import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class OutdoorAdventurePlanningContractCorpusTests: XCTestCase {
    private let acceptedCaseIDs: Set<String> = [
        "advisory_mapped_network",
        "clarification_required",
        "no_viable_route",
        "partial_harz_route",
        "partial_innsbruck_route",
        "partial_provider_failure",
        "quality_reduction",
        "routed_harz_route",
        "unsupported_activity",
        "unsupported_region"
    ]

    private let mutationOperations: Set<String> = [
        "append_outer_padding_bytes",
        "repeat_attempt_to_count",
        "repeat_route_result_to_count"
    ]

    func testCorpusSchemaVersionsCoverageAndDeterministicIDs() throws {
        let fixture = try corpus()
        XCTAssertLessThan(fixture.data.count, 2 * 1_024 * 1_024)
        XCTAssertEqual(
            Set(fixture.root.keys),
            [
                "corpusSchemaVersion",
                "contractVersions",
                "policyVersions",
                "cases"
            ]
        )
        XCTAssertEqual(try integer(fixture.root["corpusSchemaVersion"]), 1)

        let contractVersions = try dictionary(
            fixture.root["contractVersions"]
        )
        XCTAssertEqual(
            Set(contractVersions.keys),
            [
                "outdoorAdventurePlanningResponse",
                "researchGuidedRoutedAlternatives"
            ]
        )
        XCTAssertEqual(
            try integer(
                contractVersions["outdoorAdventurePlanningResponse"]
            ),
            1
        )
        XCTAssertEqual(
            try integer(
                contractVersions["researchGuidedRoutedAlternatives"]
            ),
            1
        )

        let policyVersions = try dictionary(fixture.root["policyVersions"])
        XCTAssertEqual(
            policyVersions["orchestration"] as? String,
            "outdoor-adventure-orchestration-v1"
        )
        XCTAssertEqual(
            policyVersions["candidatePlan"] as? String,
            "research-guided-route-candidates-v1"
        )
        XCTAssertEqual(
            policyVersions["routedAdapter"] as? String,
            "research-guided-routing-adapter-v1"
        )
        XCTAssertEqual(
            policyVersions["hikingQuality"] as? String,
            HikingRouteQualityPolicyVersion.v1.rawValue
        )

        XCTAssertEqual(fixture.cases.count, 40)
        let ids = try fixture.cases.map(caseID)
        XCTAssertEqual(Set(ids).count, ids.count)
        XCTAssertEqual(ids, ids.sorted())
        let acceptedIDs = Set(try fixture.cases.compactMap { item in
            try boolean(item["accepted"]) ? caseID(item) : nil
        })
        XCTAssertEqual(acceptedIDs, acceptedCaseIDs)

        let casesByID = try Dictionary(
            uniqueKeysWithValues: fixture.cases.map {
                (try caseID($0), $0)
            }
        )
        for item in fixture.cases {
            let id = try caseID(item)
            let accepted = try boolean(item["accepted"])
            let hasResponse = item["response"] != nil
            let hasMutation = item["mutation"] != nil
            XCTAssertNotEqual(hasResponse, hasMutation, id)
            XCTAssertEqual(
                Set(item.keys),
                hasResponse
                    ? ["id", "accepted", "expected", "response"]
                    : ["id", "accepted", "expected", "mutation"],
                id
            )
            let expected = try dictionary(item["expected"])
            XCTAssertEqual(
                Set(expected.keys),
                [
                    "outerState",
                    "nestedState",
                    "planningGapCount",
                    "clarificationQuestionCount",
                    "backendRouteResultCount",
                    "iosAlternativeCount",
                    "backendErrorCode"
                ],
                id
            )
            if accepted {
                XCTAssertNotNil(item["response"], id)
                XCTAssertTrue(expected["backendErrorCode"] is NSNull, id)
            } else {
                XCTAssertTrue(expected["outerState"] is NSNull, id)
                XCTAssertTrue(expected["nestedState"] is NSNull, id)
            }
            if let rawMutation = item["mutation"] {
                let mutation = try dictionary(rawMutation)
                XCTAssertEqual(
                    Set(mutation.keys),
                    ["baseCaseId", "operation", "count"],
                    id
                )
                let operation = try XCTUnwrap(
                    mutation["operation"] as? String
                )
                XCTAssertTrue(mutationOperations.contains(operation), id)
                let baseID = try XCTUnwrap(
                    mutation["baseCaseId"] as? String
                )
                XCTAssertEqual(
                    try boolean(casesByID[baseID]?["accepted"]),
                    true,
                    id
                )
            }
        }
    }

    func testAcceptedCasesUseProductionDecoderAdapterAndQualityEngine() throws {
        for item in try corpus().cases where try boolean(item["accepted"]) {
            let id = try caseID(item)
            let expected = try dictionary(item["expected"])
            let response = try dictionary(item["response"])
            let result = try OutdoorAdventurePlanningResponseValidatorV1
                .validate(
                    try jsonData(response),
                    adapter: ResearchGuidedRoutingContractAdapterV1()
                )

            XCTAssertEqual(
                result.state.rawValue,
                expected["outerState"] as? String,
                id
            )
            XCTAssertEqual(
                try routeResultCount(response),
                try exactRangeValue(
                    expected["backendRouteResultCount"],
                    id: id
                ),
                id
            )

            switch result {
            case let .clarificationRequired(state),
                 let .unsupported(state),
                 let .noViableRoute(state):
                XCTAssertEqual(
                    state.planningGaps.count,
                    try integer(expected["planningGapCount"]),
                    id
                )
                XCTAssertEqual(
                    state.clarificationQuestions.count,
                    try integer(expected["clarificationQuestionCount"]),
                    id
                )
                XCTAssertEqual(
                    try exactRangeValue(
                        expected["iosAlternativeCount"],
                        id: id
                    ),
                    0,
                    id
                )
            case let .partial(state), let .routed(state):
                try assertRoutedState(
                    state,
                    response: response,
                    expected: expected,
                    id: id
                )
            }
        }
    }

    func testQualityReductionProviderFailureAndMappedTrustRemainTruthful()
    throws {
        let fixture = try corpus()

        let quality = try acceptedResult(
            id: "quality_reduction",
            fixture: fixture
        )
        guard case let .routed(qualityState) = quality else {
            return XCTFail("Expected routed quality-reduction case")
        }
        XCTAssertEqual(qualityState.routeSelection.alternatives.count, 2)
        XCTAssertEqual(
            qualityState.routeSelection.rejectionCounts[
                RouteAlternativeRejection.nearDuplicate.rawValue
            ],
            1
        )

        let partial = try acceptedResult(
            id: "partial_provider_failure",
            fixture: fixture
        )
        guard case let .partial(partialState) = partial else {
            return XCTFail("Expected partial provider-failure case")
        }
        XCTAssertEqual(partialState.routeSelection.sourceEnvelopeState, .partial)
        XCTAssertEqual(partialState.routeSelection.alternatives.count, 1)
        XCTAssertTrue(
            partialState.routeSelection.remainingLimitations.contains(
                "provider_failure"
            )
        )

        let advisory = try acceptedResult(
            id: "advisory_mapped_network",
            fixture: fixture
        )
        guard case let .routed(advisoryState) = advisory else {
            return XCTFail("Expected routed advisory-mapped case")
        }
        let alternative = try XCTUnwrap(
            advisoryState.routeSelection.alternatives.first
        )
        let mapped = try XCTUnwrap(
            alternative.researchProvenance.mappedNetworkCandidates.first
        )
        XCTAssertEqual(mapped.sourceBasis, .mapped)
        XCTAssertTrue(mapped.knownLimitations.contains(.mappedPresenceOnly))
        XCTAssertTrue(
            mapped.knownLimitations.contains(.routeConnectionUnverified)
        )
        XCTAssertFalse(
            alternative.suggestion.route.highlights.contains { highlight in
                highlight.title.localizedCaseInsensitiveContains("official") ||
                    highlight.title.localizedCaseInsensitiveContains("scenic") ||
                    highlight.title.localizedCaseInsensitiveContains("safe")
            }
        )
    }

    func testRejectedCasesFailWithOneSafeProductionContractError() throws {
        let fixture = try corpus()
        let casesByID = try Dictionary(
            uniqueKeysWithValues: fixture.cases.map {
                (try caseID($0), $0)
            }
        )
        let leakSentinels = [
            "{",
            "47.2692",
            "11.4041",
            "51.8",
            "10.6",
            "66666666-6666-4666-8666-666666666666",
            "rrcpv1_",
            "rrlpv1_",
            "provider_message",
            "NaN",
            "Infinity"
        ]

        for item in fixture.cases where !(try boolean(item["accepted"])) {
            let id = try caseID(item)
            let response = try materializedResponse(
                for: item,
                casesByID: casesByID
            )
            XCTAssertThrowsError(
                try OutdoorAdventurePlanningResponseValidatorV1.validate(
                    try jsonData(response),
                    adapter: ResearchGuidedRoutingContractAdapterV1()
                ),
                id
            ) { error in
                XCTAssertEqual(
                    error as? OutdoorAdventurePlanningClientFailure,
                    .invalidResponse,
                    id
                )
                let text = error.localizedDescription
                XCTAssertEqual(
                    text,
                    "TrailMind couldn’t verify the planning result.",
                    id
                )
                for sentinel in leakSentinels {
                    XCTAssertFalse(text.contains(sentinel), "\(id)/\(sentinel)")
                }
            }
        }
    }

    private func assertRoutedState(
        _ state: OutdoorAdventurePlanningRoutedStateV1,
        response: [String: Any],
        expected: [String: Any],
        id: String
    ) throws {
        XCTAssertEqual(
            state.planningGaps.count,
            try integer(expected["planningGapCount"]),
            id
        )
        let expectedAlternativeCount = try exactRangeValue(
            expected["iosAlternativeCount"],
            id: id
        )
        XCTAssertEqual(
            state.routeSelection.alternatives.count,
            expectedAlternativeCount,
            id
        )
        XCTAssertEqual(
            state.routeSelection.sourceEnvelopeState.rawValue,
            expected["nestedState"] as? String,
            id
        )

        let nested = try dictionary(response["routedAlternatives"])
        let rawLimitations = try stringArray(nested["remainingLimitations"])
        XCTAssertEqual(
            state.routeSelection.remainingLimitations,
            rawLimitations,
            id
        )
        let attempts = try dictionaryArray(nested["attempts"])
        let attemptsByID = try Dictionary(
            uniqueKeysWithValues: attempts.map {
                (try XCTUnwrap($0["attemptId"] as? String), $0)
            }
        )

        for alternative in state.routeSelection.alternatives {
            XCTAssertTrue(
                alternative.suggestion.route.isVerifiedRoutedResult,
                id
            )
            guard case let .routed(provenance) =
                alternative.suggestion.route.provenance
            else {
                return XCTFail("Expected routed provenance in \(id)")
            }
            XCTAssertEqual(provenance.provider, .graphHopper, id)
            XCTAssertEqual(provenance.strategy, .backend, id)

            let rawAttempt = try XCTUnwrap(
                attemptsByID[alternative.attemptID]
            )
            let rawProvenance = try dictionary(rawAttempt["provenance"])
            XCTAssertEqual(
                alternative.researchProvenance.proposalID,
                rawProvenance["proposalId"] as? String,
                id
            )
            XCTAssertEqual(
                alternative.researchProvenance.lineageID,
                rawProvenance["lineageId"] as? String,
                id
            )
            XCTAssertEqual(
                alternative.researchProvenance.evidenceClaimIDs.map {
                    $0.uuidString.lowercased()
                },
                try stringArray(rawProvenance["evidenceClaimIds"]),
                id
            )
            XCTAssertFalse(
                alternative.researchProvenance.knownLimitations.isEmpty,
                id
            )
            XCTAssertEqual(
                alternative.waypointVisits.count,
                alternative.researchProvenance.selectedWaypoints.count + 2,
                id
            )
        }
    }

    private func acceptedResult(
        id: String,
        fixture: CorpusFixture
    ) throws -> OutdoorAdventurePlanningResultV1 {
        let item = try XCTUnwrap(
            fixture.cases.first { (try? caseID($0)) == id }
        )
        return try OutdoorAdventurePlanningResponseValidatorV1.validate(
            try jsonData(try dictionary(item["response"])),
            adapter: ResearchGuidedRoutingContractAdapterV1()
        )
    }

    private func materializedResponse(
        for item: [String: Any],
        casesByID: [String: [String: Any]]
    ) throws -> [String: Any] {
        if let response = item["response"] {
            return try clone(try dictionary(response))
        }
        let mutation = try dictionary(item["mutation"])
        let baseID = try XCTUnwrap(mutation["baseCaseId"] as? String)
        let baseCase = try XCTUnwrap(casesByID[baseID])
        var response = try clone(try dictionary(baseCase["response"]))
        let operation = try XCTUnwrap(mutation["operation"] as? String)
        let count = try integer(mutation["count"])

        switch operation {
        case "repeat_attempt_to_count":
            var nested = try dictionary(response["routedAlternatives"])
            var attempts = try dictionaryArray(nested["attempts"])
            let first = try XCTUnwrap(attempts.first)
            while attempts.count < count {
                attempts.append(try clone(first))
            }
            nested["attempts"] = attempts
            response["routedAlternatives"] = nested
        case "repeat_route_result_to_count":
            var nested = try dictionary(response["routedAlternatives"])
            var attempts = try dictionaryArray(nested["attempts"])
            var firstAttempt = try XCTUnwrap(attempts.first)
            var results = try dictionaryArray(firstAttempt["routeResults"])
            let first = try XCTUnwrap(results.first)
            while results.count < count {
                results.append(try clone(first))
            }
            firstAttempt["routeResults"] = results
            attempts[0] = firstAttempt
            nested["attempts"] = attempts
            response["routedAlternatives"] = nested
        case "append_outer_padding_bytes":
            response["padding"] = String(repeating: "x", count: count)
        default:
            XCTFail("Unsupported mutation operation: \(operation)")
        }
        return response
    }

    private func routeResultCount(_ response: [String: Any]) throws -> Int {
        guard !(response["routedAlternatives"] is NSNull) else { return 0 }
        let nested = try dictionary(response["routedAlternatives"])
        return try dictionaryArray(nested["attempts"]).reduce(0) {
            $0 + (try dictionaryArray($1["routeResults"]).count)
        }
    }

    private func exactRangeValue(_ input: Any?, id: String) throws -> Int {
        let range = try dictionary(input)
        let minimum = try integer(range["minimum"])
        let maximum = try integer(range["maximum"])
        XCTAssertEqual(minimum, maximum, id)
        return minimum
    }

    private func corpus() throws -> CorpusFixture {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent(
                "outdoor_adventure_planning_v1_contract_corpus.json"
            )
        let data = try Data(contentsOf: url)
        let root = try dictionary(
            JSONSerialization.jsonObject(with: data)
        )
        return CorpusFixture(
            data: data,
            root: root,
            cases: try dictionaryArray(root["cases"])
        )
    }

    private func clone(
        _ object: [String: Any]
    ) throws -> [String: Any] {
        try dictionary(
            JSONSerialization.jsonObject(with: jsonData(object))
        )
    }

    private func jsonData(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys]
        )
    }

    private func dictionary(_ input: Any?) throws -> [String: Any] {
        try XCTUnwrap(input as? [String: Any])
    }

    private func dictionaryArray(_ input: Any?) throws -> [[String: Any]] {
        try XCTUnwrap(input as? [[String: Any]])
    }

    private func stringArray(_ input: Any?) throws -> [String] {
        try XCTUnwrap(input as? [String])
    }

    private func integer(_ input: Any?) throws -> Int {
        try XCTUnwrap(input as? NSNumber).intValue
    }

    private func boolean(_ input: Any?) throws -> Bool {
        try XCTUnwrap(input as? NSNumber).boolValue
    }

    private func caseID(_ item: [String: Any]) throws -> String {
        try XCTUnwrap(item["id"] as? String)
    }
}

private struct CorpusFixture {
    let data: Data
    let root: [String: Any]
    let cases: [[String: Any]]
}
