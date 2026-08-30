import Foundation
import XCTest
@testable import TrailMind

@MainActor
private struct ResearchFixedIntentParser: IntentParsingProvider {
    nonisolated let parserSource: IntentParserSource
    let intent: AdventureIntent

    init(intent: AdventureIntent) {
        parserSource = intent.parserSource
        self.intent = intent
    }

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        intent
    }
}

@MainActor
private final class ResearchScriptedIntentParser: IntentParsingProvider {
    nonisolated let parserSource: IntentParserSource = .localRuleBased
    private var intents: [AdventureIntent]

    init(intents: [AdventureIntent]) {
        self.intents = intents
    }

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        guard !intents.isEmpty else {
            throw CancellationError()
        }
        return intents.removeFirst()
    }
}

@MainActor
private final class ResearchLocationResolver: LocationResolving {
    private let resolutions: [String: LocationResolution]
    private(set) var contexts: [LocationQueryContext] = []

    init(resolutions: [String: LocationResolution]) {
        self.resolutions = resolutions
    }

    func resolve(
        _ context: LocationQueryContext
    ) async throws -> LocationResolution {
        contexts.append(context)
        return resolutions[context.originalQuery]
            ?? .noResults(query: context.originalQuery)
    }
}

@MainActor
private final class ResearchLegacyRouter: RoutingCoordinating {
    enum Outcome {
        case result(RoutingResult)
        case failure(any Error)
    }

    private var outcomes: [Outcome]
    private(set) var intents: [RouteIntent] = []

    init(outcomes: [Outcome]) {
        self.outcomes = outcomes
    }

    convenience init(
        suggestions: [RouteSuggestion],
        notice: String? = nil
    ) {
        self.init(
            outcomes: [
                .result(
                    RoutingResult(
                        suggestions: suggestions,
                        notice: notice
                    )
                )
            ]
        )
    }

    func routeSuggestions(
        for intent: RouteIntent
    ) async throws -> RoutingResult {
        intents.append(intent)
        guard !outcomes.isEmpty else {
            throw GraphHopperError.noRouteFound
        }
        switch outcomes.removeFirst() {
        case let .result(result):
            return result
        case let .failure(error):
            throw error
        }
    }
}

@MainActor
private final class ResearchControlledLegacyRouter: RoutingCoordinating {
    private(set) var intents: [RouteIntent] = []
    private(set) var completedRequestCount = 0
    private var continuations: [
        Int: CheckedContinuation<RoutingResult, Error>
    ] = [:]

    func routeSuggestions(
        for intent: RouteIntent
    ) async throws -> RoutingResult {
        let requestIndex = intents.count
        intents.append(intent)
        defer { completedRequestCount += 1 }
        return try await withCheckedThrowingContinuation { continuation in
            continuations[requestIndex] = continuation
        }
    }

    func succeed(
        requestIndex: Int,
        suggestions: [RouteSuggestion]
    ) {
        continuations.removeValue(forKey: requestIndex)?.resume(
            returning: RoutingResult(
                suggestions: suggestions,
                notice: nil
            )
        )
    }
}

private final class ResearchAdapterSpy:
    AdventureResearchIntentAdaptingV1,
    @unchecked Sendable
{
    private let lock = NSLock()
    private var results: [AdventureResearchIntentAdapterResultV1]
    private var inputs: [AdventureResearchIntentAdapterInputV1] = []

    init(results: [AdventureResearchIntentAdapterResultV1]) {
        precondition(!results.isEmpty)
        self.results = results
    }

    convenience init(
        result: AdventureResearchIntentAdapterResultV1
    ) {
        self.init(results: [result])
    }

    func adapt(
        _ input: AdventureResearchIntentAdapterInputV1
    ) -> AdventureResearchIntentAdapterResultV1 {
        lock.withLock {
            inputs.append(input)
            if results.count > 1 {
                return results.removeFirst()
            }
            return results[0]
        }
    }

    func capturedInputs() -> [AdventureResearchIntentAdapterInputV1] {
        lock.withLock { inputs }
    }
}

private final class ResearchCoordinatorSpy:
    OutdoorAdventurePlanningCoordinatingV1,
    @unchecked Sendable
{
    enum Outcome {
        case result(OutdoorAdventurePlanningCoordinatorResultV1)
        case failure(any Error)
    }

    private let lock = NSLock()
    private var outcomes: [Outcome]
    private var intents: [AdventureResearchIntentV1] = []

    init(outcomes: [Outcome]) {
        precondition(!outcomes.isEmpty)
        self.outcomes = outcomes
    }

    convenience init(
        result: OutdoorAdventurePlanningCoordinatorResultV1
    ) {
        self.init(outcomes: [.result(result)])
    }

    func plan(
        intent: AdventureResearchIntentV1
    ) async throws -> OutdoorAdventurePlanningCoordinatorResultV1 {
        let outcome = lock.withLock { () -> Outcome in
            intents.append(intent)
            if outcomes.count > 1 {
                return outcomes.removeFirst()
            }
            return outcomes[0]
        }
        switch outcome {
        case let .result(result):
            return result
        case let .failure(error):
            throw error
        }
    }

    func capturedIntents() -> [AdventureResearchIntentV1] {
        lock.withLock { intents }
    }
}

private final class ResearchControlledCoordinator:
    OutdoorAdventurePlanningCoordinatingV1,
    @unchecked Sendable
{
    private let lock = NSLock()
    private var intents: [AdventureResearchIntentV1] = []
    private var continuations: [
        Int: CheckedContinuation<
            OutdoorAdventurePlanningCoordinatorResultV1,
            Error
        >
    ] = [:]

    func plan(
        intent: AdventureResearchIntentV1
    ) async throws -> OutdoorAdventurePlanningCoordinatorResultV1 {
        try await withCheckedThrowingContinuation {
            continuation in
            lock.withLock {
                let requestIndex = intents.count
                intents.append(intent)
                continuations[requestIndex] = continuation
            }
        }
    }

    func succeed(
        requestIndex: Int,
        with result: OutdoorAdventurePlanningCoordinatorResultV1
    ) {
        let continuation = lock.withLock {
            continuations.removeValue(forKey: requestIndex)
        }
        continuation?.resume(returning: result)
    }

    func capturedIntents() -> [AdventureResearchIntentV1] {
        lock.withLock { intents }
    }
}

@MainActor
private final class ResearchOperationCompletionRecorder {
    private(set) var requestIDs: [UUID] = []

    func record(_ requestID: UUID) {
        requestIDs.append(requestID)
    }
}

private struct SensitiveResearchError: LocalizedError {
    let sentinel: String

    var errorDescription: String? { sentinel }
}

@MainActor
final class PlannerViewModelResearchGuidedPlanningTests: XCTestCase {
    private let startCoordinate = Coordinate(
        latitude: 51.8666,
        longitude: 10.6782
    )
    private let endCoordinate = Coordinate(
        latitude: 51.7636,
        longitude: 10.6647
    )

#if DEBUG
    func testStagingProofGateProbeEvaluatesDisabledPolicyWithoutWork()
        async
    {
        let prompt = "disabled-gate-probe"
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop
        )
        let adapter = ResearchAdapterSpy(
            result: .unsupported(gaps: [.researchContractRejected])
        )
        let coordinator = ResearchCoordinatorSpy(
            outcomes: [
                .failure(
                    OutdoorAdventurePlanningCoordinatorFailureV1
                        .unavailable
                )
            ]
        )
        let router = ResearchLegacyRouter(suggestions: [])
        let viewModel = makeViewModel(
            intent: intent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: adapter,
            coordinator: coordinator,
            featureAvailable: false
        )

        XCTAssertFalse(
            viewModel.stagingProofEvaluateResearchGuidedPlanningGate()
        )
        guard case .idle = viewModel.state else {
            return XCTFail("Gate probe must leave the planner idle.")
        }
        XCTAssertTrue(adapter.capturedInputs().isEmpty)
        XCTAssertTrue(coordinator.capturedIntents().isEmpty)
        XCTAssertTrue(router.intents.isEmpty)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }
