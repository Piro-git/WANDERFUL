import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class OutdoorAdventurePlanningClientTests: XCTestCase {
    override func setUp() {
        super.setUp()
        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [])
    }

    func testFeatureFlagMissingFalseAndMalformedValuesStayDisabled() throws {
        let values: [Any?] = [
            nil,
            "",
            "false",
            "0",
            "enabled",
            "2",
            " true-ish ",
            true,
            1
        ]

        for value in values {
            var configuration: [String: Any] = [
                "INTENT_BACKEND_BASE_URL": "https://example.com"
            ]
            if let value {
                configuration["RESEARCH_GUIDED_PLANNING_ENABLED"] = value
            }
            let bundle = try makeConfigurationBundle(configuration)
            XCTAssertFalse(
                TrailMindBackendConfiguration.researchGuidedPlanningEnabled(
                    bundle: bundle
                )
            )
            XCTAssertTrue(
                OutdoorAdventurePlanningClientFactory.makeDefault(
                    bundle: bundle
                ) is NoOpOutdoorAdventurePlanningClientV1
            )
        }
    }

    func testOnlyTrueYesAndOneSelectBackendClientWithValidURL() throws {
        for value in ["true", " TRUE ", "yes", "YeS", "1", " 1 "] {
            let bundle = try makeConfigurationBundle([
                "INTENT_BACKEND_BASE_URL": "https://example.com",
                "RESEARCH_GUIDED_PLANNING_ENABLED": value
            ])
            XCTAssertTrue(
                TrailMindBackendConfiguration.researchGuidedPlanningEnabled(
                    bundle: bundle
                )
            )
            XCTAssertTrue(
                OutdoorAdventurePlanningClientFactory.makeDefault(
                    bundle: bundle
                ) is BackendOutdoorAdventurePlanningClientV1
            )
        }

        let invalidURLBundle = try makeConfigurationBundle([
            "INTENT_BACKEND_BASE_URL": "not a valid backend URL",
            "RESEARCH_GUIDED_PLANNING_ENABLED": "true"
        ])
        XCTAssertFalse(
            TrailMindBackendConfiguration.researchGuidedPlanningEnabled(
                bundle: invalidURLBundle
            )
        )
        XCTAssertTrue(
            OutdoorAdventurePlanningClientFactory.makeDefault(
                bundle: invalidURLBundle
            ) is NoOpOutdoorAdventurePlanningClientV1
        )
    }

    func testDisabledClientPerformsNoAuthorizationOrNetworkWork() async throws {
        let bundle = try makeConfigurationBundle([
            "INTENT_BACKEND_BASE_URL": "https://example.com",
            "RESEARCH_GUIDED_PLANNING_ENABLED": "false"
        ])
        let authorizer = RecordingOutdoorAdventurePlanningAuthorizer()
        let client = OutdoorAdventurePlanningClientFactory.makeDefault(
            bundle: bundle,
            session: makeTestSession(),
            authorizer: authorizer
        )

        let result = try await client.plan(
            OutdoorAdventurePlanningRequestV1(intent: try validIntent())
        )

        XCTAssertEqual(result.state, .unsupported)
        let costs = await authorizer.costs()
        XCTAssertEqual(costs, [])
        XCTAssertEqual(
            OutdoorAdventurePlanningURLProtocolStub.capturedRequests().count,
            0
        )
    }

    func testExactEndpointMethodHeadersRequestIDAndAuthorizationCost() async throws {
        OutdoorAdventurePlanningURLProtocolStub.reset(
            responses: [.init(statusCode: 200, data: try routedResponse())]
        )
        let authorizer = RecordingOutdoorAdventurePlanningAuthorizer()

        let result = try await makeClient(authorizer: authorizer).plan(
            OutdoorAdventurePlanningRequestV1(intent: try validIntent())
        )

        XCTAssertEqual(result.state, .routed)
        let request = try XCTUnwrap(
            OutdoorAdventurePlanningURLProtocolStub.capturedRequests().first
        )
        XCTAssertEqual(
            request.url?.absoluteString,
            "https://example.com/api/outdoor-research/plan-route"
        )
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Content-Type"),
            "application/json"
        )
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Accept"),
            "application/json"
        )
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Authorization"),
            "TrailMindRouteSession test-session-token-1"
        )
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "X-TrailMind-Request-ID"),
            Self.requestID.uuidString
        )
        XCTAssertEqual(request.timeoutInterval, 30)
        let costs = await authorizer.costs()
        XCTAssertEqual(costs, [12])
    }

    func testRequestEncodingContainsOnlySchemaVersionAndIntent() async throws {
        OutdoorAdventurePlanningURLProtocolStub.reset(
            responses: [.init(statusCode: 200, data: try routedResponse())]
        )

        _ = try await makeClient().plan(
            OutdoorAdventurePlanningRequestV1(intent: try validIntent())
        )

        let body = try XCTUnwrap(
            OutdoorAdventurePlanningURLProtocolStub.requestBodies().first
        )
        let root = try jsonDictionary(body)
        XCTAssertEqual(Set(root.keys), Set(["schemaVersion", "intent"]))
        XCTAssertEqual(root["schemaVersion"] as? Int, 1)
        let intent = try XCTUnwrap(root["intent"] as? [String: Any])
        XCTAssertEqual(Set(intent.keys), Set([
            "schemaVersion",
            "activity",
            "geographicAnchor",
            "routeType",
            "distanceRangeKm",
            "durationRangeMinutes",
            "maximumElevationGainMeters",
            "maximumTechnicalDifficulty",
            "mustHaveExperiences",
            "preferredExperiences",
            "avoidedExperiences",
            "requiredFacilities",
            "groupContext",
            "dateOrSeason",
            "overnightRequirements",
            "transportRequirements",
            "unresolvedClarificationQuestions"
        ]))
        XCTAssertTrue(intent["distanceRangeKm"] is [String: Any])
        XCTAssertNil(body.range(of: Data("prompt".utf8)))
        XCTAssertNil(body.range(of: Data("dossier".utf8)))
        XCTAssertNil(body.range(of: Data("provider".utf8)))
        XCTAssertNil(body.range(of: Data("evidenceIds".utf8)))
        XCTAssertNil(body.range(of: Data("policyOverride".utf8)))
        XCTAssertNil(body.range(of: Data("url".utf8)))
    }

    func testRequestSizeIsRejectedBeforeAuthorizationAndNetworking() async throws {
        let authorizer = RecordingOutdoorAdventurePlanningAuthorizer()
        let limits = OutdoorAdventurePlanningTransportLimitsV1(
            maximumRequestBodyBytes: 32,
            maximumSuccessBodyBytes: 9 * 1_024 * 1_024,
            maximumErrorBodyBytes: 64 * 1_024
        )

        await XCTAssertThrowsErrorAsync(
            try await makeClient(
                authorizer: authorizer,
                limits: limits
            ).plan(
                OutdoorAdventurePlanningRequestV1(intent: try validIntent())
            )
        ) { error in
            XCTAssertEqual(
                error as? OutdoorAdventurePlanningClientFailure,
                .requestTooLarge
            )
        }
        let costs = await authorizer.costs()
        XCTAssertEqual(costs, [])
        XCTAssertTrue(
            OutdoorAdventurePlanningURLProtocolStub.capturedRequests().isEmpty
        )
    }

    func testClarificationRequiredReturnsStrictTypedState() async throws {
        let intent = try unresolvedIntent()
        let intentObject = try jsonObject(intent)
        let questions = try XCTUnwrap(
            intentObject["unresolvedClarificationQuestions"] as? [[String: Any]]
        )
        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [
            .init(
                statusCode: 200,
                data: try orchestrationResponse(
                    state: "clarification_required",
                    normalizedIntent: intentObject,
                    planningGaps: [],
                    clarificationQuestions: questions,
                    routedAlternatives: NSNull()
                )
            )
        ])

        let result = try await makeClient().plan(
            OutdoorAdventurePlanningRequestV1(intent: intent)
        )

        guard case let .clarificationRequired(context) = result else {
            return XCTFail("Expected clarification_required")
        }
        XCTAssertEqual(context.state, .clarificationRequired)
        XCTAssertEqual(context.normalizedIntent, intent)
        XCTAssertEqual(
            context.clarificationQuestions,
            intent.unresolvedClarificationQuestions
        )
        XCTAssertTrue(context.planningGaps.isEmpty)
    }

    func testUnsupportedReturnsStrictTypedState() async throws {
        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [
            .init(
                statusCode: 200,
                data: try nonRoutedResponse(state: "unsupported")
            )
        ])

        let result = try await makeClient().plan(
            OutdoorAdventurePlanningRequestV1(intent: try validIntent())
        )

        guard case let .unsupported(context) = result else {
            return XCTFail("Expected unsupported")
        }
        XCTAssertEqual(context.state, .unsupported)
        XCTAssertTrue(context.clarificationQuestions.isEmpty)
    }

    func testNoViableRouteReturnsStrictTypedState() async throws {
        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [
            .init(
                statusCode: 200,
                data: try nonRoutedResponse(state: "no_viable_route")
            )
        ])

        let result = try await makeClient().plan(
            OutdoorAdventurePlanningRequestV1(intent: try validIntent())
        )

        guard case let .noViableRoute(context) = result else {
            return XCTFail("Expected no_viable_route")
        }
        XCTAssertEqual(context.state, .noViableRoute)
        XCTAssertTrue(context.planningGaps.isEmpty)
    }

    func testPartialReturnsValidatedNestedRouteSelectionAndPlanningGaps() async throws {
        let gap = validPlanningGap()
        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [
            .init(
                statusCode: 200,
                data: try routedResponse(
                    state: "partial",
                    planningGaps: [gap]
                )
            )
        ])

        let result = try await makeClient().plan(
            OutdoorAdventurePlanningRequestV1(intent: try validIntent())
        )

        guard case let .partial(context) = result else {
            return XCTFail("Expected partial")
        }
        XCTAssertEqual(context.state, .partial)
        XCTAssertEqual(context.planningGaps.count, 1)
        XCTAssertEqual(
            context.planningGaps[0].code,
            .scenicQualityNotVerifiable
        )
        XCTAssertFalse(context.routeSelection.alternatives.isEmpty)
        XCTAssertTrue(context.routeSelection.alternatives.allSatisfy {
            $0.suggestion.route.isVerifiedRoutedResult
        })
        XCTAssertTrue(
            context.routeSelection.alternatives.contains { alternative in
                alternative.researchProvenance.knownLimitations.contains(
                    .mappedPresenceOnly
                )
            }
        )
    }

    func testRoutedReturnsValidatedNestedRouteSelection() async throws {
        OutdoorAdventurePlanningURLProtocolStub.reset(
            responses: [.init(statusCode: 200, data: try routedResponse())]
        )

        let result = try await makeClient().plan(
            OutdoorAdventurePlanningRequestV1(intent: try validIntent())
        )

        guard case let .routed(context) = result else {
            return XCTFail("Expected routed")
        }
        XCTAssertEqual(context.state, .routed)
        XCTAssertTrue(context.planningGaps.isEmpty)
        XCTAssertEqual(context.routeSelection.sourceEnvelopeState, .routed)
        XCTAssertFalse(context.routeSelection.alternatives.isEmpty)
        XCTAssertTrue(context.routeSelection.alternatives.allSatisfy {
            $0.suggestion.route.isVerifiedRoutedResult
        })
    }

    func testRoutedWithPlanningGapsFailsClosed() async throws {
        try await assertClientFailure(
            response: routedResponse(planningGaps: [validPlanningGap()]),
            expected: .invalidResponse
        )
    }

    func testMissingNullInconsistentOrQualityRejectedRoutedAlternativesFailClosed() async throws {
        let valid = try jsonDictionary(routedResponse())
        var missing = valid
        missing.removeValue(forKey: "routedAlternatives")

        var null = valid
        null["routedAlternatives"] = NSNull()

        var inconsistent = valid
        var inconsistentIntent = try XCTUnwrap(
            inconsistent["normalizedIntent"] as? [String: Any]
        )
        inconsistentIntent["activity"] = "biking"
        inconsistent["normalizedIntent"] = inconsistentIntent

        let openLoop = try fixtureEnvelope(named: "openLoopOnly")
        var qualityRejected = valid
        qualityRejected["normalizedIntent"] = openLoop["normalizedIntent"]
        qualityRejected["routedAlternatives"] = openLoop

        for response in [missing, null, inconsistent, qualityRejected] {
            try await assertClientFailure(
                response: jsonData(response),
                expected: .invalidResponse
            )
        }
    }

    func testUnknownOuterAndNestedFieldsFailClosed() async throws {
        var unknownOuter = try jsonDictionary(routedResponse())
        unknownOuter["unexpected"] = true

        var unknownNested = try jsonDictionary(routedResponse())
        var routed = try XCTUnwrap(
            unknownNested["routedAlternatives"] as? [String: Any]
        )
        routed["unexpected"] = true
        unknownNested["routedAlternatives"] = routed

        for response in [unknownOuter, unknownNested] {
            try await assertClientFailure(
                response: jsonData(response),
                expected: .invalidResponse
            )
        }
    }

    func testInvalidSchemaPolicyAndStateFailClosed() async throws {
        let valid = try jsonDictionary(routedResponse())
        var invalidSchema = valid
        invalidSchema["schemaVersion"] = 2
        var invalidPolicy = valid
        invalidPolicy["policyVersion"] = "outdoor-adventure-orchestration-v2"
        var invalidState = valid
        invalidState["state"] = "successful"

        for response in [invalidSchema, invalidPolicy, invalidState] {
            try await assertClientFailure(
                response: jsonData(response),
                expected: .invalidResponse
            )
        }
    }

    func testDuplicateAndExcessiveGapsAndQuestionsFailClosed() async throws {
        let gap = validPlanningGap()
        var duplicateGaps = try jsonDictionary(
            nonRoutedResponse(state: "unsupported")
        )
        duplicateGaps["planningGaps"] = [gap, gap]

        var excessiveGaps = duplicateGaps
        excessiveGaps["planningGaps"] = Array(repeating: gap, count: 65)

        let intent = try unresolvedIntent()
        let intentObject = try jsonObject(intent)
        let question = try XCTUnwrap(
            (intentObject["unresolvedClarificationQuestions"] as? [[String: Any]])?
                .first
        )
        let duplicateQuestions: [String: Any] = [
            "schemaVersion": 1,
            "policyVersion": "outdoor-adventure-orchestration-v1",
            "state": "clarification_required",
            "normalizedIntent": intentObject,
            "planningGaps": [],
            "clarificationQuestions": [question, question],
            "routedAlternatives": NSNull()
        ]
        var excessiveQuestions = duplicateQuestions
        excessiveQuestions["clarificationQuestions"] = Array(
            repeating: question,
            count: 17
        )

        for response in [
            duplicateGaps,
            excessiveGaps,
            duplicateQuestions,
            excessiveQuestions
        ] {
            try await assertClientFailure(
                response: jsonData(response),
                expected: .invalidResponse
            )
        }
    }

    func testAdvertisedActualAndDishonestSuccessLengthsCannotBypassLimit() async throws {
        let limits = OutdoorAdventurePlanningTransportLimitsV1(
            maximumRequestBodyBytes: 64 * 1_024,
            maximumSuccessBodyBytes: 512,
            maximumErrorBodyBytes: 128
        )
        let responses: [OutdoorAdventurePlanningURLProtocolStub.Response] = [
            .init(
                statusCode: 200,
                data: Data(#"{"state":"unused"}"#.utf8),
                headerFields: ["Content-Length": "513"]
            ),
            .init(
                statusCode: 200,
                data: Data(repeating: 0x20, count: 513),
                chunkSize: 17
            ),
            .init(
                statusCode: 200,
                data: Data(repeating: 0x20, count: 513),
                headerFields: ["Content-Length": "8"],
                chunkSize: 19
            )
        ]

        for response in responses {
            OutdoorAdventurePlanningURLProtocolStub.reset(
                responses: [response]
            )
            await XCTAssertThrowsErrorAsync(
                try await makeClient(limits: limits).plan(
                    OutdoorAdventurePlanningRequestV1(
                        intent: try validIntent()
                    )
                )
            ) { error in
                XCTAssertEqual(
                    error as? OutdoorAdventurePlanningClientFailure,
                    .responseTooLarge
                )
            }
        }
    }

    func testOversizedErrorBodyFailsClosed() async throws {
        let limits = OutdoorAdventurePlanningTransportLimitsV1(
            maximumRequestBodyBytes: 64 * 1_024,
            maximumSuccessBodyBytes: 9 * 1_024 * 1_024,
            maximumErrorBodyBytes: 128
        )
        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [
            .init(
                statusCode: 500,
                data: Data(repeating: 0x20, count: 129),
                headerFields: ["Content-Length": "8"],
                chunkSize: 11
            )
        ])

        await XCTAssertThrowsErrorAsync(
            try await makeClient(limits: limits).plan(
                OutdoorAdventurePlanningRequestV1(intent: try validIntent())
            )
        ) { error in
            XCTAssertEqual(
                error as? OutdoorAdventurePlanningClientFailure,
                .responseTooLarge
            )
        }
    }

    func testCancellationStopsTransportAndRejectsLateCompletion() async throws {
        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [
            .init(
                statusCode: 200,
                data: try routedResponse(),
                delay: 0.2,
                deliversAfterStop: true
            )
        ])
        let client = makeClient()
        let request = OutdoorAdventurePlanningRequestV1(
            intent: try validIntent()
        )
        let task = Task { try await client.plan(request) }
        try await Task.sleep(for: .milliseconds(30))
        task.cancel()

        do {
            _ = try await task.value
            XCTFail("Cancellation must not become a late success.")
        } catch is CancellationError {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        try await Task.sleep(for: .milliseconds(250))
        XCTAssertGreaterThanOrEqual(
            OutdoorAdventurePlanningURLProtocolStub.stopLoadingCount(),
            1
        )
    }

    func testRefreshableSessionFailureRetriesExactlyOnce() async throws {
        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [
            .init(
                statusCode: 401,
                data: errorResponse(
                    code: "route_session_expired",
                    message: "private expired token detail"
                )
            ),
            .init(statusCode: 200, data: try routedResponse())
        ])
        let authorizer = RecordingOutdoorAdventurePlanningAuthorizer()

        let result = try await makeClient(authorizer: authorizer).plan(
            OutdoorAdventurePlanningRequestV1(intent: try validIntent())
        )

        XCTAssertEqual(result.state, .routed)
        let costs = await authorizer.costs()
        let invalidatedTokens = await authorizer.invalidatedTokens()
        XCTAssertEqual(costs, [12, 12])
        XCTAssertEqual(invalidatedTokens, ["test-session-token-1"])
        XCTAssertEqual(
            OutdoorAdventurePlanningURLProtocolStub.capturedRequests().count,
            2
        )
    }

    func testNonRefreshableResponseAndAuthorizationFailuresDoNotRetry() async throws {
        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [
            .init(
                statusCode: 401,
                data: errorResponse(
                    code: "authorization_failed",
                    message: "private authorization detail"
                )
            )
        ])
        let authorizer = RecordingOutdoorAdventurePlanningAuthorizer()
        await XCTAssertThrowsErrorAsync(
            try await makeClient(authorizer: authorizer).plan(
                OutdoorAdventurePlanningRequestV1(intent: try validIntent())
            )
        ) { error in
            XCTAssertEqual(
                error as? OutdoorAdventurePlanningClientFailure,
                .authorizationFailed
            )
        }
        let costs = await authorizer.costs()
        let invalidatedTokens = await authorizer.invalidatedTokens()
        XCTAssertEqual(costs, [12])
        XCTAssertEqual(invalidatedTokens, [])
        XCTAssertEqual(
            OutdoorAdventurePlanningURLProtocolStub.capturedRequests().count,
            1
        )

        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [])
        let failingAuthorizer = RecordingOutdoorAdventurePlanningAuthorizer(
            failure: .verificationFailed
        )
        await XCTAssertThrowsErrorAsync(
            try await makeClient(authorizer: failingAuthorizer).plan(
                OutdoorAdventurePlanningRequestV1(intent: try validIntent())
            )
        ) { error in
            XCTAssertEqual(
                error as? OutdoorAdventurePlanningClientFailure,
                .authorizationFailed
            )
        }
        let failingCosts = await failingAuthorizer.costs()
        XCTAssertEqual(failingCosts, [12])
        XCTAssertTrue(
            OutdoorAdventurePlanningURLProtocolStub.capturedRequests().isEmpty
        )
    }

    func testSafeErrorsNeverExposeProviderCoordinatesTokensOrRawPayloads() async throws {
        let sensitiveValues = [
            "graphhopper-provider-private-message",
            "47.2692,11.4041",
            "test-session-token-1",
            "private-evidence-id",
            "raw-dossier-payload"
        ]
        OutdoorAdventurePlanningURLProtocolStub.reset(responses: [
            .init(
                statusCode: 500,
                data: errorResponse(
                    code: "provider_private_failure",
                    message: sensitiveValues.joined(separator: " ")
                )
            )
        ])

        do {
            _ = try await makeClient().plan(
                OutdoorAdventurePlanningRequestV1(intent: try validIntent())
            )
            XCTFail("The provider failure must not become success.")
        } catch {
            let description = error.localizedDescription
            for sensitive in sensitiveValues {
                XCTAssertFalse(description.contains(sensitive))
            }
            XCTAssertEqual(
                error as? OutdoorAdventurePlanningClientFailure,
                .unavailable
            )
        }
    }

    private func assertClientFailure(
        response: Data,
        expected: OutdoorAdventurePlanningClientFailure,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async throws {
        OutdoorAdventurePlanningURLProtocolStub.reset(
            responses: [.init(statusCode: 200, data: response)]
        )
        await XCTAssertThrowsErrorAsync(
            try await makeClient().plan(
                OutdoorAdventurePlanningRequestV1(intent: try validIntent())
            ),
            file: file,
            line: line
        ) { error in
            XCTAssertEqual(
                error as? OutdoorAdventurePlanningClientFailure,
                expected,
                file: file,
                line: line
            )
        }
    }

    private func makeClient(
        authorizer: any RouteSessionAuthorizing =
            RecordingOutdoorAdventurePlanningAuthorizer(),
        limits: OutdoorAdventurePlanningTransportLimitsV1 = .standard
    ) -> BackendOutdoorAdventurePlanningClientV1 {
        BackendOutdoorAdventurePlanningClientV1(
            baseURL: URL(string: "https://example.com")!,
            session: makeTestSession(),
            authorizer: authorizer,
            limits: limits
        )
    }

    private func makeTestSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [
            OutdoorAdventurePlanningURLProtocolStub.self
        ]
        return URLSession(configuration: configuration)
    }

    private func validIntent() throws -> AdventureResearchIntentV1 {
        try AdventureResearchIntentV1(
            activity: .hiking,
            geographicAnchor: .resolved(
                name: "Innsbruck",
                coordinate: AdventureResearchCoordinateV1(
                    latitude: 47.2692,
                    longitude: 11.4041
                ),
                regionEntityID: UUID(
                    uuidString: "33333333-3333-4333-8333-333333333333"
                )
            ),
            routeType: .loop,
            distanceRangeKm: AdventureResearchDistanceRangeV1(
                min: 10,
                max: 16
            ),
            durationRangeMinutes: AdventureResearchDurationRangeV1(
                min: 210,
                max: 270
            ),
            maximumElevationGainMeters: 700,
            maximumTechnicalDifficulty: .hiking,
            mustHaveExperiences: [
                AdventureResearchExperienceRequirementV1(
                    experience: .viewpoint,
                    minimumCount: 2
                ),
                AdventureResearchExperienceRequirementV1(
                    experience: .waterfall,
                    minimumCount: 1
                )
            ],
            preferredExperiences: [.alpineHut],
            avoidedExperiences: [.exposedTrails],
            requiredFacilities: [.lunchHut],
            groupContext: AdventureResearchGroupContextV1(
                partySize: 2,
                includesChildren: false,
                youngestAge: nil,
                mobility: .standard,
                experienceLevel: .intermediate
            ),
            dateOrSeason: .season(.summer, year: 2026),
            overnightRequirements:
                AdventureResearchOvernightRequirementsV1(
                    required: false,
                    nights: 0,
                    allowedAccommodationTypes: []
                ),
            transportRequirements:
                AdventureResearchTransportRequirementsV1(
                    arrivalMode: .publicTransport,
                    returnToStart: true,
                    publicTransportRequired: false
                ),
            unresolvedClarificationQuestions: []
        )
    }

    private func unresolvedIntent() throws -> AdventureResearchIntentV1 {
        try AdventureResearchIntentV1(
            activity: .hiking,
            geographicAnchor: .unresolved(
                requirementCode: .locationRequired
            ),
            routeType: .loop,
            distanceRangeKm: nil,
            durationRangeMinutes: nil,
            maximumElevationGainMeters: nil,
            maximumTechnicalDifficulty: nil,
            mustHaveExperiences: [],
            preferredExperiences: [],
            avoidedExperiences: [],
            requiredFacilities: [],
            groupContext: AdventureResearchGroupContextV1(
                partySize: 1,
                includesChildren: false,
                youngestAge: nil,
                mobility: .unknown,
                experienceLevel: .unknown
            ),
            dateOrSeason: nil,
            overnightRequirements:
                AdventureResearchOvernightRequirementsV1(
                    required: false,
                    nights: 0,
                    allowedAccommodationTypes: []
                ),
            transportRequirements:
                AdventureResearchTransportRequirementsV1(
                    arrivalMode: .unknown,
                    returnToStart: true,
                    publicTransportRequired: false
                ),
            unresolvedClarificationQuestions: [
                AdventureResearchClarificationQuestionV1(
                    code: .locationRequired,
                    field: .geographicAnchor
                )
            ]
        )
    }

    private func routedResponse(
        state: String = "routed",
        planningGaps: [[String: Any]] = []
    ) throws -> Data {
        let routed = try fixtureEnvelope(named: "validAlternatives")
        return try orchestrationResponse(
            state: state,
            normalizedIntent: try XCTUnwrap(
                routed["normalizedIntent"] as? [String: Any]
            ),
            planningGaps: planningGaps,
            clarificationQuestions: [],
            routedAlternatives: routed
        )
    }

    private func nonRoutedResponse(state: String) throws -> Data {
        try orchestrationResponse(
            state: state,
            normalizedIntent: jsonObject(validIntent()),
            planningGaps: [],
            clarificationQuestions: [],
            routedAlternatives: NSNull()
        )
    }

    private func orchestrationResponse(
        state: String,
        normalizedIntent: [String: Any],
        planningGaps: [[String: Any]],
        clarificationQuestions: [[String: Any]],
        routedAlternatives: Any
    ) throws -> Data {
        try jsonData([
            "schemaVersion": 1,
            "policyVersion": "outdoor-adventure-orchestration-v1",
            "state": state,
            "normalizedIntent": normalizedIntent,
            "planningGaps": planningGaps,
            "clarificationQuestions": clarificationQuestions,
            "routedAlternatives": routedAlternatives
        ])
    }

    private func validPlanningGap() -> [String: Any] {
        [
            "code": "scenic_quality_not_verifiable",
            "affectedField": "preferredExperiences",
            "affectedValue": "viewpoint",
            "reason": "contract_dimension_missing",
            "requiresClarification": false,
            "requiresCapability": true
        ]
    }

    private func fixtureEnvelope(named name: String) throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent(
                "research_guided_routed_alternatives_v1.json"
            )
        let fixture = try jsonDictionary(Data(contentsOf: url))
        let envelopes = try XCTUnwrap(
            fixture["envelopes"] as? [String: Any]
        )
        return try XCTUnwrap(envelopes[name] as? [String: Any])
    }

    private func jsonObject<Value: Encodable>(
        _ value: Value
    ) throws -> [String: Any] {
        try jsonDictionary(JSONEncoder().encode(value))
    }

    private func jsonDictionary(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
    }

    private func jsonData(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys]
        )
    }

    private func errorResponse(code: String, message: String) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            "error": ["code": code, "message": message]
        ])
    }

    private func makeConfigurationBundle(
        _ values: [String: Any]
    ) throws -> Bundle {
        let identifier = UUID().uuidString.lowercased()
        let bundleURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "TrailMindOutdoorPlanning-\(identifier)",
                isDirectory: true
            )
            .appendingPathExtension("bundle")
        try FileManager.default.createDirectory(
            at: bundleURL,
            withIntermediateDirectories: true
        )
        var info: [String: Any] = [
            "CFBundleIdentifier": "com.trailmind.tests.\(identifier)",
            "CFBundleInfoDictionaryVersion": "6.0",
            "CFBundleName": "TrailMindOutdoorPlanningTests",
            "CFBundlePackageType": "BNDL",
            "CFBundleVersion": "1"
        ]
        for (key, value) in values {
            info[key] = value
        }
        let data = try PropertyListSerialization.data(
            fromPropertyList: info,
            format: .xml,
            options: 0
        )
        try data.write(
            to: bundleURL.appendingPathComponent(
                "Info.plist",
                isDirectory: false
            )
        )
        addTeardownBlock {
            try? FileManager.default.removeItem(at: bundleURL)
        }
        return try XCTUnwrap(Bundle(url: bundleURL))
    }

    nonisolated fileprivate static let requestID = UUID(
        uuidString: "11111111-1111-4111-8111-111111111111"
    )!
}

