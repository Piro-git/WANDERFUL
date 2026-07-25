import CoreFoundation
import CryptoKit
import Foundation

enum ResearchGuidedRoutedEnvelopeStateV1: String, Hashable, Sendable {
    case routed
    case partial
    case noViableRoute = "no_viable_route"
    case unsupported
}

enum ResearchGuidedAttemptStateV1: String, Hashable, Sendable {
    case routed
    case failed
    case unsupported
}

enum ResearchVerificationCodeV1: String, CaseIterable, Hashable, Sendable {
    case realRoutingRequired = "real_routing_required"
    case connectivityRequired = "connectivity_required"
    case actualDistanceRequired = "actual_distance_required"
    case actualDurationRequired = "actual_duration_required"
    case actualElevationRequired = "actual_elevation_required"
    case publicAccessRequired = "public_access_required"
    case accessRestrictionRequired = "access_restriction_required"
    case closureStatusRequired = "closure_status_required"
    case trailDifficultyRequired = "trail_difficulty_required"
    case trailVisibilityRequired = "trail_visibility_required"
    case exposureRequired = "exposure_required"
    case steepClimbRequired = "steep_climb_required"
    case openingStatusRequired = "opening_status_required"
    case seasonalOperationRequired = "seasonal_operation_required"
    case overnightPermissionRequired = "overnight_permission_required"
    case bookingRequired = "booking_required"
    case waterStatusRequired = "water_status_required"
    case currentConditionsRequired = "current_conditions_required"
    case transportRequired = "transport_required"
    case mobilitySuitabilityRequired = "mobility_suitability_required"
    case childSuitabilityRequired = "child_suitability_required"
    case beginnerSuitabilityRequired = "beginner_suitability_required"
    case endpointCoordinateRequired = "endpoint_coordinate_required"
    case officialStatusRequired = "official_status_required"
    case legalSleepRequired = "legal_sleep_required"
}

enum ResearchKnownLimitationV1: String, CaseIterable, Hashable, Sendable {
    case accessUnverified = "access_unverified"
    case accessRestrictionUnverified = "access_restriction_unverified"
    case openingUnverified = "opening_unverified"
    case overnightLegalityUnverified = "overnight_legality_unverified"
    case waterAvailabilityUnverified = "water_availability_unverified"
    case currentConditionsUnavailable = "current_conditions_unavailable"
    case sourceStale = "source_stale"
    case sourceTimestampUnavailable = "source_timestamp_unavailable"
    case conflictingAuthoritativeEvidence = "conflicting_authoritative_evidence"
    case mappedPresenceOnly = "mapped_presence_only"
    case terrainDerivedOnly = "terrain_derived_only"
    case partialRegionalCoverage = "partial_regional_coverage"
    case officialStatusUnverified = "official_status_unverified"
    case routeConnectionUnverified = "route_connection_unverified"
    case insufficientEvidence = "insufficient_evidence"
    case requiresRealRouting = "requires_real_routing"
    case endpointUnavailable = "endpoint_unavailable"
    case lowerBoundExceedsTarget = "lower_bound_exceeds_target"
    case trailDifficultyUnverified = "trail_difficulty_unverified"
    case exposureUnverified = "exposure_unverified"
    case bookabilityUnverified = "bookability_unverified"
    case seasonalStatusUnverified = "seasonal_status_unverified"
    case transportUnverified = "transport_unverified"
    case mobilitySuitabilityUnverified = "mobility_suitability_unverified"
    case childSuitabilityUnverified = "child_suitability_unverified"
    case beginnerSuitabilityUnverified = "beginner_suitability_unverified"
}

enum ResearchCandidateRoleV1: String, Hashable, Sendable {
    case mustHave = "must_have"
    case preferred
    case facilityCandidate = "facility_candidate"
    case overnightCandidate = "overnight_candidate"
}

enum ResearchHighlightCategoryV1: String, Hashable, Sendable {
    case viewpoint
    case waterfall
    case peak
    case lake
    case alpineHut = "alpine_hut"
    case wildernessHut = "wilderness_hut"
    case landmark
}

enum ResearchSelectionReasonV1: String, Hashable, Sendable {
    case requiredExperience = "required_experience"
    case preferredExperience = "preferred_experience"
    case requiredFacility = "required_facility"
    case overnightRequest = "overnight_request"
    case availableResearchCandidate = "available_research_candidate"
    case lowerPreliminaryDistance = "lower_preliminary_distance"
    case mappedNetworkContext = "mapped_network_context"
}

enum ResearchMappedSourceBasisV1: String, Hashable, Sendable {
    case mapped
    case official
    case mixed
}

struct ResearchSelectedWaypointV1: Hashable, Sendable {
    let entityID: UUID
    let coordinate: Coordinate
    let highlightCategory: ResearchHighlightCategoryV1
    let role: ResearchCandidateRoleV1
    let evidenceClaimIDs: [UUID]
    let selectionReasons: [ResearchSelectionReasonV1]
    let requiredVerification: [ResearchVerificationCodeV1]
    let knownLimitations: [ResearchKnownLimitationV1]
}

struct ResearchMappedNetworkCandidateV1: Hashable, Sendable {
    let entityID: UUID
    let sourceBasis: ResearchMappedSourceBasisV1
    let evidenceClaimIDs: [UUID]
    let requiredVerification: [ResearchVerificationCodeV1]
    let knownLimitations: [ResearchKnownLimitationV1]
}

struct ResearchRouteProvenanceV1: Hashable, Sendable {
    let proposalID: String
    let lineageID: String
    let strategy: String
    let activity: ActivityType
    let routeType: TrailRouteType
    let selectedWaypoints: [ResearchSelectedWaypointV1]
    let mappedNetworkCandidates: [ResearchMappedNetworkCandidateV1]
    let evidenceClaimIDs: [UUID]
    let requiredVerification: [ResearchVerificationCodeV1]
    let knownLimitations: [ResearchKnownLimitationV1]
    let sourceCandidatePlanPolicyVersion: String
}

enum ResearchWaypointVisitRoleV1: String, Hashable, Sendable {
    case anchor
    case via
    case returnAnchor = "return_anchor"
}

struct ResearchWaypointVisitV1: Hashable, Sendable {
    let waypointIndex: Int
    let role: ResearchWaypointVisitRoleV1
    let entityID: UUID?
    let requestedCoordinate: Coordinate
    let snappedCoordinate: Coordinate?
    let snapDistanceMeters: Double?
    let withinVisitTolerance: Bool

    /// This is deliberately narrower than "visited": it only reports whether
    /// GraphHopper snapping stayed inside the documented bounded tolerance.
    var isResearchWaypointReached: Bool {
        role == .via && withinVisitTolerance
    }
}

struct ResearchGuidedRouteAlternativeV1: Hashable {
    let attemptID: String
    let routeResultID: String
    let suggestion: RouteSuggestion
    let researchProvenance: ResearchRouteProvenanceV1
    let waypointVisits: [ResearchWaypointVisitV1]

    func replacingSuggestion(
        _ suggestion: RouteSuggestion
    ) -> ResearchGuidedRouteAlternativeV1 {
        ResearchGuidedRouteAlternativeV1(
            attemptID: attemptID,
            routeResultID: routeResultID,
            suggestion: suggestion,
            researchProvenance: researchProvenance,
            waypointVisits: waypointVisits
        )
    }
}