#endif

    func testDisabledPolicyBypassesResearchForEveryShippingShape()
        async throws
    {
        let featureOffNotice = " legacy notice\nwith spacing\t"
        let cases: [
            (
                activity: ActivityType,
                routeType: TrailRouteType,
                end: String?
            )
        ] = [
            (.hiking, .loop, nil),
            (.trailRunning, .loop, nil),
            (.biking, .loop, nil),
            (.hiking, .pointToPoint, "Schierke"),
            (.trailRunning, .pointToPoint, "Schierke"),
            (.biking, .pointToPoint, "Schierke")
        ]

        for testCase in cases {
            let prompt =
                "disabled-\(testCase.activity.rawValue)-\(testCase.routeType.rawValue)"
            let intent = makeIntent(
                prompt: prompt,
                activity: testCase.activity,
                routeType: testCase.routeType,
                end: testCase.end
            )
            let route = verifiedRoute(
                activity: testCase.activity,
                routeType: testCase.routeType
            )
            let adapter = ResearchAdapterSpy(
                result: .unsupported(gaps: [.researchContractRejected])
            )
            let coordinator = ResearchCoordinatorSpy(
                outcomes: [
                    .failure(
                        OutdoorAdventurePlanningCoordinatorFailureV1
                            .unavailable
                    )
                ]
            )
            let legacySuggestion = RouteSuggestion(
                route: route,
                explanation: "legacy"
            )
            let router = ResearchLegacyRouter(
                suggestions: [legacySuggestion],
                notice: featureOffNotice
            )
            let resolver = makeResolvedLocationResolver()
            let viewModel = makeViewModel(
                intent: intent,
                resolver: resolver,
                router: router,
                adapter: adapter,
                coordinator: coordinator,
                featureAvailable: false
            )

            viewModel.startPlanning(prompt: prompt)
            await viewModel.generate()

            guard case let .suggestionsReady(success) = viewModel.state else {
                return XCTFail("Disabled case must preserve legacy success: \(prompt)")
            }
            XCTAssertEqual(
                success,
                PlannerViewModel.PlanningSuccess(
                    originalPrompt: prompt,
                    suggestions: [
                        expectedPreparedLegacySuggestion(
                            legacySuggestion,
                            for: intent,
                            endLabel: testCase.end == nil
                                ? nil
                                : "Schierke, Germany"
                        )
                    ],
                    notice: featureOffNotice,
                    researchContext: nil
                )
            )
            XCTAssertEqual(success.notice, featureOffNotice)
            XCTAssertEqual(
                success.notice?.data(using: .utf8),
                featureOffNotice.data(using: .utf8)
            )
            XCTAssertEqual(adapter.capturedInputs().count, 0)
            XCTAssertEqual(coordinator.capturedIntents().count, 0)
            XCTAssertEqual(
                router.intents,
                [
                    RouteIntent(
                        request: RoutePlanningRequest(
                            validatedIntent:
                                ValidatedAdventureIntent(intent: intent)
                        ),
                        start: startCoordinate,
                        end: testCase.end == nil
                            ? nil
                            : endCoordinate,
                        parsedIntent:
                            ValidatedAdventureIntent(intent: intent)
                    )
                ]
            )
        }
    }

    func testDisabledPolicyPreservesExistingBroadLocationClarification()
        async
    {
        let prompt = "15 km loop around Harz"
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop,
            start: "Harz",
            end: nil
        )
        let broadCandidate = locationCandidate(
            id: "broad-region-centroid",
            displayName: "Harz, Germany",
            coordinate: startCoordinate,
            kind: .broadRegion
        )
        let resolver = ResearchLocationResolver(
            resolutions: ["Harz": .resolved(broadCandidate)]
        )
        let adapter = ResearchAdapterSpy(
            result: .unsupported(gaps: [.researchContractRejected])
        )
        let coordinator = ResearchCoordinatorSpy(
            outcomes: [
                .failure(
                    OutdoorAdventurePlanningCoordinatorFailureV1.unavailable
                )
            ]
        )
        let router = ResearchLegacyRouter(
            suggestions: [
                RouteSuggestion(
                    route: verifiedRoute(routeType: .loop),
                    explanation: "legacy"
                )
            ]
        )
        let viewModel = makeViewModel(
            intent: intent,
            resolver: resolver,
            router: router,
            adapter: adapter,
            coordinator: coordinator,
            featureAvailable: false
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard let clarification = viewModel.currentClarification else {
            return XCTFail("A broad region must use the existing clarification state.")
        }
        XCTAssertEqual(clarification.kind, .location(.startLocationQuery))
        XCTAssertTrue(clarification.allowsFreeText)
        XCTAssertNil(clarification.researchClarificationContext)
        XCTAssertEqual(adapter.capturedInputs().count, 0)
        XCTAssertEqual(coordinator.capturedIntents().count, 0)
        XCTAssertEqual(router.intents.count, 0)
    }

    func testDisabledPolicyPreservesRetryAndSelectedLocation() async {
        let prompt = "15 km loop from Ilsenburg"
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop,
            end: nil
        )
        let adapter = ResearchAdapterSpy(
            result: .unsupported(gaps: [.researchContractRejected])
        )
        let coordinator = ResearchCoordinatorSpy(
            outcomes: [
                .failure(
                    OutdoorAdventurePlanningCoordinatorFailureV1.unavailable
                )
            ]
        )
        let route = verifiedRoute(routeType: .loop)
        let router = ResearchLegacyRouter(
            outcomes: [
                .failure(GraphHopperError.noRouteFound),
                .result(
                    RoutingResult(
                        suggestions: [
                            RouteSuggestion(route: route, explanation: "legacy")
                        ],
                        notice: nil
                    )
                )
            ]
        )
        let resolver = makeResolvedLocationResolver()
        let viewModel = makeViewModel(
            intent: intent,
            resolver: resolver,
            router: router,
            adapter: adapter,
            coordinator: coordinator,
            featureAvailable: false
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()
        guard case .noRoutes = viewModel.state else {
            return XCTFail("First legacy failure must remain retryable.")
        }

        viewModel.retryGeneration()
        await viewModel.generate()

        guard case .suggestionsReady = viewModel.state else {
            return XCTFail("Retry must preserve the shipping route flow.")
        }
        XCTAssertNil(viewModel.suggestionNotice)
        XCTAssertEqual(resolver.contexts.count, 1)
        XCTAssertEqual(router.intents.count, 2)
        XCTAssertEqual(adapter.capturedInputs().count, 0)
        XCTAssertEqual(coordinator.capturedIntents().count, 0)
    }

    func testDisabledPolicyPreservesCancellationAndRejectsLateLegacyResult()
        async
    {
        let prompt = "15 km loop from Ilsenburg"
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop,
            end: nil
        )
        let router = ResearchControlledLegacyRouter()
        let adapter = ResearchAdapterSpy(
            result: .unsupported(gaps: [.researchContractRejected])
        )
        let coordinator = ResearchCoordinatorSpy(
            outcomes: [
                .failure(
                    OutdoorAdventurePlanningCoordinatorFailureV1.unavailable
                )
            ]
        )
        let viewModel = makeViewModel(
            intent: intent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: adapter,
            coordinator: coordinator,
            featureAvailable: false
        )

        viewModel.startPlanning(prompt: prompt)
        guard await waitUntil(
            "legacy route request",
            condition: { router.intents.count == 1 }
        ) else { return }

        viewModel.cancelGeneration()
        router.succeed(
            requestIndex: 0,
            suggestions: [
                RouteSuggestion(
                    route: verifiedRoute(routeType: .loop),
                    explanation: "late"
                )
            ]
        )
        guard await waitUntil(
            "late legacy completion",
            condition: {
                router.completedRequestCount == 1
            }
        ) else { return }

        guard case .cancelled = viewModel.state else {
            return XCTFail("A cancellation-ignoring legacy result must stay cancelled.")
        }
        XCTAssertEqual(adapter.capturedInputs().count, 0)
        XCTAssertEqual(coordinator.capturedIntents().count, 0)
    }

    func testReadyInvokesCoordinatorOnceWithoutLegacyRoutingAndForwardsOnlyAdaptedIntent()
        async throws
    {
        let prompt = "RAW-PROMPT-MUST-NOT-REACH-COORDINATOR"
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop,
            end: nil,
            desired: [.viewpoint, .forest]
        )
        let candidate = locationCandidate(
            id: "PRIVATE-CANDIDATE-ID",
            displayName: "Ilsenburg, Germany",
            coordinate: startCoordinate,
            providerRank: 73
        )
        let ready = try XCTUnwrap(
            productionAdapterResult(
                for: intent,
                candidate: candidate
            )
        )
        let researchIntent = try XCTUnwrap(ready.intent)
        let selection = try routedSelection()
        let result = OutdoorAdventurePlanningCoordinatorResultV1.routed(
            OutdoorAdventurePlanningRoutedStateV1(
                state: .routed,
                normalizedIntent: researchIntent,
                planningGaps: [],
                routeSelection: selection
            )
        )
        let adapter = ResearchAdapterSpy(result: ready)
        let coordinator = ResearchControlledCoordinator()
        let router = ResearchLegacyRouter(outcomes: [])
        let resolver = ResearchLocationResolver(
            resolutions: ["Ilsenburg": .resolved(candidate)]
        )
        let viewModel = makeViewModel(
            intent: intent,
            resolver: resolver,
            router: router,
            adapter: adapter,
            coordinator: coordinator,
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: prompt)
        guard await waitUntil(
            "research coordinator request",
            condition: {
                coordinator.capturedIntents().count == 1
            }
        ) else { return }
        XCTAssertEqual(router.intents.count, 0)
        coordinator.succeed(requestIndex: 0, with: result)
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Verified research alternatives must reach success.")
        }
        XCTAssertEqual(router.intents.count, 0)
        XCTAssertEqual(adapter.capturedInputs().count, 1)
        XCTAssertEqual(coordinator.capturedIntents(), [researchIntent])
        XCTAssertEqual(
            success.suggestions.map(\.id),
            selection.alternatives.map(\.suggestion.id)
        )
        XCTAssertNil(success.notice)
        XCTAssertEqual(success.researchContext?.outcome, .routed)
        XCTAssertEqual(
            success.researchContext?.adapterGaps,
            ready.gaps
        )
        XCTAssertEqual(
            success.researchContext?.selectionState,
            selection.state
        )
        XCTAssertEqual(
            success.researchContext?.sourceEnvelopeState,
            selection.sourceEnvelopeState
        )
        XCTAssertEqual(
            success.researchContext?.rejectionCounts,
            selection.rejectionCounts
        )
        XCTAssertEqual(
            success.researchContext?.remainingLimitations,
            selection.remainingLimitations
        )
        for alternative in selection.alternatives {
            let sidecar = try XCTUnwrap(
                success.researchContext?
                    .alternativesBySuggestionID[alternative.suggestion.id]
            )
            XCTAssertEqual(sidecar.attemptID, alternative.attemptID)
            XCTAssertEqual(sidecar.routeResultID, alternative.routeResultID)
            XCTAssertEqual(
                sidecar.researchProvenance,
                alternative.researchProvenance
            )
            XCTAssertEqual(sidecar.waypointVisits, alternative.waypointVisits)
            XCTAssertEqual(
                alternative.suggestion.route.provenance,
                success.suggestions.first {
                    $0.id == alternative.suggestion.id
                }?.route.provenance
            )
        }

        let encodedIntent = try JSONEncoder().encode(
            try XCTUnwrap(coordinator.capturedIntents().first)
        )
        let encodedString = try XCTUnwrap(
            String(data: encodedIntent, encoding: .utf8)
        )
        XCTAssertFalse(encodedString.contains(prompt))
        XCTAssertFalse(encodedString.contains(candidate.id))
        XCTAssertFalse(encodedString.contains("appleGeocoder"))
        XCTAssertFalse(encodedString.contains("providerRank"))
        XCTAssertFalse(encodedString.contains("73"))
    }

    func testProductionAdapterCarriesBrockenPeakMustHaveThroughPlanner()
        async throws
    {
        let prompt = "PRIVATE_BROCKEN_PROMPT_MUST_NOT_CROSS"
        let candidateID = "PRIVATE_BROCKEN_CANDIDATE_ID"
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop,
            start: "Brocken",
            end: nil,
            mustHave: [
                MustHaveResearchExperienceConstraint(
                    experience: .peak
                )
            ]
        )
        let candidate = locationCandidate(
            id: candidateID,
            displayName: "Brocken",
            coordinate: Coordinate(
                latitude: 51.7992,
                longitude: 10.6171
            ),
            kind: .landmark,
            providerRank: 73
        )
        let coordinator = ResearchControlledCoordinator()
        let router = ResearchLegacyRouter(outcomes: [])
        let viewModel = makeViewModel(
            intent: intent,
            resolver: ResearchLocationResolver(
                resolutions: ["Brocken": .resolved(candidate)]
            ),
            router: router,
            adapter: AdventureResearchIntentAdapterV1(),
            coordinator: coordinator,
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: prompt)
        guard await waitUntil(
            "Brocken research coordinator request",
            condition: {
                coordinator.capturedIntents().count == 1
            }
        ) else { return }
        let submittedIntent = try XCTUnwrap(
            coordinator.capturedIntents().first
        )
        XCTAssertEqual(
            submittedIntent.mustHaveExperiences,
            [
                try AdventureResearchExperienceRequirementV1(
                    experience: .peak,
                    minimumCount: 1
                )
            ]
        )
        guard case let .resolved(anchorName, _, _) =
            submittedIntent.geographicAnchor
        else {
            return XCTFail("Expected a resolved Brocken anchor.")
        }
        XCTAssertEqual(anchorName, "Brocken")

        let encodedData = try JSONEncoder().encode(submittedIntent)
        let encoded = try XCTUnwrap(
            String(data: encodedData, encoding: .utf8)
        )
        XCTAssertFalse(encoded.contains(prompt))
        XCTAssertFalse(encoded.contains(candidateID))
        XCTAssertFalse(encoded.contains("appleGeocoder"))
        XCTAssertFalse(encoded.contains("providerRank"))

        let selection = try routedSelection()
        coordinator.succeed(
            requestIndex: 0,
            with: .routed(
                OutdoorAdventurePlanningRoutedStateV1(
                    state: .routed,
                    normalizedIntent: submittedIntent,
                    planningGaps: [],
                    routeSelection: selection
                )
            )
        )
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail(
                "The typed Brocken research request must complete."
            )
        }
        XCTAssertEqual(router.intents.count, 0)
        XCTAssertEqual(success.researchContext?.outcome, .routed)
    }

    func testUnsatisfiedGenericMustHaveFallsBackWithoutFakeResearchRoute()
        async throws
    {
        let prompt = "PRIVATE_UNSATISFIED_MUST_HAVE_PROMPT"
        let constraint = MustHaveResearchExperienceConstraint(
            experience: .waterfall
        )
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop,
            end: nil,
            mustHave: [constraint]
        )
        let candidate = locationCandidate(
            id: "PRIVATE_ILSENBURG_CANDIDATE_ID",
            displayName: "Ilsenburg, Germany",
            coordinate: startCoordinate
        )
        let coordinator = ResearchControlledCoordinator()
        let router = ResearchLegacyRouter(
            suggestions: [
                RouteSuggestion(
                    route: verifiedRoute(routeType: .loop),
                    explanation: "legacy"
                )
            ]
        )
        let viewModel = makeViewModel(
            intent: intent,
            resolver: ResearchLocationResolver(
                resolutions: ["Ilsenburg": .resolved(candidate)]
            ),
            router: router,
            adapter: AdventureResearchIntentAdapterV1(),
            coordinator: coordinator,
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: prompt)
        guard await waitUntil(
            "generic must-have research coordinator request",
            condition: {
                coordinator.capturedIntents().count == 1
            }
        ) else { return }
        let submittedIntent = try XCTUnwrap(
            coordinator.capturedIntents().first
        )
        XCTAssertEqual(
            submittedIntent.mustHaveExperiences,
            [
                try AdventureResearchExperienceRequirementV1(
                    experience: .waterfall,
                    minimumCount: 1
                )
            ]
        )
        XCTAssertTrue(submittedIntent.preferredExperiences.isEmpty)
        XCTAssertTrue(submittedIntent.requiredFacilities.isEmpty)
        let encodedData = try JSONEncoder().encode(submittedIntent)
        let encoded = try XCTUnwrap(
            String(data: encodedData, encoding: .utf8)
        )
        XCTAssertTrue(encoded.contains("\"waterfall\""))
        XCTAssertFalse(encoded.contains(prompt))
        XCTAssertFalse(
            encoded.contains("PRIVATE_ILSENBURG_CANDIDATE_ID")
        )

        coordinator.succeed(
            requestIndex: 0,
            with: .noViableRoute(
                OutdoorAdventurePlanningNonRoutedStateV1(
                    state: .noViableRoute,
                    normalizedIntent: submittedIntent,
                    planningGaps: [],
                    clarificationQuestions: []
                )
            )
        )
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail(
                "An unsatisfied generic must-have must use legacy fallback."
            )
        }
        XCTAssertEqual(router.intents.count, 1)
        XCTAssertEqual(success.suggestions.count, 1)
        XCTAssertEqual(
            success.researchContext?.outcome,
            .legacyFallback(.noViableRoute)
        )
        XCTAssertTrue(
            success.researchContext?.alternativesBySuggestionID.isEmpty
                == true
        )
    }

    func testAdapterClarificationUsesExistingLocationFlowAndInvokesNoRouter()
        async throws
    {
        let prompt = "15 km loop from Ilsenburg"
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop,
            end: nil
        )
        let clarificationResult =
            AdventureResearchIntentAdapterV1().adapt(
                AdventureResearchIntentAdapterInputV1(
                    validatedIntent: ValidatedAdventureIntent(intent: intent),
                    resolvedStart: nil
                )
            )
        guard case let .clarificationRequired(
            researchIntent,
            adapterGaps
        ) = clarificationResult else {
            return XCTFail("Fixture must be a valid adapter clarification.")
        }
        let adapter = ResearchAdapterSpy(result: clarificationResult)
        let coordinator = ResearchCoordinatorSpy(
            outcomes: [
                .failure(
                    OutdoorAdventurePlanningCoordinatorFailureV1.unavailable
                )
            ]
        )
        let router = ResearchLegacyRouter(outcomes: [])
        let viewModel = makeViewModel(
            intent: intent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: adapter,
            coordinator: coordinator,
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        let clarification = try XCTUnwrap(viewModel.currentClarification)
        XCTAssertEqual(clarification.kind, .location(.startLocationQuery))
        XCTAssertTrue(clarification.allowsFreeText)
        XCTAssertTrue(
            clarification.supportingText?.contains("arbitrary map center")
                == true
        )
        let context = try XCTUnwrap(
            clarification.researchClarificationContext
        )
        XCTAssertEqual(context.origin, .adapter)
        XCTAssertEqual(context.adapterGaps, adapterGaps)
        XCTAssertEqual(context.backendPlanningGaps, [])
        XCTAssertEqual(
            context.questions,
            researchIntent.unresolvedClarificationQuestions
        )
        XCTAssertTrue(
            (1...PlannerViewModel.ResearchClarificationContext
                .maximumQuestionCount).contains(context.questions.count)
        )
        let userFacingCopy = [
            clarification.question,
            clarification.supportingText
        ]
            .compactMap { $0 }
            .joined(separator: " ")
        for gap in adapterGaps {
            XCTAssertFalse(userFacingCopy.contains(gap.rawValue))
        }
        XCTAssertEqual(adapter.capturedInputs().count, 1)
        XCTAssertEqual(coordinator.capturedIntents().count, 0)
        XCTAssertEqual(router.intents.count, 0)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
    }

    func testBroadRegionNeverReachesAdapterOrEitherRouterWhenFeatureEnabled()
        async
    {
        let prompt = "15 km loop around Harz"
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop,
            start: "Harz",
            end: nil
        )
        let broadCandidate = locationCandidate(
            id: "broad-centroid",
            displayName: "Harz, Germany",
            coordinate: startCoordinate,
            kind: .broadRegion
        )
        let adapter = ResearchAdapterSpy(
            result: .unsupported(gaps: [.researchContractRejected])
        )
        let coordinator = ResearchCoordinatorSpy(
            outcomes: [
                .failure(
                    OutdoorAdventurePlanningCoordinatorFailureV1.unavailable
                )
            ]
        )
        let router = ResearchLegacyRouter(outcomes: [])
        let viewModel = makeViewModel(
            intent: intent,
            resolver: ResearchLocationResolver(
                resolutions: ["Harz": .resolved(broadCandidate)]
            ),
            router: router,
            adapter: adapter,
            coordinator: coordinator,
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        XCTAssertNotNil(viewModel.currentClarification)
        XCTAssertEqual(adapter.capturedInputs().count, 0)
        XCTAssertEqual(coordinator.capturedIntents().count, 0)
        XCTAssertEqual(router.intents.count, 0)
    }

    func testAdapterUnsupportedFallsBackOnceAndPreservesGaps() async {
        let prompt = "bike loop from Ilsenburg"
        let routingOnlyNotice = " existing routing notice\nwith spacing\t"
        let intent = makeIntent(
            prompt: prompt,
            activity: .biking,
            routeType: .loop,
            end: nil
        )
        let gaps: [AdventureResearchIntentAdapterGapV1] = [
            .activityNotSupported
        ]
        let adapter = ResearchAdapterSpy(
            result: .unsupported(gaps: gaps)
        )
        let coordinator = ResearchCoordinatorSpy(
            outcomes: [
                .failure(
                    OutdoorAdventurePlanningCoordinatorFailureV1.unavailable
                )
            ]
        )
        let router = ResearchLegacyRouter(
            suggestions: [
                RouteSuggestion(
                    route: verifiedRoute(
                        activity: .biking,
                        routeType: .loop
                    ),
                    explanation: "legacy"
                )
            ],
            notice: routingOnlyNotice
        )
        let viewModel = makeViewModel(
            intent: intent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: adapter,
            coordinator: coordinator,
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Unsupported research shapes must preserve legacy success.")
        }
        XCTAssertEqual(router.intents.count, 1)
        XCTAssertEqual(coordinator.capturedIntents().count, 0)
        XCTAssertEqual(success.notice, routingOnlyNotice)
        XCTAssertEqual(
            success.notice?.data(using: .utf8),
            routingOnlyNotice.data(using: .utf8)
        )
        XCTAssertEqual(success.researchContext?.adapterGaps, gaps)
        XCTAssertEqual(
            success.researchContext?.outcome,
            .legacyFallback(.adapterUnsupported)
        )
    }

    func testPartialDisplaysVerifiedAlternativesWithBoundedNoticeAndAllContext()
        async throws
    {
        let fixture = try makeResearchFixture()
        let planningGap = OutdoorAdventurePlanningGapV1(
            code: .scenicQualityNotVerifiable,
            affectedField: .preferredExperiences,
            affectedValue: "viewpoint",
            reason: .contractDimensionMissing,
            requiresClarification: false,
            requiresCapability: true
        )
        let result = OutdoorAdventurePlanningCoordinatorResultV1.partial(
            OutdoorAdventurePlanningRoutedStateV1(
                state: .partial,
                normalizedIntent: fixture.intent,
                planningGaps: [planningGap],
                routeSelection: fixture.selection
            )
        )
        let router = ResearchLegacyRouter(outcomes: [])
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(result: fixture.adapterResult),
            coordinator: ResearchCoordinatorSpy(result: result),
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Partial verified alternatives must remain usable.")
        }
        XCTAssertEqual(
            success.notice,
            "Some requested preferences could not be verified."
        )
        XCTAssertEqual(router.intents.count, 0)
        XCTAssertEqual(success.researchContext?.outcome, .partial)
        XCTAssertEqual(
            success.researchContext?.backendPlanningGaps,
            [planningGap]
        )
        XCTAssertEqual(
            success.researchContext?.remainingLimitations,
            fixture.selection.remainingLimitations
        )
        XCTAssertEqual(
            Set(
                success.researchContext?
                    .alternativesBySuggestionID.keys.map { $0 } ?? []
            ),
            Set(success.suggestions.map(\.id))
        )
    }

    func testCoordinatorLocationClarificationShowsNoRoutesAndReusesExistingFlow()
        async throws
    {
        let fixture = try makeResearchFixture()
        let planningGap = OutdoorAdventurePlanningGapV1(
            code: .currentSourceUnavailable,
            affectedField: .dateOrSeason,
            affectedValue: "winter",
            reason: .currentEvidenceNotAvailable,
            requiresClarification: true,
            requiresCapability: false
        )
        let unresolvedResult =
            AdventureResearchIntentAdapterV1().adapt(
                AdventureResearchIntentAdapterInputV1(
                    validatedIntent: ValidatedAdventureIntent(
                        intent: fixture.localIntent
                    ),
                    resolvedStart: nil
                )
            )
        let unresolvedIntent = try XCTUnwrap(unresolvedResult.intent)
        let result =
            OutdoorAdventurePlanningCoordinatorResultV1
                .clarificationRequired(
                    OutdoorAdventurePlanningNonRoutedStateV1(
                        state: .clarificationRequired,
                        normalizedIntent: unresolvedIntent,
                        planningGaps: [planningGap],
                        clarificationQuestions:
                            unresolvedIntent
                                .unresolvedClarificationQuestions
                    )
                )
        let router = ResearchLegacyRouter(outcomes: [])
        let coordinator = ResearchCoordinatorSpy(result: result)
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(result: fixture.adapterResult),
            coordinator: coordinator,
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        await viewModel.generate()

        let clarification = try XCTUnwrap(viewModel.currentClarification)
        let context = try XCTUnwrap(
            clarification.researchClarificationContext
        )
        XCTAssertEqual(context.origin, .coordinator)
        XCTAssertEqual(context.adapterGaps, fixture.adapterResult.gaps)
        XCTAssertEqual(context.backendPlanningGaps, [planningGap])
        XCTAssertEqual(
            context.questions,
            unresolvedIntent.unresolvedClarificationQuestions
        )
        let userFacingCopy = [
            clarification.question,
            clarification.supportingText
        ]
            .compactMap { $0 }
            .joined(separator: " ")
        for gap in fixture.adapterResult.gaps {
            XCTAssertFalse(userFacingCopy.contains(gap.rawValue))
        }
        XCTAssertFalse(userFacingCopy.contains(planningGap.code.rawValue))
        XCTAssertFalse(
            userFacingCopy.contains(planningGap.reason.rawValue)
        )
        XCTAssertFalse(
            userFacingCopy.contains(planningGap.affectedField.rawValue)
        )
        XCTAssertTrue(viewModel.suggestions.isEmpty)
        XCTAssertEqual(coordinator.capturedIntents().count, 1)
        XCTAssertEqual(router.intents.count, 0)
    }

    func testUnrepresentableCoordinatorClarificationUsesBoundedRecovery()
        async throws
    {
        let fixture = try makeResearchFixture()
        let questions = [
            AdventureResearchClarificationQuestionV1(
                code: .dateOrSeasonRequired,
                field: .dateOrSeason
            ),
            AdventureResearchClarificationQuestionV1(
                code: .difficultyClarificationRequired,
                field: .maximumTechnicalDifficulty
            )
        ]
        let planningGap = OutdoorAdventurePlanningGapV1(
            code: .unsupportedEvidenceDimension,
            affectedField: .dateOrSeason,
            affectedValue: "winter",
            reason: .clarificationNeeded,
            requiresClarification: true,
            requiresCapability: false
        )
        let clarifiedIntent = try replacingQuestions(
            in: fixture.intent,
            with: questions
        )
        let result =
            OutdoorAdventurePlanningCoordinatorResultV1
                .clarificationRequired(
                    OutdoorAdventurePlanningNonRoutedStateV1(
                        state: .clarificationRequired,
                        normalizedIntent: clarifiedIntent,
                        planningGaps: [planningGap],
                        clarificationQuestions: questions
                    )
                )
        let router = ResearchLegacyRouter(outcomes: [])
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(result: fixture.adapterResult),
            coordinator: ResearchCoordinatorSpy(result: result),
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        await viewModel.generate()

        guard case let .recoverableError(recovery) = viewModel.state else {
            return XCTFail("Unsupported research questions must request an edit.")
        }
        XCTAssertTrue(recovery.message.contains("Edit the prompt"))
        XCTAssertFalse(recovery.message.contains("date_or_season"))
        XCTAssertFalse(recovery.message.contains("clarification_required"))
        let context = try XCTUnwrap(
            recovery.researchClarificationContext
        )
        XCTAssertEqual(context.origin, .coordinator)
        XCTAssertEqual(context.adapterGaps, fixture.adapterResult.gaps)
        XCTAssertEqual(context.backendPlanningGaps, [planningGap])
        XCTAssertEqual(context.questions, questions)
        XCTAssertTrue(
            (1...PlannerViewModel.ResearchClarificationContext
                .maximumQuestionCount).contains(context.questions.count)
        )
        for gap in fixture.adapterResult.gaps {
            XCTAssertFalse(recovery.message.contains(gap.rawValue))
        }
        XCTAssertFalse(recovery.message.contains(planningGap.code.rawValue))
        XCTAssertFalse(
            recovery.message.contains(planningGap.reason.rawValue)
        )
        XCTAssertFalse(
            recovery.message.contains(planningGap.affectedField.rawValue)
        )
        for question in questions {
            XCTAssertFalse(recovery.message.contains(question.code.rawValue))
            XCTAssertFalse(recovery.message.contains(question.field.rawValue))
        }
        XCTAssertTrue(viewModel.suggestions.isEmpty)
        XCTAssertEqual(router.intents.count, 0)
    }

    func testResearchClarificationContextEnforcesQuestionBound() {
        let question = AdventureResearchClarificationQuestionV1(
            code: .dateOrSeasonRequired,
            field: .dateOrSeason
        )
        let maximumQuestions = Array(
            repeating: question,
            count: PlannerViewModel.ResearchClarificationContext
                .maximumQuestionCount
        )

        XCTAssertNil(
            PlannerViewModel.ResearchClarificationContext(
                origin: .coordinator,
                adapterGaps: [],
                backendPlanningGaps: [],
                questions: []
            )
        )
        XCTAssertEqual(
            PlannerViewModel.ResearchClarificationContext(
                origin: .coordinator,
                adapterGaps: [],
                backendPlanningGaps: [],
                questions: maximumQuestions
            )?.questions,
            maximumQuestions
        )
        XCTAssertNil(
            PlannerViewModel.ResearchClarificationContext(
                origin: .coordinator,
                adapterGaps: [],
                backendPlanningGaps: [],
                questions: maximumQuestions + [question]
            )
        )
    }

    func testAnsweringResearchClarificationDoesNotReuseItsContext()
        async throws
    {
        let prompt = "15 km loop from Ilsenburg"
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop,
            end: nil
        )
        let clarificationResult =
            AdventureResearchIntentAdapterV1().adapt(
                AdventureResearchIntentAdapterInputV1(
                    validatedIntent: ValidatedAdventureIntent(
                        intent: intent
                    ),
                    resolvedStart: nil
                )
            )
        guard case .clarificationRequired = clarificationResult else {
            return XCTFail("Fixture must be a valid adapter clarification.")
        }
        let router = ResearchLegacyRouter(
            outcomes: [.failure(GraphHopperError.noRouteFound)]
        )
        let viewModel = makeViewModel(
            intent: intent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(
                results: [
                    clarificationResult,
                    .unsupported(gaps: [.researchContractRejected])
                ]
            ),
            coordinator: ResearchCoordinatorSpy(
                outcomes: [
                    .failure(
                        OutdoorAdventurePlanningCoordinatorFailureV1
                            .unavailable
                    )
                ]
            ),
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: prompt)
        await viewModel.generate()
        XCTAssertNotNil(
            viewModel.currentClarification?
                .researchClarificationContext
        )

        viewModel.answerClarification(.text("Schierke"))
        await viewModel.generate()

        guard case let .noRoutes(recovery) = viewModel.state else {
            return XCTFail("The answered attempt must reach fresh recovery.")
        }
        XCTAssertNil(recovery.researchClarificationContext)
        XCTAssertEqual(router.intents.count, 1)
    }

    func testRetryingResearchClarificationRecoveryDoesNotReuseItsContext()
        async throws
    {
        let fixture = try makeResearchFixture()
        let question = AdventureResearchClarificationQuestionV1(
            code: .dateOrSeasonRequired,
            field: .dateOrSeason
        )
        let clarifiedIntent = try replacingQuestions(
            in: fixture.intent,
            with: [question]
        )
        let result =
            OutdoorAdventurePlanningCoordinatorResultV1
                .clarificationRequired(
                    OutdoorAdventurePlanningNonRoutedStateV1(
                        state: .clarificationRequired,
                        normalizedIntent: clarifiedIntent,
                        planningGaps: [],
                        clarificationQuestions: [question]
                    )
                )
        let router = ResearchLegacyRouter(
            outcomes: [.failure(GraphHopperError.noRouteFound)]
        )
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(
                results: [
                    fixture.adapterResult,
                    .unsupported(gaps: [.researchContractRejected])
                ]
            ),
            coordinator: ResearchCoordinatorSpy(result: result),
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        await viewModel.generate()
        XCTAssertNotNil(
            viewModel.currentRecovery?.researchClarificationContext
        )

        viewModel.retryGeneration()
        await viewModel.generate()

        guard case let .noRoutes(recovery) = viewModel.state else {
            return XCTFail("Retry must produce a fresh non-research recovery.")
        }
        XCTAssertNil(recovery.researchClarificationContext)
        XCTAssertEqual(router.intents.count, 1)
    }

    func testEditAndResetDoNotReuseResearchClarificationContext()
        async throws
    {
        let prompt = "15 km loop from Ilsenburg"
        let intent = makeIntent(
            prompt: prompt,
            routeType: .loop,
            end: nil
        )
        let clarificationResult =
            AdventureResearchIntentAdapterV1().adapt(
                AdventureResearchIntentAdapterInputV1(
                    validatedIntent: ValidatedAdventureIntent(
                        intent: intent
                    ),
                    resolvedStart: nil
                )
            )
        guard case .clarificationRequired = clarificationResult else {
            return XCTFail("Fixture must be a valid adapter clarification.")
        }

        for action in ["edit", "reset"] {
            let router = ResearchLegacyRouter(
                outcomes: [.failure(GraphHopperError.noRouteFound)]
            )
            let viewModel = makeViewModel(
                intent: intent,
                resolver: makeResolvedLocationResolver(),
                router: router,
                adapter: ResearchAdapterSpy(
                    results: [
                        clarificationResult,
                        .unsupported(
                            gaps: [.researchContractRejected]
                        )
                    ]
                ),
                coordinator: ResearchCoordinatorSpy(
                    outcomes: [
                        .failure(
                            OutdoorAdventurePlanningCoordinatorFailureV1
                                .unavailable
                        )
                    ]
                ),
                featureAvailable: true
            )

            viewModel.startPlanning(prompt: prompt)
            await viewModel.generate()
            XCTAssertNotNil(
                viewModel.currentClarification?
                    .researchClarificationContext
            )

            if action == "edit" {
                viewModel.editRequest()
            } else {
                viewModel.reset()
            }
            viewModel.startPlanning(prompt: prompt)
            await viewModel.generate()

            guard case let .noRoutes(recovery) = viewModel.state else {
                return XCTFail(
                    "\(action) must start a fresh non-research attempt."
                )
            }
            XCTAssertNil(recovery.researchClarificationContext)
            XCTAssertEqual(router.intents.count, 1)
        }
    }

    func testUnsupportedAndNoViableRouteEachFallBackExactlyOnce()
        async throws
    {
        let fixture = try makeResearchFixture()
        let planningGap = OutdoorAdventurePlanningGapV1(
            code: .unsupportedRegion,
            affectedField: .geographicAnchor,
            affectedValue: nil,
            reason: .coverageNotConfigured,
            requiresClarification: false,
            requiresCapability: true
        )
        let cases: [
            (
                result: OutdoorAdventurePlanningCoordinatorResultV1,
                reason:
                    PlannerViewModel.ResearchPlanningContext
                        .LegacyFallbackReason
            )
        ] = [
            (
                .unsupported(
                    OutdoorAdventurePlanningNonRoutedStateV1(
                        state: .unsupported,
                        normalizedIntent: fixture.intent,
                        planningGaps: [planningGap],
                        clarificationQuestions: []
                    )
                ),
                .coordinatorUnsupported
            ),
            (
                .noViableRoute(
                    OutdoorAdventurePlanningNonRoutedStateV1(
                        state: .noViableRoute,
                        normalizedIntent: fixture.intent,
                        planningGaps: [planningGap],
                        clarificationQuestions: []
                    )
                ),
                .noViableRoute
            )
        ]

        for testCase in cases {
            let router = ResearchLegacyRouter(
                suggestions: [
                    RouteSuggestion(
                        route: verifiedRoute(routeType: .loop),
                        explanation: "legacy"
                    )
                ]
            )
            let viewModel = makeViewModel(
                intent: fixture.localIntent,
                resolver: makeResolvedLocationResolver(),
                router: router,
                adapter: ResearchAdapterSpy(
                    result: fixture.adapterResult
                ),
                coordinator: ResearchCoordinatorSpy(
                    result: testCase.result
                ),
                featureAvailable: true
            )

            viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
            await viewModel.generate()

            guard case let .suggestionsReady(success) = viewModel.state else {
                return XCTFail("Safe non-routed research states must fall back.")
            }
            XCTAssertEqual(router.intents.count, 1)
            XCTAssertEqual(
                success.notice,
                "A standard routed option was built because research-guided matching was unavailable."
            )
            XCTAssertEqual(
                success.researchContext?.outcome,
                .legacyFallback(testCase.reason)
            )
            XCTAssertEqual(
                success.researchContext?.backendPlanningGaps,
                [planningGap]
            )
        }
    }

    func testMismatchedNonRoutedResultsFailClosedAndFallBackExactlyOnce()
        async throws
    {
        let fixture = try makeResearchFixture()
        let mismatchedIntent = try replacingActivity(
            in: fixture.intent,
            with: .biking
        )
        let question = AdventureResearchClarificationQuestionV1(
            code: .dateOrSeasonRequired,
            field: .dateOrSeason
        )
        let mismatchedClarificationIntent = try replacingQuestions(
            in: mismatchedIntent,
            with: [question]
        )
        let planningGap = OutdoorAdventurePlanningGapV1(
            code: .unsupportedRegion,
            affectedField: .geographicAnchor,
            affectedValue: nil,
            reason: .coverageNotConfigured,
            requiresClarification: false,
            requiresCapability: true
        )
        let results: [OutdoorAdventurePlanningCoordinatorResultV1] = [
            .clarificationRequired(
                OutdoorAdventurePlanningNonRoutedStateV1(
                    state: .clarificationRequired,
                    normalizedIntent: mismatchedClarificationIntent,
                    planningGaps: [],
                    clarificationQuestions: [question]
                )
            ),
            .unsupported(
                OutdoorAdventurePlanningNonRoutedStateV1(
                    state: .unsupported,
                    normalizedIntent: mismatchedIntent,
                    planningGaps: [planningGap],
                    clarificationQuestions: []
                )
            ),
            .noViableRoute(
                OutdoorAdventurePlanningNonRoutedStateV1(
                    state: .noViableRoute,
                    normalizedIntent: mismatchedIntent,
                    planningGaps: [planningGap],
                    clarificationQuestions: []
                )
            )
        ]

        for result in results {
            let router = ResearchLegacyRouter(
                suggestions: [
                    RouteSuggestion(
                        route: verifiedRoute(routeType: .loop),
                        explanation: "legacy"
                    )
                ]
            )
            let viewModel = makeViewModel(
                intent: fixture.localIntent,
                resolver: makeResolvedLocationResolver(),
                router: router,
                adapter: ResearchAdapterSpy(
                    result: fixture.adapterResult
                ),
                coordinator: ResearchCoordinatorSpy(result: result),
                featureAvailable: true
            )

            viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
            await viewModel.generate()

            guard case let .suggestionsReady(success) = viewModel.state else {
                return XCTFail("Misassociated non-routed output must fail closed.")
            }
            XCTAssertEqual(router.intents.count, 1)
            XCTAssertEqual(
                success.researchContext?.outcome,
                .legacyFallback(.invalidResearchResult)
            )
        }
    }

    func testFallbackNoticeMergerPreservesBothSingleAndDuplicateNotices()
        async throws
    {
        let fixture = try makeResearchFixture()
        let researchNotice =
            "A standard routed option was built because research-guided matching was unavailable."
        let flexibleModeNotice =
            "GraphHopper round trips need flexible mode on this API plan, so Wanderful built loop options from normal routed segments."
        let loopComparisonNotice =
            "Wanderful found distinct routed loop options from the same start for comparison."
        let cases: [
            (
                name: String,
                routingNotice: String?,
                expectedNotice: String
            )
        ] = [
            (
                "flexible-mode notice",
                flexibleModeNotice,
                "\(researchNotice)\n\n\(flexibleModeNotice)"
            ),
            (
                "ordinary loop-comparison notice",
                loopComparisonNotice,
                "\(researchNotice)\n\n\(loopComparisonNotice)"
            ),
            (
                "research notice only",
                nil,
                researchNotice
            ),
            (
                "exact duplicate",
                researchNotice,
                researchNotice
            )
        ]

        for testCase in cases {
            let router = ResearchLegacyRouter(
                suggestions: [
                    RouteSuggestion(
                        route: verifiedRoute(routeType: .loop),
                        explanation: "legacy"
                    )
                ],
                notice: testCase.routingNotice
            )
            let viewModel = makeViewModel(
                intent: fixture.localIntent,
                resolver: makeResolvedLocationResolver(),
                router: router,
                adapter: ResearchAdapterSpy(
                    result: fixture.adapterResult
                ),
                coordinator: ResearchCoordinatorSpy(
                    outcomes: [
                        .failure(
                            OutdoorAdventurePlanningCoordinatorFailureV1
                                .unavailable
                        )
                    ]
                ),
                featureAvailable: true
            )

            viewModel.startPlanning(
                prompt: fixture.localIntent.rawPrompt
            )
            await viewModel.generate()

            guard case let .suggestionsReady(success) = viewModel.state else {
                return XCTFail(
                    "\(testCase.name) must preserve legacy success."
                )
            }
            XCTAssertEqual(
                success.notice,
                testCase.expectedNotice,
                testCase.name
            )
            XCTAssertEqual(router.intents.count, 1, testCase.name)
        }
    }

    func testEverySafeCoordinatorFailureFallsBackExactlyOnce()
        async throws
    {
        let fixture = try makeResearchFixture()
        let failures: [OutdoorAdventurePlanningCoordinatorFailureV1] = [
            .unavailable,
            .authorizationFailed,
            .rateLimited,
            .timedOut,
            .rejected
        ]

        for failure in failures {
            let router = ResearchLegacyRouter(
                suggestions: [
                    RouteSuggestion(
                        route: verifiedRoute(routeType: .loop),
                        explanation: "legacy"
                    )
                ]
            )
            let coordinator = ResearchCoordinatorSpy(
                outcomes: [.failure(failure)]
            )
            let viewModel = makeViewModel(
                intent: fixture.localIntent,
                resolver: makeResolvedLocationResolver(),
                router: router,
                adapter: ResearchAdapterSpy(
                    result: fixture.adapterResult
                ),
                coordinator: coordinator,
                featureAvailable: true
            )

            viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
            await viewModel.generate()

            guard case let .suggestionsReady(success) = viewModel.state else {
                return XCTFail("Failure \(failure) must preserve standard routing.")
            }
            XCTAssertEqual(router.intents.count, 1)
            XCTAssertEqual(coordinator.capturedIntents().count, 1)
            XCTAssertEqual(
                success.researchContext?.outcome,
                .legacyFallback(.coordinatorFailure(failure))
            )
            XCTAssertEqual(
                success.notice,
                "A standard routed option was built because research-guided matching was unavailable."
            )
            XCTAssertFalse(
                success.notice?.localizedCaseInsensitiveContains(
                    failure.localizedDescription
                ) == true
            )
        }
    }

    func testInvalidCoordinatorResultFailsClosedWithoutLegacyRouting()
        async throws
    {
        let fixture = try makeResearchFixture()
        let router = ResearchLegacyRouter(
            suggestions: [
                RouteSuggestion(
                    route: verifiedRoute(routeType: .loop),
                    explanation: "must not be used"
                )
            ]
        )
        let coordinator = ResearchCoordinatorSpy(
            outcomes: [
                .failure(
                    OutdoorAdventurePlanningCoordinatorFailureV1
                        .invalidResult
                )
            ]
        )
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(
                result: fixture.adapterResult
            ),
            coordinator: coordinator,
            featureAvailable: true
        )

        viewModel.startPlanning(
            prompt: fixture.localIntent.rawPrompt
        )
        await viewModel.generate()

        guard case let .recoverableError(recovery) =
                viewModel.state
        else {
            return XCTFail(
                "An invalid backend result must fail closed."
            )
        }
        XCTAssertEqual(router.intents.count, 0)
        XCTAssertEqual(coordinator.capturedIntents().count, 1)
        XCTAssertEqual(recovery.kind, .unverified)
        XCTAssertEqual(
            recovery.message,
            "Wanderful couldn’t verify the returned route. Try again or edit the request."
        )
    }

    func testUnexpectedCoordinatorErrorDoesNotExposeProviderBody()
        async throws
    {
        let fixture = try makeResearchFixture()
        let sentinel =
            "PRIVATE_PROVIDER_BODY api_key=do-not-display"
        let router = ResearchLegacyRouter(
            suggestions: [
                RouteSuggestion(
                    route: verifiedRoute(routeType: .loop),
                    explanation: "legacy"
                )
            ]
        )
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(result: fixture.adapterResult),
            coordinator: ResearchCoordinatorSpy(
                outcomes: [
                    .failure(
                        SensitiveResearchError(sentinel: sentinel)
                    )
                ]
            ),
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Unexpected provider failures must fall back safely.")
        }
        XCTAssertEqual(router.intents.count, 1)
        XCTAssertEqual(
            success.researchContext?.outcome,
            .legacyFallback(.coordinatorFailure(.unavailable))
        )
        XCTAssertEqual(
            success.notice,
            "A standard routed option was built because research-guided matching was unavailable."
        )
        XCTAssertFalse(success.notice?.contains(sentinel) == true)
