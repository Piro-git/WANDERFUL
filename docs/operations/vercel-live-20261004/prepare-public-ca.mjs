import {createHash, X509Certificate} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareVercelDatabaseCA, VERCEL_DATABASE_CA_PATH} from '../../../backend/src/operations/vercelDatabaseCA.js';

// Operator-supplied PUBLIC certificate only. No credential access, network,
// database connection, Vercel mutation, or inferred project provenance.
export function inspectPublicDatabaseCA(pem, {now = Date.now()} = {}) {
  try {
    if(typeof pem !== 'string' || Buffer.byteLength(pem) > 32768 ||
      !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\s*$/.test(pem.trim())) throw Error();
    const certificate = new X509Certificate(pem);
    const fingerprint = createHash('sha256').update(certificate.raw).digest('hex');
    let normalizedPEM;
    prepareVercelDatabaseCA({APP_ATTEST_DATABASE_CA_PEM: pem, APP_ATTEST_DATABASE_CA_SHA256: fingerprint,
      // No password. Used solely for the existing adapter's path validation;
      // prepareVercelDatabaseCA does not connect to this URL.
      APP_ATTEST_DATABASE_URL: `postgresql://app_security_runtime_role@db.mbvzwsrtqcrwhvykugcd.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=${VERCEL_DATABASE_CA_PATH}`
    }, {now, fs: {
      writeFileSync(_path, value) {normalizedPEM = value;},
      renameSync() {}, rmSync() {}
    }});
    return {normalizedPEM, fingerprintDER_SHA256: fingerprint, validFrom: certificate.validFrom,
      validTo: certificate.validTo, runtimeCertificateValidationPassed: true,
      authenticatedProjectProvenanceVerified: false, databaseTLSAdmissionVerified: false};
  } catch {throw new Error('public_ca_invalid');}
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [sourcePath, outputPath, ...extra] = process.argv.slice(2);
    if(!sourcePath || !outputPath || extra.length) throw Error();
    const {normalizedPEM, ...receipt} = inspectPublicDatabaseCA(readFileSync(sourcePath, 'utf8'));
    // Public CA output is never overwritten. Caller explicitly supplies both paths.
    writeFileSync(outputPath, normalizedPEM, {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify({...receipt, publicCAOutputPath: resolve(outputPath)}));
  } catch {console.error('public_ca_preparation_failed'); process.exitCode = 1;}
}
