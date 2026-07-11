import Foundation
import Security

protocol SecureInstallationStoring: Sendable {
    func loadAppAttestKeyID() async throws -> String?
    func saveAppAttestKeyID(_ keyID: String) async throws
    func deleteAppAttestKeyID() async throws
}

enum SecureInstallationStoreError: Error, Sendable {
    case keychain(OSStatus)
    case invalidValue
}

actor SecureInstallationStore: SecureInstallationStoring {
    private let service: String
    private let account: String

    init(
        service: String = "com.trailmind.app.app-attest",
        account: String = "installation-key-id"
    ) {
        self.service = service
        self.account = account
    }

    func loadAppAttestKeyID() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw SecureInstallationStoreError.keychain(status)
        }
        guard
            let data = result as? Data,
            let value = String(data: data, encoding: .utf8),
            !value.isEmpty
        else {
            throw SecureInstallationStoreError.invalidValue
        }
        return value
    }

    func saveAppAttestKeyID(_ keyID: String) throws {
        guard !keyID.isEmpty, let data = keyID.data(using: .utf8) else {
            throw SecureInstallationStoreError.invalidValue
        }
        var attributes = baseQuery
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let updates = [kSecValueData as String: data]
            let updateStatus = SecItemUpdate(baseQuery as CFDictionary, updates as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw SecureInstallationStoreError.keychain(updateStatus)
            }
            return
        }
        guard status == errSecSuccess else {
            throw SecureInstallationStoreError.keychain(status)
        }
    }

    func deleteAppAttestKeyID() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecureInstallationStoreError.keychain(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any
        ]
    }
}
