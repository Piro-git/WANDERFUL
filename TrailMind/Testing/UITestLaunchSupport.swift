#if DEBUG && targetEnvironment(simulator)
import Foundation
import SwiftUI

@MainActor
struct UITestLaunchComposition {
    enum StartDestination {
        case onboarding
        case onboardingLoading
        case appShell
        case routeGuidance
    }

    private enum Scenario: String {
        case onboarding
        case onboardingLoading = "onboarding-loading"
        case core
        case failOnce = "fail-once"
        case noRoutes = "no-routes"
        case researchComplete = "research-complete"
        case researchPartial = "research-partial"
        case researchFallback = "research-fallback"
        case researchClarification = "research-clarification"
        case guidance
        case guidanceOffRoute = "guidance-off-route"
        case guidanceComplete = "guidance-complete"
        case guidanceDenied = "guidance-denied"
        case guidanceReduced = "guidance-reduced"
        case guidanceRestricted = "guidance-restricted"
        case guidanceDirect = "guidance-direct"
    }

    let startDestination: StartDestination
    let appModel: AppModel
    let planner: PlannerViewModel
    let dynamicTypeSize: DynamicTypeSize
    let colorScheme: ColorScheme?
    let guidanceDependencies: RouteGuidanceDependencies
    let guidanceRoute: TrailRoute

