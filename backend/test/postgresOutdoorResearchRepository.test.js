import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OSM_ASSERTION_POLICY_SCOPES,
  OSM_RELATIONSHIP_POLICY_SCOPES
} from "../src/outdoorResearch/osmProjectionPolicy.js";
import {
  outdoorResearchRepositoryQueriesForTesting,
  outdoorResearchRuntimeQueriesForTesting,
  PostgresOutdoorResearchRepository
} from "../src/outdoorResearch/postgresOutdoorResearchRepository.js";
import {
  OUTDOOR_RESEARCH_REGION_BINDINGS_V1
} from "../src/outdoorResearch/regionBindings.js";

const BINDING = OUTDOOR_RESEARCH_REGION_BINDINGS_V1.find((binding) =>
  binding.operationalRegionId === "harz-v1"
);
const ANCHOR = { latitude: 51.8, longitude: 10.6 };
const NOW = new Date("2026-07-24T12:00:00Z");

describe("PostGIS outdoor research repository", () => {
  it("derives exact mapped capabilities from one active governed snapshot", async () => {
    const harness = repositoryHarness({ snapshotRow: activeSnapshotRow() });
    const result = await harness.repository.withConsistentSnapshot({}, async (session) =>
      session.resolveCapabilities(BINDING, ANCHOR, NOW)
    );
    assert.equal(result.availabilityState, "active");
    assert.deepEqual(result.capabilities.supportedRegionIds, [BINDING.regionEntityId]);
    assert.deepEqual(result.capabilities.availableSourceCategories, [
      "openstreetmap_open_mapping"
    ]);
    assert.deepEqual(result.capabilities.enabledOperationTypes, [
      "discover_highlights",
      "retrieve_mapped_hiking_routes"
    ]);
    assert(result.capabilities.supportedEvidencePredicates.includes(
      "mapped_hiking_route_membership"
    ));
    assert(result.capabilities.supportedEvidencePredicates.includes(
      "access_restriction"
    ));
    for (const forbidden of [
      "public_access",
      "current_opening",
      "overnight_permission",
      "drinking_water_availability",
      "closure_status"
    ]) {
      assert.equal(
        result.capabilities.supportedEvidencePredicates.includes(forbidden),
        false
      );
    }
    assert.equal(result.snapshot.operationalRegionId, "harz-v1");
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(harness.commands.slice(0, 2), [
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SELECT set_config('statement_timeout', $1, true)"
    ]);
    assert.equal(harness.commands.at(-1), "COMMIT");
    assert.equal(harness.released(), true);
    const snapshotCall = harness.queryCalls.find((call) =>
      call.text.includes("trailmind_runtime_outdoor_research_snapshot_context_v1")
    );
    assert.deepEqual(snapshotCall.values, [
      "harz-v1",
      ANCHOR.longitude,
      ANCHOR.latitude
    ]);
  });

  it("removes capabilities for inactive, revoked, scope-drifted and policy-stale evidence", async () => {
    const cases = [
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({ source_lifecycle_state: "paused" })
      },
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({ policy_lifecycle_state: "retired" })
      },
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({
          authority_scopes: OSM_ASSERTION_POLICY_SCOPES.slice(1)
        })
      },
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({ relationship_scopes: [] })
      },
      {
        expected: "source_stale",
        row: activeSnapshotRow({ source_data_at: "2026-07-09T10:00:00Z" })
      }
    ];
    for (const testCase of cases) {
      const harness = repositoryHarness({ snapshotRow: testCase.row });
      const result = await harness.repository.withConsistentSnapshot(
        {},
        (session) => session.resolveCapabilities(BINDING, ANCHOR, NOW)
      );
      assert.equal(result.availabilityState, testCase.expected);
      assert.deepEqual(result.capabilities.supportedRegionIds, []);
      assert.equal(result.snapshot, null);
    }
  });

  it("does not confuse the publisher refresh cadence with the reviewed maximum age", async () => {
    const harness = repositoryHarness({
      snapshotRow: activeSnapshotRow({
        source_data_at: "2026-07-23T10:00:00Z",
        import_retrieved_at: "2026-07-23T11:00:00Z",
        imported_at: "2026-07-23T12:00:00Z",
        expected_refresh_interval_seconds: 86_400
      })
    });
    const result = await harness.repository.withConsistentSnapshot(
      {},
      (session) => session.resolveCapabilities(BINDING, ANCHOR, NOW)
    );
    assert.equal(result.availabilityState, "active");
    assert.equal(result.snapshot.freshnessLimitMilliseconds, 14 * 86_400_000);
  });

  it("normalizes PostgreSQL timestamp offsets at the JSON function boundary", async () => {
    const harness = repositoryHarness({
      snapshotRow: activeSnapshotRow({
        source_data_at: "2026-07-24T02:00:00+02:00",
        import_retrieved_at: "2026-07-24T02:30:00+02:00",
        imported_at: "2026-07-24T03:00:00+02:00"
      })
    });
    const result = await harness.repository.withConsistentSnapshot(
      {},
      (session) => session.resolveCapabilities(BINDING, ANCHOR, NOW)
    );
    assert.equal(result.availabilityState, "active");
    assert.equal(result.snapshot.sourceDataAt, "2026-07-24T00:00:00.000Z");
    assert.equal(result.snapshot.retrievedAt, "2026-07-24T00:30:00.000Z");
    assert.equal(result.snapshot.importedAt, "2026-07-24T01:00:00.000Z");
  });

  it("fails missing, future, and maximum-age policy drift closed", async () => {
    const cases = [
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({ source_data_at: null })
      },
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({ import_retrieved_at: null })
      },
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({ imported_at: null })
      },
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({
          source_data_at: "2026-07-25T00:00:00Z",
          import_retrieved_at: "2026-07-25T01:00:00Z",
          imported_at: "2026-07-25T02:00:00Z"
        })
      },
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({ maximum_input_age_days: null })
      },
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({ maximum_input_age_days: 15 })
      },
      {
        expected: "source_unavailable",
        row: activeSnapshotRow({ freshness_threshold_days: 0 })
      }
    ];
    for (const testCase of cases) {
      const harness = repositoryHarness({ snapshotRow: testCase.row });
      const result = await harness.repository.withConsistentSnapshot(
        {},
        (session) => session.resolveCapabilities(BINDING, ANCHOR, NOW)
      );
      assert.equal(result.availabilityState, testCase.expected);
      assert.equal(result.snapshot, null);
    }

    const missingSnapshot = repositoryHarness();
    const unavailable = await missingSnapshot.repository.withConsistentSnapshot(
      {},
      (session) => session.resolveCapabilities(BINDING, ANCHOR, NOW)
    );
    assert.equal(unavailable.availabilityState, "source_unavailable");
    assert.equal(unavailable.snapshot, null);
  });

  it("fails exact polygon containment closed without advertising another region", async () => {
    const harness = repositoryHarness({
      snapshotRow: activeSnapshotRow({
        anchor_inside: false,
        boundary_distance_meters: null
      })
    });
    const result = await harness.repository.withConsistentSnapshot(
      {},
      (session) => session.resolveCapabilities(BINDING, ANCHOR, NOW)
    );
    assert.equal(result.availabilityState, "outside_region");
    assert.deepEqual(result.capabilities.supportedRegionIds, []);
    assert.equal(result.snapshot, null);
  });

  it("rejects malformed normalized repository and freshness timestamps", async () => {
    const invalidTimestamps = [
      "2026-02-30T10:00:00Z",
      "2026-02-30T10:00:00+02:00",
      "2026",
      "2026-07-24T10:00:00",
      "2026-07-24T10:00:00+15:00",
      "not-a-date",
      new Date(Number.NaN)
    ];
    for (const invalidTimestamp of invalidTimestamps) {
      for (const field of [
        "source_data_at",
        "import_retrieved_at",
        "imported_at"
      ]) {
        const harness = repositoryHarness({
          snapshotRow: activeSnapshotRow({ [field]: invalidTimestamp })
        });
        await assert.rejects(
          () => harness.repository.withConsistentSnapshot(
            {},
            (session) => session.resolveCapabilities(BINDING, ANCHOR, NOW)
          ),
          hasCode("malformed_evidence")
        );
      }
    }
    const clockHarness = repositoryHarness({ snapshotRow: activeSnapshotRow() });
    await assert.rejects(
      () => clockHarness.repository.withConsistentSnapshot(
        {},
        (session) => session.resolveCapabilities(
          BINDING,
          ANCHOR,
          "2026-07-24T12:00:00"
        )
      ),
      hasCode("invalid_dependencies")
    );
  });

  it("uses fixed parameterized spatial queries, strict active views and bounded rows", () => {
    const queries = outdoorResearchRepositoryQueriesForTesting;
    for (const query of Object.values(queries)) {
      assert.match(query, /\$1/);
      assert.doesNotMatch(query, /51\.8|10\.6/);
      assert.doesNotMatch(query, /ST_AsGeoJSON|ST_AsText/);
    }
    assert.match(queries.snapshotContext, /outdoor_research_active_projection_runs/);
    assert.match(queries.highlights, /outdoor_research_active_assertions/);
    assert.match(queries.highlights, /ST_DWithin/);
    assert.match(queries.highlights, /active_run\.region_id = \$2/);
    assert.match(queries.highlights, /lifecycle_state = 'active'/);
    assert.match(queries.highlights, /projection_quarantines/);
    assert.match(queries.highlights, /trail\.entity_category = 'trail_segment'/);
    assert.match(queries.highlights, /COS\(RADIANS\(ST_Y/);
    assert.match(queries.highlights, /ST_DWithin\([\s\S]*::geography/);
    assert.match(queries.highlights, /\$9::double precision/);
    assert.match(queries.highlights, /LIMIT \$8/);
    assert.match(queries.routeMemberships, /outdoor_research_active_relationships/);
    assert.match(queries.routeMemberships, /active_run\.region_id = \$2/);
    assert.match(queries.routeMemberships, /region\.active_import_id = active_run\.input_import_id/);
    assert.match(queries.routeMemberships, /lifecycle_state = 'active'/);
    assert.match(queries.routeMemberships, /projection_quarantines/);
    assert.match(queries.routeMemberships, /COS\(RADIANS\(ST_Y/);
    assert.match(queries.routeMemberships, /relationship\.evidence_class/);
    assert.match(queries.routeMemberships, /nearby\.evidence_class/);
    assert.match(queries.routeMemberships, /membership_rank <= \$7/);
    assert.match(queries.routeMemberships, /membership_segment_ids AS MATERIALIZED/);
    assert.match(queries.routeMemberships, /candidate_segments AS MATERIALIZED/);
    assert.match(queries.routeMemberships, /nearby_segments AS MATERIALIZED/);
    assert.match(
      queries.routeMemberships,
      /ST_PointOnSurface\(segment\.projected_geometry\) && ST_Expand/
    );
    assert.match(
      queries.routeMemberships,
      /ST_DWithin\([\s\S]*segment\.candidate_point::geography/
    );
    assert.match(queries.routeMemberships, /ST_CoveredBy\(/);
    assert.match(queries.routeMemberships, /ORDER BY nearby\.distance_meters/);
    assert.match(queries.routeMemberships, /LIMIT \$6$/);
    assert.doesNotMatch(queries.routeMemberships, /selected_routes AS/);
    assert.equal(
      [...queries.routeMemberships.matchAll(/ST_PointOnSurface\(/g)].length,
      2
    );
    assert.match(queries.routeAssertions, /LIMIT \$4/);
    assert.match(queries.trailAccessCandidates, /ST_ClosestPoint\(/);
    assert.match(
      queries.trailAccessCandidates,
      /ST_DWithin\([\s\S]*projected_geometry::geography[\s\S]*evidence_point::geography/
    );
    assert.match(queries.trailAccessCandidates, /ST_Distance\(/);
    assert.match(queries.trailAccessCandidates, /active_import_id = run\.input_import_id/);
    assert.match(queries.trailAccessCandidates, /import\.status = 'active'/);
    assert.match(queries.trailAccessCandidates, /lifecycle_state = 'active'/);
    assert.match(queries.trailAccessCandidates, /projection_quarantines/);
    assert.match(queries.trailAccessCandidates, /access_restriction/);
    assert.match(queries.trailAccessCandidates, /closure_status/);
    assert.match(
      queries.trailAccessCandidates,
      /value_text IS DISTINCT FROM 'open'/
    );
    assert.match(
      queries.trailAccessCandidates,
      /trail_category_evidence_claim_ids/
    );
    assert.match(queries.trailAccessCandidates, /source_trail\.osm_id::text/);
    assert.match(queries.trailAccessCandidates, /source_trail\.highway_class = ANY/);
    assert.match(queries.trailAccessCandidates, /ORDER BY eligible\.poi_to_access_distance_meters/);
    assert.match(queries.trailAccessCandidates, /LIMIT \$8$/);
    assert.doesNotMatch(queries.trailAccessCandidates, /ST_Expand/);
    assert.doesNotMatch(queries.trailAccessCandidates, /ST_PointOnSurface\(trail/);
  });

  it("executes only the bounded runtime function surface", () => {
    const queries = outdoorResearchRuntimeQueriesForTesting;
    for (const [name, query] of Object.entries(queries)) {
      assert.match(query, /^\s*SELECT "public"\.trailmind_runtime_/);
      assert.doesNotMatch(query, /\b(?:FROM|JOIN) outdoor_/);
      if (!name.endsWith("Plan")) assert.match(query, /AS runtime_row/);
    }
  });

  it("rejects an unsafe runtime schema identifier", () => {
    for (const runtimeSchema of [
      "public; SET ROLE elevated",
      "MixedCase",
      "pg-temp",
      ""
    ]) {
      assert.throws(
        () => new PostgresOutdoorResearchRepository({
          pool: { async connect() {} },
          runtimeSchema
        }),
        hasCode("invalid_dependencies")
      );
    }
  });

  it("passes only reviewed bounded parameters to the access-point query", async () => {
    const highlight = {
      entityId: "11111111-1111-4111-8111-111111111111",
      highlightCategory: "viewpoint",
      evidenceCoordinate: ANCHOR
    };
    const harness = repositoryHarness({ trailAccessRows: [] });
    await harness.repository.withConsistentSnapshot({}, (session) =>
      session.resolveTrailAccessCandidates({
        projectionRunId: activeSnapshotRow().projection_run_id,
        operationalRegionId: "harz-v1",
        highlights: [highlight],
        maximumDistanceMeters: 75,
        maximumCandidatesPerHighlight: 3,
        eligibleHighwayClasses: [
          "path", "footway", "track", "steps", "bridleway", "pedestrian"
        ],
        highlightCategories: [
          "viewpoint", "waterfall", "peak", "lake", "alpine_hut",
          "wilderness_hut", "landmark"
        ],
        maximumRows: 64
      })
    );
    const call = harness.queryCalls.find((item) =>
      item.text.includes(
        "trailmind_runtime_outdoor_research_trail_access_candidates_v1"
      )
    );
    assert.deepEqual(call.values, [
      activeSnapshotRow().projection_run_id,
      "harz-v1",
      [highlight.entityId],
      75,
      3,
      ["path", "footway", "track", "steps", "bridleway", "pedestrian"],
      [
        "viewpoint", "waterfall", "peak", "lake", "alpine_hut",
        "wilderness_hut", "landmark"
      ],
      64
    ]);
  });

  it("passes only bounded typed parameters to highlight and route query shapes", async () => {
    const harness = repositoryHarness({
      snapshotRow: activeSnapshotRow(),
      highlightRows: [],
      membershipRows: []
    });
    await harness.repository.withConsistentSnapshot({}, async (session) => {
      await session.discoverHighlights({
        projectionRunId: activeSnapshotRow().projection_run_id,
        operationalRegionId: "harz-v1",
        anchor: ANCHOR,
        entityCategories: ["viewpoint"],
        predicates: ["entity_category", "viewpoint_presence"],
        searchRadiusMeters: 8_000,
        limit: 12
      });
      await session.retrieveMappedHikingRoutes({
        projectionRunId: activeSnapshotRow().projection_run_id,
        operationalRegionId: "harz-v1",
        anchor: ANCHOR,
        predicates: [
          "entity_category",
          "mapped_hiking_route_membership",
          "trail_difficulty",
          "trail_visibility",
          "access_restriction"
        ],
        searchRadiusMeters: 8_000,
        limit: 12
      });
    });
    const highlightCall = harness.queryCalls.find((call) =>
      call.text.includes("trailmind_runtime_outdoor_research_highlights_v1")
    );
    assert.deepEqual(highlightCall.values.slice(1, 8), [
      "harz-v1",
      10.6,
      51.8,
      ["viewpoint"],
      8_000,
      ["entity_category", "viewpoint_presence"],
      12
    ]);
    assert.equal(highlightCall.values[8], 75);
    const membershipCall = harness.queryCalls.find((call) =>
      call.text.includes("trailmind_runtime_outdoor_research_route_memberships_v1")
    );
    assert.deepEqual(membershipCall.values.slice(1), [
      "harz-v1",
      10.6,
      51.8,
      8_000,
      12,
      1
    ]);
  });

  it("returns the exact mapped evidence class selected from a route relationship", async () => {
    const membershipRow = {
      relationship_id: "60000000-0000-4000-8000-000000000001",
      segment_entity_id: "50000000-0000-4000-8000-000000000002",
      route_entity_id: "50000000-0000-4000-8000-000000000001",
      evidence_class: "mapped"
    };
    const harness = repositoryHarness({
      membershipRows: [membershipRow]
    });
    const result = await harness.repository.withConsistentSnapshot(
      {},
      (session) => session.retrieveMappedHikingRoutes({
        projectionRunId: activeSnapshotRow().projection_run_id,
        operationalRegionId: "harz-v1",
        anchor: ANCHOR,
        predicates: ["mapped_hiking_route_membership"],
        searchRadiusMeters: 8_000,
        limit: 1
      })
    );
    assert.equal(result.memberships[0].evidence_class, "mapped");
    assert.equal(result.assertions.length, 0);
  });

  it("does not query an already-aborted request and cancels between operations", async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    let connectCalls = 0;
    const repository = new PostgresOutdoorResearchRepository({
      pool: {
        async connect() {
          connectCalls += 1;
          throw new Error("must not connect");
        }
      }
    });
    await assert.rejects(
      () => repository.withConsistentSnapshot(
        { signal: alreadyAborted.signal },
        () => undefined
      ),
      hasCode("request_cancelled")
    );
    assert.equal(connectCalls, 0);

    const controller = new AbortController();
    const harness = repositoryHarness({ snapshotRow: activeSnapshotRow() });
    await assert.rejects(
      () => harness.repository.withConsistentSnapshot(
        { signal: controller.signal },
        async (session) => {
          await session.resolveCapabilities(BINDING, ANCHOR, NOW);
          controller.abort();
          await session.discoverHighlights({
            projectionRunId: activeSnapshotRow().projection_run_id,
            operationalRegionId: "harz-v1",
            anchor: ANCHOR,
            entityCategories: ["viewpoint"],
            predicates: ["entity_category"],
            searchRadiusMeters: 8_000,
            limit: 1
          });
        }
      ),
      hasCode("request_cancelled")
    );
    assert.equal(
      harness.queryCalls.some((call) => call.text.includes("candidates AS")),
      false
    );
    assert.equal(harness.commands.includes("ROLLBACK"), true);
  });

  it("maps database timeout and private failures to fixed safe errors", async () => {
    for (const [error, expectedCode] of [
      [Object.assign(new Error("private SQL detail"), { code: "57014" }),
        "repository_timed_out"],
      [new Error("private hostname and table detail"), "repository_failed"]
    ]) {
      const harness = repositoryHarness({ queryError: error });
      await assert.rejects(
        () => harness.repository.withConsistentSnapshot(
          {},
          (session) => session.resolveCapabilities(BINDING, ANCHOR, NOW)
        ),
        (caught) => {
          assert.equal(caught.code, expectedCode);
          assert.equal(caught.message.includes("private"), false);
          return true;
        }
      );
      assert.equal(harness.commands.includes("ROLLBACK"), true);
    }
  });

  it("rejects oversized and invalid operation bounds", async () => {
    const harness = repositoryHarness({
      highlightRows: Array.from({ length: 161 }, () => ({}))
    });
    await assert.rejects(
      () => harness.repository.withConsistentSnapshot({}, (session) =>
        session.discoverHighlights({
          projectionRunId: activeSnapshotRow().projection_run_id,
          operationalRegionId: "harz-v1",
          anchor: ANCHOR,
          entityCategories: ["viewpoint"],
          predicates: ["entity_category"],
          searchRadiusMeters: 8_000,
          limit: 32
        })
      ),
      hasCode("result_too_large")
    );
    const boundsHarness = repositoryHarness();
    await assert.rejects(
      () => boundsHarness.repository.withConsistentSnapshot({}, (session) =>
        session.discoverHighlights({
          projectionRunId: activeSnapshotRow().projection_run_id,
          operationalRegionId: "harz-v1",
          anchor: ANCHOR,
          entityCategories: ["viewpoint"],
          predicates: ["entity_category"],
          searchRadiusMeters: 8_000,
          limit: 33
        })
      ),
      hasCode("operation_scope_violation")
    );
  });
});

function repositoryHarness(options = {}) {
  const commands = [];
  const queryCalls = [];
  let didRelease = false;
  const client = {
    async query(input, legacyValues) {
      const text = typeof input === "string" ? input : input.text;
      const values = typeof input === "string" ? legacyValues : input.values;
      if (!values && [
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        "COMMIT",
        "ROLLBACK"
      ].includes(text)) {
        commands.push(text);
        return { rows: [] };
      }
      if (text.startsWith("SELECT set_config")) {
        commands.push("SELECT set_config('statement_timeout', $1, true)");
        return { rows: [] };
      }
      queryCalls.push({ text, values });
      if (options.queryError) throw options.queryError;
      if (text.includes("trailmind_runtime_outdoor_research_snapshot_context_v1")) {
        return runtimeRows(options.snapshotRow ? [options.snapshotRow] : []);
      }
      if (text.includes("trailmind_runtime_outdoor_research_trail_access_candidates_v1")) {
        return runtimeRows(options.trailAccessRows ?? []);
      }
      if (text.includes("trailmind_runtime_outdoor_research_highlights_v1")) {
        return runtimeRows(options.highlightRows ?? []);
      }
      if (text.includes("trailmind_runtime_outdoor_research_route_memberships_v1")) {
        return runtimeRows(options.membershipRows ?? []);
      }
      if (text.includes("trailmind_runtime_outdoor_research_route_assertions_v1")) {
        return runtimeRows(options.assertionRows ?? []);
      }
      throw new Error("unexpected fake query");
    },
    release() { didRelease = true; }
  };
  return {
    repository: new PostgresOutdoorResearchRepository({
      pool: { async connect() { return client; } }
    }),
    commands,
    queryCalls,
    released: () => didRelease
  };
}

function runtimeRows(rows) {
  return { rows: rows.map((runtime_row) => ({ runtime_row })) };
}

function activeSnapshotRow(overrides = {}) {
  return {
    region_id: "harz-v1",
    region_enabled: true,
    active_import_id: "10000000-0000-4000-8000-000000000001",
    freshness_threshold_days: 14,
    anchor_inside: true,
    boundary_distance_meters: 12_000,
    import_status: "active",
    source_data_at: "2026-07-24T00:00:00Z",
    import_retrieved_at: "2026-07-24T01:00:00Z",
    imported_at: "2026-07-24T02:00:00Z",
    projection_run_id: "20000000-0000-4000-8000-000000000001",
    input_import_id: "10000000-0000-4000-8000-000000000001",
    source_id: "40000000-0000-4000-8000-000000000001",
    source_policy_id: "50000000-0000-4000-8000-000000000001",
    source_policy_version: "osm-foundational-mapped-v1",
    adapter_schema_version: "osm-evidence-graph-v1",
    source_key: "osm_foundational_data",
    source_category: "openstreetmap_open_mapping",
    license_identifier: "ODbL-1.0",
    attribution_requirements: "© OpenStreetMap contributors",
    expected_refresh_interval_seconds: 86_400,
    last_successful_retrieval_at: "2026-07-24T01:00:00Z",
    source_lifecycle_state: "active",
    source_normalized_facts_allowed: true,
    policy_schema_version: 1,
    maximum_input_age_days: 14,
    policy_lifecycle_state: "active",
    policy_normalized_facts_allowed: true,
    policy_derived_features_allowed: false,
    policy_scopes: OSM_ASSERTION_POLICY_SCOPES.map((scope) => ({ ...scope })),
    authority_scopes: OSM_ASSERTION_POLICY_SCOPES.map((scope) => ({ ...scope })),
    relationship_scopes: OSM_RELATIONSHIP_POLICY_SCOPES.map((scope) => ({
      ...scope
    })),
    ...overrides
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}
