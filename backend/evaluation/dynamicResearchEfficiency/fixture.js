// Synthetic orchestration replay only. This is NOT route-quality or live-provider evidence.
// The same evidence-aware model stub drives both planners: read only missing source
// records, then revise from measured tool feedback, then finish only when asked to.
const anchor={latitude:57.2,longitude:-4.7};
const places=Array.from({length:4},(_,i)=>({id:`osm:node:${i+1}`,name:`Offline hill ${i+1}`,
  category:'viewpoint',coordinate:{latitude:57.21+i/100,longitude:-4.69},coordinateKind:'mapped_point',wikidataId:`Q${i+1}`,
  source:{provider:'openstreetmap',url:`https://www.openstreetmap.org/node/${i+1}`,attribution:'© OpenStreetMap contributors',
    license:'ODbL-1.0',version:1,updatedAt:'2020-01-01T00:00:00Z',retrievedAt:'2026-09-08T22:00:00Z'},
  facts:[{code:'mapped_category',value:'viewpoint'}],limitations:['Fixture identity only. Access and safety are not verified.']}));
export const scenarios=Object.freeze([
  {name:'immediate-loop',itineraries:[[0,1,2]]},
  {name:'revision-new-stop',itineraries:[[0,1],[1,2]]},
  {name:'four-revisions',itineraries:[[0,1],[1,2],[1,3],[2,3],[0,2]]},
  {name:'point-to-point',pointToPoint:true,itineraries:[[0,1]]},
  {name:'named-places',named:true,itineraries:[[0,1]]}
]);
export const simulatedDelaysMs=Object.freeze({selection:20,web:15,osm:10,graphhopper:2,wikidata:6,commons:4});
export async function replayScenario(plan,scenario,{delays=null}={}) {
  const calls={selection:0,web:0,osm:0,graphhopper:0,wikidata:0,commons:0};
  let historyBytes=0,id=0;const attemptedItineraries=[];
  const work=async provider=>{calls[provider]++;if(delays)await new Promise(resolve=>setTimeout(resolve,delays[provider]));};
  const call=(name,args)=>({type:'function_call',id:`offline-${++id}`,name,arguments:args});
  const request={prompt:'A twelve kilometre walk through meaningful mapped hilltop places.',anchor,
    researchMode:'web_and_map',locationName:'Offline village',
    intent:{routeType:scenario.pointToPoint?'pointToPoint':'loop',activityType:'hiking',targetDistanceKm:12},
    ...(scenario.pointToPoint?{end:{latitude:57.25,longitude:-4.68}}:{})};
  const web={provider:'google_grounding',retrievedAt:'2026-09-09T00:00:00Z',observedSearchQueries:1,blocks:[{text:'Synthetic source statement for orchestration replay.',
    citations:[{url:'https://park.example.org/hills',title:'Offline fixture',startIndex:0,endIndex:9}]}],
    searchSuggestions:['<div>Offline attribution fixture</div>'],retrievedSourceURLs:['https://park.example.org/hills']};
  const enrich=async place=>{await work('wikidata');return {imageFile:place.name};};
  const deps={
    reviewPlan:async()=>({decision:'complete',summary:'Synthetic route assessment.',remainingWishes:[],evidenceIds:[]}),
    researchWeb:async()=>{await work('web');return structuredClone(web);},
    interact:async history=>{
      await work('selection');historyBytes+=Buffer.byteLength(JSON.stringify(history));
      const results=history.filter(s=>s.type==='function_result').map(s=>({name:s.name,value:JSON.parse(s.result[0].text)}));
      const discovered=results.filter(r=>['search_places','resolve_named_place'].includes(r.name));
      if(!discovered.length)return {steps:scenario.named
        ?scenario.itineraries[0].map(i=>call('resolve_named_place',{name:places[i].name,radiusMeters:6000}))
        :[call('search_places',{radiusMeters:6000,kinds:['viewpoint']})]};
      const feedback=results.filter(r=>r.name==='route_itinerary');
      if(feedback.at(-1)?.value.accepted)return {steps:[call('finish_plan',{routeId:feedback.at(-1).value.routeId})]};
      const chosen=scenario.itineraries[feedback.length];
      if(!chosen)throw Error('offline_fixture_exhausted');
      const inspected=new Set();
      for(const {value} of results)for(const place of value.places??(value.place?[value.place]:[]))if(place.source)inspected.add(place.id);
      const missing=chosen.filter(i=>!inspected.has(places[i].id));
      return {steps:missing.length?missing.map(i=>call('read_place',{placeId:places[i].id}))
        :[call('route_itinerary',{placeIds:chosen.map(i=>places[i].id)})]};
    },
    search:async()=>{await work('osm');return structuredClone(places);},
    resolve:async({name})=>{await work('osm');return {state:'resolved',place:structuredClone(places.find(p=>p.name===name))};},
    read:enrich, // Baseline-only protocol; optimized planner uses enrich after acceptance.
    enrich,
    photo:async evidence=>{await work('commons');return {url:`offline:${evidence.imageFile}`};},
    route:async({places:selected})=>{
      await work('graphhopper');attemptedItineraries.push(selected.map(p=>p.id));
      return calls.graphhopper===scenario.itineraries.length
        ?{accepted:true,statistics:{distanceMeters:12000,durationSeconds:10800,elevationGainMeters:300},limitations:['Synthetic measurements, not a real route.']}
        :{accepted:false,reasonCode:'soft_distance_deviation',statistics:{distanceMeters:18000}};
    }
  };
  const started=performance.now();const result=await plan(request,deps);
  return {calls,googleCallsExcludingIntent:calls.selection+calls.web,historyBytes,
    simulatedWallMs:delays?Math.round((performance.now()-started)*100)/100:null,
    attemptedItineraries,result};
}
