import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OutdoorResearchExecutorError
} from "../src/outdoorResearch/executorPolicy.js";
import {
  assembleAdventureResearchDossierV1
} from "../src/outdoorResearch/dossierAssembler.js";
import {
  researchOutdoorAdventureV1
} from "../src/outdoorResearch/outdoorResearchExecutor.js";
import {
  buildResearchGuidedRouteCandidatePlanV1
} from "../src/routeResearch/researchGuidedRouteCandidatePlanner.js";
import {
  routeResearchGuidedCandidatesV1
} from "../src/routeResearch/researchGuidedRoutingAdapter.js";
import {
  OUTDOOR_RESEARCH_REGION_BINDINGS_V1
} from "../src/outdoorResearch/regionBindings.js";
import {
  serializeOutdoorResearchContract,
  validateAdventureResearchDossierV1
} from "../src/outdoorResearch/validation.js";

const NOW = new Date("2026-07-24T12:00:00Z");
const SOURCE_ID = "10000000-0000-4000-8000-000000000001";
const PROJECTION_RUN_ID = "20000000-0000-4000-8000-000000000001";
const HIGHLIGHT_IDS = Object.freeze({
  viewpointNear: "40000000-0000-4000-8000-000000000001",
  viewpointFar: "40000000-0000-4000-8000-000000000002",
  waterfall: "40000000-0000-4000-8000-000000000003",
  peak: "40000000-0000-4000-8000-000000000004",
  hut: "40000000-0000-4000-8000-000000000005"
});
const ROUTE_ID = "50000000-0000-4000-8000-000000000001";
const SEGMENT_ID = "50000000-0000-4000-8000-000000000002";

