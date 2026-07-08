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

        var errorDescription: String? {
            "Remote AI intent parsing is not configured yet."
        }
    }

    let parserSource: IntentParserSource = .remoteAI

    func parseIntent(rawPrompt: String) async throws -> AdventureIntent {
        _ = rawPrompt
        throw ProviderError.notConfigured
    }
}

enum IntentValidationError: LocalizedError, Equatable {
    case missingLoopStartOrRegion
    case missingPointToPointStart
    case missingPointToPointEnd
    case unreasonableDistance(Double)

    var errorDescription: String? {
        switch self {
        case .missingLoopStartOrRegion:
            "Bitte gib einen Startort oder eine Region für die Rundtour ein."
        case .missingPointToPointStart:
            "Bitte gib einen Startort ein."
        case .missingPointToPointEnd:
            "Bitte gib Start und Ziel ein, z.B. 'Ilsenburg nach Schierke'."
        case .unreasonableDistance:
            "Bitte wähle eine realistische Distanz für die Route."
        }
    }
}

struct IntentValidationService: Sendable {
    func validate(_ intent: AdventureIntent) throws -> ValidatedAdventureIntent {
        switch intent.routeType {
        case .loop:
            guard hasText(intent.startLocationQuery) || hasText(intent.regionQuery) else {
                throw IntentValidationError.missingLoopStartOrRegion
            }
        case .pointToPoint:
            guard hasText(intent.startLocationQuery) else {
                throw IntentValidationError.missingPointToPointStart
            }
            guard hasText(intent.endLocationQuery) else {
                throw IntentValidationError.missingPointToPointEnd
            }
        case .multiDay:
            guard hasText(intent.startLocationQuery) else {
                throw IntentValidationError.missingPointToPointStart
            }
            guard hasText(intent.endLocationQuery) else {
                throw IntentValidationError.missingPointToPointEnd
            }
        }

        if let distance = intent.targetDistanceKm,
           distance <= 0 || distance > 300
        {
            throw IntentValidationError.unreasonableDistance(distance)
        }

        return ValidatedAdventureIntent(intent: intent)
    }

    private func hasText(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
