import Foundation
import XCTest

@testable import TrailMind

@MainActor
final class ResearchRoutePresentationTests: XCTestCase {
  func testResearchAccessibilityIdentifiersAreExactAndUnique() {
    let identifiers = [
      ResearchPresentationAccessibilityID.cardSummary,
      ResearchPresentationAccessibilityID.fitReasons,
      ResearchPresentationAccessibilityID.highlights,
      ResearchPresentationAccessibilityID.limitations,
      ResearchPresentationAccessibilityID.showAllLimitations,
      ResearchPresentationAccessibilityID.evidenceSummary,
      ResearchPresentationAccessibilityID.clarification,
    ]

    XCTAssertEqual(
      identifiers,
      [
        "research.card.summary",
        "research.detail.fitReasons",
        "research.detail.highlights",
        "research.detail.limitations",
        "research.detail.limitations.showAll",
        "research.detail.evidenceSummary",
        "research.clarification",
      ])
    XCTAssertEqual(Set(identifiers).count, identifiers.count)
  }

  func testCompleteResearchGuidedLoopPrioritizesMustHaveAndVerifiedFacts() throws {
    let suggestion = makeSuggestion(
      index: 0,
      distance: 14.8,
      elevation: 320,
      durationHours: 4.0
    )
    let viewpoint = makeWaypoint(
      id: "11111111-1111-4111-8111-111111111111",
      category: .viewpoint,
      role: .mustHave
    )
    let waterfall = makeWaypoint(
      id: "22222222-2222-4222-8222-222222222222",
      category: .waterfall,
      role: .preferred
    )
    let context = makeContext(
      outcome: .routed,
      suggestion: suggestion,
      waypoints: [viewpoint, waterfall],
      reachedEntityIDs: [viewpoint.entityID, waterfall.entityID]
    )

    let presentation = try XCTUnwrap(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )

    XCTAssertEqual(presentation.kind, .researchGuided)
    XCTAssertEqual(presentation.badge?.title, "Researched route")
    XCTAssertEqual(
      presentation.fitReasons.map(\.code),
      [.mustHaveHighlights, .verifiedHighlights, .routeShape, .distanceMatch]
    )
    XCTAssertEqual(
      presentation.highlights.map(\.categoryLabel),
      ["viewpoint", "waterfall"]
    )
    XCTAssertTrue(presentation.highlights[0].isMustHave)
    XCTAssertTrue(presentation.limitations.isEmpty)
    XCTAssertEqual(
      presentation.evidenceSummary.coverageLabel,
      "Mapped research: available"
    )
  }

  func testPartialHarzLoopShowsVisitedHighlightAndUnconnectedLimitation() throws {
    let suggestion = makeSuggestion(index: 0)
    let reached = makeWaypoint(
      id: "11111111-1111-4111-8111-111111111111",
      category: .viewpoint,
      role: .preferred
    )
    let missed = makeWaypoint(
      id: "22222222-2222-4222-8222-222222222222",
      category: .waterfall,
      role: .preferred
    )
    let context = makeContext(
      outcome: .partial,
      suggestion: suggestion,
      waypoints: [reached, missed],
      reachedEntityIDs: [reached.entityID],
      limitations: [.accessUnverified, .currentConditionsUnavailable]
    )

    let presentation = try XCTUnwrap(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )

    XCTAssertEqual(presentation.kind, .researchGuidedPartial)
    XCTAssertEqual(presentation.highlights.map(\.title), ["Viewpoint"])
    XCTAssertTrue(
      presentation.cardFacts.contains {
        $0.code == .partialCoverage && $0.title == "Some preferences unverified"
      }
    )
    XCTAssertTrue(
      presentation.limitations.contains {
        $0.code == .unconnectedHighlight
      }
    )
    XCTAssertTrue(
      presentation.limitations.contains { $0.code == .access }
    )
    XCTAssertTrue(
      presentation.limitations.contains {
        $0.code == .currentConditions
      }
    )
  }

