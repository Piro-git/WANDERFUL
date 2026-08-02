import Foundation
import XCTest
@testable import TrailMind

#if DEBUG
@MainActor
final class StagingProofLaunchSupportTests: XCTestCase {
    private let nonceDigest =
        StagingProofDigest.sha256("operator-bound-nonce")

    func testParserIgnoresOrdinaryAppLaunch() throws {
        XCTAssertNil(
            try StagingProofLaunchRequestParser.parse(
                arguments: ["TrailMind"]
            )
        )
    }

    func testParserAcceptsEveryCanonicalTypedFixture() throws {
        XCTAssertEqual(
            StagingProofInputFixtureID.allCases.count,
            18
        )
        for fixtureID in StagingProofInputFixtureID.allCases {
            let parsed = try XCTUnwrap(
                StagingProofLaunchRequestParser.parse(
                    arguments: arguments(for: fixtureID)
                )
            )
            XCTAssertEqual(parsed.fixtureID, fixtureID)
            XCTAssertEqual(parsed.nonceDigest, nonceDigest)
            XCTAssertEqual(
                parsed.fixtureID.proofCaseID,
                fixtureID.proofCaseID
            )
        }
    }

    func testParserRejectsRawCaseIDUnknownFixtureAndBadNonce()
        throws
    {
        XCTAssertThrowsError(
            try StagingProofLaunchRequestParser.parse(
                arguments: [
                    "TrailMind",
                    StagingProofLaunchRequestParser.marker,
                    StagingProofLaunchRequestParser.fixtureKey,
                    StagingProofCaseID.case01.rawValue,
                    StagingProofLaunchRequestParser.nonceDigestKey,
                    nonceDigest
                ]
            )
        ) {
            XCTAssertEqual(
                $0 as? StagingProofLaunchRequestError,
                .unknownFixture
            )
        }
        XCTAssertThrowsError(
            try StagingProofLaunchRequestParser.parse(
                arguments: [
                    "TrailMind",
                    StagingProofLaunchRequestParser.marker,
                    StagingProofLaunchRequestParser.fixtureKey,
                    "case-99-unknown-input-v1",
                    StagingProofLaunchRequestParser.nonceDigestKey,
                    nonceDigest
                ]
            )
        )
        XCTAssertThrowsError(
            try StagingProofLaunchRequestParser.parse(
                arguments: [
                    "TrailMind",
                    StagingProofLaunchRequestParser.marker,
                    StagingProofLaunchRequestParser.fixtureKey,
                    StagingProofInputFixtureID.case01.rawValue,
                    StagingProofLaunchRequestParser.nonceDigestKey,
                    nonceDigest.uppercased()
                ]
            )
        ) {
            XCTAssertEqual(
                $0 as? StagingProofLaunchRequestError,
                .invalidNonceDigest
            )
        }
    }

    func testParserRejectsMissingAndDuplicateProofArguments() {
        XCTAssertThrowsError(
            try StagingProofLaunchRequestParser.parse(
                arguments: [
                    "TrailMind",
                    StagingProofLaunchRequestParser.marker
                ]
            )
        )
        var duplicate = arguments(for: .case01)
        duplicate.append(
            StagingProofLaunchRequestParser.fixtureKey
        )
        duplicate.append(
            StagingProofInputFixtureID.case01.rawValue
        )
        XCTAssertThrowsError(
            try StagingProofLaunchRequestParser.parse(
                arguments: duplicate
            )
        )
    }

