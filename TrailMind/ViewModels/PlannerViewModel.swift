import CoreLocation
import Foundation
import Observation

@MainActor
@Observable
final class PlannerViewModel {
    enum GenerationStage: Int, CaseIterable, Identifiable, Sendable {
        case understanding
        case locations
        case routing
        case preparation

        var id: Self { self }
    }

    enum GenerationStageStatus: Equatable, Sendable {
        case pending
        case active
        case completed
        case failed
    }

    struct GenerationStageState: Identifiable, Equatable, Sendable {
        let stage: GenerationStage
        let title: String
        let status: GenerationStageStatus

        var id: GenerationStage { stage }
    }

    struct GenerationFailure: Equatable, Sendable {
        let stage: GenerationStage
        let message: String
    }

    struct OperationTimeouts: Equatable, Sendable {
        static let production = OperationTimeouts(
            parserSeconds: 22,
            geocodingSeconds: 15,
            routingSeconds: 45
        )

        let parserSeconds: TimeInterval
        let geocodingSeconds: TimeInterval
        let routingSeconds: TimeInterval

        init(
            parserSeconds: TimeInterval,
            geocodingSeconds: TimeInterval,
            routingSeconds: TimeInterval = 45
        ) {
            self.parserSeconds = parserSeconds
            self.geocodingSeconds = geocodingSeconds
            self.routingSeconds = routingSeconds
        }
    }

    enum Phase: Equatable {
        case home
        case generating
        case clarification
        case recovery
        case suggestions
    }

    enum RecoveryKind: Equatable, Sendable {
        case invalidPrompt
        case malformedIntent
        case intentUnavailable
        case geocoding
        case routing
        case timedOut
        case unverified
        case unexpected
    }

    enum ClarificationKind: Equatable, Sendable {
        case location(IntentMissingField)
        case routeType
    }

    enum ClarificationAnswer: Equatable, Sendable {
        case text(String)
        case locationCandidate(LocationCandidate)
        case routeType(TrailRouteType)
    }

    struct PlanningAttempt: Equatable, Sendable {
        let id: UUID
        let originalPrompt: String
    }

    struct ValidationSnapshot: Equatable, Sendable {
        let status: IntentValidationStatus
        let repaired: Bool
        let repairReason: String?
        let missingFields: [IntentMissingField]
        let clarificationReason: String?
        let clarificationQuestion: String?

        init(_ result: IntentValidationResult) {
            status = result.status
            repaired = result.repaired
            repairReason = result.repairReason
            missingFields = result.missingFields
            clarificationReason = result.clarificationReason
            clarificationQuestion = result.clarificationQuestion
        }
    }

    struct PreparedAttempt: Equatable, Sendable {
        let id: UUID
        let originalPrompt: String
        let intent: AdventureIntent
        let validatedIntent: ValidatedAdventureIntent
        let validation: ValidationSnapshot
        let parserDebugInfo: IntentParserDebugInfo?
        let selectedLocations: [IntentMissingField: LocationCandidate]

        init(
            id: UUID,
            originalPrompt: String,
            intent: AdventureIntent,
            validatedIntent: ValidatedAdventureIntent,
            validation: ValidationSnapshot,
            parserDebugInfo: IntentParserDebugInfo?,
            selectedLocations: [IntentMissingField: LocationCandidate] = [:]
        ) {
            self.id = id
            self.originalPrompt = originalPrompt
            self.intent = intent
            self.validatedIntent = validatedIntent
            self.validation = validation
            self.parserDebugInfo = parserDebugInfo
            self.selectedLocations = selectedLocations
        }

        func withID(_ id: UUID) -> PreparedAttempt {
            PreparedAttempt(
                id: id,
                originalPrompt: originalPrompt,
                intent: intent,
                validatedIntent: validatedIntent,
                validation: validation,
                parserDebugInfo: parserDebugInfo,
                selectedLocations: selectedLocations
            )
        }

        func selecting(
            _ candidate: LocationCandidate,
            for field: IntentMissingField,
            id: UUID
        ) -> PreparedAttempt {
            var selections = selectedLocations
            selections[field] = candidate
            return PreparedAttempt(
                id: id,
                originalPrompt: originalPrompt,
                intent: intent,
                validatedIntent: validatedIntent,
                validation: validation,
                parserDebugInfo: parserDebugInfo,
                selectedLocations: selections
            )
        }
    }

    struct ResolvedAttempt: Equatable, Sendable {
        let prepared: PreparedAttempt
        let request: RoutePlanningRequest
        let start: Coordinate
        let end: Coordinate?
    }

    struct PendingClarification: Equatable, Sendable {
        let id: UUID
        let originalPrompt: String
        let intent: AdventureIntent
        let validation: ValidationSnapshot
        let parserDebugInfo: IntentParserDebugInfo?
        let question: String
        let kind: ClarificationKind
        let supportingText: String?
        let locationCandidates: [LocationCandidate]
        let allowsFreeText: Bool
        let preparedAttempt: PreparedAttempt?
        let researchClarificationContext: ResearchClarificationContext?

        init(
            id: UUID,
            originalPrompt: String,
            intent: AdventureIntent,
            validation: ValidationSnapshot,
            parserDebugInfo: IntentParserDebugInfo?,
            question: String,
            kind: ClarificationKind,
            supportingText: String?,
            locationCandidates: [LocationCandidate],
            allowsFreeText: Bool,
            preparedAttempt: PreparedAttempt?,
            researchClarificationContext: ResearchClarificationContext? = nil
        ) {
            self.id = id
            self.originalPrompt = originalPrompt
            self.intent = intent
            self.validation = validation
            self.parserDebugInfo = parserDebugInfo
            self.question = question
            self.kind = kind
            self.supportingText = supportingText
            self.locationCandidates = locationCandidates
            self.allowsFreeText = allowsFreeText
            self.preparedAttempt = preparedAttempt
            self.researchClarificationContext =
                researchClarificationContext
        }
    }

    struct ResearchClarificationContext: Equatable, Sendable {
        enum Origin: Equatable, Sendable {
            case adapter
            case coordinator
        }

        static let maximumQuestionCount = 16

        let origin: Origin
        let adapterGaps: [AdventureResearchIntentAdapterGapV1]
        let backendPlanningGaps: [OutdoorAdventurePlanningGapV1]
        let questions: [AdventureResearchClarificationQuestionV1]

        init?(
            origin: Origin,
            adapterGaps: [AdventureResearchIntentAdapterGapV1],
            backendPlanningGaps: [OutdoorAdventurePlanningGapV1],
            questions: [AdventureResearchClarificationQuestionV1]
        ) {
            guard (1...Self.maximumQuestionCount).contains(questions.count)
            else { return nil }

            self.origin = origin
            self.adapterGaps = adapterGaps
            self.backendPlanningGaps = backendPlanningGaps
            self.questions = questions
        }
    }

    struct ResearchPlanningContext: Equatable, Sendable {
        enum LegacyFallbackReason: Equatable, Sendable {
            case adapterUnsupported
            case coordinatorUnsupported
            case noViableRoute
            case coordinatorFailure(
                OutdoorAdventurePlanningCoordinatorFailureV1
            )
            case invalidResearchResult
        }

        enum Outcome: Equatable, Sendable {
            case routed
            case partial
            case legacyFallback(LegacyFallbackReason)
        }

        struct AlternativeSidecar: Equatable, Sendable {
            let attemptID: String
            let routeResultID: String
            let researchProvenance: ResearchRouteProvenanceV1
            let waypointVisits: [ResearchWaypointVisitV1]
        }

        let outcome: Outcome
        let adapterGaps: [AdventureResearchIntentAdapterGapV1]
        let backendPlanningGaps: [OutdoorAdventurePlanningGapV1]
        let selectionState: ResearchGuidedRoutedEnvelopeStateV1?
        let sourceEnvelopeState: ResearchGuidedRoutedEnvelopeStateV1?
        let rejectionCounts: [String: Int]
        let remainingLimitations: [String]
        let alternativesBySuggestionID: [UUID: AlternativeSidecar]
    }

    struct PlanningSuccess: Equatable {
        let originalPrompt: String
        let suggestions: [RouteSuggestion]
        let notice: String?
        let researchContext: ResearchPlanningContext?
    }

    struct PlanningRecovery: Equatable, Sendable {
        let originalPrompt: String
        let message: String
        let stage: GenerationStage
        let kind: RecoveryKind
        let preparedAttempt: PreparedAttempt?
        let researchClarificationContext: ResearchClarificationContext?

        init(
            originalPrompt: String,
            message: String,
            stage: GenerationStage,
            kind: RecoveryKind,
            preparedAttempt: PreparedAttempt?,
            researchClarificationContext: ResearchClarificationContext? = nil
        ) {
            self.originalPrompt = originalPrompt
            self.message = message
            self.stage = stage
            self.kind = kind
            self.preparedAttempt = preparedAttempt
            self.researchClarificationContext =
                researchClarificationContext
        }
    }

