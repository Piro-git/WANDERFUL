import {createGenericConditionLookup,createGeminiConditionExtraction} from './genericConditions.js';
import {createSourceDocumentLookup} from './sourceDocuments.js';
import {createGeminiQualityReview} from './quality.js';
import {createAccessLookup} from './access.js';
import {createConditionLookup} from './conditionSources.js';
import {createGeminiWebResearch} from './webResearch.js';
import {createDynamicPlaceSearch,createNamedPlaceResolver} from './places.js';
import {createLinkedPlaceReader} from './placeMedia.js';
import {createGeminiResearchInteraction} from './gemini.js';
import {createDynamicItineraryRouter} from './routing.js';
import {selectedPlanningConfiguration} from '../llmPlanning/adapters/selectedIntentPlanningAdapter.js';

export function createCurrentInformationDependency({env,fetchImpl}) {
  const config=selectedPlanningConfiguration(env);
  if(config.provider!=='google')throw new TypeError('research_configuration_missing');
  return createGenericConditionLookup({
    researchWeb:createGeminiWebResearch({apiKey:config.apiKey,model:config.model,fetchImpl}),
    extractConditions:createGeminiConditionExtraction({apiKey:config.apiKey,model:config.model,fetchImpl}),
    userAgent:env.DYNAMIC_RESEARCH_USER_AGENT
  });
}

export function createDynamicDependencies({env,fetchImpl,provider,webResearchEnabled=false}) {
  const config=selectedPlanningConfiguration(env);
  if(config.provider!=='google')throw new TypeError('research_configuration_missing');
  // Explicit descriptive client identification is required before any public source request.
  const userAgent=env.DYNAMIC_RESEARCH_USER_AGENT;
  const sourceReader=createLinkedPlaceReader({fetchImpl,userAgent});
  return {
    ...(webResearchEnabled ? {researchWeb:createGeminiWebResearch({apiKey:config.apiKey,model:config.model,fetchImpl})} : {}),
    ...(webResearchEnabled ? {currentInformation:createCurrentInformationDependency({env,fetchImpl})} : {}),
    sourceDocuments:createSourceDocumentLookup({fetchImpl,userAgent}),
    access:createAccessLookup({fetchImpl,userAgent}),
    conditions:createConditionLookup({fetchImpl,userAgent}),
    reviewPlan:createGeminiQualityReview({apiKey:config.apiKey,model:config.model,fetchImpl}),
    interact:createGeminiResearchInteraction({apiKey:config.apiKey,model:config.model,fetchImpl}),
    search:createDynamicPlaceSearch({fetchImpl,userAgent}),
    resolve:createNamedPlaceResolver({fetchImpl,userAgent}),
    enrich:sourceReader.enrich,
    photo:sourceReader.photo,
    route:createDynamicItineraryRouter({provider})
  };
}
