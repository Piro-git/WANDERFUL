import XCTest
@testable import TrailMind

@MainActor
private struct FixedIntentParsingProvider: IntentParsingProvider, IntentParsingDebugProviding {
    nonisolated let parserSource: IntentParserSource
    let intent: AdventureIntent
    let debugInfo: IntentParserDebugInfo?

    init(intent: AdventureIntent, debugInfo: IntentParserDebugInfo? = nil) {
        parserSource = intent.parserSource
        self.intent = intent
        self.debugInfo = debugInfo
    }

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent { intent }
    func intentParserDebugInfo() async -> IntentParserDebugInfo? { debugInfo }
}

#if DEBUG
private struct UnavailableIntentParsingProvider: IntentParsingProvider {
    let parserSource: IntentParserSource = .remoteAI

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        throw RemoteAIIntentParsingProvider.ProviderError.notConfigured
    }
}
#endif

private struct SlowIntentParsingProvider: IntentParsingProvider {
    let parserSource: IntentParserSource
    let intent: AdventureIntent
    let delay: Duration

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        try await Task.sleep(for: delay)
        return intent
    }
}

@MainActor
private final class ControlledIntentParsingProvider: IntentParsingProvider {
    nonisolated let parserSource: IntentParserSource = .localRuleBased
    private(set) var prompts: [String] = []
    private(set) var completedRequestIDs: Set<Int> = []
    private var continuations: [Int: CheckedContinuation<AdventureIntent, Error>] = [:]

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        let requestID = prompts.count
        prompts.append(rawPrompt)
        let intent = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<AdventureIntent, Error>) in
            continuations[requestID] = continuation
        }
        completedRequestIDs.insert(requestID)
        return intent
    }

    func succeed(requestID: Int, with intent: AdventureIntent) {
        continuations.removeValue(forKey: requestID)?.resume(returning: intent)
    }
}

@MainActor
private final class HangingDebugIntentParsingProvider: IntentParsingProvider, IntentParsingDebugProviding {
    nonisolated let parserSource: IntentParserSource
    let intent: AdventureIntent
    private(set) var debugRequestCount = 0
    private var debugContinuation: CheckedContinuation<IntentParserDebugInfo?, Never>?

    init(intent: AdventureIntent) {
        parserSource = intent.parserSource
        self.intent = intent
    }

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent { intent }

    func intentParserDebugInfo() async -> IntentParserDebugInfo? {
        debugRequestCount += 1
        return await withCheckedContinuation { continuation in
            debugContinuation = continuation
        }
    }

    func finishDebugInfo(_ debugInfo: IntentParserDebugInfo? = nil) {
        debugContinuation?.resume(returning: debugInfo)
        debugContinuation = nil
    }
}

@MainActor
private final class StubGeocodingService: GeocodingService {
    struct Request {
        let query: String
        let preferredCoordinate: Coordinate?
    }

    private var outcomes: [String: [Result<Coordinate, GeocodingServiceError>]]
    private(set) var requests: [Request] = []

    init(coordinates: [String: Coordinate]) {
        outcomes = coordinates.mapValues { [.success($0)] }
    }

    init(outcomes: [String: [Result<Coordinate, GeocodingServiceError>]]) {
        self.outcomes = outcomes
    }

    func geocodeLocation(_ query: String, near preferredCoordinate: Coordinate?) async throws -> Coordinate {
        requests.append(Request(query: query, preferredCoordinate: preferredCoordinate))
        guard var queryOutcomes = outcomes[query], !queryOutcomes.isEmpty else {
            throw GeocodingServiceError.noResults(query: query)
        }
        let outcome = queryOutcomes.removeFirst()
        outcomes[query] = queryOutcomes
        return try outcome.get()
    }
}

@MainActor
private final class ControlledGeocodingService: GeocodingService {
    struct Request {
        let query: String
        let preferredCoordinate: Coordinate?
    }

    private(set) var requests: [Request] = []
    private(set) var completedRequestIDs: Set<Int> = []
    private var continuations: [Int: CheckedContinuation<Coordinate, Error>] = [:]

    func geocodeLocation(_ query: String, near preferredCoordinate: Coordinate?) async throws -> Coordinate {
        let requestID = requests.count
        requests.append(Request(query: query, preferredCoordinate: preferredCoordinate))
        let coordinate = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Coordinate, Error>) in
            continuations[requestID] = continuation
        }
        completedRequestIDs.insert(requestID)
        return coordinate
    }

    func succeed(requestID: Int, with coordinate: Coordinate) {
        continuations.removeValue(forKey: requestID)?.resume(returning: coordinate)
    }
}

@MainActor
private final class PolicyLocationResolver: LocationResolving {
    private let candidatesByQuery: [String: [LocationCandidate]]
    private(set) var contexts: [LocationQueryContext] = []

    init(candidatesByQuery: [String: [LocationCandidate]]) {
        self.candidatesByQuery = candidatesByQuery
    }

    func resolve(_ context: LocationQueryContext) async throws -> LocationResolution {
        contexts.append(context)
        return LocationResolutionPolicy.resolve(
            context: context,
            candidates: candidatesByQuery[context.originalQuery] ?? []
        )
    }
}

@MainActor
private final class StubRoutingCoordinator: RoutingCoordinating {
    private var results: [Result<RoutingResult, Error>]
    private(set) var intents: [RouteIntent] = []

    init(results: [Result<RoutingResult, Error>]) {
        self.results = results
    }

    convenience init(routes: [TrailRoute], notice: String? = nil) {
        self.init(
            results: [
                .success(
                    RoutingResult(
                        suggestions: RouteSuggestionNormalizer.suggestions(from: routes),
                        notice: notice
                    )
                )
            ]
        )
    }

    convenience init(route: TrailRoute) {
        self.init(routes: [route])
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> RoutingResult {
        intents.append(intent)
        guard !results.isEmpty else { throw GraphHopperError.noRouteFound }
        return try results.removeFirst().get()
    }
}

@MainActor
private final class ControlledRoutingCoordinator: RoutingCoordinating {
    private(set) var intents: [RouteIntent] = []
    private(set) var completedRequestIDs: Set<Int> = []
    private var continuations: [Int: CheckedContinuation<RoutingResult, Error>] = [:]

