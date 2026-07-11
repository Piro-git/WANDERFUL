@preconcurrency import DeviceCheck
import CryptoKit
import Foundation
import Security

enum AppAttestServiceError: LocalizedError, Sendable, Equatable {
    case unsupported
    case invalidKey
    case notRegistered
    case verificationFailed
    case invalidResponse
    case networkUnavailable

    var errorDescription: String? {
        "TrailMind couldn’t verify this app installation. Check your connection and try again."
    }
}

protocol AppAttestKeyProviding: Sendable {
    func isSupported() async -> Bool
    func generateKey() async throws -> String
    func attestKey(_ keyID: String, clientDataHash: Data) async throws -> Data
    func generateAssertion(_ keyID: String, clientDataHash: Data) async throws -> Data
}

final class SystemAppAttestProvider: AppAttestKeyProviding, @unchecked Sendable {
    func isSupported() async -> Bool {
        DCAppAttestService.shared.isSupported
    }

    func generateKey() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            DCAppAttestService.shared.generateKey { keyID, error in
                Self.resume(continuation, value: keyID, error: error)
            }
        }
    }

    func attestKey(_ keyID: String, clientDataHash: Data) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            DCAppAttestService.shared.attestKey(keyID, clientDataHash: clientDataHash) { value, error in
                Self.resume(continuation, value: value, error: error)
            }
        }
    }

    func generateAssertion(_ keyID: String, clientDataHash: Data) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            DCAppAttestService.shared.generateAssertion(keyID, clientDataHash: clientDataHash) { value, error in
                Self.resume(continuation, value: value, error: error)
            }
        }
    }

    private nonisolated static func resume<T: Sendable>(
        _ continuation: CheckedContinuation<T, Error>,
        value: T?,
        error: Error?
    ) {
        if let error {
            continuation.resume(throwing: isInvalidKey(error) ? AppAttestServiceError.invalidKey : error)
        } else if let value {
            continuation.resume(returning: value)
        } else {
            continuation.resume(throwing: AppAttestServiceError.invalidResponse)
        }
    }

    private nonisolated static func isInvalidKey(_ error: Error) -> Bool {
        let value = error as NSError
        return value.domain == "com.apple.devicecheck.error" && value.code == 2
    }
}

protocol AppAttestAPI: Sendable {
    func challenge(purpose: AppAttestChallengePurpose, keyID: String?) async throws -> AppAttestChallenge
    func register(challengeID: String, keyID: String, attestationObject: Data) async throws
    func routeSession(
        challengeID: String,
        keyID: String,
        sessionNonce: Data,
        assertionObject: Data
    ) async throws -> RouteSession
}

enum AppAttestChallengePurpose: String, Sendable, Encodable {
    case registration
    case routeSession
}

struct AppAttestChallenge: Sendable, Equatable {
    let id: String
    let value: Data
    let expiresAt: Date
}

