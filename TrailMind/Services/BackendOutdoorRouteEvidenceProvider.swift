import Foundation

struct OutdoorEvidenceTransportLimits: Sendable, Equatable {
    static let standard = OutdoorEvidenceTransportLimits(
        maximumRequestBodyBytes: 128 * 1_024,
        maximumSuccessBodyBytes: 512 * 1_024,
        maximumErrorBodyBytes: 32 * 1_024,
        maximumRequestCoordinates: 1_600,
        maximumSimplificationDeviationMeters: 15,
        maximumMappedPointsOfInterest: 100
    )

    let maximumRequestBodyBytes: Int
    let maximumSuccessBodyBytes: Int
    let maximumErrorBodyBytes: Int
    let maximumRequestCoordinates: Int
    let maximumSimplificationDeviationMeters: Double
    let maximumMappedPointsOfInterest: Int
}

struct BackendOutdoorEvidenceRequest: Encodable, Sendable {
    struct Point: Encodable, Sendable {
        let latitude: Double
        let longitude: Double
    }

    let schemaVersion: Int
    let routeFingerprint: String
    let geometry: [Point]
    let corridorWidthMeters: Int?

    init(query: OutdoorRouteEvidenceQuery, limits: OutdoorEvidenceTransportLimits) throws {
        guard let fingerprint = query.routeFingerprint?.rawValue,
              Self.isValidFingerprint(fingerprint)
        else { throw BackendOutdoorEvidenceProviderFailure.rejected }
        let simplified = try OutdoorEvidenceGeometrySimplifier.simplify(
            query.geometry,
            maximumCount: limits.maximumRequestCoordinates,
            maximumDeviationMeters: limits.maximumSimplificationDeviationMeters
        )
        schemaVersion = 1
        routeFingerprint = fingerprint
        geometry = simplified.map { Point(latitude: $0.latitude, longitude: $0.longitude) }
        corridorWidthMeters = query.corridorWidthMeters
    }

    private static func isValidFingerprint(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && value.unicodeScalars.allSatisfy { scalar in
            CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-")
                .contains(scalar)
        }
    }
}

struct BackendOutdoorRouteEvidenceProvider: OutdoorRouteEvidenceProviding, Sendable {
    private static let weightedRequestCost = 4

    private let baseURL: URL?
    private let session: URLSession
    private let authorizer: any RouteSessionAuthorizing
    private let limits: OutdoorEvidenceTransportLimits

    init(
        baseURL: URL? = TrailMindBackendConfiguration.baseURL(),
        session: URLSession = .shared,
        authorizer: (any RouteSessionAuthorizing)? = nil,
        limits: OutdoorEvidenceTransportLimits = .standard
    ) {
        self.baseURL = baseURL
        self.session = session
        self.authorizer = authorizer ?? TrailMindBackendSecurity.makeSessionAuthorizer(baseURL: baseURL)
        self.limits = limits
    }

