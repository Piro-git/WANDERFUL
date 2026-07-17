import CoreGraphics
import Foundation

struct RouteThumbnailCacheKey: Hashable, Sendable {
    let routeID: UUID
    let routeType: TrailRouteType
    let routedFactFingerprint: RouteFactFingerprint?
    let pointCount: Int
    let firstPoint: RouteDisplayPointSignature?
    let middlePoint: RouteDisplayPointSignature?
    let lastPoint: RouteDisplayPointSignature?

    nonisolated init(
        routeID: UUID,
        routeType: TrailRouteType,
        routedFactFingerprint: RouteFactFingerprint?,
        pointCount: Int,
        firstPoint: RouteDisplayPointSignature?,
        middlePoint: RouteDisplayPointSignature?,
        lastPoint: RouteDisplayPointSignature?
    ) {
        self.routeID = routeID
        self.routeType = routeType
        self.routedFactFingerprint = routedFactFingerprint
        self.pointCount = pointCount
        self.firstPoint = firstPoint
        self.middlePoint = middlePoint
        self.lastPoint = lastPoint
    }
}

struct RouteDisplayPointSignature: Hashable, Sendable {
    let latitudeBits: UInt64
    let longitudeBits: UInt64
    let elevationBits: UInt64?

    nonisolated init(_ point: Coordinate) {
        latitudeBits = point.latitude.bitPattern
        longitudeBits = point.longitude.bitPattern
        elevationBits = point.elevationMeters?.bitPattern
    }
}

struct RouteCoordinateBounds: Equatable, Sendable {
    let minimumLatitude: Double
    let maximumLatitude: Double
    let minimumLongitude: Double
    let maximumLongitude: Double

    nonisolated init(
        minimumLatitude: Double,
        maximumLatitude: Double,
        minimumLongitude: Double,
        maximumLongitude: Double
    ) {
        self.minimumLatitude = minimumLatitude
        self.maximumLatitude = maximumLatitude
        self.minimumLongitude = minimumLongitude
        self.maximumLongitude = maximumLongitude
    }
}

struct RouteThumbnailGeometry: Equatable, Sendable {
    let normalizedPoints: [NormalizedRoutePoint]
    let mapPoints: [Coordinate]
    let bounds: RouteCoordinateBounds?
    let isLoop: Bool

    nonisolated init(
        normalizedPoints: [NormalizedRoutePoint],
        mapPoints: [Coordinate],
        bounds: RouteCoordinateBounds?,
        isLoop: Bool
    ) {
        self.normalizedPoints = normalizedPoints
        self.mapPoints = mapPoints
        self.bounds = bounds
        self.isLoop = isLoop
    }

    var hasRenderableRoute: Bool {
        normalizedPoints.count >= 2
    }
}

struct NormalizedRoutePoint: Equatable, Sendable {
    let x: Double
    let y: Double

    nonisolated init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    func cgPoint(in size: CGSize) -> CGPoint {
        CGPoint(x: x * size.width, y: y * size.height)
    }
}

@MainActor
final class RouteThumbnailService {
    static let shared = RouteThumbnailService()
    nonisolated static let maximumThumbnailPointCount = 512
    nonisolated static let maximumMapPointCount = 4_096

    private let cacheCapacity: Int
    private var geometryCache: [RouteThumbnailCacheKey: RouteThumbnailGeometry] = [:]
    private var cacheInsertionOrder: [RouteThumbnailCacheKey] = []

    init(cacheCapacity: Int = 48) {
        self.cacheCapacity = max(cacheCapacity, 1)
    }

    var cachedGeometryCount: Int {
        geometryCache.count
    }

    func geometry(for route: TrailRoute) -> RouteThumbnailGeometry {
        let key = Self.cacheKey(for: route)
        if let cached = geometryCache[key] {
            return cached
        }

        let geometry = Self.makeGeometry(for: route)
        if geometryCache.count >= cacheCapacity, let oldestKey = cacheInsertionOrder.first {
            geometryCache.removeValue(forKey: oldestKey)
            cacheInsertionOrder.removeFirst()
        }
        geometryCache[key] = geometry
        cacheInsertionOrder.append(key)
        return geometry
    }

    func clearCache() {
        geometryCache.removeAll()
        cacheInsertionOrder.removeAll()
    }

    nonisolated static func cacheKey(for route: TrailRoute) -> RouteThumbnailCacheKey {
        let middlePoint = route.path.isEmpty ? nil : route.path[route.path.count / 2]
        let routedFactFingerprint: RouteFactFingerprint?
        if case let .routed(provenance) = route.provenance {
            routedFactFingerprint = provenance.factFingerprint
        } else {
            routedFactFingerprint = nil
        }
        return RouteThumbnailCacheKey(
            routeID: route.id,
            routeType: route.routeType,
            routedFactFingerprint: routedFactFingerprint,
            pointCount: route.path.count,
            firstPoint: route.path.first.map(RouteDisplayPointSignature.init),
            middlePoint: middlePoint.map(RouteDisplayPointSignature.init),
            lastPoint: route.path.last.map(RouteDisplayPointSignature.init)
        )
    }

