import Foundation
import Observation
import StoreKit

nonisolated enum PremiumSubscriptionTier: String, CaseIterable, Equatable, Sendable {
    case monthly
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

nonisolated struct PremiumTransactionRecord: Equatable, Hashable, Sendable {
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
    case processingFailed
    case restoreFailed

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "The App Store is unavailable right now. Your existing access is unchanged."
        case .productUnavailable:
            "Subscription options could not be loaded. Try again later."
        case .purchaseFailed:
            "The purchase could not be completed. Your Premium access is unchanged. Check your App Store purchase history before trying again."
        case .processingFailed:
            "The purchase was verified, but Premium access could not be saved safely. Access remains locked; try again."
        case .restoreFailed:
            "Purchases could not be restored. Check your connection and try again."
        }
    }
}

@MainActor
protocol PremiumStorefront: AnyObject {
    var canMakePayments: Bool { get }

    func loadProducts(
        configuration: WanderfulPremiumConfiguration
    ) async throws -> [PremiumProduct]
    func unfinishedTransactions(
        productIdentifiers: Set<String>
    ) async -> [PremiumTransactionVerification]
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
    func finish(transactionIdentifier: UInt64) async
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

    func unfinishedTransactions(
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

    func finish(transactionIdentifier _: UInt64) async {}
}

@MainActor
final class StoreKitPremiumStorefront: PremiumStorefront {
    private var storeProducts: [String: Product] = [:]
    private var verifiedTransactionHandles: [UInt64: Transaction] = [:]

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

    func unfinishedTransactions(
        productIdentifiers: Set<String>
    ) async -> [PremiumTransactionVerification] {
        var results: [PremiumTransactionVerification] = []
        for await result in Transaction.unfinished {
            guard productIdentifiers.contains(result.unsafeProductID) else { continue }
            rememberVerifiedTransaction(from: result)
            results.append(map(result))
        }
        return results
    }

    func currentEntitlements(
        productIdentifiers: Set<String>
    ) async -> [PremiumTransactionVerification] {
        var results: [PremiumTransactionVerification] = []
        for await result in Transaction.currentEntitlements {
            guard productIdentifiers.contains(result.unsafeProductID) else { continue }
            rememberVerifiedTransaction(from: result)
            results.append(map(result))
        }
        return results
    }

