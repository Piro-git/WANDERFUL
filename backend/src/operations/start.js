import { createOperationalLogger } from "./operationalEvents.js";
import { startStandaloneIntentService } from "./serviceLifecycle.js";

const logger = createOperationalLogger();

startStandaloneIntentService({ logger }).catch(() => {
  logger.error({
    event: "service_start_failed",
    errorCode: "startup_blocked"
  });
  process.exitCode = 1;
});
