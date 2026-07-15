import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class BackendRouteClientTests: XCTestCase {
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
