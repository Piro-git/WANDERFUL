import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1,
  ResearchGuidedRouteCandidateError,
  buildResearchGuidedRouteCandidatePlanV1,
  researchGuidedRouteCandidatePlannerInternalsForTesting,
  serializeResearchGuidedRouteCandidatePlanV1
} from "../src/routeResearch/index.js";
import {
  OUTDOOR_RESEARCH_TEST_IDS,
  adventureResearchDossier,
  completeAdventureResearchIntent,
  evidenceClaim,
  highlightCandidate
} from "./outdoorResearchTestSupport.js";

const MAPPED_SOURCE_SUMMARY = Object.freeze({
  sourceId: OUTDOOR_RESEARCH_TEST_IDS.source,
  sourceKey: "openstreetmap.harz-v1",
  sourceCategory: "openstreetmap_open_mapping",
  evidenceClasses: ["mapped"],
  licenseIdentifier: "ODbL-1.0",
  attributionRequired: true,
  retrievedAt: "2026-07-20T09:00:00Z"
});
const OFFICIAL_SOURCE_SUMMARY = Object.freeze({
  sourceId: OUTDOOR_RESEARCH_TEST_IDS.secondSource,
  sourceKey: "authority.test",
  sourceCategory: "official_authority",
  evidenceClasses: ["official"],
  licenseIdentifier: "test-only",
  attributionRequired: true,
  retrievedAt: "2026-07-20T09:00:00Z"
});

test("builder preserves minimum counts with distinct exact dossier coordinates", () => {
  const intent = plainIntent({
    mustHaveExperiences: [
      { experience: "viewpoint", minimumCount: 2 },
      { experience: "waterfall", minimumCount: 1 }
    ]
  });
  const dossier = makeDossier({
    intent,
    highlights: [
      { category: "viewpoint", coordinate: { latitude: 47.01, longitude: 11.01 } },
      { category: "viewpoint", coordinate: { latitude: 47.02, longitude: 11.02 } },
      { category: "waterfall", coordinate: { latitude: 47.03, longitude: 11.03 } }
    ]
  });
  const plan = buildResearchGuidedRouteCandidatePlanV1(dossier);
  const proposal = plan.proposals[0];

  assert.equal(proposal.viaCandidates.length, 3);
  assert.equal(
    new Set(proposal.viaCandidates.map((candidate) => candidate.entityId)).size,
    3
  );
  assert.deepEqual(
    proposal.viaCandidates
      .map((candidate) => candidate.coordinate)
      .sort(compareCoordinates),
    dossier.candidateHighlights
      .map((candidate) => candidate.coordinate)
      .sort(compareCoordinates)
  );
  assert.deepEqual(
    proposal.satisfiedRequirements
      .filter((item) => item.requirementType === "must_have_experience")
      .map((item) => [item.value, item.includedCount]),
    [["viewpoint", 2], ["waterfall", 1]]
  );
});

test("must-have shortfalls are exact and candidates are never duplicated", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 2 }]
    }),
    highlights: [{ category: "viewpoint" }]
  }));
  const shortfall = plan.proposals[0].unsatisfiedRequirements.find(
    (item) => item.value === "viewpoint"
  );

  assert.deepEqual(shortfall, {
    requirementType: "must_have_experience",
    value: "viewpoint",
    requestedCount: 2,
    availableCount: 1,
    includedCount: 1,
    shortfallCount: 1
  });
  assert.equal(
    plan.evidenceGaps.some(
      (item) =>
        item.code === "must_have_shortfall" &&
        item.requiredCount === 2 &&
        item.availableCount === 1
    ),
    true
  );
});

test("preferences never displace satisfiable must-have candidates", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 5 }],
      preferredExperiences: ["lake"]
    }),
    highlights: [
      ...Array.from({ length: 5 }, () => ({ category: "viewpoint" })),
      { category: "lake" }
    ]
  }));
  const categories = plan.proposals[0].viaCandidates.map(
    (candidate) => candidate.highlightCategory
  );

  assert.deepEqual(categories, Array(5).fill("viewpoint"));
  assert.equal(
    plan.proposals[0].satisfiedRequirements.some(
      (item) => item.value === "viewpoint" && item.includedCount === 5
    ),
    true
  );
});

test("waypoint budget remains explicit rather than silently downgrading counts", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 8 }]
    }),
    highlights: Array.from({ length: 8 }, () => ({ category: "viewpoint" }))
  }));
  const shortfall = plan.proposals[0].unsatisfiedRequirements.find(
    (item) => item.value === "viewpoint"
  );

  assert.equal(plan.proposals[0].viaCandidates.length, 5);
  assert.equal(shortfall.shortfallCount, 3);
  assert.equal(
    plan.evidenceGaps.some(
      (item) => item.code === "waypoint_budget_exceeded"
    ),
    true
  );
});

test("simple current official access evidence can produce a ready brief", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({
      distanceRangeKm: null,
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }]
    }),
    highlights: [{
      category: "viewpoint",
      claims: [
        { predicate: "public_access", type: "boolean", value: true, official: true },
        { predicate: "closure_status", type: "text", value: "open", official: true }
      ]
    }]
  }));

  assert.equal(plan.state, "ready");
  assert.deepEqual(plan.unmetRequirements, []);
  assert.equal(
    plan.requiredVerification.includes("real_routing_required"),
    true
  );
  assert.equal(
    plan.requiredVerification.includes("public_access_required"),
    false
  );
});

test("unknown access and closure remain partial verification requirements", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent(),
    highlights: [{ category: "viewpoint" }]
  }));

  assert.equal(plan.state, "partial");
  assert.ok(plan.requiredVerification.includes("public_access_required"));
  assert.ok(plan.requiredVerification.includes("closure_status_required"));
  assert.ok(
    plan.unmetRequirements.some(
      (item) => item.value === "candidate_public_access"
    )
  );
});

test("restrictive current official access never satisfies unrestricted access", () => {
  for (const restriction of [
    "restricted",
    "conditional",
    "permit_required"
  ]) {
    const dossier = makeDossier({
      intent: plainIntent({
        distanceRangeKm: null,
        mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }]
      }),
      highlights: [{
        category: "viewpoint",
        claims: [
          {
            predicate: "public_access",
            type: "boolean",
            value: true,
            official: true
          },
          {
            predicate: "access_restriction",
            type: "text",
            value: restriction,
            official: true
          },
          {
            predicate: "closure_status",
            type: "text",
            value: "open",
            official: true
          }
        ]
      }]
    });
    const plan = buildResearchGuidedRouteCandidatePlanV1(dossier);
    const candidate = plan.proposals[0].viaCandidates[0];
    const restrictionClaim = dossier.evidenceClaims.find(
      (claim) => claim.predicate === "access_restriction"
    );

    assert.equal(plan.state, "partial", restriction);
    assert.ok(candidate.requiredVerification.includes(
      "access_restriction_required"
    ), restriction);
    assert.ok(candidate.knownLimitations.includes(
      "access_restriction_unverified"
    ), restriction);
    assert.ok(
      candidate.evidenceClaimIds.includes(restrictionClaim.claimId),
      restriction
    );
    assert.ok(plan.unmetRequirements.some(
      (item) =>
        item.value === "candidate_public_access" &&
        item.shortfallCount === 1
    ), restriction);
    assert.ok(plan.evidenceGaps.some(
      (item) =>
        item.code === "access_restriction_unverified" &&
        item.entityId === candidate.entityId &&
        item.predicate === "access_restriction"
    ), restriction);
  }
});