    static func resolve(arguments: [String] = ProcessInfo.processInfo.arguments) -> UITestLaunchComposition? {
        let marker = "--trailmind-ui-testing"
        let scenarioKey = "--trailmind-ui-scenario"
        let markerCount = arguments.count { $0 == marker }
        let scenarioKeyIndexes = arguments.indices.filter { arguments[$0] == scenarioKey }

        guard markerCount > 0 || !scenarioKeyIndexes.isEmpty else {
            return nil
        }
        guard markerCount == 1, scenarioKeyIndexes.count == 1 else {
            preconditionFailure("TrailMind UI testing requires exactly one marker and one scenario.")
        }

        let scenarioIndex = scenarioKeyIndexes[0]
        guard arguments.indices.contains(scenarioIndex + 1) else {
            preconditionFailure("TrailMind UI testing requires a scenario value.")
        }
        let scenarioValue = arguments[scenarioIndex + 1]
        guard !scenarioValue.hasPrefix("--"), let scenario = Scenario(rawValue: scenarioValue) else {
            preconditionFailure("Unknown TrailMind UI-test scenario.")
        }

        let routingBehavior: UITestRoutingCoordinator.Behavior = switch scenario {
        case .onboarding, .onboardingLoading, .core, .researchComplete, .researchPartial,
             .researchFallback, .researchClarification, .guidance,
             .guidanceOffRoute, .guidanceComplete, .guidanceDenied,
             .guidanceReduced, .guidanceRestricted, .guidanceDirect:
            .success
        case .failOnce:
            .failOnce
        case .noRoutes:
            .noRoutes
        }
        let researchBehavior:
            UITestResearchPlanningCoordinator.Behavior = switch scenario
        {
        case .researchComplete:
            .complete
        case .researchPartial:
            .partial
        case .researchFallback:
            .fallback
        case .researchClarification:
            .clarification
        case .onboarding, .onboardingLoading, .core, .failOnce, .noRoutes,
             .guidance, .guidanceOffRoute, .guidanceComplete,
             .guidanceDenied, .guidanceReduced, .guidanceRestricted,
             .guidanceDirect:
            .complete
        }
        let researchEnabled: Bool = switch scenario {
        case .researchComplete, .researchPartial, .researchFallback,
             .researchClarification:
            true
        case .onboarding, .onboardingLoading, .core, .failOnce, .noRoutes,
             .guidance, .guidanceOffRoute, .guidanceComplete,
             .guidanceDenied, .guidanceReduced, .guidanceRestricted,
             .guidanceDirect:
            false
        }
        let savedRoutes = SavedRoutesModel(store: InMemorySavedRouteStore())
        let appModel = AppModel(savedRoutes: savedRoutes)
        let planner = PlannerViewModel(
            intentParsingProvider: UITestIntentParsingProvider(),
            geocodingService: UITestGeocodingService(),
            routingCoordinator: UITestRoutingCoordinator(behavior: routingBehavior),
            researchPlanningCoordinator:
                UITestResearchPlanningCoordinator(
                    behavior: researchBehavior
                ),
            researchFeatureAvailable: { researchEnabled },
            operationTimeouts: .init(parserSeconds: 2, geocodingSeconds: 2, routingSeconds: 2)
        )

        let startDestination: StartDestination = switch scenario {
        case .onboarding: .onboarding
        case .onboardingLoading: .onboardingLoading
        case .core, .failOnce, .noRoutes, .researchComplete,
             .researchPartial, .researchFallback, .researchClarification,
             .guidance:
            .appShell
        case .guidanceOffRoute, .guidanceComplete, .guidanceDenied,
             .guidanceReduced, .guidanceRestricted, .guidanceDirect:
            .routeGuidance
        }
        let usesLightMode = arguments.contains("--trailmind-ui-light-mode")
        let usesDarkMode = arguments.contains("--trailmind-ui-dark-mode")
        precondition(
            !(usesLightMode && usesDarkMode),
            "TrailMind UI testing accepts only one color-scheme override."
        )

        let guidanceMode: UITestRouteGuidanceMode = switch scenario {
        case .guidance, .guidanceDirect:
            .normal
        case .guidanceOffRoute:
            .offRoute
        case .guidanceComplete:
            .complete
        case .guidanceDenied:
            .denied
        case .guidanceReduced:
            .reducedAccuracy
        case .guidanceRestricted:
            .restricted
        case .onboarding, .onboardingLoading, .core, .failOnce, .noRoutes,
             .researchComplete, .researchPartial, .researchFallback,
             .researchClarification:
            .normal
        }

        guard let guidanceRoute = UITestRouteFactory.routes(
            request: RoutePlanningRequest(
                routeType: .pointToPoint,
                startQuery: "Ilsenburg",
                endQuery: "Schierke",
                activityType: .hiking,
                graphHopperProfile: "foot",
                targetDistanceKm: nil,
                targetDurationMinutes: nil,
                difficulty: nil,
                desiredFeatures: []
            )
        ).first else {
            preconditionFailure("Route Guidance UI testing requires its deterministic route fixture.")
        }

        return UITestLaunchComposition(
            startDestination: startDestination,
            appModel: appModel,
            planner: planner,
            dynamicTypeSize: arguments.contains("--trailmind-ui-accessibility-xxxl")
                ? .accessibility5
                : .large,
            colorScheme: usesDarkMode ? .dark : (usesLightMode ? .light : nil),
            guidanceDependencies: UITestRouteGuidanceDependencies.make(
                mode: guidanceMode
            ),
            guidanceRoute: guidanceRoute
        )
    }
}

private struct UITestIntentParsingProvider: IntentParsingProvider {
    let parserSource: IntentParserSource = .localRuleBased

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        let normalized = rawPrompt.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "en_US_POSIX")
        )

        if normalized.contains("12 km loop") {
            return intent(
                rawPrompt: rawPrompt,
                activity: .hiking,
                routeType: .loop,
                start: nil,
                end: nil,
                targetDistance: 12
            )
        }
        if normalized.contains("loop") || normalized.contains("rundwanderung") {
            return intent(
                rawPrompt: rawPrompt,
                activity: normalized.contains("trailrun") ? .trailRunning : .hiking,
                routeType: .loop,
                start: "Ilsenburg",
                end: nil,
                targetDistance: normalized.contains("15 km") ? 15 : 12,
                difficulty: normalized.contains("easy") ? .easy : nil,
                avoidFeatures: normalized.contains("avoid major roads")
                    ? [.majorRoads]
                    : []
            )
        }
        if normalized.contains("luneburg") && normalized.contains("amelinghausen") {
            return intent(
                rawPrompt: rawPrompt,
                activity: .biking,
                routeType: .pointToPoint,
                start: "Lüneburg",
                end: "Amelinghausen",
                targetDistance: nil
            )
        }
        if normalized.contains("ilsenburg") && normalized.contains("schierke") {
            return intent(
                rawPrompt: rawPrompt,
                activity: .hiking,
                routeType: .pointToPoint,
                start: "Ilsenburg",
                end: "Schierke",
                targetDistance: nil
            )
        }

        throw UITestLaunchError.unsupportedPrompt
    }

    private func intent(
        rawPrompt: String,
        activity: ActivityType,
        routeType: TrailRouteType,
        start: String?,
        end: String?,
        targetDistance: Double?,
        difficulty: RouteDifficulty? = nil,
        avoidFeatures: [AvoidFeature] = []
    ) -> AdventureIntent {
        AdventureIntent(
            rawPrompt: rawPrompt,
            parserSource: .localRuleBased,
            confidence: 1,
            activityType: activity,
            routeType: routeType,
            startLocationQuery: start,
            endLocationQuery: end,
            regionQuery: nil,
            targetDistanceKm: targetDistance,
            targetDurationMinutes: nil,
            difficulty: difficulty,
            desiredFeatures: [],
            avoidFeatures: avoidFeatures
        )
    }
}

