import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request} from 'node:https';
import {Readable} from 'node:stream';

// Public HTTPS only. DNS is checked for every hop and pinned into the socket lookup.
// Never pass these requests through the authenticated provider-accounting fetch.
export function publicSourceURL(value) {
 try {const u=new URL(value);if(typeof value!=='string'||value.length>4096||u.protocol!=='https:'||u.username||u.password||u.port||isIP(u.hostname)||u.hostname.startsWith('[')||!u.hostname.includes('.')||/(?:^|\.)(?:localhost|local|internal|invalid|test|example|onion)$/.test(u.hostname))return null;u.hash='';return u;}catch{return null;}
}
export function publicAddress(address) {
 const family=isIP(address);if(family===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===100&&b>=64&&b<=127||a===192&&(b===168||b===0||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113||a>=224);}
 // Exclude mapped IPv4, tunnelling, translation, documentation and special-use blocks.
 if(family!==6)return false;const [a,b]=address.toLowerCase().split(':').map(x=>parseInt(x||'0',16));
 return a>=0x2000&&a<=0x3fff&&a!==0x2002&&!(a===0x2001&&(b<0x200||b===0xdb8))&&(a&0xfff0)!==0x3ff0;
}
export async function publicFetch(url,{signal,headers}={}, {resolve=lookup,transport=request}={}) {
 const u=publicSourceURL(String(url));if(!u)throw new TypeError('source_url_rejected');
 const addresses=await resolve(u.hostname,{all:true,verbatim:true});
 if(signal?.aborted)throw new Error('source_cancelled_or_timed_out');
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)||isIP(a.address)!==a.family))throw new TypeError('source_private_address');
 const pinned=addresses[0];
 return await new Promise((resolveResponse,reject)=>{
  const req=transport(u,{method:'GET',signal,headers,agent:false,lookup:(_host,options,cb)=>options.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family)},res=>{
   const responseHeaders=new Headers();for(const [key,value] of Object.entries(res.headers))if(value!=null)responseHeaders.set(key,Array.isArray(value)?value.join(', '):value);
   resolveResponse({status:res.statusCode,ok:res.statusCode>=200&&res.statusCode<300,redirected:false,headers:responseHeaders,body:Readable.toWeb(res)});
  });req.on('error',reject);req.end();
 });
}