struct ResearchGuidedRouteSelectionV1 {
    let state: ResearchGuidedRoutedEnvelopeStateV1
    let sourceEnvelopeState: ResearchGuidedRoutedEnvelopeStateV1
    let alternatives: [ResearchGuidedRouteAlternativeV1]
    let rejectionCounts: [String: Int]
    let remainingLimitations: [String]
}

enum ResearchGuidedRoutingContractErrorV1: Error, Equatable, Sendable {
    case invalidEnvelope
    case envelopeTooLarge
}

struct ResearchGuidedRoutingContractAdapterV1 {
    private let limits: RouteTransportLimits

    init(limits: RouteTransportLimits = .standard) {
        self.limits = limits
    }

    func decodeConvertAndSelect(
        _ data: Data
    ) throws -> ResearchGuidedRouteSelectionV1 {
        let envelope = try ResearchGuidedRoutedEnvelopeValidatorV1(
            routeLimits: limits
        ).validate(data)
        guard
            envelope.state == .routed || envelope.state == .partial
        else {
            return ResearchGuidedRouteSelectionV1(
                state: envelope.state,
                sourceEnvelopeState: envelope.state,
                alternatives: [],
                rejectionCounts: [:],
                remainingLimitations: envelope.remainingLimitations
            )
        }

        let planningRequest = envelope.intent.planningRequest
        guard let anchor = envelope.intent.anchorCoordinate else {
            throw ResearchGuidedRoutingContractErrorV1.invalidEnvelope
        }

        var contexts: [ConvertedContext] = []
        var conversionRejectionCount = 0
        for attempt in envelope.attempts where attempt.state == .routed {
            for result in attempt.routeResults {
                do {
                    let responseData = try JSONSerialization.data(
                        withJSONObject: [
                            "provider": "graphhopper",
                            "paths": [result.pathObject]
                        ],
                        options: [.sortedKeys]
                    )
                    let route = try GraphHopperClient.verifiedBackendRoute(
                        fromSinglePathResponse: responseData,
                        requestedStart: anchor,
                        requestedEnd: anchor,
                        planningRequest: planningRequest,
                        limits: limits
                    )
                    guard route.isVerifiedRoutedResult else {
                        conversionRejectionCount += 1
                        continue
                    }
                    contexts.append(ConvertedContext(
                        attemptID: attempt.attemptID,
                        routeResultID: result.routeResultID,
                        suggestion: RouteSuggestion(
                            route: route,
                            explanation: route.whyItMatches
                        ),
                        provenance: attempt.provenance,
                        waypointVisits: result.waypointVisits
                    ))
                } catch {
                    conversionRejectionCount += 1
                }
            }
        }

        let qualitySelection = RouteAlternativeQuality.select(
            contexts.map(\.suggestion),
            request: planningRequest
        )
        var rejectionCounts = qualitySelection.rejectionCounts
        if conversionRejectionCount > 0 {
            rejectionCounts["contract_route_conversion_rejected"] =
                conversionRejectionCount
        }
        let alternatives: [ResearchGuidedRouteAlternativeV1] =
            qualitySelection.selected.compactMap {
                selected -> ResearchGuidedRouteAlternativeV1? in
            guard contexts.indices.contains(selected.providerIndex) else {
                return nil
            }
            let context = contexts[selected.providerIndex]
            return ResearchGuidedRouteAlternativeV1(
                attemptID: context.attemptID,
                routeResultID: context.routeResultID,
                suggestion: selected.suggestion,
                researchProvenance: context.provenance,
                waypointVisits: context.waypointVisits
            )
        }
        let state: ResearchGuidedRoutedEnvelopeStateV1
        if alternatives.isEmpty {
            state = .noViableRoute
        } else if envelope.state == .partial {
            state = .partial
        } else {
            state = .routed
        }
        return ResearchGuidedRouteSelectionV1(
            state: state,
            sourceEnvelopeState: envelope.state,
            alternatives: alternatives,
            rejectionCounts: rejectionCounts,
            remainingLimitations: envelope.remainingLimitations
        )
    }
}

private extension ResearchGuidedRoutingContractAdapterV1 {
    struct ConvertedContext {
        let attemptID: String
        let routeResultID: String
        let suggestion: RouteSuggestion
        let provenance: ResearchRouteProvenanceV1
        let waypointVisits: [ResearchWaypointVisitV1]
    }
}

private struct ResearchGuidedRoutedEnvelopeValidatorV1 {
    private static let maximumEnvelopeBytes = 8 * 1_024 * 1_024
    private static let candidatePlanPolicyVersion =
        "research-guided-route-candidates-v1"
    private static let adapterPolicyVersion =
        "research-guided-routing-adapter-v1"
    private static let waypointVisitToleranceMeters = 100.0
    private static let maximumAttempts = 6
    private static let maximumPathsPerAttempt = 3
    private static let maximumSelectedWaypoints = 5
    private static let maximumMappedCandidates = 8
    private static let maximumEvidenceIDs = 64
    private static let maximumVerificationCodes = 32
    private static let maximumKnownLimitations = 32
    private static let adapterLimitations = [
        "snapping_unavailable",
        "snapping_exceeds_tolerance",
        "provider_failure",
        "route_type_unsupported",
        "candidate_plan_unsupported",
        "candidate_plan_not_routable"
    ]
    private static let candidateLimitations =
        ResearchKnownLimitationV1.allCases.map(\.rawValue)
    private static let attemptFailureCodes: Set<String> = [
        "route_not_found",
        "route_timed_out",
        "routing_unavailable",
        "routing_rate_limited",
        "invalid_provider_response",
        "invalid_route_request",
        "unsupported_point_to_point",
        "unsupported_out_and_back",
        "unsupported_candidate_plan"
    ]

    let routeLimits: RouteTransportLimits

    func validate(_ data: Data) throws -> ValidatedEnvelope {
        guard data.count <= Self.maximumEnvelopeBytes else {
            throw ResearchGuidedRoutingContractErrorV1.envelopeTooLarge
        }
        let root: Any
        do {
            root = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw ResearchGuidedRoutingContractErrorV1.invalidEnvelope
        }
        do {
            return try validateRoot(root)
        } catch ResearchGuidedRoutingContractErrorV1.envelopeTooLarge {
            throw ResearchGuidedRoutingContractErrorV1.envelopeTooLarge
        } catch {
            throw ResearchGuidedRoutingContractErrorV1.invalidEnvelope
        }
    }

    private func validateRoot(_ input: Any) throws -> ValidatedEnvelope {
        let value = try object(
            input,
            required: [
                "schemaVersion",
                "state",
                "normalizedIntent",
                "candidatePlanPolicyVersion",
                "routingAdapterPolicyVersion",
                "attempts",
                "remainingLimitations"
            ]
        )
        guard try integer(value["schemaVersion"], in: 1...1) == 1 else {
            throw invalid()
        }
        let state = try enumValue(
            value["state"],
            as: ResearchGuidedRoutedEnvelopeStateV1.self
        )
        guard
            try string(value["candidatePlanPolicyVersion"]) ==
                Self.candidatePlanPolicyVersion,
            try string(value["routingAdapterPolicyVersion"]) ==
                Self.adapterPolicyVersion
        else {
            throw invalid()
        }
        let intent = try validateIntent(value["normalizedIntent"])
        let rawAttempts = try array(
            value["attempts"],
            count: 0...Self.maximumAttempts
        )
        let attempts = try rawAttempts.enumerated().map { index, raw in
            try validateAttempt(
                raw,
                expectedIndex: index,
                intent: intent
            )
        }
        try requireUnique(attempts.map(\.attemptID))
        try requireUnique(attempts.map(\.provenance.proposalID))
        guard derivedState(attempts: attempts, declared: state) == state else {
            throw invalid()
        }
        let remainingLimitations = try uniqueStrings(
            value["remainingLimitations"],
            allowed: Set(
                Self.candidateLimitations + Self.adapterLimitations
            ),
            maximum: Self.maximumKnownLimitations +
                Self.adapterLimitations.count
        )
        guard
            remainingLimitations ==
                derivedLimitations(attempts: attempts, state: state)
        else {
            throw invalid()
        }
        if attempts.contains(where: { $0.state == .routed }) {
            guard
                intent.anchorCoordinate != nil,
                intent.routeType == "loop"
            else {
                throw invalid()
            }
        }
        return ValidatedEnvelope(
            state: state,
            intent: intent,
            attempts: attempts,
            remainingLimitations: remainingLimitations
        )
    }