    func evidence(for query: OutdoorRouteEvidenceQuery) async throws -> OutdoorRouteEvidenceSnapshot {
        guard baseURL != nil else { return .unsupported }
        do {
            return try await perform(query, mayRefresh: true)
        } catch BackendOutdoorEvidenceProviderFailure.refreshSession {
            do {
                return try await perform(query, mayRefresh: false)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                return Self.snapshot(for: error)
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            return Self.snapshot(for: error)
        }
    }

    private func perform(
        _ query: OutdoorRouteEvidenceQuery,
        mayRefresh: Bool
    ) async throws -> OutdoorRouteEvidenceSnapshot {
        guard let baseURL,
              let endpoint = URL(string: "api/outdoor-evidence/corridor", relativeTo: baseURL)?.absoluteURL
        else { throw BackendOutdoorEvidenceProviderFailure.unsupported }
        let body: Data
        do {
            body = try JSONEncoder().encode(BackendOutdoorEvidenceRequest(query: query, limits: limits))
        } catch let error as BackendOutdoorEvidenceProviderFailure {
            throw error
        } catch {
            throw BackendOutdoorEvidenceProviderFailure.rejected
        }
        guard body.count <= limits.maximumRequestBodyBytes else {
            throw BackendOutdoorEvidenceProviderFailure.rejected
        }
        let authorization = try await authorizer.authorization(cost: Self.weightedRequestCost)
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            "TrailMindRouteSession \(authorization.token)",
            forHTTPHeaderField: "Authorization"
        )
        request.setValue(authorization.requestID.uuidString, forHTTPHeaderField: "X-TrailMind-Request-ID")
        request.httpBody = body

        do {
            let transport = BoundedOutdoorEvidenceHTTPTransport(session: session, limits: limits)
            let (data, response) = try await transport.data(for: request)
            guard let response = response as? HTTPURLResponse else {
                throw BackendOutdoorEvidenceProviderFailure.malformed
            }
            guard (200..<300).contains(response.statusCode) else {
                let envelope = try? JSONDecoder().decode(OutdoorEvidenceErrorEnvelope.self, from: data)
                if mayRefresh, Self.isRefreshableSessionError(envelope?.error.code) {
                    await authorizer.invalidate(token: authorization.token)
                    throw BackendOutdoorEvidenceProviderFailure.refreshSession
                }
                throw Self.failure(statusCode: response.statusCode, code: envelope?.error.code)
            }
            try Task.checkCancellation()
            try Self.validateTopLevelKeys(data)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let decoded = try decoder.decode(OutdoorEvidenceResponseV2.self, from: data)
            return try decoded.snapshot(
                expectedFingerprint: query.routeFingerprint?.rawValue,
                expectedCorridorWidthMeters: query.corridorWidthMeters ?? 100,
                limits: limits
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch let failure as BackendOutdoorEvidenceProviderFailure {
            throw failure
        } catch RouteTransportValidationError.responseTooLarge {
            throw BackendOutdoorEvidenceProviderFailure.rejected
        } catch let error as URLError {
            if error.code == .cancelled, Task.isCancelled { throw CancellationError() }
            throw BackendOutdoorEvidenceProviderFailure.unavailable
        } catch {
            throw BackendOutdoorEvidenceProviderFailure.malformed
        }
    }

    private static func snapshot(for error: Error) -> OutdoorRouteEvidenceSnapshot {
        switch error {
        case BackendOutdoorEvidenceProviderFailure.unsupported:
            return .unsupported
        case BackendOutdoorEvidenceProviderFailure.rejected:
            return .statusSnapshot(.rejected)
        case BackendOutdoorEvidenceProviderFailure.malformed:
            return .statusSnapshot(.malformed)
        default:
            return .statusSnapshot(.unavailable)
        }
    }

    private static func failure(statusCode: Int, code: String?) -> BackendOutdoorEvidenceProviderFailure {
        switch code {
        case "request_too_large", "invalid_request", "invalid_coordinates", "evidence_rejected":
            .rejected
        case "route_session_expired", "route_session_exhausted", "route_session_invalid",
             "app_attest_invalid", "app_attest_environment_mismatch", "app_attest_counter_replayed",
             "app_attest_not_registered", "request_replayed":
            .rejected
        case "evidence_timed_out", "evidence_unavailable", "evidence_rate_limited",
             "authorization_unavailable", "response_too_large", "request_cancelled":
            .unavailable
        default:
            statusCode >= 400 && statusCode < 500 ? .rejected : .unavailable
        }
    }

    private static func isRefreshableSessionError(_ code: String?) -> Bool {
        code == "route_session_expired" || code == "route_session_exhausted" ||
            code == "route_session_invalid"
    }

    private static func validateTopLevelKeys(_ data: Data) throws {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BackendOutdoorEvidenceProviderFailure.malformed
        }
        let allowed = Set([
            "schemaVersion", "routeFingerprint", "evidenceStatus", "regions",
            "overallRegionalCoverageRatio",
            "osmAttribution", "attributeCoverage", "mappedHikingRouteCoverageRatio",
            "highwayLengthBreakdown", "surfaceLengthBreakdown",
            "trailVisibilityLengthBreakdown", "sacScaleLengthBreakdown",
            "maximumKnownSacScale", "explicitAccessRestrictions", "mappedPoiCounts",
            "mappedPois", "warnings"
        ])
        guard object.keys.allSatisfy(allowed.contains) else {
            throw BackendOutdoorEvidenceProviderFailure.malformed
        }
        func dictionary(
            _ value: Any?,
            allowedKeys: Set<String>,
            nullable: Bool = false
        ) throws -> [String: Any]? {
            if value is NSNull, nullable { return nil }
            guard let value = value as? [String: Any],
                  value.keys.allSatisfy(allowedKeys.contains)
            else { throw BackendOutdoorEvidenceProviderFailure.malformed }
            return value
        }
        func dictionaries(_ value: Any?, allowedKeys: Set<String>) throws -> [[String: Any]] {
            guard let values = value as? [[String: Any]],
                  values.allSatisfy({ $0.keys.allSatisfy(allowedKeys.contains) })
            else { throw BackendOutdoorEvidenceProviderFailure.malformed }
            return values
        }

        for region in try dictionaries(
            object["regions"],
            allowedKeys: [
                "id", "name", "coverageStatus", "routeCoverageRatio",
                "evidenceStatus", "dataset"
            ]
        ) {
            _ = try dictionary(
                region["dataset"],
                allowedKeys: [
                    "importId", "sourceDataset", "sourceIdentifier", "sourceDataTimestamp",
                    "importedTimestamp", "freshnessStatus"
                ],
                nullable: true
            )
        }
        _ = try dictionary(
            object["osmAttribution"],
            allowedKeys: ["notice", "license", "url"]
        )
        _ = try dictionary(
            object["attributeCoverage"],
            allowedKeys: ["highway", "surface", "trailVisibility", "sacScale", "explicitAccess"]
        )
        let breakdownKeys: Set<String> = ["value", "lengthMeters"]
        for key in [
            "highwayLengthBreakdown", "surfaceLengthBreakdown",
            "trailVisibilityLengthBreakdown", "sacScaleLengthBreakdown"
        ] {
            _ = try dictionaries(object[key], allowedKeys: breakdownKeys)
        }
        let identityKeys: Set<String> = ["osmType", "osmId"]
        for restriction in try dictionaries(
            object["explicitAccessRestrictions"],
            allowedKeys: [
                "sourceIdentity", "access", "foot", "conditional", "seasonal", "permitRequired"
            ]
        ) {
            _ = try dictionary(restriction["sourceIdentity"], allowedKeys: identityKeys)
        }
        if !(object["mappedPoiCounts"] is NSNull) {
            _ = try dictionary(
                object["mappedPoiCounts"],
                allowedKeys: Set(OutdoorEvidenceCategory.allCases.map(\.rawValue))
            )
        }
        for poi in try dictionaries(
            object["mappedPois"],
            allowedKeys: [
                "sourceIdentity", "category", "name", "coordinate",
                "distanceFromRouteMeters", "provenance"
            ]
        ) {
            _ = try dictionary(poi["sourceIdentity"], allowedKeys: identityKeys)
            _ = try dictionary(poi["coordinate"], allowedKeys: ["latitude", "longitude"])
            _ = try dictionary(
                poi["provenance"],
                allowedKeys: [
                    "regionId", "importId", "sourceDataset", "sourceVersion", "sourceTimestamp"
                ]
            )
        }
    }
}

enum OutdoorRouteEvidenceProviderFactory {
    static func makeDefault(
        bundle: Bundle = .main
    ) -> any OutdoorRouteEvidenceProviding {
        guard TrailMindBackendConfiguration.outdoorEvidenceEnabled(bundle: bundle),
              let baseURL = TrailMindBackendConfiguration.baseURL(bundle: bundle)
        else {
            return NoOpOutdoorRouteEvidenceProvider()
        }
        return BackendOutdoorRouteEvidenceProvider(baseURL: baseURL)
    }
}

struct OutdoorEvidencePostRoutingCandidate: Sendable {
    let suggestionID: UUID
    let query: OutdoorRouteEvidenceQuery
}

struct OutdoorEvidencePostRoutingCollector: Sendable {
    private let provider: any OutdoorRouteEvidenceProviding

