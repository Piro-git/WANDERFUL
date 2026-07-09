import Foundation

protocol IntentParsingProvider: Sendable {
    var parserSource: IntentParserSource { get }

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent
}

struct LocalIntentParsingProvider: IntentParsingProvider {
    let parserSource: IntentParserSource = .localRuleBased
    private let parser: RoutePromptParser

    init(parser: RoutePromptParser = RoutePromptParser()) {
        self.parser = parser
    }

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        let parsedPrompt = try parser.parse(rawPrompt)
        return AdventureIntent(
            rawPrompt: rawPrompt,
            parsedPrompt: parsedPrompt,
            parserSource: parserSource
        )
    }
}

struct RemoteAIIntentParsingProvider: IntentParsingProvider {
    enum ProviderError: LocalizedError, Equatable {
        case notConfigured
        case invalidURL
        case invalidResponse
        case httpError(Int)

        var errorDescription: String? {
            #if DEBUG
            switch self {
            case .notConfigured:
                "Remote AI intent parsing is not configured yet."
            case .invalidURL:
                "Remote AI intent backend URL is invalid."
            case .invalidResponse:
                "Remote AI intent backend returned an invalid response."
            case let .httpError(statusCode):
                "Remote AI intent backend failed with HTTP \(statusCode)."
            }
            #else
            "Remote AI intent parsing is not configured yet."
            #endif
        }
    }

    nonisolated static let infoPlistBaseURLKey = "INTENT_BACKEND_BASE_URL"
    private static let timeoutSeconds: TimeInterval = 6

    let parserSource: IntentParserSource = .remoteAI
    private let baseURL: URL?
    private let userLocationHint: String?
    private let dataLoader: @Sendable (URLRequest) async throws -> (Data, URLResponse)

    init(
        baseURL: URL? = RemoteAIIntentParsingProvider.defaultBaseURL(),
        userLocationHint: String? = nil,
        dataLoader: @escaping @Sendable (URLRequest) async throws -> (Data, URLResponse) = { request in
            try await URLSession.shared.data(for: request)
        }
    ) {
        self.baseURL = baseURL
        self.userLocationHint = userLocationHint
        self.dataLoader = dataLoader
    }

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        guard let endpoint = endpointURL(baseURL: baseURL) else {
            throw ProviderError.notConfigured
        }

        let payload = RemoteIntentRequest(
            prompt: rawPrompt,
            locale: Self.locale(for: rawPrompt),
            userLocationHint: userLocationHint
        )
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = Self.timeoutSeconds
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await dataLoader(request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ProviderError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw ProviderError.httpError(httpResponse.statusCode)
        }

        return try JSONDecoder().decode(RemoteAdventureIntentResponse.self, from: data).adventureIntent(
            fallbackRawPrompt: rawPrompt
        )
    }

    private func endpointURL(baseURL: URL?) -> URL? {
        guard let baseURL else { return nil }
        return baseURL.appending(path: "api").appending(path: "parse-intent")
    }

    private nonisolated static func defaultBaseURL(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> URL? {
        #if DEBUG
        if let environmentValue = environment[infoPlistBaseURLKey],
           let url = usableURL(environmentValue) {
            return url
        }
        if let plistValue = bundle.object(forInfoDictionaryKey: infoPlistBaseURLKey) as? String,
           let url = usableURL(plistValue) {
            return url
        }
        return URL(string: "http://127.0.0.1:3000")
        #else
        _ = bundle
        _ = environment
        return nil
        #endif
    }

    private nonisolated static func usableURL(_ value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              !trimmed.contains("$("),
              let url = URL(string: trimmed),
              let scheme = url.scheme,
              scheme == "http" || scheme == "https"
        else {
            return nil
        }
        return url
    }

    private static func locale(for prompt: String) -> String {
        let normalized = prompt.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "de_DE")
        )
        if ["ä", "ö", "ü", "ß"].contains(where: prompt.contains)
            || ["wanderung", "rundtour", "rundwanderung", "um ", "bei ", "nach ", "zuruck", "zurück"].contains(where: normalized.contains) {
            return "de"
        }
        return "en"
    }
}

struct RemoteWithLocalFallbackIntentParsingProvider: IntentParsingProvider {
    let parserSource: IntentParserSource = .remoteAI
    private let remoteProvider: any IntentParsingProvider
    private let localProvider: LocalIntentParsingProvider
    private let validationService: IntentValidationService

    init(
        remoteProvider: any IntentParsingProvider = RemoteAIIntentParsingProvider(),
        localProvider: LocalIntentParsingProvider = LocalIntentParsingProvider(),
        validationService: IntentValidationService = IntentValidationService()
    ) {
        self.remoteProvider = remoteProvider
        self.localProvider = localProvider
        self.validationService = validationService
    }

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        do {
            return try await remoteProvider.parseIntent(rawPrompt: rawPrompt)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            return try await localProvider.parseIntent(rawPrompt: rawPrompt)
        }
    }
}