#if DEBUG
        XCTAssertFalse(viewModel.generationDebugError?.contains(sentinel) == true)
#endif
    }

    func testResearchTimeoutFallsBackOnceAndLateResultCannotAddTerminalState()
        async throws
    {
        let fixture = try makeResearchFixture()
        let coordinator = ResearchControlledCoordinator()
        let completionRecorder =
            ResearchOperationCompletionRecorder()
        let legacySuggestion = RouteSuggestion(
            route: verifiedRoute(routeType: .loop),
            explanation: "legacy"
        )
        let router = ResearchLegacyRouter(
            suggestions: [legacySuggestion]
        )
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(result: fixture.adapterResult),
            coordinator: coordinator,
            featureAvailable: true,
            completionRecorder: completionRecorder,
            operationTimeouts: .init(
                parserSeconds: 2,
                geocodingSeconds: 2,
                routingSeconds: 0.05
            )
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        guard await waitUntil(
            "timed research request",
            condition: {
                coordinator.capturedIntents().count == 1
            }
        ) else { return }
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("A research timeout must preserve legacy routing.")
        }
        XCTAssertEqual(router.intents.count, 1)
        XCTAssertEqual(
            success.suggestions,
            [
                expectedPreparedLegacySuggestion(
                    legacySuggestion,
                    for: fixture.localIntent
                )
            ]
        )
        XCTAssertEqual(
            success.researchContext?.outcome,
            .legacyFallback(.coordinatorFailure(.timedOut))
        )
        let soleTerminalState = viewModel.state

        coordinator.succeed(
            requestIndex: 0,
            with: .routed(
                OutdoorAdventurePlanningRoutedStateV1(
                    state: .routed,
                    normalizedIntent: fixture.intent,
                    planningGaps: [],
                    routeSelection: fixture.selection
                )
            )
        )
        guard await waitUntil(
            "late timed-out coordinator completion",
            condition: {
                completionRecorder.requestIDs.count == 1
            }
        ) else { return }

        XCTAssertEqual(viewModel.state, soleTerminalState)
        XCTAssertEqual(router.intents.count, 1)
    }

    func testInvalidResearchSelectionsFailClosedAndFallBackExactlyOnce()
        async throws
    {
        let fixture = try makeResearchFixture()
        let firstAlternative = try XCTUnwrap(
            fixture.selection.alternatives.first
        )
        let secondAlternative = try XCTUnwrap(
            fixture.selection.alternatives.dropFirst().first
        )
        let empty = replacingAlternatives(
            in: fixture.selection,
            with: []
        )
        let unverified = replacingAlternatives(
            in: fixture.selection,
            with: [
                firstAlternative.replacingSuggestion(
                    RouteSuggestion(
                        id: firstAlternative.suggestion.id,
                        route: replacingProvenance(
                            in: firstAlternative.suggestion.route,
                            with: .unverified(.unknown)
                        ),
                        explanation:
                            firstAlternative.suggestion.explanation
                    )
                )
            ]
        )
        let biking = replacingAlternatives(
            in: fixture.selection,
            with: [
                firstAlternative.replacingSuggestion(
                    RouteSuggestion(
                        id: firstAlternative.suggestion.id,
                        route: verifiedRoute(
                            activity: .biking,
                            routeType: .loop
                        ),
                        explanation:
                            firstAlternative.suggestion.explanation
                    )
                )
            ]
        )
        let pointToPoint = replacingAlternatives(
            in: fixture.selection,
            with: [
                firstAlternative.replacingSuggestion(
                    RouteSuggestion(
                        id: firstAlternative.suggestion.id,
                        route: verifiedRoute(
                            activity: .hiking,
                            routeType: .pointToPoint
                        ),
                        explanation:
                            firstAlternative.suggestion.explanation
                    )
                )
            ]
        )
        let duplicateSuggestionIDs = replacingAlternatives(
            in: fixture.selection,
            with: [
                firstAlternative,
                secondAlternative.replacingSuggestion(
                    RouteSuggestion(
                        id: firstAlternative.suggestion.id,
                        route: secondAlternative.suggestion.route,
                        explanation:
                            secondAlternative.suggestion.explanation
                    )
                )
            ]
        )
        let eligibilityRejected = replacingAlternatives(
            in: fixture.selection,
            with: [
                firstAlternative.replacingSuggestion(
                    RouteSuggestion(
                        id: firstAlternative.suggestion.id,
                        route: replacingDistance(
                            in: firstAlternative.suggestion.route,
                            with: 0
                        ),
                        explanation:
                            firstAlternative.suggestion.explanation
                    )
                )
            ]
        )
        let mismatchedResearchProvenance = replacingAlternatives(
            in: fixture.selection,
            with: [
                replacingResearchProvenance(
                    in: firstAlternative,
                    activity: .biking
                )
            ]
        )

        for selection in [
            empty,
            unverified,
            biking,
            pointToPoint,
            duplicateSuggestionIDs,
            eligibilityRejected,
            mismatchedResearchProvenance
        ] {
            let result = OutdoorAdventurePlanningCoordinatorResultV1.routed(
                OutdoorAdventurePlanningRoutedStateV1(
                    state: .routed,
                    normalizedIntent: fixture.intent,
                    planningGaps: [],
                    routeSelection: selection
                )
            )
            let router = ResearchLegacyRouter(
                suggestions: [
                    RouteSuggestion(
                        route: verifiedRoute(routeType: .loop),
                        explanation: "legacy"
                    )
                ]
            )
            let viewModel = makeViewModel(
                intent: fixture.localIntent,
                resolver: makeResolvedLocationResolver(),
                router: router,
                adapter: ResearchAdapterSpy(
                    result: fixture.adapterResult
                ),
                coordinator: ResearchCoordinatorSpy(result: result),
                featureAvailable: true
            )

            viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
            await viewModel.generate()

            guard case let .suggestionsReady(success) = viewModel.state else {
                return XCTFail("Invalid research output must fall back safely.")
            }
            XCTAssertEqual(router.intents.count, 1)
            XCTAssertEqual(success.suggestions.count, 1)
            XCTAssertTrue(
                success.suggestions.allSatisfy {
                    $0.route.isVerifiedRoutedResult
                }
            )
            XCTAssertEqual(
                success.researchContext?.outcome,
                .legacyFallback(.invalidResearchResult)
            )
            XCTAssertTrue(
                success.researchContext?
                    .alternativesBySuggestionID.isEmpty == true
            )
        }
    }

    func testRoutedResultForDifferentNormalizedIntentFallsBackExactlyOnce()
        async throws
    {
        let fixture = try makeResearchFixture()
        let mismatchedIntent = try replacingAnchor(
            in: fixture.intent,
            with: .resolved(
                name: "Schierke, Germany",
                coordinate: AdventureResearchCoordinateV1(
                    latitude: endCoordinate.latitude,
                    longitude: endCoordinate.longitude
                ),
                regionEntityID: nil
            )
        )
        let router = ResearchLegacyRouter(
            suggestions: [
                RouteSuggestion(
                    route: verifiedRoute(routeType: .loop),
                    explanation: "legacy"
                )
            ]
        )
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(result: fixture.adapterResult),
            coordinator: ResearchCoordinatorSpy(
                result: .routed(
                    OutdoorAdventurePlanningRoutedStateV1(
                        state: .routed,
                        normalizedIntent: mismatchedIntent,
                        planningGaps: [],
                        routeSelection: fixture.selection
                    )
                )
            ),
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("A result for another anchor must fail closed.")
        }
        XCTAssertEqual(router.intents.count, 1)
        XCTAssertEqual(
            success.researchContext?.outcome,
            .legacyFallback(.invalidResearchResult)
        )
    }

    func testRoutedResultAcceptsReviewedRegionEnrichmentForNilAnchorRegion()
        async throws
    {
        let fixture = try makeResearchFixture()
        guard case let .resolved(name, coordinate, regionEntityID) =
            fixture.intent.geographicAnchor
        else {
            return XCTFail("Fixture requires a resolved anchor.")
        }
        XCTAssertNil(regionEntityID)
        let reviewedHarzRegionID = try XCTUnwrap(
            UUID(
                uuidString:
                    "30000000-0000-4000-8000-000000000002"
            )
        )
        let enrichedIntent = try replacingAnchor(
            in: fixture.intent,
            with: .resolved(
                name: name,
                coordinate: coordinate,
                regionEntityID: reviewedHarzRegionID
            )
        )
        let router = ResearchLegacyRouter(
            suggestions: [
                RouteSuggestion(
                    route: verifiedRoute(routeType: .loop),
                    explanation: "legacy"
                )
            ]
        )
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(result: fixture.adapterResult),
            coordinator: ResearchCoordinatorSpy(
                result: .routed(
                    OutdoorAdventurePlanningRoutedStateV1(
                        state: .routed,
                        normalizedIntent: enrichedIntent,
                        planningGaps: [],
                        routeSelection: fixture.selection
                    )
                )
            ),
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("Reviewed region enrichment must remain bound.")
        }
        XCTAssertTrue(router.intents.isEmpty)
        XCTAssertEqual(success.researchContext?.outcome, .routed)
        XCTAssertEqual(
            success.suggestions.map(\.id),
            fixture.selection.alternatives.map(\.suggestion.id)
        )
    }

    func testRoutedResultRejectsUnreviewedOrSubstitutedRegionEnrichment()
        async throws
    {
        let fixture = try makeResearchFixture()
        guard case let .resolved(name, coordinate, _) =
            fixture.intent.geographicAnchor
        else {
            return XCTFail("Fixture requires a resolved anchor.")
        }
        let reviewedHarzRegionID = try XCTUnwrap(
            UUID(
                uuidString:
                    "30000000-0000-4000-8000-000000000002"
            )
        )
        let unreviewedRegionID = try XCTUnwrap(
            UUID(
                uuidString:
                    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            )
        )
        let reviewedInnsbruckRegionID = try XCTUnwrap(
            UUID(
                uuidString:
                    "30000000-0000-4000-8000-000000000001"
            )
        )
        let changedCoordinate = try AdventureResearchCoordinateV1(
            latitude: coordinate.latitude + 0.01,
            longitude: coordinate.longitude
        )
        let invalidAnchors: [AdventureResearchGeographicAnchorV1] = [
            .resolved(
                name: name,
                coordinate: coordinate,
                regionEntityID: unreviewedRegionID
            ),
            .resolved(
                name: name,
                coordinate: coordinate,
                regionEntityID: reviewedInnsbruckRegionID
            ),
            .resolved(
                name: "\(name) substituted",
                coordinate: coordinate,
                regionEntityID: reviewedHarzRegionID
            ),
            .resolved(
                name: name,
                coordinate: changedCoordinate,
                regionEntityID: reviewedHarzRegionID
            )
        ]
        for invalidAnchor in invalidAnchors {
            let mismatchedIntent = try replacingAnchor(
                in: fixture.intent,
                with: invalidAnchor
            )
            let router = ResearchLegacyRouter(
                suggestions: [
                    RouteSuggestion(
                        route: verifiedRoute(routeType: .loop),
                        explanation: "legacy"
                    )
                ]
            )
            let viewModel = makeViewModel(
                intent: fixture.localIntent,
                resolver: makeResolvedLocationResolver(),
                router: router,
                adapter: ResearchAdapterSpy(result: fixture.adapterResult),
                coordinator: ResearchCoordinatorSpy(
                    result: .routed(
                        OutdoorAdventurePlanningRoutedStateV1(
                            state: .routed,
                            normalizedIntent: mismatchedIntent,
                            planningGaps: [],
                            routeSelection: fixture.selection
                        )
                    )
                ),
                featureAvailable: true
            )

            viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
            await viewModel.generate()

            guard case let .suggestionsReady(success) = viewModel.state else {
                return XCTFail("Substituted enrichment must fail closed.")
            }
            XCTAssertEqual(router.intents.count, 1)
            XCTAssertEqual(
                success.researchContext?.outcome,
                .legacyFallback(.invalidResearchResult)
            )
        }

        let boundSubmittedIntent = try replacingAnchor(
            in: fixture.intent,
            with: .resolved(
                name: name,
                coordinate: coordinate,
                regionEntityID: reviewedHarzRegionID
            )
        )
        let substitutedReturnedIntent = try replacingAnchor(
            in: boundSubmittedIntent,
            with: .resolved(
                name: name,
                coordinate: coordinate,
                regionEntityID: reviewedInnsbruckRegionID
            )
        )
        let boundAdapterResult =
            AdventureResearchIntentAdapterResultV1.ready(
                intent: boundSubmittedIntent,
                gaps: fixture.adapterResult.gaps
            )
        let boundRouter = ResearchLegacyRouter(
            suggestions: [
                RouteSuggestion(
                    route: verifiedRoute(routeType: .loop),
                    explanation: "legacy"
                )
            ]
        )
        let boundViewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: boundRouter,
            adapter: ResearchAdapterSpy(result: boundAdapterResult),
            coordinator: ResearchCoordinatorSpy(
                result: .routed(
                    OutdoorAdventurePlanningRoutedStateV1(
                        state: .routed,
                        normalizedIntent: substitutedReturnedIntent,
                        planningGaps: [],
                        routeSelection: fixture.selection
                    )
                )
            ),
            featureAvailable: true
        )

        boundViewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        await boundViewModel.generate()

        guard case let .suggestionsReady(boundSuccess) =
            boundViewModel.state
        else {
            return XCTFail("A bound region identifier cannot be replaced.")
        }
        XCTAssertEqual(boundRouter.intents.count, 1)
        XCTAssertEqual(
            boundSuccess.researchContext?.outcome,
            .legacyFallback(.invalidResearchResult)
        )
    }

    func testPartialRejectsIncoherentSelectionStatePairs()
        async throws
    {
        let fixture = try makeResearchFixture()
        let planningGap = OutdoorAdventurePlanningGapV1(
            code: .scenicQualityNotVerifiable,
            affectedField: .preferredExperiences,
            affectedValue: "viewpoint",
            reason: .contractDimensionMissing,
            requiresClarification: false,
            requiresCapability: true
        )
        let statePairs: [
            (
                ResearchGuidedRoutedEnvelopeStateV1,
                ResearchGuidedRoutedEnvelopeStateV1
            )
        ] = [
            (.routed, .partial),
            (.partial, .routed)
        ]

        for (selectionState, sourceState) in statePairs {
            let malformedSelection = ResearchGuidedRouteSelectionV1(
                state: selectionState,
                sourceEnvelopeState: sourceState,
                alternatives: fixture.selection.alternatives,
                rejectionCounts: fixture.selection.rejectionCounts,
                remainingLimitations:
                    fixture.selection.remainingLimitations
            )
            let router = ResearchLegacyRouter(
                suggestions: [
                    RouteSuggestion(
                        route: verifiedRoute(routeType: .loop),
                        explanation: "legacy"
                    )
                ]
            )
            let viewModel = makeViewModel(
                intent: fixture.localIntent,
                resolver: makeResolvedLocationResolver(),
                router: router,
                adapter: ResearchAdapterSpy(
                    result: fixture.adapterResult
                ),
                coordinator: ResearchCoordinatorSpy(
                    result: .partial(
                        OutdoorAdventurePlanningRoutedStateV1(
                            state: .partial,
                            normalizedIntent: fixture.intent,
                            planningGaps: [planningGap],
                            routeSelection: malformedSelection
                        )
                    )
                ),
                featureAvailable: true
            )

            viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
            await viewModel.generate()

            guard case let .suggestionsReady(success) = viewModel.state else {
                return XCTFail("Malformed partial state must fail closed.")
            }
            XCTAssertEqual(router.intents.count, 1)
            XCTAssertEqual(
                success.researchContext?.outcome,
                .legacyFallback(.invalidResearchResult)
            )
        }
    }

    func testPartialAcceptsCoherentPartialSelectionWithoutPlanningGap()
        async throws
    {
        let fixture = try makeResearchFixture()
        let partialSelection = ResearchGuidedRouteSelectionV1(
            state: .partial,
            sourceEnvelopeState: .partial,
            alternatives: fixture.selection.alternatives,
            rejectionCounts: fixture.selection.rejectionCounts,
            remainingLimitations:
                fixture.selection.remainingLimitations
        )
        let router = ResearchLegacyRouter(outcomes: [])
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(result: fixture.adapterResult),
            coordinator: ResearchCoordinatorSpy(
                result: .partial(
                    OutdoorAdventurePlanningRoutedStateV1(
                        state: .partial,
                        normalizedIntent: fixture.intent,
                        planningGaps: [],
                        routeSelection: partialSelection
                    )
                )
            ),
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        await viewModel.generate()

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("A coherent partial source must remain usable.")
        }
        XCTAssertEqual(router.intents.count, 0)
        XCTAssertEqual(success.researchContext?.outcome, .partial)
        XCTAssertEqual(success.researchContext?.selectionState, .partial)
        XCTAssertEqual(
            success.researchContext?.sourceEnvelopeState,
            .partial
        )
    }

    func testCancellationAbandonsResearchAndLateCompletionCannotOverwriteIt()
        async throws
    {
        let fixture = try makeResearchFixture()
        let coordinator = ResearchControlledCoordinator()
        let completionRecorder =
            ResearchOperationCompletionRecorder()
        let router = ResearchLegacyRouter(outcomes: [])
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: makeResolvedLocationResolver(),
            router: router,
            adapter: ResearchAdapterSpy(result: fixture.adapterResult),
            coordinator: coordinator,
            featureAvailable: true,
            completionRecorder: completionRecorder
        )
        let routed = OutdoorAdventurePlanningCoordinatorResultV1.routed(
            OutdoorAdventurePlanningRoutedStateV1(
                state: .routed,
                normalizedIntent: fixture.intent,
                planningGaps: [],
                routeSelection: fixture.selection
            )
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        let planningTask = try XCTUnwrap(
            viewModel.stagingProofPlanningTaskForQuiescence()
        )
        guard await waitUntil(
            "research request",
            condition: {
                coordinator.capturedIntents().count == 1
            }
        ) else { return }
        viewModel.cancelGeneration()
        coordinator.succeed(requestIndex: 0, with: routed)
        await planningTask.value

        guard case .cancelled = viewModel.state else {
            return XCTFail("A late research result must not replace cancellation.")
        }
        XCTAssertEqual(completionRecorder.requestIDs.count, 1)
        XCTAssertTrue(viewModel.suggestions.isEmpty)
        XCTAssertEqual(router.intents.count, 0)
    }

    func testOlderResearchResultCannotOverwriteNewerPrompt() async throws {
        let firstPrompt = "first research loop"
        let secondPrompt = "second research loop"
        let firstIntent = makeIntent(
            prompt: firstPrompt,
            routeType: .loop,
            end: nil
        )
        let secondIntent = makeIntent(
            prompt: secondPrompt,
            routeType: .loop,
            end: nil
        )
        let candidate = locationCandidate(
            id: "stable-anchor",
            displayName: "Ilsenburg, Germany",
            coordinate: startCoordinate
        )
        let firstAdapter = try XCTUnwrap(
            productionAdapterResult(
                for: firstIntent,
                candidate: candidate
            )
        )
        let secondAdapter = try XCTUnwrap(
            productionAdapterResult(
                for: secondIntent,
                candidate: candidate
            )
        )
        let firstResearchIntent = try XCTUnwrap(firstAdapter.intent)
        let secondResearchIntent = try XCTUnwrap(secondAdapter.intent)
        let selection = try routedSelection()
        let coordinator = ResearchControlledCoordinator()
        let completionRecorder =
            ResearchOperationCompletionRecorder()
        let router = ResearchLegacyRouter(outcomes: [])
        let viewModel = PlannerViewModel(
            intentParsingProvider: ResearchScriptedIntentParser(
                intents: [firstIntent, secondIntent]
            ),
            locationResolver: ResearchLocationResolver(
                resolutions: ["Ilsenburg": .resolved(candidate)]
            ),
            routingCoordinator: router,
            researchIntentAdapter: ResearchAdapterSpy(
                results: [firstAdapter, secondAdapter]
            ),
            researchPlanningCoordinator: coordinator,
            researchFeatureAvailable: { true },
            researchOperationDidFinish: { requestID in
                completionRecorder.record(requestID)
            },
            outdoorEvidenceProvider: NoOpOutdoorRouteEvidenceProvider()
        )

        viewModel.startPlanning(prompt: firstPrompt)
        guard await waitUntil(
            "first research request",
            condition: {
                coordinator.capturedIntents().count == 1
            }
        ) else { return }
        viewModel.startPlanning(prompt: secondPrompt)
        guard await waitUntil(
            "second research request",
            condition: {
                coordinator.capturedIntents().count == 2
            }
        ) else { return }

        coordinator.succeed(
            requestIndex: 0,
            with: .routed(
                OutdoorAdventurePlanningRoutedStateV1(
                    state: .routed,
                    normalizedIntent: firstResearchIntent,
                    planningGaps: [],
                    routeSelection: selection
                )
            )
        )
        guard await waitUntil(
            "older research completion",
            condition: {
                completionRecorder.requestIDs.count == 1
            }
        ) else { return }
        guard case let .generatingRoutes(resolved) = viewModel.state else {
            return XCTFail("Old completion must leave the new attempt active.")
        }
        XCTAssertEqual(resolved.prepared.originalPrompt, secondPrompt)

        coordinator.succeed(
            requestIndex: 1,
            with: .routed(
                OutdoorAdventurePlanningRoutedStateV1(
                    state: .routed,
                    normalizedIntent: secondResearchIntent,
                    planningGaps: [],
                    routeSelection: selection
                )
            )
        )
        await viewModel.generate()
        XCTAssertEqual(completionRecorder.requestIDs.count, 2)

        guard case let .suggestionsReady(success) = viewModel.state else {
            return XCTFail("The newest research attempt must complete.")
        }
        XCTAssertEqual(success.originalPrompt, secondPrompt)
        XCTAssertEqual(router.intents.count, 0)
    }

    func testRetryReusesSelectedLocationAcrossResearchAndLegacyFailures()
        async throws
    {
        let fixture = try makeResearchFixture()
        let candidate = locationCandidate(
            id: "selected-once",
            displayName: "Ilsenburg, Germany",
            coordinate: startCoordinate
        )
        let resolver = ResearchLocationResolver(
            resolutions: ["Ilsenburg": .resolved(candidate)]
        )
        let adapter = ResearchAdapterSpy(
            results: [fixture.adapterResult, fixture.adapterResult]
        )
        let coordinator = ResearchCoordinatorSpy(
            outcomes: [
                .failure(
                    OutdoorAdventurePlanningCoordinatorFailureV1.unavailable
                ),
                .failure(
                    OutdoorAdventurePlanningCoordinatorFailureV1.unavailable
                )
            ]
        )
        let router = ResearchLegacyRouter(
            outcomes: [
                .failure(GraphHopperError.noRouteFound),
                .result(
                    RoutingResult(
                        suggestions: [
                            RouteSuggestion(
                                route: verifiedRoute(routeType: .loop),
                                explanation: "legacy"
                            )
                        ],
                        notice: nil
                    )
                )
            ]
        )
        let viewModel = makeViewModel(
            intent: fixture.localIntent,
            resolver: resolver,
            router: router,
            adapter: adapter,
            coordinator: coordinator,
            featureAvailable: true
        )

        viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
        await viewModel.generate()
        guard case .noRoutes = viewModel.state else {
            return XCTFail("First fallback route failure must remain retryable.")
        }

        viewModel.retryGeneration()
        await viewModel.generate()

        guard case .suggestionsReady = viewModel.state else {
            return XCTFail("Second bounded fallback must succeed.")
        }
        XCTAssertEqual(resolver.contexts.count, 1)
        XCTAssertEqual(adapter.capturedInputs().count, 2)
        XCTAssertEqual(
            adapter.capturedInputs().map(\.resolvedStart),
            [candidate, candidate]
        )
        XCTAssertEqual(coordinator.capturedIntents().count, 2)
        XCTAssertEqual(router.intents.count, 2)
    }

    func testEditAndResetEachInvalidateLateResearchCompletion()
        async throws
    {
        let fixture = try makeResearchFixture()
        let routed = OutdoorAdventurePlanningCoordinatorResultV1.routed(
            OutdoorAdventurePlanningRoutedStateV1(
                state: .routed,
                normalizedIntent: fixture.intent,
                planningGaps: [],
                routeSelection: fixture.selection
            )
        )

        for action in ["edit", "reset"] {
            let coordinator = ResearchControlledCoordinator()
            let completionRecorder =
                ResearchOperationCompletionRecorder()
            let router = ResearchLegacyRouter(outcomes: [])
            let viewModel = makeViewModel(
                intent: fixture.localIntent,
                resolver: makeResolvedLocationResolver(),
                router: router,
                adapter: ResearchAdapterSpy(
                    result: fixture.adapterResult
                ),
                coordinator: coordinator,
                featureAvailable: true,
                completionRecorder: completionRecorder
            )

            viewModel.startPlanning(prompt: fixture.localIntent.rawPrompt)
            guard await waitUntil(
                "\(action) research request",
                condition: {
                    coordinator.capturedIntents().count == 1
                }
            ) else { return }
            if action == "edit" {
                viewModel.editRequest()
            } else {
                viewModel.reset()
            }
            coordinator.succeed(requestIndex: 0, with: routed)
            guard await waitUntil(
                "\(action) research completion",
                condition: {
                    completionRecorder.requestIDs.count == 1
                }
            ) else { return }

            if action == "edit" {
                guard case .editing = viewModel.state else {
                    return XCTFail("Edit must remain terminal for the old attempt.")
                }
            } else {
                guard case .idle = viewModel.state else {
                    return XCTFail("Reset must remain terminal for the old attempt.")
                }
            }
            XCTAssertEqual(router.intents.count, 0)
            XCTAssertTrue(viewModel.suggestions.isEmpty)
        }
    }
}

