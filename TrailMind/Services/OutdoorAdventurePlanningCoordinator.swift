import Foundation

protocol OutdoorAdventurePlanningCoordinatingV1: Sendable {
    func plan(
        intent: AdventureResearchIntentV1
    ) async throws -> OutdoorAdventurePlanningCoordinatorResultV1
}

enum OutdoorAdventurePlanningCoordinatorFailureV1:
    LocalizedError,
    Equatable,
    Sendable
{
    case unavailable
    case authorizationFailed
    case rateLimited
    case timedOut
    case rejected
    case invalidResult

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "Outdoor planning is currently unavailable."
        case .authorizationFailed:
            "TrailMind couldn’t authorize outdoor planning."
        case .rateLimited:
            "Outdoor planning is temporarily busy. Please try again."
        case .timedOut:
            "Outdoor planning took too long. Please try again."
        case .rejected:
            "TrailMind couldn’t use this planning request."
        case .invalidResult:
            "TrailMind couldn’t verify the planning result."
        }
    }

    fileprivate init(
        mapping failure: OutdoorAdventurePlanningClientFailure
    ) {
        switch failure {
        case .invalidRequest, .requestTooLarge, .rejected:
            self = .rejected
        case .unavailable:
            self = .unavailable
        case .authorizationFailed:
            self = .authorizationFailed
        case .rateLimited:
            self = .rateLimited
        case .timedOut:
            self = .timedOut
        case .invalidResponse, .responseTooLarge:
            self = .invalidResult
        }
    }
}

enum OutdoorAdventurePlanningCoordinatorResultV1 {
    case clarificationRequired(OutdoorAdventurePlanningNonRoutedStateV1)
    case unsupported(OutdoorAdventurePlanningNonRoutedStateV1)
    case noViableRoute(OutdoorAdventurePlanningNonRoutedStateV1)
    case partial(OutdoorAdventurePlanningRoutedStateV1)
    case routed(OutdoorAdventurePlanningRoutedStateV1)

    var state: OutdoorAdventurePlanningStateV1 {
        switch self {
        case .clarificationRequired:
            .clarificationRequired
        case .unsupported:
            .unsupported
        case .noViableRoute:
            .noViableRoute
        case .partial:
            .partial
        case .routed:
            .routed
        }
    }

    var normalizedIntent: AdventureResearchIntentV1 {
        switch self {
        case let .clarificationRequired(context),
             let .unsupported(context),
             let .noViableRoute(context):
            context.normalizedIntent
        case let .partial(context),
             let .routed(context):
            context.normalizedIntent
        }
    }

    var planningGaps: [OutdoorAdventurePlanningGapV1] {
        switch self {
        case let .clarificationRequired(context),
             let .unsupported(context),
             let .noViableRoute(context):
            context.planningGaps
        case let .partial(context),
             let .routed(context):
            context.planningGaps
        }
    }

    var clarificationQuestions: [AdventureResearchClarificationQuestionV1] {
        switch self {
        case let .clarificationRequired(context),
             let .unsupported(context),
             let .noViableRoute(context):
            context.clarificationQuestions
        case .partial, .routed:
            []
        }
    }

    var routeSelection: ResearchGuidedRouteSelectionV1? {
        switch self {
        case .clarificationRequired, .unsupported, .noViableRoute:
            nil
        case let .partial(context),
             let .routed(context):
            context.routeSelection
        }
    }

    fileprivate init(
        validating result: OutdoorAdventurePlanningResultV1
    ) throws {
        switch result {
        case let .clarificationRequired(context):
            guard context.state == .clarificationRequired,
                  !context.clarificationQuestions.isEmpty,
                  context.clarificationQuestions ==
                    context.normalizedIntent.unresolvedClarificationQuestions
            else {
                throw OutdoorAdventurePlanningCoordinatorFailureV1.invalidResult
            }
            self = .clarificationRequired(context)
        case let .unsupported(context):
            guard context.state == .unsupported,
                  context.clarificationQuestions.isEmpty
            else {
                throw OutdoorAdventurePlanningCoordinatorFailureV1.invalidResult
            }
            self = .unsupported(context)
        case let .noViableRoute(context):
            guard context.state == .noViableRoute,
                  context.clarificationQuestions.isEmpty
            else {
                throw OutdoorAdventurePlanningCoordinatorFailureV1.invalidResult
            }
            self = .noViableRoute(context)
        case let .partial(context):
            try Self.validateRoutedContext(
                context,
                expectedState: .partial,
                requiresEmptyPlanningGaps: false
            )
            self = .partial(context)
        case let .routed(context):
            try Self.validateRoutedContext(
                context,
                expectedState: .routed,
                requiresEmptyPlanningGaps: true
            )
            self = .routed(context)
        }
    }

    private static func validateRoutedContext(
        _ context: OutdoorAdventurePlanningRoutedStateV1,
        expectedState: OutdoorAdventurePlanningStateV1,
        requiresEmptyPlanningGaps: Bool
    ) throws {
        guard context.state == expectedState,
              !context.routeSelection.alternatives.isEmpty,
              context.routeSelection.alternatives.allSatisfy({
                  $0.suggestion.route.isVerifiedRoutedResult
              }),
              !requiresEmptyPlanningGaps || context.planningGaps.isEmpty
        else {
            throw OutdoorAdventurePlanningCoordinatorFailureV1.invalidResult
        }
    }
}

struct OutdoorAdventurePlanningCoordinatorV1:
    OutdoorAdventurePlanningCoordinatingV1,
    Sendable
{
    private let client: any OutdoorAdventurePlanningClientV1

    init(
        client: any OutdoorAdventurePlanningClientV1 =
            OutdoorAdventurePlanningClientFactory.makeDefault()
    ) {
        self.client = client
    }

    func plan(
        intent: AdventureResearchIntentV1
    ) async throws -> OutdoorAdventurePlanningCoordinatorResultV1 {
        try Task.checkCancellation()
        let result: OutdoorAdventurePlanningResultV1
        do {
            result = try await client.plan(
                OutdoorAdventurePlanningRequestV1(intent: intent)
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch let failure as OutdoorAdventurePlanningClientFailure {
            throw OutdoorAdventurePlanningCoordinatorFailureV1(
                mapping: failure
            )
        } catch {
            throw OutdoorAdventurePlanningCoordinatorFailureV1.unavailable
        }
        try Task.checkCancellation()
        return try OutdoorAdventurePlanningCoordinatorResultV1(
            validating: result
        )
    }
}
