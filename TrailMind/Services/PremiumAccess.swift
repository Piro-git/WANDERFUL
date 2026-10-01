import Foundation
import Observation
import StoreKit

nonisolated enum PremiumSubscriptionTier: String, CaseIterable, Equatable, Sendable {
    case weekly
    case annual
}

nonisolated enum PremiumOfferPaymentMode: Equatable, Sendable {
    case freeTrial
    case payAsYouGo
    case payUpFront
}

nonisolated struct PremiumIntroductoryOffer: Equatable, Sendable {
    let paymentMode: PremiumOfferPaymentMode
    let displayPrice: String
    let periodDescription: String
    let periodCount: Int
    let isEligible: Bool
}

nonisolated struct PremiumProduct: Identifiable, Equatable, Sendable {
    let id: String
    let tier: PremiumSubscriptionTier
    let displayName: String
    let description: String
    let displayPrice: String
    let periodDescription: String
    let introductoryOffer: PremiumIntroductoryOffer?
}

nonisolated struct PremiumTransactionRecord: Equatable, Sendable {
    let id: UInt64
    let productIdentifier: String
    let purchaseDate: Date
    let expirationDate: Date?
    let revocationDate: Date?
    let isUpgraded: Bool
}

nonisolated enum PremiumTransactionVerification: Equatable, Sendable {
    case verified(PremiumTransactionRecord)
    case unverified(productIdentifier: String?)
}

nonisolated enum PremiumRenewalState: Equatable, Sendable {
    case subscribed
    case gracePeriod
    case billingRetry
    case expired
    case revoked
}

nonisolated struct PremiumSubscriptionStatusRecord: Equatable, Sendable {
    let state: PremiumRenewalState
    let transaction: PremiumTransactionVerification
    let gracePeriodExpirationDate: Date?
    let renewalInfoIsVerified: Bool
}

nonisolated enum PremiumPurchaseOutcome: Equatable, Sendable {
    case success(PremiumTransactionRecord)
    case unverified(productIdentifier: String?)
    case pending
    case userCancelled
}

nonisolated enum PremiumStorefrontError: LocalizedError, Equatable, Sendable {
    case unavailable
    case productUnavailable
    case purchaseFailed
    case restoreFailed
    case transactionFinalizationFailed

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "The App Store is unavailable right now. Your existing access is unchanged."
        case .productUnavailable:
            "Subscription options could not be loaded. Try again later."
        case .purchaseFailed:
            "The purchase could not be completed. Check your App Store purchase history before trying again."
        case .restoreFailed:
            "Purchases could not be restored. Check your connection and try again."
        case .transactionFinalizationFailed:
            "The verified App Store transaction could not be finalized. It will be retried automatically."
        }
    }
}

@MainActor
protocol PremiumStorefront: AnyObject {
    var canMakePayments: Bool { get }

    func loadProducts(
        configuration: WanderfulPremiumConfiguration
    ) async throws -> [PremiumProduct]
    func currentEntitlements(
        productIdentifiers: Set<String>
    ) async -> [PremiumTransactionVerification]
    func subscriptionStatuses(
        productIdentifiers: Set<String>
    ) async throws -> [PremiumSubscriptionStatusRecord]
    func purchase(productIdentifier: String) async throws -> PremiumPurchaseOutcome
    func sync() async throws
    func transactionUpdates(
        productIdentifiers: Set<String>
    ) -> AsyncStream<PremiumTransactionVerification>
    func finish(transactionIdentifier: UInt64) async throws
}

@MainActor
final class NoOpPremiumStorefront: PremiumStorefront {
    var canMakePayments: Bool { false }

    func loadProducts(
        configuration _: WanderfulPremiumConfiguration
    ) async throws -> [PremiumProduct] {
        []
    }

    func currentEntitlements(
        productIdentifiers _: Set<String>
    ) async -> [PremiumTransactionVerification] {
        []
    }

    func subscriptionStatuses(
        productIdentifiers _: Set<String>
    ) async throws -> [PremiumSubscriptionStatusRecord] {
        []
    }

    func purchase(productIdentifier _: String) async throws -> PremiumPurchaseOutcome {
        throw PremiumStorefrontError.unavailable
    }