    private func validateIntent(_ input: Any?) throws -> ValidatedIntent {
        let value = try object(
            input,
            required: [
                "schemaVersion",
                "activity",
                "geographicAnchor",
                "routeType",
                "distanceRangeKm",
                "durationRangeMinutes",
                "maximumElevationGainMeters",
                "maximumTechnicalDifficulty",
                "mustHaveExperiences",
                "preferredExperiences",
                "avoidedExperiences",
                "requiredFacilities",
                "groupContext",
                "dateOrSeason",
                "overnightRequirements",
                "transportRequirements",
                "unresolvedClarificationQuestions"
            ]
        )
        guard try integer(value["schemaVersion"], in: 1...1) == 1 else {
            throw invalid()
        }
        let activity = try string(
            value["activity"],
            allowed: ["hiking", "trail_running", "biking"]
        )
        let routeType = try string(
            value["routeType"],
            allowed: ["loop", "point_to_point", "out_and_back"]
        )
        let anchor = try validateAnchor(value["geographicAnchor"])
        let distanceRange = try nullableRange(
            value["distanceRangeKm"],
            minimum: 0.1,
            maximum: 500
        )
        let durationRange = try nullableIntegerRange(
            value["durationRangeMinutes"],
            minimum: 15,
            maximum: 10_080
        )
        try nullableInteger(
            value["maximumElevationGainMeters"],
            range: 0...20_000
        )
        try nullableString(
            value["maximumTechnicalDifficulty"],
            allowed: [
                "strolling",
                "hiking",
                "mountain_hiking",
                "demanding_mountain_hiking",
                "alpine_hiking",
                "demanding_alpine_hiking",
                "difficult_alpine_hiking"
            ]
        )
        try validateMustHave(value["mustHaveExperiences"])
        try validateCanonicalIntentStringArray(
            value["preferredExperiences"],
            allowed: [
                "viewpoint",
                "waterfall",
                "peak",
                "lake",
                "forest",
                "quiet_trails",
                "official_hiking_route",
                "alpine_hut",
                "wilderness_hut",
                "landmark"
            ],
            maximum: 16
        )
        let avoided = try validateCanonicalIntentStringArray(
            value["avoidedExperiences"],
            allowed: [
                "exposed_trails",
                "technical_terrain",
                "major_roads",
                "steep_climbs",
                "repeated_path",
                "crowds",
                "unpaved_surface"
            ],
            maximum: 16
        )
        try validateCanonicalIntentStringArray(
            value["requiredFacilities"],
            allowed: [
                "drinking_water",
                "lunch_hut",
                "emergency_shelter",
                "public_transport",
                "official_campsite",
                "designated_bivouac",
                "toilets"
            ],
            maximum: 16
        )
        try validateGroupContext(value["groupContext"])
        try validateDateOrSeason(value["dateOrSeason"])
        try validateOvernight(value["overnightRequirements"])
        try validateTransport(value["transportRequirements"])
        let clarifications = try validateClarifications(
            value["unresolvedClarificationQuestions"]
        )
        if anchor.coordinate == nil {
            guard clarifications.contains(where: {
                $0.code == "location_required" ||
                    $0.code == "start_required"
            }) else {
                throw invalid()
            }
        }
        return ValidatedIntent(
            activity: activity,
            routeType: routeType,
            anchorName: anchor.name,
            anchorCoordinate: anchor.coordinate,
            targetDistanceKm: distanceRange.map {
                ($0.lowerBound + $0.upperBound) / 2
            },
            targetDurationMinutes: durationRange.map {
                ($0.lowerBound + $0.upperBound) / 2
            },
            avoidedExperiences: avoided
        )
    }

    private func validateAnchor(
        _ input: Any?
    ) throws -> (name: String?, coordinate: Coordinate?) {
        let value = try object(
            input,
            required: ["state"],
            optional: [
                "name",
                "coordinate",
                "regionEntityId",
                "requirementCode"
            ]
        )
        let state = try string(
            value["state"],
            allowed: ["resolved", "unresolved"]
        )
        if state == "resolved" {
            try requireExactKeys(
                value,
                ["state", "name", "coordinate", "regionEntityId"]
            )
            let name = try string(value["name"], maximum: 160)
            let coordinate = try coordinate(value["coordinate"])
            if !(value["regionEntityId"] is NSNull) {
                _ = try uuid(value["regionEntityId"])
            }
            return (name, coordinate)
        }
        try requireExactKeys(value, ["state", "requirementCode"])
        _ = try string(
            value["requirementCode"],
            allowed: [
                "location_required",
                "start_required",
                "destination_required"
            ]
        )
        return (nil, nil)
    }

    private func validateMustHave(_ input: Any?) throws {
        let values = try array(input, count: 0...16)
        var identities: [(experience: String, minimumCount: Int)] = []
        for item in values {
            let value = try object(
                item,
                required: ["experience", "minimumCount"]
            )
            let experience = try string(
                value["experience"],
                allowed: [
                    "viewpoint",
                    "waterfall",
                    "peak",
                    "lake",
                    "forest",
                    "quiet_trails",
                    "official_hiking_route",
                    "alpine_hut",
                    "wilderness_hut",
                    "landmark"
                ]
            )
            let minimumCount = try integer(
                value["minimumCount"],
                in: 1...8
            )
            identities.append((experience, minimumCount))
        }
        try requireUnique(identities.map(\.experience))
        let canonical = identities.sorted {
            $0.experience == $1.experience
                ? $0.minimumCount < $1.minimumCount
                : $0.experience < $1.experience
        }
        guard identities.elementsEqual(
            canonical,
            by: {
                $0.experience == $1.experience &&
                    $0.minimumCount == $1.minimumCount
            }
        ) else {
            throw invalid()
        }
    }

    @discardableResult
    private func validateCanonicalIntentStringArray(
        _ input: Any?,
        allowed: Set<String>,
        maximum: Int
    ) throws -> [String] {
        let values = try array(input, count: 0...maximum).map {
            try string($0, allowed: allowed)
        }
        try requireUnique(values)
        guard values == values.sorted() else { throw invalid() }
        return values
    }