enum IntentParserMode: String, CaseIterable, Sendable {
    case localOnly
    case remoteWithLocalFallback
}

enum IntentParsingProviderFactory {
    static func makeDefaultProvider(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> any IntentParsingProvider {
        #if DEBUG
        switch debugParserMode(environment: environment) {
        case .localOnly:
            return LocalIntentParsingProvider()
        case .remoteWithLocalFallback:
            return RemoteWithLocalFallbackIntentParsingProvider()
        }
        #else
        _ = environment
        return LocalIntentParsingProvider()
        #endif
    }

    #if DEBUG
    private static func debugParserMode(environment: [String: String]) -> IntentParserMode {
        let value = environment["TRAILMIND_INTENT_PARSER_MODE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        switch value {
        case "local", "localonly", "local_only":
            return .localOnly
        default:
            return .remoteWithLocalFallback
        }
    }
    #endif
}

private struct RemoteIntentRequest: Encodable {
    let prompt: String
    let locale: String
    let userLocationHint: String?

    enum CodingKeys: String, CodingKey {
        case prompt
        case locale
        case userLocationHint
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(prompt, forKey: .prompt)
        try container.encode(locale, forKey: .locale)
        if let userLocationHint {
            try container.encode(userLocationHint, forKey: .userLocationHint)
        } else {
            try container.encodeNil(forKey: .userLocationHint)
        }
    }
}

private struct RemoteAdventureIntentResponse: Decodable {
    let activityType: String?
    let routeType: String?
    let startLocationQuery: String?
    let endLocationQuery: String?
    let regionQuery: String?
    let targetDistanceKm: Double?
    let targetDurationMinutes: Double?
    let difficulty: String?
    let desiredFeatures: [String]
    let avoidFeatures: [String]
    let transportMode: String?
    let rawPrompt: String?
    let parserSource: String?
    let confidence: Double?

    func adventureIntent(fallbackRawPrompt: String) throws -> AdventureIntent {
        guard parserSource == "remoteAI" else {
            throw RemoteAIIntentParsingProvider.ProviderError.invalidResponse
        }

        return AdventureIntent(
            rawPrompt: rawPrompt ?? fallbackRawPrompt,
            parserSource: .remoteAI,
            confidence: confidence,
            activityType: try activityTypeValue(),
            routeType: try routeTypeValue(fallbackRawPrompt: fallbackRawPrompt),
            startLocationQuery: cleanOptional(startLocationQuery),
            endLocationQuery: cleanOptional(endLocationQuery),
            regionQuery: cleanOptional(regionQuery),
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: targetDurationMinutes.map { Int($0.rounded()) },
            difficulty: difficultyValue(),
            desiredFeatures: desiredFeatures.compactMap(Self.desiredFeatureValue),
            avoidFeatures: avoidFeatures.compactMap(Self.avoidFeatureValue),
            transportMode: transportModeValue()
        )
    }

    private func activityTypeValue() throws -> ActivityType {
        switch activityType {
        case "hiking":
            return .hiking
        case "trailRunning":
            return .trailRunning
        case "biking":
            return .biking
        default:
            throw RemoteAIIntentParsingProvider.ProviderError.invalidResponse
        }
    }

    private func routeTypeValue(fallbackRawPrompt: String) throws -> TrailRouteType {
        switch routeType {
        case "loop":
            return .loop
        case "pointToPoint":
            return .pointToPoint
        case nil:
            let hasLocation = hasText(startLocationQuery) || hasText(regionQuery)
            if IntentPromptHeuristics.indicatesLoop(fallbackRawPrompt, hasLocation: hasLocation) {
                return .loop
            }
            throw RemoteAIIntentParsingProvider.ProviderError.invalidResponse
        default:
            throw RemoteAIIntentParsingProvider.ProviderError.invalidResponse
        }
    }

    private func difficultyValue() -> RouteDifficulty? {
        switch difficulty {
        case "easy":
            .easy
        case "moderate":
            .moderate
        case "hard":
            .challenging
        default:
            nil
        }
    }

    private func transportModeValue() -> TransportMode? {
        switch transportMode {
        case "walking":
            .walking
        case "cycling":
            .cycling
        default:
            nil
        }
    }

    private static func desiredFeatureValue(_ value: String) -> DesiredFeature? {
        switch value {
        case "viewpoint":
            .viewpoint
        case "forest":
            .forest
        case "water":
            .water
        case "quiet":
            .quiet
        case "sunset":
            .sunset
        default:
            nil
        }
    }

    private static func avoidFeatureValue(_ value: String) -> AvoidFeature? {
        switch value {
        case "majorRoads":
            .majorRoads
        case "steepClimbs":
            .steepClimbs
        default:
            nil
        }
    }

