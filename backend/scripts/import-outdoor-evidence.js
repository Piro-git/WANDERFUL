import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { outdoorRegionDefinition } from "../src/outdoorEvidence/regions.js";

const { Pool } = pg;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
try {
const args = parseArguments(process.argv.slice(2));
const region = outdoorRegionDefinition(args.region);
if (!region) fail("Unknown outdoor region.");
const pbfPath = resolve(args.pbf);
if (!pbfPath.endsWith(".osm.pbf")) fail("The input must be a local .osm.pbf file.");
const file = await stat(pbfPath);
const maximumPbfBytes = integer(process.env.OUTDOOR_EVIDENCE_MAX_PBF_BYTES, 2_147_483_648, 1, 8_589_934_592);
if (!file.isFile() || file.size < 1 || file.size > maximumPbfBytes) fail("The PBF file is empty or exceeds the configured import limit.");
validateSourceIdentifier(args.sourceIdentifier);
const sourceChecksum = optionalChecksum(args.sourceChecksum);
if (args.acquisitionChannel === "geofabrik_regional_extract" && !sourceChecksum) {
  fail("A Geofabrik import requires its published source checksum.");
}
const fileChecksums = await checksumsForFile(pbfPath, sourceChecksum?.algorithm);
const inputFileSha256 = fileChecksums.sha256;
if (sourceChecksum &&
    fileChecksums[sourceChecksum.algorithm] !== sourceChecksum.value) {
  fail("The PBF does not match the supplied source checksum.");
}
const sourceChecksumVerifiedAt = sourceChecksum ? new Date().toISOString() : null;
const retrievedAt = requiredDate(args.retrievedAt, "retrieved-at");
const suppliedSourceTimestamp = requiredDate(args.sourceTimestamp, "source-timestamp");
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) fail("DATABASE_URL or POSTGRES_URL is required.");
const postgresURL = validatePostgresURL(connectionString);

const osm2pgsqlVersion = await toolVersion(
  "osm2pgsql", ["--version"], /osm2pgsql version (\d+)\.(\d+)/i, 2, 3
);
await toolVersion("osmium", ["--version"], /osmium version (\d+)\.(\d+)/i, 1, 0);
await runTool("osmium", ["fileinfo", "--no-progress", pbfPath], { discardOutput: true });

const importId = randomUUID();
const stagingSchema = `outdoor_import_${importId.replaceAll("-", "_")}`;
const pool = new Pool({
  connectionString,
  max: 2,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true
});

try {
  await ensureSchemaAvailable(pool);
  await ensureRegion(pool, region);
  await pool.query(
    `INSERT INTO outdoor_evidence_imports
       (import_id, region_id, source_dataset_name, source_identifier, source_data_at,
        retrieved_at, tool_version, import_schema_version, status,
        acquisition_channel, source_checksum_algorithm, source_checksum,
        source_checksum_verified_at, input_file_sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'loading', $8, $9, $10, $11, $12)`,
    [
      importId, region.regionId, args.datasetName, args.sourceIdentifier,
      suppliedSourceTimestamp, retrievedAt, osm2pgsqlVersion, args.acquisitionChannel,
      sourceChecksum?.algorithm ?? null, sourceChecksum?.value ?? null,
      sourceChecksumVerifiedAt, inputFileSha256
    ]
  );
  await pool.query(`CREATE SCHEMA ${quotedIdentifier(stagingSchema)}`);
  process.stdout.write(`Outdoor evidence import ${importId} started for ${region.regionId}.\n`);
  await runTool("osm2pgsql", [
    "--create", "--slim", "--output=flex", "--drop",
    `--style=${join(root, "src", "outdoorEvidence", "osm2pgsql-flex.lua")}`,
    `--schema=${stagingSchema}`,
    `--middle-schema=${stagingSchema}`,
    `--database=${decodeURIComponent(postgresURL.pathname.slice(1))}`,
    pbfPath
  ], {
    env: {
      ...libpqEnvironment(postgresURL),
      TRAILMIND_IMPORT_SCHEMA: stagingSchema
    },
    discardOutput: true
  });
  const counts = await promoteImport(pool, { importId, region, stagingSchema });
  process.stdout.write(
    `Outdoor evidence import ${importId} is active: ${counts.pois} POIs, ${counts.trails} trail segments, ${counts.relations} mapped hiking relations.\n`
  );
} catch (error) {
  try {
    await pool.query(
      `UPDATE outdoor_evidence_imports
          SET status = 'failed', failure_code = 'import_failed', updated_at = clock_timestamp()
        WHERE import_id = $1 AND status <> 'active'`,
      [importId]
    );
  } catch {}
  process.stderr.write(`Outdoor evidence import ${importId} failed safely.\n`);
  process.exitCode = 1;
} finally {
  try { await pool.query(`DROP SCHEMA IF EXISTS ${quotedIdentifier(stagingSchema)} CASCADE`); } catch {}
  await pool.end();
}
} catch {
  process.stderr.write("Outdoor evidence import preflight failed safely.\n");
  process.exitCode = 1;
}

