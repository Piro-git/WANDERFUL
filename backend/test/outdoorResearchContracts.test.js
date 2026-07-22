import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  serializeOutdoorResearchContract,
  validateAdventureResearchDossierV1,
  validateAdventureResearchIntentV1,
  validateEvidenceClaimV1,
  validateHighlightCandidateV1,
  validateResearchPlanV1
} from "../src/outdoorResearch/validation.js";
import {
  adventureResearchDossier,
  completeAdventureResearchIntent,
  evidenceClaim,
  highlightCandidate,
  minimalAdventureResearchIntent,
  officialClaim,
  OUTDOOR_RESEARCH_TEST_IDS,
  researchPlan
} from "./outdoorResearchTestSupport.js";

describe("outdoor research v1 contracts", () => {
  it("accepts valid minimal and complete AdventureResearchIntentV1 values", () => {
    assert.equal(validateAdventureResearchIntentV1(minimalAdventureResearchIntent()).schemaVersion, 1);
    const complete = validateAdventureResearchIntentV1(completeAdventureResearchIntent());
    assert.equal(complete.geographicAnchor.name, "Innsbruck");
    assert.deepEqual(complete.mustHaveExperiences, [
      { experience: "viewpoint", minimumCount: 2 },
      { experience: "waterfall", minimumCount: 1 }
    ]);
  });

  it("rejects invalid activity, difficulty, entity category and evidence category values", () => {
    assert.throws(() => validateAdventureResearchIntentV1(
      completeAdventureResearchIntent({ activity: "skiing" })
    ));
    assert.throws(() => validateAdventureResearchIntentV1(
      completeAdventureResearchIntent({ maximumTechnicalDifficulty: "easy" })
    ));
    assert.throws(() => validateHighlightCandidateV1(
      highlightCandidate({ highlightCategory: "beautiful_view" })
    ));
    assert.throws(() => validateEvidenceClaimV1(
      evidenceClaim({ evidenceClass: "social_media" })
    ));
  });

  it("rejects excessive arrays, strings and serialized payloads", () => {
    assert.throws(() => validateAdventureResearchIntentV1(completeAdventureResearchIntent({
      mustHaveExperiences: Array.from(
        { length: 17 }, (_, index) => ({ experience: index === 0 ? "viewpoint" : "waterfall", minimumCount: 1 })
      )
    })));
    assert.throws(() => validateAdventureResearchIntentV1(completeAdventureResearchIntent({
      geographicAnchor: {
        state: "resolved",
        name: "x".repeat(161),
        coordinate: { latitude: 47, longitude: 11 },
        regionEntityId: null
      }
    })));
    assert.throws(() => validateEvidenceClaimV1(evidenceClaim({
      provenance: { identifier: "x".repeat(20_000), adapterVersion: "v1", recordVersion: 1 }
    })));
  });

  it("rejects invalid coordinates, timestamps and inconsistent ranges", () => {
    assert.throws(() => validateAdventureResearchIntentV1(completeAdventureResearchIntent({
      geographicAnchor: {
        state: "resolved", name: "Invalid", coordinate: { latitude: 91, longitude: 11 },
        regionEntityId: null
      }
    })));
    assert.throws(() => validateEvidenceClaimV1(evidenceClaim({ retrievedAt: "not-a-time" })));
    assert.throws(() => validateEvidenceClaimV1(evidenceClaim({
      retrievedAt: "2026-02-30T09:00:00Z"
    })));
    assert.throws(() => validateAdventureResearchIntentV1(completeAdventureResearchIntent({
      dateOrSeason: { kind: "date", date: "2026-02-30" }
    })));
    assert.throws(() => validateAdventureResearchIntentV1(completeAdventureResearchIntent({
      distanceRangeKm: { min: 20, max: 10 }
    })));
    assert.throws(() => validateAdventureResearchIntentV1(completeAdventureResearchIntent({
      durationRangeMinutes: { min: 300, max: 200 }
    })));
  });

  it("rejects unknown fields at every contract boundary", () => {
    assert.throws(() => validateAdventureResearchIntentV1({
      ...completeAdventureResearchIntent(), originalPrompt: "copy this everywhere"
    }));
    assert.throws(() => validateEvidenceClaimV1({ ...evidenceClaim(), persuasiveSummary: "trust me" }));
    assert.throws(() => validateHighlightCandidateV1({ ...highlightCandidate(), routeGeometry: [] }));
  });

  it("accepts typed research operations and rejects provider URLs, SQL, shell and recursive plans", () => {
    assert.equal(validateResearchPlanV1(researchPlan()).operations.length, 1);
    for (const forbidden of ["providerUrl", "sql", "shellCommand", "subplan", "routeGeometry"]) {
      const operation = { ...researchPlan().operations[0], [forbidden]: "forbidden" };
      assert.throws(() => validateResearchPlanV1(researchPlan({ operations: [operation] })));
    }
    assert.throws(() => validateResearchPlanV1(researchPlan({
      operations: [{
        ...researchPlan().operations[0],
        operationType: "inspect_access_evidence",
        informationNeed: "access_and_legal_status",
        reasonCode: "high_stakes_verification",
        acceptableSourceCategories: ["model_inference", "trailmind_community"],
        predicates: ["public_access"]
      }]
    })));
  });

  it("validates typed claims and keeps an unknown value distinct from false", () => {
    const unknown = validateEvidenceClaimV1(evidenceClaim({
      value: { type: "unknown" },
      freshness: "unknown",
      resolutionState: "unknown",
      relevantLimitationCodes: ["insufficient_evidence"]
    }));
    assert.deepEqual(unknown.value, { type: "unknown" });
    assert.notDeepEqual(unknown.value, { type: "boolean", value: false });
  });

  it("rejects inconsistent source/evidence classes and high-stakes non-official resolution", () => {
    assert.throws(() => validateEvidenceClaimV1(evidenceClaim({ evidenceClass: "official" })));
    assert.throws(() => validateEvidenceClaimV1(evidenceClaim({
      predicate: "public_access",
      value: { type: "boolean", value: true },
      resolutionState: "known"
    })));
  });

  it("validates highlight claim references and excludes unsupported scenic persuasion", () => {
    const candidate = validateHighlightCandidateV1(highlightCandidate());
    assert.equal(candidate.relevanceReasons[0].code, "mapped_viewpoint");
    assert.throws(() => validateHighlightCandidateV1(highlightCandidate({
      relevanceReasons: [{ code: "beautiful_view", evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.claim] }]
    })));
  });

  it("validates complete dossiers and rejects geometry, raw HTML and dangling claim references", () => {
    const dossier = validateAdventureResearchDossierV1(adventureResearchDossier());
    assert.equal(dossier.candidateHighlights.length, 1);
    assert.throws(() => validateAdventureResearchDossierV1({
      ...adventureResearchDossier(), routePolyline: [[11, 47], [11.1, 47.1]]
    }));
    assert.throws(() => validateAdventureResearchDossierV1(adventureResearchDossier({
      rawHtml: "<html>source</html>"
    })));
    assert.throws(() => validateAdventureResearchDossierV1(adventureResearchDossier({
      sourceProvenanceSummary: [{
        ...adventureResearchDossier().sourceProvenanceSummary[0],
        licenseIdentifier: "<html>not-a-license</html>"
      }]
    })));
    assert.throws(() => validateAdventureResearchDossierV1(adventureResearchDossier({
      candidateHighlights: [highlightCandidate({
        evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.secondClaim],
        relevanceReasons: [{
          code: "mapped_viewpoint", evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.secondClaim]
        }]
      })]
    })));
  });

  it("rejects dossier candidates whose claims belong to another entity or category", () => {
    assert.throws(() => validateAdventureResearchDossierV1(adventureResearchDossier({
      evidenceClaims: [evidenceClaim({ entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity })]
    })));

    const routeCategory = evidenceClaim({
      entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity,
      value: { type: "text", value: "hiking_route" }
    });
    assert.throws(() => validateAdventureResearchDossierV1(dossierForClaims([routeCategory], {
      mappedOrOfficialRouteCandidates: [{
        entityId: OUTDOOR_RESEARCH_TEST_IDS.entity,
        entityCategory: "hiking_route",
        sourceBasis: "mapped",
        evidenceClaimIds: [routeCategory.claimId],
        knownLimitations: []
      }]
    })));
  });

  it("rejects relevance codes unsupported by compatible predicates, categories and classes", () => {
    assert.throws(() => validateAdventureResearchDossierV1(adventureResearchDossier({
      candidateHighlights: [highlightCandidate({
        relevanceReasons: [{
          code: "mapped_waterfall", evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.claim]
        }]
      })]
    })));
    assert.throws(() => validateHighlightCandidateV1(highlightCandidate({
      relevanceReasons: [{
        code: "low_derived_detour_cost", evidenceClaimIds: [OUTDOOR_RESEARCH_TEST_IDS.claim]
      }]
    })));

    const category = evidenceClaim();
    const name = evidenceClaim({
      claimId: OUTDOOR_RESEARCH_TEST_IDS.secondClaim,
      predicate: "name",
      value: { type: "text", value: "Test viewpoint" },
      provenance: { identifier: "node/123/name", adapterVersion: "osm-graph-v1", recordVersion: 7 }
    });
    assert.throws(() => validateAdventureResearchDossierV1(dossierForClaims([category, name], {
      candidateHighlights: [highlightCandidate({
        evidenceClaimIds: [category.claimId, name.claimId],
        relevanceReasons: [{ code: "mapped_viewpoint", evidenceClaimIds: [name.claimId] }]
      })]
    })));

    const officialCategory = officialClaim({
      predicate: "entity_category",
      value: { type: "text", value: "viewpoint" }
    });
    assert.throws(() => validateAdventureResearchDossierV1(dossierForClaims([officialCategory], {
      candidateHighlights: [highlightCandidate({
        evidenceClaimIds: [officialCategory.claimId],
        relevanceReasons: [{
          code: "mapped_viewpoint", evidenceClaimIds: [officialCategory.claimId]
        }]
      })]
    })));
  });

  it("requires time-sensitive checks to match and actually resolve their declared state", () => {
    const unavailable = officialClaim({ resolutionState: "unavailable" });
    assert.throws(() => validateAdventureResearchDossierV1(dossierForClaims([unavailable], {
      timeSensitiveChecks: [{
        entityId: unavailable.entityId,
        predicate: unavailable.predicate,
        state: "complete",
        evidenceClaimIds: [unavailable.claimId]
      }]
    })));
    const available = officialClaim();
    assert.throws(() => validateAdventureResearchDossierV1(dossierForClaims([available], {
      timeSensitiveChecks: [{
        entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity,
        predicate: available.predicate,
        state: "complete",
        evidenceClaimIds: [available.claimId]
      }]
    })));
    assert.throws(() => validateAdventureResearchDossierV1(dossierForClaims([available], {
      timeSensitiveChecks: [{
        entityId: available.entityId,
        predicate: "current_opening",
        state: "complete",
        evidenceClaimIds: [available.claimId]
      }]
    })));
  });

  it("requires conflict groups to match their cohort and resolve conflicted", () => {
    const claims = [
      officialClaim(),
      officialClaim({
        claimId: OUTDOOR_RESEARCH_TEST_IDS.secondClaim,
        sourceReference: {
          sourceId: OUTDOOR_RESEARCH_TEST_IDS.secondSource,
          sourceKey: "innsbruck.operator",
          sourceCategory: "official_operator"
        }
      })
    ];
    assert.throws(() => validateAdventureResearchDossierV1(dossierForClaims(claims, {
      conflictingEvidence: [{
        entityId: claims[0].entityId,
        predicate: claims[0].predicate,
        evidenceClaimIds: claims.map((claim) => claim.claimId)
      }]
    })));
    const mismatched = { ...claims[1], entityId: OUTDOOR_RESEARCH_TEST_IDS.secondEntity };
    assert.throws(() => validateAdventureResearchDossierV1(dossierForClaims([
      claims[0], mismatched
    ], {
      conflictingEvidence: [{
        entityId: claims[0].entityId,
        predicate: claims[0].predicate,
        evidenceClaimIds: claims.map((claim) => claim.claimId)
      }]
    })));
    assert.throws(() => validateAdventureResearchDossierV1(dossierForClaims(claims, {
      conflictingEvidence: [{
        entityId: claims[0].entityId,
        predicate: "current_opening",
        evidenceClaimIds: claims.map((claim) => claim.claimId)
      }]
    })));
  });

  it("requires entity-candidate source basis to agree with referenced evidence classes", () => {
    const routeCategory = evidenceClaim({ value: { type: "text", value: "hiking_route" } });
    assert.throws(() => validateAdventureResearchDossierV1(dossierForClaims([routeCategory], {
      mappedOrOfficialRouteCandidates: [{
        entityId: routeCategory.entityId,
        entityCategory: "hiking_route",
        sourceBasis: "official",
        evidenceClaimIds: [routeCategory.claimId],
        knownLimitations: []
      }]
    })));
  });

  it("serializes validated contracts deterministically", () => {
    const first = adventureResearchDossier();
    const second = Object.fromEntries(Object.entries(first).reverse());
    assert.equal(
      serializeOutdoorResearchContract("AdventureResearchDossierV1", first),
      serializeOutdoorResearchContract("AdventureResearchDossierV1", second)
    );
    assert.throws(() => serializeOutdoorResearchContract("UnknownV1", first));
  });
});

function dossierForClaims(claims, overrides = {}) {
  const summaries = new Map();
  for (const claim of claims) {
    const source = claim.sourceReference;
    const existing = summaries.get(source.sourceId);
    if (existing) {
      if (!existing.evidenceClasses.includes(claim.evidenceClass)) {
        existing.evidenceClasses.push(claim.evidenceClass);
      }
      continue;
    }
    summaries.set(source.sourceId, {
      sourceId: source.sourceId,
      sourceKey: source.sourceKey,
      sourceCategory: source.sourceCategory,
      evidenceClasses: [claim.evidenceClass],
      licenseIdentifier: "test-license",
      attributionRequired: false,
      retrievedAt: claim.retrievedAt
    });
  }
  return adventureResearchDossier({
    evidenceClaims: claims,
    candidateHighlights: [],
    mappedOrOfficialRouteCandidates: [],
    overnightCandidates: [],
    timeSensitiveChecks: [],
    conflictingEvidence: [],
    sourceProvenanceSummary: [...summaries.values()],
    ...overrides
  });
}