    /// The only observable planning source of truth.
    /// idle/editing → understanding → clarification (when needed) → locations →
    /// routing → preparation → suggestions, with explicit no-route, error, and
    /// cancelled recovery states. Every asynchronous transition is attempt-scoped.
    enum State: Equatable {
        case idle(prompt: String)
        case editing(prompt: String)
        case understanding(PlanningAttempt)
        case awaitingClarification(PendingClarification)
        case resolvingLocations(PreparedAttempt)
        case generatingRoutes(ResolvedAttempt)
        case preparingSuggestions(ResolvedAttempt)
        case suggestionsReady(PlanningSuccess)
        case noRoutes(PlanningRecovery)
        case recoverableError(PlanningRecovery)
        case cancelled(PlanningRecovery)
    }

    private struct SendableRoutingResult: @unchecked Sendable {
        let value: RoutingResult
    }

    private struct SendableResearchPlanningResult: @unchecked Sendable {
        let value: OutdoorAdventurePlanningCoordinatorResultV1
    }

    private enum ResearchPathDecision {
        case useLegacy(
            context: ResearchPlanningContext?,
            notice: String?
        )
        case suggestions(
            [RouteSuggestion],
            notice: String?,
            context: ResearchPlanningContext
        )
        case handled
    }

    private enum PlannerIssue: Error, Sendable {
        case invalidIntent(String)
        case timedOut
        case unverifiedRoutes
        case unsupportedClarification
    }

    @MainActor
    private final class TimeoutRace<Value: Sendable> {
        private var continuation: CheckedContinuation<Value, Error>?
        private var operationTask: Task<Void, Never>?
        private var timeoutTask: Task<Void, Never>?
        private var terminalResult: Result<Value, Error>?

        func install(
            continuation: CheckedContinuation<Value, Error>,
            seconds: TimeInterval,
            operationDidFinish:
                @escaping @MainActor @Sendable () -> Void = {},
            operation: @escaping @MainActor @Sendable () async throws -> Value
        ) {
            if let terminalResult {
                continuation.resume(with: terminalResult)
                return
            }

            self.continuation = continuation
            operationTask = Task { @MainActor [weak self] in
                defer { operationDidFinish() }
                do {
                    let value = try await operation()
                    self?.resolve(.success(value))
                } catch {
                    self?.resolve(.failure(error))
                }
            }
            timeoutTask = Task.detached { [weak self] in
                do {
                    try await Task.sleep(for: .seconds(seconds))
                } catch {
                    return
                }
                await self?.resolve(.failure(PlannerIssue.timedOut))
            }
        }

        func cancel() {
            resolve(.failure(CancellationError()))
        }

        private func resolve(_ result: Result<Value, Error>) {
            guard terminalResult == nil else { return }
            terminalResult = result
            operationTask?.cancel()
            timeoutTask?.cancel()
            operationTask = nil
            timeoutTask = nil
            continuation?.resume(with: result)
            continuation = nil
        }
    }

    private let intentParsingProvider: any IntentParsingProvider
    private let intentValidationService: IntentValidationService
    private let locationResolver: any LocationResolving
    private let routingCoordinator: any RoutingCoordinating
    private let researchIntentAdapter: any AdventureResearchIntentAdaptingV1
    private let researchPlanningCoordinator:
        any OutdoorAdventurePlanningCoordinatingV1
    private let outdoorEvidenceProvider: any OutdoorRouteEvidenceProviding
    private let operationTimeouts: OperationTimeouts
    @ObservationIgnored private let researchFeatureAvailable:
        @MainActor @Sendable () -> Bool
    @ObservationIgnored private let researchOperationDidFinish:
        @MainActor @Sendable (UUID) -> Void
    @ObservationIgnored private let attemptIDProvider: @MainActor () -> UUID
    @ObservationIgnored private var activeRequestID: UUID?
    @ObservationIgnored private var planningTaskID: UUID?
    @ObservationIgnored private var planningTask: Task<Void, Never>?
    @ObservationIgnored private var outdoorEvidenceTask: Task<Void, Never>?
    @ObservationIgnored private(set) var outdoorEvidenceBySuggestionID: [
        UUID: OutdoorRouteEvidenceSnapshot
    ] = [:]

    private(set) var state: State = .idle(prompt: "")
#if DEBUG
    private(set) var generationDebugError: String?
#endif

    var phase: Phase {
        switch state {
        case .idle, .editing:
            .home
        case .understanding, .resolvingLocations, .generatingRoutes, .preparingSuggestions:
            .generating
        case .awaitingClarification:
            .clarification
        case .suggestionsReady:
            .suggestions
        case .noRoutes, .recoverableError, .cancelled:
            .recovery
        }
    }

    var prompt: String {
        switch state {
        case let .idle(prompt), let .editing(prompt):
            prompt
        case let .understanding(attempt):
            attempt.originalPrompt
        case let .awaitingClarification(clarification):
            clarification.originalPrompt
        case let .resolvingLocations(attempt):
            attempt.originalPrompt
        case let .generatingRoutes(attempt), let .preparingSuggestions(attempt):
            attempt.prepared.originalPrompt
        case let .suggestionsReady(success):
            success.originalPrompt
        case let .noRoutes(recovery), let .recoverableError(recovery), let .cancelled(recovery):
            recovery.originalPrompt
        }
    }

    var suggestions: [RouteSuggestion] {
        guard case let .suggestionsReady(success) = state else { return [] }
        return success.suggestions
    }

    var suggestionNotice: String? {
        guard case let .suggestionsReady(success) = state else { return nil }
        return success.notice
    }

    var researchPlanningContext: ResearchPlanningContext? {
        guard case let .suggestionsReady(success) = state else { return nil }
        return success.researchContext
    }

    var currentClarification: PendingClarification? {
        guard case let .awaitingClarification(clarification) = state else { return nil }
        return clarification
    }

    var currentRecovery: PlanningRecovery? {
        switch state {
        case let .noRoutes(recovery), let .recoverableError(recovery), let .cancelled(recovery):
            recovery
        default:
            nil
        }
    }

    var isEditing: Bool {
        if case .editing = state { return true }
        return false
    }

    var generationRequestID: UUID? { activeRequestID }

    var generationStages: [GenerationStageState] {
        let activeStage: GenerationStage?
        let failedStage: GenerationStage?
        switch state {
        case .understanding:
            activeStage = .understanding
            failedStage = nil
        case .resolvingLocations:
            activeStage = .locations
            failedStage = nil
        case .generatingRoutes:
            activeStage = .routing
            failedStage = nil
        case .preparingSuggestions:
            activeStage = .preparation
            failedStage = nil
        case let .recoverableError(recovery), let .noRoutes(recovery):
            activeStage = nil
            failedStage = recovery.stage
        default:
            activeStage = nil
            failedStage = nil
        }
        return Self.stageStates(active: activeStage, failed: failedStage)
    }

    var generationFailure: GenerationFailure? {
        guard case let .recoverableError(recovery) = state else { return nil }
        return GenerationFailure(stage: recovery.stage, message: recovery.message)
    }

    var errorMessage: String? {
        guard case let .recoverableError(recovery) = state else { return nil }
        return recovery.message
    }

    var generatedRoute: TrailRoute? { nil }

    var generationStep: Int {
        generationStages.firstIndex { $0.status == .active || $0.status == .failed }
            ?? max(generationStages.lastIndex(where: { $0.status == .completed }) ?? 0, 0)
    }

    var completedGenerationStageCount: Int {
        generationStages.count { $0.status == .completed }
    }

    var generationMessages: [String] {
        generationStages.map(\.title)
    }

    var generationFooter: String {
        "Searching with Apple geocoding · calculating a mapped route"
    }

    init(
        intentParsingProvider: any IntentParsingProvider = IntentParsingProviderFactory.makeDefaultProvider(),
        intentValidationService: IntentValidationService = IntentValidationService(),
        geocodingService: (any GeocodingService)? = nil,
        locationResolver: (any LocationResolving)? = nil,
        routingCoordinator: any RoutingCoordinating = RoutingCoordinator(),
        researchIntentAdapter: any AdventureResearchIntentAdaptingV1 =
            AdventureResearchIntentAdapterV1(),
        researchPlanningCoordinator:
            any OutdoorAdventurePlanningCoordinatingV1 =
                OutdoorAdventurePlanningCoordinatorV1(),
        researchFeatureAvailable:
            @escaping @MainActor @Sendable () -> Bool = {
                TrailMindBackendConfiguration
                    .researchGuidedPlanningEnabled()
            },
        researchOperationDidFinish:
            @escaping @MainActor @Sendable (UUID) -> Void = { _ in },
        outdoorEvidenceProvider: any OutdoorRouteEvidenceProviding = OutdoorRouteEvidenceProviderFactory.makeDefault(),
        operationTimeouts: OperationTimeouts = .production,
        attemptIDProvider: @escaping @MainActor () -> UUID = { UUID() }
    ) {
        self.intentParsingProvider = intentParsingProvider
        self.intentValidationService = intentValidationService
        if let locationResolver {
            self.locationResolver = locationResolver
        } else if let geocodingService {
            self.locationResolver = LegacyGeocodingLocationResolver(
                geocodingService: geocodingService
            )
        } else {
            self.locationResolver = LocationResolutionService(
                provider: NativeGeocodingService()
            )
        }
        self.routingCoordinator = routingCoordinator
        self.researchIntentAdapter = researchIntentAdapter
        self.researchPlanningCoordinator = researchPlanningCoordinator
        self.researchFeatureAvailable = researchFeatureAvailable
        self.researchOperationDidFinish =
            researchOperationDidFinish
        self.outdoorEvidenceProvider = outdoorEvidenceProvider
        self.operationTimeouts = operationTimeouts
        self.attemptIDProvider = attemptIDProvider
    }

