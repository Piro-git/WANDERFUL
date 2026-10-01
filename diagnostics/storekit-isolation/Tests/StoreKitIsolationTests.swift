import Foundation
import StoreKit
import StoreKitTest
import XCTest

/// No Wanderful imports, SDKs, backend, purchase, sync, or account requests.
@MainActor
final class StoreKitIsolationTests: XCTestCase {
    func testBundledConfigurationsAreReadable() throws {
        for name in ["Minimal", "Wanderful"] {
            let url = try XCTUnwrap(Bundle.main.url(forResource: name, withExtension: "storekit"))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
            XCTAssertNotNil(json["version"])
        }
    }

    func testMinimalCatalogUsingExplicitURL() async throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "Minimal", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: url)
        try await assertCatalog(session, identifiers: ["test.local.storekit.probe.consumable"])
    }

    func testWanderfulCatalogUsingExplicitURL() async throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "Wanderful", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: url)
        try await assertCatalog(session, identifiers: ["test.app.wanderful.premium.weekly", "test.app.wanderful.premium.annual"])
    }

    func testMinimalCatalogUsingName() async throws {
        let session = try SKTestSession(configurationFileNamed: "Minimal")
        try await assertCatalog(session, identifiers: ["test.local.storekit.probe.consumable"])
    }

    private func assertCatalog(_ session: SKTestSession, identifiers: Set<String>) async throws {
        // Readback distinguishes a parsed file from a working StoreKit test service.
        session.disableDialogs = true
        XCTAssertTrue(session.disableDialogs, "StoreKit test service did not persist its local setting")
        let products = try await Product.products(for: identifiers)
        XCTAssertEqual(Set(products.map(\.id)), identifiers, "Local StoreKit catalog unavailable before any product logic")
        withExtendedLifetime(session) {}
    }
}
