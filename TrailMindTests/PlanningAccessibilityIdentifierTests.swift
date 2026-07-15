import XCTest
@testable import TrailMind

@MainActor
final class PlanningAccessibilityIdentifierTests: XCTestCase {
    func testPlanningAccessibilityIdentifierContractIsExactAndUnique() {
        let identifiers = [
            PlanningAccessibilityID.promptInput,
            PlanningAccessibilityID.submit,
            PlanningAccessibilityID.loading,
            PlanningAccessibilityID.clarificationQuestion,
            PlanningAccessibilityID.clarificationAnswer,
            PlanningAccessibilityID.clarificationContinue,
            PlanningAccessibilityID.cancel,
            PlanningAccessibilityID.retry,
            PlanningAccessibilityID.editPrompt,
            PlanningAccessibilityID.error,
            PlanningAccessibilityID.noRoutes,
            PlanningAccessibilityID.cancelled,
            PlanningAccessibilityID.suggestions,
            PlanningAccessibilityID.startOver
        ]

        XCTAssertEqual(identifiers, [
            "composer.prompt",
            "composer.submit",
            "planning.loading",
            "planning.clarification.question",
            "planning.clarification.answer",
            "planning.clarification.continue",
            "generation.cancel",
            "planning.retry",
            "planning.editPrompt",
            "planning.error",
            "planning.noRoutes",
            "planning.cancelled",
            "planning.suggestions",
            "planning.startOver"
        ])
        XCTAssertEqual(Set(identifiers).count, identifiers.count)
        XCTAssertFalse(identifiers.contains(where: \.isEmpty))
    }
}