    func startPlanning(prompt: String) {
        invalidateActiveRequest()
        let cleanPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanPrompt.isEmpty else {
            state = .recoverableError(
                PlanningRecovery(
                    originalPrompt: cleanPrompt,
                    message: "Describe where you want to go and what kind of route you want.",
                    stage: .understanding,
                    kind: .invalidPrompt,
                    preparedAttempt: nil
                )
            )
            return
        }
        beginUnderstanding(prompt: cleanPrompt)
    }

    func startTextRoute(prompt: String) {
        startPlanning(prompt: prompt)
    }

    func answerClarification(_ answer: ClarificationAnswer) {
        guard case let .awaitingClarification(pending) = state else { return }
        invalidateActiveRequest()
        let requestID = attemptIDProvider()

        do {
            if let preparedAttempt = pending.preparedAttempt,
               case let .location(field) = pending.kind {
                try resumeLocationClarification(
                    answer,
                    pending: pending,
                    preparedAttempt: preparedAttempt,
                    field: field,
                    requestID: requestID
                )
                return
            }
            let mergedIntent = try Self.merge(answer, into: pending.intent, for: pending.kind)
            let validationResult = intentValidationService.validateResult(mergedIntent)
            try continueAfterValidation(
                validationResult,
                parsedIntent: mergedIntent,
                parserDebugInfo: pending.parserDebugInfo,
                requestID: requestID,
                originalPrompt: pending.originalPrompt
            )
        } catch {
            transitionToFailure(
                error,
                requestID: nil,
                originalPrompt: pending.originalPrompt,
                stage: .understanding,
                preparedAttempt: nil
            )
        }
    }

    func submitClarification(_ answer: ClarificationAnswer) {
        answerClarification(answer)
    }

    func retryGeneration() {
        guard let recovery = currentRecovery else { return }
        invalidateActiveRequest()
        if let preparedAttempt = recovery.preparedAttempt {
            let freshAttempt = preparedAttempt.withID(attemptIDProvider())
            state = .resolvingLocations(freshAttempt)
            launchAttempt(id: freshAttempt.id)
        } else {
            beginUnderstanding(prompt: recovery.originalPrompt)
        }
    }

    func editRequest() {
        let retainedPrompt = prompt
        invalidateActiveRequest()
        state = .editing(prompt: retainedPrompt)
    }

    func cancelGeneration() {
        let recovery: PlanningRecovery
        switch state {
        case let .understanding(attempt):
            recovery = cancelledRecovery(prompt: attempt.originalPrompt, stage: .understanding, prepared: nil)
        case let .awaitingClarification(pending):
            recovery = cancelledRecovery(
                prompt: pending.originalPrompt,
                stage: pending.preparedAttempt == nil ? .understanding : .locations,
                prepared: pending.preparedAttempt
            )
        case let .resolvingLocations(prepared):
            recovery = cancelledRecovery(prompt: prepared.originalPrompt, stage: .locations, prepared: prepared)
        case let .generatingRoutes(resolved):
            recovery = cancelledRecovery(prompt: resolved.prepared.originalPrompt, stage: .routing, prepared: resolved.prepared)
        case let .preparingSuggestions(resolved):
            recovery = cancelledRecovery(prompt: resolved.prepared.originalPrompt, stage: .preparation, prepared: resolved.prepared)
        default:
            return
        }
        invalidateActiveRequest()
        state = .cancelled(recovery)
    }

    func reset() {
        invalidateActiveRequest()
        state = .idle(prompt: "")
    }

    func dismissError() {
        editRequest()
    }

    func consumeGeneratedRoute() -> TrailRoute? { nil }

    /// Compatibility waiter used by deterministic tests; planning starts at submission.
    func generate() async {
        let task = planningTask
        await task?.value
    }

#if DEBUG
    /// Evaluates the same availability gate used by the production research
    /// decision without starting any planning, authorization, or routing work.
    func stagingProofEvaluateResearchGuidedPlanningGate() -> Bool {
        researchGuidedPlanningIsAvailable()
    }

    /// Captures the exact in-flight attempt so proof-only cancellation can
    /// await quiescence even after `cancelGeneration()` clears model state.
    func stagingProofPlanningTaskForQuiescence() -> Task<Void, Never>? {
        planningTask
    }
#endif

    private func beginUnderstanding(prompt: String) {
#if DEBUG
        generationDebugError = nil
#endif
        let attempt = PlanningAttempt(id: attemptIDProvider(), originalPrompt: prompt)
        state = .understanding(attempt)
        launchAttempt(id: attempt.id)
    }

    private func launchAttempt(id: UUID) {
        planningTask?.cancel()
        activeRequestID = id
        planningTaskID = id
        planningTask = Task { [weak self] in
            await self?.runAttempt(requestID: id)
        }
    }

    private func launchOutdoorEvidenceFetch(for suggestions: [RouteSuggestion]) {
        outdoorEvidenceTask?.cancel()
        guard outdoorEvidenceProvider.collectionEnabled else {
            outdoorEvidenceTask = nil
            outdoorEvidenceBySuggestionID = [:]
            return
        }
        let candidates = suggestions.compactMap { suggestion -> OutdoorEvidencePostRoutingCandidate? in
            guard suggestion.route.isVerifiedRoutedResult,
                  case let .routed(provenance) = suggestion.route.provenance,
                  suggestion.route.path.count >= 2
            else { return nil }
            return OutdoorEvidencePostRoutingCandidate(
                suggestionID: suggestion.id,
                query: OutdoorRouteEvidenceQuery(
                    routeFingerprint: provenance.factFingerprint,
                    geometry: suggestion.route.path
                )
            )
        }
        guard !candidates.isEmpty else {
            outdoorEvidenceTask = nil
            return
        }
        let expectedSuggestionIDs = Set(suggestions.map(\.id))
        let collector = OutdoorEvidencePostRoutingCollector(provider: outdoorEvidenceProvider)
        outdoorEvidenceTask = Task { [weak self] in
            let snapshots = await collector.collect(candidates)
            guard !Task.isCancelled, let self,
                  case let .suggestionsReady(success) = self.state,
                  Set(success.suggestions.map(\.id)) == expectedSuggestionIDs
            else { return }
            self.outdoorEvidenceBySuggestionID = snapshots.filter {
                expectedSuggestionIDs.contains($0.key)
            }
            self.outdoorEvidenceTask = nil
        }
    }

    private func invalidateActiveRequest() {
        activeRequestID = nil
        planningTaskID = nil
        planningTask?.cancel()
        planningTask = nil
        outdoorEvidenceTask?.cancel()
        outdoorEvidenceTask = nil
        outdoorEvidenceBySuggestionID = [:]
    }
}

private extension PlannerViewModel {
    func resumeLocationClarification(
        _ answer: ClarificationAnswer,
        pending: PendingClarification,
        preparedAttempt: PreparedAttempt,
        field: IntentMissingField,
        requestID: UUID
    ) throws {
        switch answer {
        case let .locationCandidate(candidate):
            guard let providerCandidate = pending.locationCandidates.first(where: { $0.id == candidate.id }) else {
                throw PlannerIssue.unsupportedClarification
            }
            guard providerCandidate.semanticKind.isUsableRouteAnchor else {
                activeRequestID = nil
                state = .awaitingClarification(
                    PendingClarification(
                        id: requestID,
                        originalPrompt: pending.originalPrompt,
                        intent: pending.intent,
                        validation: pending.validation,
                        parserDebugInfo: pending.parserDebugInfo,
                        question: field == .endLocationQuery
                            ? "Which specific place in this area should be the destination?"
                            : "Where in this area should the hike start?",
                        kind: pending.kind,
                        supportingText: "Enter a nearby town, valley or trailhead so TrailMind does not route from an arbitrary map center.",
                        locationCandidates: [],
                        allowsFreeText: true,
                        preparedAttempt: preparedAttempt
                    )
                )
                return
            }

            let freshAttempt = preparedAttempt.selecting(
                providerCandidate,
                for: field,
                id: requestID
            )
            state = .resolvingLocations(freshAttempt)
            launchAttempt(id: requestID)

        case .text:
            let mergedIntent = try Self.merge(answer, into: preparedAttempt.intent, for: pending.kind)
            let validationResult = intentValidationService.validateResult(mergedIntent)
            var retainedSelections = preparedAttempt.selectedLocations
            retainedSelections.removeValue(forKey: field)
            try continueAfterValidation(
                validationResult,
                parsedIntent: mergedIntent,
                parserDebugInfo: pending.parserDebugInfo,
                requestID: requestID,
                originalPrompt: pending.originalPrompt,
                selectedLocations: retainedSelections
            )

        case .routeType:
            throw PlannerIssue.unsupportedClarification
        }
    }

