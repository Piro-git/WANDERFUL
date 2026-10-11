import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createOwnerProviderBudget } from './owner-phone-provider-budget.js';
import { createOwnerPhoneTestSession } from './owner-phone-test-session.js';
import { createOwnerPhoneTestServer } from './owner-phone-test-server.js';
import { createOwnerResearchRuntime, readOwnerPrivateFile } from './owner-phone-research-runtime.js';
import { createOwnerDiagnostics } from './owner-phone-diagnostics.js';

// Dependency injection is for offline tests; the CLI accepts paths/public metadata only.
export async function startOwnerPhoneTest(options, dependencies={}) {
  let budget,research,session,server,timer,diagnostics;let stopping;
  const stop=()=>stopping??=(async()=>{
    clearTimeout(timer);session?.revoke();
    try {
      if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    } finally {
      try {await research?.close();} finally {try {budget?.close();} finally {diagnostics?.close();}}
    }
  })();
  try {
    const {credentialPath,publicURL,outputPath,researchConfigPath}=options;
    if(options.enabled!==true) throw Error('configuration');
    const url=new URL(publicURL);
    if(url.protocol!=='https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname!=='/' ||
        !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(url.hostname)) throw Error('configuration');
    const port=Number(options.port??48173);
    if(!Number.isInteger(port)||port<1024||port>65535) throw Error('configuration');
    const directory=path.dirname(outputPath),info=fs.lstatSync(directory);
    if(!path.isAbsolute(outputPath)||info.isSymbolicLink()||!info.isDirectory()||info.uid!==process.getuid()||
        (info.mode&0o777)!==0o700||fs.realpathSync(directory)!==directory||path.basename(outputPath)!=='OwnerPhoneTest.json'||fs.existsSync(outputPath)) throw Error('configuration');
    const acceptanceMode=options.acceptanceMode === true;
    if (acceptanceMode && (options.researchEnabled === true || researchConfigPath || options.dynamicResearchAllowance !== undefined)) throw Error('configuration');
    const dynamicResearch=options.dynamicResearchAllowance !== undefined;
    if (dynamicResearch && (!options.dynamicResearchUserAgent || options.researchEnabled === true || researchConfigPath)) throw Error('configuration');
    const researchEnabled=options.researchEnabled===true;
    if(researchEnabled!==Boolean(researchConfigPath)) throw Error('owner_research_unavailable');
    const lifetime=acceptanceMode||researchEnabled||dynamicResearch?1800000:7200000;
    const expiresAt=options.expiresAt??Date.now()+lifetime;
    if(!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+lifetime) throw Error('configuration');
    diagnostics=(dependencies.createDiagnostics??createOwnerDiagnostics)(directory);
    budget=(dependencies.createBudget??createOwnerProviderBudget)({directory,diagnostic:diagnostics.record,
      dynamicResearch, acceptanceMode, limits:acceptanceMode?{google:1,graphhopper:2}:dynamicResearch?options.dynamicResearchAllowance:researchEnabled?{google:2,graphhopper:2}:{google:5,graphhopper:10}});
    if(researchEnabled) research=await (dependencies.createResearchRuntime??createOwnerResearchRuntime)(researchConfigPath);
    if(Date.now()>=expiresAt) throw Error('configuration');
    // Real database/source/place/access readiness is complete before provider keys or owner token.
    const values=parseEnv((dependencies.readProviderFile??readOwnerPrivateFile)(credentialPath));
    if(values.AI_PROVIDER!=='google'||!values.GOOGLE_API_KEY?.trim()||!values.GRAPHHOPPER_API_KEY?.trim()) throw Error('configuration');
    const env={NODE_ENV:'development',TRAILMIND_RELEASE_STAGE:'local',OWNER_PHONE_TEST_ENABLED:'true',
      INTENT_PROVIDER_ENABLED:'true',ROUTE_PROVIDER_ENABLED:'true',LLM_FIRST_PLANNING_ENABLED:'true',
      APP_ATTEST_ALLOW_IN_MEMORY:'false',ROUTE_ALLOW_INSECURE_LOCAL_ROUTING:'false',INTENT_ALLOW_INSECURE_LOCAL_PARSING:'false',
      AI_PROVIDER:'google',GOOGLE_MODEL:'gemini-3.8-flash',GOOGLE_API_KEY:values.GOOGLE_API_KEY,GRAPHHOPPER_API_KEY:values.GRAPHHOPPER_API_KEY,
      ...(researchEnabled||dynamicResearch?{OWNER_PHONE_RESEARCH_TEST_ENABLED:'true',OUTDOOR_RESEARCH_PLANNING_ENABLED:'true',OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED:'true'}:{}),
      ...(dynamicResearch?{DYNAMIC_RESEARCH_ENABLED:'true',DYNAMIC_RESEARCH_USER_AGENT:options.dynamicResearchUserAgent,
        ...(Object.hasOwn(options.dynamicResearchAllowance,'grounding')?{DYNAMIC_WEB_RESEARCH_ENABLED:'true'}:{})}:{})};
    const token=(dependencies.makeToken??(()=>randomBytes(32).toString('base64url')))();
    session=(dependencies.createSession??createOwnerPhoneTestSession)({token,expiresAt,env,...(acceptanceMode?{maxRequests:4,maxCost:12}:{})});
    server=(dependencies.createServer??createOwnerPhoneTestServer)({session,env,diagnostics,logger:diagnostics.logger,fetchImpl:budget.fetch,...(research?{repository:research.repository}:{})});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    fs.writeFileSync(outputPath,JSON.stringify({baseURL:url.href,token,expiresAt:expiresAt/1000}),{flag:'wx',mode:0o600});
    timer=setTimeout(()=>void stop(),Math.max(1,expiresAt-Date.now()));timer.unref();
    return {stop,expiresAt,researchSummary:research?.summary};
  } catch(error) {await stop();throw Error(error?.message==='owner_research_unavailable'?'owner_research_unavailable':'owner_startup_unavailable');}
}
async function main() {
  const [credentialPath,publicURL,outputPath,port='48173',researchConfigPath]=process.argv.slice(2);
  if(process.argv.length>7) throw Error('configuration');
  const runtime=await startOwnerPhoneTest({credentialPath,publicURL,outputPath,port,researchConfigPath,
    enabled:process.env.OWNER_PHONE_TEST_ENABLED==='true',acceptanceMode:process.env.OWNER_PHONE_ACCEPTANCE_MODE==='true',researchEnabled:process.env.OWNER_PHONE_RESEARCH_TEST_ENABLED==='true',
    ...(process.env.OWNER_PHONE_TEST_EXPIRES_AT_MS?{expiresAt:Number(process.env.OWNER_PHONE_TEST_EXPIRES_AT_MS)}:{})});
  process.once('SIGINT',()=>void runtime.stop());process.once('SIGTERM',()=>void runtime.stop());
  console.log('Owner test listening on loopback only; private credential written; no provider calls at startup.');
  if(runtime.researchSummary) console.log('Research snapshot, sourced places and mapped access passed bounded readiness checks.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error=>{
  console.error(error?.message==='owner_research_unavailable'
    ?'Owner research startup blocked: verify scoped staging connections, current source snapshot, places and mapped access.'
    :'Owner test startup blocked: verify opt-in, private paths, provider selection, deadline, HTTPS URL and port.');
  process.exitCode=1;
});