  func testInnsbruckViewpointKeepsAlpineLimitationsConservative() throws {
    let suggestion = makeSuggestion(index: 0, location: "Innsbruck")
    let viewpoint = makeWaypoint(
      id: "33333333-3333-4333-8333-333333333333",
      category: .viewpoint,
      role: .mustHave,
      limitations: [
        .mappedPresenceOnly,
        .trailDifficultyUnverified,
        .exposureUnverified,
      ]
    )
    let context = makeContext(
      outcome: .partial,
      suggestion: suggestion,
      waypoints: [viewpoint],
      reachedEntityIDs: [viewpoint.entityID],
      limitations: [
        .mappedPresenceOnly,
        .trailDifficultyUnverified,
        .exposureUnverified,
      ]
    )

    let presentation = try XCTUnwrap(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )
    let allCopy = presentationCopy(presentation)

    XCTAssertEqual(
      presentation.highlights.first?.evidenceLabel,
      "Mapped place on this routed path"
    )
    XCTAssertTrue(
      presentation.limitations.contains {
        $0.code == .trailDifficulty
      }
    )
    XCTAssertTrue(
      presentation.limitations.contains { $0.code == .exposure }
    )
    assertDoesNotContainForbiddenClaims(allCopy)
  }

  func testRequestedPreferenceNeverBecomesVerifiedHighlight() throws {
    let suggestion = makeSuggestion(
      index: 0,
      desiredFeatures: [.viewpoint, .water, .quiet]
    )
    let context = makeContext(
      outcome: .routed,
      suggestion: suggestion,
      waypoints: [],
      reachedEntityIDs: []
    )

    let presentation = try XCTUnwrap(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )
    let copy = presentationCopy(presentation)

    XCTAssertTrue(presentation.highlights.isEmpty)
    XCTAssertFalse(
      presentation.fitReasons.contains {
        $0.code == .verifiedHighlights || $0.code == .mustHaveHighlights
      }
    )
    XCTAssertFalse(copy.localizedCaseInsensitiveContains("quiet"))
    XCTAssertFalse(copy.localizedCaseInsensitiveContains("has water"))
    XCTAssertFalse(copy.localizedCaseInsensitiveContains("scenic"))
  }

  func testVisitMustMatchSelectedEntityAndTolerance() throws {
    let suggestion = makeSuggestion(index: 0)
    let selected = makeWaypoint(
      id: "11111111-1111-4111-8111-111111111111",
      category: .viewpoint,
      role: .preferred
    )
    let unrelatedID = UUID(
      uuidString: "99999999-9999-4999-8999-999999999999"
    )!
    let context = makeContext(
      outcome: .partial,
      suggestion: suggestion,
      waypoints: [selected],
      visits: [
        makeVisit(entityID: selected.entityID, reached: false),
        makeVisit(entityID: unrelatedID, reached: true),
      ]
    )

    let presentation = try XCTUnwrap(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )

    XCTAssertTrue(presentation.highlights.isEmpty)
    XCTAssertTrue(
      presentation.limitations.contains {
        $0.code == .unconnectedHighlight
      }
    )
  }

  func testFallbackHasNoResearchBadgeFactsOrClaims() throws {
    let suggestion = makeSuggestion(index: 0)
    let context = makeFallbackContext()

    let presentation = try XCTUnwrap(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )

    XCTAssertEqual(presentation.kind, .standardRouteFallback)
    XCTAssertNil(presentation.badge)
    XCTAssertTrue(presentation.cardFacts.isEmpty)
    XCTAssertTrue(presentation.fitReasons.isEmpty)
    XCTAssertTrue(presentation.highlights.isEmpty)
    XCTAssertTrue(presentation.limitations.isEmpty)
    XCTAssertEqual(
      presentation.evidenceSummary.title,
      "Standard routed option"
    )
  }

  func testMissingContextAndMissingSidecarProduceNoResearchPresentation() {
    let suggestion = makeSuggestion(index: 0)
    XCTAssertTrue(
      ResearchPresentationProjector.routePresentations(
        suggestions: [suggestion],
        context: nil
      ).isEmpty
    )

    let context = PlannerViewModel.ResearchPlanningContext(
      outcome: .routed,
      adapterGaps: [],
      backendPlanningGaps: [],
      selectionState: .routed,
      sourceEnvelopeState: .routed,
      rejectionCounts: [:],
      remainingLimitations: [],
      alternativesBySuggestionID: [:]
    )
    XCTAssertNil(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )
  }

  func testUnsupportedBikingResearchShapeKeepsStandardPresentation() {
    let suggestion = makeSuggestion(
      index: 0,
      activity: .biking
    )

    XCTAssertTrue(
      ResearchPresentationProjector.routePresentations(
        suggestions: [suggestion],
        context: nil
      ).isEmpty
    )
    XCTAssertTrue(suggestion.route.isVerifiedRoutedResult)
    XCTAssertEqual(suggestion.route.activity, .biking)
  }

