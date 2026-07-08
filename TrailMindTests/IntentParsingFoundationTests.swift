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
                "Bitte gib Start und Ziel ein, z.B. 'Ilsenburg nach Schierke'."
            )
        }
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
        let provider = RemoteAIIntentParsingProvider()

        do {
            _ = try await provider.parseIntent(rawPrompt: "Plan a quiet loop near Schierke")
            XCTFail("Remote provider should stay disabled until a backend exists.")
        } catch {
            XCTAssertEqual(error as? RemoteAIIntentParsingProvider.ProviderError, .notConfigured)
        }
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
        XCTAssertEqual(values["validationStatus"], "validated")
        XCTAssertEqual(values["localFallbackUsed"], "yes")
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
