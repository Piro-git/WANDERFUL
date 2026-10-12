import {appAttestError} from '../appAttest/appAttestErrors.js';
export const FOLLOWUP_CAPS=Object.freeze({diagnosticGoogle:1,intents:1,requests:1,google:8,graphhopper:6});
export function followupConfiguration(env,{keyId,origin,expiresAt}){
 if(env.OWNER_ACCESS_FOLLOWUP_ENABLED!=='true')return undefined;
 if(env.OWNER_ACCESS_SUPPLEMENT_ENABLED==='true')throw Error('ambiguous_entitlement');
 const approvalSHA256=env.OWNER_ACCESS_FOLLOWUP_APPROVAL_SHA256,backendTree=env.OWNER_ACCESS_FOLLOWUP_BACKEND_TREE,phoneApprovalSHA256=env.OWNER_ACCESS_FOLLOWUP_PHONE_APPROVAL_SHA256;
 if(!/^[a-f0-9]{64}$/.test(approvalSHA256??'')||!/^[a-f0-9]{40}$/.test(backendTree??'')||!/^[a-f0-9]{64}$/.test(phoneApprovalSHA256??''))throw Error('followup_unavailable');
 return Object.freeze({approvalSHA256,backendTree,phoneApprovalSHA256,keyId,origin,expiresAt});
}
export async function followupSecurity(c){
 const t=await c.query(`SELECT c.relrowsecurity,pg_get_userbyid(c.relowner)<>current_user AS operator_owned,has_table_privilege(c.oid,'SELECT') AS sel,has_table_privilege(c.oid,'INSERT,DELETE,TRUNCATE,TRIGGER,REFERENCES') AS unsafe,NOT has_schema_privilege(n.oid,'CREATE') AS no_create FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wanderful_owner_budget_v1' AND c.relname='entitlements' AND c.relkind='r'`);
 if(t.rows.length!==1||!t.rows[0].relrowsecurity||!t.rows[0].operator_owned||!t.rows[0].sel||t.rows[0].unsafe||!t.rows[0].no_create)throw Error('followup_guard_unavailable');
 const perms=await c.query(`SELECT 1 FROM pg_attribute a WHERE a.attrelid='wanderful_owner_budget_v1.entitlements'::regclass AND a.attname IN ('sequence','approval_sha256','key_id','origin','diagnostic_backend_tree','activated_at','diagnostic_expires_at','phone_backend_tree','phone_approval_sha256','phone_activated_at','phone_expires_at','revoked_at') AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE') LIMIT 1`);if(perms.rowCount)throw Error('followup_guard_unavailable');
 const pub=await c.query(`SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') AND (has_schema_privilege(oid,'wanderful_owner_budget_v1','USAGE,CREATE') OR has_table_privilege(oid,'wanderful_owner_budget_v1.entitlements','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')) LIMIT 1`);if(pub.rowCount)throw Error('followup_guard_unavailable');
 const g=await c.query(`SELECT t.tgname FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wanderful_owner_budget_v1' AND NOT t.tgisinternal AND t.tgenabled='O' AND NOT p.prosecdef AND pg_get_userbyid(p.proowner)<>current_user AND p.proconfig @> ARRAY['search_path=pg_catalog']`);
 const expected=['supplement_cumulative_totals','supplement_no_truncate','supplement_totals','supplement_write','entitlement_write','entitlement_no_truncate','entitlement_totals'];if(g.rows.map(x=>x.tgname).sort().join()!==expected.sort().join())throw Error('followup_guard_unavailable');
}
export async function followupRow(c,p,phase){
 if(!/^[a-f0-9]{64}$/.test(p?.approvalSHA256??'')||!/^[a-f0-9]{40}$/.test(p?.backendTree??''))throw appAttestError('route_session_exhausted');
 await followupSecurity(c);
 const {rows}=await c.query(`SELECT e.*,extract(epoch FROM e.diagnostic_expires_at)*1000 AS diag_ms,extract(epoch FROM e.phone_expires_at)*1000 AS phone_ms FROM wanderful_owner_budget_v1.entitlements e JOIN wanderful_owner_v1.keys k ON k.key_id=e.key_id JOIN wanderful_owner_v1.owners o ON o.installation_id=k.installation_id WHERE e.sequence=2 AND e.approval_sha256=$1 AND e.key_id=$2 AND e.origin=$3 AND e.revoked_at IS NULL AND e.activated_at<=clock_timestamp() AND k.revoked_at IS NULL AND o.revoked_at IS NULL FOR UPDATE OF e`,[p.approvalSHA256,p.keyId,p.origin]);
 const s=rows[0];if(!s)throw appAttestError('route_session_exhausted');
 const {rows:clock}=await c.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now_ms');const now=Number(clock[0].now_ms);
 if(phase==='diagnostic'){if(s.diagnostic_backend_tree!==p.backendTree||now>=Number(s.diag_ms))throw appAttestError('route_session_exhausted');}
 else if(s.phone_backend_tree!==p.backendTree||s.phone_approval_sha256!==p.phoneApprovalSHA256||Number(s.phone_ms)!==p.expiresAt||now>=Number(s.phone_ms))throw appAttestError('route_session_exhausted');
 return s;
}
export async function chargeOriginalProvider(c,provider){
 if(!['google','graphhopper'].includes(provider))throw Error('provider_not_allowed');
 const scope='wanderful-live-wave-20261003:'+provider;
 const {rows}=await c.query("SELECT cost FROM wanderful_owner_v1.windows WHERE scope=$1 AND identity_hash='global'",[scope]);
 if((rows[0]?.cost??0)>=(provider==='google'?16:10))throw appAttestError('app_attest_rate_limited');
 await c.query("INSERT INTO wanderful_owner_v1.windows(scope,identity_hash,cost,reset_at) VALUES($1,'global',1,'infinity') ON CONFLICT(scope,identity_hash) DO UPDATE SET cost=wanderful_owner_v1.windows.cost+1,reset_at='infinity'",[scope]);
}
export async function reserveFollowupDiagnostic(c,p,jobId){
 const s=await followupRow(c,p,'diagnostic');if(s.diagnostic_used!==0||s.phone_backend_tree!==null)throw appAttestError('route_session_exhausted');
 await c.query('UPDATE wanderful_owner_budget_v1.entitlements SET diagnostic_used=1,diagnostic_job_id=$1 WHERE sequence=2',[jobId]);
 await chargeOriginalProvider(c,'google');
}
export async function reserveFollowupAdmission(c,{cost,planning},leaseId){
 const s=await followupRow(c,planning.followup,'phone');
 if(cost===3){if(s.intent_used||s.requests_used)throw appAttestError('route_session_exhausted');await c.query('UPDATE wanderful_owner_budget_v1.entitlements SET intent_used=1,intent_lease_id=$1 WHERE sequence=2',[leaseId]);}
 else if(cost===12){if(s.requests_used)throw appAttestError('route_session_exhausted');await c.query('UPDATE wanderful_owner_budget_v1.entitlements SET requests_used=1,plan_lease_id=$1 WHERE sequence=2',[leaseId]);}
 else throw appAttestError('route_session_invalid');
}
export async function reserveFollowupProvider(c,input){
 const s=await followupRow(c,input.followup,'phone'),provider=input.provider;
 if(!['google','graphhopper'].includes(provider)||input.leaseId!==(s.requests_used?s.plan_lease_id:s.intent_lease_id)||s[provider+'_used']>=FOLLOWUP_CAPS[provider])return false;
 await c.query(`UPDATE wanderful_owner_budget_v1.entitlements SET ${provider}_used=${provider}_used+1,last_provider_lease_id=$1 WHERE sequence=2`,[input.leaseId]);
 await chargeOriginalProvider(c,provider);return true;
}