    private func validateGroupContext(_ input: Any?) throws {
        let value = try object(
            input,
            required: [
                "partySize",
                "includesChildren",
                "youngestAge",
                "mobility",
                "experienceLevel"
            ]
        )
        _ = try integer(value["partySize"], in: 1...100)
        let includesChildren = try boolean(value["includesChildren"])
        let youngestAge: Int?
        if value["youngestAge"] is NSNull {
            youngestAge = nil
        } else {
            youngestAge = try integer(value["youngestAge"], in: 0...17)
        }
        guard includesChildren == (youngestAge != nil) else {
            throw invalid()
        }
        _ = try string(
            value["mobility"],
            allowed: ["standard", "limited", "unknown"]
        )
        _ = try string(
            value["experienceLevel"],
            allowed: [
                "beginner",
                "intermediate",
                "advanced",
                "unknown"
            ]
        )
    }

    private func validateDateOrSeason(_ input: Any?) throws {
        guard !(input is NSNull) else { return }
        let value = try object(
            input,
            required: ["kind"],
            optional: ["date", "season", "year"]
        )
        let kind = try string(value["kind"], allowed: ["date", "season"])
        if kind == "date" {
            try requireExactKeys(value, ["kind", "date"])
            let date = try string(value["date"], maximum: 10)
            guard Self.isValidDate(date) else { throw invalid() }
        } else {
            try requireExactKeys(value, ["kind", "season", "year"])
            _ = try string(
                value["season"],
                allowed: ["spring", "summer", "autumn", "winter"]
            )
            try nullableInteger(value["year"], range: 2020...2100)
        }
    }

    private func validateOvernight(_ input: Any?) throws {
        let value = try object(
            input,
            required: [
                "required",
                "nights",
                "allowedAccommodationTypes"
            ]
        )
        let required = try boolean(value["required"])
        let nights = try integer(value["nights"], in: 0...30)
        let accommodationTypes = try validateCanonicalIntentStringArray(
            value["allowedAccommodationTypes"],
            allowed: [
                "alpine_hut",
                "wilderness_hut",
                "official_campsite",
                "designated_bivouac"
            ],
            maximum: 8
        )
        guard
            required
                ? nights >= 1 && !accommodationTypes.isEmpty
                : nights == 0 && accommodationTypes.isEmpty
        else {
            throw invalid()
        }
    }

    private func validateTransport(_ input: Any?) throws {
        let value = try object(
            input,
            required: [
                "arrivalMode",
                "returnToStart",
                "publicTransportRequired"
            ]
        )
        _ = try string(
            value["arrivalMode"],
            allowed: [
                "walking",
                "bicycle",
                "car",
                "public_transport",
                "unknown"
            ]
        )
        _ = try boolean(value["returnToStart"])
        _ = try boolean(value["publicTransportRequired"])
    }

    private func validateClarifications(
        _ input: Any?
    ) throws -> [(code: String, field: String)] {
        let values = try array(input, count: 0...16)
        var identities: [(code: String, field: String)] = []
        for item in values {
            let value = try object(
                item,
                required: ["code", "field"]
            )
            let code = try string(value["code"], allowed: [
                "location_required",
                "start_required",
                "destination_required",
                "distance_required",
                "duration_required",
                "date_or_season_required",
                "overnight_legality_required",
                "transport_requirement_required",
                "difficulty_clarification_required"
            ])
            let field = try string(value["field"], allowed: [
                "geographicAnchor",
                "routeType",
                "distanceRangeKm",
                "durationRangeMinutes",
                "dateOrSeason",
                "overnightRequirements",
                "transportRequirements",
                "maximumTechnicalDifficulty"
            ])
            identities.append((code, field))
        }
        let canonical = identities.sorted {
            $0.code == $1.code
                ? $0.field < $1.field
                : $0.code < $1.code
        }
        guard identities.elementsEqual(
            canonical,
            by: { $0.code == $1.code && $0.field == $1.field }
        ) else {
            throw invalid()
        }
        return identities
    }

    private func validateAttempt(
        _ input: Any,
        expectedIndex: Int,
        intent: ValidatedIntent
    ) throws -> ValidatedAttempt {
        let value = try object(
            input,
            required: [
                "attemptId",
                "proposalIndex",
                "state",
                "provenance",
                "routeResults",
                "failureCode"
            ]
        )
        let proposalIndex = try integer(
            value["proposalIndex"],
            in: 0...(Self.maximumAttempts - 1)
        )
        guard proposalIndex == expectedIndex else { throw invalid() }
        let provenance = try validateProvenance(
            value["provenance"],
            intent: intent
        )
        let attemptID = try string(value["attemptId"], maximum: 39)
        let expectedAttemptID = try derivedAttemptID(
            proposalID: provenance.proposalID
        )
        guard
            Self.isHexIdentity(
                attemptID,
                prefix: "rrrav1_",
                hexadecimalCount: 32
            ),
            attemptID == expectedAttemptID
        else {
            throw invalid()
        }
        let state = try enumValue(
            value["state"],
            as: ResearchGuidedAttemptStateV1.self
        )
        let rawResults = try array(
            value["routeResults"],
            count: 0...Self.maximumPathsPerAttempt
        )
        let routeResults = try rawResults.enumerated().map { index, raw in
            try validateRouteResult(
                raw,
                expectedIndex: index,
                attemptID: attemptID,
                intent: intent,
                provenance: provenance
            )
        }
        try requireUnique(routeResults.map(\.routeResultID))
        let failureCode: String?
        if value["failureCode"] is NSNull {
            failureCode = nil
        } else {
            failureCode = try string(
                value["failureCode"],
                allowed: Self.attemptFailureCodes
            )
        }
        guard
            (state == .routed) ==
                (!routeResults.isEmpty && failureCode == nil),
            state == .routed ||
                (routeResults.isEmpty && failureCode != nil)
        else {
            throw invalid()
        }
        if state == .unsupported {
            guard [
                "unsupported_point_to_point",
                "unsupported_out_and_back",
                "unsupported_candidate_plan"
            ].contains(failureCode) else {
                throw invalid()
            }
        }
        return ValidatedAttempt(
            attemptID: attemptID,
            proposalIndex: proposalIndex,
            state: state,
            provenance: provenance,
            routeResults: routeResults,
            failureCode: failureCode
        )
    }

