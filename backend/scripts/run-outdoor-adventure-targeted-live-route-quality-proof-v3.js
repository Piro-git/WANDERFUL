import {
  readFile,
  realpath,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  runServerLivePipelineProofV1
} from "../evaluation/outdoorAdventureServerLiveProof/harness.js";
import {
  loadServerLiveProofCasesV1,
  stableSerialize,
  validateDisposableLoopbackDatabaseUrlV1
} from "../evaluation/outdoorAdventureServerLiveProof/manifest.js";
import {
  PostgresOutdoorResearchRepository
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const BASELINE_COMMIT = "81358cb6e022983e4fe698b195893c72eb281ec0";
const PROOF_CLASSIFICATION =
  "targeted_server_side_live_route_quality_proof";
const PROVIDER_CALL_LIMIT = 15;
const CLEANUP_TIMEOUT_MILLISECONDS = 5_000;
const TARGET_CASE_IDS = Object.freeze([
  "case-15-partial-provider-failure-survivor",
  "case-04-harz-brocken-must-have-landmark",
  "case-07-innsbruck-viewpoint-loop",
  "case-08-innsbruck-easy-conservative-loop"
]);
const AUTHORIZATION = Object.freeze({
  liveTraffic:
    "TARGETED_LIVE_ROUTE_QUALITY_PROOF_V3_LIVE_TRAFFIC_AUTHORIZED",
  credentialContainment:
    "SERVER_SIDE_PROVIDER_CREDENTIAL_PROCESS_LOCAL_NOT_RETAINED",
  reviewedFixtureManifest:
    "TARGETED_LIVE_ROUTE_QUALITY_PROOF_V3_4_CASE_MANIFEST_REVIEWED",
  disposableDatabase: "DISPOSABLE_LOOPBACK_POSTGIS_CONFIRMED"
});
const DEFAULT_OFFICIAL_SUMMARY = fileURLToPath(new URL(
  "../../docs/release/OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.summary.json",
  import.meta.url
));
const PROTECTED_HISTORICAL_ARTIFACTS = Object.freeze([
  "OUTDOOR_ADVENTURE_SERVER_SIDE_LIVE_PIPELINE_PROOF_V1.md",
  "OUTDOOR_ADVENTURE_SERVER_SIDE_LIVE_PIPELINE_PROOF_V1.summary.json",
  "OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V2.md",
  "OUTDOOR_ADVENTURE_TARGETED_LIVE_ROUTE_QUALITY_PROOF_V2.summary.json",
  "OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.md",
  "OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.summary.json"
].map((name) => fileURLToPath(
  new URL(`../../docs/release/${name}`, import.meta.url)
)));

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}

async function main() {
  let pool;
  let capturePath;
  let options;
  let summary;
  let failure = null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    options = parseArguments(process.argv.slice(2));
    validateAuthorization(options.authorization);
    await validateTargetedLiveProofV3Paths(options);
    const databaseUrl = boundedEnvironmentValue(
      process.env.TRAILMIND_SERVER_LIVE_PROOF_DATABASE_URL,
      8_192
    );
    validateTargetedLiveProofV3DatabaseUrl(databaseUrl);
    const [acquisitionMetadata, officialSummary] = await Promise.all([
      readJson(options.acquisitionMetadataPath),
      readJson(DEFAULT_OFFICIAL_SUMMARY)
    ]);
    const cases = await loadServerLiveProofCasesV1({
      caseIds: TARGET_CASE_IDS
    });
    pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      connectionTimeoutMillis: 2_000,
      allowExitOnIdle: true,
      application_name: "trailmind_targeted_live_route_quality_proof_v3"
    });
    const repository = new PostgresOutdoorResearchRepository({ pool });
    capturePath = `${options.outputPath}.server-capture`;
    const capture = await runServerLivePipelineProofV1({
      cases,
      pool,
      repository,
      env: process.env,
      usageLedgerPath: options.usageLedgerPath,
      outputPath: capturePath,
      acquisitionMetadata,
      officialSummary,
      finalize: false,
      diagnosticMode: false,
      maximumProposals: 3,
      providerCallLimit: PROVIDER_CALL_LIMIT,
      maximumConcurrency: 1,
      minimumProviderSpacingMilliseconds: 2_000,
      consecutiveImmediateFailureLimit: 2,
      immediateFailureThresholdMilliseconds: 1_000,
      graphHopperAttemptTimeoutMs: 30_000,
      totalDeadlineMs: 45_000,
      validatePublishedSummary: false,
      signal: controller.signal
    });
    summary = buildTargetedLiveProofV3Summary(capture, acquisitionMetadata);
    validateTargetedLiveProofV3Summary(summary);
  } catch (error) {
    failure = error;
  }
  try {
    await cleanupTargetedLiveProofV3Resources({
      pool,
      capturePath,
      timeoutMilliseconds: CLEANUP_TIMEOUT_MILLISECONDS
    });
    pool = null;
    capturePath = null;
  } catch (error) {
    failure = error;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
  if (failure === null) {
    try {
      await atomicWrite(options.outputPath, `${stableSerialize(summary)}\n`);
    } catch (error) {
      failure = error;
    }
  }
  if (failure === null) {
    process.stdout.write(`${stableSerialize({
      proofClassification: summary.proofClassification,
      status: summary.status,
      executedCaseCount: summary.executedCaseCount,
      passedCaseCount: summary.passedCaseCount,
      failedCaseCount: summary.failedCaseCount,
      providerCalls: summary.providerCalls
    })}\n`);
    process.exitCode = summary.status === "failed" ? 1 : 0;
  } else {
    process.stdout.write(`${stableSerialize({
      proofClassification: PROOF_CLASSIFICATION,
      status: "not_run",
      errorCode: safeErrorCode(failure)
    })}\n`);
    process.exitCode = 1;
  }
}