@MainActor
private struct UITestGeocodingService: GeocodingService {
    func geocodeLocation(_ query: String, near preferredCoordinate: Coordinate?) async throws -> Coordinate {
        switch query.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current) {
        case "ilsenburg":
            Coordinate(latitude: 51.8640, longitude: 10.6785)
        case "schierke":
            Coordinate(latitude: 51.7669, longitude: 10.6642)
        case "luneburg":
            Coordinate(latitude: 53.2487, longitude: 10.4079)
        case "amelinghausen":
            Coordinate(latitude: 53.1305, longitude: 10.2147)
        default:
            throw GeocodingServiceError.noResults(query: query)
        }
    }
}

@MainActor
private final class UITestRoutingCoordinator: RoutingCoordinating {
    enum Behavior: Equatable {
        case success
        case failOnce
        case noRoutes
    }

    private let behavior: Behavior
    private var invocationCount = 0

    init(behavior: Behavior) {
        self.behavior = behavior
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> RoutingResult {
        invocationCount += 1
        if behavior == .failOnce, invocationCount == 1 {
            throw GraphHopperError.network(message: "Deterministic UI-test routing failure")
        }
        if behavior == .noRoutes {
            return RoutingResult(suggestions: [], notice: nil)
        }

        let routes = UITestRouteFactory.routes(request: intent.request)
        let rawSuggestions = routes.enumerated().map { index, route in
            RouteSuggestion(
                id: UITestRouteFactory.suggestionIDs[index],
                route: route,
                explanation: "Deterministic routed fixture"
            )
        }
        let suggestions = HikingRouteQualityEngine().select(
            rawSuggestions,
            request: intent.request
        ).selected.map(\.suggestion)
        return RoutingResult(
            suggestions: suggestions,
            notice: nil,
            loopSearchOutcome: intent.request.routeType == .loop
                ? .comparison(routeCount: suggestions.count)
                : nil,
            loopSearchDiagnostics: intent.request.routeType == .loop
                ? .empty(elapsedMilliseconds: 1)
                : nil
        )
    }
}

private struct UITestResearchPlanningCoordinator:
    OutdoorAdventurePlanningCoordinatingV1,
    Sendable
{
    enum Behavior: Equatable, Sendable {
        case complete
        case partial
        case fallback
        case clarification
    }

    let behavior: Behavior

    func plan(
        intent: AdventureResearchIntentV1
    ) async throws -> OutdoorAdventurePlanningCoordinatorResultV1 {
        switch behavior {
        case .fallback:
            throw OutdoorAdventurePlanningCoordinatorFailureV1.unavailable
        case .clarification:
            return try clarificationResult(intent: intent)
        case .complete, .partial:
            return routedResult(intent: intent)
        }
    }

    private func routedResult(
        intent: AdventureResearchIntentV1
    ) -> OutdoorAdventurePlanningCoordinatorResultV1 {
        let request = planningRequest(intent: intent)
        let routes = UITestRouteFactory.routes(request: request)
        let suggestions = routes.enumerated().map { index, route in
            RouteSuggestion(
                id: UITestRouteFactory.suggestionIDs[index],
                route: route.withPlanningMetadata(request.metadata),
                explanation: "Deterministic research-guided fixture"
            )
        }
        let partial = behavior == .partial
        let selectedWaypoints = researchWaypoints(partial: partial)
        let reachedIDs = selectedWaypoints.map(\.entityID)
        let knownLimitations: [ResearchKnownLimitationV1] = partial
            ? [
                .accessUnverified,
                .currentConditionsUnavailable,
                .mappedPresenceOnly,
                .officialStatusUnverified
            ]
            : []
        let provenance = ResearchRouteProvenanceV1(
            proposalID: "fixture-proposal",
            lineageID: "fixture-lineage",
            strategy: "must_have_first",
            activity: request.activityType,
            routeType: request.routeType,
            selectedWaypoints: selectedWaypoints,
            mappedNetworkCandidates: [],
            evidenceClaimIDs:
                selectedWaypoints.flatMap(\.evidenceClaimIDs),
            requiredVerification: partial
                ? [.publicAccessRequired, .currentConditionsRequired]
                : [],
            knownLimitations: knownLimitations,
            sourceCandidatePlanPolicyVersion:
                "research-guided-route-candidates-v1"
        )
        let alternatives = suggestions.enumerated().map {
            index, suggestion in
            ResearchGuidedRouteAlternativeV1(
                attemptID: "fixture-attempt-\(index)",
                routeResultID: "fixture-route-\(index)",
                suggestion: suggestion,
                researchProvenance: provenance,
                waypointVisits: selectedWaypoints.enumerated().map {
                    waypointIndex, waypoint in
                    researchVisit(
                        waypoint: waypoint,
                        index: waypointIndex,
                        reached: reachedIDs.contains(waypoint.entityID)
                    )
                }
            )
        }
        let selectionState: ResearchGuidedRoutedEnvelopeStateV1 =
            partial ? .partial : .routed
        let selection = ResearchGuidedRouteSelectionV1(
            state: selectionState,
            sourceEnvelopeState: selectionState,
            alternatives: alternatives,
            rejectionCounts: [:],
            remainingLimitations: knownLimitations.map(\.rawValue)
        )
        let planningGaps = partial
            ? [
                OutdoorAdventurePlanningGapV1(
                    code: .currentSourceUnavailable,
                    affectedField: .researchPlan,
                    affectedValue: nil,
                    reason: .currentEvidenceNotAvailable,
                    requiresClarification: false,
                    requiresCapability: true
                )
            ]
            : []
        let state = OutdoorAdventurePlanningRoutedStateV1(
            state: partial ? .partial : .routed,
            normalizedIntent: intent,
            planningGaps: planningGaps,
            routeSelection: selection
        )
        return partial ? .partial(state) : .routed(state)
    }

    private func clarificationResult(
        intent: AdventureResearchIntentV1
    ) throws -> OutdoorAdventurePlanningCoordinatorResultV1 {
        let question = AdventureResearchClarificationQuestionV1(
            code: .locationRequired,
            field: .geographicAnchor
        )
        let clarifiedIntent = try AdventureResearchIntentV1(
            activity: intent.activity,
            geographicAnchor: .unresolved(
                requirementCode: .locationRequired
            ),
            routeType: intent.routeType,
            distanceRangeKm: intent.distanceRangeKm,
            durationRangeMinutes: intent.durationRangeMinutes,
            maximumElevationGainMeters:
                intent.maximumElevationGainMeters,
            maximumTechnicalDifficulty:
                intent.maximumTechnicalDifficulty,
            mustHaveExperiences: intent.mustHaveExperiences,
            preferredExperiences: intent.preferredExperiences,
            avoidedExperiences: intent.avoidedExperiences,
            requiredFacilities: intent.requiredFacilities,
            groupContext: intent.groupContext,
            dateOrSeason: intent.dateOrSeason,
            overnightRequirements: intent.overnightRequirements,
            transportRequirements: intent.transportRequirements,
            unresolvedClarificationQuestions: [question]
        )
        return .clarificationRequired(
            OutdoorAdventurePlanningNonRoutedStateV1(
                state: .clarificationRequired,
                normalizedIntent: clarifiedIntent,
                planningGaps: [],
                clarificationQuestions: [question]
            )
        )
    }

    private func planningRequest(
        intent: AdventureResearchIntentV1
    ) -> RoutePlanningRequest {
        let activityType: ActivityType
        switch intent.activity {
        case .hiking:
            activityType = .hiking
        case .trailRunning:
            activityType = .trailRunning
        case .biking:
            activityType = .biking
        }
        let startName: String
        switch intent.geographicAnchor {
        case let .resolved(name, _, _):
            startName = name
        case .unresolved:
            startName = "Ilsenburg"
        }
        let desiredFeatures = intent.preferredExperiences.compactMap {
            experience -> DesiredFeature? in
            switch experience {
            case .viewpoint:
                .viewpoint
            case .forest:
                .forest
            case .quietTrails:
                .quiet
            case .waterfall, .peak, .lake, .officialHikingRoute,
                 .alpineHut, .wildernessHut, .landmark:
                nil
            }
        }
        return RoutePlanningRequest(
            routeType: .loop,
            startQuery: startName,
            endQuery: nil,
            activityType: activityType,
            graphHopperProfile: activityType == .biking ? "bike" : "foot",
            targetDistanceKm: intent.distanceRangeKm?.min,
            targetDurationMinutes: intent.durationRangeMinutes?.min,
            difficulty: intent.maximumTechnicalDifficulty == .hiking
                ? .easy
                : nil,
            desiredFeatures: desiredFeatures
        )
    }

    private func researchWaypoints(
        partial: Bool
    ) -> [ResearchSelectedWaypointV1] {
        let limitations: [ResearchKnownLimitationV1] =
            partial ? [.mappedPresenceOnly] : []
        return [
            ResearchSelectedWaypointV1(
                entityID: UUID(
                    uuidString:
                        "11111111-1111-4111-8111-111111111111"
                )!,
                coordinate: Coordinate(
                    latitude: 51.84,
                    longitude: 10.69
                ),
                highlightCategory: .viewpoint,
                role: .preferred,
                evidenceClaimIDs: [
                    UUID(
                        uuidString:
                            "66666666-6666-4666-8666-666666666661"
                    )!
                ],
                selectionReasons: [.preferredExperience],
                requiredVerification: [],
                knownLimitations: limitations
            ),
            ResearchSelectedWaypointV1(
                entityID: UUID(
                    uuidString:
                        "22222222-2222-4222-8222-222222222222"
                )!,
                coordinate: Coordinate(
                    latitude: 51.83,
                    longitude: 10.67
                ),
                highlightCategory: .waterfall,
                role: .preferred,
                evidenceClaimIDs: [
                    UUID(
                        uuidString:
                            "66666666-6666-4666-8666-666666666662"
                    )!
                ],
                selectionReasons: [.preferredExperience],
                requiredVerification: [],
                knownLimitations: limitations
            )
        ]
    }

    private func researchVisit(
        waypoint: ResearchSelectedWaypointV1,
        index: Int,
        reached: Bool
    ) -> ResearchWaypointVisitV1 {
        ResearchWaypointVisitV1(
            waypointIndex: index + 1,
            role: .via,
            entityID: waypoint.entityID,
            requestedCoordinate: waypoint.coordinate,
            snappedCoordinate: reached ? waypoint.coordinate : nil,
            snapDistanceMeters: reached ? 0 : nil,
            withinVisitTolerance: reached
        )
    }
}

private enum UITestRouteFactory {
    private struct RoadEvidenceProfile {
        let coverageRatio: Double
        let pathRatio: Double
        let majorRoadRatio: Double
    }

