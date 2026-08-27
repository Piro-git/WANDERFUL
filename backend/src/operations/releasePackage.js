import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const APPLE_PACKAGE_DIRECTORY = "docs/release/app-store-v1";
const CLOSED_BETA_SOURCE_COMMIT = "52849b4c75cd6e5ddf00473adf8a3265160d750d";
const APPLE_SOURCE_BASELINE = "009c5aa52f7feb386335c7aeb0c2f1e85ec7a7fd";
const CLOSED_BETA_SOURCE_BASELINE_DOCUMENTS = Object.freeze([
  "CLOSED_BETA_ROLLOUT_V1.md",
  "OBSERVABILITY_AND_PRIVACY_V1.md",
  "PHYSICAL_IPHONE_APP_ATTEST_PROOF_V1.md",
  "README.md",
  "ROLLBACK_AND_INCIDENT_RESPONSE_V1.md",
  "STAGING_PROVISIONING_RUNBOOK_V1.md",
  "V4_OPERATIONAL_PROTOCOL.md"
]);
const APPLE_GATE_IDS = Object.freeze(Array.from(
  { length: 50 },
  (_, index) => `G-${String(index + 1).padStart(3, "0")}`
));
const APPLE_GATE_CLASSIFICATIONS = new Set([
  "proved",
  "locally actionable",
  "onboarding-dependent",
  "physical-device",
  "Apple-account",
  "public-URL/legal",
  "blocked"
]);
const APPLE_PROVED_GATE_IDS = Object.freeze([
  "G-001", "G-002", "G-003", "G-004", "G-006", "G-007", "G-011", "G-014",
  "G-016", "G-017", "G-022", "G-023", "G-025", "G-027", "G-028", "G-036",
  "G-037", "G-038", "G-039", "G-040", "G-041", "G-042", "G-043", "G-050"
]);
const APPLE_BLOCKER_IDS = Object.freeze(Array.from(
  { length: 28 },
  (_, index) => `ASV1-${String(index + 1).padStart(3, "0")}`
));
const APPLE_BLOCKER_STATUSES = Object.freeze(["open", "resolved", "candidate", "optional"]);
const APPLE_SOURCE_PATHS = Object.freeze([
  "Configuration/Shared.xcconfig",
  "Configuration/TrailMind-Info.plist",
  "TrailMind/TrailMindDebug.entitlements",
  "TrailMind/TrailMindRelease.entitlements",
  "TrailMind/PrivacyInfo.xcprivacy",
  "TrailMind.xcodeproj/project.pbxproj",
  "TrailMind.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
  "TrailMind/App/TrailMindApp.swift",
  "TrailMind/Views/Home/HomeView.swift",
  "TrailMind/ViewModels/AppModels.swift",
  "TrailMind/Models/HikingPreferenceProfile.swift",
  "TrailMind/Services/HikingPreferenceProfileStore.swift",
  "TrailMind/Services/HikingPreferenceProfileSync.swift",
  "TrailMind/Services/HikingPreferenceProfileResolver.swift",
  "TrailMind/Services/RouteThumbnailService.swift",
  "TrailMind/Views/Route/RouteComponents.swift",
  "TrailMindTests/RouteThumbnailServiceTests.swift",
  "TrailMind/Services/IntentParsingFoundation.swift",
  "TrailMind/Services/SuperwallOnboardingClient.swift",
  "TrailMind/Views/Onboarding/SuperwallOnboardingHost.swift",
  "TrailMind/Views/Onboarding/OnboardingView.swift",
  "TrailMind/Views/Profile/ProfilePreferencesView.swift",
  "TrailMind/Services/VoicePlanningService.swift",
  "TrailMind/Services/GraphHopperClient.swift",
  "TrailMind/Models/AdventureModels.swift",
  "TrailMind/Views/Profile/TrailMindAboutContent.swift",
  "TrailMind/Services/SavedRouteStore.swift",
  "TrailMind/Services/GPXExporter.swift",
  "TrailMind/Assets.xcassets/AppIcon.appiconset/Contents.json",
  "TrailMind/Assets.xcassets/AppIcon.appiconset/TrailMindAppIcon.png",
  "TrailMindTests/PrivacyReleaseContentTests.swift",
  "TrailMindTests/ReleaseSurfaceTruthTests.swift",
  "TrailMindTests/RoutingFoundationTests.swift",
  "TrailMindTests/HikingPreferenceProfileSyncTests.swift",
  "scripts/release-contract.json",
  "scripts/verify-release-artifact.sh",
  "scripts/test-release-artifact-verifier.sh",
  "backend/config.example.env",
  "Configuration/Development.xcconfig",
  "Configuration/Staging.xcconfig",
  "Configuration/Production.xcconfig",
  "TrailMind/Services/AppEnvironment.swift",
  "TrailMindTests/AppEnvironmentTests.swift",
  "TrailMind.xcodeproj/xcshareddata/xcschemes/TrailMind Staging.xcscheme"
]);
const APPLE_EXTERNAL_ACTIVITY_FIELDS = Object.freeze([
  "backend", "supabase", "graphhopper", "ai", "superwall", "apple_mutations"
]);
const APPLE_SECRET_BOUNDARY_FIELDS = Object.freeze([
  "local_xcconfig_inspected",
  "clipboard_inspected",
  "private_certificate_material_inspected",
  "secret_values_inspected"
]);

