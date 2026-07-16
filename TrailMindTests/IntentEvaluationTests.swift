import XCTest
@testable import TrailMind

@MainActor
final class IntentEvaluationTests: XCTestCase {
    func testIntentEvalFixturesDecodeAndCoverPromptFamilies() throws {
        let fixtures = try IntentEvalFixture.load()

        XCTAssertGreaterThanOrEqual(fixtures.count, 30)
        XCTAssertLessThanOrEqual(fixtures.count, 50)
        XCTAssertTrue(fixtures.contains { $0.routeType == TrailRouteType.loop.rawValue && $0.prompt.localizedCaseInsensitiveContains("Rund") })
        XCTAssertTrue(fixtures.contains { $0.routeType == TrailRouteType.loop.rawValue && $0.prompt.localizedCaseInsensitiveContains("loop") })
        XCTAssertTrue(fixtures.contains { $0.routeType == TrailRouteType.pointToPoint.rawValue })
        XCTAssertTrue(fixtures.contains { $0.shouldNeedClarification })
        XCTAssertTrue(fixtures.contains { $0.targetDurationMinutes != nil })
        XCTAssertTrue(fixtures.contains { $0.difficulty == RouteDifficulty.easy.rawValue })
        XCTAssertTrue(fixtures.contains { $0.difficulty == RouteDifficulty.challenging.rawValue })
        XCTAssertTrue(fixtures.contains { $0.prompt.localizedCaseInsensitiveContains("zurueck") })
        XCTAssertTrue(fixtures.contains { $0.activityType == ActivityType.trailRunning.rawValue })
        XCTAssertTrue(fixtures.contains { $0.activityType == ActivityType.biking.rawValue })
        XCTAssertTrue(fixtures.contains { $0.startLocationQuery == "Harz" })
    }

    func testLocalIntentEvalRunsRepeatablyWithoutLiveAI() async throws {
        let fixtures = try IntentEvalFixture.load()
        let summary = await IntentEvaluator().evaluate(
            fixtures: fixtures,
            provider: LocalIntentParsingProvider(),
            label: "local parser"
        )

        print("\n\(summary.formatted())")

        XCTAssertEqual(summary.total, fixtures.count)
        XCTAssertEqual(summary.remoteAISuccessCount, 0)
        XCTAssertEqual(summary.fallbackCount, summary.results.filter { $0.parserSource == .localRuleBased }.count)
        XCTAssertEqual(summary.failed, 0, summary.formatted())
    }

    func testEvaluationSummaryRedactsPromptAndProviderError() throws {
        let fixture = IntentEvalFixture(
            prompt: "private prompt that must never be logged",
            activityType: nil,
            routeType: nil,
            startLocationQuery: nil,
            endLocationQuery: nil,
            regionQuery: nil,
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: [],
            shouldNeedClarification: false,
            expectedClarificationType: nil
        )
        let summary = IntentEvalSummary(
            label: "redaction test",
            results: [IntentEvalCaseResult(
                fixture: fixture,
                passed: false,
                failedFields: ["parseError"],
                parserSource: nil,
                validationStatus: .invalid,
                clarificationReason: nil,
                parseError: "private raw provider response"
            )]
        )

        let output = summary.formatted()
        XCTAssertFalse(output.contains(fixture.prompt))
        XCTAssertFalse(output.contains("private raw provider response"))
        XCTAssertTrue(output.contains("case_001"))
        XCTAssertTrue(output.contains("provider error redacted"))
    }

    func testEvaluationHarnessControl() throws {
        switch ProcessInfo.processInfo.environment["TRAILMIND_EVAL_HARNESS_MODE"] {
        case nil:
            return
        case "pass":
            try LiveEvaluationMachineSummary(
                evaluation: "intent",
                totalCount: 1,
                passedCount: 1,
                failedCount: 0,
                skippedCount: 0,
                providerProof: false
            ).emit()
        case "skip":
            try LiveEvaluationMachineSummary(
                evaluation: "intent",
                totalCount: 1,
                passedCount: 0,
                failedCount: 0,
                skippedCount: 1,
                providerProof: false
            ).emit()
            throw XCTSkip("Controlled evaluation harness skip.")
        case "fail":
            try LiveEvaluationMachineSummary(
                evaluation: "intent",
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

    func testLiveRemoteAIIntentEvalWhenEnabled() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["TRAILMIND_RUN_REMOTE_INTENT_EVAL"] == "1" else {
            throw XCTSkip("Set TRAILMIND_RUN_REMOTE_INTENT_EVAL=1 to run live remoteAI intent eval.")
        }
        guard environment["TRAILMIND_EVAL_CREDENTIALS_CONTAINED"] == "1",
              environment["TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED"] == "1" else {
            throw XCTSkip("Credential containment and provider usage authorization are required.")
        }

        let fixtures = try IntentEvalFixture.load()
        guard fixtures.count == 40 else {
            try LiveEvaluationMachineSummary(
                evaluation: "intent",
                totalCount: fixtures.count,
                passedCount: 0,
                failedCount: fixtures.count,
                skippedCount: 0,
                providerProof: false
            ).emit()
            XCTFail("The authorized intent baseline requires exactly 40 fixtures.")
            return
        }
        let summary = await IntentEvaluator().evaluate(
            fixtures: fixtures,
            provider: RemoteWithLocalFallbackIntentParsingProvider(),
            label: "remoteAI with local fallback"
        )

        let providerProof = summary.remoteAISuccessCount > 0
        try LiveEvaluationMachineSummary(
            evaluation: "intent",
            totalCount: summary.total,
            passedCount: summary.passed,
            failedCount: summary.failed,
            skippedCount: 0,
            providerProof: providerProof
        ).emit()
        print("\n\(summary.formatted(maxFailures: 50))")

        XCTAssertEqual(summary.total, fixtures.count)
        XCTAssertTrue(providerProof, "No remote provider result was observed.")
        XCTAssertEqual(summary.failed, 0, summary.formatted(maxFailures: 50))
    }
}
