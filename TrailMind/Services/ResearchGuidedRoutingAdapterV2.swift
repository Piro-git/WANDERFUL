import CoreFoundation
import CryptoKit
import Foundation

struct ResearchGuidedRoutingContractAdapterV2: Sendable {
    private let limits: RouteTransportLimits
    private let qualitySelectionDidFinish: @Sendable (Duration) -> Void

    init(
        limits: RouteTransportLimits = .standard,
        qualitySelectionDidFinish:
            @escaping @Sendable (Duration) -> Void = { _ in }
    ) {
        self.limits = limits
        self.qualitySelectionDidFinish = qualitySelectionDidFinish
    }

    func decodeConvertAndSelect(
        _ data: Data
    ) throws -> ResearchGuidedRouteSelectionV1 {
        let envelope = try ResearchGuidedRoutedEnvelopeValidatorV2(
            routeLimits: limits
        ).validate(data)
        guard envelope.state == .routed || envelope.state == .partial else {
            return ResearchGuidedRouteSelectionV1(
                state: envelope.state,
                sourceEnvelopeState: envelope.state,
                alternatives: [],
                rejectionCounts: [:],
                remainingLimitations: envelope.remainingLimitations
            )
        }
        let planningRequest = Self.planningRequest(envelope.intent)
        guard case let .resolved(_, researchAnchor, _) =
            envelope.intent.geographicAnchor
        else {
            throw ResearchGuidedRoutingContractErrorV1.invalidEnvelope
        }
        let anchor = Coordinate(
            latitude: researchAnchor.latitude,
            longitude: researchAnchor.longitude
        )
        var contexts: [ConvertedContext] = []
        var conversionRejections = 0
        for attempt in envelope.attempts where attempt.state == .routed {
            for result in attempt.routeResults {
                let hardApproaches = result.highlightApproaches.filter {
                    [.mustHave, .facilityCandidate, .overnightCandidate]
                        .contains($0.role)
                }
                guard hardApproaches.allSatisfy({
                    $0.providerVerifiedAccess && $0.state == .reached
                }) else {
                    conversionRejections += 1
                    continue
                }
                do {
                    let response = try JSONSerialization.data(
                        withJSONObject: [
                            "provider": "graphhopper",
                            "paths": [result.pathObject]
                        ],
                        options: [.sortedKeys]
                    )
                    let route = try GraphHopperClient.verifiedBackendRoute(
                        fromSinglePathResponse: response,
                        requestedStart: anchor,
                        requestedEnd: anchor,
                        planningRequest: planningRequest,
                        limits: limits
                    )
                    guard route.isVerifiedRoutedResult else {
                        conversionRejections += 1
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
                        waypointVisits: result.waypointVisits,
                        highlightApproaches: result.highlightApproaches
                    ))
                } catch {
                    conversionRejections += 1
                }
            }
        }

        let startedAt = ContinuousClock().now
        let quality = RouteAlternativeQuality.select(
            contexts.map(\.suggestion),
            request: planningRequest
        )
        qualitySelectionDidFinish(startedAt.duration(to: .now))
        var rejectionCounts = quality.rejectionCounts
        if conversionRejections > 0 {
            rejectionCounts["contract_route_conversion_rejected"] =
                conversionRejections
        }
        let alternatives = quality.selected.compactMap {
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
                waypointVisits: context.waypointVisits,
                highlightApproaches: context.highlightApproaches
            )
        }
        let state: ResearchGuidedRoutedEnvelopeStateV1 =
            alternatives.isEmpty ? .noViableRoute
            : envelope.state == .partial ? .partial : .routed
        return ResearchGuidedRouteSelectionV1(
            state: state,
            sourceEnvelopeState: envelope.state,
            alternatives: alternatives,
            rejectionCounts: rejectionCounts,
            remainingLimitations: envelope.remainingLimitations
        )
    }

    private static func planningRequest(
        _ intent: AdventureResearchIntentV1
    ) -> RoutePlanningRequest {
        let activity: ActivityType
        let profile: String
        switch intent.activity {
        case .hiking:
            activity = .hiking
            profile = "foot"
        case .trailRunning:
            activity = .trailRunning
            profile = "foot"
        case .biking:
            activity = .biking
            profile = "bike"
        }
        let start: String
        switch intent.geographicAnchor {
        case let .resolved(name, _, _): start = name
        case .unresolved: start = "Start"
        }
        let desired = intent.preferredExperiences.compactMap {
            switch $0 {
            case .viewpoint: DesiredFeature.viewpoint
            case .forest: DesiredFeature.forest
            case .quietTrails: DesiredFeature.quiet
            default: nil
            }
        }
        var avoid: [AvoidFeature] = []
        if intent.avoidedExperiences.contains(.majorRoads) {
            avoid.append(.majorRoads)
        }
        if intent.avoidedExperiences.contains(.steepClimbs) {
            avoid.append(.steepClimbs)
        }
        if intent.avoidedExperiences.contains(.repeatedPath) {
            avoid.append(.repeatedPath)
        }
        return RoutePlanningRequest(
            routeType: intent.routeType == .loop ? .loop : .pointToPoint,
            startQuery: start,
            endQuery: nil,
            activityType: activity,
            graphHopperProfile: profile,
            targetDistanceKm: intent.distanceRangeKm.map {
                ($0.min + $0.max) / 2
            },
            targetDurationMinutes: intent.durationRangeMinutes.map {
                ($0.min + $0.max) / 2
            },
            difficulty: intent.maximumTechnicalDifficulty == .hiking
                ? .easy : nil,
            desiredFeatures: desired,
            avoidFeatures: avoid
        )
    }

    private struct ConvertedContext {
        let attemptID: String
        let routeResultID: String
        let suggestion: RouteSuggestion
        let provenance: ResearchRouteProvenanceV1
        let waypointVisits: [ResearchWaypointVisitV1]
        let highlightApproaches: [ResearchHighlightApproachV2]
    }
}

