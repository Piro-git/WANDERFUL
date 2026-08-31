import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class PremiumAccessTests: XCTestCase {
    private let currentDate = Date(timeIntervalSince1970: 2_000_000_000)

    func testDisabledStoreStartsWithoutTouchingStorefrontOrShowingUI() async {
        let storefront = MockPremiumStorefront()
        let store = PremiumAccessStore(
            configuration: nil,
            storefront: storefront,
            cache: InMemoryPremiumEntitlementCache(),
            now: { self.currentDate }
        )

        await store.start()

        XCTAssertEqual(store.accessState, .disabled)
        XCTAssertFalse(store.isAvailable)
        XCTAssertFalse(store.hasPremiumAccess)
        XCTAssertEqual(storefront.loadProductsCallCount, 0)
        XCTAssertEqual(storefront.currentEntitlementsCallCount, 0)
        XCTAssertEqual(storefront.listenerCallCount, 0)
        XCTAssertFalse(store.canOfferPremium(after: TestRouteFixtures.luneburgLoop))
    }

    func testConfiguredStoreLoadsLocalizedProductsAndOffersOnlyAfterVerifiedValue() async {
        let storefront = MockPremiumStorefront()
        storefront.products = products
        let store = makeStore(storefront: storefront)
        let verifiedRoute = TestRouteFixtures.luneburgLoop

        await store.start()

        XCTAssertEqual(store.products, products)
        XCTAssertEqual(store.accessState, .inactive)
        XCTAssertFalse(store.canOfferPremium(after: verifiedRoute))
        store.recordVerifiedRouteViewed(verifiedRoute)
        XCTAssertTrue(store.canOfferPremium(after: verifiedRoute))
        XCTAssertFalse(store.canOfferPremium(after: TestRouteFixtures.legacyRoute))

        store.presentPremium(after: verifiedRoute)
        XCTAssertEqual(store.presentedPaywall?.routeIdentifier, verifiedRoute.id)
    }

    func testVerifiedCurrentEntitlementGrantsAndCachesAccess() async {
        let storefront = MockPremiumStorefront()
        storefront.products = products
        let transaction = activeTransaction()
        storefront.entitlements = [.verified(transaction)]
        let cache = InMemoryPremiumEntitlementCache()
        let store = makeStore(storefront: storefront, cache: cache)

        await store.start()

        XCTAssertEqual(
            store.accessState,
            .active(expirationDate: try XCTUnwrap(transaction.expirationDate))
        )
        XCTAssertTrue(store.hasPremiumAccess)
        XCTAssertEqual(cache.entitlement?.transactionIdentifier, transaction.id)
    }

    func testUnverifiedTransactionsNeverGrantOrFinishAccess() async {
        let storefront = MockPremiumStorefront()
        storefront.products = products
        storefront.entitlements = [
            .unverified(productIdentifier: configuration.monthlyProductIdentifier)
        ]
        storefront.statuses = [
            PremiumSubscriptionStatusRecord(
                state: .subscribed,
                transaction: .unverified(
                    productIdentifier: configuration.monthlyProductIdentifier
                ),
                gracePeriodExpirationDate: nil,
                renewalInfoIsVerified: false
            )
        ]
        storefront.purchaseOutcome = .unverified(
            productIdentifier: configuration.monthlyProductIdentifier
        )
        let store = makeStore(storefront: storefront)

        await store.start()
        await store.purchase(products[0])

        XCTAssertEqual(store.accessState, .inactive)
        XCTAssertFalse(store.hasPremiumAccess)
        XCTAssertEqual(storefront.finishedTransactionIdentifiers, [])
        guard case .failed = store.purchaseState else {
            return XCTFail("An unverified purchase must show a recoverable failure.")
        }
    }

    func testGracePeriodGrantsButBillingRetryExpiredAndRevokedDoNot() async {
        let graceExpiration = currentDate.addingTimeInterval(3_600)
        let graceStorefront = MockPremiumStorefront()
        graceStorefront.products = products
        graceStorefront.statuses = [
            status(
                state: .gracePeriod,
                transaction: activeTransaction(expiration: currentDate.addingTimeInterval(-60)),
                graceExpiration: graceExpiration
            )
        ]
        let graceStore = makeStore(storefront: graceStorefront)
        await graceStore.start()
        XCTAssertEqual(
            graceStore.accessState,
            .gracePeriod(expirationDate: graceExpiration)
        )
        XCTAssertTrue(graceStore.hasPremiumAccess)

        for expected: PremiumAccessState in [.billingRetry, .expired, .revoked] {
            let storefront = MockPremiumStorefront()
            storefront.products = products
            let renewalState: PremiumRenewalState?
            switch expected {
            case .billingRetry: renewalState = .billingRetry
            case .expired: renewalState = .expired
            case .revoked: renewalState = .revoked
            default: renewalState = nil
            }
            guard let renewalState else {
                XCTFail("Unexpected state")
                continue
            }
            storefront.statuses = [
                status(
                    state: renewalState,
                    transaction: activeTransaction(
                        expiration: currentDate.addingTimeInterval(-60),
                        revoked: renewalState == .revoked
                    )
                )
            ]
            let store = makeStore(storefront: storefront)
            await store.start()
            XCTAssertEqual(store.accessState, expected)
            XCTAssertFalse(store.hasPremiumAccess)
        }
    }

    func testVerifiedPurchaseGrantsThenFinishesAndCancellationIsQuiet() async {
        let transaction = activeTransaction(id: 41)
        let storefront = MockPremiumStorefront()
        storefront.products = products
        storefront.purchaseOutcome = .success(transaction)
        let store = makeStore(storefront: storefront)
        await store.start()

        await store.purchase(products[0])

        XCTAssertEqual(store.purchaseState, .succeeded)
        XCTAssertEqual(storefront.finishedTransactionIdentifiers, [41])
        XCTAssertTrue(store.hasPremiumAccess)

        storefront.purchaseOutcome = .userCancelled
        await store.purchase(products[1])
        XCTAssertEqual(store.purchaseState, .idle)
        XCTAssertEqual(storefront.finishedTransactionIdentifiers, [41])
    }

    func testVerifiedButInactivePurchaseDoesNotGrantOrFinish() async {
        let transaction = activeTransaction(
            id: 42,
            expiration: currentDate.addingTimeInterval(-60)
        )
        let storefront = MockPremiumStorefront()
        storefront.products = products
        storefront.purchaseOutcome = .success(transaction)
        let store = makeStore(storefront: storefront)
        await store.start()

        await store.purchase(products[0])

        XCTAssertFalse(store.hasPremiumAccess)
        XCTAssertEqual(storefront.finishedTransactionIdentifiers, [])
        guard case .failed = store.purchaseState else {
            return XCTFail("Inactive transactions must remain unacknowledged and locked.")
        }
    }

    func testPendingAndThrownPurchasesRemainRecoverable() async {
        let storefront = MockPremiumStorefront()
        storefront.products = products
        let store = makeStore(storefront: storefront)
        await store.start()

        storefront.purchaseOutcome = .pending
        await store.purchase(products[0])
        XCTAssertEqual(store.purchaseState, .pending)
        XCTAssertFalse(store.hasPremiumAccess)

        storefront.purchaseError = .purchaseFailed
        await store.purchase(products[1])
        guard case let .failed(message) = store.purchaseState else {
            return XCTFail("Purchase errors must remain on the paywall.")
        }
        XCTAssertTrue(message.contains("could not be completed"))
    }

    func testRestoreRunsOnlyOnExplicitRequestAndRefreshesEntitlement() async {
        let transaction = activeTransaction()
        let storefront = MockPremiumStorefront()
        storefront.products = products
        let store = makeStore(storefront: storefront)
        await store.start()
        XCTAssertEqual(storefront.syncCallCount, 0)

        storefront.entitlements = [.verified(transaction)]
        await store.restorePurchases()

        XCTAssertEqual(storefront.syncCallCount, 1)
        XCTAssertEqual(store.restoreState, .succeeded(foundAccess: true))
        XCTAssertTrue(store.hasPremiumAccess)
    }

    func testPaymentRestrictionBlocksPurchaseButKeepsRestoreAndManagementAvailable() async {
        let storefront = MockPremiumStorefront()
        storefront.canMakePayments = false
        storefront.products = products
        let store = makeStore(storefront: storefront)
        await store.start()

        XCTAssertTrue(store.isAvailable)
        XCTAssertFalse(store.canMakePayments)
        store.recordVerifiedRouteViewed(TestRouteFixtures.luneburgLoop)
        XCTAssertFalse(store.canOfferPremium(after: TestRouteFixtures.luneburgLoop))

        await store.purchase(products[0])
        XCTAssertEqual(storefront.purchaseCallCount, 0)

        await store.restorePurchases()
        XCTAssertEqual(storefront.syncCallCount, 1)
    }

    func testRecentVerifiedCacheSupportsOfflineLaunchButExpiresAfterSeventyTwoHours() async {
        let cached = PremiumCachedEntitlement(
            productIdentifier: configuration.monthlyProductIdentifier,
            transactionIdentifier: 8,
            expirationDate: currentDate.addingTimeInterval(30 * 24 * 60 * 60),
            verifiedAt: currentDate.addingTimeInterval(-60 * 60)
        )
        let storefront = MockPremiumStorefront()
        storefront.loadProductsError = .productUnavailable
        let store = makeStore(
            storefront: storefront,
            cache: InMemoryPremiumEntitlementCache(entitlement: cached)
        )

        await store.start()
        XCTAssertEqual(
            store.accessState,
            .cachedOffline(expirationDate: cached.expirationDate)
        )
        XCTAssertTrue(store.hasPremiumAccess)

        let stale = PremiumCachedEntitlement(
            productIdentifier: configuration.monthlyProductIdentifier,
            transactionIdentifier: 9,
            expirationDate: cached.expirationDate,
            verifiedAt: currentDate.addingTimeInterval(-73 * 60 * 60)
        )
        let staleCache = InMemoryPremiumEntitlementCache(entitlement: stale)
        let staleStore = makeStore(storefront: storefront, cache: staleCache)
        await staleStore.start()
        XCTAssertEqual(staleStore.accessState, .unavailable)
        XCTAssertFalse(staleStore.hasPremiumAccess)
        XCTAssertNil(staleCache.entitlement)
    }

    func testListenerProcessesVerifiedUpdateAndCancelsWhenStopped() async {
        let storefront = MockPremiumStorefront()
        storefront.products = products
        let store = makeStore(storefront: storefront)
        await store.start()
        XCTAssertEqual(storefront.listenerCallCount, 1)

        let transaction = activeTransaction(id: 77)
        storefront.entitlements = [.verified(transaction)]
        storefront.sendUpdate(.verified(transaction))
        await waitUntil { store.hasPremiumAccess }

        XCTAssertTrue(store.hasPremiumAccess)
        XCTAssertEqual(storefront.finishedTransactionIdentifiers, [77])
        store.stop()
        await waitUntil { storefront.listenerWasCancelled }
        XCTAssertTrue(storefront.listenerWasCancelled)
    }

    private var configuration: WanderfulPremiumConfiguration {
        WanderfulPremiumConfiguration(
            monthlyProductIdentifier: "app.wanderful.premium.monthly",
            annualProductIdentifier: "app.wanderful.premium.annual",
            privacyPolicyURL: URL(string: "https://wanderful.app/privacy")!,
            termsOfUseURL: URL(string: "https://wanderful.app/terms")!
        )
    }

    private var products: [PremiumProduct] {
        [
            PremiumProduct(
                id: configuration.monthlyProductIdentifier,
                tier: .monthly,
                displayName: "Monthly",
                description: "Wanderful Premium",
                displayPrice: "$4.99",
                periodDescription: "1 month",
                introductoryOffer: nil
            ),
            PremiumProduct(
                id: configuration.annualProductIdentifier,
                tier: .annual,
                displayName: "Annual",
                description: "Wanderful Premium",
                displayPrice: "$39.99",
                periodDescription: "1 year",
                introductoryOffer: PremiumIntroductoryOffer(
                    paymentMode: .freeTrial,
                    displayPrice: "$0.00",
                    periodDescription: "1 week",
                    periodCount: 1,
                    isEligible: true
                )
            )
        ]
    }

    private func activeTransaction(
        id: UInt64 = 7,
        expiration: Date? = nil,
        revoked: Bool = false
    ) -> PremiumTransactionRecord {
        PremiumTransactionRecord(
            id: id,
            productIdentifier: configuration.monthlyProductIdentifier,
            purchaseDate: currentDate.addingTimeInterval(-3_600),
            expirationDate: expiration ?? currentDate.addingTimeInterval(30 * 24 * 60 * 60),
            revocationDate: revoked ? currentDate.addingTimeInterval(-30) : nil,
            isUpgraded: false
        )
    }

    private func status(
        state: PremiumRenewalState,
        transaction: PremiumTransactionRecord,
        graceExpiration: Date? = nil
    ) -> PremiumSubscriptionStatusRecord {
        PremiumSubscriptionStatusRecord(
            state: state,
            transaction: .verified(transaction),
            gracePeriodExpirationDate: graceExpiration,
            renewalInfoIsVerified: true
        )
    }

    private func makeStore(
        storefront: MockPremiumStorefront,
        cache: (any PremiumEntitlementCaching)? = nil
    ) -> PremiumAccessStore {
        let store = PremiumAccessStore(
            configuration: configuration,
            storefront: storefront,
            cache: cache ?? InMemoryPremiumEntitlementCache(),
            now: { self.currentDate }
        )
        addTeardownBlock { @MainActor in store.stop() }
        return store
    }

    private func waitUntil(
        timeout: Duration = .seconds(1),
        condition: @escaping @MainActor () -> Bool
    ) async {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while !condition(), clock.now < deadline {
            try? await Task.sleep(for: .milliseconds(10))
        }
    }
}

