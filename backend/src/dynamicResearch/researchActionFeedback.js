// This phase declares only server-side Google Search and URL Context tools.
// Never dispatch a proposed client function or fetch a URL from its arguments.
const invalid=()=>{throw Object.assign(new Error('web_research_unverified'),{
 code:'web_research_unverified',privateResearchValidationReason:'research_action_invalid',
 privateResearchProviderStatus:'requires_action'
});};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200;
function bounded(x,depth=0){
 return depth<=8&&(x===null||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x)||
  typeof x==='string'&&x.length<=65536||Array.isArray(x)&&x.length<=80&&x.every(v=>bounded(v,depth+1))||
  object(x)&&Object.keys(x).length<=80&&Object.values(x).every(v=>bounded(v,depth+1)));
}
function sourceURL(value){
 if(typeof value!=='string'||value.length>4096)return null;
 let url;try{url=new URL(value);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||
  /^\d+(?:\.\d+){3}$/.test(url.hostname)||url.hostname.startsWith('[')||
  /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname))return null;
 return url.href;
}
// Bound every complete input history before serializing it for a paid request.
export function validateResearchHistory(history){
 if(!Array.isArray(history)||!bounded(history)||Buffer.byteLength(JSON.stringify(history))>524288)invalid();
 return history;
}
export function completedResearchSteps(earlier,newPayload){
 if(newPayload?.status!=='completed'||!Array.isArray(newPayload.steps)){
  const status=['requires_action','failed','incomplete','cancelled','queued','in_progress','budget_exceeded'].includes(newPayload?.status)?newPayload.status:'unrecognized';
  throw Object.assign(new Error('web_research_unverified'),{code:'web_research_unverified',
   privateResearchValidationReason:'provider_not_completed',privateResearchProviderStatus:status});
 }
 // A completed answer cannot introduce another client action or executable tool.
 const allowed=new Set(['thought','model_output','google_search_call','google_search_result','url_context_call','url_context_result']);
 if(newPayload.steps.some(s=>!object(s)||!allowed.has(s.type)||
  s.type==='thought'&&(s.signature!==undefined&&typeof s.signature!=='string'||
   s.summary!==undefined&&(!Array.isArray(s.summary)||s.summary.some(c=>!object(c)||c.type!=='text'||typeof c.text!=='string')))))invalid();
 const steps=[...earlier.filter(s=>s.type!=='model_output'),...newPayload.steps],ids=new Set();
 for(const s of steps)if(['function_call','google_search_call','url_context_call'].includes(s?.type)){
  if(!id(s.id)||ids.has(s.id))invalid();ids.add(s.id);
 }
 return steps;
}
export function researchActionFeedback(payload){
 if(payload?.status!=='requires_action'||!Array.isArray(payload.steps)||!payload.steps.length||
  payload.steps.length>60||!bounded(payload.steps)||Buffer.byteLength(JSON.stringify(payload.steps))>196608)invalid();
 const calls=[],ids=new Map(),answered=new Set();
 for(const step of payload.steps){
  if(!object(step))invalid();
  if(step.type==='thought'){
   if(step.signature!==undefined&&typeof step.signature!=='string'||
    step.summary!==undefined&&(!Array.isArray(step.summary)||step.summary.some(c=>
     !object(c)||c.type!=='text'||typeof c.text!=='string')))invalid();
  }else if(step.type==='function_call'){
   if(!id(step.id)||ids.has(step.id)||!id(step.name)||!object(step.arguments)||
    !bounded(step.arguments)||Buffer.byteLength(JSON.stringify(step.arguments))>16000)invalid();
   ids.set(step.id,step.type);calls.push(step);
  }else if(step.type==='google_search_call'){
   const queries=step.arguments?.queries;
   if(!id(step.id)||ids.has(step.id)||!object(step.arguments)||queries!==undefined&&(
    !Array.isArray(queries)||queries.length>20||queries.some(q=>typeof q!=='string'||!q.trim()||q.length>1000)))invalid();
   ids.set(step.id,step.type);
  }else if(step.type==='url_context_call'){
   const urls=step.arguments?.urls;
   if(!id(step.id)||ids.has(step.id)||!object(step.arguments)||!Array.isArray(urls)||!urls.length||
    urls.length>20||urls.some(u=>!sourceURL(u)))invalid();
   ids.set(step.id,{type:step.type,urls:new Set(urls.map(sourceURL))});
  }else if(step.type==='google_search_result'||step.type==='url_context_result'){
   const call=ids.get(step.call_id),expected=step.type==='google_search_result'?'google_search_call':'url_context_call';
   if(!id(step.call_id)||(typeof call==='string'?call:call?.type)!==expected||answered.has(step.call_id)||
    !Array.isArray(step.result)||step.is_error!==undefined&&typeof step.is_error!=='boolean'||
    expected==='google_search_call'&&step.is_error===true)invalid();
   answered.add(step.call_id);
   for(const item of step.result){
    if(!object(item))invalid();
    if(expected==='google_search_call'&&item.search_suggestions!==undefined&&(
     typeof item.search_suggestions!=='string'||!item.search_suggestions.trim()))invalid();
    if(expected==='url_context_call'&&(item.url!==undefined&&(!sourceURL(item.url)||!call.urls.has(sourceURL(item.url)))||
     item.status!==undefined&&typeof item.status!=='string'))invalid();
   }
  }else if(step.type==='model_output'){
   if(step.error!=null||step.content!==undefined&&(!Array.isArray(step.content)||step.content.some(c=>
    !object(c)||c.type!=='text'||typeof c.text!=='string'||c.annotations!==undefined&&!Array.isArray(c.annotations))))invalid();
  }else{
   // Client function results and other executable tool histories are not accepted.
   invalid();
  }
 }
 if(calls.length<1||calls.length>3||[...ids].some(([key,value])=>
  value!=='function_call'&&!answered.has(key)))invalid();
 return calls.map(call=>({type:'function_result',call_id:call.id,name:call.name,is_error:true,
  result:{error:{code:'unsupported_client_tool_for_research',
   message:'No client function is registered in this research phase. This call was not executed. Use the declared server-side Google Search and URL Context tools for source research. Routing and photos are handled later.'}}
 }));
}
