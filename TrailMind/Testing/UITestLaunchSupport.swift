#if DEBUG && targetEnvironment(simulator)
import Foundation

@MainActor
struct UITestLaunchComposition {
    enum StartDestination {
        case onboarding
        case appShell
    }

    private enum Scenario: String {
        case onboarding
        case core
        case failOnce = "fail-once"
        case noRoutes = "no-routes"
    }

    let startDestination: StartDestination
    let appModel: AppModel
    let planner: PlannerViewModel

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
        case .onboarding, .core:
            .success
        case .failOnce:
            .failOnce
        case .noRoutes:
            .noRoutes
        }
        let savedRoutes = SavedRoutesModel(store: InMemorySavedRouteStore())
        let appModel = AppModel(savedRoutes: savedRoutes)
        let planner = PlannerViewModel(
            intentParsingProvider: UITestIntentParsingProvider(),
            geocodingService: UITestGeocodingService(),
            routingCoordinator: UITestRoutingCoordinator(behavior: routingBehavior),
            operationTimeouts: .init(parserSeconds: 2, geocodingSeconds: 2, routingSeconds: 2)
        )

        return UITestLaunchComposition(
            startDestination: scenario == .onboarding ? .onboarding : .appShell,
            appModel: appModel,
            planner: planner
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

@MainActor
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
            verifiedCharacteristics: verifiedCharacteristics
        )
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
#endif