async function promoteImport(pool, input) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `trailmind-outdoor-import:${input.region.regionId}`
    ]);
    const schema = quotedIdentifier(input.stagingSchema);
    await client.query(
      `INSERT INTO outdoor_evidence_pois
         (import_id, region_id, osm_type, osm_id, category, name, reference,
          geom, geom_metric, source_version, source_timestamp, evidence_tags)
       SELECT $1, $2, raw.source_type, raw.osm_id, raw.category,
              CASE WHEN length(trim(raw.name)) BETWEEN 1 AND 160 THEN trim(raw.name) END,
              CASE WHEN length(trim(raw.ref)) BETWEEN 1 AND 80 THEN trim(raw.ref) END,
              ST_Force2D(raw.geom), ST_Transform(ST_Force2D(raw.geom), $3::integer),
              NULLIF(raw.source_version, 0), raw.source_timestamp,
              jsonb_strip_nulls(jsonb_build_object(
                'tourism', raw.tourism, 'natural', raw.natural,
                'water', raw.water, 'waterway', raw.waterway
              ))
         FROM ${schema}.raw_pois raw
         JOIN outdoor_evidence_regions region ON region.region_id = $2
        WHERE raw.source_type IN ('node', 'way', 'relation')
          AND raw.osm_id > 0
          AND ST_Intersects(raw.geom, region.boundary)
       ON CONFLICT DO NOTHING`,
      [input.importId, input.region.regionId, input.region.metricSRID]
    );
    await client.query(
      `INSERT INTO outdoor_evidence_trail_segments
         (import_id, region_id, osm_id, highway_class, surface, trail_visibility,
          sac_scale, access_tag, foot_tag, access_conditional, foot_conditional,
          seasonal_tag, permit_tag, geom, geom_metric, source_version, source_timestamp)
       SELECT $1, $2, raw.osm_id,
              CASE WHEN raw.highway IN (
                'path','footway','track','steps','bridleway','cycleway','pedestrian','service',
                'unclassified','residential','living_street','tertiary','secondary','primary',
                'trunk','motorway','road'
              ) THEN raw.highway ELSE 'other' END,
              CASE WHEN raw.surface IN (
                'paved','asphalt','concrete','concrete:lanes','concrete:plates','paving_stones',
                'sett','cobblestone','unhewn_cobblestone','compacted','fine_gravel','gravel',
                'pebblestone','rock','dirt','earth','ground','grass','mud','sand','wood','metal'
              ) THEN raw.surface WHEN raw.surface IS NULL THEN NULL ELSE 'other' END,
              CASE WHEN raw.trail_visibility IN ('excellent','good','intermediate','bad','horrible','no')
                THEN raw.trail_visibility ELSE NULL END,
              CASE WHEN raw.sac_scale IN (
                'strolling','hiking','mountain_hiking','demanding_mountain_hiking',
                'alpine_hiking','demanding_alpine_hiking','difficult_alpine_hiking'
              ) THEN raw.sac_scale ELSE NULL END,
              CASE WHEN raw.access_tag IN (
                'yes','no','private','permissive','designated','destination','customers','delivery',
                'agricultural','forestry','permit','use_sidepath'
              ) THEN raw.access_tag ELSE NULL END,
              CASE WHEN raw.foot_tag IN (
                'yes','no','private','permissive','designated','destination','customers','delivery',
                'agricultural','forestry','permit','use_sidepath'
              ) THEN raw.foot_tag ELSE NULL END,
              CASE WHEN length(trim(raw.access_conditional)) BETWEEN 1 AND 256
                THEN trim(raw.access_conditional) END,
              CASE WHEN length(trim(raw.foot_conditional)) BETWEEN 1 AND 256
                THEN trim(raw.foot_conditional) END,
              CASE WHEN length(trim(raw.seasonal_tag)) BETWEEN 1 AND 40
                THEN trim(raw.seasonal_tag) END,
              CASE WHEN length(trim(raw.permit_tag)) BETWEEN 1 AND 40
                THEN trim(raw.permit_tag) END,
              ST_Multi(ST_Force2D(raw.geom)),
              ST_Multi(ST_Transform(ST_Force2D(raw.geom), $3::integer)),
              NULLIF(raw.source_version, 0), raw.source_timestamp
         FROM ${schema}.raw_trails raw
         JOIN outdoor_evidence_regions region ON region.region_id = $2
        WHERE raw.osm_id > 0 AND ST_Intersects(raw.geom, region.boundary)
       ON CONFLICT DO NOTHING`,
      [input.importId, input.region.regionId, input.region.metricSRID]
    );
    await client.query(
      `INSERT INTO outdoor_evidence_hiking_relations
         (import_id, region_id, osm_id, route_type, network, name, reference, operator,
          symbol, osmc_symbol, state, source_version, source_timestamp)
       SELECT DISTINCT $1, $2, relation.osm_id, relation.route_type,
              CASE WHEN relation.network IN ('iwn','nwn','rwn','lwn') THEN relation.network ELSE NULL END,
              CASE WHEN length(trim(relation.name)) BETWEEN 1 AND 160 THEN trim(relation.name) END,
              CASE WHEN length(trim(relation.ref)) BETWEEN 1 AND 80 THEN trim(relation.ref) END,
              CASE WHEN length(trim(relation.operator)) BETWEEN 1 AND 160
                THEN trim(relation.operator) END,
              CASE WHEN length(trim(relation.symbol)) BETWEEN 1 AND 160
                THEN trim(relation.symbol) END,
              CASE WHEN length(trim(relation.osmc_symbol)) BETWEEN 1 AND 160
                THEN trim(relation.osmc_symbol) END,
              relation.state,
              NULLIF(relation.source_version, 0), relation.source_timestamp
         FROM ${schema}.raw_hiking_relations relation
         JOIN ${schema}.raw_hiking_relation_members member
           ON member.relation_osm_id = relation.osm_id
         JOIN outdoor_evidence_trail_segments segment
           ON segment.import_id = $1 AND segment.osm_id = member.segment_osm_id
        WHERE relation.route_type IN ('hiking', 'foot')
          AND relation.state IN ('current', 'alternate', 'temporary', 'connection')
       ON CONFLICT DO NOTHING`,
      [input.importId, input.region.regionId]
    );
    await client.query(
      `INSERT INTO outdoor_evidence_hiking_relation_members
         (import_id, region_id, relation_osm_id, segment_osm_id, member_role, member_sequence)
       SELECT $1, $2, member.relation_osm_id, member.segment_osm_id,
              left(COALESCE(member.member_role, ''), 80), member.member_sequence
         FROM ${schema}.raw_hiking_relation_members member
         JOIN outdoor_evidence_hiking_relations relation
           ON relation.import_id = $1 AND relation.osm_id = member.relation_osm_id
         JOIN outdoor_evidence_trail_segments segment
           ON segment.import_id = $1 AND segment.osm_id = member.segment_osm_id
       ON CONFLICT DO NOTHING`,
      [input.importId, input.region.regionId]
    );
    const countResult = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM outdoor_evidence_pois WHERE import_id = $1) AS pois,
         (SELECT count(*)::integer FROM outdoor_evidence_trail_segments WHERE import_id = $1) AS trails,
         (SELECT count(*)::integer FROM outdoor_evidence_hiking_relations WHERE import_id = $1) AS relations,
         (SELECT count(*)::integer FROM outdoor_evidence_hiking_relation_members WHERE import_id = $1) AS members`,
      [input.importId]
    );
    const counts = countResult.rows[0];
    if (!Number.isInteger(counts?.trails) || counts.trails < 1) {
      throw new Error("Import validation failed.");
    }
    await client.query(
      `UPDATE outdoor_evidence_imports
          SET status = 'superseded', updated_at = clock_timestamp()
        WHERE region_id = $1 AND status = 'active' AND import_id <> $2`,
      [input.region.regionId, input.importId]
    );
    const activation = await client.query(
      `UPDATE outdoor_evidence_imports
          SET status = 'active', imported_at = clock_timestamp(),
              aggregate_counts = $2::jsonb, updated_at = clock_timestamp()
        WHERE import_id = $1 AND region_id = $3 AND status = 'loading'
        RETURNING import_id`,
      [input.importId, JSON.stringify(counts), input.region.regionId]
    );
    if (activation.rowCount !== 1) throw new Error("Import activation state changed.");
    const pointerUpdate = await client.query(
      `UPDATE outdoor_evidence_regions
          SET active_import_id = $2, updated_at = clock_timestamp()
        WHERE region_id = $1
        RETURNING region_id`,
      [input.region.regionId, input.importId]
    );
    if (pointerUpdate.rowCount !== 1) throw new Error("Import region is unavailable.");
    await client.query("COMMIT");
    return counts;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function ensureRegion(pool, region) {
  await pool.query(
    `INSERT INTO outdoor_evidence_regions
       (region_id, name, definition_version, boundary_kind, coordinate_reference_system,
        metric_srid, boundary, boundary_metric, supported_feature_classes,
        freshness_threshold_days, path_match_tolerance_meters)
     VALUES ($1, $2, $3, $4, $5, $6::integer,
             ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)),
             ST_Multi(ST_Transform(
               ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), $6::integer
             )),
             $8, $9, $10)
     ON CONFLICT (region_id) DO NOTHING`,
    [
      region.regionId, region.name, region.schemaVersion, region.boundaryKind,
      region.coordinateReferenceSystem, region.metricSRID,
      JSON.stringify(region.boundaryFeature.geometry), region.supportedFeatureClasses,
      region.freshnessThresholdDays, region.pathMatchToleranceMeters
    ]
  );
  const existing = await pool.query(
    `SELECT name = $2
            AND definition_version = $3
            AND boundary_kind = $4
            AND coordinate_reference_system = $5
            AND metric_srid = $6::integer
            AND ST_Equals(
              boundary,
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326))
            )
            AND ST_Equals(
              boundary_metric,
              ST_Multi(ST_Transform(
                ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), $6::integer
              ))
            )
            AND supported_feature_classes = $8::text[]
            AND freshness_threshold_days = $9
            AND path_match_tolerance_meters = $10 AS matches
       FROM outdoor_evidence_regions
      WHERE region_id = $1`,
    [
      region.regionId, region.name, region.schemaVersion, region.boundaryKind,
      region.coordinateReferenceSystem, region.metricSRID,
      JSON.stringify(region.boundaryFeature.geometry), region.supportedFeatureClasses,
      region.freshnessThresholdDays, region.pathMatchToleranceMeters
    ]
  );
  if (existing.rowCount !== 1 || existing.rows[0]?.matches !== true) {
    fail("The versioned outdoor region definition does not match the database.");
  }
}

async function ensureSchemaAvailable(pool) {
  const result = await pool.query(
    `SELECT to_regclass('outdoor_evidence_regions') IS NOT NULL AS regions,
            to_regclass('outdoor_evidence_imports') IS NOT NULL AS imports,
            (
              SELECT count(*) = 5
                FROM information_schema.columns
               WHERE table_schema = current_schema()
                 AND table_name = 'outdoor_evidence_imports'
                 AND column_name IN (
                   'acquisition_channel', 'source_checksum_algorithm',
                   'source_checksum', 'source_checksum_verified_at',
                   'input_file_sha256'
                 )
            ) AS acquisition_provenance,
            postgis_lib_version() AS postgis_version`
  );
  if (!result.rows[0]?.regions || !result.rows[0]?.imports ||
      !result.rows[0]?.acquisition_provenance ||
      !hasMinimumVersion(result.rows[0]?.postgis_version, 3, 2)) {
    fail("Apply backend migrations before importing outdoor evidence.");
  }
}

function hasMinimumVersion(value, minimumMajor, minimumMinor) {
  const match = String(value ?? "").match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > minimumMajor || (major === minimumMajor && minor >= minimumMinor);
}

async function toolVersion(command, arguments_, pattern, minimumMajor, minimumMinor) {
  const output = await runTool(command, arguments_);
  const match = output.match(pattern);
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);
  if (!match || major < minimumMajor || (major === minimumMajor && minor < minimumMinor)) {
    fail(`${command} is missing or unsupported.`);
  }
  return `${command} ${match[1]}.${match[2]}`;
}

function runTool(command, arguments_, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const childEnvironment = { ...process.env, ...options.env };
    delete childEnvironment.DATABASE_URL;
    delete childEnvironment.POSTGRES_URL;
    const child = spawn(command, arguments_, {
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      if (!options.discardOutput && output.length < 4_096) output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (!options.discardOutput && output.length < 4_096) output += chunk.toString("utf8");
    });
    child.once("error", () => rejectPromise(new Error(`${command} could not be started.`)));
    child.once("close", (code) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(`${command} exited unsuccessfully.`));
    });
  });
}

function libpqEnvironment(url) {
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") || "prefer"
  };
}

function validatePostgresURL(value) {
  const url = new URL(value);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    fail("DATABASE_URL or POSTGRES_URL must use PostgreSQL.");
  }
  return url;
}

function validateSourceIdentifier(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 500) fail("source-id is invalid.");
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) {
      fail("source-id must not contain credentials or query data.");
    }
  } catch (error) {
    if (error?.message?.includes("credentials or query data")) throw error;
  }
}

function parseArguments(values) {
  const parsed = {};
  const allowed = new Set([
    "region", "pbf", "dataset-name", "source-id", "retrieved-at",
    "source-timestamp", "acquisition-channel", "source-checksum"
  ]);
  if (values.length % 2 !== 0) fail("Import arguments must be --key value pairs.");
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("Import arguments must be --key value pairs.");
    const name = key.slice(2);
    if (!allowed.has(name) || Object.hasOwn(parsed, name)) fail("Import arguments are invalid.");
    parsed[name] = value;
  }
  const required = [
    "region", "pbf", "dataset-name", "source-id", "retrieved-at",
    "source-timestamp", "acquisition-channel"
  ];
  if (required.some((key) => !parsed[key])) {
    fail(
      "Required: --region --pbf --dataset-name --source-id --retrieved-at " +
      "--source-timestamp --acquisition-channel."
    );
  }
  if (!parsed["dataset-name"].trim() || parsed["dataset-name"].length > 160) {
    fail("dataset-name is invalid.");
  }
  const acquisitionChannel = parsed["acquisition-channel"];
  if (!new Set([
    "geofabrik_regional_extract", "operator_supplied_local", "other_reviewed_bulk"
  ]).has(acquisitionChannel)) fail("acquisition-channel is invalid.");
  return {
    region: parsed.region,
    pbf: parsed.pbf,
    datasetName: parsed["dataset-name"],
    sourceIdentifier: parsed["source-id"],
    retrievedAt: parsed["retrieved-at"],
    sourceTimestamp: parsed["source-timestamp"],
    acquisitionChannel,
    sourceChecksum: parsed["source-checksum"]
  };
}

function requiredDate(value, label) {
  const date = optionalDate(value, label);
  if (!date) fail(`${label} is required.`);
  return date;
}

function optionalDate(value, label) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail(`${label} must be an ISO-8601 timestamp.`);
  return date.toISOString();
}

function quotedIdentifier(value) {
  if (!/^outdoor_import_[a-f0-9_]+$/.test(value)) fail("Invalid staging schema name.");
  return `"${value}"`;
}

function integer(value, fallback, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function optionalChecksum(value) {
  if (!value) return null;
  const match = value.toLowerCase().match(/^(md5|sha256):([a-f0-9]+)$/);
  if (!match) fail("source-checksum is invalid.");
  const expectedLength = match[1] === "md5" ? 32 : 64;
  if (match[2].length !== expectedLength) fail("source-checksum is invalid.");
  return { algorithm: match[1], value: match[2] };
}

function checksumsForFile(path, sourceAlgorithm) {
  return new Promise((resolvePromise, rejectPromise) => {
    const algorithms = new Set(["sha256"]);
    if (sourceAlgorithm) algorithms.add(sourceAlgorithm);
    const hashes = new Map(
      [...algorithms].map((algorithm) => [algorithm, createHash(algorithm)])
    );
    const stream = createReadStream(path);
    stream.on("data", (chunk) => {
      for (const hash of hashes.values()) hash.update(chunk);
    });
    stream.once("error", () => rejectPromise(new Error("PBF checksum failed.")));
    stream.once("end", () => resolvePromise(Object.fromEntries(
      [...hashes].map(([algorithm, hash]) => [algorithm, hash.digest("hex")])
    )));
  });
}

function fail(message) {
  throw new Error(message);
}
