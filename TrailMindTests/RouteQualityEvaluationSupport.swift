import Foundation
@testable import TrailMind

struct RouteQualityFixture: Decodable, Sendable {
    struct FixtureCoordinate: Decodable, Sendable {
        let latitude: Double
        let longitude: Double

        @MainActor
        var coordinate: Coordinate {
            Coordinate(latitude: latitude, longitude: longitude)
        }
    }

    let id: String
    let region: String
    let startName: String
    let endName: String?
    let start: FixtureCoordinate
    let end: FixtureCoordinate?
    let activityType: String
    let routeType: String
    let targetDistanceKm: Double?
    let targetDurationMinutes: Int?
    let difficulty: String?
    let avoidFeatures: [String]
    let expectedRouteCountCategory: String

    static func load(from testFilePath: String = #filePath) throws -> [RouteQualityFixture] {
        let testFile = URL(fileURLWithPath: testFilePath)
        let fixtureURL = testFile
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("route_quality_eval.json")
        return try JSONDecoder().decode([RouteQualityFixture].self, from: Data(contentsOf: fixtureURL))
    }

    @MainActor
    func routeIntent() throws -> RouteIntent {
        guard let activity = ActivityType(rawValue: activityType) else {
            throw RouteQualityFixtureError.invalidActivity(activityType)
        }
        guard let type = TrailRouteType(rawValue: routeType) else {
            throw RouteQualityFixtureError.invalidRouteType(routeType)
        }
        guard let difficulty = difficulty.flatMap(RouteDifficulty.init(rawValue:)) else {
            if self.difficulty == nil {
                return RouteIntent(
                    request: RoutePlanningRequest(
                        routeType: type,
                        startQuery: startName,
                        endQuery: endName,
                        activityType: activity,
                        graphHopperProfile: graphHopperProfile(for: activity),
                        targetDistanceKm: targetDistanceKm,
                        targetDurationMinutes: targetDurationMinutes,
                        difficulty: nil,
                        desiredFeatures: [],
                        avoidFeatures: try parsedAvoidFeatures()
                    ),
                    start: start.coordinate,
                    end: end?.coordinate
                )
            }
            throw RouteQualityFixtureError.invalidDifficulty(self.difficulty ?? "")
        }

        return RouteIntent(
            request: RoutePlanningRequest(
                routeType: type,
                startQuery: startName,
                endQuery: endName,
                activityType: activity,
                graphHopperProfile: graphHopperProfile(for: activity),
                targetDistanceKm: targetDistanceKm,
                targetDurationMinutes: targetDurationMinutes,
                difficulty: difficulty,
                desiredFeatures: [],
                avoidFeatures: try parsedAvoidFeatures()
            ),
            start: start.coordinate,
            end: end?.coordinate
        )
    }

    private func parsedAvoidFeatures() throws -> [AvoidFeature] {
        try avoidFeatures.map { value in
            guard let feature = AvoidFeature(rawValue: value) else {
                throw RouteQualityFixtureError.invalidAvoidFeature(value)
            }
            return feature
        }
    }

    private func graphHopperProfile(for activity: ActivityType) -> String {
        activity == .biking ? "bike" : "foot"
    }
}

enum RouteQualityFixtureError: LocalizedError {
    case invalidActivity(String)
    case invalidRouteType(String)
    case invalidDifficulty(String)
    case invalidAvoidFeature(String)

    var errorDescription: String? {
        switch self {
        case let .invalidActivity(value): "Invalid route-quality activity: \(value)"
        case let .invalidRouteType(value): "Invalid route-quality type: \(value)"
        case let .invalidDifficulty(value): "Invalid route-quality difficulty: \(value)"
        case let .invalidAvoidFeature(value): "Invalid route-quality avoid feature: \(value)"
        }
    }
}

