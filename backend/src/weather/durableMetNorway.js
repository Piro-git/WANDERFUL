import {fetchMetNorwayPoint,validateMetUserAgent} from './metNorway.js';

// A lease may outlive its worker after a crash; it cannot make stale data fresh.
// Each admission is globally spaced by the durable store, including failures.
export function createDurableMetNorwayProvider({store,userAgent,fetchImpl=globalThis.fetch,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=5000}={}) {
  validateMetUserAgent(userAgent);
  if(!store?.claim || !store?.complete || !store?.fail) throw new TypeError('weather_store_unavailable');
  return async(point,{signal}={})=>{
    const key=`${point.latitude},${point.longitude}`,deadline=now()+6000;
    while(true) {
      if(signal?.aborted) throw new Error('cancelled');
      const admission=await store.claim(key);
      if(admission.kind==='hit') return admission.value;
      if(admission.kind==='busy' || admission.kind==='wait') {
        if(now()>=deadline) throw new Error('weather_busy');
        await sleep(Math.min(100,Math.max(1,deadline-now())));
        continue;
      }
      if(admission.kind!=='claim') throw new Error('weather_store_unavailable');
      try {
        const result=await fetchMetNorwayPoint({point,old:admission.old,userAgent,fetchImpl,now,timeoutMs});
        await store.complete(key,admission.token,result);
        return result;
      } catch(error) {
        try {await store.fail(key,admission.token,{throttled:error?.throttled===true});} catch {}
        throw error;
      }
    }
  };
}
