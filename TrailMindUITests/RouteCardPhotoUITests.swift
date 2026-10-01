import XCTest

final class RouteCardPhotoUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor
    func testSourceActionIsSeparateFromNavigationInBothLanguages() {
        for (language, sourceTitle, caption) in [
            ("en", "Photo source", "Photo of a route stop:"),
            ("de", "Fotoquelle", "Foto eines Routenstopps:")
        ] {
            let app = launch(language: language)
            let source = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "route.card.photoSource.")).firstMatch
            XCTAssertTrue(source.waitForExistence(timeout: 10))
            for _ in 0..<5 where !source.isHittable { app.swipeUp() }
            XCTAssertTrue(source.isHittable)
            XCTAssertGreaterThanOrEqual(source.frame.height, 44)
            let route = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "route.open.")).firstMatch
            XCTAssertTrue(route.label.contains(caption))
            XCTAssertTrue(source.label.contains("Synthetic fixture author"))
            capture(app, "Card photo · " + language)
            source.tap()
            XCTAssertTrue(app.navigationBars[sourceTitle].waitForExistence(timeout: 5))
            XCTAssertTrue(app.staticTexts["Synthetic stop · offline image fixture"].exists)
            XCTAssertTrue(app.staticTexts["route.commons.credit"].label.contains("Synthetic fixture author"))
            capture(app, "Card source · " + language)
            app.buttons[language == "de" ? "Fertig" : "Done"].tap()
            for _ in 0..<5 where !route.isHittable { app.swipeDown() }
            route.tap()
            XCTAssertTrue(app.scrollViews["route.detail"].waitForExistence(timeout: 5))
            app.terminate()
        }
    }

    @MainActor
    func testRouteCopyAndStatisticsUseSelectedLanguage() {
        for (language, distance, climb, duration, limitation) in [
            ("de", "Strecke", "Aufstieg", "Dauer", "Technische Wegschwierigkeit unbekannt"),
            ("en", "distance", "climb", "Duration", "Technical trail difficulty data unavailable")
        ] {
            let app = launch(language: language)
            let route = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "route.open.")).firstMatch
            XCTAssertTrue(route.waitForExistence(timeout: 10))
            XCTAssertTrue(route.label.contains(distance))
            XCTAssertTrue(route.label.contains(climb))
            XCTAssertTrue(route.label.contains(limitation))
            XCTAssertFalse(route.label.contains("GraphHopper"))
            route.tap()
            XCTAssertTrue(app.scrollViews["route.detail"].waitForExistence(timeout: 5))
            let summary = app.staticTexts["route.quality.summary"]
            for _ in 0..<5 where !summary.isHittable { app.swipeUp() }
            XCTAssertTrue(summary.exists)
            XCTAssertTrue(summary.label.contains(language == "de" ? "Route berechnet:" : "Route calculated:"))
            XCTAssertFalse(summary.label.contains("GraphHopper"))
            XCTAssertTrue(app.staticTexts[duration].exists)
            capture(app, "Localized route detail · " + language)
            app.terminate()
        }
    }

    @MainActor
    func testFallbacksAndPendingImageKeepRouteNavigable() {
        for mode in ["none", "invalid", "offline", "corrupt", "slow"] {
            let app = launch(extra: ["--card-photo-" + mode])
            let route = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "route.open.")).firstMatch
            XCTAssertTrue(route.waitForExistence(timeout: 8))
            XCTAssertFalse(route.label.contains("Photo of a route stop:"))
            XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "route.card.photoSource.")).firstMatch.exists)
            capture(app, "Map fallback · " + mode)
            route.tap()
            XCTAssertTrue(app.scrollViews["route.detail"].waitForExistence(timeout: 5))
            app.terminate()
        }
    }

    @MainActor
    func testLargestGermanTextKeepsSourceReachable() {
        let app = launch(language: "de", extra: ["--trailmind-ui-accessibility-xxxl", "-UIAccessibilityReduceMotionEnabled", "YES"])
        let source = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "route.card.photoSource.")).firstMatch
        for _ in 0..<12 where !source.isHittable { app.swipeUp() }
        XCTAssertTrue(source.waitForExistence(timeout: 8))
        XCTAssertTrue(source.isHittable)
        capture(app, "Card photo · de largest type")
        source.tap()
        XCTAssertTrue(app.navigationBars["Fotoquelle"].waitForExistence(timeout: 5))
        let credit = app.staticTexts["route.commons.credit"]
        for _ in 0..<6 where !credit.isHittable { app.swipeUp() }
        XCTAssertTrue(credit.isHittable)
        XCTAssertGreaterThan(credit.frame.height, 100, "The sheet must retain the requested accessibility text size.")
        capture(app, "Card source · de largest type")
    }

    @MainActor
    private func launch(language: String = "en", extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--trailmind-ui-testing", "--trailmind-ui-scenario", "core",
            "--trailmind-ui-evidence", "--trailmind-ui-card-photo", "-wanderful.interfaceLanguage", language] + extra
        app.launch()
        return app
    }

    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
