// Private-lane diagnostics: closed enums/numbers only, no arbitrary error/message/body.
const CODES=new Set(['configuration_missing','cancelled','timed_out','rate_limited','provider_rejected','provider_unavailable','redirect_rejected','invalid_content_type','response_too_large','invalid_response','web_research_unverified','web_research_unavailable','research_budget_exhausted','research_timed_out','invalid_route_evidence','quality_review_unavailable','invalid_quality_review','research_no_acceptable_route','invalid_request','route_session_invalid','route_session_expired','route_session_exhausted','app_attest_rate_limited']);
const STAGES=new Set(['web_search_http','web_search_validation','web_page_validation','web_followup_http','web_followup_validation']);
const VALIDATION_REASONS=new Set(['provider_not_completed','model_output_failed','provider_steps_invalid', 'search_call_invalid', 'search_queries_missing', 'search_result_invalid', 'search_suggestions_missing', 'search_suggestions_invalid', 'page_call_invalid', 'page_result_invalid', 'model_content_invalid', 'answer_text_invalid', 'annotation_list_invalid', 'citation_url_invalid', 'citation_title_invalid', 'citation_range_missing', 'citation_range_invalid', 'grounded_text_missing', 'search_evidence_missing', 'source_page_evidence_missing', 'web_limits_exceeded', 'unicode_invalid', 'web_envelope_invalid']);
const PROVIDERS=new Set(['google','graphhopper']);
const PHASES=new Set(['intent','web_grounding','page_read','place_routing','graphhopper']);
export function safePrivateFailure(error){
 const out={diagnosticCode:CODES.has(error?.code)?error.code:'unclassified',diagnosticStage:STAGES.has(error?.privateResearchStage)?error.privateResearchStage:'unclassified'};
 if(VALIDATION_REASONS.has(error?.privateResearchValidationReason))out.diagnosticValidationReason=error.privateResearchValidationReason;
 return out;
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
  if(VALIDATION_REASONS.has(value.diagnosticValidationReason))out.diagnosticValidationReason=value.diagnosticValidationReason;
  try{sink.info(out);}catch{}
 }};
}
