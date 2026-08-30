import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSERTION_IDS,
  AUDITOR_ROLE,
  EXPECTED_MANIFEST_SCHEMA_VERSION,
  HEX_64,
  LIMITS,
  SAFE_ID,
  SQL_IDENTIFIER,
  TARGET_PROJECT_NAME
} from "./constants.js";
import {
  canonicalJson,
  exactKeys,
  sha256Bytes,
  strictParseJson
} from "./canonicalJson.js";
import { blocked } from "./errors.js";
import { readSafeRegularFile } from "./safeFiles.js";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DECLARATION_PATH = resolve(
  packageDirectory,
  "reviewed-declarations-v1.json"
);
const ROOT_KEYS = Object.freeze([
  "assertionIds", "auditor", "constraints", "contractId", "digestAlgorithm",
  "extensions", "functions", "indexes", "migrations", "policyTemplates",
  "relations", "roleRules", "schemas", "sourceFiles", "targetProjectName"
]);

export function compileExpectedManifest({
  declarationPath = DEFAULT_DECLARATION_PATH,
  repositoryRoot = resolve(packageDirectory, "../../../../")
} = {}) {
  const declarationBytes = readSafeRegularFile(resolve(declarationPath), {
    maximumBytes: LIMITS.manifestBytes
  });
  const declaration = strictParseJson(declarationBytes, {
    maximumBytes: LIMITS.manifestBytes
  });
  validateDeclaration(declaration);
  verifySourceFiles(declaration, resolve(repositoryRoot));
  const policies = expandPolicyTemplates(declaration.policyTemplates);
  const manifest = {
    assertions: declaration.assertionIds.map((id) => ({ expected: true, id })),
    auditor: cloneJson(declaration.auditor),
    catalog: {
      constraints: [...declaration.constraints],
      extensions: cloneJson(declaration.extensions),
      functions: cloneJson(declaration.functions),
      indexes: [...declaration.indexes],
      policies,
      relations: [...declaration.relations],
      roleRules: cloneJson(declaration.roleRules),
      schemas: cloneJson(declaration.schemas)
    },
    contractId: declaration.contractId,
    declarationSha256: sha256Bytes(declarationBytes),
    digestAlgorithm: "sha256",
    migrationLedger: cloneJson(declaration.migrations),
    schemaVersion: EXPECTED_MANIFEST_SCHEMA_VERSION,
    sourceFiles: cloneJson(declaration.sourceFiles),
    targetProjectName: declaration.targetProjectName
  };
  validateExpectedManifest(manifest);
  const canonical = canonicalJson(manifest);
  return Object.freeze({
    canonical,
    manifest: deepFreeze(manifest),
    sha256: sha256Bytes(canonical)
  });
}

export function validateExpectedManifest(manifest) {
  exactKeys(manifest, [
    "assertions", "auditor", "catalog", "contractId", "declarationSha256",
    "digestAlgorithm", "migrationLedger", "schemaVersion", "sourceFiles",
    "targetProjectName"
  ], "manifest_keys");
  if (manifest.schemaVersion !== EXPECTED_MANIFEST_SCHEMA_VERSION ||
      manifest.targetProjectName !== TARGET_PROJECT_NAME ||
      manifest.digestAlgorithm !== "sha256" ||
      !SAFE_ID.test(manifest.contractId) ||
      !HEX_64.test(manifest.declarationSha256)) blocked("manifest_header");
  exactKeys(manifest.catalog, [
    "constraints", "extensions", "functions", "indexes", "policies",
    "relations", "roleRules", "schemas"
  ], "manifest_catalog_keys");
  assertExactArray(
    manifest.assertions.map((item) => {
      exactKeys(item, ["expected", "id"], "manifest_assertion_keys");
      if (item.expected !== true) blocked("manifest_assertion_value");
      return item.id;
    }),
    ASSERTION_IDS,
    "manifest_assertion_order"
  );
  validateAuditor(manifest.auditor);
  validateMigrations(manifest.migrationLedger);
  validateSources(manifest.sourceFiles);
  validateCatalog(manifest.catalog);
  if (Buffer.byteLength(canonicalJson(manifest)) > LIMITS.manifestBytes) {
    blocked("manifest_size");
  }
  return manifest;
}

export function expectedManifestDigest(manifest) {
  validateExpectedManifest(manifest);
  return sha256Bytes(canonicalJson(manifest));
}