private struct ResearchGuidedRoutedEnvelopeValidatorV2 {
    private static let maximumEnvelopeBytes = 8 * 1_024 * 1_024
    private static let accessTolerance = 100.0
    private static let reachedTolerance = 25.0
    private static let nearTolerance = 100.0
    private static let calculationTolerance = 0.75
    private static let hardRoles: Set<ResearchCandidateRoleV1> = [
        .mustHave, .facilityCandidate, .overnightCandidate
    ]
    private static let strategies: Set<String> = [
        "must_have_first",
        "balanced_experiences",
        "minimal_preliminary_detour",
        "mapped_network_first",
        "overnight_candidate_first"
    ]
    private static let failureCodes: Set<String> = [
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
    private static let accessKnownLimitations: Set<String> = [
        "mapped_trail_only",
        "provider_connectivity_unverified",
        "provider_access_unverified",
        "public_access_unverified"
    ]
    private static let accessRequiredVerification: Set<String> = [
        "provider_routing_required",
        "provider_snap_required",
        "route_geometry_approach_required",
        "public_access_required"
    ]
    private static let provenanceKnownLimitations: Set<String> =
        Set(ResearchKnownLimitationV1.allCases.map(\.rawValue))
        .union(accessKnownLimitations)
        .union([
            "access_candidate_unavailable",
            "optional_access_removed",
            "material_required_detour",
            "required_backtracking_risk",
            "provider_verification_required"
        ])
    private static let provenanceRequiredVerification: Set<String> =
        Set(ResearchVerificationCodeV1.allCases.map(\.rawValue))
        .union(accessRequiredVerification)
    private static let adapterLimitations: Set<String> = [
        "provider_access_snap_unavailable",
        "provider_access_snap_exceeds_tolerance",
        "route_misses_access_coordinate",
        "selected_highlight_not_reached",
        "selected_highlight_passes_near",
        "target_distance_not_met",
        "provider_failure",
        "route_type_unsupported",
        "candidate_plan_unsupported",
        "candidate_plan_not_routable"
    ]

    let routeLimits: RouteTransportLimits

    func validate(_ data: Data) throws -> ValidatedEnvelope {
        guard data.count <= Self.maximumEnvelopeBytes else {
            throw ResearchGuidedRoutingContractErrorV1.envelopeTooLarge
        }
        do {
            let root = try JSONSerialization.jsonObject(with: data)
            return try validateRoot(root)
        } catch ResearchGuidedRoutingContractErrorV1.envelopeTooLarge {
            throw ResearchGuidedRoutingContractErrorV1.envelopeTooLarge
        } catch {
            throw ResearchGuidedRoutingContractErrorV1.invalidEnvelope
        }
    }

    private func validateRoot(_ input: Any) throws -> ValidatedEnvelope {
        let root = try object(input, keys: [
            "schemaVersion", "state", "normalizedIntent",
            "candidatePlanPolicyVersion", "routingAdapterPolicyVersion",
            "attempts", "remainingLimitations"
        ])
        guard try integer(root["schemaVersion"], range: 2...2) == 2,
              try string(root["candidatePlanPolicyVersion"]) ==
                "research-guided-route-candidates-v2",
              try string(root["routingAdapterPolicyVersion"]) ==
                "research-guided-routing-adapter-v2"
        else { throw invalid() }
        let state = try enumValue(
            root["state"], as: ResearchGuidedRoutedEnvelopeStateV1.self
        )
        let intentObject = try object(root["normalizedIntent"])
        let intent = try AdventureResearchIntentV1(
            validatingJSONObject: intentObject
        )
        let attempts = try array(root["attempts"], range: 0...6)
            .enumerated().map {
                try validateAttempt(
                    $0.element,
                    index: $0.offset,
                    intent: intent,
                    intentObject: intentObject
                )
            }
        try unique(attempts.map { $0.attemptID })
        guard state == envelopeState(attempts, declared: state) else {
            throw invalid()
        }
        let limitations = try strings(
            root["remainingLimitations"], range: 0...128
        )
        guard limitations == limitations.sorted(),
              limitations == derivedLimitations(attempts, state: state)
        else { throw invalid() }
        return ValidatedEnvelope(
            state: state,
            intent: intent,
            attempts: attempts,
            remainingLimitations: limitations
        )
    }

    private func validateAttempt(
        _ input: Any,
        index: Int,
        intent: AdventureResearchIntentV1,
        intentObject: [String: Any]
    ) throws -> ValidatedAttempt {
        let value = try object(input, keys: [
            "attemptId", "proposalIndex", "state", "provenance",
            "routeResults", "failureCode"
        ])
        guard try integer(value["proposalIndex"], range: 0...5) == index
        else { throw invalid() }
        let parsed = try validateProvenance(
            value["provenance"],
            intent: intent,
            intentObject: intentObject
        )
        let attemptID = try string(value["attemptId"])
        let expectedAttemptID = try hash(
            prefix: "rrrav2_",
            value: [
                "policyVersion": "research-guided-routing-adapter-v2",
                "proposalId": parsed.provenance.proposalID,
                "lineageId": parsed.provenance.lineageID
            ]
        )
        guard attemptID == expectedAttemptID else { throw invalid() }
        let state = try enumValue(
            value["state"], as: ResearchGuidedAttemptStateV1.self
        )
        let results = try array(value["routeResults"], range: 0...3)
            .enumerated().map {
                try validateRouteResult(
                    $0.element,
                    index: $0.offset,
                    attemptID: attemptID,
                    selected: parsed.selected,
                    intent: intent
                )
            }
        let failureCode: String? = isNull(value["failureCode"])
            ? nil : try string(value["failureCode"])
        guard failureCode.map(Self.failureCodes.contains) ?? true else {
            throw invalid()
        }
        guard (state == .routed) == (!results.isEmpty && failureCode == nil),
              state == .routed || (results.isEmpty && failureCode != nil)
        else { throw invalid() }
        return ValidatedAttempt(
            attemptID: attemptID,
            state: state,
            provenance: parsed.provenance,
            rawKnownLimitations: parsed.rawKnownLimitations,
            routeResults: results
        )
    }

    private func validateProvenance(
        _ input: Any?,
        intent: AdventureResearchIntentV1,
        intentObject: [String: Any]
    ) throws -> ParsedProvenance {
        let value = try object(input, keys: [
            "proposalId", "lineageId", "sourceProposalId", "strategy",
            "activity", "routeType", "selectedHighlights",
            "mappedNetworkCandidates", "evidenceClaimIds",
            "requiredVerification", "knownLimitations",
            "sourceCandidatePlanPolicyVersion", "trailAccessPolicyVersion"
        ])
        guard try string(value["sourceCandidatePlanPolicyVersion"]) ==
                "research-guided-route-candidates-v2",
              try string(value["trailAccessPolicyVersion"]) ==
                "research-trail-access-candidates-v1",
              try string(value["activity"]) == intent.activity.rawValue,
              try string(value["routeType"]) == intent.routeType.rawValue
        else { throw invalid() }
        let selected = try array(
            value["selectedHighlights"], range: 1...5
        ).map(validateSelected)
        try unique(selected.map { $0.waypoint.entityID })
        let mapped = try array(
            value["mappedNetworkCandidates"], range: 0...8
        ).map(validateMapped)
        let evidenceIDs = try uuids(value["evidenceClaimIds"], range: 1...64)
        let verificationRaw = try strings(
            value["requiredVerification"], range: 0...64
        )
        let limitationRaw = try strings(
            value["knownLimitations"], range: 0...96
        )
        guard Set(verificationRaw).isSubset(
            of: Self.provenanceRequiredVerification
        ), Set(limitationRaw).isSubset(
            of: Self.provenanceKnownLimitations
        ) else { throw invalid() }
        let sourceProposalID = try string(value["sourceProposalId"])
        let strategy = try string(value["strategy"])
        guard sourceProposalID.wholeMatch(of: /^rrcpv1_[0-9a-f]{32}$/) != nil,
              Self.strategies.contains(strategy)
        else { throw invalid() }
        let proposalID = try string(value["proposalId"])
        let proposalIdentity: [String: Any] = [
            "policyVersion": "research-guided-route-candidates-v2",
            "normalizedIntent": try identityValue(intentObject),
            "sourceProposalId": sourceProposalID,
            "strategy": strategy,
            "orderedSelection": selected.map {
                [
                    "entityId": $0.waypoint.entityID.uuidString.lowercased(),
                    "evidenceCoordinate": fixedCoordinate($0.waypoint.coordinate),
                    "routingCoordinate": fixedCoordinate($0.routingCoordinate),
                    "accessCandidateId": $0.accessCandidateID,
                    "role": $0.waypoint.role.rawValue
                ]
            },
            "mappedNetworkEntityIds": mapped.map {
                $0.entityID.uuidString.lowercased()
            }
        ]
        let expectedProposalID = try hash(
            prefix: "rrcpv2_", value: proposalIdentity
        )
        guard proposalID == expectedProposalID else { throw invalid() }
        var lineageInput = value
        lineageInput.removeValue(forKey: "lineageId")
        let lineageID = try string(value["lineageId"])
        let expectedLineageID = try hash(
            prefix: "rrlpv2_",
            value: [
                "policyVersion": "research-guided-routing-adapter-v2",
                "provenance": try identityValue(lineageInput)
            ]
        )
        guard lineageID == expectedLineageID else { throw invalid() }
        let activity: ActivityType = intent.activity == .hiking
            ? .hiking : intent.activity == .trailRunning
                ? .trailRunning : .biking
        let routeType: TrailRouteType = intent.routeType == .loop
            ? .loop : .pointToPoint
        return ParsedProvenance(
            provenance: ResearchRouteProvenanceV1(
                proposalID: proposalID,
                lineageID: lineageID,
                strategy: strategy,
                activity: activity,
                routeType: routeType,
                selectedWaypoints: selected.map(\.waypoint),
                mappedNetworkCandidates: mapped,
                evidenceClaimIDs: evidenceIDs,
                requiredVerification: verificationRaw.compactMap(
                    ResearchVerificationCodeV1.init(rawValue:)
                ),
                knownLimitations: limitationRaw.compactMap(
                    ResearchKnownLimitationV1.init(rawValue:)
                ),
                sourceCandidatePlanPolicyVersion:
                    "research-guided-route-candidates-v2"
            ),
            selected: selected,
            rawKnownLimitations: limitationRaw
        )
    }

    private func validateSelected(_ input: Any) throws -> SelectedHighlight {
        let value = try object(input, keys: [
            "entityId", "highlightCategory", "role", "evidenceCoordinate",
            "routingCoordinate", "trailAccessCandidate", "evidenceClaimIds",
            "selectionReasons", "requiredVerification", "knownLimitations"
        ])
        let entityID = try uuid(value["entityId"])
        let category = try enumValue(
            value["highlightCategory"], as: ResearchHighlightCategoryV1.self
        )
        let role = try enumValue(
            value["role"], as: ResearchCandidateRoleV1.self
        )
        let evidence = try coordinate(value["evidenceCoordinate"])
        let routing = try coordinate(value["routingCoordinate"])
        let access = try validateAccessCandidate(value["trailAccessCandidate"])
        guard access.entityID == entityID,
              access.category == category,
              access.evidenceCoordinate == evidence,
              access.routingCoordinate == routing
        else { throw invalid() }
        return SelectedHighlight(
            waypoint: ResearchSelectedWaypointV1(
                entityID: entityID,
                coordinate: evidence,
                highlightCategory: category,
                role: role,
                evidenceClaimIDs: try uuids(
                    value["evidenceClaimIds"], range: 1...32
                ),
                selectionReasons: try enums(
                    value["selectionReasons"],
                    as: ResearchSelectionReasonV1.self,
                    range: 0...32
                ),
                requiredVerification: try enums(
                    value["requiredVerification"],
                    as: ResearchVerificationCodeV1.self,
                    range: 0...32
                ),
                knownLimitations: try enums(
                    value["knownLimitations"],
                    as: ResearchKnownLimitationV1.self,
                    range: 0...32
                )
            ),
            routingCoordinate: routing,
            accessCandidateID: access.candidateID
        )
    }

    private func validateAccessCandidate(
        _ input: Any?
    ) throws -> AccessCandidate {
        let value = try object(input, keys: [
            "schemaVersion", "candidateId", "originalHighlightEntityId",
            "highlightCategory", "evidenceCoordinate", "routingCoordinate",
            "sourceTrailSegmentEntityId",
            "sourceTrailCategoryEvidenceClaimIds",
            "sourceSnapshot", "derivationPolicyVersion",
            "derivationAlgorithm", "poiToAccessPointDistanceMeters",
            "sourceTrailHighwayClass", "sourceTrailRecord", "lifecycleState",
            "accessCandidateState", "knownLimitations",
            "requiredVerification", "displayName", "freshness"
        ])
        guard try integer(value["schemaVersion"], range: 1...1) == 1,
              try string(value["derivationPolicyVersion"]) ==
                "research-trail-access-candidates-v1",
              try string(value["derivationAlgorithm"]) ==
                "postgis-st-closest-point-v1",
              try string(value["lifecycleState"]) == "current",
              try string(value["accessCandidateState"]) == "candidate"
        else { throw invalid() }
        let entityID = try uuid(value["originalHighlightEntityId"])
        let category = try enumValue(
            value["highlightCategory"], as: ResearchHighlightCategoryV1.self
        )
        let evidence = try coordinate(value["evidenceCoordinate"])
        let routing = try coordinate(value["routingCoordinate"])
        let distance = try number(
            value["poiToAccessPointDistanceMeters"], range: 0...75
        )
        let highwayClass = try string(value["sourceTrailHighwayClass"])
        guard abs(Self.distance(evidence, routing) - distance) <= 0.75,
              ["path", "footway", "track", "steps", "bridleway", "pedestrian"]
                .contains(highwayClass)
        else { throw invalid() }
        let snapshot = try object(value["sourceSnapshot"], keys: [
            "operationalRegionId", "projectionRunId", "importId", "sourceId",
            "sourcePolicyId", "sourcePolicyVersion", "adapterSchemaVersion"
        ])
        let snapshotRegion = try string(snapshot["operationalRegionId"])
        let snapshotImportID = try uuid(snapshot["importId"])
        for field in ["projectionRunId", "importId", "sourceId", "sourcePolicyId"] {
            _ = try uuid(snapshot[field])
        }
        _ = try string(snapshot["sourcePolicyVersion"])
        _ = try string(snapshot["adapterSchemaVersion"])
        let sourceTrailRecord = try object(value["sourceTrailRecord"], keys: [
            "importId", "operationalRegionId", "osmType", "osmId",
            "highwayClass"
        ])
        let recordImportID = try uuid(sourceTrailRecord["importId"])
        let recordRegion = try string(
            sourceTrailRecord["operationalRegionId"]
        )
        let recordOSMType = try string(sourceTrailRecord["osmType"])
        let recordOSMID = try string(sourceTrailRecord["osmId"])
        let recordHighwayClass = try string(
            sourceTrailRecord["highwayClass"]
        )
        guard recordImportID == snapshotImportID,
              recordRegion == snapshotRegion,
              recordOSMType == "way",
              recordOSMID.range(
                of: #"^[1-9][0-9]{0,19}$"#,
                options: .regularExpression
              ) != nil,
              recordHighwayClass == highwayClass
        else { throw invalid() }
        let known = try strings(value["knownLimitations"], range: 0...8)
        let required = try strings(value["requiredVerification"], range: 0...8)
        guard Set(known).isSubset(of: Self.accessKnownLimitations),
              Set(required).isSubset(of: Self.accessRequiredVerification),
              Set([
            "mapped_trail_only", "provider_connectivity_unverified",
            "provider_access_unverified", "public_access_unverified"
        ]).isSubset(of: Set(known)),
              Set([
                "provider_routing_required", "provider_snap_required",
                "route_geometry_approach_required", "public_access_required"
              ]).isSubset(of: Set(required))
        else { throw invalid() }
        let freshness = try object(value["freshness"], keys: [
            "state", "sourceDataDate", "retrievedDate"
        ])
        guard try string(freshness["state"]) == "current" else {
            throw invalid()
        }
        let sourceDataDate = try strictDate(freshness["sourceDataDate"])
        let retrievedDate = try strictDate(freshness["retrievedDate"])
        guard sourceDataDate <= retrievedDate else { throw invalid() }
        if !isNull(value["displayName"]) {
            let displayName = try string(value["displayName"])
            guard displayName == displayName.trimmingCharacters(
                in: .whitespacesAndNewlines
            ), !displayName.contains("<"), !displayName.contains(">")
            else { throw invalid() }
        }
        let identity: [String: Any] = [
            "originalHighlightEntityId": entityID.uuidString.lowercased(),
            "highlightCategory": category.rawValue,
            "evidenceCoordinate": fixedCoordinate(evidence),
            "routingCoordinate": fixedCoordinate(routing),
            "sourceTrailSegmentEntityId":
                try uuid(value["sourceTrailSegmentEntityId"])
                    .uuidString.lowercased(),
            "sourceTrailCategoryEvidenceClaimIds": try uuids(
                value["sourceTrailCategoryEvidenceClaimIds"], range: 1...8
            ).map { $0.uuidString.lowercased() },
            "sourceSnapshot": snapshot,
            "derivationPolicyVersion": "research-trail-access-candidates-v1",
            "derivationAlgorithm": "postgis-st-closest-point-v1",
            "poiToAccessPointDistanceMeters": fixed(distance, places: 3),
            "sourceTrailHighwayClass": highwayClass,
            "sourceTrailRecord": [
                "importId": recordImportID.uuidString.lowercased(),
                "operationalRegionId": recordRegion,
                "osmType": recordOSMType,
                "osmId": recordOSMID,
                "highwayClass": recordHighwayClass
            ],
            "freshness": freshness
        ]
        let candidateID = try string(value["candidateId"])
        let expectedCandidateID = try hash(
            prefix: "rtacv1_", value: identity
        )
        guard candidateID == expectedCandidateID else { throw invalid() }
        return AccessCandidate(
            candidateID: candidateID,
            entityID: entityID,
            category: category,
            evidenceCoordinate: evidence,
            routingCoordinate: routing
        )
    }

    private func validateMapped(
        _ input: Any
    ) throws -> ResearchMappedNetworkCandidateV1 {
        let value = try object(input, keys: [
            "entityId", "sourceBasis", "evidenceClaimIds",
            "requiredVerification", "knownLimitations"
        ])
        return ResearchMappedNetworkCandidateV1(
            entityID: try uuid(value["entityId"]),
            sourceBasis: try enumValue(
                value["sourceBasis"], as: ResearchMappedSourceBasisV1.self
            ),
            evidenceClaimIDs: try uuids(
                value["evidenceClaimIds"], range: 1...32
            ),
            requiredVerification: try enums(
                value["requiredVerification"],
                as: ResearchVerificationCodeV1.self,
                range: 0...32
            ),
            knownLimitations: try enums(
                value["knownLimitations"],
                as: ResearchKnownLimitationV1.self,
                range: 0...32
            )
        )
    }

    private func validateRouteResult(
        _ input: Any,
        index: Int,
        attemptID: String,
        selected: [SelectedHighlight],
        intent: AdventureResearchIntentV1
    ) throws -> ValidatedRouteResult {
        let value = try object(input, keys: [
            "routeResultId", "pathIndex", "geometryProvider",
            "routingStrategy", "verificationState", "path",
            "waypointSnaps", "highlightVerifications",
            "distanceVerification"
        ])
        guard try integer(value["pathIndex"], range: 0...2) == index,
              try string(value["geometryProvider"]) == "graphhopper",
              try string(value["routingStrategy"]) == "backend"
        else { throw invalid() }
        let path = try validatePath(value["path"])
        let snaps = try array(
            value["waypointSnaps"],
            range: (selected.count + 2)...(selected.count + 2)
        ).enumerated().map {
            try validateSnap(
                $0.element,
                index: $0.offset,
                selected: selected,
                intent: intent
            )
        }
        let approaches = try array(
            value["highlightVerifications"],
            range: selected.count...selected.count
        ).enumerated().map {
            try validateApproach(
                $0.element,
                index: $0.offset,
                selected: selected[$0.offset],
                snap: snaps[$0.offset + 1],
                pathCoordinates: path.coordinates
            )
        }
        let expectedVerification: String
        if approaches.contains(where: {
            Self.hardRoles.contains($0.role) && !$0.providerVerifiedAccess
        }) {
            expectedVerification = "unverified"
        } else if approaches.contains(where: {
            Self.hardRoles.contains($0.role) && $0.state != .reached
        }) {
            expectedVerification = "ineligible"
        } else {
            expectedVerification = "eligible"
        }
        guard try string(value["verificationState"]) == expectedVerification
        else { throw invalid() }
        let distanceOutsideTarget = try validateDistance(
            value["distanceVerification"],
            pathDistanceMeters: path.distanceMeters,
            target: intent.distanceRangeKm
        )
        var resultIdentity = value
        resultIdentity.removeValue(forKey: "routeResultId")
        let expectedRouteResultID = try hash(
            prefix: "rrrv2_",
            value: [
                "policyVersion": "research-guided-routing-adapter-v2",
                "attemptId": attemptID,
                "pathIndex": index,
                "routeResult": try identityValue(resultIdentity)
            ]
        )
        guard try string(value["routeResultId"]) == expectedRouteResultID
        else { throw invalid() }
        return ValidatedRouteResult(
            routeResultID: expectedRouteResultID,
            pathObject: path.object,
            waypointVisits: snaps.map(\.visit),
            highlightApproaches: approaches,
            verificationState: expectedVerification,
            distanceOutsideTarget: distanceOutsideTarget
        )
    }

    private func validatePath(
        _ input: Any?
    ) throws -> (object: [String: Any], coordinates: [Coordinate], distanceMeters: Double) {
        let value = try object(input)
        let allowed = Set([
            "distance", "time", "ascend", "descend", "points",
            "instructions", "details"
        ])
        guard Set(value.keys).isSubset(of: allowed),
              ["distance", "time", "points", "instructions"]
                .allSatisfy(value.keys.contains)
        else { throw invalid() }
        let distance = try number(value["distance"], range: 10...1_000_000)
        _ = try integer(value["time"], range: 1...(30 * 24 * 60 * 60 * 1_000))
        let points = try object(value["points"], keys: ["type", "coordinates"])
        guard try string(points["type"]) == "LineString" else {
            throw invalid()
        }
        let coordinates = try array(
            points["coordinates"], range: 2...routeLimits.maximumCoordinatesPerPath
        ).map { raw -> Coordinate in
            let item = try array(raw, range: 2...3)
            if item.count == 3 {
                _ = try number(item[2], range: -100_000...100_000)
            }
            return Coordinate(
                latitude: try number(item[1], range: -90...90),
                longitude: try number(item[0], range: -180...180)
            )
        }
        guard coordinates.dropFirst().contains(where: {
            $0.latitude != coordinates[0].latitude ||
                $0.longitude != coordinates[0].longitude
        }) else { throw invalid() }
        return (value, coordinates, distance)
    }

    private func validateSnap(
        _ input: Any,
        index: Int,
        selected: [SelectedHighlight],
        intent: AdventureResearchIntentV1
    ) throws -> ValidatedSnap {
        let value = try object(input, keys: [
            "waypointIndex", "role", "entityId", "requestedCoordinate",
            "snappedCoordinate", "snapDistanceMeters", "withinAccessTolerance"
        ])
        guard try integer(
            value["waypointIndex"], range: 0...(selected.count + 1)
        ) == index else { throw invalid() }
        let isVia = index > 0 && index <= selected.count
        let role = isVia ? "via_access" : index == 0
            ? "anchor" : "return_anchor"
        guard try string(value["role"]) == role else { throw invalid() }
        let selectedHighlight = isVia ? selected[index - 1] : nil
        let entityID = isNull(value["entityId"])
            ? nil : try uuid(value["entityId"])
        guard entityID == selectedHighlight?.waypoint.entityID else {
            throw invalid()
        }
        let requested = try coordinate(value["requestedCoordinate"])
        let anchor: Coordinate
        guard case let .resolved(_, researchCoordinate, _) =
            intent.geographicAnchor
        else { throw invalid() }
        anchor = Coordinate(
            latitude: researchCoordinate.latitude,
            longitude: researchCoordinate.longitude
        )
        guard requested == (selectedHighlight?.routingCoordinate ?? anchor)
        else { throw invalid() }
        let snapped: Coordinate?
        let distance: Double?
        if isNull(value["snappedCoordinate"]) {
            guard isNull(value["snapDistanceMeters"]) else { throw invalid() }
            snapped = nil
            distance = nil
        } else {
            snapped = try coordinate(value["snappedCoordinate"], elevation: true)
            distance = try number(value["snapDistanceMeters"], range: 0...1_000_000)
            guard abs(Self.distance(requested, snapped!) - distance!) <=
                Self.calculationTolerance else { throw invalid() }
        }
        let within = try boolean(value["withinAccessTolerance"])
        guard within == (distance.map { $0 <= Self.accessTolerance } ?? false)
        else { throw invalid() }
        return ValidatedSnap(
            snappedCoordinate: snapped,
            snapDistanceMeters: distance,
            withinTolerance: within,
            visit: ResearchWaypointVisitV1(
                waypointIndex: index,
                role: isVia ? .via : index == 0 ? .anchor : .returnAnchor,
                entityID: entityID,
                requestedCoordinate: requested,
                snappedCoordinate: snapped,
                snapDistanceMeters: distance,
                withinVisitTolerance: within
            )
        )
    }

    private func validateApproach(
        _ input: Any,
        index: Int,
        selected: SelectedHighlight,
        snap: ValidatedSnap,
        pathCoordinates: [Coordinate]
    ) throws -> ResearchHighlightApproachV2 {
        let value = try object(input, keys: [
            "highlightIndex", "entityId", "role", "evidenceCoordinate",
            "routingCoordinate", "providerSnappedCoordinate",
            "providerSnapDistanceMeters", "routeClosestApproachCoordinate",
            "routeGeometryDistanceToAccessMeters",
            "routeGeometryDistanceToEvidenceMeters", "providerVerifiedAccess",
            "approachState"
        ])
        let waypoint = selected.waypoint
        guard try integer(value["highlightIndex"], range: 0...4) == index,
              try uuid(value["entityId"]) == waypoint.entityID,
              try enumValue(value["role"], as: ResearchCandidateRoleV1.self) == waypoint.role,
              try coordinate(value["evidenceCoordinate"]) == waypoint.coordinate,
              try coordinate(value["routingCoordinate"]) == selected.routingCoordinate
        else { throw invalid() }
        let providerCoordinate = isNull(value["providerSnappedCoordinate"])
            ? nil : try coordinate(value["providerSnappedCoordinate"], elevation: true)
        let providerDistance = isNull(value["providerSnapDistanceMeters"])
            ? nil : try number(value["providerSnapDistanceMeters"], range: 0...1_000_000)
        guard providerCoordinate == snap.snappedCoordinate,
              providerDistance == snap.snapDistanceMeters
        else { throw invalid() }
        let evidenceClosest = Self.closestPoint(
            on: pathCoordinates,
            to: waypoint.coordinate
        )
        let accessClosest = Self.closestPoint(
            on: pathCoordinates,
            to: selected.routingCoordinate
        )
        let closestCoordinate = try coordinate(
            value["routeClosestApproachCoordinate"]
        )
        let accessDistance = try number(
            value["routeGeometryDistanceToAccessMeters"],
            range: 0...1_000_000
        )
        let evidenceDistance = try number(
            value["routeGeometryDistanceToEvidenceMeters"],
            range: 0...1_000_000
        )
        guard Self.distance(closestCoordinate, evidenceClosest.coordinate) <=
                Self.calculationTolerance,
              abs(accessDistance - accessClosest.distance) <=
                Self.calculationTolerance,
              abs(evidenceDistance - evidenceClosest.distance) <=
                Self.calculationTolerance
        else { throw invalid() }
        let verified = snap.withinTolerance &&
            accessClosest.distance <= Self.accessTolerance
        let state: ResearchHighlightApproachStateV2 = !verified
            ? .unverified
            : evidenceClosest.distance <= Self.reachedTolerance
                ? .reached
                : evidenceClosest.distance <= Self.nearTolerance
                    ? .passesNear : .notReached
        guard try boolean(value["providerVerifiedAccess"]) == verified,
              try enumValue(
                value["approachState"],
                as: ResearchHighlightApproachStateV2.self
              ) == state
        else { throw invalid() }
        return ResearchHighlightApproachV2(
            entityID: waypoint.entityID,
            role: waypoint.role,
            evidenceCoordinate: waypoint.coordinate,
            routingCoordinate: selected.routingCoordinate,
            providerSnappedCoordinate: providerCoordinate,
            providerSnapDistanceMeters: providerDistance,
            routeClosestApproachCoordinate: closestCoordinate,
            routeGeometryDistanceToAccessMeters: accessDistance,
            routeGeometryDistanceToEvidenceMeters: evidenceDistance,
            providerVerifiedAccess: verified,
            state: state
        )
    }

    private func validateDistance(
        _ input: Any?,
        pathDistanceMeters: Double,
        target: AdventureResearchDistanceRangeV1?
    ) throws -> Bool {
        let value = try object(input, keys: [
            "routeDistanceKm", "targetRangeKm", "state", "deviationKm"
        ])
        let routeKm = rounded(pathDistanceMeters / 1_000, places: 3)
        guard try number(value["routeDistanceKm"], range: 0...1_000) == routeKm
        else { throw invalid() }
        if let target {
            let range = try object(value["targetRangeKm"], keys: ["min", "max"])
            guard try number(range["min"], range: 0.1...500) == target.min,
                  try number(range["max"], range: 0.1...500) == target.max
            else { throw invalid() }
            let within = (target.min...target.max).contains(routeKm)
            let deviation = within ? 0 : routeKm < target.min
                ? rounded(target.min - routeKm, places: 3)
                : rounded(routeKm - target.max, places: 3)
            guard try string(value["state"]) ==
                    (within ? "within_target" : "outside_target"),
                  try number(value["deviationKm"], range: 0...1_000) == deviation
            else { throw invalid() }
            return !within
        } else {
            guard isNull(value["targetRangeKm"]),
                  try string(value["state"]) == "target_unspecified",
                  isNull(value["deviationKm"])
            else { throw invalid() }
            return false
        }
    }

    private func envelopeState(
        _ attempts: [ValidatedAttempt],
        declared: ResearchGuidedRoutedEnvelopeStateV1
    ) -> ResearchGuidedRoutedEnvelopeStateV1 {
        if attempts.isEmpty {
            return declared == .unsupported ? .unsupported : .noViableRoute
        }
        let results = attempts.flatMap(\.routeResults)
        let hasEligible = results.contains {
            $0.verificationState == "eligible"
        }
        if hasEligible && attempts.allSatisfy({ $0.state == .routed }) {
            return .routed
        }
        if !results.isEmpty { return .partial }
        if attempts.allSatisfy({ $0.state == .unsupported }) {
            return .unsupported
        }
        return .noViableRoute
    }

    private func derivedLimitations(
        _ attempts: [ValidatedAttempt],
        state: ResearchGuidedRoutedEnvelopeStateV1
    ) -> [String] {
        var values = attempts.flatMap(\.rawKnownLimitations)
        if attempts.isEmpty { values.append("candidate_plan_not_routable") }
        if attempts.isEmpty && state == .unsupported {
            values.append("candidate_plan_unsupported")
        }
        if attempts.contains(where: { $0.state == .failed }) {
            values.append("provider_failure")
        }
        if attempts.contains(where: { $0.state == .unsupported }) {
            values.append("route_type_unsupported")
        }
        for approach in attempts.flatMap(\.routeResults)
            .flatMap(\.highlightApproaches) {
            if approach.providerSnappedCoordinate == nil {
                values.append("provider_access_snap_unavailable")
            } else if !approach.providerVerifiedAccess {
                values.append("provider_access_snap_exceeds_tolerance")
            }
            if approach.routeGeometryDistanceToAccessMeters > Self.accessTolerance {
                values.append("route_misses_access_coordinate")
            }
            if approach.state == .passesNear {
                values.append("selected_highlight_passes_near")
            }
            if approach.state == .notReached {
                values.append("selected_highlight_not_reached")
            }
        }
        if attempts.flatMap(\.routeResults).contains(where: {
            $0.distanceOutsideTarget
        }) {
            values.append("target_distance_not_met")
        }
        return Array(Set(values)).sorted()
    }

    private static func closestPoint(
        on path: [Coordinate],
        to target: Coordinate
    ) -> (coordinate: Coordinate, distance: Double) {
        var best = (coordinate: path[0], distance: Double.greatestFiniteMagnitude)
        for index in 1..<path.count {
            let candidate = closestPoint(
                start: path[index - 1],
                end: path[index],
                target: target
            )
            if candidate.distance < best.distance { best = candidate }
        }
        return best
    }

    private static func closestPoint(
        start: Coordinate,
        end: Coordinate,
        target: Coordinate
    ) -> (coordinate: Coordinate, distance: Double) {
        let radians = Double.pi / 180
        let earth = 6_371_000.0
        let originLatitude = target.latitude * radians
        func xy(_ point: Coordinate) -> (x: Double, y: Double) {
            (
                (point.longitude - target.longitude) * radians *
                    cos(originLatitude) * earth,
                (point.latitude - target.latitude) * radians * earth
            )
        }
        let a = xy(start)
        let b = xy(end)
        let dx = b.x - a.x
        let dy = b.y - a.y
        let denominator = dx * dx + dy * dy
        let raw = denominator == 0 ? 0 :
            -(a.x * dx + a.y * dy) / denominator
        let t = min(1, max(0, raw))
        let coordinate = Coordinate(
            latitude: start.latitude + (end.latitude - start.latitude) * t,
            longitude: start.longitude + (end.longitude - start.longitude) * t
        )
        return (coordinate, distance(target, coordinate))
    }

    private static func distance(_ left: Coordinate, _ right: Coordinate) -> Double {
        let radians = Double.pi / 180
        let latitudeDelta = (right.latitude - left.latitude) * radians
        let longitudeDelta = (right.longitude - left.longitude) * radians
        let value = sin(latitudeDelta / 2) * sin(latitudeDelta / 2) +
            cos(left.latitude * radians) * cos(right.latitude * radians) *
            sin(longitudeDelta / 2) * sin(longitudeDelta / 2)
        return 6_371_000 * 2 * atan2(sqrt(value), sqrt(max(0, 1 - value)))
    }

    private func object(
        _ input: Any?,
        keys: [String]? = nil
    ) throws -> [String: Any] {
        guard let value = input as? [String: Any] else { throw invalid() }
        if let keys, Set(value.keys) != Set(keys) { throw invalid() }
        return value
    }

    private func array(_ input: Any?, range: ClosedRange<Int>) throws -> [Any] {
        guard let value = input as? [Any], range.contains(value.count)
        else { throw invalid() }
        return value
    }

    private func string(_ input: Any?) throws -> String {
        guard let value = input as? String,
              !value.isEmpty, value.utf16.count <= 512,
              !value.unicodeScalars.contains(where: {
                  $0.value <= 0x1F || $0.value == 0x7F
              })
        else { throw invalid() }
        return value
    }

    private func strings(
        _ input: Any?, range: ClosedRange<Int>
    ) throws -> [String] {
        let result = try array(input, range: range).map(string)
        try unique(result)
        return result
    }

    private func uuid(_ input: Any?) throws -> UUID {
        let raw = try string(input)
        guard raw.count == 36, raw == raw.lowercased(),
              let value = UUID(uuidString: raw)
        else { throw invalid() }
        return value
    }

    private func uuids(
        _ input: Any?, range: ClosedRange<Int>
    ) throws -> [UUID] {
        let result = try array(input, range: range).map(uuid)
        try unique(result)
        return result
    }

    private func number(
        _ input: Any?, range: ClosedRange<Double>
    ) throws -> Double {
        guard let value = input as? NSNumber,
              CFGetTypeID(value) != CFBooleanGetTypeID()
        else { throw invalid() }
        let result = value.doubleValue
        guard result.isFinite, range.contains(result) else { throw invalid() }
        return result
    }

    private func integer(
        _ input: Any?, range: ClosedRange<Int>
    ) throws -> Int {
        let value = try number(
            input,
            range: Double(range.lowerBound)...Double(range.upperBound)
        )
        guard value.rounded() == value else { throw invalid() }
        return Int(value)
    }

    private func boolean(_ input: Any?) throws -> Bool {
        guard let value = input as? NSNumber,
              CFGetTypeID(value) == CFBooleanGetTypeID()
        else { throw invalid() }
        return value.boolValue
    }

    private func coordinate(
        _ input: Any?, elevation: Bool = false
    ) throws -> Coordinate {
        let value = try object(input)
        let allowed = elevation
            ? Set(["latitude", "longitude", "elevationMeters"])
            : Set(["latitude", "longitude"])
        guard Set(value.keys).isSubset(of: allowed),
              value["latitude"] != nil, value["longitude"] != nil
        else { throw invalid() }
        if value["elevationMeters"] != nil {
            _ = try number(value["elevationMeters"], range: -100_000...100_000)
        }
        return Coordinate(
            latitude: try number(value["latitude"], range: -90...90),
            longitude: try number(value["longitude"], range: -180...180)
        )
    }

    private func enumValue<T: RawRepresentable>(
        _ input: Any?, as _: T.Type
    ) throws -> T where T.RawValue == String {
        guard let result = T(rawValue: try string(input)) else {
            throw invalid()
        }
        return result
    }

    private func enums<T: RawRepresentable & Hashable>(
        _ input: Any?,
        as type: T.Type,
        range: ClosedRange<Int>
    ) throws -> [T] where T.RawValue == String {
        let result = try array(input, range: range).map {
            try enumValue($0, as: type)
        }
        try unique(result)
        return result
    }

    private func strictDate(_ input: Any?) throws -> String {
        let value = try string(input)
        let pattern = /^\d{4}-\d{2}-\d{2}$/
        let components = value.split(separator: "-")
        guard value.wholeMatch(of: pattern) != nil,
              components.count == 3,
              let year = Int(components[0]),
              let month = Int(components[1]),
              let day = Int(components[2])
        else { throw invalid() }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let requested = DateComponents(
            calendar: calendar,
            timeZone: calendar.timeZone,
            year: year,
            month: month,
            day: day
        )
        guard let date = calendar.date(from: requested) else { throw invalid() }
        let resolved = calendar.dateComponents(
            [.year, .month, .day],
            from: date
        )
        guard resolved.year == year,
              resolved.month == month,
              resolved.day == day
        else { throw invalid() }
        return value
    }

    private func hash(prefix: String, value: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(
            withJSONObject: value,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        let digest = SHA256.hash(data: data).map {
            String(format: "%02x", $0)
        }.joined()
        return prefix + digest.prefix(32)
    }

    private func fixedCoordinate(_ value: Coordinate) -> [String: String] {
        [
            "latitude": fixed(value.latitude, places: 7),
            "longitude": fixed(value.longitude, places: 7)
        ]
    }

    private func fixed(_ value: Double, places: Int) -> String {
        String(
            format: "%.*f",
            locale: Locale(identifier: "en_US_POSIX"),
            places,
            value
        )
    }

    private func rounded(_ value: Double, places: Int) -> Double {
        let scale = pow(10.0, Double(places))
        return (value * scale).rounded() / scale
    }

    private func unique<T: Hashable>(_ values: [T]) throws {
        guard Set(values).count == values.count else { throw invalid() }
    }

    private func isNull(_ value: Any?) -> Bool { value is NSNull }
    private func identityValue(_ value: Any) throws -> Any {
        if let object = value as? [String: Any] {
            return try object.mapValues(identityValue)
        }
        if let array = value as? [Any] {
            return try array.map(identityValue)
        }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return number.boolValue
            }
            guard number.doubleValue.isFinite else { throw invalid() }
            return fixed(number.doubleValue, places: 7)
        }
        return value
    }

