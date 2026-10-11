import XCTest
@testable import TrailMind

@MainActor
final class RouteLocalizedCopyTests: XCTestCase {
    func testLanguageChangesPresentationWithoutRewritingTheRoute() throws {
        let suite = "RouteLocalizedCopyTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let controller = AppLanguageController(defaults: defaults)
        var route = TestRouteFixtures.luneburgLoop
        route.dynamicRouteOutcome = .init(isPartial: true, hasUnresolvedWishes: true)
        let originalTitle = route.title, originalPath = route.path
        controller.select(.german)
        let de = RouteLocalizedCopy(route: route, language: controller.language)
        XCTAssertTrue(de.title.contains("Wandern · Rundtour"))
        XCTAssertTrue(de.title.contains(route.location))
        XCTAssertTrue(de.summary.contains("Teilweise passend"))
        XCTAssertTrue(de.summary.contains(de.distance))
        XCTAssertTrue(de.outcomeExplanation.contains("Trinkwasserverfügbarkeit sind nicht bestätigt"))
        XCTAssertTrue(de.outcomeDetails.contains { $0.contains("nicht alle Vorlieben sind bestätigt") })
        XCTAssertEqual(de.distance(12.5), "12,5 km")
        controller.select(.english)
        let en = RouteLocalizedCopy(route: route, language: controller.language)
        XCTAssertTrue(en.title.contains("Hiking · Loop"))
        XCTAssertTrue(en.summary.contains("Partial match"))
        XCTAssertTrue(en.outcomeExplanation.contains("drinking water availability are not verified"))
        XCTAssertEqual(en.distance(12.5), "12.5 km")
        XCTAssertFalse(en.outcomeExplanation.contains("GraphHopper"))
        XCTAssertFalse(de.outcomeExplanation.contains("GraphHopper"))
        XCTAssertEqual(route.title, originalTitle)
        XCTAssertEqual(route.path, originalPath)
        XCTAssertTrue(route.isVerifiedRoutedResult)
        XCTAssertEqual(route.withPlanningMetadata(route.planningMetadata).dynamicRouteOutcome, route.dynamicRouteOutcome)
    }

    func testExistingNamesRemainVerbatimWithoutFreshGeneratedOutcome() {
        let route = TestRouteFixtures.luneburgLoop
        for language in AppLanguage.allCases {
            let copy = RouteLocalizedCopy(route: route, language: language)
            XCTAssertEqual(copy.title, route.title)
            XCTAssertEqual(copy.summary, route.summary)
            XCTAssertTrue(copy.outcomeDetails.isEmpty)
        }
    }

    func testGermanComparisonKeepsFactsAndUnknownTechnicalDifficulty() {
        let route = TestRouteFixtures.luneburgLoop
        let summary = RouteComparisonAccessibilitySummary(route: route, comparisonLabel: "Lowest climb", language: .german)
        XCTAssertTrue(summary.label.hasPrefix(route.title))
        XCTAssertTrue(summary.label.contains("Vergleich: Geringster Aufstieg"))
        XCTAssertTrue(summary.label.contains("Strecke"))
        XCTAssertTrue(summary.label.contains("Aufstieg"))
        XCTAssertTrue(summary.label.contains("Zeit"))
        XCTAssertTrue(summary.label.contains("Wichtige Einschränkung"))
        XCTAssertFalse(summary.label.contains(route.summary))
        XCTAssertEqual(summary.hint, "Öffnet die Routendetails.")
        let rejected = RouteComparisonAccessibilitySummary(route: route, comparisonLabel: "Scenic favorite", language: .german)
        XCTAssertFalse(rejected.label.contains("Scenic"))
        XCTAssertFalse(rejected.label.contains("Vergleich:"))
    }

    func testEvidenceUsesTypedCodeRatherThanTranslatingUntrustedCopy() {
        let route = TestRouteFixtures.luneburgLoop
        let item = RouteQualityPresentationItem(role: .limitation, code: .technicalDifficultyUnavailable,
            title: "Safe drinking water is guaranteed", detail: "100% safe", symbol: "questionmark.circle", accessibilityLabel: "Safe")
        let copy = RouteLocalizedCopy(route: route, language: .german).evidence(item)
        XCTAssertEqual(copy.title, "Technische Wegschwierigkeit unbekannt")
        XCTAssertTrue(copy.detail?.contains("belegen nicht") == true)
        XCTAssertFalse(copy.accessibilityLabel.contains("100%"))
        XCTAssertFalse(copy.accessibilityLabel.contains("Safe"))
    }
}