    private func validateProvenance(
        _ input: Any?,
        intent: ValidatedIntent
    ) throws -> ResearchRouteProvenanceV1 {
        let value = try object(
            input,
            required: [
                "proposalId",
                "lineageId",
                "strategy",
                "activity",
                "routeType",
                "selectedWaypoints",
                "mappedNetworkCandidates",
                "evidenceClaimIds",
                "requiredVerification",
                "knownLimitations",
                "sourceCandidatePlanPolicyVersion"
            ]
        )
        let proposalID = try string(value["proposalId"], maximum: 39)
        guard Self.isHexIdentity(
            proposalID,
            prefix: "rrcpv1_",
            hexadecimalCount: 32
        ) else {
            throw invalid()
        }
        let strategy = try string(value["strategy"], allowed: [
            "must_have_first",
            "balanced_experiences",
            "minimal_preliminary_detour",
            "mapped_network_first",
            "overnight_candidate_first"
        ])
        let activityRaw = try string(
            value["activity"],
            allowed: ["hiking", "trail_running"]
        )
        let routeTypeRaw = try string(
            value["routeType"],
            allowed: ["loop", "point_to_point", "out_and_back"]
        )
        guard
            activityRaw == intent.activity,
            routeTypeRaw == intent.routeType,
            try string(value["sourceCandidatePlanPolicyVersion"]) ==
                Self.candidatePlanPolicyVersion
        else {
            throw invalid()
        }
        let selected = try array(
            value["selectedWaypoints"],
            count: 1...Self.maximumSelectedWaypoints
        ).map(validateSelectedWaypoint)
        let mapped = try array(
            value["mappedNetworkCandidates"],
            count: 0...Self.maximumMappedCandidates
        ).map(validateMappedCandidate)
        try requireUnique(selected.map { $0.entityID.uuidString })
        try requireUnique(mapped.map { $0.entityID.uuidString })
        let evidenceIDs = try uniqueUUIDs(
            value["evidenceClaimIds"],
            minimum: 1,
            maximum: Self.maximumEvidenceIDs
        )
        let expectedEvidence = Set(
            selected.flatMap(\.evidenceClaimIDs) +
                mapped.flatMap(\.evidenceClaimIDs)
        ).sorted { $0.uuidString < $1.uuidString }
        guard evidenceIDs == expectedEvidence else { throw invalid() }
        let requiredVerification = try verificationCodes(
            value["requiredVerification"]
        )
        let limitations = try knownLimitations(
            value["knownLimitations"]
        )
        let lineageID = try string(value["lineageId"], maximum: 39)
        let expectedLineageID = derivedLineageID(
            proposalID: proposalID,
            strategy: strategy,
            activity: activityRaw,
            routeType: routeTypeRaw,
            selected: selected,
            mapped: mapped,
            evidenceIDs: evidenceIDs,
            requiredVerification: requiredVerification,
            knownLimitations: limitations
        )
        guard
            Self.isHexIdentity(
                lineageID,
                prefix: "rrlpv1_",
                hexadecimalCount: 32
            ),
            lineageID == expectedLineageID
        else {
            throw invalid()
        }
        let activity: ActivityType =
            activityRaw == "hiking" ? .hiking : .trailRunning
        let routeType: TrailRouteType =
            routeTypeRaw == "loop" ? .loop : .pointToPoint
        return ResearchRouteProvenanceV1(
            proposalID: proposalID,
            lineageID: lineageID,
            strategy: strategy,
            activity: activity,
            routeType: routeType,
            selectedWaypoints: selected,
            mappedNetworkCandidates: mapped,
            evidenceClaimIDs: evidenceIDs,
            requiredVerification: requiredVerification,
            knownLimitations: limitations,
            sourceCandidatePlanPolicyVersion:
                Self.candidatePlanPolicyVersion
        )
    }

    private func validateSelectedWaypoint(
        _ input: Any
    ) throws -> ResearchSelectedWaypointV1 {
        let value = try object(
            input,
            required: [
                "entityId",
                "coordinate",
                "highlightCategory",
                "role",
                "evidenceClaimIds",
                "selectionReasons",
                "requiredVerification",
                "knownLimitations"
            ]
        )
        return ResearchSelectedWaypointV1(
            entityID: try uuid(value["entityId"]),
            coordinate: try coordinate(value["coordinate"]),
            highlightCategory: try enumValue(
                value["highlightCategory"],
                as: ResearchHighlightCategoryV1.self
            ),
            role: try enumValue(
                value["role"],
                as: ResearchCandidateRoleV1.self
            ),
            evidenceClaimIDs: try uniqueUUIDs(
                value["evidenceClaimIds"],
                minimum: 1,
                maximum: 32
            ),
            selectionReasons: try uniqueEnums(
                value["selectionReasons"],
                as: ResearchSelectionReasonV1.self,
                maximum: 8
            ),
            requiredVerification: try verificationCodes(
                value["requiredVerification"]
            ),
            knownLimitations: try knownLimitations(
                value["knownLimitations"]
            )
        )
    }

    private func validateMappedCandidate(
        _ input: Any
    ) throws -> ResearchMappedNetworkCandidateV1 {
        let value = try object(
            input,
            required: [
                "entityId",
                "sourceBasis",
                "evidenceClaimIds",
                "requiredVerification",
                "knownLimitations"
            ]
        )
        return ResearchMappedNetworkCandidateV1(
            entityID: try uuid(value["entityId"]),
            sourceBasis: try enumValue(
                value["sourceBasis"],
                as: ResearchMappedSourceBasisV1.self
            ),
            evidenceClaimIDs: try uniqueUUIDs(
                value["evidenceClaimIds"],
                minimum: 1,
                maximum: 32
            ),
            requiredVerification: try verificationCodes(
                value["requiredVerification"]
            ),
            knownLimitations: try knownLimitations(
                value["knownLimitations"]
            )
        )
    }

    private func validateRouteResult(
        _ input: Any,
        expectedIndex: Int,
        attemptID: String,
        intent: ValidatedIntent,
        provenance: ResearchRouteProvenanceV1
    ) throws -> ValidatedRouteResult {
        let value = try object(
            input,
            required: [
                "routeResultId",
                "pathIndex",
                "geometryProvider",
                "routingStrategy",
                "path",
                "waypointVisits"
            ]
        )
        let pathIndex = try integer(
            value["pathIndex"],
            in: 0...(Self.maximumPathsPerAttempt - 1)
        )
        guard pathIndex == expectedIndex else { throw invalid() }
        let routeResultID = try string(
            value["routeResultId"],
            maximum: 46
        )
        guard routeResultID == "\(attemptID)_path_\(pathIndex + 1)" else {
            throw invalid()
        }
        guard
            try string(value["geometryProvider"]) == "graphhopper",
            try string(value["routingStrategy"]) == "backend"
        else {
            throw invalid()
        }
        let pathObject = try validatePath(value["path"])
        let expectedVisitCount = provenance.selectedWaypoints.count + 2
        let rawVisits = try array(
            value["waypointVisits"],
            count: expectedVisitCount...expectedVisitCount
        )
        let visits = try rawVisits.enumerated().map { index, raw in
            try validateVisit(
                raw,
                expectedIndex: index,
                intent: intent,
                selectedWaypoints: provenance.selectedWaypoints
            )
        }
        return ValidatedRouteResult(
            routeResultID: routeResultID,
            pathIndex: pathIndex,
            pathObject: pathObject,
            waypointVisits: visits
        )
    }