export class ReleasePackageValidationError extends Error {
  constructor(code) {
    super("Release evidence package validation failed.");
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
  if (typeof options.isSourceCommit !== "function") {
    invalid("missing_source_ancestry_validator");
  }
  if (!options.isSourceCommit(manifest.sourceCommit)) {
    invalid("unbound_source_commit");
  }
  if (manifest.sourceCommit !== CLOSED_BETA_SOURCE_COMMIT) {
    invalid("unexpected_source_commit");
  }
  if (
    checklist.sourceCommit !== manifest.sourceCommit ||
    matrix.sourceCommit !== manifest.sourceCommit
  ) {
    invalid("unreconciled_source_commit");
  }

  if (!Array.isArray(checklist.domains) || checklist.domains.some((domain) =>
    !domain || typeof domain !== "object" || !Array.isArray(domain.requirements)
  )) {
    invalid("invalid_checklist_domains");
  }
  const requirements = checklist.domains.flatMap((domain) => domain.requirements);
  if (requirements.length === 0) {
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
      !uniqueStrings(requirement.evidenceReferences) ||
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
  if (!sameOrderedStrings(checklist.currentDecisionReasons, unresolved)) {
    invalid("unreconciled_decision_reasons");
  }

  const gates = manifest.gates;
  if (!Array.isArray(gates) ||
      uniqueIds(gates, "invalid_manifest_gate_ids").size !== requirementIds.size ||
      !sameOrderedStrings(gates.map((gate) => gate.id), [...requirementIds])) {
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
      !uniqueStrings(gate.classifications) ||
      gate.classifications.some((value) => !CLASSIFICATIONS.has(value))
    ) {
      invalid("invalid_gate_classification");
    }
    if (
      !Array.isArray(gate.sourceEvidence) ||
      !uniqueStrings(gate.sourceEvidence) ||
      (requirement.currentState === "verified" && gate.sourceEvidence.length === 0)
    ) {
      invalid("invalid_gate_source_evidence");
    }
    for (const path of gate.sourceEvidence) validateSourcePath(path, manifest.sourceCommit, options);
  }

  if (!Array.isArray(matrix.releaseBlockers)) invalid("invalid_feature_blockers");
  const featureBlockers = matrix.releaseBlockers.map((item) => item?.id).sort();
  if (!sameOrderedStrings(manifest.featureFlagBlockerIds, featureBlockers)) {
    invalid("unreconciled_feature_blockers");
  }
  validateMatrix(matrix);

  const packageFiles = options.packageFiles;
  if (
    !Array.isArray(manifest.packageFiles) ||
    !uniqueStrings(manifest.packageFiles) ||
    !sameOrderedStrings(manifest.packageFiles, [...manifest.packageFiles].sort()) ||
    manifest.packageFiles.some((name) =>
      typeof name !== "string" || name.includes("/") || name.includes("\\") || name.length > 255
    )
  ) {
    invalid("unsafe_package_inventory");
  }
  if (packageFiles && !sameOrderedStrings(manifest.packageFiles, packageFiles)) {
    invalid("package_inventory_mismatch");
  }
  if (
    !sameOrderedStrings(
      manifest.sourceBaselineDocuments,
      CLOSED_BETA_SOURCE_BASELINE_DOCUMENTS
    ) ||
    manifest.sourceBaselineDocuments.some((name) =>
      !safePackageFileName(name) || !manifest.packageFiles.includes(name))
  ) {
    invalid("invalid_source_baseline_documents");
  }
  if (typeof options.sourceBaselineForDocument !== "function") {
    invalid("missing_document_source_validator");
  }
  for (const name of manifest.sourceBaselineDocuments) {
    if (options.sourceBaselineForDocument(name) !== manifest.sourceCommit) {
      invalid("unreconciled_document_source_commit");
    }
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
  const reviewedIntegrationCommit = options.reviewedIntegrationCommit ?? "origin/main";
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
        gitSucceeds(repoRoot, ["cat-file", "-e", `${reviewedIntegrationCommit}^{commit}`]) &&
        gitSucceeds(repoRoot, ["merge-base", "--is-ancestor", commit, reviewedIntegrationCommit]);
    },
    sourcePathExists(commit, path) {
      return gitSucceeds(repoRoot, ["cat-file", "-e", `${commit}:${path}`]);
    },
    sourceBaselineForDocument(name) {
      return extractClosedBetaDocumentSourceCommit(
        readFileSync(resolve(packageRoot, name), "utf8")
      );
    }
  });
}