private extension PlannerViewModelResearchGuidedPlanningTests {
    struct ResearchFixture {
        let localIntent: AdventureIntent
        let adapterResult: AdventureResearchIntentAdapterResultV1
        let intent: AdventureResearchIntentV1
        let selection: ResearchGuidedRouteSelectionV1
    }

    func makeViewModel(
        intent: AdventureIntent,
        resolver: any LocationResolving,
        router: any RoutingCoordinating,
        adapter: any AdventureResearchIntentAdaptingV1,
        coordinator: any OutdoorAdventurePlanningCoordinatingV1,
        featureAvailable: Bool,
        completionRecorder:
            ResearchOperationCompletionRecorder? = nil,
        operationTimeouts: PlannerViewModel.OperationTimeouts = .init(
            parserSeconds: 2,
            geocodingSeconds: 2,
            routingSeconds: 2
        )
    ) -> PlannerViewModel {
        PlannerViewModel(
            intentParsingProvider: ResearchFixedIntentParser(
                intent: intent
            ),
            locationResolver: resolver,
            routingCoordinator: router,
            researchIntentAdapter: adapter,
            researchPlanningCoordinator: coordinator,
            researchFeatureAvailable: { featureAvailable },
            researchOperationDidFinish: { requestID in
                completionRecorder?.record(requestID)
            },
            outdoorEvidenceProvider: NoOpOutdoorRouteEvidenceProvider(),
            operationTimeouts: operationTimeouts
        )
    }

