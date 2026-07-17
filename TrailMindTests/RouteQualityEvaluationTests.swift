import XCTest
@testable import TrailMind

@MainActor
final class RouteQualityEvaluationTests: XCTestCase {
    func testRouteQualityFixturesDecodeAndCoverPlannedFamilies() throws {
        let fixtures = try RouteQualityFixture.load()

        XCTAssertEqual(fixtures.count, 20)
        XCTAssertEqual(fixtures.filter { $0.routeType == TrailRouteType.loop.rawValue }.count, 14)
        XCTAssertEqual(fixtures.filter { $0.routeType == TrailRouteType.pointToPoint.rawValue }.count, 6)
        XCTAssertTrue(fixtures.contains { $0.region == "Harz" })
        XCTAssertTrue(fixtures.contains { $0.region == "Lueneburg Heath" })
        XCTAssertTrue(fixtures.contains { $0.region == "Southern Germany" })
        XCTAssertTrue(fixtures.contains { $0.activityType == ActivityType.hiking.rawValue })
        XCTAssertTrue(fixtures.contains { $0.activityType == ActivityType.trailRunning.rawValue })
        XCTAssertTrue(fixtures.contains { $0.activityType == ActivityType.biking.rawValue })
        XCTAssertTrue(fixtures.contains { $0.targetDurationMinutes != nil })
        XCTAssertTrue(fixtures.contains { $0.avoidFeatures.contains(AvoidFeature.majorRoads.rawValue) })
        XCTAssertTrue(fixtures.contains { $0.avoidFeatures.contains(AvoidFeature.steepClimbs.rawValue) })
        XCTAssertTrue(fixtures.contains { $0.avoidFeatures.contains(AvoidFeature.repeatedPath.rawValue) })
        XCTAssertTrue(fixtures.allSatisfy { (try? $0.routeIntent()) != nil })
    }

    func testSingleValidLoopIsWarningNotHardFailure() async throws {
        let fixture = try XCTUnwrap(try RouteQualityFixture.load().first { $0.id == "schierke-hike-15" })
        let route = Self.loopRoute(distanceKm: 15, characteristics: nil)
        let result = RoutingResult(
            suggestions: [RouteSuggestion(route: route, explanation: "test")],
            notice: nil,
            loopSearchDiagnostics: LoopSearchDiagnostics.empty(elapsedMilliseconds: 180)
        )

        let summary = await RouteQualityEvaluator(coordinator: StubRoutingCoordinator(result: result))
            .evaluate(fixtures: [fixture], label: "stub")
        let evaluation = try XCTUnwrap(summary.results.first)

        XCTAssertTrue(evaluation.passed)
        XCTAssertTrue(evaluation.warnings.contains("single_loop_route"))
        XCTAssertTrue(evaluation.warnings.contains("comparison_not_available"))
        XCTAssertTrue(evaluation.warnings.contains("surface_data_unavailable"))
    }

    func testMalformedLoopGeometryAndHardDistanceMissFail() async throws {
        let fixture = try XCTUnwrap(try RouteQualityFixture.load().first { $0.id == "schierke-hike-15" })
        let malformedRoute = Self.loopRoute(
            distanceKm: 15,
            path: [Coordinate(latitude: 51.76, longitude: 10.66)]
        )
        let hardDistanceMiss = Self.loopRoute(distanceKm: 30)
        let result = RoutingResult(
            suggestions: [
                RouteSuggestion(route: malformedRoute, explanation: "malformed"),
                RouteSuggestion(route: hardDistanceMiss, explanation: "distance miss")
            ],
            notice: nil
        )

        let summary = await RouteQualityEvaluator(coordinator: StubRoutingCoordinator(result: result))
            .evaluate(fixtures: [fixture], label: "stub")
        let evaluation = try XCTUnwrap(summary.results.first)

        XCTAssertFalse(evaluation.passed)
        XCTAssertTrue(evaluation.hardFailures.contains("invalid_route_metrics"))
        XCTAssertTrue(evaluation.hardFailures.contains("route_quality_invalid_geometry"))
        XCTAssertTrue(evaluation.hardFailures.contains("route_quality_distance_outside_hard_envelope"))
    }

