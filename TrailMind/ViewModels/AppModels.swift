import CoreLocation
import Foundation
import Observation

@Observable
final class AppModel {
    let savedRoutes: SavedRoutesModel
    var preferences = UserPreferences()

    init(savedRoutes: SavedRoutesModel = SavedRoutesModel()) {
        self.savedRoutes = savedRoutes
    }
}

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
        var status: GenerationStageStatus

        var id: GenerationStage { stage }
    }

    struct GenerationFailure: Equatable, Sendable {
        let stage: GenerationStage
        let message: String
    }

    struct OperationTimeouts: Equatable, Sendable {
        static let production = OperationTimeouts(parserSeconds: 22, geocodingSeconds: 15)

        let parserSeconds: TimeInterval
        let geocodingSeconds: TimeInterval
    }

    enum Phase: Equatable {
        case home
        case generating
        case suggestions
    }

    private enum RequestKind {
        case mockSuggestions
        case dynamicRoute
    }

    private let plannerService: any AIPlannerService
    private let intentParsingProvider: any IntentParsingProvider
    private let intentValidationService: IntentValidationService
    private let geocodingService: any GeocodingService
    private let routingCoordinator: any RoutingCoordinating
    private let operationTimeouts: OperationTimeouts
    private var requestKind: RequestKind = .mockSuggestions
    private var activeRequestID: UUID?

    var phase: Phase = .home
    var prompt = ""
    var suggestions: [RouteSuggestion] = []
    var generatedRoute: TrailRoute?
    var generationStages: [GenerationStageState] = []
    var generationFailure: GenerationFailure?
    var errorMessage: String?
    var suggestionNotice: String?
#if DEBUG
    private(set) var generationDebugError: String?
