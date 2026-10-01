import Foundation
import CryptoKit

/// Mapped candidates beside one accepted route, never booked stops or verified overnight permission.
nonisolated struct RouteStays: Codable, Hashable, Sendable {
    enum State: String, Codable, Sendable { case available, empty, unavailable }
    enum Kind: String, Codable, Sendable {
        case hut = "alpine_hut", wildernessHut = "wilderness_hut", campsite, emergencyShelter = "emergency_shelter"
    }
    struct Candidate: Codable, Hashable, Identifiable, Sendable {
        let id: String
        let name: String
        let category: Kind
        let coordinate: DynamicResearchCoordinate
        let coordinateKind: String
        let source: DynamicResearchStop.Source
        let nameKnown: Bool
        let `operator`: String?
        let website: URL?
        let straightLineDistanceToPathMeters: Int
    }
    let schemaVersion: Int
    let geometryDigest: String
    let checkedAt: String
    let coverage: String
    let maximumOffsetMeters: Int
    let state: State
    let candidates: [Candidate]

    static func unavailable(path: [GeoPoint], now: Date = .now) -> RouteStays {
        RouteStays(schemaVersion: 1, geometryDigest: digest(path: path),
                   checkedAt: ISO8601DateFormatter().string(from: now), coverage: "partial",
                   maximumOffsetMeters: 2000, state: .unavailable, candidates: [])
    }

    static func digest(path: [GeoPoint]) -> String {
        let text = path.map { point in
            [point.longitude, point.latitude].map { String(Int((($0 + 180) * 1e6).rounded())) }.joined(separator: ",")
        }.joined(separator: ";")
        return SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func isStale(at now: Date = .now) -> Bool {
        guard let checked = PlanningEvidenceDate.parse(checkedAt) else { return true }
        return now.timeIntervalSince(checked) > 7 * 86_400 || candidates.contains {
            guard let snapshot = PlanningEvidenceDate.parse($0.source.snapshotAt) else { return true }
            return now.timeIntervalSince(snapshot) > 7 * 86_400
        }
    }

    func validate(path: [GeoPoint], now: Date = .now, requireFresh: Bool = false) throws {
        func reject() throws { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
        guard path.count >= 2, path.count <= 20_000,
              path.allSatisfy({ $0.latitude.isFinite && $0.longitude.isFinite && abs($0.latitude) <= 90 && abs($0.longitude) <= 180 }),
              schemaVersion == 1, geometryDigest == Self.digest(path: path), coverage == "partial",
              maximumOffsetMeters == 2000, candidates.count <= 12,
              Set(candidates.map(\.id)).count == candidates.count,
              (state == .available) == !candidates.isEmpty,
              let checked = PlanningEvidenceDate.parse(checkedAt), checked <= now.addingTimeInterval(300),
              !requireFresh || (now.timeIntervalSince(checked) <= 86_400 && !isStale(at: now)) else { return try reject() }
        for candidate in candidates {
            let source = candidate.source
            guard candidate.coordinate.isValid,
                  PlanningEvidenceDate.validLabel(candidate.name, maximum: 180),
                  candidate.operator.map({ PlanningEvidenceDate.validLabel($0, maximum: 180) }) ?? true,
                  ["mapped_point", "mapped_center"].contains(candidate.coordinateKind),
                  candidate.id.range(of: "^osm:(node|way|relation):[1-9][0-9]*$", options: .regularExpression) != nil,
                  candidate.nameKnown || candidate.name == candidate.id,
                  source.provider == "openstreetmap", source.license == "ODbL-1.0", source.version > 0,
                  source.attribution == "© OpenStreetMap contributors",
                  source.url.absoluteString == "https://www.openstreetmap.org/" + candidate.id.dropFirst(4).replacingOccurrences(of: ":", with: "/"),
                  let snapshot = PlanningEvidenceDate.parse(source.snapshotAt),
                  let retrieved = PlanningEvidenceDate.parse(source.retrievedAt),
                  let edited = PlanningEvidenceDate.parse(source.updatedAt),
                  edited <= snapshot.addingTimeInterval(300), snapshot <= retrieved.addingTimeInterval(300),
                  retrieved <= checked.addingTimeInterval(300),
                  !requireFresh || (now.timeIntervalSince(snapshot) <= 7 * 86_400 && now.timeIntervalSince(retrieved) <= 86_400),
                  (0...maximumOffsetMeters).contains(candidate.straightLineDistanceToPathMeters),
                  abs(Self.distanceToPath(candidate.coordinate, path: path) - Double(candidate.straightLineDistanceToPathMeters)) <= 2 else { return try reject() }
            if let url = candidate.website {
                guard Self.validWebsite(url) else { return try reject() }
            }
        }
    }

    private static func validWebsite(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased(), url.scheme == "https", url.user == nil, url.password == nil,
              url.port == nil, url.fragment == nil, url.absoluteString.count <= 4096,
              host.contains("."), !host.contains(":"), !host.hasPrefix("["),
              host.range(of: "^[0-9.]+$", options: .regularExpression) == nil else { return false }
        return !["localhost", "local", "internal", "invalid", "test", "example", "onion"].contains { host == $0 || host.hasSuffix("." + $0) }
    }

    /// Spherical distance to finite segments; never converts a straight-line offset into walking time.
    static func distanceToPath(_ coordinate: DynamicResearchCoordinate, path: [GeoPoint]) -> Double {
        let rad = Double.pi / 180, radius = 6_371_000.0
        func distance(_ a: DynamicResearchCoordinate, _ b: DynamicResearchCoordinate) -> Double {
            let x = pow(sin((b.latitude-a.latitude)*rad/2), 2) + cos(a.latitude*rad)*cos(b.latitude*rad)*pow(sin((b.longitude-a.longitude)*rad/2), 2)
            return radius * 2 * atan2(sqrt(max(0, x)), sqrt(max(0, 1-x)))
        }
        func bearing(_ a: DynamicResearchCoordinate, _ b: DynamicResearchCoordinate) -> Double {
            let delta = (b.longitude-a.longitude)*rad
            return atan2(sin(delta)*cos(b.latitude*rad), cos(a.latitude*rad)*sin(b.latitude*rad)-sin(a.latitude*rad)*cos(b.latitude*rad)*cos(delta))
        }
        var closest = Double.infinity
        for index in path.indices.dropFirst() {
            let a = DynamicResearchCoordinate(latitude: path[index-1].latitude, longitude: path[index-1].longitude)
            let b = DynamicResearchCoordinate(latitude: path[index].latitude, longitude: path[index].longitude)
            let delta = distance(a, coordinate)/radius, angle = bearing(a, coordinate)-bearing(a,b)
            let along = atan2(sin(delta)*cos(angle), cos(delta))*radius
            let cross = abs(asin(max(-1, min(1, sin(delta)*sin(angle))))*radius)
            closest = min(closest, along >= 0 && along <= distance(a,b) ? cross : min(distance(a,coordinate),distance(b,coordinate)))
        }
        return closest
    }
}
