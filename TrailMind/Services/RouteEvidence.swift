import Foundation

enum RouteEvidenceStatus: String, Codable, Hashable, Sendable {
    case known
    case unavailable
    case unsupported
    case stale
    case malformed
    case rejected
}

enum RouteEvidenceSource: Hashable, Sendable {
    case routedGeometry
    case routedMetric
    case graphHopperPathDetail(String)
    case derived(String)
    case futureOutdoorEvidenceProvider
    case unsupported
}

enum RouteEvidenceConfidence: String, Codable, Hashable, Sendable {
    case high
    case medium
    case low
    case unknown
}

enum RouteEvidenceFreshness: String, Codable, Hashable, Sendable {
    case currentRequest
    case sourceTimestampUnavailable
    case stale
    case notApplicable
}

struct RouteEvidenceMetric<Value: Sendable>: Sendable {
    let value: Value?
    let coverageRatio: Double?
    let source: RouteEvidenceSource
    let confidence: RouteEvidenceConfidence
    let status: RouteEvidenceStatus
    let freshness: RouteEvidenceFreshness

    var isKnown: Bool { status == .known && value != nil }

    func hasStrongCoverage(using policy: HikingRouteQualityPolicy) -> Bool {
        isKnown && (coverageRatio ?? 0) >= policy.minimumStrongEvidenceCoverage
    }

    static func known(
        _ value: Value,
        coverageRatio: Double = 1,
        source: RouteEvidenceSource,
        freshness: RouteEvidenceFreshness = .sourceTimestampUnavailable,
        policy: HikingRouteQualityPolicy
    ) -> RouteEvidenceMetric<Value> {
        guard coverageRatio.isFinite, (0...1).contains(coverageRatio) else {
            return malformed(source: source)
        }
        let confidence: RouteEvidenceConfidence = if coverageRatio >= policy.minimumHighEvidenceCoverage {
            .high
        } else if coverageRatio >= policy.minimumStrongEvidenceCoverage {
            .medium
        } else {
            .low
        }
        return RouteEvidenceMetric(
            value: value,
            coverageRatio: coverageRatio,
            source: source,
            confidence: confidence,
            status: .known,
            freshness: freshness
        )
    }

    static func unavailable(source: RouteEvidenceSource) -> RouteEvidenceMetric<Value> {
        RouteEvidenceMetric(
            value: nil,
            coverageRatio: nil,
            source: source,
            confidence: .unknown,
            status: .unavailable,
            freshness: .notApplicable
        )
    }

    static func unsupported() -> RouteEvidenceMetric<Value> {
        RouteEvidenceMetric(
            value: nil,
            coverageRatio: nil,
            source: .unsupported,
            confidence: .unknown,
            status: .unsupported,
            freshness: .notApplicable
        )
    }

    static func stale(source: RouteEvidenceSource) -> RouteEvidenceMetric<Value> {
        RouteEvidenceMetric(
            value: nil,
            coverageRatio: nil,
            source: source,
            confidence: .unknown,
            status: .stale,
            freshness: .stale
        )
    }

    static func malformed(source: RouteEvidenceSource) -> RouteEvidenceMetric<Value> {
        RouteEvidenceMetric(
            value: nil,
            coverageRatio: nil,
            source: source,
            confidence: .unknown,
            status: .malformed,
            freshness: .notApplicable
        )
    }
}

struct RouteEvidenceCoverage: Hashable, Sendable {
    let surface: Double?
    let roadClass: Double?
    let technicalDifficulty: Double?

    var availableRatios: [Double] {
        [surface, roadClass, technicalDifficulty].compactMap { value in
            guard let value, value.isFinite, (0...1).contains(value) else { return nil }
            return value
        }
    }

    var meanAvailableCoverage: Double? {
        let values = availableRatios
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }
}

struct RouteTechnicalDifficultyEvidence: Hashable, Sendable {
    let maximumKnownHikeRating: Int
    let demandingSectionDistanceMeters: Double
}

struct RouteSurfaceSuitabilityEvidence: Hashable, Sendable {
    let stableSurfaceRatio: Double
    let roughSurfaceRatio: Double
}

struct RouteEvidenceSnapshot: Sendable {
    let distanceKilometers: RouteEvidenceMetric<Double>
    let durationMinutes: RouteEvidenceMetric<Int>
    let ascentMeters: RouteEvidenceMetric<Int>
    let geometry: RouteEvidenceMetric<RouteGeometryQualityAnalysis>
    let pathAndTrackRatio: RouteEvidenceMetric<Double>
    let majorRoadRatio: RouteEvidenceMetric<Double>
    let surfaceSuitability: RouteEvidenceMetric<RouteSurfaceSuitabilityEvidence>
    let technicalDifficulty: RouteEvidenceMetric<RouteTechnicalDifficultyEvidence>
    let officialHikingNetworkRatio: RouteEvidenceMetric<Double>
    let verifiedPointOfInterestCount: RouteEvidenceMetric<Int>
    let accessRestrictions: RouteEvidenceMetric<Bool>
    let maximumSlopePercent: RouteEvidenceMetric<Double>
    let coverage: RouteEvidenceCoverage

