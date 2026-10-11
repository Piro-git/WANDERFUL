import AuthenticationServices
import XCTest
@testable import TrailMind

final class AccountAuthenticationTests: XCTestCase {
    func testSessionCodableRoundTrip() throws { let value = WanderfulAccountSession(accountID: "account", token: "token"); XCTAssertEqual(try JSONDecoder().decode(WanderfulAccountSession.self, from: JSONEncoder().encode(value)), value) }
    func testCancelledLoginHasAUserSafeMessage() { XCTAssertEqual(AppleAccountAuthenticationError.cancelled.errorDescription, "Sign in was cancelled.") }
    func testDeletionFailureDoesNotClaimSuccess() { XCTAssertEqual(AppleAccountAuthenticationError.failed.errorDescription, "Sign in with Apple could not be completed.") }
    @MainActor
    func testAccountAccessRequiresBothAccountAndAppleSignInReleaseGates() {
        XCTAssertFalse(WanderfulAccountAccess.isEnabled(info: [:]))
        XCTAssertFalse(WanderfulAccountAccess.isEnabled(info: ["WANDERFUL_ACCOUNT_ENABLED": "true"]))
        XCTAssertFalse(WanderfulAccountAccess.isEnabled(info: ["WANDERFUL_APPLE_SIGN_IN_ENABLED": "true"]))
        XCTAssertTrue(WanderfulAccountAccess.isEnabled(info: ["WANDERFUL_ACCOUNT_ENABLED": "true", "WANDERFUL_APPLE_SIGN_IN_ENABLED": "true"]))
    }
    @MainActor
    func testAccountStoreFactoryIsDisabledByDefaultAndRejectsInsecureBackend() {
        let secure = WanderfulServiceConfiguration.configured(WanderfulBackendConfiguration(baseURL: URL(string: "https://planner.example")!))
        XCTAssertNil(AccountStoreFactory.make(backend: secure))
        XCTAssertNil(AccountStoreFactory.make(capability: .init(enabled: true), backend: .configured(.init(baseURL: URL(string: "http://127.0.0.1")!))))
        XCTAssertNotNil(AccountStoreFactory.make(capability: .init(enabled: true), backend: secure))
    }

    @MainActor
    func testAccountAccessCachePreservesTheStoreAndAuthenticatorAcrossRecompositions() throws {
        let cache = AccountAccessCache()
        let first = try XCTUnwrap(cache.access(orCreate: {
            (AccountStore(service: TestAccountService()), AppleAccountAuthenticator())
        }))
        let second = try XCTUnwrap(cache.access(orCreate: {
            (AccountStore(service: TestAccountService()), AppleAccountAuthenticator())
        }))

        XCTAssertTrue(first.store === second.store)
        XCTAssertTrue(first.authenticator === second.authenticator)
    }

    func testDeletionWithoutSessionFailsWithoutMakingARequestOrClearingStorage() async {
        let service = TestAccountService()
        let storage = TestAccountSessionStorage(session: nil)
        let store = AccountStore(service: service, storage: storage)

        await assertDeletionFails(store, expected: .noActiveSession)

        let deletionRequestCount = await service.deletionRequestCount
        XCTAssertEqual(deletionRequestCount, 0)
        XCTAssertEqual(storage.clearCallCount, 0)
        XCTAssertNil(storage.session)
    }

    func testServerDeletionFailureRetainsLocalSessionAndDoesNotReportSuccess() async {
        let existing = testSession
        let service = TestAccountService(deletionError: AccountServiceError.rejected)
        let storage = TestAccountSessionStorage(session: existing)
        let store = AccountStore(service: service, storage: storage)

        do {
            try await store.deleteAccount(reauthentication: testCredential)
            XCTFail("A rejected server deletion must not succeed.")
        } catch {
            XCTAssertEqual(error as? AccountServiceError, .rejected)
        }

        let deletionRequestCount = await service.deletionRequestCount
        let currentSession = await store.session
        XCTAssertEqual(deletionRequestCount, 1)
        XCTAssertEqual(storage.clearCallCount, 0)
        XCTAssertEqual(storage.session, existing)
        XCTAssertEqual(currentSession, existing)
    }

