import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class AppLanguageTests: XCTestCase {
    func testSelectionPersistsAcrossControllers() throws {
        let suiteName = "AppLanguageTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let controller = AppLanguageController(defaults: defaults)
        XCTAssertFalse(controller.hasChosenLanguage)

        controller.select(.german)

        XCTAssertEqual(controller.language, .german)
        XCTAssertTrue(controller.hasChosenLanguage)
        XCTAssertEqual(AppLanguageController(defaults: defaults).language, .german)
    }

    func testStoredLanguageWinsOverSystemDefault() throws {
        let suiteName = "AppLanguageTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(AppLanguage.english.rawValue, forKey: AppLanguageController.storageKey)

        XCTAssertEqual(AppLanguageController(defaults: defaults).language, .english)
    }

    func testLanguageCanBeChangedAfterFirstSelection() throws {
        let suiteName = "AppLanguageTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let controller = AppLanguageController(defaults: defaults)

        controller.select(.german)
        controller.select(.english)

        XCTAssertTrue(controller.hasChosenLanguage)
        XCTAssertEqual(controller.language, .english)
        XCTAssertEqual(AppLanguageController(defaults: defaults).language, .english)
    }

    func testHomeExampleTitlesFollowTheSelectedInterfaceLanguage() throws {
        let examples = Dictionary(uniqueKeysWithValues: HomeView.routeExamples.map { ($0.id, $0) })
        let loop = try XCTUnwrap(examples["loop"])
        let pointToPoint = try XCTUnwrap(examples["pointToPoint"])
        let trailRun = try XCTUnwrap(examples["trailRun"])
        let bike = try XCTUnwrap(examples["bike"])

        XCTAssertEqual(loop.displayTitle(for: .german), "15-km-Rundweg")
        XCTAssertEqual(pointToPoint.displayTitle(for: .german), "Streckenwanderung")
        XCTAssertEqual(trailRun.displayTitle(for: .german), "2-stündiger Trailrun")
        XCTAssertEqual(bike.displayTitle(for: .german), "Radtour")
        XCTAssertEqual(loop.displayTitle(for: .english), "15 km loop")
    }
}
