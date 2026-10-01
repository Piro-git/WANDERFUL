import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=process.env.CANDIDATE_ROOT;
const imp=p=>import(pathToFileURL(`${root}/${p}`));
const {planDynamicResearch}=await imp('backend/src/dynamicResearch/planner.js');
const {parseHarzNewsArticle}=await imp('backend/src/dynamicResearch/regionalConditions.js');
const {evaluateConditions}=await imp('backend/src/dynamicResearch/localConditions.js');
const anchor={latitude:51.86,longitude:10.68};
const places=[1,2,3].map(i=>({id:`osm:node:${i}`,name:`Fixture ${i}`,coordinate:anchor,source:{provider:'openstreetmap',url:`https://www.openstreetmap.org/node/${i}`}}));
const now=Date.parse('2026-09-09T10:00:00Z');
const request={prompt:'15 km Rundwanderung mit Aussicht',researchMode:'web_and_map',locationName:'Ilsenburg',anchor,end:null,intent:{activityType:'hiking',routeType:'loop',targetDistanceKm:15,difficulty:null}};
const web={provider:'google_grounding',retrievedAt:new Date(now).toISOString(),observedSearchQueries:1,blocks:[{text:'Place evidence.',citations:[{url:places[0].source.url,title:'OSM',startIndex:0,endIndex:15}]}],retrievedSourceURLs:[places[0].source.url],searchSuggestions:['<div>Fixture attribution</div>']};
let turns=0,routes=0,reviews=0,error=null,result=null;
try {
 result=await planDynamicResearch(request,{
 researchWeb:async()=>web,search:async()=>places,
 interact:async()=>{turns++;return {steps:[turns===1?{type:'function_call',id:'s',name:'search_places',arguments:{radiusMeters:7000,kinds:['viewpoint']}}:{type:'function_call',id:`r${turns}`,name:'route_itinerary',arguments:{placeIds:[places[turns-2].id]}}]};},
 route:async()=>({accepted:true,statistics:{distanceMeters:[12000,13000,14900][routes++],durationSeconds:3600,elevationGainMeters:100}}),
 reviewPlan:async context=>{reviews++;return {decision:reviews<3?'revise':'complete',summary:'Eine passendere bekannte Alternative prüfen.',remainingWishes:[],evidenceIds:context.selectedPlaces.map(p=>p.id)};}
 });
}catch(e){error=e.code??e.message;}
const revision={scenario:'Two reviews request improvement; third measured candidate is valid and closer to 15 km',routes,reviews,error,returnedRoute:result?.statistics??null};
assert.notEqual(error,'research_budget_exhausted','must reach a controlled terminal state');assert.ok(routes<=2,'no third route without review capacity');assert.equal(reviews,2);assert.equal(result,null,'revise must not be silently promoted');assert.ok(error,'an explicit controlled terminal failure is required');
const area=[10.57,51.79,10.7,51.89];
const html='<article><div>Datum: 09.09.2026</div><h1>Hirtenstieg: Sperrung aufgehoben</h1><p>Die bisher bis auf Weiteres geltende Sperrung auf dem Hirtenstieg wurde aufgehoben. Der Weg ist wieder geöffnet.</p></article>';
const notices=parseHarzNewsArticle(html,{url:'https://www.nationalpark-harz.de/de/aktuelles/2026/Hirtenstieg/',area,checkedAt:new Date(now).toISOString()});
const evaluated=evaluateConditions({area,notices,sources:[],checkedAt:new Date(now).toISOString()},{now});
const n=evaluated.notices[0];
const revoked={scenario:'Explicit reopened notice describes previous until-revoked closure',title:n.title,status:n.status,validity:n.validity,blocksRoute:n.blocksRoute,excerpt:n.sourceExcerpt};
assert.notEqual(n.status,'active','explicit revoked closure must not be active');assert.notEqual(n.validity,'active');assert.equal(n.blocksRoute,false);assert.ok(n.sourceExcerpt.includes('aufgehoben'));
const output={scope:'Synthetic offline regression probes, no live providers and no product edits',candidateRoot:root,revision,revoked};
await fs.writeFile(process.env.REVIEW_OUTPUT,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
