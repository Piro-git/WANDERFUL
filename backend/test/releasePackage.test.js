import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ReleasePackageValidationError,
  validateAppleReleasePackage,
  validateReleasePackage
} from "../src/operations/releasePackage.js";

const proofIntegrityFixtures = JSON.parse(readFileSync(new URL(
  "fixtures/releasePackageProofIntegrity.json",
  import.meta.url
), "utf8"));
const CLOSED_BETA_SOURCE_COMMIT = "52849b4c75cd6e5ddf00473adf8a3265160d750d";
const CLOSED_BETA_SOURCE_BASELINE_DOCUMENTS = [
  "CLOSED_BETA_ROLLOUT_V1.md",
  "OBSERVABILITY_AND_PRIVACY_V1.md",
  "PHYSICAL_IPHONE_APP_ATTEST_PROOF_V1.md",
  "README.md",
  "ROLLBACK_AND_INCIDENT_RESPONSE_V1.md",
  "STAGING_PROVISIONING_RUNBOOK_V1.md",
  "V4_OPERATIONAL_PROTOCOL.md"
];
const CLOSED_BETA_PACKAGE_FILES = [
  ...CLOSED_BETA_SOURCE_BASELINE_DOCUMENTS,
  "SOURCE_EVIDENCE_MANIFEST_V1.json"
].sort();

