import ast, hashlib, json, re, subprocess, os
from pathlib import Path
QA=Path(os.environ.get("WANDERFUL_QA_ROOT", str(Path(__file__).resolve().parents[3])))
LOG=Path(os.environ["WANDERFUL_SOURCE_TASK_LOG"])
OLD='/private/tmp/wanderful-live-acceptance-20261003/'
R=QA/'docs/recovery/20261007';R.mkdir(parents=True,exist_ok=True)
records={}
for n,line in enumerate(LOG.open(),1):
 if 470<=n<=1756:
  d=json.loads(line)
  if d.get('timestamp','')<'2026-10-07':records[n]=d
provenance=[]
def sha(data):return hashlib.sha256(data).hexdigest()
def put(rel,data,line,method):
 assert rel.startswith(('backend/quality-gates/','docs/route-quality/','docs/recovery/20261007/'))
 target=QA/rel;assert QA in target.resolve().parents;assert not target.is_symlink()
 target.parent.mkdir(parents=True,exist_ok=True)
 if isinstance(data,str):data=data.encode()
 target.write_bytes(data)
 provenance.append({'path':rel,'sourceTaskLog':LOG.name,'sourceLine':line,'sourceTimestamp':records[line]['timestamp'] if line else None,'method':method,'fileSHA256':sha(data),'bytes':len(data),'originalGitObjectRecovered':False})
def source(n):return records[n]['payload'].get('input','')
def python(n):
 for value in re.findall(r'cmd:\s*("(?:\\.|[^"\\])*")',source(n)):
  cmd=json.loads(value);m=re.search(r"python3 - <<'PY'\n([\s\S]*?)\nPY",cmd)
  if m:return ast.parse(m[1])
 raise ValueError(n)
def assigned(n,var):
 for node in ast.walk(python(n)):
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id==var for t in node.targets):return node.value
 raise ValueError((n,var))
def literal(n,var):return ast.literal_eval(assigned(n,var))
# Decode ONLY literal apply_patch payloads targeting this task's bounded source files.
for n in (604,684,745,762,1005,1138,1336,1623):
 payloads=re.findall(r'apply_patch\(\s*("(?:\\.|[^"\\])*")',source(n))
 assert payloads,n
 for raw in payloads:
  patch=json.loads(raw);assert patch.startswith('*** Begin Patch\n')
  lines=patch.splitlines();k=1
  while k<len(lines) and lines[k]!='*** End Patch':
   header=lines[k];k+=1
   match=re.fullmatch(r'\*\*\* (Add|Update) File: (.+)',header);assert match,(n,header)
   kind,name=match.groups();assert name.startswith(OLD),name
   rel=name[len(OLD):];assert rel.startswith('backend/quality-gates/'),rel
   segment=[]
   while k<len(lines) and not lines[k].startswith('*** '):segment.append(lines[k]);k+=1
   if kind=='Add':
    assert all(x.startswith('+') for x in segment);text='\n'.join(x[1:] for x in segment)+'\n'
    assert not (QA/rel).exists(),rel
   else:
    text=(QA/rel).read_text();groups=[];group=[]
    for ln in segment:
     if ln.startswith('@@'):
      if group:groups.append(group)
      group=[]
     else:group.append(ln)
    if group:groups.append(group)
    for group in groups:
     assert all(x and x[0] in ' +-' for x in group),group
     before='\n'.join(x[1:] for x in group if x[0] in ' -')+'\n'
     after='\n'.join(x[1:] for x in group if x[0] in ' +')+'\n'
     assert text.count(before)==1,(n,rel,text.count(before));text=text.replace(before,after,1)
   put(rel,text,n,'decoded original task file patch; no historical command executed')
# Restore literal, dated historical reports; no dynamic receipt is fabricated.
for n,var,rel in [(470,'doc','docs/route-quality/live-acceptance-20261005/QA-HANDOFF.md'),(755,'report','docs/route-quality/private-owner-review-20261005/QA-HANDOFF.md'),(1149,'decision','docs/route-quality/owner-supabase-review-20261005/EXACT-BOOTSTRAP-DECISION.md'),(1309,'core','docs/route-quality/core-phone-review-20261005/ACCEPTANCE-MATRIX.md'),(1411,'t','docs/route-quality/core-phone-review-20261005/FEATURE-STATUS.md'),(1699,'deploy','docs/route-quality/core-phone-review-20261005/DEPLOYMENT-REVIEW.md'),(1706,'h','docs/route-quality/core-phone-review-20261005/QA-HANDOFF.md')]:
 text=literal(n,var)
 if n==1309:
  for node in ast.walk(python(1485)):
   if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='replace' and len(node.args)==2:
    args=[ast.literal_eval(x) for x in node.args]
    if args[0].startswith('App checkout contains an older backend tree'):text=text.replace(*args)
 if n==1411:
  replacements=[('iPhoneed4ad86/backenda3a16c1','iPhone ed4ad86 / backend a3a16c1'),('privateed4','private ed4'),('onlyschema3','only schema3'),('Existing100/107','Existing 100/107'),('max2km','max 2km')]
  for a,b in replacements:text=text.replace(a,b)
 put(rel,text,n,'literal historical report recovered from original file-write input; not a new source/live approval')
def outputs(v):
 if isinstance(v,list):
  for x in v:yield from outputs(x)
 elif isinstance(v,dict):
  for k in ('output','text','value'):
   if k in v:yield from outputs(v[k])
 elif isinstance(v,str):
  try:yield from outputs(json.loads(v))
  except (ValueError,TypeError):yield v
