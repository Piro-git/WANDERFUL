import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";
import { decode, Decoder, encode } from "cbor-x";
import { sha256 } from "../src/appAttest/clientData.js";
import { createAppAttestVerifier } from "../src/appAttest/appAttestVerifier.js";
import { APPLE_APP_ATTEST_FIXTURE } from "./fixtures/appleAppAttestFixture.js";

const verifier = createAppAttestVerifier({
  appIdPrefix: "1234567890",
  bundleId: "com.example.myapp",
  environment: "production",
  allowedValidationCategories: [1],
  allowedBundleVersions: ["1"]
});
const fixtureDecoder = new Decoder({ mapsAsObjects: false, useRecords: false });

describe("App Attest verifier", () => {
  it("validates Apple's official attestation fixture completely", async () => {
    const result = await verifier.verifyAttestation({
      attestationObject: Buffer.from(APPLE_APP_ATTEST_FIXTURE.attestationObject, "base64"),
      keyId: APPLE_APP_ATTEST_FIXTURE.keyId,
      // Apple's published 2026 fixture supplies these challenge bytes directly
      // to attestKey as clientDataHash; production hashes its random challenge.
      clientDataHash: Buffer.from(APPLE_APP_ATTEST_FIXTURE.challenge, "utf8"),
      now: new Date("2026-04-21T12:00:00.000Z")
    });

    assert.equal(result.environment, "production");
    assert.equal(result.counter, 0);
    assert.equal(result.validationCategory, 1);
    assert.equal(result.bundleVersion, "1");
    assert.match(result.publicKeyPem, /^-----BEGIN PUBLIC KEY-----/);
    assert.ok(result.receipt.length > 1_000);
  });

  it("rejects invalid CBOR without exposing parser details", async () => {
    await assert.rejects(
      verifier.verifyAttestation({
        attestationObject: Buffer.from([0xff]),
        keyId: APPLE_APP_ATTEST_FIXTURE.keyId,
        clientDataHash: Buffer.from(APPLE_APP_ATTEST_FIXTURE.challenge),
        now: new Date("2026-04-21T12:00:00.000Z")
      }),
      (error) => error.code === "app_attest_invalid" && error.message === "App verification failed."
    );
  });

  it("rejects a wrong key identifier", async () => {
    await assert.rejects(
      verifier.verifyAttestation({
        attestationObject: Buffer.from(APPLE_APP_ATTEST_FIXTURE.attestationObject, "base64"),
        keyId: Buffer.alloc(32, 7).toString("base64"),
        clientDataHash: Buffer.from(APPLE_APP_ATTEST_FIXTURE.challenge),
        now: new Date("2026-04-21T12:00:00.000Z")
      }),
      (error) => error.code === "app_attest_invalid"
    );
  });

  it("rejects an invalid attestation certificate chain", async () => {
    const attestationObject = mutateAttestation((decoded) => {
      const statement = decoded.get("attStmt");
      const certificates = statement.get("x5c");
      statement.set("x5c", [certificates[0], certificates[0]]);
    });
    await assert.rejects(
      verifyOfficialFixture(verifier, { attestationObject }),
      (error) => error.code === "app_attest_invalid"
    );
  });

  it("rejects an invalid credential certificate nonce", async () => {
    await assert.rejects(
      verifyOfficialFixture(verifier, { clientDataHash: Buffer.alloc(32, 9) }),
      (error) => error.code === "app_attest_invalid"
    );
  });

  it("rejects a wrong RP ID", async () => {
    const wrongRpVerifier = fixtureVerifier({ bundleId: "com.example.other" });
    await assert.rejects(
      verifyOfficialFixture(wrongRpVerifier),
      (error) => error.code === "app_attest_invalid"
    );
  });

  it("rejects a wrong AAGUID", async () => {
    const attestationObject = mutateAttestation((decoded) => {
      const authenticatorData = Buffer.from(decoded.get("authData"));
      authenticatorData[37] ^= 0x01;
      decoded.set("authData", authenticatorData);
    });
    await assert.rejects(
      verifyOfficialFixture(verifier, { attestationObject }),
      (error) => error.code === "app_attest_environment_mismatch"
    );
  });

  it("rejects a nonzero initial attestation counter", async () => {
    const attestationObject = mutateAttestation((decoded) => {
      const authenticatorData = Buffer.from(decoded.get("authData"));
      authenticatorData.writeUInt32BE(1, 33);
      decoded.set("authData", authenticatorData);
    });
    await assert.rejects(
      verifyOfficialFixture(verifier, { attestationObject }),
      (error) => error.code === "app_attest_invalid"
    );
  });

  it("rejects a disallowed validation category", async () => {
    const wrongCategoryVerifier = fixtureVerifier({ allowedValidationCategories: [2] });
    await assert.rejects(
      verifyOfficialFixture(wrongCategoryVerifier),
      (error) => error.code === "app_attest_invalid"
    );
  });

  it("rejects a disallowed bundle version", async () => {
    const wrongVersionVerifier = fixtureVerifier({ allowedBundleVersions: ["2"] });
    await assert.rejects(
      verifyOfficialFixture(wrongVersionVerifier),
      (error) => error.code === "app_attest_invalid"
    );
  });

  it("rejects an environment mismatch", async () => {
    const developmentVerifier = createAppAttestVerifier({
      appIdPrefix: "1234567890",
      bundleId: "com.example.myapp",
      environment: "development",
      allowedValidationCategories: [1],
      allowedBundleVersions: ["1"]
    });
    await assert.rejects(
      developmentVerifier.verifyAttestation({
        attestationObject: Buffer.from(APPLE_APP_ATTEST_FIXTURE.attestationObject, "base64"),
        keyId: APPLE_APP_ATTEST_FIXTURE.keyId,
        clientDataHash: Buffer.from(APPLE_APP_ATTEST_FIXTURE.challenge),
        now: new Date("2026-04-21T12:00:00.000Z")
      }),
      (error) => error.code === "app_attest_environment_mismatch"
    );
  });

  it("verifies assertion signatures, RP identity, metadata, and increasing counters", async () => {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const clientData = Buffer.from("canonical-client-data");
    const assertionObject = assertionFixture({ keys, clientData, counter: 4 });
    const result = await verifier.verifyAssertion({
      assertionObject,
      publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }),
      clientData,
      previousCounter: 3
    });
    assert.deepEqual(result, { counter: 4, validationCategory: 1, bundleVersion: "1" });

    await assert.rejects(
      verifier.verifyAssertion({
        assertionObject,
        publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }),
        clientData,
        previousCounter: 4
      }),
      (error) => error.code === "app_attest_counter_replayed"
    );
  });

  it("rejects an invalid assertion signature", async () => {
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const clientData = Buffer.from("canonical-client-data");
    const assertion = decode(assertionFixture({ keys, clientData, counter: 1 }));
    const invalidSignature = Buffer.from(assertion.get("signature"));
    invalidSignature[invalidSignature.length - 1] ^= 0x01;
    assertion.set("signature", invalidSignature);
    const assertionObject = encode(assertion);
    await assert.rejects(
      verifier.verifyAssertion({
        assertionObject,
        publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }),
        clientData,
        previousCounter: 0
      }),
      (error) => error.code === "app_attest_invalid"
    );
  });
});

