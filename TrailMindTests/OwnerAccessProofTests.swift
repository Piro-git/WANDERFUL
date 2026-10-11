import CryptoKit
import XCTest
@testable import TrailMind

@MainActor
final class OwnerAccessProofTests: XCTestCase {
    private func data(origin: String = "https://owner.example.com") throws -> Data {
        try OwnerAccessProof.clientData(origin: origin,
            keyID: OwnerAccessProof.base64URL(Data(repeating: 1, count: 32)),
            challengeID: OwnerAccessProof.base64URL(Data(repeating: 2, count: 24)),
            challenge: Data(repeating: 3, count: 32), nonce: Data(repeating: 4, count: 32))
    }

    func testMatchesNodeWireContract() throws {
        let digest = SHA256.hash(data: try data()).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(digest, "0c16da272ec832ce7717ec697590deedc911b66548465d1e9703719646e073a1")
    }

    func testProofIsBoundToOrigin() throws {
        let key = P256.Signing.PrivateKey()
        let payload = try data()
        let signature = try key.signature(for: payload)
        XCTAssertEqual(signature.rawRepresentation.count, 64)
        XCTAssertTrue(key.publicKey.isValidSignature(signature, for: payload))
        XCTAssertFalse(key.publicKey.isValidSignature(signature, for: try data(origin: "https://other.example.com")))
        XCTAssertEqual(OwnerAccessProof.keyID(for: key.publicKey), OwnerAccessProof.base64URL(Data(SHA256.hash(data: key.publicKey.derRepresentation))))
    }

    func testRejectsTemporaryAndNoncanonicalOrigins() {
        for origin in ["http://owner.example.com", "https://owner.example.com/", "https://owner.example.com:443", "https://a.trycloudflare.com", "https://127.0.0.1", "https://a.local", "https://user@owner.example.com"] {
            XCTAssertThrowsError(try data(origin: origin), origin)
        }
    }
}