    static let pointToPointRouteID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    static let loopRouteIDs = [
        UUID(uuidString: "22222222-2222-4222-8222-222222222221")!,
        UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
        UUID(uuidString: "22222222-2222-4222-8222-222222222223")!
    ]
    static let suggestionIDs = [
        UUID(uuidString: "33333333-3333-4333-8333-333333333331")!,
        UUID(uuidString: "33333333-3333-4333-8333-333333333332")!,
        UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
    ]

    static func routes(request: RoutePlanningRequest) -> [TrailRoute] {
        let activity = request.activityType
        let routeType = request.routeType
        if routeType == .loop {
            let roadEvidence: [RoadEvidenceProfile?] = if request.avoidFeatures.contains(.majorRoads) {
                [
                    RoadEvidenceProfile(coverageRatio: 1, pathRatio: 0.20, majorRoadRatio: 0.35),
                    RoadEvidenceProfile(coverageRatio: 1, pathRatio: 0.85, majorRoadRatio: 0.01),
                    RoadEvidenceProfile(coverageRatio: 0.20, pathRatio: 0.16, majorRoadRatio: 0)
                ]
            } else {
                [nil, nil, nil]
            }
            return [
                route(
                    id: loopRouteIDs[0],
                    title: "Ilsenburg North Loop",
                    activity: activity,
                    routeType: .loop,
                    distance: 14.8,
                    elevationGain: 330,
                    duration: 4.1,
                    path: loopPath(latitudeOffset: 0, longitudeOffset: 0),
                    roadEvidence: roadEvidence[0]
                ),
                route(
                    id: loopRouteIDs[1],
                    title: "Ilsenburg South Loop",
                    activity: activity,
                    routeType: .loop,
                    distance: 15.3,
                    elevationGain: 280,
                    duration: 4.0,
                    path: loopPath(latitudeOffset: -0.008, longitudeOffset: 0.006),
                    roadEvidence: roadEvidence[1]
                ),
                route(
                    id: loopRouteIDs[2],
                    title: "Ilsenburg Ridge Loop",
                    activity: activity,
                    routeType: .loop,
                    distance: 16.1,
                    elevationGain: 410,
                    duration: 4.5,
                    path: loopPath(latitudeOffset: 0.006, longitudeOffset: -0.007),
                    roadEvidence: roadEvidence[2]
                )
            ]
        }

        return [
            route(
                id: pointToPointRouteID,
                title: "Ilsenburg to Schierke Route",
                activity: activity,
                routeType: .pointToPoint,
                distance: 14.2,
                elevationGain: 360,
                duration: 4.2,
                path: [
                    Coordinate(latitude: 51.8640, longitude: 10.6785, elevationMeters: 250),
                    Coordinate(latitude: 51.8360, longitude: 10.6680, elevationMeters: 360),
                    Coordinate(latitude: 51.8060, longitude: 10.6500, elevationMeters: 540),
                    Coordinate(latitude: 51.7810, longitude: 10.6590, elevationMeters: 470),
                    Coordinate(latitude: 51.7669, longitude: 10.6642, elevationMeters: 610)
                ],
                roadEvidence: nil
            )
        ]
    }

