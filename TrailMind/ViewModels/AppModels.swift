import CoreLocation
import Foundation
import Observation

@Observable
final class AppModel {
    var savedRouteIDs: Set<UUID> = [MockRoutes.luneburgLoop.id]
    var preferences = UserPreferences()

    func isSaved(_ route: TrailRoute) -> Bool {
        savedRouteIDs.contains(route.id)
    }

    func toggleSaved(_ route: TrailRoute) {
        if savedRouteIDs.contains(route.id) {
            savedRouteIDs.remove(route.id)
        } else {
            savedRouteIDs.insert(route.id)
        }
    }
}

@Observable
final class PlannerViewModel {
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
    private var requestKind: RequestKind = .mockSuggestions

    var phase: Phase = .home
    var prompt = ""
    var suggestions: [RouteSuggestion] = []
    var generatedRoute: TrailRoute?
    var generationStep = 0
    var errorMessage: String?
    var suggestionNotice: String?

    var generationMessages: [String] {
        switch requestKind {
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
                "Finding start and destination",
                "Calculating the outdoor route",
                "Preparing map and elevation"
            ]
        }
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
        routingCoordinator: any RoutingCoordinating = RoutingCoordinator()
    ) {
        self.plannerService = plannerService
        self.intentParsingProvider = intentParsingProvider
        self.intentValidationService = intentValidationService
        self.geocodingService = geocodingService
        self.routingCoordinator = routingCoordinator
    }

    func startPlanning(prompt: String) {
        beginPlanning(prompt: prompt, requestKind: .mockSuggestions)
    }

    func startTextRoute(prompt: String) {
        beginPlanning(prompt: prompt, requestKind: .dynamicRoute)
    }

    private func beginPlanning(prompt: String, requestKind: RequestKind) {
        self.prompt = prompt
        self.requestKind = requestKind
        generationStep = 0
        errorMessage = nil
        suggestionNotice = nil
        generatedRoute = nil
        suggestions = []
        phase = .generating
    }

    func generate() async {
        guard phase == .generating else { return }

        do {
            switch requestKind {
            case .mockSuggestions:
                try await generateMockSuggestions()
            case .dynamicRoute:
                try await generateDynamicRoute()
            }
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
            phase = .home
        }
    }

    private func generateMockSuggestions() async throws {
        for index in generationMessages.indices {
            generationStep = index
            try await Task.sleep(for: .milliseconds(index == 0 ? 500 : 650))
        }

        let intent = try await plannerService.parseAdventurePrompt(prompt: prompt)
        let routes = try await plannerService.generateRouteSuggestions(intent: intent)
        suggestions = routes.enumerated().map { index, route in
            RouteSuggestion(
                route: route,
                matchScore: max(96 - index * 5, 80),
                explanation: route.whyItMatches
            )
        }
        phase = .suggestions
    }

    private func generateDynamicRoute() async throws {
        generationStep = 0
        let parsedIntent = try await intentParsingProvider.parseIntent(rawPrompt: prompt)
        let validationResult = intentValidationService.validateResult(parsedIntent)
        guard let validatedIntent = validationResult.validatedIntent else {
            errorMessage = validationResult.clarificationQuestion
                ?? validationResult.validationError?.localizedDescription
                ?? IntentClarificationQuestion.vagueArea
            phase = .home
            return
        }
        let planningRequest = RoutePlanningRequest(validatedIntent: validatedIntent)
        try await Task.sleep(for: .milliseconds(250))

        generationStep = 1
        let start = try await geocodingService.geocodeLocation(planningRequest.startQuery)
        let end: Coordinate?
        if let endQuery = planningRequest.endQuery {
            let geocodedEnd = try await geocodingService.geocodeLocation(
                endQuery,
                near: start
            )
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
        try Task.checkCancellation()

        generationStep = 2
        let routingResult = try await routingCoordinator.routeSuggestions(
            for: RouteIntent(
                request: planningRequest,
                start: start,
                end: end,
                parsedIntent: validatedIntent
            )
        )

        generationStep = 3
        try await Task.sleep(for: .milliseconds(300))
        suggestionNotice = routingResult.notice
        let intentDebugMetadata = RouteIntentDebugMetadata(
            intent: validatedIntent,
            validationStatus: validationResult.status.rawValue,
            repaired: validationResult.repaired,
            repairReason: validationResult.repairReason,
            missingFields: validationResult.missingFields.map(\.rawValue),
            clarificationQuestion: validationResult.clarificationQuestion,
            geocodedStartLabel: planningRequest.startQuery,
            geocodedEndLabel: planningRequest.endQuery
        )
        let debugSuggestions = routingResult.suggestions.map { suggestion in
            RouteSuggestion(
                id: suggestion.id,
                route: suggestion.route.withIntentDebugMetadata(intentDebugMetadata),
                matchScore: suggestion.matchScore,
                explanation: suggestion.explanation,
                debugMetadata: suggestion.debugMetadata
            )
        }

        if debugSuggestions.count > 1 {
            suggestions = debugSuggestions
            phase = .suggestions
            return
        }

        guard let route = debugSuggestions.first?.route else {
            throw GraphHopperError.noRouteFound
        }
        generatedRoute = route
        phase = .home
    }

    func consumeGeneratedRoute() -> TrailRoute? {
        defer { generatedRoute = nil }
        return generatedRoute
    }

    func dismissError() {
        errorMessage = nil
    }

    func reset() {
        prompt = ""
        suggestions = []
        generatedRoute = nil
        errorMessage = nil
        suggestionNotice = nil
        requestKind = .mockSuggestions
        phase = .home
    }
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