  func testInvalidRouteCannotBecomeSuccessfulResearchPresentation() {
    let verified = makeSuggestion(index: 0)
    let invalidRoute = replacingProvenance(
      of: verified.route,
      with: .demo(.testFixture)
    )
    let invalidSuggestion = RouteSuggestion(
      id: verified.id,
      route: invalidRoute,
      explanation: verified.explanation
    )
    let context = makeContext(
      outcome: .routed,
      suggestion: invalidSuggestion,
      waypoints: [],
      reachedEntityIDs: []
    )

    XCTAssertNil(
      ResearchPresentationProjector.routePresentation(
        suggestion: invalidSuggestion,
        allSuggestions: [invalidSuggestion],
        context: context
      )
    )
  }

  func testHighStakesLimitationsArePrioritizedAndExactlyDeduplicated() throws {
    let suggestion = makeSuggestion(index: 0)
    let context = makeContext(
      outcome: .partial,
      suggestion: suggestion,
      waypoints: [],
      reachedEntityIDs: [],
      limitations: [
        .mappedPresenceOnly,
        .waterAvailabilityUnverified,
        .accessUnverified,
        .waterAvailabilityUnverified,
        .currentConditionsUnavailable,
      ],
      backendGaps: [
        planningGap(
          code: .waterAvailabilitySourceMissing,
          field: .preferredExperiences
        ),
        planningGap(
          code: .officialSourceUnavailable,
          field: .geographicAnchor
        ),
      ],
      requiredVerification: [
        .publicAccessRequired,
        .waterStatusRequired,
        .closureStatusRequired,
        .currentConditionsRequired,
        .trailVisibilityRequired,
        .trailDifficultyRequired,
        .steepClimbRequired,
      ]
    )

    let presentation = try XCTUnwrap(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )

    XCTAssertEqual(
      presentation.limitations.prefix(3).map(\.priority),
      [.high, .high, .high]
    )
    XCTAssertEqual(
      presentation.limitations.filter { $0.code == .water }.count,
      1
    )
    XCTAssertEqual(
      presentation.limitations.filter { $0.code == .access }.count,
      1
    )
    XCTAssertEqual(
      presentation.limitations.filter { $0.code == .closure }.count,
      1
    )
    XCTAssertTrue(
      presentation.limitations.contains { $0.code == .trailVisibility }
    )
    XCTAssertTrue(
      presentation.limitations.contains { $0.code == .trailDifficulty }
    )
    XCTAssertTrue(
      presentation.limitations.contains { $0.code == .steepSections }
    )
  }

  func testCollectionsAreBoundedAndOrderingIsDeterministic() throws {
    let suggestion = makeSuggestion(index: 0)
    let waypointCategories: [ResearchHighlightCategoryV1] = [
      .viewpoint, .waterfall, .peak, .lake, .alpineHut,
      .wildernessHut, .landmark,
    ]
    let waypoints = waypointCategories.enumerated().map {
      makeWaypoint(
        id: String(
          format: "00000000-0000-4000-8000-%012d",
          $0.offset + 1
        ),
        category: $0.element,
        role: .preferred
      )
    }
    let limitations = ResearchKnownLimitationV1.allCases
    let context = makeContext(
      outcome: .partial,
      suggestion: suggestion,
      waypoints: waypoints,
      reachedEntityIDs: waypoints.map(\.entityID),
      limitations: limitations
    )

    let first = try XCTUnwrap(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )
    let second = try XCTUnwrap(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )

    XCTAssertEqual(first, second)
    XCTAssertLessThanOrEqual(
      first.cardFacts.count,
      ResearchRoutePresentation.maximumCardFactCount
    )
    XCTAssertLessThanOrEqual(
      first.fitReasons.count,
      ResearchRoutePresentation.maximumFitReasonCount
    )
    XCTAssertEqual(
      first.highlights.count,
      ResearchRoutePresentation.maximumHighlightCount
    )
    XCTAssertLessThanOrEqual(
      first.limitations.count,
      ResearchRoutePresentation.maximumLimitationCount
    )
    XCTAssertEqual(
      first.initiallyVisibleLimitations.count,
      ResearchRoutePresentation.initialLimitationCount
    )
    XCTAssertTrue(first.hasAdditionalLimitations)
  }

