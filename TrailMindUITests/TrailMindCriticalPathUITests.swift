import XCTest

final class TrailMindCriticalPathUITests: XCTestCase {
    private enum Scenario: String {
        case onboarding
        case onboardingLoading = "onboarding-loading"
        case core
        case failOnce = "fail-once"
        case noRoutes = "no-routes"
        case researchComplete = "research-complete"
        case researchPartial = "research-partial"
        case researchFallback = "research-fallback"
        case researchClarification = "research-clarification"
        case guidance
        case guidanceOffRoute = "guidance-off-route"
        case guidanceComplete = "guidance-complete"
        case guidanceDenied = "guidance-denied"
        case guidanceDirect = "guidance-direct"
    }

    private let pointToPointRouteID = "11111111-1111-4111-8111-111111111111"
    private let accessibilityStressArguments = [
        "--trailmind-ui-accessibility-xxxl",
        "--trailmind-ui-dark-mode",
        "-UIAccessibilityDarkerSystemColorsEnabled",
        "YES",
        "-UIAccessibilityReduceMotionEnabled",
        "YES"
    ]

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testOnboardingCompletesIntoDeterministicHome() {
        let app = launch(.onboarding)
        let continueButton = app.buttons["onboarding.continue"]

        XCTAssertTrue(
            app.staticTexts["Your perfect day, mapped."]
                .waitForExistence(timeout: 5)
        )
        XCTAssertTrue(continueButton.exists)
        XCTAssertTrue(
            tap(continueButton, until: app.staticTexts["How do you want to move outside?"]),
            "The welcome action should advance to activity personalization."
        )

        XCTAssertTrue(app.buttons["onboarding.activity.unknown"].exists)
        app.buttons["onboarding.activity.hiking"].tap()
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["What feels like a comfortable hiking day?"]
                .waitForExistence(timeout: 5)
        )