    private static func loopPath(latitudeOffset: Double, longitudeOffset: Double) -> [Coordinate] {
        let start = Coordinate(
            latitude: 51.8640 + latitudeOffset,
            longitude: 10.6785 + longitudeOffset,
            elevationMeters: 250
        )
        return [
            start,
            Coordinate(latitude: 51.8500 + latitudeOffset, longitude: 10.7020 + longitudeOffset, elevationMeters: 330),
            Coordinate(latitude: 51.8240 + latitudeOffset, longitude: 10.6950 + longitudeOffset, elevationMeters: 470),
            Coordinate(latitude: 51.8180 + latitudeOffset, longitude: 10.6580 + longitudeOffset, elevationMeters: 520),
            Coordinate(latitude: 51.8420 + latitudeOffset, longitude: 10.6420 + longitudeOffset, elevationMeters: 390),
            start
        ]
    }

    private static func route(
        id: UUID,
        title: String,
        activity: ActivityType,
        routeType: TrailRouteType,
        distance: Double,
        elevationGain: Int,
        duration: Double,
        path: [Coordinate],
        roadEvidence: RoadEvidenceProfile?
    ) -> TrailRoute {
        let routeInstructions = instructions(for: path, routeType: routeType)
        let difficulty = RouteDifficulty.estimated(
            distanceKilometers: distance,
            elevationGainMeters: elevationGain
        )
        let elevationLoss = max(0, elevationGain - 40)
        let verifiedCharacteristics = roadEvidence.map {
            routeCharacteristics(
                routeDistanceMeters: distance * 1_000,
                profile: $0
            )
        }
        let provenance = RouteProvenance.routingEngineOutput(
            provider: .graphHopper,
            strategy: .backend,
            activity: activity,
            routeType: routeType,
            distanceKilometers: distance,
            elevationGainMeters: elevationGain,
            elevationLossMeters: elevationLoss,
            durationHours: duration,
            difficulty: difficulty,
            path: path,
            routeInstructions: routeInstructions,
            verifiedCharacteristics: verifiedCharacteristics
        )
        return TrailRoute(
            id: id,
            provenance: provenance,
            title: title,
            location: "Ilsenburg, Germany",
            activity: activity,
            distanceKilometers: distance,
            elevationGainMeters: elevationGain,
            elevationLossMeters: elevationLoss,
            durationHours: duration,
            difficulty: difficulty,
            routeType: routeType,
            summary: "A deterministic mapped route used only by TrailMind UI automation.",
            whyItMatches: "Matches the requested activity and route type.",
            highlights: [],
            waypoints: [],
            days: [],
            safetyNotes: [
                SafetyNote(
                    title: "Review before starting",
                    message: "Check current weather, trail conditions and local rules.",
                    severity: .info
                )
            ],
            elevationProfile: path.compactMap(\.elevationMeters),
            path: path,
            routeInstructions: routeInstructions,
            verifiedCharacteristics: verifiedCharacteristics
        )
    }

