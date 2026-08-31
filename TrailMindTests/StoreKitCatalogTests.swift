import StoreKit
import StoreKitTest
import XCTest

@MainActor
final class StoreKitCatalogTests: XCTestCase {
    func testCatalogLoadsTestOnlyMonthlyAndAnnualSubscriptions() async throws {
        #if targetEnvironment(simulator)
        let configurationURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("StoreKit", isDirectory: true)
            .appendingPathComponent("Wanderful.storekit", isDirectory: false)
        let session = try SKTestSession(contentsOf: configurationURL)
        session.disableDialogs = true
        session.clearTransactions()

        let identifiers: Set<String> = [
            "test.app.wanderful.premium.monthly",
            "test.app.wanderful.premium.annual"
        ]
        let products = try await Product.products(for: identifiers)
        XCTAssertEqual(Set(products.map(\.id)), identifiers)

        let monthly = try XCTUnwrap(
            products.first { $0.id == "test.app.wanderful.premium.monthly" }
        )
        XCTAssertEqual(monthly.subscription?.subscriptionPeriod.unit, .month)
        XCTAssertEqual(monthly.subscription?.subscriptionPeriod.value, 1)
        XCTAssertFalse(monthly.displayPrice.isEmpty)

        let annual = try XCTUnwrap(
            products.first { $0.id == "test.app.wanderful.premium.annual" }
        )
        XCTAssertEqual(annual.subscription?.subscriptionPeriod.unit, .year)
        XCTAssertEqual(annual.subscription?.subscriptionPeriod.value, 1)
        XCTAssertEqual(
            annual.subscription?.introductoryOffer?.paymentMode,
            .freeTrial
        )
        XCTAssertEqual(
            annual.subscription?.introductoryOffer?.period.unit,
            .week
        )
        #endif
    }
}
