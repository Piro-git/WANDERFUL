#if DEBUG
import CryptoKit
import Foundation

/// Inactive wire-contract foundation for a separately deployed personal-device service.
/// This does not enroll a device, store a key, or enable an authorization fallback.
nonisolated enum OwnerAccessProof {
    enum Failure: Error { case invalidOrigin, invalidField }

    static func keyID(for key: P256.Signing.PublicKey) -> String {
        base64URL(Data(SHA256.hash(data: key.derRepresentation)))
    }

    static func clientData(origin: String, keyID: String, challengeID: String,
                           challenge: Data, nonce: Data) throws -> Data {
        guard let components = URLComponents(string: origin),
              components.scheme == "https", let host = components.host,
              host.contains("."), host == host.lowercased(),
              components.port == nil, components.user == nil, components.password == nil,
              components.path.isEmpty, components.query == nil, components.fragment == nil,
              origin == "https://\(host)",
              !host.allSatisfy({ $0.isNumber || $0 == "." }),
              !["localhost", "local", "trycloudflare.com", "ngrok.io", "ngrok-free.app"].contains(where: {
                  host == $0 || host.hasSuffix("." + $0)
              }) else { throw Failure.invalidOrigin }
        try validate(keyID, count: 32)
        try validate(challengeID, count: 24)
        guard challenge.count == 32, nonce.count == 32 else { throw Failure.invalidField }
        let fields = [Data("wanderful-owner-session-v1".utf8), Data(origin.utf8),
                      Data("POST".utf8), Data("/api/owner-access/route-session".utf8),
                      Data(keyID.utf8), Data(challengeID.utf8), challenge, nonce]
        var result = Data()
        for field in fields {
            var length = UInt32(field.count).bigEndian
            withUnsafeBytes(of: &length) { result.append(contentsOf: $0) }
            result.append(field)
        }
        return result
    }

    static func signature(for data: Data, key: P256.Signing.PrivateKey) throws -> String {
        base64URL(try key.signature(for: data).rawRepresentation)
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    private static func validate(_ value: String, count: Int) throws {
        guard value.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95 }) else { throw Failure.invalidField }
        let padded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            + String(repeating: "=", count: (4 - value.count % 4) % 4)
        guard let decoded = Data(base64Encoded: padded), decoded.count == count,
              base64URL(decoded) == value else { throw Failure.invalidField }
    }
}
#endif