export async function validateTargetedLiveProofV3Paths({
  outputPath,
  usageLedgerPath,
  acquisitionMetadataPath
}) {
  if (
    [outputPath, usageLedgerPath, acquisitionMetadataPath].some((value) =>
      typeof value !== "string" || value.length < 1
    )
  ) {
    throw proofError("invalid_arguments");
  }
  let targets;
  let protectedArtifacts;
  try {
    [targets, protectedArtifacts] = await Promise.all([
      Promise.all([
        outputPath,
        usageLedgerPath,
        acquisitionMetadataPath
      ].map(canonicalTargetPath)),
      Promise.all(PROTECTED_HISTORICAL_ARTIFACTS.map(canonicalTargetPath))
    ]);
  } catch {
    throw proofError("unsafe_output_path");
  }
  if (
    new Set(targets).size !== targets.length ||
    protectedArtifacts.map((path) => path.toLowerCase()).includes(
      targets[0].toLowerCase()
    )
  ) {
    throw proofError("unsafe_output_path");
  }
  return true;
}

export function validateTargetedLiveProofV3DatabaseUrl(value) {
  validateDisposableLoopbackDatabaseUrlV1(value);
  let username;
  try {
    username = decodeURIComponent(new URL(value).username);
  } catch {
    throw proofError("database_not_disposable_loopback");
  }
  if (
    username.length < 1 ||
    !/(test|proof|disposable)/i.test(username) ||
    /(prod|production|postgres)/i.test(username)
  ) {
    throw proofError("database_not_disposable_loopback");
  }
  return true;
}