describe("closed-beta release package validator", () => {
  it("accepts a reconciled NO_GO package bound to current source evidence", () => {
    const input = packageInput();
    assert.deepEqual(validateReleasePackage(input, validatorOptions()), {
      schemaVersion: 1,
      decision: "valid",
      currentDecision: "NO_GO",
      gateCount: 1,
      unresolvedGateCount: 1
    });
  });

  it("rejects false-green decisions, missing gates and stale source bindings", () => {
    const falseGreen = packageInput();
    falseGreen.checklist.currentDecision = "GO";
    assert.throws(
      () => validateReleasePackage(falseGreen, validatorOptions()),
      (error) => error instanceof ReleasePackageValidationError &&
        error.code === "false_green_decision"
    );

    const missingGate = packageInput();
    missingGate.manifest.gates = [];
    assert.throws(
      () => validateReleasePackage(missingGate, validatorOptions()),
      (error) => error.code === "incomplete_manifest_gate_coverage"
    );

    assert.throws(
      () => validateReleasePackage(packageInput(), {
        ...validatorOptions(),
        isSourceCommit() { return false; }
      }),
      (error) => error.code === "unbound_source_commit"
    );
  });

  it("rejects a stale source baseline embedded in an authoritative human document", () => {
    const fixture = proofIntegrityFixtures.staleHumanDocumentBaseline;
    assert.throws(
      () => validateReleasePackage(packageInput(), {
        ...validatorOptions(),
        sourceBaselineForDocument(name) {
          return name === fixture.path ? fixture.embeddedCommit : CLOSED_BETA_SOURCE_COMMIT;
        }
      }),
      (error) => error instanceof ReleasePackageValidationError &&
        error.code === fixture.expectedErrorCode
    );
  });

  it("rejects a reachable but unexpected closed-beta source baseline", () => {
    const fixture = proofIntegrityFixtures.reachableUnexpectedBaselines;
    const input = JSON.parse(JSON.stringify(packageInput()).replaceAll(
      CLOSED_BETA_SOURCE_COMMIT,
      fixture.closedBeta
    ));
    assert.throws(
      () => validateReleasePackage(input, {
        ...validatorOptions(),
        sourceBaselineForDocument() { return fixture.closedBeta; }
      }),
      (error) => error.code === fixture.closedBetaErrorCode
    );
  });

  it("rejects reordered, omitted and duplicated closed-beta evidence inventory", () => {
    const fixture = proofIntegrityFixtures.closedBetaInventoryAttacks;

    const reordered = packageInput();
    reordered.manifest.packageFiles.reverse();
    assert.throws(
      () => validateReleasePackage(reordered, validatorOptions()),
      (error) => error instanceof ReleasePackageValidationError &&
        error.code === fixture.reorderedInventoryErrorCode
    );

    const omittedDocument = packageInput();
    omittedDocument.manifest.sourceBaselineDocuments =
      omittedDocument.manifest.sourceBaselineDocuments.filter(
        (name) => name !== fixture.omittedBaselineDocument
      );
    assert.throws(
      () => validateReleasePackage(omittedDocument, validatorOptions()),
      (error) => error.code === fixture.omittedDocumentErrorCode
    );

    const duplicatedEvidence = packageInput();
    const references = duplicatedEvidence.checklist.domains[0].requirements[0]
      .evidenceReferences;
    references.push(references[0]);
    assert.throws(
      () => validateReleasePackage(duplicatedEvidence, validatorOptions()),
      (error) => error.code === fixture.duplicateEvidenceErrorCode
    );
  });

  it("rejects missing evidence paths and unreconciled feature blockers", () => {
    assert.throws(
      () => validateReleasePackage(packageInput(), {
        ...validatorOptions(),
        pathExists() { return false; }
      }),
      (error) => error.code === "missing_evidence_path"
    );
    const input = packageInput();
    input.manifest.featureFlagBlockerIds = [];
    assert.throws(
      () => validateReleasePackage(input, validatorOptions()),
      (error) => error.code === "unreconciled_feature_blockers"
    );
  });

  it("rejects verified gates without evidence and incomplete feature states", () => {
    const noEvidence = packageInput();
    const requirement = noEvidence.checklist.domains[0].requirements[0];
    requirement.currentState = "verified";
    requirement.evidenceReferences = [];
    noEvidence.checklist.currentDecisionReasons = [];
    noEvidence.manifest.gates[0].status = "verified";
    assert.throws(
      () => validateReleasePackage(noEvidence, validatorOptions()),
      (error) => error.code === "invalid_requirement_evidence"
    );

    const noCommitBoundEvidence = packageInput();
    const commitBoundRequirement =
      noCommitBoundEvidence.checklist.domains[0].requirements[0];
    commitBoundRequirement.currentState = "verified";
    noCommitBoundEvidence.checklist.currentDecisionReasons = [];
    noCommitBoundEvidence.manifest.gates[0].status = "verified";
    noCommitBoundEvidence.manifest.gates[0].sourceEvidence = [];
    assert.throws(
      () => validateReleasePackage(noCommitBoundEvidence, validatorOptions()),
      (error) => error.code === "invalid_gate_source_evidence"
    );

    const staleVerifiedEvidence = packageInput();
    const staleRequirement = staleVerifiedEvidence.checklist.domains[0].requirements[0];
    staleRequirement.currentState = "verified";
    staleVerifiedEvidence.checklist.currentDecisionReasons = [];
    staleVerifiedEvidence.manifest.gates[0].status = "verified";
    assert.throws(
      () => validateReleasePackage(staleVerifiedEvidence, {
        ...validatorOptions(),
        sourcePathExists() { return false; }
      }),
      (error) => error.code === "source_evidence_not_at_commit"
    );

    const falseGreenManifest = packageInput();
    falseGreenManifest.manifest.currentDecision = "GO";
    assert.throws(
      () => validateReleasePackage(falseGreenManifest, validatorOptions()),
      (error) => error.code === "false_green_manifest"
    );

    const incompleteState = packageInput();
    incompleteState.matrix.states[0].flags = {};
    assert.throws(
      () => validateReleasePackage(incompleteState, validatorOptions()),
      (error) => error.code === "incomplete_feature_state"
    );
  });

  it("returns bounded codes for malformed closed-beta container types", () => {
    const fixture = proofIntegrityFixtures.malformedContainers;
    const invalidDomains = packageInput();
    invalidDomains.checklist.domains = {};
    assert.throws(
      () => validateReleasePackage(invalidDomains, validatorOptions()),
      (error) => error instanceof ReleasePackageValidationError &&
        error.code === fixture.closedBetaDomainsErrorCode
    );

    const invalidBlockers = packageInput();
    invalidBlockers.matrix.releaseBlockers = {};
    assert.throws(
      () => validateReleasePackage(invalidBlockers, validatorOptions()),
      (error) => error instanceof ReleasePackageValidationError &&
        error.code === fixture.closedBetaBlockersErrorCode
    );
  });
});

