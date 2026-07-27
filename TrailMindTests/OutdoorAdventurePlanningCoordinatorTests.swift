import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class OutdoorAdventurePlanningCoordinatorTests: XCTestCase {
    func testClarificationRequiredPreservesIntentGapsAndQuestions() async throws {
        let intent = try unresolvedIntent()
        let gap = planningGap()
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .clarificationRequired,
            normalizedIntent: intent,
            planningGaps: [gap],
            clarificationQuestions: intent.unresolvedClarificationQuestions
        )
        let client = RecordingOutdoorAdventurePlanningClientV1(
            outcome: .result(.clarificationRequired(context))
        )

        let result = try await makeCoordinator(client: client).plan(intent: intent)

        guard case let .clarificationRequired(actual) = result else {
            return XCTFail("Expected clarification_required")
        }
        XCTAssertEqual(result.state, .clarificationRequired)
        XCTAssertEqual(actual.normalizedIntent, intent)
        XCTAssertEqual(actual.planningGaps, [gap])
        XCTAssertEqual(
            actual.clarificationQuestions,
            intent.unresolvedClarificationQuestions
        )
        XCTAssertEqual(result.normalizedIntent, intent)
        XCTAssertEqual(result.planningGaps, [gap])
        XCTAssertEqual(
            result.clarificationQuestions,
            intent.unresolvedClarificationQuestions
        )
        XCTAssertNil(result.routeSelection)
        XCTAssertEqual(client.capturedRequests().map(\.intent), [intent])
    }

    func testClarificationWithoutQuestionsFailsClosed() async throws {
        let intent = try unresolvedIntent()
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .clarificationRequired,
            normalizedIntent: intent,
            planningGaps: [],
            clarificationQuestions: []
        )

        await assertInvalidResult(
            .clarificationRequired(context),
            intent: intent
        )
    }

    func testClarificationQuestionsDifferingFromNormalizedIntentFailClosed()
        async throws
    {
        let intent = try unresolvedIntent()
        let differentQuestion = AdventureResearchClarificationQuestionV1(
            code: .distanceRequired,
            field: .distanceRangeKm
        )
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .clarificationRequired,
            normalizedIntent: intent,
            planningGaps: [],
            clarificationQuestions: [differentQuestion]
        )

        await assertInvalidResult(
            .clarificationRequired(context),
            intent: intent
        )
    }

    func testMismatchedEmbeddedClarificationStateFailsClosed() async throws {
        let intent = try unresolvedIntent()
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .unsupported,
            normalizedIntent: intent,
            planningGaps: [],
            clarificationQuestions: intent.unresolvedClarificationQuestions
        )

        await assertInvalidResult(
            .clarificationRequired(context),
            intent: intent
        )
    }

    func testValidUnsupportedPreservesTypedContext() async throws {
        let intent = try validIntent()
        let gap = planningGap()
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .unsupported,
            normalizedIntent: intent,
            planningGaps: [gap],
            clarificationQuestions: []
        )

        let result = try await makeCoordinator(
            result: .unsupported(context)
        ).plan(intent: intent)

        guard case let .unsupported(actual) = result else {
            return XCTFail("Expected unsupported")
        }
        XCTAssertEqual(actual.normalizedIntent, intent)
        XCTAssertEqual(actual.planningGaps, [gap])
        XCTAssertTrue(actual.clarificationQuestions.isEmpty)
        XCTAssertNil(result.routeSelection)
    }

    func testUnsupportedContainingQuestionsFailsClosed() async throws {
        let intent = try unresolvedIntent()
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .unsupported,
            normalizedIntent: intent,
            planningGaps: [],
            clarificationQuestions: intent.unresolvedClarificationQuestions
        )

        await assertInvalidResult(.unsupported(context), intent: intent)
    }

    func testUnsupportedPreservesNormalizedIntentRatherThanRequestIntent() async throws {
        let requestIntent = try validIntent(maximumElevationGainMeters: 650)
        let normalizedIntent = try validIntent(maximumElevationGainMeters: 700)
        let gap = planningGap()
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .unsupported,
            normalizedIntent: normalizedIntent,
            planningGaps: [gap],
            clarificationQuestions: []
        )
        let client = RecordingOutdoorAdventurePlanningClientV1(
            outcome: .result(.unsupported(context))
        )

        let result = try await makeCoordinator(client: client).plan(
            intent: requestIntent
        )

        guard case let .unsupported(actual) = result else {
            return XCTFail("Expected unsupported")
        }
        XCTAssertEqual(result.state, .unsupported)
        XCTAssertEqual(actual.normalizedIntent, normalizedIntent)
        XCTAssertEqual(result.normalizedIntent, normalizedIntent)
        XCTAssertNotEqual(result.normalizedIntent, requestIntent)
        XCTAssertEqual(result.planningGaps, [gap])
        XCTAssertTrue(result.clarificationQuestions.isEmpty)
        XCTAssertNil(result.routeSelection)
        XCTAssertEqual(
            client.capturedRequests(),
            [OutdoorAdventurePlanningRequestV1(intent: requestIntent)]
        )
    }

    func testNoViableRoutePreservesTypedNonRoutedContext() async throws {
        let intent = try validIntent()
        let gap = planningGap()
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .noViableRoute,
            normalizedIntent: intent,
            planningGaps: [gap],
            clarificationQuestions: []
        )

        let result = try await makeCoordinator(
            result: .noViableRoute(context)
        ).plan(intent: intent)

        guard case let .noViableRoute(actual) = result else {
            return XCTFail("Expected no_viable_route")
        }
        XCTAssertEqual(result.state, .noViableRoute)
        XCTAssertEqual(actual.normalizedIntent, intent)
        XCTAssertEqual(actual.planningGaps, [gap])
        XCTAssertEqual(result.planningGaps, [gap])
        XCTAssertTrue(result.clarificationQuestions.isEmpty)
        XCTAssertNil(result.routeSelection)
    }

    func testNoViableRouteContainingQuestionsFailsClosed() async throws {
        let intent = try unresolvedIntent()
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .noViableRoute,
            normalizedIntent: intent,
            planningGaps: [],
            clarificationQuestions: intent.unresolvedClarificationQuestions
        )

        await assertInvalidResult(.noViableRoute(context), intent: intent)
    }

    func testPartialPreservesSelectionProvenanceAndLimitations() async throws {
        let intent = try validIntent()
        let gap = planningGap()
        let selection = try routedSelection()
        let context = OutdoorAdventurePlanningRoutedStateV1(
            state: .partial,
            normalizedIntent: intent,
            planningGaps: [gap],
            routeSelection: selection
        )

        let result = try await makeCoordinator(
            result: .partial(context)
        ).plan(intent: intent)

        guard case let .partial(actual) = result else {
            return XCTFail("Expected partial")
        }
        XCTAssertEqual(result.state, .partial)
        XCTAssertEqual(actual.normalizedIntent, intent)
        XCTAssertEqual(actual.planningGaps, [gap])
        XCTAssertEqual(
            actual.routeSelection.remainingLimitations,
            selection.remainingLimitations
        )
        try assertSelectionIdentityPreserved(
            actual.routeSelection,
            expected: selection
        )
        let exposedSelection = try XCTUnwrap(result.routeSelection)
        XCTAssertEqual(
            exposedSelection.remainingLimitations,
            selection.remainingLimitations
        )
        XCTAssertTrue(result.clarificationQuestions.isEmpty)
    }

    func testPartialWithoutAlternativesFailsClosed() async throws {
        let intent = try validIntent()
        let selection = replacingAlternatives(
            in: try routedSelection(),
            with: []
        )
        let context = OutdoorAdventurePlanningRoutedStateV1(
            state: .partial,
            normalizedIntent: intent,
            planningGaps: [planningGap()],
            routeSelection: selection
        )

        await assertInvalidResult(.partial(context), intent: intent)
    }

    func testPartialWithUnverifiedAlternativeFailsClosed() async throws {
        let intent = try validIntent()
        let selection = try selectionWithUnverifiedAlternative()
        let context = OutdoorAdventurePlanningRoutedStateV1(
            state: .partial,
            normalizedIntent: intent,
            planningGaps: [planningGap()],
            routeSelection: selection
        )

        await assertInvalidResult(.partial(context), intent: intent)
    }

    func testRoutedPreservesSelectionProvenanceAndLimitations() async throws {
        let intent = try validIntent()
        let selection = try routedSelection()
        let context = OutdoorAdventurePlanningRoutedStateV1(
            state: .routed,
            normalizedIntent: intent,
            planningGaps: [],
            routeSelection: selection
        )

        let result = try await makeCoordinator(
            result: .routed(context)
        ).plan(intent: intent)

        guard case let .routed(actual) = result else {
            return XCTFail("Expected routed")
        }
        XCTAssertEqual(result.state, .routed)
        XCTAssertEqual(actual.normalizedIntent, intent)
        XCTAssertTrue(actual.planningGaps.isEmpty)
        XCTAssertEqual(
            actual.routeSelection.remainingLimitations,
            selection.remainingLimitations
        )
        try assertSelectionIdentityPreserved(
            actual.routeSelection,
            expected: selection
        )
        XCTAssertTrue(result.planningGaps.isEmpty)
        XCTAssertTrue(result.clarificationQuestions.isEmpty)
    }

    func testRoutedWithPlanningGapsFailsClosed() async throws {
        let intent = try validIntent()
        let context = OutdoorAdventurePlanningRoutedStateV1(
            state: .routed,
            normalizedIntent: intent,
            planningGaps: [planningGap()],
            routeSelection: try routedSelection()
        )

        await assertInvalidResult(.routed(context), intent: intent)
    }

    func testRoutedWithoutAlternativesFailsClosed() async throws {
        let intent = try validIntent()
        let selection = replacingAlternatives(
            in: try routedSelection(),
            with: []
        )
        let context = OutdoorAdventurePlanningRoutedStateV1(
            state: .routed,
            normalizedIntent: intent,
            planningGaps: [],
            routeSelection: selection
        )

        await assertInvalidResult(.routed(context), intent: intent)
    }

    func testRoutedWithUnverifiedAlternativeFailsClosed() async throws {
        let intent = try validIntent()
        let context = OutdoorAdventurePlanningRoutedStateV1(
            state: .routed,
            normalizedIntent: intent,
            planningGaps: [],
            routeSelection: try selectionWithUnverifiedAlternative()
        )

        await assertInvalidResult(.routed(context), intent: intent)
    }

    func testMismatchedEmbeddedRoutedStateFailsClosed() async throws {
        let intent = try validIntent()
        let context = OutdoorAdventurePlanningRoutedStateV1(
            state: .partial,
            normalizedIntent: intent,
            planningGaps: [],
            routeSelection: try routedSelection()
        )

        await assertInvalidResult(.routed(context), intent: intent)
    }

    func testNoOpClientRemainsAnUnsupportedNonNetworkResult() async throws {
        let intent = try validIntent()
        CoordinatorNetworkURLProtocol.reset()
        let authorizer = RecordingCoordinatorAuthorizer()
        let bundle = try makeConfigurationBundle([
            "INTENT_BACKEND_BASE_URL": "https://sensitive.example.invalid",
            "RESEARCH_GUIDED_PLANNING_ENABLED": "false"
        ])
        let client = OutdoorAdventurePlanningClientFactory.makeDefault(
            bundle: bundle,
            session: makeNetworkTrackingSession(),
            authorizer: authorizer
        )
        XCTAssertTrue(client is NoOpOutdoorAdventurePlanningClientV1)
        let coordinator = OutdoorAdventurePlanningCoordinatorV1(
            client: client
        )

        let result = try await coordinator.plan(intent: intent)

        guard case let .unsupported(context) = result else {
            return XCTFail("Expected disabled client to remain unsupported")
        }
        XCTAssertEqual(context.normalizedIntent, intent)
        XCTAssertTrue(context.planningGaps.isEmpty)
        XCTAssertTrue(context.clarificationQuestions.isEmpty)
        XCTAssertNil(result.routeSelection)
        let authorizationCosts = await authorizer.costs()
        XCTAssertTrue(authorizationCosts.isEmpty)
        XCTAssertEqual(CoordinatorNetworkURLProtocol.requestCount(), 0)
    }

    func testEveryClientFailureMapsToExactCoordinatorFailure() async throws {
        let intent = try validIntent()
        let mappings: [(
            OutdoorAdventurePlanningClientFailure,
            OutdoorAdventurePlanningCoordinatorFailureV1
        )] = [
            (.invalidRequest, .rejected),
            (.requestTooLarge, .rejected),
            (.rejected, .rejected),
            (.unavailable, .unavailable),
            (.authorizationFailed, .authorizationFailed),
            (.rateLimited, .rateLimited),
            (.timedOut, .timedOut),
            (.invalidResponse, .invalidResult),
            (.responseTooLarge, .invalidResult)
        ]

        for (clientFailure, expected) in mappings {
            let coordinator = makeCoordinator(failure: clientFailure)
            do {
                _ = try await coordinator.plan(intent: intent)
                XCTFail("Expected \(expected)")
            } catch {
                XCTAssertEqual(
                    error as? OutdoorAdventurePlanningCoordinatorFailureV1,
                    expected
                )
            }
        }
    }

    func testUnexpectedClientErrorIsReducedToSafeUnavailableFailure() async throws {
        let unexpectedFailures: [any Error] = [
            UnexpectedFailure(),
            OutdoorAdventurePlanningCoordinatorFailureV1.invalidResult
        ]

        for unexpectedFailure in unexpectedFailures {
            let coordinator = makeCoordinator(failure: unexpectedFailure)
            do {
                _ = try await coordinator.plan(intent: validIntent())
                XCTFail("Expected a safe client failure")
            } catch {
                XCTAssertEqual(
                    error as? OutdoorAdventurePlanningCoordinatorFailureV1,
                    .unavailable
                )
            }
        }
    }

    func testErrorDescriptionsContainNoSensitiveTestSentinels() async throws {
        let sentinel = "SENSITIVE_COORDINATE_47.2692_TOKEN"
        let coordinator = makeCoordinator(
            failure: SensitiveUnexpectedFailure(sentinel: sentinel)
        )

        do {
            _ = try await coordinator.plan(intent: validIntent())
            XCTFail("Expected a safe coordinator failure")
        } catch {
            let failure = try XCTUnwrap(
                error as? OutdoorAdventurePlanningCoordinatorFailureV1
            )
            XCTAssertEqual(failure, .unavailable)
            let description = try XCTUnwrap(failure.errorDescription)
            XCTAssertFalse(description.contains(sentinel))
            XCTAssertLessThanOrEqual(description.utf16.count, 160)
        }

        let safeFailures: [OutdoorAdventurePlanningCoordinatorFailureV1] = [
            .unavailable,
            .authorizationFailed,
            .rateLimited,
            .timedOut,
            .rejected,
            .invalidResult
        ]
        for failure in safeFailures {
            let description = try XCTUnwrap(failure.errorDescription)
            XCTAssertFalse(description.contains(sentinel))
            XCTAssertLessThanOrEqual(description.utf16.count, 160)
        }
    }

    func testCancellationRemainsCancellation() async throws {
        let coordinator = makeCoordinator(failure: CancellationError())

        do {
            _ = try await coordinator.plan(intent: validIntent())
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            // Expected. Cancellation is control flow, not a planning failure.
        } catch {
            XCTFail("Expected CancellationError, received \(error)")
        }
    }

    func testCancellationIgnoringLateClientCannotProduceSuccess() async throws {
        let intent = try validIntent()
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .unsupported,
            normalizedIntent: intent,
            planningGaps: [],
            clarificationQuestions: []
        )
        let client = CancellationIgnoringCoordinatorClient(
            result: .unsupported(context)
        )
        let coordinator = makeCoordinator(client: client)
        let task = Task {
            try await coordinator.plan(intent: intent)
        }

        try await Task.sleep(for: .milliseconds(10))
        task.cancel()

        do {
            _ = try await task.value
            XCTFail("A late result must not win after cancellation")
        } catch is CancellationError {
            // Expected.
        } catch {
            XCTFail("Expected CancellationError, received \(error)")
        }
        XCTAssertEqual(client.capturedRequestCount(), 1)
    }

    func testCoordinatorInvokesClientExactlyOnce() async throws {
        let intent = try validIntent()
        let context = OutdoorAdventurePlanningNonRoutedStateV1(
            state: .unsupported,
            normalizedIntent: intent,
            planningGaps: [],
            clarificationQuestions: []
        )
        let client = RecordingOutdoorAdventurePlanningClientV1(
            outcome: .result(.unsupported(context))
        )

        _ = try await makeCoordinator(client: client).plan(intent: intent)

        XCTAssertEqual(
            client.capturedRequests(),
            [OutdoorAdventurePlanningRequestV1(intent: intent)]
        )
    }

    private func makeCoordinator(
        result: OutdoorAdventurePlanningResultV1
    ) -> OutdoorAdventurePlanningCoordinatorV1 {
        makeCoordinator(
            client: RecordingOutdoorAdventurePlanningClientV1(
                outcome: .result(result)
            )
        )
    }

    private func makeCoordinator(
        failure: any Error
    ) -> OutdoorAdventurePlanningCoordinatorV1 {
        makeCoordinator(
            client: RecordingOutdoorAdventurePlanningClientV1(
                outcome: .failure(failure)
            )
        )
    }

    private func makeCoordinator(
        client: any OutdoorAdventurePlanningClientV1
    ) -> OutdoorAdventurePlanningCoordinatorV1 {
        OutdoorAdventurePlanningCoordinatorV1(client: client)
    }

    private func assertInvalidResult(
        _ result: OutdoorAdventurePlanningResultV1,
        intent: AdventureResearchIntentV1,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            _ = try await makeCoordinator(result: result).plan(intent: intent)
            XCTFail(
                "Expected invalidResult",
                file: file,
                line: line
            )
        } catch {
            XCTAssertEqual(
                error as? OutdoorAdventurePlanningCoordinatorFailureV1,
                .invalidResult,
                file: file,
                line: line
            )
        }
    }

    private func replacingAlternatives(
        in selection: ResearchGuidedRouteSelectionV1,
        with alternatives: [ResearchGuidedRouteAlternativeV1]
    ) -> ResearchGuidedRouteSelectionV1 {
        ResearchGuidedRouteSelectionV1(
            state: selection.state,
            sourceEnvelopeState: selection.sourceEnvelopeState,
            alternatives: alternatives,
            rejectionCounts: selection.rejectionCounts,
            remainingLimitations: selection.remainingLimitations
        )
    }

    private func selectionWithUnverifiedAlternative()
        throws -> ResearchGuidedRouteSelectionV1
    {
        let selection = try routedSelection()
        var alternatives = selection.alternatives
        let original = try XCTUnwrap(alternatives.first)
        let originalSuggestion = original.suggestion
        let unverifiedRoute = route(
            originalSuggestion.route,
            replacingProvenanceWith: .unverified(.unknown)
        )
        XCTAssertFalse(unverifiedRoute.isVerifiedRoutedResult)
        alternatives[0] = original.replacingSuggestion(
            RouteSuggestion(
                id: originalSuggestion.id,
                route: unverifiedRoute,
                explanation: originalSuggestion.explanation,
                debugMetadata: originalSuggestion.debugMetadata
            )
        )
        return replacingAlternatives(
            in: selection,
            with: alternatives
        )
    }

    private func route(
        _ route: TrailRoute,
        replacingProvenanceWith provenance: RouteProvenance
    ) -> TrailRoute {
        TrailRoute(
            id: route.id,
            provenance: provenance,
            title: route.title,
            location: route.location,
            activity: route.activity,
            distanceKilometers: route.distanceKilometers,
            elevationGainMeters: route.elevationGainMeters,
            elevationLossMeters: route.elevationLossMeters,
            durationHours: route.durationHours,
            difficulty: route.difficulty,
            routeType: route.routeType,
            summary: route.summary,
            whyItMatches: route.whyItMatches,
            highlights: route.highlights,
            waypoints: route.waypoints,
            days: route.days,
            safetyNotes: route.safetyNotes,
            elevationProfile: route.elevationProfile,
            path: route.path,
            routeInstructions: route.routeInstructions,
            planningMetadata: route.planningMetadata,
            intentDebugMetadata: route.intentDebugMetadata,
            verifiedCharacteristics: route.verifiedCharacteristics
        )
    }

    private func makeNetworkTrackingSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CoordinatorNetworkURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    private func makeConfigurationBundle(
        _ values: [String: Any]
    ) throws -> Bundle {
        let identifier = UUID().uuidString.lowercased()
        let bundleURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "TrailMindCoordinator-\(identifier)",
                isDirectory: true
            )
            .appendingPathExtension("bundle")
        try FileManager.default.createDirectory(
            at: bundleURL,
            withIntermediateDirectories: true
        )
        var info: [String: Any] = [
            "CFBundleIdentifier": "com.trailmind.coordinator.\(identifier)",
            "CFBundleInfoDictionaryVersion": "6.0",
            "CFBundleName": "TrailMindCoordinatorTests",
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
            to: bundleURL.appendingPathComponent("Info.plist")
        )
        addTeardownBlock {
            try? FileManager.default.removeItem(at: bundleURL)
        }
        return try XCTUnwrap(Bundle(url: bundleURL))
    }

    private func validIntent(
        maximumElevationGainMeters: Int = 700
    ) throws -> AdventureResearchIntentV1 {
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
            maximumElevationGainMeters: maximumElevationGainMeters,
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
            overnightRequirements: AdventureResearchOvernightRequirementsV1(
                required: false,
                nights: 0,
                allowedAccommodationTypes: []
            ),
            transportRequirements: AdventureResearchTransportRequirementsV1(
                arrivalMode: .publicTransport,
                returnToStart: true,
                publicTransportRequired: false
            ),
            unresolvedClarificationQuestions: []
        )
    }

    private func unresolvedIntent() throws -> AdventureResearchIntentV1 {
        let question = AdventureResearchClarificationQuestionV1(
            code: .locationRequired,
            field: .geographicAnchor
        )
        return try AdventureResearchIntentV1(
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
            overnightRequirements: AdventureResearchOvernightRequirementsV1(
                required: false,
                nights: 0,
                allowedAccommodationTypes: []
            ),
            transportRequirements: AdventureResearchTransportRequirementsV1(
                arrivalMode: .unknown,
                returnToStart: true,
                publicTransportRequired: false
            ),
            unresolvedClarificationQuestions: [question]
        )
    }

    private func planningGap() -> OutdoorAdventurePlanningGapV1 {
        OutdoorAdventurePlanningGapV1(
            code: .scenicQualityNotVerifiable,
            affectedField: .preferredExperiences,
            affectedValue: "viewpoint",
            reason: .contractDimensionMissing,
            requiresClarification: false,
            requiresCapability: true
        )
    }

    private func routedSelection() throws -> ResearchGuidedRouteSelectionV1 {
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent(
                "research_guided_routed_alternatives_v1.json"
            )
        let fixtureData = try Data(contentsOf: fixtureURL)
        let fixture = try XCTUnwrap(
            JSONSerialization.jsonObject(with: fixtureData) as? [String: Any]
        )
        let envelopes = try XCTUnwrap(
            fixture["envelopes"] as? [String: Any]
        )
        let envelope = try XCTUnwrap(
            envelopes["validAlternatives"] as? [String: Any]
        )
        let data = try JSONSerialization.data(
            withJSONObject: envelope,
            options: [.sortedKeys]
        )
        return try ResearchGuidedRoutingContractAdapterV1()
            .decodeConvertAndSelect(data)
    }

    private func assertSelectionIdentityPreserved(
        _ actual: ResearchGuidedRouteSelectionV1,
        expected: ResearchGuidedRouteSelectionV1,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        XCTAssertEqual(actual.state, expected.state, file: file, line: line)
        XCTAssertEqual(
            actual.sourceEnvelopeState,
            expected.sourceEnvelopeState,
            file: file,
            line: line
        )
        XCTAssertEqual(
            actual.rejectionCounts,
            expected.rejectionCounts,
            file: file,
            line: line
        )
        XCTAssertEqual(
            actual.remainingLimitations,
            expected.remainingLimitations,
            file: file,
            line: line
        )
        XCTAssertEqual(
            actual.alternatives.map(\.attemptID),
            expected.alternatives.map(\.attemptID),
            file: file,
            line: line
        )
        XCTAssertEqual(
            actual.alternatives.map(\.routeResultID),
            expected.alternatives.map(\.routeResultID),
            file: file,
            line: line
        )
        XCTAssertEqual(
            actual.alternatives.map(\.researchProvenance),
            expected.alternatives.map(\.researchProvenance),
            file: file,
            line: line
        )
        XCTAssertEqual(
            actual.alternatives.map(\.waypointVisits),
            expected.alternatives.map(\.waypointVisits),
            file: file,
            line: line
        )
        XCTAssertEqual(
            actual.alternatives.map(\.suggestion),
            expected.alternatives.map(\.suggestion),
            file: file,
            line: line
        )
    }
}

