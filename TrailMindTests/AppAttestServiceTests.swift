import CryptoKit
import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class AppAttestServiceTests: XCTestCase {
    func testUnsupportedProviderFailsWithSafeTypedError() async {
        let service = AppAttestService(
            provider: FakeAppAttestProvider(supported: false),
            store: MemoryInstallationStore(),
            api: FakeAppAttestAPI()
        )
        await XCTAssertThrowsErrorAsync(try await service.openRouteSession()) { error in
            XCTAssertEqual(error as? AppAttestServiceError, .unsupported)
            XCTAssertEqual(
                error.localizedDescription,
                "TrailMind couldn’t verify this app installation. Check your connection and try again."
            )
        }
    }

    func testExistingRegisteredKeySkipsGenerationAndAttestation() async throws {
        let provider = FakeAppAttestProvider()
        let store = MemoryInstallationStore(keyID: "existing-key")
        let api = FakeAppAttestAPI()
        let session = try await AppAttestService(provider: provider, store: store, api: api).openRouteSession()
        let generatedKeyCount = await provider.generatedKeyCount()
        let attestationCount = await provider.attestationCount()
        let assertionCount = await provider.assertionCount()
        XCTAssertEqual(session.token, FakeAppAttestAPI.token)
        XCTAssertEqual(generatedKeyCount, 0)
        XCTAssertEqual(attestationCount, 0)
        XCTAssertEqual(assertionCount, 1)
    }

    func testNewKeyIsRegisteredAndPersisted() async throws {
        let provider = FakeAppAttestProvider(generatedKeys: ["new-key"])
        let store = MemoryInstallationStore()
        let api = FakeAppAttestAPI()
        _ = try await AppAttestService(provider: provider, store: store, api: api).openRouteSession()
        let storedKey = await store.loadAppAttestKeyID()
        let generatedKeyCount = await provider.generatedKeyCount()
        let attestationCount = await provider.attestationCount()
        let registrationCount = await api.registrationCount()
        XCTAssertEqual(storedKey, "new-key")
        XCTAssertEqual(generatedKeyCount, 1)
        XCTAssertEqual(attestationCount, 1)
        XCTAssertEqual(registrationCount, 1)
    }

    func testInvalidKeyDeletesItAndRegistersAReplacement() async throws {
        let provider = FakeAppAttestProvider(
            generatedKeys: ["replacement-key"],
            assertionErrors: [.invalidKey, nil]
        )
        let store = MemoryInstallationStore(keyID: "invalid-key")
        let api = FakeAppAttestAPI()
        _ = try await AppAttestService(provider: provider, store: store, api: api).openRouteSession()
        let storedKey = await store.loadAppAttestKeyID()
        let generatedKeyCount = await provider.generatedKeyCount()
        let registrationCount = await api.registrationCount()
        let assertionCount = await provider.assertionCount()
        XCTAssertEqual(storedKey, "replacement-key")
        XCTAssertEqual(generatedKeyCount, 1)
        XCTAssertEqual(registrationCount, 1)
        XCTAssertEqual(assertionCount, 2)
    }

    func testRegistrationChallengeFailureDoesNotAttest() async {
        let provider = FakeAppAttestProvider(generatedKeys: ["new-key"])
        let api = FakeAppAttestAPI(challengeError: .networkUnavailable)
        let service = AppAttestService(
            provider: provider,
            store: MemoryInstallationStore(),
            api: api
        )
        await XCTAssertThrowsErrorAsync(try await service.openRouteSession())
        let attestationCount = await provider.attestationCount()
        XCTAssertEqual(attestationCount, 0)
    }

    func testAttestationFailureDoesNotSubmitRegistration() async {
        let provider = FakeAppAttestProvider(
            generatedKeys: ["new-key"],
            attestationError: .verificationFailed
        )
        let api = FakeAppAttestAPI()
        let service = AppAttestService(
            provider: provider,
            store: MemoryInstallationStore(),
            api: api
        )
        await XCTAssertThrowsErrorAsync(try await service.openRouteSession())
        let registrationCount = await api.registrationCount()
        XCTAssertEqual(registrationCount, 0)
    }

    func testAssertionUsesCanonicalClientDataHash() async throws {
        let provider = FakeAppAttestProvider()
        let challenge = Data(repeating: 1, count: 32)
        let nonce = Data(repeating: 2, count: 32)
        let api = FakeAppAttestAPI(challengeValue: challenge)
        _ = try await AppAttestService(
            provider: provider,
            store: MemoryInstallationStore(keyID: "key-id"),
            api: api
        ).openRouteSession()
        let optionalNonce = await api.lastSessionNonce()
        let capturedNonce = try XCTUnwrap(optionalNonce)
        let actualClientData = AppAttestService.canonicalRouteSessionClientData(
            challenge: challenge,
            keyID: "key-id",
            sessionNonce: capturedNonce
        )
        let assertionHash = await provider.lastAssertionHash()
        XCTAssertEqual(assertionHash, Data(SHA256.hash(data: actualClientData)))
        let vectorData = AppAttestService.canonicalRouteSessionClientData(
            challenge: challenge,
            keyID: "key-id",
            sessionNonce: nonce
        )
        XCTAssertEqual(
            vectorData.map { String(format: "%02x", $0) }.joined(),
            "0000001a747261696c6d696e642d726f7574652d73657373696f6e2d7631" +
            "00000004504f5354" +
            "0000001d2f6170692f6170702d6174746573742f726f7574652d73657373696f6e" +
            "00000020" + String(repeating: "01", count: 32) +
            "000000066b65792d6964" +
            "00000020" + String(repeating: "02", count: 32)
        )
    }

    func testKeychainPersistsOnlyTheInstallationKeyIdentifier() async throws {
        let store = SecureInstallationStore(
            service: "com.trailmind.tests.\(UUID().uuidString)",
            account: "app-attest-key"
        )
        defer { Task { try? await store.deleteAppAttestKeyID() } }
        let initialValue = try await store.loadAppAttestKeyID()
        XCTAssertNil(initialValue)
        try await store.saveAppAttestKeyID("keychain-key")
        let savedValue = try await store.loadAppAttestKeyID()
        XCTAssertEqual(savedValue, "keychain-key")
        try await store.deleteAppAttestKeyID()
        let deletedValue = try await store.loadAppAttestKeyID()
        XCTAssertNil(deletedValue)
    }
}