describe("Apple release evidence proof-integrity validator", () => {
  it("accepts the reconciled NO_GO package and verifies every source hash", () => {
    const input = applePackageInput();
    assert.deepEqual(validateAppleReleasePackage(input, appleValidatorOptions(input)), {
      schemaVersion: 1,
      decision: "valid",
      currentDecision: "NO_GO",
      sourceBaseline: "009c5aa52f7feb386335c7aeb0c2f1e85ec7a7fd",
      gateCount: 50,
      provedGateCount: 24
    });
  });

  it("rejects an unreachable sibling commit even when its source blobs hash identically", () => {
    const fixture = proofIntegrityFixtures.unreachableSiblingCommit;
    const input = replaceAppleBaseline(applePackageInput(), fixture.commit);
    assert.throws(
      () => validateAppleReleasePackage(input, appleValidatorOptions(input, false)),
      (error) => error instanceof ReleasePackageValidationError &&
        error.code === fixture.expectedErrorCode
    );
  });

  it("rejects a reachable but unexpected Apple source baseline", () => {
    const fixture = proofIntegrityFixtures.reachableUnexpectedBaselines;
    const input = replaceAppleBaseline(applePackageInput(), fixture.apple);
    assert.throws(
      () => validateAppleReleasePackage(input, appleValidatorOptions(input)),
      (error) => error.code === fixture.appleErrorCode
    );
  });

  it("rejects missing, reordered, duplicated and mutated source-hash evidence", () => {
    const fixture = proofIntegrityFixtures.appleSourceInventoryAttacks;

    const missing = applePackageInput();
    missing.manifest.files.splice(fixture.recordIndex, 1);
    assert.throws(
      () => validateAppleReleasePackage(missing, appleValidatorOptions(missing)),
      (error) => error.code === fixture.inventoryErrorCode
    );

    const reordered = applePackageInput();
    reordered.manifest.files.reverse();
    assert.throws(
      () => validateAppleReleasePackage(reordered, appleValidatorOptions(reordered)),
      (error) => error.code === fixture.inventoryErrorCode
    );

    const duplicated = applePackageInput();
    duplicated.manifest.files.splice(
      fixture.recordIndex,
      0,
      structuredClone(duplicated.manifest.files[fixture.recordIndex])
    );
    assert.throws(
      () => validateAppleReleasePackage(duplicated, appleValidatorOptions(duplicated)),
      (error) => error.code === fixture.inventoryErrorCode
    );

    const mutated = applePackageInput();
    const sourceOptions = appleValidatorOptions(mutated);
    mutated.manifest.files[fixture.recordIndex].sha256 = fixture.mutatedSha256;
    assert.throws(
      () => validateAppleReleasePackage(mutated, sourceOptions),
      (error) => error.code === fixture.hashErrorCode
    );
  });

  it("rejects missing or reordered Apple gates", () => {
    const fixture = proofIntegrityFixtures.appleGateInventoryAttacks;

    const missing = applePackageInput();
    missing.matrix = missing.matrix.replace(
      `| ${fixture.missingGateId} |`,
      `| ${fixture.replacementGateId} |`
    );
    assert.throws(
      () => validateAppleReleasePackage(missing, appleValidatorOptions(missing)),
      (error) => error.code === fixture.expectedErrorCode
    );

    const reordered = applePackageInput();
    const lines = reordered.matrix.split("\n");
    const indexes = fixture.reorderedGateIds.map((gateId) =>
      lines.findIndex((line) => line.startsWith(`| ${gateId} |`))
    );
    [lines[indexes[0]], lines[indexes[1]]] = [lines[indexes[1]], lines[indexes[0]]];
    reordered.matrix = lines.join("\n");
    assert.throws(
      () => validateAppleReleasePackage(reordered, appleValidatorOptions(reordered)),
      (error) => error.code === fixture.expectedErrorCode
    );
  });

  it("rejects false-green human status and resolved blockers still used by open gates", () => {
    const statusFixture = proofIntegrityFixtures.appleFalseGreenReadme;
    const falseGreen = applePackageInput();
    falseGreen.readme = falseGreen.readme.replace(
      statusFixture.currentStatus,
      statusFixture.mutatedStatus
    );
    assert.throws(
      () => validateAppleReleasePackage(falseGreen, appleValidatorOptions(falseGreen)),
      (error) => error.code === statusFixture.expectedErrorCode
    );

    const blockerFixture = proofIntegrityFixtures.appleResolvedReferencedBlocker;
    const inconsistent = applePackageInput();
    const blocker = inconsistent.blockers.blockers.find(
      (item) => item.id === blockerFixture.blockerId
    );
    blocker.status = "resolved";
    blocker.blocking_public_release = false;
    assert.throws(
      () => validateAppleReleasePackage(inconsistent, appleValidatorOptions(inconsistent)),
      (error) => error.code === blockerFixture.expectedErrorCode
    );
  });

  it("rejects recorded external activity or secret-boundary inspection", () => {
    const fixture = proofIntegrityFixtures.appleOperationalBoundaryAttacks;
    const externalActivity = applePackageInput();
    externalActivity.audit.external_calls[fixture.externalActivityField] = 1;
    assert.throws(
      () => validateAppleReleasePackage(
        externalActivity,
        appleValidatorOptions(externalActivity)
      ),
      (error) => error.code === fixture.externalActivityErrorCode
    );

    const secretInspection = applePackageInput();
    secretInspection.audit.privacy_and_secret_boundary[fixture.secretBoundaryField] = true;
    assert.throws(
      () => validateAppleReleasePackage(
        secretInspection,
        appleValidatorOptions(secretInspection)
      ),
      (error) => error.code === fixture.secretBoundaryErrorCode
    );
  });

  it("returns bounded codes for malformed Apple evidence container types", () => {
    const fixture = proofIntegrityFixtures.malformedContainers;
    const invalidBlockers = applePackageInput();
    invalidBlockers.blockers.blockers = {};
    assert.throws(
      () => validateAppleReleasePackage(invalidBlockers, appleValidatorOptions(invalidBlockers)),
      (error) => error instanceof ReleasePackageValidationError &&
        error.code === fixture.appleBlockersErrorCode
    );

    const invalidNotes = applePackageInput();
    invalidNotes.manifest.notes = {};
    assert.throws(
      () => validateAppleReleasePackage(invalidNotes, appleValidatorOptions(invalidNotes)),
      (error) => error instanceof ReleasePackageValidationError &&
        error.code === fixture.appleNotesErrorCode
    );
  });

  it("rejects a generic device build presented as archive proof", () => {
    const fixture = proofIntegrityFixtures.genericBuildAsArchive;
    const input = applePackageInput();
    input.matrix = input.matrix.replace(
      /\| G-044 \|([^\n]+)\| blocked \|/,
      "| G-044 |$1| proved |"
    );
    assert.equal(
      input.audit.artifacts.generic_iphoneos_release_build_diagnostic.artifact_kind,
      fixture.genericArtifactKind
    );
    assert.equal(input.audit.builds.signed_distribution_archive, fixture.signedArchiveState);
    assert.throws(
      () => validateAppleReleasePackage(input, appleValidatorOptions(input)),
      (error) => error instanceof ReleasePackageValidationError &&
        error.code === fixture.expectedErrorCode
    );
  });

  it("rejects self-consistent archive fields without independent archive verification", () => {
    const fixture = proofIntegrityFixtures.selfConsistentArchiveForgery;
    const input = applePackageInput();
    input.audit.builds.signed_distribution_archive = "passed";
    input.audit.artifacts.signed_distribution_archive = {
      artifact_kind: "xcarchive",
      sha256: fixture.sha256
    };
    input.manifest.current_stage_c_evidence.builds.signed_distribution_archive = "passed";
    input.manifest.current_stage_c_evidence.archive_artifacts = [{
      artifact_kind: "xcarchive",
      sha256: fixture.sha256
    }];
    input.matrix = input.matrix
      .replace(
        /\| G-044 \|([^\n]+)\| blocked \|([^\n]+)\| ASV1-020 \|/,
        "| G-044 |$1| proved |$2| — |"
      )
      .replace(
        "Exactly 24 of 50 applicable gates are proved: **48.0%**",
        "Exactly 25 of 50 applicable gates are proved: **50.0%**"
      );
    input.readme = input.readme.replace(
      "proves **24 of 50 applicable release gates (48.0%)**",
      "proves **25 of 50 applicable release gates (50.0%)**"
    );
    assert.throws(
      () => validateAppleReleasePackage(input, appleValidatorOptions(input)),
      (error) => error instanceof ReleasePackageValidationError &&
        error.code === fixture.expectedErrorCode
    );
  });
});

