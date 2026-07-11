import Foundation
@testable import TrailMind

struct IntentEvalFixture: Decodable, Sendable {
    let prompt: String
    let activityType: String?
    let routeType: String?
    let startLocationQuery: String?
    let endLocationQuery: String?
    let regionQuery: String?
    let targetDistanceKm: Double?
    let targetDurationMinutes: Int?
    let difficulty: String?
    let desiredFeatures: [String]
    let avoidFeatures: [String]
    let shouldNeedClarification: Bool
    let expectedClarificationType: String?

    static func load(from testFilePath: String = #filePath) throws -> [IntentEvalFixture] {
        let testFile = URL(fileURLWithPath: testFilePath)
        let fixtureURL = testFile
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("prompt_intent_eval.json")
        let data = try Data(contentsOf: fixtureURL)
        return try JSONDecoder().decode([IntentEvalFixture].self, from: data)
    }
}

struct IntentEvalCaseResult: Sendable {
    let fixture: IntentEvalFixture
    let passed: Bool
    let failedFields: [String]
    let parserSource: IntentParserSource?
    let validationStatus: IntentValidationStatus
    let clarificationReason: String?
    let parseError: String?

    var needsClarification: Bool {
        validationStatus == .needsClarification
    }

    var usedRemoteAI: Bool {
        parserSource == .remoteAI
    }

    var usedFallback: Bool {
        parserSource == .localRuleBased
    }
}

struct IntentEvalSummary: Sendable {
    let label: String
    let results: [IntentEvalCaseResult]

    var total: Int { results.count }
    var passed: Int { results.filter(\.passed).count }
    var failed: Int { total - passed }
    var remoteAISuccessCount: Int { results.filter(\.usedRemoteAI).count }
    var fallbackCount: Int { results.filter(\.usedFallback).count }
    var clarificationCount: Int { results.filter(\.needsClarification).count }

    var mostCommonFailedFields: [(field: String, count: Int)] {
        let counts = results
            .flatMap(\.failedFields)
            .reduce(into: [String: Int]()) { partial, field in
                partial[field, default: 0] += 1
            }
        return counts
            .map { ($0.key, $0.value) }
            .sorted { first, second in
                if first.1 == second.1 {
                    return first.0 < second.0
                }
                return first.1 > second.1
            }
    }

    func formatted(maxFailures: Int = 12) -> String {
        var lines = [
            "Intent Eval: \(label)",
            "total prompts: \(total)",
            "passed: \(passed)",
            "failed: \(failed)",
            "remoteAI success count: \(remoteAISuccessCount)",
            "fallback count: \(fallbackCount)",
            "clarification count: \(clarificationCount)"
        ]

        let commonFields = mostCommonFailedFields
        if commonFields.isEmpty {
            lines.append("most common failed fields: none")
        } else {
            let fields = commonFields
                .map { "\($0.field)=\($0.count)" }
                .joined(separator: ", ")
            lines.append("most common failed fields: \(fields)")
        }

        let failures = results.filter { !$0.passed }.prefix(maxFailures)
        if failures.isEmpty {
            lines.append("failures: none")
        } else {
            lines.append("failures:")
            for failure in failures {
                let fields = failure.failedFields.isEmpty ? "unknown" : failure.failedFields.joined(separator: ", ")
                lines.append("- \(failure.fixture.prompt) [\(fields)]")
                if let parseError = failure.parseError {
                    lines.append("  parseError: \(parseError)")
                }
            }
        }

        return lines.joined(separator: "\n")
    }
}

@MainActor
struct IntentEvaluator {
    private let validationService: IntentValidationService

    init(validationService: IntentValidationService = IntentValidationService()) {
        self.validationService = validationService
    }

    func evaluate(
        fixtures: [IntentEvalFixture],
        provider: any IntentParsingProvider,
        label: String
    ) async -> IntentEvalSummary {
        var results: [IntentEvalCaseResult] = []
        for fixture in fixtures {
            results.append(await evaluate(fixture: fixture, provider: provider))
        }
        return IntentEvalSummary(label: label, results: results)
    }

