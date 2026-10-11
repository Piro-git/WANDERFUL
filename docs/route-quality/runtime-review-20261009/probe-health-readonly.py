from pathlib import Path
import subprocess,json,datetime,os,shutil
Q=Path(os.environ.get("WANDERFUL_QA_ROOT", str(Path(__file__).resolve().parents[3])));B=Path(os.environ.get("WANDERFUL_BACKEND_ROOT",str(Q)));E=Q/".local-evidence";STAGE=B/'.deploy/private-owner-20261007/backend';DPL='dpl_ACBwa9RQLDweAuKauZVecr3NNoWw';URL='https://backend-nbtudy0rp-piros-projects-7e6430a1.vercel.app'
p=json.loads((STAGE/'.vercel/project.json').read_text());assert p['projectId']=='prj_s58Xlu24J4AkuvUIjDaX5Uc454R7' and p['orgId']=='team_nvtnn3IzOLpftJqVS6hMkqCh'
env={k:os.environ[k] for k in ('HOME','PATH','TMPDIR','LANG','LC_ALL') if k in os.environ}
checks=[]
for path in ['/healthz','/api/private-owner/readyz']:
 args=[os.environ.get("WANDERFUL_NODE_BINARY") or shutil.which("node") or "node",os.environ["WANDERFUL_VERCEL_CLI_JS"],'curl',path,'--deployment',URL,'--','--silent','--show-error','--max-time','20','--write-out','\nQA_HTTP_STATUS:%{http_code}']
 # Existing CLI authentication stays internal: no token flags, explicit bypass
 # secret, env pull, trace, body/header log or caller-supplied app authorization.
 result=subprocess.run(args,cwd=STAGE,capture_output=True,text=True,env=env,timeout=35)
 body,sep,code=result.stdout.rpartition('\nQA_HTTP_STATUS:')
 status=int(code) if sep and code.strip().isdigit() else None
 payload={}
 if sep:
  try:payload=json.loads(body)
  except ValueError:pass
 safe={'path':path,'method':'GET','exit':result.returncode,'httpStatus':status,
  'applicationStatus':payload.get('status') if payload.get('status') in ['live','ready','not_ready'] else None,
  'applicationErrorCode':payload.get('error',{}).get('code') if isinstance(payload.get('error'),dict) else None,
  'bodyOrHeadersStored':False,'appAuthSupplied':False,'traceEnabled':False}
 diagnostic=result.stdout+'\n'+result.stderr
 safe['safeCLIArgumentErrors']=__import__('re').findall(r'(?:option|argument)\s+([\-]{1,2}[A-Za-z0-9-]+).*?(?:unknown|unrecognized|invalid)',diagnostic,__import__('re').I)
 for token in ['Unknown or unexpected option', 'option --non-interactive', 'option --scope', 'link_required', 'TRUSTED_SOURCES_ENVIRONMENT_MISMATCH']:
  if token in diagnostic: safe.setdefault('safeCLIErrorLabels',[]).append(token)
 checks.append(safe)
 if result.returncode or status not in [200,503]:break
receipt={'observedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'deploymentId':DPL,'deploymentURL':URL,'projectId':p['projectId'],'teamId':p['orgId'],'executedByQA':True,'readOnlyActualHTTP':True,'checks':checks,'livenessProven':len(checks)>0 and checks[0]['exit']==0 and checks[0]['httpStatus']==200 and checks[0]['applicationStatus']=='live','privateReadyProven':len(checks)>1 and checks[1]['httpStatus']==200,'privateGateClosed':len(checks)>1 and checks[1]['exit']==0 and checks[1]['httpStatus']==503 and checks[1]['applicationErrorCode']=='owner_access_unavailable','providerRequests':0,'directDBQueries':0,'productionMutations':0,'protectionChanged':False,'tokenValuesRetrievedOrPrintedOrStored':False,'canonicalSourceNotClaimed':True,'corePhoneReady':False}
(E/'qa-independent-deployed-health-corrected-20261009.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