captured={}
for n,marker,name in [(1604,'// Human-only local credential handoff','activate-owner-credential-input.mjs'),(1659,'#!/usr/bin/env python3\n','complete-owner-credential.py'),(1737,'// Credential stdin only','verify-owner-runtime-input.mjs')]:
 chunks=[s for s in outputs(records[n]['payload']['output']) if s.startswith(marker)]
 assert len(chunks)==1,(n,name)
 text=chunks[0]
 if name.endswith('.py'):
  assert '\n#!/bin/zsh\n' in text;text=text.split('#!/bin/zsh\n',1)[0]
  ast.parse(text);assert 'PSQL =' not in text
 captured[name]=text
 put('docs/recovery/20261007/historical-source/'+name,text,n,'bounded original public source cat output; related owner source snapshot only, not executable authorization')
assert sha(captured['activate-owner-credential-input.mjs'].encode())=='36ce7b831cd8070d881cf4a340636c54d35c51c40ac0dfc26eac3b93f48f3378'
assert sha(captured['verify-owner-runtime-input.mjs'].encode())=='58b78d8df6a4d3456b87b7babdb858cb991fda8adf3fbcc4e321710ee9d95969'
ops_hash={name:sha(text.encode()) for name,text in captured.items()}
# Evaluate a fixed allowlist of the historical report's public formatting fields, never code.
node=assigned(1699,'cred');assert isinstance(node,ast.JoinedStr)
fields={'commit':'873403c5acbcc23d0402ffd2e8036eadb792784f',"git(b, 'rev-parse', 'HEAD^{tree}')":'6276bd5755aa6bf9827962eb3a75d89683dfc145'}
text=''
for part in node.values:
 if isinstance(part,ast.Constant):text+=part.value
 else:
  expr=ast.unparse(part.value)
  if isinstance(part.value,ast.Subscript) and ast.unparse(part.value.value)=='ops_hash':value=ops_hash[ast.literal_eval(part.value.slice)]
  else:assert expr in fields,expr;value=fields[expr]
  assert part.conversion==-1 and part.format_spec is None;text+=value
for node in ast.walk(python(1741)):
 if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='replace' and len(node.args)==2:
  a,b=[ast.literal_eval(x) for x in node.args]
  if a.startswith('Candidate bytes were checked before/after'):text=text.replace(a,b)
put('docs/route-quality/core-phone-review-20261005/CREDENTIAL-REVIEW.md',text,1699,'historical report literal plus exact public source hashes and logged final replacement; original dynamic receipt unavailable')
# Recover the exact bounded public JSON output, not fresh native execution.
chunks=[s for s in outputs(records[1604]['payload']['output']) if '"normalNative"' in s]
assert len(chunks)==1
obj,end=json.JSONDecoder().raw_decode(chunks[0]);assert obj['normalNative']['pass']==100 and obj['privateNative']['pass']==107
put('docs/route-quality/core-phone-review-20261005/NATIVE-CURRENT.json',chunks[0][:end]+'\n',1604,'original historical sanitized JSON cat output; current tests/install not inferred')
manifest={'recoveryMethod':'static bounded extraction from this exact QA task; no command replay','originalBaseCommit':'549c2e91b62e6df3cd4e486bd3919be7af30b77e','originalLatestReportedCommit':'78fbce5a989575bbb52ad8c2aad7a61028684a00','originalLatestReportedTree':'1e53e809a07df85e3366279de589a9ff6b886f8c','originalLatestGitObjectRecovered':False,'historicalOperatorFilesSHA256':ops_hash,'files':provenance,'dynamicReceiptGaps':['FLOW-REVIEW-RECEIPT.json','PRIVATE-OWNER-RECEIPT.json','SUPABASE-DDL-RECEIPT.json','REVIEW-RECEIPT.json; original runtime-generated metadata/hashes/evidence inputs not fully recovered'],'historicalEvidenceNotReexecuted':True,'currentSourceApproved':False,'currentLiveCoreReady':False,'credentialsRead':False,'providerCalls':0,'remoteSQL':0,'foreignRepositoryEdits':False}
(R/'OWN-SOURCE-PROVENANCE.json').write_text(json.dumps(manifest,indent=2)+'\n')
(R/'README.md').write_text('''# QA recovery — 7 October 2026

Base549c2e9 is an original verified Git snapshot. Later source tests and dated report text were extracted from exact own-task file patches/writes; public helper snapshots came from bounded own-task source output. This produces a NEW reconstruction, not original78fbce5 or an exact original full tree. Original dynamic review receipts and temporary logs are missing; no false original receipt was created. See OWN-SOURCE-PROVENANCE.json for per-file provenance/hashes and gaps.

All restored 5October PASS/test/native/management statements are HISTORICAL. They do not authorize new deployment/credential activation or establish current recovered-source tests, TLS, phone installation, provider results, photos or persistence. Current status is qa-current-status.json, kept separately from historical documents. Supabase003 was already applied according to historical/root management evidence; never replay it. No historical shell/SQL/network code was executed, no source approval based on summary alone. Other owner checkouts and protected dataless root were untouched.
''')
print(json.dumps({'patchFiles':5,'historicalReports':8,'nativeJSONRecovered':True,'helperSnapshots':len(captured),'sourceProvenanceEntries':len(provenance),'helperSHA256':ops_hash,'original78Recovered':False}))