private actor RecordingOutdoorAdventurePlanningAuthorizer:
    RouteSessionAuthorizing
{
    private let failure: AppAttestServiceError?
    private var recordedCosts: [Int] = []
    private var invalidations: [String] = []

    init(failure: AppAttestServiceError? = nil) {
        self.failure = failure
    }

    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        recordedCosts.append(cost)
        if let failure {
            throw failure
        }
        return RouteSessionAuthorization(
            token: "test-session-token-\(recordedCosts.count)",
            requestID: OutdoorAdventurePlanningClientTests.requestID
        )
    }

    func invalidate(token: String) async {
        invalidations.append(token)
    }

    func costs() -> [Int] {
        recordedCosts
    }

    func invalidatedTokens() -> [String] {
        invalidations
    }
}

private final class OutdoorAdventurePlanningURLProtocolStub:
    URLProtocol,
    @unchecked Sendable
{
    struct Response: @unchecked Sendable {
        let statusCode: Int
        let chunks: [Data]
        let headerFields: [String: String]
        let delay: TimeInterval
        let deliversAfterStop: Bool

        init(
            statusCode: Int,
            data: Data,
            headerFields: [String: String] = [:],
            chunkSize: Int? = nil,
            delay: TimeInterval = 0,
            deliversAfterStop: Bool = false
        ) {
            self.statusCode = statusCode
            if let chunkSize, chunkSize > 0 {
                chunks = stride(
                    from: 0,
                    to: data.count,
                    by: chunkSize
                ).map { offset in
                    data.subdata(
                        in: offset..<min(offset + chunkSize, data.count)
                    )
                }
            } else {
                chunks = [data]
            }
            self.headerFields = headerFields
            self.delay = delay
            self.deliversAfterStop = deliversAfterStop
        }
    }

    private static let lock = NSLock()
    private nonisolated(unsafe) static var responses: [Response] = []
    private nonisolated(unsafe) static var requests: [URLRequest] = []
    private nonisolated(unsafe) static var bodies: [Data] = []
    private nonisolated(unsafe) static var stops = 0
    private let stateLock = NSLock()
    private var stopped = false

    static func reset(responses newResponses: [Response]) {
        lock.lock()
        responses = newResponses
        requests = []
        bodies = []
        stops = 0
        lock.unlock()
    }

    static func capturedRequests() -> [URLRequest] {
        lock.lock()
        let value = requests
        lock.unlock()
        return value
    }

    static func requestBodies() -> [Data] {
        lock.lock()
        let value = bodies
        lock.unlock()
        return value
    }

    static func stopLoadingCount() -> Int {
        lock.lock()
        let value = stops
        lock.unlock()
        return value
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(
        for request: URLRequest
    ) -> URLRequest {
        request
    }

    override func startLoading() {
        let body = request.httpBody ?? Self.readBodyStream(
            request.httpBodyStream
        )
        Self.lock.lock()
        Self.requests.append(request)
        Self.bodies.append(body)
        let response = Self.responses.isEmpty
            ? Response(
                statusCode: 500,
                data: Data(
                    #"{"error":{"code":"missing_test_response"}}"#.utf8
                )
            )
            : Self.responses.removeFirst()
        Self.lock.unlock()

        let deliver: @Sendable () -> Void = { [weak self] in
            self?.deliver(response)
        }
        if response.delay > 0 {
            DispatchQueue.global().asyncAfter(
                deadline: .now() + response.delay,
                execute: deliver
            )
        } else {
            deliver()
        }
    }

    override func stopLoading() {
        stateLock.lock()
        stopped = true
        stateLock.unlock()
        Self.lock.lock()
        Self.stops += 1
        Self.lock.unlock()
    }

    private func deliver(_ response: Response) {
        stateLock.lock()
        let shouldDeliver = !stopped || response.deliversAfterStop
        stateLock.unlock()
        guard shouldDeliver else { return }

        let httpResponse = HTTPURLResponse(
            url: request.url!,
            statusCode: response.statusCode,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"].merging(
                response.headerFields,
                uniquingKeysWith: { _, new in new }
            )
        )!
        client?.urlProtocol(
            self,
            didReceive: httpResponse,
            cacheStoragePolicy: .notAllowed
        )
        for chunk in response.chunks {
            client?.urlProtocol(self, didLoad: chunk)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    private static func readBodyStream(_ stream: InputStream?) -> Data {
        guard let stream else { return Data() }
        stream.open()
        defer { stream.close() }

        var data = Data()
        let bufferSize = 1_024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(
            capacity: bufferSize
        )
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: bufferSize)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
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
        XCTFail("Expected expression to throw.", file: file, line: line)
    } catch {
        errorHandler(error)
    }
}