describe("outdoor research executor and dossier assembler", () => {
  it("executes a valid ready plan and returns a validated mapped dossier", async () => {
    const harness = fakeRepository();
    const result = await researchOutdoorAdventureV1(readyIntent(), dependencies(harness));
    assert.equal(result.state, "ready");
    assert.doesNotThrow(() => validateAdventureResearchDossierV1(result.dossier));
    assert.deepEqual(
      result.dossier.candidateHighlights.map((item) => item.highlightCategory),
      ["viewpoint", "viewpoint", "waterfall", "peak", "alpine_hut"]
    );
    assert.equal(result.dossier.mappedOrOfficialRouteCandidates.length, 1);
    assert.equal(
      result.dossier.mappedOrOfficialRouteCandidates[0].sourceBasis,
      "mapped"
    );
    assert(result.dossier.mappedOrOfficialRouteCandidates[0].knownLimitations
      .includes("official_status_unverified"));
    assert.equal(result.dossier.overnightCandidates.length, 1);
    assert(result.dossier.overnightCandidates[0].knownLimitations
      .includes("opening_unverified"));
    assert(result.dossier.overnightCandidates[0].knownLimitations
      .includes("overnight_legality_unverified"));
    assert(result.dossier.overnightCandidates[0].knownLimitations
      .includes("water_availability_unverified"));
    assert(result.dossier.overnightCandidates[0].knownLimitations
      .includes("bookability_unverified"));
    assert(result.dossier.overnightCandidates[0].knownLimitations
      .includes("seasonal_status_unverified"));
    assert.equal(
      result.dossier.evidenceClaims.some((claim) =>
        claim.predicate === "public_access"),
      false
    );
    assert(result.dossier.candidateHighlights.every((candidate) =>
      candidate.knownLimitations.includes("route_connection_unverified")
    ));
    assert(result.dossier.evidenceGaps.some((gap) =>
      gap.code === "missing_route_connection" &&
      gap.entityId === null &&
      gap.predicate === null
    ));
  });

  it("defaults to the exact production dossier assembler", async () => {
    const implicit = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository())
    );
    const explicit = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository(), {
        assembleDossier: assembleAdventureResearchDossierV1
      })
    );
    assert.equal(
      serializeOutdoorResearchContract(
        "AdventureResearchDossierV1",
        implicit.dossier
      ),
      serializeOutdoorResearchContract(
        "AdventureResearchDossierV1",
        explicit.dossier
      )
    );
  });

  it("passes the exact assembly input and result through an injected wrapper", async () => {
    const harness = fakeRepository();
    let assemblyInput = null;
    let assembledDossier = null;
    let assemblyCalls = 0;
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(harness, {
        async assembleDossier(input) {
          assemblyCalls += 1;
          assemblyInput = input;
          assembledDossier = assembleAdventureResearchDossierV1(input);
          return assembledDossier;
        }
      })
    );

    assert.equal(assemblyCalls, 1);
    assert.deepEqual(Object.keys(assemblyInput).sort(), [
      "binding",
      "evidenceRecords",
      "generatedAt",
      "normalizedIntent",
      "planningGaps",
      "searchRadiusMeters",
      "snapshot"
    ]);
    assert.equal(assemblyInput.normalizedIntent, result.normalizedIntent);
    assert.equal(assemblyInput.binding, harness.bindings[0]);
    assert.equal(assemblyInput.generatedAt.getTime(), NOW.getTime());
    assert.equal(Array.isArray(assemblyInput.evidenceRecords), true);
    assert.equal(assemblyInput.evidenceRecords.length > 0, true);
    assert.equal(result.dossier, assembledDossier);
  });

  it("rejects invalid dossier assembler injection before repository work", async () => {
    for (const assembleDossier of [null, false, "assembler", {}, []]) {
      const harness = fakeRepository();
      await assert.rejects(
        () => researchOutdoorAdventureV1(
          readyIntent(),
          dependencies(harness, { assembleDossier })
        ),
        hasCode("invalid_dependencies")
      );
      assert.equal(harness.snapshotCalls, 0);
      assert.equal(harness.evidenceCalls.length, 0);
    }
  });

  it("returns clarification with zero repository calls", async () => {
    const harness = fakeRepository();
    const result = await researchOutdoorAdventureV1(
      unresolvedIntent(),
      dependencies(harness)
    );
    assert.equal(result.state, "clarification_required");
    assert.equal(harness.snapshotCalls, 0);
    assert.equal(harness.evidenceCalls.length, 0);
  });

  it("binds a nil region ID to the one reviewed polygon before repository work", async () => {
    const harness = fakeRepository();
    const result = await researchOutdoorAdventureV1(
      readyIntent({
        geographicAnchor: {
          state: "resolved",
          name: "Harz",
          coordinate: { latitude: 51.8, longitude: 10.6 },
          regionEntityId: null
        }
      }),
      dependencies(harness)
    );
    assert.equal(result.state, "ready");
    assert.equal(
      result.normalizedIntent.geographicAnchor.regionEntityId,
      "30000000-0000-4000-8000-000000000002"
    );
    assert.equal(
      result.dossier.normalizedIntent.geographicAnchor.regionEntityId,
      "30000000-0000-4000-8000-000000000002"
    );
    assert.deepEqual(result.dossier.regionCoverage.regionEntityIds, [
      "30000000-0000-4000-8000-000000000002"
    ]);
    assert.equal(harness.snapshotCalls, 1);
    assert.equal(
      harness.bindings[0].operationalRegionId,
      "harz-v1"
    );
  });

  it("returns unsupported for a nil binding outside coverage without repository work", async () => {
    const harness = fakeRepository();
    const result = await researchOutdoorAdventureV1(
      readyIntent({
        geographicAnchor: {
          state: "resolved",
          name: "Outside reviewed coverage",
          coordinate: { latitude: 45, longitude: 8 },
          regionEntityId: null
        }
      }),
      dependencies(harness)
    );
    assert.equal(result.state, "unsupported");
    assert.equal(result.availabilityState, "unsupported_region");
    assert.equal(
      result.normalizedIntent.geographicAnchor.regionEntityId,
      null
    );
    assert.equal(harness.snapshotCalls, 0);
    assert.equal(harness.evidenceCalls.length, 0);
  });

  it("rejects a supplied binding that mismatches the reviewed polygon without repository work", async () => {
    const harness = fakeRepository();
    const result = await researchOutdoorAdventureV1(
      readyIntent({
        geographicAnchor: {
          state: "resolved",
          name: "Harz",
          coordinate: { latitude: 51.8, longitude: 10.6 },
          regionEntityId: "30000000-0000-4000-8000-000000000001"
        }
      }),
      dependencies(harness)
    );
    assert.equal(result.state, "unsupported");
    assert.equal(result.availabilityState, "unsupported_region");
    assert.equal(
      result.normalizedIntent.geographicAnchor.regionEntityId,
      "30000000-0000-4000-8000-000000000001"
    );
    assert.equal(harness.snapshotCalls, 0);
    assert.equal(harness.evidenceCalls.length, 0);
  });

  it("returns unsupported for an unknown exact binding with zero repository calls", async () => {
    const harness = fakeRepository();
    const intent = readyIntent({
      geographicAnchor: {
        state: "resolved",
        name: "Outside pilot",
        coordinate: { latitude: 45, longitude: 8 },
        regionEntityId: "99999999-9999-4999-8999-999999999999"
      }
    });
    const result = await researchOutdoorAdventureV1(intent, dependencies(harness));
    assert.equal(result.state, "unsupported");
    assert.equal(result.availabilityState, "unsupported_region");
    assert.equal(harness.snapshotCalls, 0);
    assert.equal(harness.evidenceCalls.length, 0);
  });

  it("supports exact Harz and Innsbruck bindings without fallback", async () => {
    for (const binding of OUTDOOR_RESEARCH_REGION_BINDINGS_V1) {
      const harness = fakeRepository();
      const coordinate = binding.operationalRegionId === "harz-v1"
        ? { latitude: 51.8, longitude: 10.6 }
        : { latitude: 47.2692, longitude: 11.4041 };
      const result = await researchOutdoorAdventureV1(
        readyIntent({
          geographicAnchor: {
            state: "resolved",
            name: binding.displayName,
            coordinate,
            regionEntityId: binding.regionEntityId
          }
        }),
        dependencies(harness)
      );
      assert.equal(result.state, "ready");
      assert.equal(harness.bindings[0].operationalRegionId, binding.operationalRegionId);
    }
  });

  it("fails an anchor outside its exact polygon closed before evidence queries", async () => {
    const harness = fakeRepository({ availabilityState: "outside_region" });
    const result = await researchOutdoorAdventureV1(readyIntent(), dependencies(harness));
    assert.equal(result.state, "unsupported");
    assert.equal(result.availabilityState, "outside_region");
    assert.equal(harness.evidenceCalls.length, 0);
  });

  it("rejects a snapshot whose region identity differs from the exact binding", async () => {
    const harness = fakeRepository({
      snapshotMutation(snapshot) {
        snapshot.operationalRegionId = "innsbruck-alps-v1";
      }
    });
    await assert.rejects(
      () => researchOutdoorAdventureV1(readyIntent(), dependencies(harness)),
      hasCode("inconsistent_snapshot")
    );
    assert.equal(harness.evidenceCalls.length, 0);
  });

  it("reports inactive, revoked and stale source state without evidence queries", async () => {
    for (const availabilityState of ["source_unavailable", "source_stale"]) {
      const harness = fakeRepository({ availabilityState });
      const result = await researchOutdoorAdventureV1(
        readyIntent(),
        dependencies(harness)
      );
      assert.equal(result.state, "unsupported");
      assert.equal(result.availabilityState, availabilityState);
      assert.equal(harness.evidenceCalls.length, 0);
      assert(result.planningGaps.some((gap) =>
        gap.code === "mapped_source_unavailable" ||
        gap.code === "operation_type_unavailable"
      ));
    }
  });

  it("dispatches validated operations in deterministic plan order", async () => {
    const first = fakeRepository();
    const second = fakeRepository();
    await researchOutdoorAdventureV1(readyIntent(), dependencies(first));
    await researchOutdoorAdventureV1(readyIntent(), dependencies(second));
    assert.deepEqual(first.evidenceCalls, second.evidenceCalls);
    assert.equal(first.evidenceCalls.at(-1), "retrieve_mapped_hiking_routes");
    assert(first.evidenceCalls.slice(0, -1).every((name) =>
      name === "discover_highlights"
    ));
  });

  it("materializes default loop highlights only as mapped viewpoint/waterfall facts", async () => {
    for (const activity of ["hiking", "trail_running"]) {
      const harness = fakeRepository();
      const result = await researchOutdoorAdventureV1(
        genericLoopIntent({ activity }),
        dependencies(harness)
      );

      assert.equal(result.state, "ready");
      assert.deepEqual(harness.evidenceCalls, [
        "discover_highlights",
        "retrieve_mapped_hiking_routes"
      ]);
      assert.deepEqual(result.normalizedIntent.mustHaveExperiences, []);
      assert.deepEqual(result.normalizedIntent.preferredExperiences, []);
      assert.deepEqual(
        result.dossier.candidateHighlights.map((candidate) =>
          candidate.highlightCategory
        ),
        ["viewpoint", "viewpoint", "waterfall"]
      );
      for (const candidate of result.dossier.candidateHighlights) {
        assert.deepEqual(
          candidate.relevanceReasons.map((reason) => reason.code),
          [candidate.highlightCategory === "viewpoint"
            ? "mapped_viewpoint"
            : "mapped_waterfall"]
        );
        assert.equal(candidate.knownLimitations.includes("access_unverified"), true);
        assert.equal(
          candidate.knownLimitations.includes("route_connection_unverified"),
          true
        );
      }
      const serialized = JSON.stringify(result.dossier.candidateHighlights);
      for (const forbidden of [
        "request_must_have",
        "request_preference",
        "scenic",
        "official",
        "current_opening",
        "public_access",
        "safe"
      ]) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
      }
    }
  });

  it("keeps a generic loop with no mapped highlights truthfully empty", async () => {
    const harness = fakeRepository({ highlightRows: [] });
    const result = await researchOutdoorAdventureV1(
      genericLoopIntent(),
      dependencies(harness)
    );

    assert.equal(result.state, "ready");
    assert.deepEqual(harness.evidenceCalls, [
      "discover_highlights",
      "retrieve_mapped_hiking_routes"
    ]);
    assert.deepEqual(result.dossier.candidateHighlights, []);
    assert.deepEqual(result.normalizedIntent.mustHaveExperiences, []);
    assert.deepEqual(result.normalizedIntent.preferredExperiences, []);
    assert.equal(result.dossier.evidenceClaims.some((claim) =>
      claim.predicate === "viewpoint_presence" ||
      claim.predicate === "waterfall_presence"
    ), false);
  });

  it("composes planner, executor, candidate planning and routing with a neutral fallback role", async () => {
    const highlightRows = defaultHighlightRows().map((row, index) => ({
      ...row,
      latitude: 51.81 + index * 0.001,
      longitude: 10.62 + index * 0.001
    }));
    const harness = fakeRepository({ highlightRows });
    const research = await researchOutdoorAdventureV1(
      genericLoopIntent(),
      dependencies(harness)
    );
    const candidatePlan =
      buildResearchGuidedRouteCandidatePlanV1(
        research.dossier,
        { maximumProposals: 1 }
      );
    const providerRequests = [];
    const routed = await routeResearchGuidedCandidatesV1(
      candidatePlan,
      {
        provider: {
          async route(routeRequest) {
            providerRequests.push(routeRequest);
            return routedProviderResponse(routeRequest);
          }
        }
      }
    );

    assert.deepEqual(harness.evidenceCalls, [
      "discover_highlights",
      "retrieve_mapped_hiking_routes"
    ]);
    assert.equal(candidatePlan.state, "partial");
    assert.equal(candidatePlan.proposals.length, 1);
    assert.equal(
      candidatePlan.proposals[0].viaCandidates[0].role,
      "available_candidate"
    );
    assert.deepEqual(
      candidatePlan.proposals[0].viaCandidates[0].selectionReasons,
      ["available_research_candidate"]
    );
    assert.equal(providerRequests.length, 1);
    assert.equal(routed.state, "routed");
    const selected = routed.attempts[0].provenance.selectedWaypoints[0];
    assert.equal(selected.role, "available_candidate");
    assert.notEqual(selected.role, "preferred");
    assert.notEqual(selected.role, "must_have");
    assert.deepEqual(selected.selectionReasons, [
      "available_research_candidate"
    ]);
  });

  it("rejects source-category, entity-category and predicate scope escapes", async () => {
    for (const mutation of [
      (row) => { row.source_category = "official_authority"; },
      (row) => { row.entity_category = "lake"; },
      (row) => { row.predicate = "closure_status"; }
    ]) {
      const row = assertionRow({
        assertionNumber: 80,
        entityId: HIGHLIGHT_IDS.viewpointNear,
        category: "viewpoint",
        predicate: "entity_category",
        valueType: "text",
        value: "viewpoint",
        distanceMeters: 800
      });
      mutation(row);
      const harness = fakeRepository({
        highlightRows: [row],
        bypassHighlightFiltering: true
      });
      await assert.rejects(
        () => researchOutdoorAdventureV1(readyIntent(), dependencies(harness)),
        hasCode("operation_scope_violation")
      );
    }
  });

  it("rejects malformed and duplicate repository rows", async () => {
    const malformed = assertionRow({
      assertionNumber: 81,
      entityId: HIGHLIGHT_IDS.viewpointNear,
      category: "viewpoint",
      predicate: "entity_category",
      valueType: "text",
      value: "viewpoint",
      distanceMeters: 800
    });
    malformed.retrieved_at = "not-a-date";
    await assert.rejects(
      () => researchOutdoorAdventureV1(
        readyIntent(),
        dependencies(fakeRepository({ highlightRows: [malformed] }))
      ),
      hasCode("malformed_evidence")
    );

    const duplicate = defaultHighlightRows()[0];
    await assert.rejects(
      () => researchOutdoorAdventureV1(
        readyIntent(),
        dependencies(fakeRepository({ highlightRows: [duplicate, duplicate] }))
      ),
      hasCode("malformed_evidence")
    );
  });

  it("requires exact mapped provenance on every route-membership row", async () => {
    for (const evidenceClass of [
      undefined,
      "official",
      "community_observed",
      "derived",
      "model_inferred",
      "unknown"
    ]) {
      const routeResult = defaultRouteResult();
      routeResult.memberships[0].evidence_class = evidenceClass;
      await assert.rejects(
        () => researchOutdoorAdventureV1(
          readyIntent(),
          dependencies(fakeRepository({ routeResult }))
        ),
        hasCode("operation_scope_violation")
      );
    }
  });

  it("rejects permissively parseable assertion and freshness timestamps", async () => {
    const invalidTimestamps = [
      "2026-02-30T10:00:00Z",
      "2026",
      "2026-07-24T10:00:00",
      "2026-07-24T12:00:00+02:00",
      "not-a-date",
      new Date(Number.NaN)
    ];
    for (const invalidTimestamp of invalidTimestamps) {
      const row = assertionRow({
        assertionNumber: 82,
        entityId: HIGHLIGHT_IDS.viewpointNear,
        category: "viewpoint",
        predicate: "entity_category",
        valueType: "text",
        value: "viewpoint",
        distanceMeters: 800
      });
      row.retrieved_at = invalidTimestamp;
      await assert.rejects(
        () => researchOutdoorAdventureV1(
          readyIntent(),
          dependencies(fakeRepository({ highlightRows: [row] }))
        ),
        hasCode("malformed_evidence")
      );
    }

    const invalidFreshnessBound = assertionRow({
      assertionNumber: 83,
      entityId: HIGHLIGHT_IDS.viewpointNear,
      category: "viewpoint",
      predicate: "entity_category",
      valueType: "text",
      value: "viewpoint",
      distanceMeters: 800
    });
    invalidFreshnessBound.valid_until = "2026-02-30T10:00:00Z";
    await assert.rejects(
      () => researchOutdoorAdventureV1(
        readyIntent(),
        dependencies(fakeRepository({ highlightRows: [invalidFreshnessBound] }))
      ),
      hasCode("malformed_evidence")
    );
  });

  it("rejects malformed relationship, snapshot, and clock timestamps", async () => {
    const routeResult = defaultRouteResult();
    routeResult.memberships[0].observed_at = "2026-07-24T10:00:00";
    await assert.rejects(
      () => researchOutdoorAdventureV1(
        readyIntent(),
        dependencies(fakeRepository({ routeResult }))
      ),
      hasCode("malformed_evidence")
    );

    for (const field of ["sourceDataAt", "retrievedAt", "importedAt"]) {
      const harness = fakeRepository({
        snapshotMutation(snapshot) {
          snapshot[field] = "2026-02-30T10:00:00Z";
        }
      });
      await assert.rejects(
        () => researchOutdoorAdventureV1(readyIntent(), dependencies(harness)),
        hasCode("malformed_evidence")
      );
    }

    for (const value of [
      "2026",
      "2026-07-24T12:00:00",
      "2026-07-24T14:00:00+02:00",
      new Date(Number.NaN)
    ]) {
      await assert.rejects(
        () => researchOutdoorAdventureV1(
          readyIntent(),
          dependencies(fakeRepository(), { clock: () => value })
        ),
        hasCode("invalid_dependencies")
      );
    }
  });

  it("keeps mapped access restrictions unresolved and never infers public access", async () => {
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository())
    );
    const access = result.dossier.evidenceClaims.find((claim) =>
      claim.predicate === "access_restriction"
    );
    assert.equal(access.evidenceClass, "mapped");
    assert.equal(access.resolutionState, "unavailable");
    assert(access.relevantLimitationCodes.includes("access_unverified"));
    assert.equal(result.dossier.evidenceClaims.some((claim) =>
      claim.predicate === "public_access"), false);
  });

  it("preserves mapped claim provenance and source attribution", async () => {
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository())
    );
    const claim = result.dossier.evidenceClaims[0];
    assert.equal(claim.evidenceClass, "mapped");
    assert.match(claim.provenance.identifier, /^osm:/);
    assert.equal(claim.provenance.adapterVersion, "osm-evidence-graph-v1");
    assert.equal(claim.sourceReference.sourceId, SOURCE_ID);
    assert.deepEqual(result.dossier.sourceProvenanceSummary, [{
      sourceId: SOURCE_ID,
      sourceKey: "osm_foundational_data",
      sourceCategory: "openstreetmap_open_mapping",
      evidenceClasses: ["mapped"],
      licenseIdentifier: "ODbL-1.0",
      attributionRequired: true,
      retrievedAt: "2026-07-24T10:00:00.000Z"
    }]);
  });

  it("preserves conflicting evidence without choosing a convenient value", async () => {
    const rows = defaultHighlightRows();
    rows.push(assertionRow({
      assertionNumber: 83,
      entityId: HIGHLIGHT_IDS.viewpointNear,
      category: "viewpoint",
      predicate: "viewpoint_presence",
      valueType: "boolean",
      value: false,
      distanceMeters: 800
    }));
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository({ highlightRows: rows }))
    );
    const conflict = result.dossier.conflictingEvidence.find((item) =>
      item.entityId === HIGHLIGHT_IDS.viewpointNear &&
      item.predicate === "viewpoint_presence"
    );
    assert.equal(conflict.evidenceClaimIds.length, 2);
  });

  it("retains stale evidence unresolved and excludes it from candidates", async () => {
    const rows = defaultHighlightRows().map((row) => ({ ...row }));
    for (const row of rows) {
      if (row.entity_id === HIGHLIGHT_IDS.waterfall) {
        row.freshness_state = "stale";
      }
    }
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository({ highlightRows: rows }))
    );
    assert.equal(result.dossier.freshnessState, "stale");
    assert.equal(result.dossier.candidateHighlights.some((candidate) =>
      candidate.entityId === HIGHLIGHT_IDS.waterfall), false);
  });

  it("reports exact must-have minimum-count shortfalls", async () => {
    const rows = defaultHighlightRows().filter((row) =>
      row.entity_id !== HIGHLIGHT_IDS.viewpointFar
    );
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository({ highlightRows: rows }))
    );
    assert(result.dossier.evidenceGaps.some((gap) =>
      gap.code === "insufficient_candidate_count" &&
      gap.experience === "viewpoint" &&
      gap.requiredMinimumCount === 2 &&
      gap.foundCount === 1
    ));
  });

  it("counts one or several mapped routes as zero official hiking routes", async () => {
    for (const [routeCount, requiredMinimumCount] of [[1, 1], [3, 2]]) {
      const result = await researchOutdoorAdventureV1(
        readyIntent({
          mustHaveExperiences: [{
            experience: "official_hiking_route",
            minimumCount: requiredMinimumCount
          }],
          preferredExperiences: []
        }),
        dependencies(fakeRepository({
          highlightRows: [],
          routeResult: mappedRouteResult(routeCount)
        }))
      );
      assert.equal(result.dossier.mappedOrOfficialRouteCandidates.length, routeCount);
      assert(result.dossier.mappedOrOfficialRouteCandidates.every((candidate) =>
        candidate.sourceBasis === "mapped"
      ));
      assert.deepEqual(
        result.dossier.evidenceGaps.find((gap) =>
          gap.code === "insufficient_candidate_count" &&
          gap.experience === "official_hiking_route"
        ),
        {
          code: "insufficient_candidate_count",
          experience: "official_hiking_route",
          requiredMinimumCount,
          foundCount: 0
        }
      );
      assert(result.dossier.evidenceGaps.some((gap) =>
        gap.code === "missing_official_status"
      ));
    }
  });

  it("keeps preferred official-route status unresolved without a counted shortfall", async () => {
    const result = await researchOutdoorAdventureV1(
      readyIntent({
        mustHaveExperiences: [],
        preferredExperiences: ["official_hiking_route"]
      }),
      dependencies(fakeRepository({ routeResult: mappedRouteResult(2) }))
    );
    assert.equal(result.dossier.mappedOrOfficialRouteCandidates.length, 2);
    assert(result.dossier.evidenceGaps.some((gap) =>
      gap.code === "missing_official_status"
    ));
    assert.equal(result.dossier.evidenceGaps.some((gap) =>
      gap.code === "insufficient_candidate_count" &&
      gap.experience === "official_hiking_route"
    ), false);
  });

  it("never reuses segment-route membership as highlight connectivity", async () => {
    for (const routeResult of [
      defaultRouteResult(),
      mappedRouteResult(3),
      { memberships: [], assertions: [] }
    ]) {
      const result = await researchOutdoorAdventureV1(
        readyIntent(),
        dependencies(fakeRepository({ routeResult }))
      );
      assert(result.dossier.candidateHighlights.every((candidate) =>
        candidate.knownLimitations.includes("route_connection_unverified")
      ));
      assert(result.dossier.evidenceGaps.some((gap) =>
        gap.code === "missing_route_connection" &&
        gap.predicate === null
      ));
      if (routeResult.memberships.length > 0) {
        assert(result.dossier.evidenceClaims.some((claim) =>
          claim.predicate === "mapped_hiking_route_membership"
        ));
      }
    }
  });

  it("reports unknown dossier freshness when the repository returns zero claims", async () => {
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository({
        highlightRows: [],
        routeResult: { memberships: [], assertions: [] }
      }))
    );
    assert.equal(result.state, "ready");
    assert.equal(result.dossier.evidenceClaims.length, 0);
    assert.equal(result.dossier.freshnessState, "unknown");
    assert.equal(result.dossier.expiresAt, "2026-07-25T10:00:00.000Z");
  });

  it("orders candidates by request tier, verified distance, then UUID", async () => {
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository())
    );
    assert.deepEqual(
      result.dossier.candidateHighlights.map((candidate) => candidate.entityId),
      [
        HIGHLIGHT_IDS.viewpointNear,
        HIGHLIGHT_IDS.viewpointFar,
        HIGHLIGHT_IDS.waterfall,
        HIGHLIGHT_IDS.peak,
        HIGHLIGHT_IDS.hut
      ]
    );
  });

  it("deduplicates one entity discovered by overlapping must-have and preference operations", async () => {
    const result = await researchOutdoorAdventureV1(
      readyIntent({ preferredExperiences: ["peak", "viewpoint"] }),
      dependencies(fakeRepository())
    );
    const viewpointIds = result.dossier.candidateHighlights
      .filter((candidate) => candidate.highlightCategory === "viewpoint")
      .map((candidate) => candidate.entityId);
    assert.deepEqual(viewpointIds, [
      HIGHLIGHT_IDS.viewpointNear,
      HIGHLIGHT_IDS.viewpointFar
    ]);
    assert.equal(new Set(result.dossier.evidenceClaims.map((claim) =>
      claim.claimId)).size, result.dossier.evidenceClaims.length);
  });

  it("never labels an OSM route official or adds route geometry/stats", async () => {
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository())
    );
    const route = result.dossier.mappedOrOfficialRouteCandidates[0];
    assert.equal(route.sourceBasis, "mapped");
    assert.deepEqual(Object.keys(route).sort(), [
      "entityCategory",
      "entityId",
      "evidenceClaimIds",
      "knownLimitations",
      "sourceBasis"
    ]);
    assert.equal(JSON.stringify(route).includes("geometry"), false);
    assert.equal(JSON.stringify(route).includes("distance"), false);
  });

  it("models a mapped hut only as a limited location candidate", async () => {
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository())
    );
    const hutClaims = result.dossier.evidenceClaims.filter((claim) =>
      claim.entityId === HIGHLIGHT_IDS.hut
    );
    assert.equal(hutClaims.some((claim) =>
      ["current_opening", "overnight_permission", "bookability",
        "drinking_water_availability"].includes(claim.predicate)), false);
    assert(result.dossier.evidenceGaps.some((gap) =>
      gap.code === "missing_opening_evidence"
    ));
  });

  it("cancels before execution and between operations", async () => {
    const before = new AbortController();
    before.abort();
    const beforeHarness = fakeRepository();
    await assert.rejects(
      () => researchOutdoorAdventureV1(
        readyIntent(),
        dependencies(beforeHarness, { signal: before.signal })
      ),
      hasCode("request_cancelled")
    );
    assert.equal(beforeHarness.snapshotCalls, 0);

    const between = new AbortController();
    const betweenHarness = fakeRepository({
      afterFirstEvidenceCall: () => between.abort()
    });
    await assert.rejects(
      () => researchOutdoorAdventureV1(
        readyIntent(),
        dependencies(betweenHarness, { signal: between.signal })
      ),
      hasCode("request_cancelled")
    );
    assert.equal(betweenHarness.evidenceCalls.length, 1);
  });

  it("preserves repository timeout as a bounded safe error", async () => {
    const privateError = new OutdoorResearchExecutorError("repository_timed_out", {
      cause: new Error("private SQL and hostname")
    });
    const harness = fakeRepository({ executionError: privateError });
    await assert.rejects(
      () => researchOutdoorAdventureV1(readyIntent(), dependencies(harness)),
      (error) => {
        assert.equal(error.code, "repository_timed_out");
        assert.equal(error.message.includes("private"), false);
        return true;
      }
    );
  });

  it("enforces one total deadline without returning a partial dossier", async () => {
    const harness = fakeRepository({ waitForAbort: true });
    await assert.rejects(
      () => researchOutdoorAdventureV1(
        readyIntent(),
        dependencies(harness, { totalTimeoutMs: 250 })
      ),
      hasCode("execution_timed_out")
    );
  });

  it("is byte-for-byte deterministic and deeply immutable", async () => {
    const first = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository())
    );
    const second = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository())
    );
    assert.equal(
      serializeOutdoorResearchContract("AdventureResearchDossierV1", first.dossier),
      serializeOutdoorResearchContract("AdventureResearchDossierV1", second.dossier)
    );
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.dossier), true);
    assert.equal(Object.isFrozen(first.dossier.evidenceClaims), true);
    assert.equal(Object.isFrozen(first.dossier.candidateHighlights[0]), true);
  });

  it("accepts the maximum bounded highlight-candidate collection", async () => {
    const rows = Array.from({ length: 32 }, (_, index) =>
      assertionRow({
        assertionNumber: 200 + index,
        entityId: numberedUuid("4", index + 200),
        category: "viewpoint",
        predicate: "entity_category",
        valueType: "text",
        value: "viewpoint",
        distanceMeters: 1_000 + index
      })
    );
    const result = await researchOutdoorAdventureV1(
      readyIntent(),
      dependencies(fakeRepository({ highlightRows: rows }))
    );
    assert.equal(result.state, "ready");
    assert.equal(result.dossier.candidateHighlights.length, 32);
    assert.equal(result.dossier.evidenceClaims.length >= 32, true);
  });

  it("rejects oversized accumulated evidence", async () => {
    const rows = Array.from({ length: 161 }, (_, index) =>
      assertionRow({
        assertionNumber: 100 + index,
        entityId: numberedUuid("4", index + 100),
        category: "viewpoint",
        predicate: "entity_category",
        valueType: "text",
        value: "viewpoint",
        distanceMeters: 1_000 + index
      })
    );
    const harness = fakeRepository({ highlightRows: rows });
    await assert.rejects(
      () => researchOutdoorAdventureV1(readyIntent(), dependencies(harness)),
      hasCode("result_too_large")
    );
  });
});