    nonisolated init(provider: any OutdoorRouteEvidenceProviding) {
        self.provider = provider
    }

    nonisolated func collect(
        _ candidates: [OutdoorEvidencePostRoutingCandidate]
    ) async -> [UUID: OutdoorRouteEvidenceSnapshot] {
        do {
            return try await collectThrowing(candidates)
        } catch is CancellationError {
            return [:]
        } catch {
            return [:]
        }
    }

    private nonisolated func collectThrowing(
        _ candidates: [OutdoorEvidencePostRoutingCandidate]
    ) async throws -> [UUID: OutdoorRouteEvidenceSnapshot] {
        try await withThrowingTaskGroup(
            of: (UUID, OutdoorRouteEvidenceSnapshot).self,
            returning: [UUID: OutdoorRouteEvidenceSnapshot].self
        ) { group in
            for item in candidates {
                group.addTask {
                    do {
                        return (item.suggestionID, try await provider.evidence(for: item.query))
                    } catch is CancellationError {
                        throw CancellationError()
                    } catch {
                        return (
                            item.suggestionID,
                            .statusSnapshot(.unavailable, warningCodes: ["serviceUnavailable"])
                        )
                    }
                }
            }
            var output: [UUID: OutdoorRouteEvidenceSnapshot] = [:]
            for try await (suggestionID, snapshot) in group {
                output[suggestionID] = snapshot
            }
            return output
        }
    }
}

enum OutdoorEvidenceGeometrySimplifier {
    static func simplify(
        _ points: [Coordinate],
        maximumCount: Int,
        maximumDeviationMeters: Double
    ) throws -> [Coordinate] {
        guard maximumCount >= 2, maximumDeviationMeters.isFinite,
              maximumDeviationMeters >= 0, points.count >= 2,
              points.allSatisfy({ point in
                  point.latitude.isFinite && point.longitude.isFinite &&
                      (-90...90).contains(point.latitude) && (-180...180).contains(point.longitude)
              })
        else { throw BackendOutdoorEvidenceProviderFailure.rejected }
        guard points.count > maximumCount else { return points }

        let atMaximum = douglasPeucker(points, toleranceMeters: maximumDeviationMeters)
        guard atMaximum.count <= maximumCount else {
            throw BackendOutdoorEvidenceProviderFailure.rejected
        }
        var lower = 0.0
        var upper = maximumDeviationMeters
        var best = atMaximum
        for _ in 0..<24 {
            let tolerance = (lower + upper) / 2
            let candidate = douglasPeucker(points, toleranceMeters: tolerance)
            if candidate.count <= maximumCount {
                best = candidate
                upper = tolerance
            } else {
                lower = tolerance
            }
        }
        guard best.first == points.first, best.last == points.last else {
            throw BackendOutdoorEvidenceProviderFailure.rejected
        }
        return best
    }