    func testConfirmedServerDeletionClearsLocalSessionOnlyAfterSuccess() async throws {
        let existing = testSession
        let service = TestAccountService()
        let storage = TestAccountSessionStorage(session: existing)
        let store = AccountStore(service: service, storage: storage)

        try await store.deleteAccount(reauthentication: testCredential)

        let deletionRequestCount = await service.deletionRequestCount
        let currentSession = await store.session
        XCTAssertEqual(deletionRequestCount, 1)
        XCTAssertEqual(storage.clearCallCount, 1)
        XCTAssertNil(storage.session)
        XCTAssertNil(currentSession)
    }

    func testSessionReplacementDuringReauthenticationRetainsReplacementLocally() async {
        let original = testSession
        let replacement = WanderfulAccountSession(accountID: "replacement", token: "replacement-token")
        let service = DeletionGateAccountService(signInSession: replacement)
        let storage = TestAccountSessionStorage(session: original)
        let store = AccountStore(service: service, storage: storage)

        let credential = testCredential
        let deletion = Task<Result<Void, Error>, Never> {
            do {
                try await store.deleteAccount(reauthentication: credential)
                return .success(())
            } catch {
                return .failure(error)
            }
        }
        await service.waitForDeletionStart()
        try? await store.signIn(with: testCredential)
        await service.finishDeletion()

        guard case let .failure(error) = await deletion.value else {
            return XCTFail("A changed session must not report deletion success.")
        }
        XCTAssertEqual(error as? AccountStoreError, .sessionChangedDuringDeletion)
        XCTAssertEqual(storage.clearCallCount, 0)
        XCTAssertEqual(storage.session, replacement)
        let currentSession = await store.session
        XCTAssertEqual(currentSession, replacement)
    }

    @MainActor
    func testAccountDeletionErrorsHaveGermanAndEnglishCopy() {
        XCTAssertEqual(
            AccountStoreError.noActiveSession.message(for: Locale(identifier: "en_US")),
            "You’re not signed in. Sign in before deleting your account."
        )
        XCTAssertEqual(
            AccountStoreError.noActiveSession.message(for: Locale(identifier: "de_DE")),
            "Du bist nicht angemeldet. Melde dich an, bevor du dein Konto löschst."
        )
        let germanLocale = AppLanguage.german.locale
        XCTAssertEqual(
            AccountStoreError.sessionChangedDuringDeletion.message(for: germanLocale),
            "Deine Sitzung wurde geändert. Dein Konto wurde nicht lokal gelöscht. Bitte melde dich erneut an und versuche es noch einmal."
        )
    }

    @MainActor
    func testNativeAppleButtonRequestUsesFreshNonceAndNoUnneededPersonalScopes() throws {
        let authenticator = AppleAccountAuthenticator()
        let first = ASAuthorizationAppleIDProvider().createRequest()
        authenticator.prepare(first)
        let nonce = try XCTUnwrap(first.nonce)
        XCTAssertGreaterThanOrEqual(nonce.count, 43)
        XCTAssertEqual(first.requestedScopes, [])

        XCTAssertThrowsError(try authenticator.credential(from: .failure(
            ASAuthorizationError(.canceled)
        ))) { error in
            XCTAssertEqual(error as? AppleAccountAuthenticationError, .cancelled)
        }
        let second = ASAuthorizationAppleIDProvider().createRequest()
        authenticator.prepare(second)
        XCTAssertNotEqual(second.nonce, nonce)
    }

    @MainActor
    func testNativeRequestPreventsASecondControllerBasedSignIn() async {
        let authenticator = AppleAccountAuthenticator()
        authenticator.prepare(ASAuthorizationAppleIDProvider().createRequest())
        do {
            _ = try await authenticator.signIn()
            XCTFail("An active native request must prevent a second Apple dialog.")
        } catch {
            XCTAssertEqual(error as? AppleAccountAuthenticationError, .failed)
        }
        _ = try? authenticator.credential(from: .failure(ASAuthorizationError(.canceled)))
    }

