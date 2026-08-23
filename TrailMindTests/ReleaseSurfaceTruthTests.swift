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

    func testOnboardingUsesAFocusedEightStepFlowWithoutUnsupportedClaims() {
        XCTAssertEqual(OnboardingView.pages.count, 8)
        XCTAssertEqual(OnboardingView.pages.first?.title, "Your perfect day, mapped.")
        let copy = OnboardingView.pages
            .flatMap { [$0.eyebrow, $0.title, $0.body] }
            .joined(separator: " ")

        XCTAssertFalse(copy.localizedCaseInsensitiveContains("two days"))
        XCTAssertFalse(copy.localizedCaseInsensitiveContains("practical stops"))
        XCTAssertFalse(copy.localizedCaseInsensitiveContains("exposure"))
        XCTAssertTrue(copy.localizedCaseInsensitiveContains("planning aid"))
        XCTAssertTrue(copy.localizedCaseInsensitiveContains("not live navigation"))
        XCTAssertTrue(copy.localizedCaseInsensitiveContains("requested preferences"))
        XCTAssertTrue(copy.localizedCaseInsensitiveContains("I don’t know yet"))
        XCTAssertTrue(copy.localizedCaseInsensitiveContains("what you ask for later always wins"))
        XCTAssertTrue(copy.localizedCaseInsensitiveContains("real route"))
        XCTAssertTrue(copy.localizedCaseInsensitiveContains("distance, time and elevation"))
        XCTAssertFalse(copy.localizedCaseInsensitiveContains("a few optional answers"))
    }

    func testEveryOnboardingStepUsesItsOwnIllustration() {
        let assets = OnboardingView.Step.allCases.map(\.illustrationAssetName)

        XCTAssertEqual(assets.count, OnboardingView.pages.count)
        XCTAssertEqual(Set(assets).count, assets.count)
    }

    func testV1OnboardingDoesNotConfigureOrPresentSuperwallBeforeProductValue() throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let appSource = try String(
            contentsOf: repositoryURL.appendingPathComponent("TrailMind/App/TrailMindApp.swift"),
            encoding: .utf8
        )
        let hostSource = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "TrailMind/Views/Onboarding/SuperwallOnboardingHost.swift"
            ),
            encoding: .utf8
        )

        XCTAssertFalse(appSource.contains("SuperwallOnboardingClient()"))
        XCTAssertFalse(hostSource.contains("presentOnboarding("))
        XCTAssertFalse(hostSource.contains("setPreferencesHandler("))
        XCTAssertTrue(hostSource.contains("startNativeOnboarding()"))
    }

    func testTrackedRemoteAndResearchFlagsRemainDisabled() throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sharedConfiguration = try String(
            contentsOf: repositoryURL.appendingPathComponent("Configuration/Shared.xcconfig"),
            encoding: .utf8
        )

        for setting in [
            "SUPABASE_ONBOARDING_SYNC_ENABLED = false",
            "RESEARCH_GUIDED_PLANNING_ENABLED = false",
            "OUTDOOR_EVIDENCE_ENABLED = false",
            "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED = false"
        ] {
            XCTAssertTrue(sharedConfiguration.contains(setting), "Missing disabled setting: \(setting)")
        }
    }

    func testOnboardingMovesAccessibilityFocusToEveryNewHeading() throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "TrailMind/Views/Onboarding/OnboardingComponents.swift"
            ),
            encoding: .utf8
        )

        XCTAssertGreaterThanOrEqual(
            source.components(separatedBy: "@AccessibilityFocusState").count - 1,
            2
        )
        XCTAssertGreaterThanOrEqual(
            source.components(separatedBy: ".accessibilityFocused($isHeadingFocused)").count - 1,
            2
        )
        XCTAssertGreaterThanOrEqual(
            source.components(separatedBy: ".task(id: page.step)").count - 1,
            2
        )
    }

    func testOnboardingHonorsReduceMotionWithoutAnimatedPageChanges() throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "TrailMind/Views/Onboarding/OnboardingView.swift"
            ),
            encoding: .utf8
        )

        XCTAssertTrue(source.contains("@Environment(\\.accessibilityReduceMotion) private var reduceMotion"))
        XCTAssertTrue(source.contains(".animation(reduceMotion ? nil : .snappy, value: selectedPage)"))
        XCTAssertTrue(source.contains("guard !reduceMotion else { return .opacity }"))
        XCTAssertGreaterThanOrEqual(
            source.components(separatedBy: "withAnimation(reduceMotion ? nil : .snappy)").count - 1,
            3
        )
    }

    func testOnboardingDistanceChoicesAdaptToActivity() {
        XCTAssertEqual(OnboardingView.distanceOptions(for: .hiking), [5, 10, 15, 20])
        XCTAssertEqual(OnboardingView.distanceOptions(for: .trailRunning), [5, 8, 12, 18])
        XCTAssertEqual(OnboardingView.distanceOptions(for: .biking), [15, 25, 40, 60])
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
