import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedWikidataEvidence,directOsmCommonsEvidence,licensedCommonsPhoto,createLinkedPlaceReader} from '../src/dynamicResearch/placeMedia.js';
const place={wikidataId:'Q123',coordinate:{latitude:57.2,longitude:-4.7}};
const claim=value=>({rank:'normal',mainsnak:{snaktype:'value',datavalue:{value}}});
const data=()=>({entities:{Q123:{id:'Q123',type:'item',claims:{P625:[claim({...place.coordinate,globe:'http://www.wikidata.org/entity/Q2'})],P18:[claim('Named place.jpg')]}}}});
const evidence=()=>linkedWikidataEvidence(data(),place);
const photo=()=>({query:{pages:[{title:'File:Named place.jpg',imageinfo:[{mime:'image/jpeg',thumbmime:'image/jpeg',thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Named_place.jpg/800px-Named_place.jpg',extmetadata:{
  Artist:{value:'<a href="https://example.invalid">A Photographer</a>'},LicenseShortName:{value:'CC BY-SA 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by-sa/4.0/'}}}]}]}});
test('place identity and nearby Earth coordinate establish explicit photo link',()=>{
 const item=evidence();assert.equal(item.imageFile,'Named place.jpg');assert.equal(item.sourceURL,'https://www.wikidata.org/wiki/Q123');
 const result=licensedCommonsPhoto(photo(),item);assert.equal(result.credit,'A Photographer');assert.equal(result.license,'CC BY-SA 4.0');
});
test('an exact OSM Commons File tag is a place-bound fallback without Wikidata',()=>{
 const direct={id:'osm:node:9',coordinate:place.coordinate,commonsFile:'Mapped waterfall.jpg',
  source:{url:'https://www.openstreetmap.org/node/9'}};
 const item=directOsmCommonsEvidence(direct);
 assert.deepEqual(item,{id:'osm:node:9',sourceURL:'https://www.openstreetmap.org/node/9',license:'ODbL-1.0',imageFile:'Mapped waterfall.jpg'});
 assert.equal(directOsmCommonsEvidence({...direct,commonsFile:'Category:Waterfalls'}),null);
 assert.equal(directOsmCommonsEvidence({...direct,source:{url:'https://www.openstreetmap.org/node/10'}}),null);
});
test('mismatched identity, far coordinates and ambiguous imagery never select a photo',()=>{
 for(const mutate of [e=>{e.id='Q999';},e=>{e.claims.P625[0].mainsnak.datavalue.value.latitude=10;},e=>{e.claims.P625=null;},e=>{e.claims.P625=[claim(null)];}]) {
  const d=data();mutate(d.entities.Q123);assert.equal(linkedWikidataEvidence(d,place),null);
 }
 const d=data();d.entities.Q123.claims.P18.push(claim('Other.jpg'));assert.equal(linkedWikidataEvidence(d,place).imageFile,null);
});
test('unrecognized licenses, missing credit, malicious URLs and wrong files are omitted',()=>{
 for(const mutate of [p=>{p.title='File:Other place.jpg';},p=>{p.imageinfo[0].extmetadata.LicenseShortName.value='Fair use';},
  p=>{delete p.imageinfo[0].extmetadata.Artist;},p=>{p.imageinfo[0].thumburl='https://example.invalid/image.jpg';},
  p=>{p.imageinfo[0].extmetadata.Artist.value='<script>alert(1)</script>';},p=>{p.imageinfo[0].extmetadata.LicenseUrl.value='https://example.invalid/license';}]) {
  const d=photo();mutate(d.query.pages[0]);assert.equal(licensedCommonsPhoto(d,evidence()),null);
 }
});
test('explicit attribution overrides artist and stays plain text',()=>{
 const d=photo();d.query.pages[0].imageinfo[0].extmetadata.Attribution={value:'Photo by <b>Author</b> &amp; archive'};
 assert.equal(licensedCommonsPhoto(d,evidence()).credit,'Photo by Author & archive');
});
test('a verified Commons thumbnail CDN URL remains eligible',()=>{
 const d=photo();d.query.pages[0].imageinfo[0].thumburl='https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Named_place.jpg/800px-Named_place.jpg?utm_source=commons.wikimedia.org';
 assert.equal(licensedCommonsPhoto(d,evidence()).url,d.query.pages[0].imageinfo[0].thumburl);
});
test('source reader never fetches model-provided URLs or missing IDs',async()=>{
 let calls=0;
 const reader=createLinkedPlaceReader({userAgent:'Wanderful offline test',fetchImpl:async()=>{calls++;throw new Error('unexpected fetch');}});
 assert.equal(await reader.enrich({coordinate:place.coordinate,wikidataId:'https://example.invalid'}),null);
 assert.equal(await reader.photo({}),null);assert.equal(calls,0);
});

test('thumbnail file identity cannot substitute a different Commons image',()=>{
 for(const path of ['Other_place.jpg/800px-Other_place.jpg','%ZZ/800px-Named_place.jpg']) {
  const d=photo();d.query.pages[0].imageinfo[0].thumburl=`https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${path}`;
  assert.equal(licensedCommonsPhoto(d,evidence()),null);
 }
});
test('exact identity works in multiple regions without a name-based fallback',()=>{
 for(const coordinate of [{latitude:51.8,longitude:10.6},{latitude:-33.86,longitude:151.21},{latitude:35.36,longitude:138.73}]) {
  const d=data();d.entities.Q123.claims.P625=[claim({...coordinate,globe:'http://www.wikidata.org/entity/Q2'})];
  assert.ok(linkedWikidataEvidence(d,{...place,coordinate}));
  assert.equal(linkedWikidataEvidence(d,place),null);
 }
});

test('Commons license URLs without a trailing slash normalize to the canonical supported license',()=>{
 const d=photo();d.query.pages[0].imageinfo[0].extmetadata.LicenseUrl.value='https://creativecommons.org/licenses/by-sa/4.0';
 assert.equal(licensedCommonsPhoto(d,evidence()).licenseURL,'https://creativecommons.org/licenses/by-sa/4.0/');
 for(const url of ['https://creativecommons.org/licenses/by-sa/4.0?other=1','https://creativecommons.org/licenses/by-sa/4.0.evil','https://example.invalid/licenses/by-sa/4.0']) {
  d.query.pages[0].imageinfo[0].extmetadata.LicenseUrl.value=url;
  assert.equal(licensedCommonsPhoto(d,evidence()),null);
 }
});
