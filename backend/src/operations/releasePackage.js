import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLASSIFICATIONS = new Set([
  "proved_by_current_automated_test",
  "verified_from_current_source",
  "locally_actionable",
  "requires_disposable_postgis",
  "requires_staging_or_deployment",
  "requires_physical_iphone_app_attest",
  "requires_provider_authorization",
  "requires_owner_or_cloud_decision",
  "blocked_or_not_applicable",
  "historical_evidence_only"
]);
const REQUIREMENT_STATES = new Set(["absent", "partial", "verified"]);
const GATE_STATUS = Object.freeze({
  absent: "blocked",
  partial: "partial",
  verified: "verified"
});
const PACKAGE_DIRECTORY = "docs/operations/closed-beta-readiness-v1";

export class ReleasePackageValidationError extends Error {
  constructor(code) {
    super("Closed-beta release package validation failed.");
    this.name = "ReleasePackageValidationError";
    this.code = code;
  }
}

export function validateReleasePackage(input, options = {}) {
  const { checklist, matrix, manifest } = input ?? {};
  object(checklist, "invalid_checklist");
  object(matrix, "invalid_feature_matrix");
  object(manifest, "invalid_evidence_manifest");
  if (checklist.currentDecision !== "NO_GO") invalid("false_green_decision");
  if (matrix.currentDecision !== "NO_GO") invalid("false_green_feature_matrix");
  if (manifest.currentDecision !== "NO_GO") invalid("false_green_manifest");
  if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit ?? "")) {
    invalid("invalid_source_commit");
  }
  if (options.isSourceCommit && !options.isSourceCommit(manifest.sourceCommit)) {
    invalid("unbound_source_commit");
  }
  if (
    checklist.sourceCommit !== manifest.sourceCommit ||
    matrix.sourceCommit !== manifest.sourceCommit
  ) {
    invalid("unreconciled_source_commit");
  }

  const requirements = checklist.domains?.flatMap((domain) => domain.requirements ?? []);
  if (!Array.isArray(requirements) || requirements.length === 0) {
    invalid("missing_requirements");
  }
  const requirementIds = uniqueIds(requirements, "invalid_requirement_ids");
  for (const requirement of requirements) {
    if (!REQUIREMENT_STATES.has(requirement.currentState)) {
      invalid("invalid_requirement_state");
    }
    if (
      typeof requirement.ownerRole !== "string" ||
      requirement.ownerRole.length < 3 ||
      typeof requirement.blocker !== "string" ||
      requirement.blocker.length < 3 ||
      !Array.isArray(requirement.evidenceReferences) ||
      (requirement.currentState === "verified" && requirement.evidenceReferences.length === 0)
    ) {
      invalid("invalid_requirement_evidence");
    }
    for (const path of requirement.evidenceReferences) {
      if (!safeRepositoryPath(path)) invalid("unsafe_evidence_path");
      if (requirement.currentState === "verified") {
        validateSourcePath(path, manifest.sourceCommit, options);
      }
    }
  }
  const unresolved = requirements
    .filter((requirement) => requirement.mandatory && requirement.currentState !== "verified")
    .map((requirement) => requirement.id)
    .sort();
  if (!sameStrings(checklist.currentDecisionReasons, unresolved)) {
    invalid("unreconciled_decision_reasons");
  }

  const gates = manifest.gates;
  if (!Array.isArray(gates) || uniqueIds(gates, "invalid_manifest_gate_ids").size !== requirementIds.size) {
    invalid("incomplete_manifest_gate_coverage");
  }
  for (const gate of gates) {
    const requirement = requirements.find((candidate) => candidate.id === gate.id);
    if (!requirement || gate.status !== GATE_STATUS[requirement.currentState]) {
      invalid("manifest_gate_status_mismatch");
    }
    if (
      !Array.isArray(gate.classifications) ||
      gate.classifications.length === 0 ||
      gate.classifications.some((value) => !CLASSIFICATIONS.has(value))
    ) {
      invalid("invalid_gate_classification");
    }
    if (
      !Array.isArray(gate.sourceEvidence) ||
      (requirement.currentState === "verified" && gate.sourceEvidence.length === 0)
    ) {
      invalid("invalid_gate_source_evidence");
    }
    for (const path of gate.sourceEvidence) validateSourcePath(path, manifest.sourceCommit, options);
  }

  const featureBlockers = (matrix.releaseBlockers ?? []).map((item) => item.id).sort();
  if (!sameStrings(manifest.featureFlagBlockerIds, featureBlockers)) {
    invalid("unreconciled_feature_blockers");
  }
  validateMatrix(matrix);

  const packageFiles = options.packageFiles;
  if (
    !Array.isArray(manifest.packageFiles) ||
    manifest.packageFiles.some((name) =>
      typeof name !== "string" || name.includes("/") || name.includes("\\") || name.length > 255
    )
  ) {
    invalid("unsafe_package_inventory");
  }
  if (packageFiles && !sameStrings(manifest.packageFiles, packageFiles)) {
    invalid("package_inventory_mismatch");
  }
  for (const path of allEvidenceReferences(requirements)) {
    if (options.pathExists && !options.pathExists(path)) invalid("missing_evidence_path");
  }
  return Object.freeze({
    schemaVersion: 1,
    decision: "valid",
    currentDecision: "NO_GO",
    gateCount: requirements.length,
    unresolvedGateCount: unresolved.length
  });
}