struct RouteQualityMetrics: Sendable {
    let routeCount: Int
    let comparisonCount: Int
    let primaryDistanceKm: Double?
    let distanceRatio: Double?
    let primaryDurationMinutes: Int?
    let primaryElevationGainMeters: Int?
    let overlapRatio: Double?
    let shapeQualityScore: Double?
    let surfaceCoverageRatio: Double?
    let roadClassCoverageRatio: Double?
    let pathAndTrackRatio: Double?
    let majorRoadRatio: Double?
    let elapsedMilliseconds: Int?
    let directRouteCount: Int
    let fallbackRouteCount: Int
    let rejectionCounts: [String: Int]
    let didReachTimeBudget: Bool
}

struct RouteQualityResult: Sendable {
    let fixture: RouteQualityFixture
    let metrics: RouteQualityMetrics?
    let hardFailures: [String]
    let warnings: [String]
    let routingError: String?
    let providerProof: Bool

    var passed: Bool { hardFailures.isEmpty }
}

struct RouteQualitySummary: Sendable {
    let label: String
    let results: [RouteQualityResult]

    var total: Int { results.count }
    var passed: Int { results.filter(\.passed).count }
    var failed: Int { total - passed }
    var warningCount: Int { results.reduce(0) { $0 + $1.warnings.count } }
    var comparisonCount: Int { results.filter { ($0.metrics?.comparisonCount ?? 0) >= 2 }.count }
    var directRouteCount: Int { results.reduce(0) { $0 + ($1.metrics?.directRouteCount ?? 0) } }
    var fallbackRouteCount: Int { results.reduce(0) { $0 + ($1.metrics?.fallbackRouteCount ?? 0) } }
    var providerProofCount: Int { results.filter(\.providerProof).count }
    var hasCompleteProviderProof: Bool { total > 0 && providerProofCount == total }

    var mostCommonHardFailures: [(String, Int)] {
        commonCategories { $0.hardFailures }
    }

    var mostCommonWarnings: [(String, Int)] {
        commonCategories { $0.warnings }
    }

    func formatted(maxCases: Int = 50) -> String {
        let metrics = results.compactMap(\.metrics)
        var lines = [
            "Route Quality Eval: \(label)",
            "total fixtures: \(total)",
            "passed: \(passed)",
            "failed: \(failed)",
            "warnings: \(warningCount)",
            "comparison results: \(comparisonCount)",
            "direct routes: \(directRouteCount)",
            "fallback routes: \(fallbackRouteCount)",
            "search time median/p95: \(timingLabel(metrics.map(\.elapsedMilliseconds)))",
            "distance ratio median: \(ratioLabel(metrics.map(\.distanceRatio)))",
            "overlap median: \(ratioLabel(metrics.map(\.overlapRatio)))",
            "shape quality median: \(ratioLabel(metrics.map(\.shapeQualityScore)))",
            "surface coverage median: \(ratioLabel(metrics.map(\.surfaceCoverageRatio)))",
            "road-class coverage median: \(ratioLabel(metrics.map(\.roadClassCoverageRatio)))",
            "hard failures: \(categoryLabel(mostCommonHardFailures))",
            "warnings by category: \(categoryLabel(mostCommonWarnings))",
            "cases:"
        ]

        for (index, result) in results.prefix(maxCases).enumerated() {
            let state = result.passed ? (result.warnings.isEmpty ? "PASS" : "WARN") : "FAIL"
            let details = ([
                result.metrics.map { "routes=\($0.routeCount)" },
                result.metrics?.distanceRatio.map { "distance=\(Self.percent($0))" },
                result.metrics?.overlapRatio.map { "overlap=\(Self.percent($0))" },
                result.metrics?.elapsedMilliseconds.map { "time=\($0)ms" },
                !result.hardFailures.isEmpty ? "fail=\(result.hardFailures.joined(separator: ","))" : nil,
                !result.warnings.isEmpty ? "warn=\(result.warnings.joined(separator: ","))" : nil,
                result.routingError.map { _ in "error=redacted" }
            ] as [String?]).compactMap(\.self).joined(separator: " · ")
            lines.append("- [\(state)] case_\(String(format: "%03d", index + 1)) \(details)")
        }

        return lines.joined(separator: "\n")
    }