    func makeIntent(
        prompt: String,
        activity: ActivityType = .hiking,
        routeType: TrailRouteType,
        start: String? = "Ilsenburg",
        end: String? = nil,
        desired: [DesiredFeature] = [],
        mustHave:
            [MustHaveResearchExperienceConstraint] = []
    ) -> AdventureIntent {
        AdventureIntent(
            rawPrompt: prompt,
            parserSource: .localRuleBased,
            confidence: 0.91,
            activityType: activity,
            routeType: routeType,
            startLocationQuery: start,
            endLocationQuery: end,
            regionQuery: nil,
            targetDistanceKm: routeType == .loop ? 15 : nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: desired,
            avoidFeatures: [],
            mustHaveResearchExperiences: mustHave,
            transportMode: nil
        )
    }

    func makeResolvedLocationResolver() -> ResearchLocationResolver {
        ResearchLocationResolver(
            resolutions: [
                "Ilsenburg": .resolved(
                    locationCandidate(
                        id: "start-id",
                        displayName: "Ilsenburg, Germany",
                        coordinate: startCoordinate
                    )
                ),
                "Schierke": .resolved(
                    locationCandidate(
                        id: "end-id",
                        displayName: "Schierke, Germany",
                        coordinate: endCoordinate
                    )
                )
            ]
        )
    }

