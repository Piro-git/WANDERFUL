import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class UserPreferencesStoreTests: XCTestCase {
    func testPreferencesRoundTripThroughIsolatedStore() throws {
        let suiteName = "UserPreferencesStoreTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = UserPreferencesStore(defaults: defaults)
        let expected = UserPreferences(
            preferredActivity: .trailRunning,
            fitnessLevel: .challenging,
            preferredDistanceKilometers: 18,
            avoidsSteepClimbs: false,
            interests: ["Forest", "Quiet paths"],
            cautiousSafetyMode: true,
            prefersOfflineMaps: false,
            hapticsEnabled: true
        )

        store.save(expected)

        XCTAssertEqual(store.load(), expected)
    }

    func testInvalidPreferencesFallBackToSafeDefaults() throws {
        let suiteName = "UserPreferencesStoreTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(Data("not-json".utf8), forKey: UserPreferencesStore.defaultKey)

        let store = UserPreferencesStore(defaults: defaults)

        XCTAssertEqual(store.load(), UserPreferences())
    }
}
