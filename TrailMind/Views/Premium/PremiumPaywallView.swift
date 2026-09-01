import StoreKit
import SwiftUI

struct PremiumInvitationView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(PremiumAccessStore.self) private var premiumAccess
    let route: TrailRoute

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Your route is ready", systemImage: "checkmark.seal.fill")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(theme.forest)

            Text("You planned a verified route first. Explore Wanderful Premium only if it feels useful now.")
                .font(.subheadline)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                premiumAccess.presentPremium(after: route)
            } label: {
                Label("Explore Premium", systemImage: "sparkles")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.forestBright)
            .accessibilityHint("Opens optional subscription choices")
            .accessibilityIdentifier("premium.entry")
        }
        .trailCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("premium.invitation")
    }
}

struct PremiumSubscriptionControlsView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(PremiumAccessStore.self) private var premiumAccess
    @State private var showManageSubscriptions = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(accessLabel, systemImage: accessSymbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(theme.graphite)
                .accessibilityIdentifier("premium.profile.status")

            Button("Restore purchases", systemImage: "arrow.clockwise") {
                Task { await premiumAccess.restorePurchases() }
            }
            .disabled(premiumAccess.restoreState == .restoring)
            .accessibilityHint("Asks the App Store to resync past purchases")
            .accessibilityIdentifier("premium.profile.restore")

            profileRestoreStatus

            Button("Manage subscription", systemImage: "rectangle.and.pencil.and.ellipsis") {
                showManageSubscriptions = true
            }
            .accessibilityHint("Opens Apple's subscription management sheet")
            .accessibilityIdentifier("premium.profile.manage")
        }
        .manageSubscriptionsSheet(isPresented: $showManageSubscriptions)
    }

    @ViewBuilder
    private var profileRestoreStatus: some View {
        switch premiumAccess.restoreState {
        case .restoring:
            ProgressView("Restoring…")
                .font(.caption)
                .accessibilityIdentifier("premium.profile.restoreProcessing")
        case let .succeeded(foundAccess):
            Text(foundAccess ? "Premium access restored." : "No active Premium purchase was found.")
                .font(.caption)
                .foregroundStyle(theme.secondaryText)
                .accessibilityIdentifier("premium.profile.restoreResult")
        case let .failed(message):
            Text(message)
                .font(.caption)
                .foregroundStyle(theme.warning)
                .accessibilityIdentifier("premium.profile.restoreError")
        case .idle:
            EmptyView()
        }
    }

    private var accessLabel: String {
        switch premiumAccess.accessState {
        case .active: "Premium access is active"
        case .gracePeriod: "Premium access is in a billing grace period"
        case .cachedOffline: "Premium access was verified previously; connect to refresh"
        case .billingRetry: "App Store billing needs attention"
        case .expired: "Premium subscription expired"
        case .revoked: "Premium purchase was revoked"
        case .loading: "Checking Premium access…"
        case .inactive, .unavailable, .disabled: "No active Premium subscription"
        }
    }

    private var accessSymbol: String {
        premiumAccess.hasPremiumAccess ? "checkmark.seal.fill" : "sparkles"
    }
}

