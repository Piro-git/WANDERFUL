import Foundation
import XCTest
@testable import TrailMind

final class HikePreparationTests: XCTestCase {
    private func input(_ id: UUID = UUID(), hiking: Bool = true, distance: Double = 8, hours: Double = 2) -> PreparationInput {
        .init(routeID: id, isHiking: hiking, distanceKM: distance, durationHours: hours)
    }
    func testDayCampingAndHutHaveDistinctSleepingKit() {
        let route = input()
        let day = PreparationCatalogue.items(for: route, stay: .day)
        let camping = PreparationCatalogue.items(for: route, stay: .camping)
        let hut = PreparationCatalogue.items(for: route, stay: .hut)
        XCTAssertFalse(day.contains { $0.group == .overnight })
        XCTAssertTrue(day.contains { $0.id == "shelter" })
        XCTAssertTrue(camping.contains { $0.id == "tent" })
        XCTAssertTrue(camping.contains { $0.id == "sleep" })
        XCTAssertFalse(hut.contains { $0.id == "tent" || $0.id == "sleep" })
        XCTAssertTrue(hut.contains { $0.id == "hutKit" })
        XCTAssertEqual(Set(camping.map(\.id)).count, camping.count)
    }
    func testMeasuredLongerOutingAddsFoodWithoutWeatherInference() {
        let short = PreparationCatalogue.items(for: input(), stay: .day)
        let long = PreparationCatalogue.items(for: input(hours: 5), stay: .day)
        XCTAssertFalse(short.contains { $0.id == "meal" })
        XCTAssertTrue(long.contains { $0.id == "meal" })
        XCTAssertTrue(long.first { $0.id == "water" }!.reason.contains("unverified"))
        XCTAssertTrue(long.allSatisfy { $0.source != nil })
        XCTAssertEqual(PreparationCatalogue.items(for: input(hiking: false), stay: .camping), [])
    }
    func testContextReconciliationPreservesCheckedExcludedAndCustomItemsAcrossTripStyles() {
        let route = input()
        var state = PreparationCatalogue.reconcile(.init(routeID: route.routeID), input: route)
        state.statuses["water"] = .packed
        state.add("Camera")
        let customID = state.customItems[0].id
        state.statuses[customID] = .packed
        state.stay = .camping
        state = PreparationCatalogue.reconcile(state, input: route)
        XCTAssertTrue(state.revisionNotice)
        XCTAssertEqual(state.status("water"), .packed)
        XCTAssertEqual(state.status("tent"), .unpacked)
        state.statuses["tent"] = .packed
        state.statuses["sleep"] = .excluded
        state.stay = .day
        state = PreparationCatalogue.reconcile(state, input: route)
        state.stay = .camping
        state = PreparationCatalogue.reconcile(state, input: route)
        XCTAssertEqual(state.status("tent"), .packed)
        XCTAssertEqual(state.status("sleep"), .excluded)
        XCTAssertEqual(state.status(customID), .packed)
        XCTAssertEqual(state.customItems[0].label, "Camera")
        let other = PreparationCatalogue.reconcile(state, input: input())
        XCTAssertTrue(other.customItems.isEmpty)
        XCTAssertEqual(other.status("water"), .unpacked)
    }
    func testContextReconciliationPrunesStaleStatusesButKeepsKnownHiddenItems() {
        let route = input()
        var state = PreparationState(routeID: route.routeID)
        state.statuses["tent"] = .packed
        state.statuses["obsolete.item"] = .excluded
        state.stay = .day

        state = PreparationCatalogue.reconcile(state, input: route)

        XCTAssertEqual(state.status("tent"), .packed)
        XCTAssertNil(state.statuses["obsolete.item"])
    }
    func testExclusionDoesNotCountAsPackingAndEmptyListIsNotCompletion() {
        let route = input()
        let items = PreparationCatalogue.items(for: route, stay: .day)
        var state = PreparationState(routeID: route.routeID)
        state.statuses[items[0].id] = .packed
        state.statuses[items[1].id] = .excluded
        XCTAssertEqual(state.progress(items: items).packed, 1)
        XCTAssertEqual(state.progress(items: items).total, items.count - 1)
        for item in items { state.statuses[item.id] = .excluded }
        XCTAssertEqual(state.progress(items: items).total, 0)
        XCTAssertEqual(state.progress(items: items).packed, 0)
    }
    func testGermanAndEnglishLabelsKeepCatalogueIDsAndCustomTextStable() {
        let route = input()
        let items = PreparationStay.allCases.flatMap { PreparationCatalogue.items(for: route, stay: $0) } + PreparationAddition.allCases.map(\.item)
        for item in items {
            XCTAssertNotEqual(item.localizedLabel(locale: Locale(identifier: "de")), item.label, item.id)
            XCTAssertEqual(item.localizedLabel(locale: Locale(identifier: "en")), item.label, item.id)
        }
        var state = PreparationState(routeID: route.routeID)
        state.add("Water & carrying bottles")
        XCTAssertEqual(state.customItems[0].localizedLabel(locale: Locale(identifier: "de")), "Water & carrying bottles")
    }

    @MainActor
    func testLegacyListWithoutOptionalEnrichmentKeepsHutProgressAfterRelaunch() throws {
        let defaults = UserDefaults(suiteName: "PreparationTests." + UUID().uuidString)!
        let route = input()
        let store = PreparationStore(defaults: defaults)
        var state = PreparationCatalogue.reconcile(.init(routeID: route.routeID), input: route)
        state.stay = .hut
        state = PreparationCatalogue.reconcile(state, input: route)
        state.statuses["hutKit"] = .packed
        state.statuses["fire"] = .excluded
        state.add("Meine Kamera")
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as! [String: Any]
        object.removeValue(forKey: "enrichment")
        defaults.set(try JSONSerialization.data(withJSONObject: object), forKey: store.key(route.routeID))
        let loaded = try PreparationStore(defaults: defaults).load(route)
        XCTAssertEqual(loaded.stay, .hut)
        XCTAssertEqual(loaded.status("hutKit"), .packed)
        XCTAssertEqual(loaded.status("fire"), .excluded)
        XCTAssertEqual(loaded.customItems.first?.label, "Meine Kamera")
    }

    @MainActor
    func testPersistenceIsolatesRoutesAndPreservesCustomExclusions() throws {
        let defaults = UserDefaults(suiteName: "PreparationTests." + UUID().uuidString)!
        let store = PreparationStore(defaults: defaults)
        let route = input()
        var state = try store.load(route)
        state.add("Camera")
        state.statuses[state.customItems[0].id] = .excluded
        state.statuses["water"] = .packed
        try store.save(state)
        XCTAssertEqual(try PreparationStore(defaults: defaults).load(route), state)
        XCTAssertEqual(try store.load(input()).status("water"), .unpacked)
    }
    @MainActor
    func testCorruptAndFutureRecordsAreNotSilentlyReplaced() throws {
        let defaults = UserDefaults(suiteName: "PreparationTests." + UUID().uuidString)!
        let store = PreparationStore(defaults: defaults)
        let route = input()
        let damaged = Data("broken".utf8)
        defaults.set(damaged, forKey: store.key(route.routeID))
        XCTAssertThrowsError(try store.load(route))
        XCTAssertEqual(defaults.data(forKey: store.key(route.routeID)), damaged)
        var future = PreparationState(routeID: route.routeID)
        future.version = 2
        let data = try JSONEncoder().encode(future)
        defaults.set(data, forKey: store.key(route.routeID))
        XCTAssertThrowsError(try store.load(route))
        XCTAssertEqual(defaults.data(forKey: store.key(route.routeID)), data)
    }
}