export function validateAppleReleasePackage(input, options = {}) {
  const { audit, blockers, manifest, matrix, privacyQuestionnaire, readme } = input ?? {};
  object(audit, "invalid_apple_audit");
  object(blockers, "invalid_apple_blockers");
  object(manifest, "invalid_apple_manifest");
  if (typeof matrix !== "string" || typeof privacyQuestionnaire !== "string" ||
      typeof readme !== "string") {
    invalid("invalid_apple_documents");
  }
  if (audit.decision !== "no_go" || blockers.public_release_decision !== "NO-GO" ||
      extractMarkdownValue(matrix, "Public-release decision") !== "**NO-GO**" ||
      extractMarkdownValue(readme, "Status") !== "**NO-GO for public App Store release**" ||
      !extractMarkdownValue(privacyQuestionnaire, "Status")
        ?.includes("do not publish in App Store Connect")) {
    invalid("false_green_apple_decision");
  }

  const sourceBaseline = manifest.source_baseline;
  if (!/^[0-9a-f]{40}$/.test(sourceBaseline ?? "")) {
    invalid("invalid_apple_source_baseline");
  }
  if (typeof options.isSourceCommit !== "function") {
    invalid("missing_source_ancestry_validator");
  }
  if (!options.isSourceCommit(sourceBaseline)) {
    invalid("unreachable_apple_source_baseline");
  }
  if (sourceBaseline !== APPLE_SOURCE_BASELINE) {
    invalid("unexpected_apple_source_baseline");
  }
  const embeddedBaselines = [
    audit.source_baseline,
    blockers.source_baseline,
    manifest.current_stage_c_evidence?.selected_commit,
    extractMarkdownCommit(readme, "Source baseline"),
    extractMarkdownCommit(matrix, "Baseline"),
    extractMarkdownCommit(privacyQuestionnaire, "Source baseline")
  ];
  if (embeddedBaselines.some((commit) => commit !== sourceBaseline)) {
    invalid("unreconciled_apple_source_baseline");
  }

  const matrixRows = parseGateRows(matrix);
  if (!sameOrderedStrings([...matrixRows.keys()], APPLE_GATE_IDS) ||
      [...matrixRows.values()].some((row) =>
        !APPLE_GATE_CLASSIFICATIONS.has(row.classification))) {
    invalid("invalid_apple_gate_inventory");
  }
  const baselineGate = matrixRows.get("G-001");
  const manifestGate = matrixRows.get("G-050");
  if (!baselineGate?.evidence.includes(sourceBaseline) ||
      !manifestGate?.evidence.includes(sourceBaseline)) {
    invalid("unreconciled_apple_gate_provenance");
  }
  if (!Array.isArray(blockers.blockers)) invalid("invalid_apple_blocker_inventory");
  const verifierBlocker = blockers.blockers.find((item) => item?.id === "ASV1-018");
  if (typeof verifierBlocker?.dependency !== "string" ||
      !verifierBlocker.dependency.includes(sourceBaseline)) {
    invalid("unreconciled_apple_verifier_provenance");
  }
  if (!uniqueStrings(manifest.notes) || !manifest.notes.some((note) =>
    note.includes(`selected source commit ${sourceBaseline}`)
  )) {
    invalid("unreconciled_apple_hash_provenance");
  }

  if (typeof options.sourceBlobSha256 !== "function") {
    invalid("missing_source_hash_validator");
  }
  if (manifest.algorithm !== "SHA-256" ||
      !Array.isArray(manifest.files) ||
      !sameOrderedStrings(manifest.files.map((file) => file?.path), APPLE_SOURCE_PATHS)) {
    invalid("invalid_apple_source_inventory");
  }
  const hashedPaths = new Set();
  for (const file of manifest.files) {
    if (!safeRepositoryPath(file?.path) || hashedPaths.has(file.path) ||
        !/^[0-9a-f]{64}$/.test(file.sha256 ?? "") ||
        !Array.isArray(file.claims) || file.claims.length === 0 ||
        !uniqueStrings(file.claims)) {
      invalid("invalid_apple_source_hash");
    }
    hashedPaths.add(file.path);
    if (options.sourceBlobSha256(sourceBaseline, file.path) !== file.sha256) {
      invalid("apple_source_hash_mismatch");
    }
  }

  validateAppleOperationalBoundary({ audit, manifest });
  const archiveProved = validateAppleArchiveGate({
    audit, manifest, matrix, matrixRows, options, readme
  });
  validateAppleProvedGateInventory(matrixRows, archiveProved);
  validateAppleBlockers({ blockers, matrixRows });
  validateAppleGateCounts({ matrix, matrixRows, readme });
  return Object.freeze({
    schemaVersion: 1,
    decision: "valid",
    currentDecision: "NO_GO",
    sourceBaseline,
    gateCount: matrixRows.size,
    provedGateCount: [...matrixRows.values()]
      .filter((row) => row.classification === "proved").length
  });
}