@MainActor
final class RouteSessionServiceTests: XCTestCase {
    func testCachesAndAccountsForSessionCostInMemory() async throws {
        let opener = FakeRouteSessionOpener(sessions: [session(cost: 12)])
        let service = RouteSessionService(opener: opener)
        let first = try await service.authorization(cost: 2)
        let second = try await service.authorization(cost: 3)
        let openCount = await opener.openCount()
        XCTAssertEqual(first.token, second.token)
        XCTAssertEqual(openCount, 1)
    }

    func testRefreshesBeforeExpiry() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 1_000))
        let opener = FakeRouteSessionOpener(sessions: [
            session(token: "first", expiresAt: clock.now.addingTimeInterval(20), cost: 12),
            session(token: "second", expiresAt: clock.now.addingTimeInterval(300), cost: 12)
        ])
        let service = RouteSessionService(opener: opener, now: { clock.now }, refreshLeeway: 10)
        let first = try await service.authorization(cost: 1)
        XCTAssertEqual(first.token, "first")
        clock.now = clock.now.addingTimeInterval(11)
        let second = try await service.authorization(cost: 1)
        XCTAssertEqual(second.token, "second")
    }

    func testRefreshesWhenLocalBudgetWouldBeExhausted() async throws {
        let opener = FakeRouteSessionOpener(sessions: [session(token: "first", cost: 2), session(token: "second", cost: 12)])
        let service = RouteSessionService(opener: opener)
        let first = try await service.authorization(cost: 2)
        let second = try await service.authorization(cost: 2)
        XCTAssertEqual(first.token, "first")
        XCTAssertEqual(second.token, "second")
    }

    func testConcurrentConsumersShareOneRefresh() async throws {
        let opener = FakeRouteSessionOpener(sessions: [session(cost: 12)], delayNanoseconds: 20_000_000)
        let service = RouteSessionService(opener: opener)
        async let first = service.authorization(cost: 2)
        async let second = service.authorization(cost: 2)
        async let third = service.authorization(cost: 2)
        let values = try await [first, second, third]
        let tokens = Set(values.map { $0.token })
        let openCount = await opener.openCount()
        XCTAssertEqual(tokens, ["session-token"])
        XCTAssertEqual(openCount, 1)
    }

    func testConcurrentConsumersAggregateTheirCostBeforeReusingSession() async throws {
        let opener = FakeRouteSessionOpener(
            sessions: [
                session(token: "first", cost: 12),
                session(token: "second", cost: 12)
            ],
            delayNanoseconds: 20_000_000
        )
        let service = RouteSessionService(opener: opener)
        async let first = service.authorization(cost: 2)
        async let second = service.authorization(cost: 2)
        async let third = service.authorization(cost: 2)
        let initial = try await [first, second, third]

        XCTAssertEqual(Set(initial.map(\.token)), ["first"])
        let next = try await service.authorization(cost: 7)
        let openCount = await opener.openCount()
        XCTAssertEqual(next.token, "second")
        XCTAssertEqual(openCount, 2)
    }

    func testConcurrentConsumersRefreshWhenAggregateCostExceedsSessionBudget() async throws {
        let opener = FakeRouteSessionOpener(
            sessions: [
                session(token: "first", cost: 12),
                session(token: "second", cost: 12)
            ],
            delayNanoseconds: 20_000_000
        )
        let service = RouteSessionService(opener: opener)
        async let first = service.authorization(cost: 7)
        async let second = service.authorization(cost: 7)
        let values = try await [first, second]

        XCTAssertEqual(Set(values.map(\.token)), ["first", "second"])
        let openCount = await opener.openCount()
        XCTAssertEqual(openCount, 2)
    }

    func testCancellationDoesNotPersistSensitiveSessionDataElsewhere() async throws {
        let opener = FakeRouteSessionOpener(sessions: [session(cost: 12)], delayNanoseconds: 20_000_000)
        let service = RouteSessionService(opener: opener)
        let task = Task { try await service.authorization(cost: 1) }
        task.cancel()
        await XCTAssertThrowsErrorAsync(try await task.value) { error in
            XCTAssertTrue(error is CancellationError)
        }
        let openCount = await opener.openCount()
        XCTAssertLessThanOrEqual(openCount, 1)
    }

    private func session(
        token: String = "session-token",
        expiresAt: Date = Date().addingTimeInterval(300),
        cost: Int
    ) -> RouteSession {
        RouteSession(token: token, expiresAt: expiresAt, remainingCost: cost)
    }
}

