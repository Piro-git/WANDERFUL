import XCTest

final class DynamicEvidenceUITests: XCTestCase {
    @MainActor
    func testRevisionKeepsExcludedStopOutOfFinalListAndPreservesOriginalResearch() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["Stops on this route"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["1. Offline source fixture 1"].exists)
        XCTAssertFalse(app.staticTexts["4. Earlier ridge (offline fixture)"].exists)
        revealSources("osm:node:2", in: app)
        XCTAssertTrue(app.staticTexts["route.evidence.osm:node:2"].label.contains("No web passage reliably linked"))
        for _ in 0..<4 where !app.buttons["route.evidence.originalResearch"].isHittable { app.swipeUp() }
        app.buttons["route.evidence.originalResearch"].tap()
        XCTAssertTrue(app.staticTexts["Web research with Google"].waitForExistence(timeout: 5))
        // SwiftUI reports this medium-weight label as Other on some iOS 26 runtimes.
        let excluded = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "Not on this route: Earlier ridge (offline fixture)")
        ).firstMatch
        for _ in 0..<4 where !excluded.isHittable { app.swipeUp() }
        XCTAssertTrue(excluded.exists)
        XCTAssertTrue(excluded.isHittable)
        XCTAssertTrue(app.staticTexts["Web research with Google"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Revised route — offline fixture"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testMissingAndExpiredEvidenceNeverShowsAWebConfirmation() {
        for mode in ["--trailmind-ui-evidence-missing", "--trailmind-ui-evidence-expired"] {
            let app = launch(extra: [mode])
            XCTAssertTrue(app.staticTexts["Stops on this route"].waitForExistence(timeout: 10))
            revealSources("osm:node:1", in: app)
            XCTAssertTrue(app.staticTexts["route.evidence.osm:node:1"].label.contains("Web evidence unavailable"))
            app.swipeUp()
            XCTAssertFalse(app.buttons["route.evidence.originalResearch"].exists)
            app.terminate()
        }
    }

    @MainActor
    func testSourceOnlyResearchHasNoInventedPassagesOrSuggestionsInEitherLanguage() {
        for (language, title, description) in [
            ("de", "Web-Recherche mit Google", "In der Recherche genannt und gelesen. Die Quelle ist keinem bestimmten Satz zugeordnet."),
            ("en", "Web research with Google", "Cited and read during research. The source is not linked to a specific sentence.")
        ] {
            for largeText in [false, true] {
                let extra = ["--trailmind-ui-evidence-source-only"] + (largeText ? ["--trailmind-ui-accessibility-xxxl"] : [])
                let app = launch(extra: extra, language: language)
                let research = app.buttons["route.evidence.originalResearch"]
                for _ in 0..<8 where !research.isHittable { app.swipeUp() }
                XCTAssertTrue(research.waitForExistence(timeout: 5))
                research.tap()
                XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 5))
                let sources = app.buttons["route.evidence.sources"]
                for _ in 0..<8 where !sources.isHittable { app.swipeUp() }
                XCTAssertTrue(sources.waitForExistence(timeout: 5))
                sources.tap()
                let reference = app.staticTexts["route.evidence.sourceScope.0.0"]
                for _ in 0..<6 where !reference.isHittable { app.swipeUp() }
                XCTAssertEqual(reference.label, description)
                XCTAssertTrue(reference.isHittable)
                XCTAssertFalse(app.staticTexts["Selected map record."].exists)
                XCTAssertEqual(app.webViews.count, 0, "No provider HTML was supplied in this synthetic response.")
                let attachment = XCTAttachment(screenshot: app.screenshot())
                attachment.name = "Source reference without sentence span · " + language + (largeText ? " · largest text" : "")
                attachment.lifetime = .keepAlways
                add(attachment)
                app.terminate()
            }
        }
    }

    @MainActor
    func testSuppliedSearchSuggestionsRemainAccessibleInEitherLanguage() {
        for language in ["de", "en"] {
            let app = launch(language: language)
            let research = app.buttons["route.evidence.originalResearch"]
            for _ in 0..<8 where !research.isHittable { app.swipeUp() }
            XCTAssertTrue(research.waitForExistence(timeout: 5))
            research.tap()
            let suggestions = app.webViews.firstMatch
            for _ in 0..<8 where !suggestions.isHittable { app.swipeUp() }
            XCTAssertTrue(suggestions.waitForExistence(timeout: 5))
            XCTAssertTrue(suggestions.staticTexts["Offline Google suggestions fixture"].waitForExistence(timeout: 5))
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "Supplied suggestions HTML · " + language
            attachment.lifetime = .keepAlways
            add(attachment)
            app.terminate()
        }
    }

    @MainActor
    func testPreparationUsesSelectedLanguageAndPackingControls() {
        for (language, title, water, packed, camping) in [
            ("de", "Packen & vorbereiten", "Wasser & Trinkflaschen", "Gepackt", "Übernachtung im Zelt"),
            ("en", "Pack & prepare", "Water & carrying bottles", "Packed", "Overnight · camping")
        ] {
            let app = launch(extra: ["--trailmind-ui-preparation"], language: language)
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 10))
            let stay = app.buttons["preparation.stay"]
            XCTAssertTrue(stay.exists)
            stay.tap()
            app.buttons[camping].tap()
            let item = app.buttons["preparation.item.water"]
            for _ in 0..<6 where !item.isHittable { app.swipeUp() }
            XCTAssertEqual(item.label, water)
            item.tap()
            XCTAssertEqual(item.value as? String, packed)
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "Packing list · " + language
            attachment.lifetime = .keepAlways
            add(attachment)
            app.terminate()
        }
    }

    @MainActor
    func testPreparationSurvivesRestartAndLanguageChange() {
        let arguments = ["--trailmind-ui-preparation", "--trailmind-ui-preparation-persistence"]
        let app = launch(extra: arguments, language: "de")
        XCTAssertTrue(app.navigationBars["Packen & vorbereiten"].waitForExistence(timeout: 10))
        let water = app.buttons["preparation.item.water"]
        for _ in 0..<6 where !water.isHittable { app.swipeUp() }
        if water.value as? String != "Gepackt" { water.tap() }
        XCTAssertEqual(water.value as? String, "Gepackt")
        app.terminate()
        let reopened = launch(extra: arguments, language: "en")
        XCTAssertTrue(reopened.navigationBars["Pack & prepare"].waitForExistence(timeout: 10))
        let restored = reopened.buttons["preparation.item.water"]
        for _ in 0..<6 where !restored.isHittable { reopened.swipeUp() }
        XCTAssertEqual(restored.label, "Water & carrying bottles")
        XCTAssertEqual(restored.value as? String, "Packed")
        reopened.terminate()
    }

    @MainActor
    func testLongPhotoCreditInBothLanguagesAtLargestTextSize() {
        for (language, title, source) in [
            ("de", "Fotoquelle", "Original auf Wikimedia Commons"),
            ("en", "Photo source", "Original on Wikimedia Commons")
        ] {
            let app = launch(extra: ["--trailmind-ui-photo-source", "--trailmind-ui-accessibility-xxxl",
                "-UIAccessibilityReduceMotionEnabled", "YES"], language: language)
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 10))
            let credit = app.staticTexts["route.commons.credit"]
            XCTAssertTrue(credit.exists)
            XCTAssertTrue(credit.label.hasSuffix("Credit ends here."))
            let upper = XCTAttachment(screenshot: app.screenshot())
            upper.name = "Photo credit top · " + language
            upper.lifetime = .keepAlways
            add(upper)
            let original = app.buttons[source]
            for _ in 0..<12 where !original.isHittable { app.swipeUp() }
            XCTAssertTrue(original.isHittable)
            let license = app.buttons["CC BY-SA 4.0"]
            for _ in 0..<3 where !license.isHittable { app.swipeUp() }
            XCTAssertTrue(license.isHittable)
            let lower = XCTAttachment(screenshot: app.screenshot())
            lower.name = "Photo credit links · " + language
            lower.lifetime = .keepAlways
            add(lower)
            app.terminate()
        }
    }

    @MainActor
    private func revealSources(_ stopID: String, in app: XCUIApplication) {
        let button = app.descendants(matching: .any).matching(identifier: "route.sources." + stopID).firstMatch
        for _ in 0..<5 where !button.isHittable { app.swipeUp() }
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
    }

    @MainActor
    private func launch(extra: [String] = [], language: String = "en") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--trailmind-ui-testing", "--trailmind-ui-scenario", "core", "--trailmind-ui-evidence", "-wanderful.interfaceLanguage", language] + extra
        app.launch()
        return app
    }
}