    func subscriptionStatuses(
        productIdentifiers: Set<String>
    ) async throws -> [PremiumSubscriptionStatusRecord] {
        var results: [PremiumSubscriptionStatusRecord] = []
        var visitedGroups: Set<String> = []
        let configuredProducts = storeProducts.values.filter {
            productIdentifiers.contains($0.id)
        }
        guard !configuredProducts.isEmpty else {
            throw PremiumStorefrontError.productUnavailable
        }

        for product in configuredProducts {
            guard let subscription = product.subscription,
                  visitedGroups.insert(subscription.subscriptionGroupID).inserted
            else { continue }

            for status in try await subscription.status {
                let transaction = map(status.transaction)
                let productID = transaction.productIdentifier
                guard productID.map(productIdentifiers.contains) ?? true else { continue }
                rememberVerifiedTransaction(from: status.transaction)

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
                verifiedTransactionHandles[transaction.id] = transaction
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
                    if case let .verified(transaction) = result {
                        self?.verifiedTransactionHandles[transaction.id] = transaction
                    }
                    continuation.yield(self?.map(result) ?? .unverified(productIdentifier: nil))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func finish(transactionIdentifier: UInt64) async {
        guard let transaction = verifiedTransactionHandles.removeValue(
            forKey: transactionIdentifier
        ) else { return }
        await transaction.finish()
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

    private func rememberVerifiedTransaction(
        from result: VerificationResult<Transaction>
    ) {
        guard case let .verified(transaction) = result else { return }
        verifiedTransactionHandles[transaction.id] = transaction
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
        case configuration.monthlyProductIdentifier: .monthly
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

private extension PremiumSubscriptionTier {
    var sortOrder: Int {
        switch self {
        case .monthly: 0
        case .annual: 1
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
    func save(_ entitlement: PremiumCachedEntitlement) throws
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

    func save(_ entitlement: PremiumCachedEntitlement) throws {
        let data = try encoder.encode(entitlement)
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
    func save(_ entitlement: PremiumCachedEntitlement) throws { self.entitlement = entitlement }
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
    case cachedOffline(expirationDate: Date)
    case unavailable

    var grantsAccess: Bool {
        switch self {
        case .active, .gracePeriod, .cachedOffline: true
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
    private struct EntitlementResolution {
        let state: PremiumAccessState
        let cachedEntitlement: PremiumCachedEntitlement?
    }

    private static let maximumOfflineCacheAge: TimeInterval = 72 * 60 * 60
    private let configuration: WanderfulPremiumConfiguration?
    private let storefront: any PremiumStorefront
    private let cache: any PremiumEntitlementCaching
    private let now: () -> Date
    private let presentationPolicy = PremiumPresentationPolicy()
    private var listenerTask: Task<Void, Never>?
    private var hasStarted = false
    private var processedVerifiedTransactions: Set<PremiumTransactionRecord> = []
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
    var hasPremiumAccess: Bool { accessState.grantsAccess }
    var privacyPolicyURL: URL? { configuration?.privacyPolicyURL }
    var termsOfUseURL: URL? { configuration?.termsOfUseURL }

    func start() async {
        guard !hasStarted, let configuration else { return }
        hasStarted = true
        applyValidCachedEntitlement(configuration: configuration)
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
        var catalogMessage: String?

        do {
            products = try await storefront.loadProducts(configuration: configuration)
            if Set(products.map(\.id)) != configuration.productIdentifiers {
                catalogMessage = PremiumStorefrontError.productUnavailable.localizedDescription
            }
        } catch {
            products = []
            catalogMessage = userFacingMessage(
                for: error,
                fallback: PremiumStorefrontError.productUnavailable
            )
        }

        _ = await refreshEntitlement(configuration: configuration)
        if statusMessage == nil {
            statusMessage = catalogMessage
        }
    }

    func purchase(_ product: PremiumProduct) async {
        guard let configuration, canMakePayments, products.contains(product) else { return }
        purchaseState = .purchasing(productIdentifier: product.id)
        statusMessage = nil

        do {
            switch try await storefront.purchase(productIdentifier: product.id) {
            case let .success(transaction):
                let resolution = resolution(for: transaction)
                do {
                    try await applyAndFinish(
                        resolution: resolution,
                        verifiedTransactions: [transaction]
                    )
                } catch {
                    purchaseState = .failed(
                        message: userFacingMessage(for: error, fallback: .processingFailed)
                    )
                    return
                }

                if resolution.state.grantsAccess {
                    purchaseState = .succeeded
                    presentedPaywall = nil
                } else {
                    purchaseState = .failed(
                        message: "The App Store purchase is no longer active."
                    )
                    _ = await refreshEntitlement(configuration: configuration)
                }
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
            let refreshed = await refreshEntitlement(configuration: configuration)
            if refreshed {
                restoreState = .succeeded(foundAccess: hasPremiumAccess)
            } else {
                restoreState = .failed(
                    message: statusMessage ?? PremiumStorefrontError.restoreFailed.localizedDescription
                )
            }
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
            guard configuration.productIdentifiers.contains(transaction.productIdentifier) else {
                return
            }
            do {
                let didProcess = try await applyAndFinish(
                    resolution: resolution(for: transaction),
                    verifiedTransactions: [transaction]
                )
                if didProcess {
                    statusMessage = nil
                    _ = await refreshEntitlement(configuration: configuration)
                }
            } catch {
                accessState = validCachedState() ?? .unavailable
                statusMessage = userFacingMessage(for: error, fallback: .processingFailed)
            }
        case .unverified:
            statusMessage = "An App Store update could not be verified. Existing verified access is unchanged."
        }
    }

    @discardableResult
    private func refreshEntitlement(
        configuration: WanderfulPremiumConfiguration
    ) async -> Bool {
        let unfinished = await storefront.unfinishedTransactions(
            productIdentifiers: configuration.productIdentifiers
        )
        let entitlements = await storefront.currentEntitlements(
            productIdentifiers: configuration.productIdentifiers
        )
        let verified = verifiedTransactions(
            in: unfinished + entitlements,
            configuration: configuration
        )
        if let active = verified
            .filter(grantsAccess)
            .max(by: { ($0.expirationDate ?? .distantPast) < ($1.expirationDate ?? .distantPast) }) {
            do {
                try await applyAndFinish(
                    resolution: resolution(for: active),
                    verifiedTransactions: verified
                )
                return true
            } catch {
                accessState = validCachedState() ?? .unavailable
                statusMessage = userFacingMessage(for: error, fallback: .processingFailed)
                return false
            }
        }

        let statuses: [PremiumSubscriptionStatusRecord]
        do {
            statuses = try await storefront.subscriptionStatuses(
                productIdentifiers: configuration.productIdentifiers
            )
        } catch {
            accessState = validCachedState() ?? .unavailable
            statusMessage = userFacingMessage(for: error, fallback: .unavailable)
            return false
        }

        let verifiedStatusTransactions = statuses.compactMap { status -> PremiumTransactionRecord? in
            guard case let .verified(transaction) = status.transaction,
                  configuration.productIdentifiers.contains(transaction.productIdentifier)
            else { return nil }
            return transaction
        }
        do {
            try await applyAndFinish(
                resolution: resolution(for: statuses),
                verifiedTransactions: verified + verifiedStatusTransactions
            )
            return true
        } catch {
            accessState = validCachedState() ?? .unavailable
            statusMessage = userFacingMessage(for: error, fallback: .processingFailed)
            return false
        }
    }

    private func verifiedTransactions(
        in verifications: [PremiumTransactionVerification],
        configuration: WanderfulPremiumConfiguration
    ) -> [PremiumTransactionRecord] {
        verifications.compactMap { verification in
            guard case let .verified(transaction) = verification,
                  configuration.productIdentifiers.contains(transaction.productIdentifier)
            else { return nil }
            return transaction
        }
    }

    private func grantsAccess(_ transaction: PremiumTransactionRecord) -> Bool {
        transaction.revocationDate == nil &&
            !transaction.isUpgraded &&
            transaction.expirationDate.map { $0 > now() } == true
    }

    private func resolution(
        for transaction: PremiumTransactionRecord
    ) -> EntitlementResolution {
        if grantsAccess(transaction), let expirationDate = transaction.expirationDate {
            return EntitlementResolution(
                state: .active(expirationDate: expirationDate),
                cachedEntitlement: cachedEntitlement(
                    for: transaction,
                    expirationDate: expirationDate
                )
            )
        }
        if transaction.revocationDate != nil {
            return EntitlementResolution(state: .revoked, cachedEntitlement: nil)
        }
        if transaction.isUpgraded {
            return EntitlementResolution(state: .inactive, cachedEntitlement: nil)
        }
        if transaction.expirationDate.map({ $0 <= now() }) == true {
            return EntitlementResolution(state: .expired, cachedEntitlement: nil)
        }
        return EntitlementResolution(state: .inactive, cachedEntitlement: nil)
    }

    private func resolution(
        for statuses: [PremiumSubscriptionStatusRecord]
    ) -> EntitlementResolution {
        let trustedStatuses = statuses.filter { status in
            guard case .verified = status.transaction else { return false }
            return status.renewalInfoIsVerified
        }

        let subscribedTransactions = trustedStatuses.compactMap { status -> PremiumTransactionRecord? in
            guard status.state == .subscribed,
                  case let .verified(transaction) = status.transaction,
                  grantsAccess(transaction)
            else { return nil }
            return transaction
        }
        if let active = subscribedTransactions.max(by: {
            ($0.expirationDate ?? .distantPast) < ($1.expirationDate ?? .distantPast)
        }), let expirationDate = active.expirationDate {
            return EntitlementResolution(
                state: .active(expirationDate: expirationDate),
                cachedEntitlement: cachedEntitlement(
                    for: active,
                    expirationDate: expirationDate
                )
            )
        }

        let graceCandidates = trustedStatuses.compactMap {
            status -> (transaction: PremiumTransactionRecord, expirationDate: Date?)? in
            guard status.state == .gracePeriod,
                  case let .verified(transaction) = status.transaction,
                  transaction.revocationDate == nil,
                  !transaction.isUpgraded
            else { return nil }
            if let graceExpirationDate = status.gracePeriodExpirationDate,
               graceExpirationDate <= now() {
                return nil
            }
            return (transaction, status.gracePeriodExpirationDate)
        }
        if let grace = graceCandidates.max(by: {
            ($0.expirationDate ?? .distantFuture) < ($1.expirationDate ?? .distantFuture)
        }) {
            let cached = grace.expirationDate.map {
                cachedEntitlement(for: grace.transaction, expirationDate: $0)
            }
            return EntitlementResolution(
                state: .gracePeriod(expirationDate: grace.expirationDate),
                cachedEntitlement: cached
            )
        }

        if trustedStatuses.contains(where: { $0.state == .revoked }) {
            return EntitlementResolution(state: .revoked, cachedEntitlement: nil)
        }
        if trustedStatuses.contains(where: { $0.state == .billingRetry }) {
            return EntitlementResolution(state: .billingRetry, cachedEntitlement: nil)
        }
        if trustedStatuses.contains(where: { $0.state == .expired }) {
            return EntitlementResolution(state: .expired, cachedEntitlement: nil)
        }
        return EntitlementResolution(state: .inactive, cachedEntitlement: nil)
    }

    private func cachedEntitlement(
        for transaction: PremiumTransactionRecord,
        expirationDate: Date
    ) -> PremiumCachedEntitlement {
        PremiumCachedEntitlement(
            productIdentifier: transaction.productIdentifier,
            transactionIdentifier: transaction.id,
            expirationDate: expirationDate,
            verifiedAt: now()
        )
    }

    @discardableResult
    private func applyAndFinish(
        resolution: EntitlementResolution,
        verifiedTransactions: [PremiumTransactionRecord]
    ) async throws -> Bool {
        var uniqueTransactions: [PremiumTransactionRecord] = []
        var seen: Set<PremiumTransactionRecord> = []
        for transaction in verifiedTransactions where seen.insert(transaction).inserted {
            uniqueTransactions.append(transaction)
        }

        let unprocessed = uniqueTransactions.filter {
            !processedVerifiedTransactions.contains($0)
        }
        guard !unprocessed.isEmpty || accessState != resolution.state else {
            return false
        }

        if let cachedEntitlement = resolution.cachedEntitlement {
            try cache.save(cachedEntitlement)
        } else {
            cache.clear()
        }
        accessState = resolution.state

        for transaction in unprocessed {
            await storefront.finish(transactionIdentifier: transaction.id)
            processedVerifiedTransactions.insert(transaction)
        }
        return true
    }

    private func applyValidCachedEntitlement(
        configuration: WanderfulPremiumConfiguration
    ) {
        guard let cached = cache.load(),
              configuration.productIdentifiers.contains(cached.productIdentifier),
              cachedIsValid(cached)
        else {
            cache.clear()
            return
        }
        accessState = .cachedOffline(expirationDate: cached.expirationDate)
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
                monthlyProductIdentifier: "test.app.wanderful.premium.monthly",
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