    func sync() async throws {
        throw PremiumStorefrontError.unavailable
    }

    func transactionUpdates(
        productIdentifiers _: Set<String>
    ) -> AsyncStream<PremiumTransactionVerification> {
        AsyncStream { continuation in continuation.finish() }
    }

    func finish(transactionIdentifier _: UInt64) async throws {}
}

@MainActor
final class StoreKitPremiumStorefront: PremiumStorefront {
    private var storeProducts: [String: Product] = [:]
    private var unfinishedTransactions: [UInt64: Transaction] = [:]
    private var finishedTransactionIdentifiers: Set<UInt64> = []

    var canMakePayments: Bool { AppStore.canMakePayments }

    func loadProducts(
        configuration: WanderfulPremiumConfiguration
    ) async throws -> [PremiumProduct] {
        let products = try await Product.products(for: configuration.productIdentifiers)
        storeProducts = Dictionary(uniqueKeysWithValues: products.map { ($0.id, $0) })

        var mapped: [PremiumProduct] = []
        for product in products {
            guard let subscription = product.subscription,
                  let tier = tier(
                    for: product.id,
                    configuration: configuration
                  )
            else { continue }

            let offer = subscription.introductoryOffer
            let mappedOffer: PremiumIntroductoryOffer?
            if let offer {
                mappedOffer = PremiumIntroductoryOffer(
                    paymentMode: paymentMode(for: offer.paymentMode),
                    displayPrice: offer.displayPrice,
                    periodDescription: periodDescription(for: offer.period),
                    periodCount: offer.periodCount,
                    isEligible: await subscription.isEligibleForIntroOffer
                )
            } else {
                mappedOffer = nil
            }

            mapped.append(
                PremiumProduct(
                    id: product.id,
                    tier: tier,
                    displayName: product.displayName,
                    description: product.description,
                    displayPrice: product.displayPrice,
                    periodDescription: periodDescription(
                        for: subscription.subscriptionPeriod
                    ),
                    introductoryOffer: mappedOffer
                )
            )
        }

        return mapped.sorted { $0.tier.sortOrder < $1.tier.sortOrder }
    }

    func currentEntitlements(
        productIdentifiers: Set<String>
    ) async -> [PremiumTransactionVerification] {
        var results: [PremiumTransactionVerification] = []
        for await result in Transaction.currentEntitlements {
            guard productIdentifiers.contains(result.unsafeProductID) else { continue }
            results.append(mapAndRetain(result))
        }
        return results
    }

    func subscriptionStatuses(
        productIdentifiers: Set<String>
    ) async throws -> [PremiumSubscriptionStatusRecord] {
        let matchingProducts = storeProducts.values.filter {
            productIdentifiers.contains($0.id) && $0.subscription != nil
        }
        guard !matchingProducts.isEmpty else {
            // An unavailable catalog is not evidence that there are no subscriptions.
            throw PremiumStorefrontError.productUnavailable
        }
        var results: [PremiumSubscriptionStatusRecord] = []
        var visitedGroups: Set<String> = []

        for product in matchingProducts {
            guard let subscription = product.subscription,
                  visitedGroups.insert(subscription.subscriptionGroupID).inserted
            else { continue }

            for status in try await subscription.status {
                let transaction = mapAndRetain(status.transaction)
                let productID = transaction.productIdentifier
                guard productID.map(productIdentifiers.contains) ?? true else { continue }

                let renewalInfo: Product.SubscriptionInfo.RenewalInfo?
                switch status.renewalInfo {
                case let .verified(info): renewalInfo = info
                case .unverified: renewalInfo = nil
                }
                results.append(
                    PremiumSubscriptionStatusRecord(
                        state: renewalState(for: status.state),
                        transaction: transaction,
                        gracePeriodExpirationDate: renewalInfo?.gracePeriodExpirationDate,
                        renewalInfoIsVerified: renewalInfo != nil
                    )
                )
            }
        }
        return results
    }

