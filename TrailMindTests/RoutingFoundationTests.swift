import XCTest
@testable import TrailMind

private final class StubRoutingProvider: RoutingProvider {
    var requestedIntents: [RouteIntent] = []
    var result: Result<[RouteSuggestion], Error>

    init(result: Result<[RouteSuggestion], Error>) {
        self.result = result
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> [RouteSuggestion] {
        requestedIntents.append(intent)
        return try result.get()
    }
}

private final class StubMultiPointClient: GraphHopperMultiPointRouteCalculating {
    var requests: [(waypoints: [Coordinate], request: RoutePlanningRequest, seed: Int?)] = []
    var results: [Result<TrailRoute, Error>]

    init(results: [Result<TrailRoute, Error>]) {
        self.results = results
    }

    func calculateGraphHopperRoute(
        waypoints: [Coordinate],
        request: RoutePlanningRequest,
        seed: Int?
    ) async throws -> TrailRoute {
        requests.append((waypoints, request, seed))
        guard !results.isEmpty else {
            throw GraphHopperError.noRouteFound
        }
        return try results.removeFirst().get()
    }
}

@MainActor
final class RoutingFoundationTests: XCTestCase {
    func testFlexibleModeErrorDetectionMatchesFreePlanMessage() {
        let error = GraphHopperError.api(
            statusCode: 400,
            message: "Free packages cannot use flexible mode",
            hints: []
        )

        XCTAssertTrue(error.isFlexibleModeUnavailable)
    }

