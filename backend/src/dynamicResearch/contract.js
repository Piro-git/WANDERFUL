import {validCoordinate} from './places.js';
const fail=()=>{throw Object.assign(new TypeError('invalid_request'),{code:'invalid_request'});};
function fields(value,required,optional=[]) {
  if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>![...required,...optional].includes(k)))fail();
}
function coordinate(value) {fields(value,['latitude','longitude']);if(!validCoordinate(value))fail();}
export function validateDynamicRequest(body) {
  if(Buffer.byteLength(JSON.stringify(body)??'')>16384)fail();
  fields(body,['schemaVersion','prompt','anchor','end','intent','constraints','parserSource'],['researchMode','locationName','plannedStartAt','preferences']);
  if(body.schemaVersion!==3||body.parserSource!=='remoteAI'||typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>4000||body.prompt.includes('\u0000'))fail();
  if(body.researchMode!==undefined&&!['mapped_places','web_and_map'].includes(body.researchMode))fail();
  if(body.researchMode==='web_and_map'&&(typeof body.locationName!=='string'||!body.locationName.trim()||body.locationName.length>200))fail();
  if(body.plannedStartAt!=null&&(typeof body.plannedStartAt!=='string'||body.plannedStartAt.length>40||!/T.*(Z|[+-]\d\d:\d\d)$/.test(body.plannedStartAt)||!Number.isFinite(Date.parse(body.plannedStartAt))))fail();
  if(body.preferences!==undefined) {
    fields(body.preferences,['desiredFeatures','avoidFeatures','targetDurationMinutes','distanceOrigin','preferenceOrigin']);
    for(const key of ['desiredFeatures','avoidFeatures'])if(!Array.isArray(body.preferences[key])||body.preferences[key].length>16||body.preferences[key].some(x=>typeof x!=='string'||!x.trim()||x.length>120||/[<>\u0000-\u001f]/.test(x)))fail();
    if(body.preferences.targetDurationMinutes!==null&&(!Number.isFinite(body.preferences.targetDurationMinutes)||body.preferences.targetDurationMinutes<=0||body.preferences.targetDurationMinutes>1440))fail();
    for(const key of ['distanceOrigin','preferenceOrigin'])if(!['prompt','saved_profile','planner_suggestion'].includes(body.preferences[key]))fail();
  }
  coordinate(body.anchor);
  fields(body.intent,['activityType','routeType','targetDistanceKm','difficulty']);
  if(!['hiking','trailRunning','biking'].includes(body.intent.activityType)||!['loop','pointToPoint'].includes(body.intent.routeType)||
    ![null,'easy','moderate','hard'].includes(body.intent.difficulty))fail();
  if(body.intent.targetDistanceKm!==null&&(!Number.isFinite(body.intent.targetDistanceKm)||body.intent.targetDistanceKm<1||body.intent.targetDistanceKm>100))fail();
  if(body.intent.routeType==='pointToPoint')coordinate(body.end);else if(body.end!==null)fail();
  fields(body.constraints,['maximumDistanceKm','maximumDurationMinutes','maximumElevationGainMeters','hardAvoidances']);
  for(const [key,max] of [['maximumDistanceKm',100],['maximumDurationMinutes',1440],['maximumElevationGainMeters',10000]]) {
    const value=body.constraints[key];if(value!==null&&(!Number.isFinite(value)||value<=0||value>max))fail();
  }
  if(!Array.isArray(body.constraints.hardAvoidances)||body.constraints.hardAvoidances.length>4||new Set(body.constraints.hardAvoidances).size!==body.constraints.hardAvoidances.length||
    body.constraints.hardAvoidances.some(x=>!['majorRoads','steepClimbs','crowds','repeatedPath'].includes(x)))fail();
  return structuredClone(body);
}
