import XCTest
@testable import TrailMind

@MainActor
final class OwnerAccessIntegrationTests: XCTestCase {
    func testExplicitLocalBundleAndPermanentOriginRequired() throws {
        for (id, environment, origin, expected) in [
            ("com.piroscheibe.wanderful.local", "local", "https://owner.example.com", true),
            ("com.trailmind.app.local", "local", "https://owner.example.com", true),
            ("com.piroscheibe.wanderful", "production", "https://owner.example.com", false),
            ("com.piroscheibe.wanderful.local", "production", "https://owner.example.com", false),
            ("com.piroscheibe.wanderful.local", "local", "https://a.trycloudflare.com", false),
            ("com.piroscheibe.wanderful.local", "local", "http://127.0.0.1", false)
        ] {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".bundle")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: folder) }
            let info = ["CFBundleIdentifier": id, "TRAILMIND_APP_ENVIRONMENT": environment,
                        "WANDERFUL_OWNER_ACCESS_ORIGIN": origin]
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
                .write(to: folder.appendingPathComponent("Info.plist"))
            let bundle = try XCTUnwrap(Bundle(url: folder))
            #if DEBUG && WANDERFUL_PRIVATE_OWNER
            XCTAssertEqual(OwnerAccessConfiguration.load(bundle: bundle) != nil, expected)
            #else
            XCTAssertNil(OwnerAccessConfiguration.load(bundle: bundle), "Ordinary Debug must ignore owner configuration, including valid values")
            _ = expected
            #endif
        }
    }

    func testPlannerTimeoutsAllowPrivateHostWakeOnlyInExplicitBuild() {
        let timeouts = PlannerViewModel.OperationTimeouts.production
        #if DEBUG && WANDERFUL_PRIVATE_OWNER
        XCTAssertEqual(timeouts.parserSeconds, 115)
        XCTAssertEqual(timeouts.routingSeconds, 140)
        #else
        XCTAssertEqual(timeouts.parserSeconds, 22)
        XCTAssertEqual(timeouts.routingSeconds, 45)
        #endif
        XCTAssertEqual(timeouts.geocodingSeconds, 15)
    }

    #if DEBUG && WANDERFUL_PRIVATE_OWNER
    func testMissingOwnerConfigurationCannotFallBackToAttestOrLoopback() async throws {
        XCTAssertNil(OwnerAccessConfiguration.load())
        let opener = OwnerAccessUnexpectedAuthorizer()
        let authorizer = TrailMindBackendSecurity.makeSessionAuthorizer(
            baseURL: URL(string: "http://127.0.0.1:48175"), allowsInsecureLoopback: true,
            attestedSessionAuthorizer: opener)
        do { _ = try await authorizer.authorization(cost: 1); XCTFail("Missing owner configuration authorized") }
        catch { XCTAssertEqual(error as? AppAttestServiceError, .configurationUnavailable) }
    }

    func testPrivateOwnerDisablesUnsupportedServiceAndDirectProviderPaths() {
        XCTAssertNil(TrailMindBackendConfiguration.baseURL())
        XCTAssertFalse(TrailMindBackendConfiguration.remoteIntentEnabled())
        XCTAssertFalse(TrailMindBackendConfiguration.directGraphHopperEnabled())
        XCTAssertFalse(TrailMindBackendConfiguration.insecureLocalBackendAuthorizationEnabled())
        XCTAssertFalse(TrailMindBackendConfiguration.outdoorEvidenceEnabled())
        XCTAssertFalse(TrailMindBackendConfiguration.researchGuidedPlanningEnabled())
        XCTAssertFalse(TrailMindBackendConfiguration.routableHighlightAccessEnabled())
    }
    #endif
}

#if DEBUG && WANDERFUL_PRIVATE_OWNER
private nonisolated struct OwnerAccessUnexpectedAuthorizer: RouteSessionAuthorizing {
    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        XCTFail("Private owner mode must not fall back to App Attest")
        throw AppAttestServiceError.verificationFailed
    }
    func invalidate(token: String) async {}
}
#endif
