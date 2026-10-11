"""Offline audit of owner-supplied public request/result files; never calls providers.

Usage: python3 backend/quality-gates/audit_live_route.py request.json response.json
A passing receipt verifies supplied data only, not provider/device authenticity.
Owner runtime, raw-provider digest, budget and phone receipts remain mandatory.
"""
import hashlib
import json
import math
import sys

RADIUS = 6371000.0


def vector(point):
    longitude, latitude = map(math.radians, point[:2])
    return (math.cos(latitude) * math.cos(longitude),
            math.cos(latitude) * math.sin(longitude), math.sin(latitude))


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def angle(a, b):
    cross = (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
    return math.atan2(math.sqrt(dot(cross, cross)), dot(a, b))


def distance(a, b):
    return RADIUS * angle(vector(a), vector(b))


def coordinate(value):
    return [value['longitude'], value['latitude']]


def valid_point(p):
    return (isinstance(p, list) and len(p) in (2, 3)
            and all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in p)
            and -180 <= p[0] <= 180 and -90 <= p[1] <= 90)


def nearest_after(path, target, minimum=0.0, maximum_distance=None):
    """Nearest point on the remaining finite great-circle polyline, in metres.

    With a maximum distance, return the earliest qualifying position, rather
    than a later globally closest pass that might falsely invert stop order.
    No sum of snap-to-source and snap-to-path tolerances is admitted.
    """
    target = vector(target)
    best = (float('inf'), minimum)
    offset = 0.0
    for first, last in zip(path, path[1:]):
        a, b = vector(first), vector(last)
        arc = angle(a, b)
        length = arc * RADIUS
        lower = max(0.0, (minimum - offset) / RADIUS)
        if lower <= arc + 1e-12:
            candidates = [min(arc, lower), arc]
            if 1e-12 < arc < math.pi - 1e-9:
                tangent = tuple((b[i] - math.cos(arc)*a[i]) / math.sin(arc) for i in range(3))
                projected = math.atan2(dot(target, tangent), dot(target, a))
                if lower <= projected <= arc:
                    candidates.append(projected)
                if maximum_distance is not None:
                    magnitude = math.hypot(dot(target, a), dot(target, tangent))
                    threshold = math.cos(maximum_distance/RADIUS)
                    if magnitude >= threshold:
                        half_width = math.acos(min(1.0, threshold/magnitude))
                        # Move a fraction of a mm into the corridor to avoid
                        # boundary floating-point rounding above the exact cap.
                        entrance = projected-half_width+1e-11
                        if lower <= entrance <= arc:
                            candidates.append(entrance)
                qualifying = []
                for progress in candidates:
                    v = tuple(math.cos(progress)*a[i] + math.sin(progress)*tangent[i] for i in range(3))
                    candidate = (RADIUS * angle(target, v), offset + progress*RADIUS)
                    best = min(best, candidate)
                    if maximum_distance is not None and candidate[0] <= maximum_distance:
                        qualifying.append(candidate)
                if qualifying:
                    return min(qualifying, key=lambda item: item[1])
            else:
                for v, progress in [(a, 0), (b, length)]:
                    if offset + progress >= minimum:
                        best = min(best, (RADIUS * angle(target, v), offset + progress))
                        if maximum_distance is not None and RADIUS * angle(target, v) <= maximum_distance:
                            return RADIUS * angle(target, v), offset + progress
        offset += length
    return best