    private func commonCategories(_ values: (RouteQualityResult) -> [String]) -> [(String, Int)] {
        Dictionary(grouping: results.flatMap(values), by: { $0 })
            .map { ($0.key, $0.value.count) }
            .sorted { lhs, rhs in lhs.1 == rhs.1 ? lhs.0 < rhs.0 : lhs.1 > rhs.1 }
    }

    private func categoryLabel(_ categories: [(String, Int)]) -> String {
        categories.isEmpty ? "none" : categories.map { "\($0.0)=\($0.1)" }.joined(separator: ", ")
    }

    private func timingLabel(_ values: [Int?]) -> String {
        let usable = values.compactMap { $0 }.map(Double.init)
        guard !usable.isEmpty else { return "n/a" }
        return "\(Int(Self.quantile(usable, 0.5)))ms / \(Int(Self.quantile(usable, 0.95)))ms"
    }

    private func ratioLabel(_ values: [Double?]) -> String {
        let usable = values.compactMap { $0 }
        guard !usable.isEmpty else { return "n/a" }
        return Self.percent(Self.quantile(usable, 0.5))
    }

    private static func quantile(_ values: [Double], _ percentile: Double) -> Double {
        let sorted = values.sorted()
        guard !sorted.isEmpty else { return 0 }
        let index = min(max(Int((Double(sorted.count - 1) * percentile).rounded()), 0), sorted.count - 1)
        return sorted[index]
    }

    private static func percent(_ value: Double) -> String {
        "\(Int((value * 100).rounded()))%"
    }
}

@MainActor
struct RouteQualityEvaluator {
    private let coordinator: any RoutingCoordinating

    init(coordinator: any RoutingCoordinating = RoutingCoordinator()) {
        self.coordinator = coordinator
    }

    func evaluate(fixtures: [RouteQualityFixture], label: String) async -> RouteQualitySummary {
        var results: [RouteQualityResult] = []
        for fixture in fixtures {
            results.append(await evaluate(fixture: fixture))
        }
        return RouteQualitySummary(label: label, results: results)
    }

    private func evaluate(fixture: RouteQualityFixture) async -> RouteQualityResult {
        do {
            let intent = try fixture.routeIntent()
            let result = try await coordinator.routeSuggestions(for: intent)
            let metrics = makeMetrics(result: result, intent: intent)
            return RouteQualityResult(
                fixture: fixture,
                metrics: metrics,
                hardFailures: hardFailures(for: intent, result: result, metrics: metrics),
                warnings: warnings(for: fixture, intent: intent, result: result, metrics: metrics),
                routingError: nil,
                providerProof: !result.suggestions.isEmpty
                    && result.suggestions.allSatisfy { $0.route.isVerifiedRoutedResult }
            )
        } catch {
            return RouteQualityResult(
                fixture: fixture,
                metrics: nil,
                hardFailures: ["routing_error"],
                warnings: [],
                routingError: String(describing: error),
                providerProof: false
            )
        }
    }

    private func makeMetrics(result: RoutingResult, intent: RouteIntent) -> RouteQualityMetrics {
        let primaryRoute = result.suggestions.first?.route
        let quality = primaryRoute.map(LoopFallbackProvider.qualityAnalysis)
        let characteristics = primaryRoute?.verifiedCharacteristics
        let diagnostics = result.loopSearchDiagnostics
        return RouteQualityMetrics(
            routeCount: result.suggestions.count,
            comparisonCount: result.suggestions.count >= 2 ? result.suggestions.count : 0,
            primaryDistanceKm: primaryRoute?.distanceKilometers,
            distanceRatio: primaryRoute.flatMap { route in
                intent.request.targetDistanceKm.map { route.distanceKilometers / $0 }
            },
            primaryDurationMinutes: primaryRoute?.durationMinutes,
            primaryElevationGainMeters: primaryRoute?.elevationGainMeters,
            overlapRatio: intent.request.routeType == .loop ? quality?.overlapRatio : nil,
            shapeQualityScore: intent.request.routeType == .loop ? quality?.shapeQualityScore : nil,
            surfaceCoverageRatio: characteristics?.surfaceCoverageRatio,
            roadClassCoverageRatio: characteristics?.roadClassCoverageRatio,
            pathAndTrackRatio: characteristics?.pathAndTrackRatio,
            majorRoadRatio: characteristics?.majorRoadRatio,
            elapsedMilliseconds: diagnostics?.elapsedMilliseconds,
            directRouteCount: diagnostics?.directRouteCount ?? result.suggestions.count,
            fallbackRouteCount: diagnostics?.fallbackRouteCount ?? 0,
            rejectionCounts: diagnostics?.rejectionCounts ?? [:],
            didReachTimeBudget: diagnostics?.didReachTimeBudget ?? false
        )
    }

