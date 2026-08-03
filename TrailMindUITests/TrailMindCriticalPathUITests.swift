import XCTest

final class TrailMindCriticalPathUITests: XCTestCase {
    private enum Scenario: String {
        case onboarding
        case core
        case failOnce = "fail-once"
        case noRoutes = "no-routes"
        case researchComplete = "research-complete"
        case researchPartial = "research-partial"
        case researchFallback = "research-fallback"
        case researchClarification = "research-clarification"
    }

    private let pointToPointRouteID = "11111111-1111-4111-8111-111111111111"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testOnboardingCompletesIntoDeterministicHome() {
        let app = launch(.onboarding)
        let continueButton = app.buttons["onboarding.continue"]

        XCTAssertTrue(app.staticTexts["Your next adventure, built around you."].waitForExistence(timeout: 5))
        XCTAssertTrue(continueButton.exists)
        XCTAssertTrue(
            tap(continueButton, until: app.staticTexts["How do you like to move?"]),
            "The welcome action should advance to activity personalization."
        )

        app.buttons["onboarding.activity.hiking"].tap()
        continueButton.tap()
        XCTAssertTrue(app.staticTexts["What feels like a good day out?"].waitForExistence(timeout: 5))

        app.buttons["onboarding.distance.15"].tap()
        continueButton.tap()
        XCTAssertTrue(app.staticTexts["How much challenge do you enjoy?"].waitForExistence(timeout: 5))

        app.buttons["onboarding.effort.moderate"].tap()
        continueButton.tap()
        XCTAssertTrue(app.staticTexts["What should your request prioritize?"].waitForExistence(timeout: 5))

        app.buttons["onboarding.interest.views"].tap()
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["Real routes. Clear limits."].waitForExistence(timeout: 5),
            "Continue should advance to the planning-safety step."
        )

