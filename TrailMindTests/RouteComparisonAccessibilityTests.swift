import XCTest
@testable import TrailMind

@MainActor
final class RouteComparisonAccessibilityTests: XCTestCase {
    func testRouteActionSummaryContainsOneBoundedComparisonSemantic() throws {
        let route = TestRouteFixtures.luneburgLoop
        let summary = RouteComparisonAccessibilitySummary(
            route: route,
            comparisonLabel: "Lowest climb"
        )
        let firstLimitation = try XCTUnwrap(
            HikingRouteQualityEngine()
                .presentation(for: route)
                .limitations
                .first
        )

        XCTAssertTrue(summary.label.hasPrefix(route.title))
        XCTAssertTrue(summary.label.contains("Comparison: Lowest climb"))
        XCTAssertTrue(
            summary.label.contains(
                "\(route.activity.rawValue), \(route.difficulty.rawValue) physical effort estimate"
            )
        )
        XCTAssertTrue(summary.label.contains("\(route.distanceLabel) distance"))
        XCTAssertTrue(summary.label.contains("\(route.elevationLabel) climb"))
        XCTAssertTrue(summary.label.contains("\(route.durationLabel) time"))
        XCTAssertTrue(summary.label.contains(firstLimitation.title))
        XCTAssertFalse(summary.label.contains(route.summary))
        XCTAssertLessThanOrEqual(
            summary.label.components(separatedBy: ". ").count,
            6
        )
        XCTAssertEqual(summary.hint, "Opens this route’s details.")
    }

    func testRouteActionSummaryOmitsUnverifiedComparisonCopy() {
        let route = TestRouteFixtures.luneburgLoop
        let summary = RouteComparisonAccessibilitySummary(
            route: route,
            comparisonLabel: "Scenic favorite"
        )

        XCTAssertFalse(summary.label.contains("Comparison:"))
        XCTAssertFalse(summary.label.localizedCaseInsensitiveContains("scenic"))
    }
}
