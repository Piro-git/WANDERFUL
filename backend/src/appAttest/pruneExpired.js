import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appAttestError } from "./appAttestErrors.js";
import { postgresAppAttestRepositoryFromEnvironment } from "./postgresAppAttestRepository.js";

const COUNT_KEYS = [
  "challenges",
  "routeSessions",
  "rateWindows",
  "providerLeases"
];

export async function runAppAttestPrune(options = {}) {
  const env = options.env ?? process.env;
  const write = options.write ?? process.stdout.write.bind(process.stdout);
  if (
    env.NODE_ENV === "production" &&
    (typeof env.APP_ATTEST_DATABASE_URL !== "string" ||
      env.APP_ATTEST_DATABASE_URL.length === 0)
  ) {
    throw appAttestError("authorization_unavailable");
  }
  const repository = options.repository ?? postgresAppAttestRepositoryFromEnvironment(
    env,
    options.pool ? { pool: options.pool } : {}
  );
  const ownsRepository = options.repository === undefined;
  if (!repository) throw appAttestError("authorization_unavailable");

  let counts;
  try {
    counts = validatedCounts(await repository.pruneExpired());
  } finally {
    if (ownsRepository) {
      await closeRepositoryPools(repository);
    }
  }
  write(
    `App Attest prune complete: challenges=${counts.challenges} ` +
    `routeSessions=${counts.routeSessions} rateWindows=${counts.rateWindows} ` +
    `providerLeases=${counts.providerLeases}\n`
  );
  return counts;
}

async function closeRepositoryPools(repository) {
  const pools = [...new Set([
    repository.pool,
    repository.cancellationPool
  ].filter((pool) => typeof pool?.end === "function"))];
  const results = await Promise.allSettled(pools.map((pool) => pool.end()));
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

function validatedCounts(counts) {
  if (!counts || COUNT_KEYS.some((key) => !Number.isInteger(counts[key]) || counts[key] < 0)) {
    throw appAttestError("authorization_unavailable");
  }
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, counts[key]]));
}

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runAppAttestPrune().catch(() => {
    process.stderr.write("App Attest prune failed.\n");
    process.exitCode = 1;
  });
}
