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

private actor LateSuccessMultiPointClient: GraphHopperMultiPointRouteCalculating {
    private var callCount = 0
    private var pendingContinuation: CheckedContinuation<TrailRoute, Never>?

    func calculateGraphHopperRoute(
        waypoints: [Coordinate],
        request: RoutePlanningRequest,
        seed: Int?
    ) async throws -> TrailRoute {
        callCount += 1
        return await withCheckedContinuation { continuation in
            pendingContinuation = continuation
        }
    }

    func waitUntilStarted() async {
        while pendingContinuation == nil {
            await Task.yield()
        }
    }

    func completeWithLateSuccess(_ route: TrailRoute) {
        let continuation = pendingContinuation
        pendingContinuation = nil
        continuation?.resume(returning: route)
    }

    func recordedCallCount() -> Int {
        callCount
    }
}

private final class StubGraphHopperRouteClient: GraphHopperRouteCalculating {
    var routes: [TrailRoute]
    var pointVariantCallCount = 0
    var legacyPointCallCount = 0

    init(routes: [TrailRoute]) {
        self.routes = routes
    }

    func calculateGraphHopperRoute(
        request: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate
    ) async throws -> TrailRoute {
        legacyPointCallCount += 1
        guard let route = routes.first else { throw GraphHopperError.noRouteFound }
        return route
    }

    func calculatePointToPointRouteVariants(
        request: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate
    ) async throws -> [TrailRoute] {
        pointVariantCallCount += 1
        return routes
    }

    func calculateRoundTripRoute(
        start: Coordinate,
        request: RoutePlanningRequest,
        seed: Int?
    ) async throws -> TrailRoute {
        throw GraphHopperError.noRouteFound
    }

    func calculateRoundTripRouteVariants(
        start: Coordinate,
        request: RoutePlanningRequest,
        seeds: [Int]
    ) async throws -> [TrailRoute] {
        throw GraphHopperError.noRouteFound
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
        let pointRoute = Self.route(
            distanceKm: 9,
            path: Self.pointToPointPath(),
            routeType: .pointToPoint
        )
        let expected = RouteSuggestionNormalizer.suggestions(from: [pointRoute])[0]
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

        XCTAssertEqual(result.suggestions.map(\.route.id), [expected.route.id])
        XCTAssertEqual(primary.requestedIntents.count, 1)
        XCTAssertTrue(fallback.requestedIntents.isEmpty)
        XCTAssertNil(result.notice)
    }