function dependencies(harness, overrides = {}) {
  return {
    repository: harness.repository,
    clock: () => new Date(NOW),
    ...overrides
  };
}

function fakeRepository(options = {}) {
  const highlightRows = options.highlightRows ?? defaultHighlightRows();
  const routeResult = options.routeResult ?? defaultRouteResult();
  const harness = {
    snapshotCalls: 0,
    evidenceCalls: [],
    bindings: []
  };
  harness.repository = {
    async withConsistentSnapshot({ signal }, work) {
      harness.snapshotCalls += 1;
      if (signal.aborted) throw new OutdoorResearchExecutorError("request_cancelled");
      return work({
        async resolveCapabilities(binding) {
          harness.bindings.push(binding);
          const availabilityState = options.availabilityState ?? "active";
          if (availabilityState !== "active") {
            return {
              availabilityState,
              capabilities: emptyCapabilities(),
              snapshot: null
            };
          }
          return {
            availabilityState: "active",
            capabilities: activeCapabilities(binding.regionEntityId),
            snapshot: (() => {
              const snapshot = activeSnapshot(binding);
              options.snapshotMutation?.(snapshot);
              return snapshot;
            })()
          };
        },
        async discoverHighlights(request) {
          harness.evidenceCalls.push("discover_highlights");
          options.afterFirstEvidenceCall?.();
          if (options.waitForAbort) await rejectWhenAborted(signal);
          if (signal.aborted) throw new OutdoorResearchExecutorError("request_cancelled");
          if (options.executionError) throw options.executionError;
          return options.bypassHighlightFiltering
            ? highlightRows
            : highlightRows.filter((row) =>
              request.entityCategories.includes(row.entity_category) &&
              request.predicates.includes(row.predicate)
            );
        },
        async retrieveMappedHikingRoutes(request) {
          harness.evidenceCalls.push("retrieve_mapped_hiking_routes");
          if (signal.aborted) throw new OutdoorResearchExecutorError("request_cancelled");
          if (options.executionError) throw options.executionError;
          return {
            memberships: routeResult.memberships,
            assertions: routeResult.assertions.filter((row) =>
              request.predicates.includes(row.predicate)
            )
          };
        }
      });
    }
  };
  return harness;
}