    static func clarificationKind(for result: IntentValidationResult) -> ClarificationKind? {
        if result.missingFields.contains(.routeType) {
            return .routeType
        }

        if result.missingFields.contains(.startLocationQuery) {
            return .location(.startLocationQuery)
        }
        if result.missingFields.contains(.regionQuery) {
            return .location(.regionQuery)
        }
        if result.missingFields.contains(.endLocationQuery) {
            return .location(.endLocationQuery)
        }
        return nil
    }

    static func merge(
        _ answer: ClarificationAnswer,
        into intent: AdventureIntent,
        for kind: ClarificationKind
    ) throws -> AdventureIntent {
        var routeType = intent.routeType
        var startLocationQuery = intent.startLocationQuery
        var endLocationQuery = intent.endLocationQuery
        var regionQuery = intent.regionQuery

        switch (kind, answer) {
        case let (.location(field), .text(value)):
            let cleanedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleanedValue.isEmpty else { throw PlannerIssue.unsupportedClarification }
            switch field {
            case .startLocationQuery:
                startLocationQuery = cleanedValue
            case .endLocationQuery:
                endLocationQuery = cleanedValue
            case .regionQuery:
                regionQuery = cleanedValue
            case .routeType:
                throw PlannerIssue.unsupportedClarification
            }
        case let (.routeType, .routeType(value)):
            routeType = value
        case (.location, .locationCandidate):
            throw PlannerIssue.unsupportedClarification
        default:
            throw PlannerIssue.unsupportedClarification
        }

        return AdventureIntent(
            rawPrompt: intent.rawPrompt,
            parserSource: intent.parserSource,
            confidence: intent.confidence,
            activityType: intent.activityType,
            routeType: routeType,
            startLocationQuery: startLocationQuery,
            endLocationQuery: endLocationQuery,
            regionQuery: regionQuery,
            targetDistanceKm: intent.targetDistanceKm,
            targetDurationMinutes: intent.targetDurationMinutes,
            difficulty: intent.difficulty,
            desiredFeatures: intent.desiredFeatures,
            avoidFeatures: intent.avoidFeatures,
            mustHaveResearchExperiences:
                intent.mustHaveResearchExperiences,
            transportMode: intent.transportMode
        )
    }

    static func stageStates(
        active activeStage: GenerationStage?,
        failed failedStage: GenerationStage?
    ) -> [GenerationStageState] {
        let titles = [
            "Understanding your route request",
            "Finding the start and destination",
            "Calculating the outdoor route",
            "Preparing the map and route details"
        ]
        return zip(GenerationStage.allCases, titles).map { stage, title in
            let status: GenerationStageStatus
            if stage == failedStage {
                status = .failed
            } else if let failedStage, stage.rawValue < failedStage.rawValue {
                status = .completed
            } else if stage == activeStage {
                status = .active
            } else if let activeStage, stage.rawValue < activeStage.rawValue {
                status = .completed
            } else {
                status = .pending
            }
            return GenerationStageState(stage: stage, title: title, status: status)
        }
    }

    static func recoveryKind(for error: Error, stage: GenerationStage) -> RecoveryKind {
        if let issue = error as? PlannerIssue {
            return switch issue {
            case .timedOut:
                .timedOut
            case .invalidIntent, .unsupportedClarification:
                .malformedIntent
            case .unverifiedRoutes:
                .unverified
            }
        }
        if error is RoutePromptParserError || error is IntentValidationError {
            return .malformedIntent
        }
        #if DEBUG
        if error is RemoteAIIntentParsingProvider.ProviderError {
            return .intentUnavailable
        }
        #endif
        if error is GeocodingServiceError {
            return .geocoding
        }
        if error is RouteEligibilityError {
            return .unverified
        }
        if error is GraphHopperError || error is RoutingError {
            return .routing
        }
        if error is URLError {
            return stage == .understanding ? .intentUnavailable : .routing
        }
        return .unexpected
    }

    static func userMessage(for error: Error) -> String {
        if let issue = error as? PlannerIssue {
            return switch issue {
            case let .invalidIntent(message):
                message
            case .timedOut:
                "This route is taking longer than expected. Try again, shorten the distance, or choose a nearby trailhead."
            case .unverifiedRoutes:
                "TrailMind couldn’t verify the returned route. Try again or edit the request."
            case .unsupportedClarification:
                "TrailMind couldn’t apply that clarification without changing your request. Edit the prompt and try again."
            }
        }
        if let error = error as? RoutePromptParserError {
            return error.localizedDescription
        }
        if let error = error as? IntentValidationError {
            return error.localizedDescription
        }
        #if DEBUG
        if error is RemoteAIIntentParsingProvider.ProviderError {
            return "Route understanding isn’t available right now. Try again or edit the request."
        }
        #endif
        if let error = error as? GeocodingServiceError {
            return switch error {
            case .emptyQuery:
                "Add a start location, then try again."
            case let .noResults(query):
                "TrailMind couldn’t find “\(query)”. Check the spelling or choose a nearby trailhead."
            case .endpointsTooClose:
                "Start and destination are too close together. Choose a more specific destination."
            case let .needsClarification(query):
                "TrailMind needs a more specific town, valley or trailhead for “\(query)”."
            case .network:
                "TrailMind couldn’t reach location search. Check your connection and try again."
            case .requestInProgress:
                "Location search is still busy. Try again in a moment."
            case .unavailable, .failed:
                "Location search isn’t available right now. Try again or edit the place name."
            }
        }
        if let error = error as? GraphHopperError {
            return switch error {
            case .missingAPIKey:
                "Live routing isn’t configured yet. Try again after routing setup is complete."
            case .noRouteFound:
                "TrailMind couldn’t find a mapped route between these places. Try a nearby trailhead or edit the request."
            case let .network(message) where message.localizedCaseInsensitiveContains("timed out"):
                "This route is taking longer than expected. Try again, shorten the distance, or choose a nearby trailhead."
            case .network:
                "TrailMind couldn’t reach the routing service. Check your connection and try again."
            case .api, .invalidEndpoint, .invalidResponse, .decoding:
                "TrailMind couldn’t calculate this route. Try again or edit the request."
            }
        }
        if error is RoutingError {
            return "TrailMind couldn’t build a useful loop from this start. Try a nearby trailhead or a different distance."
        }
        if error is RouteEligibilityError {
            return "TrailMind couldn’t verify the returned route. Try again or edit the request."
        }
        if let error = error as? URLError {
            return error.code == .timedOut
                ? "This route is taking longer than expected. Try again, shorten the distance, or choose a nearby trailhead."
                : "TrailMind couldn’t connect. Check your network and try again."
        }
        return "TrailMind couldn’t build this route. Try again or edit the request."
    }

    static func isNoRoutesError(_ error: Error) -> Bool {
        if let graphHopperError = error as? GraphHopperError,
           case .noRouteFound = graphHopperError {
            return true
        }
        if let routingError = error as? RoutingError,
           case .loopRouteNotFound = routingError {
            return true
        }
        return false
    }

    func cancelledRecovery(
        prompt: String,
        stage: GenerationStage,
        prepared: PreparedAttempt?
    ) -> PlanningRecovery {
        PlanningRecovery(
            originalPrompt: prompt,
            message: "Route planning was cancelled. Your request is still here.",
            stage: stage,
            kind: .unexpected,
            preparedAttempt: prepared
        )
    }
}

private extension PlannerViewModel {
    static let standardResearchFallbackNotice =
        "A standard routed option was built because research-guided matching was unavailable."

    func researchGuidedPlanningIsAvailable() -> Bool {
        researchFeatureAvailable()
    }

    static func mergedPlanningNotice(
        researchNotice: String?,
        routingNotice: String?
    ) -> String? {
        switch (researchNotice, routingNotice) {
        case (nil, nil):
            nil
        case let (notice?, nil), let (nil, notice?):
            notice
        case let (researchNotice?, routingNotice?)
            where researchNotice == routingNotice:
            researchNotice
        case let (researchNotice?, routingNotice?):
            "\(researchNotice)\n\n\(routingNotice)"
        }
    }