    nonisolated static func makeGeometry(for route: TrailRoute) -> RouteThumbnailGeometry {
        let mapPoints = displayPoints(
            for: route.path,
            maximumCount: maximumMapPointCount
        )
        let thumbnailPoints = displayPoints(
            for: mapPoints,
            maximumCount: maximumThumbnailPointCount
        )
        return RouteThumbnailGeometry(
            normalizedPoints: normalizedPoints(for: thumbnailPoints),
            mapPoints: mapPoints,
            bounds: coordinateBounds(for: mapPoints),
            isLoop: route.routeType == .loop || isClosedLoop(route.path)
        )
    }

    nonisolated static func displayPoints(
        for coordinates: [Coordinate],
        maximumCount: Int
    ) -> [Coordinate] {
        guard maximumCount > 0 else { return [] }
        guard maximumCount >= 2, coordinates.count > maximumCount else {
            return maximumCount >= 2 ? coordinates : Array(coordinates.prefix(maximumCount))
        }

        let interiorBudget = maximumCount - 2
        guard interiorBudget > 0 else {
            return [coordinates[0], coordinates[coordinates.count - 1]]
        }

        let interiorCount = coordinates.count - 2
        let bucketCount = max(1, interiorBudget / 4)
        var selectedIndices = Set<Int>()
        selectedIndices.reserveCapacity(interiorBudget)

        for bucket in 0..<bucketCount {
            let lowerBound = 1 + (interiorCount * bucket / bucketCount)
            let upperBound = 1 + (interiorCount * (bucket + 1) / bucketCount)
            guard lowerBound < upperBound else { continue }

            var minimumLatitudeIndex = lowerBound
            var maximumLatitudeIndex = lowerBound
            var minimumLongitudeIndex = lowerBound
            var maximumLongitudeIndex = lowerBound

            for index in (lowerBound + 1)..<upperBound {
                let point = coordinates[index]
                if point.latitude < coordinates[minimumLatitudeIndex].latitude {
                    minimumLatitudeIndex = index
                }
                if point.latitude > coordinates[maximumLatitudeIndex].latitude {
                    maximumLatitudeIndex = index
                }
                if point.longitude < coordinates[minimumLongitudeIndex].longitude {
                    minimumLongitudeIndex = index
                }
                if point.longitude > coordinates[maximumLongitudeIndex].longitude {
                    maximumLongitudeIndex = index
                }
            }

            selectedIndices.insert(minimumLatitudeIndex)
            selectedIndices.insert(maximumLatitudeIndex)
            selectedIndices.insert(minimumLongitudeIndex)
            selectedIndices.insert(maximumLongitudeIndex)
        }

        var orderedIndices = selectedIndices.sorted()
        if orderedIndices.count > interiorBudget {
            orderedIndices = evenlySampledIndices(orderedIndices, maximumCount: interiorBudget)
        }

        var result: [Coordinate] = []
        result.reserveCapacity(orderedIndices.count + 2)
        result.append(coordinates[0])
        result.append(contentsOf: orderedIndices.map { coordinates[$0] })
        result.append(coordinates[coordinates.count - 1])
        return result
    }

    private nonisolated static func evenlySampledIndices(
        _ indices: [Int],
        maximumCount: Int
    ) -> [Int] {
        guard maximumCount > 0, indices.count > maximumCount else {
            return maximumCount > 0 ? indices : []
        }
        guard maximumCount > 1 else { return [indices[indices.count / 2]] }

        let lastIndex = indices.count - 1
        return (0..<maximumCount).map { sampleIndex in
            let position = Double(sampleIndex) * Double(lastIndex) / Double(maximumCount - 1)
            return indices[Int(position.rounded())]
        }
    }

    nonisolated static func coordinateBounds(
        for coordinates: [Coordinate]
    ) -> RouteCoordinateBounds? {
        guard let first = coordinates.first else { return nil }
        var minimumLatitude = first.latitude
        var maximumLatitude = first.latitude
        var minimumLongitude = first.longitude
        var maximumLongitude = first.longitude

        for point in coordinates.dropFirst() {
            minimumLatitude = min(minimumLatitude, point.latitude)
            maximumLatitude = max(maximumLatitude, point.latitude)
            minimumLongitude = min(minimumLongitude, point.longitude)
            maximumLongitude = max(maximumLongitude, point.longitude)
        }

        return RouteCoordinateBounds(
            minimumLatitude: minimumLatitude,
            maximumLatitude: maximumLatitude,
            minimumLongitude: minimumLongitude,
            maximumLongitude: maximumLongitude
        )
    }

    nonisolated static func normalizedPoints(for coordinates: [Coordinate]) -> [NormalizedRoutePoint] {
        guard coordinates.count >= 2 else { return [] }

        guard let bounds = coordinateBounds(for: coordinates) else { return [] }

        let latitudeRange = max(bounds.maximumLatitude - bounds.minimumLatitude, 0.001)
        let longitudeRange = max(bounds.maximumLongitude - bounds.minimumLongitude, 0.001)

        return coordinates.map { point in
            NormalizedRoutePoint(
                x: (point.longitude - bounds.minimumLongitude) / longitudeRange,
                y: 1 - (point.latitude - bounds.minimumLatitude) / latitudeRange
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
