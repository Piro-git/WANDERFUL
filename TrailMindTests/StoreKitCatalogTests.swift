import Foundation
import StoreKit
import StoreKitTest
import XCTest

@MainActor
final class StoreKitCatalogTests: XCTestCase {
    func testCheckedInFixtureModelsTheApprovedLocalOffer() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("StoreKit/Wanderful.storekit")
        let root = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: Any]
        )
        let settings = try XCTUnwrap(root["settings"] as? [String: Any])
        XCTAssertEqual(settings["_storefront"] as? String, "DEU")
        XCTAssertEqual(settings["_locale"] as? String, "de_DE")

        let groups = try XCTUnwrap(root["subscriptionGroups"] as? [[String: Any]])
        let subscriptions = try XCTUnwrap(groups.first?["subscriptions"] as? [[String: Any]])
        let weekly = try XCTUnwrap(subscriptions.first { $0["productID"] as? String == "test.app.wanderful.premium.weekly" })
        XCTAssertEqual(weekly["displayPrice"] as? String, "3.99")
        XCTAssertEqual(weekly["recurringSubscriptionPeriod"] as? String, "P1W")
        XCTAssertNil(weekly["introductoryOffer"] as? [String: Any])

        let annual = try XCTUnwrap(subscriptions.first { $0["productID"] as? String == "test.app.wanderful.premium.annual" })
        XCTAssertEqual(annual["displayPrice"] as? String, "39.99")
        XCTAssertEqual(annual["recurringSubscriptionPeriod"] as? String, "P1Y")
        let trial = try XCTUnwrap(annual["introductoryOffer"] as? [String: Any])
        XCTAssertEqual(trial["paymentMode"] as? String, "free")
        XCTAssertEqual(trial["subscriptionPeriod"] as? String, "P1W")
    }

    func testCatalogLoadsTestOnlyWeeklyAndAnnualSubscriptions() async throws {
        #if targetEnvironment(simulator)
        let session = try SKTestSession(configurationFileNamed: "Wanderful")
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()

        let identifiers: Set<String> = [
            "test.app.wanderful.premium.weekly",
            "test.app.wanderful.premium.annual"
        ]
        let products = try await Product.products(for: identifiers)
        guard !products.isEmpty else {
            XCTFail("StoreKit runtime gate failed: the bundled catalog was not exposed.")
            return
        }
        XCTAssertEqual(Set(products.map(\.id)), identifiers)

        let weekly = try XCTUnwrap(
            products.first { $0.id == "test.app.wanderful.premium.weekly" }
        )
        XCTAssertEqual(weekly.subscription?.subscriptionPeriod.unit, .week)
        XCTAssertEqual(weekly.subscription?.subscriptionPeriod.value, 1)
        XCTAssertEqual(weekly.price, Decimal(string: "3.99"))
        XCTAssertNil(weekly.subscription?.introductoryOffer)

        let annual = try XCTUnwrap(
            products.first { $0.id == "test.app.wanderful.premium.annual" }
        )
        XCTAssertEqual(annual.subscription?.subscriptionPeriod.unit, .year)
        XCTAssertEqual(annual.subscription?.subscriptionPeriod.value, 1)
        XCTAssertEqual(annual.price, Decimal(string: "39.99"))
        XCTAssertEqual(annual.subscription?.introductoryOffer?.paymentMode, .freeTrial)
        XCTAssertEqual(annual.subscription?.introductoryOffer?.period.unit, .week)
        XCTAssertEqual(annual.subscription?.introductoryOffer?.period.value, 1)
        #endif
    }
}
