import {
  createPublicKey,
  verify as verifySignature,
  webcrypto,
  X509Certificate as NodeX509Certificate
} from "node:crypto";
import { Constructed, fromBER, ObjectIdentifier, OctetString, Sequence } from "asn1js";
import { Decoder } from "cbor-x/decode-no-eval";
import {
  Certificate,
  CertificateChainValidationEngine,
  CryptoEngine,
  setEngine
} from "pkijs";
import { APPLE_APP_ATTESTATION_ROOT_PEM } from "./appleAppAttestationRoot.js";
import { appAttestError } from "./appAttestErrors.js";
import {
  decodeBase64,
  equalBytes,
  sha256
} from "./clientData.js";

const APP_ATTEST_NONCE_OID = "1.2.840.113635.100.8.2";
const DEVELOPMENT_AAGUID = Buffer.from("appattestdevelop", "ascii");
const PRODUCTION_AAGUID = Buffer.concat([Buffer.from("appattest", "ascii"), Buffer.alloc(7)]);
const VALIDATION_CATEGORY_KEYS = ["apple_validation_category_01", "validationCategory"];
const BUNDLE_VERSION_KEYS = ["apple_bundle_version_01", "bundleVersion"];
const decoder = new Decoder({ mapsAsObjects: false, useRecords: false, structuredClone: false });
setEngine("node-webcrypto", new CryptoEngine({
  name: "node-webcrypto",
  crypto: webcrypto,
  subtle: webcrypto.subtle
}));

export function createAppAttestVerifier(configuration) {
  const config = validateVerifierConfiguration(configuration);
  const expectedRpIdHash = sha256(Buffer.from(`${config.appIdPrefix}.${config.bundleId}`, "utf8"));
  const expectedAaguid = config.environment === "development"
    ? DEVELOPMENT_AAGUID
    : PRODUCTION_AAGUID;
  const rootNode = new NodeX509Certificate(APPLE_APP_ATTESTATION_ROOT_PEM);
  const rootCertificate = Certificate.fromBER(rootNode.raw);

  return {
    configuration: config,

    async verifyAttestation({ attestationObject, keyId, clientDataHash, now = new Date() }) {
      try {
        const keyIdBytes = decodeBase64(keyId, { expectedLength: 32, maxLength: 64 });
        const decoded = decodeCborMap(attestationObject, 128 * 1_024);
        requireExactKeys(decoded, ["fmt", "attStmt", "authData"]);
        if (decoded.get("fmt") !== "apple-appattest") invalid();

        const statement = requireMap(decoded.get("attStmt"));
        requireExactKeys(statement, ["x5c", "receipt"]);
        const certificateBuffers = statement.get("x5c");
        const receipt = requireBytes(statement.get("receipt"), 1, 128 * 1_024);
        if (!Array.isArray(certificateBuffers) || certificateBuffers.length < 2 || certificateBuffers.length > 5) {
          invalid();
        }
        const certificates = certificateBuffers.map((value) =>
          new NodeX509Certificate(requireBytes(value, 64, 16 * 1_024))
        );
        await verifyCertificateChain(certificateBuffers, rootCertificate, now);

        const authenticatorData = requireBytes(decoded.get("authData"), 55, 8 * 1_024);
        const parsed = parseAuthenticatorData(authenticatorData, { attestation: true });
        if (!equalBytes(parsed.rpIdHash, expectedRpIdHash) || parsed.counter !== 0) invalid();
        if (!equalBytes(parsed.aaguid, expectedAaguid)) {
          throw appAttestError("app_attest_environment_mismatch");
        }
        if (!equalBytes(parsed.credentialId, keyIdBytes)) invalid();

        const leafNode = certificates[0];
        const publicKeyPoint = rawP256PublicKey(leafNode);
        if (!equalBytes(sha256(publicKeyPoint), keyIdBytes)) invalid();
        verifyCosePublicKey(parsed.credentialPublicKey, publicKeyPoint);

        const nonce = sha256(Buffer.concat([
          authenticatorData,
          requireBytes(clientDataHash, 1, 64)
        ]));
        const nonceExtension = certificateExtension(leafNode, APP_ATTEST_NONCE_OID);
        if (!nonceExtension || !equalBytes(parseSingleOctetString(nonceExtension), nonce)) invalid();

        const validationCategory = validationCategoryFrom(parsed.extensions);
        const bundleVersion = bundleVersionFrom(parsed.extensions);
        verifyApplicationMetadata(config, validationCategory, bundleVersion);

        return {
          publicKeyPem: leafNode.publicKey.export({ type: "spki", format: "pem" }),
          receipt: Buffer.from(receipt),
          environment: config.environment,
          counter: 0,
          validationCategory,
          bundleVersion
        };
      } catch (error) {
        if (error?.code?.startsWith?.("app_attest_")) throw error;
        throw appAttestError("app_attest_invalid", { cause: error });
      }
    },

    async verifyAssertion({ assertionObject, publicKeyPem, clientData, previousCounter }) {
      try {
        const decoded = decodeCborMap(assertionObject, 16 * 1_024);
        requireExactKeys(decoded, ["signature", "authenticatorData"]);
        const signature = requireBytes(decoded.get("signature"), 8, 512);
        const authenticatorData = requireBytes(decoded.get("authenticatorData"), 37, 8 * 1_024);
        const parsed = parseAuthenticatorData(authenticatorData, { attestation: false });

        if (!equalBytes(parsed.rpIdHash, expectedRpIdHash)) invalid();
        if (!Number.isInteger(previousCounter) || parsed.counter <= previousCounter) {
          throw appAttestError("app_attest_counter_replayed");
        }
        const nonce = sha256(Buffer.concat([
          authenticatorData,
          sha256(requireBytes(clientData, 1, 8 * 1_024))
        ]));
        const publicKey = createPublicKey(publicKeyPem);
        if (!verifySignature("sha256", nonce, publicKey, signature)) invalid();

        const validationCategory = validationCategoryFrom(parsed.extensions);
        const bundleVersion = bundleVersionFrom(parsed.extensions);
        verifyApplicationMetadata(config, validationCategory, bundleVersion);
        return { counter: parsed.counter, validationCategory, bundleVersion };
      } catch (error) {
        if (error?.code?.startsWith?.("app_attest_")) throw error;
        throw appAttestError("app_attest_invalid", { cause: error });
      }
    }
  };
}