    private func researchPathDecision(
        requestID: UUID,
        preparedAttempt: PreparedAttempt,
        planningRequest: RoutePlanningRequest,
        startCandidate: LocationCandidate
    ) async throws -> ResearchPathDecision {
        guard researchGuidedPlanningIsAvailable() else {
            return .useLegacy(context: nil, notice: nil)
        }

        let adapterResult = researchIntentAdapter.adapt(
            AdventureResearchIntentAdapterInputV1(
                validatedIntent: preparedAttempt.validatedIntent,
                resolvedStart: startCandidate
            )
        )
        try ensureActive(requestID)

        switch adapterResult {
        case let .unsupported(gaps):
            return .useLegacy(
                context: Self.makeLegacyResearchContext(
                    reason: .adapterUnsupported,
                    adapterGaps: gaps
                ),
                notice: nil
            )

        case let .clarificationRequired(intent, gaps):
            guard adapterResult.satisfiesStateInvariants,
                  let clarificationContext = ResearchClarificationContext(
                    origin: .adapter,
                    adapterGaps: gaps,
                    backendPlanningGaps: [],
                    questions: intent.unresolvedClarificationQuestions
                  )
            else {
                transitionToFailure(
                    PlannerIssue.unsupportedClarification,
                    requestID: requestID,
                    originalPrompt: preparedAttempt.originalPrompt,
                    stage: .routing,
                    preparedAttempt: preparedAttempt
                )
                return .handled
            }
            transitionToResearchClarification(
                clarificationContext,
                requestID: requestID,
                preparedAttempt: preparedAttempt
            )
            return .handled

        case let .ready(intent, gaps):
            guard adapterResult.satisfiesStateInvariants else {
                return .useLegacy(
                    context: Self.makeLegacyResearchContext(
                        reason: .invalidResearchResult,
                        adapterGaps: gaps
                    ),
                    notice: Self.standardResearchFallbackNotice
                )
            }

            do {
                let result = try await withTimeout(
                    seconds: operationTimeouts.routingSeconds,
                    operationDidFinish: {
                        self.researchOperationDidFinish(requestID)
                    }
                ) {
                    SendableResearchPlanningResult(
                        value: try await self.researchPlanningCoordinator.plan(
                            intent: intent
                        )
                    )
                }
                try ensureActive(requestID)
                return coordinatorDecision(
                    result.value,
                    requestID: requestID,
                    preparedAttempt: preparedAttempt,
                    planningRequest: planningRequest,
                    submittedIntent: intent,
                    adapterGaps: gaps
                )
            } catch is CancellationError {
                throw CancellationError()
            } catch let failure
                as OutdoorAdventurePlanningCoordinatorFailureV1
                where failure == .invalidResult
            {
                try ensureActive(requestID)
                transitionToFailure(
                    PlannerIssue.unverifiedRoutes,
                    requestID: requestID,
                    originalPrompt:
                        preparedAttempt.originalPrompt,
                    stage: .routing,
                    preparedAttempt: preparedAttempt
                )
                return .handled
            } catch {
                try ensureActive(requestID)
                return .useLegacy(
                    context: Self.makeLegacyResearchContext(
                        reason: .coordinatorFailure(
                            Self.researchCoordinatorFailure(for: error)
                        ),
                        adapterGaps: gaps
                    ),
                    notice: Self.standardResearchFallbackNotice
                )
            }
        }
    }

    private func coordinatorDecision(
        _ result: OutdoorAdventurePlanningCoordinatorResultV1,
        requestID: UUID,
        preparedAttempt: PreparedAttempt,
        planningRequest: RoutePlanningRequest,
        submittedIntent: AdventureResearchIntentV1,
        adapterGaps: [AdventureResearchIntentAdapterGapV1]
    ) -> ResearchPathDecision {
        switch result {
        case let .clarificationRequired(context):
            guard context.state == .clarificationRequired,
                  Self.researchClarificationIntentIsBound(
                    context.normalizedIntent,
                    to: submittedIntent,
                    questions: context.clarificationQuestions
                  ),
                  let clarificationContext = ResearchClarificationContext(
                    origin: .coordinator,
                    adapterGaps: adapterGaps,
                    backendPlanningGaps: context.planningGaps,
                    questions: context.clarificationQuestions
                  )
            else {
                return .useLegacy(
                    context: Self.makeLegacyResearchContext(
                        reason: .invalidResearchResult,
                        adapterGaps: adapterGaps,
                        backendPlanningGaps: context.planningGaps
                    ),
                    notice: Self.standardResearchFallbackNotice
                )
            }
            transitionToResearchClarification(
                clarificationContext,
                requestID: requestID,
                preparedAttempt: preparedAttempt
            )
            return .handled

        case let .unsupported(context):
            guard context.state == .unsupported,
                  Self.researchIntentsAreEquivalent(
                    context.normalizedIntent,
                    submittedIntent
                  )
            else {
                return .useLegacy(
                    context: Self.makeLegacyResearchContext(
                        reason: .invalidResearchResult,
                        adapterGaps: adapterGaps,
                        backendPlanningGaps: context.planningGaps
                    ),
                    notice: Self.standardResearchFallbackNotice
                )
            }
            return .useLegacy(
                context: Self.makeLegacyResearchContext(
                    reason: .coordinatorUnsupported,
                    adapterGaps: adapterGaps,
                    backendPlanningGaps: context.planningGaps
                ),
                notice: Self.standardResearchFallbackNotice
            )

        case let .noViableRoute(context):
            guard context.state == .noViableRoute,
                  Self.researchIntentsAreEquivalent(
                    context.normalizedIntent,
                    submittedIntent
                  )
            else {
                return .useLegacy(
                    context: Self.makeLegacyResearchContext(
                        reason: .invalidResearchResult,
                        adapterGaps: adapterGaps,
                        backendPlanningGaps: context.planningGaps
                    ),
                    notice: Self.standardResearchFallbackNotice
                )
            }
            return .useLegacy(
                context: Self.makeLegacyResearchContext(
                    reason: .noViableRoute,
                    adapterGaps: adapterGaps,
                    backendPlanningGaps: context.planningGaps
                ),
                notice: Self.standardResearchFallbackNotice
            )

        case let .routed(context):
            do {
                let researchContext = try Self.validatedResearchContext(
                    outcome: .routed,
                    routedState: context,
                    planningRequest: planningRequest,
                    submittedIntent: submittedIntent,
                    adapterGaps: adapterGaps
                )
                return .suggestions(
                    context.routeSelection.alternatives.map(\.suggestion),
                    notice: nil,
                    context: researchContext
                )
            } catch {
                return .useLegacy(
                    context: Self.makeLegacyResearchContext(
                        reason: .invalidResearchResult,
                        adapterGaps: adapterGaps,
                        backendPlanningGaps: context.planningGaps,
                        selection: context.routeSelection
                    ),
                    notice: Self.standardResearchFallbackNotice
                )
            }

        case let .partial(context):
            do {
                let researchContext = try Self.validatedResearchContext(
                    outcome: .partial,
                    routedState: context,
                    planningRequest: planningRequest,
                    submittedIntent: submittedIntent,
                    adapterGaps: adapterGaps
                )
                return .suggestions(
                    context.routeSelection.alternatives.map(\.suggestion),
                    notice: "Some requested preferences could not be verified.",
                    context: researchContext
                )
            } catch {
                return .useLegacy(
                    context: Self.makeLegacyResearchContext(
                        reason: .invalidResearchResult,
                        adapterGaps: adapterGaps,
                        backendPlanningGaps: context.planningGaps,
                        selection: context.routeSelection
                    ),
                    notice: Self.standardResearchFallbackNotice
                )
            }
        }
    }

    func transitionToResearchClarification(
        _ context: ResearchClarificationContext,
        requestID: UUID,
        preparedAttempt: PreparedAttempt
    ) {
        guard context.questions.count == 1,
              let question = context.questions.first,
              question.field == .geographicAnchor,
              question.code == .locationRequired ||
                question.code == .startRequired
        else {
            transitionToFailure(
                PlannerIssue.unsupportedClarification,
                requestID: requestID,
                originalPrompt: preparedAttempt.originalPrompt,
                stage: .routing,
                preparedAttempt: preparedAttempt,
                researchClarificationContext: context
            )
            return
        }
        guard isActive(requestID) else { return }

        activeRequestID = nil
        state = .awaitingClarification(
            PendingClarification(
                id: requestID,
                originalPrompt: preparedAttempt.originalPrompt,
                intent: preparedAttempt.intent,
                validation: preparedAttempt.validation,
                parserDebugInfo: preparedAttempt.parserDebugInfo,
                question: "Which specific town, valley or trailhead should the route start from?",
                kind: .location(.startLocationQuery),
                supportingText: "Choose a precise route anchor so TrailMind does not route from an arbitrary map center.",
                locationCandidates: [],
                allowsFreeText: true,
                preparedAttempt: preparedAttempt,
                researchClarificationContext: context
            )
        )
    }

