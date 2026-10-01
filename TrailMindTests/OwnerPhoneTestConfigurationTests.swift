#if DEBUG && WANDERFUL_OWNER_PHONE_TEST
import XCTest
@testable import TrailMind

@MainActor
final class OwnerPhoneTestConfigurationTests: XCTestCase {
    func testOwnerLoopSearchUsesSerialAdmission() {
        XCTAssertEqual(LoopSearchPolicy.comparisonDefault.maximumConcurrentRequests, 1)
        XCTAssertEqual(LoopSearchPolicy(maximumConcurrentRequests: 2).maximumConcurrentRequests, 1)
    }

    func testOwnerIdentityIsRestrictedToExactLocalApplications() {
        for identifier in ["com.trailmind.app.local", "com.piroscheibe.wanderful.local"] {
            XCTAssertTrue(OwnerPhoneTestConfiguration.allowsIdentity(environment: "local", bundleIdentifier: identifier))
            for environment in [nil, "staging", "production"] as [String?] {
                XCTAssertFalse(OwnerPhoneTestConfiguration.allowsIdentity(environment: environment, bundleIdentifier: identifier))
            }
        }
        for identifier in [nil, "com.trailmind.app", "com.piroscheibe.wanderful", "com.other.local"] as [String?] {
            XCTAssertFalse(OwnerPhoneTestConfiguration.allowsIdentity(environment: "local", bundleIdentifier: identifier))
        }
    }

    private func data(_ changes: [String: Any] = [:]) throws -> Data {
        var value: [String: Any] = ["baseURL": "https://owner.example.com/", "token": String(repeating: "A", count: 43), "expiresAt": 1500]
        value.merge(changes) { _, new in new }
        return try JSONSerialization.data(withJSONObject: value)
    }

    func testExplicitHTTPSBoundedConfiguration() throws {
        XCTAssertNotNil(OwnerPhoneTestConfiguration.decode(try data(), now: Date(timeIntervalSince1970: 1000)))
    }

    func testRejectsUnsafeURLAndExtraFields() throws {
        for url in ["http://owner.example.com/", "https://user@owner.example.com/", "https://owner.example.com/?key=x", "https://owner.example.com/#x", "https://owner.example.com:443/", "https://owner.example.com/api/"] {
            XCTAssertNil(OwnerPhoneTestConfiguration.decode(try data(["baseURL": url]), now: Date(timeIntervalSince1970: 1000)))
        }
        XCTAssertNil(OwnerPhoneTestConfiguration.decode(try data(["providerKey": "not-allowed"]), now: Date(timeIntervalSince1970: 1000)))
    }

    func testRejectsExpiredOrUnboundedCredential() throws {
        for expiry in [999.0, 1000.0, 8201.0] {
            XCTAssertNil(OwnerPhoneTestConfiguration.decode(try data(["expiresAt": expiry]), now: Date(timeIntervalSince1970: 1000)))
        }
        XCTAssertNil(OwnerPhoneTestConfiguration.decode(try data(["token": "short"]), now: Date(timeIntervalSince1970: 1000)))
    }

    func testInvalidatedOwnerCredentialCannotBeRetried() async throws {
        let configuration = OwnerPhoneTestConfiguration(
            baseURL: URL(string: "https://owner.example.com/")!,
            token: String(repeating: "A", count: 43),
            expiresAt: Date.now.timeIntervalSince1970 + 60
        )
        let authorizer = OwnerPhoneTestAuthorizer(configuration: configuration)
        let first = try await authorizer.authorization(cost: 1)
        let second = try await authorizer.authorization(cost: 1)
        XCTAssertNotEqual(first.requestID, second.requestID)
        await authorizer.invalidate(token: first.token)
        do {
            _ = try await authorizer.authorization(cost: 1)
            XCTFail("An invalidated private credential must not produce another request")
        } catch {
            XCTAssertTrue(error is AppAttestServiceError)
        }
    }

    func testExpiredOwnerCredentialFailsBeforeRequest() async {
        let authorizer = OwnerPhoneTestAuthorizer(configuration: .init(
            baseURL: URL(string: "https://owner.example.com/")!,
            token: String(repeating: "A", count: 43),
            expiresAt: Date.now.timeIntervalSince1970 - 1
        ))
        do {
            _ = try await authorizer.authorization(cost: 1)
            XCTFail("Expired credentials must fail locally")
        } catch {
            XCTAssertTrue(error is AppAttestServiceError)
        }
    }
}
#endif
