import Foundation

protocol AccountServicing: Sendable {
    func signIn(_ credential: AppleAccountCredential) async throws -> WanderfulAccountSession
    func signOut(session: WanderfulAccountSession) async throws
    func deleteAccount(session: WanderfulAccountSession, reauthentication: AppleAccountCredential) async throws
}

enum AccountServiceError: LocalizedError, Equatable, Sendable {
    case invalidServerResponse, rejected
    var errorDescription: String? { "The account service could not complete the request." }
}

enum AccountStoreError: LocalizedError, Equatable, Sendable {
    case noActiveSession
    case sessionChangedDuringDeletion

    func message(for locale: Locale = .current) -> String {
        switch locale.language.languageCode?.identifier {
        case "de":
            switch self {
            case .noActiveSession:
                "Du bist nicht angemeldet. Melde dich an, bevor du dein Konto löschst."
            case .sessionChangedDuringDeletion:
                "Deine Sitzung wurde geändert. Dein Konto wurde nicht lokal gelöscht. Bitte melde dich erneut an und versuche es noch einmal."
            }
        default:
            switch self {
            case .noActiveSession:
                "You’re not signed in. Sign in before deleting your account."
            case .sessionChangedDuringDeletion:
                "Your session changed. Your account was not deleted locally. Please sign in again and try once more."
            }
        }
    }

    var errorDescription: String? { message() }
}

/// Account access is opt-in at composition time. A missing or non-HTTPS backend
/// produces no store and therefore cannot start an authentication request.
nonisolated struct WanderfulAccountCapability: Equatable, Sendable {
    let enabled: Bool
    static let disabled = Self(enabled: false)
}

enum AccountStoreFactory {
    static func make(
        capability: WanderfulAccountCapability = .disabled,
        backend: WanderfulServiceConfiguration<WanderfulBackendConfiguration>
    ) -> AccountStore? {
        guard capability.enabled,
              let baseURL = backend.configuredValue?.baseURL,
              baseURL.scheme?.lowercased() == "https",
              baseURL.host != nil
        else { return nil }
        return AccountStore(service: BackendAccountService(baseURL: baseURL))
    }
}

struct BackendAccountService: AccountServicing {
    let baseURL: URL
    let session: URLSession
    init(baseURL: URL, session: URLSession = .shared) { self.baseURL = baseURL; self.session = session }
    func signIn(_ credential: AppleAccountCredential) async throws -> WanderfulAccountSession {
        let reply: AccountReply = try await post("/api/account/apple/sign-in", body: CredentialBody(credential), token: nil)
        guard let accountID = reply.accountID, let token = reply.sessionToken else { throw AccountServiceError.invalidServerResponse }
        return WanderfulAccountSession(accountID: accountID, token: token)
    }
    func signOut(session: WanderfulAccountSession) async throws { let _: AccountReply = try await post("/api/account/sign-out", body: EmptyBody(), token: session.token) }
    func deleteAccount(session: WanderfulAccountSession, reauthentication: AppleAccountCredential) async throws { let reply: AccountReply = try await post("/api/account/delete", body: CredentialBody(reauthentication), token: session.token); guard reply.deleted == true else { throw AccountServiceError.rejected } }
    private func post<T: Encodable, R: Decodable>(_ path: String, body: T, token: String?) async throws -> R {
        var request = URLRequest(url: baseURL.appending(path: path)); request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.setValue("no-store", forHTTPHeaderField: "Cache-Control"); if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }; request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request); guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw AccountServiceError.rejected }; return try JSONDecoder().decode(R.self, from: data)
    }
    private struct CredentialBody: Encodable { let identityToken: String; let authorizationCode: String; let nonce: String; init(_ value: AppleAccountCredential) { identityToken = value.identityToken; authorizationCode = value.authorizationCode; nonce = value.nonce } }
    private struct EmptyBody: Encodable {}
    private struct AccountReply: Decodable { let accountID: String?; let sessionToken: String?; let deleted: Bool? }
}

actor AccountStore {
    private let service: any AccountServicing
    private let storage: any AccountSessionStoring
    private let credentialChecker: any AppleAccountCredentialChecking
    private(set) var session: WanderfulAccountSession?
    init(
        service: any AccountServicing,
        storage: any AccountSessionStoring = KeychainAccountSessionStore(),
        credentialChecker: any AppleAccountCredentialChecking = AppleAccountCredentialChecker()
    ) {
        self.service = service
        self.storage = storage
        self.credentialChecker = credentialChecker
        self.session = try? storage.load()
    }

    func signIn(with credential: AppleAccountCredential) async throws {
        let reply = try await service.signIn(credential)
        let session = WanderfulAccountSession(
            accountID: reply.accountID,
            token: reply.token,
            appleUserIdentifier: credential.userIdentifier
        )
        try storage.save(session)
        self.session = session
    }

    /// A transient Apple error does not delete credentials, but cannot confirm access.
    /// Only the captured session may be cleared: an in-flight check must not erase a new login.
    func validateAppleCredential() async throws -> Bool {
        guard let current = session,
              let identifier = current.appleUserIdentifier,
              !identifier.isEmpty else { return false }
        let authorized = try await credentialChecker.isAuthorized(userIdentifier: identifier)
        guard session == current else { return false }
        guard !authorized else { return true }
        session = nil
        try storage.clear()
        // Local revocation takes effect even if the backend cannot be reached.
        // Server-side revocation notifications remain a separate backend requirement.
        try? await service.signOut(session: current)
        return false
    }
    func signOut() async throws { guard let session else { return }; try await service.signOut(session: session); try storage.clear(); self.session = nil }
    /// Server deletion happens first. On failure we deliberately retain the local credential and never show success.
    func deleteAccount(reauthentication: AppleAccountCredential) async throws {
        guard let session else { throw AccountStoreError.noActiveSession }
        try await service.deleteAccount(session: session, reauthentication: reauthentication)
        guard self.session == session else { throw AccountStoreError.sessionChangedDuringDeletion }
        try storage.clear()
        self.session = nil
    }
}