    var containsMalformedEvidence: Bool {
        [
            distanceKilometers.status,
            durationMinutes.status,
            ascentMeters.status,
            geometry.status,
            pathAndTrackRatio.status,
            majorRoadRatio.status,
            surfaceSuitability.status,
            technicalDifficulty.status
        ].contains(.malformed)
    }

    static func make(
        route: TrailRoute,
        analysis: RouteGeometryQualityAnalysis,
        policy: HikingRouteQualityPolicy = .v1
    ) -> RouteEvidenceSnapshot {
        let distance = finiteMetric(
            route.distanceKilometers,
            source: .routedMetric,
            policy: policy
        )
        let duration: RouteEvidenceMetric<Int> = route.durationMinutes > 0
            ? .known(route.durationMinutes, source: .routedMetric, policy: policy)
            : .malformed(source: .routedMetric)
        let ascent: RouteEvidenceMetric<Int> = route.elevationGainMeters >= 0
            ? .known(route.elevationGainMeters, source: .routedMetric, policy: policy)
            : .malformed(source: .routedMetric)
        let geometryMetric: RouteEvidenceMetric<RouteGeometryQualityAnalysis> =
            analysis.geometryLengthMeters.isFinite && analysis.geometryLengthMeters > 0
                ? .known(analysis, source: .routedGeometry, policy: policy)
                : .malformed(source: .routedGeometry)

        // Only a provenance fingerprint that still matches the routed facts
        // can promote provider path details into ranking evidence. Demo or
        // subsequently modified routes keep those dimensions unknown.
        let mapped = mappedEvidence(
            route.isVerifiedRoutedResult ? route.verifiedCharacteristics : nil,
            policy: policy
        )
        return RouteEvidenceSnapshot(
            distanceKilometers: distance,
            durationMinutes: duration,
            ascentMeters: ascent,
            geometry: geometryMetric,
            pathAndTrackRatio: mapped.pathAndTrackRatio,
            majorRoadRatio: mapped.majorRoadRatio,
            surfaceSuitability: mapped.surfaceSuitability,
            technicalDifficulty: mapped.technicalDifficulty,
            officialHikingNetworkRatio: .unsupported(),
            verifiedPointOfInterestCount: .unsupported(),
            accessRestrictions: .unsupported(),
            maximumSlopePercent: .unsupported(),
            coverage: mapped.coverage
        )
    }

    /// UI-safe evidence extraction that avoids repeating full geometry analysis
    /// during SwiftUI rendering. Geometry objectives remain selection-time only.
    static func presentationSnapshot(
        route: TrailRoute,
        policy: HikingRouteQualityPolicy = .v1
    ) -> RouteEvidenceSnapshot {
        let unavailableGeometry = RouteEvidenceMetric<RouteGeometryQualityAnalysis>.unavailable(
            source: .routedGeometry
        )
        let mapped = mappedEvidence(route.verifiedCharacteristics, policy: policy)
        return RouteEvidenceSnapshot(
            distanceKilometers: finiteMetric(
                route.distanceKilometers,
                source: .routedMetric,
                policy: policy
            ),
            durationMinutes: route.durationMinutes > 0
                ? .known(route.durationMinutes, source: .routedMetric, policy: policy)
                : .malformed(source: .routedMetric),
            ascentMeters: route.elevationGainMeters >= 0
                ? .known(route.elevationGainMeters, source: .routedMetric, policy: policy)
                : .malformed(source: .routedMetric),
            geometry: unavailableGeometry,
            pathAndTrackRatio: mapped.pathAndTrackRatio,
            majorRoadRatio: mapped.majorRoadRatio,
            surfaceSuitability: mapped.surfaceSuitability,
            technicalDifficulty: mapped.technicalDifficulty,
            officialHikingNetworkRatio: .unsupported(),
            verifiedPointOfInterestCount: .unsupported(),
            accessRestrictions: .unsupported(),
            maximumSlopePercent: .unsupported(),
            coverage: mapped.coverage
        )
    }

    private struct MappedEvidence {
        let pathAndTrackRatio: RouteEvidenceMetric<Double>
        let majorRoadRatio: RouteEvidenceMetric<Double>
        let surfaceSuitability: RouteEvidenceMetric<RouteSurfaceSuitabilityEvidence>
        let technicalDifficulty: RouteEvidenceMetric<RouteTechnicalDifficultyEvidence>
        let coverage: RouteEvidenceCoverage
    }

