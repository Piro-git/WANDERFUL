import {createHash} from 'node:crypto';
import {buildWebResearchInput} from '../dynamicResearch/webResearch.js';
import {researchInteractionBody} from '../dynamicResearch/researchProtocol.js';
// This fixed public operator scenario is not a regional app restriction and is
// never substituted for a user request. No prior private phone payload is read.
export const PROTOCOL_PUBLIC_REQUEST=Object.freeze({prompt:'Plane eine ungefähr 15 km lange Rundwanderung ab Ilsenburg im Harz, die wieder am Start endet. Baue echte, namentlich bekannte Aussichtspunkte ein. Zeige passende Wikimedia-Fotos dieser Orte, sofern verfügbar. Kleine Abweichungen von 15 km sind okay.',locationName:'Ilsenburg',intent:Object.freeze({activityType:'hiking',routeType:'loop',targetDistanceKm:15}),preferences:Object.freeze({interests:Object.freeze(['viewpoint'])})});
export const PROTOCOL_INITIAL_BODY=JSON.stringify(researchInteractionBody({model:'gemini-3.8-flash',input:buildWebResearchInput(PROTOCOL_PUBLIC_REQUEST),tools:[{type:'google_search',search_types:['web_search']},{type:'url_context'}]}));
export const PROTOCOL_INPUT_SHA256=createHash('sha256').update(PROTOCOL_INITIAL_BODY).digest('hex');