    static func validatedResearchContext(
        outcome: ResearchPlanningContext.Outcome,
        routedState: OutdoorAdventurePlanningRoutedStateV1,
        planningRequest: RoutePlanningRequest,
        submittedIntent: AdventureResearchIntentV1,
        adapterGaps: [AdventureResearchIntentAdapterGapV1]
    ) throws -> ResearchPlanningContext {
        let expectedPlanningState: OutdoorAdventurePlanningStateV1
        switch outcome {
        case .routed:
            expectedPlanningState = .routed
        case .partial:
            expectedPlanningState = .partial
        case .legacyFallback:
            throw PlannerIssue.unverifiedRoutes
        }
        guard routedState.state == expectedPlanningState,
              researchIntentsAreEquivalent(
                routedState.normalizedIntent,
                submittedIntent
              ),
              planningRequest.routeType == .loop,
              planningRequest.activityType == .hiking ||
                planningRequest.activityType == .trailRunning
        else {
            throw PlannerIssue.unverifiedRoutes
        }

        let selection = routedState.routeSelection
        switch outcome {
        case .routed:
            guard routedState.planningGaps.isEmpty,
                  selection.state == .routed,
                  selection.sourceEnvelopeState == .routed
            else {
                throw PlannerIssue.unverifiedRoutes
            }
        case .partial:
            let hasCoherentSelectionState =
                selection.state == .routed &&
                    selection.sourceEnvelopeState == .routed ||
                selection.state == .partial &&
                    selection.sourceEnvelopeState == .partial
            guard hasCoherentSelectionState,
                  !routedState.planningGaps.isEmpty ||
                    selection.state == .partial
            else {
                throw PlannerIssue.unverifiedRoutes
            }
        case .legacyFallback:
            throw PlannerIssue.unverifiedRoutes
        }

        let alternatives = selection.alternatives
        let suggestionIDs = alternatives.map(\.suggestion.id)
        guard !alternatives.isEmpty,
              Set(suggestionIDs).count == suggestionIDs.count
        else {
            throw PlannerIssue.unverifiedRoutes
        }

        var sidecars: [
            UUID: ResearchPlanningContext.AlternativeSidecar
        ] = [:]
        for alternative in alternatives {
            let route = alternative.suggestion.route
            try RouteEligibilityPolicy.validate(
                route,
                for: .productionSuccess
            )
            guard route.isVerifiedRoutedResult,
                  route.activity == planningRequest.activityType,
                  route.routeType == planningRequest.routeType,
                  route.routeType == .loop,
                  alternative.researchProvenance.activity == route.activity,
                  alternative.researchProvenance.routeType == route.routeType,
                  case let .routed(routedProvenance) = route.provenance,
                  routedProvenance.provider == .graphHopper
            else {
                throw PlannerIssue.unverifiedRoutes
            }
            sidecars[alternative.suggestion.id] =
                ResearchPlanningContext.AlternativeSidecar(
                    attemptID: alternative.attemptID,
                    routeResultID: alternative.routeResultID,
                    researchProvenance:
                        alternative.researchProvenance,
                    waypointVisits: alternative.waypointVisits
                )
        }

        return ResearchPlanningContext(
            outcome: outcome,
            adapterGaps: adapterGaps,
            backendPlanningGaps: routedState.planningGaps,
            selectionState: selection.state,
            sourceEnvelopeState: selection.sourceEnvelopeState,
            rejectionCounts: selection.rejectionCounts,
            remainingLimitations: selection.remainingLimitations,
            alternativesBySuggestionID: sidecars
        )
    }

    static func researchIntentsAreEquivalent(
        _ returned: AdventureResearchIntentV1,
        _ submitted: AdventureResearchIntentV1
    ) -> Bool {
        researchIntentFieldsAreEquivalent(
            returned,
            submitted,
            comparesAnchor: true,
            comparesQuestions: true
        )
    }

    static func researchClarificationIntentIsBound(
        _ returned: AdventureResearchIntentV1,
        to submitted: AdventureResearchIntentV1,
        questions: [AdventureResearchClarificationQuestionV1]
    ) -> Bool {
        guard !questions.isEmpty,
              Set(returned.unresolvedClarificationQuestions) ==
                Set(questions),
              researchIntentFieldsAreEquivalent(
                returned,
                submitted,
                comparesAnchor: false,
                comparesQuestions: false
              )
        else {
            return false
        }

        if researchGeographicAnchorsAreEquivalent(
            returned.geographicAnchor,
            submitted.geographicAnchor
        ) {
            return true
        }
        guard case let .unresolved(requirement) =
                returned.geographicAnchor
        else {
            return false
        }
        return questions.contains {
            $0.field == .geographicAnchor &&
                Self.clarificationCode($0.code, matches: requirement)
        }
    }

    static func clarificationCode(
        _ code: AdventureResearchClarificationCodeV1,
        matches requirement: AdventureResearchAnchorRequirementV1
    ) -> Bool {
        switch (code, requirement) {
        case (.locationRequired, .locationRequired),
             (.startRequired, .startRequired),
             (.destinationRequired, .destinationRequired):
            true
        default:
            false
        }
    }

    static func researchIntentFieldsAreEquivalent(
        _ returned: AdventureResearchIntentV1,
        _ submitted: AdventureResearchIntentV1,
        comparesAnchor: Bool,
        comparesQuestions: Bool
    ) -> Bool {
        guard returned.activity == submitted.activity,
              !comparesAnchor ||
                researchGeographicAnchorsAreEquivalent(
                    returned.geographicAnchor,
                    submitted.geographicAnchor
                ),
              returned.routeType == submitted.routeType,
              returned.distanceRangeKm == submitted.distanceRangeKm,
              returned.durationRangeMinutes ==
                submitted.durationRangeMinutes,
              returned.maximumElevationGainMeters ==
                submitted.maximumElevationGainMeters,
              returned.maximumTechnicalDifficulty ==
                submitted.maximumTechnicalDifficulty,
              returned.groupContext == submitted.groupContext,
              returned.dateOrSeason == submitted.dateOrSeason,
              returned.overnightRequirements.required ==
                submitted.overnightRequirements.required,
              returned.overnightRequirements.nights ==
                submitted.overnightRequirements.nights,
              returned.transportRequirements ==
                submitted.transportRequirements
        else {
            return false
        }

        let returnedMustHaves = returned.mustHaveExperiences.sorted {
            if $0.experience.rawValue != $1.experience.rawValue {
                return $0.experience.rawValue < $1.experience.rawValue
            }
            return $0.minimumCount < $1.minimumCount
        }
        let submittedMustHaves = submitted.mustHaveExperiences.sorted {
            if $0.experience.rawValue != $1.experience.rawValue {
                return $0.experience.rawValue < $1.experience.rawValue
            }
            return $0.minimumCount < $1.minimumCount
        }

        return returnedMustHaves == submittedMustHaves &&
            Set(returned.preferredExperiences) ==
                Set(submitted.preferredExperiences) &&
            Set(returned.avoidedExperiences) ==
                Set(submitted.avoidedExperiences) &&
            Set(returned.requiredFacilities) ==
                Set(submitted.requiredFacilities) &&
            Set(
                returned.overnightRequirements
                    .allowedAccommodationTypes
            ) ==
                Set(
                    submitted.overnightRequirements
                        .allowedAccommodationTypes
                ) &&
            (!comparesQuestions ||
                Set(returned.unresolvedClarificationQuestions) ==
                    Set(submitted.unresolvedClarificationQuestions))
    }

    static func researchGeographicAnchorsAreEquivalent(
        _ returned: AdventureResearchGeographicAnchorV1,
        _ submitted: AdventureResearchGeographicAnchorV1
    ) -> Bool {
        if returned == submitted {
            return true
        }
        guard
            case let .resolved(
                returnedName,
                returnedCoordinate,
                returnedRegionEntityID
            ) = returned,
            case let .resolved(
                submittedName,
                submittedCoordinate,
                submittedRegionEntityID
            ) = submitted,
            submittedRegionEntityID == nil,
            returnedName == submittedName,
            returnedCoordinate == submittedCoordinate,
            let returnedRegionEntityID,
            reviewedResearchRegionEntityIDV1(
                for: submittedCoordinate
            ) == returnedRegionEntityID.uuidString.lowercased()
        else {
            return false
        }
        return true
    }

    private static func reviewedResearchRegionEntityIDV1(
        for coordinate: AdventureResearchCoordinateV1
    ) -> String? {
        let matches = reviewedResearchRegionsV1.filter {
            $0.contains(coordinate)
        }
        guard matches.count == 1 else {
            return nil
        }
        return matches[0].entityID
    }

    private struct ReviewedResearchRegionV1 {
        let entityID: String
        let latitudeRange: ClosedRange<Double>
        let longitudeRange: ClosedRange<Double>

        func contains(
            _ coordinate: AdventureResearchCoordinateV1
        ) -> Bool {
            latitudeRange.contains(coordinate.latitude) &&
                longitudeRange.contains(coordinate.longitude)
        }
    }