    private func evaluate(
        fixture: IntentEvalFixture,
        provider: any IntentParsingProvider
    ) async -> IntentEvalCaseResult {
        do {
            let intent = try await provider.parseIntent(rawPrompt: fixture.prompt)
            let result = validationService.validateResult(intent)
            let failedFields = compare(fixture: fixture, result: result)
            return IntentEvalCaseResult(
                fixture: fixture,
                passed: failedFields.isEmpty,
                failedFields: failedFields,
                parserSource: intent.parserSource,
                validationStatus: result.status,
                clarificationReason: result.clarificationReason,
                parseError: nil
            )
        } catch {
            let failedFields = parseErrorFields(fixture: fixture, error: error)
            return IntentEvalCaseResult(
                fixture: fixture,
                passed: failedFields.isEmpty,
                failedFields: failedFields,
                parserSource: nil,
                validationStatus: fixture.shouldNeedClarification ? .needsClarification : .invalid,
                clarificationReason: fixture.shouldNeedClarification ? fixture.expectedClarificationType : nil,
                parseError: String(describing: error)
            )
        }
    }

    private func compare(
        fixture: IntentEvalFixture,
        result: IntentValidationResult
    ) -> [String] {
        if fixture.shouldNeedClarification {
            var failedFields: [String] = []
            if result.status != .needsClarification {
                failedFields.append("validationStatus")
            }
            if result.clarificationReason != fixture.expectedClarificationType {
                failedFields.append("clarificationReason")
            }
            return failedFields
        }

        guard let intent = result.validatedIntent else {
            return ["validatedIntent"]
        }

        var failedFields: [String] = []
        append(&failedFields, "activityType", actual: intent.activityType.rawValue, expected: fixture.activityType)
        append(&failedFields, "routeType", actual: intent.routeType.rawValue, expected: fixture.routeType)
        append(&failedFields, "startLocationQuery", actual: intent.startLocationQuery, expected: fixture.startLocationQuery)
        append(&failedFields, "endLocationQuery", actual: intent.endLocationQuery, expected: fixture.endLocationQuery)
        append(&failedFields, "regionQuery", actual: intent.regionQuery, expected: fixture.regionQuery)
        append(&failedFields, "targetDistanceKm", actual: intent.targetDistanceKm, expected: fixture.targetDistanceKm)
        append(&failedFields, "targetDurationMinutes", actual: intent.targetDurationMinutes, expected: fixture.targetDurationMinutes)
        append(&failedFields, "difficulty", actual: intent.difficulty?.rawValue, expected: fixture.difficulty)
        append(&failedFields, "desiredFeatures", actual: intent.desiredFeatures.map(\.rawValue), expected: fixture.desiredFeatures)
        append(&failedFields, "avoidFeatures", actual: intent.avoidFeatures.map(\.rawValue), expected: fixture.avoidFeatures)
        return failedFields
    }

    private func parseErrorFields(fixture: IntentEvalFixture, error: Error) -> [String] {
        if fixture.shouldNeedClarification,
           fixture.expectedClarificationType == "vagueHikingRequest",
           error is RoutePromptParserError {
            return []
        }

        if fixture.shouldNeedClarification,
           fixture.expectedClarificationType == "missingPointToPointEnd",
           error is RoutePromptParserError {
            return []
        }

        return fixture.shouldNeedClarification ? ["clarificationReason"] : ["parseError"]
    }

    private func append(_ failedFields: inout [String], _ field: String, actual: String?, expected: String?) {
        if actual != expected {
            failedFields.append(field)
        }
    }

    private func append(_ failedFields: inout [String], _ field: String, actual: Double?, expected: Double?) {
        switch (actual, expected) {
        case (.none, .none):
            return
        case let (.some(actual), .some(expected)) where abs(actual - expected) < 0.01:
            return
        default:
            failedFields.append(field)
        }
    }

    private func append(_ failedFields: inout [String], _ field: String, actual: Int?, expected: Int?) {
        if actual != expected {
            failedFields.append(field)
        }
    }

    private func append(_ failedFields: inout [String], _ field: String, actual: [String], expected: [String]) {
        if actual != expected {
            failedFields.append(field)
        }
    }
}