    private func validateVisit(
        _ input: Any,
        expectedIndex: Int,
        intent: ValidatedIntent,
        selectedWaypoints: [ResearchSelectedWaypointV1]
    ) throws -> ResearchWaypointVisitV1 {
        let value = try object(
            input,
            required: [
                "waypointIndex",
                "role",
                "entityId",
                "requestedCoordinate",
                "snappedCoordinate",
                "snapDistanceMeters",
                "withinVisitTolerance"
            ]
        )
        let waypointIndex = try integer(
            value["waypointIndex"],
            in: 0...(selectedWaypoints.count + 1)
        )
        guard waypointIndex == expectedIndex else { throw invalid() }
        let expectedRole: ResearchWaypointVisitRoleV1
        if expectedIndex == 0 {
            expectedRole = .anchor
        } else if expectedIndex == selectedWaypoints.count + 1 {
            expectedRole = .returnAnchor
        } else {
            expectedRole = .via
        }
        let role = try enumValue(
            value["role"],
            as: ResearchWaypointVisitRoleV1.self
        )
        guard role == expectedRole else { throw invalid() }
        let expectedWaypoint = role == .via
            ? selectedWaypoints[expectedIndex - 1]
            : nil
        let entityID: UUID?
        if value["entityId"] is NSNull {
            entityID = nil
        } else {
            entityID = try uuid(value["entityId"])
        }
        guard entityID == expectedWaypoint?.entityID else {
            throw invalid()
        }
        guard let anchor = intent.anchorCoordinate else {
            throw invalid()
        }
        let requestedCoordinate = try coordinate(
            value["requestedCoordinate"]
        )
        let expectedCoordinate = expectedWaypoint?.coordinate ?? anchor
        guard requestedCoordinate == expectedCoordinate else {
            throw invalid()
        }
        let snappedCoordinate: Coordinate?
        let snapDistanceMeters: Double?
        if value["snappedCoordinate"] is NSNull {
            guard value["snapDistanceMeters"] is NSNull else {
                throw invalid()
            }
            snappedCoordinate = nil
            snapDistanceMeters = nil
        } else {
            snappedCoordinate = try coordinateWithOptionalElevation(
                value["snappedCoordinate"]
            )
            snapDistanceMeters = try number(
                value["snapDistanceMeters"],
                minimum: 0,
                maximum: 1_000_000
            )
        }
        let withinTolerance = try boolean(
            value["withinVisitTolerance"]
        )
        if
            let snappedCoordinate,
            let snapDistanceMeters
        {
            let expectedDistance = Self.distanceMeters(
                requestedCoordinate,
                snappedCoordinate
            )
            guard
                abs(expectedDistance - snapDistanceMeters) <= 0.01,
                withinTolerance ==
                    (
                        snapDistanceMeters <=
                            Self.waypointVisitToleranceMeters
                    )
            else {
                throw invalid()
            }
        } else if withinTolerance {
            throw invalid()
        }
        return ResearchWaypointVisitV1(
            waypointIndex: waypointIndex,
            role: role,
            entityID: entityID,
            requestedCoordinate: requestedCoordinate,
            snappedCoordinate: snappedCoordinate,
            snapDistanceMeters: snapDistanceMeters,
            withinVisitTolerance: withinTolerance
        )
    }

    private func validatePath(
        _ input: Any?
    ) throws -> [String: Any] {
        let value = try object(
            input,
            required: ["distance", "time", "points", "instructions"],
            optional: ["ascend", "descend", "details"]
        )
        _ = try number(
            value["distance"],
            minimum: 10,
            maximum: 1_000_000
        )
        _ = try integer(
            value["time"],
            in: 1...(30 * 24 * 60 * 60 * 1_000)
        )
        if let ascend = value["ascend"] {
            _ = try number(
                ascend,
                minimum: 0,
                maximum: routeLimits.maximumAbsoluteElevationMeters
            )
        }
        if let descend = value["descend"] {
            _ = try number(
                descend,
                minimum: 0,
                maximum: routeLimits.maximumAbsoluteElevationMeters
            )
        }
        let coordinateCount = try validateLineString(value["points"])
        let instructions = try array(
            value["instructions"],
            count: 0...routeLimits.maximumInstructionsPerPath
        )
        for instruction in instructions {
            try validateInstruction(
                instruction,
                maximumCoordinateIndex: coordinateCount - 1
            )
        }
        if let details = value["details"] {
            try validateDetails(
                details,
                maximumCoordinateIndex: coordinateCount - 1
            )
        }
        return value
    }

    private func validateLineString(_ input: Any?) throws -> Int {
        let value = try object(
            input,
            required: ["type", "coordinates"]
        )
        guard try string(value["type"]) == "LineString" else {
            throw invalid()
        }
        let coordinates = try array(
            value["coordinates"],
            count: 2...routeLimits.maximumCoordinatesPerPath
        )
        var first: [Double]?
        var hasDistinctCoordinate = false
        for raw in coordinates {
            let values = try array(raw, count: 2...3).map {
                try number(
                    $0,
                    minimum: -routeLimits.maximumAbsoluteElevationMeters,
                    maximum: routeLimits.maximumAbsoluteElevationMeters
                )
            }
            guard
                (-180...180).contains(values[0]),
                (-90...90).contains(values[1])
            else {
                throw invalid()
            }
            if let first {
                hasDistinctCoordinate =
                    hasDistinctCoordinate ||
                    values[0] != first[0] ||
                    values[1] != first[1]
            } else {
                first = values
            }
        }
        guard hasDistinctCoordinate else { throw invalid() }
        return coordinates.count
    }

    private func validateInstruction(
        _ input: Any,
        maximumCoordinateIndex: Int
    ) throws {
        let value = try object(
            input,
            required: [
                "text",
                "distance",
                "time",
                "interval",
                "sign"
            ],
            optional: ["street_name"]
        )
        _ = try string(value["text"], minimum: 0, maximum: 512)
        if let streetName = value["street_name"] {
            _ = try string(streetName, minimum: 0, maximum: 512)
        }
        _ = try number(
            value["distance"],
            minimum: 0,
            maximum: 1_000_000
        )
        _ = try integer(
            value["time"],
            in: 0...(30 * 24 * 60 * 60 * 1_000)
        )
        _ = try integer(value["sign"], in: -100...100)
        let interval = try array(value["interval"], count: 2...2)
            .map {
                try integer($0, in: 0...maximumCoordinateIndex)
            }
        guard interval[0] <= interval[1] else { throw invalid() }
    }

    private func validateDetails(
        _ input: Any,
        maximumCoordinateIndex: Int
    ) throws {
        let value = try object(
            input,
            required: [],
            optional: ["surface", "road_class", "hike_rating"]
        )
        var totalCount = 0
        for key in ["surface", "road_class", "hike_rating"] {
            guard let raw = value[key] else { continue }
            let entries = try array(
                raw,
                count: 0...routeLimits.maximumPathDetailsPerPath
            )
            totalCount += entries.count
            for entry in entries {
                let item = try array(entry, count: 3...3)
                let from = try integer(
                    item[0],
                    in: 0...maximumCoordinateIndex
                )
                let to = try integer(
                    item[1],
                    in: 0...maximumCoordinateIndex
                )
                guard from <= to else { throw invalid() }
                try validatePathDetailValue(item[2])
            }
        }
        guard totalCount <= routeLimits.maximumPathDetailsPerPath else {
            throw invalid()
        }
    }

    private func validatePathDetailValue(_ input: Any) throws {
        if input is Bool { return }
        if let value = input as? String {
            _ = try string(value, maximum: 160)
            return
        }
        _ = try number(
            input,
            minimum: -1_000_000,
            maximum: 1_000_000
        )
    }

    private func derivedState(
        attempts: [ValidatedAttempt],
        declared: ResearchGuidedRoutedEnvelopeStateV1
    ) -> ResearchGuidedRoutedEnvelopeStateV1 {
        if attempts.isEmpty {
            return declared == .unsupported ? .unsupported : .noViableRoute
        }
        let routedCount = attempts.filter { $0.state == .routed }.count
        if routedCount == attempts.count { return .routed }
        if routedCount > 0 { return .partial }
        if attempts.allSatisfy({ $0.state == .unsupported }) {
            return .unsupported
        }
        return .noViableRoute
    }

