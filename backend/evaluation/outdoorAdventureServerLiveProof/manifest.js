import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  outdoorAdventureStagingProofCanonicalIntentV1
} from "../outdoorAdventureStagingProof/operationalBackendCapture.js";

export const SERVER_LIVE_PROOF_CLASSIFICATION =
  "server_side_live_pipeline_proof";
export const SERVER_LIVE_PROOF_SCHEMA_VERSION = 1;
export const SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT = 25;
export const SERVER_LIVE_PROOF_AUTHORIZATION_V1 = Object.freeze({
  liveTraffic:
    "SERVER_SIDE_LIVE_PIPELINE_PROOF_V1_LIVE_TRAFFIC_AUTHORIZED",
  credentialContainment:
    "SERVER_SIDE_PROVIDER_CREDENTIAL_PROCESS_LOCAL_NOT_RETAINED",
  reviewedFixtureManifest:
    "SERVER_SIDE_LIVE_PROOF_8_CASE_MANIFEST_V1_REVIEWED",
  disposableDatabase:
    "DISPOSABLE_LOOPBACK_POSTGIS_CONFIRMED"
});
export const SERVER_LIVE_PROOF_FEATURE_FLAGS = Object.freeze([
  "OUTDOOR_RESEARCH_PLANNING_ENABLED",
  "OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL",
  "OUTDOOR_EVIDENCE_PROVIDER_ENABLED",
  "ROUTE_ALLOW_INSECURE_LOCAL_ROUTING",
  "INTENT_ALLOW_INSECURE_LOCAL_PARSING",
  "APP_ATTEST_ALLOW_IN_MEMORY"
]);
export const SERVER_LIVE_PROOF_CASE_IDS = Object.freeze([
  "case-01-harz-ilsenburg-loop-viewpoints-forest",
  "case-02-harz-schierke-easy-loop-paths-avoid-roads",
  "case-03-harz-trail-running-loop",
  "case-04-harz-brocken-must-have-landmark",
  "case-05-harz-unsatisfied-must-have-highlight",
  "case-07-innsbruck-viewpoint-loop",
  "case-08-innsbruck-easy-conservative-loop",
  "case-15-partial-provider-failure-survivor"
]);
const SERVER_LIVE_PROOF_INNSBRUCK_CASE_IDS = new Set([
  "case-07-innsbruck-viewpoint-loop",
  "case-08-innsbruck-easy-conservative-loop"
]);
const SERVER_LIVE_PROOF_ANCHOR_FIXTURE_IDS = new Set([
  "harz-brocken",
  "harz-ilsenburg",
  "harz-schierke",
  "innsbruck-hungerburg"
]);

const DEFAULT_FIXTURE_PATH = fileURLToPath(new URL(
  "../outdoorAdventureStagingProof/fixtures/mandatoryCasesV1.json",
  import.meta.url
));
export async function loadServerLiveProofCasesV1({
  fixturePath = DEFAULT_FIXTURE_PATH,
  caseIds = SERVER_LIVE_PROOF_CASE_IDS
} = {}) {
  const requested = validateCaseIds(caseIds);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(fixturePath, "utf8"));
  } catch {
    throw proofError("fixture_unavailable");
  }
  if (!parsed || !Array.isArray(parsed.cases)) {
    throw proofError("fixture_invalid");
  }
  const byId = new Map(parsed.cases.map((item) => [item?.id, item]));
  const cases = requested.map((caseId) => {
    const value = byId.get(caseId);
    validateCase(value, caseId);
    return Object.freeze({
      id: caseId,
      input: structuredClone(value.input)
    });
  });
  return Object.freeze(cases);
}

export function serverLiveProofCanonicalIntentV1(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw proofError("fixture_invalid");
  }
  if (
    !SERVER_LIVE_PROOF_ANCHOR_FIXTURE_IDS.has(input.anchorFixture) ||
    input.flow !== "research_guided" ||
    input.routeType !== "loop" ||
    input.destinationFixture !== null ||
    !Array.isArray(input.mustHaveExperiences) ||
    !Array.isArray(input.preferredExperiences) ||
    !Array.isArray(input.avoidedExperiences)
  ) {
    throw proofError("fixture_invalid");
  }
  try {
    return outdoorAdventureStagingProofCanonicalIntentV1(input, {
      includeReviewedRegionId: true
    });
  } catch {
    throw proofError("fixture_invalid");
  }
}

export function serverLiveProofRegionForCaseIdV1(caseId) {
  if (!SERVER_LIVE_PROOF_CASE_IDS.includes(caseId)) {
    throw proofError("invalid_case_selection");
  }
  return SERVER_LIVE_PROOF_INNSBRUCK_CASE_IDS.has(caseId)
    ? "innsbruck-alps-v1"
    : "harz-v1";
}