test("access denial, prohibition, and current closure use exact exclusion gaps", () => {
  const cases = [
    {
      claims: [{
        predicate: "public_access",
        type: "boolean",
        value: false,
        official: true
      }],
      code: "candidate_access_denied",
      predicate: "public_access"
    },
    {
      claims: [{
        predicate: "access_restriction",
        type: "text",
        value: "prohibited",
        official: true
      }],
      code: "candidate_access_denied",
      predicate: "access_restriction"
    },
    {
      claims: [{
        predicate: "closure_status",
        type: "text",
        value: "closed",
        official: true
      }],
      code: "candidate_currently_closed",
      predicate: "closure_status"
    }
  ];
  for (const specification of cases) {
    const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent(),
      highlights: [{
        category: "viewpoint",
        claims: specification.claims
      }]
    }));
    assert.equal(plan.state, "insufficient_evidence");
    assert.ok(plan.evidenceGaps.some(
      (item) =>
        item.code === specification.code &&
        item.entityId === entityUuid(1) &&
        item.predicate === specification.predicate
    ));
    assert.equal(plan.evidenceGaps.some(
      (item) =>
        item.entityId === entityUuid(1) &&
        item.code === "incompatible_difficulty"
    ), false);
  }
});

test("conflicting current access evidence is retained and never resolved optimistically", () => {
  const dossier = makeDossier({
    intent: plainIntent(),
    highlights: [{
      category: "viewpoint",
      conflictedPredicate: "public_access",
      claims: [
        { predicate: "public_access", type: "boolean", value: true, official: true },
        { predicate: "public_access", type: "boolean", value: false, official: true }
      ]
    }]
  });
  const plan = buildResearchGuidedRouteCandidatePlanV1(dossier);
  const candidate = plan.proposals[0].viaCandidates[0];

  assert.equal(plan.state, "partial");
  assert.ok(candidate.requiredVerification.includes("public_access_required"));
  assert.equal(
    candidate.evidenceClaimIds.includes(dossier.evidenceClaims[1].claimId),
    true
  );
  assert.equal(
    candidate.evidenceClaimIds.includes(dossier.evidenceClaims[2].claimId),
    true
  );
});

test("known incompatible difficulty is excluded while unknown difficulty stays unresolved", () => {
  const intent = plainIntent({
    maximumTechnicalDifficulty: "hiking"
  });
  const excessive = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent,
    highlights: [{
      category: "viewpoint",
      claims: [{
        predicate: "trail_difficulty",
        type: "text",
        value: "alpine_hiking"
      }]
    }]
  }));
  assert.equal(excessive.state, "insufficient_evidence");
  assert.ok(
    excessive.evidenceGaps.some(
      (item) => item.code === "incompatible_difficulty"
    )
  );

  const unknown = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent,
    highlights: [{ category: "viewpoint" }]
  }));
  assert.ok(unknown.requiredVerification.includes("trail_difficulty_required"));
  assert.equal(unknown.state, "partial");
});

test("beginner, children, and limited mobility uncertainty is never suitability", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({
      groupContext: {
        partySize: 3,
        includesChildren: true,
        youngestAge: 8,
        mobility: "limited",
        experienceLevel: "beginner"
      }
    }),
    highlights: [{ category: "viewpoint" }]
  }));
  const serialized = serializeResearchGuidedRouteCandidatePlanV1(plan);

  for (const code of [
    "beginner_suitability_required",
    "child_suitability_required",
    "mobility_suitability_required"
  ]) {
    assert.ok(plan.requiredVerification.includes(code));
  }
  assert.equal(serialized.includes("safe for beginners"), false);
  assert.equal(serialized.includes("suitable for children"), false);
});

test("mapped hiking relations remain mapped coordinate-free guidance", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent(),
    highlights: [{ category: "viewpoint" }],
    routeCandidates: 2
  }));
  const mapped = plan.proposals[0].mappedNetworkCandidates;

  assert.equal(mapped.length, 2);
  assert.ok(mapped.every((candidate) => candidate.sourceBasis === "mapped"));
  assert.ok(
    mapped.every((candidate) =>
      candidate.requiredVerification.includes("official_status_required")
    )
  );
  assert.ok(mapped.every((candidate) => !Object.hasOwn(candidate, "coordinate")));
  assert.equal(
    serializeResearchGuidedRouteCandidatePlanV1(plan).includes(
      '"sourceBasis":"official"'
    ),
    false
  );
});

test("mapped networks apply the same conditional and prohibited access policy", () => {
  const conditionalDossier = makeDossier({
    intent: plainIntent({ distanceRangeKm: null }),
    highlights: [{
      category: "viewpoint",
      claims: [
        { predicate: "public_access", type: "boolean", value: true, official: true },
        { predicate: "closure_status", type: "text", value: "open", official: true }
      ]
    }],
    routeCandidates: 1
  });
  addOfficialRouteClaims(conditionalDossier, 1, [
    { predicate: "public_access", type: "boolean", value: true },
    { predicate: "access_restriction", type: "text", value: "permit_required" },
    { predicate: "closure_status", type: "text", value: "open" }
  ]);
  const conditional = buildResearchGuidedRouteCandidatePlanV1(
    conditionalDossier
  );
  const mapped = conditional.proposals[0].mappedNetworkCandidates[0];
  assert.ok(
    mapped.requiredVerification.includes("access_restriction_required")
  );
  assert.ok(
    mapped.knownLimitations.includes("access_restriction_unverified")
  );
  assert.ok(conditional.evidenceGaps.some(
    (item) =>
      item.code === "access_restriction_unverified" &&
      item.entityId === routeUuid(1)
  ));

  const prohibitedDossier = makeDossier({
    intent: plainIntent({ distanceRangeKm: null }),
    highlights: [{
      category: "viewpoint",
      claims: [
        { predicate: "public_access", type: "boolean", value: true, official: true },
        { predicate: "closure_status", type: "text", value: "open", official: true }
      ]
    }],
    routeCandidates: 1
  });
  addOfficialRouteClaims(prohibitedDossier, 1, [{
    predicate: "access_restriction",
    type: "text",
    value: "prohibited"
  }]);
  const prohibited = buildResearchGuidedRouteCandidatePlanV1(
    prohibitedDossier
  );
  assert.deepEqual(
    prohibited.proposals[0].mappedNetworkCandidates,
    []
  );
  assert.ok(prohibited.evidenceGaps.some(
    (item) =>
      item.code === "candidate_access_denied" &&
      item.entityId === routeUuid(1) &&
      item.predicate === "access_restriction"
  ));
});