  func testProjectionNeverLeaksInternalIdentifiersProvidersOrUnsafeClaims() throws {
    let suggestion = makeSuggestion(index: 0)
    let waypoint = makeWaypoint(
      id: "11111111-1111-4111-8111-111111111111",
      category: .viewpoint,
      role: .mustHave
    )
    let context = makeContext(
      outcome: .partial,
      suggestion: suggestion,
      waypoints: [waypoint],
      reachedEntityIDs: [waypoint.entityID],
      limitations: [.accessUnverified],
      remainingLimitations: [
        "provider_failure",
        "private_provider_error_with_url_https://example.com",
      ],
      rejectionCounts: [
        "contract_route_conversion_rejected": 42
      ],
      strategy: "internal-provider-strategy"
    )

    let presentation = try XCTUnwrap(
      ResearchPresentationProjector.routePresentation(
        suggestion: suggestion,
        allSuggestions: [suggestion],
        context: context
      )
    )
    let copy = presentationCopy(presentation).lowercased()

    for forbidden in [
      "11111111-1111-4111-8111-111111111111",
      "graphhopper",
      "postgis",
      "provider",
      "https://",
      "contract_route_conversion_rejected",
      "internal-provider-strategy",
      "confidence",
      "%",
      "safe",
      "legal to camp",
      "official route",
      "guaranteed scenic",
      "open now",
    ] {
      XCTAssertFalse(copy.contains(forbidden), "Leaked: \(forbidden)")
    }
  }

  func testBroadRegionClarificationIsBoundedAndHumanReadable() throws {
    let questions = [
      AdventureResearchClarificationQuestionV1(
        code: .locationRequired,
        field: .geographicAnchor
      ),
      AdventureResearchClarificationQuestionV1(
        code: .distanceRequired,
        field: .distanceRangeKm
      ),
      AdventureResearchClarificationQuestionV1(
        code: .durationRequired,
        field: .durationRangeMinutes
      ),
      AdventureResearchClarificationQuestionV1(
        code: .difficultyClarificationRequired,
        field: .maximumTechnicalDifficulty
      ),
      AdventureResearchClarificationQuestionV1(
        code: .dateOrSeasonRequired,
        field: .dateOrSeason
      ),
    ]
    let context = try XCTUnwrap(
      PlannerViewModel.ResearchClarificationContext(
        origin: .coordinator,
        adapterGaps: [.broadRegionRequiresClarification],
        backendPlanningGaps: [],
        questions: questions
      )
    )

    let presentation = try XCTUnwrap(
      ResearchPresentationProjector.clarificationPresentation(
        context: context
      )
    )

    XCTAssertEqual(
      presentation.questions.count,
      ResearchClarificationPresentation.maximumQuestionCount
    )
    XCTAssertEqual(
      presentation.questions.first,
      "Which specific town, valley, landmark or trailhead should Wanderful use?"
    )
    XCTAssertFalse(
      presentation.questions.joined().contains("location_required")
    )
    XCTAssertFalse(
      presentation.questions.joined().contains("geographicAnchor")
    )
  }
}

extension ResearchRoutePresentationTests {
  fileprivate func makeSuggestion(
    index: Int,
    location: String = "Ilsenburg, Germany",
    distance: Double = 14.8,
    elevation: Int = 320,
    durationHours: Double = 4,
    activity: ActivityType = .hiking,
    desiredFeatures: [DesiredFeature] = [.viewpoint]
  ) -> RouteSuggestion {
    let id = UUID(
      uuidString: String(
        format: "aaaaaaaa-aaaa-4aaa-8aaa-%012d",
        index + 1
      )
    )!
    let routeID = UUID(
      uuidString: String(
        format: "bbbbbbbb-bbbb-4bbb-8bbb-%012d",
        index + 1
      )
    )!
    let path = [
      Coordinate(
        latitude: 51.864,
        longitude: 10.678,
        elevationMeters: 250
      ),
      Coordinate(
        latitude: 51.84,
        longitude: 10.70,
        elevationMeters: 410
      ),
      Coordinate(
        latitude: 51.82,
        longitude: 10.66,
        elevationMeters: 470
      ),
      Coordinate(
        latitude: 51.864,
        longitude: 10.678,
        elevationMeters: 250
      ),
    ]
    let difficulty = RouteDifficulty.estimated(
      distanceKilometers: distance,
      elevationGainMeters: elevation
    )
    let provenance = RouteProvenance.routingEngineOutput(
      provider: .graphHopper,
      strategy: .backend,
      activity: activity,
      routeType: .loop,
      distanceKilometers: distance,
      elevationGainMeters: elevation,
      elevationLossMeters: elevation,
      durationHours: durationHours,
      difficulty: difficulty,
      path: path,
      verifiedCharacteristics: nil
    )
    let route = TrailRoute(
      id: routeID,
      provenance: provenance,
      title: location == "Innsbruck"
        ? "Innsbruck Research Loop"
        : "Harz Research Loop",
      location: location,
      activity: activity,
      distanceKilometers: distance,
      elevationGainMeters: elevation,
      elevationLossMeters: elevation,
      durationHours: durationHours,
      difficulty: difficulty,
      routeType: .loop,
      summary: "A verified routed fixture.",
      whyItMatches: "Verified route facts.",
      highlights: [],
      waypoints: [],
      days: [],
      safetyNotes: [],
      elevationProfile: path.compactMap(\.elevationMeters),
      path: path,
      planningMetadata: RoutePlanningMetadata(
        routeType: .loop,
        activityType: activity,
        targetDistanceKm: 15,
        targetDurationMinutes: nil,
        difficulty: nil,
        desiredFeatures: desiredFeatures,
        avoidFeatures: []
      )
    )
    return RouteSuggestion(
      id: id,
      route: route,
      explanation: "Closest Match"
    )
  }

