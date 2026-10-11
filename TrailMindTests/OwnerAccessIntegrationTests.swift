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
                        "WANDERFUL_OWNER_ACCESS_ORIGIN": origin,
                        "WANDERFUL_OWNER_ACCESS_EXPIRES_AT": String(Date.now.timeIntervalSince1970 + 60)]
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
                .write(to: folder.appendingPathComponent("Info.plist"))
            let bundle = try XCTUnwrap(Bundle(url: folder))
            #if DEBUG && (WANDERFUL_PRIVATE_OWNER || WANDERFUL_PRIVATE_RESEARCH_OWNER)
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

    #if DEBUG && WANDERFUL_PRIVATE_RESEARCH_OWNER
    func testResearchOwnerRejectsMissingExpiredAndUnboundedTestWindow() throws {
        let now = Date(timeIntervalSince1970: 1000)
        for expiry in [nil, "999", "1000", "8201", "nan", "$(WANDERFUL_OWNER_ACCESS_EXPIRES_AT)", "1500"] as [String?] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".bundle")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            var info = ["CFBundleIdentifier": "com.piroscheibe.wanderful.local", "TRAILMIND_APP_ENVIRONMENT": "local",
                        "WANDERFUL_OWNER_ACCESS_ORIGIN": "https://owner.example.com"]
            info["WANDERFUL_OWNER_ACCESS_EXPIRES_AT"] = expiry
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
                .write(to: directory.appendingPathComponent("Info.plist"))
            let bundle = try XCTUnwrap(Bundle(url: directory))
            XCTAssertEqual(OwnerAccessConfiguration.load(bundle: bundle, now: now) != nil, expiry == "1500")
        }
    }

    func testResearchOwnerRequiresCompleteFeaturesAndUsesExactGlobalClientOrigin() throws {
        let now = Date.now
        let origin = "https://owner.example.com"
        for change in [nil, "REMOTE_INTENT_ENABLED", "RESEARCH_GUIDED_PLANNING_ENABLED",
                       "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED", "IN_MEMORY_APP_ATTEST_ENABLED",
                       "DIRECT_GRAPHHOPPER_ENABLED", "INSECURE_LOCAL_BACKEND_AUTH_ENABLED", "ROUTE_WEATHER_ENABLED"] as [String?] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".bundle")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            var info: [String: Any] = ["CFBundleIdentifier": "com.piroscheibe.wanderful.local",
                "CFBundleDisplayName": "Wanderful Local", "TRAILMIND_APP_ENVIRONMENT": "local",
                "TRAILMIND_APP_ATTEST_ENVIRONMENT": "development", "INTENT_BACKEND_BASE_URL": "",
                "WANDERFUL_OWNER_ACCESS_ORIGIN": origin,
                "WANDERFUL_OWNER_ACCESS_EXPIRES_AT": String(now.timeIntervalSince1970 + 60)]
            for key in ["OUTDOOR_EVIDENCE_ENABLED", "REMOTE_INTENT_ENABLED", "RESEARCH_GUIDED_PLANNING_ENABLED",
                        "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED", "DIRECT_GRAPHHOPPER_ENABLED", "INSECURE_LOCAL_BACKEND_AUTH_ENABLED",
                        "IN_MEMORY_APP_ATTEST_ENABLED", "SUPABASE_ONBOARDING_SYNC_ENABLED", "SUPERWALL_ENABLED",
                        "MONETIZATION_ENABLED", "ROUTE_WEATHER_ENABLED"] {
                info[key] = ["REMOTE_INTENT_ENABLED", "RESEARCH_GUIDED_PLANNING_ENABLED", "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED"].contains(key) ? "true" : "false"
            }
            if let change { info[change] = info[change] as? String == "true" ? "false" : "true" }
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
                .write(to: directory.appendingPathComponent("Info.plist"))
            let bundle = try XCTUnwrap(Bundle(url: directory))
            let configuration = try WanderfulAppConfiguration.resolve(infoDictionary: info,
                signedIdentity: WanderfulSignedLaneIdentity.value)
            XCTAssertEqual(OwnerAccessConfiguration.loadForResearch(bundle: bundle, configuration: configuration) != nil, change == nil)
            let client = DynamicResearchPlanningClientFactory.make(configuration: configuration, bundle: bundle)
            if change == nil {
                let global = try XCTUnwrap(client as? BackendDynamicResearchPlanningClient)
                XCTAssertEqual(global.baseURL.absoluteString, origin)
                XCTAssertTrue(global.authorizer is OwnerResearchSessionAuthorizer)
            } else {
                XCTAssertThrowsError(try XCTUnwrap(client).validateConfiguration())
            }
        }
    }

    func testResearchOwnerWindowExpiresBeforeCachedSessionCanAuthorize() async throws {
        let expiry = Date(timeIntervalSince1970: 1500)
        for date in [Date(timeIntervalSince1970: 1500), Date(timeIntervalSince1970: 1600)] {
            let owner = try OwnerAccessConfiguration(origin: "https://owner.example.com", expiresAt: expiry)
            let guardAuthorizer = OwnerResearchSessionAuthorizer(configuration: owner,
                sessions: OwnerAccessUnexpectedAuthorizer(), now: { date })
            do { _ = try await guardAuthorizer.authorization(cost: 12); XCTFail("Expired private window authorized") }
            catch { XCTAssertEqual(error as? AppAttestServiceError, .configurationUnavailable) }
        }
    }

    func testResearchOwnerMissingConfigurationCannotFallBackToPublicResearch() throws {
        let client = try XCTUnwrap(DynamicResearchPlanningClientFactory.make(configuration: nil))
        XCTAssertThrowsError(try client.validateConfiguration())
        XCTAssertNil(OwnerAccessConfiguration.loadForResearch(configuration: nil))
    }
    #endif

    #if DEBUG && (WANDERFUL_PRIVATE_OWNER || WANDERFUL_PRIVATE_RESEARCH_OWNER)
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

#if DEBUG && (WANDERFUL_PRIVATE_OWNER || WANDERFUL_PRIVATE_RESEARCH_OWNER)
private nonisolated struct OwnerAccessUnexpectedAuthorizer: RouteSessionAuthorizing {
    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        XCTFail("Private owner mode must not fall back to App Attest")
        throw AppAttestServiceError.verificationFailed
    }
    func invalidate(token: String) async {}
}
#endif