        continueButton.tap()
        XCTAssertTrue(app.staticTexts["Your route planner is ready."].waitForExistence(timeout: 5))
        XCTAssertTrue(waitForLabel("Start planning", on: continueButton))
        XCTAssertTrue(
            tap(continueButton, until: app.buttons["home.typeInstead"]),
            "Start planning should finish onboarding at Home."
        )
    }

    @MainActor
    func testPointToPointPlanningOpensVerifiedRouteActions() {
        let app = launch(.core)

        openPointToPointRoute(in: app)

        XCTAssertTrue(element("route.detail", in: app).exists)
        XCTAssertTrue(app.buttons["route.saveToggle"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["route.exportGPX"].waitForExistence(timeout: 5))
        XCTAssertFalse(element("route.unverifiedNotice", in: app).exists)
    }

    @MainActor
    func testComposerExposesADescriptiveRouteRequestElement() {
        let app = launch(.core)
        let prompt = openComposer(in: app)

        XCTAssertEqual(prompt.label, "Route request")
        XCTAssertTrue(prompt.isHittable)
    }

    @MainActor
    func testLoopPlanningShowsThreeDistinctMappedOptions() {
        let app = launch(.core)

        tapHomeExample(
            "home.example.loop",
            in: app,
            until: element("planning.suggestions", in: app)
        )
        XCTAssertTrue(app.staticTexts["Ilsenburg North Loop"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Ilsenburg South Loop"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Ilsenburg Ridge Loop"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testResearchCompleteShowsCardFitHighlightsAndEvidenceSummary() {
        let app = launch(.researchComplete)

        openLoopResearchRoute(in: app)

        XCTAssertTrue(
            element("research.detail.evidenceSummary", in: app)
                .waitForExistence(timeout: 5)
        )
        XCTAssertTrue(
            element("research.detail.fitReasons", in: app).exists
        )
        XCTAssertTrue(
            element("research.detail.highlights", in: app).exists
        )
        let routeShapeReason = element(
            "research.detail.fitReasons.routeShape",
            in: app
        )
        XCTAssertTrue(routeShapeReason.exists)
        XCTAssertTrue(
            routeShapeReason.label.contains(
                "The verified route returns to its start point."
            )
        )
        let firstHighlight = element(
            "research.detail.highlight.0",
            in: app
        )
        XCTAssertTrue(firstHighlight.exists)
        XCTAssertTrue(
            firstHighlight.label.contains(
                "Researched place on this routed path"
            )
        )
        XCTAssertFalse(
            element("research.detail.limitations", in: app).exists
        )
    }

    @MainActor
    func testResearchPartialShowsCalmBoundedLimitations() {
        let app = launch(.researchPartial)

        openLoopResearchRoute(in: app)

        let limitations = app.staticTexts["What to check"]
        XCTAssertTrue(
            waitUntilHittable(limitations, in: app, maximumSwipes: 14)
        )
        XCTAssertTrue(
            app.staticTexts[
                "Official access information wasn’t available."
            ].exists
        )
        let showAll = app.buttons[
            "research.detail.limitations.showAll"
        ]
        XCTAssertTrue(waitUntilHittable(showAll, in: app, maximumSwipes: 14))
        showAll.tap()
        XCTAssertTrue(
            app.staticTexts[
                "Highlighted places are mapped, but current status wasn’t verified."
            ].waitForExistence(timeout: 5)
        )
    }

    @MainActor
    func testResearchPartialSupportsAccessibilityDynamicType() {
        let app = launch(
            .researchPartial,
            extraArguments: [
                "-UIPreferredContentSizeCategoryName",
                "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge"
            ]
        )

        openLoopResearchRoute(in: app)

        XCTAssertTrue(
            element("research.detail.evidenceSummary", in: app)
                .waitForExistence(timeout: 5)
        )
        let limitations = app.staticTexts["What to check"]
        XCTAssertTrue(
            waitUntilHittable(limitations, in: app, maximumSwipes: 20)
        )
        XCTAssertTrue(
            app.staticTexts[
                "Official access information wasn’t available."
            ].exists
        )
    }

    @MainActor
    func testResearchFallbackKeepsStandardRouteUsefulWithoutResearchBadge() {
        let app = launch(.researchFallback)

        tapHomeExample(
            "home.example.loop",
            in: app,
            until: element("planning.suggestions", in: app)
        )
        XCTAssertTrue(
            app.staticTexts[
                "A standard routed option was built because research-guided matching was unavailable."
            ].waitForExistence(timeout: 5)
        )
        XCTAssertFalse(
            element("research.card.summary", in: app).exists
        )

        openRoute(
            titled: "Ilsenburg North Loop",
            in: app
        )
        XCTAssertTrue(
            app.staticTexts["Standard routed option"]
                .waitForExistence(timeout: 5)
        )
        XCTAssertFalse(
            element("research.detail.highlights", in: app).exists
        )
    }

    @MainActor
    func testResearchClarificationExplainsWhySpecificLocationMatters() {
        let app = launch(.researchClarification)

        tapHomeExample(
            "home.example.loop",
            in: app,
            until: element("planning.clarification.question", in: app)
        )
        XCTAssertTrue(
            element("research.clarification", in: app)
                .waitForExistence(timeout: 5)
        )
        XCTAssertTrue(
            app.staticTexts[
                "A precise starting place helps TrailMind research places that can connect to a real routed option."
            ].exists
        )
    }

    @MainActor
    func testMissingLocationClarificationContinuesWithoutNetwork() {
        let app = launch(.core)
        let prompt = openComposer(in: app)
        prompt.tap()
        prompt.typeText("Plan a 12 km loop")
        dismissKeyboardIfPresent(in: app)

        let submit = app.buttons["composer.submit"]
        XCTAssertTrue(waitUntilHittable(submit, in: app))
        XCTAssertTrue(
            tap(
                submit,
                until: element("planning.clarification.question", in: app),
                timeout: 8
            )
        )
        let answer = element("planning.clarification.answer", in: app)
        XCTAssertTrue(answer.exists)
        answer.tap()
        answer.typeText("Ilsenburg")
        dismissKeyboardIfPresent(in: app)

        let continueButton = app.buttons["planning.clarification.continue"]
        XCTAssertTrue(waitUntilHittable(continueButton, in: app))
        XCTAssertTrue(
            tap(continueButton, until: element("planning.suggestions", in: app), timeout: 8)
        )
        XCTAssertTrue(app.staticTexts["Ilsenburg North Loop"].exists)
    }

    @MainActor
    func testRecoverableFailureRetriesToSuccess() {
        let app = launch(.failOnce)

        tapHomeExample(
            "home.example.pointToPoint",
            in: app,
            until: element("planning.error", in: app)
        )

        let retry = app.buttons["planning.retry"]
        XCTAssertTrue(retry.exists)
        XCTAssertTrue(
            tap(retry, until: element("planning.suggestions", in: app), timeout: 8)
        )
        XCTAssertTrue(app.staticTexts["Ilsenburg to Schierke Route"].exists)
    }

    @MainActor
    func testNoRouteRecoveryOffersRetryAndEdit() {
        let app = launch(.noRoutes)

        tapHomeExample(
            "home.example.loop",
            in: app,
            until: element("planning.noRoutes", in: app)
        )
        XCTAssertTrue(app.buttons["planning.retry"].exists)
        XCTAssertTrue(app.buttons["planning.editPrompt"].exists)
    }

    @MainActor
    func testSaveReopenAndDeleteUsesOnlyInMemoryUITestStore() {
        let app = launch(.core)
        openPointToPointRoute(in: app)

        let saveButton = app.buttons["route.saveToggle"]
        XCTAssertTrue(saveButton.waitForExistence(timeout: 5))
        XCTAssertTrue(tap(saveButton, untilLabel: "Remove from saved routes"))

        let savedTab = app.tabBars.buttons["Saved"]
        XCTAssertTrue(savedTab.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(savedTab, until: element("saved.populatedState", in: app), timeout: 8)
        )

        let savedRoute = app.buttons["saved.route.\(pointToPointRouteID)"]
        XCTAssertTrue(savedRoute.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(savedRoute, until: element("route.detail", in: app)),
            "The saved route row should reopen its route detail."
        )

        let backButton = app.navigationBars.buttons["Saved"]
        XCTAssertTrue(backButton.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(backButton, until: element("saved.populatedState", in: app))
        )

        let remove = app.buttons["saved.remove.\(pointToPointRouteID)"]
        XCTAssertTrue(remove.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(remove, until: element("saved.emptyState", in: app), timeout: 8)
        )
    }

    @MainActor
    func testGPXExportPresentsSystemHandoff() {
        let app = launch(.core)
        openPointToPointRoute(in: app)

        let export = app.buttons["route.exportGPX"]
        XCTAssertTrue(export.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntilHittable(export, in: app, maximumSwipes: 14))

        let shareSheet = element("route.gpxShareSheet", in: app)
        XCTAssertTrue(
            tap(export, until: shareSheet, timeout: 10),
            "Export should hand the generated GPX file to the system share sheet."
        )
    }

    @MainActor
    private func launch(
        _ scenario: Scenario,
        extraArguments: [String] = []
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--trailmind-ui-testing",
            "--trailmind-ui-scenario",
            scenario.rawValue
        ] + extraArguments
        app.launch()
        return app
    }

    @MainActor
    private func tapHomeExample(
        _ identifier: String,
        in app: XCUIApplication,
        until destination: XCUIElement
    ) {
        let example = app.buttons[identifier]
        XCTAssertTrue(example.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntilHittable(example, in: app, maximumSwipes: 4))
        XCTAssertTrue(
            tap(example, until: destination, timeout: 8),
            "The selected route example should enter its expected planning state."
        )
    }

    @MainActor
    private func openComposer(in app: XCUIApplication) -> XCUIElement {
        let typeInstead = app.buttons["home.typeInstead"]
        XCTAssertTrue(typeInstead.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntilHittable(typeInstead, in: app, maximumSwipes: 3))

        let prompt = app.textViews["composer.prompt"]
        XCTAssertTrue(
            tap(typeInstead, until: prompt),
            "Type instead should present the prompt composer."
        )
        return prompt
    }

    @MainActor
    private func openPointToPointRoute(in app: XCUIApplication) {
        tapHomeExample(
            "home.example.pointToPoint",
            in: app,
            until: element("planning.suggestions", in: app)
        )

        let routeTitle = app.staticTexts["Ilsenburg to Schierke Route"]
        XCTAssertTrue(routeTitle.waitForExistence(timeout: 5))
        let routeLink = app.buttons.containing(.staticText, identifier: "Ilsenburg to Schierke Route").firstMatch
        XCTAssertTrue(routeLink.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(routeLink, until: element("route.detail", in: app), timeout: 8),
            "The suggestion card should open its route detail."
        )
    }

    @MainActor
    private func openLoopResearchRoute(in app: XCUIApplication) {
        tapHomeExample(
            "home.example.loop",
            in: app,
            until: element("planning.suggestions", in: app)
        )
        XCTAssertTrue(
            element("research.card.summary", in: app)
                .waitForExistence(timeout: 5)
        )
        openRoute(titled: "Ilsenburg North Loop", in: app)
    }

    @MainActor
    private func openRoute(
        titled title: String,
        in app: XCUIApplication
    ) {
        let routeTitle = app.staticTexts[title]
        XCTAssertTrue(routeTitle.waitForExistence(timeout: 5))
        let routeLink = app.buttons
            .containing(.staticText, identifier: title)
            .firstMatch
        XCTAssertTrue(routeLink.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(
                routeLink,
                until: element("route.detail", in: app),
                timeout: 8
            ),
            "The research route card should open its route detail."
        )
    }

    @MainActor
    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)[identifier]
    }

    @MainActor
    private func waitForLabel(
        _ label: String,
        on element: XCUIElement,
        timeout: TimeInterval = 5
    ) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == %@", label),
            object: element
        )
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    @MainActor
    private func waitUntilHittable(
        _ element: XCUIElement,
        in app: XCUIApplication,
        maximumSwipes: Int = 8
    ) -> Bool {
        if element.isHittable { return true }

        for _ in 0..<maximumSwipes {
            app.swipeUp()
            if element.isHittable { return true }
        }
        return false
    }

    @MainActor
    private func tap(
        _ control: XCUIElement,
        until destination: XCUIElement,
        attempts: Int = 2,
        timeout: TimeInterval = 4
    ) -> Bool {
        if destination.exists { return true }

        for _ in 0..<attempts {
            guard control.exists, control.isHittable else { return false }
            control.tap()
            if destination.waitForExistence(timeout: timeout) { return true }
        }
        return false
    }

    @MainActor
    private func tap(
        _ control: XCUIElement,
        untilLabel label: String,
        attempts: Int = 2,
        timeout: TimeInterval = 4
    ) -> Bool {
        if control.label == label { return true }

        for _ in 0..<attempts {
            guard control.exists, control.isHittable else { return false }
            control.tap()
            if waitForLabel(label, on: control, timeout: timeout) { return true }
        }
        return false
    }

    @MainActor
    private func dismissKeyboardIfPresent(in app: XCUIApplication) {
        guard app.keyboards.firstMatch.exists else { return }

        let semanticDone = app.buttons["composer.keyboardDone"]
        if semanticDone.waitForExistence(timeout: 2) {
            semanticDone.tap()
            XCTAssertTrue(
                app.keyboards.firstMatch.waitForNonExistence(timeout: 2),
                "The semantic Done action should dismiss the keyboard."
            )
            return
        }

        let hideKeyboard = app.keyboards.buttons["Hide keyboard"]
        if hideKeyboard.exists {
            hideKeyboard.tap()
            return
        }

        XCTFail("No deterministic keyboard-dismiss action was available.")
    }
}