test("mapped hut stays a candidate without opening, booking, or legal overnight claims", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({
      mustHaveExperiences: [{ experience: "alpine_hut", minimumCount: 1 }],
      requiredFacilities: ["lunch_hut"],
      overnightRequirements: {
        required: true,
        nights: 1,
        allowedAccommodationTypes: ["alpine_hut"]
      }
    }),
    highlights: [{ category: "alpine_hut" }],
    overnightHighlightIndexes: [0]
  }));
  const candidate = plan.proposals[0].viaCandidates[0];
  const serialized = serializeResearchGuidedRouteCandidatePlanV1(plan);

  assert.equal(plan.state, "partial");
  for (const code of [
    "opening_status_required",
    "overnight_permission_required",
    "booking_required",
    "legal_sleep_required"
  ]) {
    assert.ok(candidate.requiredVerification.includes(code));
  }
  for (const forbidden of ["open hut", "available bed", "legal campsite"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false);
  }
});

test("executor-shaped hut limitations are accepted and booking stays explicit", () => {
  const executorOvernightLimitations = [
    "access_unverified",
    "bookability_unverified",
    "current_conditions_unavailable",
    "mapped_presence_only",
    "opening_unverified",
    "overnight_legality_unverified",
    "seasonal_status_unverified",
    "water_availability_unverified"
  ];
  const executorHighlightLimitations = [
    ...executorOvernightLimitations,
    "route_connection_unverified"
  ];
  const dossier = makeDossier({
    intent: plainIntent({
      overnightRequirements: {
        required: true,
        nights: 1,
        allowedAccommodationTypes: ["alpine_hut"]
      }
    }),
    highlights: [{
      category: "alpine_hut",
      knownLimitations: executorHighlightLimitations
    }],
    overnightHighlightIndexes: [0]
  });
  dossier.overnightCandidates[0].knownLimitations =
    executorOvernightLimitations;

  const plan = buildResearchGuidedRouteCandidatePlanV1(dossier);
  const proposal = plan.proposals[0];
  assert.equal(plan.state, "partial");
  assert.ok(proposal.requiredVerification.includes("booking_required"));
  assert.ok(proposal.knownLimitations.includes("bookability_unverified"));
  assert.ok(proposal.viaCandidates[0].knownLimitations.includes(
    "bookability_unverified"
  ));
});

test("drinking water remains unverified and missing access never becomes permission", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({ requiredFacilities: ["drinking_water"] }),
    highlights: [{ category: "waterfall" }]
  }));
  const serialized = serializeResearchGuidedRouteCandidatePlanV1(plan);

  assert.equal(plan.state, "partial");
  assert.ok(plan.requiredVerification.includes("water_status_required"));
  assert.ok(plan.requiredVerification.includes("public_access_required"));
  assert.equal(serialized.includes("drinkable"), false);
  assert.equal(serialized.includes("public access"), false);
});

test("loop lower bound returns to anchor; point-to-point remains endpoint-incomplete", () => {
  const coordinate = { latitude: 47.02, longitude: 11 };
  const loop = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({ routeType: "loop" }),
    highlights: [{ category: "viewpoint", coordinate }]
  }));
  const pointToPoint = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({ routeType: "point_to_point" }),
    highlights: [{ category: "viewpoint", coordinate }]
  }));
  const direct =
    researchGuidedRouteCandidatePlannerInternalsForTesting.haversineKm(
      plainIntent().geographicAnchor.coordinate,
      coordinate
    );

  assert.equal(
    loop.proposals[0].preliminaryDistanceEnvelope.lowerBoundKm,
    round(direct * 2)
  );
  assert.equal(
    pointToPoint.proposals[0].preliminaryDistanceEnvelope.lowerBoundKm,
    round(direct)
  );
  assert.ok(
    pointToPoint.requiredVerification.includes("endpoint_coordinate_required")
  );
  assert.ok(
    pointToPoint.unmetRequirements.some(
      (item) => item.value === "route_endpoint"
    )
  );
});

test("lower bound exceeding target is explicit and never presented as feasible", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({
      distanceRangeKm: { min: 0.1, max: 0.5 }
    }),
    highlights: [{
      category: "viewpoint",
      coordinate: { latitude: 47.1, longitude: 11 }
    }]
  }));
  const proposal = plan.proposals[0];

  assert.equal(
    proposal.preliminaryDistanceEnvelope.feasibilityState,
    "lower_bound_exceeds_target"
  );
  assert.ok(proposal.knownLimitations.includes("lower_bound_exceeds_target"));
  assert.ok(
    proposal.unsatisfiedRequirements.some(
      (item) => item.value === "distance_target"
    )
  );
});

test("absent target remains target_unspecified without inventing a distance", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({ distanceRangeKm: null }),
    highlights: [{ category: "viewpoint" }]
  }));

  assert.equal(
    plan.proposals[0].preliminaryDistanceEnvelope.feasibilityState,
    "target_unspecified"
  );
  assert.equal(plan.proposals[0].targetDistanceRangeKm, null);
});

test("only selected proposal records contribute proposal-specific gaps", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({
      distanceRangeKm: { min: 0.1, max: 5 },
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }]
    }),
    highlights: [
      {
        category: "viewpoint",
        coordinate: { latitude: 47.2702, longitude: 11.4051 }
      },
      {
        category: "viewpoint",
        coordinate: { latitude: 48.2692, longitude: 12.4041 }
      }
    ]
  }), { maximumProposals: 1 });

  assert.deepEqual(
    plan.proposals[0].viaCandidates.map((candidate) => candidate.entityId),
    [entityUuid(1)]
  );
  assert.equal(
    plan.proposals[0].preliminaryDistanceEnvelope.feasibilityState,
    "not_ruled_out"
  );
  assert.equal(plan.evidenceGaps.some(
    (item) => item.code === "distance_lower_bound_exceeds_target"
  ), false);
  assert.equal(plan.unmetRequirements.some(
    (item) => item.value === "distance_target"
  ), false);
});