export function safeProofDigestV1(value, prefix = "proof") {
  return `${prefix}_${createHash("sha256")
    .update(stableSerialize(value))
    .digest("hex")
    .slice(0, 24)}`;
}

export function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateServerLiveProofAuthorizationV1(input) {
  if (
    !input ||
    input.liveTraffic !== SERVER_LIVE_PROOF_AUTHORIZATION_V1.liveTraffic ||
    input.credentialContainment !==
      SERVER_LIVE_PROOF_AUTHORIZATION_V1.credentialContainment ||
    input.reviewedFixtureManifest !==
      SERVER_LIVE_PROOF_AUTHORIZATION_V1.reviewedFixtureManifest ||
    input.disposableDatabase !==
      SERVER_LIVE_PROOF_AUTHORIZATION_V1.disposableDatabase ||
    input.providerCallBudget !== SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT
  ) {
    throw proofError("live_authorization_missing");
  }
  return true;
}

export function validateDisposableLoopbackDatabaseUrlV1(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192) {
    throw proofError("database_configuration_missing");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw proofError("database_configuration_missing");
  }
  const hostname = parsed.hostname.toLowerCase();
  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw proofError("database_configuration_missing");
  }
  if (
    parsed.protocol !== "postgresql:" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname) ||
    databaseName.length < 1 ||
    !/(test|proof|disposable)/i.test(databaseName) ||
    /(prod|production)/i.test(databaseName) ||
    parsed.hash
  ) {
    throw proofError("database_not_disposable_loopback");
  }
  return true;
}

export function validateServerLiveProofPublishedSummaryV1(summary) {
  if (
    !summary ||
    summary.schemaVersion !== SERVER_LIVE_PROOF_SCHEMA_VERSION ||
    summary.proofClassification !== SERVER_LIVE_PROOF_CLASSIFICATION ||
    !["in_progress", "failed", "passed"].includes(summary.status) ||
    summary.configuredCaseCount !== SERVER_LIVE_PROOF_CASE_IDS.length ||
    !Array.isArray(summary.cases) ||
    !Array.isArray(summary.notRunCaseIds) ||
    !Array.isArray(summary.limitations) ||
    !Array.isArray(summary.failureReasons) ||
    summary.closedBetaEligible !== false ||
    summary.physicalIPhoneAppAttestProven !== false
  ) {
    throw proofError("invalid_published_summary");
  }
  const caseIds = summary.cases.map((item) => item?.caseId);
  if (
    new Set(caseIds).size !== caseIds.length ||
    caseIds.some((caseId) => !SERVER_LIVE_PROOF_CASE_IDS.includes(caseId)) ||
    summary.executedCaseCount !== summary.cases.length ||
    summary.passedCaseCount !== summary.cases.filter((item) =>
      item?.passed === true
    ).length ||
    summary.failedCaseCount !== summary.cases.filter((item) =>
      item?.passed === false
    ).length ||
    summary.passedCaseCount + summary.failedCaseCount !==
      summary.executedCaseCount
  ) {
    throw proofError("invalid_published_summary");
  }
  const expectedNotRun = SERVER_LIVE_PROOF_CASE_IDS.filter((caseId) =>
    !caseIds.includes(caseId)
  );
  if (
    summary.notRunCaseCount !== expectedNotRun.length ||
    JSON.stringify(summary.notRunCaseIds) !== JSON.stringify(expectedNotRun)
  ) {
    throw proofError("invalid_published_summary");
  }
  for (const receipt of summary.cases) validatePublishedCaseReceipt(receipt);
  validateProviderCounts(summary.providerCalls);
  if (
    summary.status === "passed" &&
    (
      summary.executedCaseCount !== SERVER_LIVE_PROOF_CASE_IDS.length ||
      summary.passedCaseCount !== SERVER_LIVE_PROOF_CASE_IDS.length ||
      summary.failedCaseCount !== 0 ||
      summary.notRunCaseCount !== 0 ||
      summary.failureReasons.length !== 0 ||
      !["harz-v1", "innsbruck-alps-v1"].every((region) =>
        summary.cases.some((receipt) =>
          receipt.region === region &&
          receipt.passed === true &&
          receipt.routeQuality.selectedCount > 0
        )
      )
    )
  ) {
    throw proofError("invalid_published_summary");
  }
  if (
    summary.officialCanonical18CaseSummary?.status !== "not_run" ||
    summary.officialCanonical18CaseSummary?.caseCount !== 18 ||
    summary.officialCanonical18CaseSummary?.executedCaseCount !== 0 ||
    summary.officialCanonical18CaseSummary?.providerCallCount !== 0 ||
    !Array.isArray(summary.featureFlags) ||
    summary.featureFlags.length !== SERVER_LIVE_PROOF_FEATURE_FLAGS.length ||
    summary.featureFlags.some((flag, index) =>
      flag?.name !== SERVER_LIVE_PROOF_FEATURE_FLAGS[index] ||
      flag?.enabled !== false
    )
  ) {
    throw proofError("invalid_published_summary");
  }
  assertNoSensitiveSummaryValue(summary);
  return summary;
}

