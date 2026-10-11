import { X509Certificate, randomUUID } from "node:crypto";
import { writeFileSync, renameSync, rmSync } from "node:fs";

export const VERCEL_DATABASE_CA_PATH = "/tmp/wanderful-app-attest-ca.pem";

// The CA is a public trust anchor supplied from the selected database's
// authenticated dashboard, never a private key or an administrative DSN.
export function prepareVercelDatabaseCA(env, options = {}) {
  const pem = env.APP_ATTEST_DATABASE_CA_PEM;
  const fingerprint = env.APP_ATTEST_DATABASE_CA_SHA256;
  if (pem === undefined && fingerprint === undefined) return;
  const invalid = () => { throw new Error("database_ca_configuration_invalid"); };
  if (typeof pem !== "string" || Buffer.byteLength(pem) > 32768 ||
      !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\s*$/.test(pem.trim()) ||
      typeof fingerprint !== "string" || !/^[a-fA-F0-9]{64}$/.test(fingerprint)) invalid();
  let certificate;
  try { certificate = new X509Certificate(pem); } catch { invalid(); }
  const now = options.now ?? Date.now();
  if (!certificate.ca || certificate.fingerprint256.replaceAll(":", "").toLowerCase() !== fingerprint.toLowerCase() ||
      !(Date.parse(certificate.validFrom) <= now && now < Date.parse(certificate.validTo))) invalid();
  const url = new URL(env.APP_ATTEST_DATABASE_URL);
  if (url.searchParams.getAll("sslrootcert").length !== 1 ||
      url.searchParams.get("sslrootcert") !== VERCEL_DATABASE_CA_PATH) invalid();
  const fs = options.fs ?? { writeFileSync, renameSync, rmSync };
  const temporary = `${VERCEL_DATABASE_CA_PATH}.${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, certificate.toString(), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, VERCEL_DATABASE_CA_PATH);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