function activeCapabilities(regionEntityId) {
  return {
    supportedRegionIds: [regionEntityId],
    availableSourceCategories: ["openstreetmap_open_mapping"],
    supportedEvidencePredicates: [
      "entity_category",
      "name",
      "operator",
      "access_restriction",
      "trail_difficulty",
      "trail_visibility",
      "viewpoint_presence",
      "waterfall_presence",
      "mapped_hiking_route_membership"
    ],
    enabledOperationTypes: [
      "discover_highlights",
      "retrieve_mapped_hiking_routes"
    ]
  };
}

function emptyCapabilities() {
  return {
    supportedRegionIds: [],
    availableSourceCategories: [],
    supportedEvidencePredicates: [],
    enabledOperationTypes: []
  };
}

function activeSnapshot(binding) {
  return {
    schemaVersion: 1,
    regionEntityId: binding.regionEntityId,
    operationalRegionId: binding.operationalRegionId,
    projectionRunId: PROJECTION_RUN_ID,
    sourceId: SOURCE_ID,
    sourcePolicyId: "20000000-0000-4000-8000-000000000002",
    importId: "20000000-0000-4000-8000-000000000003",
    sourceDataAt: "2026-07-24T10:00:00.000Z",
    retrievedAt: "2026-07-24T10:00:00.000Z",
    importedAt: "2026-07-24T10:00:00.000Z",
    boundaryDistanceMeters: 50_000,
    freshnessLimitMilliseconds: 86_400_000,
    source: {
      sourceId: SOURCE_ID,
      sourceKey: "osm_foundational_data",
      sourceCategory: "openstreetmap_open_mapping",
      licenseIdentifier: "ODbL-1.0",
      attributionRequired: true
    }
  };
}

