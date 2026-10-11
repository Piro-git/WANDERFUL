from pathlib import Path
import subprocess,json,hashlib,datetime,os,shutil
Q=Path(os.environ.get("WANDERFUL_QA_ROOT", str(Path(__file__).resolve().parents[3])));B=Path(os.environ.get("WANDERFUL_BACKEND_ROOT",str(Q)));E=Q/".local-evidence";STAGE=B/'.deploy/private-owner-20261007/backend'
NODE=os.environ.get("WANDERFUL_NODE_BINARY") or shutil.which("node") or "node";VC=os.environ["WANDERFUL_VERCEL_CLI_JS"];DPL='dpl_ACBwa9RQLDweAuKauZVecr3NNoWw'
project=json.loads((STAGE/'.vercel/project.json').read_text());assert project['projectId']=='prj_s58Xlu24J4AkuvUIjDaX5Uc454R7' and project['orgId']=='team_nvtnn3IzOLpftJqVS6hMkqCh'
# No auth-token/environment-variable API, env pull, deploy, trace or headers.
# The complete read-only file metadata API is necessary because MCP truncated it.
env={k:os.environ[k] for k in ('HOME','PATH','TMPDIR','LANG','LC_ALL') if k in os.environ}
args=[NODE,VC,'api',f'/v6/deployments/{DPL}/files','--method','GET','--scope','piros-projects-7e6430a1','--cwd',str(STAGE),'--non-interactive']
result=subprocess.run(args,capture_output=True,text=True,env=env,timeout=45)
if result.returncode:raise SystemExit('read_only_file_metadata_request_failed; raw diagnostics not emitted')
try:raw=json.loads(result.stdout)
except ValueError:raise SystemExit('read_only_file_metadata_shape_unrecognized; raw output not emitted')
assert isinstance(raw,list)
sources=[x for x in raw if x.get('name')=='src' and x.get('type')=='directory'];assert len(sources)==1
files={}
def walk(items,prefix=''):
 for x in items:
  rel=prefix+x['name'];assert '..' not in Path(rel).parts
  if x['type']=='directory':walk(x['children'],rel+'/')
  else:
   assert x['type']=='file' and rel not in files
   files[rel]={'uid':x['uid'],'mode':x.get('mode')}
walk(sources[0]['children'])
expected={};excluded=['.gitignore','.dockerignore'];matched=[]
for line in subprocess.check_output(['git','ls-tree','-r','HEAD:backend'],cwd=B,text=True).splitlines():
 info,rel=line.split('\t',1);mode,kind,blob=info.split();assert kind=='blob' and mode!='120000';expected[rel]=(mode,blob)
for rel,(mode,blob) in expected.items():
 if rel in excluded:continue
 value=subprocess.check_output(['git','cat-file','blob',blob],cwd=B)
 assert rel in files and files[rel]['uid']==hashlib.sha1(value).hexdigest(),rel
 assert files[rel]['mode']==int(mode,8),rel
 matched.append({'path':rel,'serverUID':files[rel]['uid'],'mode':files[rel]['mode'],'SHA256':hashlib.sha256(value).hexdigest()})
assert len(expected)==470 and len(files)==len(matched)==468
assert set(files)==set(expected)-set(excluded)
receipt={'observedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'deploymentId':DPL,'deploymentURL':'backend-nbtudy0rp-piros-projects-7e6430a1.vercel.app','projectId':project['projectId'],'teamId':project['orgId'],'backendCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=B,text=True).strip(),'backendTree':subprocess.check_output(['git','rev-parse','HEAD:backend'],cwd=B,text=True).strip(),'independentAuthenticatedMetadataRequest':True,'MCPWasTruncated':True,'CLIReadOnlyFallbackUsed':True,'remoteSourceFiles':len(files),'matchedSourceUIDsAndModes':len(matched),'trackedSourceFiles':470,'intentionalCLIExcludedFiles':excluded,'missingFiles':[],'unexpectedFiles':[],'sourceBindingPassed':True,'metadataCommitAloneNotUsed':True,'sourceFileBodiesRetrievedByThisQAProbe':0,'secretValuesRetrieved':False,'providerCalls':0,'remoteSQL':0,'writesToProduction':0,'canonicalPromotionObserved':False,'actualPrivateReadinessProven':False,'files':matched}
(E/'qa-independent-hosted-source-verification-20261009.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:v for k,v in receipt.items() if k!='files'}))