export async function cleanupTargetedLiveProofV3Resources({
  pool = null,
  capturePath = null,
  timeoutMilliseconds = CLEANUP_TIMEOUT_MILLISECONDS,
  unlinkImpl = unlink
} = {}) {
  if (
    !Number.isInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > 30_000 ||
    typeof unlinkImpl !== "function" ||
    (pool !== null && typeof pool?.end !== "function") ||
    (capturePath !== null && (
      typeof capturePath !== "string" || capturePath.length < 1
    ))
  ) {
    throw proofError("cleanup_failed");
  }
  const operations = [];
  if (pool !== null) {
    operations.push(runBoundedCleanup(
      () => pool.end(),
      timeoutMilliseconds
    ));
  }
  if (capturePath !== null) {
    operations.push(runBoundedCleanup(async () => {
      try {
        await unlinkImpl(capturePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }, timeoutMilliseconds));
  }
  const results = await Promise.allSettled(operations);
  if (results.some((result) => result.status === "rejected")) {
    throw proofError("cleanup_failed");
  }
  return true;
}

export function buildTargetedLiveProofV3Summary(
  capture,
  acquisitionMetadata
) {
  const byId = new Map(capture.cases.map((item) => [item.caseId, item]));
  const cases = TARGET_CASE_IDS.flatMap((caseId) => {
    const receipt = byId.get(caseId);
    return receipt ? [receipt] : [];
  });
  const notRunCaseIds = TARGET_CASE_IDS.filter((caseId) => !byId.has(caseId));
  const failureReasons = [];
  if (cases.some((item) => !item.passed)) failureReasons.push("case_failed");
  if (notRunCaseIds.length > 0) failureReasons.push("targeted_case_not_run");
  if (capture.providerScheduling.stopped) {
    failureReasons.push("repeated_immediate_provider_failure_stop");
  }
  const passedCaseCount = cases.filter((item) => item.passed).length;
  const failedCaseCount = cases.length - passedCaseCount;
  const exactAttempted = capture.providerCalls.exactAttempted;
  return Object.freeze({
    schemaVersion: 1,
    proofClassification: PROOF_CLASSIFICATION,
    baselineCommit: BASELINE_COMMIT,
    status: failureReasons.length === 0 ? "passed" : "failed",
    generatedAt: capture.generatedAt,
    configuredCaseCount: TARGET_CASE_IDS.length,
    executedCaseCount: cases.length,
    passedCaseCount,
    failedCaseCount,
    notRunCaseCount: notRunCaseIds.length,
    notRunCaseIds: Object.freeze(notRunCaseIds),
    providerAuthorization: Object.freeze({
      hardLimit: PROVIDER_CALL_LIMIT,
      scope: "four_reviewed_harz_innsbruck_nonproduction_fixtures",
      expiresAtTaskCompletion: true
    }),
    providerCalls: Object.freeze({
      limit: PROVIDER_CALL_LIMIT,
      exactAttempted,
      successful: capture.providerCalls.successful,
      failed: capture.providerCalls.failed,
      timedOut: capture.providerCalls.timedOut,
      cancelled: capture.providerCalls.cancelled,
      controlledFailureAfterSuccess:
        capture.providerCalls.controlledFailureAfterSuccess,
      unused: PROVIDER_CALL_LIMIT - exactAttempted
    }),
    providerScheduling: capture.providerScheduling,
    evidence: Object.freeze({
      ...capture.evidence,
      acquisition: acquisitionMetadata
    }),
    graphHopper: capture.graphHopper,
    cases: Object.freeze(cases),
    officialCanonical18CaseSummary:
      capture.officialCanonical18CaseSummary,
    featureFlags: capture.featureFlags,
    closedBetaEligible: false,
    physicalIPhoneAppAttestProven: false,
    providerSuperiorityClaim: false,
    limitations: Object.freeze([
      "bounded_targeted_fixture_run_not_provider_superiority_claim",
      "not_physical_iphone_app_attest_proof",
      "not_full_18_case_official_proof",
      "not_production_proof",
      "not_closed_beta_approval",
      "mapped_evidence_not_official_current_safe_open_legal_or_accessible_claim"
    ]),
    failureReasons: Object.freeze(failureReasons)
  });
}

export function validateTargetedLiveProofV3Summary(summary) {
  const counts = summary.providerCalls;
  const outcomes = [
    counts.successful,
    counts.failed,
    counts.timedOut,
    counts.cancelled
  ];
  if (
    summary.proofClassification !== PROOF_CLASSIFICATION ||
    summary.baselineCommit !== BASELINE_COMMIT ||
    summary.configuredCaseCount !== TARGET_CASE_IDS.length ||
    !Array.isArray(summary.cases) ||
    summary.executedCaseCount !== summary.cases.length ||
    summary.passedCaseCount !== summary.cases.filter((item) => item.passed).length ||
    summary.failedCaseCount !== summary.cases.filter((item) => !item.passed).length ||
    summary.passedCaseCount + summary.failedCaseCount !==
      summary.executedCaseCount ||
    summary.notRunCaseCount !== summary.notRunCaseIds.length ||
    summary.executedCaseCount + summary.notRunCaseCount !==
      summary.configuredCaseCount ||
    counts.limit !== PROVIDER_CALL_LIMIT ||
    !Number.isInteger(counts.exactAttempted) ||
    counts.exactAttempted < 0 ||
    counts.exactAttempted > PROVIDER_CALL_LIMIT ||
    outcomes.some((value) => !Number.isInteger(value) || value < 0) ||
    outcomes.reduce((total, value) => total + value, 0) !==
      counts.exactAttempted ||
    !Number.isInteger(counts.controlledFailureAfterSuccess) ||
    counts.controlledFailureAfterSuccess < 0 ||
    counts.controlledFailureAfterSuccess > counts.successful ||
    counts.unused !== PROVIDER_CALL_LIMIT - counts.exactAttempted ||
    (summary.providerScheduling.stopped && summary.status !== "failed") ||
    (
      summary.providerScheduling.stopped &&
      !summary.failureReasons.includes(
        "repeated_immediate_provider_failure_stop"
      )
    ) ||
    summary.closedBetaEligible !== false ||
    summary.physicalIPhoneAppAttestProven !== false ||
    summary.providerSuperiorityClaim !== false ||
    summary.featureFlags.some((flag) => flag.enabled !== false) ||
    summary.officialCanonical18CaseSummary.status !== "not_run" ||
    summary.officialCanonical18CaseSummary.caseCount !== 18 ||
    summary.officialCanonical18CaseSummary.executedCaseCount !== 0 ||
    summary.officialCanonical18CaseSummary.providerCallCount !== 0
  ) {
    throw proofError("invalid_targeted_summary");
  }
  assertNoSensitiveValue(summary);
}

function assertNoSensitiveValue(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveValue(item);
    return;
  }
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      (
        /postgres(?:ql)?:\/\//i.test(value) ||
        /[?&]key=/i.test(value) ||
        /https?:\/\/[^\s]*graphhopper\.com/i.test(value) ||
        /(?:^|\s)\/(?:private\/)?tmp\//i.test(value) ||
        /\/(?:private\/)?var\/folders\//i.test(value)
      )
    ) {
      throw proofError("invalid_targeted_summary");
    }
    return;
  }
  const forbiddenKeys = new Set([
    "geometry", "coordinate", "coordinates", "latitude", "longitude",
    "requesturl", "providerurl", "providerbaseurl", "rawresponse",
    "providerresponse", "rawprompt", "prompt", "headers", "rawheaders",
    "apikey", "databaseurl", "password", "appattestmaterial",
    "appattestassertion", "authorizationheader", "credential", "credentials",
    "secret", "token"
  ]);
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if ([...forbiddenKeys].some((forbidden) =>
      normalized === forbidden || normalized.endsWith(forbidden)
    )) {
      throw proofError("invalid_targeted_summary");
    }
    assertNoSensitiveValue(child);
  }
}

