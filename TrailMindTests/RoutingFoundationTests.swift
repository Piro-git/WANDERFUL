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
            "GraphHopper could not build a direct round trip, so TrailMind tried alternate loop shapes from the same start."
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
        XCTAssertEqual(result.suggestions.map(\.explanation), ["Closest Match", "Shorter Loop", "Longer Loop"])
        XCTAssertEqual(primary.requestedIntents.count, 1)
        XCTAssertEqual(fallback.requestedIntents.count, 1)
        XCTAssertEqual(
            result.notice,
            "TrailMind found distinct real loop options from the same start for comparison."
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
        XCTAssertEqual(result.suggestions.map(\.explanation), ["Closest Match", "Loop Option"])
        XCTAssertEqual(fallback.requestedIntents.count, 1)
        XCTAssertEqual(
            result.notice,
            "TrailMind found distinct real loop options from the same start for comparison."
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
        XCTAssertEqual(result.suggestions.map(\.explanation), ["Closest Match", "Longer Loop"])
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

        XCTAssertEqual(ranked.map(\.seed), [29])
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
        XCTAssertEqual(ranked.first?.route.planningMetadata?.variantLabel, "Closest Match")
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
            "Closest available mapped loop to your 15 km request."
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
        elevationGainMeters: Int = 120,
        durationHours: Double? = nil,
        path customPath: [Coordinate]? = nil,
        provenanceOverride: RouteProvenance? = nil,
        routeInstructions: [RouteInstruction] = []
    ) -> TrailRoute {
        let path = customPath ?? (0..<14).map { index in
            let phase = Double(index) / 13
            return Coordinate(
                latitude: 51.8666 + sin(phase * .pi * 2) * 0.015,
                longitude: 10.6782 + longitudeOffset + cos(phase * .pi * 2) * 0.015,
                elevationMeters: 200 + Double(index % 4) * 8
            )
        }
        let durationHours = durationHours ?? max(distanceKm / 4, 0.5)
        let difficulty = RouteDifficulty.estimated(
            distanceKilometers: distanceKm,
            elevationGainMeters: elevationGainMeters
        )
        let provenance = RouteProvenance.routingEngineOutput(
            provider: .graphHopper,
            strategy: .backend,
            activity: .hiking,
            routeType: .loop,
            distanceKilometers: distanceKm,
            elevationGainMeters: elevationGainMeters,
            elevationLossMeters: 118,
            durationHours: durationHours,
            difficulty: difficulty,
            path: path,
            verifiedCharacteristics: nil
        )

        return TrailRoute(
            id: UUID(),
            provenance: provenanceOverride ?? provenance,
            title: "\(distanceKm) km Hike loop around Ilsenburg",
            location: "Germany",
            activity: .hiking,
            distanceKilometers: distanceKm,
            elevationGainMeters: elevationGainMeters,
            elevationLossMeters: 118,
            durationHours: durationHours,
            difficulty: difficulty,
            routeType: .loop,
            summary: "A test loop.",
            whyItMatches: "Test route.",
            highlights: [],
            waypoints: [],
            days: [],
            safetyNotes: [],
            elevationProfile: [],
            path: path,
            routeInstructions: routeInstructions,
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