        XCTAssertTrue(app.buttons["onboarding.distance.unknown"].exists)
        app.buttons["onboarding.distance.15"].tap()
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["How should the route come together?"]
                .waitForExistence(timeout: 5)
        )

        XCTAssertTrue(app.buttons["onboarding.route-shape.unknown"].exists)
        app.buttons["onboarding.route-shape.loop"].tap()
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["Your hiking day is taking shape."]
                .waitForExistence(timeout: 5)
        )

        XCTAssertTrue(app.buttons["onboarding.avoidance.unknown"].exists)
        app.buttons["onboarding.avoidance.steep-climbs"].tap()
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["What makes a day outside feel worth it?"]
                .waitForExistence(timeout: 5)
        )

        XCTAssertTrue(app.buttons["onboarding.interest.unknown"].exists)
        app.buttons["onboarding.interest.views"].tap()
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["Routed options. Honest guidance."].waitForExistence(timeout: 5),
            "Continue should advance to the planning-safety step."
        )

        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["Meet the starting point for your adventures."]
                .waitForExistence(timeout: 5)
        )
        XCTAssertTrue(waitForLabel("Plan my first route", on: continueButton))
        XCTAssertTrue(
            tap(continueButton, until: app.buttons["home.typeInstead"]),
            "Plan my first route should finish onboarding at Home."
        )
    }

    @MainActor
    func testOnboardingComfortCopyAdaptsAcrossEverySupportedActivity() {
        let app = launch(.onboarding)
        let continueButton = app.buttons["onboarding.continue"]
        XCTAssertTrue(continueButton.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(continueButton, until: app.buttons["onboarding.activity.hiking"])
        )

        let activityPaths = [
            ("hiking", "What feels like a comfortable hiking day?"),
            ("trail-running", "What feels like a comfortable trail-running day?"),
            ("biking", "What feels like a comfortable ride?")
        ]

        for (activityID, expectedTitle) in activityPaths {
            let activity = app.buttons["onboarding.activity.\(activityID)"]
            XCTAssertTrue(activity.waitForExistence(timeout: 5))
            activity.tap()
            continueButton.tap()
            XCTAssertTrue(app.staticTexts[expectedTitle].waitForExistence(timeout: 5))

            let backButton = app.buttons["onboarding.back"]
            XCTAssertTrue(backButton.waitForExistence(timeout: 5))
            backButton.tap()
            XCTAssertTrue(
                app.staticTexts["How do you want to move outside?"]
                    .waitForExistence(timeout: 5)
            )
        }

        app.buttons["onboarding.activity.unknown"].tap()
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["What feels like a comfortable day?"]
                .waitForExistence(timeout: 5)
        )
    }

    @MainActor
    func testOnboardingUnknownPathKeepsEveryPlanningDefaultOpen() {
        let app = launch(.onboarding)
        let continueButton = app.buttons["onboarding.continue"]
        XCTAssertTrue(continueButton.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(continueButton, until: app.buttons["onboarding.activity.unknown"])
        )

        let unknownSteps = [
            "onboarding.activity.unknown",
            "onboarding.distance.unknown",
            "onboarding.route-shape.unknown",
            "onboarding.avoidance.unknown",
            "onboarding.interest.unknown"
        ]

        for unknownID in unknownSteps {
            let unknown = app.buttons[unknownID]
            XCTAssertTrue(unknown.waitForExistence(timeout: 5), "Missing \(unknownID)")
            unknown.tap()
            continueButton.tap()
        }

        XCTAssertTrue(app.staticTexts["Routed options. Honest guidance."].waitForExistence(timeout: 5))
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["Open by default, ready for your request"]
                .waitForExistence(timeout: 5)
        )
        let unsetValueCount = app.staticTexts.allElementsBoundByIndex
            .filter { $0.label == "Not set" }
            .count
        XCTAssertGreaterThanOrEqual(unsetValueCount, 5)
    }

    @MainActor
    func testOnboardingExplicitNoneRemainsDistinctFromUnknownInRecap() {
        let app = launch(.onboarding)
        let continueButton = app.buttons["onboarding.continue"]
        XCTAssertTrue(continueButton.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(continueButton, until: app.buttons["onboarding.activity.unknown"])
        )

        for unknownID in [
            "onboarding.activity.unknown",
            "onboarding.distance.unknown",
            "onboarding.route-shape.unknown"
        ] {
            let unknown = app.buttons[unknownID]
            XCTAssertTrue(unknown.waitForExistence(timeout: 5))
            unknown.tap()
            continueButton.tap()
        }

        let noAvoidances = app.buttons["onboarding.avoidance.none"]
        XCTAssertTrue(noAvoidances.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntilHittable(noAvoidances, in: app))
        noAvoidances.tap()
        continueButton.tap()

        let noExperiences = app.buttons["onboarding.interest.none"]
        XCTAssertTrue(noExperiences.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntilHittable(noExperiences, in: app))
        noExperiences.tap()
        continueButton.tap()

        XCTAssertTrue(app.staticTexts["Routed options. Honest guidance."].waitForExistence(timeout: 5))
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["Meet the starting point for your adventures."]
                .waitForExistence(timeout: 5)
        )
        let explicitNoneCount = app.staticTexts.allElementsBoundByIndex
            .filter { $0.label == "None selected" }
            .count
        XCTAssertGreaterThanOrEqual(explicitNoneCount, 2)
    }

    @MainActor
    func testOnboardingSupportsAccessibilityDynamicType() {
        let app = launch(
            .onboarding,
            extraArguments: [
                "-UIPreferredContentSizeCategoryName",
                "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge"
            ]
        )
        let continueButton = app.buttons["onboarding.continue"]
        XCTAssertTrue(continueButton.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntilHittable(continueButton, in: app))
        XCTAssertTrue(
            tap(continueButton, until: app.buttons["onboarding.activity.unknown"])
        )

        for unknownID in [
            "onboarding.activity.unknown",
            "onboarding.distance.unknown",
            "onboarding.route-shape.unknown",
            "onboarding.avoidance.unknown",
            "onboarding.interest.unknown"
        ] {
            let unknown = app.buttons[unknownID]
            XCTAssertTrue(unknown.waitForExistence(timeout: 5), "Missing \(unknownID)")
            XCTAssertTrue(waitUntilHittable(unknown, in: app, maximumSwipes: 12))
            unknown.tap()
            XCTAssertTrue(waitUntilHittable(continueButton, in: app, maximumSwipes: 12))
            continueButton.tap()
        }

        XCTAssertTrue(app.staticTexts["Routed options. Honest guidance."].waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntilHittable(continueButton, in: app, maximumSwipes: 12))
        continueButton.tap()
        XCTAssertTrue(
            app.staticTexts["Open by default, ready for your request"]
                .waitForExistence(timeout: 5)
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
        for title in [
            "Ilsenburg North Loop",
            "Ilsenburg South Loop",
            "Ilsenburg Ridge Loop"
        ] {
            XCTAssertTrue(routeAction(titled: title, in: app).waitForExistence(timeout: 5))
        }
    }

    @MainActor
    func testRouteComparisonRemainsReadableAndReachableAtAccessibilityXXXL() {
        let app = launch(
            .core,
            extraArguments: [
                "--trailmind-ui-accessibility-xxxl"
            ]
        )

        tapHomeExample(
            "home.example.loop",
            in: app,
            until: element("planning.suggestions", in: app)
        )

        let requestSummary = app.staticTexts[
            "Built around “15 km Rundwanderung um Ilsenburg”"
        ]
        XCTAssertTrue(requestSummary.waitForExistence(timeout: 5))
        XCTAssertEqual(
            requestSummary.identifier,
            "planning.requestSummary"
        )
        let routeButton = routeAction(titled: "Ilsenburg North Loop", in: app)
        XCTAssertTrue(routeButton.waitForExistence(timeout: 5))
        for expectedPart in [
            "Ilsenburg North Loop",
            "Comparison:",
            "Hiking, Moderate physical effort estimate",
            "330 m climb",
            "time",
            "Important limitation:"
        ] {
            XCTAssertTrue(
                routeButton.label.contains(expectedPart),
                "The single route action should include \(expectedPart). Actual label: \(routeButton.label)"
            )
        }
        XCTAssertTrue(
            routeButton.label.contains("14.8 km distance")
                || routeButton.label.contains("14,8 km distance"),
            "The route action should preserve the measured distance using the active locale. Actual label: \(routeButton.label)"
        )
        XCTAssertEqual(
            app.buttons
                .matching(NSPredicate(format: "identifier == %@", routeButton.identifier))
                .count,
            1
        )
        XCTAssertEqual(routeButton.descendants(matching: .button).count, 0)
        for measuredTerm in ["distance", "climb", "time"] {
            XCTAssertEqual(
                routeButton.label.components(separatedBy: measuredTerm).count - 1,
                1,
                "The single route action should announce \(measuredTerm) exactly once. Actual label: \(routeButton.label)"
            )
        }

        let startOver = app.buttons["planning.startOver"]
        XCTAssertTrue(waitUntilHittable(startOver, in: app, maximumSwipes: 24))
    }

    @MainActor
    func testNativePrivacyAndHelpRemainReachableWithoutConfiguredWebLinks() {
        let app = launch(.core)
        let profile = app.tabBars.buttons["Profile"]
        XCTAssertTrue(profile.waitForExistence(timeout: 5))
        profile.tap()

        let privacy = element("about.destination.privacyAndData", in: app)
        XCTAssertTrue(waitUntilHittable(privacy, in: app, maximumSwipes: 16))
        privacy.tap()
        XCTAssertTrue(app.navigationBars["Privacy & data"].waitForExistence(timeout: 5))
        XCTAssertFalse(element("about.link.privacyPolicy", in: app).exists)

        app.navigationBars.buttons["Profile"].tap()
        let help = element("about.destination.helpAndSafety", in: app)
        XCTAssertTrue(waitUntilHittable(help, in: app, maximumSwipes: 16))
        help.tap()
        XCTAssertTrue(app.navigationBars["Help & safety"].waitForExistence(timeout: 5))
        XCTAssertFalse(element("about.link.supportWebsite", in: app).exists)
    }

    @MainActor
    func testAppStoreVisualQAAtStandardSizeInLight() {
        exerciseAppStoreVisualPath(
            label: "standard-light",
            extraArguments: ["--trailmind-ui-light-mode"]
        )
    }

    @MainActor
    func testAppStoreVisualQAAtStandardSizeInDark() {
        exerciseAppStoreVisualPath(
            label: "standard-dark",
            extraArguments: ["--trailmind-ui-dark-mode"]
        )
    }

    @MainActor
    func testAppStoreVisualQAAtAccessibilityXXXLInLight() {
        exerciseAppStoreVisualPath(
            label: "accessibility-xxxl-light",
            extraArguments: [
                "--trailmind-ui-accessibility-xxxl",
                "--trailmind-ui-light-mode"
            ]
        )
    }

    @MainActor
    func testAppStoreVisualQAAtAccessibilityXXXLInDarkIncreasedContrastReducedMotion() {
        exerciseAppStoreVisualPath(
            label: "accessibility-xxxl-dark-increased-contrast-reduced-motion",
            extraArguments: accessibilityStressArguments
        )
    }

    @MainActor
    func testOnboardingAndSuperwallLoadingVisualQAUnderAccessibilityStress() {
        let loadingApp = launch(
            .onboardingLoading,
            extraArguments: accessibilityStressArguments
        )
        let loading = loadingApp.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Preparing onboarding"))
            .firstMatch
        XCTAssertTrue(loading.waitForExistence(timeout: 5))
        captureScreen(named: "superwall-loading-accessibility-stress")

        let onboardingApp = launch(
            .onboarding,
            extraArguments: accessibilityStressArguments
        )
        let welcome = onboardingApp.staticTexts["Your perfect day, mapped."]
        XCTAssertTrue(welcome.waitForExistence(timeout: 5))
        captureScreen(named: "native-onboarding-accessibility-stress")

        let continueButton = onboardingApp.buttons["onboarding.continue"]
        XCTAssertTrue(continueButton.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(
                continueButton,
                until: onboardingApp.staticTexts["How do you want to move outside?"]
            )
        )
        captureScreen(named: "native-onboarding-choice-accessibility-stress")
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
                "A precise starting place helps Wanderful research places that can connect to a real routed option."
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
        XCTAssertTrue(routeAction(titled: "Ilsenburg North Loop", in: app).exists)
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
        XCTAssertTrue(routeAction(titled: "Ilsenburg to Schierke Route", in: app).exists)
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
    func testRouteGuidanceStartPermissionPauseResumeAndEnd() {
        let app = launch(.guidance)
        openPointToPointRoute(in: app)

        let purpose = element("route.guidancePermissionPurpose", in: app)
        XCTAssertTrue(purpose.waitForExistence(timeout: 5))
        XCTAssertTrue(
            purpose.label.contains("only while the guidance screen is open")
        )

        let start = app.buttons["route.startGuidance"]
        XCTAssertTrue(waitUntilHittable(start, in: app, maximumSwipes: 12))
        XCTAssertTrue(
            tap(start, until: element("guidance.screen", in: app), timeout: 8)
        )

        let pause = app.buttons["guidance.pause"]
        XCTAssertTrue(pause.waitForExistence(timeout: 8))
        XCTAssertTrue(element("guidance.mapSummary", in: app).exists)
        XCTAssertTrue(element("guidance.safety", in: app).exists)
        captureScreen(named: "route-guidance-normal")

        let resume = app.buttons["guidance.resume"]
        XCTAssertTrue(
            tap(pause, until: resume, timeout: 5),
            "Pausing guidance should expose the resume control."
        )
        XCTAssertTrue(
            tap(resume, until: app.buttons["guidance.pause"], timeout: 5),
            "Resuming guidance should restore the pause control."
        )

        app.buttons["guidance.end"].tap()
        // iOS 26 can expose the SwiftUI destructive alert action through both
        // its legacy and modern accessibility representations.
        let confirmation = app.alerts.buttons["End Route"].firstMatch
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        confirmation.tap()
        XCTAssertTrue(element("guidance.ended", in: app).waitForExistence(timeout: 5))
    }

    @MainActor
    func testRouteGuidanceShowsAndCapturesOffRouteWarning() {
        let app = launch(.guidanceOffRoute)
        openPointToPointRoute(in: app)
        startRouteGuidance(in: app)

        let warning = element("guidance.offRouteWarning", in: app)
        XCTAssertTrue(warning.waitForExistence(timeout: 8))
        XCTAssertTrue(warning.label.contains("may be off route"))
        XCTAssertTrue(warning.label.contains("Progress is paused"))
        captureScreen(named: "route-guidance-off-route")
    }

    @MainActor
    func testRouteGuidanceShowsExplicitCompletion() {
        let app = launch(.guidanceComplete)
        openPointToPointRoute(in: app)
        startRouteGuidance(in: app)

        let completion = element("guidance.completion", in: app)
        XCTAssertTrue(completion.waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Route complete"].exists)
        XCTAssertTrue(app.buttons["guidance.done"].exists)
        captureScreen(named: "route-guidance-completion")
    }

    @MainActor
    func testRouteGuidanceDeniedPermissionSurfaceRemainsUsable() {
        let deniedApp = launch(.guidanceDenied)
        openPointToPointRoute(in: deniedApp)
        startRouteGuidance(in: deniedApp)
        XCTAssertTrue(
            element("guidance.blocked", in: deniedApp)
                .waitForExistence(timeout: 5)
        )
        XCTAssertTrue(deniedApp.buttons["guidance.openSettings"].exists)
    }

    @MainActor
    func testRouteGuidanceAccessibilitySurfacesRemainUsable() {
        let accessibleApp = launch(
            .guidanceDirect,
            extraArguments: accessibilityStressArguments
        )

        let pause = accessibleApp.buttons["guidance.pause"]
        XCTAssertTrue(pause.waitForExistence(timeout: 8))
        XCTAssertGreaterThanOrEqual(pause.frame.height, 44)
        XCTAssertTrue(element("guidance.mapSummary", in: accessibleApp).exists)
        XCTAssertTrue(
            element("guidance.safety", in: accessibleApp)
                .waitForExistence(timeout: 5)
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
    private func exerciseAppStoreVisualPath(
        label: String,
        extraArguments: [String]
    ) {
        let app = launch(.core, extraArguments: extraArguments)
        XCTAssertTrue(app.buttons["home.example.loop"].waitForExistence(timeout: 5))
        captureScreen(named: "\(label)-home")

        tapHomeExample(
            "home.example.loop",
            in: app,
            until: element("planning.suggestions", in: app)
        )
        XCTAssertTrue(
            routeAction(titled: "Ilsenburg North Loop", in: app)
                .waitForExistence(timeout: 5)
        )
        captureScreen(named: "\(label)-route-suggestions")

        openRoute(titled: "Ilsenburg North Loop", in: app)
        captureScreen(named: "\(label)-route-detail")

        let profile = app.tabBars.buttons["Profile"]
        XCTAssertTrue(profile.waitForExistence(timeout: 5))
        profile.tap()
        captureScreen(named: "\(label)-profile")

        let privacy = element("about.destination.privacyAndData", in: app)
        XCTAssertTrue(waitUntilHittable(privacy, in: app, maximumSwipes: 20))
        privacy.tap()
        XCTAssertTrue(app.navigationBars["Privacy & data"].waitForExistence(timeout: 5))
        captureScreen(named: "\(label)-privacy-and-data")

        app.navigationBars.buttons["Profile"].tap()
        let help = element("about.destination.helpAndSafety", in: app)
        XCTAssertTrue(waitUntilHittable(help, in: app, maximumSwipes: 20))
        help.tap()
        XCTAssertTrue(app.navigationBars["Help & safety"].waitForExistence(timeout: 5))
        captureScreen(named: "\(label)-help-and-safety")
    }

    @MainActor
    private func captureScreen(named name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
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
        centerHomeExampleHorizontallyIfNeeded(example, in: app)
        XCTAssertTrue(
            tap(example, until: destination, timeout: 8),
            "The selected route example should enter its expected planning state."
        )
    }

    @MainActor
    private func centerHomeExampleHorizontallyIfNeeded(
        _ example: XCUIElement,
        in app: XCUIApplication
    ) {
        guard app.scrollViews.count > 1 else { return }
        let examplesCarousel = app.scrollViews.element(boundBy: 1)
        let viewport = app.windows.firstMatch.frame

        for _ in 0..<4 {
            let midpoint = example.frame.midX
            guard midpoint < viewport.minX || midpoint > viewport.maxX else {
                return
            }
            examplesCarousel.swipeLeft()
        }
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

        let routeLink = routeAction(
            titled: "Ilsenburg to Schierke Route",
            in: app
        )
        XCTAssertTrue(routeLink.waitForExistence(timeout: 5))
        XCTAssertTrue(
            tap(routeLink, until: element("route.detail", in: app), timeout: 8),
            "The suggestion card should open its route detail."
        )
    }

    @MainActor
    private func startRouteGuidance(in app: XCUIApplication) {
        let start = app.buttons["route.startGuidance"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        XCTAssertTrue(waitUntilHittable(start, in: app, maximumSwipes: 12))
        XCTAssertTrue(
            tap(start, until: element("guidance.screen", in: app), timeout: 8)
        )
    }

    @MainActor
    private func openLoopResearchRoute(in app: XCUIApplication) {
        tapHomeExample(
            "home.example.loop",
            in: app,
            until: element("planning.suggestions", in: app)
        )
        let routeLink = routeAction(titled: "Ilsenburg North Loop", in: app)
        XCTAssertTrue(routeLink.waitForExistence(timeout: 5))
        XCTAssertTrue(
            routeLink.label.contains("Verified evidence:")
                || routeLink.label.contains("Important limitation:")
        )
        openRoute(titled: "Ilsenburg North Loop", in: app)
    }

    @MainActor
    private func openRoute(
        titled title: String,
        in app: XCUIApplication
    ) {
        let routeLink = routeAction(titled: title, in: app)
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
    private func routeAction(
        titled title: String,
        in app: XCUIApplication
    ) -> XCUIElement {
        app.buttons
            .matching(
                NSPredicate(
                    format: "identifier BEGINSWITH %@",
                    "route.open."
                )
            )
            .matching(NSPredicate(format: "label BEGINSWITH %@", title))
            .firstMatch
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