export function validateAppleReleasePackageFromDisk(options = {}) {
  const repoRoot = options.repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const packageRoot = resolve(repoRoot, APPLE_PACKAGE_DIRECTORY);
  const readJson = (name) => JSON.parse(readFileSync(resolve(packageRoot, name), "utf8"));
  const readText = (name) => readFileSync(resolve(packageRoot, name), "utf8");
  const reviewedIntegrationCommit = options.reviewedIntegrationCommit ?? "origin/main";
  return validateAppleReleasePackage({
    audit: readJson("APPLE_RELEASE_READINESS_AUDIT_V1.json"),
    blockers: readJson("RELEASE_BLOCKERS_V1.json"),
    manifest: readJson("SOURCE_EVIDENCE_MANIFEST_V1.json"),
    matrix: readText("RELEASE_GATE_MATRIX.md"),
    privacyQuestionnaire: readText("APP_PRIVACY_QUESTIONNAIRE_V1.md"),
    readme: readText("README.md")
  }, {
    isSourceCommit(commit) {
      return gitSucceeds(repoRoot, ["cat-file", "-e", `${commit}^{commit}`]) &&
        gitSucceeds(repoRoot, ["cat-file", "-e", `${reviewedIntegrationCommit}^{commit}`]) &&
        gitSucceeds(repoRoot, ["merge-base", "--is-ancestor", commit, reviewedIntegrationCommit]);
    },
    sourceBlobSha256(commit, path) {
      return gitBlobSha256(repoRoot, commit, path);
    }
  });
}

