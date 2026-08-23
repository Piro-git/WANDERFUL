import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ReleasePackageValidationError,
  validateReleasePackage
} from "../src/operations/releasePackage.js";

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
});

function packageInput() {
  return {
    checklist: {
      sourceCommit: "a".repeat(40),
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
      sourceCommit: "a".repeat(40),
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
      sourceCommit: "a".repeat(40),
      currentDecision: "NO_GO",
      featureFlagBlockerIds: ["flag-blocker-deployment"],
      packageFiles: ["SOURCE_EVIDENCE_MANIFEST_V1.json"],
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
    packageFiles: ["SOURCE_EVIDENCE_MANIFEST_V1.json"],
    pathExists() { return true; },
    isSourceCommit() { return true; },
    sourcePathExists() { return true; }
  };
}