test("proposal IDs and serialization ignore semantically unordered input arrays", () => {
  const dossier = makeDossier({
    intent: plainIntent({
      mustHaveExperiences: [
        { experience: "viewpoint", minimumCount: 1 },
        { experience: "waterfall", minimumCount: 1 }
      ],
      preferredExperiences: ["lake", "peak"]
    }),
    highlights: [
      { category: "viewpoint" },
      { category: "waterfall" },
      { category: "lake" },
      { category: "peak" }
    ],
    routeCandidates: 2
  });
  const shuffled = shuffleDossier(dossier);
  const first = buildResearchGuidedRouteCandidatePlanV1(dossier);
  const second = buildResearchGuidedRouteCandidatePlanV1(shuffled);

  assert.deepEqual(
    first.proposals.map((proposal) => proposal.proposalId),
    second.proposals.map((proposal) => proposal.proposalId)
  );
  assert.equal(
    serializeResearchGuidedRouteCandidatePlanV1(first),
    serializeResearchGuidedRouteCandidatePlanV1(second)
  );
});

test("proposal identity ignores mapped candidates omitted by evidence budget", () => {
  const dossier = makeDossier({
    intent: plainIntent({ distanceRangeKm: null }),
    highlights: [{
      category: "viewpoint",
      claims: [
        { predicate: "public_access", type: "boolean", value: true, official: true },
        { predicate: "closure_status", type: "text", value: "open", official: true }
      ]
    }],
    routeCandidates: 2
  });
  addMappedEvidenceReferences(dossier, 1, 31);
  addMappedEvidenceReferences(dossier, 2, 31);
  const withoutOmitted = structuredClone(dossier);
  withoutOmitted.mappedOrOfficialRouteCandidates =
    withoutOmitted.mappedOrOfficialRouteCandidates.filter(
      (candidate) => candidate.entityId !== routeUuid(2)
    );
  withoutOmitted.evidenceClaims = withoutOmitted.evidenceClaims.filter(
    (claim) => claim.entityId !== routeUuid(2)
  );

  const withOmittedPlan = buildResearchGuidedRouteCandidatePlanV1(dossier);
  const withoutOmittedPlan = buildResearchGuidedRouteCandidatePlanV1(
    withoutOmitted
  );
  assert.deepEqual(
    withOmittedPlan.proposals[0].mappedNetworkCandidates.map(
      (candidate) => candidate.entityId
    ),
    [routeUuid(1)]
  );
  assert.equal(
    withOmittedPlan.proposals[0].proposalId,
    withoutOmittedPlan.proposals[0].proposalId
  );
});

test("property-style rotations retain byte-for-byte determinism", () => {
  const dossier = makeDossier({
    intent: plainIntent({
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 2 }]
    }),
    highlights: Array.from({ length: 6 }, () => ({ category: "viewpoint" })),
    routeCandidates: 4
  });
  const expected = serializeResearchGuidedRouteCandidatePlanV1(
    buildResearchGuidedRouteCandidatePlanV1(dossier)
  );

  for (let offset = 0; offset < 16; offset += 1) {
    const permuted = rotateDossierArrays(dossier, offset);
    const actual = serializeResearchGuidedRouteCandidatePlanV1(
      buildResearchGuidedRouteCandidatePlanV1(permuted)
    );
    assert.equal(actual, expected);
  }
});

test("proposal diversity uses different entity sets and fabricates no variants", () => {
  const one = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent(),
    highlights: [{ category: "viewpoint" }]
  }));
  assert.equal(one.proposals.length, 1);

  const diverse = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({
      mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }]
    }),
    highlights: Array.from({ length: 4 }, () => ({ category: "viewpoint" }))
  }));
  const sets = diverse.proposals.map((proposal) =>
    proposal.viaCandidates.map((candidate) => candidate.entityId).sort().join(":")
  );
  assert.equal(new Set(sets).size, sets.length);
  assert.ok(sets.length > 1);
});

test("all search and output limits remain bounded at maximum dossier candidate counts", () => {
  const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent(),
    highlights: Array.from({ length: 32 }, (_, index) => ({
      category: index % 2 === 0 ? "viewpoint" : "peak"
    })),
    routeCandidates: 24
  }));

  assert.ok(
    plan.proposals.length <=
      RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1.limits.maximumProposals
  );
  assert.ok(plan.proposals.every(
    (proposal) =>
      proposal.viaCandidates.length <= 5 &&
      proposal.mappedNetworkCandidates.length <= 8 &&
      proposal.evidenceClaimIds.length <= 64
  ));
  assert.equal(
    researchGuidedRouteCandidatePlannerInternalsForTesting
      .maximumExploredCombinations,
    512
  );
});

test("unsupported, insufficient, and partial states are explicit", () => {
  const biking = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent({ activity: "biking" }),
    highlights: [{ category: "viewpoint" }]
  }));
  assert.equal(biking.state, "unsupported");
  assert.deepEqual(biking.proposals, []);

  const empty = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent(),
    highlights: []
  }));
  assert.equal(empty.state, "insufficient_evidence");
  assert.deepEqual(empty.proposals, []);

  const partial = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
    intent: plainIntent(),
    highlights: [{ category: "viewpoint" }],
    regionState: "partial"
  }));
  assert.equal(partial.state, "partial");
});

test("non-current dossier freshness is an explicit deterministic plan blocker", () => {
  for (const freshnessState of ["stale", "unknown"]) {
    const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        distanceRangeKm: null,
        mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }]
      }),
      highlights: [{
        category: "viewpoint",
        claims: [
          { predicate: "public_access", type: "boolean", value: true, official: true },
          { predicate: "closure_status", type: "text", value: "open", official: true }
        ]
      }],
      freshnessState
    }));

    assert.equal(plan.state, "partial", freshnessState);
    assert.deepEqual(plan.unmetRequirements, [], freshnessState);
    assert.ok(plan.evidenceGaps.some(
      (item) => item.code === "dossier_freshness_not_current"
    ), freshnessState);
    assert.ok(plan.proposals[0].knownLimitations.includes(
      freshnessState === "stale" ? "source_stale" : "insufficient_evidence"
    ), freshnessState);
  }
});

test("stale and unavailable candidate evidence cannot create a proposal", () => {
  for (const state of ["stale", "unavailable"]) {
    const plan = buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent(),
      highlights: [{
        category: "viewpoint",
        categoryEvidenceState: state
      }]
    }));
    assert.equal(plan.state, "insufficient_evidence");
  }
});

