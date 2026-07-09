import XCTest
@testable import TrailMind

@MainActor
final class IntentParsingFoundationTests: XCTestCase {
    func testLocalParserProviderPreservesPointToPointBehavior() async throws {
        let provider = LocalIntentParsingProvider()

        let intent = try await provider.parseIntent(rawPrompt: "Schierke zum Brocken")

        XCTAssertEqual(intent.parserSource, .localRuleBased)
        XCTAssertEqual(intent.confidence, 1)
        XCTAssertEqual(intent.routeType, .pointToPoint)
        XCTAssertEqual(intent.startLocationQuery, "Schierke")
        XCTAssertEqual(intent.endLocationQuery, "Brocken")
        XCTAssertEqual(intent.activityType, .hiking)
        XCTAssertEqual(intent.transportMode, .walking)
    }

    func testLoopPromptCreatesValidLoopIntent() async throws {
        let provider = LocalIntentParsingProvider()
        let validator = IntentValidationService()

        let intent = try await provider.parseIntent(rawPrompt: "15 km Rundwanderung um Ilsenburg")
        let validated = try validator.validate(intent)

        XCTAssertEqual(validated.routeType, .loop)
        XCTAssertEqual(validated.startOrRegionQuery, "Ilsenburg")
        XCTAssertNil(validated.endLocationQuery)
        XCTAssertEqual(validated.targetDistanceKm, 15)
    }

