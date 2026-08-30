import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import {
  acquireCandidateCaPin,
  provisionCandidateSigningKey,
  signCanonicalReceipt,
  verifyCanonicalReceipt,
  verifyPinnedCaFile
} from "../src/operations/stagingPrerequisitesV3/index.js";

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const path = temporaryDirectories.pop();
    if (path.startsWith(`${tmpdir()}/trailmind-signing-v3-`)) {
      rmSync(path, { force: true, recursive: true });
    }
  }
});

describe("staging prerequisites v3 Ed25519 and CA pins", () => {
  it("creates disposable Ed25519 material with restrictive private mode", () => {
    const directory = temporaryDirectory();
    const candidate = provisionCandidateSigningKey({ outputDirectory: directory });
    assert.equal(candidate.candidateOnly, true);
    assert.match(candidate.keyId, /^trailmind-observer-ed25519-[a-f0-9]{24}$/);
    assert.match(candidate.publicKeySpkiSha256, /^[a-f0-9]{64}$/);
    assert.equal(lstatSync(join(directory, candidate.privateKeyFileName)).mode & 0o777,
      0o600);
    assert.equal(readFileSync(join(directory, candidate.privateKeyFileName), "utf8")
      .includes("PRIVATE KEY"), false);
  });

  it("signs and verifies every required binding without claiming truth or freshness", () => {
    const directory = temporaryDirectory();
    const candidate = provisionCandidateSigningKey({ outputDirectory: directory });
    const receipt = validReceipt();
    const signed = signCanonicalReceipt({
      privateKeyPath: join(directory, candidate.privateKeyFileName),
      receipt,
      requiredKeyId: candidate.keyId,
      requiredPublicKeySpkiSha256: candidate.publicKeySpkiSha256
    });
    const result = verifyCanonicalReceipt({
      envelope: signed.canonical,
      publicKeyPath: join(directory, candidate.publicKeyFileName),
      requiredKeyId: candidate.keyId,
      requiredPublicKeySpkiSha256: candidate.publicKeySpkiSha256
    });
    assert.deepEqual(result, {
      artifactSha256: signed.envelope.artifactSha256,
      authenticityProved: true,
      integrityProved: true,
      freshnessProved: false,
      truthProved: false
    });
  });

  it("rejects tampering, duplicate JSON keys, wrong pins, and unsafe key files", () => {
    const directory = temporaryDirectory();
    const candidate = provisionCandidateSigningKey({ outputDirectory: directory });
    const signed = signCanonicalReceipt({
      privateKeyPath: join(directory, candidate.privateKeyFileName),
      receipt: validReceipt(),
      requiredKeyId: candidate.keyId,
      requiredPublicKeySpkiSha256: candidate.publicKeySpkiSha256
    });
    const tampered = structuredClone(signed.envelope);
    tampered.receipt.result.digest = "f".repeat(64);
    assert.throws(() => verifyCanonicalReceipt({
      envelope: tampered,
      publicKeyPath: join(directory, candidate.publicKeyFileName),
      requiredKeyId: candidate.keyId,
      requiredPublicKeySpkiSha256: candidate.publicKeySpkiSha256
    }), hasCode("verification_artifact_digest"));
    const duplicate = signed.canonical.replace(
      '"algorithm":"Ed25519",',
      '"algorithm":"Ed25519","algorithm":"Ed25519",'
    );
    assert.throws(() => verifyCanonicalReceipt({
      envelope: duplicate,
      publicKeyPath: join(directory, candidate.publicKeyFileName),
      requiredKeyId: candidate.keyId,
      requiredPublicKeySpkiSha256: candidate.publicKeySpkiSha256
    }), hasCode("json_duplicate_key"));
    assert.throws(() => verifyCanonicalReceipt({
      envelope: signed.canonical,
      publicKeyPath: join(directory, candidate.publicKeyFileName),
      requiredKeyId: candidate.keyId,
      requiredPublicKeySpkiSha256: "0".repeat(64)
    }), hasCode("verification_pin"));
    chmodSync(join(directory, candidate.privateKeyFileName), 0o644);
    assert.throws(() => signCanonicalReceipt({
      privateKeyPath: join(directory, candidate.privateKeyFileName),
      receipt: validReceipt(),
      requiredKeyId: candidate.keyId,
      requiredPublicKeySpkiSha256: candidate.publicKeySpkiSha256
    }), hasCode("file_mode"));
  });

  it("pins one explicitly supplied local CA file and blocks changes or symlinks", () => {
    const directory = temporaryDirectory();
    const privateKey = join(directory, "disposable-ca-key.pem");
    const certificate = join(directory, "disposable-ca.pem");
    execFileSync("openssl", [
      "req", "-new", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", privateKey, "-out", certificate, "-days", "1",
      "-subj", "/CN=TrailMind Disposable Test CA",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign"
    ], { cwd: directory, stdio: "ignore", timeout: 15_000 });
    chmodSync(privateKey, 0o600);
    chmodSync(certificate, 0o644);
    const candidate = acquireCandidateCaPin({ caCertificatePath: certificate });
    assert.equal(candidate.candidateOnly, true);
    assert.equal(verifyPinnedCaFile({
      caCertificatePath: certificate,
      reviewedSslrootcertSha256: candidate.sslrootcertSha256
    }).pinMatched, true);
    assert.throws(() => verifyPinnedCaFile({
      caCertificatePath: certificate,
      reviewedSslrootcertSha256: "0".repeat(64)
    }), hasCode("ca_pin_mismatch"));
    const link = join(directory, "ca-link.pem");
    symlinkSync(certificate, link);
    assert.throws(() => acquireCandidateCaPin({ caCertificatePath: link }),
      hasCode("file_type"));
    writeFileSync(certificate, Buffer.concat([readFileSync(certificate), Buffer.from("\n")]));
    assert.throws(() => verifyPinnedCaFile({
      caCertificatePath: certificate,
      reviewedSslrootcertSha256: candidate.sslrootcertSha256
    }), hasCode("ca_pin_mismatch"));
  });
});

function validReceipt() {
  return {
    auditorIdentity: {
      applicationName: `trailmind_p1v2_auditor_${"a".repeat(32)}`,
      backendPid: 42,
      roleName: "trailmind_phase1_v2_stats_auditor",
      sessionIdentitySha256: "b".repeat(64)
    },
    candidateGitCommit: "c".repeat(40),
    candidateGitTree: "d".repeat(40),
    expectedManifestSha256: "e".repeat(64),
    observedAt: "2026-08-30T12:00:00.000Z",
    programSha256: "f".repeat(64),
    result: { digest: "1".repeat(64), status: "pass" },
    runId: "11111111-1111-4111-8111-111111111111",
    schemaVersion: 1
  };
}

function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), "trailmind-signing-v3-"));
  chmodSync(path, 0o700);
  temporaryDirectories.push(path);
  return path;
}

function hasCode(code) {
  return (error) => error?.code === code;
}