function validateAppleOperationalBoundary({ audit, manifest }) {
  const stageEvidence = manifest.current_stage_c_evidence;
  if (!stageEvidence || !sameJson(audit.builds, stageEvidence.builds)) {
    invalid("unreconciled_apple_build_evidence");
  }
  if (!sameStrings(Object.keys(audit.external_calls ?? {}), APPLE_EXTERNAL_ACTIVITY_FIELDS) ||
      Object.values(audit.external_calls).some((value) => value !== 0) ||
      stageEvidence.external_mutation !== "none") {
    invalid("unexpected_apple_external_activity");
  }
  if (!sameStrings(
    Object.keys(audit.privacy_and_secret_boundary ?? {}),
    APPLE_SECRET_BOUNDARY_FIELDS
  ) || Object.values(audit.privacy_and_secret_boundary).some((value) => value !== false)) {
    invalid("apple_secret_boundary_violation");
  }
  if (!sameOrderedStrings(
    manifest.excluded_paths,
    ["Configuration/Local.xcconfig", "backend/.env"]
  ) || manifest.excluded_paths.some((path) => APPLE_SOURCE_PATHS.includes(path))) {
    invalid("invalid_apple_secret_exclusions");
  }
  if (!Array.isArray(audit.no_go_reasons) || audit.no_go_reasons.length === 0 ||
      !uniqueStrings(audit.no_go_reasons)) {
    invalid("missing_apple_no_go_reasons");
  }
  const auditVerifier = audit.artifacts?.release?.verifier;
  const manifestVerifier = stageEvidence.release_verifier;
  if (auditVerifier?.passed !== manifestVerifier?.built_artifact_checks_passed ||
      auditVerifier?.failed !== manifestVerifier?.built_artifact_checks_failed ||
      auditVerifier?.status !== "passed" ||
      audit.verifier_regression?.isolated_cases_passed !==
        manifestVerifier?.isolated_adversarial_cases_passed ||
      audit.verifier_regression?.stale_report_recovery !==
        manifestVerifier?.stale_report_recovery ||
      audit.verifier_regression?.large_binary_pipefail_regression !== "passed") {
    invalid("unreconciled_apple_verifier_evidence");
  }
}

