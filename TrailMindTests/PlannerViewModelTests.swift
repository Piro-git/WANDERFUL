import XCTest
@testable import TrailMind

@MainActor
private final class StubGeocodingService: GeocodingService {
    struct Request {
        let query: String
        let preferredCoordinate: Coordinate?
    }

    var requests: [Request] = []
    var coordinates: [String: Coordinate]

    init(coordinates: [String: Coordinate]) {
        self.coordinates = coordinates
    }

    func geocodeLocation(_ query: String, near preferredCoordinate: Coordinate?) async throws -> Coordinate {
        requests.append(Request(query: query, preferredCoordinate: preferredCoordinate))
        guard let coordinate = coordinates[query] else {
            throw GeocodingServiceError.noResults(query: query)
        }
        return coordinate
    }
}

@MainActor
private final class StubRoutingCoordinator: RoutingCoordinating {
    var intent: RouteIntent?
    var result: Result<RoutingResult, Error>

    init(result: Result<RoutingResult, Error>) {
        self.result = result
    }

    convenience init(route: TrailRoute) {
        self.init(
            result: .success(
                RoutingResult(
                    suggestions: RouteSuggestionNormalizer.suggestions(from: [route]),
                    notice: nil
                )
            )
        )
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> RoutingResult {
        self.intent = intent
        return try result.get()
    }
}

private struct FixedIntentParsingProvider: IntentParsingProvider {
    let parserSource: IntentParserSource
    let intent: AdventureIntent

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        intent
    }
}

private struct DelayedIntentParsingProvider: IntentParsingProvider {
    let parserSource: IntentParserSource = .localRuleBased
    let delay: Duration
    let ignoresCancellation: Bool

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        do {
            try await Task.sleep(for: delay)
        } catch {
            if !ignoresCancellation { throw error }
        }
        return try await LocalIntentParsingProvider().parseIntent(rawPrompt: rawPrompt)
    }
}

@MainActor
private final class DelayedRoutingCoordinator: RoutingCoordinating {
    let delay: Duration
    let ignoresCancellation: Bool
    let result: RoutingResult
    private(set) var didStart = false

    init(delay: Duration, ignoresCancellation: Bool, route: TrailRoute) {
        self.delay = delay
        self.ignoresCancellation = ignoresCancellation
        result = RoutingResult(
            suggestions: RouteSuggestionNormalizer.suggestions(from: [route]),
            notice: nil
        )
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> RoutingResult {
        didStart = true
        do {
            try await Task.sleep(for: delay)
        } catch {
            if !ignoresCancellation { throw error }
        }
        return result
    }
}

@MainActor
private final class DelayedGeocodingService: GeocodingService {
    let delay: Duration
    let coordinate: Coordinate

    init(delay: Duration, coordinate: Coordinate) {
        self.delay = delay
        self.coordinate = coordinate
    }

    func geocodeLocation(_ query: String, near preferredCoordinate: Coordinate?) async throws -> Coordinate {
        try await Task.sleep(for: delay)
        return coordinate
    }
}

final class PlannerViewModelTests: XCTestCase {
    @MainActor
    private func makeViewModel(
        geocodingService: any GeocodingService,
        routingCoordinator: any RoutingCoordinating,
        intentParsingProvider: any IntentParsingProvider = LocalIntentParsingProvider(),
        operationTimeouts: PlannerViewModel.OperationTimeouts = .production
    ) -> PlannerViewModel {
        PlannerViewModel(
            intentParsingProvider: intentParsingProvider,
            geocodingService: geocodingService,
            routingCoordinator: routingCoordinator,
            operationTimeouts: operationTimeouts
        )
    }

    @MainActor
    func testGenerationStartsWithOnlyUnderstandingActive() {
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: [:]),
            routingCoordinator: StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        )

        viewModel.startTextRoute(prompt: "Ilsenburg nach Schierke")