    func locationCandidate(
        id: String,
        displayName: String,
        coordinate: Coordinate,
        kind: LocationSemanticKind = .settlement,
        providerRank: Int = 0
    ) -> LocationCandidate {
        LocationCandidate(
            id: id,
            name: displayName,
            displayName: displayName,
            coordinate: coordinate,
            semanticKind: kind,
            countryCode: "DE",
            provider: .appleGeocoder,
            providerRank: providerRank
        )
    }

    func verifiedRoute(
        activity: ActivityType = .hiking,
        routeType: TrailRouteType
    ) -> TrailRoute {
        let base = TestRouteFixtures.luneburgLoop
        let difficulty = RouteDifficulty.estimated(
            distanceKilometers: base.distanceKilometers,
            elevationGainMeters: base.elevationGainMeters
        )
        let provenance = RouteProvenance.routingEngineOutput(
            provider: .graphHopper,
            strategy: .backend,
            activity: activity,
            routeType: routeType,
            distanceKilometers: base.distanceKilometers,
            elevationGainMeters: base.elevationGainMeters,
            elevationLossMeters: base.elevationLossMeters,
            durationHours: base.durationHours,
            difficulty: difficulty,
            path: base.path,
            verifiedCharacteristics: base.verifiedCharacteristics
        )
        return TrailRoute(
            id: UUID(),
            provenance: provenance,
            title: base.title,
            location: base.location,
            activity: activity,
            distanceKilometers: base.distanceKilometers,
            elevationGainMeters: base.elevationGainMeters,
            elevationLossMeters: base.elevationLossMeters,
            durationHours: base.durationHours,
            difficulty: difficulty,
            routeType: routeType,
            summary: base.summary,
            whyItMatches: base.whyItMatches,
            highlights: base.highlights,
            waypoints: base.waypoints,
            days: base.days,
            safetyNotes: base.safetyNotes,
            elevationProfile: base.elevationProfile,
            path: base.path,
            routeInstructions: base.routeInstructions,
            planningMetadata: nil,
            intentDebugMetadata: nil,
            verifiedCharacteristics: base.verifiedCharacteristics
        )
    }