    func testPointToPointRoutePathDoesNotUseLoopFallback() async throws {
        let expected = RouteSuggestionNormalizer.suggestions(from: [Self.route(distanceKm: 9)])[0]
        let primary = StubRoutingProvider(result: .success([expected]))
        let fallback = StubRoutingProvider(result: .success([]))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        let result = try await coordinator.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .pointToPoint, endQuery: "Schierke"),
                start: Self.start,
                end: Self.end
            )
        )

        XCTAssertEqual(result.suggestions, [expected])
        XCTAssertEqual(primary.requestedIntents.count, 1)
        XCTAssertTrue(fallback.requestedIntents.isEmpty)
        XCTAssertNil(result.notice)
    }

    func testLoopFallbackIsTriggeredOnlyForLoopFlexibleModeError() async throws {
        let fallbackSuggestion = RouteSuggestionNormalizer.suggestions(from: [Self.route(distanceKm: 15)])[0]
        let primary = StubRoutingProvider(
            result: .failure(
                GraphHopperError.api(
                    statusCode: 400,
                    message: "Free packages cannot use flexible mode",
                    hints: []
                )
            )
        )
        let fallback = StubRoutingProvider(result: .success([fallbackSuggestion]))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        let result = try await coordinator.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(result.suggestions, [fallbackSuggestion])
        XCTAssertEqual(fallback.requestedIntents.count, 1)
        XCTAssertNotNil(result.notice)
    }

    func testPointToPointFlexibleModeErrorDoesNotUseLoopFallback() async {
        let primary = StubRoutingProvider(
            result: .failure(
                GraphHopperError.api(
                    statusCode: 400,
                    message: "Free packages cannot use flexible mode",
                    hints: []
                )
            )
        )
        let fallback = StubRoutingProvider(result: .success(RouteSuggestionNormalizer.suggestions(from: [Self.route(distanceKm: 15)])))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        do {
            _ = try await coordinator.routeSuggestions(
                for: RouteIntent(
                    request: Self.request(routeType: .pointToPoint, endQuery: "Schierke"),
                    start: Self.start,
                    end: Self.end
                )
            )
            XCTFail("Expected the point-to-point flexible-mode error to be rethrown.")
        } catch let error as GraphHopperError {
            XCTAssertTrue(error.isFlexibleModeUnavailable)
            XCTAssertTrue(fallback.requestedIntents.isEmpty)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testViaPointCandidateGenerationCreatesClosedMultiPointLoops() {
        let candidates = LoopFallbackProvider.makeCandidates(
            start: Self.start,
            targetDistanceKm: 15,
            seeds: [11, 29, 47]
        )

        XCTAssertEqual(candidates.count, 3)
        XCTAssertEqual(candidates.map(\.seed), [11, 29, 47])
        XCTAssertTrue(candidates.allSatisfy { $0.waypoints.first == Self.start })
        XCTAssertTrue(candidates.allSatisfy { $0.waypoints.last == Self.start })
        XCTAssertTrue(candidates.allSatisfy { $0.waypoints.count >= 4 })
    }

    func testRouteSuggestionNormalizationUsesVariantLabel() {
        let route = Self.route(distanceKm: 15).withPlanningMetadata(
            Self.request(routeType: .loop, endQuery: nil).metadata.withVariant(
                seed: 11,
                label: "Closest Match"
            )
        )

        let suggestion = RouteSuggestionNormalizer.suggestions(from: [route])[0]

        XCTAssertEqual(suggestion.route, route)
        XCTAssertEqual(suggestion.matchScore, 96)
        XCTAssertEqual(suggestion.explanation, "Closest Match")
    }

    func testDuplicateFallbackCandidatesAreRejected() async throws {
        let duplicateRoute = Self.route(distanceKm: 15)
        let client = StubMultiPointClient(
            results: [
                .success(duplicateRoute),
                .success(duplicateRoute),
                .success(duplicateRoute)
            ]
        )
        let provider = LoopFallbackProvider(client: client, seeds: [11, 29, 47])

        let suggestions = try await provider.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(client.requests.count, 3)
        XCTAssertEqual(suggestions.count, 1)
    }

    func testFailedFallbackSeedDoesNotFailWholeRequest() async throws {
        let client = StubMultiPointClient(
            results: [
                .failure(GraphHopperError.noRouteFound),
                .success(Self.route(distanceKm: 15.1, longitudeOffset: 0.04)),
                .failure(GraphHopperError.network(message: "offline"))
            ]
        )
        let provider = LoopFallbackProvider(client: client, seeds: [11, 29, 47])

        let suggestions = try await provider.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(client.requests.count, 3)
        XCTAssertEqual(suggestions.count, 1)
        XCTAssertEqual(suggestions.first?.route.distanceKilometers, 15.1)
    }

    func testFallbackRanksCandidatesByTargetDistance() async throws {
        let client = StubMultiPointClient(
            results: [
                .success(Self.route(distanceKm: 18)),
                .success(Self.route(distanceKm: 15.2, longitudeOffset: 0.04)),
                .success(Self.route(distanceKm: 11, longitudeOffset: 0.08))
            ]
        )
        let provider = LoopFallbackProvider(client: client, seeds: [11, 29, 47])

        let suggestions = try await provider.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(suggestions.first?.route.distanceKilometers, 15.2)
        XCTAssertEqual(suggestions.first?.route.planningMetadata?.variantLabel, "Closest Match")
    }

    private static let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
    private static let end = Coordinate(latitude: 51.7636, longitude: 10.6647)

    private static func request(
        routeType: TrailRouteType,
        endQuery: String?,
        targetDistanceKm: Double = 15
    ) -> RoutePlanningRequest {
        RoutePlanningRequest(
            routeType: routeType,
            startQuery: "Ilsenburg",
            endQuery: endQuery,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: routeType == .loop ? targetDistanceKm : nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )
    }

    private static func route(
        distanceKm: Double,
        longitudeOffset: Double = 0
    ) -> TrailRoute {
        let path = (0..<14).map { index in
            let phase = Double(index) / 13
            return Coordinate(
                latitude: 51.8666 + sin(phase * .pi * 2) * 0.015,
                longitude: 10.6782 + longitudeOffset + cos(phase * .pi * 2) * 0.015,
                elevationMeters: 200 + Double(index % 4) * 8
            )
        }

        return TrailRoute(
            id: UUID(),
            title: "\(distanceKm) km Hike loop around Ilsenburg",
            location: "Germany",
            activity: .hiking,
            distanceKilometers: distanceKm,
            elevationGainMeters: 120,
            elevationLossMeters: 118,
            durationHours: max(distanceKm / 4, 0.5),
            difficulty: .moderate,
            routeType: .loop,
            summary: "A test loop.",
            whyItMatches: "Test route.",
            highlights: [],
            waypoints: [],
            days: [],
            safetyNotes: [],
            elevationProfile: [],
            path: path,
            planningMetadata: request(routeType: .loop, endQuery: nil).metadata
        )
    }
}
