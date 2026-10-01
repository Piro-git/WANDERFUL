import XCTest

final class RouteStaysUITests: XCTestCase {
    @MainActor
    func testCandidateSourcesAndMapAreDiscoverableWithoutPermissionClaims() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["Stay along the way"].waitForExistence(timeout: 10))
        app.buttons["View places (1)"].tap()
        XCTAssertTrue(app.staticTexts["Fixture hut"].exists)
        XCTAssertTrue(app.staticTexts["About 111 m in a straight line from the mapped path"].exists)
        let details = app.buttons["Details and sources"]
        for _ in 0..<5 where !details.isHittable { app.swipeUp() }
        details.tap()
        let source = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "OSM source · osm:node:1")).firstMatch
        for _ in 0..<6 where !source.isHittable { app.swipeUp() }
        XCTAssertTrue(source.exists)
        XCTAssertTrue(app.staticTexts["Mapped point, not a confirmed entrance."].exists)
        let map = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "View Fixture hut on map")).firstMatch
        for _ in 0..<6 where !map.isHittable { app.swipeUp() }
        XCTAssertTrue(map.isHittable)
        attach(app, "Stay source details — synthetic fixture")
    }
    @MainActor
    func testGermanAtLargestDynamicTypeAndStaleEvidence() {
        let app = launch(["--trailmind-ui-stays-de", "--trailmind-ui-stays-stale", "--trailmind-ui-accessibility-xxxl"])
        XCTAssertTrue(app.staticTexts["Unterwegs übernachten"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Älterer Datenstand – Angaben erneut prüfen."].exists)
        let places = app.buttons["Orte ansehen (1)"]
        for _ in 0..<6 where !places.isHittable { app.swipeUp() }
        XCTAssertTrue(places.isHittable)
        places.tap()
        let candidate = app.staticTexts["Fixture hut"]
        for _ in 0..<6 where !candidate.isHittable { app.swipeUp() }
        XCTAssertTrue(candidate.isHittable)
        app.swipeUp()
        attach(app, "German stays — accessibility XXXL")
    }
    @MainActor
    func testEmptyAndOfflineStatesDoNotOfferInventedPlaces() {
        for state in ["empty", "unavailable"] {
            let app = launch(["--trailmind-ui-stays-" + state])
            XCTAssertTrue(app.staticTexts["Stay along the way"].waitForExistence(timeout: 10))
            XCTAssertFalse(app.buttons["View places (1)"].exists)
            XCTAssertFalse(app.staticTexts["Fixture hut"].exists)
            attach(app, "Stays " + state)
            app.terminate()
        }
    }
    @MainActor
    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--trailmind-ui-testing", "--trailmind-ui-scenario", "core", "--trailmind-ui-evidence", "--trailmind-ui-stays"] + extra
        app.launch()
        return app
    }
    @MainActor
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
