# TrailMind Regional Outdoor Evidence Foundation

## Scope and trust boundary

This foundation answers one bounded question: what OpenStreetMap-mapped outdoor evidence is present near an already-routed geometry? It does not create route geometry, rank “best spots,” shape candidates around POIs, or make scenic, safety, access, water, opening-hours, or legal claims.

OpenStreetMap is treated as evidence that an object or tag is mapped. In this contract:

- `tourism=viewpoint` means “OSM-mapped viewpoint,” not a verified beautiful view.
- `type=route` plus `route=hiking|foot` means “mapped hiking relation,” not a government-official trail.
- an explicit restrictive `access`, `foot`, conditional, seasonal, or permit tag is restriction evidence.
- a missing access tag is unknown and never becomes permission.
- missing `surface`, `trail_visibility`, or `sac_scale` is unknown and never becomes easy, visible, or safe.
- mapped huts do not establish current opening, staffing, beds, food, water, or access.
- absence of a mapped POI is not proof that the real-world feature is absent.

The endpoint returns the attribution notice `© OpenStreetMap contributors`, an ODbL label, and `https://www.openstreetmap.org/copyright`. Any product surface that exposes this evidence must retain a discoverable attribution. Final ODbL and broader licensing review remains a release responsibility; this document is operational guidance, not a legal conclusion.

## Supported operational regions

The catalog loads every checked-in versioned region definition in deterministic filename order. The corridor service then selects every enabled region whose polygon has a positive-length intersection with the routed geometry. Region order is deterministic: descending intersected route length, then stable region ID. Clients cannot choose or override a region.

### Harz v1

Harz is the first region because TrailMind’s initial users and existing routing fixtures center on Ilsenburg, Schierke, Brocken, Wernigerode, and Bad Harzburg. It is small enough for controlled regional refreshes and includes meaningful hiking-path, hiking-relation, terrain-tag, and POI variation.

`backend/config/outdoor-regions/harz-v1.json` is the typed versioned contract. Its boundary is committed as `harz-v1.geojson`:

```text
west  10.30° E
east  11.35° E
south 51.45° N
north 51.98° N
```

The closed polygon is:

```text
(10.30,51.45) → (11.35,51.45) → (11.35,51.98) →
(10.30,51.98) → (10.30,51.45)
```

Coordinates above are longitude, latitude. This is a TrailMind operational coverage polygon, not an official administrative, park, mountain-range, or legal boundary. The configuration validates that all five required anchor coordinates lie inside it.

- storage and transport CRS: EPSG:4326
- distance, length, buffer, and area CRS: EPSG:25832 (ETRS89 / UTM zone 32N)
- freshness threshold: 14 days
- route-to-path match tolerance: 25 metres

No distance, length, or buffer calculation is performed directly in longitude/latitude degrees.

### Innsbruck Alpine Pilot v1

`backend/config/outdoor-regions/innsbruck-alps-v1.json` and `innsbruck-alps-v1.geojson` define `innsbruck-alps-v1`:

```text
west  10.95° E
east  11.65° E
south 47.00° N
north 47.45° N
```

The closed polygon is:

```text
(10.95,47.00) → (11.65,47.00) → (11.65,47.45) →
(10.95,47.45) → (10.95,47.00)
```

It covers the operational pilot around Innsbruck, Nordkette, Seefeld in Tirol, Fulpmes, and Neustift in the northern Stubai area. It is deliberately a bounded TrailMind pilot polygon. It is not the complete Alps, not a complete Austrian or Tyrolean Alpine boundary, and not an official administrative, mountain-range, protected-area, or legal boundary. Broad requests such as “the Alps” therefore never resolve to this polygon as an arbitrary route anchor; route location clarification remains a separate product safeguard.

- storage and transport CRS: EPSG:4326
- distance, length, buffer, and area CRS: EPSG:25832 (ETRS89 / UTM zone 32N)
- freshness threshold: 14 days
- route-to-path match tolerance: 25 metres

EPSG:25832 is appropriate for this compact pilot around longitude 11° E and keeps the region in UTM zone 32N. The shared value with Harz is incidental; the schema and query retain a metric SRID per region.

## Region contract and future Alpine sharding

Each region definition contains a stable ID, name, schema version, committed GeoJSON boundary, boundary kind, storage CRS, metric SRID, feature-class allowlist, freshness threshold, path-match tolerance, required anchor checks, and a source-metadata contract.

Adding another Alpine shard does not require a schema or endpoint redesign:

