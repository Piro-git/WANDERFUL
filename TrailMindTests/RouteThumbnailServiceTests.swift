import Foundation
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
        XCTAssertTrue(geometry.mapPoints.isEmpty)
        XCTAssertNil(geometry.bounds)
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

    @MainActor
    func testCacheKeyUsesVerifiedFingerprintWhenInteriorGeometryChangesUnderSameID() {
        let base = MockRoutes.luneburgLoop
        var changedPath = base.path
        changedPath[2] = Coordinate(latitude: 54.0, longitude: 11.0)
        let original = base.withPath(
            base.path,
            provenance: base.routedProvenance(for: base.path)
        )
        let changed = base.withPath(
            changedPath,
            provenance: base.routedProvenance(for: changedPath)
        )

        XCTAssertEqual(original.id, changed.id)
        XCTAssertEqual(original.path.count, changed.path.count)
        XCTAssertEqual(original.path.first, changed.path.first)
        XCTAssertEqual(original.path[original.path.count / 2], changed.path[changed.path.count / 2])
        XCTAssertEqual(original.path.last, changed.path.last)
        XCTAssertNotEqual(
            RouteThumbnailService.cacheKey(for: original),
            RouteThumbnailService.cacheKey(for: changed)
        )
    }

    @MainActor
    func testLargeRouteGeometryIsBoundedAndPreservesEndpointsAndExtrema() {
        let coordinates = (0..<100_000).map { index in
            let progress = Double(index) / 99_999
            return Coordinate(
                latitude: 50 + progress + sin(progress * 80) * 0.12,
                longitude: 9 + progress + cos(progress * 60) * 0.10
            )
        }
        let route = MockRoutes.luneburgLoop.withPath(coordinates)
        let expectedMinimumLatitude = coordinates.min { $0.latitude < $1.latitude }
        let expectedMaximumLatitude = coordinates.max { $0.latitude < $1.latitude }
        let expectedMinimumLongitude = coordinates.min { $0.longitude < $1.longitude }
        let expectedMaximumLongitude = coordinates.max { $0.longitude < $1.longitude }

        let start = CFAbsoluteTimeGetCurrent()
        let geometry = RouteThumbnailService.makeGeometry(for: route)
        let elapsed = CFAbsoluteTimeGetCurrent() - start

        XCTAssertLessThanOrEqual(geometry.mapPoints.count, RouteThumbnailService.maximumMapPointCount)
        XCTAssertLessThanOrEqual(geometry.normalizedPoints.count, RouteThumbnailService.maximumThumbnailPointCount)
        XCTAssertEqual(geometry.mapPoints.first, coordinates.first)
        XCTAssertEqual(geometry.mapPoints.last, coordinates.last)
        XCTAssertTrue(geometry.mapPoints.contains(expectedMinimumLatitude!))
        XCTAssertTrue(geometry.mapPoints.contains(expectedMaximumLatitude!))
        XCTAssertTrue(geometry.mapPoints.contains(expectedMinimumLongitude!))
        XCTAssertTrue(geometry.mapPoints.contains(expectedMaximumLongitude!))
        XCTAssertLessThan(elapsed, 2, "Display geometry should stay bounded at the transport ceiling.")
    }

    @MainActor
    func testGeometryCacheHasFiniteCapacityAndReusesEntries() {
        let service = RouteThumbnailService(cacheCapacity: 2)
        let firstRoute = MockRoutes.luneburgLoop
        let secondRoute = firstRoute.withPath(
            firstRoute.path + [Coordinate(latitude: 53.22, longitude: 10.39)]
        )
        let thirdRoute = firstRoute.withPath(
            firstRoute.path + [
                Coordinate(latitude: 53.22, longitude: 10.39),
                Coordinate(latitude: 53.23, longitude: 10.40)
            ]
        )

        let firstGeometry = service.geometry(for: firstRoute)
        XCTAssertEqual(service.geometry(for: firstRoute), firstGeometry)
        XCTAssertEqual(service.cachedGeometryCount, 1)

        _ = service.geometry(for: secondRoute)
        _ = service.geometry(for: thirdRoute)
        XCTAssertEqual(service.cachedGeometryCount, 2)

        service.clearCache()
        XCTAssertEqual(service.cachedGeometryCount, 0)
    }

    @MainActor
    func testMapServiceCapsRenderedPolylineAndUsesRouteBounds() {
        let coordinates = (0..<10_000).map { index in
            Coordinate(
                latitude: 51 + Double(index) / 20_000,
                longitude: 9 + sin(Double(index) / 120) * 0.4
            )
        }
        let route = MockRoutes.luneburgLoop.withPath(coordinates)
        let service = DefaultMapService()

        let polyline = service.getRoutePolyline(route: route)
        let region = service.getMapPreview(route: route)

        XCTAssertLessThanOrEqual(polyline.pointCount, RouteThumbnailService.maximumMapPointCount)
        XCTAssertEqual(region.center.latitude, 51.249975, accuracy: 0.000001)
        XCTAssertGreaterThan(region.span.latitudeDelta, 0.4)
        XCTAssertGreaterThan(region.span.longitudeDelta, 1.2)
    }
}

@MainActor
private extension TrailRoute {
    func withPath(
        _ path: [Coordinate],
        provenance: RouteProvenance = .demo(.testFixture)
    ) -> TrailRoute {
        TrailRoute(
            id: id,
            provenance: provenance,
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

    func routedProvenance(for path: [Coordinate]) -> RouteProvenance {
        .routingEngineOutput(
            provider: .graphHopper,
            strategy: .backend,
            activity: activity,
            routeType: routeType,
            distanceKilometers: distanceKilometers,
            elevationGainMeters: elevationGainMeters,
            elevationLossMeters: elevationLossMeters,
            durationHours: durationHours,
            difficulty: difficulty,
            path: path,
            verifiedCharacteristics: verifiedCharacteristics
        )
    }
}
