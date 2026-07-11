import { createAppAttestEndpoint } from "./appAttestEndpoint.js";
import { InMemoryAppAttestRepository } from "./appAttestRepository.js";
import { createAppAttestVerifier, appAttestVerifierConfiguration } from "./appAttestVerifier.js";
import {
  createIntentSessionAuthorizer,
  createRouteSessionAuthorizer
} from "./routeSessionAuthorizer.js";

export function createAppAttestRuntime(options = {}) {
  const env = options.env ?? process.env;
  const localEnvironment = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  const repository = options.appAttestRepository ?? (
    localEnvironment && env.APP_ATTEST_ALLOW_IN_MEMORY === "true"
      ? new InMemoryAppAttestRepository(options.appAttestRepositoryOptions)
      : undefined
  );
  let verifier = options.appAttestVerifier;
  if (!verifier) {
    try {
      verifier = createAppAttestVerifier(appAttestVerifierConfiguration(env));
    } catch {
      verifier = undefined;
    }
  }
  return {
    repository,
    verifier,
    endpoint: createAppAttestEndpoint({
      repository,
      verifier,
      env,
      now: options.now,
      randomBytes: options.randomBytes
    }),
    routeAuthorizer: createRouteSessionAuthorizer({ repository, env }),
    intentAuthorizer: createIntentSessionAuthorizer({ repository, env })
  };
}