struct PremiumPaywallView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(PremiumAccessStore.self) private var premiumAccess
    @Environment(\.dismiss) private var dismiss
    @State private var showManageSubscriptions = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TrailSpacing.section) {
                    hero
                    principles
                    products
                    purchaseStatus
                    accountControls
                    renewalDisclosure
                    legalLinks
                }
                .padding(TrailSpacing.page)
            }
            .background(TrailBackground())
            .scrollIndicators(.hidden)
            .navigationTitle("Wanderful Premium")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", systemImage: "xmark") {
                        premiumAccess.dismissPaywall()
                        dismiss()
                    }
                    .accessibilityIdentifier("premium.close")
                }
            }
            .manageSubscriptionsSheet(isPresented: $showManageSubscriptions)
        }
        .interactiveDismissDisabled(false)
        .accessibilityIdentifier("premium.paywall")
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 12) {
            ZStack {
                Circle()
                    .fill(theme.mossSoft)
                Image(systemName: "mountain.2.fill")
                    .font(.title.weight(.semibold))
                    .foregroundStyle(theme.forest)
            }
            .frame(width: 58, height: 58)
            .accessibilityHidden(true)

            Text("Plan first. Decide after the value moment.")
                .font(.trailTitle)
                .foregroundStyle(theme.graphite)
                .fixedSize(horizontal: false, vertical: true)

            Text("Your route remains available whether or not you subscribe. Choose a plan only if Wanderful Premium is right for you.")
                .font(.body)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("premium.hero")
    }

    private var principles: some View {
        VStack(alignment: .leading, spacing: 14) {
            premiumPrinciple(
                symbol: "map.fill",
                title: "Guest-first planning",
                detail: "Plan and review a route before any purchase invitation appears."
            )
            premiumPrinciple(
                symbol: "checkmark.shield.fill",
                title: "Verified App Store access",
                detail: "Premium access is granted only after StoreKit verifies an active transaction."
            )
            premiumPrinciple(
                symbol: "slider.horizontal.3",
                title: "You stay in control",
                detail: "Restore purchases here, or manage and cancel through Apple."
            )
        }
        .trailCard()
    }

    @ViewBuilder
    private var products: some View {
        if premiumAccess.products.isEmpty,
           let message = premiumAccess.statusMessage {
            VStack(alignment: .leading, spacing: 12) {
                Label(
                    "Subscription options unavailable",
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.subheadline.weight(.bold))
                .foregroundStyle(theme.graphite)

                Text(message)
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)

                Button("Try again", systemImage: "arrow.clockwise") {
                    Task { await premiumAccess.reload() }
                }
                .buttonStyle(.bordered)
                .accessibilityHint("Reloads subscription options and verified access from the App Store")
                .accessibilityIdentifier("premium.products.retry")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .trailCard()
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("premium.products.error")
        } else if premiumAccess.products.isEmpty {
            VStack(spacing: 12) {
                ProgressView()
                    .accessibilityHidden(true)
                Text("Loading App Store options…")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 28)
            .trailCard()
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("premium.products.loading")
        } else {
            VStack(spacing: 14) {
                ForEach(premiumAccess.products) { product in
                    PremiumProductOption(product: product)
                }
            }
            .accessibilityIdentifier("premium.products")
        }
    }

    @ViewBuilder
    private var purchaseStatus: some View {
        switch premiumAccess.purchaseState {
        case let .purchasing(productIdentifier):
            Label(
                "Waiting for App Store confirmation…",
                systemImage: "hourglass"
            )
            .premiumStatusStyle(theme: theme)
            .accessibilityValue(productIdentifier)
            .accessibilityIdentifier("premium.purchase.processing")
        case .pending:
            Label(
                "Purchase pending approval. Premium will unlock only after the App Store confirms it.",
                systemImage: "clock.badge.questionmark"
            )
            .premiumStatusStyle(theme: theme)
            .accessibilityIdentifier("premium.purchase.pending")
        case .succeeded:
            Label("Premium access verified.", systemImage: "checkmark.seal.fill")
                .premiumStatusStyle(theme: theme)
                .accessibilityIdentifier("premium.purchase.success")
        case let .failed(message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .premiumStatusStyle(theme: theme, isWarning: true)
                .accessibilityIdentifier("premium.purchase.error")
        case .idle:
            if let message = premiumAccess.statusMessage {
                Label(message, systemImage: "info.circle")
                    .premiumStatusStyle(theme: theme)
                    .accessibilityIdentifier("premium.status")
            }
        }
    }

    private var accountControls: some View {
        VStack(spacing: 4) {
            Button("Restore purchases", systemImage: "arrow.clockwise") {
                Task { await premiumAccess.restorePurchases() }
            }
            .disabled(premiumAccess.restoreState == .restoring)
            .accessibilityHint("Asks the App Store to resync past purchases")
            .accessibilityIdentifier("premium.restore")

            restoreStatus

            Button("Manage subscription", systemImage: "rectangle.and.pencil.and.ellipsis") {
                showManageSubscriptions = true
            }
            .accessibilityHint("Opens Apple's subscription management sheet")
            .accessibilityIdentifier("premium.manage")
        }
        .buttonStyle(.borderless)
        .font(.subheadline.weight(.semibold))
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var restoreStatus: some View {
        switch premiumAccess.restoreState {
        case .restoring:
            ProgressView("Restoring…")
                .font(.caption)
                .accessibilityIdentifier("premium.restore.processing")
        case let .succeeded(foundAccess):
            Text(foundAccess ? "Premium access restored." : "No active Premium purchase was found.")
                .font(.caption)
                .foregroundStyle(theme.secondaryText)
                .accessibilityIdentifier("premium.restore.result")
        case let .failed(message):
            Text(message)
                .font(.caption)
                .foregroundStyle(theme.warning)
                .accessibilityIdentifier("premium.restore.error")
        case .idle:
            EmptyView()
        }
    }

    private var renewalDisclosure: some View {
        Text("Subscriptions automatically renew unless canceled at least 24 hours before the current period ends. Payment is charged to your Apple Account at confirmation. You can manage or cancel in App Store subscription settings.")
            .font(.caption)
            .foregroundStyle(theme.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("premium.renewalDisclosure")
    }

    @ViewBuilder
    private var legalLinks: some View {
        HStack(spacing: 22) {
            if let privacyPolicyURL = premiumAccess.privacyPolicyURL {
                Link("Privacy Policy", destination: privacyPolicyURL)
                    .accessibilityIdentifier("premium.privacy")
            }
            if let termsOfUseURL = premiumAccess.termsOfUseURL {
                Link("Terms of Use", destination: termsOfUseURL)
                    .accessibilityIdentifier("premium.terms")
            }
        }
        .font(.caption.weight(.semibold))
        .frame(maxWidth: .infinity)
    }

    private func premiumPrinciple(
        symbol: String,
        title: String,
        detail: String
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(theme.forest)
                .frame(width: 30, height: 30)
                .background(theme.mossSoft.opacity(0.7), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(theme.graphite)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct PremiumProductOption: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(PremiumAccessStore.self) private var premiumAccess
    let product: PremiumProduct

    private var isPurchasing: Bool {
        premiumAccess.purchaseState == .purchasing(productIdentifier: product.id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    productIdentity
                    Spacer(minLength: 16)
                    productPrice
                }

                VStack(alignment: .leading, spacing: 10) {
                    productIdentity
                    productPrice
                }
            }

            if let offer = product.introductoryOffer, offer.isEligible {
                Text(introductoryDisclosure(offer))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.forest)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("premium.offer.\(product.tier.rawValue)")
            }

            Button {
                Task { await premiumAccess.purchase(product) }
            } label: {
                if isPurchasing {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .accessibilityHidden(true)
                } else {
                    Text("Subscribe for \(product.displayPrice) per \(product.periodDescription)")
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.forestBright)
            .disabled(
                premiumAccess.purchaseState.isBusy ||
                    !premiumAccess.canMakePayments
            )
            .accessibilityLabel(
                isPurchasing
                    ? "Processing \(product.displayName) subscription"
                    : "Subscribe to \(product.displayName) for \(product.displayPrice) per \(product.periodDescription)"
            )
            .accessibilityHint("Completes the subscription through the App Store")
            .accessibilityIdentifier("premium.subscribe.\(product.tier.rawValue)")
        }
        .trailCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("premium.product.\(product.tier.rawValue)")
    }

    private var productIdentity: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(product.displayName)
                .font(.headline)
                .foregroundStyle(theme.graphite)
            Text(product.description)
                .font(.caption)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var productPrice: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(product.displayPrice)
                .font(.title3.weight(.bold))
                .foregroundStyle(theme.graphite)
            Text("per \(product.periodDescription)")
                .font(.caption)
                .foregroundStyle(theme.secondaryText)
        }
    }

    private func introductoryDisclosure(
        _ offer: PremiumIntroductoryOffer
    ) -> String {
        let period = offer.periodCount == 1
            ? offer.periodDescription
            : "\(offer.periodCount) × \(offer.periodDescription)"
        switch offer.paymentMode {
        case .freeTrial:
            return "Eligible customers: \(period) free, then \(product.displayPrice) per \(product.periodDescription)."
        case .payAsYouGo:
            return "Eligible customers: \(offer.displayPrice) per \(offer.periodDescription) for \(offer.periodCount) periods, then \(product.displayPrice) per \(product.periodDescription)."
        case .payUpFront:
            return "Eligible customers: \(offer.displayPrice) for \(period), then \(product.displayPrice) per \(product.periodDescription)."
        }
    }
}

private extension PremiumPurchaseState {
    var isBusy: Bool {
        if case .purchasing = self { return true }
        return false
    }
}

private extension View {
    func premiumStatusStyle(
        theme: TrailTheme,
        isWarning: Bool = false
    ) -> some View {
        self
            .font(.caption)
            .foregroundStyle(isWarning ? theme.warning : theme.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }
}