private actor MemoryInstallationStore: SecureInstallationStoring {
    private var keyID: String?
    init(keyID: String? = nil) { self.keyID = keyID }
    func loadAppAttestKeyID() -> String? { keyID }
    func saveAppAttestKeyID(_ keyID: String) { self.keyID = keyID }
    func deleteAppAttestKeyID() { keyID = nil }
}

private actor FakeAppAttestProvider: AppAttestKeyProviding {
    private let supported: Bool
    private var generatedKeys: [String]
    private var assertionErrors: [AppAttestServiceError?]
    private let attestationError: AppAttestServiceError?
    private var generateCalls = 0
    private var attestCalls = 0
    private var assertionCalls = 0
    private var assertionHash: Data?

    init(
        supported: Bool = true,
        generatedKeys: [String] = ["generated-key"],
        assertionErrors: [AppAttestServiceError?] = [],
        attestationError: AppAttestServiceError? = nil
    ) {
        self.supported = supported
        self.generatedKeys = generatedKeys
        self.assertionErrors = assertionErrors
        self.attestationError = attestationError
    }

    func isSupported() -> Bool { supported }
    func generateKey() throws -> String {
        let index = min(generateCalls, generatedKeys.count - 1)
        generateCalls += 1
        return generatedKeys[index]
    }
    func attestKey(_ keyID: String, clientDataHash: Data) throws -> Data {
        attestCalls += 1
        if let attestationError { throw attestationError }
        return Data("attestation".utf8)
    }
    func generateAssertion(_ keyID: String, clientDataHash: Data) throws -> Data {
        assertionHash = clientDataHash
        let index = assertionCalls
        assertionCalls += 1
        if assertionErrors.indices.contains(index), let error = assertionErrors[index] { throw error }
        return Data("assertion".utf8)
    }
    func generatedKeyCount() -> Int { generateCalls }
    func attestationCount() -> Int { attestCalls }
    func assertionCount() -> Int { assertionCalls }
    func lastAssertionHash() -> Data? { assertionHash }
}

private actor FakeAppAttestAPI: AppAttestAPI {
    static let token = Data(repeating: 9, count: 32).base64EncodedString()
    private let challengeError: AppAttestServiceError?
    private let challengeValue: Data
    private var registrations = 0
    private var capturedSessionNonce: Data?

    init(
        challengeError: AppAttestServiceError? = nil,
        challengeValue: Data = Data(repeating: 1, count: 32)
    ) {
        self.challengeError = challengeError
        self.challengeValue = challengeValue
    }

    func challenge(purpose: AppAttestChallengePurpose, keyID: String?) throws -> AppAttestChallenge {
        if let challengeError { throw challengeError }
        return AppAttestChallenge(id: UUID().uuidString, value: challengeValue, expiresAt: Date().addingTimeInterval(300))
    }
    func register(challengeID: String, keyID: String, attestationObject: Data) { registrations += 1 }
    func routeSession(
        challengeID: String,
        keyID: String,
        sessionNonce: Data,
        assertionObject: Data
    ) throws -> RouteSession {
        capturedSessionNonce = sessionNonce
        return RouteSession(token: Self.token, expiresAt: Date().addingTimeInterval(300), remainingCost: 12)
    }
    func registrationCount() -> Int { registrations }
    func lastSessionNonce() -> Data? { capturedSessionNonce }
}

private actor FakeRouteSessionOpener: RouteSessionOpening {
    private var sessions: [RouteSession]
    private let delayNanoseconds: UInt64
    private var count = 0
    init(sessions: [RouteSession], delayNanoseconds: UInt64 = 0) {
        self.sessions = sessions
        self.delayNanoseconds = delayNanoseconds
    }
    func openRouteSession() async throws -> RouteSession {
        count += 1
        if delayNanoseconds > 0 { try? await Task.sleep(nanoseconds: delayNanoseconds) }
        return sessions.removeFirst()
    }
    func openCount() -> Int { count }
}

private final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date
    init(_ value: Date) { self.value = value }
    var now: Date {
        get { lock.withLock { value } }
        set { lock.withLock { value = newValue } }
    }
}

@MainActor
private func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    _ handler: (Error) -> Void = { _ in }
) async {
    do {
        _ = try await expression()
        XCTFail("Expected an error")
    } catch {
        handler(error)
    }
}