    func expectedPreparedLegacySuggestion(
        _ suggestion: RouteSuggestion,
        for intent: AdventureIntent,
        endLabel: String? = nil
    ) -> RouteSuggestion {
        let validatedIntent = ValidatedAdventureIntent(intent: intent)
        let request = RoutePlanningRequest(
            validatedIntent: validatedIntent
        )
        let debugMetadata = RouteIntentDebugMetadata(
            intent: validatedIntent,
            validationStatus: IntentValidationStatus.valid.rawValue,
            parserDebugInfo: nil,
            repaired: false,
            repairReason: nil,
            missingFields: [],
            clarificationQuestion: nil,
            geocodedStartLabel: "Ilsenburg, Germany",
            geocodedEndLabel: endLabel,
            loopSearchOutcome: nil,
            loopSearchDiagnostics: nil
        )
        let baseMetadata =
            suggestion.route.planningMetadata ?? request.metadata
        let planningMetadata = request.routeType == .loop
            ? baseMetadata.withLoopSearchOutcome(nil)
            : baseMetadata
        return RouteSuggestion(
            id: suggestion.id,
            route: suggestion.route
                .withPlanningMetadata(planningMetadata)
                .withIntentDebugMetadata(debugMetadata),
            explanation: suggestion.explanation,
            debugMetadata: suggestion.debugMetadata
        )
    }

