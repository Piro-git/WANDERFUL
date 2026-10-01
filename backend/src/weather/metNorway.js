// One shared instance per long-lived server. No prompts, account IDs or device IPs reach MET Norway.
// Bounded cache refuses new coordinates when full rather than evicting still-fresh forecasts.
export function createMetNorwayProvider({userAgent,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=5000,maximumEntries=128}={}) {
  if (typeof userAgent!=='string'||userAgent.length>200||/[\r\n]/.test(userAgent)||!/^\S+.*(?:https:\/\/\S+|[^\s@]+@[^\s@]+\.[^\s@]+).*$/.test(userAgent)) throw new TypeError('weather_configuration_missing');
  const cache=new Map(),inflight=new Map(); let calls=[],blockedUntil=0;
  async function fetchPoint(key,point,old) {
    const started=now(); calls=calls.filter(t=>t>started-1000);
    if (started<blockedUntil || calls.length>=3) throw new Error('weather_busy');
    calls.push(started);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const url=new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
      url.search=new URLSearchParams({lat:String(point.latitude),lon:String(point.longitude)}).toString();
      const headers={'User-Agent':userAgent,Accept:'application/json','Accept-Encoding':'gzip, deflate'};
      if (old?.modified) headers['If-Modified-Since']=old.modified;
      // Redirects are followed only within the fixed HTTPS provider origin.
      let response=await fetchImpl(url,{headers,signal:controller.signal,redirect:'manual'});
      if ([301,302,307,308].includes(response.status)) {
        const location=new URL(response.headers.get('location'),url);
        await response.body?.cancel();
        if (location.origin!==url.origin) throw new Error('unsafe_redirect');
        response=await fetchImpl(location,{headers,signal:controller.signal,redirect:'error'});
      }
      if (![200,304].includes(response.status)) {
        await response.body?.cancel();
        blockedUntil=now()+60000; throw new Error('weather_unavailable');
      }
      const expires=Date.parse(response.headers.get('expires'));
      if (!Number.isFinite(expires)||expires<=now()) throw new Error('invalid_cache_headers');
      let document=old?.document;
      if (response.status===200) {
        const reader=response.body.getReader(); const chunks=[]; let bytes=0;
        try { while(true) { const {done,value}=await reader.read(); if(done)break; bytes+=value.length;
          if(bytes>256000) throw new Error('response_too_large'); chunks.push(Buffer.from(value)); }
        } finally { await reader.cancel(); }
        document=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      if (!document) throw new Error('missing_cached_document');
      const result={document,retrievedAt:response.status===304?old.retrievedAt:new Date(now()).toISOString(),expiresAt:new Date(expires).toISOString(),
        modified:response.headers.get('last-modified')??old?.modified};
      cache.set(key,result); return result;
    } catch(error) { blockedUntil=Math.max(blockedUntil,now()+10000); throw error; }
    finally { clearTimeout(timer); }
  }
  return async(point,{signal}={})=>{
    if(signal?.aborted) throw new Error('cancelled');
    const key=`${point.latitude},${point.longitude}`,old=cache.get(key);
    if(old&&Date.parse(old.expiresAt)>now()) return old;
    if (!inflight.has(key)) {
      // Retain old documents for conditional revalidation unless capacity is needed.
      // Expired entries may be evicted; fresh ones must survive until MET's Expires.
      if (!old && cache.size+inflight.size>=maximumEntries) {
        for (const [k,v] of cache) {
          if (k!==key && !inflight.has(k) && Date.parse(v.expiresAt)<=now()) cache.delete(k);
          if (cache.size+inflight.size<maximumEntries) break;
        }
      }
      if (!old&&cache.size+inflight.size>=maximumEntries) throw new Error('weather_cache_full');
      const work=fetchPoint(key,point,old).finally(()=>inflight.delete(key)); inflight.set(key,work);
    }
    // Shared provider work is bounded by its own timeout; one cancelled viewer cannot cancel another viewer's cache fill.
    const result=await inflight.get(key); if(signal?.aborted) throw new Error('cancelled'); return result;
  };
}