#endif

    var generationRequestID: UUID? { activeRequestID }

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
        switch requestKind {
        case .mockSuggestions:
            "Using mock planning data · no route leaves your device"
        case .dynamicRoute:
            "Searching with Apple geocoding · routing with GraphHopper"
        }
    }

    init(
        plannerService: any AIPlannerService = MockAIPlannerService(),
        intentParsingProvider: any IntentParsingProvider = IntentParsingProviderFactory.makeDefaultProvider(),
        intentValidationService: IntentValidationService = IntentValidationService(),
        geocodingService: any GeocodingService = NativeGeocodingService(),
        routingCoordinator: any RoutingCoordinating = RoutingCoordinator(),
        operationTimeouts: OperationTimeouts = .production
    ) {
        self.plannerService = plannerService
        self.intentParsingProvider = intentParsingProvider
        self.intentValidationService = intentValidationService
        self.geocodingService = geocodingService
        self.routingCoordinator = routingCoordinator
        self.operationTimeouts = operationTimeouts
    }

    func startPlanning(prompt: String) {
        beginPlanning(prompt: prompt, requestKind: .mockSuggestions)
    }

    func startTextRoute(prompt: String) {
        beginPlanning(prompt: prompt, requestKind: .dynamicRoute)
    }

    private func beginPlanning(prompt: String, requestKind: RequestKind) {
        let cleanPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        self.prompt = cleanPrompt
        guard !cleanPrompt.isEmpty else {
            errorMessage = "Describe where you want to go and what kind of route you want."
            phase = .home
            return
        }

        self.requestKind = requestKind
        activeRequestID = UUID()
        generationStages = Self.stageStates(for: requestKind)
        generationStages[0].status = .active
        generationFailure = nil
        errorMessage = nil
        suggestionNotice = nil
        generatedRoute = nil
        suggestions = []
#if DEBUG
        generationDebugError = nil
#endif
        phase = .generating
    }

    func generate() async {
        guard phase == .generating, let requestID = activeRequestID else { return }

        do {
            switch requestKind {
            case .mockSuggestions:
                try await generateMockSuggestions(requestID: requestID)
            case .dynamicRoute:
                try await generateDynamicRoute(requestID: requestID)
            }
        } catch is CancellationError {
            return
        } catch {
            guard isActive(requestID) else { return }
            let stage = activeGenerationStage ?? .understanding
            fail(stage, requestID: requestID)
            generationFailure = GenerationFailure(
                stage: stage,
                message: Self.userMessage(for: error)
            )
#if DEBUG
            generationDebugError = String(reflecting: error)
#endif
        }
    }

    private func generateMockSuggestions(requestID: UUID) async throws {
        for stage in GenerationStage.allCases {
            try ensureActive(requestID)
            try await Task.sleep(for: .milliseconds(stage == .understanding ? 500 : 650))
            try ensureActive(requestID)
            complete(stage, requestID: requestID)
            if let next = GenerationStage(rawValue: stage.rawValue + 1) {
                activate(next, requestID: requestID)
            }
        }

        let intent = try await plannerService.parseAdventurePrompt(prompt: prompt)
        try ensureActive(requestID)
        let routes = try await plannerService.generateRouteSuggestions(intent: intent)
        try ensureActive(requestID)
        suggestions = routes.enumerated().map { index, route in
            RouteSuggestion(
                route: route,
                matchScore: max(96 - index * 5, 80),
                explanation: route.whyItMatches
            )
        }
        finishDelivery(requestID: requestID)
        phase = .suggestions
    }

    private func generateDynamicRoute(requestID: UUID) async throws {
        let rawPrompt = prompt
        let parsedIntent = try await withTimeout(seconds: operationTimeouts.parserSeconds) {
            try await self.intentParsingProvider.parseIntent(rawPrompt: rawPrompt)
        }
        try ensureActive(requestID)
        let parserDebugInfo = await (intentParsingProvider as? any IntentParsingDebugProviding)?
            .intentParserDebugInfo()
        let validationResult = intentValidationService.validateResult(parsedIntent)
        guard let validatedIntent = validationResult.validatedIntent else {
            throw PlannerGenerationIssue.clarification(
                validationResult.clarificationQuestion
                ?? validationResult.validationError?.localizedDescription
                ?? IntentClarificationQuestion.vagueArea
            )
        }
        let planningRequest = RoutePlanningRequest(validatedIntent: validatedIntent)
        complete(.understanding, requestID: requestID)
        activate(.locations, requestID: requestID)

        let start = try await withTimeout(seconds: operationTimeouts.geocodingSeconds) {
            try await self.geocodingService.geocodeLocation(planningRequest.startQuery)
        }
        try ensureActive(requestID)
        let end: Coordinate?
        if let endQuery = planningRequest.endQuery {
            let geocodedEnd = try await withTimeout(seconds: operationTimeouts.geocodingSeconds) {
                try await self.geocodingService.geocodeLocation(endQuery, near: start)
            }
            try ensureActive(requestID)
            let endpointDistance = CLLocation(
                latitude: start.latitude,
                longitude: start.longitude
            ).distance(
                from: CLLocation(latitude: geocodedEnd.latitude, longitude: geocodedEnd.longitude)
            )
            guard endpointDistance >= 250 else {
                throw GeocodingServiceError.endpointsTooClose
            }
            end = geocodedEnd
        } else {
            end = nil
        }
        complete(.locations, requestID: requestID)
        activate(.routing, requestID: requestID)
        try ensureActive(requestID)

        let routingResult = try await routingCoordinator.routeSuggestions(
            for: RouteIntent(
                request: planningRequest,
                start: start,
                end: end,
                parsedIntent: validatedIntent
            )
        )
        try ensureActive(requestID)
        complete(.routing, requestID: requestID)
        activate(.preparation, requestID: requestID)

        suggestionNotice = routingResult.notice
        let intentDebugMetadata = RouteIntentDebugMetadata(
            intent: validatedIntent,
            validationStatus: validationResult.status.rawValue,
            parserDebugInfo: parserDebugInfo,
            repaired: validationResult.repaired,
            repairReason: validationResult.repairReason,
            missingFields: validationResult.missingFields.map(\.rawValue),
            clarificationQuestion: validationResult.clarificationQuestion,
            geocodedStartLabel: planningRequest.startQuery,
            geocodedEndLabel: planningRequest.endQuery,
            loopSearchOutcome: routingResult.loopSearchOutcome,
            loopSearchDiagnostics: routingResult.loopSearchDiagnostics
        )
        let debugSuggestions = routingResult.suggestions.map { suggestion in
            let planningMetadata = suggestion.route.planningMetadata ?? planningRequest.metadata
            let routeWithSearchOutcome = suggestion.route.withPlanningMetadata(
                planningRequest.routeType == .loop
                    ? planningMetadata.withLoopSearchOutcome(routingResult.loopSearchOutcome)
                    : planningMetadata
            )
            return RouteSuggestion(
                id: suggestion.id,
                route: routeWithSearchOutcome.withIntentDebugMetadata(intentDebugMetadata),
                matchScore: suggestion.matchScore,
                explanation: suggestion.explanation,
                debugMetadata: suggestion.debugMetadata
            )
        }
        try ensureActive(requestID)

        if debugSuggestions.count > 1 {
            complete(.preparation, requestID: requestID)
            suggestions = debugSuggestions
            finishDelivery(requestID: requestID)
            phase = .suggestions
            return
        }

        guard let route = debugSuggestions.first?.route else {
            throw GraphHopperError.noRouteFound
        }
        complete(.preparation, requestID: requestID)
        generatedRoute = route
        finishDelivery(requestID: requestID)
        phase = .home
    }

    func consumeGeneratedRoute() -> TrailRoute? {
        defer { generatedRoute = nil }
        return generatedRoute
    }

    func dismissError() {
        errorMessage = nil
    }

    func retryGeneration() {
        guard generationFailure != nil else { return }
        beginPlanning(prompt: prompt, requestKind: requestKind)
    }

    func editRequest() {
        cancelActiveRequest(clearPrompt: false)
    }

    func cancelGeneration() {
        cancelActiveRequest(clearPrompt: false)
    }

    func reset() {
        cancelActiveRequest(clearPrompt: true)
        requestKind = .mockSuggestions
    }

    private var activeGenerationStage: GenerationStage? {
        generationStages.first { $0.status == .active }?.stage
    }

    private func ensureActive(_ requestID: UUID) throws {
        try Task.checkCancellation()
        guard isActive(requestID) else { throw CancellationError() }
    }

    private func isActive(_ requestID: UUID) -> Bool {
        activeRequestID == requestID && phase == .generating
    }

    private func activate(_ stage: GenerationStage, requestID: UUID) {
        guard isActive(requestID), let index = generationStages.firstIndex(where: { $0.stage == stage }) else { return }
        generationStages[index].status = .active
    }

    private func complete(_ stage: GenerationStage, requestID: UUID) {
        guard isActive(requestID), let index = generationStages.firstIndex(where: { $0.stage == stage }) else { return }
        generationStages[index].status = .completed
    }

    private func fail(_ stage: GenerationStage, requestID: UUID) {
        guard isActive(requestID), let index = generationStages.firstIndex(where: { $0.stage == stage }) else { return }
        generationStages[index].status = .failed
    }

    private func finishDelivery(requestID: UUID) {
        guard activeRequestID == requestID else { return }
        activeRequestID = nil
        generationFailure = nil
        generationStages = []
        errorMessage = nil
    }

    private func cancelActiveRequest(clearPrompt: Bool) {
        activeRequestID = nil
        if clearPrompt { prompt = "" }
        suggestions = []
        generatedRoute = nil
        generationFailure = nil
        generationStages = []
        errorMessage = nil
        suggestionNotice = nil
#if DEBUG
        generationDebugError = nil
#endif
        phase = .home
    }

    private func withTimeout<T: Sendable>(
        seconds: TimeInterval,
        operation: @escaping @MainActor @Sendable () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }
            group.addTask {
                try await Task.sleep(for: .seconds(seconds))
                throw PlannerGenerationIssue.timedOut
            }
            defer { group.cancelAll() }
            guard let result = try await group.next() else {
                throw PlannerGenerationIssue.timedOut
            }
            return result
        }
    }

    private static func stageStates(for requestKind: RequestKind) -> [GenerationStageState] {
        let titles: [String] = switch requestKind {
        case .mockSuggestions:
            [
                "Understanding your adventure",
                "Finding scenic paths",
                "Balancing distance and elevation",
                "Checking highlights and safety"
            ]
        case .dynamicRoute:
            [
                "Understanding your route request",
                "Finding the start and destination",
                "Calculating the outdoor route",
                "Preparing the map and route details"
            ]
        }
        return zip(GenerationStage.allCases, titles).map {
            GenerationStageState(stage: $0.0, title: $0.1, status: .pending)
        }
    }

    private static func userMessage(for error: Error) -> String {
        if let issue = error as? PlannerGenerationIssue {
            return switch issue {
            case let .clarification(message):
                message
            case .timedOut:
                "This route is taking longer than expected. Try again, shorten the distance, or choose a nearby trailhead."
            }
        }
        if let error = error as? RoutePromptParserError {
            return error.localizedDescription
        }
        if let error = error as? IntentValidationError {
            return error.localizedDescription
        }
        if let error = error as? GeocodingServiceError {
            return switch error {
            case .emptyQuery:
                "Add a start location, then try again."
            case let .noResults(query):
                "TrailMind couldn’t find “\(query)”. Check the spelling or choose a nearby trailhead."
            case .endpointsTooClose:
                "Start and destination are too close together. Choose a more specific destination."
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
        if let error = error as? URLError {
            return error.code == .timedOut
                ? "This route is taking longer than expected. Try again, shorten the distance, or choose a nearby trailhead."
                : "TrailMind couldn’t connect. Check your network and try again."
        }
        return "TrailMind couldn’t build this route. Try again or edit the request."
    }
}

private enum PlannerGenerationIssue: Error {
    case clarification(String)
    case timedOut
}

@Observable
final class RouteEditViewModel {
    enum MessageKind {
        case user
        case copilot
    }

    struct Message: Identifiable {
        let id = UUID()
        let kind: MessageKind
        let text: String
    }

    private let plannerService: any AIPlannerService
    var route: TrailRoute
    var draft = ""
    var messages: [Message] = [
        Message(kind: .copilot, text: "I’m holding the route’s scenery, timing and safety notes together. What would you like to change?")
    ]
    var isWorking = false

    init(route: TrailRoute, plannerService: any AIPlannerService = MockAIPlannerService()) {
        self.route = route
        self.plannerService = plannerService
    }

    func send(_ instruction: String) async {
        let cleanInstruction = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanInstruction.isEmpty, !isWorking else { return }

        messages.append(Message(kind: .user, text: cleanInstruction))
        draft = ""
        isWorking = true

        do {
            try await Task.sleep(for: .milliseconds(650))
            route = try await plannerService.editRoute(route: route, instruction: cleanInstruction)
            messages.append(
                Message(
                    kind: .copilot,
                    text: "Done. I trimmed the demanding section and kept the strongest viewpoints. The revised route is \(route.distanceLabel) with \(route.elevationLabel) of climbing."
                )
            )
        } catch {
            messages.append(Message(kind: .copilot, text: "I couldn’t make that change yet. Try describing the outcome in a different way."))
        }
        isWorking = false
    }
}