    func testPostgresCancellationGateClientUsesExactBoundRequestAndResponse()
        async throws
    {
        let recorder = StagingProofGateRequestRecorder()
        let client = StagingProofPostgresCancellationGateClient(
            baseURL: URL(
                string: "https://example.invalid/proof-run/"
            )!,
            nonceDigest: nonceDigest,
            dataLoader: { request in
                try await recorder.load(request)
            }
        )

        try await client.wait(for: .queryActive)
        try await client.wait(for: .cancelSettled)

        let requests = await recorder.requests()
        XCTAssertEqual(requests.count, 2)
        for (request, phase) in zip(
            requests,
            ["query_active", "cancel_settled"]
        ) {
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(
                request.url?.path,
                "/proof-run/api/staging-proof/postgres-cancellation-gate"
            )
            XCTAssertEqual(
                request.value(
                    forHTTPHeaderField: "Content-Type"
                ),
                "application/json"
            )
            let body = try XCTUnwrap(request.httpBody)
            let object = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body)
                    as? [String: Any]
            )
            XCTAssertEqual(
                Set(object.keys),
                ["schemaVersion", "caseId", "nonceDigest", "phase"]
            )
            XCTAssertEqual(object["schemaVersion"] as? Int, 1)
            XCTAssertEqual(
                object["caseId"] as? String,
                StagingProofCaseID.case13.rawValue
            )
            XCTAssertEqual(
                object["nonceDigest"] as? String,
                nonceDigest
            )
            XCTAssertEqual(object["phase"] as? String, phase)
        }
    }

    func testPostgresCancellationGateClientRejectsUnboundOrMalformedResults()
        async throws
    {
        let malformed = StagingProofPostgresCancellationGateClient(
            baseURL: URL(string: "https://example.invalid/")!,
            nonceDigest: nonceDigest,
            dataLoader: { request in
                let data = try JSONSerialization.data(
                    withJSONObject: [
                        "schemaVersion": 1,
                        "state": "query_active",
                        "extra": true
                    ]
                )
                let response = HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: [
                        "Content-Type": "application/json"
                    ]
                )!
                return (data, response)
            }
        )
        await XCTAssertThrowsErrorAsync(
            try await malformed.wait(for: .queryActive)
        ) {
            XCTAssertEqual(
                $0 as? StagingProofPostgresCancellationGateClientError,
                .invalidResponse
            )
        }

        let redirected = StagingProofPostgresCancellationGateClient(
            baseURL: URL(string: "https://example.invalid/")!,
            nonceDigest: nonceDigest,
            dataLoader: { _ in
                let data = try JSONSerialization.data(
                    withJSONObject: [
                        "schemaVersion": 1,
                        "state": "query_active"
                    ]
                )
                let response = HTTPURLResponse(
                    url: URL(string: "https://redirect.invalid/")!,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: [
                        "Content-Type": "application/json"
                    ]
                )!
                return (data, response)
            }
        )
        await XCTAssertThrowsErrorAsync(
            try await redirected.wait(for: .queryActive)
        ) {
            XCTAssertEqual(
                $0 as? StagingProofPostgresCancellationGateClientError,
                .invalidResponse
            )
        }

        let invalidEndpoint =
            StagingProofPostgresCancellationGateClient(
                baseURL: URL(string: "http://example.invalid/")!,
                nonceDigest: nonceDigest,
                dataLoader: { _ in
                    XCTFail("An invalid endpoint must not be loaded.")
                    throw URLError(.badURL)
                }
            )
        await XCTAssertThrowsErrorAsync(
            try await invalidEndpoint.wait(for: .queryActive)
        ) {
            XCTAssertEqual(
                $0 as? StagingProofPostgresCancellationGateClientError,
                .invalidEndpoint
            )
        }
    }

    func testCanonicalFixtureSemanticsUseTypedFieldsNotPrompts() {
        let case04 = StagingProofFixture(
            id: .case04
        ).adventureIntent()
        XCTAssertEqual(case04.startLocationQuery, "Brocken")
        XCTAssertEqual(
            case04.mustHaveResearchExperiences,
            [
                MustHaveResearchExperienceConstraint(
                    experience: .peak
                )
            ]
        )

        let case05 = StagingProofFixture(
            id: .case05
        ).adventureIntent()
        XCTAssertEqual(
            case05.mustHaveResearchExperiences,
            [
                MustHaveResearchExperienceConstraint(
                    experience: .landmark
                )
            ]
        )

        let case12 = StagingProofFixture(
            id: .case12
        ).adventureIntent()
        XCTAssertEqual(case12.routeType, .pointToPoint)
        XCTAssertEqual(case12.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(case12.endLocationQuery, "Schierke")
    }

    func testReceiptCodecRoundTripsExactSchemaAndExplicitNulls()
        throws
    {
        let receipt = validReceipt()
        let data = try StagingProofReceiptCodec.encode(receipt)
        XCTAssertEqual(
            try StagingProofReceiptCodec.decode(data),
            receipt
        )

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data)
                as? [String: Any]
        )
        XCTAssertEqual(
            Set(object.keys),
            Set(
                StagingProofReceiptV1.CodingKeys
                    .allCases.map(\.rawValue)
            )
        )
        XCTAssertTrue(object["requestIdDigest"] is NSNull)
        XCTAssertTrue(object["blockerCode"] is NSNull)
        XCTAssertFalse(
            String(decoding: data, as: UTF8.self)
                .localizedCaseInsensitiveContains("prompt")
        )
        XCTAssertFalse(
            String(decoding: data, as: UTF8.self)
                .contains("://")
        )
    }

    func testReceiptCodecRejectsUnknownFieldsAndVocabulary()
        throws
    {
        let data = try StagingProofReceiptCodec.encode(
            validReceipt()
        )
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data)
                as? [String: Any]
        )
        object["rawPrompt"] = "must never be accepted"
        let unknownFieldData = try JSONSerialization.data(
            withJSONObject: object
        )
        XCTAssertThrowsError(
            try StagingProofReceiptCodec.decode(
                unknownFieldData
            )
        ) {
            XCTAssertEqual(
                $0 as? StagingProofReceiptCodec.CodecError,
                .unexpectedFields
            )
        }

        object.removeValue(forKey: "rawPrompt")
        object["semanticObservationIds"] = [
            "caller_asserted_green"
        ]
        let unknownValueData = try JSONSerialization.data(
            withJSONObject: object
        )
        XCTAssertThrowsError(
            try StagingProofReceiptCodec.decode(
                unknownValueData
            )
        ) {
            XCTAssertEqual(
                $0 as? StagingProofReceiptCodec.CodecError,
                .invalidValue
            )
        }
    }

    func testReceiptCodecRejectsCaseFixtureMismatchAndDigestLeak()
        throws
    {
        let data = try StagingProofReceiptCodec.encode(
            validReceipt()
        )
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data)
                as? [String: Any]
        )
        object["caseId"] =
            StagingProofCaseID.case01.rawValue
        object["requestIdDigest"] = "not-a-digest"
        let malformed = try JSONSerialization.data(
            withJSONObject: object
        )
        XCTAssertThrowsError(
            try StagingProofReceiptCodec.decode(malformed)
        ) {
            XCTAssertEqual(
                $0 as? StagingProofReceiptCodec.CodecError,
                .invalidValue
            )
        }
    }

    func testReceiptCodecRejectsOutOfBoundsCountsAndIncoherentRows()
        throws
    {
        let data = try StagingProofReceiptCodec.encode(
            validReceipt()
        )
        let original = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data)
                as? [String: Any]
        )

        var excessiveRequests = original
        excessiveRequests["researchCoordinatorRequestCount"] = 3
        XCTAssertThrowsError(
            try StagingProofReceiptCodec.decode(
                JSONSerialization.data(
                    withJSONObject: excessiveRequests
                )
            )
        ) {
            XCTAssertEqual(
                $0 as? StagingProofReceiptCodec.CodecError,
                .invalidValue
            )
        }

        var incoherentPresentation = original
        var presentation = try XCTUnwrap(
            incoherentPresentation["presentation"]
                as? [String: Any]
        )
        presentation["count"] = 1
        incoherentPresentation["presentation"] = presentation
        XCTAssertThrowsError(
            try StagingProofReceiptCodec.decode(
                JSONSerialization.data(
                    withJSONObject: incoherentPresentation
                )
            )
        ) {
            XCTAssertEqual(
                $0 as? StagingProofReceiptCodec.CodecError,
                .invalidValue
            )
        }

        var unknownPlanningGap = original
        unknownPlanningGap["backendPlanningGapCodes"] = [
            "caller_asserted_gap"
        ]
        XCTAssertThrowsError(
            try StagingProofReceiptCodec.decode(
                JSONSerialization.data(
                    withJSONObject: unknownPlanningGap
                )
            )
        ) {
            XCTAssertEqual(
                $0 as? StagingProofReceiptCodec.CodecError,
                .invalidValue
            )
        }
    }

    func testResultDigestRejectsObservedStateMutationForCriticalCases()
        throws
    {
        let cases: [
            (
                StagingProofInputFixtureID,
                ([String: Any]) throws -> [String: Any],
                (inout [String: Any]) throws -> Void
            )
        ] = [
            (
                .case04,
                { object in
                    var value = object
                    value["semanticObservationIds"] = [
                        "brocken_anchor_returned",
                        "canonical_intent_bound",
                        "named_brocken_must_have_satisfied",
                        "real_route_quality_ranked",
                        "research_waypoints_visited"
                    ]
                    value["limitationCauseIds"] = [
                        "access_unverified"
                    ]
                    return value
                },
                { value in
                    value["semanticObservationIds"] = [
                        "brocken_anchor_returned",
                        "canonical_intent_bound",
                        "real_route_quality_ranked",
                        "research_waypoints_visited"
                    ]
                }
            ),
            (
                .case05,
                { object in
                    var value = object
                    value["semanticObservationIds"] = [
                        "canonical_intent_bound",
                        "legacy_fallback_once",
                        "must_have_shortfall_observed"
                    ]
                    value["limitationCauseIds"] = [
                        "insufficient_candidate_count"
                    ]
                    return value
                },
                { value in
                    value["limitationCauseIds"] = []
                }
            ),
            (
                .case13,
                { object in
                    var value = object
                    var cancellation = try XCTUnwrap(
                        value["cancellation"] as? [String: Any]
                    )
                    cancellation["attemptDigest"] =
                        StagingProofDigest.sha256("cancel-attempt")
                    cancellation["postCancelTerminalState"] =
                        "cancelled"
                    value["cancellation"] = cancellation
                    return value
                },
                { value in
                    var cancellation = try XCTUnwrap(
                        value["cancellation"] as? [String: Any]
                    )
                    cancellation[
                        "postCancelCoordinatorResultCount"
                    ] = 1
                    value["cancellation"] = cancellation
                }
            ),
            (
                .case14,
                { object in
                    var value = object
                    value["semanticObservationIds"] = [
                        "canonical_intent_bound",
                        "graphhopper_timeout_observed",
                        "legacy_fallback_once"
                    ]
                    value["limitationCauseIds"] = [
                        "graphhopper_timeout"
                    ]
                    return value
                },
                { value in
                    value["limitationCauseIds"] = []
                }
            ),
            (
                .case16,
                { object in
                    var value = object
                    var timings = try XCTUnwrap(
                        value["iosStageTimings"]
                            as? [String: Any]
                    )
                    timings["response_conversion"] = [
                        "under_100ms"
                    ]
                    value["iosStageTimings"] = timings
                    return value
                },
                { value in
                    var timings = try XCTUnwrap(
                        value["iosStageTimings"]
                            as? [String: Any]
                    )
                    timings["response_conversion"] = []
                    value["iosStageTimings"] = timings
                }
            ),
            (
                .case17,
                { $0 },
                { value in
                    value["semanticObservationIds"] = []
                }
            ),
            (
                .case18,
                { object in
                    var value = object
                    var retry = try XCTUnwrap(
                        value["retry"] as? [String: Any]
                    )
                    retry["priorAttemptDigest"] =
                        StagingProofDigest.sha256("prior-attempt")
                    retry["currentAttemptDigest"] =
                        StagingProofDigest.sha256("current-attempt")
                    retry["priorRequestIdDigest"] =
                        StagingProofDigest.sha256("prior-request")
                    retry["currentRequestIdDigest"] =
                        StagingProofDigest.sha256("current-request")
                    retry["priorResultDigest"] =
                        StagingProofDigest.sha256("prior-result")
                    retry["currentResultDigest"] =
                        StagingProofDigest.sha256("current-result")
                    retry["priorTerminalState"] = "no_routes"
                    retry["currentTerminalState"] =
                        "suggestions_ready"
                    retry["postResetPlannerTerminalState"] =
                        "generating"
                    value["retry"] = retry
                    return value
                },
                { value in
                    var retry = try XCTUnwrap(
                        value["retry"] as? [String: Any]
                    )
                    retry["postResetSuggestionCount"] = 1
                    value["retry"] = retry
                }
            )
        ]

        for (fixtureID, prepare, mutate) in cases {
            var baseline = try prepare(
                try receiptObject(validReceipt())
            )
            baseline["caseId"] =
                fixtureID.proofCaseID.rawValue
            baseline["inputFixtureId"] = fixtureID.rawValue
            let canonicalData =
                try canonicalReceiptData(baseline)
            _ = try StagingProofReceiptCodec.decode(
                canonicalData
            )

            var mutated = try XCTUnwrap(
                JSONSerialization.jsonObject(
                    with: canonicalData
                ) as? [String: Any]
            )
            try mutate(&mutated)
            XCTAssertThrowsError(
                try StagingProofReceiptCodec.decode(
                    JSONSerialization.data(
                        withJSONObject: mutated
                    )
                ),
                "Mutation was not bound for \(fixtureID.rawValue)."
            ) {
                XCTAssertEqual(
                    $0 as? StagingProofReceiptCodec.CodecError,
                    .invalidValue
                )
            }
        }
    }

    private func receiptObject(
        _ receipt: StagingProofReceiptV1
    ) throws -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: encoder.encode(receipt)
            ) as? [String: Any]
        )
    }

    private func canonicalReceiptData(
        _ object: [String: Any]
    ) throws -> Data {
        let source = try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys]
        )
        var receipt = try JSONDecoder().decode(
            StagingProofReceiptV1.self,
            from: source
        )
        receipt.resultDigest =
            StagingProofResultDigestV1.compute(receipt)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(receipt)
    }

    private func arguments(
        for fixtureID: StagingProofInputFixtureID
    ) -> [String] {
        [
            "TrailMind",
            StagingProofLaunchRequestParser.marker,
            StagingProofLaunchRequestParser.fixtureKey,
            fixtureID.rawValue,
            StagingProofLaunchRequestParser.nonceDigestKey,
            nonceDigest
        ]
    }

    private func validReceipt() -> StagingProofReceiptV1 {
        let timings = Dictionary(
            uniqueKeysWithValues:
                StagingProofReceiptCodec.stageKeys.map {
                    (
                        $0,
                        $0 == "end_to_end"
                            ? [
                                StagingProofTimingBucket
                                    .under100Milliseconds
                            ]
                            : []
                    )
                }
        )
        var receipt = StagingProofReceiptV1(
            schemaVersion: StagingProofReceiptV1.schemaVersion,
            proofVersion: StagingProofReceiptV1.proofVersion,
            manifestDigest:
                StagingProofReceiptV1.manifestDigest,
            caseId: StagingProofCaseID.case17.rawValue,
            inputFixtureId:
                StagingProofInputFixtureID.case17.rawValue,
            lane: .live,
            nonceDigest: nonceDigest,
            requestIdDigest: nil,
            resultDigest: String(repeating: "0", count: 64),
            proofTerminalState: .disabled,
            plannerTerminalState: .idle,
            adapterState: "not_observed",
            researchOutcome: "none",
            researchCoordinatorRequestCount: 0,
            legacyRoutingRequestCount: 0,
            plannerAttemptCount: 0,
            backendPlanningGapCodes: [],
            semanticObservationIds: [
                "feature_disabled_zero_research"
            ],
            limitationCauseIds: ["feature_disabled"],
            selectionState: nil,
            sourceEnvelopeState: nil,
            alternativeCount: 0,
            contractConversion:
                StagingProofContractConversionReceipt(
                    coordinatorSelectionOrderDigest: nil,
                    plannerSuggestionOrderDigest: nil,
                    acceptedCount: 0,
                    rejectedCount: 0
                ),
            presentation: StagingProofPresentationReceipt(
                inputOrderDigest: nil,
                outputOrderDigest: nil,
                count: 0,
                kinds: []
            ),
            cancellation: StagingProofCancellationReceipt(
                attemptDigest: nil,
                postCancelTerminalState: nil,
                postCancelCoordinatorResultCount: 0,
                postCancelLegacyRoutingCount: 0
            ),
            retry: StagingProofRetryReceipt(
                priorAttemptDigest: nil,
                currentAttemptDigest: nil,
                priorRequestIdDigest: nil,
                currentRequestIdDigest: nil,
                priorResultDigest: nil,
                priorTerminalState: nil,
                currentTerminalState: nil,
                currentResultDigest: nil,
                postResetPlannerTerminalState: nil,
                postResetSuggestionCount: 0,
                postResetResearchContextDigest: nil,
                postResetClarificationDigest: nil,
                postResetRecoveryDigest: nil
            ),
            iosStageTimings: timings,
            diagnosticChecks: StagingProofDiagnosticChecks(
                productionClientPath: .notApplicable,
                contractConversion: .notApplicable,
                qualityRanking: .notApplicable,
                presentation: .notApplicable,
                cancellation: .notApplicable,
                retryFreshness: .notApplicable
            ),
            blockerCode: nil
        )
        receipt.resultDigest =
            StagingProofResultDigestV1.compute(receipt)
        return receipt
    }
}

private actor StagingProofGateRequestRecorder {
    private var storage: [URLRequest] = []

    func load(
        _ request: URLRequest
    ) throws -> (Data, URLResponse) {
        storage.append(request)
        let body = try XCTUnwrap(request.httpBody)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body)
                as? [String: Any]
        )
        let phase = try XCTUnwrap(object["phase"] as? String)
        let data = try JSONSerialization.data(
            withJSONObject: [
                "schemaVersion": 1,
                "state": phase
            ]
        )
        let response = HTTPURLResponse(
            url: try XCTUnwrap(request.url),
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "application/json"
            ]
        )!
        return (data, response)
    }

    func requests() -> [URLRequest] {
        storage
    }
}

@MainActor
private func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ errorHandler: (Error) -> Void = { _ in }
) async {
    do {
        _ = try await expression()
        XCTFail(
            "Expected expression to throw.",
            file: file,
            line: line
        )
    } catch {
        errorHandler(error)
    }
}
#endif