test("invalid and excessive dossiers fail with one fixed non-reflective error", () => {
  const marker = "raw-user-prompt-should-never-appear";
  const invalid = adventureResearchDossier({
    normalizedIntent: {
      ...plainIntent(),
      unknown: marker
    }
  });
  assertSafeBuilderError(
    () => buildResearchGuidedRouteCandidatePlanV1(invalid),
    "invalid_dossier",
    marker
  );

  const excessive = makeDossier({
    intent: plainIntent(),
    highlights: Array.from({ length: 32 }, () => ({ category: "viewpoint" }))
  });
  excessive.candidateHighlights.push(excessive.candidateHighlights[0]);
  assertSafeBuilderError(
    () => buildResearchGuidedRouteCandidatePlanV1(excessive),
    "invalid_dossier"
  );
});

test("options are strict, bounded, and cannot broaden policy", () => {
  const dossier = makeDossier({
    intent: plainIntent(),
    highlights: Array.from({ length: 6 }, () => ({ category: "viewpoint" }))
  });
  const limited = buildResearchGuidedRouteCandidatePlanV1(dossier, {
    maximumProposals: 2
  });
  assert.ok(limited.proposals.length <= 2);
  assertSafeBuilderError(
    () => buildResearchGuidedRouteCandidatePlanV1(dossier, {
      maximumProposals: 7
    }),
    "invalid_options"
  );
  assertSafeBuilderError(
    () => buildResearchGuidedRouteCandidatePlanV1(dossier, {
      maximumProposals: 2,
      provider: "graphhopper"
    }),
    "invalid_options"
  );
});

test("selected evidence references are exact dossier-owned entity references", () => {
  const dossier = makeDossier({
    intent: plainIntent(),
    highlights: [{
      category: "viewpoint",
      claims: [
        { predicate: "public_access", type: "boolean", value: true, official: true },
        { predicate: "closure_status", type: "text", value: "open", official: true }
      ]
    }],
    routeCandidates: 1
  });
  const plan = buildResearchGuidedRouteCandidatePlanV1(dossier);
  const claims = new Map(
    dossier.evidenceClaims.map((claim) => [claim.claimId, claim])
  );

  for (const proposal of plan.proposals) {
    for (const candidate of [
      ...proposal.viaCandidates,
      ...proposal.mappedNetworkCandidates
    ]) {
      for (const claimId of candidate.evidenceClaimIds) {
        assert.equal(claims.has(claimId), true);
        assert.equal(claims.get(claimId).entityId, candidate.entityId);
      }
    }
  }
});

