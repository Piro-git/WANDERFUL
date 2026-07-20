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
    }

    struct PlanningSuccess: Equatable {
        let originalPrompt: String
        let suggestions: [RouteSuggestion]
        let notice: String?
    }

    struct PlanningRecovery: Equatable, Sendable {
        let originalPrompt: String
        let message: String
        let stage: GenerationStage
        let kind: RecoveryKind
        let preparedAttempt: PreparedAttempt?
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
            operation: @escaping @MainActor @Sendable () async throws -> Value
        ) {
            if let terminalResult {
                continuation.resume(with: terminalResult)
                return
            }

            self.continuation = continuation
            operationTask = Task { @MainActor [weak self] in
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
    private let operationTimeouts: OperationTimeouts
    @ObservationIgnored private let attemptIDProvider: @MainActor () -> UUID
    @ObservationIgnored private var activeRequestID: UUID?
    @ObservationIgnored private var planningTaskID: UUID?
    @ObservationIgnored private var planningTask: Task<Void, Never>?

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

    private func invalidateActiveRequest() {
        activeRequestID = nil
        planningTaskID = nil
        planningTask?.cancel()
        planningTask = nil
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
                    notice: routingResult.notice
                )
            )
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
        preparedAttempt: PreparedAttempt?
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
                preparedAttempt: preparedAttempt
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
        operation: @escaping @MainActor @Sendable () async throws -> T
    ) async throws -> T {
        let race = TimeoutRace<T>()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                race.install(
                    continuation: continuation,
                    seconds: seconds,
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