    func routeSuggestions(for intent: RouteIntent) async throws -> RoutingResult {
        let requestID = intents.count
        intents.append(intent)
        let result = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<RoutingResult, Error>) in
            continuations[requestID] = continuation
        }
        completedRequestIDs.insert(requestID)
        return result
    }

    func succeed(requestID: Int, routes: [TrailRoute]) {
        continuations.removeValue(forKey: requestID)?.resume(
            returning: RoutingResult(
                suggestions: RouteSuggestionNormalizer.suggestions(from: routes),
                notice: nil
            )
        )
    }
}

@MainActor
final class PlannerViewModelTests: XCTestCase {
    private let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
    private let end = Coordinate(latitude: 51.7636, longitude: 10.6647)

    private func locationCandidate(
        id: String,
        name: String,
        displayName: String,
        coordinate: Coordinate,
        kind: LocationSemanticKind = .settlement,
        countryCode: String? = "DE",
        rank: Int = 0
    ) -> LocationCandidate {
        LocationCandidate(
            id: id,
            name: name,
            displayName: displayName,
            coordinate: coordinate,
            semanticKind: kind,
            countryCode: countryCode,
            provider: .appleGeocoder,
            providerRank: rank
        )
    }

    private func makeViewModel(
        geocodingService: any GeocodingService,
        routingCoordinator: any RoutingCoordinating,
        intentParsingProvider: any IntentParsingProvider = LocalIntentParsingProvider(),
        operationTimeouts: PlannerViewModel.OperationTimeouts = .production,
        attemptIDProvider: @escaping @MainActor () -> UUID = { UUID() }
    ) -> PlannerViewModel {
        PlannerViewModel(
            intentParsingProvider: intentParsingProvider,
            geocodingService: geocodingService,
            routingCoordinator: routingCoordinator,
            operationTimeouts: operationTimeouts,
            attemptIDProvider: attemptIDProvider
        )
    }

    private func makeIntent(
        rawPrompt: String,
        parserSource: IntentParserSource = .remoteAI,
        activity: ActivityType = .hiking,
        routeType: TrailRouteType = .pointToPoint,
        start: String? = "Ilsenburg",
        end: String? = "Schierke",
        region: String? = nil,
        distance: Double? = nil,
        duration: Int? = nil,
        difficulty: RouteDifficulty? = nil,
        desired: [DesiredFeature] = [],
        avoid: [AvoidFeature] = []
    ) -> AdventureIntent {
        AdventureIntent(
            rawPrompt: rawPrompt,
            parserSource: parserSource,
            confidence: 0.82,
            activityType: activity,
            routeType: routeType,
            startLocationQuery: start,
            endLocationQuery: end,
            regionQuery: region,
            targetDistanceKm: distance,
            targetDurationMinutes: duration,
            difficulty: difficulty,
            desiredFeatures: desired,
            avoidFeatures: avoid
        )
    }

    private func verifiedRoute(
        basedOn base: TrailRoute = TestRouteFixtures.luneburgLoop,
        activity: ActivityType = .hiking,
        routeType: TrailRouteType
    ) -> TrailRoute {
        let difficulty = RouteDifficulty.estimated(
            distanceKilometers: base.distanceKilometers,
            elevationGainMeters: base.elevationGainMeters
        )
        let provenance = RouteProvenance.routingEngineOutput(
            provider: .graphHopper,
            strategy: .backend,
            activity: activity,
            routeType: routeType,
            distanceKilometers: base.distanceKilometers,
            elevationGainMeters: base.elevationGainMeters,
            elevationLossMeters: base.elevationLossMeters,
            durationHours: base.durationHours,
            difficulty: difficulty,
            path: base.path,
            verifiedCharacteristics: base.verifiedCharacteristics
        )
        return TrailRoute(
            id: base.id,
            provenance: provenance,
            title: base.title,
            location: base.location,
            activity: activity,
            distanceKilometers: base.distanceKilometers,
            elevationGainMeters: base.elevationGainMeters,
            elevationLossMeters: base.elevationLossMeters,
            durationHours: base.durationHours,
            difficulty: difficulty,
            routeType: routeType,
            summary: base.summary,
            whyItMatches: base.whyItMatches,
            highlights: base.highlights,
            waypoints: base.waypoints,
            days: base.days,
            safetyNotes: base.safetyNotes,
            elevationProfile: base.elevationProfile,
            path: base.path,
            routeInstructions: base.routeInstructions,
            planningMetadata: nil,
            intentDebugMetadata: nil,
            verifiedCharacteristics: base.verifiedCharacteristics
        )
    }

    private func waitUntil(
        _ description: String,
        iterations: Int = 2_000,
        condition: @escaping @MainActor () -> Bool
    ) async -> Bool {
        for _ in 0..<iterations {
            if condition() { return true }
            await Task.yield()
        }
        XCTFail("Timed out waiting for \(description)")
        return false
    }

    private func drainTasks(iterations: Int = 30) async {
        for _ in 0..<iterations { await Task.yield() }
    }