    func testLegacyKeychainSessionDecodesButCannotConfirmAppleAccess() async throws {
        let legacy = Data(#"{"accountID":"account","token":"token"}"#.utf8)
        let session = try JSONDecoder().decode(WanderfulAccountSession.self, from: legacy)
        XCTAssertNil(session.appleUserIdentifier)
        let checker = TestAppleCredentialChecker(authorized: true)
        let store = AccountStore(service: TestAccountService(), storage: TestAccountSessionStorage(session: session), credentialChecker: checker)
        let authorized = try await store.validateAppleCredential()
        XCTAssertFalse(authorized)
        let checks = await checker.callCount
        XCTAssertEqual(checks, 0)
    }

    func testSignInStoresAppleIdentityAndConfirmsAuthorizedCredential() async throws {
        let storage = TestAccountSessionStorage(session: nil)
        let checker = TestAppleCredentialChecker(authorized: true)
        let store = AccountStore(service: TestAccountService(), storage: storage, credentialChecker: checker)
        try await store.signIn(with: AppleAccountCredential(identityToken: "identity", authorizationCode: "code", nonce: "nonce", userIdentifier: "apple-user"))
        XCTAssertEqual(storage.session?.appleUserIdentifier, "apple-user")
        let authorized = try await store.validateAppleCredential()
        XCTAssertTrue(authorized)
        XCTAssertEqual(storage.clearCallCount, 0)
    }

    func testRevokedAppleCredentialClearsLocalSessionEvenIfServerSignOutFails() async throws {
        let session = WanderfulAccountSession(accountID: "account", token: "token", appleUserIdentifier: "apple-user")
        let storage = TestAccountSessionStorage(session: session)
        let service = TestAccountService(signOutError: .rejected)
        let store = AccountStore(service: service, storage: storage, credentialChecker: TestAppleCredentialChecker(authorized: false))
        let authorized = try await store.validateAppleCredential()
        XCTAssertFalse(authorized)
        XCTAssertNil(storage.session)
        let current = await store.session
        XCTAssertNil(current)
        let signOutCalls = await service.signOutCallCount
        XCTAssertEqual(signOutCalls, 1)
    }

    func testAppleCredentialLookupFailureRetainsStoredSessionWithoutConfirmingAccess() async {
        let session = WanderfulAccountSession(accountID: "account", token: "token", appleUserIdentifier: "apple-user")
        let storage = TestAccountSessionStorage(session: session)
        let store = AccountStore(service: TestAccountService(), storage: storage, credentialChecker: TestAppleCredentialChecker(error: .unavailable))
        do {
            _ = try await store.validateAppleCredential()
            XCTFail("An unavailable Apple lookup must not confirm access.")
        } catch {
            XCTAssertEqual(error as? AppleAccountAuthenticationError, .unavailable)
        }
        XCTAssertEqual(storage.session, session)
        XCTAssertEqual(storage.clearCallCount, 0)
    }

    func testLateRevocationCheckCannotEraseAReplacementSignIn() async throws {
        let session = WanderfulAccountSession(accountID: "old", token: "old-token", appleUserIdentifier: "old-apple-user")
        let storage = TestAccountSessionStorage(session: session)
        let checker = GatedAppleCredentialChecker()
        let store = AccountStore(service: TestAccountService(), storage: storage, credentialChecker: checker)
        let lookup = Task { try await store.validateAppleCredential() }
        await checker.waitUntilStarted()
        try await store.signIn(with: AppleAccountCredential(identityToken: "new-identity", authorizationCode: "new-code", nonce: "new-nonce", userIdentifier: "new-apple-user"))
        await checker.finish(authorized: false)
        let result = try await lookup.value
        XCTAssertFalse(result)
        XCTAssertEqual(storage.session?.appleUserIdentifier, "new-apple-user")
        XCTAssertEqual(storage.clearCallCount, 0)
    }

    private var testSession: WanderfulAccountSession {
        WanderfulAccountSession(accountID: "account", token: "session-token")
    }

    private var testCredential: AppleAccountCredential {
        AppleAccountCredential(identityToken: "identity", authorizationCode: "code", nonce: "nonce")
    }

    private func assertDeletionFails(
        _ store: AccountStore,
        expected: AccountStoreError
    ) async {
        do {
            try await store.deleteAccount(reauthentication: testCredential)
            XCTFail("Deletion must fail without a current session.")
        } catch {
            XCTAssertEqual(error as? AccountStoreError, expected)
        }
    }
}

private final class TestAccountSessionStorage: AccountSessionStoring, @unchecked Sendable {
    var session: WanderfulAccountSession?
    private(set) var clearCallCount = 0