function validateDeclaration(value) {
  exactKeys(value, ROOT_KEYS, "declaration_keys");
  if (value.targetProjectName !== TARGET_PROJECT_NAME ||
      value.digestAlgorithm !== "sha256" || !SAFE_ID.test(value.contractId)) {
    blocked("declaration_header");
  }
  assertExactArray(value.assertionIds, ASSERTION_IDS, "declaration_assertions");
  validateAuditor(value.auditor);
  validateMigrations(value.migrations);
  validateSources(value.sourceFiles);
  validateCatalog({
    constraints: value.constraints,
    extensions: value.extensions,
    functions: value.functions,
    indexes: value.indexes,
    policies: expandPolicyTemplates(value.policyTemplates),
    relations: value.relations,
    roleRules: value.roleRules,
    schemas: value.schemas
  });
  validatePolicyTemplates(value.policyTemplates);
}

function validateAuditor(value) {
  exactKeys(value, [
    "applicationNamePattern", "connectionLimit", "directMemberships", "roleName"
  ], "auditor_keys");
  if (value.roleName !== AUDITOR_ROLE || value.connectionLimit !== 1 ||
      value.applicationNamePattern !==
        "^trailmind_p1v2_auditor_[a-f0-9]{32}$") blocked("auditor_contract");
  if (!Array.isArray(value.directMemberships) ||
      value.directMemberships.length !== 1) blocked("auditor_memberships");
  const membership = value.directMemberships[0];
  exactKeys(membership, [
    "adminOption", "inheritOption", "roleName", "setOption"
  ], "auditor_membership_keys");
  if (membership.roleName !== "pg_read_all_stats" ||
      membership.adminOption !== false || membership.inheritOption !== false ||
      membership.setOption !== true) blocked("auditor_memberships");
}

function validateMigrations(values) {
  if (!Array.isArray(values) || values.length !== 8) blocked("migration_count");
  values.forEach((item, index) => {
    exactKeys(item, ["id", "path", "sha256"], "migration_keys");
    const id = String(index + 1).padStart(3, "0");
    if (item.id !== id || typeof item.path !== "string" ||
        !item.path.startsWith(`backend/migrations/${id}_`) ||
        !item.path.endsWith(".sql") || !HEX_64.test(item.sha256)) {
      blocked("migration_identity");
    }
  });
  assertSortedUnique(values.map(({ path }) => path), "migration_order");
}

function validateSources(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 16) {
    blocked("source_files");
  }
  values.forEach((item) => {
    exactKeys(item, ["path", "sha256"], "source_file_keys");
    if (typeof item.path !== "string" || !HEX_64.test(item.sha256) ||
        !item.path.startsWith("docs/operations/staging-v1/") ||
        item.path.includes("..") || item.path.includes("\\")) {
      blocked("source_file_identity");
    }
  });
  assertSortedUnique(values.map(({ path }) => path), "source_file_order");
}

function validateCatalog(catalog) {
  for (const [name, values] of Object.entries(catalog)) {
    if (!Array.isArray(values) || values.length > LIMITS.arrayItems) {
      blocked(`catalog_${name}_bound`);
    }
  }
  validateIdentityArray(catalog.constraints, "constraint");
  validateIdentityArray(catalog.indexes, "index");
  validateRelations(catalog.relations);
  catalog.extensions.forEach((item) => {
    exactKeys(item, [
      "allowedOwners", "name", "schema", "schemaOwner"
    ], "extension_keys");
    assertSqlName(item.name, "extension_name");
    assertSqlName(item.schema, "extension_schema");
    assertSqlName(item.schemaOwner, "extension_owner");
    validateNameArray(item.allowedOwners, "extension_allowed_owners");
  });
  assertSortedUnique(catalog.extensions.map(({ name }) => name), "extension_order");
  catalog.schemas.forEach((item) => {
    exactKeys(item, ["allowedOwners", "name"], "schema_keys");
    assertSqlName(item.name, "schema_name");
    validateNameArray(item.allowedOwners, "schema_owners");
  });
  assertSortedUnique(catalog.schemas.map(({ name }) => name), "schema_order");
  catalog.functions.forEach((item) => {
    exactKeys(item, ["identity", "owner", "securityDefiner"], "function_keys");
    if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\([a-z0-9_ ,\[\]]*\)$/.test(
      item.identity
    )) blocked("function_identity");
    assertSqlName(item.owner, "function_owner");
    if (typeof item.securityDefiner !== "boolean") blocked("function_security");
  });
  assertSortedUnique(catalog.functions.map(({ identity }) => identity), "function_order");
  catalog.roleRules.forEach((item) => {
    exactKeys(item, [
      "canLogin", "connectionLimit", "inherit", "name"
    ], "role_rule_keys");
    assertSqlName(item.name, "role_name");
    if (typeof item.canLogin !== "boolean" || typeof item.inherit !== "boolean" ||
        !Number.isSafeInteger(item.connectionLimit) ||
        item.connectionLimit < -1 || item.connectionLimit > 16) blocked("role_rule");
  });
  assertSortedUnique(catalog.roleRules.map(({ name }) => name), "role_rule_order");
  catalog.policies.forEach((item) => {
    exactKeys(item, [
      "command", "identity", "roles", "usingExpression", "withCheckExpression"
    ], "policy_keys");
    if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*:[a-z_][a-z0-9_]*$/.test(
      item.identity
    ) || !["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"].includes(
      item.command
    ) || !isPolicyExpression(item.usingExpression) ||
      !isPolicyExpression(item.withCheckExpression)) blocked("policy_identity");
    validateNameArray(item.roles, "policy_roles");
  });
  assertSortedUnique(catalog.policies.map(({ identity }) => identity), "policy_order");
}