private final class RecordingOutdoorAdventurePlanningClientV1:
    OutdoorAdventurePlanningClientV1,
    @unchecked Sendable
{
    enum Outcome {
        case result(OutdoorAdventurePlanningResultV1)
        case failure(any Error)
    }

    private let outcome: Outcome
    private let lock = NSLock()
    private var requests: [OutdoorAdventurePlanningRequestV1] = []

    init(outcome: Outcome) {
        self.outcome = outcome
    }

    func plan(
        _ request: OutdoorAdventurePlanningRequestV1
    ) async throws -> OutdoorAdventurePlanningResultV1 {
        lock.withLock {
            requests.append(request)
        }
        switch outcome {
        case let .result(result):
            return result
        case let .failure(error):
            throw error
        }
    }

    func capturedRequests() -> [OutdoorAdventurePlanningRequestV1] {
        lock.withLock { requests }
    }
}

private final class CancellationIgnoringCoordinatorClient:
    OutdoorAdventurePlanningClientV1,
    @unchecked Sendable
{
    private let result: OutdoorAdventurePlanningResultV1
    private let lock = NSLock()
    private var requestCount = 0

    init(result: OutdoorAdventurePlanningResultV1) {
        self.result = result
    }

    func plan(
        _ request: OutdoorAdventurePlanningRequestV1
    ) async throws -> OutdoorAdventurePlanningResultV1 {
        lock.withLock {
            requestCount += 1
        }
        do {
            try await Task.sleep(for: .milliseconds(80))
        } catch {
            // Deliberately ignore cancellation to exercise the coordinator.
        }
        return result
    }

    func capturedRequestCount() -> Int {
        lock.withLock { requestCount }
    }
}

private actor RecordingCoordinatorAuthorizer: RouteSessionAuthorizing {
    private var recordedCosts: [Int] = []

    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        recordedCosts.append(cost)
        return RouteSessionAuthorization(
            token: "unused-test-token",
            requestID: UUID(
                uuidString: "11111111-1111-4111-8111-111111111111"
            )!
        )
    }

    func invalidate(token: String) async {}

    func costs() -> [Int] {
        recordedCosts
    }
}

private final class CoordinatorNetworkURLProtocol:
    URLProtocol,
    @unchecked Sendable
{
    private static let lock = NSLock()
    private nonisolated(unsafe) static var recordedRequestCount = 0

    static func reset() {
        lock.withLock {
            recordedRequestCount = 0
        }
    }

    static func requestCount() -> Int {
        lock.withLock { recordedRequestCount }
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
        Self.lock.withLock {
            Self.recordedRequestCount += 1
        }
        client?.urlProtocol(
            self,
            didFailWithError: URLError(.unsupportedURL)
        )
    }

    override func stopLoading() {}
}

private struct UnexpectedFailure: Error {}

private struct SensitiveUnexpectedFailure: LocalizedError {
    let sentinel: String

    var errorDescription: String? {
        sentinel
    }
}