function assertionFixture({ keys, clientData, counter }) {
  const counterBytes = Buffer.alloc(4);
  counterBytes.writeUInt32BE(counter);
  const category = Buffer.alloc(4);
  category.writeUInt32LE(1);
  const extensions = encode(new Map([
    ["validationCategory", category],
    ["bundleVersion", "1"]
  ]));
  const authenticatorData = Buffer.concat([
    sha256(Buffer.from("1234567890.com.example.myapp")),
    Buffer.from([0]),
    counterBytes,
    extensions
  ]);
  const nonce = sha256(Buffer.concat([authenticatorData, sha256(clientData)]));
  const signature = sign("sha256", nonce, keys.privateKey);
  return encode(new Map([
    ["signature", signature],
    ["authenticatorData", authenticatorData]
  ]));
}

function fixtureVerifier(overrides = {}) {
  return createAppAttestVerifier({
    appIdPrefix: "1234567890",
    bundleId: "com.example.myapp",
    environment: "production",
    allowedValidationCategories: [1],
    allowedBundleVersions: ["1"],
    ...overrides
  });
}

function verifyOfficialFixture(targetVerifier, overrides = {}) {
  return targetVerifier.verifyAttestation({
    attestationObject: Buffer.from(APPLE_APP_ATTEST_FIXTURE.attestationObject, "base64"),
    keyId: APPLE_APP_ATTEST_FIXTURE.keyId,
    clientDataHash: Buffer.from(APPLE_APP_ATTEST_FIXTURE.challenge, "utf8"),
    now: new Date("2026-04-21T12:00:00.000Z"),
    ...overrides
  });
}

function mutateAttestation(mutation) {
  const decoded = fixtureDecoder.decode(Buffer.from(APPLE_APP_ATTEST_FIXTURE.attestationObject, "base64"));
  mutation(decoded);
  return encode(decoded);
}
