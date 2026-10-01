#if DEBUG
import CryptoKit
import Foundation
import Security

/// A device-only, nonsynchronizing key. Renewal and reinstallation retain the same owner identity.
/// Missing keys are created locally; approval remains a separate operator action.
actor OwnerAccessKeychainSigner: OwnerAccessSigning {
    private let service: String
    private let account = "owner-access-p256-v1"

    init(service: String = (Bundle.main.bundleIdentifier ?? "com.wanderful.local") + ".owner-access") {
        self.service = service
    }

    func publicKey() throws -> P256.Signing.PublicKey { try loadOrCreate().publicKey }

    func signature(for data: Data) throws -> Data {
        try loadOrCreate().signature(for: data).rawRepresentation
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: false]
    }

    private func loadOrCreate() throws -> P256.Signing.PrivateKey {
        var read = query
        read[kSecReturnData as String] = true
        read[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(read as CFDictionary, &result)
        if status == errSecSuccess {
            guard let data = result as? Data else { throw AppAttestServiceError.invalidKey }
            return try P256.Signing.PrivateKey(rawRepresentation: data)
        }
        // Locked/corrupt/unavailable Keychain items never silently rotate the approved identity.
        guard status == errSecItemNotFound else { throw AppAttestServiceError.invalidKey }
        let key = P256.Signing.PrivateKey()
        var item = query
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        item[kSecValueData as String] = key.rawRepresentation
        let inserted = SecItemAdd(item as CFDictionary, nil)
        if inserted == errSecDuplicateItem { return try loadOrCreate() }
        guard inserted == errSecSuccess else { throw AppAttestServiceError.invalidKey }
        return key
    }
}
#endif
