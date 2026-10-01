// Independent offline provider-boundary probes. Names and geography are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDynamicItineraryRouter} from '../src/dynamicResearch/routing.js';
import {linkedWikidataEvidence,licensedCommonsPhoto} from '../src/dynamicResearch/placeMedia.js';

const toLine=points=>({type:'LineString',coordinates:points.map(({longitude,latitude})=>[longitude,latitude])});
function metres(a,b) {
  const r=Math.PI/180,dLat=(b.latitude-a.latitude)*r,dLon=(b.longitude-a.longitude)*r;
  const h=Math.sin(dLat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dLon/2)**2;
  return 12742000*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
const pathLength=points=>points.slice(1).reduce((sum,p,i)=>sum+metres(points[i],p),0);
function response(path,snaps,{distance=pathLength(path),time=24*3600_000,ascent=240}={}) {
  return {provider:'graphhopper',snapped_waypoints:toLine(snaps),paths:[{distance,time,ascend:ascent,descend:ascent,
    points:toLine(path),instructions:[{text:'Continue',distance,time,interval:[0,path.length-1],sign:0}],
    details:{road_class:[[0,path.length-1,'path']],surface:[],hike_rating:[]}}]};
}
function loopInput(start,stops,targetDistanceKm=null) {
  return {request:{anchor:start,intent:{activityType:'hiking',routeType:'loop',targetDistanceKm,difficulty:null}},
    places:stops.map((coordinate,i)=>({id:`osm:node:${700+i}`,coordinate}))};
}

test('a 20 km sparse segment crossing the date line at 75 degrees reaches its midpoint',async()=>{
  const a={latitude:75,longitude:179.6},b={latitude:75,longitude:-179.6};
  const c={latitude:75.18,longitude:-179.6},d={latitude:75.18,longitude:179.6};
  // The midpoint of a great-circle arc at this latitude is slightly poleward.
  const arcMidLatitude=latitude=>Math.atan2(Math.sin(latitude*Math.PI/180),
    Math.cos(latitude*Math.PI/180)*Math.cos(0.4*Math.PI/180))*180/Math.PI;
  const first={latitude:arcMidLatitude(75),longitude:180};
  const second={latitude:arcMidLatitude(75.18),longitude:180};
  const path=[a,b,c,d,a],snaps=[a,first,second,a];
  assert.ok(metres(a,b)>20000);
  const result=await createDynamicItineraryRouter({provider:{route:async req=>{
    assert.equal(req.profile,'foot');return response(path,snaps);
  }}})(loopInput(a,[first,second]));
  assert.equal(result.accepted,true,result.reasonCode);
  assert.ok(result.waypointChecks[1].routeApproachMeters<1);
  assert.ok(result.waypointChecks[2].routeApproachMeters<1);
});

test('reverse ordered stops on the same sparse segment cannot be called an ordered itinerary',async()=>{
  const a={latitude:0,longitude:0},b={latitude:0,longitude:0.02};
  const c={latitude:0.01,longitude:0.02},d={latitude:0.01,longitude:0};
  const early={latitude:0,longitude:0.006},late={latitude:0,longitude:0.014};
  const path=[a,b,c,d,a];
  const result=await createDynamicItineraryRouter({provider:{route:async()=>response(path,[a,late,early,a])}})(loopInput(a,[late,early]));
  assert.equal(result.accepted,false);
  assert.equal(result.reasonCode,'waypoint_order_invalid');
});

test('loop endpoint more than 100 m from its requested start does not pass',async()=>{
  const a={latitude:-30,longitude:140},b={latitude:-30,longitude:140.01};
  const c={latitude:-29.99,longitude:140.01};
  const end={latitude:-29.9989,longitude:140};
  const path=[a,b,c,end];
  assert.ok(metres(a,end)>100&&metres(a,end)<150);
  const result=await createDynamicItineraryRouter({provider:{route:async()=>response(path,[a,b,c,end])}})(loopInput(a,[b,c]));
  assert.equal(result.accepted,false);
});

test('moderate target deviation keeps measured distance and does not claim exact target',async()=>{
  const a={latitude:-30,longitude:140},b={latitude:-30,longitude:140.01};
  const c={latitude:-29.99,longitude:140.01},path=[a,b,c,a];
  const measured=pathLength(path),target=measured/1000/1.2;
  const result=await createDynamicItineraryRouter({provider:{route:async()=>response(path,path)}})(loopInput(a,[b,c],target));
  assert.equal(result.accepted,true,result.reasonCode);
  assert.equal(result.statistics.distanceMeters,measured);
  assert.match(result.explanation,new RegExp(`measured ${(measured/1000).toFixed(1)} km`));
});

test('provider distance 25 percent above its supplied geometry cannot become a verified statistic',async()=>{
  const a={latitude:-30,longitude:140},b={latitude:-30,longitude:140.01};
  const c={latitude:-29.99,longitude:140.01},path=[a,b,c,a];
  const overstated=pathLength(path)*1.25;
  const fixture=response(path,path,{distance:overstated,time:3_600_000,ascent:0});
  fixture.paths[0].descend=0;
  // Flat 3D vertices and straight legs leave no climb or omitted bend to explain the gap.
  fixture.paths[0].points.coordinates=path.map(({longitude,latitude})=>[longitude,latitude,0]);
  fixture.snapped_waypoints.coordinates=path.map(({longitude,latitude})=>[longitude,latitude,0]);
  const result=await createDynamicItineraryRouter({provider:{route:async()=>fixture}})(loopInput(a,[b,c]));
  assert.equal(result.accepted,false,'25% discrepancy between routed geometry and provider statistic should fail');
  assert.equal(result.statistics,undefined);
});

test('two individually tolerated gaps cannot place a POI 178 m from the actual route',async()=>{
  const a={latitude:0,longitude:0},b={latitude:0,longitude:0.02};
  const c={latitude:0.01,longitude:0.02},d={latitude:0.01,longitude:0};
  const path=[a,b,c,d,a];
  const poi={latitude:0.0016,longitude:0.01};
  const snap={latitude:0.0008,longitude:0.01};
  assert.ok(metres(poi,{latitude:0,longitude:0.01})>170);
  assert.ok(metres(poi,snap)<100);
  assert.ok(metres(snap,{latitude:0,longitude:0.01})<100);
  const result=await createDynamicItineraryRouter({provider:{route:async()=>response(path,[a,snap,c,a])}})(loopInput(a,[poi,c]));
  assert.equal(result.accepted,false,'source POI must be within 100 m of the actual routed line');
  assert.equal(result.statistics,undefined);
});

test('a Commons image requires the selected object, nearby Wikidata location, exact file and license credit',()=>{
  const place={id:'osm:node:700',wikidataId:'Q700',coordinate:{latitude:-30,longitude:140}};
  const wikidata=coordinate=>({entities:{Q700:{id:'Q700',type:'item',claims:{
    P625:[{rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:{...coordinate,globe:'http://www.wikidata.org/entity/Q2'}}}}],
    P18:[{rank:'normal',mainsnak:{snaktype:'value',datavalue:{value:'Synthetic stop.jpg'}}}]
  }}}});
  assert.equal(linkedWikidataEvidence(wikidata({latitude:-30,longitude:140.004}),place),null);
  const evidence=linkedWikidataEvidence(wikidata({latitude:-30,longitude:140.0005}),place);
  assert.equal(evidence.imageFile,'Synthetic stop.jpg');
  const page={title:'File:Synthetic stop.jpg',imageinfo:[{mime:'image/jpeg',thumbmime:'image/jpeg',
    thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Synthetic_stop.jpg/800px-Synthetic_stop.jpg',
    extmetadata:{LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'},
      Artist:{value:'Fixture photographer'}}}]};
  const valid=licensedCommonsPhoto({query:{pages:[page]}},evidence);
  assert.equal(valid.credit,'Fixture photographer');
  assert.equal(valid.placeSourceURL,'https://www.wikidata.org/wiki/Q700');
  assert.equal(licensedCommonsPhoto({query:{pages:[{...page,title:'File:Other stop.jpg'}]}},evidence),null);
  const noCredit=structuredClone(page);delete noCredit.imageinfo[0].extmetadata.Artist;
  assert.equal(licensedCommonsPhoto({query:{pages:[noCredit]}},evidence),null);
});
