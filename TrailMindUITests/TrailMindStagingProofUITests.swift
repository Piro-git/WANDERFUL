import Foundation
import XCTest

@MainActor
final class TrailMindStagingProofUITests: XCTestCase {
    private static let attachmentName =
        "TrailMind Outdoor Adventure Staging Proof Receipt v1"
    private static let proofVersion =
        "outdoor-adventure-staging-proof-v1"
    private static let manifestDigest =
        "283a4f5c6210dbbc77516e3d6de684bfda800391c4f4aa3d08290193e77638a0"
    private static let receiptIdentifier =
        "staging.proof.receipt"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testCase01() throws {
        try run(
            caseID:
                "case-01-harz-ilsenburg-loop-viewpoints-forest",
            fixtureID:
                "case-01-harz-ilsenburg-loop-viewpoints-forest-input-v1",
            expectedTerminal: "partial",
            expectsBackendRequest: true
        )
    }

    func testCase02() throws {
        try run(
            caseID:
                "case-02-harz-schierke-easy-loop-paths-avoid-roads",
            fixtureID:
                "case-02-harz-schierke-easy-loop-paths-avoid-roads-input-v1",
            expectedTerminal: "partial",
            expectsBackendRequest: true
        )
    }

    func testCase03() throws {
        try run(
            caseID: "case-03-harz-trail-running-loop",
            fixtureID:
                "case-03-harz-trail-running-loop-input-v1",
            expectedTerminal: "partial",
            expectsBackendRequest: true
        )
    }

    func testCase04() throws {
        try run(
            caseID:
                "case-04-harz-brocken-must-have-landmark",
            fixtureID:
                "case-04-harz-brocken-must-have-landmark-input-v1",
            expectedTerminal: "partial",
            expectsBackendRequest: true
        )
    }

    func testCase05() throws {
        try run(
            caseID:
                "case-05-harz-unsatisfied-must-have-highlight",
            fixtureID:
                "case-05-harz-unsatisfied-must-have-highlight-input-v1",
            expectedTerminal: "legacy_fallback",
            expectsBackendRequest: true
        )
    }

    func testCase06() throws {
        try run(
            caseID: "case-06-outside-imported-coverage",
            fixtureID:
                "case-06-outside-imported-coverage-input-v1",
            expectedTerminal: "legacy_fallback",
            expectsBackendRequest: true
        )
    }

    func testCase07() throws {
        try run(
            caseID:
                "case-07-innsbruck-viewpoint-loop",
            fixtureID:
                "case-07-innsbruck-viewpoint-loop-input-v1",
            expectedTerminal: "partial",
            expectsBackendRequest: true
        )
    }

    func testCase08() throws {
        try run(
            caseID:
                "case-08-innsbruck-easy-conservative-loop",
            fixtureID:
                "case-08-innsbruck-easy-conservative-loop-input-v1",
            expectedTerminal: "partial",
            expectsBackendRequest: true
        )
    }

    func testCase09() throws {
        try run(
            caseID:
                "case-09-broad-alps-requires-clarification",
            fixtureID:
                "case-09-broad-alps-requires-clarification-input-v1",
            expectedTerminal: "clarification",
            expectsBackendRequest: false
        )
    }

    func testCase10() throws {
        try run(
            caseID:
                "case-10-innsbruck-missing-official-current-evidence",
            fixtureID:
                "case-10-innsbruck-missing-official-current-evidence-input-v1",
            expectedTerminal: "partial",
            expectsBackendRequest: true
        )
    }

    func testCase11() throws {
        try run(
            caseID:
                "case-11-biking-unsupported-legacy-once",
            fixtureID:
                "case-11-biking-unsupported-legacy-once-input-v1",
            expectedTerminal: "legacy_fallback",
            expectsBackendRequest: false
        )
    }

    func testCase12() throws {
        try run(
            caseID:
                "case-12-point-to-point-unsupported-documented-fallback",
            fixtureID:
                "case-12-point-to-point-unsupported-documented-fallback-input-v1",
            expectedTerminal: "legacy_fallback",
            expectsBackendRequest: false
        )
    }

    func testCase13() throws {
        try run(
            caseID:
                "case-13-cancel-during-postgis-research",
            fixtureID:
                "case-13-cancel-during-postgis-research-input-v1",
            expectedTerminal: "cancelled",
            expectsBackendRequest: true
        )
    }

    func testCase14() throws {
        try run(
            caseID:
                "case-14-timeout-during-graphhopper",
            fixtureID:
                "case-14-timeout-during-graphhopper-input-v1",
            expectedTerminal: "legacy_fallback",
            expectsBackendRequest: true
        )
    }