function parseArguments(args) {
  const options = {
    outputPath: null,
    usageLedgerPath: null,
    acquisitionMetadataPath: null,
    authorization: {
      liveTraffic: null,
      credentialContainment: null,
      providerCallBudget: null,
      reviewedFixtureManifest: null,
      disposableDatabase: null
    }
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--output" && value) {
      options.outputPath = resolve(value);
      index += 1;
    } else if (argument === "--usage-ledger" && value) {
      options.usageLedgerPath = resolve(value);
      index += 1;
    } else if (argument === "--acquisition-metadata" && value) {
      options.acquisitionMetadataPath = resolve(value);
      index += 1;
    } else if (argument === "--live-authorization" && value) {
      options.authorization.liveTraffic = value;
      index += 1;
    } else if (argument === "--credential-containment-ack" && value) {
      options.authorization.credentialContainment = value;
      index += 1;
    } else if (argument === "--provider-call-budget" && value) {
      options.authorization.providerCallBudget = Number(value);
      index += 1;
    } else if (argument === "--reviewed-fixture-manifest" && value) {
      options.authorization.reviewedFixtureManifest = value;
      index += 1;
    } else if (argument === "--disposable-database-ack" && value) {
      options.authorization.disposableDatabase = value;
      index += 1;
    } else {
      throw proofError("invalid_arguments");
    }
  }
  if (
    options.outputPath === null ||
    options.usageLedgerPath === null ||
    options.acquisitionMetadataPath === null
  ) {
    throw proofError("invalid_arguments");
  }
  return options;
}

function validateAuthorization(input) {
  if (
    input.liveTraffic !== AUTHORIZATION.liveTraffic ||
    input.credentialContainment !== AUTHORIZATION.credentialContainment ||
    input.providerCallBudget !== PROVIDER_CALL_LIMIT ||
    input.reviewedFixtureManifest !== AUTHORIZATION.reviewedFixtureManifest ||
    input.disposableDatabase !== AUTHORIZATION.disposableDatabase
  ) {
    throw proofError("live_authorization_missing");
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw proofError("input_record_unavailable");
  }
}

function boundedEnvironmentValue(value, maximumLength) {
  return typeof value === "string" && value.length <= maximumLength
    ? value
    : "";
}

function safeErrorCode(error) {
  const allowed = new Set([
    "cancelled", "cleanup_failed", "database_configuration_missing",
    "database_not_disposable_loopback", "input_record_unavailable",
    "invalid_arguments", "invalid_targeted_summary",
    "invalid_usage_ledger", "live_authorization_missing",
    "non_official_provider_base_url", "provider_call_limit_reached",
    "summary_write_failed", "unsafe_output_path"
  ]);
  return allowed.has(error?.code) ? error.code : "proof_execution_failed";
}

function proofError(code) {
  return Object.assign(new Error(code), { code });
}

async function canonicalTargetPath(path) {
  const parent = await realpath(dirname(path));
  return resolve(parent, basename(path));
}

function runBoundedCleanup(operation, timeoutMilliseconds) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(proofError("cleanup_failed")),
      timeoutMilliseconds
    );
  });
  return Promise.race([
    Promise.resolve().then(operation),
    timeoutPromise
  ]).finally(() => clearTimeout(timeout));
}

async function atomicWrite(path, contents) {
  const temporaryPath = `${path}.pending-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw proofError("summary_write_failed", { cause: error });
  }
}
