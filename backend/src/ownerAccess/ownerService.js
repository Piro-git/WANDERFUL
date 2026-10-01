import { createServer } from "node:http";
import { canonicalOwnerOrigin, createOwnerAccessEndpoint, OWNER_CHALLENGE_PATH, OWNER_SESSION_PATH } from "./ownerAccessEndpoint.js";
import { createOwnerSessionAuthorizer } from "./ownerSessionAuthorizer.js";
import { createRouteEndpoint } from "../routing/routeEndpoint.js";
import { createIntentSessionEndpoint } from "../appAttest/intentSessionEndpoint.js";
import { GOOGLE_INTERACTIONS_URL } from "../intentSchema.js";
import { appAttestErrorResult } from "../appAttest/appAttestErrors.js";

export function ownerServiceConfiguration(env) {
  if (env.NODE_ENV !== "production" || env.OWNER_ACCESS_ENABLED !== "true" || env.AI_PROVIDER !== "google" ||
      !/^gemini-[a-z0-9.-]+$/.test(env.GOOGLE_MODEL ?? "") || !env.GOOGLE_API_KEY?.trim() ||
      !env.GRAPHHOPPER_API_KEY?.trim()) throw new Error("Owner service configuration unavailable");
  const limit = (key,max=100) => {
    if (!/^[1-9][0-9]*$/.test(env[key] ?? "")) throw new Error("Owner limit missing");
    const value=Number(env[key]);
    if (value>max) throw new Error("Owner limit too large");
    return value;
  };
  const maximumConcurrency=limit("OWNER_ACCESS_MAX_CONCURRENCY",2);
  return Object.freeze({ origin:canonicalOwnerOrigin(env.OWNER_ACCESS_ORIGIN),
    route:{ maximumConcurrency,ownerDailyMaximum:limit("OWNER_ACCESS_ROUTE_DAILY_LIMIT"),
      globalDailyMaximum:limit("OWNER_ACCESS_GLOBAL_ROUTE_DAILY_LIMIT") },
    intent:{ maximumConcurrency,ownerDailyMaximum:limit("OWNER_ACCESS_INTENT_DAILY_LIMIT"),
      globalDailyMaximum:limit("OWNER_ACCESS_GLOBAL_INTENT_DAILY_LIMIT") },
    // Construct a closed provider configuration. Inherited research/mock/base-URL
    // flags and alternate credentials cannot expand this service's capabilities.
    providerEnv:Object.freeze({ NODE_ENV:"production", AI_PROVIDER:"google", GOOGLE_MODEL:env.GOOGLE_MODEL,
      GOOGLE_API_KEY:env.GOOGLE_API_KEY,GRAPHHOPPER_API_KEY:env.GRAPHHOPPER_API_KEY,
      ROUTE_PROVIDER_ENABLED:"true",INTENT_PROVIDER_ENABLED:"true",INTENT_REQUEST_COST:"3",
      INTENT_PROVIDER_TIMEOUT_MS:"15000",ROUTE_REQUEST_TIMEOUT_MS:"30000",
      ROUTE_MAX_DISTANCE_METERS:"200000",INTENT_ALLOW_INSECURE_LOCAL_PARSING:"false" }) });
}

export function createOwnerService({ repository, configuration, fetchImpl=globalThis.fetch }) {
  if (!repository?.isDurable) throw new Error("Durable owner repository required");
  const authEndpoint=createOwnerAccessEndpoint({ repository,enabled:true,origin:configuration.origin,environment:"production" });
  return createServer(async (req,res) => {
    const controller=new AbortController();
    const abort=()=>controller.abort();
    req.once("aborted",abort);
    res.once("close",()=>{ if(!res.writableEnded) abort(); });
    const deadline=setTimeout(()=>{ abort(); if(!res.headersSent) send(res,504,{error:{code:"route_timed_out",message:"The request timed out."}}); },40_000);
    deadline.unref();
    try {
      if (req.method==="GET" && req.url==="/healthz") return send(res,200,{status:"live"});
      if (req.method==="GET" && req.url==="/readyz") {
        await repository.readiness();
        return send(res,200,{status:"ready"});
      }
      const paths=[OWNER_CHALLENGE_PATH,OWNER_SESSION_PATH,"/api/parse-intent","/api/route"];
      if (req.method!=="POST" || !paths.includes(req.url)) return send(res,404,{error:{code:"not_found",message:"Not found."}});
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")) {
        return send(res,415,{error:{code:"invalid_request",message:"Use a JSON request."}});
      }
      const body=await readBody(req,controller.signal);
      // Socket peer is trusted but deliberately coarse behind a reverse proxy.
      // Never derive identity or signed origin from client-controlled headers.
      const context={headers:req.headers,signal:controller.signal,edgeIdentity:req.socket.remoteAddress ?? "shared-ingress"};
      if(req.url===OWNER_CHALLENGE_PATH || req.url===OWNER_SESSION_PATH) {
        const result=await authEndpoint(req.url,body,context);
        return send(res,result.statusCode,result.payload,result.headers);
      }
      const scope=req.url==="/api/route"?"route":"intent";
      if(scope==="intent" && (!body || Object.keys(body).some((k)=>!["prompt","locale","userLocationHint"].includes(k)))) {
        return send(res,400,{error:{code:"invalid_request",message:"The intent request is invalid."}});
      }
      let access,providerBudgetError;
      const baseAuthorizer=createOwnerSessionAuthorizer({repository,scope,limits:configuration[scope]});
      const authorizer={async authorize(input){ access=await baseAuthorizer.authorize(input);return access; }};
      const boundedFetch=async (url,init) => {
        const target=new URL(url);
        const allowed=scope==="route" ? target.origin==="https://graphhopper.com" && target.pathname==="/api/1/route"
          : target.href===GOOGLE_INTERACTIONS_URL;
        if(!allowed || !access || init.method!=="POST") throw new Error("Owner provider unavailable");
        try { await access.reserveProviderAttempt(); } catch(error) {
          if(error.code==="app_attest_rate_limited") providerBudgetError=error;
          throw error;
        }
        if(controller.signal.aborted) throw new Error("Owner request cancelled");
        return fetchImpl(url,{...init,redirect:"error"});
      };
      const options={env:configuration.providerEnv,fetchImpl:boundedFetch};
      const endpoint=scope==="route" ? createRouteEndpoint({...options,authorizer})
        : createIntentSessionEndpoint({...options,intentAuthorizer:authorizer});
      const result=await endpoint(body,context);
      if(providerBudgetError) {
        const budget=appAttestErrorResult(providerBudgetError);
        return send(res,budget.statusCode,budget.payload,budget.headers);
      }
      send(res,result.statusCode,result.payload,result.headers);
    } catch {
      if(!res.headersSent) send(res,503,{error:{code:"owner_access_unavailable",message:"Owner access is temporarily unavailable."}});
    } finally { clearTimeout(deadline);req.removeListener("aborted",abort); }
  });
}

function send(res,status,payload,headers={}) {
  if(res.writableEnded || res.destroyed) return;
  res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store",...headers});
  res.end(JSON.stringify(payload));
}
async function readBody(req,signal) {
  const chunks=[];let total=0;
  const timeout=setTimeout(()=>req.destroy(),10_000);timeout.unref();
  try {
    for await(const chunk of req) {
      if(signal.aborted) throw new Error("Request aborted");
      total+=chunk.length;
      if(total>16_384) throw new Error("Request too large");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { clearTimeout(timeout); }
}