    private func derivedLimitations(
        attempts: [ValidatedAttempt],
        state: ResearchGuidedRoutedEnvelopeStateV1
    ) -> [String] {
        var values = attempts.flatMap {
            $0.provenance.knownLimitations.map(\.rawValue)
        }
        if attempts.isEmpty {
            values.append("candidate_plan_not_routable")
        }
        if attempts.contains(where: { $0.state == .failed }) {
            values.append("provider_failure")
        }
        if attempts.contains(where: { $0.state == .unsupported }) {
            values.append("route_type_unsupported")
        }
        let visits = attempts.flatMap {
            $0.routeResults.flatMap(\.waypointVisits)
        }
        if visits.contains(where: {
            $0.role == .via && $0.snappedCoordinate == nil
        }) {
            values.append("snapping_unavailable")
        }
        if visits.contains(where: {
            $0.role == .via &&
                $0.snappedCoordinate != nil &&
                !$0.withinVisitTolerance
        }) {
            values.append("snapping_exceeds_tolerance")
        }
        if state == .unsupported && attempts.isEmpty {
            values.append("candidate_plan_unsupported")
        }
        let vocabulary =
            Self.candidateLimitations + Self.adapterLimitations
        return Array(Set(values)).sorted {
            let left = vocabulary.firstIndex(of: $0) ?? .max
            let right = vocabulary.firstIndex(of: $1) ?? .max
            return left == right ? $0 < $1 : left < right
        }
    }

