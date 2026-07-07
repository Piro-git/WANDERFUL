import XCTest
@testable import TrailMind

final class RouteThumbnailServiceTests: XCTestCase {
    @MainActor
    func testNormalizesRouteCoordinatesIntoUnitSpace() {
        let points = RouteThumbnailService.normalizedPoints(
            for: [
                Coordinate(latitude: 10, longitude: 20),
                Coordinate(latitude: 15, longitude: 25),
                Coordinate(latitude: 20, longitude: 30)
            ]
        )

        XCTAssertEqual(points.first, NormalizedRoutePoint(x: 0, y: 1))
        XCTAssertEqual(points[1], NormalizedRoutePoint(x: 0.5, y: 0.5))
        XCTAssertEqual(points.last, NormalizedRoutePoint(x: 1, y: 0))
    }

    @MainActor
    func testFallbackGeometryForRoutesWithoutEnoughCoordinates() {
        let route = MockRoutes.luneburgLoop.withPath([])
        let geometry = RouteThumbnailService.makeGeometry(for: route)

        XCTAssertFalse(geometry.hasRenderableRoute)
        XCTAssertTrue(geometry.normalizedPoints.isEmpty)
    }

    @MainActor
    func testDetectsClosedLoopByNearbyStartAndEnd() {
        XCTAssertTrue(
            RouteThumbnailService.isClosedLoop(
                [
                    Coordinate(latitude: 51.8666, longitude: 10.6782),
                    Coordinate(latitude: 51.82, longitude: 10.66),
                    Coordinate(latitude: 51.8667, longitude: 10.6781)
                ]
            )
        )
        XCTAssertFalse(
            RouteThumbnailService.isClosedLoop(
                [
                    Coordinate(latitude: 51.8666, longitude: 10.6782),
                    Coordinate(latitude: 51.7636, longitude: 10.6647)
                ]
            )
        )
    }

    @MainActor
    func testCacheKeyChangesWithRouteGeometry() {
        let base = MockRoutes.luneburgLoop
        let changed = base.withPath(
            base.path + [Coordinate(latitude: 53.22, longitude: 10.39)]
        )

        XCTAssertNotEqual(
            RouteThumbnailService.cacheKey(for: base),
            RouteThumbnailService.cacheKey(for: changed)
        )
    }
}

@MainActor
private extension TrailRoute {
    func withPath(_ path: [Coordinate]) -> TrailRoute {
        TrailRoute(
            id: id,
            title: title,
            location: location,
            activity: activity,
            distanceKilometers: distanceKilometers,
            elevationGainMeters: elevationGainMeters,
            elevationLossMeters: elevationLossMeters,
            durationHours: durationHours,
            difficulty: difficulty,
            routeType: routeType,
            summary: summary,
            whyItMatches: whyItMatches,
            highlights: highlights,
            waypoints: waypoints,
            days: days,
            safetyNotes: safetyNotes,
            elevationProfile: elevationProfile,
            path: path,
            routeInstructions: routeInstructions,
            planningMetadata: planningMetadata
        )
    }
}