    init(session: WanderfulAccountSession?) { self.session = session }
    func load() throws -> WanderfulAccountSession? { session }
    func save(_ session: WanderfulAccountSession) throws { self.session = session }
    func clear() throws { clearCallCount += 1; session = nil }
}

private actor TestAccountService: AccountServicing {
    private(set) var deletionRequestCount = 0
    private let deletionError: AccountServiceError?
    private let signOutError: AccountServiceError?
    private(set) var signOutCallCount = 0

    init(deletionError: AccountServiceError? = nil, signOutError: AccountServiceError? = nil) {
        self.deletionError = deletionError
        self.signOutError = signOutError
    }
    func signIn(_: AppleAccountCredential) async throws -> WanderfulAccountSession {
        WanderfulAccountSession(accountID: "new", token: "new-token")
    }
    func signOut(session _: WanderfulAccountSession) async throws {
        signOutCallCount += 1
        if let signOutError { throw signOutError }
    }
    func deleteAccount(session _: WanderfulAccountSession, reauthentication _: AppleAccountCredential) async throws {
        deletionRequestCount += 1
        if let deletionError { throw deletionError }
    }
}

private actor DeletionGateAccountService: AccountServicing {
    private let signInSession: WanderfulAccountSession
    private var deletionStarted = false
    private var startWaiter: CheckedContinuation<Void, Never>?
    private var deletionWaiter: CheckedContinuation<Void, Never>?

    init(signInSession: WanderfulAccountSession) { self.signInSession = signInSession }
    func signIn(_: AppleAccountCredential) async throws -> WanderfulAccountSession { signInSession }
    func signOut(session _: WanderfulAccountSession) async throws {}
    func deleteAccount(session _: WanderfulAccountSession, reauthentication _: AppleAccountCredential) async throws {
        deletionStarted = true
        startWaiter?.resume()
        startWaiter = nil
        await withCheckedContinuation { deletionWaiter = $0 }
    }
    func waitForDeletionStart() async {
        if deletionStarted { return }
        await withCheckedContinuation { startWaiter = $0 }
    }
    func finishDeletion() { deletionWaiter?.resume(); deletionWaiter = nil }
}

private actor TestAppleCredentialChecker: AppleAccountCredentialChecking {
    let authorized: Bool
    let error: AppleAccountAuthenticationError?
    private(set) var callCount = 0
    init(authorized: Bool = false, error: AppleAccountAuthenticationError? = nil) {
        self.authorized = authorized
        self.error = error
    }
    func isAuthorized(userIdentifier _: String) async throws -> Bool {
        callCount += 1
        if let error { throw error }
        return authorized
    }
}

private actor GatedAppleCredentialChecker: AppleAccountCredentialChecking {
    private var started = false
    private var startWaiter: CheckedContinuation<Void, Never>?
    private var resultWaiter: CheckedContinuation<Bool, Never>?
    func isAuthorized(userIdentifier _: String) async throws -> Bool {
        started = true
        startWaiter?.resume()
        startWaiter = nil
        return await withCheckedContinuation { resultWaiter = $0 }
    }
    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { startWaiter = $0 }
    }
    func finish(authorized: Bool) {
        resultWaiter?.resume(returning: authorized)
        resultWaiter = nil
    }
}
