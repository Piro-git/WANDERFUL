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

    func testMultiLineRelaxedRoundPromptUsesFirstValidLoop() async throws {
        let provider = LocalIntentParsingProvider()
        let validator = IntentValidationService()
        let prompt = """
        Ich will eine entspannte Runde bei Ilsenburg, ca. 3 Stunden
        Mach mir eine kurze Wanderung bei Lüneburg, eher easy
        """

        let intent = try await provider.parseIntent(rawPrompt: prompt)
        let validated = try validator.validate(intent)

        XCTAssertEqual(validated.routeType, .loop)
        XCTAssertEqual(validated.startLocationQuery, "Ilsenburg")
        XCTAssertNil(validated.endLocationQuery)
        XCTAssertEqual(validated.targetDurationMinutes, 180)
        XCTAssertEqual(validated.difficulty, .easy)
        XCTAssertEqual(validated.avoidFeatures, [.steepClimbs])

        let request = RoutePlanningRequest(validatedIntent: validated)
        XCTAssertEqual(request.targetDistanceKm, 12)
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
            XCTAssertEqual(
                error.localizedDescription,
                "Choose a realistic distance for this route."
            )
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

    #if DEBUG
    func testRemoteProviderWithoutConfigurationDoesNotCallNetwork() async {
        let provider = RemoteAIIntentParsingProvider(baseURL: nil)

        do {
            _ = try await provider.parseIntent(rawPrompt: "Plan a quiet loop near Schierke")
            XCTFail("Remote provider must stay disabled without a configured backend URL.")
        } catch {
            XCTAssertEqual(error as? RemoteAIIntentParsingProvider.ProviderError, .notConfigured)
        }
    }

    func testRemoteParserDecodesSuccessfulBackendResponse() async throws {
        let capturedRequest = CapturedURLRequest()
        let provider = RemoteAIIntentParsingProvider(
            baseURL: URL(string: "http://127.0.0.1:3000"),
            authorizer: FakeIntentAuthorizer(),
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
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Authorization"),
            "TrailMindRouteSession \(String(repeating: "A", count: 43))"
        )
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "X-TrailMind-Request-ID"),
            "00000000-0000-4000-8000-000000000001"
        )
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
        XCTAssertEqual(intent.avoidFeatures, [.repeatedPath])
        XCTAssertEqual(intent.confidence, 0.78)

        let debugSnapshot = await provider.intentParserDebugInfo()
        let debugInfo = try XCTUnwrap(debugSnapshot)
        XCTAssertEqual(debugInfo.remoteAttempted, true)
        XCTAssertEqual(debugInfo.remoteSucceeded, true)
        XCTAssertNil(debugInfo.remoteFailureReason)
        XCTAssertEqual(debugInfo.remoteStatusCode, 200)
        XCTAssertNil(debugInfo.remoteValidationError)
        XCTAssertEqual(debugInfo.backendBaseURL, "http://127.0.0.1:3000")
        XCTAssertEqual(debugInfo.parserMode, .remoteWithLocalFallback)
    }

    func testRemoteParserRefreshesARejectedSessionOnce() async throws {
        let authorizer = SequencedIntentAuthorizer()
        let requests = RequestCounter()
        let provider = RemoteAIIntentParsingProvider(
            baseURL: URL(string: "http://127.0.0.1:3000"),
            authorizer: authorizer,
            dataLoader: { _ in
                let attempt = await requests.increment()
                if attempt == 1 {
                    return (
                        Data(#"{"error":{"code":"route_session_expired","message":"Session expired."}}"#.utf8),
                        Self.httpResponse(statusCode: 401)
                    )
                }
                return (Self.remoteIntentData(), Self.httpResponse(statusCode: 200))
            }
        )

        let intent = try await provider.parseIntent(rawPrompt: "15 km loop around Schierke")
        let requestCount = await requests.value()
        let costs = await authorizer.costs()
        let invalidatedTokens = await authorizer.invalidatedTokens()

        XCTAssertEqual(intent.routeType, .loop)
        XCTAssertEqual(requestCount, 2)
        XCTAssertEqual(costs, [3, 3])
        XCTAssertEqual(invalidatedTokens, [String(repeating: "A", count: 43)])
    }

    func testRemoteFailureFallsBackToLocalParserAndRecordsReason() async throws {
        let remote = RemoteAIIntentParsingProvider(
            baseURL: URL(string: "http://127.0.0.1:3000"),
            authorizer: FakeIntentAuthorizer(),
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

        let debugSnapshot = await provider.intentParserDebugInfo()
        let debugInfo = try XCTUnwrap(debugSnapshot)
        XCTAssertEqual(debugInfo.remoteAttempted, true)
        XCTAssertEqual(debugInfo.remoteSucceeded, false)
        XCTAssertEqual(debugInfo.remoteFailureReason, "http 502")
        XCTAssertEqual(debugInfo.remoteStatusCode, 502)
        XCTAssertNil(debugInfo.remoteValidationError)
        XCTAssertEqual(debugInfo.backendBaseURL, "http://127.0.0.1:3000")
        XCTAssertEqual(debugInfo.parserMode, .remoteWithLocalFallback)
    }

    func testInvalidRemoteJSONFallsBackToLocalParserAndRecordsReason() async throws {
        let remote = RemoteAIIntentParsingProvider(
            baseURL: URL(string: "http://127.0.0.1:3000"),
            authorizer: FakeIntentAuthorizer(),
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

        let debugSnapshot = await provider.intentParserDebugInfo()
        let debugInfo = try XCTUnwrap(debugSnapshot)
        XCTAssertEqual(debugInfo.remoteAttempted, true)
        XCTAssertEqual(debugInfo.remoteSucceeded, false)
        XCTAssertEqual(debugInfo.remoteFailureReason, "invalidJSON")
        XCTAssertEqual(debugInfo.remoteStatusCode, 200)
        XCTAssertNil(debugInfo.remoteValidationError)
        XCTAssertEqual(debugInfo.backendBaseURL, "http://127.0.0.1:3000")
        XCTAssertEqual(debugInfo.parserMode, .remoteWithLocalFallback)
    }

    func testRemoteTimeoutFallsBackToLocalParserAndRecordsReadableReason() async throws {
        let remote = RemoteAIIntentParsingProvider(
            baseURL: URL(string: "http://127.0.0.1:3000"),
            authorizer: FakeIntentAuthorizer(),
            dataLoader: { _ in
                throw URLError(.timedOut)
            }
        )
        let provider = RemoteWithLocalFallbackIntentParsingProvider(remoteProvider: remote)

        let intent = try await provider.parseIntent(
            rawPrompt: "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück"
        )

        XCTAssertEqual(intent.parserSource, .localRuleBased)
        XCTAssertEqual(intent.routeType, .loop)
        XCTAssertEqual(intent.startLocationQuery, "Schierke")
        XCTAssertEqual(intent.targetDistanceKm, 15)

        let debugSnapshot = await provider.intentParserDebugInfo()
        let debugInfo = try XCTUnwrap(debugSnapshot)
        XCTAssertEqual(debugInfo.remoteAttempted, true)
        XCTAssertEqual(debugInfo.remoteSucceeded, false)
        XCTAssertEqual(debugInfo.remoteFailureReason, "network: timedOut")
        XCTAssertNil(debugInfo.remoteStatusCode)
        XCTAssertNil(debugInfo.remoteValidationError)
        XCTAssertEqual(debugInfo.backendBaseURL, "http://127.0.0.1:3000")
    }

    func testRemoteNeedsClarificationFallsBackToLocalParserWhenLocalIntentIsValid() async throws {
        let prompt = """
        Ich will eine entspannte Runde bei Ilsenburg, ca. 3 Stunden
        Mach mir eine kurze Wanderung bei Lüneburg, eher easy
        """
        let remote = FixedIntentParsingProvider(
            intent: AdventureIntent(
                rawPrompt: prompt,
                parserSource: .remoteAI,
                confidence: 0.45,
                activityType: .hiking,
                routeType: .loop,
                startLocationQuery: nil,
                endLocationQuery: nil,
                regionQuery: nil,
                targetDistanceKm: nil,
                targetDurationMinutes: 180,
                difficulty: .easy,
                desiredFeatures: [],
                avoidFeatures: []
            )
        )
        let provider = RemoteWithLocalFallbackIntentParsingProvider(remoteProvider: remote)

        let intent = try await provider.parseIntent(rawPrompt: prompt)
        let validated = try IntentValidationService().validate(intent)

        XCTAssertEqual(intent.parserSource, .localRuleBased)
        XCTAssertEqual(validated.routeType, .loop)
        XCTAssertEqual(validated.startLocationQuery, "Ilsenburg")
        XCTAssertNil(validated.endLocationQuery)
        XCTAssertEqual(validated.targetDurationMinutes, 180)
        XCTAssertEqual(validated.difficulty, .easy)

        let debugSnapshot = await provider.intentParserDebugInfo()
        let debugInfo = try XCTUnwrap(debugSnapshot)
        XCTAssertEqual(debugInfo.remoteAttempted, true)
        XCTAssertEqual(debugInfo.remoteSucceeded, true)
        XCTAssertEqual(debugInfo.remoteValidationError, "missing fields: startLocationQuery, regionQuery")
    }

    func testRemoteValidationFailureFallsBackToLocalParserAndRecordsValidationError() async throws {
        let prompt = "Lüneburg bis Bardowick"
        let remote = FixedIntentParsingProvider(
            intent: AdventureIntent(
                rawPrompt: prompt,
                parserSource: .remoteAI,
                confidence: 0.52,
                activityType: .hiking,
                routeType: .pointToPoint,
                startLocationQuery: "Lüneburg",
                endLocationQuery: nil,
                regionQuery: nil,
                targetDistanceKm: nil,
                targetDurationMinutes: nil,
                difficulty: nil,
                desiredFeatures: [],
                avoidFeatures: []
            )
        )
        let provider = RemoteWithLocalFallbackIntentParsingProvider(remoteProvider: remote)

        let intent = try await provider.parseIntent(rawPrompt: prompt)

        XCTAssertEqual(intent.parserSource, .localRuleBased)
        XCTAssertEqual(intent.routeType, .pointToPoint)
        XCTAssertEqual(intent.startLocationQuery, "Lüneburg")
        XCTAssertEqual(intent.endLocationQuery, "Bardowick")

        let debugSnapshot = await provider.intentParserDebugInfo()
        let debugInfo = try XCTUnwrap(debugSnapshot)
        XCTAssertEqual(debugInfo.remoteAttempted, true)
        XCTAssertEqual(debugInfo.remoteSucceeded, true)
        XCTAssertNil(debugInfo.remoteFailureReason)
        XCTAssertEqual(debugInfo.remoteValidationError, "missing fields: endLocationQuery")
        XCTAssertEqual(debugInfo.parserMode, .remoteWithLocalFallback)
    }
    #endif

    func testLocalOnlyModeDoesNotAttemptRemote() async throws {
        let provider = LocalIntentParsingProvider()

        let intent = try await provider.parseIntent(rawPrompt: "Lüneburg bis Bardowick")

        XCTAssertEqual(intent.parserSource, .localRuleBased)
        XCTAssertEqual(intent.routeType, .pointToPoint)
        XCTAssertEqual(intent.startLocationQuery, "Lüneburg")
        XCTAssertEqual(intent.endLocationQuery, "Bardowick")

        let debugSnapshot = await provider.intentParserDebugInfo()
        let debugInfo = try XCTUnwrap(debugSnapshot)
        XCTAssertEqual(debugInfo.remoteAttempted, false)
        XCTAssertEqual(debugInfo.remoteSucceeded, false)
        XCTAssertNil(debugInfo.remoteFailureReason)
        XCTAssertNil(debugInfo.remoteStatusCode)
        XCTAssertNil(debugInfo.remoteValidationError)
        XCTAssertEqual(debugInfo.parserMode, .localOnly)
    }

    #if DEBUG
    func testDebugParserModeCanBeConfiguredFromEnvironment() {
        let localProvider = IntentParsingProviderFactory.makeDefaultProvider(
            environment: ["TRAILMIND_INTENT_PARSER_MODE": "local_only"]
        )
        let remoteProvider = IntentParsingProviderFactory.makeDefaultProvider(
            environment: ["TRAILMIND_INTENT_PARSER_MODE": "remote_with_local_fallback"]
        )

        XCTAssertTrue(localProvider is LocalIntentParsingProvider)
        XCTAssertTrue(remoteProvider is RemoteWithLocalFallbackIntentParsingProvider)
    }

    func testDebugMetadataShowsRemoteParserWithoutFallback() async throws {
        let intent = ValidatedAdventureIntent(
            intent: try await RemoteAIIntentParsingProvider(
                baseURL: URL(string: "http://127.0.0.1:3000"),
                authorizer: FakeIntentAuthorizer(),
                dataLoader: { _ in
                    (Self.remoteIntentData(), Self.httpResponse(statusCode: 200))
                }
            )
            .parseIntent(rawPrompt: "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück")
        )
        let metadata = RouteIntentDebugMetadata(
            intent: intent,
            parserDebugInfo: IntentParserDebugInfo(
                remoteAttempted: true,
                remoteSucceeded: true,
                remoteFailureReason: nil,
                remoteStatusCode: 200,
                remoteValidationError: nil,
                backendBaseURL: "http://127.0.0.1:3000",
                parserMode: .remoteWithLocalFallback
            ),
            geocodedStartLabel: "Schierke",
            geocodedEndLabel: nil
        )
        let rows = Dictionary(uniqueKeysWithValues: IntentDebugFormatter.rows(for: metadata).map { ($0.label, $0.value) })

        XCTAssertEqual(rows["parserSource"], "remoteAI")
        XCTAssertEqual(rows["localFallbackUsed"], "no")
        XCTAssertEqual(rows["remoteAttempted"], "yes")
        XCTAssertEqual(rows["remoteSucceeded"], "yes")
        XCTAssertEqual(rows["remoteStatusCode"], "200")
        XCTAssertEqual(rows["backendBaseURL"], "http://127.0.0.1:3000")
        XCTAssertEqual(rows["parserMode"], "remote with local fallback")
    }
    #endif

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
        XCTAssertEqual(values["remoteAttempted"], "unknown")
        XCTAssertEqual(values["remoteSucceeded"], "unknown")
        XCTAssertEqual(values["remoteFailureReason"], "nil")
        XCTAssertEqual(values["remoteStatusCode"], "nil")
        XCTAssertEqual(values["remoteValidationError"], "nil")
        XCTAssertEqual(values["backendBaseURL"], "nil")
        XCTAssertEqual(values["parserMode"], "unknown")
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

    #if DEBUG
    func testRemoteRouteTypeNilCanNormalizeToLoopFromPromptAndRegion() async throws {
        let provider = RemoteAIIntentParsingProvider(
            baseURL: URL(string: "http://127.0.0.1:3000"),
            authorizer: FakeIntentAuthorizer(),
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
    #endif

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
        let fixtures = try IntentEvalFixture.load()
        let summary = await IntentEvaluator().evaluate(
            fixtures: fixtures,
            provider: LocalIntentParsingProvider(),
            label: "local parser"
        )

        XCTAssertEqual(summary.total, fixtures.count)
        XCTAssertEqual(summary.failed, 0, summary.formatted())
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

private actor FakeIntentAuthorizer: RouteSessionAuthorizing {
    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        XCTAssertEqual(cost, 3)
        return RouteSessionAuthorization(
            token: String(repeating: "A", count: 43),
            requestID: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
        )
    }

    func invalidate(token: String) async {}
}

private actor SequencedIntentAuthorizer: RouteSessionAuthorizing {
    private var requestedCosts: [Int] = []
    private var invalidated: [String] = []

    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        requestedCosts.append(cost)
        let tokenCharacter = requestedCosts.count == 1 ? "A" : "B"
        return RouteSessionAuthorization(
            token: String(repeating: tokenCharacter, count: 43),
            requestID: UUID()
        )
    }

    func invalidate(token: String) async {
        invalidated.append(token)
    }

    func costs() -> [Int] { requestedCosts }
    func invalidatedTokens() -> [String] { invalidated }
}

private actor RequestCounter {
    private var count = 0

    func increment() -> Int {
        count += 1
        return count
    }

    func value() -> Int { count }
}

private struct FixedIntentParsingProvider: IntentParsingProvider {
    let parserSource: IntentParserSource = .remoteAI
    let intent: AdventureIntent

    init(intent: AdventureIntent) {
        self.intent = intent
    }

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        intent
    }
}