actor AppAttestService: RouteSessionOpening {
    private let provider: any AppAttestKeyProviding
    private let store: any SecureInstallationStoring
    private let api: any AppAttestAPI

    init(
        provider: any AppAttestKeyProviding = SystemAppAttestProvider(),
        store: any SecureInstallationStoring = SecureInstallationStore(),
        api: any AppAttestAPI = URLSessionAppAttestAPI()
    ) {
        self.provider = provider
        self.store = store
        self.api = api
    }

    func openRouteSession() async throws -> RouteSession {
        guard await provider.isSupported() else {
            throw AppAttestServiceError.unsupported
        }
        do {
            return try await openRouteSessionRecoveringRegistration()
        } catch AppAttestServiceError.invalidKey {
            try await store.deleteAppAttestKeyID()
            return try await openRouteSessionRecoveringRegistration()
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as AppAttestServiceError {
            throw error
        } catch {
            throw AppAttestServiceError.verificationFailed
        }
    }

    private func openRouteSessionRecoveringRegistration() async throws -> RouteSession {
        let key = try await installationKey()
        if key.isNew {
            try await register(keyID: key.id)
        }
        do {
            return try await exchangeRouteSession(keyID: key.id)
        } catch AppAttestServiceError.notRegistered {
            try await register(keyID: key.id)
            return try await exchangeRouteSession(keyID: key.id)
        }
    }

    private func installationKey() async throws -> (id: String, isNew: Bool) {
        if let keyID = try await store.loadAppAttestKeyID() {
            return (keyID, false)
        }
        let keyID = try await provider.generateKey()
        try await store.saveAppAttestKeyID(keyID)
        return (keyID, true)
    }

    private func register(keyID: String) async throws {
        let challenge = try await api.challenge(purpose: .registration, keyID: nil)
        let hash = Data(SHA256.hash(data: challenge.value))
        let attestation = try await provider.attestKey(keyID, clientDataHash: hash)
        try await api.register(
            challengeID: challenge.id,
            keyID: keyID,
            attestationObject: attestation
        )
    }

    private func exchangeRouteSession(keyID: String) async throws -> RouteSession {
        let challenge = try await api.challenge(purpose: .routeSession, keyID: keyID)
        let nonce = try Self.randomBytes(count: 32)
        let clientData = Self.canonicalRouteSessionClientData(
            challenge: challenge.value,
            keyID: keyID,
            sessionNonce: nonce
        )
        let assertion = try await provider.generateAssertion(
            keyID,
            clientDataHash: Data(SHA256.hash(data: clientData))
        )
        return try await api.routeSession(
            challengeID: challenge.id,
            keyID: keyID,
            sessionNonce: nonce,
            assertionObject: assertion
        )
    }

    nonisolated static func canonicalRouteSessionClientData(
        challenge: Data,
        keyID: String,
        sessionNonce: Data
    ) -> Data {
        let fields = [
            Data("trailmind-route-session-v1".utf8),
            Data("POST".utf8),
            Data("/api/app-attest/route-session".utf8),
            challenge,
            Data(keyID.utf8),
            sessionNonce
        ]
        var result = Data()
        for field in fields {
            var length = UInt32(field.count).bigEndian
            withUnsafeBytes(of: &length) { result.append(contentsOf: $0) }
            result.append(field)
        }
        return result
    }

    private nonisolated static func randomBytes(count: Int) throws -> Data {
        var data = Data(count: count)
        let status = data.withUnsafeMutableBytes { bytes in
            SecRandomCopyBytes(kSecRandomDefault, count, bytes.baseAddress!)
        }
        guard status == errSecSuccess else {
            throw AppAttestServiceError.verificationFailed
        }
        return data
    }
}

struct URLSessionAppAttestAPI: AppAttestAPI, Sendable {
    private let baseURL: URL?
    private let session: URLSession

    init(
        baseURL: URL? = TrailMindBackendConfiguration.baseURL(),
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.session = session
    }

    func challenge(purpose: AppAttestChallengePurpose, keyID: String?) async throws -> AppAttestChallenge {
        let response: ChallengeResponse = try await post(
            path: "api/app-attest/challenge",
            body: ChallengeRequest(purpose: purpose.rawValue, keyId: keyID)
        )
        guard
            let value = Data.strictBase64URLDecoded(response.challenge),
            value.count >= 32,
            let expiresAt = Self.date(response.expiresAt)
        else {
            throw AppAttestServiceError.invalidResponse
        }
        return AppAttestChallenge(id: response.challengeId, value: value, expiresAt: expiresAt)
    }

    func register(challengeID: String, keyID: String, attestationObject: Data) async throws {
        let response: RegistrationResponse = try await post(
            path: "api/app-attest/register",
            body: RegistrationRequest(
                challengeId: challengeID,
                keyId: keyID,
                attestationObject: attestationObject.base64URLEncodedString()
            )
        )
        guard response.registered else { throw AppAttestServiceError.invalidResponse }
    }

    func routeSession(
        challengeID: String,
        keyID: String,
        sessionNonce: Data,
        assertionObject: Data
    ) async throws -> RouteSession {
        let response: RouteSessionResponse = try await post(
            path: "api/app-attest/route-session",
            body: RouteSessionRequest(
                challengeId: challengeID,
                keyId: keyID,
                sessionNonce: sessionNonce.base64URLEncodedString(),
                assertionObject: assertionObject.base64URLEncodedString()
            )
        )
        guard
            Data.strictBase64URLDecoded(response.routeSessionToken)?.count == 32,
            let expiresAt = Self.date(response.expiresAt),
            response.remainingCost > 0
        else {
            throw AppAttestServiceError.invalidResponse
        }
        return RouteSession(
            token: response.routeSessionToken,
            expiresAt: expiresAt,
            remainingCost: response.remainingCost
        )
    }

    private func post<Request: Encodable, Response: Decodable>(
        path: String,
        body: Request
    ) async throws -> Response {
        guard let baseURL, let endpoint = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw AppAttestServiceError.networkUnavailable
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(body)
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw AppAttestServiceError.invalidResponse
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                let envelope = try? JSONDecoder().decode(ServerErrorEnvelope.self, from: data)
                throw Self.mapServerError(envelope?.error.code)
            }
            return try JSONDecoder().decode(Response.self, from: data)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as AppAttestServiceError {
            throw error
        } catch {
            throw AppAttestServiceError.networkUnavailable
        }
    }

    private nonisolated static func mapServerError(_ code: String?) -> AppAttestServiceError {
        switch code {
        case "app_attest_not_registered": .notRegistered
        case "app_attest_unsupported": .unsupported
        default: .verificationFailed
        }
    }

    private nonisolated static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }
}

enum TrailMindBackendConfiguration {
    nonisolated static func baseURL(bundle: Bundle = .main) -> URL? {
        guard
            let value = bundle.object(forInfoDictionaryKey: "INTENT_BACKEND_BASE_URL") as? String,
            let url = URL(string: value),
            url.host != nil
        else {
            return nil
        }
        if url.scheme == "https" { return url }
        #if DEBUG
        if url.scheme == "http", ["127.0.0.1", "localhost", "::1"].contains(url.host ?? "") {
            return url
        }
        #endif
        return nil
    }
}

private struct ChallengeRequest: Encodable { let purpose: String; let keyId: String? }
private struct ChallengeResponse: Decodable { let challengeId: String; let challenge: String; let expiresAt: String }
private struct RegistrationRequest: Encodable { let challengeId: String; let keyId: String; let attestationObject: String }
private struct RegistrationResponse: Decodable { let registered: Bool }
private struct RouteSessionRequest: Encodable {
    let challengeId: String
    let keyId: String
    let sessionNonce: String
    let assertionObject: String
}
private struct RouteSessionResponse: Decodable {
    let routeSessionToken: String
    let expiresAt: String
    let remainingCost: Int
}
private struct ServerErrorEnvelope: Decodable { let error: ServerErrorBody }
private struct ServerErrorBody: Decodable { let code: String; let message: String }

private extension Data {
    nonisolated func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    nonisolated static func strictBase64URLDecoded(_ value: String) -> Data? {
        guard
            !value.isEmpty,
            value.unicodeScalars.allSatisfy({
                CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
            }),
            value.count % 4 != 1
        else {
            return nil
        }
        var base64 = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64), data.base64URLEncodedString() == value else {
            return nil
        }
        return data
    }
}