    func productionAdapterResult(
        for intent: AdventureIntent,
        candidate: LocationCandidate
    ) -> AdventureResearchIntentAdapterResultV1? {
        let result = AdventureResearchIntentAdapterV1().adapt(
            AdventureResearchIntentAdapterInputV1(
                validatedIntent: ValidatedAdventureIntent(intent: intent),
                resolvedStart: candidate
            )
        )
        guard case .ready = result else { return nil }
        return result
    }

    func makeResearchFixture() throws -> ResearchFixture {
        let localIntent = makeIntent(
            prompt: "15 km loop from Ilsenburg with views",
            routeType: .loop,
            end: nil,
            desired: [.viewpoint]
        )
        let adapterResult = try XCTUnwrap(
            productionAdapterResult(
                for: localIntent,
                candidate: locationCandidate(
                    id: "fixture-start",
                    displayName: "Ilsenburg, Germany",
                    coordinate: startCoordinate
                )
            )
        )
        return ResearchFixture(
            localIntent: localIntent,
            adapterResult: adapterResult,
            intent: try XCTUnwrap(adapterResult.intent),
            selection: try routedSelection()
        )
    }

    func routedSelection() throws -> ResearchGuidedRouteSelectionV1 {
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent(
                "research_guided_routed_alternatives_v1.json"
            )
        let fixtureData = try Data(contentsOf: fixtureURL)
        let root = try XCTUnwrap(
            JSONSerialization.jsonObject(with: fixtureData)
                as? [String: Any]
        )
        let envelopes = try XCTUnwrap(
            root["envelopes"] as? [String: Any]
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

    func replacingQuestions(
        in intent: AdventureResearchIntentV1,
        with questions: [AdventureResearchClarificationQuestionV1]
    ) throws -> AdventureResearchIntentV1 {
        try AdventureResearchIntentV1(
            activity: intent.activity,
            geographicAnchor: intent.geographicAnchor,
            routeType: intent.routeType,
            distanceRangeKm: intent.distanceRangeKm,
            durationRangeMinutes: intent.durationRangeMinutes,
            maximumElevationGainMeters:
                intent.maximumElevationGainMeters,
            maximumTechnicalDifficulty:
                intent.maximumTechnicalDifficulty,
            mustHaveExperiences: intent.mustHaveExperiences,
            preferredExperiences: intent.preferredExperiences,
            avoidedExperiences: intent.avoidedExperiences,
            requiredFacilities: intent.requiredFacilities,
            groupContext: intent.groupContext,
            dateOrSeason: intent.dateOrSeason,
            overnightRequirements: intent.overnightRequirements,
            transportRequirements: intent.transportRequirements,
            unresolvedClarificationQuestions: questions
        )
    }

    func replacingAnchor(
        in intent: AdventureResearchIntentV1,
        with anchor: AdventureResearchGeographicAnchorV1
    ) throws -> AdventureResearchIntentV1 {
        try AdventureResearchIntentV1(
            activity: intent.activity,
            geographicAnchor: anchor,
            routeType: intent.routeType,
            distanceRangeKm: intent.distanceRangeKm,
            durationRangeMinutes: intent.durationRangeMinutes,
            maximumElevationGainMeters:
                intent.maximumElevationGainMeters,
            maximumTechnicalDifficulty:
                intent.maximumTechnicalDifficulty,
            mustHaveExperiences: intent.mustHaveExperiences,
            preferredExperiences: intent.preferredExperiences,
            avoidedExperiences: intent.avoidedExperiences,
            requiredFacilities: intent.requiredFacilities,
            groupContext: intent.groupContext,
            dateOrSeason: intent.dateOrSeason,
            overnightRequirements: intent.overnightRequirements,
            transportRequirements: intent.transportRequirements,
            unresolvedClarificationQuestions:
                intent.unresolvedClarificationQuestions
        )
    }

    func replacingActivity(
        in intent: AdventureResearchIntentV1,
        with activity: AdventureResearchActivityV1
    ) throws -> AdventureResearchIntentV1 {
        try AdventureResearchIntentV1(
            activity: activity,
            geographicAnchor: intent.geographicAnchor,
            routeType: intent.routeType,
            distanceRangeKm: intent.distanceRangeKm,
            durationRangeMinutes: intent.durationRangeMinutes,
            maximumElevationGainMeters:
                intent.maximumElevationGainMeters,
            maximumTechnicalDifficulty:
                intent.maximumTechnicalDifficulty,
            mustHaveExperiences: intent.mustHaveExperiences,
            preferredExperiences: intent.preferredExperiences,
            avoidedExperiences: intent.avoidedExperiences,
            requiredFacilities: intent.requiredFacilities,
            groupContext: intent.groupContext,
            dateOrSeason: intent.dateOrSeason,
            overnightRequirements: intent.overnightRequirements,
            transportRequirements: intent.transportRequirements,
            unresolvedClarificationQuestions:
                intent.unresolvedClarificationQuestions
        )
    }

    func replacingAlternatives(
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

    func replacingResearchProvenance(
        in alternative: ResearchGuidedRouteAlternativeV1,
        activity: ActivityType
    ) -> ResearchGuidedRouteAlternativeV1 {
        let provenance = alternative.researchProvenance
        return ResearchGuidedRouteAlternativeV1(
            attemptID: alternative.attemptID,
            routeResultID: alternative.routeResultID,
            suggestion: alternative.suggestion,
            researchProvenance: ResearchRouteProvenanceV1(
                proposalID: provenance.proposalID,
                lineageID: provenance.lineageID,
                strategy: provenance.strategy,
                activity: activity,
                routeType: provenance.routeType,
                selectedWaypoints: provenance.selectedWaypoints,
                mappedNetworkCandidates:
                    provenance.mappedNetworkCandidates,
                evidenceClaimIDs: provenance.evidenceClaimIDs,
                requiredVerification:
                    provenance.requiredVerification,
                knownLimitations: provenance.knownLimitations,
                sourceCandidatePlanPolicyVersion:
                    provenance.sourceCandidatePlanPolicyVersion
            ),
            waypointVisits: alternative.waypointVisits
        )
    }

    func replacingDistance(
        in route: TrailRoute,
        with distanceKilometers: Double
    ) -> TrailRoute {
        TrailRoute(
            id: route.id,
            provenance: route.provenance,
            title: route.title,
            location: route.location,
            activity: route.activity,
            distanceKilometers: distanceKilometers,
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

    func replacingProvenance(
        in route: TrailRoute,
        with provenance: RouteProvenance
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

    func waitUntil(
        _ description: String,
        iterations: Int = 2_000,
        condition: @escaping @MainActor () -> Bool
    ) async -> Bool {
        for _ in 0..<iterations {
            if condition() { return true }
            await Task.yield()
        }
        XCTFail("Timed out waiting for \(description)")
        return false
    }

}