    private static func mappedEvidence(
        _ characteristics: VerifiedRouteCharacteristics?,
        policy: HikingRouteQualityPolicy
    ) -> MappedEvidence {
        let surfaceSource = RouteEvidenceSource.graphHopperPathDetail("surface")
        let roadSource = RouteEvidenceSource.graphHopperPathDetail("road_class")
        let technicalSource = RouteEvidenceSource.graphHopperPathDetail("hike_rating")
        guard let characteristics else {
            return MappedEvidence(
                pathAndTrackRatio: .unavailable(source: roadSource),
                majorRoadRatio: .unavailable(source: roadSource),
                surfaceSuitability: .unavailable(source: surfaceSource),
                technicalDifficulty: .unavailable(source: technicalSource),
                coverage: RouteEvidenceCoverage(
                    surface: nil,
                    roadClass: nil,
                    technicalDifficulty: nil
                )
            )
        }

        guard evidencePayloadIsWellFormed(characteristics) else {
            return MappedEvidence(
                pathAndTrackRatio: .malformed(source: roadSource),
                majorRoadRatio: .malformed(source: roadSource),
                surfaceSuitability: .malformed(source: surfaceSource),
                technicalDifficulty: .malformed(source: technicalSource),
                coverage: RouteEvidenceCoverage(
                    surface: nil,
                    roadClass: nil,
                    technicalDifficulty: nil
                )
            )
        }

        let routeDistance = characteristics.routeDistanceMeters
        // Provider segment rounding may exceed routed distance by at most the
        // validated 1% tolerance. Coverage remains a ratio in 0...1 for the
        // typed metric rather than turning benign rounding into malformed data.
        let surfaceCoverage = min(characteristics.surfaceCoverageMeters / routeDistance, 1)
        let roadCoverage = min(characteristics.roadClassCoverageMeters / routeDistance, 1)

        let pathDistance = distance(
            for: EvidenceVocabulary.pathAndTrackRoadClasses,
            in: characteristics.roadClassBreakdown
        )
        let majorRoadDistance = distance(
            for: EvidenceVocabulary.majorRoadClasses,
            in: characteristics.roadClassBreakdown
        )
        let stableDistance = distance(
            for: EvidenceVocabulary.stableEasySurfaces,
            in: characteristics.surfaceBreakdown
        )
        let roughDistance = distance(
            for: EvidenceVocabulary.roughSurfaces,
            in: characteristics.surfaceBreakdown
        )

        let pathAndTrack: RouteEvidenceMetric<Double> = characteristics.roadClassCoverageMeters > 0
            ? .known(
                min(pathDistance / routeDistance, 1),
                coverageRatio: roadCoverage,
                source: roadSource,
                policy: policy
            )
            : .unavailable(source: roadSource)
        let majorRoad: RouteEvidenceMetric<Double> = characteristics.roadClassCoverageMeters > 0
            ? .known(
                min(majorRoadDistance / routeDistance, 1),
                coverageRatio: roadCoverage,
                source: roadSource,
                policy: policy
            )
            : .unavailable(source: roadSource)
        let surface: RouteEvidenceMetric<RouteSurfaceSuitabilityEvidence> =
            characteristics.surfaceCoverageMeters > 0
                ? .known(
                    RouteSurfaceSuitabilityEvidence(
                        stableSurfaceRatio: min(stableDistance / routeDistance, 1),
                        roughSurfaceRatio: min(roughDistance / routeDistance, 1)
                    ),
                    coverageRatio: surfaceCoverage,
                    source: surfaceSource,
                    policy: policy
                )
                : .unavailable(source: surfaceSource)

        let technical = technicalEvidence(
            characteristics,
            source: technicalSource,
            policy: policy
        )
        return MappedEvidence(
            pathAndTrackRatio: pathAndTrack,
            majorRoadRatio: majorRoad,
            surfaceSuitability: surface,
            technicalDifficulty: technical.metric,
            coverage: RouteEvidenceCoverage(
                surface: characteristics.surfaceCoverageMeters > 0 ? surfaceCoverage : nil,
                roadClass: characteristics.roadClassCoverageMeters > 0 ? roadCoverage : nil,
                technicalDifficulty: technical.coverage
            )
        )
    }