export function appAttestVerifierConfiguration(env = process.env) {
  return validateVerifierConfiguration({
    appIdPrefix: env.APP_ATTEST_APP_ID_PREFIX,
    bundleId: env.APP_ATTEST_BUNDLE_ID,
    environment: env.APP_ATTEST_ENVIRONMENT,
    allowedValidationCategories: commaSeparatedIntegers(env.APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES),
    allowedBundleVersions: commaSeparatedStrings(env.APP_ATTEST_ALLOWED_BUNDLE_VERSIONS)
  });
}

async function verifyCertificateChain(supplied, root, now) {
  const engine = new CertificateChainValidationEngine({
    trustedCerts: [root],
    certs: supplied.map((certificate) => Certificate.fromBER(Buffer.from(certificate))),
    checkDate: now
  });
  const result = await engine.verify({ passedWhenNotRevValues: true });
  if (!result.result) invalid();
}

function parseAuthenticatorData(data, { attestation }) {
  if (data.length < 37) invalid();
  const flags = data[32];
  const counter = data.readUInt32BE(33);
  if (!attestation) {
    if ((flags & 0x40) !== 0) invalid();
    const remainder = data.subarray(37);
    const extensions = parseAuthenticatorExtensions(remainder, flags);
    return { rpIdHash: data.subarray(0, 32), counter, extensions };
  }

  if ((flags & 0x40) === 0 || data.length < 55) invalid();
  const credentialLength = data.readUInt16BE(53);
  const credentialEnd = 55 + credentialLength;
  if (credentialLength !== 32 || credentialEnd >= data.length) invalid();
  const cborValues = decodeCborSequence(data.subarray(credentialEnd), 2);
  // Current App Attest objects append the application metadata dictionary even
  // when the WebAuthn ED flag isn't set (as demonstrated by Apple's 2026 fixture).
  if (cborValues.length !== 2) invalid();
  const credentialPublicKey = requireMap(cborValues[0]);
  const extensions = requireMap(cborValues[1]);
  return {
    rpIdHash: data.subarray(0, 32),
    counter,
    aaguid: data.subarray(37, 53),
    credentialId: data.subarray(55, credentialEnd),
    credentialPublicKey,
    extensions
  };
}

function parseAuthenticatorExtensions(remainder, flags) {
  if (remainder.length === 0) invalid();
  const values = decodeCborSequence(remainder, 1);
  return requireMap(values[0]);
}

function verifyCosePublicKey(cose, rawPublicKey) {
  requireExactKeys(cose, [1, 3, -1, -2, -3]);
  if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) invalid();
  const x = requireBytes(cose.get(-2), 32, 32);
  const y = requireBytes(cose.get(-3), 32, 32);
  if (!equalBytes(Buffer.concat([Buffer.from([0x04]), x, y]), rawPublicKey)) invalid();
}

function rawP256PublicKey(certificate) {
  const jwk = certificate.publicKey.export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) invalid();
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.length !== 32 || y.length !== 32) invalid();
  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

function parseSingleOctetString(value) {
  const result = fromBER(Buffer.from(value));
  if (result.offset === -1 || result.offset !== value.byteLength || !(result.result instanceof Sequence)) invalid();
  const items = result.result.valueBlock.value;
  if (
    items.length !== 1 || !(items[0] instanceof Constructed) ||
    items[0].idBlock.tagClass !== 3 || items[0].idBlock.tagNumber !== 1
  ) invalid();
  const wrappedItems = items[0].valueBlock.value;
  if (wrappedItems.length !== 1 || !(wrappedItems[0] instanceof OctetString)) invalid();
  return Buffer.from(wrappedItems[0].getValue());
}