function validateAppleArchiveGate({ audit, manifest, matrix, matrixRows, options, readme }) {
  const gate = matrixRows.get("G-044");
  if (!gate || !["blocked", "proved"].includes(gate.classification)) {
    invalid("invalid_archive_gate_state");
  }
  if (/archive-equivalent/i.test(`${matrix}\n${readme}`)) {
    invalid("archive_equivalent_claim_forbidden");
  }
  const auditArchiveState = audit.builds?.signed_distribution_archive;
  const manifestArchiveState =
    manifest.current_stage_c_evidence?.builds?.signed_distribution_archive;
  if (auditArchiveState !== manifestArchiveState) {
    invalid("unreconciled_archive_state");
  }
  const auditArchive = audit.artifacts?.signed_distribution_archive;
  const manifestArchives = manifest.current_stage_c_evidence?.archive_artifacts;
  if (!Array.isArray(manifestArchives)) invalid("invalid_archive_evidence_inventory");
  const hasArchiveEvidence = auditArchiveState === "passed" &&
    auditArchive?.artifact_kind === "xcarchive" &&
    /^[0-9a-f]{64}$/.test(auditArchive.sha256 ?? "") &&
    manifestArchives.some((item) =>
      item?.artifact_kind === "xcarchive" && item.sha256 === auditArchive.sha256
    );
  if (gate.classification === "proved" && !hasArchiveEvidence) {
    invalid("archive_gate_without_archive_evidence");
  }
  if (gate.classification === "proved" &&
      (typeof options.isArchiveEvidenceVerified !== "function" ||
       !options.isArchiveEvidenceVerified({
         sourceBaseline: manifest.source_baseline,
         auditArchive,
         manifestArchive: manifestArchives.find((item) =>
           item?.artifact_kind === "xcarchive" && item.sha256 === auditArchive.sha256)
       }))) {
    invalid("archive_gate_without_archive_evidence");
  }
  const genericDiagnostic = audit.artifacts?.generic_iphoneos_release_build_diagnostic;
  if (audit.builds?.generic_iphoneos_release_build_diagnostic === "passed" &&
      (genericDiagnostic?.artifact_kind !== "generic_iphoneos_app_bundle" ||
       genericDiagnostic?.archive_evidence !== false)) {
    invalid("generic_build_mislabeled_as_archive");
  }
  const manifestGenericDiagnostics =
    manifest.current_stage_c_evidence?.non_archive_diagnostics;
  if (!Array.isArray(manifestGenericDiagnostics) ||
      (audit.builds?.generic_iphoneos_release_build_diagnostic === "passed" &&
       !manifestGenericDiagnostics.some((item) =>
         item?.artifact_kind === genericDiagnostic?.artifact_kind &&
         item?.binary_sha256 === genericDiagnostic?.binary_sha256 &&
         item?.archive_evidence === false
       ))) {
    invalid("unreconciled_generic_build_diagnostic");
  }
  return gate.classification === "proved";
}

function validateAppleProvedGateInventory(matrixRows, archiveProved) {
  const expected = archiveProved
    ? [...APPLE_PROVED_GATE_IDS, "G-044"].sort()
    : APPLE_PROVED_GATE_IDS;
  const proved = [...matrixRows.entries()]
    .filter(([, row]) => row.classification === "proved")
    .map(([id]) => id);
  if (!sameOrderedStrings(proved, expected)) {
    invalid("unexpected_apple_proved_gates");
  }
}

function validateAppleBlockers({ blockers, matrixRows }) {
  if (!sameOrderedStrings(blockers.status_vocabulary, APPLE_BLOCKER_STATUSES) ||
      !Array.isArray(blockers.blockers) ||
      !sameOrderedStrings(blockers.blockers.map((item) => item?.id), APPLE_BLOCKER_IDS)) {
    invalid("invalid_apple_blocker_inventory");
  }
  const blockersById = new Map();
  for (const blocker of blockers.blockers) {
    if (!/^P[1-3]$/.test(blocker.severity ?? "") ||
        !APPLE_BLOCKER_STATUSES.includes(blocker.status) ||
        typeof blocker.blocking_public_release !== "boolean" ||
        typeof blocker.title !== "string" || blocker.title.length < 3 ||
        typeof blocker.owner !== "string" || blocker.owner.length < 3 ||
        typeof blocker.acceptance_criterion !== "string" ||
          blocker.acceptance_criterion.length < 3 ||
        (blocker.status === "open") !== blocker.blocking_public_release) {
      invalid("invalid_apple_blocker_state");
    }
    blockersById.set(blocker.id, blocker);
  }

  const referenced = new Set();
  for (const row of matrixRows.values()) {
    const references = row.blocker.match(/ASV1-\d{3}/g) ?? [];
    if (!uniqueStrings(references) ||
        (row.classification === "proved" && row.blocker !== "—") ||
        (row.classification !== "proved" && references.length === 0)) {
      invalid("unreconciled_apple_blockers");
    }
    for (const id of references) {
      const blocker = blockersById.get(id);
      if (!blocker || blocker.status === "resolved") {
        invalid("unreconciled_apple_blockers");
      }
      referenced.add(id);
    }
  }
  const openBlockers = blockers.blockers
    .filter((blocker) => blocker.blocking_public_release)
    .map((blocker) => blocker.id);
  if (openBlockers.length === 0 || openBlockers.some((id) => !referenced.has(id))) {
    invalid("unreconciled_apple_blockers");
  }
}

