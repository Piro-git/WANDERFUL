import CryptoKit
import XCTest
@testable import TrailMind

@MainActor
final class OwnerAccessClientTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let nonce = Data(repeating: 4, count: 32)
    private let challengeID = OwnerAccessProof.base64URL(Data(repeating: 2, count: 24))
    private let challenge = Data(repeating: 3, count: 32)

    private func response(_ object: [String: Any], status: Int = 200) throws -> URLProtocolStub.Response {
        .init(statusCode: status, data: try JSONSerialization.data(withJSONObject: object),
              headerFields: ["Content-Type": "application/json", "Cache-Control": "no-store"])
    }

    private func timestamp(_ seconds: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: now.addingTimeInterval(seconds))
    }

    private func responses(tokenByte: UInt8 = 5) throws -> [URLProtocolStub.Response] {
        [try response(["challengeId": challengeID, "challenge": OwnerAccessProof.base64URL(challenge), "expiresAt": timestamp(60)]),
         try response(["routeSessionToken": OwnerAccessProof.base64URL(Data(repeating: tokenByte, count: 32)),
                       "expiresAt": timestamp(120), "remainingCost": 12])]
    }

    private func client(signer: OwnerAccessMemorySigner = OwnerAccessMemorySigner()) throws -> OwnerAccessClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [URLProtocolStub.self]
        let fixedNow = now; let fixedNonce = nonce
        return OwnerAccessClient(configuration: try OwnerAccessConfiguration(origin: "https://owner.example.com"),
            signer: signer, session: URLSession(configuration: config), now: { fixedNow }, nonce: { fixedNonce })
    }

    func testSessionAllowsBoundedFreeHostWakeWithoutPersistentCaches() {
        let session = OwnerAccessClient.makeSession()
        defer { session.invalidateAndCancel() }
        XCTAssertEqual(session.configuration.timeoutIntervalForRequest, 75)
        XCTAssertEqual(session.configuration.timeoutIntervalForResource, 90)
        XCTAssertNil(session.configuration.httpCookieStorage)
        XCTAssertNil(session.configuration.urlCache)
    }

    func testChallengeExchangeSignsExactContractAndExportsOnlyPublicFields() async throws {
        URLProtocolStub.reset(responses: try responses())
        let signer = OwnerAccessMemorySigner()
        let client = try client(signer: signer)
        let session = try await client.openRouteSession()
        XCTAssertEqual(session.remainingCost, 12)
        XCTAssertEqual(session.expiresAt, now.addingTimeInterval(120))
        let bodies = URLProtocolStub.requestBodies()
        XCTAssertEqual(bodies.count, 2)
        let first = try XCTUnwrap(JSONSerialization.jsonObject(with: bodies[0]) as? [String: String])
        let second = try XCTUnwrap(JSONSerialization.jsonObject(with: bodies[1]) as? [String: String])
        let key = try await signer.publicKey()
        XCTAssertEqual(first, ["keyId": OwnerAccessProof.keyID(for: key)])
        XCTAssertEqual(Set(second.keys), ["keyId", "challengeId", "sessionNonce", "signature"])
        let signatureText = try XCTUnwrap(second["signature"])
        let signatureData = try XCTUnwrap(Data(base64Encoded: signatureText.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "=="))
        let signature = try P256.Signing.ECDSASignature(rawRepresentation: signatureData)
        let payload = try OwnerAccessProof.clientData(origin: "https://owner.example.com", keyID: first["keyId"]!,
            challengeID: challengeID, challenge: challenge, nonce: nonce)
        XCTAssertTrue(key.isValidSignature(signature, for: payload))
        let exported = try await client.exportEnrollmentPublicKey()
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(exported)) as? [String: String])
        XCTAssertEqual(Set(object.keys), ["keyId", "publicKeySPKI"])
        XCTAssertEqual(object["publicKeySPKI"], key.derRepresentation.base64EncodedString())
        XCTAssertEqual(URLProtocolStub.requestBodies().count, 2, "Public export must never self-enroll over the network")
    }

    func testRenewalThroughRouteSessionServiceKeepsKeyAndObtainsFreshToken() async throws {
        URLProtocolStub.reset(responses: try responses() + responses(tokenByte: 6))
        let fixedNow = now
        let authorizer = RouteSessionService(opener: try client(), now: { fixedNow })
        let first = try await authorizer.authorization(cost: 12)
        let second = try await authorizer.authorization(cost: 1)
        XCTAssertNotEqual(first.token, second.token)
        let bodies = URLProtocolStub.requestBodies()
        XCTAssertEqual(bodies.count, 4)
        XCTAssertEqual(try JSONSerialization.jsonObject(with: bodies[0]) as? [String: String],
                       try JSONSerialization.jsonObject(with: bodies[2]) as? [String: String])
    }

    func testConcurrentAuthorizationDeduplicatesChallengeExchange() async throws {
        URLProtocolStub.reset(responses: try responses())
        let fixedNow = now
        let authorizer = RouteSessionService(opener: try client(), now: { fixedNow })
        async let first = authorizer.authorization(cost: 1)
        async let second = authorizer.authorization(cost: 1)
        let values = try await [first, second]
        XCTAssertEqual(values[0].token, values[1].token)
        XCTAssertEqual(URLProtocolStub.requestBodies().count, 2)
    }

    func testCancellationDoesNotSendProofOrRetry() async throws {
        URLProtocolStub.reset(responses: [.init(statusCode: 200, data: Data(), delay: 10)])
        let client = try client()
        let task = Task { try await client.openRouteSession() }
        try await Task.sleep(for: .milliseconds(50))
        task.cancel()
        do { _ = try await task.value; XCTFail("Cancelled exchange succeeded") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertLessThanOrEqual(URLProtocolStub.requestBodies().count, 1)
    }

    func testRejectsExpiredChallengeWithoutSendingProof() async throws {
        URLProtocolStub.reset(responses: [try response(["challengeId": challengeID,
            "challenge": OwnerAccessProof.base64URL(challenge), "expiresAt": timestamp(-1)])])
        do { _ = try await client().openRouteSession(); XCTFail("Expired challenge accepted") }
        catch { XCTAssertEqual(error as? AppAttestServiceError, .invalidResponse) }
        XCTAssertEqual(URLProtocolStub.requestBodies().count, 1)
    }

    func testProviderTextIsNeverExposedAndDeniedKeyDoesNotRetry() async throws {
        for (status, expected) in [(403, AppAttestServiceError.authorizationDenied), (429, .rateLimited), (503, .networkUnavailable)] {
            URLProtocolStub.reset(responses: [try response(["message": "unsafe upstream detail"], status: status)])
            do { _ = try await client().openRouteSession(); XCTFail("Error accepted") }
            catch { XCTAssertEqual(error as? AppAttestServiceError, expected) }
            XCTAssertEqual(URLProtocolStub.requestBodies().count, 1)
        }
    }

    func testRejectsOversizedResponseAndRedirectStatus() async throws {
        for response in [URLProtocolStub.Response(statusCode: 200, data: Data(repeating: 65, count: 8193), headerFields: ["Content-Type": "application/json"]),
                         URLProtocolStub.Response(statusCode: 302, data: Data(), headerFields: ["Location": "https://other.example.com/"])] {
            URLProtocolStub.reset(responses: [response])
            do { _ = try await client().openRouteSession(); XCTFail("Invalid response accepted") }
            catch { XCTAssertEqual(error as? AppAttestServiceError, .invalidResponse) }
            XCTAssertEqual(URLProtocolStub.requestBodies().count, 1)
        }
    }

    func testRejectsInflatedSessionBudget() async throws {
        var responses = try responses()
        responses[1] = try response(["routeSessionToken": OwnerAccessProof.base64URL(Data(repeating: 5, count: 32)),
                                    "expiresAt": timestamp(120), "remainingCost": 13])
        URLProtocolStub.reset(responses: responses)
        do { _ = try await client().openRouteSession(); XCTFail("Invalid budget accepted") }
        catch { XCTAssertEqual(error as? AppAttestServiceError, .invalidResponse) }
    }
}

private nonisolated struct OwnerAccessMemorySigner: OwnerAccessSigning {
    private let key = P256.Signing.PrivateKey()
    init() {}
    func publicKey() throws -> P256.Signing.PublicKey { key.publicKey }
    func signature(for data: Data) throws -> Data { try key.signature(for: data).rawRepresentation }
}