function validatePublishedCaseReceipt(receipt) {
  if (
    !receipt ||
    receipt.executed !== true ||
    receipt.region !== serverLiveProofRegionForCaseIdV1(receipt.caseId) ||
    typeof receipt.passed !== "boolean" ||
    !Number.isInteger(receipt.providerCallCount) ||
    receipt.providerCallCount < 0 ||
    !receipt.pipeline ||
    !receipt.routeQuality ||
    !Array.isArray(receipt.limitations) ||
    !Array.isArray(receipt.failureReasons)
  ) {
    throw proofError("invalid_published_summary");
  }
  validateProviderCounts({
    limit: SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT,
    exactAttempted: receipt.providerCallCount,
    ...receipt.providerOutcomes
  });
  const routes = receipt.routeQuality.routes;
  if (
    !Array.isArray(routes) ||
    receipt.routeQuality.routeCount !== routes.length ||
    receipt.routeQuality.eligibleCount !== routes.filter((route) =>
      route?.eligible === true
    ).length ||
    receipt.routeQuality.selectedCount !== routes.filter((route) =>
      route?.selected === true
    ).length ||
    receipt.routeQuality.rejectionCount !== routes.filter((route) =>
      route?.eligible === false
    ).length ||
    routes.some((route) => route?.selected === true && route?.eligible !== true)
  ) {
    throw proofError("invalid_published_summary");
  }
}

function validateProviderCounts(counts) {
  const values = [
    counts?.successful,
    counts?.failed,
    counts?.timedOut,
    counts?.cancelled
  ];
  if (
    counts?.limit !== SERVER_LIVE_PROOF_PROVIDER_CALL_LIMIT ||
    !Number.isInteger(counts?.exactAttempted) ||
    counts.exactAttempted < 0 ||
    counts.exactAttempted > counts.limit ||
    values.some((value) => !Number.isInteger(value) || value < 0) ||
    values.reduce((total, value) => total + value, 0) !==
      counts.exactAttempted ||
    (
      counts.controlledFailureAfterSuccess !== undefined &&
      (
        !Number.isInteger(counts.controlledFailureAfterSuccess) ||
        counts.controlledFailureAfterSuccess < 0 ||
        counts.controlledFailureAfterSuccess > counts.successful
      )
    )
  ) {
    throw proofError("invalid_published_summary");
  }
}

function assertNoSensitiveSummaryValue(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveSummaryValue(item);
    return;
  }
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      (/postgres(?:ql)?:\/\//i.test(value) || /[?&]key=/i.test(value))
    ) {
      throw proofError("invalid_published_summary");
    }
    return;
  }
  const forbiddenKeys = new Set([
    "geometry",
    "coordinate",
    "coordinates",
    "latitude",
    "longitude",
    "requesturl",
    "rawresponse",
    "apikey",
    "databaseurl",
    "password",
    "appattestassertion",
    "authorization",
    "authorizationheader",
    "credential",
    "credentials",
    "secret",
    "token"
  ]);
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if ([...forbiddenKeys].some((forbidden) =>
      normalizedKey === forbidden || normalizedKey.endsWith(forbidden)
    )) {
      throw proofError("invalid_published_summary");
    }
    assertNoSensitiveSummaryValue(child);
  }
}

function validateCaseIds(input) {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > SERVER_LIVE_PROOF_CASE_IDS.length ||
    new Set(input).size !== input.length ||
    input.some((item) => !SERVER_LIVE_PROOF_CASE_IDS.includes(item))
  ) {
    throw proofError("invalid_case_selection");
  }
  return [...input];
}

function validateCase(value, expectedId) {
  if (
    !value ||
    value.id !== expectedId ||
    !value.input ||
    value.input.schemaVersion !== 1 ||
    !Array.isArray(value.input.executionModifiers) ||
    value.input.executionModifiers.some((modifier) =>
      !["normal", "one_provider_failure_with_survivor"].includes(modifier)
    )
  ) {
    throw proofError("fixture_invalid");
  }
  serverLiveProofCanonicalIntentV1(value.input);
}

function proofError(code) {
  return Object.assign(new Error(code), { code });
}