function certificateExtension(certificate, oid) {
  const decoded = fromBER(certificate.raw);
  if (decoded.offset !== certificate.raw.byteLength || !(decoded.result instanceof Sequence)) invalid();
  const certificateFields = decoded.result.valueBlock.value;
  if (certificateFields.length !== 3 || !(certificateFields[0] instanceof Sequence)) invalid();
  const tbsFields = certificateFields[0].valueBlock.value;
  const extensionsWrapper = tbsFields.find((field) =>
    field instanceof Constructed && field.idBlock.tagClass === 3 && field.idBlock.tagNumber === 3
  );
  const extensions = extensionsWrapper?.valueBlock.value;
  if (extensions?.length !== 1 || !(extensions[0] instanceof Sequence)) invalid();
  for (const candidate of extensions[0].valueBlock.value) {
    if (!(candidate instanceof Sequence)) invalid();
    const fields = candidate.valueBlock.value;
    if (fields.length < 2 || fields.length > 3 || !(fields[0] instanceof ObjectIdentifier)) invalid();
    if (fields[0].getValue() !== oid) continue;
    const value = fields.at(-1);
    if (!(value instanceof OctetString)) invalid();
    return Buffer.from(value.getValue());
  }
  return undefined;
}

function validationCategoryFrom(extensions) {
  const encodedValue = firstExtensionValue(extensions, VALIDATION_CATEGORY_KEYS);
  const value = Buffer.isBuffer(encodedValue) || encodedValue instanceof Uint8Array
    ? parseValidationCategoryBytes(encodedValue)
    : encodedValue;
  if (!Number.isInteger(value) || value < 1 || value > 10 || [7, 8, 9].includes(value)) invalid();
  return value;
}

function parseValidationCategoryBytes(value) {
  const bytes = Buffer.from(value);
  if (bytes.length !== 4) invalid();
  return bytes.readUInt32LE(0);
}

function bundleVersionFrom(extensions) {
  const value = firstExtensionValue(extensions, BUNDLE_VERSION_KEYS);
  if (typeof value !== "string" || value.length === 0 || value.length > 64) invalid();
  return value;
}

function firstExtensionValue(extensions, keys) {
  const matches = keys.filter((key) => extensions.has(key));
  if (matches.length !== 1) invalid();
  return extensions.get(matches[0]);
}

function verifyApplicationMetadata(config, validationCategory, bundleVersion) {
  if (!config.allowedValidationCategories.includes(validationCategory)) invalid();
  if (!config.allowedBundleVersions.includes(bundleVersion)) invalid();
}

function decodeCborMap(value, maximumLength) {
  return requireMap(decoder.decode(requireBytes(value, 1, maximumLength)));
}

function decodeCborSequence(value, maximumValues) {
  const buffer = requireBytes(value, 1, 16 * 1_024);
  let values;
  try {
    values = decoder.decodeMultiple(buffer);
  } catch (error) {
    throw appAttestError("app_attest_invalid", { cause: error });
  }
  if (!Array.isArray(values) || values.length === 0 || values.length > maximumValues) invalid();
  return values;
}

function requireMap(value) {
  if (!(value instanceof Map)) invalid();
  return value;
}

function requireExactKeys(map, keys) {
  if (map.size !== keys.length || keys.some((key) => !map.has(key))) invalid();
}

function requireBytes(value, minimumLength, maximumLength) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) invalid();
  const result = Buffer.from(value);
  if (result.length < minimumLength || result.length > maximumLength) invalid();
  return result;
}

function validateVerifierConfiguration(configuration = {}) {
  const appIdPrefix = requiredConfigurationString(configuration.appIdPrefix, 128);
  const bundleId = requiredConfigurationString(configuration.bundleId, 255);
  const environment = configuration.environment;
  if (environment !== "development" && environment !== "production") unavailable();
  const allowedValidationCategories = configuration.allowedValidationCategories;
  const allowedBundleVersions = configuration.allowedBundleVersions;
  if (
    !Array.isArray(allowedValidationCategories) || allowedValidationCategories.length === 0 ||
    allowedValidationCategories.some((value) => !Number.isInteger(value) || value < 1 || value > 10 || [7, 8, 9].includes(value)) ||
    !Array.isArray(allowedBundleVersions) || allowedBundleVersions.length === 0 ||
    allowedBundleVersions.some((value) => typeof value !== "string" || value.length === 0 || value.length > 64)
  ) {
    unavailable();
  }
  return {
    appIdPrefix,
    bundleId,
    environment,
    allowedValidationCategories: [...new Set(allowedValidationCategories)],
    allowedBundleVersions: [...new Set(allowedBundleVersions)]
  };
}

function requiredConfigurationString(value, maximumLength) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > maximumLength || /\s/.test(result)) unavailable();
  return result;
}

function commaSeparatedIntegers(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(",").map((item) => Number(item.trim()));
}

function commaSeparatedStrings(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function invalid() {
  throw appAttestError("app_attest_invalid");
}

function unavailable() {
  throw appAttestError("authorization_unavailable");
}