    func testPartialSurfaceDataWarnsWithoutFailing() async throws {
        let fixture = try XCTUnwrap(try RouteQualityFixture.load().first { $0.id == "schierke-hike-15" })
        let characteristics = VerifiedRouteCharacteristics(
            routeDistanceMeters: 10_000,
            surfaceBreakdown: [VerifiedRouteCharacteristicValue(value: "gravel", distanceMeters: 4_000)],
            roadClassBreakdown: [],
            hikeRatingBreakdown: [],
            surfaceCoverageMeters: 4_000,
            roadClassCoverageMeters: 0,
            hikeRatingCoverageMeters: 0
        )
        let route = Self.loopRoute(distanceKm: 15, characteristics: characteristics)
        let result = RoutingResult(
            suggestions: [RouteSuggestion(route: route, explanation: "test")],
            notice: nil
        )

        let summary = await RouteQualityEvaluator(coordinator: StubRoutingCoordinator(result: result))
            .evaluate(fixtures: [fixture], label: "stub")
        let evaluation = try XCTUnwrap(summary.results.first)

        XCTAssertTrue(evaluation.passed)
        XCTAssertTrue(evaluation.warnings.contains("low_surface_coverage"))
        XCTAssertTrue(evaluation.warnings.contains("road_class_data_unavailable"))
    }

    func testMajorRoadExposureIsWarningOnlyForRoadAvoidance() async throws {
        let fixture = try XCTUnwrap(try RouteQualityFixture.load().first { $0.id == "lueneburg-bike-15-roads" })
        let characteristics = VerifiedRouteCharacteristics(
            routeDistanceMeters: 10_000,
            surfaceBreakdown: [VerifiedRouteCharacteristicValue(value: "asphalt", distanceMeters: 10_000)],
            roadClassBreakdown: [VerifiedRouteCharacteristicValue(value: "primary", distanceMeters: 2_000)],
            hikeRatingBreakdown: [],
            surfaceCoverageMeters: 10_000,
            roadClassCoverageMeters: 10_000,
            hikeRatingCoverageMeters: 0
        )
        let route = Self.loopRoute(distanceKm: 15, activity: .biking, characteristics: characteristics)
        let result = RoutingResult(
            suggestions: [RouteSuggestion(route: route, explanation: "test")],
            notice: nil
        )

        let summary = await RouteQualityEvaluator(coordinator: StubRoutingCoordinator(result: result))
            .evaluate(fixtures: [fixture], label: "stub")
        let evaluation = try XCTUnwrap(summary.results.first)

        XCTAssertTrue(evaluation.passed)
        XCTAssertTrue(evaluation.warnings.contains("major_road_exposure"))
    }

    func testSummaryIncludesMetricsAndCategories() async throws {
        let fixture = try XCTUnwrap(try RouteQualityFixture.load().first { $0.id == "schierke-hike-15" })
        let route = Self.loopRoute(distanceKm: 15)
        let result = RoutingResult(
            suggestions: [RouteSuggestion(route: route, explanation: "test")],
            notice: nil,
            loopSearchDiagnostics: LoopSearchDiagnostics(
                elapsedMilliseconds: 500,
                directRouteCount: 1,
                fallbackRouteCount: 1,
                rejectionCounts: ["duplicate_geometry": 1],
                didReachTimeBudget: false
            )
        )

        let summary = await RouteQualityEvaluator(coordinator: StubRoutingCoordinator(result: result))
            .evaluate(fixtures: [fixture], label: "stub")
        let output = summary.formatted()

        XCTAssertTrue(output.contains("total fixtures: 1"))
        XCTAssertTrue(output.contains("search time median/p95: 500ms / 500ms"))
        XCTAssertTrue(output.contains("fallback routes: 1"))
        XCTAssertTrue(output.contains("maximum loop closure gap median:"))
        XCTAssertTrue(output.contains("maximum pairwise similarity median:"))
        XCTAssertTrue(output.contains("candidate_rejections"))
    }

