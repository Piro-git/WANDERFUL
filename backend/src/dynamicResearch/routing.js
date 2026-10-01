import {validCoordinate,distanceMeters} from './places.js';
import {evaluateLLMRouteCandidateV1} from '../llmPlanning/llmFirstPlanningOrchestrator.js';
import {validateRouteRequest} from '../routing/routeValidation.js';
import {RouteError} from '../routing/routeErrors.js';

// All geometry/statistics originate in the central routing provider; model output contains IDs only.
export function createDynamicItineraryRouter({provider}) {
  return async({request,places},{signal}={})=>{
    const {intent}=request;
    // The bounded pilot supports five provider locations including both endpoints.
    if(places.length>3)return {accepted:false,reasonCode:'too_many_places'};
    if(!['hiking','trailRunning','biking'].includes(intent?.activityType))throw new TypeError('invalid_research_activity');
    const target=intent.targetDistanceKm;
    if(target!=null&&(!Number.isFinite(target)||target<=0))throw new TypeError('invalid_research_constraints');
    const constraints=request.constraints??{};
    const hardAvoidances=constraints.hardAvoidances??[];
    if(!Array.isArray(hardAvoidances)||hardAvoidances.some(x=>!['majorRoads','repeatedPath'].includes(x))) {
      return {accepted:false,reasonCode:'hard_constraint_evidence_unavailable'};
    }
    for(const key of ['maximumDistanceKm','maximumDurationMinutes','maximumElevationGainMeters']) {
      if(constraints[key]!=null&&(!Number.isFinite(constraints[key])||constraints[key]<=0))throw new TypeError('invalid_research_constraints');
    }
    if(places.some(p=>p.access?.state==='excluded'))return {accepted:false,reasonCode:'access_excluded'};
    const targets=places.map(p=>{
      const a=p.access;
      if(a?.state!=='documented'||a.target?.kind!=='entrance')return p.coordinate;
      const t=a.target,poi=a.evidence?.find(e=>e.id===p.id);
      const nodeID=Number(t.osmId?.split(':').at(-1));
      if(a.placeId!==p.id||t.relationship!=='entrance_node_on_poi_boundary'||!validCoordinate(t.coordinate)||
        !p.id.startsWith('osm:way:')||!t.osmId?.startsWith('osm:node:')||!Number.isSafeInteger(nodeID)||nodeID<=0||
        !a.evidence?.some(e=>e.id===t.osmId)||!Array.isArray(poi?.nodeIds)||poi.nodeIds.length<4||
        poi.nodeIds[0]!==poi.nodeIds.at(-1)||!poi.nodeIds.includes(nodeID)||t.poiVisitConfirmed!==false||t.remainingWalkMeters!==null)throw new TypeError('invalid_access_evidence');
      return t.coordinate;
    });
    const points=[request.anchor,...targets,intent.routeType==='loop'?request.anchor:request.end];
    const routeRequest=validateRouteRequest({profile:intent.activityType==='biking'?'bike':'foot',routeType:intent.routeType,points,
      locale:'en',includeElevation:true,includeInstructions:true,includePathDetails:['surface','road_class','hike_rating']});
    let providerResponse;
    try {
      providerResponse=await provider.route(routeRequest,{signal,unsimplifiedGeometry:true});
    } catch (error) {
      // A provider-confirmed missing connection is itinerary feedback, not a service outage.
      // The state machine may ask the model for a distinct revision inside the same route budget.
      if (!signal?.aborted && error instanceof RouteError && error.code === 'route_not_found') {
        return {accepted:false,reasonCode:'route_connection_not_found'};
      }
      throw error;
    }
    const path=providerResponse?.paths?.[0];
    // Statistics are disclosed only after validating real geometry, instructions and provenance.
    const quality=evaluateLLMRouteCandidateV1({intent:{...intent,targetDistanceKm:null},routeRequest,requestedWaypoints:points,providerResponse,
      maximumWaypointApproachMeters:100});
    if(!quality.accepted) {
      const failed=quality.failedWaypointIndex;
      const unreachedPlaceId=Number.isInteger(failed)&&failed>0&&failed<=places.length&&
        ['waypoint_snap_exceeded','waypoint_not_reached'].includes(quality.reasonCode)
        ? places[failed-1].id : null;
      return {accepted:false,reasonCode:quality.reasonCode,
        ...(unreachedPlaceId?{unreachedPlaceIds:[unreachedPlaceId]}:{})};
    }
    if (flatGeometryStatisticsConflict(quality.path)) {
      return {accepted:false,reasonCode:'invalid_statistics'};
    }
    const statistics={distanceMeters:path.distance,durationSeconds:path.time/1000,elevationGainMeters:path.ascend??null};
    const rejected=reasonCode=>({accepted:false,reasonCode,statistics});
    const unreached=quality.waypointChecks.filter(c=>c.snapDistanceMeters>100||c.routeApproachMeters>100);
    if(unreached.length)return {...rejected('place_approach_too_far'),unreachedPlaceIds:unreached.map(c=>places[c.waypointIndex-1]?.id).filter(Boolean)};
    if((constraints.maximumDistanceKm!=null&&path.distance>constraints.maximumDistanceKm*1000)||
      (constraints.maximumDurationMinutes!=null&&path.time>constraints.maximumDurationMinutes*60000)||
      (constraints.maximumElevationGainMeters!=null&&(!Number.isFinite(path.ascend)||path.ascend>constraints.maximumElevationGainMeters)))return rejected('hard_constraint_exceeded');
    if(hardAvoidances.includes('majorRoads')) {
      const details=path.details?.road_class;
      let covered=0;
      if(!Array.isArray(details)||details.length===0)return rejected('road_evidence_unavailable');
      for(const [from,to,road] of details) {
        if(from!==covered||!Number.isInteger(to)||to<=from||!['path','track','footway','pedestrian','cycleway','steps','service','residential','living_street'].includes(road))return rejected('road_exclusion_unverified');
        covered=to;
      }
      if(covered!==path.points.coordinates.length-1)return rejected('road_evidence_incomplete');
    }
    if(hardAvoidances.includes('repeatedPath')&&quality.metrics.backtrackingRatio>0.02)return rejected('repeated_path_excluded');
    if(target!=null&&(path.distance<target*1000*0.8||path.distance>target*1000*1.3))return rejected('soft_distance_deviation');
    return {accepted:true,stopVisits:places.map(p=>({placeId:p.id,targetKind:p.access?.target?.kind??'poi',targetReached:true,poiVisitConfirmed:false})),geometryProvider:'graphhopper',path:quality.path,statistics,waypointChecks:quality.waypointChecks,
      metrics:quality.metrics,limitations:['Routes are planning aids. Check weather, local rules, trail conditions and water availability.',
        'Mapped place categories do not verify current views, access or safety.'],
      explanation:target==null?'Gemini selected and ordered sourced places. GraphHopper calculated the route.':
        `Gemini selected and ordered sourced places. GraphHopper measured ${(path.distance/1000).toFixed(1)} km against your requested ${target} km.`};
  };
}

function flatGeometryStatisticsConflict(path) {
  const points = path.points.coordinates;
  // Do not mistake a sparse 2D chord or real elevation for an invalid distance.
  // Tighten only complete, flat 3D evidence with explicitly zero ascent/descent.
  if (path.ascend !== 0 || path.descend !== 0 ||
      points.some(p => p.length !== 3 || !Number.isFinite(p[2]))) return false;
  const baseElevation = points[0][2];
  if (points.some(p => Math.abs(p[2] - baseElevation) > 0.1)) return false;
  let horizontal = 0;
  for (let i = 1; i < points.length; i++) {
    horizontal += distanceMeters(
      {longitude:points[i-1][0],latitude:points[i-1][1]},
      {longitude:points[i][0],latitude:points[i][1]});
  }
  // Screening allowance: 1% for geodesic/model differences, minimum 10m.
  // Extra vertices must not buy a larger error budget for the same route.
  // This screens unresolved conflicts; it is not a universal error bound for
  // simplification. Hosted behaviour still requires a live provider receipt.
  const allowance = Math.max(10, horizontal * 0.01);
  return Math.abs(path.distance - horizontal) > allowance;
}
