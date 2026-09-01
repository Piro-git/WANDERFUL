import Foundation
import StoreKit
import StoreKitTest
import XCTest
@testable import TrailMind

@MainActor
final class StoreKitCatalogTests: XCTestCase {
    private let monthlyProductID = "test.app.wanderful.premium.monthly"
    private let annualProductID = "test.app.wanderful.premium.annual"

    func testCatalogLoadsTestOnlyMonthlyAndAnnualSubscriptions() async throws {
        #if targetEnvironment(simulator)
        let session = try makeSession()
        defer { session.clearTransactions() }

        let identifiers = Set([monthlyProductID, annualProductID])
        let products = try await Product.products(for: identifiers)
        XCTAssertEqual(Set(products.map(\.id)), identifiers)

        let monthly = try XCTUnwrap(
            products.first { $0.id == monthlyProductID }
        )
        XCTAssertEqual(monthly.subscription?.subscriptionPeriod.unit, .month)
        XCTAssertEqual(monthly.subscription?.subscriptionPeriod.value, 1)
        XCTAssertFalse(monthly.displayPrice.isEmpty)

        let annual = try XCTUnwrap(
            products.first { $0.id == annualProductID }
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

    func testGermanCatalogUsesConfiguredLocalizedNamesAndPrices() async throws {
        #if targetEnvironment(simulator)
        let session = try makeSession()
        defer { session.clearTransactions() }
        session.locale = Locale(identifier: "de_DE")

        let products = try await Product.products(
            for: [monthlyProductID, annualProductID]
        )
        let monthly = try XCTUnwrap(
            products.first { $0.id == monthlyProductID }
        )
        let annual = try XCTUnwrap(
            products.first { $0.id == annualProductID }
        )

        XCTAssertEqual(monthly.displayName, "Wanderful Premium Monatlich")
        XCTAssertEqual(annual.displayName, "Wanderful Premium Jährlich")
        XCTAssertFalse(monthly.displayPrice.isEmpty)
        XCTAssertFalse(annual.displayPrice.isEmpty)
        #endif
    }

    func testVerifiedPurchaseFinishesAndRelaunchDerivesCurrentEntitlement() async throws {
        #if targetEnvironment(simulator)
        let session = try makeSession()
        defer { session.clearTransactions() }

        let firstStore = makeStore()
        addTeardownBlock { @MainActor in firstStore.stop() }
        await firstStore.start()
        let monthly = try XCTUnwrap(
            firstStore.products.first { $0.id == monthlyProductID }
        )

        await firstStore.purchase(monthly)

        XCTAssertEqual(firstStore.purchaseState, .succeeded)
        XCTAssertTrue(firstStore.hasPremiumAccess)
        let unfinishedAfterPurchase = await unfinishedProductIDs()
        XCTAssertEqual(unfinishedAfterPurchase, [])
        firstStore.stop()

        let relaunchedStore = makeStore()
        addTeardownBlock { @MainActor in relaunchedStore.stop() }
        await relaunchedStore.start()

        XCTAssertTrue(relaunchedStore.hasPremiumAccess)
        let unfinishedAfterRelaunch = await unfinishedProductIDs()
        XCTAssertEqual(unfinishedAfterRelaunch, [])
        #endif
    }

    func testExpiredSubscriptionLosesAccessAndRemainsFinished() async throws {
        #if targetEnvironment(simulator)
        let session = try makeSession()
        defer { session.clearTransactions() }
        let store = makeStore()
        addTeardownBlock { @MainActor in store.stop() }
        await store.start()
        let monthly = try XCTUnwrap(
            store.products.first { $0.id == monthlyProductID }
        )
        await store.purchase(monthly)
        XCTAssertTrue(store.hasPremiumAccess)

        try session.expireSubscription(productIdentifier: monthlyProductID)
        await store.reload()

        XCTAssertEqual(store.accessState, .expired)
        XCTAssertFalse(store.hasPremiumAccess)
        let unfinished = await unfinishedProductIDs()
        XCTAssertEqual(unfinished, [])
        #endif
    }

    func testRefundedSubscriptionIsRevokedAndRemainsFinished() async throws {
        #if targetEnvironment(simulator)
        let session = try makeSession()
        defer { session.clearTransactions() }
        let store = makeStore()
        addTeardownBlock { @MainActor in store.stop() }
        await store.start()
        let monthly = try XCTUnwrap(
            store.products.first { $0.id == monthlyProductID }
        )
        await store.purchase(monthly)
        let testTransaction = try XCTUnwrap(
            session.allTransactions().first { $0.productIdentifier == monthlyProductID }
        )

        try session.refundTransaction(identifier: testTransaction.identifier)
        await store.reload()

        XCTAssertEqual(store.accessState, .revoked)
        XCTAssertFalse(store.hasPremiumAccess)
        let unfinished = await unfinishedProductIDs()
        XCTAssertEqual(unfinished, [])
        #endif
    }

    func testAskToBuyPendingCompletesThroughTransactionUpdates() async throws {
        #if targetEnvironment(simulator)
        let session = try makeSession()
        defer { session.clearTransactions() }
        session.askToBuyEnabled = true
        let store = makeStore()
        addTeardownBlock { @MainActor in store.stop() }
        await store.start()
        let monthly = try XCTUnwrap(
            store.products.first { $0.id == monthlyProductID }
        )

        await store.purchase(monthly)
        XCTAssertEqual(store.purchaseState, .pending)
        XCTAssertFalse(store.hasPremiumAccess)
        let pending = try XCTUnwrap(
            session.allTransactions().first { $0.pendingAskToBuyConfirmation }
        )

        try session.approveAskToBuyTransaction(identifier: pending.identifier)
        await waitUntil { store.hasPremiumAccess }

        XCTAssertTrue(store.hasPremiumAccess)
        let unfinished = await unfinishedProductIDs()
        XCTAssertEqual(unfinished, [])
        #endif
    }

    private func makeSession() throws -> SKTestSession {
        let session = try SKTestSession(configurationFileNamed: "Wanderful")
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()
        return session
    }

    private func makeStore() -> PremiumAccessStore {
        PremiumAccessStore(
            configuration: WanderfulPremiumConfiguration(
                monthlyProductIdentifier: monthlyProductID,
                annualProductIdentifier: annualProductID,
                privacyPolicyURL: URL(string: "https://local.storekit.test/privacy")!,
                termsOfUseURL: URL(string: "https://local.storekit.test/terms")!
            ),
            storefront: StoreKitPremiumStorefront(),
            cache: InMemoryPremiumEntitlementCache()
        )
    }

    private func unfinishedProductIDs() async -> [String] {
        var productIDs: [String] = []
        for await result in Transaction.unfinished {
            if case let .verified(transaction) = result {
                productIDs.append(transaction.productID)
            }
        }
        return productIDs.sorted()
    }

    private func waitUntil(
        timeout: Duration = .seconds(3),
        condition: @escaping @MainActor () -> Bool
    ) async {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while !condition(), clock.now < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
    }
}