1. Commit a new versioned JSON definition and its GeoJSON operational polygon.
2. Select and document an appropriate local metric SRID for that bounded region.
3. Add anchor regression coordinates and the supported feature classes.
4. Supply a locally obtained, region-bounded `.osm.pbf` and run the same importer.
5. Validate coverage, freshness, query latency, and response bounds before enabling the region.

Do not combine the entire multi-country, multi-zone Alps under one operational polygon or one unsuitable metric SRID. Future Alpine coverage should be added as named, versioned shards around coherent operational areas, each with a suitable local metric SRID, independent import/freshness state, and explicit partial coverage. Routes crossing shards are aggregated through the multi-region contract.

## PostGIS schema

Migration `002_outdoor_evidence.sql` creates clearly prefixed tables so the existing migration runner and disposable test schemas continue to work:

- `outdoor_evidence_regions`: region contract, WGS84 and metric boundary, active import pointer, coverage/freshness configuration.
- `outdoor_evidence_imports`: immutable source/import provenance, state, bounded counts, and safe failure code.
- `outdoor_evidence_pois`: canonical OSM type/ID, normalized category, bounded name/ref, WGS84 and metric geometry, source version/time, and only allowlisted evidence tags.
- `outdoor_evidence_trail_segments`: canonical way identity, normalized highway/surface/visibility/SAC fields, explicit access evidence, WGS84 and metric line geometry, and source version/time.
- `outdoor_evidence_hiking_relations`: mapped `hiking`/`foot` relations, network/ref/operator/symbol fields, current lifecycle state, and source provenance.
- `outdoor_evidence_hiking_relation_members`: ordered relation-to-imported-segment membership.

Primary and foreign keys scope evidence by immutable import and enforce that active pointers, objects, relations, and members belong to the same region. GiST indexes cover WGS84 region/feature geometry and metric POI/trail geometry. Metric columns deliberately use unconstrained-SRID `geometry` with explicit shape, 2D, and positive-SRID checks: each bounded region chooses its own metric SRID, and the importer/query enforce that region's configured value. B-tree indexes cover region, import, category, network, and both directions of relation membership. RLS is enabled because these backend-owned tables may share a database whose public schema is exposed through a data API; the backend/migration owner remains responsible for private access.

## Supported OSM evidence

### POIs

| Normalized category | Required mapped tag |
| --- | --- |
| viewpoint | `tourism=viewpoint` |
| peak | `natural=peak` |
| lake | `natural=water` + `water=lake` |
| waterfall | `waterway=waterfall` |
| alpineHut | `tourism=alpine_hut` |
| wildernessHut | `tourism=wilderness_hut` |

The importer does not broaden every unclassified `natural=water` polygon into a lake. Legacy or competing waterfall conventions are not silently treated as equivalent in v1.

### Trail/path segments

The importer accepts mapped `highway=*` ways, normalizes a bounded highway vocabulary, and stores allowlisted values for:

- `surface`
- `trail_visibility`
- `sac_scale`
- `access`
- `foot`
- `access:conditional`
- `foot:conditional`
- `seasonal`
- `permit`

Unrecognized values are either normalized to `other` where the category supports it or left unknown. Conditional strings are bounded in storage and are returned only as a typed “conditional restriction present” flag, not as arbitrary upstream text.

### Hiking relations

Relations require `type=route` plus `route=hiking` or `route=foot`. Supported walking-network values are `iwn`, `nwn`, `rwn`, and `lwn`. `name`, `ref`, `operator`, `symbol`, and `osmc:symbol` are bounded. `state=alternate|temporary|connection` remains explicitly represented; `state=proposed` is excluded.

Objects with lifecycle prefixes such as `proposed:*`, `planned:*`, `construction:*`, `disused:*`, `abandoned:*`, `demolished:*`, `destroyed:*`, `removed:*`, or `razed:*`, and direct established non-current values, are excluded when the tags establish that state.

The service deliberately uses “mapped hiking relation” terminology. A relation’s network, operator, ref, or symbol may be returned as mapped provenance but does not independently prove governmental or legal official status.

## Primary documentation used

