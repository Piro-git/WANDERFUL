import Foundation
import Security

nonisolated struct WanderfulAccountSession: Codable, Equatable, Sendable {
    let accountID: String
    let token: String
    let appleUserIdentifier: String?

    init(accountID: String, token: String, appleUserIdentifier: String? = nil) {
        self.accountID = accountID
        self.token = token
        self.appleUserIdentifier = appleUserIdentifier
    }
}

protocol AccountSessionStoring: Sendable {
    nonisolated func load() throws -> WanderfulAccountSession?
    nonisolated func save(_ session: WanderfulAccountSession) throws
    nonisolated func clear() throws
}

struct KeychainAccountSessionStore: AccountSessionStoring {
    private let service = "com.trailmind.app.account"
    private let account = "session-v1"
    nonisolated func load() throws -> WanderfulAccountSession? {
        var query = base; query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw AccountSessionStoreError.keychain(status) }
        return try JSONDecoder().decode(WanderfulAccountSession.self, from: data)
    }
    nonisolated func save(_ session: WanderfulAccountSession) throws {
        let data = try JSONEncoder().encode(session); var item = base
        item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecDuplicateItem { let result = SecItemUpdate(base as CFDictionary, [kSecValueData as String: data] as CFDictionary); guard result == errSecSuccess else { throw AccountSessionStoreError.keychain(result) }; return }
        guard status == errSecSuccess else { throw AccountSessionStoreError.keychain(status) }
    }
    nonisolated func clear() throws { let status = SecItemDelete(base as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw AccountSessionStoreError.keychain(status) } }
    nonisolated private var base: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecAttrSynchronizable as String: kCFBooleanFalse as Any] }
}

enum AccountSessionStoreError: Error, Equatable, Sendable { case keychain(OSStatus) }