    private static func instructions(
        for path: [Coordinate],
        routeType: TrailRouteType
    ) -> [RouteInstruction] {
        guard path.count >= 4 else { return [] }
        return [
            RouteInstruction(
                id: UUID(uuidString: "44444444-4444-4444-8444-444444444441")!,
                text: routeType == .loop
                    ? "Continue around the mapped loop"
                    : "Continue on the mapped trail",
                streetName: "Mapped route",
                distanceMeters: 1_000,
                durationSeconds: 900,
                sign: 0,
                coordinate: path[1]
            ),
            RouteInstruction(
                id: UUID(uuidString: "44444444-4444-4444-8444-444444444442")!,
                text: "Continue toward the mapped finish",
                streetName: nil,
                distanceMeters: 1_000,
                durationSeconds: 900,
                sign: 0,
                coordinate: path[path.count - 2]
            )
        ]
    }

    private static func routeCharacteristics(
        routeDistanceMeters: Double,
        profile: RoadEvidenceProfile
    ) -> VerifiedRouteCharacteristics {
        let otherRatio = max(
            profile.coverageRatio - profile.pathRatio - profile.majorRoadRatio,
            0
        )
        var roadClassBreakdown = [
            VerifiedRouteCharacteristicValue(
                value: "path",
                distanceMeters: profile.pathRatio * routeDistanceMeters
            ),
            VerifiedRouteCharacteristicValue(
                value: "primary",
                distanceMeters: profile.majorRoadRatio * routeDistanceMeters
            )
        ]
        if otherRatio > 0 {
            roadClassBreakdown.append(
                VerifiedRouteCharacteristicValue(
                    value: "residential",
                    distanceMeters: otherRatio * routeDistanceMeters
                )
            )
        }
        return VerifiedRouteCharacteristics(
            routeDistanceMeters: routeDistanceMeters,
            surfaceBreakdown: [],
            roadClassBreakdown: roadClassBreakdown,
            hikeRatingBreakdown: [],
            surfaceCoverageMeters: 0,
            roadClassCoverageMeters: profile.coverageRatio * routeDistanceMeters,
            hikeRatingCoverageMeters: 0
        )
    }
}

private enum UITestLaunchError: LocalizedError {
    case unsupportedPrompt