    private func invalid() -> ResearchGuidedRoutingContractErrorV1 {
        .invalidEnvelope
    }

    private struct AccessCandidate {
        let candidateID: String
        let entityID: UUID
        let category: ResearchHighlightCategoryV1
        let evidenceCoordinate: Coordinate
        let routingCoordinate: Coordinate
    }

    private struct SelectedHighlight {
        let waypoint: ResearchSelectedWaypointV1
        let routingCoordinate: Coordinate
        let accessCandidateID: String
    }

    private struct ParsedProvenance {
        let provenance: ResearchRouteProvenanceV1
        let selected: [SelectedHighlight]
        let rawKnownLimitations: [String]
    }

    private struct ValidatedSnap {
        let snappedCoordinate: Coordinate?
        let snapDistanceMeters: Double?
        let withinTolerance: Bool
        let visit: ResearchWaypointVisitV1
    }

    struct ValidatedEnvelope {
        let state: ResearchGuidedRoutedEnvelopeStateV1
        let intent: AdventureResearchIntentV1
        let attempts: [ValidatedAttempt]
        let remainingLimitations: [String]
    }

    struct ValidatedAttempt {
        let attemptID: String
        let state: ResearchGuidedAttemptStateV1
        let provenance: ResearchRouteProvenanceV1
        let rawKnownLimitations: [String]
        let routeResults: [ValidatedRouteResult]
    }

    struct ValidatedRouteResult {
        let routeResultID: String
        let pathObject: [String: Any]
        let waypointVisits: [ResearchWaypointVisitV1]
        let highlightApproaches: [ResearchHighlightApproachV2]
        let verificationState: String
        let distanceOutsideTarget: Bool
    }
}