    func purchase(productIdentifier: String) async throws -> PremiumPurchaseOutcome {
        guard let product = storeProducts[productIdentifier] else {
            throw PremiumStorefrontError.productUnavailable
        }

        switch try await product.purchase() {
        case let .success(result):
            switch result {
            case let .verified(transaction):
                unfinishedTransactions[transaction.id] = transaction
                return .success(record(for: transaction))
            case let .unverified(transaction, _):
                return .unverified(productIdentifier: transaction.productID)
            }
        case .pending:
            return .pending
        case .userCancelled:
            return .userCancelled
        @unknown default:
            throw PremiumStorefrontError.purchaseFailed
        }
    }

    func sync() async throws {
        try await AppStore.sync()
    }

    func transactionUpdates(
        productIdentifiers: Set<String>
    ) -> AsyncStream<PremiumTransactionVerification> {
        AsyncStream { continuation in
            let task = Task { @MainActor [weak self] in
                for await result in Transaction.updates {
                    guard !Task.isCancelled else { break }
                    guard productIdentifiers.contains(result.unsafeProductID) else { continue }
                    continuation.yield(
                        self?.mapAndRetain(result) ?? .unverified(productIdentifier: nil)
                    )
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func finish(transactionIdentifier: UInt64) async throws {
        guard !finishedTransactionIdentifiers.contains(transactionIdentifier) else { return }
        guard let transaction = unfinishedTransactions.removeValue(
            forKey: transactionIdentifier
        ) else { return }
        await transaction.finish()
        finishedTransactionIdentifiers.insert(transactionIdentifier)
    }

    private func mapAndRetain(
        _ result: VerificationResult<Transaction>
    ) -> PremiumTransactionVerification {
        if case let .verified(transaction) = result,
           !finishedTransactionIdentifiers.contains(transaction.id) {
            unfinishedTransactions[transaction.id] = transaction
        }
        return map(result)
    }

    private func map(
        _ result: VerificationResult<Transaction>
    ) -> PremiumTransactionVerification {
        switch result {
        case let .verified(transaction):
            .verified(record(for: transaction))
        case let .unverified(transaction, _):
            .unverified(productIdentifier: transaction.productID)
        }
    }

    private func record(for transaction: Transaction) -> PremiumTransactionRecord {
        PremiumTransactionRecord(
            id: transaction.id,
            productIdentifier: transaction.productID,
            purchaseDate: transaction.purchaseDate,
            expirationDate: transaction.expirationDate,
            revocationDate: transaction.revocationDate,
            isUpgraded: transaction.isUpgraded
        )
    }

    private func tier(
        for productIdentifier: String,
        configuration: WanderfulPremiumConfiguration
    ) -> PremiumSubscriptionTier? {
        switch productIdentifier {
        case configuration.weeklyProductIdentifier: .weekly
        case configuration.annualProductIdentifier: .annual
        default: nil
        }
    }

    private func paymentMode(
        for mode: Product.SubscriptionOffer.PaymentMode
    ) -> PremiumOfferPaymentMode {
        if mode == .freeTrial { return .freeTrial }
        if mode == .payAsYouGo { return .payAsYouGo }
        return .payUpFront
    }

    private func renewalState(
        for state: Product.SubscriptionInfo.RenewalState
    ) -> PremiumRenewalState {
        switch state {
        case .subscribed: .subscribed
        case .inGracePeriod: .gracePeriod
        case .inBillingRetryPeriod: .billingRetry
        case .expired: .expired
        case .revoked: .revoked
        default: .expired
        }
    }

    private func periodDescription(
        for period: Product.SubscriptionPeriod
    ) -> String {
        let components = DateComponents(subscriptionPeriod: period)
        return DateComponentsFormatter.localizedString(
            from: components,
            unitsStyle: .full
        ) ?? "subscription period"
    }
}

extension PremiumSubscriptionTier {
    var sortOrder: Int {
        switch self {
        case .annual: 0
        case .weekly: 1
        }
    }
}

private extension VerificationResult where SignedType == Transaction {
    var unsafeProductID: String {
        switch self {
        case let .verified(transaction), let .unverified(transaction, _):
            transaction.productID
        }
    }
}

private extension PremiumTransactionVerification {
    var productIdentifier: String? {
        switch self {
        case let .verified(transaction): transaction.productIdentifier
        case let .unverified(productIdentifier): productIdentifier
        }
    }
}

nonisolated struct PremiumCachedEntitlement: Codable, Equatable, Sendable {
    let productIdentifier: String
    let transactionIdentifier: UInt64
    let expirationDate: Date
    let verifiedAt: Date
}

@MainActor
protocol PremiumEntitlementCaching: AnyObject {
    func load() -> PremiumCachedEntitlement?
    func save(_ entitlement: PremiumCachedEntitlement)
    func clear()
}

@MainActor
final class UserDefaultsPremiumEntitlementCache: PremiumEntitlementCaching {
    private static let key = "wanderful.premium.verified-entitlement.v1"
    private let defaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> PremiumCachedEntitlement? {
        guard let data = defaults.data(forKey: Self.key) else { return nil }
        return try? decoder.decode(PremiumCachedEntitlement.self, from: data)
    }

    func save(_ entitlement: PremiumCachedEntitlement) {
        guard let data = try? encoder.encode(entitlement) else { return }
        defaults.set(data, forKey: Self.key)
    }

    func clear() {
        defaults.removeObject(forKey: Self.key)
    }
}

@MainActor
final class InMemoryPremiumEntitlementCache: PremiumEntitlementCaching {
    private(set) var entitlement: PremiumCachedEntitlement?

    init(entitlement: PremiumCachedEntitlement? = nil) {
        self.entitlement = entitlement
    }

    func load() -> PremiumCachedEntitlement? { entitlement }
    func save(_ entitlement: PremiumCachedEntitlement) { self.entitlement = entitlement }
    func clear() { entitlement = nil }
}

nonisolated enum PremiumAccessState: Equatable, Sendable {
    case disabled
    case loading
    case inactive
    case active(expirationDate: Date)
    case gracePeriod(expirationDate: Date?)
    case billingRetry
    case expired
    case revoked
    case upgraded
    case cachedOffline(expirationDate: Date)
    case unavailable

    var grantsAccess: Bool {
        switch self {
        case .active, .gracePeriod: true
        default: false
        }
    }
}

nonisolated enum PremiumPurchaseState: Equatable, Sendable {
    case idle
    case purchasing(productIdentifier: String)
    case pending
    case succeeded
    case failed(message: String)
}

nonisolated enum PremiumRestoreState: Equatable, Sendable {
    case idle
    case restoring
    case succeeded(foundAccess: Bool)
    case failed(message: String)
}

nonisolated struct PremiumPaywallPresentation: Identifiable, Equatable, Sendable {
    let id = UUID()
    let routeIdentifier: UUID
}

struct PremiumPresentationPolicy: Equatable, Sendable {
    func mayPresent(
        featureIsAvailable: Bool,
        hasEntitlement: Bool,
        route: TrailRoute,
        recordedVerifiedRouteIdentifiers: Set<UUID>
    ) -> Bool {
        featureIsAvailable &&
            !hasEntitlement &&
            route.isVerifiedRoutedResult &&
            recordedVerifiedRouteIdentifiers.contains(route.id)
    }
}

@MainActor
@Observable
final class PremiumAccessStore {
    private static let maximumOfflineCacheAge: TimeInterval = 72 * 60 * 60
    private let configuration: WanderfulPremiumConfiguration?
    private let storefront: any PremiumStorefront
    private let cache: any PremiumEntitlementCaching
    private let now: () -> Date
    private let presentationPolicy = PremiumPresentationPolicy()
    private var listenerTask: Task<Void, Never>?
    private var hasStarted = false
    private var acknowledgedTransactionIdentifiers: Set<UInt64> = []
    private var recordedVerifiedRouteIdentifiers: Set<UUID> = []

    private(set) var products: [PremiumProduct] = []
    private(set) var accessState: PremiumAccessState
    private(set) var purchaseState: PremiumPurchaseState = .idle
    private(set) var restoreState: PremiumRestoreState = .idle
    private(set) var statusMessage: String?
    var presentedPaywall: PremiumPaywallPresentation?

    init(
        configuration: WanderfulPremiumConfiguration?,
        storefront: any PremiumStorefront,
        cache: any PremiumEntitlementCaching,
        now: @escaping () -> Date = Date.init
    ) {
        self.configuration = configuration
        self.storefront = storefront
        self.cache = cache
        self.now = now
        accessState = configuration == nil ? .disabled : .loading
    }

    var isAvailable: Bool { configuration != nil }
    var canMakePayments: Bool { isAvailable && storefront.canMakePayments }
    var hasPremiumAccess: Bool {
        switch accessState {
        case let .active(expirationDate): expirationDate > now()
        case let .gracePeriod(expirationDate): expirationDate.map { $0 > now() } == true
        default: false
        }
    }
    var privacyPolicyURL: URL? { configuration?.privacyPolicyURL }
    var termsOfUseURL: URL? { configuration?.termsOfUseURL }

    func start() async {
        guard !hasStarted, let configuration else { return }
        hasStarted = true
        startTransactionListener(configuration: configuration)
        await reload()
    }

    func stop() {
        listenerTask?.cancel()
        listenerTask = nil
        hasStarted = false
    }

    func reload() async {
        guard let configuration else { return }
        statusMessage = nil

        var productLoadingError: Error?
        do {
            products = try await storefront.loadProducts(configuration: configuration)
            guard Set(products.map(\.id)) == configuration.productIdentifiers else {
                products = []
                await refreshEntitlement(configuration: configuration)
                statusMessage = PremiumStorefrontError.productUnavailable.localizedDescription
                return
            }
        } catch {
            products = []
            productLoadingError = error
        }

        await refreshEntitlement(configuration: configuration)
        if let productLoadingError {
            statusMessage = userFacingMessage(
                for: productLoadingError,
                fallback: PremiumStorefrontError.productUnavailable
            )
        }
    }

    func purchase(_ product: PremiumProduct) async {
        guard canMakePayments, products.contains(product) else { return }
        purchaseState = .purchasing(productIdentifier: product.id)
        statusMessage = nil

        do {
            switch try await storefront.purchase(productIdentifier: product.id) {
            case let .success(transaction):
                let isActive = grantsAccess(transaction)
                applyVerifiedTransaction(transaction)
                guard await acknowledge(transaction) else {
                    purchaseState = .failed(
                        message: PremiumStorefrontError.transactionFinalizationFailed.localizedDescription
                    )
                    return
                }
                guard isActive else {
                    purchaseState = .failed(
                        message: "The App Store purchase is no longer active."
                    )
                    await reload()
                    return
                }
                purchaseState = .succeeded
                presentedPaywall = nil
            case .unverified:
                purchaseState = .failed(
                    message: "The App Store receipt could not be verified. Access was not granted."
                )
            case .pending:
                purchaseState = .pending
            case .userCancelled:
                purchaseState = .idle
            }
        } catch {
            purchaseState = .failed(
                message: userFacingMessage(for: error, fallback: .purchaseFailed)
            )
        }
    }

    func restorePurchases() async {
        guard isAvailable else { return }
        restoreState = .restoring
        statusMessage = nil
        do {
            try await storefront.sync()
            guard let configuration else { return }
            guard await refreshEntitlement(configuration: configuration) else {
                restoreState = .failed(message: PremiumStorefrontError.restoreFailed.localizedDescription)
                return
            }
            restoreState = .succeeded(foundAccess: hasPremiumAccess)
        } catch {
            restoreState = .failed(
                message: userFacingMessage(for: error, fallback: .restoreFailed)
            )
        }
    }

    func recordVerifiedRouteViewed(_ route: TrailRoute) {
        guard isAvailable, route.isVerifiedRoutedResult else { return }
        recordedVerifiedRouteIdentifiers.insert(route.id)
    }

    func canOfferPremium(after route: TrailRoute) -> Bool {
        presentationPolicy.mayPresent(
            featureIsAvailable: canMakePayments && productCatalogIsComplete,
            hasEntitlement: hasPremiumAccess,
            route: route,
            recordedVerifiedRouteIdentifiers: recordedVerifiedRouteIdentifiers
        )
    }

    func presentPremium(after route: TrailRoute) {
        guard canOfferPremium(after: route) else { return }
        purchaseState = .idle
        restoreState = .idle
        statusMessage = nil
        presentedPaywall = PremiumPaywallPresentation(routeIdentifier: route.id)
    }

    func dismissPaywall() {
        presentedPaywall = nil
    }

    private func startTransactionListener(
        configuration: WanderfulPremiumConfiguration
    ) {
        let updates = storefront.transactionUpdates(
            productIdentifiers: configuration.productIdentifiers
        )
        listenerTask = Task { @MainActor [weak self] in
            for await update in updates {
                guard !Task.isCancelled else { break }
                await self?.processTransactionUpdate(
                    update,
                    configuration: configuration
                )
            }
        }
    }

    private func processTransactionUpdate(
        _ update: PremiumTransactionVerification,
        configuration: WanderfulPremiumConfiguration
    ) async {
        switch update {
        case let .verified(transaction):
            applyVerifiedTransaction(transaction)
            _ = await acknowledge(transaction)
            await refreshEntitlement(configuration: configuration)
        case .unverified:
            statusMessage = "An App Store update could not be verified. Existing verified access is unchanged."
        }
    }

    @discardableResult
    private func refreshEntitlement(
        configuration: WanderfulPremiumConfiguration
    ) async -> Bool {
        let entitlements = await storefront.currentEntitlements(
            productIdentifiers: configuration.productIdentifiers
        )
        let verified = entitlements.compactMap { result -> PremiumTransactionRecord? in
            guard case let .verified(transaction) = result else { return nil }
            return transaction
        }
        if let active = verified
            .filter(grantsAccess)
            .max(by: { ($0.expirationDate ?? .distantPast) < ($1.expirationDate ?? .distantPast) }) {
            grantVerified(
                active,
                state: .active(expirationDate: active.expirationDate!)
            )
            await acknowledge(verified)
            return true
        }

        do {
            let statuses = try await storefront.subscriptionStatuses(
                productIdentifiers: configuration.productIdentifiers
            )
            apply(statuses: statuses)
            await acknowledge(verified + statuses.compactMap(\.verifiedTransaction))
            return true
        } catch {
            if let newest = verified.max(by: { $0.purchaseDate < $1.purchaseDate }) {
                applyVerifiedTransaction(newest)
                await acknowledge(verified)
            } else {
                accessState = validCachedState() ?? .unavailable
            }
            statusMessage = userFacingMessage(for: error, fallback: .unavailable)
            return false
        }
    }

    private func apply(statuses: [PremiumSubscriptionStatusRecord]) {
        let verifiedStatuses = statuses.filter { status in
            guard case .verified = status.transaction else { return false }
            return status.renewalInfoIsVerified
        }

        if let subscribed = verifiedStatuses.first(where: { $0.state == .subscribed }),
           case let .verified(transaction) = subscribed.transaction,
           grantsAccess(transaction) {
            grantVerified(
                transaction,
                state: .active(expirationDate: transaction.expirationDate!)
            )
            return
        }
        if let grace = verifiedStatuses.first(where: { $0.state == .gracePeriod }),
           case let .verified(transaction) = grace.transaction,
           transaction.revocationDate == nil,
           !transaction.isUpgraded,
           grace.gracePeriodExpirationDate.map({ $0 > now() }) ?? grantsAccess(transaction) {
            grantVerified(
                transaction,
                state: .gracePeriod(
                    expirationDate: grace.gracePeriodExpirationDate ?? transaction.expirationDate
                )
            )
            return
        }

        cache.clear()
        if verifiedStatuses.contains(where: { $0.state == .revoked }) {
            accessState = .revoked
        } else if verifiedStatuses.contains(where: {
            $0.verifiedTransaction?.isUpgraded == true
        }) {
            accessState = .upgraded
        } else if verifiedStatuses.contains(where: { $0.state == .billingRetry }) {
            accessState = .billingRetry
        } else if verifiedStatuses.contains(where: { $0.state == .expired }) {
            accessState = .expired
        } else {
            accessState = .inactive
        }
    }

    private func grantsAccess(_ transaction: PremiumTransactionRecord) -> Bool {
        transaction.revocationDate == nil &&
            !transaction.isUpgraded &&
            transaction.expirationDate.map { $0 > now() } == true
    }

    private func applyVerifiedTransaction(_ transaction: PremiumTransactionRecord) {
        if grantsAccess(transaction), let expirationDate = transaction.expirationDate {
            grantVerified(transaction, state: .active(expirationDate: expirationDate))
            return
        }

        cache.clear()
        if transaction.revocationDate != nil {
            accessState = .revoked
        } else if transaction.isUpgraded {
            accessState = .upgraded
        } else if transaction.expirationDate.map({ $0 <= now() }) == true {
            accessState = .expired
        } else {
            accessState = .inactive
        }
    }

    @discardableResult
    private func acknowledge(_ transaction: PremiumTransactionRecord) async -> Bool {
        guard !acknowledgedTransactionIdentifiers.contains(transaction.id) else { return true }
        do {
            try await storefront.finish(transactionIdentifier: transaction.id)
            acknowledgedTransactionIdentifiers.insert(transaction.id)
            return true
        } catch {
            statusMessage = userFacingMessage(
                for: error,
                fallback: .transactionFinalizationFailed
            )
            return false
        }
    }

    private func acknowledge(_ transactions: [PremiumTransactionRecord]) async {
        for transaction in transactions {
            _ = await acknowledge(transaction)
        }
    }

    private func grantVerified(
        _ transaction: PremiumTransactionRecord,
        state: PremiumAccessState
    ) {
        guard let expirationDate = transaction.expirationDate else { return }
        cache.save(
            PremiumCachedEntitlement(
                productIdentifier: transaction.productIdentifier,
                transactionIdentifier: transaction.id,
                expirationDate: expirationDate,
                verifiedAt: now()
            )
        )
        accessState = state
    }

    private func validCachedState() -> PremiumAccessState? {
        guard let configuration,
              let cached = cache.load(),
              configuration.productIdentifiers.contains(cached.productIdentifier),
              cachedIsValid(cached)
        else {
            cache.clear()
            return nil
        }
        return .cachedOffline(expirationDate: cached.expirationDate)
    }

    private func cachedIsValid(_ cached: PremiumCachedEntitlement) -> Bool {
        let currentDate = now()
        let cacheAge = currentDate.timeIntervalSince(cached.verifiedAt)
        return cached.expirationDate > currentDate &&
            cacheAge >= 0 &&
            cacheAge <= Self.maximumOfflineCacheAge
    }

    private var productCatalogIsComplete: Bool {
        guard let configuration else { return false }
        return Set(products.map(\.id)) == configuration.productIdentifiers
    }

    private func userFacingMessage(
        for error: Error,
        fallback: PremiumStorefrontError
    ) -> String {
        if let error = error as? PremiumStorefrontError {
            return error.localizedDescription
        }
        return fallback.localizedDescription
    }
}

private extension PremiumSubscriptionStatusRecord {
    var verifiedTransaction: PremiumTransactionRecord? {
        guard case let .verified(transaction) = transaction else { return nil }
        return transaction
    }
}

@MainActor
enum PremiumAccessFactory {
    static func makeProduction(
        appConfiguration: WanderfulAppConfiguration? =
            WanderfulAppConfigurationSnapshot.configuration
    ) -> PremiumAccessStore {
        guard let appConfiguration,
              appConfiguration.diagnostics.monetizationAvailable,
              let configuration = appConfiguration.monetization.configuredValue
        else {
            return PremiumAccessStore(
                configuration: nil,
                storefront: NoOpPremiumStorefront(),
                cache: InMemoryPremiumEntitlementCache()
            )
        }
        return PremiumAccessStore(
            configuration: configuration,
            storefront: StoreKitPremiumStorefront(),
            cache: UserDefaultsPremiumEntitlementCache()
        )
    }

    #if DEBUG && targetEnvironment(simulator)
    static func makeStoreKitTest() -> PremiumAccessStore {
        PremiumAccessStore(
            configuration: WanderfulPremiumConfiguration(
                weeklyProductIdentifier: "test.app.wanderful.premium.weekly",
                annualProductIdentifier: "test.app.wanderful.premium.annual",
                privacyPolicyURL: URL(
                    string: "https://local.storekit.test/privacy"
                )!,
                termsOfUseURL: URL(
                    string: "https://local.storekit.test/terms"
                )!
            ),
            storefront: StoreKitPremiumStorefront(),
            cache: InMemoryPremiumEntitlementCache()
        )
    }
    #endif
}