    var errorDescription: String? {
        "This prompt is not part of the deterministic UI-test contract."
    }
}

private enum UITestRouteGuidanceMode: Equatable {
    case normal
    case offRoute
    case complete
    case denied
    case reducedAccuracy
    case restricted
}

@MainActor
private enum UITestRouteGuidanceDependencies {
    static func make(mode: UITestRouteGuidanceMode) -> RouteGuidanceDependencies {
        let location = UITestRouteLocationService(mode: mode)
        let clock = UITestRouteGuidanceClock()
        let screenAwake = UITestRouteScreenAwakeController()
        return RouteGuidanceDependencies(
            makeLocationService: { _ in location },
            makeClock: { clock },
            makeScreenAwakeController: { screenAwake }
        )
    }
}

@MainActor
private final class UITestRouteLocationService: RouteLocationProviding {
    private let mode: UITestRouteGuidanceMode
    private var producerTask: Task<Void, Never>?
    private var activeContinuation:
        AsyncThrowingStream<RouteLocationSample, Error>.Continuation?
    private(set) var authorization: RouteLocationAuthorization

    init(mode: UITestRouteGuidanceMode) {
        self.mode = mode
        authorization = switch mode {
        case .denied:
            .denied
        case .reducedAccuracy:
            .reducedAccuracy
        case .restricted:
            .restricted
        case .normal, .offRoute, .complete:
            .notDetermined
        }
    }

