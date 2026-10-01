import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

async function main() {
  if (process.env.OWNER_PHONE_LIVE_CHECK !== 'true') throw Error('opt_in_required');
  const file=process.argv[2];
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let session;
  try {
    const info=fs.fstatSync(fd);
    if (!info.isFile() || info.uid!==process.getuid() || (info.mode&0o777)!==0o600 || info.size>4096) throw Error();
    session=JSON.parse(fs.readFileSync(fd,'utf8'));
  } finally { fs.closeSync(fd); }
  const base=new URL(session.baseURL);
  if (base.protocol!=='https:' || base.username || base.password || Date.now()>=session.expiresAt*1000) throw Error();
  const request=async(endpoint,body,token=session.token,id=randomUUID())=>{
    const response=await fetch(new URL(endpoint,base),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(45000),
      headers:{'Content-Type':'application/json',authorization:`TrailMindRouteSession ${token}`,'x-trailmind-request-id':id},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  const wrong=await request('/api/parse-intent',{},'A'.repeat(43));
  const unsupported=await request('/api/llm-plan-route',{});
  if(wrong.status!==401 || unsupported.status!==404) throw Error('admission_failed');
  console.log(JSON.stringify({httpsAdmission:{wrongToken:wrong.status,unsupported:unsupported.status}}));
  // One synthetic nonpersonal prompt. No retries or alternate models.
  const id=randomUUID();
  const intent=await request('/api/parse-intent',{prompt:'Plan a hiking route from Ilsenburg to Schierke.',locale:'en',userLocationHint:null},session.token,id);
  console.log(JSON.stringify({intent:{status:intent.status,code:intent.body?.error?.code??null}}));
  if(intent.status!==200) { process.exitCode=1; return; }
  const replayValid=await request('/api/parse-intent',{prompt:'Plan a hiking route from Ilsenburg to Schierke.',locale:'en',userLocationHint:null},session.token,id);
  if(replayValid.status!==409) throw Error('replay_failed');
  console.log(JSON.stringify({replay:replayValid.status}));
  const route=await request('/api/route',{profile:'foot',routeType:'pointToPoint',points:[{latitude:51.866,longitude:10.678},{latitude:51.765,longitude:10.653}],locale:'en',includeElevation:true,includeInstructions:true});
  const first=route.body?.paths?.[0];
  console.log(JSON.stringify({route:{status:route.status,code:route.body?.error?.code??null,provider:route.body?.provider??null,distance:first?.distance??null,time:first?.time??null,geometryPoints:first?.points?.coordinates?.length??0}}));
  if(route.status!==200) { process.exitCode=1; return; }
  if(route.status===200 && !(first?.distance>0 && first?.time>0 && first?.points?.coordinates?.length>2)) throw Error('geometry_invalid');
}
main().catch(()=>{console.error('Private HTTPS check failed; no automatic retry. Inspect only sanitized status and durable counters.');process.exitCode=1;});