  fileprivate func makeWaypoint(
    id: String,
    category: ResearchHighlightCategoryV1,
    role: ResearchCandidateRoleV1,
    limitations: [ResearchKnownLimitationV1] = []
  ) -> ResearchSelectedWaypointV1 {
    ResearchSelectedWaypointV1(
      entityID: UUID(uuidString: id)!,
      coordinate: Coordinate(latitude: 51.84, longitude: 10.68),
      highlightCategory: category,
      role: role,
      evidenceClaimIDs: [
        UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-000000000001")!
      ],
      selectionReasons: role == .mustHave
        ? [.requiredExperience]
        : [.preferredExperience],
      requiredVerification: [],
      knownLimitations: limitations
    )
  }

  fileprivate func makeVisit(
    entityID: UUID,
    reached: Bool
  ) -> ResearchWaypointVisitV1 {
    ResearchWaypointVisitV1(
      waypointIndex: 1,
      role: .via,
      entityID: entityID,
      requestedCoordinate: Coordinate(
        latitude: 51.84,
        longitude: 10.68
      ),
      snappedCoordinate: reached
        ? Coordinate(latitude: 51.84, longitude: 10.68)
        : nil,
      snapDistanceMeters: reached ? 0 : nil,
      withinVisitTolerance: reached
    )
  }

  fileprivate func makeContext(
    outcome: PlannerViewModel.ResearchPlanningContext.Outcome,
    suggestion: RouteSuggestion,
    waypoints: [ResearchSelectedWaypointV1],
    reachedEntityIDs: [UUID],
    limitations: [ResearchKnownLimitationV1] = [],
    backendGaps: [OutdoorAdventurePlanningGapV1] = [],
    remainingLimitations: [String]? = nil,
    rejectionCounts: [String: Int] = [:],
    strategy: String = "must_have_first",
    requiredVerification: [ResearchVerificationCodeV1] = []
  ) -> PlannerViewModel.ResearchPlanningContext {
    makeContext(
      outcome: outcome,
      suggestion: suggestion,
      waypoints: waypoints,
      visits: reachedEntityIDs.map {
        makeVisit(entityID: $0, reached: true)
      },
      limitations: limitations,
      backendGaps: backendGaps,
      remainingLimitations: remainingLimitations,
      rejectionCounts: rejectionCounts,
      strategy: strategy,
      requiredVerification: requiredVerification
    )
  }