    private static func technicalEvidence(
        _ characteristics: VerifiedRouteCharacteristics,
        source: RouteEvidenceSource,
        policy: HikingRouteQualityPolicy
    ) -> (metric: RouteEvidenceMetric<RouteTechnicalDifficultyEvidence>, coverage: Double?) {
        var maximumRating: Int?
        var knownDistance = 0.0
        var demandingDistance = 0.0

        for value in characteristics.hikeRatingBreakdown {
            guard let rating = Int(value.value), (0...6).contains(rating) else {
                return (.malformed(source: source), nil)
            }
            // GraphHopper documents zero as missing SAC-scale data. It must not
            // become evidence that a segment is technically easy.
            guard rating > 0 else { continue }
            maximumRating = max(maximumRating ?? rating, rating)
            knownDistance += value.distanceMeters
            if rating > policy.maximumKnownHikeRatingForEasyRequest {
                demandingDistance += value.distanceMeters
            }
        }

        guard let maximumRating, knownDistance > 0 else {
            return (.unavailable(source: source), nil)
        }
        let coverage = min(max(knownDistance / characteristics.routeDistanceMeters, 0), 1)
        return (
            .known(
                RouteTechnicalDifficultyEvidence(
                    maximumKnownHikeRating: maximumRating,
                    demandingSectionDistanceMeters: demandingDistance
                ),
                coverageRatio: coverage,
                source: source,
                policy: policy
            ),
            coverage
        )
    }

    private static func finiteMetric(
        _ value: Double,
        source: RouteEvidenceSource,
        policy: HikingRouteQualityPolicy
    ) -> RouteEvidenceMetric<Double> {
        guard value.isFinite, value > 0 else { return .malformed(source: source) }
        return .known(value, source: source, policy: policy)
    }

    private static func evidencePayloadIsWellFormed(
        _ characteristics: VerifiedRouteCharacteristics
    ) -> Bool {
        let distance = characteristics.routeDistanceMeters
        guard distance.isFinite, distance > 0 else { return false }

        let collections = [
            (characteristics.surfaceBreakdown, characteristics.surfaceCoverageMeters),
            (characteristics.roadClassBreakdown, characteristics.roadClassCoverageMeters),
            (characteristics.hikeRatingBreakdown, characteristics.hikeRatingCoverageMeters)
        ]
        for (values, coverage) in collections {
            guard coverage.isFinite, coverage >= 0, coverage <= distance * 1.01 else {
                return false
            }
            guard values.allSatisfy({
                !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    && $0.distanceMeters.isFinite
                    && $0.distanceMeters >= 0
            }) else { return false }
            let total = values.reduce(0) { $0 + $1.distanceMeters }
            guard total <= coverage * 1.01 + 1 else { return false }
            let coverageTolerance = max(1, coverage * 0.01)
            guard abs(total - coverage) <= coverageTolerance else { return false }
            if coverage == 0, !values.isEmpty { return false }
        }
        return true
    }

    private static func distance(
        for acceptedValues: Set<String>,
        in breakdown: [VerifiedRouteCharacteristicValue]
    ) -> Double {
        breakdown.reduce(into: 0) { total, value in
            if acceptedValues.contains(value.value.lowercased()) {
                total += value.distanceMeters
            }
        }
    }
}

private enum EvidenceVocabulary {
    static let pathAndTrackRoadClasses: Set<String> = ["track", "footway", "path", "steps"]
    static let majorRoadClasses: Set<String> = ["motorway", "trunk", "primary", "secondary"]
    static let stableEasySurfaces: Set<String> = [
        "paved", "asphalt", "concrete", "concrete:lanes", "concrete:plates",
        "paving_stones", "compacted", "fine_gravel", "gravel", "wood"
    ]
    static let roughSurfaces: Set<String> = [
        "rock", "dirt", "earth", "ground", "grass", "mud", "sand",
        "pebblestone", "unhewn_cobblestone", "cobblestone"
    ]
}

struct OutdoorRouteEvidenceQuery: Sendable {
    let routeFingerprint: RouteFactFingerprint?
    let geometry: [Coordinate]
}

struct OutdoorRouteEvidenceSnapshot: Sendable {
    let officialHikingNetworkRatio: RouteEvidenceMetric<Double>
    let verifiedPointOfInterestCount: RouteEvidenceMetric<Int>
    let accessRestrictions: RouteEvidenceMetric<Bool>

    static let unsupported = OutdoorRouteEvidenceSnapshot(
        officialHikingNetworkRatio: .unsupported(),
        verifiedPointOfInterestCount: .unsupported(),
        accessRestrictions: .unsupported()
    )
}

protocol OutdoorRouteEvidenceProviding: Sendable {
    func evidence(for query: OutdoorRouteEvidenceQuery) async throws -> OutdoorRouteEvidenceSnapshot
}

struct NoOpOutdoorRouteEvidenceProvider: OutdoorRouteEvidenceProviding {
    func evidence(for query: OutdoorRouteEvidenceQuery) async throws -> OutdoorRouteEvidenceSnapshot {
        .unsupported
    }
}