    /// Mirrors the backend's reviewed V1 rectangular operational polygons.
    private static let reviewedResearchRegionsV1 = [
        ReviewedResearchRegionV1(
            entityID: "30000000-0000-4000-8000-000000000001",
            latitudeRange: 47.00...47.45,
            longitudeRange: 10.95...11.65
        ),
        ReviewedResearchRegionV1(
            entityID: "30000000-0000-4000-8000-000000000002",
            latitudeRange: 51.45...51.98,
            longitudeRange: 10.30...11.35
        )
    ]

    static func makeLegacyResearchContext(
        reason: ResearchPlanningContext.LegacyFallbackReason,
        adapterGaps: [AdventureResearchIntentAdapterGapV1],
        backendPlanningGaps: [OutdoorAdventurePlanningGapV1] = [],
        selection: ResearchGuidedRouteSelectionV1? = nil
    ) -> ResearchPlanningContext {
        ResearchPlanningContext(
            outcome: .legacyFallback(reason),
            adapterGaps: adapterGaps,
            backendPlanningGaps: backendPlanningGaps,
            selectionState: selection?.state,
            sourceEnvelopeState: selection?.sourceEnvelopeState,
            rejectionCounts: selection?.rejectionCounts ?? [:],
            remainingLimitations: selection?.remainingLimitations ?? [],
            alternativesBySuggestionID: [:]
        )
    }

    static func researchCoordinatorFailure(
        for error: Error
    ) -> OutdoorAdventurePlanningCoordinatorFailureV1 {
        if let failure =
            error as? OutdoorAdventurePlanningCoordinatorFailureV1
        {
            return failure
        }
        if let issue = error as? PlannerIssue,
           case .timedOut = issue {
            return .timedOut
        }
        return .unavailable
    }
}


private extension PlannerViewModel {
    func runAttempt(requestID: UUID) async {
        defer { clearPlanningTask(requestID: requestID) }
        var stage: GenerationStage = .understanding
        var preparedForRetry: PreparedAttempt?

        do {
            let preparedAttempt: PreparedAttempt
            switch state {
            case let .understanding(attempt) where attempt.id == requestID:
                guard let prepared = try await understand(attempt) else { return }
                preparedAttempt = prepared
            case let .resolvingLocations(prepared) where prepared.id == requestID:
                preparedAttempt = prepared
            default:
                return
            }

            try ensureActive(requestID)
            preparedForRetry = preparedAttempt
            state = .resolvingLocations(preparedAttempt)
            stage = .locations

            let planningRequest = RoutePlanningRequest(validatedIntent: preparedAttempt.validatedIntent)
            var workingPrepared = preparedAttempt
            let startCandidate: LocationCandidate
            if let selectedStart = workingPrepared.selectedLocations[.startLocationQuery] {
                startCandidate = selectedStart
            } else {
                guard let resolvedStart = try await resolveLocationCandidate(
                    query: planningRequest.startQuery,
                    field: .startLocationQuery,
                    preferredCoordinate: nil,
                    preparedAttempt: workingPrepared,
                    requestID: requestID
                ) else { return }
                startCandidate = resolvedStart
                workingPrepared = workingPrepared.selecting(
                    resolvedStart,
                    for: .startLocationQuery,
                    id: requestID
                )
            }
            preparedForRetry = workingPrepared
            let start = startCandidate.coordinate

            let end: Coordinate?
            let endCandidate: LocationCandidate?
            if let endQuery = planningRequest.endQuery, planningRequest.routeType != .loop {
                let resolvedEnd: LocationCandidate
                if let selectedEnd = workingPrepared.selectedLocations[.endLocationQuery] {
                    resolvedEnd = selectedEnd
                } else {
                    guard let candidate = try await resolveLocationCandidate(
                        query: endQuery,
                        field: .endLocationQuery,
                        preferredCoordinate: start,
                        preparedAttempt: workingPrepared,
                        requestID: requestID
                    ) else { return }
                    resolvedEnd = candidate
                    workingPrepared = workingPrepared.selecting(
                        candidate,
                        for: .endLocationQuery,
                        id: requestID
                    )
                }
                let endpointDistance = CLLocation(
                    latitude: start.latitude,
                    longitude: start.longitude
                ).distance(
                    from: CLLocation(
                        latitude: resolvedEnd.coordinate.latitude,
                        longitude: resolvedEnd.coordinate.longitude
                    )
                )
                guard endpointDistance >= 250 else {
                    throw GeocodingServiceError.endpointsTooClose
                }
                end = resolvedEnd.coordinate
                endCandidate = resolvedEnd
            } else {
                end = nil
                endCandidate = nil
            }
            preparedForRetry = workingPrepared

            let resolved = ResolvedAttempt(
                prepared: workingPrepared,
                request: planningRequest,
                start: start,
                end: end
            )
            try ensureActive(requestID)
            state = .generatingRoutes(resolved)
            stage = .routing

            let researchDecision = try await researchPathDecision(
                requestID: requestID,
                preparedAttempt: workingPrepared,
                planningRequest: planningRequest,
                startCandidate: startCandidate
            )
            let legacyResearchContext: ResearchPlanningContext?
            let legacyResearchNotice: String?
            switch researchDecision {
            case let .suggestions(suggestions, notice, context):
                try ensureActive(requestID)
                state = .preparingSuggestions(resolved)
                stage = .preparation
                activeRequestID = nil
                state = .suggestionsReady(
                    PlanningSuccess(
                        originalPrompt: preparedAttempt.originalPrompt,
                        suggestions: suggestions,
                        notice: notice,
                        researchContext: context
                    )
                )
                launchOutdoorEvidenceFetch(for: suggestions)
                return

            case let .useLegacy(context, notice):
                legacyResearchContext = context
                legacyResearchNotice = notice

            case .handled:
                return
            }

            let sendableRoutingResult = try await withTimeout(seconds: operationTimeouts.routingSeconds) {
                SendableRoutingResult(
                    value: try await self.routingCoordinator.routeSuggestions(
                        for: RouteIntent(
                            request: planningRequest,
                            start: start,
                            end: end,
                            parsedIntent: preparedAttempt.validatedIntent
                        )
                    )
                )
            }
            try ensureActive(requestID)
            state = .preparingSuggestions(resolved)
            stage = .preparation

            let routingResult = sendableRoutingResult.value
            guard !routingResult.suggestions.isEmpty else {
                transitionToNoRoutes(
                    requestID: requestID,
                    originalPrompt: workingPrepared.originalPrompt,
                    preparedAttempt: workingPrepared
                )
                return
            }

            for suggestion in routingResult.suggestions {
                try RouteEligibilityPolicy.validate(
                    suggestion.route,
                    for: .productionSuccess
                )
                guard
                    suggestion.route.activity == planningRequest.activityType,
                    suggestion.route.routeType == planningRequest.routeType
                else {
                    throw PlannerIssue.unverifiedRoutes
                }
            }

            let intentDebugMetadata = RouteIntentDebugMetadata(
                intent: preparedAttempt.validatedIntent,
                validationStatus: preparedAttempt.validation.status.rawValue,
                parserDebugInfo: preparedAttempt.parserDebugInfo,
                repaired: preparedAttempt.validation.repaired,
                repairReason: preparedAttempt.validation.repairReason,
                missingFields: preparedAttempt.validation.missingFields.map(\.rawValue),
                clarificationQuestion: preparedAttempt.validation.clarificationQuestion,
                geocodedStartLabel: startCandidate.displayName,
                geocodedEndLabel: endCandidate?.displayName,
                loopSearchOutcome: routingResult.loopSearchOutcome,
                loopSearchDiagnostics: routingResult.loopSearchDiagnostics
            )
            let preparedSuggestions = routingResult.suggestions.map { suggestion in
                let planningMetadata = suggestion.route.planningMetadata ?? planningRequest.metadata
                let routeWithSearchOutcome = suggestion.route.withPlanningMetadata(
                    planningRequest.routeType == .loop
                        ? planningMetadata.withLoopSearchOutcome(routingResult.loopSearchOutcome)
                        : planningMetadata
                )
                return RouteSuggestion(
                    id: suggestion.id,
                    route: routeWithSearchOutcome.withIntentDebugMetadata(intentDebugMetadata),
                    explanation: suggestion.explanation,
                    debugMetadata: suggestion.debugMetadata
                )
            }

            try ensureActive(requestID)
            activeRequestID = nil
            state = .suggestionsReady(
                PlanningSuccess(
                    originalPrompt: preparedAttempt.originalPrompt,
                    suggestions: preparedSuggestions,
                    notice: Self.mergedPlanningNotice(
                        researchNotice: legacyResearchNotice,
                        routingNotice: routingResult.notice
                    ),
                    researchContext: legacyResearchContext
                )
            )
            launchOutdoorEvidenceFetch(for: preparedSuggestions)
        } catch is CancellationError {
            return
        } catch {
            guard isActive(requestID) else { return }
            if Self.isNoRoutesError(error) {
                transitionToNoRoutes(
                    requestID: requestID,
                    originalPrompt: preparedForRetry?.originalPrompt ?? prompt,
                    preparedAttempt: preparedForRetry
                )
            } else {
                transitionToFailure(
                    error,
                    requestID: requestID,
                    originalPrompt: preparedForRetry?.originalPrompt ?? prompt,
                    stage: stage,
                    preparedAttempt: preparedForRetry
                )
            }
        }
    }

