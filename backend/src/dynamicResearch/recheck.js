import {validateWebResearchEnvelope} from './webResearch.js';
import {createHash} from 'node:crypto';
import {boundsFor,evaluateConditions,mergeConditionSnapshots} from './localConditions.js';
import {validCoordinate,safeLabel} from './places.js';
export function validateConditionRecheck(body) {
  const fail=()=>{throw Object.assign(new TypeError('invalid_request'),{code:'invalid_request'});};
  if(!body||['geometryJSON','plannedStartAt','schemaVersion'].some(k=>!Object.hasOwn(body,k))||Object.keys(body).some(k=>!['geometryJSON','plannedStartAt','schemaVersion','locationName','routePlaces'].includes(k))||body.schemaVersion!==4||
    typeof body.geometryJSON!=='string'||Buffer.byteLength(body.geometryJSON)>500000)fail();
  if(body.plannedStartAt!==null&&(typeof body.plannedStartAt!=='string'||body.plannedStartAt.length>40||!/T.*(Z|[+-]\d\d:\d\d)$/.test(body.plannedStartAt)||!Number.isFinite(Date.parse(body.plannedStartAt))))fail();
  if(body.locationName!==undefined&&!safeLabel(body.locationName,200))fail();
  if(body.routePlaces!==undefined&&(!Array.isArray(body.routePlaces)||body.routePlaces.length>3||body.routePlaces.some(p=>
    !p||Object.keys(p).sort().join(',')!=='coordinate,name,source'||!safeLabel(p.name,180)||!validCoordinate(p.coordinate)||
    Object.keys(p.coordinate).sort().join(',')!=='latitude,longitude'||!p.source||Object.keys(p.source).join(',')!=='url'||
    typeof p.source.url!=='string'||!/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/[1-9][0-9]*$/.test(p.source.url))))fail();
  let path;try{path=JSON.parse(body.geometryJSON);}catch{fail();}
  if(!Array.isArray(path)||path.length<2||path.length>20000||path.some(p=>!Array.isArray(p)||p.length!==2||!validCoordinate({longitude:p[0],latitude:p[1]})))fail();
  return {path,plannedStartAt:body.plannedStartAt,...(body.locationName?{locationName:body.locationName}:{}),...(body.routePlaces?{routePlaces:structuredClone(body.routePlaces)}:{}),geometryDigest:createHash('sha256').update(body.geometryJSON).digest('hex')};
}
export async function recheckConditions(request,conditions,{signal,currentInformation}={}) {
  const controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;abort();},typeof currentInformation==='function'?120000:30000);let calls=0,generations=0,currentSources=0;
  const cancelled=()=>Object.assign(new Error('Condition check interrupted'),{code:timedOut?'research_timed_out':'request_cancelled'});
  let rejectAbort;
  const interrupted=new Promise((_,reject)=>{
    rejectAbort=()=>reject(cancelled());
    controller.signal.addEventListener('abort',rejectAbort,{once:true});
  });
  try {
    if(controller.signal.aborted)throw cancelled();
    const area=boundsFor(request.path.map(p=>({longitude:p[0],latitude:p[1]})));
    let snapshot=await Promise.race([Promise.resolve().then(()=>conditions({area,visitTime:request.plannedStartAt},{signal:controller.signal,
      reserveSource:()=>{if(controller.signal.aborted)throw cancelled();return calls++<4;},unavailableSources:new Set()})),interrupted]);
    if(controller.signal.aborted)throw cancelled();
    if(typeof currentInformation==='function') {
      const [longitude,latitude]=request.path[0];
      const input={request:{prompt:'Check current local reports relevant to this saved route.',anchor:{latitude,longitude},locationName:request.locationName??'Saved route location'},
        area,path:request.path,routePlaces:request.routePlaces??[],visitTime:request.plannedStartAt};
      const current=await Promise.race([Promise.resolve().then(()=>currentInformation(input,{signal:controller.signal,
        reserveGeneration:()=>{if(controller.signal.aborted)throw cancelled();return generations++<3;},
        reserveSource:()=>{if(controller.signal.aborted)throw cancelled();return currentSources++<6;}})),interrupted]);
      if(controller.signal.aborted)throw cancelled();
      if(current.researchEvidence)validateWebResearchEnvelope(current.researchEvidence);
      snapshot=mergeConditionSnapshots(snapshot,current);
    }
    return {schemaVersion:4,state:'checked',geometryDigest:request.geometryDigest,
      localConditions:evaluateConditions(snapshot,{path:request.path,area,visitTime:request.plannedStartAt})};
  } finally {controller.signal.removeEventListener('abort',rejectAbort);clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}
