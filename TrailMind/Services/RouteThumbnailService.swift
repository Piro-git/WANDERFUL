import CoreGraphics
import Foundation

struct RouteThumbnailCacheKey: Hashable, Sendable {
    let value: String
}

struct RouteThumbnailGeometry: Equatable, Sendable {
    let normalizedPoints: [NormalizedRoutePoint]
    let isLoop: Bool

    var hasRenderableRoute: Bool {
        normalizedPoints.count >= 2
    }
}

struct NormalizedRoutePoint: Equatable, Sendable {
    let x: Double
    let y: Double

    func cgPoint(in size: CGSize) -> CGPoint {
        CGPoint(x: x * size.width, y: y * size.height)
    }
}

@MainActor
final class RouteThumbnailService {
    static let shared = RouteThumbnailService()

    private var geometryCache: [RouteThumbnailCacheKey: RouteThumbnailGeometry] = [:]

    func geometry(for route: TrailRoute) -> RouteThumbnailGeometry {
        let key = Self.cacheKey(for: route)
        if let cached = geometryCache[key] {
            return cached
        }

        let geometry = Self.makeGeometry(for: route)
        geometryCache[key] = geometry
        return geometry
    }

    func clearCache() {
        geometryCache.removeAll()
    }

    nonisolated static func cacheKey(for route: TrailRoute) -> RouteThumbnailCacheKey {
        let coordinateHash = route.path.map { point in
            "\(roundedForThumbnail(point.latitude)),\(roundedForThumbnail(point.longitude))"
        }
        .joined(separator: "|")
        return RouteThumbnailCacheKey(value: "\(route.id.uuidString)|\(route.routeType.rawValue)|\(coordinateHash)")
    }

    private nonisolated static func roundedForThumbnail(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(5)))
    }

    nonisolated static func makeGeometry(for route: TrailRoute) -> RouteThumbnailGeometry {
        RouteThumbnailGeometry(
            normalizedPoints: normalizedPoints(for: route.path),
            isLoop: route.routeType == .loop || isClosedLoop(route.path)
        )
    }

    nonisolated static func normalizedPoints(for coordinates: [Coordinate]) -> [NormalizedRoutePoint] {
        guard coordinates.count >= 2 else { return [] }

        let latitudes = coordinates.map(\.latitude)
        let longitudes = coordinates.map(\.longitude)
        guard
            let minLatitude = latitudes.min(),
            let maxLatitude = latitudes.max(),
            let minLongitude = longitudes.min(),
            let maxLongitude = longitudes.max()
        else {
            return []
        }

        let latitudeRange = max(maxLatitude - minLatitude, 0.001)
        let longitudeRange = max(maxLongitude - minLongitude, 0.001)

        return coordinates.map { point in
            NormalizedRoutePoint(
                x: (point.longitude - minLongitude) / longitudeRange,
                y: 1 - (point.latitude - minLatitude) / latitudeRange
            )
        }
    }

    nonisolated static func isClosedLoop(_ coordinates: [Coordinate]) -> Bool {
        guard let first = coordinates.first, let last = coordinates.last else {
            return false
        }
        let latitudeDifference = abs(first.latitude - last.latitude)
        let longitudeDifference = abs(first.longitude - last.longitude)
        return latitudeDifference <= 0.002 && longitudeDifference <= 0.002
    }
}