    func testGraphHopperProviderConsumesEveryPointToPointVariant() async throws {
        let routes = [0.0, 0.04, 0.08].map { offset in
            Self.route(
                distanceKm: 9 + offset,
                longitudeOffset: offset,
                path: Self.pointToPointPath(longitudeOffset: offset),
                routeType: .pointToPoint
            )
        }
        let client = StubGraphHopperRouteClient(routes: routes)
        let provider = GraphHopperRoutingProvider(client: client)

        let suggestions = try await provider.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .pointToPoint, endQuery: "Schierke"),
                start: Self.start,
                end: Self.end
            )
        )

        XCTAssertEqual(suggestions.map(\.route.id), routes.map(\.id))
        XCTAssertEqual(client.pointVariantCallCount, 1)
        XCTAssertEqual(client.legacyPointCallCount, 0)
    }

    func testPointToPointCoordinatorReturnsOneTwoOrThreeDistinctOptions() async throws {
        for expectedCount in 1...3 {
            let routes = (0..<expectedCount).map { index in
                let offset = Double(index) * 0.04
                return Self.route(
                    distanceKm: 9 + Double(index),
                    longitudeOffset: offset,
                    elevationGainMeters: 120 + index * 20,
                    path: Self.pointToPointPath(longitudeOffset: offset),
                    routeType: .pointToPoint
                )
            }
            let primary = StubRoutingProvider(
                result: .success(RouteSuggestionNormalizer.suggestions(from: routes))
            )
            let fallback = StubRoutingProvider(result: .success([]))
            let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

            let result = try await coordinator.routeSuggestions(
                for: RouteIntent(
                    request: Self.request(routeType: .pointToPoint, endQuery: "Schierke"),
                    start: Self.start,
                    end: Self.end
                )
            )

            XCTAssertEqual(result.suggestions.count, expectedCount)
            XCTAssertTrue(fallback.requestedIntents.isEmpty)
        }
    }

    func testMultiDayProviderKeepsLegacySingleRouteContract() async throws {
        let route = Self.route(
            distanceKm: 22,
            path: Self.pointToPointPath(),
            routeType: .multiDay
        )
        let client = StubGraphHopperRouteClient(routes: [route])
        let provider = GraphHopperRoutingProvider(client: client)

        let suggestions = try await provider.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .multiDay, endQuery: "Schierke"),
                start: Self.start,
                end: Self.end
            )
        )

        XCTAssertEqual(suggestions.map(\.route.id), [route.id])
        XCTAssertEqual(client.legacyPointCallCount, 1)
        XCTAssertEqual(client.pointVariantCallCount, 0)
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

        XCTAssertEqual(result.suggestions.map(\.route.id), [fallbackSuggestion.route.id])
        XCTAssertEqual(fallback.requestedIntents.count, 1)
        XCTAssertNotNil(result.notice)
    }

    func testLoopNoRouteFoundTriesLoopFallback() async throws {
        let fallbackSuggestion = RouteSuggestionNormalizer.suggestions(from: [Self.route(distanceKm: 12)])[0]
        let primary = StubRoutingProvider(result: .failure(GraphHopperError.noRouteFound))
        let fallback = StubRoutingProvider(result: .success([fallbackSuggestion]))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        let result = try await coordinator.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil, targetDistanceKm: 12),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(result.suggestions.map(\.route.id), [fallbackSuggestion.route.id])
        XCTAssertEqual(primary.requestedIntents.count, 1)
        XCTAssertEqual(fallback.requestedIntents.count, 1)
        XCTAssertEqual(
            result.notice,
            "GraphHopper could not build a direct round trip, so Wanderful tried alternate loop shapes from the same start."
        )
    }

    func testSingleDirectLoopIsCombinedWithFallbackLoopsForComparison() async throws {
        let directSuggestion = RouteSuggestionNormalizer.suggestions(from: [Self.route(distanceKm: 15)])[0]
        let fallbackSuggestions = RouteSuggestionNormalizer.suggestions(from: [
            Self.route(distanceKm: 14.2, longitudeOffset: 0.04),
            Self.route(distanceKm: 16.1, longitudeOffset: 0.08)
        ])
        let primary = StubRoutingProvider(result: .success([directSuggestion]))
        let fallback = StubRoutingProvider(result: .success(fallbackSuggestions))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        let result = try await coordinator.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(result.suggestions.map(\.route.distanceKilometers), [15, 14.2, 16.1])
        XCTAssertEqual(result.suggestions.map(\.explanation), [
            "At distance target",
            "0.8 km under target",
            "1.1 km over target"
        ])
        XCTAssertEqual(primary.requestedIntents.count, 1)
        XCTAssertEqual(fallback.requestedIntents.count, 1)
        XCTAssertEqual(
            result.notice,
            "Wanderful found distinct real loop options from the same start for comparison."
        )
    }

    func testSingleDirectLoopAndOneDistinctFallbackBecomeComparableOptions() async throws {
        let directSuggestion = RouteSuggestionNormalizer.suggestions(from: [Self.route(distanceKm: 15)])[0]
        let fallbackSuggestion = RouteSuggestionNormalizer.suggestions(
            from: [Self.route(distanceKm: 14.6, longitudeOffset: 0.04)]
        )[0]
        let primary = StubRoutingProvider(result: .success([directSuggestion]))
        let fallback = StubRoutingProvider(result: .success([fallbackSuggestion]))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        let result = try await coordinator.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(result.suggestions.map(\.route.distanceKilometers), [15, 14.6])
        XCTAssertEqual(result.suggestions.map(\.explanation), [
            "At distance target",
            "0.4 km under target"
        ])
        XCTAssertEqual(fallback.requestedIntents.count, 1)
        XCTAssertEqual(
            result.notice,
            "Wanderful found distinct real loop options from the same start for comparison."
        )
    }

    func testDuplicateFallbackLoopDoesNotCreateAFalseComparison() async throws {
        let directRoute = Self.route(distanceKm: 15)
        let directSuggestion = RouteSuggestionNormalizer.suggestions(from: [directRoute])[0]
        let duplicateSuggestion = RouteSuggestionNormalizer.suggestions(from: [directRoute])[0]
        let primary = StubRoutingProvider(result: .success([directSuggestion]))
        let fallback = StubRoutingProvider(result: .success([duplicateSuggestion]))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        let result = try await coordinator.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(result.suggestions.map(\.route.id), [directSuggestion.route.id])
        XCTAssertNil(result.notice)
        XCTAssertEqual(result.loopSearchOutcome, .singleRoute)
        XCTAssertEqual(result.loopSearchDiagnostics?.directRouteCount, 1)
        XCTAssertEqual(result.loopSearchDiagnostics?.fallbackRouteCount, 1)
    }

    func testThreeDistinctLoopsProduceAComparisonOutcome() async throws {
        let directSuggestions = RouteSuggestionNormalizer.suggestions(from: [
            Self.route(distanceKm: 15),
            Self.route(distanceKm: 14.4, longitudeOffset: 0.04),
            Self.route(distanceKm: 16.1, longitudeOffset: 0.08)
        ])
        let primary = StubRoutingProvider(result: .success(directSuggestions))
        let fallback = StubRoutingProvider(result: .success([]))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        let result = try await coordinator.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(result.suggestions.count, 3)
        XCTAssertEqual(result.loopSearchOutcome, .comparison(routeCount: 3))
        XCTAssertEqual(result.loopSearchDiagnostics?.directRouteCount, 3)
        XCTAssertTrue(fallback.requestedIntents.isEmpty)
    }

    func testLoopResultReportsAppliedAndRequestedOnlyShapingPreferences() async throws {
        let request = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: 180,
            difficulty: .easy,
            desiredFeatures: [.viewpoint],
            avoidFeatures: [.steepClimbs, .majorRoads, .repeatedPath]
        )
        let primary = StubRoutingProvider(
            result: .success(
                RouteSuggestionNormalizer.suggestions(from: [
                    Self.route(distanceKm: 14.7, elevationGainMeters: 180),
                    Self.route(distanceKm: 15.4, longitudeOffset: 0.04, elevationGainMeters: 320)
                ])
            )
        )
        let fallback = StubRoutingProvider(result: .success([]))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        let result = try await coordinator.routeSuggestions(
            for: RouteIntent(request: request, start: Self.start, end: nil)
        )
        let summary = try XCTUnwrap(result.suggestions.first?.route.planningMetadata?.routeShapingSummary)

        XCTAssertEqual(
            summary.applied,
            [.activityProfile, .targetDistance, .targetDuration, .reduceRepeatedPath, .lowerElevation]
        )
        XCTAssertEqual(summary.requestedOnly, [.avoidMajorRoads])
        XCTAssertFalse(summary.applied.contains { $0.rawValue.contains("view") })
    }

    func testExpiredBudgetPreservesTheFirstDirectLoop() async throws {
        let directSuggestion = RouteSuggestionNormalizer.suggestions(from: [Self.route(distanceKm: 15)])[0]
        let primary = StubRoutingProvider(result: .success([directSuggestion]))
        let fallback = StubRoutingProvider(result: .success([
            RouteSuggestionNormalizer.suggestions(from: [Self.route(distanceKm: 14.6, longitudeOffset: 0.04)])[0]
        ]))
        let coordinator = RoutingCoordinator(
            primaryProvider: primary,
            loopFallbackProvider: fallback,
            loopSearchPolicy: LoopSearchPolicy(totalBudgetSeconds: 0)
        )

        let result = try await coordinator.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(result.suggestions.map(\.route.id), [directSuggestion.route.id])
        XCTAssertEqual(result.loopSearchOutcome, .singleRoute)
        XCTAssertTrue(result.loopSearchDiagnostics?.didReachTimeBudget == true)
        XCTAssertTrue(fallback.requestedIntents.isEmpty)
    }

    func testComparableDirectLoopsDoNotRequestFallback() async throws {
        let directSuggestions = RouteSuggestionNormalizer.suggestions(from: [
            Self.route(distanceKm: 14.7),
            Self.route(distanceKm: 16.0, longitudeOffset: 0.04)
        ])
        let primary = StubRoutingProvider(result: .success(directSuggestions))
        let fallback = StubRoutingProvider(result: .success([]))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        let result = try await coordinator.routeSuggestions(
            for: RouteIntent(
                request: Self.request(routeType: .loop, endQuery: nil),
                start: Self.start,
                end: nil
            )
        )

        XCTAssertEqual(result.suggestions.map(\.route.id), directSuggestions.map(\.route.id))
        XCTAssertEqual(result.suggestions.map(\.explanation), [
            "0.3 km under target",
            "1.0 km over target"
        ])
        XCTAssertTrue(fallback.requestedIntents.isEmpty)
        XCTAssertNil(result.notice)
    }

    func testLoopNoRouteFoundAfterFallbackUsesLoopSpecificError() async {
        let primary = StubRoutingProvider(result: .failure(GraphHopperError.noRouteFound))
        let fallback = StubRoutingProvider(result: .failure(GraphHopperError.noRouteFound))
        let coordinator = RoutingCoordinator(primaryProvider: primary, loopFallbackProvider: fallback)

        do {
            _ = try await coordinator.routeSuggestions(
                for: RouteIntent(
                    request: Self.request(routeType: .loop, endQuery: nil, targetDistanceKm: 12),
                    start: Self.start,
                    end: nil
                )
            )
            XCTFail("Expected loop-specific route failure.")
        } catch let error as RoutingError {
            XCTAssertEqual(error, .loopRouteNotFound)
            XCTAssertEqual(
                error.localizedDescription,
                "GraphHopper couldn’t build a loop route from this start. Try a nearby trailhead or a different duration."
            )
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
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

    func testTwentyKilometerTargetRejectsOnlyExtremeDistanceCandidates() async throws {
        let client = StubMultiPointClient(
            results: [
                .success(Self.route(distanceKm: 40)),
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

        XCTAssertEqual(client.requests.count, 5)
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
        XCTAssertTrue(suggestions.allSatisfy { suggestion in
            guard case let .routed(provenance) = suggestion.route.provenance else { return false }
            return provenance.provider == .graphHopper &&
                provenance.strategy == .loopFallback &&
                suggestion.route.isVerifiedRoutedResult
        })
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
        XCTAssertEqual(suggestion.explanation, "Closest Match")
        XCTAssertEqual(
            RouteAlternativeQuality.displayLabel(candidate: suggestion.explanation, for: route),
            "At distance target"
        )
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

    func testLoopFallbackCancellationStopsAfterCurrentTransportAndRejectsSuccess() async {
        let client = LateSuccessMultiPointClient()
        let provider = Self.threePatternProvider(client: client)
        let intent = RouteIntent(
            request: Self.request(routeType: .loop, endQuery: nil),
            start: Self.start,
            end: nil
        )
        let planningTask = Task {
            try await provider.routeSuggestions(for: intent)
        }

        await client.waitUntilStarted()
        planningTask.cancel()
        await client.completeWithLateSuccess(Self.route(distanceKm: 15))

        do {
            _ = try await planningTask.value
            XCTFail("Cancelled loop fallback must not return routed suggestions.")
        } catch is CancellationError {
            // Expected: cancellation propagates through the fallback search.
        } catch {
            XCTFail("Expected CancellationError, received \(error).")
        }

        let callCount = await client.recordedCallCount()
        XCTAssertEqual(
            callCount,
            1,
            "Cancellation must reject a late transport success and prevent later candidates or retries."
        )
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
        XCTAssertEqual(suggestions.first?.route.planningMetadata?.variantLabel, "0.2 km over target")
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

    func testShapeAwareQualityRejectsOutAndBackAndAllowsMeaningfulSharedLoop() {
        XCTAssertFalse(
            LoopFallbackProvider.acceptsLoopQuality(
                .init(overlapRatio: 0.52, shapeQualityScore: 0.08)
            )
        )
        XCTAssertTrue(
            LoopFallbackProvider.acceptsLoopQuality(
                .init(overlapRatio: 0.52, shapeQualityScore: 0.48)
            )
        )
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

        XCTAssertEqual(ranked.map(\.seed), [11, 29])
    }

    func testModerateOverlapLoopRemainsAvailableWhenNoCleanerOptionExists() {
        let moderateOverlap = LoopRouteVariantRanker.Variant(
            seed: 11,
            route: Self.route(distanceKm: 15.2, path: Self.cleanLoopPath()),
            radiusKm: nil,
            radiusFactor: nil,
            bearingDegrees: nil,
            bearingPattern: "left_arc",
            overlapRatio: 0.32,
            shapeQualityScore: 0.70
        )

        let ranked = LoopRouteVariantRanker.rank([moderateOverlap], targetDistanceKm: 15)

        XCTAssertEqual(ranked.map(\.seed), [11])
        XCTAssertEqual(ranked.first?.route.planningMetadata?.variantLabel, "0.2 km over target")
    }

    func testLoopVariantRankerPreservesExplicitMajorRoadAvoidanceFromSuppliedRequest() {
        let highRoad = Self.route(
            distanceKm: 15,
            verifiedCharacteristics: Self.roadCharacteristics(
                distanceKm: 15,
                majorRoadRatio: 0.40
            )
        )
        let lowRoad = Self.route(
            distanceKm: 15.3,
            longitudeOffset: 0.04,
            verifiedCharacteristics: Self.roadCharacteristics(
                distanceKm: 15.3,
                majorRoadRatio: 0.01
            )
        )
        let variants = [
            LoopRouteVariantRanker.Variant(
                seed: 11,
                route: highRoad,
                radiusKm: nil,
                radiusFactor: nil,
                bearingDegrees: nil,
                bearingPattern: "left_arc",
                overlapRatio: 0.02,
                shapeQualityScore: 0.75
            ),
            LoopRouteVariantRanker.Variant(
                seed: 29,
                route: lowRoad,
                radiusKm: nil,
                radiusFactor: nil,
                bearingDegrees: nil,
                bearingPattern: "right_arc",
                overlapRatio: 0.03,
                shapeQualityScore: 0.72
            )
        ]
        let request = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: 225,
            difficulty: .moderate,
            desiredFeatures: [.forest],
            avoidFeatures: [.majorRoads]
        )

        let ranked = LoopRouteVariantRanker.rank(
            variants,
            targetDistanceKm: 15,
            targetDurationMinutes: 225,
            request: request
        )

        XCTAssertEqual(ranked.map(\.route.id), [lowRoad.id])
    }

    func testEasyLoopRankingPrefersLowerElevationWithinDistanceTolerance() {
        let steep = Self.route(distanceKm: 15.0, elevationGainMeters: 760)
        let gentler = Self.route(
            distanceKm: 14.4,
            longitudeOffset: 0.04,
            elevationGainMeters: 180
        )

        let ranked = RouteSuggestionNormalizer.comparableLoopSuggestions(
            from: RouteSuggestionNormalizer.suggestions(from: [steep, gentler]),
            targetDistanceKm: 15,
            request: RoutePlanningRequest(
                routeType: .loop,
                startQuery: "Ilsenburg",
                endQuery: nil,
                activityType: .hiking,
                graphHopperProfile: "foot",
                targetDistanceKm: 15,
                targetDurationMinutes: nil,
                difficulty: .easy,
                desiredFeatures: [],
                avoidFeatures: [.steepClimbs]
            )
        )

        XCTAssertEqual(ranked.map(\.route.elevationGainMeters), [180, 760])
    }

    func testDurationBasedLoopRankingUsesVerifiedRouteDuration() {
        let distanceMatch = Self.route(distanceKm: 15.0, durationHours: 3.5)
        let durationMatch = Self.route(
            distanceKm: 14.2,
            longitudeOffset: 0.04,
            durationHours: 2.0
        )

        let ranked = RouteSuggestionNormalizer.comparableLoopSuggestions(
            from: RouteSuggestionNormalizer.suggestions(from: [distanceMatch, durationMatch]),
            targetDistanceKm: 15,
            request: RoutePlanningRequest(
                routeType: .loop,
                startQuery: "Ilsenburg",
                endQuery: nil,
                activityType: .hiking,
                graphHopperProfile: "foot",
                targetDistanceKm: 15,
                targetDurationMinutes: 120,
                difficulty: nil,
                desiredFeatures: []
            )
        )

        XCTAssertEqual(ranked.map(\.route.durationMinutes), [120, 210])
    }

    func testRepeatedPathPreferenceRejectsDirectOutAndBackGeometry() {
        let outAndBack = Self.route(distanceKm: 15, path: Self.outAndBackPath())
        let clean = Self.route(
            distanceKm: 15.4,
            longitudeOffset: 0.04,
            path: Self.cleanLoopPath(longitudeOffset: 0.04)
        )

        let ranked = RouteSuggestionNormalizer.comparableLoopSuggestions(
            from: RouteSuggestionNormalizer.suggestions(from: [outAndBack, clean]),
            targetDistanceKm: 15,
            request: RoutePlanningRequest(
                routeType: .loop,
                startQuery: "Ilsenburg",
                endQuery: nil,
                activityType: .hiking,
                graphHopperProfile: "foot",
                targetDistanceKm: 15,
                targetDurationMinutes: nil,
                difficulty: nil,
                desiredFeatures: [],
                avoidFeatures: [.repeatedPath]
            )
        )

        XCTAssertEqual(ranked.map(\.route.id), [clean.id])
    }

    func testFallbackRetriesWithSmallerRadiusWhenCandidatesAreTooLong() async throws {
        let client = StubMultiPointClient(
            results: [
                .success(Self.route(distanceKm: 40)),
                .success(Self.route(distanceKm: 42, longitudeOffset: 0.04)),
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

    func testFallbackRetryRemainsEligibleAfterThreeAcceptedCandidatesWhenEvidenceIsInsufficient() async throws {
        let client = StubMultiPointClient(
            results: [
                .success(Self.route(distanceKm: 15)),
                .success(Self.route(distanceKm: 15.2, longitudeOffset: 0.04)),
                .success(Self.route(distanceKm: 14.8, longitudeOffset: 0.08)),
                .success(Self.route(distanceKm: 40, longitudeOffset: 0.12)),
                .failure(GraphHopperError.noRouteFound),
                .failure(GraphHopperError.noRouteFound),
                .success(Self.route(distanceKm: 15.1, longitudeOffset: 0.16))
            ]
        )
        let provider = LoopFallbackProvider(
            client: client,
            seeds: [11, 29, 47],
            bearingPatterns: LoopFallbackBearingPattern.allCases
        )
        let request = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: [.majorRoads]
        )

        let suggestions = try await provider.routeSuggestions(
            for: RouteIntent(request: request, start: Self.start, end: nil)
        )

        XCTAssertEqual(client.requests.count, 7)
        XCTAssertTrue(client.requests.allSatisfy { $0.request.avoidFeatures == [.majorRoads] })
        XCTAssertEqual(suggestions.count, 3)
    }

    func testFallbackExpansionRetryUsesTooShortResultsAccumulatedDuringShrinkRetry() async throws {
        let client = StubMultiPointClient(
            results: [
                .success(Self.route(distanceKm: 40)),
                .success(Self.route(distanceKm: 42, longitudeOffset: 0.04)),
                .success(Self.route(distanceKm: 37, longitudeOffset: 0.08)),
                .success(Self.route(distanceKm: 5, longitudeOffset: 0.12)),
                .success(Self.route(distanceKm: 6, longitudeOffset: 0.16)),
                .success(Self.route(distanceKm: 7, longitudeOffset: 0.20)),
                .success(Self.route(distanceKm: 20.4, longitudeOffset: 0.24)),
                .success(Self.route(distanceKm: 19.2, longitudeOffset: 0.28)),
                .success(Self.route(distanceKm: 21.5, longitudeOffset: 0.32))
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

        XCTAssertEqual(client.requests.count, 9)
        XCTAssertEqual(suggestions.map(\.route.distanceKilometers), [20.4, 19.2, 21.5])
    }

    func testRouteQualityExplanationsDescribeCloseLoopUsingRealRouteData() {
        let route = Self.route(distanceKm: 15.4).withPlanningMetadata(
            Self.request(routeType: .loop, endQuery: nil, targetDistanceKm: 15).metadata.withVariant(
                seed: 11,
                label: "Closest Match"
            )
        )

        let explanations = RouteQualityExplanationGenerator.explanations(for: route)

        XCTAssertEqual(explanations.map(\.title), [
            "Close to your target distance",
            "Loop route",
            "Calculated from live trail-network data"
        ])
        XCTAssertTrue(explanations.first?.detail?.hasPrefix("Actual 15") == true)
        XCTAssertTrue(explanations.first?.detail?.hasSuffix("vs requested 15 km.") == true)
    }

    func testMaterialDistanceMismatchUsesCentralizedExplanation() {
        let metadata = Self.request(
            routeType: .loop,
            endQuery: nil,
            targetDistanceKm: 15
        ).metadata

        XCTAssertEqual(metadata.distanceFit(actualDistanceKm: 12.2), .shorter)
        XCTAssertEqual(
            metadata.distanceNote(actualDistanceKm: 12.2),
            "Actual 12.2 km vs requested 15 km."
        )
        XCTAssertEqual(metadata.requestedDistanceSummary, "Requested: about 15 km")
    }

    func testDistanceWithinToleranceDoesNotShowMismatchExplanation() {
        let metadata = Self.request(
            routeType: .loop,
            endQuery: nil,
            targetDistanceKm: 15
        ).metadata

        XCTAssertEqual(metadata.distanceFit(actualDistanceKm: 14.0), .withinTolerance)
        XCTAssertNil(metadata.distanceNote(actualDistanceKm: 14.0))
    }

    func testRouteQualityExplanationsDescribeShorterAndLongerDistanceFit() {
        let shorter = Self.route(distanceKm: 11.8)
        let longer = Self.route(distanceKm: 18.4)

        XCTAssertEqual(
            RouteQualityExplanationGenerator.explanations(for: shorter).first?.title,
            "Shorter than target"
        )
        XCTAssertEqual(
            RouteQualityExplanationGenerator.explanations(for: longer).first?.title,
            "Longer than target"
        )
    }

    func testRouteQualityExplanationsUseDebugOverlapOnlyWhenAvailable() {
        let route = Self.route(distanceKm: 15)
        let debugMetadata = RouteSuggestionDebugMetadata(
            targetDistanceKm: 15,
            actualDistanceKm: 15,
            distanceRatio: 1,
            overlapRatio: 0.04,
            shapeQualityScore: 0.82,
            radiusKm: 2.4,
            bearingSeed: 11,
            provider: "LoopFallbackProvider",
            rejectionReason: nil
        )

        let explanations = RouteQualityExplanationGenerator.explanations(
            for: route,
            debugMetadata: debugMetadata
        )

        XCTAssertTrue(explanations.map(\.title).contains("Low repeated path"))
        XCTAssertTrue(explanations.map(\.title).contains("Calculated from live trail-network data"))
    }

    func testCoordinatesAndInstructionsCannotPromoteDemoRouteToVerified() {
        let route = Self.route(
            distanceKm: 15,
            provenanceOverride: .demo(.testFixture),
            routeInstructions: [
                RouteInstruction(
                    text: "Continue",
                    streetName: nil,
                    distanceMeters: 1_000,
                    durationSeconds: 600,
                    sign: 0,
                    coordinate: Self.start
                )
            ]
        )

        XCTAssertFalse(route.isVerifiedRoutedResult)
        XCTAssertFalse(
            RouteQualityExplanationGenerator.explanations(for: route)
                .map(\.title)
                .contains("Calculated from live trail-network data")
        )
    }

    func testRouteQualityExplanationsKeepRequestedFeaturesOutOfVerifiedClaims() {
        let metadata = RoutePlanningMetadata(
            routeType: .loop,
            activityType: .hiking,
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [.viewpoint, .forest, .quiet],
            avoidFeatures: [],
            seed: 11,
            variantLabel: "Closest Match"
        )
        let route = Self.route(distanceKm: 15).withPlanningMetadata(metadata)

        let explanationText = RouteQualityExplanationGenerator.explanations(for: route)
            .flatMap { [$0.title, $0.detail ?? ""] }
            .joined(separator: " ")

        XCTAssertFalse(explanationText.localizedCaseInsensitiveContains("view"))
        XCTAssertFalse(explanationText.localizedCaseInsensitiveContains("forest"))
        XCTAssertFalse(explanationText.localizedCaseInsensitiveContains("quiet"))
        XCTAssertEqual(metadata.requestedFeatureSummary, "Requested: Views, Forest, Quiet route")
    }

    func testPairwiseSimilarityRejectsReversedResampledAndSmallOffsetCopies() {
        let original = Self.cleanLoopPath()
        let reversed = Array(original.reversed())
        let resampled = Self.resampled(original)
        let smallOffset = original.map {
            Coordinate(
                latitude: $0.latitude + 0.0001,
                longitude: $0.longitude,
                elevationMeters: $0.elevationMeters
            )
        }
        let materiallyDistinct = Self.cleanLoopPath(longitudeOffset: 0.03)

        XCTAssertGreaterThan(RouteAlternativeQuality.pairwiseSimilarity(original, reversed), 0.98)
        XCTAssertGreaterThan(RouteAlternativeQuality.pairwiseSimilarity(original, resampled), 0.98)
        XCTAssertGreaterThan(RouteAlternativeQuality.pairwiseSimilarity(original, smallOffset), 0.95)
        XCTAssertLessThan(
            RouteAlternativeQuality.pairwiseSimilarity(original, materiallyDistinct),
            RouteAlternativeQualityPolicy.preBaseline.nearDuplicateSimilarity
        )
    }

    func testMeasuredDeduplicationRetainsOnlyMateriallyDistinctRoutes() {
        let original = Self.cleanLoopPath()
        let routes = [
            Self.route(distanceKm: 15, path: original),
            Self.route(distanceKm: 15, path: Array(original.reversed())),
            Self.route(distanceKm: 15, path: Self.resampled(original)),
            Self.route(
                distanceKm: 15,
                path: original.map {
                    Coordinate(latitude: $0.latitude + 0.0001, longitude: $0.longitude)
                }
            ),
            Self.route(distanceKm: 15, path: Self.cleanLoopPath(longitudeOffset: 0.03))
        ]
        let request = Self.request(routeType: .loop, endQuery: nil)

        let selection = RouteAlternativeQuality.select(
            RouteSuggestionNormalizer.suggestions(from: routes),
            request: request,
            maximumSuggestions: 3
        )
        let reversedSelection = RouteAlternativeQuality.select(
            RouteSuggestionNormalizer.suggestions(from: Array(routes.reversed())),
            request: request,
            maximumSuggestions: 3
        )

        let selectedIDs = selection.selected.map(\.suggestion.route.id)
        XCTAssertEqual(selectedIDs, reversedSelection.selected.map(\.suggestion.route.id))
        XCTAssertEqual(selectedIDs.count, 2)
        XCTAssertTrue(selectedIDs.contains(routes[4].id))
        XCTAssertEqual(selectedIDs.filter { Set(routes.prefix(4).map(\.id)).contains($0) }.count, 1)
        XCTAssertEqual(
            selection.rejectionCounts[RouteAlternativeRejection.nearDuplicate.rawValue],
            3
        )
    }

    func testEveryLoopMustBeClosedAndAvoidExcessiveBacktracking() {
        let request = Self.request(routeType: .loop, endQuery: nil)
        let openRoute = Self.route(
            distanceKm: 15,
            path: Array(Self.cleanLoopPath().dropLast(3))
        )
        let backtrackingRoute = Self.route(distanceKm: 15, path: Self.outAndBackPath())
        let openAnalysis = RouteAlternativeQuality.analyze(route: openRoute, request: request)
        let backtrackingAnalysis = RouteAlternativeQuality.analyze(route: backtrackingRoute, request: request)

        XCTAssertEqual(
            RouteAlternativeQuality.rejection(for: openRoute, analysis: openAnalysis, request: request),
            .openLoop
        )
        XCTAssertGreaterThan(
            backtrackingAnalysis.selfBacktrackingRatio ?? 0,
            RouteAlternativeQualityPolicy.preBaseline.maximumSelfBacktrackingRatio
        )
        XCTAssertLessThan(
            backtrackingAnalysis.shapeQualityScore ?? 1,
            RouteAlternativeQualityPolicy.preBaseline.minimumLoopShapeQuality
        )
        XCTAssertEqual(
            RouteAlternativeQuality.rejection(
                for: backtrackingRoute,
                analysis: backtrackingAnalysis,
                request: request
            ),
            .excessiveBacktracking
        )
    }

    func testSameDirectionRepeatedLoopIsRejectedAsExcessiveSelfOverlap() {
        let singleLoop = Self.cleanLoopPath()
        let repeatedPath = singleLoop + singleLoop.dropFirst()
        let route = Self.route(distanceKm: 30, path: repeatedPath)
        let request = Self.request(
            routeType: .loop,
            endQuery: nil,
            targetDistanceKm: 30
        )
        let analysis = RouteAlternativeQuality.analyze(route: route, request: request)

        XCTAssertLessThan(
            analysis.selfBacktrackingRatio ?? 1,
            RouteAlternativeQualityPolicy.preBaseline.maximumSelfBacktrackingRatio
        )
        XCTAssertGreaterThan(
            analysis.selfOverlapRatio ?? 0,
            RouteAlternativeQualityPolicy.preBaseline.maximumSelfOverlapRatio
        )
        XCTAssertEqual(
            RouteAlternativeQuality.rejection(for: route, analysis: analysis, request: request),
            .excessiveSelfOverlap
        )
    }

    func testExtremePointToPointDetourIsRejected() {
        let path = [
            Self.start,
            Coordinate(latitude: 52.02, longitude: 10.68),
            Coordinate(latitude: 52.02, longitude: 10.92),
            Coordinate(latitude: 51.8700, longitude: 10.6850)
        ]
        let route = Self.route(
            distanceKm: 35,
            path: path,
            routeType: .pointToPoint
        )
        let request = Self.request(routeType: .pointToPoint, endQuery: "Nearby finish")
        let analysis = RouteAlternativeQuality.analyze(route: route, request: request)

        XCTAssertGreaterThan(
            analysis.detourRatio ?? 0,
            RouteAlternativeQualityPolicy.preBaseline.maximumPointToPointDetourRatio
        )
        XCTAssertEqual(
            RouteAlternativeQuality.rejection(for: route, analysis: analysis, request: request),
            .extremeDetour
        )
    }

    func testBorderlineTargetMissSurvivesWithExactDistanceAndDurationDisclosure() throws {
        let request = RoutePlanningRequest(
            routeType: .pointToPoint,
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 10,
            targetDurationMinutes: 120,
            difficulty: nil,
            desiredFeatures: []
        )
        let route = Self.route(
            distanceKm: 17,
            durationHours: 4,
            path: Self.pointToPointPath(),
            routeType: .pointToPoint
        ).withPlanningMetadata(request.metadata)

        let normalized = RouteSuggestionNormalizer.normalizedSuggestions(
            from: RouteSuggestionNormalizer.suggestions(from: [route]),
            request: request
        )

        let suggestion = try XCTUnwrap(normalized.suggestions.first)
        XCTAssertEqual(suggestion.explanation, "7.0 km over target • 120 min over target")
        XCTAssertEqual(suggestion.route.planningMetadata?.variantLabel, suggestion.explanation)
        XCTAssertTrue(normalized.rejectionCounts.isEmpty)
    }

    func testExtremeDistanceAndDurationTargetMissesFailClosed() {
        let request = RoutePlanningRequest(
            routeType: .pointToPoint,
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 10,
            targetDurationMinutes: 120,
            difficulty: nil,
            desiredFeatures: []
        )
        let distanceMiss = Self.route(
            distanceKm: 18,
            durationHours: 2,
            path: Self.pointToPointPath(),
            routeType: .pointToPoint
        )
        let durationMiss = Self.route(
            distanceKm: 10,
            durationHours: 5.1,
            path: Self.pointToPointPath(longitudeOffset: 0.04),
            routeType: .pointToPoint
        )

        let distanceAnalysis = RouteAlternativeQuality.analyze(route: distanceMiss, request: request)
        let durationAnalysis = RouteAlternativeQuality.analyze(route: durationMiss, request: request)
        XCTAssertEqual(
            RouteAlternativeQuality.rejection(
                for: distanceMiss,
                analysis: distanceAnalysis,
                request: request
            ),
            .distanceOutsideEnvelope
        )
        XCTAssertEqual(
            RouteAlternativeQuality.rejection(
                for: durationMiss,
                analysis: durationAnalysis,
                request: request
            ),
            .durationOutsideEnvelope
        )
    }

    func testRankingIsStableAndInputOrderInvariantForCompleteTies() {
        let first = Self.route(distanceKm: 15, path: Self.cleanLoopPath())
        let second = Self.route(
            distanceKm: 15,
            longitudeOffset: 0.04,
            path: Self.cleanLoopPath(longitudeOffset: 0.04)
        )
        let request = Self.request(routeType: .loop, endQuery: nil)

        let forward = RouteAlternativeQuality.select(
            RouteSuggestionNormalizer.suggestions(from: [first, second]),
            request: request
        )
        let reversed = RouteAlternativeQuality.select(
            RouteSuggestionNormalizer.suggestions(from: [second, first]),
            request: request
        )

        let forwardIDs = forward.selected.map(\.suggestion.route.id)
        let reversedIDs = reversed.selected.map(\.suggestion.route.id)
        XCTAssertEqual(forwardIDs, reversedIDs)
        XCTAssertEqual(Set(forwardIDs), Set([first.id, second.id]))
        XCTAssertEqual(forward.policyVersion, HikingRouteQualityPolicyVersion.v1.rawValue)
    }

    func testNoTargetComparisonLabelsUseMeasuredClimbOnly() {
        let higher = Self.route(
            distanceKm: 9,
            longitudeOffset: 0.04,
            elevationGainMeters: 320,
            path: Self.pointToPointPath(longitudeOffset: 0.04),
            routeType: .pointToPoint
        )
        let lower = Self.route(
            distanceKm: 9,
            elevationGainMeters: 120,
            path: Self.pointToPointPath(),
            routeType: .pointToPoint
        )
        let request = Self.request(routeType: .pointToPoint, endQuery: "Schierke")

        let normalized = RouteSuggestionNormalizer.normalizedSuggestions(
            from: RouteSuggestionNormalizer.suggestions(from: [higher, lower]),
            request: request
        )

        XCTAssertEqual(normalized.suggestions.map(\.route.id), [lower.id, higher.id])
        XCTAssertEqual(normalized.suggestions.map(\.explanation), ["Lowest climb", "+200 m climb"])
    }

    func testQualitySelectionSupportsAllRoutingActivities() {
        for activity in ActivityType.allCases {
            let request = Self.request(
                routeType: .pointToPoint,
                endQuery: "Schierke",
                activity: activity
            )
            let route = Self.route(
                distanceKm: 9,
                path: Self.pointToPointPath(),
                activity: activity,
                routeType: .pointToPoint
            )
            let selection = RouteAlternativeQuality.select(
                RouteSuggestionNormalizer.suggestions(from: [route]),
                request: request
            )

            XCTAssertEqual(selection.selected.first?.suggestion.route.activity, activity)
        }
    }

    func testRequestedEasyMismatchUsesMeasuredDifficultyDisclosure() {
        let request = Self.request(
            routeType: .loop,
            endQuery: nil,
            difficulty: .easy
        )
        let route = Self.route(
            distanceKm: 20,
            elevationGainMeters: 900
        ).withPlanningMetadata(request.metadata)

        let mismatch = RouteQualityExplanationGenerator.explanations(for: route)
            .first { $0.title == "Harder than requested" }

        XCTAssertNotNil(mismatch)
        XCTAssertEqual(
            mismatch?.detail,
            "Requested Easy. Measured 20 km and 900 m climb produce Wanderful’s Challenging estimate."
        )
    }

    func testReleaseComparisonLabelSuppressesPersistedLegacyCopy() {
        let route = Self.route(distanceKm: 12.2).withPlanningMetadata(
            Self.request(routeType: .loop, endQuery: nil).metadata.withVariant(
                seed: 11,
                label: "Easier Option"
            )
        )

        XCTAssertNil(RouteAlternativeQuality.displayLabel(candidate: nil, for: route))
        XCTAssertEqual(
            RouteAlternativeQuality.displayLabel(candidate: "Easier Option", for: route),
            "2.8 km under target"
        )
        XCTAssertEqual(
            RouteAlternativeQuality.detailDisplayLabel(for: route),
            "2.8 km under target"
        )

        let noTargetMetadata = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        ).metadata.withVariant(seed: 11, label: "Closest Match")
        let legacyOnlyRoute = route.withPlanningMetadata(noTargetMetadata)

        XCTAssertNil(RouteAlternativeQuality.detailDisplayLabel(for: legacyOnlyRoute))
    }

    private static let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
    private static let end = Coordinate(latitude: 51.7636, longitude: 10.6647)

    private static func threePatternProvider(
        client: any GraphHopperMultiPointRouteCalculating
    ) -> LoopFallbackProvider {
        LoopFallbackProvider(
            client: client,
            seeds: [11, 29, 47],
            bearingPatterns: [.leftArc, .rightArc, .wideTriangle]
        )
    }

    private static func request(
        routeType: TrailRouteType,
        endQuery: String?,
        targetDistanceKm: Double = 15,
        targetDurationMinutes: Int? = nil,
        difficulty: RouteDifficulty? = nil,
        activity: ActivityType = .hiking
    ) -> RoutePlanningRequest {
        RoutePlanningRequest(
            routeType: routeType,
            startQuery: "Ilsenburg",
            endQuery: endQuery,
            activityType: activity,
            graphHopperProfile: activity == .biking ? "bike" : "foot",
            targetDistanceKm: routeType == .loop ? targetDistanceKm : nil,
            targetDurationMinutes: targetDurationMinutes,
            difficulty: difficulty,
            desiredFeatures: []
        )
    }

    private static func route(
        distanceKm: Double,
        longitudeOffset: Double = 0,
        elevationGainMeters: Int = 120,
        durationHours: Double? = nil,
        path customPath: [Coordinate]? = nil,
        activity: ActivityType = .hiking,
        routeType: TrailRouteType = .loop,
        provenanceOverride: RouteProvenance? = nil,
        routeInstructions: [RouteInstruction] = [],
        verifiedCharacteristics: VerifiedRouteCharacteristics? = nil
    ) -> TrailRoute {
        let path = customPath ?? (routeType == .loop
            ? (0..<14).map { index in
                let phase = Double(index) / 13
                return Coordinate(
                    latitude: 51.8666 + sin(phase * .pi * 2) * 0.015,
                    longitude: 10.6782 + longitudeOffset + cos(phase * .pi * 2) * 0.015,
                    elevationMeters: 200 + Double(index % 4) * 8
                )
            }
            : pointToPointPath(longitudeOffset: longitudeOffset))
        let durationHours = durationHours ?? max(distanceKm / 4, 0.5)
        let difficulty = RouteDifficulty.estimated(
            distanceKilometers: distanceKm,
            elevationGainMeters: elevationGainMeters
        )
        let provenance = RouteProvenance.routingEngineOutput(
            provider: .graphHopper,
            strategy: .backend,
            activity: activity,
            routeType: routeType,
            distanceKilometers: distanceKm,
            elevationGainMeters: elevationGainMeters,
            elevationLossMeters: 118,
            durationHours: durationHours,
            difficulty: difficulty,
            path: path,
            verifiedCharacteristics: verifiedCharacteristics
        )

        return TrailRoute(
            id: UUID(),
            provenance: provenanceOverride ?? provenance,
            title: "\(distanceKm) km test route",
            location: "Germany",
            activity: activity,
            distanceKilometers: distanceKm,
            elevationGainMeters: elevationGainMeters,
            elevationLossMeters: 118,
            durationHours: durationHours,
            difficulty: difficulty,
            routeType: routeType,
            summary: "A test loop.",
            whyItMatches: "Test route.",
            highlights: [],
            waypoints: [],
            days: [],
            safetyNotes: [],
            elevationProfile: [],
            path: path,
            routeInstructions: routeInstructions,
            planningMetadata: request(
                routeType: routeType,
                endQuery: routeType == .loop ? nil : "Schierke",
                activity: activity
            ).metadata,
            verifiedCharacteristics: verifiedCharacteristics
        )
    }

    private static func roadCharacteristics(
        distanceKm: Double,
        majorRoadRatio: Double
    ) -> VerifiedRouteCharacteristics {
        let distanceMeters = distanceKm * 1_000
        let majorRoadDistance = distanceMeters * majorRoadRatio
        return VerifiedRouteCharacteristics(
            routeDistanceMeters: distanceMeters,
            surfaceBreakdown: [],
            roadClassBreakdown: [
                VerifiedRouteCharacteristicValue(
                    value: "primary",
                    distanceMeters: majorRoadDistance
                ),
                VerifiedRouteCharacteristicValue(
                    value: "path",
                    distanceMeters: distanceMeters - majorRoadDistance
                )
            ],
            hikeRatingBreakdown: [],
            surfaceCoverageMeters: 0,
            roadClassCoverageMeters: distanceMeters,
            hikeRatingCoverageMeters: 0
        )
    }

    private static func pointToPointPath(longitudeOffset: Double = 0) -> [Coordinate] {
        (0...12).map { index in
            let progress = Double(index) / 12
            return Coordinate(
                latitude: start.latitude + (end.latitude - start.latitude) * progress + sin(progress * .pi) * 0.002,
                longitude: start.longitude + longitudeOffset + (end.longitude - start.longitude) * progress
            )
        }
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

    private static func resampled(_ coordinates: [Coordinate]) -> [Coordinate] {
        guard let first = coordinates.first else { return [] }
        var result = [first]
        for pair in zip(coordinates, coordinates.dropFirst()) {
            result.append(
                Coordinate(
                    latitude: (pair.0.latitude + pair.1.latitude) / 2,
                    longitude: (pair.0.longitude + pair.1.longitude) / 2
                )
            )
            result.append(pair.1)
        }
        return result
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