    func testPointToPointPromptCreatesValidPointToPointIntent() async throws {
        let provider = LocalIntentParsingProvider()
        let validator = IntentValidationService()

        let intent = try await provider.parseIntent(rawPrompt: "Ilsenburg nach Schierke")
        let validated = try validator.validate(intent)

        XCTAssertEqual(validated.routeType, .pointToPoint)
        XCTAssertEqual(validated.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(validated.endLocationQuery, "Schierke")
        XCTAssertEqual(validated.graphHopperProfile, "foot")
    }

    func testInvalidOrUnderspecifiedIntentProducesGracefulValidationError() {
        let validator = IntentValidationService()
        let intent = AdventureIntent(
            rawPrompt: "bring me somewhere nice",
            parserSource: .remoteAI,
            confidence: 0.4,
            activityType: .hiking,
            routeType: .pointToPoint,
            startLocationQuery: "Ilsenburg",
            endLocationQuery: nil,
            regionQuery: nil,
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: []
        )

        XCTAssertThrowsError(try validator.validate(intent)) { error in
            XCTAssertEqual(error as? IntentValidationError, .missingPointToPointEnd)
            XCTAssertEqual(
                error.localizedDescription,
                "Where do you want to go?"
            )
        }
    }

    func testLoopWithRegionQueryOnlyRepairsToStartLocationQuery() {
        let validator = IntentValidationService()
        let intent = AdventureIntent(
            rawPrompt: "Plan a 15 km loop near Schierke",
            parserSource: .remoteAI,
            confidence: 0.74,
            activityType: .hiking,
            routeType: .loop,
            startLocationQuery: nil,
            endLocationQuery: nil,
            regionQuery: "Schierke",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: []
        )

        let result = validator.validateResult(intent)

        XCTAssertEqual(result.status, .repaired)
        XCTAssertTrue(result.repaired)
        XCTAssertEqual(result.validatedIntent?.routeType, .loop)
        XCTAssertEqual(result.validatedIntent?.startLocationQuery, "Schierke")
        XCTAssertEqual(result.validatedIntent?.regionQuery, "Schierke")
        XCTAssertNil(result.validatedIntent?.endLocationQuery)
        XCTAssertEqual(result.repairReason, "Used regionQuery as startLocationQuery for loop routing.")
    }

    func testRemoteRundwanderungPointToPointWithoutEndRepairsToLoop() {
        let validator = IntentValidationService()
        let intent = AdventureIntent(
            rawPrompt: "15 km Rundwanderung um Schierke",
            parserSource: .remoteAI,
            confidence: 0.7,
            activityType: .hiking,
            routeType: .pointToPoint,
            startLocationQuery: "Schierke",
            endLocationQuery: nil,
            regionQuery: nil,
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: []
        )

        let result = validator.validateResult(intent)

        XCTAssertEqual(result.status, .repaired)
        XCTAssertEqual(result.validatedIntent?.routeType, .loop)
        XCTAssertEqual(result.validatedIntent?.startOrRegionQuery, "Schierke")
        XCTAssertNil(result.validatedIntent?.endLocationQuery)
        XCTAssertTrue(result.missingFields.isEmpty)
    }

    func testRemoteHikeAroundLuneburgValidatesAsLoopWithoutEndLocation() throws {
        let validator = IntentValidationService()
        let intent = AdventureIntent(
            rawPrompt: "hike around Lüneburg",
            parserSource: .remoteAI,
            confidence: 0.66,
            activityType: .hiking,
            routeType: .pointToPoint,
            startLocationQuery: nil,
            endLocationQuery: nil,
            regionQuery: "Lüneburg",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: []
        )

        let result = validator.validateResult(intent)

        XCTAssertEqual(result.status, .repaired)
        XCTAssertEqual(result.validatedIntent?.routeType, .loop)
        XCTAssertEqual(result.validatedIntent?.startLocationQuery, "Lüneburg")
        XCTAssertNil(result.validatedIntent?.endLocationQuery)
        XCTAssertEqual(RoutePlanningRequest(validatedIntent: try XCTUnwrap(result.validatedIntent)).targetDistanceKm, 10)
    }

    func testPointToPointWithoutEndAsksForDestination() {
        let validator = IntentValidationService()
        let intent = AdventureIntent(
            rawPrompt: "Plan a route from Ilsenburg to",
            parserSource: .remoteAI,
            confidence: 0.5,
            activityType: .hiking,
            routeType: .pointToPoint,
            startLocationQuery: "Ilsenburg",
            endLocationQuery: nil,
            regionQuery: nil,
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: []
        )

        let result = validator.validateResult(intent)

        XCTAssertEqual(result.status, .needsClarification)
        XCTAssertEqual(result.missingFields, [.endLocationQuery])
        XCTAssertEqual(result.clarificationReason, "missingPointToPointEnd")
        XCTAssertEqual(result.clarificationQuestion, "Where do you want to go?")
    }

    func testVaguePromptAsksForAreaOrStartLocation() {
        let validator = IntentValidationService()
        let intent = AdventureIntent(
            rawPrompt: "mach mir was schönes zum Wandern",
            parserSource: .remoteAI,
            confidence: 0.35,
            activityType: .hiking,
            routeType: .pointToPoint,
            startLocationQuery: nil,
            endLocationQuery: nil,
            regionQuery: nil,
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: []
        )

        let result = validator.validateResult(intent)

        XCTAssertEqual(result.status, .needsClarification)
        XCTAssertEqual(result.missingFields, [.startLocationQuery, .endLocationQuery])
        XCTAssertEqual(result.clarificationReason, "vagueHikingRequest")
        XCTAssertEqual(result.clarificationQuestion, "Which area should I plan around?")
    }

    func testUnreasonableDistanceProducesValidationError() {
        let validator = IntentValidationService()
        let intent = AdventureIntent(
            rawPrompt: "1000 km Rundwanderung um Ilsenburg",
            parserSource: .remoteAI,
            confidence: 0.6,
            activityType: .hiking,
            routeType: .loop,
            startLocationQuery: "Ilsenburg",
            endLocationQuery: nil,
            regionQuery: nil,
            targetDistanceKm: 1_000,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: []
        )

        XCTAssertThrowsError(try validator.validate(intent)) { error in
            XCTAssertEqual(error as? IntentValidationError, .unreasonableDistance(1_000))
        }
    }

    func testDesiredFeaturesRemainRequestedPreferencesOnly() async throws {
        let provider = LocalIntentParsingProvider()
        let validator = IntentValidationService()

        let intent = try await provider.parseIntent(
            rawPrompt: "Plane eine Wanderung von Ilsenburg nach Schierke mit Aussicht und Wald"
        )
        let validated = try validator.validate(intent)
        let request = RoutePlanningRequest(validatedIntent: validated)

        XCTAssertEqual(validated.desiredFeatures, [.viewpoint, .forest])
        XCTAssertEqual(validated.desiredFeatures, validated.requestedFeaturePreferences)
        XCTAssertEqual(request.metadata.requestedFeatureSummary, "Requested: Views, Forest")
    }

    func testRemoteProviderIsInterfaceOnlyAndDoesNotCallNetwork() async {
        let provider = RemoteAIIntentParsingProvider(baseURL: nil)

        do {
            _ = try await provider.parseIntent(rawPrompt: "Plan a quiet loop near Schierke")
            XCTFail("Remote provider should stay disabled until a backend exists.")
        } catch {
            XCTAssertEqual(error as? RemoteAIIntentParsingProvider.ProviderError, .notConfigured)
        }
    }

    func testRemoteParserDecodesSuccessfulBackendResponse() async throws {
        let capturedRequest = CapturedURLRequest()
        let provider = RemoteAIIntentParsingProvider(
            baseURL: URL(string: "http://127.0.0.1:3000"),
            dataLoader: { request in
                await capturedRequest.set(request)
                return (
                    Self.remoteIntentData(),
                    Self.httpResponse(statusCode: 200)
                )
            }
        )

        let intent = try await provider.parseIntent(
            rawPrompt: "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück"
        )
        let captured = await capturedRequest.get()
        let request = try XCTUnwrap(captured)
        let body = try XCTUnwrap(request.httpBody)
        let payload = try JSONSerialization.jsonObject(with: body) as? [String: Any]

        XCTAssertEqual(request.url?.absoluteString, "http://127.0.0.1:3000/api/parse-intent")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(payload?["prompt"] as? String, "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück")
        XCTAssertEqual(payload?["locale"] as? String, "de")
        XCTAssertTrue(payload?.keys.contains("userLocationHint") == true)
        XCTAssertEqual(intent.parserSource, .remoteAI)
        XCTAssertEqual(intent.routeType, .loop)
        XCTAssertEqual(intent.activityType, .hiking)
        XCTAssertEqual(intent.startLocationQuery, "Schierke")
        XCTAssertNil(intent.endLocationQuery)
        XCTAssertEqual(intent.targetDistanceKm, 15)
        XCTAssertEqual(intent.difficulty, .easy)
        XCTAssertEqual(intent.confidence, 0.78)
    }

    func testRemoteFailureFallsBackToLocalParser() async throws {
        let remote = RemoteAIIntentParsingProvider(
            baseURL: URL(string: "http://127.0.0.1:3000"),
            dataLoader: { _ in
                (Data(#"{"error":"nope"}"#.utf8), Self.httpResponse(statusCode: 502))
            }
        )
        let provider = RemoteWithLocalFallbackIntentParsingProvider(remoteProvider: remote)

        let intent = try await provider.parseIntent(rawPrompt: "15 km Rundwanderung um Schierke")

        XCTAssertEqual(intent.parserSource, .localRuleBased)
        XCTAssertEqual(intent.routeType, .loop)
        XCTAssertEqual(intent.startLocationQuery, "Schierke")
        XCTAssertEqual(intent.targetDistanceKm, 15)
    }

    func testInvalidRemoteJSONFallsBackToLocalParser() async throws {
        let remote = RemoteAIIntentParsingProvider(
            baseURL: URL(string: "http://127.0.0.1:3000"),
            dataLoader: { _ in
                (Data("not-json".utf8), Self.httpResponse(statusCode: 200))
            }
        )
        let provider = RemoteWithLocalFallbackIntentParsingProvider(remoteProvider: remote)

        let intent = try await provider.parseIntent(rawPrompt: "Ilsenburg nach Schierke")

        XCTAssertEqual(intent.parserSource, .localRuleBased)
        XCTAssertEqual(intent.routeType, .pointToPoint)
        XCTAssertEqual(intent.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(intent.endLocationQuery, "Schierke")
    }

    func testDebugMetadataShowsRemoteParserWithoutFallback() async throws {
        let intent = ValidatedAdventureIntent(
            intent: try await RemoteAIIntentParsingProvider(
                baseURL: URL(string: "http://127.0.0.1:3000"),
                dataLoader: { _ in
                    (Self.remoteIntentData(), Self.httpResponse(statusCode: 200))
                }
            )
            .parseIntent(rawPrompt: "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück")
        )
        let metadata = RouteIntentDebugMetadata(
            intent: intent,
            geocodedStartLabel: "Schierke",
            geocodedEndLabel: nil
        )
        let rows = Dictionary(uniqueKeysWithValues: IntentDebugFormatter.rows(for: metadata).map { ($0.label, $0.value) })

        XCTAssertEqual(rows["parserSource"], "remoteAI")
        XCTAssertEqual(rows["localFallbackUsed"], "no")
    }

    func testIntentDebugFormatterIncludesParserFallbackAndIntentFields() {
        let intent = ValidatedAdventureIntent(
            intent: AdventureIntent(
                rawPrompt: "15 km Rundwanderung um Schierke mit Aussicht",
                parserSource: .localRuleBased,
                confidence: 0.72,
                activityType: .hiking,
                routeType: .loop,
                startLocationQuery: "Schierke",
                endLocationQuery: nil,
                regionQuery: nil,
                targetDistanceKm: 15,
                targetDurationMinutes: nil,
                difficulty: .easy,
                desiredFeatures: [.viewpoint],
                avoidFeatures: [.steepClimbs]
            )
        )
        let metadata = RouteIntentDebugMetadata(
            intent: intent,
            geocodedStartLabel: "Schierke",
            geocodedEndLabel: nil
        )

        let rows = IntentDebugFormatter.rows(for: metadata)
        let values = Dictionary(uniqueKeysWithValues: rows.map { ($0.label, $0.value) })

        XCTAssertEqual(values["parserSource"], "localRuleBased")
        XCTAssertEqual(values["validationStatus"], "valid")
        XCTAssertEqual(values["localFallbackUsed"], "yes")
        XCTAssertEqual(values["repaired"], "no")
        XCTAssertEqual(values["repairReason"], "nil")
        XCTAssertEqual(values["missingFields"], "[]")
        XCTAssertEqual(values["clarificationQuestion"], "nil")
        XCTAssertEqual(values["rawPrompt"], "15 km Rundwanderung um Schierke mit Aussicht")
        XCTAssertEqual(values["activityType"], "Hiking")
        XCTAssertEqual(values["routeType"], "Loop")
        XCTAssertEqual(values["startLocationQuery"], "Schierke")
        XCTAssertEqual(values["endLocationQuery"], "nil")
        XCTAssertEqual(values["targetDistanceKm"], "15 km")
        XCTAssertEqual(values["difficulty"], "Easy")
        XCTAssertEqual(values["desiredFeatures"], "viewpoint")
        XCTAssertEqual(values["avoidFeatures"], "steepClimbs")
        XCTAssertEqual(values["transportMode"], "walking")
        XCTAssertTrue(values["confidence"] == "0.72" || values["confidence"] == "0,72")
        XCTAssertEqual(values["geocodedStartLabel"], "Schierke")
    }

    func testRemoteRouteTypeNilCanNormalizeToLoopFromPromptAndRegion() async throws {
        let provider = RemoteAIIntentParsingProvider(
            baseURL: URL(string: "http://127.0.0.1:3000"),
            dataLoader: { _ in
                (Self.remoteIntentDataWithoutRouteType(), Self.httpResponse(statusCode: 200))
            }
        )

        let intent = try await provider.parseIntent(rawPrompt: "hike around Lüneburg")

        XCTAssertEqual(intent.parserSource, .remoteAI)
        XCTAssertEqual(intent.routeType, .loop)
        XCTAssertEqual(intent.regionQuery, "Lüneburg")
        XCTAssertNil(intent.endLocationQuery)
    }

    func testIntentRepairKeepsRequestedFeaturesAsPreferencesOnly() throws {
        let validator = IntentValidationService()
        let intent = AdventureIntent(
            rawPrompt: "15 km Rundwanderung um Schierke mit Aussicht",
            parserSource: .remoteAI,
            confidence: 0.77,
            activityType: .hiking,
            routeType: .pointToPoint,
            startLocationQuery: "Schierke",
            endLocationQuery: nil,
            regionQuery: nil,
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [.viewpoint],
            avoidFeatures: []
        )

        let result = validator.validateResult(intent)
        let validated = try XCTUnwrap(result.validatedIntent)
        let request = RoutePlanningRequest(validatedIntent: validated)

        XCTAssertEqual(result.status, .repaired)
        XCTAssertEqual(validated.desiredFeatures, [.viewpoint])
        XCTAssertEqual(validated.requestedFeaturePreferences, [.viewpoint])
        XCTAssertEqual(request.metadata.requestedFeatureSummary, "Requested: Views")
    }

    func testFixturePromptEvalCoversCurrentLocalParserContract() async throws {
        let fixtures = try Self.loadFixtures()
        XCTAssertGreaterThanOrEqual(fixtures.count, 20)
        XCTAssertLessThanOrEqual(fixtures.count, 30)

        let provider = LocalIntentParsingProvider()
        let validator = IntentValidationService()

        for fixture in fixtures {
            let intent = try await provider.parseIntent(rawPrompt: fixture.prompt)
            let validated = try validator.validate(intent)

            XCTAssertEqual(validated.routeType.rawValue, fixture.routeType, fixture.prompt)
            XCTAssertEqual(validated.activityType.rawValue, fixture.activityType, fixture.prompt)
            XCTAssertEqual(validated.startLocationQuery, fixture.startLocationQuery, fixture.prompt)
            XCTAssertEqual(validated.endLocationQuery, fixture.endLocationQuery, fixture.prompt)
            XCTAssertEqual(validated.regionQuery, fixture.regionQuery, fixture.prompt)
            XCTAssertEqual(validated.targetDistanceKm, fixture.targetDistanceKm, fixture.prompt)
            XCTAssertEqual(validated.targetDurationMinutes, fixture.targetDurationMinutes, fixture.prompt)
            XCTAssertEqual(validated.desiredFeatures.map(\.rawValue), fixture.desiredFeatures, fixture.prompt)
        }
    }

    private static func loadFixtures() throws -> [IntentFixture] {
        let testFile = URL(fileURLWithPath: #filePath)
        let fixtureURL = testFile
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("prompt_intent_eval.json")
        let data = try Data(contentsOf: fixtureURL)
        return try JSONDecoder().decode([IntentFixture].self, from: data)
    }

    private nonisolated static func remoteIntentData() -> Data {
        Data(
            """
            {
              "activityType": "hiking",
              "routeType": "loop",
              "startLocationQuery": "Schierke",
              "endLocationQuery": null,
              "regionQuery": null,
              "targetDistanceKm": 15,
              "targetDurationMinutes": null,
              "difficulty": "easy",
              "desiredFeatures": [],
              "avoidFeatures": ["repeatedPath"],
              "transportMode": "walking",
              "rawPrompt": "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück",
              "parserSource": "remoteAI",
              "confidence": 0.78
            }
            """.utf8
        )
    }

    private nonisolated static func remoteIntentDataWithoutRouteType() -> Data {
        Data(
            """
            {
              "activityType": "hiking",
              "routeType": null,
              "startLocationQuery": null,
              "endLocationQuery": null,
              "regionQuery": "Lüneburg",
              "targetDistanceKm": null,
              "targetDurationMinutes": null,
              "difficulty": null,
              "desiredFeatures": [],
              "avoidFeatures": [],
              "transportMode": "walking",
              "rawPrompt": "hike around Lüneburg",
              "parserSource": "remoteAI",
              "confidence": 0.64
            }
            """.utf8
        )
    }

    private nonisolated static func httpResponse(statusCode: Int) -> HTTPURLResponse {
        HTTPURLResponse(
            url: URL(string: "http://127.0.0.1:3000/api/parse-intent")!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        )!
    }
}

private actor CapturedURLRequest {
    private var value: URLRequest?

    func set(_ request: URLRequest) {
        value = request
    }

    func get() -> URLRequest? {
        value
    }
}

private struct IntentFixture: Decodable {
    let prompt: String
    let routeType: String
    let activityType: String
    let startLocationQuery: String?
    let endLocationQuery: String?
    let regionQuery: String?
    let targetDistanceKm: Double?
    let targetDurationMinutes: Int?
    let desiredFeatures: [String]
}
