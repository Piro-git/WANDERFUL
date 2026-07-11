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

    func testLiveRemoteAIIntentEvalWhenEnabled() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["TRAILMIND_RUN_REMOTE_INTENT_EVAL"] == "1" else {
            throw XCTSkip("Set TRAILMIND_RUN_REMOTE_INTENT_EVAL=1 to run live remoteAI intent eval.")
        }

        let fixtures = try IntentEvalFixture.load()
        let summary = await IntentEvaluator().evaluate(
            fixtures: fixtures,
            provider: RemoteWithLocalFallbackIntentParsingProvider(),
            label: "remoteAI with local fallback"
        )

        print("\n\(summary.formatted(maxFailures: 50))")

        XCTAssertEqual(summary.total, fixtures.count)
    }
}