function defaultHighlightRows() {
  const definitions = [
    [1, HIGHLIGHT_IDS.viewpointNear, "viewpoint", 800],
    [2, HIGHLIGHT_IDS.viewpointFar, "viewpoint", 1_200],
    [3, HIGHLIGHT_IDS.waterfall, "waterfall", 1_600],
    [4, HIGHLIGHT_IDS.peak, "peak", 1_900],
    [5, HIGHLIGHT_IDS.hut, "alpine_hut", 2_100]
  ];
  const rows = [];
  for (const [number, entityId, category, distanceMeters] of definitions) {
    rows.push(assertionRow({
      assertionNumber: number * 10,
      entityId,
      category,
      predicate: "entity_category",
      valueType: "text",
      value: category,
      distanceMeters
    }));
    if (category === "viewpoint") {
      rows.push(assertionRow({
        assertionNumber: number * 10 + 1,
        entityId,
        category,
        predicate: "viewpoint_presence",
        valueType: "boolean",
        value: true,
        distanceMeters
      }));
    }
    if (category === "waterfall") {
      rows.push(assertionRow({
        assertionNumber: number * 10 + 1,
        entityId,
        category,
        predicate: "waterfall_presence",
        valueType: "boolean",
        value: true,
        distanceMeters
      }));
    }
  }
  return rows;
}