  fileprivate func makeContext(
    outcome: PlannerViewModel.ResearchPlanningContext.Outcome,
    suggestion: RouteSuggestion,
    waypoints: [ResearchSelectedWaypointV1],
    visits: [ResearchWaypointVisitV1],
    limitations: [ResearchKnownLimitationV1] = [],
    backendGaps: [OutdoorAdventurePlanningGapV1] = [],
    remainingLimitations: [String]? = nil,
    rejectionCounts: [String: Int] = [:],
    strategy: String = "must_have_first",
    requiredVerification: [ResearchVerificationCodeV1] = []
  ) -> PlannerViewModel.ResearchPlanningContext {
    let provenance = ResearchRouteProvenanceV1(
      proposalID: "rrcpv1_internal",
      lineageID: "rrlpv1_internal",
      strategy: strategy,
      activity: suggestion.route.activity,
      routeType: suggestion.route.routeType,
      selectedWaypoints: waypoints,
      mappedNetworkCandidates: [],
      evidenceClaimIDs: waypoints.flatMap(\.evidenceClaimIDs),
      requiredVerification: requiredVerification,
      knownLimitations: limitations,
      sourceCandidatePlanPolicyVersion:
        "research-guided-route-candidates-v1"
    )
    let sidecar =
      PlannerViewModel.ResearchPlanningContext.AlternativeSidecar(
        attemptID: "internal_attempt_id",
        routeResultID: "internal_route_result_id",
        researchProvenance: provenance,
        waypointVisits: visits
      )
    let isPartial: Bool
    switch outcome {
    case .partial:
      isPartial = true
    case .routed, .legacyFallback:
      isPartial = false
    }
    return PlannerViewModel.ResearchPlanningContext(
      outcome: outcome,
      adapterGaps: [],
      backendPlanningGaps: backendGaps,
      selectionState: isPartial ? .partial : .routed,
      sourceEnvelopeState: isPartial ? .partial : .routed,
      rejectionCounts: rejectionCounts,
      remainingLimitations:
        remainingLimitations ?? limitations.map(\.rawValue),
      alternativesBySuggestionID: [suggestion.id: sidecar]
    )
  }

  fileprivate func makeFallbackContext() -> PlannerViewModel.ResearchPlanningContext {
    PlannerViewModel.ResearchPlanningContext(
      outcome: .legacyFallback(
        .coordinatorFailure(.unavailable)
      ),
      adapterGaps: [],
      backendPlanningGaps: [],
      selectionState: nil,
      sourceEnvelopeState: nil,
      rejectionCounts: [:],
      remainingLimitations: [],
      alternativesBySuggestionID: [:]
    )
  }

  fileprivate func planningGap(
    code: OutdoorAdventurePlanningGapCodeV1,
    field: OutdoorAdventurePlanningGapAffectedFieldV1
  ) -> OutdoorAdventurePlanningGapV1 {
    OutdoorAdventurePlanningGapV1(
      code: code,
      affectedField: field,
      affectedValue: nil,
      reason: .acceptedSourceNotAvailable,
      requiresClarification: false,
      requiresCapability: true
    )
  }

  fileprivate func replacingProvenance(
    of route: TrailRoute,
    with provenance: RouteProvenance
  ) -> TrailRoute {
    TrailRoute(
      id: route.id,
      provenance: provenance,
      title: route.title,
      location: route.location,
      activity: route.activity,
      distanceKilometers: route.distanceKilometers,
      elevationGainMeters: route.elevationGainMeters,
      elevationLossMeters: route.elevationLossMeters,
      durationHours: route.durationHours,
      difficulty: route.difficulty,
      routeType: route.routeType,
      summary: route.summary,
      whyItMatches: route.whyItMatches,
      highlights: route.highlights,
      waypoints: route.waypoints,
      days: route.days,
      safetyNotes: route.safetyNotes,
      elevationProfile: route.elevationProfile,
      path: route.path,
      routeInstructions: route.routeInstructions,
      planningMetadata: route.planningMetadata,
      intentDebugMetadata: route.intentDebugMetadata,
      verifiedCharacteristics: route.verifiedCharacteristics
    )
  }

  fileprivate func presentationCopy(_ presentation: ResearchRoutePresentation) -> String {
    [
      presentation.badge?.title,
      presentation.cardFacts.map(\.title).joined(separator: " "),
      presentation.fitReasons.map {
        [$0.title, $0.detail].compactMap(\.self)
          .joined(separator: " ")
      }.joined(separator: " "),
      presentation.highlights.map {
        "\($0.title) \($0.categoryLabel) \($0.evidenceLabel)"
      }.joined(separator: " "),
      presentation.limitations.map(\.title).joined(separator: " "),
      presentation.evidenceSummary.title,
      presentation.evidenceSummary.detail,
      presentation.evidenceSummary.coverageLabel,
    ]
    .compactMap(\.self)
    .joined(separator: " ")
  }

  fileprivate func assertDoesNotContainForbiddenClaims(
    _ copy: String,
    file: StaticString = #filePath,
    line: UInt = #line
  ) {
    let normalized = copy.lowercased()
    for forbidden in [
      "beautiful",
      "scenic route",
      "safe",
      "accessible",
      "open",
      "legal",
      "drinking water",
      "official route",
    ] {
      XCTAssertFalse(
        normalized.contains(forbidden),
        "Found forbidden claim: \(forbidden)",
        file: file,
        line: line
      )
    }
  }
}
