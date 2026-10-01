#if DEBUG
import CryptoKit
import Foundation
import Security

nonisolated struct OwnerAccessConfiguration: Sendable {
    let origin: String
    let baseURL: URL

    init(origin: String) throws {
        _ = try OwnerAccessProof.clientData(origin: origin,
            keyID: OwnerAccessProof.base64URL(Data(repeating: 0, count: 32)),
            challengeID: OwnerAccessProof.base64URL(Data(repeating: 0, count: 24)),
            challenge: Data(repeating: 0, count: 32), nonce: Data(repeating: 0, count: 32))
        guard let url = URL(string: origin) else { throw AppAttestServiceError.configurationUnavailable }
        self.origin = origin
        self.baseURL = url
    }

    /// An explicit build opt-in and local bundle identity are both required.
    static func load(bundle: Bundle = .main) -> Self? {
        #if WANDERFUL_PRIVATE_OWNER
        guard bundle.object(forInfoDictionaryKey: "TRAILMIND_APP_ENVIRONMENT") as? String == "local",
              ["com.trailmind.app.local", "com.piroscheibe.wanderful.local"].contains(bundle.bundleIdentifier ?? ""),
              let origin = bundle.object(forInfoDictionaryKey: "WANDERFUL_OWNER_ACCESS_ORIGIN") as? String else { return nil }
        return try? Self(origin: origin)
        #else
        return nil
        #endif
    }
}

nonisolated protocol OwnerAccessSigning: Sendable {
    func publicKey() async throws -> P256.Signing.PublicKey
    func signature(for data: Data) async throws -> Data
}

/// Supplies renewable short-lived sessions. Construction never enrolls a key or opens a connection.
actor OwnerAccessClient: RouteSessionOpening {
    private let configuration: OwnerAccessConfiguration
    private let signer: any OwnerAccessSigning
    private let session: URLSession
    private let now: @Sendable () -> Date
    private let nonce: @Sendable () throws -> Data

    init(configuration: OwnerAccessConfiguration,
         signer: any OwnerAccessSigning = OwnerAccessKeychainSigner(),
         session: URLSession = OwnerAccessClient.makeSession(),
         now: @escaping @Sendable () -> Date = { Date() },
         nonce: @escaping @Sendable () throws -> Data = { try OwnerAccessClient.randomNonce() }) {
        self.configuration = configuration
        self.signer = signer
        self.session = session
        self.now = now
        self.nonce = nonce
    }

    func openRouteSession() async throws -> RouteSession {
        do {
            let key = try await signer.publicKey()
            let keyID = OwnerAccessProof.keyID(for: key)
            let challenge: Challenge = try await post("/api/owner-access/challenge", body: ["keyId": keyID])
            let challengeBytes = try decode(challenge.challenge, count: 32)
            _ = try decode(challenge.challengeId, count: 24)
            guard let challengeExpiry = date(challenge.expiresAt),
                  challengeExpiry > now(), challengeExpiry <= now().addingTimeInterval(65) else {
                throw AppAttestServiceError.invalidResponse
            }
            let nonceBytes = try nonce()
            let payload = try OwnerAccessProof.clientData(origin: configuration.origin, keyID: keyID,
                challengeID: challenge.challengeId, challenge: challengeBytes, nonce: nonceBytes)
            let signature = try await signer.signature(for: payload)
            guard signature.count == 64, challengeExpiry > now() else { throw AppAttestServiceError.invalidResponse }
            let result: SessionResponse = try await post("/api/owner-access/route-session", body: [
                "keyId": keyID, "challengeId": challenge.challengeId,
                "sessionNonce": OwnerAccessProof.base64URL(nonceBytes),
                "signature": OwnerAccessProof.base64URL(signature)
            ])
            _ = try decode(result.routeSessionToken, count: 32)
            guard let expiresAt = date(result.expiresAt), expiresAt > now().addingTimeInterval(10),
                  expiresAt <= now().addingTimeInterval(125), (1...12).contains(result.remainingCost) else {
                throw AppAttestServiceError.invalidResponse
            }
            return RouteSession(token: result.routeSessionToken, expiresAt: expiresAt, remainingCost: result.remainingCost)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as AppAttestServiceError {
            throw error
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch is URLError {
            throw AppAttestServiceError.networkUnavailable
        } catch {
            throw AppAttestServiceError.invalidResponse
        }
    }

    /// Explicit operator transfer only; contains SPKI public key and derived ID, never private material.
    func exportEnrollmentPublicKey() async throws -> OwnerAccessPublicKeyExport {
        let key = try await signer.publicKey()
        return OwnerAccessPublicKeyExport(keyId: OwnerAccessProof.keyID(for: key), publicKeySPKI: key.derRepresentation.base64EncodedString())
    }

    private func post<T: Decodable & Sendable>(_ path: String, body: [String: String]) async throws -> T {
        let url = configuration.baseURL.appendingPathComponent(String(path.dropFirst()))
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 75)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpShouldHandleCookies = false
        request.httpBody = try JSONEncoder().encode(body)
        let (bytes, response) = try await session.bytes(for: request, delegate: OwnerAccessNoRedirect())
        guard let response = response as? HTTPURLResponse, response.url == url,
              response.expectedContentLength <= 8192 else { throw AppAttestServiceError.invalidResponse }
        var data = Data()
        for try await byte in bytes {
            guard data.count < 8192 else { throw AppAttestServiceError.invalidResponse }
            data.append(byte)
        }
        guard response.statusCode == 200 else {
            // Status is enough to select safe copy. Never display remote exception text.
            switch response.statusCode {
            case 401, 403: throw AppAttestServiceError.authorizationDenied
            case 429: throw AppAttestServiceError.rateLimited
            case 503: throw AppAttestServiceError.networkUnavailable
            default: throw AppAttestServiceError.invalidResponse
            }
        }
        guard response.mimeType == "application/json" else { throw AppAttestServiceError.invalidResponse }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func decode(_ value: String, count: Int) throws -> Data {
        let padded = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            + String(repeating: "=", count: (4 - value.count % 4) % 4)
        guard let bytes = Data(base64Encoded: padded), bytes.count == count,
              OwnerAccessProof.base64URL(bytes) == value else { throw AppAttestServiceError.invalidResponse }
        return bytes
    }

    private func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }

    nonisolated static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        // The free hosting instance can need about a minute to wake after idling.
        // This is bounded waiting, with cancellation and no automatic retry loop.
        configuration.timeoutIntervalForRequest = 75
        configuration.timeoutIntervalForResource = 90
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }

    nonisolated static func randomNonce() throws -> Data {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw AppAttestServiceError.invalidKey
        }
        return Data(bytes)
    }

    private struct Challenge: Decodable, Sendable { let challengeId: String; let challenge: String; let expiresAt: String }
    private struct SessionResponse: Decodable, Sendable { let routeSessionToken: String; let expiresAt: String; let remainingCost: Int }
}

nonisolated struct OwnerAccessPublicKeyExport: Sendable, Encodable {
    let keyId: String
    let publicKeySPKI: String
}

private nonisolated final class OwnerAccessNoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
#endif