@MainActor
private final class MockPremiumStorefront: PremiumStorefront {
    var canMakePayments = true
    var products: [PremiumProduct] = []
    var entitlements: [PremiumTransactionVerification] = []
    var statuses: [PremiumSubscriptionStatusRecord] = []
    var purchaseOutcome: PremiumPurchaseOutcome = .userCancelled
    var loadProductsError: PremiumStorefrontError?
    var statusError: PremiumStorefrontError?
    var purchaseError: PremiumStorefrontError?
    var syncError: PremiumStorefrontError?
    private var updateContinuation: AsyncStream<PremiumTransactionVerification>.Continuation?

    private(set) var loadProductsCallCount = 0
    private(set) var currentEntitlementsCallCount = 0
    private(set) var statusCallCount = 0
    private(set) var purchaseCallCount = 0
    private(set) var syncCallCount = 0
    private(set) var listenerCallCount = 0
    private(set) var listenerWasCancelled = false
    private(set) var finishedTransactionIdentifiers: [UInt64] = []

    func loadProducts(
        configuration _: WanderfulPremiumConfiguration
    ) async throws -> [PremiumProduct] {
        loadProductsCallCount += 1
        if let loadProductsError { throw loadProductsError }
        return products
    }

    func currentEntitlements(
        productIdentifiers _: Set<String>
    ) async -> [PremiumTransactionVerification] {
        currentEntitlementsCallCount += 1
        return entitlements
    }

    func subscriptionStatuses(
        productIdentifiers _: Set<String>
    ) async throws -> [PremiumSubscriptionStatusRecord] {
        statusCallCount += 1
        if let statusError { throw statusError }
        return statuses
    }

    func purchase(productIdentifier _: String) async throws -> PremiumPurchaseOutcome {
        purchaseCallCount += 1
        if let purchaseError { throw purchaseError }
        return purchaseOutcome
    }

    func sync() async throws {
        syncCallCount += 1
        if let syncError { throw syncError }
    }

    func transactionUpdates(
        productIdentifiers _: Set<String>
    ) -> AsyncStream<PremiumTransactionVerification> {
        listenerCallCount += 1
        return AsyncStream { continuation in
            updateContinuation = continuation
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.listenerWasCancelled = true }
            }
        }
    }

    func finish(transactionIdentifier: UInt64) async {
        finishedTransactionIdentifiers.append(transactionIdentifier)
    }

    func sendUpdate(_ update: PremiumTransactionVerification) {
        updateContinuation?.yield(update)
    }
}