    private func hardFailures(
        for intent: RouteIntent,
        result: RoutingResult,
        metrics: RouteQualityMetrics
    ) -> [String] {
        guard let route = result.suggestions.first?.route else { return ["no_usable_route"] }
        var failures: [String] = []

        if route.path.count < 2 || !route.distanceKilometers.isFinite || route.distanceKilometers <= 0 || route.durationMinutes <= 0 {
            failures.append("invalid_route_metrics")
        }

        guard intent.request.routeType == .loop else { return failures }
        if !LoopFallbackProvider.hasUsableGeometry(route) {
            failures.append("invalid_loop_geometry")
        }
        if let targetDistanceKm = intent.request.targetDistanceKm,
           LoopFallbackProvider.distanceRejectionReason(route: route, targetDistanceKm: targetDistanceKm) != nil
        {
            failures.append("loop_distance_outside_hard_envelope")
        }
        if let overlapRatio = metrics.overlapRatio,
           let shapeQualityScore = metrics.shapeQualityScore,
           !LoopFallbackProvider.acceptsLoopQuality(
               .init(overlapRatio: overlapRatio, shapeQualityScore: shapeQualityScore)
           )
        {
            failures.append("loop_geometry_quality_rejected")
        }
        return failures
    }

    private func warnings(
        for fixture: RouteQualityFixture,
        intent: RouteIntent,
        result: RoutingResult,
        metrics: RouteQualityMetrics
    ) -> [String] {
        var warnings: [String] = []
        if intent.request.routeType == .loop, metrics.routeCount == 1 {
            warnings.append("single_loop_route")
        }
        if intent.request.routeType == .loop,
           fixture.expectedRouteCountCategory == "comparisonPreferred",
           metrics.comparisonCount < 2
        {
            warnings.append("comparison_not_available")
        }
        if let distanceRatio = metrics.distanceRatio,
           !(0.75...1.25).contains(distanceRatio)
        {
            warnings.append("soft_distance_miss")
        }
        if metrics.didReachTimeBudget {
            warnings.append("time_budget_reached")
        }
        if metrics.fallbackRouteCount > 0 {
            warnings.append("fallback_used")
        }
        if let surfaceCoverageRatio = metrics.surfaceCoverageRatio,
           surfaceCoverageRatio > 0
        {
            if surfaceCoverageRatio < VerifiedRouteCharacteristics.minimumDisplayCoverage {
                warnings.append("low_surface_coverage")
            }
        } else {
            warnings.append("surface_data_unavailable")
        }
        if let roadClassCoverageRatio = metrics.roadClassCoverageRatio,
           roadClassCoverageRatio > 0
        {
            if roadClassCoverageRatio < VerifiedRouteCharacteristics.minimumDisplayCoverage {
                warnings.append("low_road_class_coverage")
            }
        } else {
            warnings.append("road_class_data_unavailable")
        }
        if intent.request.avoidFeatures.contains(.majorRoads),
           let majorRoadRatio = metrics.majorRoadRatio,
           majorRoadRatio > 0.10
        {
            warnings.append("major_road_exposure")
        }
        if result.loopSearchDiagnostics?.rejectionCounts.isEmpty == false {
            warnings.append("candidate_rejections")
        }
        return warnings
    }
}