function defaultRouteResult() {
  return {
    memberships: [{
      relationship_id: "60000000-0000-4000-8000-000000000001",
      segment_entity_id: SEGMENT_ID,
      route_entity_id: ROUTE_ID,
      evidence_class: "mapped",
      observed_at: "2026-07-23T10:00:00Z",
      retrieved_at: "2026-07-24T10:00:00Z",
      valid_from: null,
      valid_until: null,
      freshness_state: "current",
      provenance_identifier: "osm:relation/1@7/member/way/2",
      record_provenance: { relation_osm_version: 7 },
      distance_meters: 700,
      ...sourceFields()
    }],
    assertions: [
      assertionRow({
        assertionNumber: 60,
        entityId: ROUTE_ID,
        category: "hiking_route",
        predicate: "entity_category",
        valueType: "text",
        value: "hiking_route",
        distanceMeters: null
      }),
      assertionRow({
        assertionNumber: 61,
        entityId: ROUTE_ID,
        category: "hiking_route",
        predicate: "name",
        valueType: "text",
        value: "Mapped relation",
        distanceMeters: null
      }),
      assertionRow({
        assertionNumber: 62,
        entityId: SEGMENT_ID,
        category: "trail_segment",
        predicate: "entity_category",
        valueType: "text",
        value: "trail_segment",
        distanceMeters: null
      }),
      assertionRow({
        assertionNumber: 63,
        entityId: SEGMENT_ID,
        category: "trail_segment",
        predicate: "trail_difficulty",
        valueType: "text",
        value: "mountain_hiking",
        distanceMeters: null
      }),
      assertionRow({
        assertionNumber: 64,
        entityId: SEGMENT_ID,
        category: "trail_segment",
        predicate: "trail_visibility",
        valueType: "text",
        value: "good",
        distanceMeters: null
      }),
      assertionRow({
        assertionNumber: 65,
        entityId: SEGMENT_ID,
        category: "trail_segment",
        predicate: "access_restriction",
        valueType: "text",
        value: "conditional",
        distanceMeters: null
      })
    ]
  };
}