function packageInput() {
  return {
    checklist: {
      sourceCommit: CLOSED_BETA_SOURCE_COMMIT,
      currentDecision: "NO_GO",
      currentDecisionReasons: ["operations-runtime"],
      domains: [{
        requirements: [{
          id: "operations-runtime",
          mandatory: true,
          ownerRole: "backend_owner",
          currentState: "partial",
          evidenceReferences: ["backend/src/server.js"],
          blocker: "Staging evidence is absent."
        }]
      }]
    },
    matrix: {
      sourceCommit: CLOSED_BETA_SOURCE_COMMIT,
      currentDecision: "NO_GO",
      currentClassification: "production-off",
      releaseBlockers: [{
        id: "flag-blocker-deployment",
        status: "open",
        requiredResolution: "Prove deployment admission."
      }],
      flags: [{
        id: "backend-route-provider",
        surface: "backend",
        currentAcceptedTrueValues: ["true", "yes", "1"],
        missingOrMalformedEffectiveValue: false
      }],
      states: [{
        id: "production-off",
        flags: { "backend-route-provider": false }
      }]
    },
    manifest: {
      sourceCommit: CLOSED_BETA_SOURCE_COMMIT,
      currentDecision: "NO_GO",
      featureFlagBlockerIds: ["flag-blocker-deployment"],
      packageFiles: [...CLOSED_BETA_PACKAGE_FILES],
      sourceBaselineDocuments: [...CLOSED_BETA_SOURCE_BASELINE_DOCUMENTS],
      gates: [{
        id: "operations-runtime",
        status: "partial",
        classifications: [
          "proved_by_current_automated_test",
          "requires_staging_or_deployment"
        ],
        sourceEvidence: ["backend/src/server.js"]
      }]
    }
  };
}

