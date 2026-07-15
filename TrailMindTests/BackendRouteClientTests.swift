import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class BackendRouteClientTests: XCTestCase {
    func testBackendGatewayUsesBoundedTransportAndExactNamedCoordinateBody() async throws {
        URLProtocolStub.reset(
            responses: [.init(statusCode: 200, data: Self.routeResponse, chunkSize: 37)]
        )
        let gateway = makeGateway()

        let data = try await gateway.route(Self.backendRequest)

        XCTAssertEqual(data, Self.routeResponse)
        let body = try XCTUnwrap(URLProtocolStub.requestBodies().first)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )
        XCTAssertEqual(object["profile"] as? String, "foot")
        XCTAssertEqual(object["routeType"] as? String, "pointToPoint")
        let points = try XCTUnwrap(object["points"] as? [[String: Double]])
        XCTAssertEqual(points, [
            ["latitude": 51.866, "longitude": 10.678],
            ["latitude": 51.765, "longitude": 10.653]
        ])
        XCTAssertNil(object["apiKey"])
        XCTAssertFalse(String(decoding: body, as: UTF8.self).localizedCaseInsensitiveContains("provider-key"))
    }

    func testBackendGatewayRejectsAdvertisedAndActuallyOversizedBodies() async throws {
        let limits = Self.testLimits(maximumSuccessBodyBytes: 256)
        let responses: [URLProtocolStub.Response] = [
            .init(
                statusCode: 200,
                data: Data(#"{"paths":[]}"#.utf8),
                headerFields: ["Content-Length": "257"]
            ),
            .init(
                statusCode: 200,
                data: Data(repeating: 0x20, count: 257),
                chunkSize: 17
            ),
            .init(
                statusCode: 200,
                data: Data(repeating: 0x20, count: 257),
                headerFields: ["Content-Length": "8"],
                chunkSize: 19
            )
        ]

        for response in responses {
            URLProtocolStub.reset(responses: [response])
            do {
                _ = try await makeGateway(limits: limits).route(Self.backendRequest)
                XCTFail("An oversized backend response must fail closed.")
            } catch let error as GraphHopperError {
                guard case .decoding = error else {
                    return XCTFail("Unexpected GraphHopper error: \(error)")
                }
            }
        }
    }

    func testBackendGatewayCancellationStopsTransportAndRejectsLateResponse() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: Self.routeResponse,
                    delay: 0.2,
                    deliversAfterStop: true
                )
            ]
        )
        let gateway = makeGateway()
        let task = Task { try await gateway.route(Self.backendRequest) }
        try await Task.sleep(for: .milliseconds(30))
        task.cancel()

        do {
            _ = try await task.value
            XCTFail("Backend cancellation must not become a late success.")
        } catch is CancellationError {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        try await Task.sleep(for: .milliseconds(250))
        XCTAssertGreaterThanOrEqual(URLProtocolStub.stopLoadingCount(), 1)
    }

    func testBackendGatewayDoesNotExposeProviderErrorBody() async throws {
        let sensitive = "provider-secret exact-private-request"
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 400,
                    data: Data(
                        "{\"error\":{\"code\":\"provider_error\",\"message\":\"\(sensitive)\"}}".utf8
                    )
                )
            ]
        )

        do {
            _ = try await makeGateway().route(Self.backendRequest)
            XCTFail("The backend error must fail.")
        } catch let error as GraphHopperError {
            XCTAssertFalse(error.localizedDescription.contains(sensitive))
            if case let .api(_, message, hints) = error {
                XCTAssertFalse(message.contains(sensitive))
                XCTAssertTrue(hints.isEmpty)
            } else {
                XCTFail("Unexpected GraphHopper error: \(error)")
            }
        }
    }

    func testBackendClientUsesNamedCoordinatesAndContainsNoProviderKey() async throws {
        let gateway = RecordingRouteGateway(response: Self.routeResponse)
        let client = GraphHopperClient(gateway: gateway)
        let request = RoutePlanningRequest(
            routeType: .pointToPoint,
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: [.majorRoads]
        )
        let route = try await client.calculateGraphHopperRoute(
            request: request,
            start: Coordinate(latitude: 51.866, longitude: 10.678),
            end: Coordinate(latitude: 51.765, longitude: 10.653)
        )
        let capturedRequests = await gateway.requests()
        let captured = try XCTUnwrap(capturedRequests.first)
        XCTAssertEqual(captured.points[0].latitude, 51.866)
        XCTAssertEqual(captured.points[0].longitude, 10.678)
        XCTAssertEqual(captured.routeType, "pointToPoint")
        XCTAssertEqual(captured.preferences?.avoid, ["majorRoads"])
        XCTAssertEqual(captured.weightedCost, 2)
        let encoded = try JSONEncoder().encode(captured)
        XCTAssertFalse(String(decoding: encoded, as: UTF8.self).localizedCaseInsensitiveContains("apiKey"))
        XCTAssertEqual(route.distanceKilometers, 12.3, accuracy: 0.01)
        guard case let .routed(provenance) = route.provenance else {
            return XCTFail("Backend route must carry decoded routing provenance.")
        }
        XCTAssertEqual(provenance.provider, .graphHopper)
        XCTAssertEqual(provenance.strategy, .backend)
        XCTAssertTrue(route.isVerifiedRoutedResult)
    }

    func testBackendResponseWithoutProviderCannotBecomeVerified() async throws {
        let response = Data(String(decoding: Self.routeResponse, as: UTF8.self)
            .replacingOccurrences(of: #""provider": "graphhopper","#, with: "")
            .utf8)
        let client = GraphHopperClient(gateway: RecordingRouteGateway(response: response))
        let request = RoutePlanningRequest(
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )

        do {
            _ = try await client.calculateGraphHopperRoute(
                request: request,
                start: Coordinate(latitude: 51.866, longitude: 10.678),
                end: Coordinate(latitude: 51.765, longitude: 10.653)
            )
            XCTFail("A backend response without provider identity must fail closed.")
        } catch GraphHopperError.invalidResponse {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testBackendClientRejectsLateSuccessFromCancellationIgnoringGateway() async throws {
        let gateway = CancellationIgnoringRouteGateway(response: Self.routeResponse)
        let client = GraphHopperClient(gateway: gateway)
        let request = RoutePlanningRequest(
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )
        let task = Task {
            try await client.calculateGraphHopperRoute(
                request: request,
                start: Coordinate(latitude: 51.866, longitude: 10.678),
                end: Coordinate(latitude: 51.765, longitude: 10.653)
            )
        }

        var gatewayStarted = false
        for _ in 0..<1_000 {
            if await gateway.hasStarted() {
                gatewayStarted = true
                break
            }
            await Task.yield()
        }
        XCTAssertTrue(gatewayStarted)
        task.cancel()

        do {
            _ = try await task.value
            XCTFail("Cancellation must not become a verified late success.")
        } catch is CancellationError {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testConcurrentLoopVariantsUseTheGatewayInParallel() async throws {
        let gateway = RecordingRouteGateway(response: Self.routeResponse, delayNanoseconds: 20_000_000)
        let client = GraphHopperClient(gateway: gateway)
        let request = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )
        let routes = try await client.calculateRoundTripRouteVariants(
            start: Coordinate(latitude: 51.866, longitude: 10.678),
            request: request,
            seeds: [11, 29, 47],
            deadline: nil,
            maximumConcurrentRequests: 2
        )
        let requests = await gateway.requests()
        let maximumConcurrentRequests = await gateway.maximumConcurrentRequests()
        XCTAssertEqual(routes.count, 3)
        XCTAssertEqual(requests.compactMap { $0.roundTrip?.seed }.sorted(), [11, 29, 47])
        XCTAssertTrue(requests.allSatisfy { $0.weightedCost == 2 })
        XCTAssertGreaterThan(maximumConcurrentRequests, 1)
        XCTAssertTrue(routes.allSatisfy { route in
            guard case let .routed(provenance) = route.provenance else { return false }
            return provenance.provider == .graphHopper && provenance.strategy == .backend
        })
    }

    private static let routeResponse = Data(#"""
    {
      "provider": "graphhopper",
      "paths": [{
        "distance": 12300,
        "time": 7200000,
        "ascend": 320,
        "descend": 315,
        "points": {
          "type": "LineString",
          "coordinates": [[10.678, 51.866, 250], [10.700, 51.820, 410], [10.678, 51.866, 250]]
        },
        "instructions": [],
        "details": { "surface": [], "road_class": [], "hike_rating": [] }
      }]
    }
    """#.utf8)

    private static let backendRequest = BackendRouteRequest(
        profile: "foot",
        routeType: "pointToPoint",
        points: [
            .init(Coordinate(latitude: 51.866, longitude: 10.678)),
            .init(Coordinate(latitude: 51.765, longitude: 10.653))
        ],
        algorithm: nil,
        roundTrip: nil,
        alternativeRoute: nil,
        locale: "de",
        includeElevation: true,
        includeInstructions: true,
        includePathDetails: ["surface", "road_class", "hike_rating"],
        preferences: nil
    )

    private func makeGateway(
        limits: RouteTransportLimits = .standard
    ) -> BackendRouteGateway {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        return BackendRouteGateway(
            baseURL: URL(string: "https://example.com")!,
            session: URLSession(configuration: configuration),
            authorizer: StaticRouteAuthorizer(),
            limits: limits
        )
    }

    private static func testLimits(maximumSuccessBodyBytes: Int) -> RouteTransportLimits {
        RouteTransportLimits(
            maximumSuccessBodyBytes: maximumSuccessBodyBytes,
            maximumErrorBodyBytes: 128,
            maximumPaths: 8,
            maximumCoordinatesPerPath: 100_000,
            maximumInstructionsPerPath: 25_000,
            maximumPathDetailsPerPath: 100_000,
            maximumAbsoluteElevationMeters: 100_000
        )
    }
}

private actor StaticRouteAuthorizer: RouteSessionAuthorizing {
    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        RouteSessionAuthorization(
            token: "test-session-token",
            requestID: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
        )
    }

    func invalidate(token: String) async {}
}

private actor RecordingRouteGateway: BackendRouteGatewayRouting {
    private let response: Data
    private let delayNanoseconds: UInt64
    private var capturedRequests: [BackendRouteRequest] = []
    private var activeRequests = 0
    private var maximumActiveRequests = 0

    init(response: Data, delayNanoseconds: UInt64 = 0) {
        self.response = response
        self.delayNanoseconds = delayNanoseconds
    }

    func route(_ request: BackendRouteRequest) async throws -> Data {
        capturedRequests.append(request)
        activeRequests += 1
        maximumActiveRequests = max(maximumActiveRequests, activeRequests)
        if delayNanoseconds > 0 { try await Task.sleep(nanoseconds: delayNanoseconds) }
        activeRequests -= 1
        return response
    }

    func requests() -> [BackendRouteRequest] { capturedRequests }
    func maximumConcurrentRequests() -> Int { maximumActiveRequests }
}

private actor CancellationIgnoringRouteGateway: BackendRouteGatewayRouting {
    private let response: Data
    private var started = false

    init(response: Data) {
        self.response = response
    }

    func route(_ request: BackendRouteRequest) async throws -> Data {
        started = true
        while !Task.isCancelled {
            await Task.yield()
        }
        return response
    }

    func hasStarted() -> Bool { started }
}
