import Foundation

/// Proximity to finite minor great-circle arcs, with monotonic progress through
/// the returned route. This verifies geometry only, never access or a POI visit.
nonisolated enum RouteStopGeometry {
    static func firstPosition(of coordinate: DynamicResearchCoordinate, on path: [GeoPoint],
                              after minimumPosition: Double = 0,
                              maximumDistanceMeters: Double = 100) -> Double? {
        guard coordinate.isValid, path.count >= 2,
              path.allSatisfy({ DynamicResearchCoordinate(latitude: $0.latitude, longitude: $0.longitude).isValid }),
              minimumPosition.isFinite, minimumPosition >= 0, minimumPosition <= Double(path.count - 1),
              maximumDistanceMeters.isFinite, maximumDistanceMeters >= 0 else { return nil }
        let point = Vector(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let firstSegment = min(Int(minimumPosition), path.count - 2)
        for index in firstSegment..<(path.count - 1) {
            let start = Vector(latitude: path[index].latitude, longitude: path[index].longitude)
            let end = Vector(latitude: path[index + 1].latitude, longitude: path[index + 1].longitude)
            let cross = start.cross(end)
            let length = atan2(cross.length, start.dot(end))
            let lowerFraction = max(0, minimumPosition - Double(index))
            let fraction: Double
            let closest: Vector
            if cross.length < 1e-12 {
                // Coincident vertices are valid; antipodal vertices do not
                // determine a unique arc, so cannot establish proximity.
                guard start.dot(end) > 0 else { continue }
                fraction = lowerFraction
                closest = start
            } else {
                let tangent = cross.scaled(by: 1 / cross.length).cross(start)
                let along = atan2(point.dot(tangent), point.dot(start))
                let lower = length * lowerFraction
                var angles = [lower, length]
                if along >= lower && along <= length { angles.append(along) }
                let candidates = angles.map { angle in
                    (angle, start.scaled(by: cos(angle)).adding(tangent.scaled(by: sin(angle))))
                }
                // Endpoints also matter when atan2 wraps outside the minor arc.
                let best = candidates.max { point.dot($0.1) < point.dot($1.1) }!
                fraction = best.0 / length
                closest = best.1
            }
            let distance = 6_371_000 * atan2(point.cross(closest).length, point.dot(closest))
            if distance <= maximumDistanceMeters {
                return Double(index) + fraction
            }
        }
        return nil
    }

    private struct Vector {
        let x: Double
        let y: Double
        let z: Double

        init(latitude: Double, longitude: Double) {
            let lat = latitude * .pi / 180
            let lon = longitude * .pi / 180
            self.init(x: cos(lat) * cos(lon), y: cos(lat) * sin(lon), z: sin(lat))
        }

        init(x: Double, y: Double, z: Double) { self.x = x; self.y = y; self.z = z }
        var length: Double { sqrt(dot(self)) }
        func dot(_ other: Self) -> Double { x * other.x + y * other.y + z * other.z }
        func cross(_ other: Self) -> Self {
            Self(x: y * other.z - z * other.y, y: z * other.x - x * other.z, z: x * other.y - y * other.x)
        }
        func scaled(by value: Double) -> Self { Self(x: x * value, y: y * value, z: z * value) }
        func adding(_ other: Self) -> Self { Self(x: x + other.x, y: y + other.y, z: z + other.z) }
    }
}
