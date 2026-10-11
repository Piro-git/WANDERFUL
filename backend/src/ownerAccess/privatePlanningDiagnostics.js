// Private-lane diagnostics: closed enums/numbers only, no arbitrary error/message/body.
const CODES=new Set(['configuration_missing','cancelled','timed_out','rate_limited','provider_rejected','provider_unavailable','redirect_rejected','invalid_content_type','response_too_large','invalid_response','web_research_unverified','web_research_unavailable','research_budget_exhausted','research_timed_out','invalid_route_evidence','quality_review_unavailable','invalid_quality_review','research_no_acceptable_route','invalid_request','route_session_invalid','route_session_expired','route_session_exhausted','app_attest_rate_limited']);
const STAGES=new Set(['web_search_http','web_search_validation','web_page_validation','web_followup_http','web_followup_validation']);
const PROVIDERS=new Set(['google','graphhopper']);
const PHASES=new Set(['intent','web_grounding','page_read','place_routing','graphhopper']);
export function safePrivateFailure(error){
 return {diagnosticCode:CODES.has(error?.code)?error.code:'unclassified',diagnosticStage:STAGES.has(error?.privateResearchStage)?error.privateResearchStage:'unclassified'};
}
export function createPrivatePlanningLogger(sink){
 return {info(value){
  if(!value||typeof value!=='object')return;
  const out={};
  if(['dynamic_research_admitted','llm_first_planning_completed','owner_provider_attempt_completed','owner_provider_attempt_failed'].includes(value.event))out.event=value.event;else return;
  if(PROVIDERS.has(value.provider))out.provider=value.provider;
  if(PHASES.has(value.phase))out.phase=value.phase;
  if(Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599)out.httpStatus=value.httpStatus;
  for(const k of ['requestCostUnits','dailyRequestLimit','acceptedCount','rejectedCount','fallbackAttemptCount'])if(Number.isSafeInteger(value[k])&&value[k]>=0&&value[k]<=100)out[k]=value[k];
  if(['routed','checked','failed'].includes(value.resultState))out.resultState=value.resultState;
  if(['under_250ms','250ms_to_1s','1s_to_5s','5s_to_15s','15s_to_30s','30s_or_more','unknown'].includes(value.durationBucket))out.durationBucket=value.durationBucket;
  if(CODES.has(value.errorCode)||['research_unavailable','internal_failure','authorization_failed','authorization_unavailable','feature_unavailable','unsupported'].includes(value.errorCode))out.errorCode=value.errorCode;
  if(CODES.has(value.diagnosticCode)||value.diagnosticCode==='unclassified')out.diagnosticCode=value.diagnosticCode;
  if(STAGES.has(value.diagnosticStage)||value.diagnosticStage==='unclassified')out.diagnosticStage=value.diagnosticStage;
  try{sink.info(out);}catch{}
 }};
}