    private static func douglasPeucker(
        _ points: [Coordinate],
        toleranceMeters: Double
    ) -> [Coordinate] {
        guard points.count > 2 else { return points }
        var keep = Array(repeating: false, count: points.count)
        keep[0] = true
        keep[points.count - 1] = true
        var segments = [(0, points.count - 1)]
        while let (start, end) = segments.popLast() {
            guard end > start + 1 else { continue }
            var maximumDistance = -1.0
            var maximumIndex = start
            for index in (start + 1)..<end {
                let distance = perpendicularDistanceMeters(
                    points[index],
                    start: points[start],
                    end: points[end]
                )
                if distance > maximumDistance {
                    maximumDistance = distance
                    maximumIndex = index
                }
            }
            if maximumDistance > toleranceMeters {
                keep[maximumIndex] = true
                segments.append((start, maximumIndex))
                segments.append((maximumIndex, end))
            }
        }
        return zip(points, keep).compactMap { point, shouldKeep in shouldKeep ? point : nil }
    }

    private static func perpendicularDistanceMeters(
        _ point: Coordinate,
        start: Coordinate,
        end: Coordinate
    ) -> Double {
        let referenceLatitude = (start.latitude + end.latitude + point.latitude) / 3
        let longitudeScale = cos(referenceLatitude * .pi / 180)
        let metersPerDegree = 111_320.0
        let startX = start.longitude * longitudeScale * metersPerDegree
        let startY = start.latitude * metersPerDegree
        let endX = end.longitude * longitudeScale * metersPerDegree
        let endY = end.latitude * metersPerDegree
        let pointX = point.longitude * longitudeScale * metersPerDegree
        let pointY = point.latitude * metersPerDegree
        let deltaX = endX - startX
        let deltaY = endY - startY
        let squaredLength = deltaX * deltaX + deltaY * deltaY
        guard squaredLength > 0 else { return hypot(pointX - startX, pointY - startY) }
        let projection = min(max(
            ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / squaredLength,
            0
        ), 1)
        return hypot(pointX - (startX + projection * deltaX), pointY - (startY + projection * deltaY))
    }
}

private struct BoundedOutdoorEvidenceHTTPTransport: Sendable {
    let session: URLSession
    let limits: OutdoorEvidenceTransportLimits

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try Task.checkCancellation()
        let (bytes, response) = try await session.bytes(for: request)
        let maximumBytes = if let response = response as? HTTPURLResponse,
                              !(200..<300).contains(response.statusCode) {
            limits.maximumErrorBodyBytes
        } else {
            limits.maximumSuccessBodyBytes
        }
        guard response.expectedContentLength <= Int64(maximumBytes) else {
            throw RouteTransportValidationError.responseTooLarge
        }
        var data = Data()
        if response.expectedContentLength > 0 {
            data.reserveCapacity(Int(response.expectedContentLength))
        }
        for try await byte in bytes {
            guard data.count < maximumBytes else {
                throw RouteTransportValidationError.responseTooLarge
            }
            data.append(byte)
            if data.count.isMultiple(of: 8 * 1_024) { try Task.checkCancellation() }
        }
        try Task.checkCancellation()
        return (data, response)
    }
}

private enum BackendOutdoorEvidenceProviderFailure: Error {
    case refreshSession
    case unsupported
    case unavailable
    case malformed
    case rejected
}

private struct OutdoorEvidenceErrorEnvelope: Decodable {
    struct Body: Decodable { let code: String }
    let error: Body
}

private struct OutdoorEvidenceResponseV2: Decodable {
    private static let highwayValues = Set([
        "path", "footway", "track", "steps", "bridleway", "cycleway", "pedestrian",
        "service", "unclassified", "residential", "living_street", "tertiary",
        "secondary", "primary", "trunk", "motorway", "road", "other"
    ])
    private static let surfaceValues = Set([
        "paved", "asphalt", "concrete", "concrete:lanes", "concrete:plates",
        "paving_stones", "sett", "cobblestone", "unhewn_cobblestone", "compacted",
        "fine_gravel", "gravel", "pebblestone", "rock", "dirt", "earth", "ground",
        "grass", "mud", "sand", "wood", "metal", "other"
    ])
    private static let trailVisibilityValues = Set([
        "excellent", "good", "intermediate", "bad", "horrible", "no"
    ])
    private static let sacScaleOrder = [
        "strolling", "hiking", "mountain_hiking", "demanding_mountain_hiking",
        "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking"
    ]
    private static let sacScaleValues = Set(sacScaleOrder)
    private static let accessValues = Set([
        "yes", "no", "private", "permissive", "designated", "destination", "customers",
        "delivery", "agricultural", "forestry", "permit", "use_sidepath"
    ])