test("owned implementation has no time, random, network, database, or provider behavior", async () => {
  const source = await readFile(
    new URL(
      "../src/routeResearch/researchGuidedRouteCandidatePlanner.js",
      import.meta.url
    ),
    "utf8"
  );
  for (const forbidden of [
    "Date.now(",
    "Math.random(",
    "fetch(",
    "XMLHttpRequest",
    "process.env",
    "GraphHopper",
    "PostGIS",
    "postgres",
    "http://",
    "https://"
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("the 74+ case structured fixture corpus is complete and bounded", async () => {
  const fixture = JSON.parse(await readFile(
    new URL(
      "./fixtures/researchGuidedRouteCandidateV1.json",
      import.meta.url
    ),
    "utf8"
  ));
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(
    fixture.policyVersion,
    RESEARCH_GUIDED_ROUTE_CANDIDATE_POLICY_V1.policyVersion
  );
  const fixtureCases = fixture.cases.map((item) => ({
    ...fixture.caseDefaults,
    ...item
  }));
  assert.ok(fixtureCases.length >= 74);
  assert.equal(
    new Set(fixtureCases.map((item) => item.id)).size,
    fixtureCases.length
  );

  for (const fixtureCase of fixtureCases) {
    assertFixtureShape(fixtureCase);
    if (fixtureCase.expectedErrorCode !== null) {
      assertSafeBuilderError(
        () => buildFixturePlan(fixtureCase.template),
        fixtureCase.expectedErrorCode
      );
      continue;
    }
    const plan = buildFixturePlan(fixtureCase.template);
    assert.equal(plan.state, fixtureCase.expectedState, fixtureCase.id);
    if (fixtureCase.expectedProposalCount !== null) {
      assert.equal(
        plan.proposals.length,
        fixtureCase.expectedProposalCount,
        fixtureCase.id
      );
    }
    assert.ok(
      plan.proposals.length <= fixtureCase.maximumProposalCount,
      fixtureCase.id
    );
    const serialized = serializeResearchGuidedRouteCandidatePlanV1(plan)
      .toLowerCase();
    for (const wording of fixtureCase.forbiddenWording) {
      assert.equal(serialized.includes(wording.toLowerCase()), false, fixtureCase.id);
    }
    for (const code of fixtureCase.requiredVerificationCodes) {
      assert.equal(plan.requiredVerification.includes(code), true, fixtureCase.id);
    }
    const limitationCodes = new Set(plan.proposals.flatMap((proposal) => [
      ...proposal.knownLimitations,
      proposal.preliminaryDistanceEnvelope.limitationCode,
      ...proposal.viaCandidates.flatMap(
        (candidate) => candidate.knownLimitations
      ),
      ...proposal.mappedNetworkCandidates.flatMap(
        (candidate) => candidate.knownLimitations
      )
    ]));
    for (const code of fixtureCase.requiredLimitationCodes) {
      assert.equal(limitationCodes.has(code), true, fixtureCase.id);
    }
    for (const expected of fixtureCase.expectedShortfalls) {
      const actual = plan.unmetRequirements.find(
        (item) =>
          item.requirementType === expected.requirementType &&
          item.value === expected.value
      );
      assert.ok(actual, fixtureCase.id);
      assert.equal(actual.shortfallCount, expected.shortfallCount, fixtureCase.id);
    }
    assert.equal(
      plan.unmetRequirements.length,
      fixtureCase.expectedShortfalls.length,
      fixtureCase.id
    );
    for (const expected of fixtureCase.expectedMustHaveSatisfaction) {
      const proposal = plan.proposals[0];
      assert.ok(proposal, fixtureCase.id);
      const actual = [
        ...proposal.satisfiedRequirements,
        ...proposal.unsatisfiedRequirements
      ].find(
        (item) =>
          item.requirementType === "must_have_experience" &&
          item.value === expected.experience
      );
      assert.ok(actual, fixtureCase.id);
      assert.equal(actual.includedCount, expected.includedCount, fixtureCase.id);
    }
    assert.deepEqual(fixtureCase.orderingExpectations, [
      "must_have_count_desc",
      "known_incompatibilities_excluded",
      "unresolved_high_stakes_asc",
      "preferred_count_desc",
      "lower_bound_asc",
      "stable_entity_id"
    ]);
  }
});

function plainIntent(overrides = {}) {
  return completeAdventureResearchIntent({
    routeType: "loop",
    distanceRangeKm: { min: 5, max: 30 },
    durationRangeMinutes: null,
    maximumElevationGainMeters: null,
    maximumTechnicalDifficulty: null,
    mustHaveExperiences: [],
    preferredExperiences: [],
    avoidedExperiences: [],
    requiredFacilities: [],
    groupContext: {
      partySize: 1,
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
  });
}

function makeDossier({
  intent,
  highlights,
  routeCandidates = 0,
  overnightHighlightIndexes = [],
  regionState = "full",
  evidenceGaps = [],
  freshnessState = "current"
}) {
  const evidenceClaims = [];
  const candidateHighlights = [];
  const conflictingEvidence = [];
  let hasOfficialClaims = false;

  for (const [index, specification] of highlights.entries()) {
    const entityId = entityUuid(index + 1);
    const categoryClaim = mappedClaim({
      claimId: claimUuid(index * 20 + 1),
      entityId,
      predicate: "entity_category",
      type: "text",
      value: specification.category,
      state: specification.categoryEvidenceState ?? "known"
    });
    evidenceClaims.push(categoryClaim);
    const referencedClaimIds = [categoryClaim.claimId];
    const extraClaims = [];
    for (const [claimIndex, claimSpec] of (specification.claims ?? []).entries()) {
      const claim = claimSpec.official
        ? officialTestClaim({
          claimId: claimUuid(index * 20 + claimIndex + 2),
          entityId,
          ...claimSpec
        })
        : mappedClaim({
          claimId: claimUuid(index * 20 + claimIndex + 2),
          entityId,
          ...claimSpec
        });
      if (claimSpec.official) hasOfficialClaims = true;
      evidenceClaims.push(claim);
      extraClaims.push(claim);
      referencedClaimIds.push(claim.claimId);
    }
    if (specification.conflictedPredicate) {
      const conflictClaims = extraClaims.filter(
        (claim) => claim.predicate === specification.conflictedPredicate
      );
      conflictingEvidence.push({
        entityId,
        predicate: specification.conflictedPredicate,
        evidenceClaimIds: conflictClaims.map((claim) => claim.claimId)
      });
    }
    candidateHighlights.push(highlightCandidate({
      entityId,
      highlightCategory: specification.category,
      coordinate: specification.coordinate ?? {
        latitude: 47.2692 + (index + 1) * 0.005,
        longitude: 11.4041 + (index + 1) * 0.005
      },
      relevanceReasons: [{
        code: reasonCode(specification.category),
        evidenceClaimIds: [categoryClaim.claimId]
      }],
      evidenceClaimIds: referencedClaimIds,
      knownLimitations: specification.knownLimitations ??
        (specification.categoryEvidenceState === "stale"
          ? ["source_stale"]
          : ["mapped_presence_only"]),
      suitabilityState: specification.suitabilityState ?? "conditional",
      uncertaintyState: specification.categoryEvidenceState === "stale"
        ? "stale"
        : specification.conflictedPredicate
          ? "conflicted"
          : "insufficient_evidence"
    }));
  }

  const mappedOrOfficialRouteCandidates = [];
  for (let index = 0; index < routeCandidates; index += 1) {
    const entityId = routeUuid(index + 1);
    const claim = mappedClaim({
      claimId: claimUuid(1_000 + index),
      entityId,
      predicate: "entity_category",
      type: "text",
      value: "hiking_route"
    });
    evidenceClaims.push(claim);
    mappedOrOfficialRouteCandidates.push({
      entityId,
      entityCategory: "hiking_route",
      sourceBasis: "mapped",
      evidenceClaimIds: [claim.claimId],
      knownLimitations: ["mapped_presence_only", "route_connection_unverified"]
    });
  }

  const overnightCandidates = overnightHighlightIndexes.map((index) => ({
    entityId: candidateHighlights[index].entityId,
    entityCategory: candidateHighlights[index].highlightCategory,
    sourceBasis: "mapped",
    evidenceClaimIds: [candidateHighlights[index].evidenceClaimIds[0]],
    knownLimitations: [
      "mapped_presence_only",
      "opening_unverified",
      "overnight_legality_unverified"
    ]
  }));

  return adventureResearchDossier({
    normalizedIntent: intent,
    regionCoverage: {
      state: regionState,
      regionEntityIds: [OUTDOOR_RESEARCH_TEST_IDS.region],
      limitationCodes:
        regionState === "full" ? [] : ["partial_regional_coverage"]
    },
    evidenceClaims,
    candidateHighlights,
    mappedOrOfficialRouteCandidates,
    overnightCandidates,
    timeSensitiveChecks: [],
    conflictingEvidence,
    evidenceGaps,
    unresolvedQuestions: [],
    sourceProvenanceSummary: [
      MAPPED_SOURCE_SUMMARY,
      ...(hasOfficialClaims ? [OFFICIAL_SOURCE_SUMMARY] : [])
    ],
    freshnessState
  });
}

function addOfficialRouteClaims(dossier, routeIndex, specifications) {
  const entityId = routeUuid(routeIndex);
  for (const [index, specification] of specifications.entries()) {
    dossier.evidenceClaims.push(officialTestClaim({
      claimId: claimUuid(2_000 + routeIndex * 10 + index),
      entityId,
      ...specification
    }));
  }
  if (!dossier.sourceProvenanceSummary.some(
    (summary) => summary.sourceId === OFFICIAL_SOURCE_SUMMARY.sourceId
  )) {
    dossier.sourceProvenanceSummary.push(OFFICIAL_SOURCE_SUMMARY);
  }
}

function addMappedEvidenceReferences(dossier, routeIndex, count) {
  const entityId = routeUuid(routeIndex);
  const candidate = dossier.mappedOrOfficialRouteCandidates.find(
    (item) => item.entityId === entityId
  );
  for (let index = 0; index < count; index += 1) {
    const claim = mappedClaim({
      claimId: claimUuid(3_000 + routeIndex * 100 + index),
      entityId,
      predicate: "name",
      type: "text",
      value: `mapped-route-${routeIndex}`
    });
    dossier.evidenceClaims.push(claim);
    candidate.evidenceClaimIds.push(claim.claimId);
  }
}

function mappedClaim({
  claimId,
  entityId,
  predicate,
  type,
  value,
  state = "known"
}) {
  return evidenceClaim({
    claimId,
    entityId,
    predicate,
    value: type === "unknown" ? { type } : { type, value },
    freshness: state === "stale" ? "stale" : "current",
    resolutionState: state,
    relevantLimitationCodes:
      state === "stale" ? ["source_stale"] : ["mapped_presence_only"]
  });
}

function officialTestClaim({
  claimId,
  entityId,
  predicate,
  type,
  value,
  state = "known"
}) {
  return evidenceClaim({
    claimId,
    entityId,
    predicate,
    value: type === "unknown" ? { type } : { type, value },
    evidenceClass: "official",
    sourceReference: {
      sourceId: OUTDOOR_RESEARCH_TEST_IDS.secondSource,
      sourceKey: "authority.test",
      sourceCategory: "official_authority"
    },
    provenance: {
      identifier: `official/${claimId}`,
      adapterVersion: "test-v1",
      recordVersion: 1
    },
    freshness: state === "stale" ? "stale" : "current",
    resolutionState: state,
    relevantLimitationCodes: state === "stale" ? ["source_stale"] : []
  });
}

function reasonCode(category) {
  if (category === "viewpoint") return "mapped_viewpoint";
  if (category === "waterfall") return "mapped_waterfall";
  if (category === "alpine_hut" || category === "wilderness_hut") {
    return "facility_match";
  }
  return "request_must_have";
}

function entityUuid(value) {
  return `20000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function routeUuid(value) {
  return `30000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function claimUuid(value) {
  return `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function shuffleDossier(dossier) {
  const intent = dossier.normalizedIntent;
  return {
    ...structuredClone(dossier),
    normalizedIntent: {
      ...intent,
      mustHaveExperiences: [...intent.mustHaveExperiences].reverse(),
      preferredExperiences: [...intent.preferredExperiences].reverse(),
      avoidedExperiences: [...intent.avoidedExperiences].reverse(),
      requiredFacilities: [...intent.requiredFacilities].reverse(),
      overnightRequirements: {
        ...intent.overnightRequirements,
        allowedAccommodationTypes: [
          ...intent.overnightRequirements.allowedAccommodationTypes
        ].reverse()
      }
    },
    evidenceClaims: [...dossier.evidenceClaims].reverse(),
    candidateHighlights: [...dossier.candidateHighlights].reverse().map(
      (candidate) => ({
        ...candidate,
        evidenceClaimIds: [...candidate.evidenceClaimIds].reverse(),
        knownLimitations: [...candidate.knownLimitations].reverse()
      })
    ),
    mappedOrOfficialRouteCandidates: [
      ...dossier.mappedOrOfficialRouteCandidates
    ].reverse(),
    overnightCandidates: [...dossier.overnightCandidates].reverse(),
    evidenceGaps: [...dossier.evidenceGaps].reverse(),
    sourceProvenanceSummary: [...dossier.sourceProvenanceSummary].reverse()
  };
}

function rotateDossierArrays(dossier, offset) {
  const rotated = structuredClone(dossier);
  for (const field of [
    "evidenceClaims",
    "candidateHighlights",
    "mappedOrOfficialRouteCandidates",
    "overnightCandidates",
    "evidenceGaps",
    "sourceProvenanceSummary"
  ]) {
    rotated[field] = rotate(rotated[field], offset);
  }
  return rotated;
}

function rotate(values, offset) {
  if (values.length === 0) return [];
  const normalized = offset % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function compareCoordinates(left, right) {
  return left.latitude - right.latitude || left.longitude - right.longitude;
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function assertSafeBuilderError(action, code, forbidden = "") {
  assert.throws(action, (error) => {
    assert.ok(error instanceof ResearchGuidedRouteCandidateError);
    assert.equal(error.code, code);
    assert.ok(error.message.length <= 64);
    if (forbidden) {
      assert.equal(error.message.includes(forbidden), false);
      assert.equal(error.stack.includes(forbidden), false);
    }
    return true;
  });
}

function assertFixtureShape(fixtureCase) {
  for (const field of [
    "id",
    "label",
    "language",
    "template",
    "expectedState",
    "expectedErrorCode",
    "expectedProposalCount",
    "maximumProposalCount",
    "expectedMustHaveSatisfaction",
    "expectedShortfalls",
    "requiredVerificationCodes",
    "requiredLimitationCodes",
    "forbiddenWording",
    "orderingExpectations"
  ]) {
    assert.equal(Object.hasOwn(fixtureCase, field), true, fixtureCase.id);
  }
  assert.ok(["de", "en"].includes(fixtureCase.language), fixtureCase.id);
  assert.ok(fixtureCase.maximumProposalCount <= 6, fixtureCase.id);
  assert.ok(fixtureCase.forbiddenWording.length > 0, fixtureCase.id);
}

function buildFixturePlan(template) {
  const forbiddenOnly = ["best", "safest", "scenic", "perfect"];
  void forbiddenOnly;
  if (template === "ready_viewpoint") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        distanceRangeKm: null,
        mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }]
      }),
      highlights: [{
        category: "viewpoint",
        claims: [
          { predicate: "public_access", type: "boolean", value: true, official: true },
          { predicate: "closure_status", type: "text", value: "open", official: true }
        ]
      }]
    }));
  }
  if (template === "two_viewpoints_waterfall") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [
          { experience: "viewpoint", minimumCount: 2 },
          { experience: "waterfall", minimumCount: 1 }
        ]
      }),
      highlights: [
        { category: "viewpoint" },
        { category: "viewpoint" },
        { category: "waterfall" }
      ]
    }));
  }
  if (template === "viewpoint_shortfall") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 2 }]
      }),
      highlights: [{ category: "viewpoint" }]
    }));
  }
  if (template === "mapped_hut") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [{ experience: "alpine_hut", minimumCount: 1 }],
        requiredFacilities: ["lunch_hut"]
      }),
      highlights: [{ category: "alpine_hut" }]
    }));
  }
  if (template === "overnight_hut") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        overnightRequirements: {
          required: true,
          nights: 1,
          allowedAccommodationTypes: ["alpine_hut"]
        }
      }),
      highlights: [{ category: "alpine_hut" }],
      overnightHighlightIndexes: [0]
    }));
  }
  if (template === "lower_bound_exceeds") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ distanceRangeKm: { min: 0.1, max: 0.5 } }),
      highlights: [{
        category: "peak",
        coordinate: { latitude: 47.1, longitude: 11 }
      }]
    }));
  }
  if (template === "mapped_network") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent(),
      highlights: [{ category: "viewpoint" }],
      routeCandidates: 2
    }));
  }
  if (template === "vulnerable_group") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        groupContext: {
          partySize: 3,
          includesChildren: true,
          youngestAge: 7,
          mobility: "limited",
          experienceLevel: "beginner"
        }
      }),
      highlights: [{ category: "lake" }]
    }));
  }
  if (template === "unsupported_biking") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ activity: "biking" }),
      highlights: [{ category: "viewpoint" }]
    }));
  }
  if (template === "no_highlights") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent(),
      highlights: []
    }));
  }
  if (template === "point_to_point") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ routeType: "point_to_point" }),
      highlights: [{ category: "peak" }, { category: "landmark" }]
    }));
  }
  if (template === "water_unverified") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ requiredFacilities: ["drinking_water"] }),
      highlights: [{ category: "waterfall" }]
    }));
  }
  if (template === "public_transport") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        transportRequirements: {
          arrivalMode: "public_transport",
          returnToStart: true,
          publicTransportRequired: true
        }
      }),
      highlights: [{ category: "viewpoint" }]
    }));
  }
  if (template === "exact_date") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        dateOrSeason: { kind: "date", date: "2026-12-21" }
      }),
      highlights: [{ category: "peak" }]
    }));
  }
  if (template === "unknown_difficulty") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ maximumTechnicalDifficulty: "hiking" }),
      highlights: [{ category: "viewpoint" }]
    }));
  }
  if (template === "viewpoint_hut") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }],
        requiredFacilities: ["lunch_hut"]
      }),
      highlights: [{ category: "viewpoint" }, { category: "alpine_hut" }]
    }));
  }
  if (template === "viewpoint_waterfall_hut") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [
          { experience: "viewpoint", minimumCount: 1 },
          { experience: "waterfall", minimumCount: 1 }
        ],
        requiredFacilities: ["lunch_hut"]
      }),
      highlights: [
        { category: "viewpoint" },
        { category: "waterfall" },
        { category: "alpine_hut" }
      ]
    }));
  }
  if (template === "preferred_peak") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ preferredExperiences: ["peak"] }),
      highlights: [{ category: "peak" }]
    }));
  }
  if (template === "preferred_lake") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ preferredExperiences: ["lake"] }),
      highlights: [{ category: "lake" }]
    }));
  }
  if (template === "unsupported_preferences") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        preferredExperiences: ["forest", "quiet_trails"],
        avoidedExperiences: ["major_roads"]
      }),
      highlights: [{ category: "viewpoint" }]
    }));
  }
  if (template === "winter") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        dateOrSeason: { kind: "season", season: "winter", year: 2026 }
      }),
      highlights: [{ category: "peak" }]
    }));
  }
  if (template === "technical_runner") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        activity: "trail_running",
        avoidedExperiences: ["technical_terrain"]
      }),
      highlights: [{ category: "viewpoint" }]
    }));
  }
  if (template === "two_night_huts") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        overnightRequirements: {
          required: true,
          nights: 2,
          allowedAccommodationTypes: ["alpine_hut"]
        }
      }),
      highlights: [{ category: "alpine_hut" }, { category: "alpine_hut" }],
      overnightHighlightIndexes: [0, 1]
    }));
  }
  if (template === "official_route_unverified") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [
          { experience: "official_hiking_route", minimumCount: 1 }
        ]
      }),
      highlights: [{ category: "viewpoint" }],
      routeCandidates: 1
    }));
  }
  if (template === "waypoint_budget") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 8 }]
      }),
      highlights: Array.from({ length: 8 }, () => ({ category: "viewpoint" }))
    }));
  }
  if (template === "stale_candidate") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent(),
      highlights: [{
        category: "viewpoint",
        categoryEvidenceState: "stale"
      }]
    }));
  }
  if (template === "excessive_difficulty") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ maximumTechnicalDifficulty: "hiking" }),
      highlights: [{
        category: "viewpoint",
        claims: [{
          predicate: "trail_difficulty",
          type: "text",
          value: "alpine_hiking"
        }]
      }]
    }));
  }
  if (template === "target_unspecified") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ distanceRangeKm: null }),
      highlights: [{ category: "viewpoint" }]
    }));
  }
  if (template === "partial_region") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent(),
      highlights: [{ category: "viewpoint" }],
      regionState: "partial"
    }));
  }
  if (template === "unresolved_geography") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        geographicAnchor: {
          state: "unresolved",
          requirementCode: "location_required"
        },
        unresolvedClarificationQuestions: [{
          code: "location_required",
          field: "geographicAnchor"
        }]
      }),
      highlights: [{ category: "viewpoint" }]
    }));
  }
  if (template === "out_and_back") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ routeType: "out_and_back" }),
      highlights: [{ category: "lake" }]
    }));
  }
  if (template === "diverse_viewpoints") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [{ experience: "viewpoint", minimumCount: 1 }]
      }),
      highlights: Array.from({ length: 4 }, () => ({ category: "viewpoint" }))
    }));
  }
  if (template === "maximum_candidates") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent(),
      highlights: Array.from({ length: 32 }, (_, index) => ({
        category: index % 2 === 0 ? "viewpoint" : "peak"
      })),
      routeCandidates: 24
    }));
  }
  if (template === "invalid_duplicate") {
    const dossier = makeDossier({
      intent: plainIntent(),
      highlights: [{ category: "viewpoint" }]
    });
    dossier.candidateHighlights.push(dossier.candidateHighlights[0]);
    return buildResearchGuidedRouteCandidatePlanV1(dossier);
  }
  if (template === "invalid_excessive") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent(),
      highlights: Array.from({ length: 33 }, () => ({ category: "viewpoint" }))
    }));
  }
  if (template === "conflicting_access") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent(),
      highlights: [{
        category: "viewpoint",
        conflictedPredicate: "public_access",
        claims: [
          { predicate: "public_access", type: "boolean", value: true, official: true },
          { predicate: "public_access", type: "boolean", value: false, official: true }
        ]
      }]
    }));
  }
  if (template === "unavailable_candidate") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent(),
      highlights: [{
        category: "viewpoint",
        categoryEvidenceState: "unavailable"
      }]
    }));
  }
  if (template === "waterfall_focus") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [{ experience: "waterfall", minimumCount: 1 }]
      }),
      highlights: [{ category: "waterfall" }]
    }));
  }
  if (template === "peak_focus") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [{ experience: "peak", minimumCount: 1 }]
      }),
      highlights: [{ category: "peak" }]
    }));
  }
  if (template === "lake_focus") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        mustHaveExperiences: [{ experience: "lake", minimumCount: 1 }]
      }),
      highlights: [{ category: "lake" }]
    }));
  }
  if (template === "emergency_shelter") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({ requiredFacilities: ["emergency_shelter"] }),
      highlights: [{ category: "viewpoint" }]
    }));
  }
  if (template === "legal_sleep_bivouac") {
    return buildResearchGuidedRouteCandidatePlanV1(makeDossier({
      intent: plainIntent({
        overnightRequirements: {
          required: true,
          nights: 1,
          allowedAccommodationTypes: ["designated_bivouac"]
        }
      }),
      highlights: [{ category: "viewpoint" }]
    }));
  }
  throw new Error(`Unknown fixture template: ${template}`);
}