export function validateReleasePackageFromDisk(options = {}) {
  const repoRoot = options.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const packageRoot = resolve(repoRoot, PACKAGE_DIRECTORY);
  const read = (name) => JSON.parse(readFileSync(resolve(packageRoot, name), "utf8"));
  const packageFiles = readdirSync(packageRoot).sort();
  const sourceCommit = read("SOURCE_EVIDENCE_MANIFEST_V1.json").sourceCommit;
  return validateReleasePackage({
    checklist: read("go-no-go-checklist-v1.json"),
    matrix: read("feature-flag-state-matrix-v1.json"),
    manifest: read("SOURCE_EVIDENCE_MANIFEST_V1.json")
  }, {
    packageFiles,
    pathExists(path) {
      return existsSync(resolve(repoRoot, path));
    },
    isSourceCommit(commit) {
      return gitSucceeds(repoRoot, ["cat-file", "-e", `${commit}^{commit}`]) &&
        gitSucceeds(repoRoot, ["merge-base", "--is-ancestor", commit, "HEAD"]);
    },
    sourcePathExists(commit, path) {
      return gitSucceeds(repoRoot, ["cat-file", "-e", `${commit}:${path}`]);
    }
  });
}

function validateMatrix(matrix) {
  const flags = matrix.flags ?? [];
  const flagIds = uniqueIds(flags, "invalid_feature_flag_ids");
  if (flags.length === 0) invalid("missing_feature_flags");
  for (const flag of flags) {
    if (flag.surface !== "backend") continue;
    if (
      !Array.isArray(flag.currentAcceptedTrueValues) ||
      flag.currentAcceptedTrueValues.length === 0 ||
      flag.currentAcceptedTrueValues.some((value) => !["true", "yes", "1"].includes(value)) ||
      flag.missingOrMalformedEffectiveValue !== false
    ) {
      invalid("unsafe_feature_flag_contract");
    }
  }
  const states = matrix.states ?? [];
  const stateIds = uniqueIds(states, "invalid_feature_state_ids");
  if (!stateIds.has(matrix.currentClassification)) invalid("invalid_current_feature_state");
  for (const state of states) {
    if (
      !state.flags ||
      !sameStrings(Object.keys(state.flags), [...flagIds]) ||
      Object.values(state.flags).some((value) => typeof value !== "boolean")
    ) {
      invalid("incomplete_feature_state");
    }
    const insecureEnabled = Object.entries(state.flags ?? {}).some(
      ([id, value]) => id.includes("insecure") || id.includes("in_memory")
        ? value !== false
        : false
    );
    if (insecureEnabled) invalid("unsafe_release_state");
  }
  const blockers = matrix.releaseBlockers ?? [];
  uniqueIds(blockers, "invalid_feature_blocker_ids");
  if (
    blockers.length === 0 ||
    blockers.some((blocker) =>
      blocker.status !== "open" ||
      typeof blocker.requiredResolution !== "string" ||
      blocker.requiredResolution.length < 3
    )
  ) {
    invalid("invalid_feature_blockers");
  }
}

function validateSourcePath(path, sourceCommit, options) {
  if (!safeRepositoryPath(path)) invalid("unsafe_source_path");
  if (options.sourcePathExists && !options.sourcePathExists(sourceCommit, path)) {
    invalid("source_evidence_not_at_commit");
  }
}

function allEvidenceReferences(requirements) {
  return [...new Set(requirements.flatMap((item) => item.evidenceReferences))];
}

function uniqueIds(items, code) {
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9_-]{2,127}$/.test(item.id)) {
      invalid(code);
    }
    if (ids.has(item.id)) invalid(code);
    ids.add(item.id);
  }
  return ids;
}

function sameStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function safeRepositoryPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !value.startsWith("/") && !value.includes("..") && !value.includes("\\") &&
    value !== "backend/.env" && !value.endsWith("/Local.xcconfig");
}

function gitSucceeds(cwd, arguments_) {
  try {
    execFileSync("git", arguments_, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5_000
    });
    return true;
  } catch {
    return false;
  }
}

function object(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(code);
}

function invalid(code) {
  throw new ReleasePackageValidationError(code);
}
