import Foundation

enum HikingRouteQualityPolicyVersion: String, Codable, Hashable, Sendable {
    case v1 = "hiking-route-quality-v1"
}

/// Versioned, deterministic policy for selecting routed hiking alternatives.
///
/// Every v1 threshold is pre-baseline: it protects an explicit product contract,
/// but has not yet been calibrated from the authorized live-provider baseline or
/// a blind human preference study. Changes require an offline benchmark update
/// and, when authorized, comparison against the unchanged 20-case live harness.
struct HikingRouteQualityPolicy: Hashable, Sendable {
    static let v1 = HikingRouteQualityPolicy(
        version: .v1,
        structuralPolicy: .preBaseline,
        maximumSuggestions: 3,
        maximumCandidatePoolCount: 6,
        minimumStrongEvidenceCoverage: 0.60,
        minimumHighEvidenceCoverage: 0.90,
        easyTargetToleranceRatio: 0.12,
        highQualityTargetToleranceRatio: 0.15,
        maximumMajorRoadRatioWhenExplicitlyAvoided: 0.25,
        maximumKnownHikeRatingForEasyRequest: 1,
        minimumDemandingTechnicalDistanceMeters: 100,
        physicalEffortAscentNormalizationMeters: 1_200,
        requestedDifficultyGapWeight: 0.70,
        physicalEffortAscentWeight: 0.30,
        minimumPathAndTrackRatioForFact: 0.60,
        minimumMajorRoadRatioForFact: 0.01,
        maximumLowRepeatedPathRatioForFact: 0.10,
        objectiveComparisonEpsilon: 0.000_001,
        maximumVerifiedCharacteristicExplanationCount: 2,
        maximumCardExplanationCount: 2,
        maximumDetailExplanationCount: 5
    )

    let version: HikingRouteQualityPolicyVersion
    let structuralPolicy: RouteAlternativeQualityPolicy

    /// Product cap and diversity target. Three choices remain understandable.
    let maximumSuggestions: Int

    /// Bounded enrichment pool. Six lets v1 compare beyond the first three
    /// provider successes while preserving existing request/time limits.
    let maximumCandidatePoolCount: Int

    /// Below 60% coverage, a zero exposure value is treated as mostly unknown,
    /// not as a verified positive route characteristic.
    let minimumStrongEvidenceCoverage: Double

    /// At 90% coverage, explanations may describe evidence as broadly covering
    /// the route. This is a disclosure threshold, not a scientific confidence.
    let minimumHighEvidenceCoverage: Double

    /// Easy requests treat distance alternatives inside the existing 12%
    /// product tolerance as comparable before considering gentler evidence.
    let easyTargetToleranceRatio: Double

    /// Early-stop candidates must be within 15% of supplied distance/time goals.
    let highQualityTargetToleranceRatio: Double

    /// An explicit major-road avoidance request rejects only known, substantial
    /// exposure above 25%, and only with strong road-class coverage.
    let maximumMajorRoadRatioWhenExplicitlyAvoided: Double

    /// Official GraphHopper semantics define 1 as hiking and 2 as
    /// mountain_hiking. v1 only makes the conservative Easy boundary; it does
    /// not invent mappings for Moderate or Challenging user difficulty.
    let maximumKnownHikeRatingForEasyRequest: Int

    /// Ignore isolated rounding/sliver artifacts smaller than 100 routed meters
    /// when applying the technical-difficulty hard rule.
    let minimumDemandingTechnicalDistanceMeters: Double

    /// Total ascent at which the v1 physical-effort ascent component reaches
    /// its normalized maximum. This is a pre-baseline tuning value.
    let physicalEffortAscentNormalizationMeters: Double

    /// Requested difficulty remains the primary component of physical fit;
    /// total ascent provides a smaller independent load component.
    let requestedDifficultyGapWeight: Double
    let physicalEffortAscentWeight: Double

    /// Only a clear majority supports the concise "paths and tracks" fact.
    let minimumPathAndTrackRatioForFact: Double

    /// One percent avoids rendering meaningless rounded zero road exposure.
    let minimumMajorRoadRatioForFact: Double

    /// Ten percent or less supports a factual low-repetition explanation.
    let maximumLowRepeatedPathRatioForFact: Double

    /// Floating-point comparisons inside dominance and deterministic ordering.
    let objectiveComparisonEpsilon: Double

