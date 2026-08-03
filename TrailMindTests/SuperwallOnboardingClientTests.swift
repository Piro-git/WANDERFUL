import XCTest
@testable import TrailMind

@MainActor
final class SuperwallOnboardingClientTests: XCTestCase {
    func testAPIKeyNormalizationRejectsMissingAndUnexpandedValues() {
        XCTAssertNil(SuperwallConfiguration.normalizedPublicAPIKey(nil))
        XCTAssertNil(SuperwallConfiguration.normalizedPublicAPIKey(""))
        XCTAssertNil(SuperwallConfiguration.normalizedPublicAPIKey("$(SUPERWALL_API_KEY)"))
        XCTAssertNil(SuperwallConfiguration.normalizedPublicAPIKey("pk_your_public_key"))
        XCTAssertNil(SuperwallConfiguration.normalizedPublicAPIKey("not-a-superwall-key"))
        XCTAssertNil(SuperwallConfiguration.normalizedPublicAPIKey("pk_"))
        XCTAssertEqual(
            SuperwallConfiguration.normalizedPublicAPIKey("  pk_public_example  "),
            "pk_public_example"
        )
    }

    func testUnconfiguredClientFallsBackWithoutPresentingOrCompleting() {
        let client = SuperwallOnboardingClient(apiKey: nil, isAutomation: false)
        var didPresent = false
        var didComplete = false
        var didFallback = false

        client.presentOnboarding(
            onPresent: { didPresent = true },
            onComplete: { didComplete = true },
            onFallback: { didFallback = true }
        )

        XCTAssertFalse(client.isConfigured)
        XCTAssertFalse(didPresent)
        XCTAssertFalse(didComplete)
        XCTAssertTrue(didFallback)
    }

    func testAutomationMarkersDisableSuperwallPresentation() {
        XCTAssertTrue(
            SuperwallConfiguration.isAutomation(
                arguments: ["TrailMind", "--trailmind-ui-testing"]
            )
        )
        XCTAssertTrue(
            SuperwallConfiguration.isAutomation(
                arguments: ["TrailMind", "--trailmind-staging-proof"]
            )
        )
        XCTAssertFalse(SuperwallConfiguration.isAutomation(arguments: ["TrailMind"]))
    }

    func testFlowAttributesMergeIntoRoutePreferences() {
        let current = UserPreferences()
        let updated = SuperwallOnboardingPreferenceMapper.merging(
            attributes: [
                "onboarding_activity": "trail_running",
                "onboarding_distance_km": 18,
                "onboarding_effort": "challenging",
                "onboarding_interest_views": true,
                "onboarding_interest_forest": false,
                "onboarding_interest_quiet_paths": true,
                "onboarding_interest_waterfalls": false
            ],
            into: current
        )

        XCTAssertEqual(updated.preferredActivity, .trailRunning)
        XCTAssertEqual(updated.preferredDistanceKilometers, 18)
        XCTAssertEqual(updated.fitnessLevel, .challenging)
        XCTAssertFalse(updated.avoidsSteepClimbs)
        XCTAssertEqual(updated.interests, ["Views", "Quiet paths"])
    }

    func testCompletePayloadRequiresEverySupportedAttribute() {
        var attributes: [String: Any] = [
            "onboarding_activity": "hiking",
            "onboarding_distance_km": 15,
            "onboarding_effort": "moderate",
            "onboarding_interest_views": true,
            "onboarding_interest_forest": false,
            "onboarding_interest_quiet_paths": true,
            "onboarding_interest_waterfalls": false
        ]

        XCTAssertTrue(SuperwallOnboardingPreferenceMapper.hasCompletePayload(attributes))

        attributes.removeValue(forKey: "onboarding_interest_waterfalls")
        XCTAssertFalse(SuperwallOnboardingPreferenceMapper.hasCompletePayload(attributes))
    }

    func testSessionCompletesOnlyAfterExplicitCallbackAndCompletePayload() {
        var session = SuperwallOnboardingSessionState()
        session.recordAttributes([
            "onboarding_activity": "biking",
            "onboarding_distance_km": 40,
            "onboarding_effort": "easy",
            "onboarding_interest_views": false,
            "onboarding_interest_forest": true,
            "onboarding_interest_quiet_paths": true,
            "onboarding_interest_waterfalls": false
        ])

        XCTAssertFalse(session.canComplete)

        session.recordCustomCallback(
            named: SuperwallConfiguration.onboardingCompletionCallback
        )

        XCTAssertTrue(session.canComplete)
    }

    func testUnknownCallbackDoesNotCompleteSession() {
        var session = SuperwallOnboardingSessionState()
        session.recordAttributes([
            "onboarding_activity": "hiking",
            "onboarding_distance_km": 10,
            "onboarding_effort": "moderate",
            "onboarding_interest_views": true,
            "onboarding_interest_forest": false,
            "onboarding_interest_quiet_paths": false,
            "onboarding_interest_waterfalls": false
        ])
        session.recordCustomCallback(named: "something_else")

        XCTAssertFalse(session.canComplete)
    }
}
