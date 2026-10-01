import Foundation
import CryptoKit
import XCTest
@testable import TrailMind

@MainActor
final class DurableResearchTransportTests: XCTestCase {
    private let start = Coordinate(latitude: 57.2, longitude: -4.7)
    private var request: RoutePlanningRequest {
        RoutePlanningRequest(routeType: .loop, startQuery: "Public village", endQuery: nil,
            activityType: .hiking, graphHopperProfile: "foot", targetDistanceKm: 6,
            targetDurationMinutes: nil, difficulty: .moderate, desiredFeatures: [.viewpoint])
    }
    private func configuration(enabled: String = "true", url: String = "https://planning.example.org/") throws -> WanderfulAppConfiguration {
        try WanderfulAppConfiguration.resolve(infoDictionary: [
            "TRAILMIND_APP_ENVIRONMENT": "staging", "TRAILMIND_APP_ATTEST_ENVIRONMENT": "production",
            "CFBundleIdentifier": "com.trailmind.app.staging", "CFBundleDisplayName": "Wanderful Staging",
            "RESEARCH_GUIDED_PLANNING_ENABLED": enabled, "REMOTE_INTENT_ENABLED": "true",
            "INTENT_BACKEND_BASE_URL": url
        ], signedIdentity: WanderfulLaneIdentityPolicy(environment: .staging,
            bundleIdentifier: "com.trailmind.app.staging", displayName: "Wanderful Staging",
            appAttestEnvironment: .production, backend: .exactHost("planning.example.org"), supabase: .unavailable))
    }
    #if !DEBUG
    func testReleaseRemoteIntentFactoryUsesTheRealParser() {
        XCTAssertTrue(IntentParsingProviderFactory.makeDefaultProvider(remoteIntentEnabled: true) is RemoteAIIntentParsingProvider)
        XCTAssertTrue(IntentParsingProviderFactory.makeDefaultProvider(remoteIntentEnabled: false) is LocalIntentParsingProvider)
    }
    #endif
    func testNormalFactoryCreatesAttestedClientWithoutOwnerFlag() throws {
        let client = DynamicResearchPlanningClientFactory.make(configuration: try configuration())
        XCTAssertTrue(client is BackendDynamicResearchPlanningClient)
        XCTAssertNoThrow(try client?.validateConfiguration())
        XCTAssertNil(DynamicResearchPlanningClientFactory.make(configuration: try configuration(enabled: "false")))
    }
    #if DEBUG && targetEnvironment(simulator)
    func testExplicitLocalLoopbackReusesDevelopmentAuthorization() throws {
        let values: [String: Any] = [
            "TRAILMIND_APP_ENVIRONMENT": "local", "TRAILMIND_APP_ATTEST_ENVIRONMENT": "development",
            "CFBundleIdentifier": "com.trailmind.app.local", "CFBundleDisplayName": "Wanderful Local",
            "RESEARCH_GUIDED_PLANNING_ENABLED": "true", "REMOTE_INTENT_ENABLED": "true",
            "INSECURE_LOCAL_BACKEND_AUTH_ENABLED": "true", "INTENT_BACKEND_BASE_URL": "http://127.0.0.1:3000/"
        ]
        let local = try WanderfulAppConfiguration.resolve(infoDictionary: values,
            signedIdentity: WanderfulLaneIdentityPolicy(environment: .local,
                bundleIdentifier: "com.trailmind.app.local", displayName: "Wanderful Local",
                appAttestEnvironment: .development, backend: .loopbackOnly, supabase: .unavailable))
        let client = try XCTUnwrap(DynamicResearchPlanningClientFactory.make(configuration: local) as? BackendDynamicResearchPlanningClient)
        XCTAssertTrue(client.authorizer is LoopbackDevelopmentSessionAuthorizer)
        let remote = try XCTUnwrap(DynamicResearchPlanningClientFactory.make(configuration: configuration()) as? BackendDynamicResearchPlanningClient)
        XCTAssertFalse(remote.authorizer is LoopbackDevelopmentSessionAuthorizer)
    }
    #endif
    func testMissingInvalidOrMalformedConfigurationIsExplicit() throws {
        for configuration in [nil, try configuration(url: ""), try configuration(url: "https://wrong.example.org/"), try configuration(enabled: "yes")] {
            let client = try XCTUnwrap(DynamicResearchPlanningClientFactory.make(configuration: configuration))
            XCTAssertThrowsError(try client.validateConfiguration()) { error in
                XCTAssertTrue(error is DynamicResearchConfigurationFailure)
                XCTAssertTrue(PlannerViewModel.userMessage(for: error).contains("configured"))
            }
        }
    }
    func testExpiredSessionRenewsExactlyOnceAndAdoptsValidatedRoute() async throws {
        let opener = ResearchSessionOpener()
        let authorizer = RouteSessionService(opener: opener)
        let data = try successfulFixture()
        ResearchTransportProtocol.reset([.http(401, error("route_session_expired")), .http(200, data)])
        let result = try await client(authorizer).plan(prompt: "Public village loop", request: request,
            start: start, end: nil, context: .unspecified)
        XCTAssertTrue(result.suggestion.route.isVerifiedRoutedResult)
        XCTAssertEqual(result.suggestion.route.dynamicResearchStops.count, 3)
        let count = await opener.count
        XCTAssertEqual(count, 2)
        let sent = ResearchTransportProtocol.sent()
        XCTAssertEqual(sent.count, 2)
        XCTAssertNotEqual(sent[0].value(forHTTPHeaderField: "Authorization"), sent[1].value(forHTTPHeaderField: "Authorization"))
        XCTAssertNotEqual(sent[0].value(forHTTPHeaderField: "X-TrailMind-Request-ID"), sent[1].value(forHTTPHeaderField: "X-TrailMind-Request-ID"))
    }
    func testDenialReplayRateLimitOutageAndRepeatedExpiryDoNotLoop() async throws {
        for (status, code, expected) in [(403,"denied",OutdoorAdventurePlanningClientFailure.authorizationFailed),
            (401,"route_session_invalid",.authorizationFailed),(429,"rate_limited",.rateLimited),
            (409,"request_replayed",.rejected),(503,"feature_unavailable",.unavailable),(504,"timed_out",.timedOut)] {
            let opener = ResearchSessionOpener()
            ResearchTransportProtocol.reset([.http(status,error(code))])
            do { _ = try await client(RouteSessionService(opener: opener)).plan(prompt: "Village loop",
                request: request, start: start, end: nil, context: .unspecified); XCTFail("Unexpected success") }
            catch { XCTAssertEqual(error as? OutdoorAdventurePlanningClientFailure, expected) }
            XCTAssertEqual(ResearchTransportProtocol.sent().count,1)
        }
        ResearchTransportProtocol.reset([.http(401,error("route_session_expired")),.http(401,error("route_session_expired"))])
        do { _ = try await client(RouteSessionService(opener: ResearchSessionOpener())).plan(prompt: "Village loop",
            request: request,start: start,end: nil,context: .unspecified); XCTFail("Unexpected success") }
        catch { XCTAssertEqual(error as? OutdoorAdventurePlanningClientFailure,.authorizationFailed) }
        XCTAssertEqual(ResearchTransportProtocol.sent().count,2)
    }
    func testTransportCancellationAndNetworkFailureStayTyped() async throws {
        for code in [URLError.Code.cancelled,.notConnectedToInternet] {
            ResearchTransportProtocol.reset([.failure(code)])
            do { _ = try await client(RouteSessionService(opener: ResearchSessionOpener())).plan(prompt: "Village loop",
                request: request,start: start,end: nil,context: .unspecified); XCTFail("Unexpected success") }
            catch {
                if code == .cancelled { XCTAssertTrue(error is CancellationError) }
                else { XCTAssertEqual(error as? OutdoorAdventurePlanningClientFailure,.unavailable) }
            }
            XCTAssertEqual(ResearchTransportProtocol.sent().count,1)
        }
    }
    func testSavedRouteRecheckBindsExactGeometryAndPlannedDate() async throws {
        let route = try BackendDynamicResearchPlanningClient.validate(successfulFixture(), request: request,
            start: start, end: nil, context: .unspecified).suggestion.route
        let originalPath = route.path
        let date = Date(timeIntervalSince1970: floor(Date.now.timeIntervalSince1970) + 3600)
        let geometry = try JSONSerialization.data(withJSONObject: route.path.map { [$0.longitude, $0.latitude] })
        let digest = SHA256.hash(data: geometry).map { String(format: "%02x", $0) }.joined()
        let formatter = ISO8601DateFormatter()
        var conditions = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(RoutePlanningEvidenceTests.conditions())) as? [String: Any])
        conditions["checkedAt"] = formatter.string(from: .now)
        conditions["expiresAt"] = formatter.string(from: Date.now.addingTimeInterval(3500))
        conditions["visitTime"] = formatter.string(from: date)
        let payload: [String: Any] = ["schemaVersion": 4, "state": "checked", "geometryDigest": digest, "localConditions": conditions]
        ResearchTransportProtocol.reset([.http(200, try JSONSerialization.data(withJSONObject: payload))])
        let result = try await client(RouteSessionService(opener: ResearchSessionOpener())).recheck(route: route, plannedStartAt: date)
        XCTAssertEqual(PlanningEvidenceDate.parse(result.visitTime), date)
        XCTAssertEqual(route.path, originalPath)
        XCTAssertEqual(ResearchTransportProtocol.sent().count, 1)
        var wrong = payload; wrong["geometryDigest"] = String(repeating: "0", count: 64)
        ResearchTransportProtocol.reset([.http(200, try JSONSerialization.data(withJSONObject: wrong))])
        do {
            _ = try await client(RouteSessionService(opener: ResearchSessionOpener())).recheck(route: route, plannedStartAt: date)
            XCTFail("Unrelated geometry must not adopt a condition check")
        } catch {
            XCTAssertEqual(error as? OutdoorAdventurePlanningClientFailure, .invalidResponse)
        }
        XCTAssertEqual(route.path, originalPath)
    }

    private func client(_ authorizer: any RouteSessionAuthorizing) -> BackendDynamicResearchPlanningClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ResearchTransportProtocol.self]
        return BackendDynamicResearchPlanningClient(baseURL: URL(string:"https://planning.example.org/")!,
            session: URLSession(configuration: config),authorizer: authorizer)
    }
    private func error(_ code: String) -> Data { Data("{\"error\":{\"code\":\"\(code)\"}}".utf8) }
    private func successfulFixture() throws -> Data {
        // Offline geometry and grounding fixtures; refreshed timestamps are synthetic.
        let folder = URL(fileURLWithPath:#filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")
        var body = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf:folder.appendingPathComponent("dynamic-research-offline.json"))) as? [String:Any])
        var route = try XCTUnwrap(body["route"] as? [String:Any])
        var places = try XCTUnwrap(route["places"] as? [[String:Any]])
        let dates = ISO8601DateFormatter();dates.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        for index in places.indices {
            var source = try XCTUnwrap(places[index]["source"] as? [String:Any])
            source["snapshotAt"] = dates.string(from:.now);source["retrievedAt"] = dates.string(from:.now)
            places[index]["source"] = source
        }
        route["places"] = places
        route["qualityReview"] = ["schemaVersion": 1, "decision": "complete", "summary": "This measured route connects the selected stops.", "remainingWishes": ["Current access remains unverified."], "evidenceIds": []]
        let web = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf:folder.appendingPathComponent("dynamic-web-unicode.json"))) as? [[String:Any]])
        route["webResearch"] = web[0];body["route"] = route
        return try JSONSerialization.data(withJSONObject:body)
    }
}
private actor ResearchSessionOpener: RouteSessionOpening {
    var count = 0
    func openRouteSession() async throws -> RouteSession {
        count += 1
        return RouteSession(token:"offline-session-\(count)",expiresAt:.now.addingTimeInterval(600),remainingCost:24)
    }
}
private final class ResearchTransportProtocol: URLProtocol, @unchecked Sendable {
    enum Reply { case http(Int,Data); case failure(URLError.Code) }
    private static let lock = NSLock()
    private nonisolated(unsafe) static var replies: [Reply] = []
    private nonisolated(unsafe) static var requests: [URLRequest] = []
    static func reset(_ values: [Reply]) { lock.lock();defer { lock.unlock() };replies=values;requests=[] }
    static func sent() -> [URLRequest] { lock.lock();defer { lock.unlock() };return requests }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock();Self.requests.append(request)
        let reply = Self.replies.isEmpty ? Reply.http(500,Data()) : Self.replies.removeFirst()
        Self.lock.unlock()
        switch reply {
        case let .failure(code): client?.urlProtocol(self,didFailWithError:URLError(code))
        case let .http(status,data):
            client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
            client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}