    struct Dataset: Decodable {
        let importId: String
        let sourceDataset: String
        let sourceIdentifier: String
        let sourceDataTimestamp: Date?
        let importedTimestamp: Date
        let freshnessStatus: String
    }
    struct Region: Decodable {
        let id: String
        let name: String
        let coverageStatus: String
        let routeCoverageRatio: Double
        let evidenceStatus: String
        let dataset: Dataset?
    }
    struct Attribution: Decodable {
        let notice: String
        let license: String
        let url: URL
    }
    struct Coverage: Decodable {
        let highway: Double?
        let surface: Double?
        let trailVisibility: Double?
        let sacScale: Double?
        let explicitAccess: Double?
    }
    struct Breakdown: Decodable {
        let value: String
        let lengthMeters: Double
    }
    struct Identity: Decodable {
        let osmType: String
        let osmId: String
    }
    struct Restriction: Decodable {
        let sourceIdentity: Identity
        let access: String?
        let foot: String?
        let conditional: Bool
        let seasonal: Bool
        let permitRequired: Bool
    }
    struct CoordinateDTO: Decodable {
        let latitude: Double
        let longitude: Double
    }
    struct POIProvenance: Decodable {
        let regionId: String
        let importId: String
        let sourceDataset: String
        let sourceVersion: Int?
        let sourceTimestamp: Date?
    }
    struct POI: Decodable {
        let sourceIdentity: Identity
        let category: OutdoorEvidenceCategory
        let name: String?
        let coordinate: CoordinateDTO
        let distanceFromRouteMeters: Double
        let provenance: POIProvenance
    }
    private struct ValidatedRegion {
        let state: OutdoorEvidenceRegionState
        let dataset: Dataset?
    }

    let schemaVersion: Int
    let routeFingerprint: String
    let evidenceStatus: String
    let regions: [Region]
    let overallRegionalCoverageRatio: Double?
    let osmAttribution: Attribution
    let attributeCoverage: Coverage
    let mappedHikingRouteCoverageRatio: Double?
    let highwayLengthBreakdown: [Breakdown]
    let surfaceLengthBreakdown: [Breakdown]
    let trailVisibilityLengthBreakdown: [Breakdown]
    let sacScaleLengthBreakdown: [Breakdown]
    let maximumKnownSacScale: String?
    let explicitAccessRestrictions: [Restriction]
    let mappedPoiCounts: [String: Int]?
    let mappedPois: [POI]
    let warnings: [String]

