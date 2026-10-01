import XCTest
@testable import TrailMind

@MainActor
final class RouteStopGeometryTests: XCTestCase {
    private func point(_ latitude: Double, _ longitude: Double) -> GeoPoint {
        GeoPoint(latitude: latitude, longitude: longitude)
    }

    func testSparseSegmentMidpointAndFiniteEndpoints() throws {
        let path = [point(0, 0), point(0, 0.1)]
        let position = try XCTUnwrap(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: 0.05), on: path))
        XCTAssertEqual(position, 0.5, accuracy: 1e-8)
        XCTAssertNil(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: -0.01), on: path))
        XCTAssertNil(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: 0.11), on: path))
    }

    func testOneHundredMeterCorridorIsNotExpanded() {
        let path = [point(0, 0), point(0, 0.1)]
        for (meters, accepted) in [(98.0, true), (102.0, false)] {
            let latitude = meters / 6_371_000 * 180 / Double.pi
            XCTAssertEqual(RouteStopGeometry.firstPosition(of: .init(latitude: latitude, longitude: 0.05), on: path) != nil, accepted)
        }
    }

    func testDatelineUsesShortArcAndNeverGreenwich() throws {
        let path = [point(0, 179.99), point(0, -179.99)]
        for longitude in [180.0, -180.0] {
            XCTAssertEqual(try XCTUnwrap(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: longitude), on: path)), 0.5, accuracy: 1e-8)
        }
        XCTAssertNil(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: 0), on: path))
    }

    func testHighLatitudeSphericalMidpointAcrossDateline() throws {
        let latitude = atan(tan(80 * Double.pi / 180) / cos(Double.pi / 180)) * 180 / Double.pi
        let path = [point(80, 179), point(80, -179)]
        XCTAssertEqual(try XCTUnwrap(RouteStopGeometry.firstPosition(of: .init(latitude: latitude, longitude: 180), on: path)), 0.5, accuracy: 1e-8)
        XCTAssertNil(RouteStopGeometry.firstPosition(of: .init(latitude: 80, longitude: 0), on: path))
    }

    func testArcOverPole() throws {
        XCTAssertEqual(try XCTUnwrap(RouteStopGeometry.firstPosition(of: .init(latitude: 90, longitude: 0),
            on: [point(89, -90), point(89, 90)])), 0.5, accuracy: 1e-8)
    }

    func testProgressCannotMoveBackwardsWithinSameSegment() throws {
        let path = [point(0, 0), point(0, 0.1)]
        let first = try XCTUnwrap(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: 0.075), on: path))
        XCTAssertNil(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: 0.025), on: path, after: first))
        XCTAssertNotNil(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: 0.08), on: path, after: first))
    }

    func testLaterRevisitCanSatisfyStopOrder() throws {
        let path = [point(0, 0), point(0, 0.1), point(0, 0)]
        let position = try XCTUnwrap(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: 0.025), on: path, after: 0.75))
        XCTAssertEqual(position, 1.75, accuracy: 1e-8)
    }

    func testDuplicateVerticesAndEndProgress() throws {
        let path = [point(0, 0), point(0, 0), point(0, 0.1)]
        XCTAssertEqual(try XCTUnwrap(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: 0.05), on: path)), 1.5, accuracy: 1e-8)
        XCTAssertEqual(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: 0.1), on: path, after: 2), 2)
        XCTAssertNil(RouteStopGeometry.firstPosition(of: .init(latitude: 0, longitude: 0.05), on: path, after: 2))
    }

    func testInvalidAndAmbiguousGeometryFailsClosed() {
        let coordinate = DynamicResearchCoordinate(latitude: 0, longitude: 0)
        for path in [[], [point(0, 0)], [point(.nan, 0), point(0, 1)], [point(91, 0), point(0, 1)], [point(0, 0), point(0, 180)]] {
            XCTAssertNil(RouteStopGeometry.firstPosition(of: coordinate, on: path))
        }
        let path = [point(0, 0), point(0, 0.1)]
        XCTAssertNil(RouteStopGeometry.firstPosition(of: .init(latitude: .infinity, longitude: 0), on: path))
        for progress in [-1.0, 2, .infinity, .nan] {
            XCTAssertNil(RouteStopGeometry.firstPosition(of: coordinate, on: path, after: progress))
        }
    }
}
