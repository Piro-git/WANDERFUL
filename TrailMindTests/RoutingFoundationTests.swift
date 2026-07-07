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
            targetDistanceKm: 20,
            seeds: [11, 29, 47]
        )

        XCTAssertEqual(candidates.count, 6)
        XCTAssertEqual(candidates.map(\.bearingPattern), LoopFallbackBearingPattern.allCases)
        XCTAssertEqual(Array(candidates.map(\.seed).prefix(3)), [11, 29, 47])
        XCTAssertEqual(Array(candidates.map(\.radiusFactor).prefix(3)), [0.16, 0.19, 0.22])
        XCTAssertEqual(Array(candidates.map(\.radiusKm).prefix(3)), [3.2, 3.8, 4.4])
        XCTAssertTrue(candidates.allSatisfy { $0.waypoints.first == Self.start })
        XCTAssertTrue(candidates.allSatisfy { $0.waypoints.last == Self.start })
        XCTAssertTrue(candidates.allSatisfy { $0.waypoints.count == 5 })
        XCTAssertTrue(candidates.allSatisfy { Self.triangleArea($0.waypoints.dropFirst().dropLast()) > 0.01 })
    }

    func testTwentyKilometerTargetRejectsThirtyAndThirtySevenKilometerCandidates() async throws {
        let client = StubMultiPointClient(
            results: [
                .success(Self.route(distanceKm: 30)),
                .success(Self.route(distanceKm: 37, longitudeOffset: 0.04)),
                .success(Self.route(distanceKm: 21, longitudeOffset: 0.08))
            ]
        )
        let provider = Self.threePatternProvider(client: client)

        let suggestions = try await provider.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil, targetDistanceKm: 20),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(client.requests.count, 3)
        XCTAssertEqual(suggestions.map(\.route.distanceKilometers), [21])
        XCTAssertEqual(suggestions.first?.debugMetadata?.targetDistanceKm, 20)
        XCTAssertEqual(suggestions.first?.debugMetadata?.actualDistanceKm, 21)
        XCTAssertEqual(suggestions.first?.debugMetadata?.bearingPattern, "wide_triangle")
        XCTAssertEqual(suggestions.first?.debugMetadata?.provider, "LoopFallbackProvider")
    }

    func testTwentyKilometerTargetAcceptsCandidatesAroundEighteenToTwentyTwoKilometers() async throws {
        let client = StubMultiPointClient(
            results: [
                .success(Self.route(distanceKm: 18)),
                .success(Self.route(distanceKm: 22, longitudeOffset: 0.04)),
                .success(Self.route(distanceKm: 20.5, longitudeOffset: 0.08))
            ]
        )
        let provider = Self.threePatternProvider(client: client)

        let suggestions = try await provider.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil, targetDistanceKm: 20),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(suggestions.map(\.route.distanceKilometers), [20.5, 18, 22])
        XCTAssertEqual(suggestions.count, 3)
    }

    func testReversedDuplicateSegmentsCountAsOverlap() {
        let overlapRatio = LoopFallbackProvider.overlapRatio(
            for: [
                Coordinate(latitude: 51.0, longitude: 10.0),
                Coordinate(latitude: 51.0, longitude: 10.01),
                Coordinate(latitude: 51.0, longitude: 10.0)
            ]
        )

        XCTAssertGreaterThan(overlapRatio, 0.45)
    }

    func testRepeatedRouteSegmentsIncreaseOverlapRatio() {
        let overlapRatio = LoopFallbackProvider.overlapRatio(for: Self.outAndBackPath())

        XCTAssertGreaterThan(overlapRatio, 0.45)
    }

    func testCleanLoopGeometryHasLowOverlapRatio() {
        let overlapRatio = LoopFallbackProvider.overlapRatio(for: Self.cleanLoopPath())

        XCTAssertLessThan(overlapRatio, 0.10)
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
        let provider = Self.threePatternProvider(client: client)

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
        let provider = Self.threePatternProvider(client: client)

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
        let provider = Self.threePatternProvider(client: client)

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

    func testCandidateWithTooMuchOverlapIsRejected() async {
        let client = StubMultiPointClient(
            results: [
                .success(Self.route(distanceKm: 20, path: Self.outAndBackPath())),
                .failure(GraphHopperError.noRouteFound),
                .failure(GraphHopperError.noRouteFound)
            ]
        )
        let provider = Self.threePatternProvider(client: client)

        do {
            _ = try await provider.routeSuggestions(
                for: RouteIntent(
                    request: Self.request(routeType: .loop, endQuery: nil, targetDistanceKm: 20),
                    start: Self.start,
                    end: nil
                )
            )
            XCTFail("Expected too much overlap to reject the only route.")
        } catch {
            XCTAssertEqual(client.requests.count, 3)
        }
    }

    func testCleanLoopRanksAboveGoodDistanceRouteWithWeakOverlap() {
        let weakOverlap = LoopRouteVariantRanker.Variant(
            seed: 11,
            route: Self.route(distanceKm: 20.1, path: Self.cleanLoopPath()),
            radiusKm: nil,
            radiusFactor: nil,
            bearingDegrees: nil,
            bearingPattern: "left_arc",
            overlapRatio: 0.22,
            shapeQualityScore: 0.70
        )
        let cleanLoop = LoopRouteVariantRanker.Variant(
            seed: 29,
            route: Self.route(distanceKm: 21.0, longitudeOffset: 0.04, path: Self.cleanLoopPath(longitudeOffset: 0.04)),
            radiusKm: nil,
            radiusFactor: nil,
            bearingDegrees: nil,
            bearingPattern: "wide_triangle",
            overlapRatio: 0.02,
            shapeQualityScore: 0.72
        )

        let ranked = LoopRouteVariantRanker.rank([weakOverlap, cleanLoop], targetDistanceKm: 20)

        XCTAssertEqual(ranked.map(\.seed), [29])
    }

    func testFallbackRetriesWithSmallerRadiusWhenCandidatesAreTooLong() async throws {
        let client = StubMultiPointClient(
            results: [
                .success(Self.route(distanceKm: 30)),
                .success(Self.route(distanceKm: 32, longitudeOffset: 0.04)),
                .success(Self.route(distanceKm: 37, longitudeOffset: 0.08)),
                .success(Self.route(distanceKm: 20.4, longitudeOffset: 0.12)),
                .success(Self.route(distanceKm: 21.5, longitudeOffset: 0.16)),
                .success(Self.route(distanceKm: 19.2, longitudeOffset: 0.20))
            ]
        )
        let provider = Self.threePatternProvider(client: client)

        let suggestions = try await provider.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil, targetDistanceKm: 20),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(client.requests.count, 6)
        XCTAssertEqual(suggestions.map(\.route.distanceKilometers), [20.4, 19.2, 21.5])
        let radiusKm = try XCTUnwrap(suggestions.first?.debugMetadata?.radiusKm)
        XCTAssertEqual(radiusKm, 2.304, accuracy: 0.001)
        XCTAssertEqual(suggestions.first?.debugMetadata?.bearingSeed, 11)
    }

    private static let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
    private static let end = Coordinate(latitude: 51.7636, longitude: 10.6647)

    private static func threePatternProvider(client: StubMultiPointClient) -> LoopFallbackProvider {
        LoopFallbackProvider(
            client: client,
            seeds: [11, 29, 47],
            bearingPatterns: [.leftArc, .rightArc, .wideTriangle]
        )
    }

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
        longitudeOffset: Double = 0,
        path customPath: [Coordinate]? = nil
    ) -> TrailRoute {
        let path = customPath ?? (0..<14).map { index in
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

    private static func cleanLoopPath(longitudeOffset: Double = 0) -> [Coordinate] {
        [
            Coordinate(latitude: 51.8666, longitude: 10.6782 + longitudeOffset),
            Coordinate(latitude: 51.8840, longitude: 10.7050 + longitudeOffset),
            Coordinate(latitude: 51.8700, longitude: 10.7350 + longitudeOffset),
            Coordinate(latitude: 51.8460, longitude: 10.7200 + longitudeOffset),
            Coordinate(latitude: 51.8360, longitude: 10.6900 + longitudeOffset),
            Coordinate(latitude: 51.8520, longitude: 10.6600 + longitudeOffset),
            Coordinate(latitude: 51.8666, longitude: 10.6782 + longitudeOffset),
            Coordinate(latitude: 51.8680, longitude: 10.6800 + longitudeOffset),
            Coordinate(latitude: 51.8720, longitude: 10.6860 + longitudeOffset),
            Coordinate(latitude: 51.8760, longitude: 10.6960 + longitudeOffset),
            Coordinate(latitude: 51.8740, longitude: 10.7060 + longitudeOffset),
            Coordinate(latitude: 51.8666, longitude: 10.6782 + longitudeOffset)
        ]
    }

    private static func outAndBackPath() -> [Coordinate] {
        let outward = [
            Coordinate(latitude: 51.8666, longitude: 10.6782),
            Coordinate(latitude: 51.8720, longitude: 10.6880),
            Coordinate(latitude: 51.8780, longitude: 10.6980),
            Coordinate(latitude: 51.8840, longitude: 10.7080),
            Coordinate(latitude: 51.8900, longitude: 10.7180),
            Coordinate(latitude: 51.8960, longitude: 10.7280)
        ]
        return outward + outward.dropLast().reversed()
    }

    private static func triangleArea<S: Sequence>(_ coordinates: S) -> Double where S.Element == Coordinate {
        let points = Array(coordinates)
        guard points.count >= 3 else { return 0 }
        let origin = points[0]
        let projected = points.map { point in
            (
                x: (point.longitude - origin.longitude) * 111.32,
                y: (point.latitude - origin.latitude) * 110.57
            )
        }
        let closed = Array(projected.dropFirst()) + [projected[0]]
        return abs(zip(projected, closed).reduce(0.0) { area, pair in
            area + ((pair.0.x * pair.1.y) - (pair.1.x * pair.0.y))
        }) / 2
    }
}