function mappedRouteResult(count) {
  const memberships = [];
  const assertions = [];
  for (let index = 0; index < count; index += 1) {
    const routeEntityId = numberedUuid("5", 100 + index);
    const segmentEntityId = numberedUuid("5", 500 + index);
    memberships.push({
      relationship_id: numberedUuid("6", 100 + index),
      segment_entity_id: segmentEntityId,
      route_entity_id: routeEntityId,
      evidence_class: "mapped",
      observed_at: "2026-07-23T10:00:00Z",
      retrieved_at: "2026-07-24T10:00:00Z",
      valid_from: null,
      valid_until: null,
      freshness_state: "current",
      provenance_identifier:
        `osm:relation/${100 + index}@7/member/way/${500 + index}`,
      record_provenance: { relation_osm_version: 7 },
      distance_meters: 700 + index,
      ...sourceFields()
    });
    assertions.push(
      assertionRow({
        assertionNumber: 600 + index * 2,
        entityId: routeEntityId,
        category: "hiking_route",
        predicate: "entity_category",
        valueType: "text",
        value: "hiking_route",
        distanceMeters: null
      }),
      assertionRow({
        assertionNumber: 601 + index * 2,
        entityId: segmentEntityId,
        category: "trail_segment",
        predicate: "entity_category",
        valueType: "text",
        value: "trail_segment",
        distanceMeters: null
      })
    );
  }
  return { memberships, assertions };
}

