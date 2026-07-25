import XCTest
@testable import TrailMind

@MainActor
final class ResearchGuidedRoutingAdapterTests: XCTestCase {
    func testSharedFixtureCorpusCoversEveryRequiredScenario() throws {
        let fixture = try fixtureCorpus()
        XCTAssertEqual(fixture.schemaVersion, 1)
        XCTAssertEqual(fixture.contractSchemaVersion, 1)
        XCTAssertEqual(fixture.requiredScenarioIDs.count, 19)
        XCTAssertEqual(
            Set(fixture.requiredScenarioIDs).count,
            fixture.requiredScenarioIDs.count
        )
        XCTAssertEqual(Set(fixture.requiredScenarioIDs), Set([
            "valid_loop_one_highlight",
            "valid_loop_ordered_highlights",
            "multiple_proposals_out_of_order",
            "partial_provider_failure",
            "all_providers_no_route",
            "malformed_graphhopper_response",
            "tampered_proposal_id",
            "mismatched_evidence_or_entity",
            "unsupported_point_to_point",
            "unsupported_out_and_back",
            "unsupported_activity_contract_compatibility",
            "mapped_relation_advisory_only",
            "excessive_snapping_distance",
            "cancelled_and_late_response",
            "duplicate_routed_geometry",
            "all_quality_rejected",
            "quality_reduced_and_ranked",
            "oversized_arrays_and_response",
            "sanitized_failure_no_details"
        ]))
        XCTAssertEqual(Set(fixture.envelopes.keys), [
            "validAlternatives",
            "openLoopOnly",
            "unsupportedBiking"
        ])
    }

    func testValidBackendPathsBecomeVerifiedRoutesAndPassExistingQualityEngine() throws {
        let result = try adapterResult(envelope: "validAlternatives")

        XCTAssertEqual(result.sourceEnvelopeState, .routed)
        XCTAssertEqual(result.state, .routed)
        XCTAssertEqual(result.alternatives.count, 2)
        let selectedResultIDs = Set(
            result.alternatives.map(\.routeResultID)
        )
        XCTAssertTrue(
            selectedResultIDs.contains(
                "rrrav1_149fc6a18b98f3110bf68d5159fb0f76_path_3"
            )
        )
        XCTAssertEqual(
            selectedResultIDs.intersection([
                "rrrav1_149fc6a18b98f3110bf68d5159fb0f76_path_1",
                "rrrav1_149fc6a18b98f3110bf68d5159fb0f76_path_2"
            ]).count,
            1
        )
        XCTAssertEqual(
            result.rejectionCounts[
                RouteAlternativeRejection.nearDuplicate.rawValue
            ],
            1
        )

        for alternative in result.alternatives {
            XCTAssertTrue(alternative.suggestion.route.isVerifiedRoutedResult)
            guard case let .routed(routed) =
                alternative.suggestion.route.provenance
            else {
                return XCTFail("Expected routed provenance")
            }
            XCTAssertEqual(routed.provider, .graphHopper)
            XCTAssertEqual(routed.strategy, .backend)
            XCTAssertEqual(
                alternative.researchProvenance.proposalID,
                "rrcpv1_d26d2dccb9d2fa312102181b272033df"
            )
            XCTAssertEqual(
                alternative.researchProvenance.selectedWaypoints.map(
                    { $0.entityID.uuidString.lowercased() }
                ),
                ["11111111-1111-4111-8111-111111111111"]
            )
            XCTAssertEqual(
                alternative.researchProvenance.evidenceClaimIDs.map(
                    { $0.uuidString.lowercased() }
                ),
                ["66666666-6666-4666-8666-666666666666"]
            )
            XCTAssertTrue(
                alternative.researchProvenance.knownLimitations.contains(
                    .mappedPresenceOnly
                )
            )
            XCTAssertFalse(
                alternative.suggestion.route.highlights.contains {
                    $0.title.localizedCaseInsensitiveContains("scenic") ||
                        $0.title.localizedCaseInsensitiveContains("official")
                }
            )
        }
    }

