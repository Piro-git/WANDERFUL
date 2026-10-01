import {randomUUID} from 'node:crypto';
import {authorizeRouteRequest,createDefaultRouteAuthorizer} from '../routing/routeAuthorization.js';
import {InMemoryRouteRateLimiter} from '../routing/routeRateLimiter.js';
import {AppAttestError,appAttestErrorResult} from '../appAttest/appAttestErrors.js';
import {RouteError,routeErrorResult} from '../routing/routeErrors.js';
import {validateWeatherRequest,createRouteWeather} from './routeWeather.js';
import {createMetNorwayProvider} from './metNorway.js';

export function createWeatherEndpoint(options={}) {
  const env=options.env??process.env;
  let authorizer=options.authorizer,weather;
  const limiter=new InMemoryRouteRateLimiter({maxCost:6});
  return async(body,context={})=>{
    let request,authorization;
    try {request=validateWeatherRequest(body);} catch {return {statusCode:400,payload:{error:{code:'invalid_weather_request'}}};}
    try {
      authorizer??=createDefaultRouteAuthorizer(env,options);
      const headerID=context.headers?.['x-trailmind-request-id'];
      const requestId=typeof headerID==='string'&&/^[0-9a-f-]{36}$/i.test(headerID)?headerID:randomUUID();
      authorization=await authorizeRouteRequest(authorizer,{...context,requestId,cost:1});
      if(authorization.limitsConsumed!==true && (env.NODE_ENV==='production'||!limiter.consume({key:authorization.rateLimitKey,cost:1}).allowed)) {
        return {statusCode:429,payload:{error:{code:'weather_unavailable'}}};
      }
      if(!weather) {
        let provider;
        if(env.ROUTE_WEATHER_ENABLED==='true') {
          try {provider=options.weatherProvider??createMetNorwayProvider({userAgent:env.ROUTE_WEATHER_USER_AGENT,fetchImpl:options.fetchImpl,now:options.now});} catch {}
        }
        weather=createRouteWeather({provider,now:options.now});
      }
      return {statusCode:200,payload:await weather(request,{signal:context.signal})};
    } catch(error) {
      if(error instanceof AppAttestError)return appAttestErrorResult(error);
      if(error instanceof RouteError)return routeErrorResult(error);
      return {statusCode:503,payload:{error:{code:'weather_unavailable'}}};
    } finally {try {await authorization?.release?.();} catch {}}
  };
}