function validateAppleGateCounts({ matrix, matrixRows, readme }) {
  const proved = [...matrixRows.values()]
    .filter((row) => row.classification === "proved").length;
  const expectedPercentage = ((proved / matrixRows.size) * 100).toFixed(1);
  const matrixSummary = matrix.match(
    /Exactly (\d+) of (\d+) applicable gates are proved: \*\*([0-9.]+)%\*\*/
  );
  const readmeSummary = readme.match(
    /proves \*\*(\d+) of (\d+) applicable release gates \(([0-9.]+)%\)\*\*/
  );
  for (const summary of [matrixSummary, readmeSummary]) {
    if (!summary || Number(summary[1]) !== proved || Number(summary[2]) !== matrixRows.size ||
        summary[3] !== expectedPercentage) {
      invalid("unreconciled_apple_gate_counts");
    }
  }
}

function parseGateRows(markdown) {
  const rows = new Map();
  for (const line of markdown.split("\n")) {
    if (!/^\| G-\d{3} \|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((value) => value.trim());
    if (cells.length !== 5 || rows.has(cells[0])) invalid("invalid_apple_gate_inventory");
    rows.set(cells[0], {
      requirement: cells[1],
      classification: cells[2],
      evidence: cells[3],
      blocker: cells[4]
    });
  }
  return rows;
}

function extractMarkdownCommit(markdown, label) {
  const prefix = `${label}: \``;
  const line = markdown.split("\n").find((candidate) => candidate.startsWith(prefix));
  const commit = line?.slice(prefix.length, -1) ?? "";
  return line?.endsWith("`") && /^[0-9a-f]{40}$/.test(commit) ? commit : null;
}

function extractMarkdownValue(markdown, label) {
  const prefix = `${label}: `;
  const lines = markdown.split("\n").filter((candidate) => candidate.startsWith(prefix));
  return lines.length === 1 ? lines[0].slice(prefix.length) : null;
}

function extractClosedBetaDocumentSourceCommit(markdown) {
  return markdown.match(
    /(?:Reviewed backend source|Current (?:backend |package )?source boundary):\s*`([0-9a-f]{40})`/m
  )?.[1] ?? null;
}

function validateMatrix(matrix) {
  if (!Array.isArray(matrix.flags)) invalid("missing_feature_flags");
  const flags = matrix.flags;
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
  if (!Array.isArray(matrix.states)) invalid("invalid_feature_states");
  const states = matrix.states;
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
  if (!Array.isArray(matrix.releaseBlockers)) invalid("invalid_feature_blockers");
  const blockers = matrix.releaseBlockers;
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

function sameOrderedStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.every((value) => typeof value === "string") &&
    right.every((value) => typeof value === "string") &&
    JSON.stringify(left) === JSON.stringify(right);
}

function uniqueStrings(values) {
  return Array.isArray(values) && values.every((value) => typeof value === "string") &&
    new Set(values).size === values.length;
}

function sameJson(left, right) {
  return left !== undefined && right !== undefined &&
    JSON.stringify(left) === JSON.stringify(right);
}

function safeRepositoryPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !value.startsWith("/") && !value.includes("..") && !value.includes("\\") &&
    value !== "backend/.env" && !value.endsWith("/Local.xcconfig");
}

function safePackageFileName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 255 &&
    !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..";
}

function gitBlobSha256(cwd, commit, path) {
  try {
    const blob = execFileSync("git", ["show", `${commit}:${path}`], {
      cwd,
      encoding: null,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" }
    });
    return createHash("sha256").update(blob).digest("hex");
  } catch {
    return null;
  }
}

function gitSucceeds(cwd, arguments_) {
  try {
    execFileSync("git", arguments_, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 15_000,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" }
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