    func testDuplicateGeometryIsRemovedAndDistinctAlternativesAreRanked() throws {
        let result = try adapterResult(envelope: "validAlternatives")

        XCTAssertEqual(result.alternatives.count, 2)
        let firstDistance = try XCTUnwrap(
            result.alternatives.first?.suggestion.route.distanceKilometers
        )
        XCTAssertEqual(
            firstDistance,
            13.2,
            accuracy: 0.001
        )
        XCTAssertTrue(
            result.alternatives.allSatisfy {
                $0.suggestion.route.routeType == .loop
            }
        )
    }

    func testOpenLoopIsRejectedByHikingQualityEngineAndCannotBecomeSuccess() throws {
        let result = try adapterResult(envelope: "openLoopOnly")

        XCTAssertEqual(result.sourceEnvelopeState, .routed)
        XCTAssertEqual(result.state, .noViableRoute)
        XCTAssertTrue(result.alternatives.isEmpty)
        XCTAssertEqual(
            result.rejectionCounts[
                RouteAlternativeRejection.openLoop.rawValue
            ],
            1
        )
    }

    func testResearchLineageSurvivesQualitySelectionAndValueCopying() throws {
        let result = try adapterResult(envelope: "validAlternatives")
        let original = try XCTUnwrap(result.alternatives.first)
        let copiedSuggestion = RouteSuggestion(
            id: original.suggestion.id,
            route: original.suggestion.route.withPlanningMetadata(
                original.suggestion.route.planningMetadata
            ),
            explanation: original.suggestion.explanation,
            debugMetadata: original.suggestion.debugMetadata
        )
        let copied = original.replacingSuggestion(copiedSuggestion)

        XCTAssertEqual(copied.researchProvenance, original.researchProvenance)
        XCTAssertEqual(copied.waypointVisits, original.waypointVisits)
        XCTAssertEqual(copied.attemptID, original.attemptID)
        XCTAssertTrue(copied.suggestion.route.isVerifiedRoutedResult)
    }

    func testExcessiveSnappingIsTypedButNeverReportedAsReached() throws {
        var envelope = try fixtureEnvelope(named: "validAlternatives")
        var attempts = try XCTUnwrap(envelope["attempts"] as? [[String: Any]])
        var attempt = attempts[0]
        var results = try XCTUnwrap(
            attempt["routeResults"] as? [[String: Any]]
        )
        for index in results.indices {
            var result = results[index]
            var visits = try XCTUnwrap(
                result["waypointVisits"] as? [[String: Any]]
            )
            var visit = visits[1]
            let requested = try coordinateDictionary(
                visit["requestedCoordinate"]
            )
            let snapped = [
                "latitude": requested.latitude + 0.02,
                "longitude": requested.longitude + 0.02
            ]
            visit["snappedCoordinate"] = snapped
            visit["snapDistanceMeters"] = distanceMeters(
                requested,
                (
                    latitude: requested.latitude + 0.02,
                    longitude: requested.longitude + 0.02
                )
            )
            visit["withinVisitTolerance"] = false
            visits[1] = visit
            result["waypointVisits"] = visits
            results[index] = result
        }
        attempt["routeResults"] = results
        attempts[0] = attempt
        envelope["attempts"] = attempts
        var limitations = try XCTUnwrap(
            envelope["remainingLimitations"] as? [String]
        )
        limitations.append("snapping_exceeds_tolerance")
        envelope["remainingLimitations"] = limitations

        let result = try ResearchGuidedRoutingContractAdapterV1()
            .decodeConvertAndSelect(try jsonData(envelope))
        let visit = try XCTUnwrap(
            result.alternatives.first?.waypointVisits.first {
                $0.role == .via
            }
        )
        XCTAssertFalse(visit.withinVisitTolerance)
        XCTAssertFalse(visit.isResearchWaypointReached)
        XCTAssertGreaterThan(visit.snapDistanceMeters ?? 0, 100)
    }