    private func cleanOptional(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func hasText(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

enum IntentValidationError: LocalizedError, Equatable {
    case missingLoopStartOrRegion
    case missingPointToPointStart
    case missingPointToPointEnd
    case ambiguousRouteType
    case vagueHikingRequest
    case unreasonableDistance(Double)

    var errorDescription: String? {
        switch self {
        case .missingLoopStartOrRegion:
            IntentClarificationQuestion.missingLocation
        case .missingPointToPointStart:
            IntentClarificationQuestion.missingLocation
        case .missingPointToPointEnd:
            IntentClarificationQuestion.missingEnd
        case .ambiguousRouteType:
            IntentClarificationQuestion.ambiguousRouteType
        case .vagueHikingRequest:
            IntentClarificationQuestion.vagueArea
        case .unreasonableDistance:
            "Bitte wähle eine realistische Distanz für die Route."
        }
    }
}

enum IntentValidationStatus: String, Hashable, Sendable {
    case valid
    case repaired
    case needsClarification
    case invalid
}

enum IntentMissingField: String, Hashable, Sendable {
    case routeType
    case startLocationQuery
    case endLocationQuery
    case regionQuery
}

enum IntentClarificationQuestion {
    nonisolated static let missingLocation = "Where should the route start?"
    nonisolated static let missingEnd = "Where do you want to go?"
    nonisolated static let ambiguousRouteType = "Should this be a loop or a route to a destination?"
    nonisolated static let vagueArea = "Which area should I plan around?"
}

struct IntentValidationResult: Sendable {
    let status: IntentValidationStatus
    let intentForRouting: AdventureIntent?
    let validatedIntent: ValidatedAdventureIntent?
    let repaired: Bool
    let repairReason: String?
    let missingFields: [IntentMissingField]
    let clarificationReason: String?
    let clarificationQuestion: String?
    let validationError: IntentValidationError?
}

struct IntentRepairService: Sendable {
    struct Result: Hashable, Sendable {
        let intent: AdventureIntent
        let repaired: Bool
        let repairReason: String?
    }

    func repair(_ intent: AdventureIntent) -> Result {
        var repairedIntent = intent
        var reasons: [String] = []

        if intent.routeType == .loop,
           !hasText(intent.startLocationQuery),
           hasText(intent.regionQuery) {
            repairedIntent = copy(
                intent,
                routeType: .loop,
                startLocationQuery: intent.regionQuery,
                endLocationQuery: nil,
                regionQuery: intent.regionQuery
            )
            reasons.append("Used regionQuery as startLocationQuery for loop routing.")
        }

        if repairedIntent.routeType == .pointToPoint,
           !hasText(repairedIntent.endLocationQuery),
           IntentPromptHeuristics.indicatesLoop(
                repairedIntent.rawPrompt,
                hasLocation: hasText(repairedIntent.startLocationQuery) || hasText(repairedIntent.regionQuery)
           ),
           hasText(repairedIntent.startLocationQuery) || hasText(repairedIntent.regionQuery) {
            repairedIntent = copy(
                repairedIntent,
                routeType: .loop,
                startLocationQuery: repairedIntent.startLocationQuery ?? repairedIntent.regionQuery,
                endLocationQuery: nil,
                regionQuery: repairedIntent.regionQuery
            )
            reasons.append("Repaired pointToPoint intent without an end location to loop based on loop wording.")
        }

        return Result(
            intent: repairedIntent,
            repaired: !reasons.isEmpty,
            repairReason: reasons.isEmpty ? nil : reasons.joined(separator: " ")
        )
    }

    private func copy(
        _ intent: AdventureIntent,
        routeType: TrailRouteType,
        startLocationQuery: String?,
        endLocationQuery: String?,
        regionQuery: String?
    ) -> AdventureIntent {
        AdventureIntent(
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

    private func hasText(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

enum IntentPromptHeuristics {
    static func indicatesLoop(_ prompt: String, hasLocation: Bool) -> Bool {
        let normalized = normalized(prompt)
        if ["rundwanderung", "rundweg", "rundtour", "round trip", "loop"].contains(where: normalized.contains) {
            return true
        }

        guard hasLocation else { return false }
        return matches(#"\b(?:around|near|bei|um)\s+[\p{L}\p{N}]"#, in: normalized)
    }

    static func isVagueHikingRequest(_ prompt: String) -> Bool {
        let normalized = normalized(prompt)
        let hasActivity = ["hike", "wanderung", "wandern", "route", "tour", "trailrun", "lauf"].contains(where: normalized.contains)
        let hasLocationCue = matches(#"\b(?:in|im|bei|near|around|um|from|von|nach|to|zum|zur)\s+[\p{L}\p{N}]"#, in: normalized)
        return hasActivity && !hasLocationCue
    }

    static func indicatesPointToPoint(_ prompt: String) -> Bool {
        matches(#"\b(?:from|von)\s+.+\b(?:to|nach|zum|zur)\b"#, in: normalized(prompt))
            || matches(#"\b(?:nach|to|zum|zur)\s+[\p{L}\p{N}]"#, in: normalized(prompt))
    }

    private static func normalized(_ prompt: String) -> String {
        prompt.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "de_DE")
        )
    }

    private static func matches(_ pattern: String, in value: String) -> Bool {
        value.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

struct IntentValidationService: Sendable {
    private let repairService: IntentRepairService

    init(repairService: IntentRepairService = IntentRepairService()) {
        self.repairService = repairService
    }

    func validateResult(_ intent: AdventureIntent) -> IntentValidationResult {
        let repair = repairService.repair(intent)
        let repairedIntent = repair.intent

        if let distance = repairedIntent.targetDistanceKm,
           distance <= 0 || distance > 300 {
            return IntentValidationResult(
                status: .invalid,
                intentForRouting: repair.repaired ? repairedIntent : intent,
                validatedIntent: nil,
                repaired: repair.repaired,
                repairReason: repair.repairReason,
                missingFields: [],
                clarificationReason: "unreasonableDistance",
                clarificationQuestion: nil,
                validationError: .unreasonableDistance(distance)
            )
        }

        let missingFields = missingFields(for: repairedIntent)
        guard missingFields.isEmpty else {
            let issue = clarificationIssue(for: repairedIntent, missingFields: missingFields)
            return IntentValidationResult(
                status: .needsClarification,
                intentForRouting: repair.repaired ? repairedIntent : intent,
                validatedIntent: nil,
                repaired: repair.repaired,
                repairReason: repair.repairReason,
                missingFields: missingFields,
                clarificationReason: issue.reason,
                clarificationQuestion: issue.question,
                validationError: issue.error
            )
        }

        let validated = ValidatedAdventureIntent(intent: repairedIntent)
        return IntentValidationResult(
            status: repair.repaired ? .repaired : .valid,
            intentForRouting: repairedIntent,
            validatedIntent: validated,
            repaired: repair.repaired,
            repairReason: repair.repairReason,
            missingFields: [],
            clarificationReason: nil,
            clarificationQuestion: nil,
            validationError: nil
        )
    }

    func validate(_ intent: AdventureIntent) throws -> ValidatedAdventureIntent {
        let result = validateResult(intent)
        if let validatedIntent = result.validatedIntent {
            return validatedIntent
        }

        throw result.validationError ?? IntentValidationError.vagueHikingRequest
    }

    private func missingFields(for intent: AdventureIntent) -> [IntentMissingField] {
        var missingFields: [IntentMissingField] = []

        switch intent.routeType {
        case .loop:
            if !hasText(intent.startLocationQuery) && !hasText(intent.regionQuery) {
                missingFields.append(.startLocationQuery)
                missingFields.append(.regionQuery)
            }
        case .pointToPoint:
            if !hasText(intent.startLocationQuery) {
                missingFields.append(.startLocationQuery)
            }
            if !hasText(intent.endLocationQuery) {
                missingFields.append(.endLocationQuery)
            }
        case .multiDay:
            if !hasText(intent.startLocationQuery) {
                missingFields.append(.startLocationQuery)
            }
            if !hasText(intent.endLocationQuery) {
                missingFields.append(.endLocationQuery)
            }
        }

        return missingFields
    }

    private func clarificationIssue(
        for intent: AdventureIntent,
        missingFields: [IntentMissingField]
    ) -> (reason: String, question: String, error: IntentValidationError) {
        let missingStart = missingFields.contains(.startLocationQuery)
        let missingRegion = missingFields.contains(.regionQuery)
        let missingEnd = missingFields.contains(.endLocationQuery)

        if missingStart, missingEnd {
            return (
                "vagueHikingRequest",
                IntentClarificationQuestion.vagueArea,
                .vagueHikingRequest
            )
        }

        if intent.routeType == .loop, missingStart, missingRegion {
            let question = IntentPromptHeuristics.isVagueHikingRequest(intent.rawPrompt)
                ? IntentClarificationQuestion.vagueArea
                : IntentClarificationQuestion.missingLocation
            return (
                "missingLoopStartOrRegion",
                question,
                .missingLoopStartOrRegion
            )
        }

        if missingEnd {
            return (
                "missingPointToPointEnd",
                IntentClarificationQuestion.missingEnd,
                .missingPointToPointEnd
            )
        }

        return (
            "missingPointToPointStart",
            IntentClarificationQuestion.missingLocation,
            .missingPointToPointStart
        )
    }

    private func hasText(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
