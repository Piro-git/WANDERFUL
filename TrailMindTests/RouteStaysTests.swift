import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class RouteStaysTests: XCTestCase {
    private let now = PlanningEvidenceDate.parse("2026-09-29T10:00:00Z")!
    private struct Fixture: Decodable {
        let coordinates: [[Double]]
        let evidence: RouteStays
        @MainActor var path: [GeoPoint] { coordinates.map { .init(latitude: $0[1], longitude: $0[0]) } }
    }
    private func fixture() throws -> Fixture {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/route-stays-offline.json")
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }
    private func modified(_ changes: (inout [String: Any]) -> Void) throws -> RouteStays {
        let evidence = try fixture().evidence
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(evidence)) as? [String: Any])
        changes(&json)
        return try JSONDecoder().decode(RouteStays.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testBackendFixtureValidatesWithNativeGeometryDigestAndSegmentDistance() throws {
        let fixture = try fixture()
        try fixture.evidence.validate(path: fixture.path, now: now, requireFresh: true)
        XCTAssertFalse(fixture.evidence.isStale(at: now))
        XCTAssertEqual(fixture.evidence.candidates[0].straightLineDistanceToPathMeters, 111)
        XCTAssertLessThan(RouteStays.distanceToPath(fixture.evidence.candidates[0].coordinate, path: fixture.path), 112)
        XCTAssertThrowsError(try fixture.evidence.validate(path: [.init(latitude: 48, longitude: 10), .init(latitude: 48, longitude: 10.02)], now: now))
    }
    func testDateLineAndSparseSegmentEndpoints() {
        let offset = RouteStays.distanceToPath(.init(latitude: 0.001, longitude: 180), path: [
            .init(latitude: 0, longitude: 179.99), .init(latitude: 0, longitude: -179.99)])
        XCTAssertEqual(offset, 111.195, accuracy: 1)
    }
    func testForgedDistanceSourceIdentityUnknownNameAndWebsiteAreRejected() throws {
        let path = try fixture().path
        for (key, value) in [("straightLineDistanceToPathMeters", 1 as Any), ("nameKnown", false), ("website", "https://127.0.0.1/"), ("id", "osm:node:999")] {
            let evidence = try modified { json in
                var candidates = json["candidates"] as! [[String: Any]]
                candidates[0][key] = value
                json["candidates"] = candidates
            }
            XCTAssertThrowsError(try evidence.validate(path: path, now: now), key)
        }
    }
    func testEmptyUnavailableAndDuplicateStatesValidateStrictly() throws {
        let path = try fixture().path
        for state in ["empty", "unavailable"] {
            let evidence = try modified { $0["state"] = state; $0["candidates"] = [] }
            XCTAssertNoThrow(try evidence.validate(path: path, now: now))
        }
        let duplicate = try modified { $0["candidates"] = ($0["candidates"] as! [Any]) + ($0["candidates"] as! [Any]) }
        XCTAssertThrowsError(try duplicate.validate(path: path, now: now))
        let emptyAvailable = try modified { $0["candidates"] = [] }
        XCTAssertThrowsError(try emptyAvailable.validate(path: path, now: now))
    }
    func testOfflineSavedEvidenceKeepsAgeWithoutBecomingFreshAgain() throws {
        let fixture = try fixture(), later = now.addingTimeInterval(8 * 86_400)
        let decoded = try JSONDecoder().decode(RouteStays.self, from: JSONEncoder().encode(fixture.evidence))
        XCTAssertTrue(decoded.isStale(at: later))
        XCTAssertNoThrow(try decoded.validate(path: fixture.path, now: later))
        XCTAssertThrowsError(try decoded.validate(path: fixture.path, now: later, requireFresh: true))
        XCTAssertEqual(decoded.candidates[0].source.updatedAt, "2024-01-01T00:00:00.000Z")
    }
}
