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
            "TrailMind/Services/VoicePlanningService.swift",
            "TrailMind/Data/MockRoutes.swift"
        ]
        let forbiddenReleaseTerms = [
            "MockRoutes",
            "MockAIPlannerService",
            "MockRoutingService",
            "FakeVoicePlanningService",
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
        XCTAssertTrue(copy.localizedCaseInsensitiveContains("routed option"))
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
            "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED = false",
            "REMOTE_INTENT_ENABLED = false",
            "DIRECT_GRAPHHOPPER_ENABLED = false",
            "INSECURE_LOCAL_BACKEND_AUTH_ENABLED = false",
            "IN_MEMORY_APP_ATTEST_ENABLED = false",
            "SUPERWALL_ENABLED = false",
            "MONETIZATION_ENABLED = false"
        ] {
            XCTAssertTrue(sharedConfiguration.contains(setting), "Missing disabled setting: \(setting)")
        }
    }

    func testShippingIdentityUsesWanderfulPublicNameAndCurrentVersion() throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let productionConfiguration = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "Configuration/Production.xcconfig"
            ),
            encoding: .utf8
        )
        let project = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "TrailMind.xcodeproj/project.pbxproj"
            ),
            encoding: .utf8
        )
        let contractData = try Data(
            contentsOf: repositoryURL.appendingPathComponent(
                "scripts/release-contract.json"
            )
        )
        let contract = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: contractData) as? [String: Any]
        )
        let product = try XCTUnwrap(contract["product"] as? [String: Any])

        XCTAssertTrue(productionConfiguration.contains("TRAILMIND_DISPLAY_NAME = Wanderful"))
        XCTAssertFalse(productionConfiguration.contains("TRAILMIND_DISPLAY_NAME = TrailMind"))
        XCTAssertTrue(
            productionConfiguration.contains(
                "TRAILMIND_PRODUCT_BUNDLE_IDENTIFIER = com.trailmind.app"
            )
        )
        XCTAssertEqual(product["display_name"] as? String, "Wanderful")
        XCTAssertEqual(product["bundle_identifier"] as? String, "com.trailmind.app")
        XCTAssertEqual(product["marketing_version"] as? String, "1.0")
        XCTAssertEqual(product["build_number"] as? String, "1")
        XCTAssertTrue(project.contains("MARKETING_VERSION = 1.0;"))
        XCTAssertTrue(project.contains("CURRENT_PROJECT_VERSION = 1;"))
    }

    func testReleaseUsesAdaptiveAppearanceAndEmptyPublicLinkDefaults() throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let appSource = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "TrailMind/App/TrailMindApp.swift"
            ),
            encoding: .utf8
        )
        let sharedConfiguration = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "Configuration/Shared.xcconfig"
            ),
            encoding: .utf8
        )

        XCTAssertFalse(appSource.contains(".preferredColorScheme(.light)"))
        for emptySetting in [
            "LOCAL_PRIVACY_POLICY_URL =",
            "LOCAL_SUPPORT_URL =",
            "LOCAL_TERMS_OF_USE_URL =",
            "LOCAL_PREMIUM_MONTHLY_PRODUCT_ID =",
            "LOCAL_PREMIUM_ANNUAL_PRODUCT_ID =",
            "STAGING_PRIVACY_POLICY_URL =",
            "STAGING_SUPPORT_URL =",
            "STAGING_TERMS_OF_USE_URL =",
            "STAGING_PREMIUM_MONTHLY_PRODUCT_ID =",
            "STAGING_PREMIUM_ANNUAL_PRODUCT_ID =",
            "PRODUCTION_PRIVACY_POLICY_URL =",
            "PRODUCTION_SUPPORT_URL =",
            "PRODUCTION_TERMS_OF_USE_URL =",
            "PRODUCTION_PREMIUM_MONTHLY_PRODUCT_ID =",
            "PRODUCTION_PREMIUM_ANNUAL_PRODUCT_ID ="
        ] {
            XCTAssertTrue(
                sharedConfiguration.contains(emptySetting),
                "Missing empty-by-default public-link setting: \(emptySetting)"
            )
        }
    }

    func testPublicLinkXCConfigDocumentsEscapedHTTPSWithoutDestinations() throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let localExample = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "Configuration/Local.xcconfig.example"
            ),
            encoding: .utf8
        )
        let sharedConfiguration = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "Configuration/Shared.xcconfig"
            ),
            encoding: .utf8
        )

        XCTAssertTrue(localExample.contains("https:/$()/…"))
        XCTAssertTrue(sharedConfiguration.contains("https:/$()/…"))
        XCTAssertFalse(localExample.contains("LOCAL_PRIVACY_POLICY_URL = https:"))
        XCTAssertFalse(localExample.contains("LOCAL_SUPPORT_URL = https:"))
        XCTAssertFalse(localExample.contains("LOCAL_TERMS_OF_USE_URL = https:"))
    }

    func testProductionPremiumFoundationIsDisabledAndTestCatalogIsDebugOnly() async throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sharedConfiguration = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "Configuration/Shared.xcconfig"
            ),
            encoding: .utf8
        )
        let premiumSource = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "TrailMind/Services/PremiumAccess.swift"
            ),
            encoding: .utf8
        )
        let releasePremiumSource = sourceExcludingDebugBlocks(
            premiumSource.replacingOccurrences(
                of: "#if DEBUG && targetEnvironment(simulator)",
                with: "#if DEBUG"
            )
        )

        XCTAssertTrue(sharedConfiguration.contains("MONETIZATION_ENABLED = false"))
        XCTAssertFalse(releasePremiumSource.contains("test.app.wanderful.premium"))
        XCTAssertFalse(releasePremiumSource.contains("local.storekit.test"))

        let store = PremiumAccessFactory.makeProduction(appConfiguration: nil)
        await store.start()
        XCTAssertEqual(store.accessState, .disabled)
        XCTAssertFalse(store.isAvailable)
        XCTAssertTrue(store.products.isEmpty)
    }

    func testRouteSuggestionsExposeOneCompleteOuterAccessibilityAction() throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: repositoryURL.appendingPathComponent(
                "TrailMind/Views/Planning/PlanningViews.swift"
            ),
            encoding: .utf8
        )

        XCTAssertTrue(source.contains("RouteComparisonAccessibilitySummary("))
        XCTAssertTrue(source.contains(".accessibilityElement(children: .ignore)"))
        XCTAssertTrue(source.contains(".accessibilityLabel(accessibilitySummary.label)"))
        XCTAssertTrue(source.contains(".accessibilityHint(accessibilitySummary.hint)"))
        XCTAssertFalse(source.contains(".accessibilityLabel(\"Open "))
    }

    func testNativePrivacyAndHelpDestinationsRemainAvailableWithoutWebLinks() {
        XCTAssertFalse(TrailMindAboutContent.dataFlowItems.isEmpty)
        XCTAssertFalse(TrailMindAboutContent.privacyControlItems.isEmpty)
        XCTAssertFalse(TrailMindAboutContent.helpItems.isEmpty)
        XCTAssertFalse(TrailMindAboutContent.planningBoundaryItems.isEmpty)
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