function validatePolicyTemplates(values) {
  if (!Array.isArray(values) || values.length > 32) blocked("policy_templates");
  values.forEach((item) => {
    exactKeys(item, ["command", "name", "roles", "tables"], "policy_template_keys");
    assertSqlName(item.name, "policy_template_name");
    validateNameArray(item.roles, "policy_template_roles");
    validateNameArray(item.tables, "policy_template_tables");
  });
  assertSortedUnique(values.map(({ name }) => name), "policy_template_order");
}

function expandPolicyTemplates(templates) {
  const result = [];
  for (const template of templates) {
    for (const table of template.tables) {
      result.push({
        command: template.command,
        identity: `trailmind_app.${table}:${template.name}`,
        roles: [...template.roles],
        ...policyExpressions(template.name)
      });
    }
  }
  return result.sort((left, right) => left.identity.localeCompare(right.identity));
}

function policyExpressions(name) {
  switch (name) {
    case "app_security_runtime_insert":
      return { usingExpression: null, withCheckExpression: "true" };
    case "app_security_runtime_select":
    case "pruner_delete":
    case "projection_read":
      return { usingExpression: "true", withCheckExpression: null };
    case "app_security_runtime_update":
    case "projection_all":
    case "regional_import_all":
      return { usingExpression: "true", withCheckExpression: "true" };
    case "import_schema_owner_loading_read":
      return {
        usingExpression: "(status='loading'::text)",
        withCheckExpression: null
      };
    default:
      blocked("policy_template_semantics");
  }
}

function isPolicyExpression(value) {
  return value === null || value === "true" || value === "(status='loading'::text)";
}

function validateIdentityArray(values, code) {
  values.forEach((value) => {
    if (typeof value !== "string" ||
        !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(value)) blocked(`${code}_identity`);
  });
  assertSortedUnique(values, `${code}_order`);
}

function validateRelations(values) {
  values.forEach((value) => {
    if (typeof value !== "string" ||
        !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*:(?:table|view)$/.test(value)) {
      blocked("relation_identity");
    }
  });
  assertSortedUnique(values, "relation_order");
}

function validateNameArray(values, code) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 32) blocked(code);
  values.forEach((value) => assertSqlName(value, code));
  assertSortedUnique(values, code);
}

function assertSqlName(value, code) {
  if (typeof value !== "string" || !SQL_IDENTIFIER.test(value)) blocked(code);
}

function assertExactArray(actual, expected, code) {
  if (!Array.isArray(actual) || actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])) blocked(code);
}

function assertSortedUnique(values, code) {
  if (!Array.isArray(values) || new Set(values).size !== values.length ||
      values.some((value, index) => index > 0 && value <= values[index - 1])) {
    blocked(code);
  }
}

function verifySourceFiles(declaration, repositoryRoot) {
  const all = [...declaration.migrations, ...declaration.sourceFiles];
  for (const source of all) {
    const path = resolve(repositoryRoot, source.path);
    const pathRelative = relative(repositoryRoot, path);
    if (!pathRelative || pathRelative.startsWith("..") ||
        isAbsolute(pathRelative) || pathRelative.split(sep).includes(".temp") ||
        pathRelative === "Configuration/Local.xcconfig") blocked("source_path");
    const bytes = readSafeRegularFile(path, { maximumBytes: LIMITS.manifestBytes });
    if (sha256Bytes(bytes) !== source.sha256) blocked("source_digest_drift");
  }
}

function cloneJson(value) {
  return strictParseJson(canonicalJson(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
