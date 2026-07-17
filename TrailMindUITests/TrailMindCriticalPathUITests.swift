import XCTest

final class TrailMindCriticalPathUITests: XCTestCase {
    private enum Scenario: String {
        case onboarding
        case core
        case failOnce = "fail-once"
        case noRoutes = "no-routes"
    }

    private let pointToPointRouteID = "11111111-1111-4111-8111-111111111111"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testOnboardingCompletesIntoDeterministicHome() {
        let app = launch(.onboarding)
        let continueButton = app.buttons["onboarding.continue"]

        XCTAssertTrue(app.staticTexts["Say what kind of day you need."].waitForExistence(timeout: 5))
        XCTAssertTrue(continueButton.exists)
        XCTAssertTrue(
            tap(continueButton, until: app.staticTexts["Compare mapped routes."]),
            "Continue should advance to the route-comparison page."
        )

        XCTAssertTrue(
            tap(continueButton, until: app.staticTexts["Plan with current local information."]),
            "Continue should advance to the planning-safety page."
        )

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
    private func launch(_ scenario: Scenario) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "--trailmind-ui-testing",
            "--trailmind-ui-scenario",
            scenario.rawValue
        ]
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