    func understand(_ attempt: PlanningAttempt) async throws -> PreparedAttempt? {
        let parsedIntent = try await withTimeout(seconds: operationTimeouts.parserSeconds) {
            try await self.intentParsingProvider.parseIntent(rawPrompt: attempt.originalPrompt)
        }
        try ensureActive(attempt.id)
        let parserDebugInfo: IntentParserDebugInfo?
        if let debugProvider = intentParsingProvider as? any IntentParsingDebugProviding {
            parserDebugInfo = try? await withTimeout(
                seconds: min(operationTimeouts.parserSeconds, 1)
            ) {
                await debugProvider.intentParserDebugInfo()
            }
        } else {
            parserDebugInfo = nil
        }
        try ensureActive(attempt.id)
        let validationResult = intentValidationService.validateResult(parsedIntent)

        return try preparedAttempt(
            from: validationResult,
            parsedIntent: parsedIntent,
            parserDebugInfo: parserDebugInfo,
            requestID: attempt.id,
            originalPrompt: attempt.originalPrompt
        )
    }

    func resolveLocationCandidate(
        query: String,
        field: IntentMissingField,
        preferredCoordinate: Coordinate?,
        preparedAttempt: PreparedAttempt,
        requestID: UUID
    ) async throws -> LocationCandidate? {
        let context = LocationQueryContext(
            originalQuery: query,
            originalPrompt: preparedAttempt.originalPrompt,
            routeType: preparedAttempt.validatedIntent.routeType,
            activityType: preparedAttempt.validatedIntent.activityType,
            requestedField: field,
            preferredCoordinate: preferredCoordinate,
            explicitlyRequestsNearby: Self.explicitlyRequestsNearby(preparedAttempt.originalPrompt)
        )
        let resolution = try await withTimeout(seconds: operationTimeouts.geocodingSeconds) {
            try await self.locationResolver.resolve(context)
        }
        try ensureActive(requestID)

        switch resolution {
        case let .resolved(candidate):
            guard candidate.semanticKind.isUsableRouteAnchor else {
                let clarification = LocationClarification(
                    query: query,
                    question: field == .endLocationQuery
                        ? "Which specific place should be the destination?"
                        : "Where should the hike start?",
                    supportingText: "Enter a nearby town, valley or trailhead so TrailMind does not route from an arbitrary map center.",
                    candidates: [candidate],
                    allowsFreeText: true
                )
                transitionToLocationClarification(
                    clarification,
                    field: field,
                    preparedAttempt: preparedAttempt,
                    requestID: requestID
                )
                return nil
            }
            return candidate

        case let .needsClarification(clarification):
            transitionToLocationClarification(
                clarification,
                field: field,
                preparedAttempt: preparedAttempt,
                requestID: requestID
            )
            return nil

        case let .noResults(query):
            throw GeocodingServiceError.noResults(query: query)

        case .unavailable:
            throw GeocodingServiceError.unavailable
        }
    }

    func transitionToLocationClarification(
        _ clarification: LocationClarification,
        field: IntentMissingField,
        preparedAttempt: PreparedAttempt,
        requestID: UUID
    ) {
        guard isActive(requestID) else { return }
        activeRequestID = nil
        state = .awaitingClarification(
            PendingClarification(
                id: requestID,
                originalPrompt: preparedAttempt.originalPrompt,
                intent: preparedAttempt.intent,
                validation: preparedAttempt.validation,
                parserDebugInfo: preparedAttempt.parserDebugInfo,
                question: clarification.question,
                kind: .location(field),
                supportingText: clarification.supportingText,
                locationCandidates: clarification.candidates,
                allowsFreeText: clarification.allowsFreeText,
                preparedAttempt: preparedAttempt
            )
        )
    }

    static func explicitlyRequestsNearby(_ prompt: String) -> Bool {
        let normalized = LocationLanguageContext.normalizedWords(prompt)
        return ["near me", "close to me", "in meiner nahe", "bei mir", "um mich herum"]
            .contains(where: normalized.contains)
    }

    func continueAfterValidation(
        _ validationResult: IntentValidationResult,
        parsedIntent: AdventureIntent,
        parserDebugInfo: IntentParserDebugInfo?,
        requestID: UUID,
        originalPrompt: String,
        selectedLocations: [IntentMissingField: LocationCandidate] = [:]
    ) throws {
        guard let prepared = try preparedAttempt(
            from: validationResult,
            parsedIntent: parsedIntent,
            parserDebugInfo: parserDebugInfo,
            requestID: requestID,
            originalPrompt: originalPrompt,
            selectedLocations: selectedLocations
        ) else { return }

        state = .resolvingLocations(prepared)
        launchAttempt(id: requestID)
    }

    func preparedAttempt(
        from validationResult: IntentValidationResult,
        parsedIntent: AdventureIntent,
        parserDebugInfo: IntentParserDebugInfo?,
        requestID: UUID,
        originalPrompt: String,
        selectedLocations: [IntentMissingField: LocationCandidate] = [:]
    ) throws -> PreparedAttempt? {
        let snapshot = ValidationSnapshot(validationResult)
        if let validatedIntent = validationResult.validatedIntent {
            return PreparedAttempt(
                id: requestID,
                originalPrompt: originalPrompt,
                intent: validationResult.intentForRouting ?? parsedIntent,
                validatedIntent: validatedIntent,
                validation: snapshot,
                parserDebugInfo: parserDebugInfo,
                selectedLocations: selectedLocations
            )
        }

        if validationResult.status == .needsClarification {
            let pendingIntent = validationResult.intentForRouting ?? parsedIntent
            guard let kind = Self.clarificationKind(for: validationResult) else {
                throw PlannerIssue.unsupportedClarification
            }
            activeRequestID = nil
            state = .awaitingClarification(
                PendingClarification(
                    id: requestID,
                    originalPrompt: originalPrompt,
                    intent: pendingIntent,
                    validation: snapshot,
                    parserDebugInfo: parserDebugInfo,
                    question: validationResult.clarificationQuestion
                        ?? validationResult.validationError?.localizedDescription
                        ?? IntentClarificationQuestion.vagueArea,
                    kind: kind,
                    supportingText: nil,
                    locationCandidates: [],
                    allowsFreeText: true,
                    preparedAttempt: nil
                )
            )
            return nil
        }

        throw PlannerIssue.invalidIntent(
            validationResult.validationError?.localizedDescription
                ?? "TrailMind couldn’t understand enough of that request to plan it truthfully."
        )
    }

    func transitionToNoRoutes(
        requestID: UUID,
        originalPrompt: String,
        preparedAttempt: PreparedAttempt?
    ) {
        guard isActive(requestID) else { return }
        activeRequestID = nil
        state = .noRoutes(
            PlanningRecovery(
                originalPrompt: originalPrompt,
                message: "TrailMind couldn’t find a valid mapped route for this request. Try a nearby trailhead, a different distance, or edit the request.",
                stage: .routing,
                kind: .routing,
                preparedAttempt: preparedAttempt
            )
        )
    }

    func transitionToFailure(
        _ error: Error,
        requestID: UUID?,
        originalPrompt: String,
        stage: GenerationStage,
        preparedAttempt: PreparedAttempt?,
        researchClarificationContext:
            ResearchClarificationContext? = nil
    ) {
        if let requestID, !isActive(requestID) { return }
        activeRequestID = nil
#if DEBUG
        generationDebugError = String(reflecting: error)
#endif
        state = .recoverableError(
            PlanningRecovery(
                originalPrompt: originalPrompt,
                message: Self.userMessage(for: error),
                stage: stage,
                kind: Self.recoveryKind(for: error, stage: stage),
                preparedAttempt: preparedAttempt,
                researchClarificationContext:
                    researchClarificationContext
            )
        )
    }

    func clearPlanningTask(requestID: UUID) {
        guard planningTaskID == requestID else { return }
        planningTask = nil
        planningTaskID = nil
    }

    func ensureActive(_ requestID: UUID) throws {
        try Task.checkCancellation()
        guard isActive(requestID) else { throw CancellationError() }
    }

    func isActive(_ requestID: UUID) -> Bool {
        activeRequestID == requestID
    }

    func withTimeout<T: Sendable>(
        seconds: TimeInterval,
        operationDidFinish:
            @escaping @MainActor @Sendable () -> Void = {},
        operation: @escaping @MainActor @Sendable () async throws -> T
    ) async throws -> T {
        let race = TimeoutRace<T>()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                race.install(
                    continuation: continuation,
                    seconds: seconds,
                    operationDidFinish: operationDidFinish,
                    operation: operation
                )
            }
        } onCancel: {
            Task { @MainActor in
                race.cancel()
            }
        }
    }
}
