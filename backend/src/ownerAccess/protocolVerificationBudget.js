import {PostgresOwnerRepository} from './postgresOwnerRepository.js';
import {followupSecurity,chargeOriginalProvider} from './planningFollowupEntitlement.js';
const unavailable=()=>{throw Object.assign(new Error('verification_unavailable'),{code:'verification_unavailable'});};
const HEX40=/^[a-f0-9]{40}$/,HEX64=/^[a-f0-9]{64}$/,KEY=/^[A-Za-z0-9_-]{43}$/;
export const FIRST_COLUMNS=['first_status','first_http_status','first_search_calls','first_page_calls','first_citation_count','first_pending_builtin','first_pending_planning','first_pending_other','first_total_tokens'];
export const RESULT_COLUMNS=[...FIRST_COLUMNS,'last_status','last_http_status','last_pending_builtin','last_pending_planning','last_pending_other','last_total_tokens','full_research_valid','result_failure','result_stage','validation_reason','validated_search_calls','validated_query_count','validated_read_count','validated_citation_count'];
const immutable=['singleton','approval_sha256','backend_tree','input_sha256','key_id','origin','activated_at','expires_at','revoked_at'];
export function verificationConfiguration(p){
 if(!HEX64.test(p?.approvalSHA256??'')||!HEX40.test(p?.backendTree??'')||!HEX64.test(p?.inputSHA256??'')||!KEY.test(p?.keyId??'')||p.origin!=='https://backend-zeta-amber-69.vercel.app'||!Number.isFinite(p.expiresAt))unavailable();
 return p;
}
export async function protocolVerificationSecurity(c){
 await new PostgresOwnerRepository({pool:c}).readiness();
 const role=(await c.query("SELECT current_user AS name,rolsuper,rolbypassrls,rolinherit,rolcreatedb,rolcreaterole,rolreplication,rolconnlimit,(SELECT count(*) FROM pg_auth_members WHERE member=r.oid) AS memberships FROM pg_roles r WHERE rolname=current_user")).rows[0];
 if(!role||role.name!=='wanderful_owner_runtime'||role.rolsuper||role.rolbypassrls||role.rolinherit||role.rolcreatedb||role.rolcreaterole||role.rolreplication||role.rolconnlimit!==4||Number(role.memberships)!==0)unavailable();
 await followupSecurity(c);
 const r=await c.query("SELECT c.relrowsecurity,pg_get_userbyid(c.relowner)<>current_user AS operator_owned,has_table_privilege(c.oid,'SELECT') AS sel,has_table_privilege(c.oid,'INSERT,DELETE,TRUNCATE,TRIGGER,REFERENCES') AS unsafe,NOT has_schema_privilege(n.oid,'CREATE') AS no_create FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wanderful_owner_budget_v1' AND c.relname='protocol_verification' AND c.relkind='r'");
 if(r.rows.length!==1||!r.rows[0].relrowsecurity||!r.rows[0].operator_owned||!r.rows[0].sel||r.rows[0].unsafe||!r.rows[0].no_create)unavailable();
 const permission=await c.query("SELECT a.attname FROM pg_attribute a WHERE a.attrelid='wanderful_owner_budget_v1.protocol_verification'::regclass AND a.attname=ANY($1::text[]) AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')",[immutable]);if(permission.rowCount)unavailable();
 const pub=await c.query("SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') AND (has_table_privilege(r.oid,'wanderful_owner_budget_v1.protocol_verification','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') OR has_schema_privilege(r.oid,'wanderful_owner_budget_v1','USAGE,CREATE')) LIMIT 1");if(pub.rowCount)unavailable();
 const guards=await c.query("SELECT t.tgname,t.tgtype,t.tgdeferrable,t.tginitdeferred FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='wanderful_owner_budget_v1.protocol_verification'::regclass AND NOT t.tgisinternal AND t.tgenabled='O' AND NOT p.prosecdef AND pg_get_userbyid(p.proowner)<>current_user AND p.proconfig @> ARRAY['search_path=pg_catalog']");
 const expected={'protocol_verification_write':31,'protocol_verification_no_truncate':34,'protocol_verification_totals':21};
 if(guards.rows.length!==3||guards.rows.some(g=>expected[g.tgname]!==g.tgtype||g.tgname==='protocol_verification_totals'&&(!g.tgdeferrable||!g.tginitdeferred)))unavailable();
 const wave=await c.query("SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='wanderful_owner_v1.windows'::regclass AND t.tgname='guard_planning_wave' AND t.tgenabled='O' AND t.tgtype=31 AND NOT t.tgisinternal AND NOT p.prosecdef AND pg_get_userbyid(p.proowner)<>current_user AND p.proconfig @> ARRAY['search_path=pg_catalog']");if(wave.rowCount!==1)unavailable();
 const hash=(await c.query("SELECT md5(pg_get_functiondef('wanderful_owner_v1.guard_planning_wave()'::regprocedure)) AS hash")).rows[0].hash;if(hash!=='d8b7ecca4776f5ae4346f9b16298da6d')unavailable();
}
async function row(c,p,jobId,{finish=false}={}){
 verificationConfiguration(p);await protocolVerificationSecurity(c);
 const {rows}=await c.query(`SELECT v.*,extract(epoch FROM v.expires_at)*1000 AS expiry_ms FROM wanderful_owner_budget_v1.protocol_verification v JOIN wanderful_owner_v1.keys k ON k.key_id=v.key_id JOIN wanderful_owner_v1.owners o ON o.installation_id=k.installation_id WHERE v.singleton AND v.approval_sha256=$1 AND v.backend_tree=$2 AND v.input_sha256=$3 AND v.key_id=$4 AND v.origin=$5 AND v.activated_at<=clock_timestamp() AND v.revoked_at IS NULL AND k.revoked_at IS NULL AND o.revoked_at IS NULL FOR UPDATE OF v`,[p.approvalSHA256,p.backendTree,p.inputSHA256,p.keyId,p.origin]);
 const v=rows[0],now=Number((await c.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now_ms')).rows[0].now_ms);
 if(!v||Number(v.expiry_ms)!==p.expiresAt||now>=Number(v.expiry_ms)+(finish?120000:0)||v.result_finished_at!==null||jobId!==undefined&&v.job_id!==jobId)unavailable();
 return v;
}
export async function claimProtocolVerification(c,p,jobId){
 const v=await row(c,p);if(v.job_id!==null||v.google_used!==0)unavailable();
 const totals=(await c.query("SELECT COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:requests'),0) AS r,COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:google'),0) AS g,COALESCE(max(cost) FILTER(WHERE scope='wanderful-live-wave-20261003:graphhopper'),0) AS h FROM wanderful_owner_v1.windows WHERE identity_hash='global'")).rows[0];
 const spent=(await c.query("SELECT 1 FROM wanderful_owner_budget_v1.entitlements WHERE sequence=2 AND key_id=$1 AND origin=$2 AND diagnostic_used=1 AND intent_used=1 AND requests_used=1 AND google_used=3 AND graphhopper_used=0 AND phone_expires_at<=clock_timestamp()",[p.keyId,p.origin])).rowCount;
 const old=(await c.query("SELECT 1 FROM wanderful_owner_budget_v1.supplement WHERE singleton AND key_id=$1 AND intent_used=1 AND requests_used=1 AND google_used=2 AND graphhopper_used=0",[p.keyId])).rowCount;
 const leases=(await c.query('SELECT 1 FROM wanderful_owner_v1.leases WHERE released_at IS NULL AND expires_at>clock_timestamp() LIMIT 1')).rowCount;
 if(totals.r!==2||totals.g!==10||totals.h!==0||spent!==1||old!==1||leases)unavailable();
 await c.query('UPDATE wanderful_owner_budget_v1.protocol_verification SET job_id=$1,claimed_at=clock_timestamp() WHERE singleton',[jobId]);
}
export async function reserveProtocolGoogle(c,p,jobId){
 const v=await row(c,p,jobId);if(v.google_used>=2||v.google_used===1&&!v.readback_authorized)unavailable();
 await c.query('UPDATE wanderful_owner_budget_v1.protocol_verification SET google_used=google_used+1 WHERE singleton');
 await chargeOriginalProvider(c,'google');return v.google_used+1;
}
export function summaryValues(s,http){
 return [s?.status??null,http??null,s?.searchCalls??null,s?.pageCalls??null,s?.citationCount??null,s?.pendingBuiltin??null,s?.pendingPlanning??null,s?.pendingOther??null,s?.totalTokens??null];
}
export async function authorizeProtocolReadback(c,p,jobId,summary,http){
 const v=await row(c,p,jobId);if(v.google_used!==1||v.readback_authorized||summary?.status!=='completed'||!(summary.searchCalls>0)||summary.pageCalls!==0||!(summary.citationCount>0))unavailable();
 const values=summaryValues(summary,http);await c.query(`UPDATE wanderful_owner_budget_v1.protocol_verification SET readback_authorized=true,${FIRST_COLUMNS.map((x,i)=>x+'=$'+(i+1)).join(',')} WHERE singleton`,values);
}
export async function finishProtocolVerification(c,p,jobId,result){
 await row(c,p,jobId,{finish:true});const values=RESULT_COLUMNS.map(x=>result[x]??null);
 const saved=await c.query(`UPDATE wanderful_owner_budget_v1.protocol_verification SET ${RESULT_COLUMNS.map((x,i)=>x+'=$'+(i+1)).join(',')},result_finished_at=clock_timestamp() WHERE singleton AND job_id=$${values.length+1} AND result_finished_at IS NULL`,[...values,jobId]);
 if(saved.rowCount!==1)unavailable();
}