function validatorOptions() {
  return {
    packageFiles: [...CLOSED_BETA_PACKAGE_FILES],
    pathExists() { return true; },
    isSourceCommit() { return true; },
    sourcePathExists() { return true; },
    sourceBaselineForDocument() { return CLOSED_BETA_SOURCE_COMMIT; }
  };
}

function applePackageInput() {
  const packageUrl = new URL("../../docs/release/app-store-v1/", import.meta.url);
  const readJson = (name) => JSON.parse(readFileSync(new URL(name, packageUrl), "utf8"));
  const readText = (name) => readFileSync(new URL(name, packageUrl), "utf8");
  return {
    audit: readJson("APPLE_RELEASE_READINESS_AUDIT_V1.json"),
    blockers: readJson("RELEASE_BLOCKERS_V1.json"),
    manifest: readJson("SOURCE_EVIDENCE_MANIFEST_V1.json"),
    matrix: readText("RELEASE_GATE_MATRIX.md"),
    privacyQuestionnaire: readText("APP_PRIVACY_QUESTIONNAIRE_V1.md"),
    readme: readText("README.md")
  };
}

function appleValidatorOptions(input, reachable = true) {
  const sourceHashes = new Map(input.manifest.files.map((file) => [file.path, file.sha256]));
  return {
    isSourceCommit() { return reachable; },
    sourceBlobSha256(_commit, path) {
      return sourceHashes.get(path) ?? null;
    }
  };
}

function replaceAppleBaseline(input, replacement) {
  const current = input.manifest.source_baseline;
  return JSON.parse(JSON.stringify(input).replaceAll(current, replacement));
}