function assertionRow(input) {
  const row = {
    entity_id: input.entityId,
    entity_category: input.category,
    source_version: 3,
    record_provenance: { osm_version: 3 },
    assertion_id: numberedUuid("7", input.assertionNumber),
    predicate: input.predicate,
    value_type: input.valueType,
    value_text: null,
    value_boolean: null,
    value_number: null,
    value_integer: null,
    value_timestamp: null,
    value_entity_id: null,
    evidence_class: "mapped",
    observed_at: "2026-07-23T10:00:00Z",
    retrieved_at: "2026-07-24T10:00:00Z",
    valid_from: null,
    valid_until: null,
    freshness_state: "current",
    provenance_identifier:
      `osm:node/${input.assertionNumber}@3#${input.predicate}`,
    adapter_schema_version: "osm-evidence-graph-v1",
    latitude: input.distanceMeters === null ? undefined : 51.8,
    longitude: input.distanceMeters === null ? undefined : 10.6,
    distance_meters: input.distanceMeters,
    ...sourceFields()
  };
  const column = {
    text: "value_text",
    boolean: "value_boolean",
    number: "value_number",
    integer: "value_integer",
    timestamp: "value_timestamp",
    entity_reference: "value_entity_id"
  }[input.valueType];
  row[column] = input.value;
  return row;
}

function sourceFields() {
  return {
    source_id: SOURCE_ID,
    source_key: "osm_foundational_data",
    source_category: "openstreetmap_open_mapping",
    license_identifier: "ODbL-1.0",
    attribution_requirements: "© OpenStreetMap contributors",
    adapter_schema_version: "osm-evidence-graph-v1"
  };
}

function readyIntent(overrides = {}) {
  return {
    schemaVersion: 1,
    activity: "hiking",
    geographicAnchor: {
      state: "resolved",
      name: "Harz",
      coordinate: { latitude: 51.8, longitude: 10.6 },
      regionEntityId: "30000000-0000-4000-8000-000000000002"
    },
    routeType: "loop",
    distanceRangeKm: { min: 12, max: 14 },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: "mountain_hiking",
    mustHaveExperiences: [
      { experience: "viewpoint", minimumCount: 2 },
      { experience: "waterfall", minimumCount: 1 }
    ],
    preferredExperiences: ["peak"],
    avoidedExperiences: [],
    requiredFacilities: ["lunch_hut"],
    groupContext: {
      partySize: 2,
      includesChildren: false,
      youngestAge: null,
      mobility: "standard",
      experienceLevel: "intermediate"
    },
    dateOrSeason: null,
    overnightRequirements: {
      required: false,
      nights: 0,
      allowedAccommodationTypes: []
    },
    transportRequirements: {
      arrivalMode: "walking",
      returnToStart: true,
      publicTransportRequired: false
    },
    unresolvedClarificationQuestions: [],
    ...overrides
  };
}

function genericLoopIntent(overrides = {}) {
  return readyIntent({
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [],
    preferredExperiences: [],
    requiredFacilities: [],
    ...overrides
  });
}

function routedProviderResponse(routeRequest) {
  const start = routeRequest.points[0];
  const via = routeRequest.points[1];
  return {
    provider: "graphhopper",
    paths: [{
      distance: 12_000,
      time: 10_800_000,
      ascend: 400,
      descend: 400,
      points: {
        type: "LineString",
        coordinates: [
          [start.longitude, start.latitude, 500],
          [via.longitude, via.latitude, 650],
          [start.longitude, start.latitude, 500]
        ]
      },
      instructions: [{
        text: "Continue",
        distance: 12_000,
        time: 10_800_000,
        interval: [0, 2],
        sign: 0
      }],
      details: {
        surface: [[0, 2, "ground"]],
        road_class: [[0, 2, "path"]],
        hike_rating: [[0, 2, "1"]]
      },
      snapped_waypoints: {
        type: "LineString",
        coordinates: routeRequest.points.map((point) => [
          point.longitude,
          point.latitude
        ])
      }
    }]
  };
}

function unresolvedIntent() {
  return readyIntent({
    geographicAnchor: {
      state: "unresolved",
      requirementCode: "location_required"
    },
    unresolvedClarificationQuestions: [{
      code: "location_required",
      field: "geographicAnchor"
    }]
  });
}

function numberedUuid(prefix, number) {
  const suffix = String(number).padStart(12, "0");
  return `${prefix}0000000-0000-4000-8000-${suffix}`;
}

function hasCode(code) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message.length < 120, true);
    return true;
  };
}

function rejectWhenAborted(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new OutdoorResearchExecutorError("request_cancelled"));
      return;
    }
    signal.addEventListener("abort", () => {
      reject(new OutdoorResearchExecutorError("request_cancelled"));
    }, { once: true });
  });
}