        XCTAssertEqual(viewModel.generationStages.map(\.status), [
            .active,
            .pending,
            .pending,
            .pending
        ])
        XCTAssertEqual(viewModel.completedGenerationStageCount, 0)
    }

    @MainActor
    func testCompletedParsingActivatesLocationWithoutMarkingItCompleted() async {
        let viewModel = makeViewModel(
            geocodingService: DelayedGeocodingService(
                delay: .seconds(5),
                coordinate: Coordinate(latitude: 51.8666, longitude: 10.6782)
            ),
            routingCoordinator: StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        )
        viewModel.startTextRoute(prompt: "15 km Rundwanderung um Ilsenburg")

        let task = Task { await viewModel.generate() }
        try? await Task.sleep(for: .milliseconds(80))

        XCTAssertEqual(viewModel.generationStages.map(\.status), [
            .completed,
            .active,
            .pending,
            .pending
        ])
        viewModel.cancelGeneration()
        task.cancel()
        await task.value
    }

    @MainActor
    func testCancellationBeforeParsingCompletesReturnsHome() async {
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: [:]),
            routingCoordinator: StubRoutingCoordinator(route: MockRoutes.luneburgLoop),
            intentParsingProvider: DelayedIntentParsingProvider(
                delay: .seconds(5),
                ignoresCancellation: false
            )
        )
        viewModel.startTextRoute(prompt: "Ilsenburg nach Schierke")

        let task = Task { await viewModel.generate() }
        try? await Task.sleep(for: .milliseconds(30))
        viewModel.cancelGeneration()
        task.cancel()
        await task.value

        XCTAssertEqual(viewModel.phase, .home)
        XCTAssertNil(viewModel.generatedRoute)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
        XCTAssertNil(viewModel.generationFailure)
    }

    @MainActor
    func testCancellationDuringRoutingReturnsHome() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let end = Coordinate(latitude: 51.7636, longitude: 10.6647)
        let router = DelayedRoutingCoordinator(
            delay: .seconds(5),
            ignoresCancellation: false,
            route: MockRoutes.luneburgLoop
        )
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(
                coordinates: ["Ilsenburg": start, "Schierke": end]
            ),
            routingCoordinator: router
        )
        viewModel.startTextRoute(prompt: "Ilsenburg nach Schierke")

        let task = Task { await viewModel.generate() }
        for _ in 0..<20 where !router.didStart {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(router.didStart)
        viewModel.cancelGeneration()
        task.cancel()
        await task.value

        XCTAssertEqual(viewModel.phase, .home)
        XCTAssertNil(viewModel.generatedRoute)
    }

    @MainActor
    func testLateRoutingResultIsIgnoredAfterCancellation() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let end = Coordinate(latitude: 51.7636, longitude: 10.6647)
        let router = DelayedRoutingCoordinator(
            delay: .milliseconds(80),
            ignoresCancellation: true,
            route: MockRoutes.luneburgLoop
        )
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(
                coordinates: ["Ilsenburg": start, "Schierke": end]
            ),
            routingCoordinator: router
        )
        viewModel.startTextRoute(prompt: "Ilsenburg nach Schierke")

        let task = Task { await viewModel.generate() }
        for _ in 0..<20 where !router.didStart {
            try? await Task.sleep(for: .milliseconds(10))
        }
        viewModel.cancelGeneration()
        await task.value

        XCTAssertEqual(viewModel.phase, .home)
        XCTAssertNil(viewModel.generatedRoute)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    @MainActor
    func testRetryPreservesPromptAndStartsNewRequest() async {
        let prompt = "Ilsenburg nach Schierke"
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: [:]),
            routingCoordinator: StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        )
        viewModel.startTextRoute(prompt: prompt)
        await viewModel.generate()
        let failedRequestID = viewModel.generationRequestID

        XCTAssertNotNil(viewModel.generationFailure)
        viewModel.retryGeneration()

        XCTAssertEqual(viewModel.prompt, prompt)
        XCTAssertNotEqual(viewModel.generationRequestID, failedRequestID)
        XCTAssertNil(viewModel.generationFailure)
        XCTAssertEqual(viewModel.generationStages.first?.status, .active)
    }

    @MainActor
    func testParserTimeoutShowsActionableRecovery() async {
        let prompt = "Ilsenburg nach Schierke"
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: [:]),
            routingCoordinator: StubRoutingCoordinator(route: MockRoutes.luneburgLoop),
            intentParsingProvider: DelayedIntentParsingProvider(
                delay: .seconds(5),
                ignoresCancellation: false
            ),
            operationTimeouts: .init(parserSeconds: 0.01, geocodingSeconds: 1)
        )
        viewModel.startTextRoute(prompt: prompt)

        await viewModel.generate()

        XCTAssertEqual(viewModel.phase, .generating)
        XCTAssertEqual(viewModel.generationFailure?.stage, .understanding)
        XCTAssertEqual(
            viewModel.generationFailure?.message,
            "This route is taking longer than expected. Try again, shorten the distance, or choose a nearby trailhead."
        )
        XCTAssertEqual(viewModel.prompt, prompt)
    }

    @MainActor
    func testRoutingTimeoutUsesActionableRecoveryCopy() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let end = Coordinate(latitude: 51.7636, longitude: 10.6647)
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(
                coordinates: ["Ilsenburg": start, "Schierke": end]
            ),
            routingCoordinator: StubRoutingCoordinator(
                result: .failure(GraphHopperError.network(message: "The request timed out."))
            )
        )
        viewModel.startTextRoute(prompt: "Ilsenburg nach Schierke")

        await viewModel.generate()

        XCTAssertEqual(viewModel.generationFailure?.stage, .routing)
        XCTAssertEqual(
            viewModel.generationFailure?.message,
            "This route is taking longer than expected. Try again, shorten the distance, or choose a nearby trailhead."
        )
    }

    @MainActor
    func testEmptyPromptReturnsFriendlyHomeError() {
        let viewModel = makeViewModel(
            geocodingService: StubGeocodingService(coordinates: [:]),
            routingCoordinator: StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        )

        viewModel.startTextRoute(prompt: "   ")

        XCTAssertEqual(viewModel.phase, .home)
        XCTAssertEqual(
            viewModel.errorMessage,
            "Describe where you want to go and what kind of route you want."
        )
        XCTAssertNil(viewModel.generationRequestID)
    }

    @MainActor
    func testTextRouteOrchestratesParsingGeocodingAndRouting() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let end = Coordinate(latitude: 51.7636, longitude: 10.6647)
        let geocoder = StubGeocodingService(
            coordinates: [
                "Ilsenburg": start,
                "Schierke": end
            ]
        )
        let expectedRoute = MockRoutes.luneburgLoop
        let router = StubRoutingCoordinator(route: expectedRoute)
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router
        )

        viewModel.startTextRoute(prompt: "Ilsenburg nach Schierke")
        await viewModel.generate()

        XCTAssertEqual(viewModel.phase, .home)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertEqual(viewModel.generatedRoute?.id, expectedRoute.id)
        XCTAssertEqual(geocoder.requests.map(\.query), ["Ilsenburg", "Schierke"])
        XCTAssertNil(geocoder.requests.first?.preferredCoordinate)
        XCTAssertEqual(geocoder.requests.last?.preferredCoordinate, start)
        XCTAssertEqual(router.intent?.start, start)
        XCTAssertEqual(router.intent?.end, end)
        XCTAssertEqual(router.intent?.request.graphHopperProfile, "foot")
        XCTAssertEqual(router.intent?.request.startQuery, "Ilsenburg")
        XCTAssertEqual(router.intent?.request.endQuery, "Schierke")
        XCTAssertEqual(router.intent?.request.activityType, .hiking)
        XCTAssertEqual(router.intent?.parsedIntent?.rawPrompt, "Ilsenburg nach Schierke")
        XCTAssertEqual(router.intent?.parsedIntent?.parserSource, .localRuleBased)
        XCTAssertEqual(router.intent?.parsedIntent?.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(router.intent?.parsedIntent?.endLocationQuery, "Schierke")
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.intent.rawPrompt, "Ilsenburg nach Schierke")
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.intent.parserSource, .localRuleBased)
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.validationStatus, "valid")
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.localFallbackUsed, true)
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.repaired, false)
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.geocodedStartLabel, "Ilsenburg")
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.geocodedEndLabel, "Schierke")
    }

    @MainActor
    func testIntentHintsMapIntoPlanningRequest() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let end = Coordinate(latitude: 51.7636, longitude: 10.6647)
        let geocoder = StubGeocodingService(
            coordinates: [
                "Ilsenburg": start,
                "Schierke": end
            ]
        )
        let router = StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router
        )

        viewModel.startTextRoute(prompt: "Plane eine schöne Wanderung von Ilsenburg nach Schierke mit Aussicht, ca. 15 km")
        await viewModel.generate()

        XCTAssertEqual(router.intent?.request.targetDistanceKm, 15)
        XCTAssertEqual(router.intent?.request.desiredFeatures, [.viewpoint])
        XCTAssertEqual(router.intent?.request.graphHopperProfile, "foot")
    }

    @MainActor
    func testBikePromptUsesBikeProfile() async {
        let start = Coordinate(latitude: 53.2487, longitude: 10.4079)
        let end = Coordinate(latitude: 53.1305, longitude: 10.2147)
        let geocoder = StubGeocodingService(
            coordinates: [
                "Lüneburg": start,
                "Amelinghausen": end
            ]
        )
        let router = StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router
        )

        viewModel.startTextRoute(prompt: "Radroute von Lüneburg nach Amelinghausen")
        await viewModel.generate()

        XCTAssertEqual(router.intent?.request.activityType, .biking)
        XCTAssertEqual(router.intent?.request.graphHopperProfile, "bike")
    }

    @MainActor
    func testTrailRunPromptUsesFootProfileWithTrailRunActivity() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let end = Coordinate(latitude: 51.7636, longitude: 10.6647)
        let geocoder = StubGeocodingService(
            coordinates: [
                "Ilsenburg": start,
                "Schierke": end
            ]
        )
        let router = StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router
        )

        viewModel.startTextRoute(prompt: "Trailrun from Ilsenburg to Schierke for 2 hours")
        await viewModel.generate()

        XCTAssertEqual(router.intent?.request.activityType, .trailRunning)
        XCTAssertEqual(router.intent?.request.graphHopperProfile, "foot")
        XCTAssertEqual(router.intent?.request.targetDurationMinutes, 120)
    }

    @MainActor
    func testLoopPromptGeocodesStartOnlyAndCallsRoundTrip() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let geocoder = StubGeocodingService(
            coordinates: [
                "Ilsenburg": start
            ]
        )
        let router = StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router
        )

        viewModel.startTextRoute(prompt: "15 km Rundwanderung um Ilsenburg")
        await viewModel.generate()

        XCTAssertEqual(geocoder.requests.map(\.query), ["Ilsenburg"])
        XCTAssertEqual(router.intent?.start, start)
        XCTAssertNil(router.intent?.end)
        XCTAssertEqual(router.intent?.request.routeType, .loop)
        XCTAssertEqual(router.intent?.request.startQuery, "Ilsenburg")
        XCTAssertNil(router.intent?.request.endQuery)
        XCTAssertEqual(router.intent?.request.targetDistanceKm, 15)
        XCTAssertEqual(router.intent?.parsedIntent?.routeType, .loop)
        XCTAssertEqual(router.intent?.parsedIntent?.startOrRegionQuery, "Ilsenburg")
    }

    @MainActor
    func testRepairedRemoteLoopIntentRoutesThroughExistingCoordinator() async {
        let start = Coordinate(latitude: 51.765, longitude: 10.664)
        let geocoder = StubGeocodingService(
            coordinates: [
                "Schierke": start
            ]
        )
        let route = MockRoutes.luneburgLoop
        let router = StubRoutingCoordinator(route: route)
        let remoteIntent = AdventureIntent(
            rawPrompt: "Ich will eine entspannte 15 km Rundwanderung um Schierke",
            parserSource: .remoteAI,
            confidence: 0.78,
            activityType: .hiking,
            routeType: .pointToPoint,
            startLocationQuery: "Schierke",
            endLocationQuery: nil,
            regionQuery: nil,
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: .easy,
            desiredFeatures: [],
            avoidFeatures: []
        )
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router,
            intentParsingProvider: FixedIntentParsingProvider(
                parserSource: .remoteAI,
                intent: remoteIntent
            )
        )

        viewModel.startTextRoute(prompt: remoteIntent.rawPrompt)
        await viewModel.generate()

        XCTAssertEqual(viewModel.phase, .home)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertEqual(geocoder.requests.map(\.query), ["Schierke"])
        XCTAssertEqual(router.intent?.request.routeType, .loop)
        XCTAssertEqual(router.intent?.request.startQuery, "Schierke")
        XCTAssertNil(router.intent?.request.endQuery)
        XCTAssertEqual(router.intent?.request.targetDistanceKm, 15)
        XCTAssertEqual(router.intent?.parsedIntent?.parserSource, .remoteAI)
        XCTAssertEqual(router.intent?.parsedIntent?.routeType, .loop)
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.validationStatus, "repaired")
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.localFallbackUsed, false)
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.repaired, true)
        XCTAssertEqual(
            viewModel.generatedRoute?.intentDebugMetadata?.repairReason,
            "Repaired pointToPoint intent without an end location to loop based on loop wording."
        )
    }

    @MainActor
    func testMultipleLoopVariantsShowSuggestions() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let geocoder = StubGeocodingService(
            coordinates: [
                "Ilsenburg": start
            ]
        )
        let first = MockRoutes.luneburgLoop.withPlanningMetadata(
            RoutePlanningMetadata(
                routeType: .loop,
                activityType: .hiking,
                targetDistanceKm: 15,
                targetDurationMinutes: nil,
                difficulty: nil,
                desiredFeatures: [],
                avoidFeatures: [],
                seed: 11,
                variantLabel: "Closest Match"
            )
        )
        let second = MockRoutes.sunsetRidge.withPlanningMetadata(
            RoutePlanningMetadata(
                routeType: .loop,
                activityType: .hiking,
                targetDistanceKm: 15,
                targetDurationMinutes: nil,
                difficulty: nil,
                desiredFeatures: [],
                avoidFeatures: [],
                seed: 29,
                variantLabel: "Shorter Loop"
            )
        )
        let router = StubRoutingCoordinator(
            result: .success(
                RoutingResult(
                    suggestions: RouteSuggestionNormalizer.suggestions(from: [first, second]),
                    notice: nil
                )
            )
        )
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router
        )

        viewModel.startTextRoute(prompt: "15 km Rundwanderung um Ilsenburg")
        await viewModel.generate()

        XCTAssertEqual(viewModel.phase, .suggestions)
        XCTAssertNil(viewModel.generatedRoute)
        XCTAssertEqual(viewModel.suggestions.map(\.route.id), [first.id, second.id])
        XCTAssertEqual(viewModel.suggestions.first?.explanation, "Closest Match")
        XCTAssertEqual(viewModel.suggestions.first?.route.intentDebugMetadata?.intent.routeType, .loop)
        XCTAssertEqual(viewModel.suggestions.first?.route.intentDebugMetadata?.geocodedStartLabel, "Ilsenburg")
    }

    @MainActor
    func testSingleLoopVariantStillOpensDetailDirectly() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let geocoder = StubGeocodingService(
            coordinates: [
                "Ilsenburg": start
            ]
        )
        let route = MockRoutes.luneburgLoop
        let router = StubRoutingCoordinator(
            result: .success(
                RoutingResult(
                    suggestions: RouteSuggestionNormalizer.suggestions(from: [route]),
                    notice: nil,
                    loopSearchOutcome: .singleRoute,
                    loopSearchDiagnostics: LoopSearchDiagnostics(
                        elapsedMilliseconds: 2_500,
                        directRouteCount: 1,
                        fallbackRouteCount: 0,
                        rejectionCounts: ["duplicate_geometry": 2],
                        didReachTimeBudget: false
                    )
                )
            )
        )
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router
        )

        viewModel.startTextRoute(prompt: "15 km Rundwanderung um Ilsenburg")
        await viewModel.generate()

        XCTAssertEqual(viewModel.phase, .home)
        XCTAssertEqual(viewModel.generatedRoute?.id, route.id)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
        XCTAssertEqual(viewModel.generatedRoute?.planningMetadata?.loopSearchOutcome, .singleRoute)
        XCTAssertEqual(viewModel.generatedRoute?.intentDebugMetadata?.loopSearchDiagnostics?.directRouteCount, 1)
    }

    @MainActor
    func testCoordinatorNoticeShowsOnLoopFallbackSuggestions() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let geocoder = StubGeocodingService(
            coordinates: [
                "Ilsenburg": start
            ]
        )
        let route = MockRoutes.luneburgLoop
        let router = StubRoutingCoordinator(
            result: .success(
                RoutingResult(
                    suggestions: RouteSuggestionNormalizer.suggestions(from: [route, MockRoutes.sunsetRidge]),
                    notice: "GraphHopper round trips need flexible mode on this API plan, so TrailMind built loop options from normal routed segments."
                )
            )
        )
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router
        )

        viewModel.startTextRoute(prompt: "15 km Rundwanderung um Ilsenburg")
        await viewModel.generate()

        XCTAssertEqual(viewModel.phase, .suggestions)
        XCTAssertNil(viewModel.generatedRoute)
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertEqual(viewModel.suggestions.count, 2)
        XCTAssertEqual(
            viewModel.suggestionNotice,
            "GraphHopper round trips need flexible mode on this API plan, so TrailMind built loop options from normal routed segments."
        )
    }

    @MainActor
    func testInvalidPromptStopsBeforeGeocoding() async {
        let geocoder = StubGeocodingService(coordinates: [:])
        let router = StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router
        )

        viewModel.startTextRoute(prompt: "mach mir was schönes")
        await viewModel.generate()

        XCTAssertEqual(viewModel.phase, .generating)
        XCTAssertEqual(
            viewModel.generationFailure?.message,
            "Which area should I plan around?"
        )
        XCTAssertEqual(viewModel.generationFailure?.stage, .understanding)
        XCTAssertTrue(geocoder.requests.isEmpty)
        XCTAssertNil(router.intent)
    }

    @MainActor
    func testPointToPointWithoutEndShowsContextualDestinationQuestion() async {
        let geocoder = StubGeocodingService(coordinates: [:])
        let router = StubRoutingCoordinator(route: MockRoutes.luneburgLoop)
        let remoteIntent = AdventureIntent(
            rawPrompt: "Plan a route from Ilsenburg to",
            parserSource: .remoteAI,
            confidence: 0.52,
            activityType: .hiking,
            routeType: .pointToPoint,
            startLocationQuery: "Ilsenburg",
            endLocationQuery: nil,
            regionQuery: nil,
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: []
        )
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router,
            intentParsingProvider: FixedIntentParsingProvider(
                parserSource: .remoteAI,
                intent: remoteIntent
            )
        )

        viewModel.startTextRoute(prompt: remoteIntent.rawPrompt)
        await viewModel.generate()

        XCTAssertEqual(viewModel.phase, .generating)
        XCTAssertEqual(viewModel.generationFailure?.message, "Where do you want to go?")
        XCTAssertTrue(geocoder.requests.isEmpty)
        XCTAssertNil(router.intent)
    }

    @MainActor
    func testRoutingFailureReturnsFriendlyErrorWithoutRoute() async {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let end = Coordinate(latitude: 51.7636, longitude: 10.6647)
        let geocoder = StubGeocodingService(
            coordinates: [
                "Ilsenburg": start,
                "Schierke": end
            ]
        )
        let router = StubRoutingCoordinator(
            result: .failure(GraphHopperError.missingAPIKey)
        )
        let viewModel = makeViewModel(
            geocodingService: geocoder,
            routingCoordinator: router
        )

        viewModel.startTextRoute(prompt: "Ilsenburg nach Schierke")
        await viewModel.generate()

        XCTAssertEqual(viewModel.phase, .generating)
        XCTAssertNil(viewModel.generatedRoute)
        XCTAssertEqual(
            viewModel.generationFailure?.message,
            "Live routing isn’t configured yet. Try again after routing setup is complete."
        )
    }
}