    func testCase15() throws {
        try run(
            caseID:
                "case-15-partial-provider-failure-survivor",
            fixtureID:
                "case-15-partial-provider-failure-survivor-input-v1",
            expectedTerminal: "partial",
            expectsBackendRequest: true
        )
    }
    func testCase16() throws {
        try run(
            caseID:
                "case-16-malformed-backend-response-rejected-by-ios",
            fixtureID:
                "case-16-malformed-backend-response-rejected-by-ios-input-v1",
            expectedTerminal: "rejected",
            expectsBackendRequest: true,
            expectedLane: "controlled"
        )
    }

    func testCase17() throws {
        try run(
            caseID:
                "case-17-feature-disabled-zero-research-work",
            fixtureID:
                "case-17-feature-disabled-zero-research-work-input-v1",
            expectedTerminal: "disabled",
            expectsBackendRequest: false
        )
    }

    func testCase18() throws {
        try run(
            caseID:
                "case-18-retry-does-not-reuse-stale-state",
            fixtureID:
                "case-18-retry-does-not-reuse-stale-state-input-v1",
            expectedTerminal: "retry_succeeded",
            expectsBackendRequest: true,
            expectsFreshRetry: true
        )
    }
    private func run(
        caseID: String,
        fixtureID: String,
        expectedTerminal: String,
        expectsBackendRequest: Bool,
        expectedLane: String = "live",
        expectsFreshRetry: Bool = false,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let initialFailureCount = testRun?.failureCount ?? 0
        let nonceDigest = try XCTUnwrap(
            ProcessInfo.processInfo.environment[
                "TRAILMIND_STAGING_PROOF_NONCE_DIGEST"
            ],
            "The proof runner must supply its pre-bound nonce digest.",
            file: file,
            line: line
        )
        guard Self.isSHA256(nonceDigest) else {
            XCTFail(
                "The proof runner nonce digest is malformed.",
                file: file,
                line: line
            )
            return
        }
        let app = XCUIApplication()
        app.launchArguments = [
            "--trailmind-staging-proof",
            "--trailmind-staging-proof-fixture",
            fixtureID,
            "--trailmind-staging-proof-nonce-digest",
            nonceDigest
        ]
        app.launch()

        let receiptElement =
            app.descendants(matching: .any)[
                Self.receiptIdentifier
            ].firstMatch
        XCTAssertTrue(
            receiptElement.waitForExistence(timeout: 30),
            "The app did not expose its staging-proof receipt.",
            file: file,
            line: line
        )
        let receiptReady = XCTNSPredicateExpectation(
            predicate: NSPredicate { object, _ in
                guard let element = object as? XCUIElement,
                      let value = element.value as? String
                else {
                    return false
                }
                return value != "pending" && !value.isEmpty
            },
            object: receiptElement
        )
        XCTAssertEqual(
            XCTWaiter.wait(
                for: [receiptReady],
                timeout: 150
            ),
            .completed,
            "The app did not finish its staging-proof receipt.",
            file: file,
            line: line
        )
        guard let payload = receiptElement.value as? String,
              let data = payload.data(using: .utf8)
        else {
            XCTFail(
                "The app receipt was not UTF-8 JSON.",
                file: file,
                line: line
            )
            return
        }

        let receipt = try Self.strictReceipt(from: data)
        XCTAssertEqual(
            receipt["schemaVersion"] as? Int,
            1,
            file: file,
            line: line
        )
        XCTAssertEqual(
            receipt["proofVersion"] as? String,
            Self.proofVersion,
            file: file,
            line: line
        )
        XCTAssertEqual(
            receipt["manifestDigest"] as? String,
            Self.manifestDigest,
            file: file,
            line: line
        )
        XCTAssertEqual(
            receipt["caseId"] as? String,
            caseID,
            file: file,
            line: line
        )
        XCTAssertEqual(
            receipt["inputFixtureId"] as? String,
            fixtureID,
            file: file,
            line: line
        )
        #if targetEnvironment(simulator)
        let effectiveExpectedLane = "controlled"
        #else
        let effectiveExpectedLane = expectedLane
        #endif
        XCTAssertEqual(
            receipt["lane"] as? String,
            effectiveExpectedLane,
            file: file,
            line: line
        )
        XCTAssertEqual(
            receipt["nonceDigest"] as? String,
            nonceDigest,
            file: file,
            line: line
        )
        #if targetEnvironment(simulator)
        let expectedBlocker: String? =
            caseID ==
                "case-16-malformed-backend-response-rejected-by-ios"
                ? nil
                : "simulator_development_session_non_proof"
        #else
        let expectedBlocker: String? = nil
        #endif
        if let expectedBlocker {
            XCTAssertEqual(
                receipt["blockerCode"] as? String,
                expectedBlocker,
                file: file,
                line: line
            )
        } else {
            XCTAssertTrue(
                receipt["blockerCode"] is NSNull,
                "The runtime emitted a non-passing blocker receipt.",
                file: file,
                line: line
            )
        }
        XCTAssertEqual(
            receipt["proofTerminalState"] as? String,
            expectedTerminal,
            file: file,
            line: line
        )

        let requestDigest = receipt["requestIdDigest"]
        if expectsBackendRequest {
            XCTAssertTrue(
                Self.isSHA256(requestDigest as? String),
                "A server-bound case needs a causal request digest.",
                file: file,
                line: line
            )
        } else {
            XCTAssertTrue(
                requestDigest is NSNull,
                "This case must not claim a backend request.",
                file: file,
                line: line
            )
        }

        if expectsFreshRetry {
            let retry = try XCTUnwrap(
                receipt["retry"] as? [String: Any],
                file: file,
                line: line
            )
            let prior = try XCTUnwrap(
                retry["priorRequestIdDigest"] as? String,
                file: file,
                line: line
            )
            let current = try XCTUnwrap(
                retry["currentRequestIdDigest"] as? String,
                file: file,
                line: line
            )
            XCTAssertTrue(Self.isSHA256(prior))
            XCTAssertTrue(Self.isSHA256(current))
            XCTAssertNotEqual(prior, current)
            XCTAssertEqual(requestDigest as? String, current)
        }
        try Self.assertRuntimeEvidence(
            receipt,
            expectation: Self.runtimeExpectation(
                for: caseID
            ),
            file: file,
            line: line
        )
        guard
            (testRun?.failureCount ?? initialFailureCount) ==
                initialFailureCount
        else {
            return
        }
        let attachment = XCTAttachment(
            data: data,
            uniformTypeIdentifier: "public.json"
        )
        attachment.name = Self.attachmentName
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private struct RuntimeExpectation {
        let adapterState: String
        let researchOutcomes: Set<String>
        let plannerTerminalState: String
        let coordinatorCount: Int
        let legacyCount: Int
        let attemptCount: Int
        let requiredSemantics: Set<String>
        let requiredCauses: Set<String>
        let minimumTimings: [String: Int]
        let diagnosticChecks: [String: String]
        let requiresConversion: Bool
        let presentationKind: String?
        let cancellation: Bool
        let retry: Bool
    }

    private static func runtimeExpectation(
        for caseID: String
    ) -> RuntimeExpectation {
        let partialChecks = [
            "productionClientPath": "passed",
            "contractConversion": "passed",
            "qualityRanking": "passed",
            "presentation": "passed",
            "cancellation": "not_applicable",
            "retryFreshness": "not_applicable"
        ]
        let fallbackChecks = [
            "productionClientPath": "passed",
            "contractConversion": "not_applicable",
            "qualityRanking": "not_applicable",
            "presentation": "passed",
            "cancellation": "not_applicable",
            "retryFreshness": "not_applicable"
        ]
        let partialTimings = [
            "adapter_conversion": 1,
            "research_coordinator": 1,
            "response_conversion": 1,
            "route_quality": 1,
            "presentation_projection": 1,
            "end_to_end": 1
        ]
        switch caseID {
        case "case-01-harz-ilsenburg-loop-viewpoints-forest":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["partial"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "real_route_quality_ranked",
                    "research_waypoints_visited",
                    "viewpoint_forest_preferences_preserved"
                ],
                requiredCauses: ["access_unverified"],
                minimumTimings: partialTimings,
                diagnosticChecks: partialChecks,
                requiresConversion: true,
                presentationKind: "research_guided_partial",
                cancellation: false,
                retry: false
            )
        case "case-02-harz-schierke-easy-loop-paths-avoid-roads":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["partial"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "conservative_difficulty_applied",
                    "path_and_road_preferences_preserved",
                    "real_route_quality_ranked",
                    "research_waypoints_visited"
                ],
                requiredCauses: ["access_unverified"],
                minimumTimings: partialTimings,
                diagnosticChecks: partialChecks,
                requiresConversion: true,
                presentationKind: "research_guided_partial",
                cancellation: false,
                retry: false
            )
        case "case-03-harz-trail-running-loop":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["partial"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "real_route_quality_ranked",
                    "research_waypoints_visited",
                    "trail_running_activity_preserved"
                ],
                requiredCauses: ["access_unverified"],
                minimumTimings: partialTimings,
                diagnosticChecks: partialChecks,
                requiresConversion: true,
                presentationKind: "research_guided_partial",
                cancellation: false,
                retry: false
            )
        case "case-04-harz-brocken-must-have-landmark":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["partial"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "brocken_anchor_returned",
                    "canonical_intent_bound",
                    "named_brocken_must_have_satisfied",
                    "real_route_quality_ranked",
                    "research_waypoints_visited"
                ],
                requiredCauses: ["access_unverified"],
                minimumTimings: partialTimings,
                diagnosticChecks: partialChecks,
                requiresConversion: true,
                presentationKind: "research_guided_partial",
                cancellation: false,
                retry: false
            )
        case "case-05-harz-unsatisfied-must-have-highlight":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["no_viable_route"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 1,
                attemptCount: 1,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "legacy_fallback_once",
                    "must_have_shortfall_observed"
                ],
                requiredCauses: ["insufficient_candidate_count"],
                minimumTimings: [
                    "adapter_conversion": 1,
                    "research_coordinator": 1,
                    "response_conversion": 1,
                    "legacy_routing": 1,
                    "presentation_projection": 1,
                    "end_to_end": 1
                ],
                diagnosticChecks: fallbackChecks,
                requiresConversion: false,
                presentationKind: "standard_route_fallback",
                cancellation: false,
                retry: false
            )
        case "case-06-outside-imported-coverage":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["unsupported"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 1,
                attemptCount: 1,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "legacy_fallback_once",
                    "outside_coverage_unsupported"
                ],
                requiredCauses: ["unsupported_region"],
                minimumTimings: [
                    "adapter_conversion": 1,
                    "research_coordinator": 1,
                    "response_conversion": 1,
                    "legacy_routing": 1,
                    "presentation_projection": 1,
                    "end_to_end": 1
                ],
                diagnosticChecks: fallbackChecks,
                requiresConversion: false,
                presentationKind: "standard_route_fallback",
                cancellation: false,
                retry: false
            )
        case "case-07-innsbruck-viewpoint-loop":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["partial"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "real_route_quality_ranked",
                    "research_waypoints_visited",
                    "viewpoint_preference_preserved"
                ],
                requiredCauses: ["access_unverified"],
                minimumTimings: partialTimings,
                diagnosticChecks: partialChecks,
                requiresConversion: true,
                presentationKind: "research_guided_partial",
                cancellation: false,
                retry: false
            )
        case "case-08-innsbruck-easy-conservative-loop":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["partial"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "conservative_difficulty_applied",
                    "real_route_quality_ranked",
                    "research_waypoints_visited"
                ],
                requiredCauses: ["access_unverified"],
                minimumTimings: partialTimings,
                diagnosticChecks: partialChecks,
                requiresConversion: true,
                presentationKind: "research_guided_partial",
                cancellation: false,
                retry: false
            )
        case "case-09-broad-alps-requires-clarification":
            return RuntimeExpectation(
                adapterState: "not_observed",
                researchOutcomes: ["none"],
                plannerTerminalState: "clarification",
                coordinatorCount: 0,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "broad_region_clarification"
                ],
                requiredCauses: ["unresolved_geography"],
                minimumTimings: [
                    "presentation_projection": 1,
                    "end_to_end": 1
                ],
                diagnosticChecks: [
                    "productionClientPath": "not_applicable",
                    "contractConversion": "not_applicable",
                    "qualityRanking": "not_applicable",
                    "presentation": "passed",
                    "cancellation": "not_applicable",
                    "retryFreshness": "not_applicable"
                ],
                requiresConversion: false,
                presentationKind: "clarification",
                cancellation: false,
                retry: false
            )
        case "case-10-innsbruck-missing-official-current-evidence":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["partial"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "missing_official_current_evidence_visible",
                    "real_route_quality_ranked",
                    "research_waypoints_visited",
                    "viewpoint_preference_preserved"
                ],
                requiredCauses: [
                    "access_unverified",
                    "official_status_unverified"
                ],
                minimumTimings: partialTimings,
                diagnosticChecks: partialChecks,
                requiresConversion: true,
                presentationKind: "research_guided_partial",
                cancellation: false,
                retry: false
            )
        case "case-11-biking-unsupported-legacy-once":
            var checks = fallbackChecks
            checks["productionClientPath"] = "not_applicable"
            return RuntimeExpectation(
                adapterState: "unsupported",
                researchOutcomes: ["none"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 0,
                legacyCount: 1,
                attemptCount: 1,
                requiredSemantics: [
                    "legacy_fallback_once",
                    "unsupported_biking_fallback"
                ],
                requiredCauses: ["unsupported_activity"],
                minimumTimings: [
                    "adapter_conversion": 1,
                    "legacy_routing": 1,
                    "presentation_projection": 1,
                    "end_to_end": 1
                ],
                diagnosticChecks: checks,
                requiresConversion: false,
                presentationKind: "standard_route_fallback",
                cancellation: false,
                retry: false
            )
        case "case-12-point-to-point-unsupported-documented-fallback":
            var checks = fallbackChecks
            checks["productionClientPath"] = "not_applicable"
            return RuntimeExpectation(
                adapterState: "unsupported",
                researchOutcomes: ["none"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 0,
                legacyCount: 1,
                attemptCount: 1,
                requiredSemantics: [
                    "legacy_fallback_once",
                    "unsupported_point_to_point_fallback"
                ],
                requiredCauses: ["unsupported_route_type"],
                minimumTimings: [
                    "adapter_conversion": 1,
                    "legacy_routing": 1,
                    "presentation_projection": 1,
                    "end_to_end": 1
                ],
                diagnosticChecks: checks,
                requiresConversion: false,
                presentationKind: "standard_route_fallback",
                cancellation: false,
                retry: false
            )
        case "case-13-cancel-during-postgis-research":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["failure"],
                plannerTerminalState: "cancelled",
                coordinatorCount: 1,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "cancelled_during_postgis",
                    "canonical_intent_bound"
                ],
                requiredCauses: [],
                minimumTimings: [
                    "adapter_conversion": 1,
                    "research_coordinator": 1,
                    "end_to_end": 1
                ],
                diagnosticChecks: [
                    "productionClientPath": "passed",
                    "contractConversion": "not_applicable",
                    "qualityRanking": "not_applicable",
                    "presentation": "not_applicable",
                    "cancellation": "passed",
                    "retryFreshness": "not_applicable"
                ],
                requiresConversion: false,
                presentationKind: nil,
                cancellation: true,
                retry: false
            )
        case "case-14-timeout-during-graphhopper":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["failure", "no_viable_route"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 1,
                attemptCount: 1,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "graphhopper_timeout_observed",
                    "legacy_fallback_once"
                ],
                requiredCauses: ["graphhopper_timeout"],
                minimumTimings: [
                    "adapter_conversion": 1,
                    "research_coordinator": 1,
                    "legacy_routing": 1,
                    "presentation_projection": 1,
                    "end_to_end": 1
                ],
                diagnosticChecks: fallbackChecks,
                requiresConversion: false,
                presentationKind: "standard_route_fallback",
                cancellation: false,
                retry: false
            )
        case "case-15-partial-provider-failure-survivor":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["partial"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 1,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "partial_provider_failure_survivor",
                    "real_route_quality_ranked",
                    "research_waypoints_visited"
                ],
                requiredCauses: [
                    "access_unverified",
                    "provider_failure"
                ],
                minimumTimings: partialTimings,
                diagnosticChecks: partialChecks,
                requiresConversion: true,
                presentationKind: "research_guided_partial",
                cancellation: false,
                retry: false
            )
        case "case-16-malformed-backend-response-rejected-by-ios":
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["failure"],
                plannerTerminalState: "recoverable_error",
                coordinatorCount: 1,
                legacyCount: 0,
                attemptCount: 1,
                requiredSemantics: [
                    "malformed_response_rejected_by_ios"
                ],
                requiredCauses: ["malformed_response"],
                minimumTimings: [
                    "adapter_conversion": 1,
                    "research_coordinator": 1,
                    "response_conversion": 1,
                    "end_to_end": 1
                ],
                diagnosticChecks: [
                    "productionClientPath": "passed",
                    "contractConversion": "not_applicable",
                    "qualityRanking": "not_applicable",
                    "presentation": "not_applicable",
                    "cancellation": "not_applicable",
                    "retryFreshness": "not_applicable"
                ],
                requiresConversion: false,
                presentationKind: nil,
                cancellation: false,
                retry: false
            )
        case "case-17-feature-disabled-zero-research-work":
            return RuntimeExpectation(
                adapterState: "not_observed",
                researchOutcomes: ["none"],
                plannerTerminalState: "idle",
                coordinatorCount: 0,
                legacyCount: 0,
                attemptCount: 0,
                requiredSemantics: [
                    "feature_disabled_zero_research"
                ],
                requiredCauses: ["feature_disabled"],
                minimumTimings: [
                    "end_to_end": 1
                ],
                diagnosticChecks: [
                    "productionClientPath": "not_applicable",
                    "contractConversion": "not_applicable",
                    "qualityRanking": "not_applicable",
                    "presentation": "not_applicable",
                    "cancellation": "not_applicable",
                    "retryFreshness": "not_applicable"
                ],
                requiresConversion: false,
                presentationKind: nil,
                cancellation: false,
                retry: false
            )
        case "case-18-retry-does-not-reuse-stale-state":
            var checks = partialChecks
            checks["retryFreshness"] = "passed"
            return RuntimeExpectation(
                adapterState: "ready",
                researchOutcomes: ["partial"],
                plannerTerminalState: "suggestions_ready",
                coordinatorCount: 2,
                legacyCount: 1,
                attemptCount: 2,
                requiredSemantics: [
                    "canonical_intent_bound",
                    "fresh_retry_after_failure",
                    "legacy_fallback_once",
                    "real_route_quality_ranked",
                    "research_waypoints_visited"
                ],
                requiredCauses: [
                    "access_unverified",
                    "prior_attempt_failed"
                ],
                minimumTimings: [
                    "adapter_conversion": 2,
                    "research_coordinator": 2,
                    "legacy_routing": 1,
                    "response_conversion": 1,
                    "route_quality": 1,
                    "presentation_projection": 1,
                    "end_to_end": 1
                ],
                diagnosticChecks: checks,
                requiresConversion: true,
                presentationKind: "research_guided_partial",
                cancellation: false,
                retry: true
            )
        default:
            preconditionFailure("Unknown staging-proof case.")
        }
    }

    private static func assertRuntimeEvidence(
        _ receipt: [String: Any],
        expectation: RuntimeExpectation,
        file: StaticString,
        line: UInt
    ) throws {
        XCTAssertEqual(
            receipt["adapterState"] as? String,
            expectation.adapterState,
            file: file,
            line: line
        )
        XCTAssertTrue(
            expectation.researchOutcomes.contains(
                receipt["researchOutcome"] as? String ?? ""
            ),
            file: file,
            line: line
        )
        XCTAssertEqual(
            receipt["plannerTerminalState"] as? String,
            expectation.plannerTerminalState,
            file: file,
            line: line
        )
        XCTAssertEqual(
            receipt["researchCoordinatorRequestCount"] as? Int,
            expectation.coordinatorCount,
            file: file,
            line: line
        )
        XCTAssertEqual(
            receipt["legacyRoutingRequestCount"] as? Int,
            expectation.legacyCount,
            file: file,
            line: line
        )
        XCTAssertEqual(
            receipt["plannerAttemptCount"] as? Int,
            expectation.attemptCount,
            file: file,
            line: line
        )
        let semantics = Set(
            try XCTUnwrap(
                receipt["semanticObservationIds"] as? [String],
                file: file,
                line: line
            )
        )
        XCTAssertEqual(
            semantics,
            expectation.requiredSemantics,
            "Runtime semantics must exactly match the canonical case.",
            file: file,
            line: line
        )
        let causes = Set(
            try XCTUnwrap(
                receipt["limitationCauseIds"] as? [String],
                file: file,
                line: line
            )
        )
        XCTAssertEqual(
            causes,
            expectation.requiredCauses,
            "Runtime limitations must exactly match the canonical case.",
            file: file,
            line: line
        )
        let timings = try XCTUnwrap(
            receipt["iosStageTimings"] as?
                [String: [String]],
            file: file,
            line: line
        )
        let timingVocabulary: Set<String> = [
            "under_100ms",
            "100ms_to_499ms",
            "500ms_to_999ms",
            "1s_to_4s",
            "5s_to_14s",
            "15s_or_more"
        ]
        for (stage, values) in timings {
            XCTAssertTrue(
                Set(values).isSubset(of: timingVocabulary),
                "Unknown timing bucket for \(stage).",
                file: file,
                line: line
            )
        }
        for (stage, minimum) in expectation.minimumTimings {
            XCTAssertGreaterThanOrEqual(
                timings[stage]?.count ?? 0,
                minimum,
                "Missing causal timing for \(stage).",
                file: file,
                line: line
            )
        }
        let checks = try XCTUnwrap(
            receipt["diagnosticChecks"] as? [String: String],
            file: file,
            line: line
        )
        XCTAssertEqual(
            checks,
            expectation.diagnosticChecks,
            file: file,
            line: line
        )
        let conversion = try XCTUnwrap(
            receipt["contractConversion"] as? [String: Any],
            file: file,
            line: line
        )
        let presentation = try XCTUnwrap(
            receipt["presentation"] as? [String: Any],
            file: file,
            line: line
        )
        if expectation.requiresConversion {
            let coordinatorOrder = try XCTUnwrap(
                conversion[
                    "coordinatorSelectionOrderDigest"
                ] as? String,
                file: file,
                line: line
            )
            let plannerOrder = try XCTUnwrap(
                conversion[
                    "plannerSuggestionOrderDigest"
                ] as? String,
                file: file,
                line: line
            )
            XCTAssertTrue(isSHA256(coordinatorOrder))
            XCTAssertEqual(coordinatorOrder, plannerOrder)
            XCTAssertEqual(
                presentation["inputOrderDigest"] as? String,
                plannerOrder,
                file: file,
                line: line
            )
            let accepted = try XCTUnwrap(
                conversion["acceptedCount"] as? Int,
                file: file,
                line: line
            )
            XCTAssertGreaterThan(accepted, 0)
            XCTAssertEqual(
                receipt["alternativeCount"] as? Int,
                accepted,
                file: file,
                line: line
            )
        } else {
            XCTAssertTrue(
                conversion[
                    "coordinatorSelectionOrderDigest"
                ] is NSNull,
                file: file,
                line: line
            )
            XCTAssertEqual(
                conversion["acceptedCount"] as? Int,
                0,
                file: file,
                line: line
            )
        }
        if let expectedKind = expectation.presentationKind {
            let kinds = try XCTUnwrap(
                presentation["kinds"] as? [String],
                file: file,
                line: line
            )
            XCTAssertFalse(kinds.isEmpty)
            XCTAssertTrue(kinds.allSatisfy { $0 == expectedKind })
            XCTAssertTrue(
                isSHA256(
                    presentation["outputOrderDigest"] as? String
                )
            )
        } else {
            XCTAssertEqual(
                presentation["count"] as? Int,
                0,
                file: file,
                line: line
            )
        }
        if expectation.cancellation {
            let cancellation = try XCTUnwrap(
                receipt["cancellation"] as? [String: Any],
                file: file,
                line: line
            )
            XCTAssertTrue(
                isSHA256(
                    cancellation["attemptDigest"] as? String
                )
            )
            XCTAssertEqual(
                cancellation["postCancelTerminalState"]
                    as? String,
                "cancelled"
            )
            XCTAssertEqual(
                cancellation[
                    "postCancelCoordinatorResultCount"
                ] as? Int,
                0
            )
            XCTAssertEqual(
                cancellation[
                    "postCancelLegacyRoutingCount"
                ] as? Int,
                0
            )
        }
        if expectation.retry {
            let retry = try XCTUnwrap(
                receipt["retry"] as? [String: Any],
                file: file,
                line: line
            )
            XCTAssertEqual(
                retry["priorTerminalState"] as? String,
                "no_routes"
            )
            XCTAssertEqual(
                retry["currentTerminalState"] as? String,
                "suggestions_ready"
            )
            XCTAssertTrue(
                isSHA256(
                    retry["priorAttemptDigest"] as? String
                )
            )
            XCTAssertTrue(
                isSHA256(
                    retry["currentAttemptDigest"] as? String
                )
            )
            XCTAssertNotEqual(
                retry["priorAttemptDigest"] as? String,
                retry["currentAttemptDigest"] as? String
            )
            XCTAssertTrue(
                isSHA256(
                    retry["priorResultDigest"] as? String
                )
            )
            XCTAssertTrue(
                isSHA256(
                    retry["currentResultDigest"] as? String
                )
            )
            XCTAssertNotEqual(
                retry["priorResultDigest"] as? String,
                retry["currentResultDigest"] as? String
            )
            XCTAssertEqual(
                retry["postResetPlannerTerminalState"] as? String,
                "generating"
            )
            XCTAssertEqual(
                retry["postResetSuggestionCount"] as? Int,
                0
            )
            XCTAssertTrue(
                retry["postResetResearchContextDigest"] is NSNull
            )
            XCTAssertTrue(
                retry["postResetClarificationDigest"] is NSNull
            )
            XCTAssertTrue(
                retry["postResetRecoveryDigest"] is NSNull
            )
        } else {
            let retry = try XCTUnwrap(
                receipt["retry"] as? [String: Any],
                file: file,
                line: line
            )
            for key in [
                "priorResultDigest",
                "postResetPlannerTerminalState",
                "postResetResearchContextDigest",
                "postResetClarificationDigest",
                "postResetRecoveryDigest"
            ] {
                XCTAssertTrue(
                    retry[key] is NSNull,
                    "Non-retry receipt unexpectedly populated \(key).",
                    file: file,
                    line: line
                )
            }
            XCTAssertEqual(
                retry["postResetSuggestionCount"] as? Int,
                0,
                file: file,
                line: line
            )
        }
    }

    private static func strictReceipt(
        from data: Data
    ) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(
            with: data,
            options: []
        )
        let receipt = try XCTUnwrap(object as? [String: Any])
        let expectedTopLevelKeys: Set<String> = [
            "schemaVersion",
            "proofVersion",
            "manifestDigest",
            "caseId",
            "inputFixtureId",
            "lane",
            "nonceDigest",
            "requestIdDigest",
            "resultDigest",
            "proofTerminalState",
            "plannerTerminalState",
            "adapterState",
            "researchOutcome",
            "researchCoordinatorRequestCount",
            "legacyRoutingRequestCount",
            "plannerAttemptCount",
            "backendPlanningGapCodes",
            "semanticObservationIds",
            "limitationCauseIds",
            "selectionState",
            "sourceEnvelopeState",
            "alternativeCount",
            "contractConversion",
            "presentation",
            "cancellation",
            "retry",
            "iosStageTimings",
            "diagnosticChecks",
            "blockerCode"
        ]
        XCTAssertEqual(Set(receipt.keys), expectedTopLevelKeys)
        try assertExactKeys(
            receipt["contractConversion"],
            [
                "coordinatorSelectionOrderDigest",
                "plannerSuggestionOrderDigest",
                "acceptedCount",
                "rejectedCount"
            ]
        )
        try assertExactKeys(
            receipt["presentation"],
            [
                "inputOrderDigest",
                "outputOrderDigest",
                "count",
                "kinds"
            ]
        )
        try assertExactKeys(
            receipt["cancellation"],
            [
                "attemptDigest",
                "postCancelTerminalState",
                "postCancelCoordinatorResultCount",
                "postCancelLegacyRoutingCount"
            ]
        )
        try assertExactKeys(
            receipt["retry"],
            [
                "priorAttemptDigest",
                "currentAttemptDigest",
                "priorRequestIdDigest",
                "currentRequestIdDigest",
                "priorResultDigest",
                "priorTerminalState",
                "currentTerminalState",
                "currentResultDigest",
                "postResetPlannerTerminalState",
                "postResetSuggestionCount",
                "postResetResearchContextDigest",
                "postResetClarificationDigest",
                "postResetRecoveryDigest"
            ]
        )
        try assertExactKeys(
            receipt["diagnosticChecks"],
            [
                "productionClientPath",
                "contractConversion",
                "qualityRanking",
                "presentation",
                "cancellation",
                "retryFreshness"
            ]
        )
        try assertExactKeys(
            receipt["iosStageTimings"],
            [
                "adapter_conversion",
                "research_coordinator",
                "legacy_routing",
                "response_conversion",
                "route_quality",
                "presentation_projection",
                "end_to_end"
            ]
        )
        XCTAssertTrue(Self.isSHA256(receipt["resultDigest"] as? String))
        try assertRedacted(receipt)
        return receipt
    }

    private static func assertExactKeys(
        _ input: Any?,
        _ keys: Set<String>
    ) throws {
        let object = try XCTUnwrap(input as? [String: Any])
        XCTAssertEqual(Set(object.keys), keys)
    }

    private static func assertRedacted(_ value: Any) throws {
        let forbiddenKeyFragments = [
            "prompt",
            "coordinate",
            "token",
            "geometry",
            "url",
            "providerbody",
            "responsebody"
        ]
        if let dictionary = value as? [String: Any] {
            for (key, child) in dictionary {
                let normalized = key
                    .lowercased()
                    .replacingOccurrences(of: "_", with: "")
                XCTAssertFalse(
                    forbiddenKeyFragments.contains {
                        normalized.contains($0)
                    },
                    "Receipt contains forbidden key \(key)."
                )
                try assertRedacted(child)
            }
            return
        }
        if let array = value as? [Any] {
            for child in array {
                try assertRedacted(child)
            }
            return
        }
        if let string = value as? String {
            XCTAssertFalse(string.contains("://"))
            XCTAssertFalse(
                string.localizedCaseInsensitiveContains(
                    "authorization:"
                )
            )
        }
    }

    private static func isSHA256(_ value: String?) -> Bool {
        guard let value, value.utf8.count == 64 else {
            return false
        }
        return value.unicodeScalars.allSatisfy {
            ($0.value >= 48 && $0.value <= 57) ||
                ($0.value >= 97 && $0.value <= 102)
        }
    }
}