    func testEvaluationRejectsReversedDuplicateAlternatives() async throws {
        let fixture = try XCTUnwrap(try RouteQualityFixture.load().first { $0.id == "schierke-hike-15" })
        let path = Self.cleanLoopPath()
        let result = RoutingResult(
            suggestions: [
                RouteSuggestion(route: Self.loopRoute(distanceKm: 15, path: path), explanation: "one"),
                RouteSuggestion(
                    route: Self.loopRoute(distanceKm: 15.1, path: Array(path.reversed())),
                    explanation: "two"
                )
            ],
            notice: nil
        )

        let summary = await RouteQualityEvaluator(coordinator: StubRoutingCoordinator(result: result))
            .evaluate(fixtures: [fixture], label: "stub")
        let evaluation = try XCTUnwrap(summary.results.first)

        XCTAssertEqual(evaluation.metrics?.distinctRouteCount, 1)
        XCTAssertGreaterThan(evaluation.metrics?.maximumPairwiseSimilarity ?? 0, 0.95)
        XCTAssertTrue(evaluation.hardFailures.contains("near_duplicate_alternatives"))
    }

    func testEvaluationChecksClosureForEveryLoopAlternative() async throws {
        let fixture = try XCTUnwrap(try RouteQualityFixture.load().first { $0.id == "schierke-hike-15" })
        let openPath = Array(Self.cleanLoopPath().dropLast(4))
        let result = RoutingResult(
            suggestions: [
                RouteSuggestion(route: Self.loopRoute(distanceKm: 15), explanation: "closed"),
                RouteSuggestion(route: Self.loopRoute(distanceKm: 15.2, path: openPath), explanation: "open")
            ],
            notice: nil
        )

        let summary = await RouteQualityEvaluator(coordinator: StubRoutingCoordinator(result: result))
            .evaluate(fixtures: [fixture], label: "stub")
        let evaluation = try XCTUnwrap(summary.results.first)

        XCTAssertEqual(evaluation.metrics?.allLoopsClosed, false)
        XCTAssertTrue(evaluation.hardFailures.contains("open_loop_geometry"))
        XCTAssertTrue(evaluation.hardFailures.contains("route_quality_open_loop"))
    }

    func testEvaluationSummaryRedactsFixtureAndProviderError() {
        let fixture = RouteQualityFixture(
            id: "private-fixture-identifier",
            region: "private region",
            startName: "private start",
            endName: nil,
            start: .init(latitude: 12.345678, longitude: 87.654321),
            end: nil,
            activityType: ActivityType.hiking.rawValue,
            routeType: TrailRouteType.loop.rawValue,
            targetDistanceKm: 10,
            targetDurationMinutes: nil,
            difficulty: nil,
            avoidFeatures: [],
            expectedRouteCountCategory: "singleAcceptable"
        )
        let summary = RouteQualitySummary(
            label: "redaction test",
            results: [RouteQualityResult(
                fixture: fixture,
                metrics: nil,
                hardFailures: ["routing_error"],
                warnings: [],
                routingError: "private raw provider response",
                providerProof: false
            )]
        )

        let output = summary.formatted()
        XCTAssertFalse(output.contains(fixture.id))
        XCTAssertFalse(output.contains("12.345678"))
        XCTAssertFalse(output.contains("private raw provider response"))
        XCTAssertTrue(output.contains("case_001"))
        XCTAssertTrue(output.contains("error=redacted"))
    }

    func testEvaluationHarnessControl() throws {
        switch ProcessInfo.processInfo.environment["TRAILMIND_EVAL_HARNESS_MODE"] {
        case nil:
            return
        case "pass":
            try LiveEvaluationMachineSummary(
                evaluation: "route-quality",
                totalCount: 1,
                passedCount: 1,
                failedCount: 0,
                skippedCount: 0,
                providerProof: false
            ).emit()
        case "skip":
            try LiveEvaluationMachineSummary(
                evaluation: "route-quality",
                totalCount: 1,
                passedCount: 0,
                failedCount: 0,
                skippedCount: 1,
                providerProof: false
            ).emit()
            throw XCTSkip("Controlled evaluation harness skip.")
        case "fail":
            try LiveEvaluationMachineSummary(
                evaluation: "route-quality",
                totalCount: 1,
                passedCount: 0,
                failedCount: 1,
                skippedCount: 0,
                providerProof: false
            ).emit()
            XCTFail("Controlled evaluation harness failure.")
        default:
            XCTFail("Unsupported controlled evaluation harness mode.")
        }
    }