    func snapshot(
        expectedFingerprint: String?,
        expectedCorridorWidthMeters: Int,
        limits: OutdoorEvidenceTransportLimits
    ) throws -> OutdoorRouteEvidenceSnapshot {
        guard schemaVersion == 2, routeFingerprint == expectedFingerprint else { throw malformed() }
        let warningAllowlist = Set([
            "partialRegionalCoverage", "overlappingRegionalCoverage", "datasetStale",
            "sourceTimestampUnavailable", "osmMappedEvidenceOnly", "missingTagsRemainUnknown",
            "routeOutsideSupportedRegion", "datasetUnavailable", "serviceUnavailable"
        ])
        guard warnings.allSatisfy(warningAllowlist.contains),
              Set(warnings).count == warnings.count,
              osmAttribution.notice == "© OpenStreetMap contributors",
              osmAttribution.license == "ODbL 1.0",
              osmAttribution.url.scheme == "https",
              osmAttribution.url.host == "www.openstreetmap.org"
        else { throw malformed() }

        let validated = try validatedRegions()
        let states = validated.map(\.state)
        let overallCoverage = try optionalRatio(overallRegionalCoverageRatio)

        if evidenceStatus == "unsupported" {
            guard states.isEmpty, overallCoverage == 0,
                  warnings == ["routeOutsideSupportedRegion"]
            else { throw malformed() }
            try validateEmptyEvidence()
            return .statusSnapshot(
                .unsupported,
                overallRegionalCoverageRatio: 0,
                warningCodes: warnings
            )
        }

        if evidenceStatus == "unavailable" {
            guard overallCoverage == nil || overallCoverage! > 0 else { throw malformed() }
            if states.isEmpty {
                guard overallCoverage == nil, warnings == ["serviceUnavailable"] else { throw malformed() }
            } else {
                try validateRegionalWarnings(states: states, overallCoverage: overallCoverage!)
                guard states.contains(where: { $0.evidenceStatus == .unavailable }) else { throw malformed() }
            }
            try validateEmptyEvidence()
            return .statusSnapshot(
                .unavailable,
                regionStates: states,
                overallRegionalCoverageRatio: overallCoverage,
                warningCodes: warnings
            )
        }

        guard !states.isEmpty, let overallCoverage, overallCoverage > 0 else { throw malformed() }
        try validateRegionalWarnings(states: states, overallCoverage: overallCoverage)
        let expectedOverallStatus: RouteEvidenceStatus = states.contains(where: {
            $0.evidenceStatus == .unavailable
        }) ? .unavailable : states.contains(where: {
            $0.evidenceStatus == .stale
        }) ? .stale : .known
        let metricStatus: RouteEvidenceStatus = switch evidenceStatus {
        case "known": .known
        case "stale": .stale
        default: throw malformed()
        }
        guard expectedOverallStatus == metricStatus,
              warnings.contains("osmMappedEvidenceOnly"),
              warnings.contains("missingTagsRemainUnknown")
        else { throw malformed() }

        let coverage = OutdoorEvidenceAttributeCoverage(
            highway: try requiredRatio(attributeCoverage.highway),
            surface: try requiredRatio(attributeCoverage.surface),
            trailVisibility: try requiredRatio(attributeCoverage.trailVisibility),
            sacScale: try requiredRatio(attributeCoverage.sacScale),
            explicitAccess: try requiredRatio(attributeCoverage.explicitAccess)
        )
        let hikingRatio = try requiredRatio(mappedHikingRouteCoverageRatio)
        let categories = try mappedCategories()
        let datasetsByImport = Dictionary(uniqueKeysWithValues: validated.compactMap { item in
            item.dataset.map { ($0.importId, (item.state.coverage.regionID, $0)) }
        })
        let pois = try mappedPoints(
            limits: limits,
            datasetsByImport: datasetsByImport,
            maximumDistanceMeters: Double(expectedCorridorWidthMeters) + 1
        )
        let restrictions = try mappedRestrictions()
        guard pois.allSatisfy({ (categories[$0.category] ?? 0) > 0 }) else { throw malformed() }
        for category in OutdoorEvidenceCategory.allCases {
            guard pois.count(where: { $0.category == category }) <= (categories[category] ?? 0) else {
                throw malformed()
            }
        }
        if coverage.explicitAccess == 0, !restrictions.isEmpty { throw malformed() }

        let highways = try breakdown(highwayLengthBreakdown, allowlist: Self.highwayValues)
        let surfaces = try breakdown(surfaceLengthBreakdown, allowlist: Self.surfaceValues)
        let visibility = try breakdown(
            trailVisibilityLengthBreakdown,
            allowlist: Self.trailVisibilityValues
        )
        let sacScales = try breakdown(sacScaleLengthBreakdown, allowlist: Self.sacScaleValues)
        let maximumSacScale = try validatedMaximumSacScale()
        let derivedMaximumSacScale = sacScales
            .filter { $0.lengthMeters > 0 }
            .compactMap { item in Self.sacScaleOrder.firstIndex(of: item.value).map { ($0, item.value) } }
            .max { $0.0 < $1.0 }?.1
        guard maximumSacScale == derivedMaximumSacScale else { throw malformed() }

        let provenances = states.compactMap(\.provenance)
        guard provenances.count == states.count else { throw malformed() }
        let source: RouteEvidenceSource = if provenances.count == 1, let provenance = provenances.first {
            .osmRegionalDataset(regionID: provenance.regionID, importID: provenance.importID)
        } else {
            .osmRegionalDatasets(
                regionIDs: provenances.map(\.regionID),
                importIDs: provenances.map(\.importID)
            )
        }
        let totalPOIs = try categories.values.reduce(0) { total, count in
            let (sum, overflow) = total.addingReportingOverflow(count)
            guard !overflow else { throw malformed() }
            return sum
        }
        let hikingMetric: RouteEvidenceMetric<Double>
        let poiMetric: RouteEvidenceMetric<Int>
        let accessMetric: RouteEvidenceMetric<Int>
        if metricStatus == .known {
            hikingMetric = .known(
                hikingRatio,
                coverageRatio: coverage.highway ?? overallCoverage,
                source: source,
                freshness: .sourceCurrent,
                policy: .v1
            )
            poiMetric = .known(
                totalPOIs,
                coverageRatio: overallCoverage,
                source: source,
                freshness: .sourceCurrent,
                policy: .v1
            )
            if let accessCoverage = coverage.explicitAccess, accessCoverage > 0 {
                accessMetric = .known(
                    restrictions.count,
                    coverageRatio: accessCoverage,
                    source: source,
                    freshness: .sourceCurrent,
                    policy: .v1
                )
            } else {
                accessMetric = .unavailable(source: source)
            }
        } else {
            hikingMetric = .stale(source: source)
            poiMetric = .stale(source: source)
            accessMetric = .stale(source: source)
        }

        return OutdoorRouteEvidenceSnapshot(
            regionStates: states,
            overallRegionalCoverageRatio: overallCoverage,
            attributeCoverage: coverage,
            mappedHikingRouteRatio: hikingMetric,
            mappedPointOfInterestCount: poiMetric,
            explicitAccessRestrictionCount: accessMetric,
            highwayLengthBreakdown: highways,
            surfaceLengthBreakdown: surfaces,
            trailVisibilityLengthBreakdown: visibility,
            sacScaleLengthBreakdown: sacScales,
            maximumKnownSacScale: maximumSacScale,
            mappedPointOfInterestCounts: categories,
            mappedPointsOfInterest: pois,
            explicitAccessRestrictions: restrictions,
            warningCodes: warnings
        )
    }

