import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import {
  ASSERTION_IDS,
  atomicWriteFile,
  buildReadinessContract,
  canonicalJson,
  catalogAssertionProgramSha256,
  compileExpectedManifest,
  DEFAULT_DECLARATION_PATH,
  runCatalogAssertions,
  strictParseJson,
  validateExpectedManifest
} from "../src/operations/stagingPrerequisitesV3/index.js";

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const path = temporaryDirectories.pop();
    if (path.startsWith(`${tmpdir()}/trailmind-prereq-v3-`)) {
      rmSync(path, { force: true, recursive: true });
    }
  }
});

describe("staging prerequisites v3 strict contracts", () => {
  it("rejects duplicate JSON keys, precision loss, and lone surrogates", () => {
    assert.throws(() => strictParseJson('{"a":1,"a":2}'), hasCode("json_duplicate_key"));
    assert.throws(() => strictParseJson('{"n":9007199254740993}'),
      hasCode("json_integer_precision"));
    assert.throws(() => strictParseJson('{"s":"\\ud800"}'), hasCode("json_string"));
  });

  it("canonicalizes object keys while manifest arrays remain order-sensitive", () => {
    assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
    assert.throws(() => canonicalJson({ value: 9_007_199_254_740_992 }),
      hasCode("canonical_number"));
    assert.throws(() => canonicalJson({ ["\ud800"]: true }),
      hasCode("canonical_key"));
    const compiled = compileExpectedManifest({ repositoryRoot: ".." });
    const changed = structuredClone(compiled.manifest);
    [changed.catalog.indexes[0], changed.catalog.indexes[1]] =
      [changed.catalog.indexes[1], changed.catalog.indexes[0]];
    assert.throws(() => validateExpectedManifest(changed), hasCode("index_order"));
  });

  it("publishes restrictive files without overwrite or symlink traversal", () => {
    const directory = temporaryDirectory();
    const destination = join(directory, "candidate.json");
    atomicWriteFile(destination, Buffer.from("candidate\n"), { mode: 0o600 });
    assert.equal(readFileSync(destination, "utf8"), "candidate\n");
    assert.equal(lstatSync(destination).mode & 0o777, 0o600);
    assert.throws(() => atomicWriteFile(destination, Buffer.from("replacement")),
      hasCode("write_overwrite"));
    const link = join(directory, "link.json");
    symlinkSync(destination, link);
    assert.throws(() => atomicWriteFile(link, Buffer.from("replacement")),
      hasCode("write_overwrite"));
  });

  it("compiles a deterministic offline manifest and verifies every source digest", () => {
    const first = compileExpectedManifest({ repositoryRoot: ".." });
    const second = compileExpectedManifest({ repositoryRoot: ".." });
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.canonical, second.canonical);
    assert.equal(first.manifest.migrationLedger.length, 9);
    assert.deepEqual(first.manifest.migrationLedger.map(({ id }) => id),
      ["001", "002", "003", "004", "005", "006", "007", "009", "010"]);
    assert.equal(first.manifest.migrationProfile.profileId,
      "supabase_phase1_v2");
    assert.equal(first.manifest.assertions.length, ASSERTION_IDS.length);
  });

  it("fails closed when a reviewed source digest drifts or is unavailable", async () => {
    const directory = temporaryDirectory();
    const declaration = strictParseJson(await readFile(DEFAULT_DECLARATION_PATH));
    const originalSourceSha256 = declaration.sourceFiles[0].sha256;
    declaration.sourceFiles[0].sha256 = "0".repeat(64);
    const path = join(directory, "declaration.json");
    await writeFile(path, `${canonicalJson(declaration)}\n`, { mode: 0o600 });
    assert.throws(
      () => compileExpectedManifest({ declarationPath: path, repositoryRoot: ".." }),
      hasCode("source_digest_drift")
    );
    declaration.sourceFiles[0].sha256 = originalSourceSha256;
    declaration.sourceFiles.at(-1).path =
      "docs/operations/staging-v1/database/PHASE_1_PRE_MIGRATION_V2_UNAVAILABLE.sql";
    await writeFile(path, `${canonicalJson(declaration)}\n`, { mode: 0o600 });
    assert.throws(
      () => compileExpectedManifest({ declarationPath: path, repositoryRoot: ".." }),
      hasCode("file_unavailable")
    );
  });

  it("runs one bounded read-only transaction and accepts only the exact result", async () => {
    const compiled = compileExpectedManifest({ repositoryRoot: ".." });
    const calls = [];
    const client = {
      async query(request) {
        calls.push(request);
        if (typeof request === "object") {
          return { rows: ASSERTION_IDS.map((id) => ({ id, pass: true })) };
        }
        return { rows: [] };
      }
    };
    const result = await runCatalogAssertions({
      client,
      expectedManifest: compiled.manifest
    });
    assert.equal(result.status, "pass");
    assert.match(result.resultSha256, /^[a-f0-9]{64}$/);
    assert.equal(calls[0],
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(calls.at(-1), "ROLLBACK");
    assert.equal(calls.filter((call) => typeof call === "object").length, 1);
  });

  it("rejects false, duplicate, unknown, reordered, or non-boolean assertions", async () => {
    const compiled = compileExpectedManifest({ repositoryRoot: ".." });
    for (const mutate of [
      (rows) => { rows[0].pass = false; },
      (rows) => { rows[1].id = rows[0].id; },
      (rows) => { rows[0].id = "unknown"; },
      (rows) => { [rows[0], rows[1]] = [rows[1], rows[0]]; },
      (rows) => { rows[0].pass = "true"; }
    ]) {
      const rows = ASSERTION_IDS.map((id) => ({ id, pass: true }));
      mutate(rows);
      const client = {
        async query(request) {
          return typeof request === "object" ? { rows } : { rows: [] };
        }
      };
      await assert.rejects(
        runCatalogAssertions({ client, expectedManifest: compiled.manifest }),
        (error) => error?.status === "blocked"
      );
    }
  });

  it("produces stable candidate pins but keeps the honest default not_ready", () => {
    const first = buildReadinessContract({ repositoryRoot: ".." });
    const second = buildReadinessContract({ repositoryRoot: ".." });
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.contract.status, "not_ready");
    assert.equal(first.contract.issueCodes.length, 5);
    assert.equal(
      first.contract.candidateEvidence.independentCatalogAssertionProgramSha256,
      catalogAssertionProgramSha256()
    );
    assert.equal(first.contract.externalLimitations.exactInvoiceOrUsageEstablished,
      false);
    assert.equal(first.contract.externalLimitations.advisorCausalFreshnessEstablished,
      false);
  });
});

function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), "trailmind-prereq-v3-"));
  chmodSync(path, 0o700);
  temporaryDirectories.push(path);
  return path;
}

function hasCode(code) {
  return (error) => error?.code === code;
}
