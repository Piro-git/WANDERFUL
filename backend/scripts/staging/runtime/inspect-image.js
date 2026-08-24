import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXPECTED_USER = "65532:65532";
const EXPECTED_NODE_VERSION = "v22.23.2";
const EXPECTED_ENTRYPOINT = Object.freeze(["node"]);
const EXPECTED_COMMAND = Object.freeze(["container/start.js"]);
const EXPECTED_HEALTHCHECK = Object.freeze(["CMD", "node", "container/healthcheck.js"]);
const ALLOWED_APP_ROOTS = new Set(["config", "container", "node_modules", "package.json", "src"]);
const FORBIDDEN_APP_NAMES = /(?:^|\/)(?:\.env(?:\..*)?|[^/]*\.xcconfig|[^/]*\.pbf|test|tests|fixtures|logs?)(?:\/|$)/i;
const OFF_LIMITS_PRODUCTION_PROJECT_REF_SHA256 =
  "730c9715a50e01394edff472b079a0742e6c34159c51329032d0bb8e8d7aa6b7";
const SECRET_PATTERNS = Object.freeze([
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i,
  /\b(?:eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{16,})\b/,
  /\b(?:sb_secret_|sk-or-v1-)[a-zA-Z0-9_-]{16,}\b/
]);

export async function inspectImage(imageReference, options = {}) {
  if (typeof imageReference !== "string" || imageReference.length < 1) {
    throw new TypeError("image_reference_required");
  }
  const exec = options.execFileSync ?? execFileSync;
  const temporary = await mkdtemp(join(tmpdir(), "trailmind-image-inspection-"));
  try {
    const metadata = JSON.parse(exec(
      "docker", ["image", "inspect", imageReference, "--format", "{{json .}}"],
      { encoding: "utf8", maxBuffer: 4 * 1_024 * 1_024 }
    ));
    const failures = [];
    if (metadata.Config?.User !== EXPECTED_USER) failures.push("runtime_user");
    if (!sameArray(metadata.Config?.Entrypoint, EXPECTED_ENTRYPOINT)) failures.push("entrypoint");
    if (!sameArray(metadata.Config?.Cmd, EXPECTED_COMMAND)) failures.push("command");
    if (!sameArray(metadata.Config?.Healthcheck?.Test, EXPECTED_HEALTHCHECK)) {
      failures.push("healthcheck");
    }
    const staticEnvironment = new Map((metadata.Config?.Env ?? []).map((entry) => {
      const separator = entry.indexOf("=");
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }));
    if (staticEnvironment.get("NODE_ENV") !== "production") failures.push("node_environment");
    if (staticEnvironment.get("NODE_VERSION") !== EXPECTED_NODE_VERSION.slice(1)) {
      failures.push("node_version");
    }
    for (const name of [
      "ROUTE_PROVIDER_ENABLED", "INTENT_PROVIDER_ENABLED",
      "OUTDOOR_EVIDENCE_PROVIDER_ENABLED", "OUTDOOR_RESEARCH_PLANNING_ENABLED",
      "OUTDOOR_ROUTABLE_HIGHLIGHT_ACCESS_ENABLED", "ROUTE_ALLOW_INSECURE_LOCAL_ROUTING",
      "INTENT_ALLOW_INSECURE_LOCAL_PARSING", "INTENT_ALLOW_DETERMINISTIC_MOCK",
      "OUTDOOR_RESEARCH_PLANNING_ALLOW_INSECURE_LOCAL", "APP_ATTEST_ALLOW_IN_MEMORY"
    ]) {
      if (staticEnvironment.get(name) !== "false") failures.push("feature_flag_default");
    }
    if ([...staticEnvironment.keys()].some((name) =>
      /(?:DATABASE_URL|API_KEY|SECRET|PASSWORD|TOKEN)$/i.test(name)
    )) failures.push("baked_secret_environment");
    for (const name of [
      "NODE_OPTIONS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS",
      "NODE_DEBUG", "PGOPTIONS", "PGSERVICE", "PGSERVICEFILE"
    ]) {
      if (staticEnvironment.has(name)) failures.push("unsafe_process_environment");
    }
    const observedNodeVersion = exec(
      "docker",
      ["run", "--rm", "--network", "none", "--entrypoint", "node", imageReference, "--version"],
      { encoding: "utf8", maxBuffer: 1_024 * 1_024 }
    ).trim();
    if (observedNodeVersion !== EXPECTED_NODE_VERSION) failures.push("node_version");

    const archive = join(temporary, "filesystem.tar");
    const containerId = exec("docker", ["create", imageReference], {
      encoding: "utf8", maxBuffer: 1_024 * 1_024
    }).trim();
    try {
      exec("docker", ["export", "--output", archive, containerId], {
        encoding: "utf8", maxBuffer: 1_024 * 1_024
      });
    } finally {
      exec("docker", ["container", "rm", containerId], {
        encoding: "utf8", maxBuffer: 1_024 * 1_024
      });
    }
    const filesystem = join(temporary, "filesystem");
    exec("mkdir", [filesystem], { encoding: "utf8" });
    exec("tar", ["-xf", archive, "-C", filesystem], {
      encoding: "utf8", maxBuffer: 8 * 1_024 * 1_024
    });
    const appRoot = join(filesystem, "app");
    const appEntries = await readdir(appRoot);
    if (appEntries.some((entry) => !ALLOWED_APP_ROOTS.has(entry))) failures.push("image_content");
    const appRootMetadata = await lstat(appRoot);
    if (runtimeCanWrite(appRootMetadata)) failures.push("writable_application_content");
    for (const entry of await entriesBelow(appRoot)) {
      if (entry.metadata.isSymbolicLink()) {
        failures.push("forbidden_artifact");
        continue;
      }
      if (runtimeCanWrite(entry.metadata)) failures.push("writable_application_content");
      if (!entry.metadata.isFile()) continue;
      const file = entry.name;
      if (FORBIDDEN_APP_NAMES.test(file)) {
        failures.push("forbidden_artifact");
        continue;
      }
      const content = await readFile(join(appRoot, file));
      const includeDatabaseUrls = !file.startsWith("node_modules/");
      if (isText(content) && containsCredentialPattern(
        content.toString("utf8"),
        includeDatabaseUrls
      )) {
        failures.push("credential_pattern");
      }
    }
    return Object.freeze({
      schemaVersion: 1,
      decision: failures.length === 0 ? "pass" : "fail",
      imageId: safeDigest(metadata.Id),
      repositoryDigests: Object.freeze((metadata.RepoDigests ?? []).map(safeDigest).filter(Boolean).sort()),
      nodeVersion: observedNodeVersion,
      runtimeUser: metadata.Config?.User,
      applicationRootCount: appEntries.length,
      failureCategories: Object.freeze([...new Set(failures)].sort())
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function entriesBelow(root, directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = path.slice(root.length + 1);
    const metadata = await lstat(path);
    result.push({ name, metadata });
    if (metadata.isDirectory()) result.push(...await entriesBelow(root, path));
  }
  return result;
}

function runtimeCanWrite(metadata) {
  const permissions = metadata.mode & 0o777;
  return (
    (metadata.uid === 65_532 && (permissions & 0o200) !== 0) ||
    (metadata.gid === 65_532 && (permissions & 0o020) !== 0) ||
    (permissions & 0o002) !== 0
  );
}

function sameArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function safeDigest(value) {
  const digest = String(value ?? "").match(/sha256:[0-9a-f]{64}/i)?.[0];
  return digest?.toLowerCase();
}

function isText(buffer) {
  return !buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0);
}

function containsCredentialPattern(text, includeDatabaseUrls) {
  const patterns = includeDatabaseUrls ? SECRET_PATTERNS : SECRET_PATTERNS.slice(1);
  if (patterns.some((pattern) => pattern.test(text))) return true;
  for (const candidate of text.matchAll(/\b[a-z]{20}\b/gi)) {
    if (createHash("sha256").update(candidate[0].toLowerCase()).digest("hex") ===
      OFF_LIMITS_PRODUCTION_PROJECT_REF_SHA256) return true;
  }
  return false;
}

const imageReference = process.argv[2];
try {
  const report = await inspectImage(imageReference);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.decision !== "pass") process.exitCode = 1;
} catch {
  process.stdout.write('{"schemaVersion":1,"decision":"blocked","reason":"image_inspection_unavailable"}\n');
  process.exitCode = 1;
}