    func requestWhenInUseAuthorization() async -> RouteLocationAuthorization {
        switch mode {
        case .denied:
            return .denied
        case .reducedAccuracy:
            return .reducedAccuracy
        case .restricted:
            return .restricted
        case .normal, .offRoute, .complete:
            break
        }
        authorization = .authorized
        return .authorized
    }

    func locationUpdates() -> AsyncThrowingStream<RouteLocationSample, Error> {
        stopUpdatingLocation()
        return AsyncThrowingStream { continuation in
            activeContinuation = continuation
            let samples = Self.samples(for: mode)
            producerTask = Task { @MainActor in
                for sample in samples {
                    guard !Task.isCancelled else { return }
                    continuation.yield(sample)
                    try? await Task.sleep(for: .milliseconds(450))
                }
                do {
                    try await Task.sleep(for: .seconds(3_600))
                } catch {
                    return
                }
            }
            continuation.onTermination = { @Sendable [weak self] _ in
                Task { @MainActor in
                    self?.producerTask?.cancel()
                    self?.producerTask = nil
                }
            }
        }
    }

    func stopUpdatingLocation() {
        producerTask?.cancel()
        producerTask = nil
        let continuation = activeContinuation
        activeContinuation = nil
        continuation?.finish()
    }

    private static func samples(
        for mode: UITestRouteGuidanceMode
    ) -> [RouteLocationSample] {
        let start = Coordinate(latitude: 51.8640, longitude: 10.6785)
        let firstInstruction = Coordinate(latitude: 51.8360, longitude: 10.6680)
        let nearFinish = Coordinate(latitude: 51.7810, longitude: 10.6590)
        let finish = Coordinate(latitude: 51.7669, longitude: 10.6642)
        let offRoute = Coordinate(latitude: 51.8662, longitude: 10.6785)
        let coordinates: [Coordinate] = switch mode {
        case .normal, .denied, .reducedAccuracy, .restricted:
            [start, firstInstruction]
        case .offRoute:
            [start, offRoute, offRoute, offRoute]
        case .complete:
            [start, nearFinish, finish, finish]
        }
        let baseDate = Date()
        return coordinates.enumerated().map { index, coordinate in
            RouteLocationSample(
                coordinate: coordinate,
                horizontalAccuracyMeters: 5,
                timestamp: baseDate.addingTimeInterval(Double(index))
            )
        }
    }
}

@MainActor
private final class UITestRouteGuidanceClock: RouteGuidanceClock {
    func now() -> Date { Date() }

    func sleep(seconds: TimeInterval) async throws {
        try await Task.sleep(for: .seconds(seconds))
    }
}

@MainActor
private final class UITestRouteScreenAwakeController:
    RouteScreenAwakeControlling
{
    private(set) var isGuidanceActive = false

    func setGuidanceActive(_ isActive: Bool) {
        isGuidanceActive = isActive
    }
}
#endif