def audit(request, envelope):
    errors = []
    def require(condition, code):
        if not condition:
            errors.append(code)
    result = envelope.get('route', {})
    require(envelope.get('schemaVersion') == 3 and envelope.get('state') == 'routed', 'not_routed_v3')
    require(result.get('accepted') is True and result.get('plannerSource') == 'gemini_tools'
            and result.get('geometryProvider') == 'graphhopper', 'wrong_result_provenance')
    path = result.get('path', {})
    points = path.get('points', {}).get('coordinates', [])
    if len(points) < 2 or not all(valid_point(p) for p in points):
        return {'dataChecksPassed': False, 'errors': errors + ['malformed_geometry']}
    measured = {key: path.get(key) for key in ('distance', 'time', 'ascend', 'descend')}
    for key in ('distance', 'time'):
        value = measured[key]
        require(isinstance(value, (int, float)) and not isinstance(value, bool)
                and math.isfinite(value) and value > 0, 'invalid_' + key)
    for key in ('ascend', 'descend'):
        value = measured[key]
        require(value is None or (isinstance(value, (int, float)) and not isinstance(value, bool)
                and math.isfinite(value) and value >= 0), 'invalid_' + key)
    stats = result.get('statistics', {})
    require(stats.get('distanceMeters') == measured['distance'], 'distance_not_native')
    require(isinstance(measured['time'], (int, float))
            and stats.get('durationSeconds') == measured['time']/1000, 'time_not_native')
    require(stats.get('elevationGainMeters') == measured['ascend'], 'ascent_not_native')
    start = coordinate(request['anchor'])
    require(distance(points[0], start) <= 100, 'start_not_reached')
    is_loop = request['intent']['routeType'] == 'loop'
    end = start if is_loop else coordinate(request['end'])
    require(distance(points[-1], end) <= 100, 'end_not_reached')
    if is_loop:
        require(distance(points[0], points[-1]) <= 100, 'loop_not_closed')
    stops = result.get('places', [])
    require(len(stops) > 0 or not is_loop, 'missing_loop_stop')
    require(len({s['id'] for s in stops}) == len(stops), 'duplicate_stop')
    visits, progress = [], 0.0
    for stop in stops:
        identity = stop['id'].split(':')
        source = stop.get('source', {})
        require(len(identity) == 3 and identity[0] == 'osm'
                and identity[1] in ('node', 'way', 'relation') and identity[2].isdigit()
                and int(identity[2]) > 0 and source.get('provider') == 'openstreetmap'
                and source.get('url') == 'https://www.openstreetmap.org/' + '/'.join(identity[1:]),
                'source_identity_mismatch')
        target = stop['coordinate']
        access = stop.get('access') or {}
        entrance = access.get('target') or {}
        target_kind = 'poi'
        if access.get('state') == 'documented' and entrance.get('kind') == 'entrance':
            target_kind = 'entrance'
            node = entrance.get('osmId', '')
            poi_evidence = next((e for e in access.get('evidence', []) if e.get('id') == stop['id']), {})
            node_ids = poi_evidence.get('nodeIds', [])
            node_id = int(node.split(':')[-1]) if node.split(':')[-1].isdigit() else None
            allowed = (access.get('placeId') == stop['id'] and stop['id'].startswith('osm:way:')
                       and entrance.get('relationship') == 'entrance_node_on_poi_boundary'
                       and node.startswith('osm:node:') and node_id is not None and node_id > 0
                       and len(node_ids) >= 4 and node_ids[0] == node_ids[-1] and node_id in node_ids
                       and any(e.get('id') == node for e in access.get('evidence', []))
                       and entrance.get('poiVisitConfirmed') is False and entrance.get('remainingWalkMeters') is None)
            require(allowed, 'undocumented_entrance')
            if allowed:
                target = entrance['coordinate']
        require(access.get('state') != 'excluded', 'excluded_stop')
        approach, position = nearest_after(points, coordinate(target), progress, maximum_distance=100)
        require(approach <= 100, 'ordered_source_target_not_reached')
        progress = position
        visits.append({'placeId': stop['id'], 'targetKind': target_kind,
                       'directApproachMeters': approach if math.isfinite(approach) else None,
                       'routeProgressMeters': position})
    horizontal = sum(distance(a, b) for a, b in zip(points, points[1:]))
    flat = (measured['ascend'] == 0 and measured['descend'] == 0 and all(len(p) == 3 for p in points)
            and all(abs(p[2] - points[0][2]) <= 0.1 for p in points))
    if flat and isinstance(measured['distance'], (int, float)):
        require(abs(measured['distance'] - horizontal) <= max(10, horizontal*0.01), 'flat_geometry_distance_conflict')
    target = request['intent'].get('targetDistanceKm')
    if target and isinstance(measured['distance'], (int, float)):
        require(target*800 <= measured['distance'] <= target*1300, 'soft_distance_outside_range')
    constraints = request.get('constraints', {})
    for key, stat, scale in [('maximumDistanceKm', 'distance', 1000),
                             ('maximumDurationMinutes', 'time', 60000),
                             ('maximumElevationGainMeters', 'ascend', 1)]:
        if constraints.get(key) is not None:
            value = measured[stat]
            require(isinstance(value, (int, float)) and value <= constraints[key]*scale, 'hard_' + key)
    return {'dataChecksPassed': not errors, 'errors': errors, 'statistics': measured,
            'horizontalGeometryMeters': horizontal, 'flat3DCheckApplicable': flat,
            'distanceDeviationMeters': measured['distance']-target*1000 if target and isinstance(measured['distance'], (int, float)) else None,
            'stopApproaches': visits,
            'stillRequires': ['authentic runtime/provider and shared-budget receipts',
                             'grounded research and source passages', 'hard avoidance evidence when requested',
                             'photo motif and attribution review when present', 'actual iPhone UI and persistence evidence']}


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: audit_live_route.py public-request.json public-response.json')
    inputs = [open(name, 'rb').read() for name in sys.argv[1:]]
    try:
        receipt = audit(*(json.loads(data) for data in inputs))
    except (KeyError, TypeError, ValueError, IndexError) as error:
        receipt = {'dataChecksPassed': False, 'errors': ['invalid_audit_input:' + type(error).__name__]}
    receipt['inputSHA256'] = [hashlib.sha256(data).hexdigest() for data in inputs]
    receipt['evidenceClass'] = 'offline_supplied_data_audit'
    print(json.dumps(receipt, indent=2, allow_nan=False))
    raise SystemExit(0 if receipt['dataChecksPassed'] else 1)