    let maximumVerifiedCharacteristicExplanationCount: Int
    let maximumCardExplanationCount: Int
    let maximumDetailExplanationCount: Int

    func replacingStructuralPolicy(
        _ structuralPolicy: RouteAlternativeQualityPolicy
    ) -> HikingRouteQualityPolicy {
        HikingRouteQualityPolicy(
            version: version,
            structuralPolicy: structuralPolicy,
            maximumSuggestions: maximumSuggestions,
            maximumCandidatePoolCount: maximumCandidatePoolCount,
            minimumStrongEvidenceCoverage: minimumStrongEvidenceCoverage,
            minimumHighEvidenceCoverage: minimumHighEvidenceCoverage,
            easyTargetToleranceRatio: easyTargetToleranceRatio,
            highQualityTargetToleranceRatio: highQualityTargetToleranceRatio,
            maximumMajorRoadRatioWhenExplicitlyAvoided: maximumMajorRoadRatioWhenExplicitlyAvoided,
            maximumKnownHikeRatingForEasyRequest: maximumKnownHikeRatingForEasyRequest,
            minimumDemandingTechnicalDistanceMeters: minimumDemandingTechnicalDistanceMeters,
            physicalEffortAscentNormalizationMeters: physicalEffortAscentNormalizationMeters,
            requestedDifficultyGapWeight: requestedDifficultyGapWeight,
            physicalEffortAscentWeight: physicalEffortAscentWeight,
            minimumPathAndTrackRatioForFact: minimumPathAndTrackRatioForFact,
            minimumMajorRoadRatioForFact: minimumMajorRoadRatioForFact,
            maximumLowRepeatedPathRatioForFact: maximumLowRepeatedPathRatioForFact,
            objectiveComparisonEpsilon: objectiveComparisonEpsilon,
            maximumVerifiedCharacteristicExplanationCount: maximumVerifiedCharacteristicExplanationCount,
            maximumCardExplanationCount: maximumCardExplanationCount,
            maximumDetailExplanationCount: maximumDetailExplanationCount
        )
    }
}

enum RouteQualityRejection: String, Codable, Hashable, Sendable {
    case invalidGeometry = "invalid_geometry"
    case openLoop = "open_loop"
    case excessiveBacktracking = "excessive_backtracking"
    case excessiveSelfOverlap = "excessive_self_overlap"
    case degenerateLoopShape = "degenerate_loop_shape"
    case extremeDetour = "extreme_detour"
    case distanceOutsideEnvelope = "distance_outside_hard_envelope"
    case durationOutsideEnvelope = "duration_outside_hard_envelope"
    case routeTypeMismatch = "route_type_mismatch"
    case activityMismatch = "activity_mismatch"
    case unusableEvidencePayload = "unusable_evidence_payload"
    case knownTechnicalDifficultyAboveEasyRequest = "known_technical_difficulty_above_easy_request"
    case excessiveKnownMajorRoadExposure = "excessive_known_major_road_exposure"
    case nearDuplicateGeometry = "near_duplicate_geometry"

    init(structuralRejection: RouteAlternativeRejection) {
        switch structuralRejection {
        case .invalidGeometry: self = .invalidGeometry
        case .openLoop: self = .openLoop
        case .excessiveBacktracking: self = .excessiveBacktracking
        case .excessiveSelfOverlap: self = .excessiveSelfOverlap
        case .degenerateLoopShape: self = .degenerateLoopShape
        case .extremeDetour: self = .extremeDetour
        case .distanceOutsideEnvelope: self = .distanceOutsideEnvelope
        case .durationOutsideEnvelope: self = .durationOutsideEnvelope
        case .nearDuplicate: self = .nearDuplicateGeometry
        }
    }
}

enum RouteQualityWarning: String, Codable, Hashable, Sendable {
    case physicalEffortHarderThanRequested = "physical_effort_harder_than_requested"
    case technicalDifficultyUnavailable = "technical_difficulty_unavailable"
    case technicalDifficultyCoverageLimited = "technical_difficulty_coverage_limited"
    case surfaceEvidenceUnavailable = "surface_evidence_unavailable"
    case surfaceEvidenceCoverageLimited = "surface_evidence_coverage_limited"
    case roadClassEvidenceUnavailable = "road_class_evidence_unavailable"
    case roadClassEvidenceCoverageLimited = "road_class_evidence_coverage_limited"
    case requestedPreferencesUnverified = "requested_preferences_unverified"
}