    private func validatedRegions() throws -> [ValidatedRegion] {
        guard regions.count <= 100 else { throw malformed() }
        var ids = Set<String>()
        var imports = Set<String>()
        var output: [ValidatedRegion] = []
        for region in regions {
            let ratio = try validRatio(region.routeCoverageRatio)
            guard !region.id.isEmpty, region.id.utf8.count <= 80,
                  !region.name.isEmpty, region.name.utf8.count <= 160,
                  ids.insert(region.id).inserted,
                  ["full", "partial"].contains(region.coverageStatus),
                  (region.coverageStatus == "full") == (ratio >= 0.999999)
            else { throw malformed() }
            let coverage = OutdoorEvidenceRegionCoverage(
                regionID: region.id,
                regionName: region.name,
                isPartial: region.coverageStatus == "partial",
                routeCoverageRatio: ratio
            )
            let status: RouteEvidenceStatus = switch region.evidenceStatus {
            case "known": .known
            case "stale": .stale
            case "unavailable": .unavailable
            default: throw malformed()
            }
            let provenance: OutdoorEvidenceProvenance?
            if let dataset = region.dataset {
                guard !dataset.importId.isEmpty, dataset.importId.utf8.count <= 80,
                      imports.insert(dataset.importId).inserted,
                      !dataset.sourceDataset.isEmpty, dataset.sourceDataset.utf8.count <= 160,
                      !dataset.sourceIdentifier.isEmpty, dataset.sourceIdentifier.utf8.count <= 500
                else { throw malformed() }
                let freshness: RouteEvidenceFreshness = switch dataset.freshnessStatus {
                case "current": .sourceCurrent
                case "stale": .stale
                case "sourceTimestampUnavailable": .sourceTimestampUnavailable
                default: throw malformed()
                }
                guard (freshness == .sourceTimestampUnavailable) == (dataset.sourceDataTimestamp == nil),
                      (status == .known && freshness == .sourceCurrent) ||
                      (status == .stale && freshness == .stale) ||
                      (status == .unavailable && freshness == .sourceTimestampUnavailable)
                else { throw malformed() }
                provenance = OutdoorEvidenceProvenance(
                    regionID: region.id,
                    importID: dataset.importId,
                    sourceDataset: dataset.sourceDataset,
                    sourceIdentifier: dataset.sourceIdentifier,
                    sourceDataTimestamp: dataset.sourceDataTimestamp,
                    importedTimestamp: dataset.importedTimestamp,
                    freshness: freshness,
                    regionalCoverageRatio: ratio,
                    osmAttribution: osmAttribution.notice,
                    osmLicenseURL: osmAttribution.url
                )
            } else {
                guard status == .unavailable else { throw malformed() }
                provenance = nil
            }
            output.append(ValidatedRegion(
                state: OutdoorEvidenceRegionState(
                    coverage: coverage,
                    evidenceStatus: status,
                    provenance: provenance
                ),
                dataset: region.dataset
            ))
        }
        for pair in zip(output, output.dropFirst()) {
            let left = pair.0.state.coverage
            let right = pair.1.state.coverage
            guard left.routeCoverageRatio > right.routeCoverageRatio ||
                    (left.routeCoverageRatio == right.routeCoverageRatio && left.regionID < right.regionID)
            else { throw malformed() }
        }
        return output
    }

    private func validateRegionalWarnings(
        states: [OutdoorEvidenceRegionState],
        overallCoverage: Double
    ) throws {
        guard states.allSatisfy({ $0.coverage.routeCoverageRatio <= overallCoverage + 0.000001 }) else {
            throw malformed()
        }
        let partial = overallCoverage < 0.999999
        let clearlyOverlapping = states.reduce(0) { $0 + $1.coverage.routeCoverageRatio } >
            overallCoverage + 0.02
        let stale = states.contains { $0.evidenceStatus == .stale }
        let missingDataset = states.contains { $0.provenance == nil }
        let missingTimestamp = states.contains { $0.provenance?.freshness == .sourceTimestampUnavailable }
        guard warnings.contains("partialRegionalCoverage") == partial,
              (!clearlyOverlapping || warnings.contains("overlappingRegionalCoverage")),
              warnings.contains("datasetStale") == stale,
              warnings.contains("datasetUnavailable") == missingDataset,
              warnings.contains("sourceTimestampUnavailable") == missingTimestamp
        else { throw malformed() }
    }

    private func validateEmptyEvidence() throws {
        guard attributeCoverage.highway == nil,
              attributeCoverage.surface == nil,
              attributeCoverage.trailVisibility == nil,
              attributeCoverage.sacScale == nil,
              attributeCoverage.explicitAccess == nil,
              mappedHikingRouteCoverageRatio == nil,
              highwayLengthBreakdown.isEmpty,
              surfaceLengthBreakdown.isEmpty,
              trailVisibilityLengthBreakdown.isEmpty,
              sacScaleLengthBreakdown.isEmpty,
              maximumKnownSacScale == nil,
              explicitAccessRestrictions.isEmpty,
              mappedPoiCounts == nil,
              mappedPois.isEmpty
        else { throw malformed() }
    }

    private func mappedCategories() throws -> [OutdoorEvidenceCategory: Int] {
        guard let mappedPoiCounts else { throw malformed() }
        var output: [OutdoorEvidenceCategory: Int] = [:]
        for (key, count) in mappedPoiCounts {
            guard let category = OutdoorEvidenceCategory(rawValue: key),
                  count >= 0, count <= 1_000_000
            else { throw malformed() }
            output[category] = count
        }
        guard Set(output.keys) == Set(OutdoorEvidenceCategory.allCases) else { throw malformed() }
        return output
    }

