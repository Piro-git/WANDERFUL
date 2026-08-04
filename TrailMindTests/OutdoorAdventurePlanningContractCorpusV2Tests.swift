import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class OutdoorAdventurePlanningContractCorpusV2Tests: XCTestCase {
    func testSharedCorpusDeclaresAdditiveBoundedVersionedCases() throws {
        let fixture = try corpus()
        XCTAssertLessThan(fixture.data.count, 256 * 1_024)
        XCTAssertEqual(
            Set(fixture.root.keys),
            [
                "corpusSchemaVersion", "contractVersions", "policyVersions",
                "envelopes", "cases"
            ]
        )
        XCTAssertEqual(fixture.root["corpusSchemaVersion"] as? Int, 2)
        let versions = try XCTUnwrap(
            fixture.root["contractVersions"] as? [String: Int]
        )
        XCTAssertEqual(versions, [
            "outdoorAdventurePlanningResponse": 2,
            "researchGuidedRoutedAlternatives": 2,
            "researchTrailAccessCandidate": 1
        ])
        let ids = try fixture.cases.map {
            try XCTUnwrap($0["id"] as? String)
        }
        XCTAssertEqual(ids, ids.sorted())
        XCTAssertEqual(ids.count, Set(ids).count)
        XCTAssertTrue(ids.contains("routed_reached_highlight"))
        XCTAssertTrue(ids.contains("invalid_lineage_id_tamper"))
        XCTAssertTrue(ids.contains("invalid_routed_with_planning_gap"))
        let text = String(decoding: fixture.data, as: UTF8.self)
        XCTAssertNil(text.range(
            of: #"Bearer\s|api[_-]?key|secret|token"#,
            options: .regularExpression
        ))
    }

    func testAcceptedCasesUseProductionV2DecoderAndPreserveApproachLineage()
        throws
    {
        let fixture = try corpus()
        for item in fixture.cases where try accepted(item) {
            let id = try XCTUnwrap(item["id"] as? String)
            let envelopeName = try XCTUnwrap(item["envelope"] as? String)
            let envelope = try XCTUnwrap(fixture.envelopes[envelopeName])
            if id == "routed_reached_highlight" {
                let nested = try XCTUnwrap(
                    envelope["routedAlternatives"] as? [String: Any]
                )
                do {
                    let selection = try ResearchGuidedRoutingContractAdapterV2()
                        .decodeConvertAndSelect(try jsonData(nested))
                    XCTAssertEqual(selection.sourceEnvelopeState, .routed)
                    XCTAssertFalse(
                        selection.alternatives.isEmpty,
                        "routed corpus was contract-valid but quality-rejected: \(selection.rejectionCounts)"
                    )
                } catch {
                    XCTFail("routed corpus failed nested V2 validation: \(error)")
                    continue
                }
            }
            let result: OutdoorAdventurePlanningResultV1
            do {
                result = try OutdoorAdventurePlanningResponseValidatorV1
                    .validateV2(
                        try jsonData(envelope),
                        adapter: ResearchGuidedRoutingContractAdapterV2()
                    )
            } catch {
                XCTFail("\(id) failed V2 decoding: \(error)")
                continue
            }
            switch id {
            case "clarification_required":
                XCTAssertEqual(result.state, .clarificationRequired)
            case "no_viable_route":
                XCTAssertEqual(result.state, .noViableRoute)
            case "routed_reached_highlight":
                guard case let .routed(state) = result else {
                    return XCTFail("Expected routed V2 corpus response")
                }
                let alternative = try XCTUnwrap(
                    state.routeSelection.alternatives.first
                )
                let approach = try XCTUnwrap(
                    alternative.highlightApproaches.first
                )
                XCTAssertEqual(approach.state, .reached)
                XCTAssertTrue(approach.providerVerifiedAccess)
                XCTAssertNotEqual(
                    approach.evidenceCoordinate,
                    approach.routingCoordinate
                )
                XCTAssertTrue(
                    alternative.researchProvenance.lineageID.hasPrefix(
                        "rrlpv2_"
                    )
                )
                XCTAssertEqual(
                    alternative.researchProvenance.selectedWaypoints.first?
                        .coordinate,
                    approach.evidenceCoordinate
                )
            default:
                XCTFail("Unexpected accepted case: \(id)")
            }
        }
    }

    func testRejectedCasesFailClosedAndVersionsAreNotInterchangeable()
        throws
    {
        let fixture = try corpus()
        for item in fixture.cases where try !accepted(item) {
            let id = try XCTUnwrap(item["id"] as? String)
            let envelopeName = try XCTUnwrap(item["envelope"] as? String)
            let envelope = try XCTUnwrap(fixture.envelopes[envelopeName])
            let mutation = try XCTUnwrap(
                item["mutation"] as? [String: Any]
            )
            let path = try XCTUnwrap(mutation["path"] as? [Any])
            let replacement = try XCTUnwrap(mutation["value"])
            let mutated = try replacing(
                envelope,
                path: ArraySlice(path),
                with: replacement
            )
            XCTAssertThrowsError(
                try OutdoorAdventurePlanningResponseValidatorV1.validateV2(
                    try jsonData(mutated),
                    adapter: ResearchGuidedRoutingContractAdapterV2()
                ),
                id
            ) { error in
                XCTAssertEqual(
                    error as? OutdoorAdventurePlanningClientFailure,
                    .invalidResponse,
                    id
                )
            }
        }

        let v2 = try XCTUnwrap(fixture.envelopes["routed"])
        XCTAssertThrowsError(
            try OutdoorAdventurePlanningResponseValidatorV1.validate(
                try jsonData(v2),
                adapter: ResearchGuidedRoutingContractAdapterV1()
            )
        )
        var v1 = try XCTUnwrap(fixture.envelopes["noViable"])
        v1["schemaVersion"] = 1
        v1["policyVersion"] = "outdoor-adventure-orchestration-v1"
        XCTAssertNoThrow(
            try OutdoorAdventurePlanningResponseValidatorV1.validate(
                try jsonData(v1),
                adapter: ResearchGuidedRoutingContractAdapterV1()
            )
        )
        XCTAssertThrowsError(
            try OutdoorAdventurePlanningResponseValidatorV1.validateV2(
                try jsonData(v1),
                adapter: ResearchGuidedRoutingContractAdapterV2()
            )
        )
    }

    func testImpossibleFreshnessDateAndUnknownAccessEnumFailClosed() throws {
        let fixture = try corpus()
        let routed = try XCTUnwrap(fixture.envelopes["routed"])
        let accessPath: [Any] = [
            "routedAlternatives", "attempts", 0, "provenance",
            "selectedHighlights", 0, "trailAccessCandidate"
        ]
        let invalidDate = try replacing(
            routed,
            path: ArraySlice(accessPath + ["freshness", "sourceDataDate"]),
            with: "2026-02-30"
        )
        let invalidEnum = try replacing(
            routed,
            path: ArraySlice(accessPath + ["knownLimitations", 0]),
            with: "verified_routable"
        )
        for value in [invalidDate, invalidEnum] {
            XCTAssertThrowsError(
                try OutdoorAdventurePlanningResponseValidatorV1.validateV2(
                    try jsonData(value),
                    adapter: ResearchGuidedRoutingContractAdapterV2()
                )
            )
        }
    }

    func testRoutedNestedEnvelopeRemainsCoherentAsPartialWithPlanningGap()
        throws
    {
        let fixture = try corpus()
        var partial = try XCTUnwrap(fixture.envelopes["routed"])
        partial["state"] = "partial"
        partial["planningGaps"] = [[
            "code": "official_source_unavailable",
            "affectedField": "capabilities",
            "affectedValue": "retrieve_mapped_hiking_routes",
            "reason": "authority_not_available",
            "requiresClarification": false,
            "requiresCapability": true
        ]]

        let result = try OutdoorAdventurePlanningResponseValidatorV1
            .validateV2(
                try jsonData(partial),
                adapter: ResearchGuidedRoutingContractAdapterV2()
            )
        guard case let .partial(state) = result else {
            return XCTFail("Expected coherent partial V2 response")
        }
        XCTAssertEqual(state.planningGaps.count, 1)
        XCTAssertEqual(state.routeSelection.sourceEnvelopeState, .routed)
    }

    private func corpus() throws -> Fixture {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent(
                "outdoor_adventure_planning_v2_contract_corpus.json"
            )
        let data = try Data(contentsOf: url)
        let root = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        return Fixture(
            data: data,
            root: root,
            envelopes: try XCTUnwrap(
                root["envelopes"] as? [String: [String: Any]]
            ),
            cases: try XCTUnwrap(root["cases"] as? [[String: Any]])
        )
    }

    private func accepted(_ item: [String: Any]) throws -> Bool {
        try XCTUnwrap(item["accepted"] as? Bool)
    }

    private func replacing(
        _ value: Any,
        path: ArraySlice<Any>,
        with replacement: Any
    ) throws -> [String: Any] {
        try XCTUnwrap(
            replacingValue(value, path: path, with: replacement)
                as? [String: Any]
        )
    }

    private func replacingValue(
        _ value: Any,
        path: ArraySlice<Any>,
        with replacement: Any
    ) throws -> Any {
        guard let segment = path.first else { return replacement }
        let remainder = path.dropFirst()
        if let key = segment as? String {
            var object = try XCTUnwrap(value as? [String: Any])
            if remainder.isEmpty {
                object[key] = replacement
                return object
            }
            let child = try XCTUnwrap(object[key])
            object[key] = try replacingValue(
                child,
                path: remainder,
                with: replacement
            )
            return object
        }
        let index = try XCTUnwrap((segment as? NSNumber)?.intValue)
        var array = try XCTUnwrap(value as? [Any])
        if remainder.isEmpty {
            array[index] = replacement
            return array
        }
        array[index] = try replacingValue(
            array[index],
            path: remainder,
            with: replacement
        )
        return array
    }

    private func jsonData(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private struct Fixture {
        let data: Data
        let root: [String: Any]
        let envelopes: [String: [String: Any]]
        let cases: [[String: Any]]
    }
}
