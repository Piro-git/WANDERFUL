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
            suggestions: [RouteSuggestion(route: route, matchScore: 90, explanation: "test")],
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
        let route = Self.loopRoute(distanceKm: 25, path: [Coordinate(latitude: 51.76, longitude: 10.66)])
        let result = RoutingResult(
            suggestions: [RouteSuggestion(route: route, matchScore: 50, explanation: "test")],
            notice: nil
        )

        let summary = await RouteQualityEvaluator(coordinator: StubRoutingCoordinator(result: result))
            .evaluate(fixtures: [fixture], label: "stub")
        let evaluation = try XCTUnwrap(summary.results.first)

        XCTAssertFalse(evaluation.passed)
        XCTAssertTrue(evaluation.hardFailures.contains("invalid_route_metrics"))
        XCTAssertTrue(evaluation.hardFailures.contains("invalid_loop_geometry"))
        XCTAssertTrue(evaluation.hardFailures.contains("loop_distance_outside_hard_envelope"))
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
            suggestions: [RouteSuggestion(route: route, matchScore: 90, explanation: "test")],
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
            suggestions: [RouteSuggestion(route: route, matchScore: 90, explanation: "test")],
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
            suggestions: [RouteSuggestion(route: route, matchScore: 90, explanation: "test")],
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
        XCTAssertTrue(output.contains("candidate_rejections"))
    }

    func testLiveRouteQualityEvalWhenEnabled() async throws {
        guard ProcessInfo.processInfo.environment["TRAILMIND_RUN_ROUTE_QUALITY_EVAL"] == "1" else {
            throw XCTSkip("Set TRAILMIND_RUN_ROUTE_QUALITY_EVAL=1 to run live GraphHopper route-quality evaluation.")
        }
        do {
            _ = try GraphHopperConfiguration.local()
        } catch {
            throw XCTSkip("GraphHopper is not configured for this test environment.")
        }

        let summary = await RouteQualityEvaluator().evaluate(
            fixtures: try RouteQualityFixture.load(),
            label: "live GraphHopper"
        )
        print("\n\(summary.formatted())")

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
            title: "Test loop",
            location: "Germany",
            activity: activity,
            distanceKilometers: distanceKm,
            elevationGainMeters: 220,
            durationHours: 3,
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
