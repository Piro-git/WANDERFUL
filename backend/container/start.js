import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOperationalLogger } from "../src/operations/operationalEvents.js";
import { startStandaloneIntentService } from "../src/operations/serviceLifecycle.js";
import { assertStagingContainerEnvironment } from "./stagingAdmission.js";

export async function startStagingContainerProcess(options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? createOperationalLogger(options.loggerOptions);
  assertStagingContainerEnvironment(env, {
    execArgv: options.execArgv ?? process.execArgv
  });
  return await (options.startService ?? startStandaloneIntentService)({
    ...options,
    env,
    logger
  });
}

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const logger = createOperationalLogger();
  startStagingContainerProcess({ logger }).catch(() => {
    logger.error({ event: "service_start_failed", errorCode: "startup_blocked" });
    process.exitCode = 1;
  });
}