    private func mappedPoints(
        limits: OutdoorEvidenceTransportLimits,
        datasetsByImport: [String: (regionID: String, dataset: Dataset)],
        maximumDistanceMeters: Double
    ) throws -> [MappedOutdoorPointOfInterest] {
        guard mappedPois.count <= limits.maximumMappedPointsOfInterest else { throw malformed() }
        var identities = Set<String>()
        return try mappedPois.map { poi in
            let identity = try sourceIdentity(poi.sourceIdentity)
            guard identities.insert("\(identity.osmType):\(identity.osmID)").inserted,
                  poi.coordinate.latitude.isFinite, (-90...90).contains(poi.coordinate.latitude),
                  poi.coordinate.longitude.isFinite, (-180...180).contains(poi.coordinate.longitude),
                  poi.distanceFromRouteMeters.isFinite, poi.distanceFromRouteMeters >= 0,
                  poi.distanceFromRouteMeters <= maximumDistanceMeters,
                  let expected = datasetsByImport[poi.provenance.importId],
                  poi.provenance.regionId == expected.regionID,
                  poi.provenance.sourceDataset == expected.dataset.sourceDataset,
                  poi.provenance.sourceVersion.map({ $0 > 0 }) ?? true,
                  poi.name.map({ !$0.isEmpty && $0.utf8.count <= 160 }) ?? true
            else { throw malformed() }
            return MappedOutdoorPointOfInterest(
                sourceIdentity: identity,
                category: poi.category,
                name: poi.name,
                coordinate: Coordinate(
                    latitude: poi.coordinate.latitude,
                    longitude: poi.coordinate.longitude
                ),
                distanceFromRouteMeters: poi.distanceFromRouteMeters,
                regionID: expected.regionID,
                importID: expected.dataset.importId,
                sourceDataset: expected.dataset.sourceDataset,
                sourceVersion: poi.provenance.sourceVersion,
                sourceTimestamp: poi.provenance.sourceTimestamp
            )
        }
    }

    private func mappedRestrictions() throws -> [ExplicitAccessRestrictionEvidence] {
        guard explicitAccessRestrictions.count <= 25 else { throw malformed() }
        var identities = Set<String>()
        return try explicitAccessRestrictions.map { item in
            let identity = try sourceIdentity(item.sourceIdentity)
            guard identity.osmType == "way", identities.insert(identity.osmID).inserted,
                  item.access.map(Self.accessValues.contains) ?? true,
                  item.foot.map(Self.accessValues.contains) ?? true,
                  Self.isRestriction(item)
            else { throw malformed() }
            return ExplicitAccessRestrictionEvidence(
                sourceIdentity: identity,
                access: item.access,
                foot: item.foot,
                isConditional: item.conditional,
                isSeasonal: item.seasonal,
                requiresPermit: item.permitRequired
            )
        }
    }

    private func sourceIdentity(_ identity: Identity) throws -> OutdoorEvidenceSourceIdentity {
        guard ["node", "way", "relation"].contains(identity.osmType),
              !identity.osmId.isEmpty,
              identity.osmId.unicodeScalars.allSatisfy({ (48...57).contains($0.value) }),
              identity.osmId.utf8.count <= 32
        else { throw malformed() }
        return OutdoorEvidenceSourceIdentity(osmType: identity.osmType, osmID: identity.osmId)
    }

    private func breakdown(
        _ values: [Breakdown],
        allowlist: Set<String>
    ) throws -> [OutdoorEvidenceLengthBreakdown] {
        guard values.count <= allowlist.count else { throw malformed() }
        var seen = Set<String>()
        let result = try values.map { item in
            guard allowlist.contains(item.value), item.value.utf8.count <= 80,
                  seen.insert(item.value).inserted,
                  item.lengthMeters.isFinite, item.lengthMeters >= 0,
                  item.lengthMeters <= 200_001
            else { throw malformed() }
            return OutdoorEvidenceLengthBreakdown(value: item.value, lengthMeters: item.lengthMeters)
        }
        guard result.reduce(0, { $0 + $1.lengthMeters }) <= 200_001 else { throw malformed() }
        return result
    }

    private func validatedMaximumSacScale() throws -> String? {
        guard let maximumKnownSacScale else { return nil }
        guard Self.sacScaleValues.contains(maximumKnownSacScale) else { throw malformed() }
        return maximumKnownSacScale
    }

    private static func isRestriction(_ item: Restriction) -> Bool {
        let restrictive = Set([
            "no", "private", "customers", "delivery", "agricultural", "forestry",
            "permit", "use_sidepath"
        ])
        return item.access.map(restrictive.contains) == true ||
            item.foot.map(restrictive.contains) == true || item.conditional ||
            item.seasonal || item.permitRequired
    }

    private func requiredRatio(_ value: Double?) throws -> Double {
        guard let value else { throw malformed() }
        return try validRatio(value)
    }

    private func optionalRatio(_ value: Double?) throws -> Double? {
        guard let value else { return nil }
        return try validRatio(value)
    }

    private func validRatio(_ value: Double) throws -> Double {
        guard value.isFinite, (0...1).contains(value) else { throw malformed() }
        return value
    }

    private func malformed() -> BackendOutdoorEvidenceProviderFailure { .malformed }
}
