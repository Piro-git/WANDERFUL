import Foundation

@MainActor
final class AccountAccessCache {
    typealias Access = (store: AccountStore, authenticator: AppleAccountAuthenticator)
    private var cachedAccess: Access?

    func access(orCreate make: () -> Access?) -> Access? {
        if let cachedAccess { return cachedAccess }
        guard let access = make() else { return nil }
        cachedAccess = access
        return access
    }
}

/// Deliberately opt-in: a configured research backend alone never enables accounts.
@MainActor enum WanderfulAccountAccess {
    private static let cache = AccountAccessCache()

    static func isEnabled(info: [String: Any]) -> Bool {
        info["WANDERFUL_ACCOUNT_ENABLED"] as? String == "true" &&
            info["WANDERFUL_APPLE_SIGN_IN_ENABLED"] as? String == "true"
    }

    static func make(bundle: Bundle = .main) -> (store: AccountStore, authenticator: AppleAccountAuthenticator)? {
        guard isEnabled(info: bundle.infoDictionary ?? [:]),
              let configuration = WanderfulAppConfigurationSnapshot.configuration else {
            return nil
        }
        return cache.access(orCreate: {
            AccountStoreFactory.make(
                capability: .init(enabled: true),
                backend: configuration.backend
            ).map { ($0, AppleAccountAuthenticator()) }
        })
    }
}
