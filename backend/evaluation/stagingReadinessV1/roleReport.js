import {
  CANONICAL_ROLE_IDS,
  CANONICAL_ROLE_SEPARATION_GUARD_IDS,
  CANCELLATION_CONTROL_PRIVILEGE_MANIFEST,
  CANCELLATION_CONTROL_ROLE_ID
} from "./constants.js";
import { stagingReadinessRoleSetRecordV1 } from "./observations.js";
import {
  sha256StagingReadinessV1,
  stableSerializeStagingReadinessV1
} from "./serialization.js";
import {
  assertDigest,
  assertExactOrderedIds,
  invalidStagingReadinessV1,
  plainObject
} from "./validation.js";

export function renderStagingReadinessRolesMarkdownV1({
  roleObservation,
  policy
}) {
  if (!plainObject(roleObservation) || !plainObject(policy) ||
      !Array.isArray(policy.canonicalRoleContracts)) {
    invalidStagingReadinessV1("role_report_input_invalid");
  }
  assertExactOrderedIds(roleObservation.roles, CANONICAL_ROLE_IDS);
  assertExactOrderedIds(
    roleObservation.separationGuardIdentities,
    CANONICAL_ROLE_SEPARATION_GUARD_IDS
  );
  assertDigest(roleObservation.roleSetDigest);
  assertDigest(roleObservation.grantDigest);
  assertDigest(roleObservation.roleContractDigest);
  assertDigest(roleObservation.evidenceSha256);
  if (policy.canonicalRoleContracts.length !== CANONICAL_ROLE_IDS.length ||
      roleObservation.roleContractDigest !== sha256StagingReadinessV1(
        policy.canonicalRoleContracts
      )) {
    invalidStagingReadinessV1("role_report_contract_mismatch");
  }
  const identities = new Set();
  const rows = roleObservation.roles.map((role, index) => {
    const contract = policy.canonicalRoleContracts[index];
    assertDigest(role.identityDigest);
    assertDigest(role.privilegeManifestDigest);
    assertDigest(role.evidenceSha256);
    identities.add(role.identityDigest);
    if (role.id !== contract.id || role.purpose !== contract.purpose) {
      invalidStagingReadinessV1("role_report_contract_mismatch");
    }
    const { evidenceSha256, ...roleRecord } = role;
    if (sha256StagingReadinessV1(roleRecord) !== evidenceSha256) {
      invalidStagingReadinessV1("role_report_evidence_digest_mismatch");
    }
    const passed = role.separatedIdentity === true &&
      role.boundaryPassed === true &&
      role.prohibitedPrivilegesDenied === true &&
      role.dangerousPrivilegeDetected === false &&
      role.unexpectedMembershipDetected === false &&
      role.unexpectedInheritanceDetected === false &&
      role.unexpectedOwnershipDetected === false &&
      role.unexpectedSchemaPrivilegeDetected === false &&
      role.unexpectedTablePrivilegeDetected === false &&
      role.publicDataApiExposed === false && role.rlsBoundaryPassed === true &&
      role.businessDataMutationBoundaryPassed === true;
    return `| ${role.id} | ${role.purpose} | ${role.identityDigest} | ` +
      `${role.privilegeManifestDigest} | ${passed ? "passed" : "failed"} |`;
  });
  const cancellationRole = roleObservation.roles.find((role) =>
    role.id === CANCELLATION_CONTROL_ROLE_ID
  );
  const expectedManifestDigest = sha256StagingReadinessV1(
    CANCELLATION_CONTROL_PRIVILEGE_MANIFEST
  );
  if (!cancellationRole ||
      cancellationRole.privilegeManifestDigest !== expectedManifestDigest ||
      sha256StagingReadinessV1(cancellationRole.privilegeManifest) !==
        expectedManifestDigest ||
      cancellationRole.identityDigest !== roleObservation.cancellationRoleDigest ||
      cancellationRole.privilegeManifestDigest !==
        roleObservation.cancellationPrivilegeManifestDigest) {
    invalidStagingReadinessV1("role_report_cancellation_manifest_mismatch");
  }
  const guardRows = roleObservation.separationGuardIdentities.map((guard) => {
    assertDigest(guard.identityDigest);
    identities.add(guard.identityDigest);
    return `| ${guard.id} | ${guard.identityDigest} |`;
  });
  if (identities.size !== CANONICAL_ROLE_IDS.length +
      CANONICAL_ROLE_SEPARATION_GUARD_IDS.length ||
      roleObservation.roleSetDigest !== sha256StagingReadinessV1(
        stagingReadinessRoleSetRecordV1(roleObservation)
      ) || roleObservation.grantDigest !== sha256StagingReadinessV1(
        roleObservation.roles.map((role) => ({
          id: role.id,
          privilegeManifestDigest: role.privilegeManifestDigest
        }))
      )) {
    invalidStagingReadinessV1("role_report_role_set_mismatch");
  }
  const { evidenceSha256, ...observationRecord } = roleObservation;
  if (sha256StagingReadinessV1(observationRecord) !== evidenceSha256) {
    invalidStagingReadinessV1("role_report_evidence_digest_mismatch");
  }
  return [
    "# Staging Role Evidence V1",
    "",
    `Role-set digest: \`${roleObservation.roleSetDigest}\``,
    "",
    `Grant digest: \`${roleObservation.grantDigest}\``,
    "",
    "| Role ID | Purpose | Identity digest | Privilege manifest digest | Boundary |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Cancellation/control exact privilege manifest",
    "",
    "```json",
    stableSerializeStagingReadinessV1(cancellationRole.privilegeManifest),
    "```",
    "",
    "## Required distinct managed identities",
    "",
    "| Guard ID | Identity digest |",
    "| --- | --- |",
    ...guardRows,
    ""
  ].join("\n");
}
