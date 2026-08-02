import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  PostgresOutdoorResearchRepository
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  runServerLivePipelineProofV1
} from "../evaluation/outdoorAdventureServerLiveProof/harness.js";
import {
  loadServerLiveProofCasesV1,
  SERVER_LIVE_PROOF_CASE_IDS,
  stableSerialize,
  validateDisposableLoopbackDatabaseUrlV1,
  validateServerLiveProofAuthorizationV1
} from "../evaluation/outdoorAdventureServerLiveProof/manifest.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_OFFICIAL_SUMMARY = fileURLToPath(new URL(
  "../../docs/release/OUTDOOR_ADVENTURE_END_TO_END_STAGING_PROOF_V1.summary.json",
  import.meta.url
));

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}

async function main() {
  let pool;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const options = parseArguments(process.argv.slice(2));
    validateServerLiveProofAuthorizationV1(options.authorization);
    const databaseUrl = boundedEnvironmentValue(
      process.env.TRAILMIND_SERVER_LIVE_PROOF_DATABASE_URL,
      8_192
    );
    validateDisposableLoopbackDatabaseUrlV1(databaseUrl);
    const [acquisitionMetadata, officialSummary, priorSummary] =
      await Promise.all([
        readJson(options.acquisitionMetadataPath),
        readJson(DEFAULT_OFFICIAL_SUMMARY),
        options.priorSummaryPath === null
          ? Promise.resolve(null)
          : readJson(options.priorSummaryPath)
      ]);
    const caseIds = options.caseIds.length === 0
      ? SERVER_LIVE_PROOF_CASE_IDS.filter((caseId) =>
        !priorSummary?.cases?.some((item) => item.caseId === caseId)
      )
      : options.caseIds;
    const cases = await loadServerLiveProofCasesV1({ caseIds });
    pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      connectionTimeoutMillis: 2_000,
      allowExitOnIdle: true,
      application_name: "trailmind_server_live_proof_v1"
    });
    const repository = new PostgresOutdoorResearchRepository({ pool });
    const summary = await runServerLivePipelineProofV1({
      cases,
      pool,
      repository,
      env: process.env,
      usageLedgerPath: options.usageLedgerPath,
      outputPath: options.outputPath,
      acquisitionMetadata,
      officialSummary,
      priorSummary,
      finalize: options.finalize,
      diagnosticMode: options.diagnosticMode,
      maximumProposals: options.maximumProposals,
      signal: controller.signal
    });
    process.stdout.write(`${stableSerialize({
      proofClassification: summary.proofClassification,
      status: summary.status,
      executedCaseCount: summary.executedCaseCount,
      passedCaseCount: summary.passedCaseCount,
      failedCaseCount: summary.failedCaseCount,
      providerCalls: summary.providerCalls
    })}\n`);
    process.exitCode = summary.status === "failed" ? 1 : 0;
  } catch (error) {
    process.stdout.write(`${stableSerialize({
      proofClassification: "server_side_live_pipeline_proof",
      status: "not_run",
      errorCode: safeErrorCode(error)
    })}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
    await pool?.end().catch(() => {});
  }
}

function parseArguments(args) {
  const options = {
    caseIds: [],
    priorSummaryPath: null,
    finalize: false,
    outputPath: null,
    usageLedgerPath: null,
    acquisitionMetadataPath: null,
    maximumProposals: 3,
    diagnosticMode: false,
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
    if (argument === "--case" && value) {
      options.caseIds.push(value);
      index += 1;
    } else if (argument === "--prior-summary" && value) {
      options.priorSummaryPath = resolve(value);
      index += 1;
    } else if (argument === "--output" && value) {
      options.outputPath = resolve(value);
      index += 1;
    } else if (argument === "--usage-ledger" && value) {
      options.usageLedgerPath = resolve(value);
      index += 1;
    } else if (argument === "--acquisition-metadata" && value) {
      options.acquisitionMetadataPath = resolve(value);
      index += 1;
    } else if (argument === "--finalize") {
      options.finalize = true;
    } else if (argument === "--maximum-proposals" && value) {
      options.maximumProposals = Number(value);
      index += 1;
    } else if (argument === "--diagnostic") {
      options.diagnosticMode = true;
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
    options.acquisitionMetadataPath === null ||
    new Set(options.caseIds).size !== options.caseIds.length ||
    !Number.isInteger(options.maximumProposals) ||
    options.maximumProposals < 1 ||
    options.maximumProposals > 3 ||
    (
      options.diagnosticMode &&
      (
        options.priorSummaryPath !== null ||
        options.maximumProposals !== 1 ||
        options.caseIds.length !== 1 ||
        options.caseIds[0] !== "case-07-innsbruck-viewpoint-loop"
      )
    )
  ) {
    throw proofError("invalid_arguments");
  }
  return options;
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
    "active_region_projection_missing",
    "cancelled",
    "database_not_disposable_loopback",
    "database_configuration_missing",
    "duplicate_case_execution",
    "evidence_inspection_failed",
    "fixture_invalid",
    "fixture_unavailable",
    "input_record_unavailable",
    "invalid_arguments",
    "invalid_case_selection",
    "invalid_prior_summary",
    "invalid_run_dependencies",
    "invalid_usage_ledger",
    "invalid_usage_ledger_transition",
    "live_authorization_missing",
    "non_official_provider_base_url",
    "provider_call_limit_reached",
    "summary_write_failed"
  ]);
  return allowed.has(error?.code) ? error.code : "proof_execution_failed";
}

function proofError(code) {
  return Object.assign(new Error(code), { code });
}
