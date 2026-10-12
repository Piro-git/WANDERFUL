import {appAttestError} from '../appAttest/appAttestErrors.js';
export const SUPPLEMENT_CAPS=Object.freeze({requests:1,intents:1,google:8,graphhopper:6});
export function supplementConfiguration(env,{keyId,origin,expiresAt}){
 if(env.OWNER_ACCESS_SUPPLEMENT_ENABLED!=='true')return undefined;
 const approvalSHA256=env.OWNER_ACCESS_SUPPLEMENT_APPROVAL_SHA256,backendTree=env.OWNER_ACCESS_SUPPLEMENT_BACKEND_TREE;
 if(!/^[a-f0-9]{64}$/.test(approvalSHA256??'')||!/^[a-f0-9]{40}$/.test(backendTree??''))throw Error('supplement_configuration_unavailable');
 return Object.freeze({approvalSHA256,backendTree,keyId,origin,expiresAt});
}
async function row(c,p){
 if(!p||!/^[a-f0-9]{64}$/.test(p.approvalSHA256??'')||!/^[a-f0-9]{40}$/.test(p.backendTree??'')||!Number.isSafeInteger(p.expiresAt))throw appAttestError('route_session_exhausted');
 const r=await c.query(`SELECT *,extract(epoch FROM expires_at)*1000 AS expires_ms FROM wanderful_owner_budget_v1.supplement WHERE singleton AND approval_sha256=$1 AND backend_tree=$2 AND key_id=$3 AND origin=$4 AND revoked_at IS NULL AND activated_at<=clock_timestamp() AND expires_at>clock_timestamp() FOR UPDATE`,[p.approvalSHA256,p.backendTree,p.keyId,p.origin]);
 const s=r.rows[0];if(!s||Number(s.expires_ms)!==p.expiresAt)throw appAttestError('route_session_exhausted');return s;
}
export async function reserveSupplementAdmission(c,{cost,planning},leaseId){
 const s=await row(c,planning.supplement);
 if(cost===3){
  if(s.intent_used!==0||s.requests_used!==0)throw appAttestError('route_session_exhausted');
  await c.query('UPDATE wanderful_owner_budget_v1.supplement SET intent_used=intent_used+1,intent_lease_id=$1 WHERE singleton',[leaseId]);
 }else if(cost===12){
  if(s.requests_used!==0)throw appAttestError('route_session_exhausted');
  await c.query('UPDATE wanderful_owner_budget_v1.supplement SET requests_used=requests_used+1,plan_lease_id=$1 WHERE singleton',[leaseId]);
 }else throw appAttestError('route_session_invalid');
}
export async function reserveSupplementProvider(c,input){
 const s=await row(c,input.supplement),provider=input.provider;
 if(!['google','graphhopper'].includes(provider)||input.leaseId!==(s.requests_used===1?s.plan_lease_id:s.intent_lease_id)||s[provider+'_used']>=SUPPLEMENT_CAPS[provider])return false;
 const {rows}=await c.query("SELECT cost FROM wanderful_owner_v1.windows WHERE scope=$1 AND identity_hash='global'",['wanderful-live-wave-20261003:'+provider]);
 const total=rows[0]?.cost??0;if(total>=(provider==='google'?16:10))return false;
 await c.query(`UPDATE wanderful_owner_budget_v1.supplement SET ${provider}_used=${provider}_used+1,last_provider_lease_id=$1 WHERE singleton`,[input.leaseId]);
 await c.query(`INSERT INTO wanderful_owner_v1.windows(scope,identity_hash,cost,reset_at) VALUES($1,'global',1,'infinity'::timestamptz) ON CONFLICT(scope,identity_hash) DO UPDATE SET cost=wanderful_owner_v1.windows.cost+1,reset_at='infinity'::timestamptz`,['wanderful-live-wave-20261003:'+provider]);
 return true;
}
export async function supplementReadiness(c,p){
 const s=await row(c,p);if(s.requests_used!==0)throw Error('supplement_plan_exhausted');
 const {rows}=await c.query(`SELECT c.relrowsecurity,pg_get_userbyid(c.relowner)<>current_user AS operator_owned,has_table_privilege(c.oid,'SELECT') AS sel,has_table_privilege(c.oid,'INSERT,DELETE,TRUNCATE,TRIGGER,REFERENCES') AS unsafe,NOT has_schema_privilege(n.oid,'CREATE') AS no_create FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wanderful_owner_budget_v1' AND c.relname='supplement' AND c.relkind='r'`);
 if(rows.length!==1||!rows[0].relrowsecurity||!rows[0].operator_owned||!rows[0].sel||rows[0].unsafe||!rows[0].no_create)throw Error('supplement_guard_unavailable');
 const guards=await c.query(`SELECT t.tgname FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wanderful_owner_budget_v1' AND NOT t.tgisinternal AND t.tgenabled='O' AND NOT p.prosecdef AND pg_get_userbyid(p.proowner)<>current_user`);
 if(guards.rows.map(x=>x.tgname).sort().join()!==['supplement_cumulative_totals','supplement_no_truncate','supplement_totals','supplement_write'].sort().join())throw Error('supplement_guard_unavailable');
}
