import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class ReleaseSurfaceTruthTests: XCTestCase {
    func testReleaseCompositionExcludesMockAndDeveloperSurfaces() throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let releaseCompositionFiles = [
            "TrailMind/App/TrailMindApp.swift",
            "TrailMind/Views/Home/HomeView.swift",
            "TrailMind/ViewModels/AppModels.swift",
            "TrailMind/Views/Onboarding/OnboardingView.swift",
            "TrailMind/Views/Profile/ProfilePreferencesView.swift",
            "TrailMind/Views/Route/RouteDetailView.swift",
            "TrailMind/Views/AIEdit/RouteEditAIView.swift",
            "TrailMind/Services/TrailServices.swift",
            "TrailMind/Data/MockRoutes.swift"
        ]
        let forbiddenReleaseTerms = [
            "MockRoutes",
            "MockAIPlannerService",
            "MockRoutingService",
            "RouteEditAIView",
            "LIVE ROUTING DEMO",
            "generateHarzDemoRoute",
            "Continue outside",
            "Recent plans",
            "Near you",
            "Edit with AI",
            "Start route",
            "Prefer offline-ready routes",
            "Coming next"
        ]

        for relativePath in releaseCompositionFiles {
            let fileURL = repositoryURL.appendingPathComponent(relativePath)
            let source = try String(contentsOf: fileURL, encoding: .utf8)
            let releaseSource = sourceExcludingDebugBlocks(source)

            for term in forbiddenReleaseTerms {
                XCTAssertFalse(
                    releaseSource.contains(term),
                    "Release source \(relativePath) still contains \(term)."
                )
            }
        }
    }

    func testReleaseTabSetContainsOnlyTruthfulSurfaces() {
        XCTAssertEqual(AppTab.allCases, [.plan, .saved, .profile])
    }

    func testOnboardingRetainsThreePagesWithoutUnsupportedClaims() {
        XCTAssertEqual(OnboardingView.pages.count, 3)
        let copy = OnboardingView.pages
            .flatMap { [$0.eyebrow, $0.title, $0.body] }
            .joined(separator: " ")

        XCTAssertFalse(copy.localizedCaseInsensitiveContains("two days"))
        XCTAssertFalse(copy.localizedCaseInsensitiveContains("practical stops"))
        XCTAssertFalse(copy.localizedCaseInsensitiveContains("exposure"))
        XCTAssertTrue(copy.localizedCaseInsensitiveContains("planning aid"))
        XCTAssertTrue(copy.localizedCaseInsensitiveContains("not live navigation"))
    }

    func testUnverifiedAndLegacyRoutesDoNotExposeProductionActions() {
        let demoPresentation = RouteDetailPresentation(route: MockRoutes.luneburgLoop)
        let legacyPresentation = RouteDetailPresentation(route: TestRouteFixtures.legacyRoute)

        XCTAssertFalse(demoPresentation.allowsProductionActions)
        XCTAssertEqual(demoPresentation.verificationTitle, "Demo route")
        XCTAssertFalse(legacyPresentation.allowsProductionActions)
        XCTAssertEqual(legacyPresentation.verificationTitle, "Unverified saved route")
        XCTAssertNotNil(legacyPresentation.verificationMessage)
    }

    func testVerifiedRouteExposesProductionActions() {
        let presentation = RouteDetailPresentation(route: TestRouteFixtures.luneburgLoop)

        XCTAssertTrue(presentation.allowsProductionActions)
        XCTAssertNil(presentation.verificationTitle)
        XCTAssertNil(presentation.verificationMessage)
    }

    func testRequestedDifficultyIsPresentedAsARequest() {
        let metadata = RoutePlanningMetadata(
            routeType: .loop,
            activityType: .hiking,
            targetDistanceKm: 12,
            targetDurationMinutes: nil,
            difficulty: .easy,
            desiredFeatures: [],
            avoidFeatures: []
        )
        let route = TestRouteFixtures.luneburgLoop.withPlanningMetadata(metadata)
        let presentation = RouteDetailPresentation(route: route)

        XCTAssertEqual(presentation.requestedDifficultyLabel, "Requested: Easy")
        XCTAssertNotEqual(presentation.requestedDifficultyLabel, "Easy")
    }

    private func sourceExcludingDebugBlocks(_ source: String) -> String {
        var debugDepth = 0
        var releaseLines: [Substring] = []

        for line in source.split(separator: "\n", omittingEmptySubsequences: false) {
            let directive = String(line).trimmingCharacters(in: .whitespaces)
            if directive == "#if DEBUG" {
                debugDepth += 1
                continue
            }
            if debugDepth > 0, directive.hasPrefix("#if ") {
                debugDepth += 1
                continue
            }
            if debugDepth > 0, directive == "#endif" {
                debugDepth -= 1
                continue
            }
            if debugDepth == 0 {
                releaseLines.append(line)
            }
        }

        return releaseLines.joined(separator: "\n")
    }
}