- [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright)
- [OSM `tourism=viewpoint`](https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dviewpoint)
- [OSM `water=lake`](https://wiki.openstreetmap.org/wiki/Tag:water%3Dlake)
- [OSM waterfalls](https://wiki.openstreetmap.org/wiki/Waterfalls)
- [OSM `tourism=alpine_hut`](https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dalpine_hut)
- [OSM `tourism=wilderness_hut`](https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dwilderness_hut)
- [OSM route relations](https://wiki.openstreetmap.org/wiki/Relation:route)
- [OSM `route=foot`](https://wiki.openstreetmap.org/wiki/Tag:route%3Dfoot)
- [OSM access tags](https://wiki.openstreetmap.org/wiki/Access_tags)
- [OSM `trail_visibility`](https://wiki.openstreetmap.org/wiki/Key:trail_visibility)
- [OSM `sac_scale`](https://wiki.openstreetmap.org/wiki/Key:sac_scale)
- [OSM lifecycle prefixes](https://wiki.openstreetmap.org/wiki/Lifecycle_prefix)
- [osm2pgsql v2 manual and flex output](https://osm2pgsql.org/doc/manual.html)
- [PostGIS `ST_DWithin` guidance](https://postgis.net/documentation/tips/st-dwithin/)
- [PostGIS spatial-index guidance](https://postgis.net/documentation/faq/spatial-indexes/)
- [Geofabrik regional download server](https://download.geofabrik.de/europe/dach.html)

The OSM wiki documents community tagging practice and its limitations; it is not a real-time guarantee about any mapped object.

## Import prerequisites and local command

The importer never downloads data and never calls public Overpass or Nominatim. Prerequisites are deliberately external gates:

- PostgreSQL with PostGIS 3.2 or later already installed and configured (`ST_DumpSegments` is used)
- migrations applied with `npm run db:migrate`
- osm2pgsql 2.3 or later (native flex `timestamptz` columns are used)
- osmium-tool 1.x or later
- a user-supplied regional `.osm.pbf`
- `DATABASE_URL` or `POSTGRES_URL` supplied through the operator’s environment

Do not put credentials on the command line or in source control. Do not use a Germany-, Alps-, or planet-scale PBF for this v1 workflow. The default local file ceiling is 2 GiB and should be reduced for constrained environments.

Example with a previously downloaded and appropriately bounded file:

```sh
cd backend
npm run outdoor-evidence:import -- \
  --region innsbruck-alps-v1 \
  --pbf /absolute/path/to/user-supplied-innsbruck-pilot.osm.pbf \
  --dataset-name "Operator-selected regional OSM extract" \
  --source-id "documented-source-identifier-without-credentials" \
  --retrieved-at "2026-07-20T08:00:00Z" \
  --source-timestamp "2026-07-20T00:00:00Z"
```

The source timestamp is optional at ingestion because some valid files do not expose one, but evidence from an import without it is returned as freshness-unavailable rather than current.

## Atomic promotion, retry, cleanup, and refresh

Each run receives an immutable UUID and a uniquely named staging schema. The flex mapping writes only selected raw columns into staging. Promotion then runs in one transaction under a region-specific advisory lock:

Region IDs are versioned contracts. The importer inserts a missing definition, but it never overwrites an existing definition in place; every configured field and both geometries must match before a new import can start. Boundary or CRS changes therefore require a new region ID and cannot alter an active dataset through a failed refresh.

1. clip objects to the configured boundary;
2. normalize and insert POIs and trail segments;
3. insert eligible hiking relations and only memberships whose segment was imported;
4. calculate bounded aggregate counts;
5. mark the previous active import `superseded`;
6. mark the new import `active` and update the region’s active pointer;
7. commit.

Until step 7 commits, the old import remains active. A failed run receives only the safe code `import_failed`; raw tool output, connection strings, tags, and coordinates are not put in routine logs. The staging schema is dropped on success or failure. Retrying creates a fresh immutable run, so a partial run cannot be promoted accidentally.

Superseded import rows are retained for deliberate rollback and audit. Rollback is an operator-reviewed database transaction that marks the current import superseded, restores the chosen prior import to active, and changes the region pointer together. Only after the retention/rollback window should an operator delete a superseded import; foreign-key cascades remove only that import’s evidence. The importer does not perform broad automatic deletion.

V1 implements full regional replacement. A daily or scheduled refresh would supply a new bounded PBF, run the same command, validate counts/freshness/query smoke tests, and atomically promote. Incremental minutely/daily replication is not implemented or claimed. A future replication worker must preserve immutable import provenance and atomic promotion rather than mutating the active dataset in place.

## Corridor API

`POST /api/outdoor-evidence/corridor`

Request schema v1 contains only:

```json
{
  "schemaVersion": 1,
  "routeFingerprint": "opaque-correlation-value",
  "geometry": [
    { "latitude": 51.80, "longitude": 10.61 },
    { "latitude": 51.81, "longitude": 10.63 }
  ],
  "corridorWidthMeters": 100
}
```

The fingerprint is only an opaque correlation/cache value; it is not proof of route integrity. The request accepts no prompt, SQL, provider URL, arbitrary filter, or client-controlled region. The server selects every positively intersecting enabled configured region.

Bounds include a 128 KiB default body ceiling, 2–2,000 coordinates, finite/range validation, at least one metre and at most 200 km of routed geometry, corridor widths from the fixed allowlist `25, 50, 100, 250, 500`, a 2.5 second PostGIS statement timeout, at most 40 returned POIs by default, and a 512 KiB serialized response ceiling. All SQL values are parameters. The Swift client may deterministically apply Douglas–Peucker simplification with at most 15 metres deviation; it preserves endpoints and material turns and rejects geometries that cannot satisfy the point bound without exceeding that deviation. It never truncates silently.

Response schema v2 contains:

- schema/fingerprint correlation
- `known`, `stale`, `unavailable`, or `unsupported` evidence state
- every intersecting region, in deterministic selection order, with independent full/partial coverage
- independent immutable import/source provenance, active-import state, freshness, and evidence status per region
- the union coverage ratio across all intersecting regions
- OSM attribution/license link
- per-attribute coverage ratios
- mapped hiking-relation coverage ratio
- highway, surface, trail-visibility, and SAC-scale length breakdowns
- maximum known mapped SAC scale
- bounded explicit restriction evidence
- category counts and a bounded deduplicated mapped-POI list
- typed warning codes

Outside, missing-import, stale, missing-timestamp, overlap, and partial states are distinct. If any selected region lacks usable freshness or an active import, the aggregate state fails conservatively to unavailable while the per-region states remain visible. The service never reports “zero viewpoints” when the dataset is unavailable. With current active imports for every selected region, zero is a known mapped count for the covered corridor only.

## Length and deduplication semantics

The route is intersected with every enabled region, and the covered linework is unioned before segmentation. Each global route piece is assigned to at most one nearest candidate OSM way across all current active imports. Distance matching transforms the piece into each candidate region's configured metric SRID and applies the smaller of the corridor width and that region's path-match tolerance. Ties use region selection rank and canonical OSM ID. Attribute and hiking-relation lengths are accumulated from those uniquely assigned global pieces.

This makes evidence length-weighted and prevents parallel ways, overlapping imports, or multiple route relations that share a member from counting one route piece more than once. POI candidates are canonicalized across imports by OSM type plus ID; deterministic region rank selects the returned provenance. Relation membership is a boolean property of the single assigned piece, so relations are never summed. Ratios are validated against union-covered and total route length before the final numerical clamp; malformed over-counting fails closed. Every emitted ratio is bounded to `0...1`.

Coverage denominators use the complete routed geometry. Consequently, evidence coverage cannot silently appear complete when only part of a route lies inside one or several pilot regions. Individual region ratios may overlap, but the overall regional ratio is calculated from their geometric union. Unknown/missing attribute distance remains visible as the gap between overall route coverage and attribute coverage.

## Authorization, privacy, cancellation, and logging

The endpoint reuses the existing TrailMind route-session/App Attest authorizer. Its explicit weighted cost defaults to 4. Durable route-session rate and concurrency controls are reused, production fails closed without durable authorization, and leases are released on success, validation/query failure, timeout, and cancellation.

The backend provider is also fail-closed by configuration. `OUTDOOR_EVIDENCE_PROVIDER_ENABLED` must be explicitly set to `true`, `yes`, or `1` before the endpoint can authorize or query evidence. A missing, false, empty, or malformed value returns the bounded unavailable response. The tracked example configuration keeps it false; disposable verification may override it only in that isolated local/test process.

The HTTP abort signal is propagated to the repository contract. The selected node-postgres promise API does not expose a stable AbortSignal query contract, so the repository checks cancellation before and after database work and enforces a short database statement timeout; no claim of instantaneous server-side PostgreSQL cancellation is made. A future driver-level cancel implementation must be validated against pool safety before adoption.

Exact route geometry, mapped POI coordinates, fingerprints, prompts, authorization headers, database errors, credentials, raw tags, and request bodies are never logged. Completion logs contain only request ID, a bounded list of matched region IDs when known, point-count bucket, distance bucket, corridor-width choice, status/error code, and duration. Safe error envelopes never expose PostgreSQL or importer output.

## iOS integration

`BackendOutdoorRouteEvidenceProvider` conforms to `OutdoorRouteEvidenceProviding` and uses:

- the existing backend base URL
- the existing route-session authorizer and one-time expired-session refresh semantics
- a dedicated 512 KiB success / 32 KiB error response limit
- cancellation-aware incremental transport
- strict schema/fingerprint/top-level allowlist validation
- typed OSM provenance, freshness, coverage, breakdown, restriction, and mapped-POI models

Transport failure never becomes a known zero. Unsupported, unavailable, stale, malformed, and rejected snapshots remain distinct. Response schema v2 preserves a deterministic list of region states and per-import provenance. `NoOpOutdoorRouteEvidenceProvider` remains the fallback when outdoor evidence is disabled or no valid backend base URL is configured, so ordinary GraphHopper routing is not blocked when this optional service is absent.

The synchronous `HikingRouteQualityEngine` has an overload that merges an already-fetched outdoor snapshot into `RouteEvidenceSnapshot`. It performs no network operation. V1 does not use POIs or mapped relations as ranking weights, eligibility thresholds, explanations, UI claims, persistence, or route shaping.

The production composition seam is present but runtime collection is disabled by default. `OUTDOOR_EVIDENCE_ENABLED` must be explicitly set to `true`, `yes`, or `1`, and a valid TrailMind backend base URL must also be configured, before the factory selects `BackendOutdoorRouteEvidenceProvider`. A missing flag, explicit `false`/`no`/`0`, malformed value, or invalid/missing backend URL selects `NoOpOutdoorRouteEvidenceProvider`. The tracked shared build configuration sets the flag to `false`.

Operators must not enable runtime collection until all of these operational data gates pass:

1. the PostGIS migration has run successfully in the target environment;
2. at least one supported regional PBF has been imported successfully;
3. corridor smoke tests pass against that imported data; and
4. privacy review and the product placement of OpenStreetMap attribution are approved.

Only after those gates pass may an owner-approved build configuration set `OUTDOOR_EVIDENCE_ENABLED = true`. When enabled, after final route generation and after suggestions are published, `PlannerViewModel` starts a separate post-routing collector only for provenance-verified routed geometry. The collector cannot delay or fail ordinary route generation, and keeps snapshots only in transient memory keyed by suggestion ID. The data is not displayed, persisted, merged into production ranking, used for waypoint generation, or used to shape routes. With collection disabled, ordinary planning does not call the provider or issue an outdoor-evidence request. If an enabled optional request fails, the unavailable path still preserves ordinary routing.

## External deployment and scheduler gates

This repository work does not deploy a database, install PostgreSQL/PostGIS/osm2pgsql/osmium, download regional data, create a production scheduler, or call live providers. Before release, operators must separately approve and verify infrastructure sizing, backups, connection/RLS roles, PBF provenance, scheduled refresh ownership, retention, monitoring, ODbL obligations, attribution placement, timeout/load tests, and incident rollback.

## Verification status

As of 2026-07-21:

- `npm run build` passes;
- focused outdoor-evidence backend tests pass 38/38 runnable tests;
- the full backend suite passes 216/216 runnable tests with database credentials explicitly removed;
- the real PostGIS suite and the pre-existing PostgreSQL App Attest suite are suite-level skips in that run because no disposable database URL was supplied; neither skip is counted as executed proof;
- focused outdoor-evidence Swift tests pass 17/17, `HikingRouteQualityEngineTests` pass 18/18, and the focused default-planning no-request test passes 1/1 (36/36 combined, with no skips);
- Debug and Release builds both pass for an iPhone 17 Pro Simulator on iOS 26.5, reusing `/private/tmp/TrailMindDerivedData-Agent11` and with the disk gate above 8 GiB;
- `git diff --check`, an additional trailing-whitespace scan for untracked files, credential-pattern review, and bulk OSM/database-artifact review pass;
- no real PostGIS migration/query, local Harz or Innsbruck-pilot PBF import, live provider request, public Overpass call, package installation, data download, deployment, or scheduler run was performed. The gated PostGIS suite and operator-supplied bounded imports remain external verification gates.

## Separate next task

POI-aware candidate waypoint generation and route shaping using verified outdoor evidence. That work must remain separate from this evidence foundation and must define its own safety, ranking, and truth contracts.
