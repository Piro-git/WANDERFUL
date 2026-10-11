"""Synthetic tests of the independent receipt auditor, not live acceptance."""
import copy
import math
import unittest
from audit_live_route import audit, distance, nearest_after, vector


def fixture():
    points = [[0, 0, 0], [0.02, 0, 0], [0.02, 0.01, 0], [0, 0.01, 0], [0, 0, 0]]
    length = sum(distance(a, b) for a, b in zip(points, points[1:]))
    request = {'anchor': {'longitude': 0, 'latitude': 0}, 'end': None,
               'intent': {'routeType': 'loop', 'targetDistanceKm': length/1000}, 'constraints': {}}
    stops = [{'id': 'osm:node:1', 'coordinate': {'longitude': 0.01, 'latitude': 0},
              'source': {'provider': 'openstreetmap', 'url': 'https://www.openstreetmap.org/node/1'}}]
    envelope = {'schemaVersion': 3, 'state': 'routed', 'route': {
        'accepted': True, 'plannerSource': 'gemini_tools', 'geometryProvider': 'graphhopper',
        'places': stops, 'path': {'points': {'coordinates': points}, 'distance': length,
                                 'time': 3600000, 'ascend': 0, 'descend': 0},
        'statistics': {'distanceMeters': length, 'durationSeconds': 3600, 'elevationGainMeters': 0}}}
    return request, envelope


class ReceiptAuditTests(unittest.TestCase):
    def test_native_stats_and_midsegment_target(self):
        result = audit(*fixture())
        self.assertTrue(result['dataChecksPassed'], result)
        self.assertLessEqual(result['stopApproaches'][0]['directApproachMeters'], 100)
        self.assertLess(result['stopApproaches'][0]['routeProgressMeters'], 1120)

    def test_snap_gaps_do_not_accumulate(self):
        request, envelope = fixture()
        envelope['route']['places'][0]['coordinate']['latitude'] = 0.0016
        # Provider's imaginary snap is 89m from POI and 89m from path.
        envelope['route']['waypointChecks'] = [{'snapDistanceMeters': 89, 'routeApproachMeters': 89}]
        self.assertIn('ordered_source_target_not_reached', audit(request, envelope)['errors'])

    def test_reversed_midsegment_order(self):
        request, envelope = fixture()
        first = envelope['route']['places'][0]
        first['coordinate']['longitude'] = 0.014
        second = copy.deepcopy(first)
        second.update(id='osm:node:2', source={'provider': 'openstreetmap', 'url': 'https://www.openstreetmap.org/node/2'})
        second['coordinate']['longitude'] = 0.006
        envelope['route']['places'].append(second)
        self.assertIn('ordered_source_target_not_reached', audit(request, envelope)['errors'])

    def test_loop_with_two_tolerated_endpoint_gaps_still_must_close(self):
        request, envelope = fixture()
        envelope['route']['path']['points']['coordinates'][0][0] = -0.0008
        envelope['route']['path']['points']['coordinates'][-1][0] = 0.0008
        self.assertIn('loop_not_closed', audit(request, envelope)['errors'])

    def test_hard_limit_stays_hard(self):
        request, envelope = fixture()
        request['constraints']['maximumDurationMinutes'] = 59
        self.assertIn('hard_maximumDurationMinutes', audit(request, envelope)['errors'])

    def test_soft_distance_allows_small_deviation(self):
        request, envelope = fixture()
        request['intent']['targetDistanceKm'] /= 1.2
        result = audit(request, envelope)
        self.assertTrue(result['dataChecksPassed'], result)
        self.assertGreater(result['distanceDeviationMeters'], 0)

    def test_fake_native_stat_and_source_url(self):
        request, envelope = fixture()
        envelope['route']['statistics']['durationSeconds'] = 3599
        envelope['route']['places'][0]['source']['url'] = 'https://www.openstreetmap.org/node/2'
        errors = audit(request, envelope)['errors']
        self.assertIn('time_not_native', errors)
        self.assertIn('source_identity_mismatch', errors)

    def test_flat_distance_allowance_is_resampling_invariant(self):
        request, sparse = fixture()
        dense = copy.deepcopy(sparse)
        original = sparse['route']['path']['points']['coordinates']
        subdivided = []
        # Spherical interpolation preserves each original finite geodesic arc.
        for start, end in zip(original, original[1:]):
            a, b = vector(start), vector(end)
            arc = distance(start, end)/6371000
            for step in range(300):
                f = step/300
                v = [math.sin((1-f)*arc)/math.sin(arc)*a[i] + math.sin(f*arc)/math.sin(arc)*b[i] for i in range(3)]
                subdivided.append([math.degrees(math.atan2(v[1], v[0])),
                                   math.degrees(math.atan2(v[2], math.hypot(v[0], v[1]))), 0])
        subdivided.append(original[-1])
        dense['route']['path']['points']['coordinates'] = subdivided
        sparse_receipt, dense_receipt = audit(request, sparse), audit(request, dense)
        self.assertAlmostEqual(sparse_receipt['horizontalGeometryMeters'], dense_receipt['horizontalGeometryMeters'], places=6)
        self.assertTrue(dense_receipt['dataChecksPassed'], dense_receipt)
        for envelope in (sparse, dense):
            envelope['route']['path']['distance'] *= 1.25
            envelope['route']['statistics']['distanceMeters'] = envelope['route']['path']['distance']
            self.assertIn('flat_geometry_distance_conflict', audit(request, envelope)['errors'])

    def test_dateline_high_latitude_finite_arc(self):
        latitude = math.degrees(math.atan2(math.sin(math.radians(75)), math.cos(math.radians(75))*math.cos(math.radians(0.4))))
        approach, progress = nearest_after([[179.6, 75], [-179.6, 75]], [180, latitude])
        self.assertLess(approach, 0.001)
        self.assertAlmostEqual(progress, distance([179.6, 75], [-179.6, 75])/2, places=5)

    def test_earlier_qualifying_pass_wins_over_later_exact_pass(self):
        path = [[0, 0], [0.02, 0], [0.02, 0.01], [0.01, 0.0005], [0, 0]]
        target = [0.01, 0.0005]
        approach, position = nearest_after(path, target, maximum_distance=100)
        self.assertLessEqual(approach, 100)
        self.assertLess(position, distance(path[0], path[1]))

    def test_entrance_requires_documented_topology(self):
        request, envelope = fixture()
        stop = envelope['route']['places'][0]
        stop.update(id='osm:way:7', source={'provider': 'openstreetmap', 'url': 'https://www.openstreetmap.org/way/7'},
                    coordinate={'longitude': 0.01, 'latitude': 0.005})
        stop['access'] = {'state': 'documented', 'placeId': stop['id'], 'target': {
            'kind': 'entrance', 'coordinate': {'longitude': 0.01, 'latitude': 0},
            'osmId': 'osm:node:8', 'relationship': 'entrance_node_on_poi_boundary',
            'poiVisitConfirmed': False, 'remainingWalkMeters': None},
            'evidence': [{'id': 'osm:way:7', 'nodeIds': [8, 9, 10, 8]}, {'id': 'osm:node:8'}]}
        self.assertTrue(audit(request, envelope)['dataChecksPassed'])
        stop['access']['evidence'][0]['nodeIds'] = [9, 10, 11, 9]
        self.assertIn('undocumented_entrance', audit(request, envelope)['errors'])


if __name__ == '__main__':
    unittest.main()