    private func derivedLineageID(
        proposalID: String,
        strategy: String,
        activity: String,
        routeType: String,
        selected: [ResearchSelectedWaypointV1],
        mapped: [ResearchMappedNetworkCandidateV1],
        evidenceIDs: [UUID],
        requiredVerification: [ResearchVerificationCodeV1],
        knownLimitations: [ResearchKnownLimitationV1]
    ) -> String {
        let selectedIdentity = selected.map { waypoint in
            [
                waypoint.entityID.uuidString.lowercased(),
                Self.fixedCoordinate(waypoint.coordinate.latitude),
                Self.fixedCoordinate(waypoint.coordinate.longitude),
                waypoint.highlightCategory.rawValue,
                waypoint.role.rawValue,
                waypoint.evidenceClaimIDs
                    .map { $0.uuidString.lowercased() }
                    .joined(separator: ","),
                waypoint.selectionReasons.map(\.rawValue)
                    .joined(separator: ","),
                waypoint.requiredVerification.map(\.rawValue)
                    .joined(separator: ","),
                waypoint.knownLimitations.map(\.rawValue)
                    .joined(separator: ",")
            ].joined(separator: "|")
        }.joined(separator: ";")
        let mappedIdentity = mapped.map { candidate in
            [
                candidate.entityID.uuidString.lowercased(),
                candidate.sourceBasis.rawValue,
                candidate.evidenceClaimIDs
                    .map { $0.uuidString.lowercased() }
                    .joined(separator: ","),
                candidate.requiredVerification.map(\.rawValue)
                    .joined(separator: ","),
                candidate.knownLimitations.map(\.rawValue)
                    .joined(separator: ",")
            ].joined(separator: "|")
        }.joined(separator: ";")
        let value = [
            Self.adapterPolicyVersion,
            Self.candidatePlanPolicyVersion,
            proposalID,
            strategy,
            activity,
            routeType,
            selectedIdentity,
            mappedIdentity,
            evidenceIDs.map { $0.uuidString.lowercased() }
                .joined(separator: ","),
            requiredVerification.map(\.rawValue).joined(separator: ","),
            knownLimitations.map(\.rawValue).joined(separator: ",")
        ].joined(separator: "\n")
        let digest = SHA256.hash(data: Data(value.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return "rrlpv1_" + hex.prefix(32)
    }

    private func derivedAttemptID(
        proposalID: String
    ) throws -> String {
        try identity(
            prefix: "rrrav1_",
            value: [
                "candidatePlanPolicyVersion":
                    Self.candidatePlanPolicyVersion,
                "proposalId": proposalID,
                "routingAdapterPolicyVersion": Self.adapterPolicyVersion
            ]
        )
    }

    private func identity(
        prefix: String,
        value: [String: Any]
    ) throws -> String {
        let data = try JSONSerialization.data(
            withJSONObject: value,
            options: [.sortedKeys]
        )
        let digest = SHA256.hash(data: data)
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return prefix + hex.prefix(32)
    }

    private func verificationCodes(
        _ input: Any?
    ) throws -> [ResearchVerificationCodeV1] {
        try uniqueEnums(
            input,
            as: ResearchVerificationCodeV1.self,
            maximum: Self.maximumVerificationCodes
        )
    }

    private func knownLimitations(
        _ input: Any?
    ) throws -> [ResearchKnownLimitationV1] {
        try uniqueEnums(
            input,
            as: ResearchKnownLimitationV1.self,
            maximum: Self.maximumKnownLimitations
        )
    }

    private func uniqueEnums<T: RawRepresentable & Hashable>(
        _ input: Any?,
        as type: T.Type,
        maximum: Int
    ) throws -> [T] where T.RawValue == String {
        let result = try array(input, count: 0...maximum).map {
            try enumValue($0, as: type)
        }
        try requireUnique(result)
        return result
    }

    private func enumValue<T: RawRepresentable>(
        _ input: Any?,
        as _: T.Type
    ) throws -> T where T.RawValue == String {
        let rawValue = try string(input)
        guard let value = T(rawValue: rawValue) else { throw invalid() }
        return value
    }

    private func uniqueUUIDs(
        _ input: Any?,
        minimum: Int,
        maximum: Int
    ) throws -> [UUID] {
        let result = try array(
            input,
            count: minimum...maximum
        ).map { try uuid($0) }
        try requireUnique(result)
        return result
    }

    private func uniqueStrings(
        _ input: Any?,
        allowed: Set<String>,
        maximum: Int
    ) throws -> [String] {
        let result = try array(input, count: 0...maximum).map {
            try string($0, allowed: allowed)
        }
        try requireUnique(result)
        return result
    }

    private func nullableRange(
        _ input: Any?,
        minimum: Double,
        maximum: Double
    ) throws -> ClosedRange<Double>? {
        guard !(input is NSNull) else { return nil }
        let value = try object(
            input,
            required: ["min", "max"]
        )
        let lower = try number(
            value["min"],
            minimum: minimum,
            maximum: maximum
        )
        let upper = try number(
            value["max"],
            minimum: minimum,
            maximum: maximum
        )
        guard lower <= upper else { throw invalid() }
        return lower...upper
    }

    private func nullableIntegerRange(
        _ input: Any?,
        minimum: Int,
        maximum: Int
    ) throws -> ClosedRange<Int>? {
        guard !(input is NSNull) else { return nil }
        let value = try object(
            input,
            required: ["min", "max"]
        )
        let lower = try integer(
            value["min"],
            in: minimum...maximum
        )
        let upper = try integer(
            value["max"],
            in: minimum...maximum
        )
        guard lower <= upper else { throw invalid() }
        return lower...upper
    }

    private func nullableInteger(
        _ input: Any?,
        range: ClosedRange<Int>
    ) throws {
        guard !(input is NSNull) else { return }
        _ = try integer(input, in: range)
    }

    private func nullableString(
        _ input: Any?,
        allowed: Set<String>
    ) throws {
        guard !(input is NSNull) else { return }
        _ = try string(input, allowed: allowed)
    }

    private func coordinate(_ input: Any?) throws -> Coordinate {
        let value = try object(
            input,
            required: ["latitude", "longitude"]
        )
        return Coordinate(
            latitude: try number(
                value["latitude"],
                minimum: -90,
                maximum: 90
            ),
            longitude: try number(
                value["longitude"],
                minimum: -180,
                maximum: 180
            )
        )
    }

    private func coordinateWithOptionalElevation(
        _ input: Any?
    ) throws -> Coordinate {
        let value = try object(
            input,
            required: ["latitude", "longitude"],
            optional: ["elevationMeters"]
        )
        return Coordinate(
            latitude: try number(
                value["latitude"],
                minimum: -90,
                maximum: 90
            ),
            longitude: try number(
                value["longitude"],
                minimum: -180,
                maximum: 180
            ),
            elevationMeters: try value["elevationMeters"].map {
                try number(
                    $0,
                    minimum:
                        -routeLimits.maximumAbsoluteElevationMeters,
                    maximum:
                        routeLimits.maximumAbsoluteElevationMeters
                )
            }
        )
    }

    private func uuid(_ input: Any?) throws -> UUID {
        let rawValue = try string(input, maximum: 36)
        guard
            rawValue == rawValue.lowercased(),
            let value = UUID(uuidString: rawValue),
            value.uuidString.lowercased() == rawValue
        else {
            throw invalid()
        }
        return value
    }

    private func object(
        _ input: Any?,
        required: Set<String>,
        optional: Set<String> = []
    ) throws -> [String: Any] {
        guard let value = input as? [String: Any] else {
            throw invalid()
        }
        let keys = Set(value.keys)
        guard
            required.isSubset(of: keys),
            keys.isSubset(of: required.union(optional))
        else {
            throw invalid()
        }
        return value
    }

    private func requireExactKeys(
        _ input: [String: Any],
        _ expected: Set<String>
    ) throws {
        guard Set(input.keys) == expected else { throw invalid() }
    }

    private func array(
        _ input: Any?,
        count: ClosedRange<Int>
    ) throws -> [Any] {
        guard
            let value = input as? [Any],
            count.contains(value.count)
        else {
            throw invalid()
        }
        return value
    }

    private func string(
        _ input: Any?,
        minimum: Int = 1,
        maximum: Int = 512
    ) throws -> String {
        guard
            let value = input as? String,
            value == value.trimmingCharacters(in: .whitespacesAndNewlines),
            value.count >= minimum,
            value.count <= maximum,
            value.rangeOfCharacter(from: .controlCharacters) == nil,
            !value.contains("<"),
            !value.contains(">")
        else {
            throw invalid()
        }
        return value
    }

    private func string(
        _ input: Any?,
        allowed: Set<String>
    ) throws -> String {
        let value = try string(input)
        guard allowed.contains(value) else { throw invalid() }
        return value
    }

    private func string(
        _ input: Any?,
        allowed: [String]
    ) throws -> String {
        try string(input, allowed: Set(allowed))
    }

    private func number(
        _ input: Any?,
        minimum: Double,
        maximum: Double
    ) throws -> Double {
        guard
            let value = input as? NSNumber,
            CFGetTypeID(value) != CFBooleanGetTypeID()
        else {
            throw invalid()
        }
        let number = value.doubleValue
        guard
            number.isFinite,
            number >= minimum,
            number <= maximum
        else {
            throw invalid()
        }
        return number
    }

    private func integer(
        _ input: Any?,
        in range: ClosedRange<Int>
    ) throws -> Int {
        let value = try number(
            input,
            minimum: Double(range.lowerBound),
            maximum: Double(range.upperBound)
        )
        guard
            value.rounded(.towardZero) == value,
            value <= Double(Int.max)
        else {
            throw invalid()
        }
        return Int(value)
    }

    private func boolean(_ input: Any?) throws -> Bool {
        guard
            let value = input as? NSNumber,
            CFGetTypeID(value) == CFBooleanGetTypeID()
        else {
            throw invalid()
        }
        return value.boolValue
    }

    private func requireUnique<T: Hashable>(_ input: [T]) throws {
        guard Set(input).count == input.count else { throw invalid() }
    }

    private func invalid() -> ResearchGuidedRoutingContractErrorV1 {
        .invalidEnvelope
    }

    private static func isHexIdentity(
        _ value: String,
        prefix: String,
        hexadecimalCount: Int
    ) -> Bool {
        guard
            value.hasPrefix(prefix),
            value.count == prefix.count + hexadecimalCount
        else {
            return false
        }
        return value.dropFirst(prefix.count).allSatisfy {
            $0.isNumber || ("a"..."f").contains(String($0))
        }
    }

    private static func isValidDate(_ value: String) -> Bool {
        guard value.count == 10 else { return false }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard let date = formatter.date(from: value) else { return false }
        return formatter.string(from: date) == value
    }

    private static func distanceMeters(
        _ start: Coordinate,
        _ finish: Coordinate
    ) -> Double {
        let earthRadiusMeters = 6_371_000.0
        let radians = Double.pi / 180
        let latitudeDelta =
            (finish.latitude - start.latitude) * radians
        let longitudeDelta =
            (finish.longitude - start.longitude) * radians
        let startLatitude = start.latitude * radians
        let finishLatitude = finish.latitude * radians
        let value =
            pow(sin(latitudeDelta / 2), 2) +
            cos(startLatitude) *
                cos(finishLatitude) *
                pow(sin(longitudeDelta / 2), 2)
        return earthRadiusMeters * 2 *
            atan2(sqrt(value), sqrt(max(0, 1 - value)))
    }

    private static func fixedCoordinate(_ value: Double) -> String {
        String(
            format: "%.7f",
            locale: Locale(identifier: "en_US_POSIX"),
            value
        )
    }
}

private extension ResearchGuidedRoutedEnvelopeValidatorV1 {
    struct ValidatedEnvelope {
        let state: ResearchGuidedRoutedEnvelopeStateV1
        let intent: ValidatedIntent
        let attempts: [ValidatedAttempt]
        let remainingLimitations: [String]
    }

    struct ValidatedIntent {
        let activity: String
        let routeType: String
        let anchorName: String?
        let anchorCoordinate: Coordinate?
        let targetDistanceKm: Double?
        let targetDurationMinutes: Int?
        let avoidedExperiences: [String]

        var planningRequest: RoutePlanningRequest {
            let activityType: ActivityType
            let graphHopperProfile: String
            switch activity {
            case "hiking":
                activityType = .hiking
                graphHopperProfile = "foot"
            case "trail_running":
                activityType = .trailRunning
                graphHopperProfile = "foot"
            default:
                activityType = .biking
                graphHopperProfile = "bike"
            }
            var avoidFeatures: [AvoidFeature] = []
            if avoidedExperiences.contains("major_roads") {
                avoidFeatures.append(.majorRoads)
            }
            if avoidedExperiences.contains("steep_climbs") {
                avoidFeatures.append(.steepClimbs)
            }
            if avoidedExperiences.contains("repeated_path") {
                avoidFeatures.append(.repeatedPath)
            }
            return RoutePlanningRequest(
                routeType: routeType == "loop" ? .loop : .pointToPoint,
                startQuery: anchorName ?? "Start",
                endQuery: nil,
                activityType: activityType,
                graphHopperProfile: graphHopperProfile,
                targetDistanceKm: targetDistanceKm,
                targetDurationMinutes: targetDurationMinutes,
                difficulty: nil,
                desiredFeatures: [],
                avoidFeatures: avoidFeatures
            )
        }
    }

    struct ValidatedAttempt {
        let attemptID: String
        let proposalIndex: Int
        let state: ResearchGuidedAttemptStateV1
        let provenance: ResearchRouteProvenanceV1
        let routeResults: [ValidatedRouteResult]
        let failureCode: String?
    }

    struct ValidatedRouteResult {
        let routeResultID: String
        let pathIndex: Int
        let pathObject: [String: Any]
        let waypointVisits: [ResearchWaypointVisitV1]
    }
}
