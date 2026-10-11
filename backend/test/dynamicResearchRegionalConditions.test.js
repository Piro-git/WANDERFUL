import test from 'node:test';import assert from 'node:assert/strict';
import {parseInnsbruckNotices,parseHarzNewsArticle,discoverHarzNews,germanDay,noticeTiming,REGIONAL_SOURCES} from '../src/dynamicResearch/regionalConditions.js';
import {createConditionLookup,harzQuery,parseHarz} from '../src/dynamicResearch/conditionSources.js';
import {evaluateConditions,validateNotice} from '../src/dynamicResearch/localConditions.js';
const now=Date.parse('2026-09-09T08:00:00Z'),checkedAt=new Date(now).toISOString(),area=[11.37,47.22,11.42,47.28];
const inn=(extra='')=>`<main><h2>Wo sind weitere Wegsperren?</h2><h3>Emile-Béthouart-Steg</h3><p>Am 7. September und 8. September 2026 gesperrt.</p><h3>Sillschlucht Severinisteig</h3><p>Severinisteig zwischen Gärberbach und Sonnenburgerhof bis auf Widerruf gesperrt.</p><h3>Sillschlucht Bauarbeiten</h3><p>Der Zugang zur Sillschlucht ist zeitweise geschlossen.</p>${extra}<h2>Kontakt</h2><footer>Zuletzt aktualisiert am 04.09.2026</footer></main>`;
const evalNotices=(notices,options={})=>evaluateConditions({area,notices,sources:[],checkedAt},{now,...options});
const article=(text='Hirtenstieg zum Brocken bis auf Weiteres gesperrt.',date='02.09.2026')=>`<article><div>Datum: ${date}</div><h1>Update zur Sperrung Hirtenstieg</h1><p>${text}</p></article>`;
test('city current page separates expired closure, until-revoked and intermittent restrictions',()=>{
 const parsed=parseInnsbruckNotices(inn(),{area,checkedAt});assert.equal(parsed.length,3);assert.equal(parsed[0].publishedAt,null);assert.equal(parsed[0].sourceUpdatedAt,'2026-09-04T00:00:00.000Z');
 const result=evalNotices(parsed);assert.deepEqual(result.notices.map(n=>n.validity),['expired','active','unknown']);assert.ok(result.notices.every(n=>n.spatial==='area'&&!n.blocksRoute));
 assert.equal(parsed[0].validUntil,'2026-09-08T22:00:00.000Z');
});
test('long-standing official explicit closure stays active on fresh fetch, without refreshing publication',()=>{
 const n=validateNotice({id:'x',eventId:'x',kind:'closure',title:'Works',areaLabel:'Innsbruck',action:'Check details.',status:'active',publishedAt:'2026-01-01T00:00:00Z',retrievedAt:checkedAt,validFrom:'2026-01-01T00:00:00Z',validUntil:'2026-12-01T00:00:00Z',temporalBasis:'explicit_interval'},REGIONAL_SOURCES[1]);
 assert.equal(evalNotices([n]).notices[0].validity,'active');assert.equal(evalNotices([n]).notices[0].publishedAt,'2026-01-01T00:00:00Z');
 assert.equal(evalNotices([n],{now:now+7*3600000}).notices[0].freshness,'stale');
});
test('future hiking date cannot inherit present indefinite restriction certainty; old snapshot stays stale',()=>{
 const notices=parseInnsbruckNotices(inn(),{area,checkedAt});
 assert.equal(evalNotices(notices,{visitTime:'2026-10-01T08:00:00Z'}).notices[1].validity,'unknown');
 assert.equal(evalNotices(notices,{now:now+7*3600000}).notices[1].validity,'stale');
});
test('missing city update date remains missing, without dropping useful published wording',()=>{
 const notices=parseInnsbruckNotices(inn().replace('04.09.2026',''),{area,checkedAt});assert.equal(notices[1].sourceUpdatedAt,null);assert.equal(notices[1].publishedAt,null);assert.equal(notices[1].temporalBasis,'until_revoked');
});
test('geographic relevance excludes Sillschlucht from Nordkette and ignores unrelated news',()=>{
 const notices=parseInnsbruckNotices(inn('<h3>Party Innsbruck</h3><p>Tickets gesperrt.</p>'),{area:[11.35,47.3,11.43,47.34],checkedAt});assert.equal(notices.length,0);
 const harzArea=[10.57,51.79,10.7,51.89];
 const home=`<h2>Aktuelles</h2><article><a href="/de/aktuelles/2026/Hirtenstieg.php">02.09.2026 Hirtenstieg am Brocken gesperrt</a></article><article><a href="/de/aktuelles/2026/Brunft.php">09.09.2026 Clausthaler Flutgraben gesperrt</a></article><article><a href="https://evil.example.org/">Brocken gesperrt</a></article>`;
 assert.deepEqual(discoverHarzNews(home,harzArea).map(l=>l.url),['https://www.nationalpark-harz.de/de/aktuelles/2026/Hirtenstieg/']);
});
test('dated official article retains source and regional relevance, never invents a closure polygon',()=>{
 const notices=parseHarzNewsArticle(article(),{url:'https://www.nationalpark-harz.de/de/aktuelles/2026/Hirtenstieg/',area:[10.57,51.79,10.7,51.89],checkedAt});assert.equal(notices.length,1);assert.equal(notices[0].geometry,null);assert.equal(notices[0].restrictionArea,false);assert.equal(notices[0].publishedAt,'2026-09-02T00:00:00.000Z');assert.equal(notices[0].publishedPrecision,'day');
});
test('Harz service filters null-state network records before bounded fetch, saturation remains explicit',()=>{
 assert.match(harzQuery([10.57,51.79,10.7,51.89]).searchParams.get('where'),/Zustand IN/);assert.equal(harzQuery([10.57,51.79,10.7,51.89]).searchParams.get('orderByFields'),'FID ASC');
 assert.deepEqual(parseHarz({type:'FeatureCollection',features:[{properties:{Zustand:null}}]}),[]);
 assert.throws(()=>parseHarz({type:'FeatureCollection',exceededTransferLimit:true,features:[]}),/incomplete/);
 assert.throws(()=>parseHarz({type:'FeatureCollection',features:Array(40).fill({})}),/incomplete/);
});
test('Innsbruck never claims DWD or avalanche coverage and performs only its supported request',async()=>{
 let calls=0;const lookup=createConditionLookup({userAgent:'test',now:()=>now,fetchImpl:async u=>{calls++;assert.equal(String(u),REGIONAL_SOURCES[1].url);return new Response(inn(),{headers:{'Content-Type':'text/html'}})}});
 const result=await lookup({area});assert.equal(calls,1);assert.ok(result.sources.some(s=>s.id==='weather-coverage'&&s.state==='not_checked'));assert.ok(!result.sources.some(s=>s.id==='dwd-warnings'));assert.equal(result.notices.length,3);
});
test('each regional article costs a request and finite exhausted source budget preserves other notices',async()=>{
 let calls=0;const lookup=createConditionLookup({userAgent:'test',now:()=>now,sources:[REGIONAL_SOURCES[0]],fetchImpl:async u=>{calls++;return new Response(String(u)===REGIONAL_SOURCES[0].url?'<h2>Aktuelles</h2><article><a href="/de/aktuelles/2026/Hirtenstieg.php">Hirtenstieg am Brocken gesperrt</a></article>':article(),{headers:{'Content-Type':'text/html'}})}});
 let reserved=0;const r=await lookup({area:[10.57,51.79,10.7,51.89]},{reserveSource:()=>++reserved<=1});assert.equal(calls,1);assert.equal(r.notices.length,0);assert.equal(r.sources[0].reason,'partial_articles_or_budget_limit');
});
test('invalid calendar dates do not normalize; DST, unknown years and exceptions stay conservative',()=>{
 assert.equal(germanDay('31.02.2026'),null);assert.equal(germanDay('01.13.2026'),null);
 assert.equal(noticeTiming('vom 15. September bis 15. Oktober 2026 gesperrt.').validUntil,'2026-10-15T22:00:00.000Z');
 assert.equal(noticeTiming('vom 1. November bis 3. November 2026 gesperrt.').validUntil,'2026-11-03T23:00:00.000Z');
 assert.equal(noticeTiming('vom 15. September bis 15. Oktober gesperrt.').validUntil,null);
 assert.equal(noticeTiming('am 1. September und 3. September 2026 Ausnahme täglich.').validUntil,null);
});

test('separate named days are not interpreted as a continuous closure and stated time is preserved',()=>{
 assert.equal(noticeTiming('Am 1. September und 8. September 2026 gesperrt.').validUntil,null);
 const timing=noticeTiming('Am 7. September ab 9.00 Uhr und 8. September 2026 gesperrt.');assert.equal(timing.validFrom,'2026-09-07T07:00:00.000Z');
});

test('explicit morning start after autumn DST transition keeps the actual civil hour',()=>{
 assert.equal(noticeTiming('Am 25. Oktober ab 9.00 Uhr und 26. Oktober 2026 gesperrt.').validFrom,'2026-10-25T08:00:00.000Z');
});
