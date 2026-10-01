import StoreKit
import StoreKitTest
import XCTest
@testable import TrailMind

@MainActor
final class StoreKitTransactionLifecycleTests: XCTestCase {
    private let weeklyProductIdentifier = "test.app.wanderful.premium.weekly"

    func testVerifiedStoreKitPurchaseIsGrantedFinishedAndRemovedAfterExpiration() async throws {
        #if targetEnvironment(simulator)
        let session = try makeSession()
        defer { session.clearTransactions() }
        let purchased = try await buyProduct(in: session)
        let unfinishedBeforeRefresh = await unfinishedTransactionIDs()
        XCTAssertTrue(unfinishedBeforeRefresh.contains(purchased.id))

        let store = PremiumAccessStore(
            configuration: premiumConfiguration,
            storefront: StoreKitPremiumStorefront(),
            cache: InMemoryPremiumEntitlementCache()
        )
        addTeardownBlock { @MainActor in store.stop() }

        await store.start()

        XCTAssertTrue(store.hasPremiumAccess)
        let unfinishedAfterPurchase = await unfinishedTransactionIDs()
        XCTAssertTrue(unfinishedAfterPurchase.isEmpty)

        try session.expireSubscription(productIdentifier: weeklyProductIdentifier)
        await store.reload()

        XCTAssertFalse(store.hasPremiumAccess)
        XCTAssertEqual(store.accessState, .expired)
        let unfinishedAfterExpiration = await unfinishedTransactionIDs()
        XCTAssertTrue(unfinishedAfterExpiration.isEmpty)
        #endif
    }

    func testVerifiedRevocationIsProcessedAndFinishedWithoutGrantingAccess() async throws {
        #if targetEnvironment(simulator)
        let session = try makeSession()
        defer { session.clearTransactions() }
        let purchased = try await buyProduct(in: session)
        let transaction = try XCTUnwrap(
            session.allTransactions().first { UInt64($0.identifier) == purchased.id }
        )
        try session.refundTransaction(identifier: transaction.identifier)

        let store = PremiumAccessStore(
            configuration: premiumConfiguration,
            storefront: StoreKitPremiumStorefront(),
            cache: InMemoryPremiumEntitlementCache()
        )
        addTeardownBlock { @MainActor in store.stop() }
        await store.start()

        XCTAssertFalse(store.hasPremiumAccess)
        XCTAssertEqual(store.accessState, .revoked)
        let unfinishedAfterRevocation = await unfinishedTransactionIDs()
        XCTAssertTrue(unfinishedAfterRevocation.isEmpty)
        #endif
    }

    private var premiumConfiguration: WanderfulPremiumConfiguration {
        WanderfulPremiumConfiguration(
            weeklyProductIdentifier: weeklyProductIdentifier,
            annualProductIdentifier: "test.app.wanderful.premium.annual",
            privacyPolicyURL: URL(string: "https://local.storekit.test/privacy")!,
            termsOfUseURL: URL(string: "https://local.storekit.test/terms")!
        )
    }

    private func unfinishedTransactionIDs() async -> [UInt64] {
        var identifiers: [UInt64] = []
        for await result in Transaction.unfinished {
            if case let .verified(transaction) = result {
                identifiers.append(transaction.id)
            }
        }
        return identifiers
    }

    private func buyProduct(in session: SKTestSession) async throws -> Transaction {
        try await session.buyProduct(identifier: weeklyProductIdentifier)
    }

    private func makeSession() throws -> SKTestSession {
        let session = try SKTestSession(configurationFileNamed: "Wanderful")
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()
        return session
    }
}