    func testLiveRouteQualityEvalWhenEnabled() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["TRAILMIND_RUN_ROUTE_QUALITY_EVAL"] == "1" else {
            throw XCTSkip("Set TRAILMIND_RUN_ROUTE_QUALITY_EVAL=1 to run live GraphHopper route-quality evaluation.")
        }
        guard environment["TRAILMIND_EVAL_CREDENTIALS_CONTAINED"] == "1",
              environment["TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED"] == "1" else {
            throw XCTSkip("Credential containment and provider usage authorization are required.")
        }

        let fixtures = try RouteQualityFixture.load()
        guard fixtures.count == 20 else {
            try LiveEvaluationMachineSummary(
                evaluation: "route-quality",
                totalCount: fixtures.count,
                passedCount: 0,
                failedCount: fixtures.count,
                skippedCount: 0,
                providerProof: false
            ).emit()
            XCTFail("The authorized route-quality baseline requires exactly 20 fixtures.")
            return
        }
        let summary = await RouteQualityEvaluator().evaluate(
            fixtures: fixtures,
            label: "live backend routing"
        )
        let providerProof = summary.hasCompleteProviderProof
        try LiveEvaluationMachineSummary(
            evaluation: "route-quality",
            totalCount: summary.total,
            passedCount: summary.passed,
            failedCount: summary.failed,
            skippedCount: 0,
            providerProof: providerProof
        ).emit()
        print("\n\(summary.formatted())")

        XCTAssertEqual(summary.total, 20)
        XCTAssertTrue(providerProof, "Not every fixture produced verified routed provider output.")
        XCTAssertEqual(summary.failed, 0, summary.formatted())
    }

    private static func loopRoute(
        distanceKm: Double,
        activity: ActivityType = .hiking,
        path: [Coordinate]? = nil,
        characteristics: VerifiedRouteCharacteristics? = nil
    ) -> TrailRoute {
        let routePath = path ?? cleanLoopPath()
        return TrailRoute(
            id: UUID(),
            provenance: .demo(.testFixture),
            title: "Test loop",
            location: "Germany",
            activity: activity,
            distanceKilometers: distanceKm,
            elevationGainMeters: 220,
            durationHours: activity == .biking ? 1 : 3,
            difficulty: .moderate,
            routeType: .loop,
            summary: "Test route",
            whyItMatches: "Test route",
            highlights: [],
            waypoints: [],
            days: [],
            safetyNotes: [],
            elevationProfile: [],
            path: routePath,
            planningMetadata: RoutePlanningRequest(
                routeType: .loop,
                startQuery: "Schierke",
                endQuery: nil,
                activityType: activity,
                graphHopperProfile: activity == .biking ? "bike" : "foot",
                targetDistanceKm: 15,
                targetDurationMinutes: nil,
                difficulty: nil,
                desiredFeatures: []
            ).metadata,
            verifiedCharacteristics: characteristics
        )
    }

    private static func cleanLoopPath() -> [Coordinate] {
        let center = Coordinate(latitude: 51.7636, longitude: 10.6647)
        return (0...12).map { index in
            let angle = Double(index) / 12 * 2 * .pi
            return Coordinate(
                latitude: center.latitude + sin(angle) * 0.012,
                longitude: center.longitude + cos(angle) * 0.018
            )
        }
    }
}

private struct StubRoutingCoordinator: RoutingCoordinating {
    let result: RoutingResult

    func routeSuggestions(for intent: RouteIntent) async throws -> RoutingResult {
        result
    }
}