    func testStrictValidationRejectsUnknownTamperedAndMismatchedFields() throws {
        let base = try fixtureEnvelope(named: "validAlternatives")

        var unknown = base
        unknown["unexpected"] = true
        try assertInvalid(unknown)

        var proposalTamper = base
        try mutateProvenance(in: &proposalTamper) {
            $0["proposalId"] =
                "rrcpv1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
        try assertInvalid(proposalTamper)

        var evidenceTamper = base
        try mutateProvenance(in: &evidenceTamper) {
            $0["evidenceClaimIds"] = [
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            ]
        }
        try assertInvalid(evidenceTamper)

        var entityTamper = base
        try mutateProvenance(in: &entityTamper) { provenance in
            var waypoints = try XCTUnwrap(
                provenance["selectedWaypoints"] as? [[String: Any]]
            )
            waypoints[0]["entityId"] =
                "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            provenance["selectedWaypoints"] = waypoints
        }
        try assertInvalid(entityTamper)

        var providerTamper = base
        try mutateFirstPath(in: &providerTamper) {
            $0["provider_message"] = "private-provider-detail"
        }
        try assertInvalid(providerTamper)
    }

    func testMalformedAndExcessiveEnvelopesFailClosed() throws {
        var malformed = try fixtureEnvelope(named: "validAlternatives")
        try mutateFirstPath(in: &malformed) { path in
            path["points"] = [
                "type": "LineString",
                "coordinates": []
            ]
        }
        try assertInvalid(malformed)

        var excessive = try fixtureEnvelope(named: "validAlternatives")
        try mutateFirstPath(in: &excessive) { path in
            path["instructions"] = Array(
                repeating: [
                    "text": "Continue",
                    "distance": 1,
                    "time": 1,
                    "interval": [0, 1],
                    "sign": 0
                ],
                count: RouteTransportLimits.standard
                    .maximumInstructionsPerPath + 1
            )
        }
        try assertInvalid(excessive)

        let oversized = Data(
            repeating: 0x20,
            count: 8 * 1_024 * 1_024 + 1
        )
        XCTAssertThrowsError(
            try ResearchGuidedRoutingContractAdapterV1()
                .decodeConvertAndSelect(oversized)
        ) { error in
            XCTAssertEqual(
                error as? ResearchGuidedRoutingContractErrorV1,
                .envelopeTooLarge
            )
        }
    }

    func testUnsupportedEnvelopeReturnsNoSuccessWithoutDecodingRoutes() throws {
        let result = try adapterResult(envelope: "unsupportedBiking")
        XCTAssertEqual(result.state, .unsupported)
        XCTAssertTrue(result.alternatives.isEmpty)
    }

    func testIntentValidationMatchesBackendContractBoundaries() throws {
        let valid = try fixtureEnvelope(named: "unsupportedBiking")
        XCTAssertNoThrow(
            try ResearchGuidedRoutingContractAdapterV1()
                .decodeConvertAndSelect(try jsonData(valid))
        )

        var invalidArrivalMode = valid
        var arrivalIntent = try XCTUnwrap(
            invalidArrivalMode["normalizedIntent"] as? [String: Any]
        )
        var transport = try XCTUnwrap(
            arrivalIntent["transportRequirements"] as? [String: Any]
        )
        transport["arrivalMode"] = "cycling"
        arrivalIntent["transportRequirements"] = transport
        invalidArrivalMode["normalizedIntent"] = arrivalIntent
        try assertInvalid(invalidArrivalMode)

        var invalidChildren = valid
        var childrenIntent = try XCTUnwrap(
            invalidChildren["normalizedIntent"] as? [String: Any]
        )
        var group = try XCTUnwrap(
            childrenIntent["groupContext"] as? [String: Any]
        )
        group["includesChildren"] = false
        group["youngestAge"] = 12
        childrenIntent["groupContext"] = group
        invalidChildren["normalizedIntent"] = childrenIntent
        try assertInvalid(invalidChildren)

        var invalidAccommodation = valid
        var overnightIntent = try XCTUnwrap(
            invalidAccommodation["normalizedIntent"] as? [String: Any]
        )
        var overnight = try XCTUnwrap(
            overnightIntent["overnightRequirements"] as? [String: Any]
        )
        overnight["required"] = false
        overnight["nights"] = 1
        overnight["allowedAccommodationTypes"] = ["alpine_hut"]
        overnightIntent["overnightRequirements"] = overnight
        invalidAccommodation["normalizedIntent"] = overnightIntent
        try assertInvalid(invalidAccommodation)
    }

    private func adapterResult(
        envelope name: String
    ) throws -> ResearchGuidedRouteSelectionV1 {
        try ResearchGuidedRoutingContractAdapterV1()
            .decodeConvertAndSelect(
                try jsonData(fixtureEnvelope(named: name))
            )
    }

    private func assertInvalid(
        _ envelope: [String: Any],
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        XCTAssertThrowsError(
            try ResearchGuidedRoutingContractAdapterV1()
                .decodeConvertAndSelect(try jsonData(envelope)),
            file: file,
            line: line
        ) { error in
            XCTAssertEqual(
                error as? ResearchGuidedRoutingContractErrorV1,
                .invalidEnvelope,
                file: file,
                line: line
            )
        }
    }

    private func mutateProvenance(
        in envelope: inout [String: Any],
        mutation: (inout [String: Any]) throws -> Void
    ) throws {
        var attempts = try XCTUnwrap(
            envelope["attempts"] as? [[String: Any]]
        )
        var provenance = try XCTUnwrap(
            attempts[0]["provenance"] as? [String: Any]
        )
        try mutation(&provenance)
        attempts[0]["provenance"] = provenance
        envelope["attempts"] = attempts
    }

    private func mutateFirstPath(
        in envelope: inout [String: Any],
        mutation: (inout [String: Any]) throws -> Void
    ) throws {
        var attempts = try XCTUnwrap(
            envelope["attempts"] as? [[String: Any]]
        )
        var results = try XCTUnwrap(
            attempts[0]["routeResults"] as? [[String: Any]]
        )
        var path = try XCTUnwrap(results[0]["path"] as? [String: Any])
        try mutation(&path)
        results[0]["path"] = path
        attempts[0]["routeResults"] = results
        envelope["attempts"] = attempts
    }

    private func fixtureEnvelope(
        named name: String
    ) throws -> [String: Any] {
        let fixture = try fixtureCorpus()
        return try XCTUnwrap(fixture.envelopes[name])
    }

    private func fixtureCorpus() throws -> FixtureCorpus {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent(
                "research_guided_routed_alternatives_v1.json"
            )
        let root = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: Data(contentsOf: url)
            ) as? [String: Any]
        )
        return FixtureCorpus(
            schemaVersion: try XCTUnwrap(
                root["schemaVersion"] as? Int
            ),
            contractSchemaVersion: try XCTUnwrap(
                root["contractSchemaVersion"] as? Int
            ),
            requiredScenarioIDs: try XCTUnwrap(
                root["requiredScenarioIDs"] as? [String]
            ),
            envelopes: try XCTUnwrap(
                root["envelopes"] as? [String: [String: Any]]
            )
        )
    }

    private func jsonData(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys]
        )
    }

    private func coordinateDictionary(
        _ input: Any?
    ) throws -> (latitude: Double, longitude: Double) {
        let value = try XCTUnwrap(input as? [String: Double])
        return (
            latitude: try XCTUnwrap(value["latitude"]),
            longitude: try XCTUnwrap(value["longitude"])
        )
    }

    private func distanceMeters(
        _ start: (latitude: Double, longitude: Double),
        _ finish: (latitude: Double, longitude: Double)
    ) -> Double {
        let radius = 6_371_000.0
        let radians = Double.pi / 180
        let latitudeDelta =
            (finish.latitude - start.latitude) * radians
        let longitudeDelta =
            (finish.longitude - start.longitude) * radians
        let startLatitude = start.latitude * radians
        let finishLatitude = finish.latitude * radians
        let value =
            pow(sin(latitudeDelta / 2), 2) +
            cos(startLatitude) *
                cos(finishLatitude) *
                pow(sin(longitudeDelta / 2), 2)
        return radius * 2 *
            atan2(sqrt(value), sqrt(max(0, 1 - value)))
    }
}

private struct FixtureCorpus {
    let schemaVersion: Int
    let contractSchemaVersion: Int
    let requiredScenarioIDs: [String]
    let envelopes: [String: [String: Any]]
}