    func testIdleSubmitGenerationProducesOneVerifiedSuggestion() async throws {
        let geocoder = StubGeocodingService(coordinates: ["Ilsenburg": start, "Schierke": end])
        let router = StubRoutingCoordinator(route: verifiedRoute(routeType: .pointToPoint))
        let viewModel = makeViewModel(geocodingService: geocoder, routingCoordinator: router)

        XCTAssertEqual(viewModel.state, .idle(prompt: ""))
        viewModel.startPlanning(prompt: "Ilsenburg nach Schierke")
        guard case let .understanding(attempt) = viewModel.state else {
            return XCTFail("Submission must synchronously enter understanding.")
        }
        XCTAssertEqual(attempt.originalPrompt, "Ilsenburg nach Schierke")

        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("A verified single route must enter suggestionsReady.")
        }
        XCTAssertEqual(success.originalPrompt, "Ilsenburg nach Schierke")
        XCTAssertEqual(success.suggestions.count, 1)
        XCTAssertTrue(try XCTUnwrap(success.suggestions.first).route.isVerifiedRoutedResult)
        XCTAssertEqual(success.suggestions.first?.route.activity, .hiking)
        XCTAssertEqual(success.suggestions.first?.route.routeType, .pointToPoint)
        XCTAssertEqual(geocoder.requests.map(\.query), ["Ilsenburg", "Schierke"])
        XCTAssertNil(geocoder.requests.first?.preferredCoordinate)
        XCTAssertEqual(geocoder.requests.last?.preferredCoordinate, start)
        XCTAssertEqual(router.intents.first?.request.graphHopperProfile, "foot")
        XCTAssertEqual(router.intents.first?.parsedIntent?.rawPrompt, "Ilsenburg nach Schierke")
        XCTAssertEqual(success.suggestions.first?.route.intentDebugMetadata?.intent.rawPrompt, "Ilsenburg nach Schierke")
        XCTAssertEqual(success.suggestions.first?.route.intentDebugMetadata?.localFallbackUsed, true)
    }

    func testOrdinaryPlanningPerformsNoOutdoorEvidenceRequestByDefault() async {
        XCTAssertTrue(
            OutdoorRouteEvidenceProviderFactory.makeDefault() is NoOpOutdoorRouteEvidenceProvider
        )
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(
                coordinates: ["Ilsenburg": start, "Schierke": end]
            ),
            routingCoordinator: StubRoutingCoordinator(
                route: verifiedRoute(routeType: .pointToPoint)
            )
        )

        viewModel.startPlanning(prompt: "Ilsenburg nach Schierke")
        await viewModel.generate()
        await drainTasks()

        guard case .suggestionsReady = viewModel.state else {
            return XCTFail("Ordinary planning must still produce a route with collection disabled.")
        }
        XCTAssertTrue(viewModel.outdoorEvidenceBySuggestionID.isEmpty)
    }

    func testMultipleVerifiedSuggestionsRemainInOneSuccessState() async {
        let prompt = "15 km Rundwanderung um Ilsenburg"
        let intent = makeIntent(
            rawPrompt: prompt,
            routeType: .loop,
            start: "Ilsenburg",
            end: nil,
            distance: 15
        )
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start]),
            routingCoordinator: StubRoutingCoordinator(
                routes: [TestRouteFixtures.luneburgLoop, TestRouteFixtures.sunsetRidge]
            ),
            intentParsingProvider: FixedIntentParsingProvider(intent: intent)
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Expected multiple suggestions.")
        }
        XCTAssertEqual(success.suggestions.map(\.route.id), [
            TestRouteFixtures.luneburgLoop.id,
            TestRouteFixtures.sunsetRidge.id
        ])
        XCTAssertTrue(success.suggestions.allSatisfy { $0.route.isVerifiedRoutedResult })
    }

    func testMissingLoopStartClarifiesThenGeneratesWithoutChangingPrompt() async throws {
        let prompt = "Plan a 12 km loop"
        let intent = makeIntent(
            rawPrompt: prompt,
            activity: .trailRunning,
            routeType: .loop,
            start: nil,
            end: nil,
            region: nil,
            distance: 12
        )
        let geocoder = StubGeocodingService(coordinates: ["Ilsenburg": start])
        let router = StubRoutingCoordinator(
            route: verifiedRoute(activity: .trailRunning, routeType: .loop)
        )
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router,
            intentParsingProvider: FixedIntentParsingProvider(intent: intent)
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        let clarification = try XCTUnwrap(viewModel.currentClarification)
        XCTAssertEqual(clarification.originalPrompt, prompt)
        XCTAssertEqual(clarification.kind, .location(.startLocationQuery))
        XCTAssertEqual(viewModel.prompt, prompt)

        viewModel.submitClarification(.text("  Ilsenburg  "))
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Clarified loop must generate.")
        }
        XCTAssertEqual(success.originalPrompt, prompt)
        XCTAssertEqual(router.intents.first?.request.startQuery, "Ilsenburg")
        XCTAssertEqual(router.intents.first?.request.activityType, .trailRunning)
        XCTAssertEqual(router.intents.first?.request.targetDistanceKm, 12)
        XCTAssertEqual(success.suggestions.first?.route.intentDebugMetadata?.intent.rawPrompt, prompt)
    }

    func testPointToPointMissingOriginThenDestinationClarifiesInOrderAndGenerates() async throws {
        let prompt = "Plan a hiking route"
        let intent = makeIntent(rawPrompt: prompt, start: nil, end: nil)
        let geocoder = StubGeocodingService(coordinates: ["Ilsenburg": start, "Schierke": end])
        let router = StubRoutingCoordinator(route: verifiedRoute(routeType: .pointToPoint))
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router,
            intentParsingProvider: FixedIntentParsingProvider(intent: intent)
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()
        XCTAssertEqual(try XCTUnwrap(viewModel.currentClarification).kind, .location(.startLocationQuery))

        viewModel.answerClarification(.text("Ilsenburg"))
        XCTAssertEqual(try XCTUnwrap(viewModel.currentClarification).kind, .location(.endLocationQuery))
        XCTAssertEqual(viewModel.prompt, prompt)

        viewModel.answerClarification(.text("Schierke"))
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Both clarified endpoints must generate.")
        }
        XCTAssertEqual(success.originalPrompt, prompt)
        XCTAssertEqual(router.intents.first?.request.startQuery, "Ilsenburg")
        XCTAssertEqual(router.intents.first?.request.endQuery, "Schierke")
        XCTAssertEqual(success.suggestions.first?.route.intentDebugMetadata?.intent.rawPrompt, prompt)
    }

    func testClarificationMergesOnlyTargetFieldAndPreservesOriginalIntent() async throws {
        let prompt = "Bike 42 km from Ilsenburg with views and no major roads"
        let intent = makeIntent(
            rawPrompt: prompt,
            activity: .biking,
            start: "Ilsenburg",
            end: nil,
            distance: 42,
            duration: 180,
            difficulty: .challenging,
            desired: [.viewpoint, .forest],
            avoid: [.majorRoads, .repeatedPath]
        )
        let debugInfo = IntentParserDebugInfo(
            remoteAttempted: true,
            remoteSucceeded: true,
            remoteFailureReason: nil,
            remoteStatusCode: 200,
            remoteValidationError: nil,
            backendBaseURL: nil,
            parserMode: .remoteWithLocalFallback
        )
        let router = StubRoutingCoordinator(
            route: verifiedRoute(activity: .biking, routeType: .pointToPoint)
        )
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start, "Schierke": end]),
            routingCoordinator: router,
            intentParsingProvider: FixedIntentParsingProvider(intent: intent, debugInfo: debugInfo)
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()
        viewModel.submitClarification(.text("Schierke"))
        await viewModel.generate()

        let routedIntent = try XCTUnwrap(router.intents.first?.parsedIntent)
        XCTAssertEqual(routedIntent.rawPrompt, prompt)
        XCTAssertEqual(routedIntent.activityType, .biking)
        XCTAssertEqual(routedIntent.routeType, .pointToPoint)
        XCTAssertEqual(routedIntent.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(routedIntent.endLocationQuery, "Schierke")
        XCTAssertNil(routedIntent.regionQuery)
        XCTAssertEqual(routedIntent.targetDistanceKm, 42)
        XCTAssertEqual(routedIntent.targetDurationMinutes, 180)
        XCTAssertEqual(routedIntent.difficulty, .challenging)
        XCTAssertEqual(routedIntent.desiredFeatures, [.viewpoint, .forest])
        XCTAssertEqual(routedIntent.avoidFeatures, [.majorRoads, .repeatedPath])
        XCTAssertEqual(routedIntent.transportMode, .cycling)

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Clarified request must succeed.")
        }
        XCTAssertEqual(success.originalPrompt, prompt)
        XCTAssertEqual(success.suggestions.first?.route.intentDebugMetadata?.intent, routedIntent)
        XCTAssertEqual(success.suggestions.first?.route.intentDebugMetadata?.parserDebugInfo, debugInfo)
    }

    func testMalformedValidatedIntentIsRecoverableWithoutGeocodingOrRouting() async {
        let prompt = "1000 km loop around Ilsenburg"
        let intent = makeIntent(
            rawPrompt: prompt,
            routeType: .loop,
            start: "Ilsenburg",
            end: nil,
            distance: 1_000
        )
        let geocoder = StubGeocodingService(coordinates: [:])
        let router = StubRoutingCoordinator(route: TestRouteFixtures.luneburgLoop)
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router,
            intentParsingProvider: FixedIntentParsingProvider(intent: intent)
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("Invalid intent must be recoverable.")
        }
        XCTAssertEqual(recovery.kind, .malformedIntent)
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertTrue(geocoder.requests.isEmpty)
        XCTAssertTrue(router.intents.isEmpty)
    }

    #if DEBUG
    func testUnavailableIntentProviderIsRecoverable() async {
        let prompt = "Ilsenburg nach Schierke"
        let geocoder = StubGeocodingService(coordinates: [:])
        let router = StubRoutingCoordinator(route: TestRouteFixtures.luneburgLoop)
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router,
            intentParsingProvider: UnavailableIntentParsingProvider()
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("Unavailable provider must be recoverable.")
        }
        XCTAssertEqual(recovery.kind, .intentUnavailable)
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertTrue(geocoder.requests.isEmpty)
        XCTAssertTrue(router.intents.isEmpty)
    }
    #endif

    func testExplicitEmptyRoutingResultEntersNoRoutes() async {
        let prompt = "Ilsenburg nach Schierke"
        let router = StubRoutingCoordinator(
            results: [.success(RoutingResult(suggestions: [], notice: nil))]
        )
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start, "Schierke": end]),
            routingCoordinator: router
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .noRoutes(recovery) = viewModel.state else {
            return XCTFail("An empty verified result must be an explicit no-routes state.")
        }
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertEqual(recovery.kind, .routing)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testUnverifiedRouteCannotReachSuccess() async {
        let prompt = "Ilsenburg nach Schierke"
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start, "Schierke": end]),
            routingCoordinator: StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("Unverified output must fail closed.")
        }
        XCTAssertEqual(recovery.kind, .unverified)
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testVerifiedActivityMismatchCannotReachSuccessEvenBesideAValidSuggestion() async {
        let prompt = "Plan a biking loop around Ilsenburg"
        let intent = makeIntent(
            rawPrompt: prompt,
            activity: .biking,
            routeType: .loop,
            start: "Ilsenburg",
            end: nil
        )
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start]),
            routingCoordinator: StubRoutingCoordinator(
                routes: [
                    verifiedRoute(activity: .biking, routeType: .loop),
                    TestRouteFixtures.sunsetRidge
                ]
            ),
            intentParsingProvider: FixedIntentParsingProvider(intent: intent)
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("A mixed-activity routed result must fail closed.")
        }
        XCTAssertEqual(recovery.kind, .unverified)
        XCTAssertEqual(recovery.stage, .preparation)
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testVerifiedRouteTypeMismatchCannotReachSuccess() async {
        let prompt = "Ilsenburg nach Schierke"
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(
                coordinates: ["Ilsenburg": start, "Schierke": end]
            ),
            routingCoordinator: StubRoutingCoordinator(route: TestRouteFixtures.luneburgLoop)
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("A loop result must not satisfy a point-to-point request.")
        }
        XCTAssertEqual(recovery.kind, .unverified)
        XCTAssertEqual(recovery.stage, .preparation)
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testGeocodingFailurePreservesPromptAndRetryUsesFreshAttemptThenSucceeds() async throws {
        let prompt = "12 km loop around Ilsenburg"
        let intent = makeIntent(
            rawPrompt: prompt,
            routeType: .loop,
            start: "Ilsenburg",
            end: nil,
            distance: 12
        )
        let geocoder = StubGeocodingService(
            outcomes: [
                "Ilsenburg": [
                    .failure(.network),
                    .success(start)
                ]
            ]
        )
        let router = StubRoutingCoordinator(route: TestRouteFixtures.luneburgLoop)
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router,
            intentParsingProvider: FixedIntentParsingProvider(intent: intent)
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("Geocoding failure must be recoverable.")
        }
        XCTAssertEqual(recovery.kind, .geocoding)
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertEqual(viewModel.prompt, prompt)
        let failedAttemptID = try XCTUnwrap(recovery.preparedAttempt?.id)

        viewModel.retryGeneration()
        guard case let .resolvingLocations(retryAttempt) = viewModel.state else {
            return XCTFail("Retry must start a fresh prepared attempt.")
        }
        XCTAssertNotEqual(retryAttempt.id, failedAttemptID)
        XCTAssertEqual(retryAttempt.originalPrompt, prompt)

        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Fresh retry must be able to succeed.")
        }
        XCTAssertEqual(success.originalPrompt, prompt)
        XCTAssertEqual(viewModel.prompt, prompt)
        XCTAssertEqual(geocoder.requests.map(\.query), ["Ilsenburg", "Ilsenburg"])
        XCTAssertEqual(router.intents.count, 1)
    }

    func testRoutingUnavailableIsRecoverableWithoutSuccess() async {
        let prompt = "Ilsenburg nach Schierke"
        let router = StubRoutingCoordinator(results: [.failure(GraphHopperError.missingAPIKey)])
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start, "Schierke": end]),
            routingCoordinator: router
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("Unavailable routing must be recoverable.")
        }
        XCTAssertEqual(recovery.kind, .routing)
        XCTAssertEqual(recovery.stage, .routing)
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testSlowIntentOperationTimesOutWithPromptPreserved() async {
        let prompt = "Ilsenburg nach Schierke"
        let intent = makeIntent(rawPrompt: prompt)
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: [:]),
            routingCoordinator: StubRoutingCoordinator(route: TestRouteFixtures.luneburgLoop),
            intentParsingProvider: SlowIntentParsingProvider(
                parserSource: .localRuleBased,
                intent: intent,
                delay: .seconds(30)
            ),
            operationTimeouts: .init(
                parserSeconds: 0.005,
                geocodingSeconds: 1,
                routingSeconds: 1
            )
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("Slow parsing must time out recoverably.")
        }
        XCTAssertEqual(recovery.kind, .timedOut)
        XCTAssertEqual(recovery.stage, .understanding)
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertEqual(viewModel.prompt, prompt)
    }

    func testCancellationIgnoringIntentOperationHardTimesOutAndLateResultIsIgnored() async {
        let prompt = "Ilsenburg nach Schierke"
        let parser = ControlledIntentParsingProvider()
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: [:]),
            routingCoordinator: StubRoutingCoordinator(route: TestRouteFixtures.luneburgLoop),
            intentParsingProvider: parser,
            operationTimeouts: .init(
                parserSeconds: 0.01,
                geocodingSeconds: 1,
                routingSeconds: 1
            )
        )

        viewModel.startPlanning(prompt: prompt)
        guard await waitUntil("cancellation-ignoring parser request", condition: { parser.prompts.count == 1 }) else {
            return
        }
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("A cancellation-ignoring parser must still time out.")
        }
        XCTAssertEqual(recovery.kind, .timedOut)
        XCTAssertEqual(recovery.originalPrompt, prompt)

        parser.succeed(requestID: 0, with: makeIntent(rawPrompt: prompt))
        guard await waitUntil(
            "late parser cleanup after timeout",
            condition: { parser.completedRequestIDs.contains(0) }
        ) else { return }
        await drainTasks()

        guard case let .recoverableError(finalRecovery) = viewModel.state else {
            return XCTFail("A late parser result overwrote the timeout recovery state.")
        }
        XCTAssertEqual(finalRecovery.kind, .timedOut)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testSlowParserDebugMetadataIsBestEffortAndCannotBlockPlanning() async {
        let prompt = "Ilsenburg nach Schierke"
        let parser = HangingDebugIntentParsingProvider(intent: makeIntent(rawPrompt: prompt))
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start, "Schierke": end]),
            routingCoordinator: StubRoutingCoordinator(
                route: verifiedRoute(routeType: .pointToPoint)
            ),
            intentParsingProvider: parser,
            operationTimeouts: .init(
                parserSeconds: 0.01,
                geocodingSeconds: 1,
                routingSeconds: 1
            )
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            parser.finishDebugInfo()
            return XCTFail("Optional parser diagnostics must not gate verified suggestions.")
        }
        XCTAssertEqual(parser.debugRequestCount, 1)
        XCTAssertEqual(success.originalPrompt, prompt)

        parser.finishDebugInfo()
        await drainTasks()
        guard case .suggestionsReady = viewModel.state else {
            return XCTFail("Late optional diagnostics changed planning state.")
        }
    }

    func testEmptyPromptIsAnExplicitRecoverableInvalidPrompt() {
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: [:]),
            routingCoordinator: StubRoutingCoordinator(route: TestRouteFixtures.luneburgLoop)
        )

        viewModel.startPlanning(prompt: "   ")

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("Empty prompt must not start an attempt.")
        }
        XCTAssertEqual(recovery.kind, .invalidPrompt)
        XCTAssertEqual(recovery.stage, .understanding)
        XCTAssertNil(viewModel.generationRequestID)
    }

    func testAllSupportedActivitiesReachRoutingWithTheirTruthfulProfiles() async {
        for activity in ActivityType.allCases {
            let prompt = "Plan a loop for \(activity.rawValue) around Ilsenburg"
            let intent = makeIntent(
                rawPrompt: prompt,
                activity: activity,
                routeType: .loop,
                start: "Ilsenburg",
                end: nil,
                distance: 10
            )
            let router = StubRoutingCoordinator(
                route: verifiedRoute(activity: activity, routeType: .loop)
            )
            let viewModel = makeViewModel(
                geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start]),
                routingCoordinator: router,
                intentParsingProvider: FixedIntentParsingProvider(intent: intent)
            )

            viewModel.startPlanning(prompt: prompt)
            await viewModel.generate()

            guard case let .suggestionsReady(success) = viewModel.state else {
                XCTFail("\(activity.rawValue) did not reach suggestions.")
                continue
            }
            XCTAssertTrue(success.suggestions.allSatisfy { suggestion in
                suggestion.route.activity == activity && suggestion.route.routeType == .loop
            })
            XCTAssertEqual(router.intents.first?.request.activityType, activity)
            XCTAssertEqual(
                router.intents.first?.request.graphHopperProfile,
                activity == .biking ? "bike" : "foot"
            )
            XCTAssertEqual(
                router.intents.first?.parsedIntent?.transportMode,
                activity == .biking ? .cycling : .walking
            )
        }
    }

    func testRequestedPreferencesRemainExplicitlyRequestedOnSuccess() async throws {
        let prompt = "Easy 14 km loop near Ilsenburg with views, forest and quiet paths"
        let intent = makeIntent(
            rawPrompt: prompt,
            routeType: .loop,
            start: "Ilsenburg",
            end: nil,
            distance: 14,
            difficulty: .easy,
            desired: [.viewpoint, .forest, .quiet],
            avoid: [.steepClimbs]
        )
        let routeWithoutRequestMetadata = TestRouteFixtures.luneburgLoop.withPlanningMetadata(nil)
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start]),
            routingCoordinator: StubRoutingCoordinator(route: routeWithoutRequestMetadata),
            intentParsingProvider: FixedIntentParsingProvider(intent: intent)
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Requested preferences must survive successful planning.")
        }
        let metadata = try XCTUnwrap(success.suggestions.first?.route.planningMetadata)
        XCTAssertEqual(metadata.desiredFeatures, [.viewpoint, .forest, .quiet])
        XCTAssertEqual(metadata.requestedFeatureSummary, "Requested: Views, Forest, Quiet route")
        XCTAssertEqual(metadata.requestedDifficultySummary, "Requested: Easy")
        XCTAssertTrue(metadata.requestedFeatureSummary?.hasPrefix("Requested:") == true)
        XCTAssertTrue(success.suggestions.first?.route.isVerifiedRoutedResult == true)
    }

    func testCancellationDuringParsingRejectsLateSuccess() async {
        let prompt = "Ilsenburg nach Schierke"
        let parser = ControlledIntentParsingProvider()
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start, "Schierke": end]),
            routingCoordinator: StubRoutingCoordinator(route: TestRouteFixtures.luneburgLoop),
            intentParsingProvider: parser
        )

        viewModel.startPlanning(prompt: prompt)
        guard await waitUntil("controlled parser request", condition: { parser.prompts.count == 1 }) else { return }
        viewModel.cancelGeneration()
        guard case let .cancelled(recovery) = viewModel.state else {
            return XCTFail("Cancellation must be observable.")
        }
        XCTAssertEqual(recovery.originalPrompt, prompt)

        parser.succeed(requestID: 0, with: makeIntent(rawPrompt: prompt))
        guard await waitUntil(
            "cancelled parser completion",
            condition: { parser.completedRequestIDs.contains(0) }
        ) else { return }
        await drainTasks()

        guard case let .cancelled(finalRecovery) = viewModel.state else {
            return XCTFail("Late parser success overwrote cancellation.")
        }
        XCTAssertEqual(finalRecovery.originalPrompt, prompt)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testCancellationDuringGeocodingRejectsLateSuccess() async {
        let prompt = "Ilsenburg nach Schierke"
        let geocoder = ControlledGeocodingService()
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: StubRoutingCoordinator(route: TestRouteFixtures.luneburgLoop),
            intentParsingProvider: FixedIntentParsingProvider(intent: makeIntent(rawPrompt: prompt))
        )

        viewModel.startPlanning(prompt: prompt)
        guard await waitUntil("controlled geocoder request", condition: { geocoder.requests.count == 1 }) else { return }
        viewModel.cancelGeneration()
        geocoder.succeed(requestID: 0, with: start)
        guard await waitUntil(
            "cancelled geocoder completion",
            condition: { geocoder.completedRequestIDs.contains(0) }
        ) else { return }
        await drainTasks()

        guard case let .cancelled(recovery) = viewModel.state else {
            return XCTFail("Late geocoding success overwrote cancellation.")
        }
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testCancellationDuringRoutingRejectsLateSuccess() async {
        let prompt = "Ilsenburg nach Schierke"
        let router = ControlledRoutingCoordinator()
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: ["Ilsenburg": start, "Schierke": end]),
            routingCoordinator: router,
            intentParsingProvider: FixedIntentParsingProvider(intent: makeIntent(rawPrompt: prompt))
        )

        viewModel.startPlanning(prompt: prompt)
        guard await waitUntil("controlled routing request", condition: { router.intents.count == 1 }) else { return }
        viewModel.cancelGeneration()
        router.succeed(requestID: 0, routes: [TestRouteFixtures.luneburgLoop])
        guard await waitUntil(
            "cancelled routing completion",
            condition: { router.completedRequestIDs.contains(0) }
        ) else { return }
        await drainTasks()

        guard case let .cancelled(recovery) = viewModel.state else {
            return XCTFail("Late routing success overwrote cancellation.")
        }
        XCTAssertEqual(recovery.originalPrompt, prompt)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testOlderRequestCompletingAfterNewerSuccessIsIgnored() async {
        let oldPrompt = "Old route from Ilsenburg to Schierke"
        let newPrompt = "New route from Lüneburg to Amelinghausen"
        let newStart = Coordinate(latitude: 53.2487, longitude: 10.4079)
        let newEnd = Coordinate(latitude: 53.1305, longitude: 10.2147)
        let parser = ControlledIntentParsingProvider()
        let router = StubRoutingCoordinator(route: verifiedRoute(routeType: .pointToPoint))
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(
                coordinates: ["Lüneburg": newStart, "Amelinghausen": newEnd]
            ),
            routingCoordinator: router,
            intentParsingProvider: parser
        )

        viewModel.startPlanning(prompt: oldPrompt)
        guard await waitUntil("old parser request", condition: { parser.prompts.count == 1 }) else { return }

        viewModel.startPlanning(prompt: newPrompt)
        guard await waitUntil("new parser request", condition: { parser.prompts.count == 2 }) else { return }
        parser.succeed(
            requestID: 1,
            with: makeIntent(
                rawPrompt: newPrompt,
                start: "Lüneburg",
                end: "Amelinghausen"
            )
        )
        await viewModel.generate()

        guard case let .suggestionsReady(newSuccess) = viewModel.state else {
            return XCTFail("New request must finish first.")
        }
        XCTAssertEqual(newSuccess.originalPrompt, newPrompt)

        parser.succeed(requestID: 0, with: makeIntent(rawPrompt: oldPrompt))
        guard await waitUntil(
            "old parser late completion",
            condition: { parser.completedRequestIDs.contains(0) }
        ) else { return }
        await drainTasks()

        guard case let .suggestionsReady(finalSuccess) = viewModel.state else {
            return XCTFail("Old completion replaced the new result.")
        }
        XCTAssertEqual(finalSuccess.originalPrompt, newPrompt)
        XCTAssertEqual(router.intents.count, 1)
        XCTAssertEqual(router.intents.first?.parsedIntent?.rawPrompt, newPrompt)
    }

    func testBroadHikingRegionsClarifyBeforeRouting() async throws {
        let cases = [
            (
                "Ich möchte eine leichte Wanderung in den Alpen.",
                "Alpen",
                "Where in the Alps should the hike start?"
            ),
            (
                "15 km Rundwanderung im Harz.",
                "Harz",
                "Where in the Harz should the hike start?"
            )
        ]

        for (prompt, query, expectedQuestion) in cases {
            let resolver = PolicyLocationResolver(candidatesByQuery: [:])
            let router = StubRoutingCoordinator(route: verifiedRoute(routeType: .loop))
            let viewModel = PlannerViewModel(
                intentParsingProvider: LocalIntentParsingProvider(),
                locationResolver: resolver,
                routingCoordinator: router
            )

            viewModel.startPlanning(prompt: prompt)
            await viewModel.generate()

            let clarification = try XCTUnwrap(viewModel.currentClarification)
            XCTAssertEqual(clarification.question, expectedQuestion)
            XCTAssertTrue(clarification.supportingText?.contains("town, valley or trailhead") == true)
            XCTAssertTrue(clarification.allowsFreeText)
            XCTAssertEqual(clarification.originalPrompt, prompt)
            XCTAssertEqual(router.intents.count, 0)
            XCTAssertEqual(resolver.contexts.count, 1)
            XCTAssertEqual(resolver.contexts.first?.originalQuery, query)
        }
    }

    func testQualifiedHikingSettlementResolvesWithoutGermanyBias() async {
        let prompt = "Easy hike near Innsbruck, Austria."
        let innsbruck = locationCandidate(
            id: "innsbruck-at",
            name: "Innsbruck",
            displayName: "Innsbruck, Tyrol, Austria",
            coordinate: Coordinate(latitude: 47.27, longitude: 11.40),
            countryCode: "AT"
        )
        let resolver = PolicyLocationResolver(candidatesByQuery: ["Innsbruck, Austria": [innsbruck]])
        let router = StubRoutingCoordinator(route: verifiedRoute(routeType: .loop))
        let viewModel = PlannerViewModel(
            intentParsingProvider: FixedIntentParsingProvider(
                intent: makeIntent(
                    rawPrompt: prompt,
                    routeType: .loop,
                    start: "Innsbruck, Austria",
                    end: nil,
                    distance: 10
                )
            ),
            locationResolver: resolver,
            routingCoordinator: router
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        XCTAssertEqual(router.intents.count, 1)
        XCTAssertEqual(router.intents.first?.start, innsbruck.coordinate)
        XCTAssertEqual(resolver.contexts.first?.explicitCountryCode, "AT")
        XCTAssertNil(resolver.contexts.first?.preferredCoordinate)
    }

    func testAmbiguousCandidateChoiceDeterministicallyResumesRouting() async throws {
        let prompt = "Wanderung bei Neustadt"
        let first = locationCandidate(
            id: "neustadt-one",
            name: "Neustadt",
            displayName: "Neustadt, Rhineland-Palatinate, Germany",
            coordinate: Coordinate(latitude: 49.35, longitude: 8.15),
            rank: 0
        )
        let selected = locationCandidate(
            id: "neustadt-two",
            name: "Neustadt",
            displayName: "Neustadt, Lower Saxony, Germany",
            coordinate: Coordinate(latitude: 52.50, longitude: 9.46),
            rank: 1
        )
        let resolver = PolicyLocationResolver(candidatesByQuery: ["Neustadt": [first, selected]])
        let router = StubRoutingCoordinator(route: verifiedRoute(routeType: .loop))
        let viewModel = PlannerViewModel(
            intentParsingProvider: FixedIntentParsingProvider(
                intent: makeIntent(
                    rawPrompt: prompt,
                    routeType: .loop,
                    start: "Neustadt",
                    end: nil,
                    distance: 10
                )
            ),
            locationResolver: resolver,
            routingCoordinator: router
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        let clarification = try XCTUnwrap(viewModel.currentClarification)
        XCTAssertEqual(clarification.locationCandidates.map(\.id), [first.id, selected.id])
        XCTAssertEqual(router.intents.count, 0)

        viewModel.submitClarification(.locationCandidate(selected))
        await viewModel.generate()

        XCTAssertEqual(router.intents.count, 1)
        XCTAssertEqual(router.intents.first?.start, selected.coordinate)
        XCTAssertEqual(resolver.contexts.count, 1, "An explicit candidate must not be silently re-geocoded.")
        guard case .suggestionsReady = viewModel.state else {
            return XCTFail("Selected location should resume the existing routing pipeline.")
        }
    }

    func testDestinationResolutionUsesResolvedStartOnlyAsSoftHint() async {
        let prompt = "Plan a hike from Ilsenburg to Schierke."
        let ilsenburg = locationCandidate(
            id: "ilsenburg",
            name: "Ilsenburg",
            displayName: "Ilsenburg, Saxony-Anhalt, Germany",
            coordinate: start
        )
        let schierke = locationCandidate(
            id: "schierke",
            name: "Schierke",
            displayName: "Schierke, Saxony-Anhalt, Germany",
            coordinate: end
        )
        let resolver = PolicyLocationResolver(
            candidatesByQuery: ["Ilsenburg": [ilsenburg], "Schierke": [schierke]]
        )
        let router = StubRoutingCoordinator(route: verifiedRoute(routeType: .pointToPoint))
        let viewModel = PlannerViewModel(
            intentParsingProvider: FixedIntentParsingProvider(intent: makeIntent(rawPrompt: prompt)),
            locationResolver: resolver,
            routingCoordinator: router
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        XCTAssertEqual(resolver.contexts.count, 2)
        XCTAssertNil(resolver.contexts[0].preferredCoordinate)
        XCTAssertEqual(resolver.contexts[1].requestedField, .endLocationQuery)
        XCTAssertEqual(resolver.contexts[1].preferredCoordinate, start)
        XCTAssertEqual(router.intents.first?.end, end)
    }

    func testRoutingRetryPreservesExplicitCandidateChoice() async throws {
        let prompt = "Wanderung bei Neustadt"
        let first = locationCandidate(
            id: "neustadt-one",
            name: "Neustadt",
            displayName: "Neustadt, Rhineland-Palatinate, Germany",
            coordinate: Coordinate(latitude: 49.35, longitude: 8.15),
            rank: 0
        )
        let selected = locationCandidate(
            id: "neustadt-two",
            name: "Neustadt",
            displayName: "Neustadt, Lower Saxony, Germany",
            coordinate: Coordinate(latitude: 52.50, longitude: 9.46),
            rank: 1
        )
        let resolver = PolicyLocationResolver(candidatesByQuery: ["Neustadt": [first, selected]])
        let router = StubRoutingCoordinator(
            results: [
                .failure(GraphHopperError.network(message: "offline")),
                .success(
                    RoutingResult(
                        suggestions: RouteSuggestionNormalizer.suggestions(
                            from: [verifiedRoute(routeType: .loop)]
                        ),
                        notice: nil
                    )
                )
            ]
        )
        let viewModel = PlannerViewModel(
            intentParsingProvider: FixedIntentParsingProvider(
                intent: makeIntent(
                    rawPrompt: prompt,
                    routeType: .loop,
                    start: "Neustadt",
                    end: nil
                )
            ),
            locationResolver: resolver,
            routingCoordinator: router
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()
        viewModel.submitClarification(.locationCandidate(selected))
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("First routing attempt should fail recoverably.")
        }
        XCTAssertEqual(recovery.preparedAttempt?.selectedLocations[.startLocationQuery], selected)

        viewModel.retryGeneration()
        await viewModel.generate()

        XCTAssertEqual(router.intents.count, 2)
        XCTAssertTrue(router.intents.allSatisfy { $0.start == selected.coordinate })
        XCTAssertEqual(resolver.contexts.count, 1, "Retry must reuse the explicit location choice.")
        guard case .suggestionsReady = viewModel.state else {
            return XCTFail("Retry should finish with the preserved location.")
        }
    }

    func testNoRoutesRetryPreservesExplicitCandidateChoice() async throws {
        let prompt = "Wanderung bei Neustadt"
        let first = locationCandidate(
            id: "neustadt-one",
            name: "Neustadt",
            displayName: "Neustadt, Rhineland-Palatinate, Germany",
            coordinate: Coordinate(latitude: 49.35, longitude: 8.15),
            rank: 0
        )
        let selected = locationCandidate(
            id: "neustadt-two",
            name: "Neustadt",
            displayName: "Neustadt, Lower Saxony, Germany",
            coordinate: Coordinate(latitude: 52.50, longitude: 9.46),
            rank: 1
        )
        let resolver = PolicyLocationResolver(candidatesByQuery: ["Neustadt": [first, selected]])
        let router = StubRoutingCoordinator(
            results: [
                .success(RoutingResult(suggestions: [], notice: nil)),
                .success(
                    RoutingResult(
                        suggestions: RouteSuggestionNormalizer.suggestions(
                            from: [verifiedRoute(routeType: .loop)]
                        ),
                        notice: nil
                    )
                )
            ]
        )
        let viewModel = PlannerViewModel(
            intentParsingProvider: FixedIntentParsingProvider(
                intent: makeIntent(
                    rawPrompt: prompt,
                    routeType: .loop,
                    start: "Neustadt",
                    end: nil
                )
            ),
            locationResolver: resolver,
            routingCoordinator: router
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()
        viewModel.submitClarification(.locationCandidate(selected))
        await viewModel.generate()

        guard case let .noRoutes(recovery) = viewModel.state else {
            return XCTFail("The first routing result should expose no-route recovery.")
        }
        XCTAssertEqual(recovery.preparedAttempt?.selectedLocations[.startLocationQuery], selected)

        viewModel.retryGeneration()
        await viewModel.generate()

        XCTAssertEqual(router.intents.count, 2)
        XCTAssertTrue(router.intents.allSatisfy { $0.start == selected.coordinate })
        XCTAssertEqual(resolver.contexts.count, 1, "No-route retry must reuse the explicit location choice.")
        guard case .suggestionsReady = viewModel.state else {
            return XCTFail("No-route retry should finish with the preserved location.")
        }
    }

    func testEveryHomeExampleUsesTheSameRealCoordinator() async {
        let coordinates = [
            "Ilsenburg": start,
            "Schierke": end,
            "Lüneburg": Coordinate(latitude: 53.2487, longitude: 10.4079),
            "Amelinghausen": Coordinate(latitude: 53.1305, longitude: 10.2147)
        ]

        for example in HomeView.routeExamples {
            let matchingRoute: TrailRoute
            switch example.id {
            case "loop":
                matchingRoute = verifiedRoute(routeType: .loop)
            case "pointToPoint":
                matchingRoute = verifiedRoute(routeType: .pointToPoint)
            case "trailRun":
                matchingRoute = verifiedRoute(activity: .trailRunning, routeType: .loop)
            case "bike":
                matchingRoute = verifiedRoute(activity: .biking, routeType: .pointToPoint)
            default:
                XCTFail("Add a semantically matching fixture for \(example.id).")
                continue
            }
            let router = StubRoutingCoordinator(route: matchingRoute)
            let viewModel = makeViewModel(
                geocodingService: StubGeocodingService(coordinates: coordinates),
                routingCoordinator: router
            )

            viewModel.startPlanning(prompt: example.prompt)
            await viewModel.generate()

            XCTAssertEqual(router.intents.count, 1, "Example did not reach routing: \(example.title)")
            guard case let .suggestionsReady(success) = viewModel.state else {
                XCTFail("Example did not reach verified suggestions: \(example.title)")
                continue
            }
            XCTAssertEqual(success.originalPrompt, example.prompt)
            XCTAssertTrue(success.suggestions.allSatisfy { $0.route.isVerifiedRoutedResult })
        }
    }
}