struct RouteEligibility: Hashable, Sendable {
    let rejection: RouteQualityRejection?
    let warnings: [RouteQualityWarning]

    var isEligible: Bool { rejection == nil }

    static func eligible(warnings: [RouteQualityWarning] = []) -> RouteEligibility {
        RouteEligibility(rejection: nil, warnings: warnings)
    }

    static func rejected(
        _ rejection: RouteQualityRejection,
        warnings: [RouteQualityWarning] = []
    ) -> RouteEligibility {
        RouteEligibility(rejection: rejection, warnings: warnings)
    }
}

struct RouteQualityObjective: Hashable, Sendable {
    enum Kind: String, CaseIterable, Codable, Hashable, Sendable {
        case distanceDeviation
        case durationDeviation
        case physicalEffortFit
        case technicalDifficulty
        case surfaceSuitability
        case pathAndTrackPreference
        case majorRoadExposure
        case selfBacktracking
        case selfOverlap
        case loopShape
        case pointToPointDetour
        case evidenceConfidence
    }

    let kind: Kind

    /// Normalized loss: lower is preferred. Nil means unavailable/unsupported,
    /// never zero. No aggregate user-facing score is derived from these values.
    let normalizedLoss: Double?
    let evidenceCoverage: Double?
}

enum RouteQualityDominance: String, Codable, Hashable, Sendable {
    case leftDominates
    case rightDominates
    case nonDominated
    case equivalent
}

struct RouteQualityComparison: Hashable, Sendable {
    let leftCandidateKey: String
    let rightCandidateKey: String
    let dominance: RouteQualityDominance
    let materiallyDifferentObjectives: [RouteQualityObjective.Kind]
}

enum RouteQualityExplanationRole: String, Codable, Hashable, Sendable {
    case primaryFit
    case verifiedCharacteristic
    case estimate
    case limitation
}

enum RouteQualityExplanationCode: String, Codable, Hashable, Sendable {
    case distanceFit
    case durationFit
    case physicalEffortEstimate
    case pathsAndTracks
    case majorRoadExposure
    case lowRepeatedPath
    case technicalSections
    case technicalDifficultyUnavailable
    case technicalDifficultyCoverageLimited
    case surfaceEvidenceUnavailable
    case surfaceCoverageLimited
    case roadClassEvidenceUnavailable
    case roadClassCoverageLimited
    case requestedPreferencesUnverified
    case mappedEvidenceUnavailable
}

struct RouteQualityPresentationItem: Identifiable, Hashable, Sendable {
    let role: RouteQualityExplanationRole
    let code: RouteQualityExplanationCode
    let title: String
    let detail: String?
    let symbol: String
    let accessibilityLabel: String

    var id: String {
        "\(role.rawValue)|\(code.rawValue)|\(title)|\(detail ?? "")"
    }
}

struct RouteQualityExplanationSet: Hashable, Sendable {
    let primaryFit: RouteQualityPresentationItem?
    let verifiedCharacteristics: [RouteQualityPresentationItem]
    let estimates: [RouteQualityPresentationItem]
    let limitations: [RouteQualityPresentationItem]

    var allItems: [RouteQualityPresentationItem] {
        [primaryFit].compactMap(\.self) + estimates + verifiedCharacteristics + limitations
    }

    func cardItems(limit: Int) -> [RouteQualityPresentationItem] {
        var items: [RouteQualityPresentationItem] = []
        if let primaryFit { items.append(primaryFit) }
        items.append(contentsOf: verifiedCharacteristics)
        if items.isEmpty { items.append(contentsOf: estimates) }
        if items.count < limit { items.append(contentsOf: limitations) }
        return Array(items.prefix(max(limit, 0)))
    }

    func detailItems(limit: Int) -> [RouteQualityPresentationItem] {
        Array(allItems.prefix(max(limit, 0)))
    }
}

struct RouteQualityTelemetrySummary: Hashable, Sendable {
    let policyVersion: HikingRouteQualityPolicyVersion
    let candidateCount: Int
    let eligibleCount: Int
    let selectedCount: Int
    let rejectionCounts: [String: Int]
    let assessmentDurationMicroseconds: UInt64
}
