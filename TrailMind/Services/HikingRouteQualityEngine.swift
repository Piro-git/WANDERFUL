import Foundation

struct RouteQualityAssessment {
    let suggestion: RouteSuggestion
    let providerIndex: Int
    let stableCandidateKey: String
    let evidence: RouteEvidenceSnapshot
    let eligibility: RouteEligibility
    let objectives: [RouteQualityObjective]
    let paretoRank: Int
    let explanations: RouteQualityExplanationSet

    var route: TrailRoute { suggestion.route }

    func objective(_ kind: RouteQualityObjective.Kind) -> RouteQualityObjective? {
        objectives.first { $0.kind == kind }
    }

    func withParetoRank(_ rank: Int) -> RouteQualityAssessment {
        RouteQualityAssessment(
            suggestion: suggestion,
            providerIndex: providerIndex,
            stableCandidateKey: stableCandidateKey,
            evidence: evidence,
            eligibility: eligibility,
            objectives: objectives,
            paretoRank: rank,
            explanations: explanations
        )
    }

    func withEligibility(_ eligibility: RouteEligibility) -> RouteQualityAssessment {
        RouteQualityAssessment(
            suggestion: suggestion,
            providerIndex: providerIndex,
            stableCandidateKey: stableCandidateKey,
            evidence: evidence,
            eligibility: eligibility,
            objectives: objectives,
            paretoRank: paretoRank,
            explanations: explanations
        )
    }

    func withExplanations(_ explanations: RouteQualityExplanationSet) -> RouteQualityAssessment {
        RouteQualityAssessment(
            suggestion: suggestion,
            providerIndex: providerIndex,
            stableCandidateKey: stableCandidateKey,
            evidence: evidence,
            eligibility: eligibility,
            objectives: objectives,
            paretoRank: paretoRank,
            explanations: explanations
        )
    }
}

struct RouteQualitySelection {
    let policyVersion: HikingRouteQualityPolicyVersion
    let selected: [RouteQualityAssessment]
    let assessments: [RouteQualityAssessment]
    let comparisons: [RouteQualityComparison]
    let telemetry: RouteQualityTelemetrySummary

    var rejectionCounts: [String: Int] { telemetry.rejectionCounts }
}

struct HikingRouteQualityEngine {
    let policy: HikingRouteQualityPolicy

    init(policy: HikingRouteQualityPolicy = .v1) {
        self.policy = policy
    }

    func select(
        _ suggestions: [RouteSuggestion],
        request: RoutePlanningRequest,
        maximumSuggestions: Int? = nil
    ) -> RouteQualitySelection {
        let startedAt = DispatchTime.now().uptimeNanoseconds
        let assessed = suggestions.enumerated().map { index, suggestion in
            assessment(
                for: suggestion,
                providerIndex: index,
                request: request
            )
        }

        var rejectionCounts: [String: Int] = [:]
        for assessment in assessed where !assessment.eligibility.isEligible {
            if let rejection = assessment.eligibility.rejection {
                rejectionCounts[rejection.rawValue, default: 0] += 1
            }
        }

        let eligible = assessed.filter(\.eligibility.isEligible)
        let withParetoRanks = assignParetoRanks(eligible)
        let ranked = paretoAwareOrdering(withParetoRanks, request: request)
        let limit = max(1, min(maximumSuggestions ?? policy.maximumSuggestions, policy.maximumSuggestions))

        var selected: [RouteQualityAssessment] = []
        var diversityRejected: [Int: RouteQualityAssessment] = [:]
        for candidate in ranked {
            let duplicatesSelected = selected.contains { existing in
                RouteAlternativeQuality.pairwiseSimilarity(
                    candidate.route.path,
                    existing.route.path,
                    corridorMeters: policy.structuralPolicy.similarityCorridorMeters
                ) >= policy.structuralPolicy.nearDuplicateSimilarity
            }
            if duplicatesSelected {
                let rejection = RouteQualityRejection.nearDuplicateGeometry
                rejectionCounts[rejection.rawValue, default: 0] += 1
                diversityRejected[candidate.providerIndex] = candidate.withEligibility(
                    .rejected(rejection, warnings: candidate.eligibility.warnings)
                )
                continue
            }
            selected.append(candidate)
            if selected.count == limit { break }
        }

        let comparisons = comparisons(for: withParetoRanks)
        let contextualSelected = selected.map { candidate in
            candidate.withExplanations(
                explanationSet(
                    route: candidate.route,
                    request: request,
                    evidence: candidate.evidence,
                    selected: selected
                )
            )
        }
        let contextualByIndex = Dictionary(
            uniqueKeysWithValues: contextualSelected.map { ($0.providerIndex, $0) }
        )
        let rankedByIndex = Dictionary(uniqueKeysWithValues: ranked.map { ($0.providerIndex, $0) })
        let finalAssessments = assessed.map { original in
            contextualByIndex[original.providerIndex]
                ?? diversityRejected[original.providerIndex]
                ?? rankedByIndex[original.providerIndex]
                ?? original
        }

        let elapsed = DispatchTime.now().uptimeNanoseconds - startedAt
        let telemetry = RouteQualityTelemetrySummary(
            policyVersion: policy.version,
            candidateCount: suggestions.count,
            eligibleCount: eligible.count,
            selectedCount: contextualSelected.count,
            rejectionCounts: rejectionCounts,
            assessmentDurationMicroseconds: elapsed / 1_000
        )
        return RouteQualitySelection(
            policyVersion: policy.version,
            selected: contextualSelected,
            assessments: finalAssessments,
            comparisons: comparisons,
            telemetry: telemetry
        )
    }

    func assessment(
        for suggestion: RouteSuggestion,
        providerIndex: Int,
        request: RoutePlanningRequest
    ) -> RouteQualityAssessment {
        let analysis = RouteAlternativeQuality.analyze(
            route: suggestion.route,
            request: request,
            policy: policy.structuralPolicy
        )
        return assessment(
            for: suggestion,
            providerIndex: providerIndex,
            request: request,
            analysis: analysis
        )
    }

    func assessment(
        for suggestion: RouteSuggestion,
        providerIndex: Int,
        request: RoutePlanningRequest,
        analysis: RouteGeometryQualityAnalysis
    ) -> RouteQualityAssessment {
        assessment(
            for: suggestion,
            providerIndex: providerIndex,
            request: request,
            analysis: analysis,
            outdoorEvidence: .unsupported
        )
    }

    /// Deterministic merge seam for evidence fetched before ranking. Network
    /// work remains outside the synchronous quality engine.
    func assessment(
        for suggestion: RouteSuggestion,
        providerIndex: Int,
        request: RoutePlanningRequest,
        analysis: RouteGeometryQualityAnalysis,
        outdoorEvidence: OutdoorRouteEvidenceSnapshot
    ) -> RouteQualityAssessment {
        let route = suggestion.route
        let evidence = RouteEvidenceSnapshot.make(
            route: route,
            analysis: analysis,
            policy: policy
        ).merging(outdoorEvidence)
        let eligibility = eligibility(
            route: route,
            request: request,
            analysis: analysis,
            evidence: evidence
        )
        return RouteQualityAssessment(
            suggestion: suggestion,
            providerIndex: providerIndex,
            stableCandidateKey: Self.stableCandidateKey(for: route),
            evidence: evidence,
            eligibility: eligibility,
            objectives: objectives(
                route: route,
                request: request,
                analysis: analysis,
                evidence: evidence
            ),
            paretoRank: Int.max,
            explanations: explanationSet(
                route: route,
                request: request,
                evidence: evidence,
                selected: []
            )
        )
    }

    func comparison(
        _ left: RouteQualityAssessment,
        _ right: RouteQualityAssessment
    ) -> RouteQualityComparison {
        var leftBetter = false
        var rightBetter = false
        var differences: [RouteQualityObjective.Kind] = []

        for kind in RouteQualityObjective.Kind.allCases {
            guard
                let leftValue = left.objective(kind)?.normalizedLoss,
                let rightValue = right.objective(kind)?.normalizedLoss,
                leftValue.isFinite,
                rightValue.isFinite
            else { continue }
            let difference = leftValue - rightValue
            guard abs(difference) > policy.objectiveComparisonEpsilon else { continue }
            differences.append(kind)
            if difference < 0 { leftBetter = true }
            if difference > 0 { rightBetter = true }
        }

        let dominance: RouteQualityDominance = switch (leftBetter, rightBetter) {
        case (true, false): .leftDominates
        case (false, true): .rightDominates
        case (true, true): .nonDominated
        case (false, false): .equivalent
        }
        return RouteQualityComparison(
            leftCandidateKey: left.stableCandidateKey,
            rightCandidateKey: right.stableCandidateKey,
            dominance: dominance,
            materiallyDifferentObjectives: differences
        )
    }

    func hasSufficientHighQualityDistinctCandidates(
        _ suggestions: [RouteSuggestion],
        request: RoutePlanningRequest,
        minimumCandidateCount: Int? = nil
    ) -> Bool {
        let requiredCount = max(
            1,
            min(minimumCandidateCount ?? policy.maximumSuggestions, policy.maximumSuggestions)
        )
        let selection = select(
            suggestions,
            request: request,
            maximumSuggestions: policy.maximumSuggestions
        )
        guard selection.selected.count >= requiredCount else { return false }
        return selection.selected.allSatisfy { assessment in
            guard assessment.eligibility.isEligible else { return false }
            if let loss = assessment.objective(.distanceDeviation)?.normalizedLoss,
               request.targetDistanceKm != nil,
               loss > policy.highQualityTargetToleranceRatio
            {
                return false
            }
            if let loss = assessment.objective(.durationDeviation)?.normalizedLoss,
               request.targetDurationMinutes != nil,
               loss > policy.highQualityTargetToleranceRatio
            {
                return false
            }
            if request.difficulty == .easy,
               request.activityType != .biking,
               !assessment.evidence.technicalDifficulty.hasStrongCoverage(using: policy)
            {
                return false
            }
            if request.avoidFeatures.contains(.majorRoads),
               !assessment.evidence.majorRoadRatio.hasStrongCoverage(using: policy)
            {
                return false
            }
            return !assessment.eligibility.warnings.contains(.physicalEffortHarderThanRequested)
        }
    }

    /// Route-local Release presentation. It deliberately excludes comparative
    /// statements that cannot be reconstructed after navigation drops the
    /// surrounding suggestion cohort.
    func presentation(for route: TrailRoute) -> RouteQualityExplanationSet {
        guard route.isVerifiedRoutedResult else {
            return RouteQualityExplanationSet(
                primaryFit: nil,
                verifiedCharacteristics: [],
                estimates: [],
                limitations: []
            )
        }
        let request = Self.request(from: route)
        let evidence = RouteEvidenceSnapshot.presentationSnapshot(route: route, policy: policy)
        return explanationSet(
            route: route,
            request: request,
            evidence: evidence,
            selected: []
        )
    }

    private func eligibility(
        route: TrailRoute,
        request: RoutePlanningRequest,
        analysis: RouteGeometryQualityAnalysis,
        evidence: RouteEvidenceSnapshot
    ) -> RouteEligibility {
        var warnings: [RouteQualityWarning] = []

        if let structural = RouteAlternativeQuality.rejection(
            for: route,
            analysis: analysis,
            request: request,
            policy: policy.structuralPolicy
        ) {
            return .rejected(.init(structuralRejection: structural))
        }
        guard route.routeType == request.routeType else {
            return .rejected(.routeTypeMismatch)
        }
        guard route.activity == request.activityType else {
            return .rejected(.activityMismatch)
        }
        guard !evidence.containsMalformedEvidence else {
            return .rejected(.unusableEvidencePayload)
        }

        if request.difficulty == .easy,
           request.activityType != .biking,
           let technical = evidence.technicalDifficulty.value,
           technical.maximumKnownHikeRating > policy.maximumKnownHikeRatingForEasyRequest,
           technical.demandingSectionDistanceMeters >= policy.minimumDemandingTechnicalDistanceMeters
        {
            return .rejected(.knownTechnicalDifficultyAboveEasyRequest)
        }
        if request.avoidFeatures.contains(.majorRoads),
           evidence.majorRoadRatio.hasStrongCoverage(using: policy),
           let ratio = evidence.majorRoadRatio.value,
           ratio > policy.maximumMajorRoadRatioWhenExplicitlyAvoided
        {
            return .rejected(.excessiveKnownMajorRoadExposure)
        }

        if let requestedDifficulty = request.difficulty,
           Self.difficultyRank(route.difficulty) > Self.difficultyRank(requestedDifficulty)
        {
            warnings.append(.physicalEffortHarderThanRequested)
        }
        if request.activityType != .biking {
            warnings.append(contentsOf: evidenceWarnings(
                metric: evidence.technicalDifficulty,
                unavailable: .technicalDifficultyUnavailable,
                limited: .technicalDifficultyCoverageLimited
            ))
            warnings.append(contentsOf: evidenceWarnings(
                metric: evidence.surfaceSuitability,
                unavailable: .surfaceEvidenceUnavailable,
                limited: .surfaceEvidenceCoverageLimited
            ))
        }
        warnings.append(contentsOf: evidenceWarnings(
            metric: evidence.majorRoadRatio,
            unavailable: .roadClassEvidenceUnavailable,
            limited: .roadClassEvidenceCoverageLimited
        ))
        if !request.desiredFeatures.isEmpty {
            warnings.append(.requestedPreferencesUnverified)
        }
        return .eligible(warnings: Self.uniqueWarnings(warnings))
    }

    private func evidenceWarnings<Value>(
        metric: RouteEvidenceMetric<Value>,
        unavailable: RouteQualityWarning,
        limited: RouteQualityWarning
    ) -> [RouteQualityWarning] where Value: Sendable {
        switch metric.status {
        case .known where (metric.coverageRatio ?? 0) < policy.minimumStrongEvidenceCoverage:
            [limited]
        case .unavailable, .unsupported, .stale:
            [unavailable]
        case .known, .malformed, .rejected:
            []
        }
    }

    private func objectives(
        route: TrailRoute,
        request: RoutePlanningRequest,
        analysis: RouteGeometryQualityAnalysis,
        evidence: RouteEvidenceSnapshot
    ) -> [RouteQualityObjective] {
        let distanceDeviation = request.targetDistanceKm.flatMap { target in
            target > 0 ? Self.normalized(abs(route.distanceKilometers - target) / target) : nil
        }
        let durationDeviation = request.targetDurationMinutes.flatMap { target in
            target > 0 ? Self.normalized(abs(Double(route.durationMinutes - target)) / Double(target)) : nil
        }
        // Use total ascent here, not ascent per kilometre. A longer route with
        // the same climb must never look physically easier merely because the
        // denominator grew; target distance is evaluated independently.
        let ascentLoad = Self.normalized(
            Double(route.elevationGainMeters) / policy.physicalEffortAscentNormalizationMeters
        ) ?? 1
        var physicalEffortFit: Double
        if let requested = request.difficulty {
            let difficultyGap = Double(
                abs(Self.difficultyRank(route.difficulty) - Self.difficultyRank(requested))
            ) / 2
            physicalEffortFit = min(
                difficultyGap * policy.requestedDifficultyGapWeight
                    + ascentLoad * policy.physicalEffortAscentWeight,
                1
            )
        } else {
            physicalEffortFit = ascentLoad
        }
        let technicalLoss: Double? = if request.activityType == .biking {
            nil
        } else {
            evidence.technicalDifficulty.value.flatMap {
                Self.normalized(Double($0.maximumKnownHikeRating) / 6)
            }
        }
        let surfaceLoss: Double? = if
            request.difficulty == .easy || request.avoidFeatures.contains(.steepClimbs),
            evidence.surfaceSuitability.hasStrongCoverage(using: policy),
            let surface = evidence.surfaceSuitability.value
        {
            Self.normalized(surface.roughSurfaceRatio)
        } else {
            nil
        }
        let pathLoss: Double? = if
            evidence.pathAndTrackRatio.hasStrongCoverage(using: policy),
            let ratio = evidence.pathAndTrackRatio.value
        {
            Self.normalized(1 - ratio)
        } else {
            nil
        }
        let majorRoadLoss: Double? = if
            evidence.majorRoadRatio.hasStrongCoverage(using: policy),
            let ratio = evidence.majorRoadRatio.value
        {
            Self.normalized(ratio)
        } else {
            nil
        }
        let relevantCoverage: [Double] = if request.activityType == .biking {
            [evidence.coverage.surface ?? 0, evidence.coverage.roadClass ?? 0]
        } else {
            [
                evidence.coverage.surface ?? 0,
                evidence.coverage.roadClass ?? 0,
                evidence.coverage.technicalDifficulty ?? 0
            ]
        }
        let meanCoverage = relevantCoverage.reduce(0, +) / Double(relevantCoverage.count)

        return [
            RouteQualityObjective(kind: .distanceDeviation, normalizedLoss: distanceDeviation, evidenceCoverage: 1),
            RouteQualityObjective(kind: .durationDeviation, normalizedLoss: durationDeviation, evidenceCoverage: 1),
            RouteQualityObjective(kind: .physicalEffortFit, normalizedLoss: physicalEffortFit, evidenceCoverage: 1),
            RouteQualityObjective(
                kind: .technicalDifficulty,
                normalizedLoss: technicalLoss,
                evidenceCoverage: evidence.technicalDifficulty.coverageRatio
            ),
            RouteQualityObjective(
                kind: .surfaceSuitability,
                normalizedLoss: surfaceLoss,
                evidenceCoverage: evidence.surfaceSuitability.coverageRatio
            ),
            RouteQualityObjective(
                kind: .pathAndTrackPreference,
                normalizedLoss: pathLoss,
                evidenceCoverage: evidence.pathAndTrackRatio.coverageRatio
            ),
            RouteQualityObjective(
                kind: .majorRoadExposure,
                normalizedLoss: majorRoadLoss,
                evidenceCoverage: evidence.majorRoadRatio.coverageRatio
            ),
            RouteQualityObjective(
                kind: .selfBacktracking,
                normalizedLoss: analysis.selfBacktrackingRatio.flatMap(Self.normalized),
                evidenceCoverage: analysis.selfBacktrackingRatio == nil ? nil : 1
            ),
            RouteQualityObjective(
                kind: .selfOverlap,
                normalizedLoss: analysis.selfOverlapRatio.flatMap(Self.normalized),
                evidenceCoverage: analysis.selfOverlapRatio == nil ? nil : 1
            ),
            RouteQualityObjective(
                kind: .loopShape,
                normalizedLoss: analysis.shapeQualityScore.flatMap { Self.normalized(1 - $0) },
                evidenceCoverage: analysis.shapeQualityScore == nil ? nil : 1
            ),
            RouteQualityObjective(
                kind: .pointToPointDetour,
                normalizedLoss: analysis.detourRatio.flatMap {
                    let normalizationRange = max(
                        policy.structuralPolicy.maximumPointToPointDetourRatio - 1,
                        policy.objectiveComparisonEpsilon
                    )
                    return Self.normalized(max($0 - 1, 0) / normalizationRange)
                },
                evidenceCoverage: analysis.detourRatio == nil ? nil : 1
            ),
            RouteQualityObjective(
                kind: .evidenceConfidence,
                normalizedLoss: Self.normalized(1 - meanCoverage),
                evidenceCoverage: 1
            )
        ]
    }

    private func assignParetoRanks(
        _ assessments: [RouteQualityAssessment]
    ) -> [RouteQualityAssessment] {
        var remaining = assessments
        var ranked: [RouteQualityAssessment] = []
        var rank = 0

        while !remaining.isEmpty {
            var front = remaining.filter { candidate in
                !remaining.contains { other in
                    guard other.providerIndex != candidate.providerIndex else { return false }
                    return comparison(other, candidate).dominance == .leftDominates
                }
            }
            if front.isEmpty {
                front = [remaining.min { $0.stableCandidateKey < $1.stableCandidateKey }!]
            }
            ranked.append(contentsOf: front.map { $0.withParetoRank(rank) })
            let frontIndices = Set(front.map(\.providerIndex))
            remaining.removeAll { frontIndices.contains($0.providerIndex) }
            rank += 1
        }
        return ranked
    }

    private func comparisons(
        for assessments: [RouteQualityAssessment]
    ) -> [RouteQualityComparison] {
        guard assessments.count >= 2 else { return [] }
        var result: [RouteQualityComparison] = []
        for leftIndex in 0..<(assessments.count - 1) {
            for rightIndex in (leftIndex + 1)..<assessments.count {
                result.append(comparison(assessments[leftIndex], assessments[rightIndex]))
            }
        }
        return result
    }

    /// Select one intent-best candidate from the current non-dominated front,
    /// then recompute the front. This keeps a candidate behind any route that
    /// directly dominates it without forcing every member of a broad first
    /// front ahead of a more relevant candidate whose dominator was selected.
    private func paretoAwareOrdering(
        _ assessments: [RouteQualityAssessment],
        request: RoutePlanningRequest
    ) -> [RouteQualityAssessment] {
        var remaining = assessments
        var ordered: [RouteQualityAssessment] = []

        while !remaining.isEmpty {
            var front = remaining.filter { candidate in
                !remaining.contains { other in
                    guard other.providerIndex != candidate.providerIndex else { return false }
                    return comparison(other, candidate).dominance == .leftDominates
                }
            }
            if front.isEmpty {
                front = remaining
            }
            let chosen = front.sorted {
                ranksBefore($0, $1, request: request)
            }.first!
            ordered.append(chosen)
            remaining.removeAll { $0.providerIndex == chosen.providerIndex }
        }
        return ordered
    }

    private func ranksBefore(
        _ left: RouteQualityAssessment,
        _ right: RouteQualityAssessment,
        request: RoutePlanningRequest
    ) -> Bool {
        if request.targetDurationMinutes != nil,
           let result = compareObjective(.durationDeviation, left, right)
        {
            return result
        }

        let prioritizesIntentTradeoff = request.difficulty == .easy
            || request.avoidFeatures.contains(.steepClimbs)
            || request.avoidFeatures.contains(.majorRoads)
            || request.avoidFeatures.contains(.repeatedPath)
        if prioritizesIntentTradeoff,
           request.targetDistanceKm != nil,
           let result = compareDistanceToleranceBucket(left, right)
        {
            return result
        }

        if request.difficulty == .easy, request.activityType != .biking,
           let result = compareObjective(.technicalDifficulty, left, right, preferKnown: true)
        {
            return result
        }
        if request.avoidFeatures.contains(.majorRoads),
           let result = compareObjective(.majorRoadExposure, left, right, preferKnown: true)
        {
            return result
        }
        if request.avoidFeatures.contains(.repeatedPath) {
            if let result = compareObjective(.selfOverlap, left, right) { return result }
            if let result = compareObjective(.selfBacktracking, left, right) { return result }
        }
        if request.difficulty == .easy || request.avoidFeatures.contains(.steepClimbs) {
            if let result = compareObjective(.physicalEffortFit, left, right) { return result }
            if let result = compareObjective(.surfaceSuitability, left, right, preferKnown: true) { return result }
        }
        if request.targetDistanceKm != nil,
           let result = compareObjective(.distanceDeviation, left, right)
        {
            return result
        }

        if request.activityType != .biking {
            if let result = compareObjective(.pathAndTrackPreference, left, right, preferKnown: true) { return result }
            if let result = compareObjective(.majorRoadExposure, left, right, preferKnown: true) { return result }
        }
        for kind in [
            RouteQualityObjective.Kind.selfBacktracking,
            .selfOverlap,
            .loopShape,
            .pointToPointDetour
        ] {
            if let result = compareObjective(kind, left, right) { return result }
        }
        if let result = compareObjective(.physicalEffortFit, left, right) { return result }
        if let result = compareObjective(.evidenceConfidence, left, right) { return result }

        if left.route.durationMinutes != right.route.durationMinutes {
            return left.route.durationMinutes < right.route.durationMinutes
        }
        if left.route.distanceKilometers != right.route.distanceKilometers {
            return left.route.distanceKilometers < right.route.distanceKilometers
        }
        return left.stableCandidateKey < right.stableCandidateKey
    }

    private func compareDistanceToleranceBucket(
        _ left: RouteQualityAssessment,
        _ right: RouteQualityAssessment
    ) -> Bool? {
        guard
            let leftLoss = left.objective(.distanceDeviation)?.normalizedLoss,
            let rightLoss = right.objective(.distanceDeviation)?.normalizedLoss
        else { return nil }
        let leftBucket = leftLoss <= policy.easyTargetToleranceRatio ? 0 : 1
        let rightBucket = rightLoss <= policy.easyTargetToleranceRatio ? 0 : 1
        guard leftBucket != rightBucket else { return nil }
        return leftBucket < rightBucket
    }

    private func compareObjective(
        _ kind: RouteQualityObjective.Kind,
        _ left: RouteQualityAssessment,
        _ right: RouteQualityAssessment,
        preferKnown: Bool = false
    ) -> Bool? {
        let leftValue = left.objective(kind)?.normalizedLoss
        let rightValue = right.objective(kind)?.normalizedLoss
        switch (leftValue, rightValue) {
        case let (left?, right?):
            guard abs(left - right) > policy.objectiveComparisonEpsilon else { return nil }
            return left < right
        case (_?, nil) where preferKnown:
            return true
        case (nil, _?) where preferKnown:
            return false
        default:
            return nil
        }
    }

    private func explanationSet(
        route: TrailRoute,
        request: RoutePlanningRequest,
        evidence: RouteEvidenceSnapshot,
        selected: [RouteQualityAssessment]
    ) -> RouteQualityExplanationSet {
        let primary = primaryFitExplanation(route: route, request: request)
        var characteristics: [RouteQualityPresentationItem] = []

        if evidence.pathAndTrackRatio.hasStrongCoverage(using: policy),
           let ratio = evidence.pathAndTrackRatio.value,
           ratio >= policy.minimumPathAndTrackRatioForFact
        {
            let title = "\(Self.percentLabel(ratio)) paths and tracks"
            let detail = "Road-class data covers \(Self.percentLabel(evidence.pathAndTrackRatio.coverageRatio ?? 0)) of this route."
            characteristics.append(Self.item(
                role: .verifiedCharacteristic,
                code: .pathsAndTracks,
                title: title,
                detail: detail,
                symbol: "point.bottomleft.forward.to.point.topright.scurvepath",
                voiceOverPrefix: "Mapped route fact"
            ))
        }

        if evidence.majorRoadRatio.hasStrongCoverage(using: policy),
           let ratio = evidence.majorRoadRatio.value,
           (request.avoidFeatures.contains(.majorRoads) || ratio >= policy.minimumMajorRoadRatioForFact)
        {
            let isLowest = !selected.isEmpty && Self.isUniqueMinimum(
                route: route,
                values: selected.compactMap { assessment in
                    assessment.evidence.majorRoadRatio.hasStrongCoverage(using: policy)
                        ? assessment.evidence.majorRoadRatio.value.map { (assessment.route.id, $0) }
                        : nil
                }
            )
            let title = isLowest
                ? "Lowest measured road exposure"
                : "\(Self.percentLabel(ratio)) major-road exposure"
            let detail = "Road-class data covers \(Self.percentLabel(evidence.majorRoadRatio.coverageRatio ?? 0)) of this route."
            characteristics.append(Self.item(
                role: .verifiedCharacteristic,
                code: .majorRoadExposure,
                title: title,
                detail: detail,
                symbol: "road.lanes",
                voiceOverPrefix: "Mapped route fact"
            ))
        }

        if let technical = evidence.technicalDifficulty.value,
           technical.maximumKnownHikeRating > policy.maximumKnownHikeRatingForEasyRequest
        {
            let distance = technical.demandingSectionDistanceMeters / 1_000
            let detail = "\(Self.distanceLabel(distance)) is mapped above the basic hiking classification; hike-rating data covers \(Self.percentLabel(evidence.technicalDifficulty.coverageRatio ?? 0)) of the route."
            characteristics.append(Self.item(
                role: .verifiedCharacteristic,
                code: .technicalSections,
                title: "Contains mapped mountain-hiking sections",
                detail: detail,
                symbol: "mountain.2.fill",
                voiceOverPrefix: "Mapped technical route fact"
            ))
        }

        if route.routeType == .loop,
           let geometry = evidence.geometry.value,
           let overlap = geometry.selfOverlapRatio,
           overlap <= policy.maximumLowRepeatedPathRatioForFact
        {
            characteristics.append(Self.item(
                role: .verifiedCharacteristic,
                code: .lowRepeatedPath,
                title: "\(Self.percentLabel(overlap)) repeated path",
                detail: "Calculated from the routed loop geometry.",
                symbol: "point.bottomleft.forward.to.point.topright.scurvepath",
                voiceOverPrefix: "Measured geometry fact"
            ))
        }

        let effortDetail = "Based on \(route.distanceLabel) and \(route.elevationGainMeters.formatted()) m climb. Technical trail difficulty is assessed separately."
        let estimate = Self.item(
            role: .estimate,
            code: .physicalEffortEstimate,
            title: "Physical effort estimate: \(route.difficulty.rawValue)",
            detail: effortDetail,
            symbol: route.difficulty.symbol,
            voiceOverPrefix: "Estimate"
        )

        var limitations: [RouteQualityPresentationItem] = []
        if request.activityType != .biking {
            if evidence.technicalDifficulty.status != .known {
                limitations.append(Self.item(
                    role: .limitation,
                    code: .technicalDifficultyUnavailable,
                    title: "Technical trail difficulty data unavailable",
                    detail: "Missing hike-rating data is not treated as proof that the route is technically easy.",
                    symbol: "questionmark.circle",
                    voiceOverPrefix: "Data limitation"
                ))
            } else if (evidence.technicalDifficulty.coverageRatio ?? 0) < policy.minimumStrongEvidenceCoverage {
                limitations.append(Self.item(
                    role: .limitation,
                    code: .technicalDifficultyCoverageLimited,
                    title: "Technical difficulty data covers only \(Self.percentLabel(evidence.technicalDifficulty.coverageRatio ?? 0))",
                    detail: "Unmapped sections remain unknown.",
                    symbol: "chart.bar.xaxis",
                    voiceOverPrefix: "Data limitation"
                ))
            }
        }
        if evidence.surfaceSuitability.status == .known,
           (evidence.surfaceSuitability.coverageRatio ?? 0) < policy.minimumStrongEvidenceCoverage
        {
            limitations.append(Self.item(
                role: .limitation,
                code: .surfaceCoverageLimited,
                title: "Surface information covers only \(Self.percentLabel(evidence.surfaceSuitability.coverageRatio ?? 0))",
                detail: "Unknown sections are not treated as paved or unpaved.",
                symbol: "chart.bar.xaxis",
                voiceOverPrefix: "Data limitation"
            ))
        } else if request.activityType != .biking,
                  request.difficulty == .easy || request.avoidFeatures.contains(.steepClimbs),
                  evidence.surfaceSuitability.status != .known
        {
            limitations.append(Self.item(
                role: .limitation,
                code: .surfaceEvidenceUnavailable,
                title: "Surface evidence unavailable",
                detail: "Missing surface data is not treated as proof that the route is easy underfoot.",
                symbol: "questionmark.circle",
                voiceOverPrefix: "Data limitation"
            ))
        }
        if evidence.majorRoadRatio.status == .known,
           (evidence.majorRoadRatio.coverageRatio ?? 0) < policy.minimumStrongEvidenceCoverage
        {
            limitations.append(Self.item(
                role: .limitation,
                code: .roadClassCoverageLimited,
                title: "Road-class information covers only \(Self.percentLabel(evidence.majorRoadRatio.coverageRatio ?? 0))",
                detail: "Low measured exposure cannot confirm low road exposure for the whole route.",
                symbol: "chart.bar.xaxis",
                voiceOverPrefix: "Data limitation"
            ))
        } else if request.avoidFeatures.contains(.majorRoads),
                  evidence.majorRoadRatio.status != .known
        {
            limitations.append(Self.item(
                role: .limitation,
                code: .roadClassEvidenceUnavailable,
                title: "Road-class evidence unavailable",
                detail: "Wanderful cannot confirm low major-road exposure without current road-class data.",
                symbol: "questionmark.circle",
                voiceOverPrefix: "Data limitation"
            ))
        }
        if !request.desiredFeatures.isEmpty {
            let labels = request.desiredFeatures.map(\.label).joined(separator: ", ")
            limitations.append(Self.item(
                role: .limitation,
                code: .requestedPreferencesUnverified,
                title: "Requested preferences are not yet verified",
                detail: "Requested: \(labels). Wanderful does not yet have route-corridor evidence for these preferences.",
                symbol: "checklist.unchecked",
                voiceOverPrefix: "Evidence limitation"
            ))
        }
        if evidence.pathAndTrackRatio.status != .known,
           evidence.surfaceSuitability.status != .known,
           evidence.technicalDifficulty.status != .known,
           limitations.isEmpty
        {
            limitations.append(Self.item(
                role: .limitation,
                code: .mappedEvidenceUnavailable,
                title: "Mapped route-characteristic data unavailable",
                detail: "Distance, duration and climb are routed facts; surface, road class and technical difficulty remain unknown.",
                symbol: "questionmark.circle",
                voiceOverPrefix: "Data limitation"
            ))
        }

        // Safety-relevant mapped technical sections must survive the narrow
        // two-fact Release budget. Preserve insertion order for all other facts.
        let prioritizedCharacteristics = characteristics.enumerated()
            .sorted { left, right in
                let leftPriority = left.element.code == .technicalSections ? 0 : 1
                let rightPriority = right.element.code == .technicalSections ? 0 : 1
                return leftPriority == rightPriority
                    ? left.offset < right.offset
                    : leftPriority < rightPriority
            }
            .map(\.element)

        // A limitation tied to an explicit avoidance request is more actionable
        // than generic coverage limits and must remain visible in the UI budget.
        let prioritizedLimitations = Self.uniqueItems(limitations).enumerated()
            .sorted { left, right in
                func priority(_ item: RouteQualityPresentationItem) -> Int {
                    if request.avoidFeatures.contains(.majorRoads),
                       item.code == .roadClassCoverageLimited
                        || item.code == .roadClassEvidenceUnavailable
                    {
                        return 0
                    }
                    switch item.code {
                    case .technicalDifficultyUnavailable, .technicalDifficultyCoverageLimited: return 1
                    case .roadClassEvidenceUnavailable, .roadClassCoverageLimited: return 2
                    case .surfaceEvidenceUnavailable, .surfaceCoverageLimited: return 3
                    case .requestedPreferencesUnverified: return 4
                    default: return 5
                    }
                }
                let leftPriority = priority(left.element)
                let rightPriority = priority(right.element)
                return leftPriority == rightPriority
                    ? left.offset < right.offset
                    : leftPriority < rightPriority
            }
            .map(\.element)

        return RouteQualityExplanationSet(
            primaryFit: primary,
            verifiedCharacteristics: Array(
                prioritizedCharacteristics.prefix(
                    policy.maximumVerifiedCharacteristicExplanationCount
                )
            ),
            estimates: [estimate],
            // Keep every distinct limitation in the evidence contract. The card
            // and detail views own their respective two/five-item presentation
            // budgets, while tests and future clients can still inspect every
            // request-relevant unknown instead of silently losing it here.
            limitations: prioritizedLimitations
        )
    }

    private func primaryFitExplanation(
        route: TrailRoute,
        request: RoutePlanningRequest
    ) -> RouteQualityPresentationItem? {
        if let target = request.targetDistanceKm, target > 0 {
            let difference = route.distanceKilometers - target
            let title: String = if abs(difference) < 0.05 {
                "At your requested distance"
            } else {
                "\(Self.distanceLabel(abs(difference))) \(difference < 0 ? "under" : "over") your requested distance"
            }
            let detail = "Actual \(route.distanceLabel) versus requested \(Self.distanceLabel(target))."
            return Self.item(
                role: .primaryFit,
                code: .distanceFit,
                title: title,
                detail: detail,
                symbol: "ruler",
                voiceOverPrefix: "Request fit"
            )
        }
        if let target = request.targetDurationMinutes, target > 0 {
            let difference = route.durationMinutes - target
            let title: String = if difference == 0 {
                "At your requested time"
            } else {
                "\(abs(difference)) min \(difference < 0 ? "under" : "over") your requested time"
            }
            let detail = "Actual \(route.durationLabel) versus requested \(Self.durationLabel(target))."
            return Self.item(
                role: .primaryFit,
                code: .durationFit,
                title: title,
                detail: detail,
                symbol: "clock",
                voiceOverPrefix: "Request fit"
            )
        }
        return nil
    }

    private static func item(
        role: RouteQualityExplanationRole,
        code: RouteQualityExplanationCode,
        title: String,
        detail: String?,
        symbol: String,
        voiceOverPrefix: String
    ) -> RouteQualityPresentationItem {
        RouteQualityPresentationItem(
            role: role,
            code: code,
            title: title,
            detail: detail,
            symbol: symbol,
            accessibilityLabel: [voiceOverPrefix, title, detail].compactMap(\.self).joined(separator: ". ")
        )
    }

    private static func request(from route: TrailRoute) -> RoutePlanningRequest {
        let metadata = route.planningMetadata
        return RoutePlanningRequest(
            routeType: metadata?.routeType ?? route.routeType,
            startQuery: route.location.isEmpty ? "Start" : route.location,
            endQuery: route.routeType == .loop ? nil : "Finish",
            activityType: metadata?.activityType ?? route.activity,
            graphHopperProfile: route.activity == .biking ? "bike" : "foot",
            targetDistanceKm: metadata?.targetDistanceKm,
            targetDurationMinutes: metadata?.targetDurationMinutes,
            difficulty: metadata?.difficulty,
            desiredFeatures: metadata?.desiredFeatures ?? [],
            avoidFeatures: metadata?.avoidFeatures ?? []
        )
    }

    private static func stableCandidateKey(for route: TrailRoute) -> String {
        let forward = canonicalGeometryComponents(route.path)
        let reverse = canonicalGeometryComponents(Array(route.path.reversed()))
        let geometry = forward.lexicographicallyPrecedes(reverse) ? forward : reverse
        return ([
            route.title,
            route.activity.rawValue,
            route.routeType.rawValue,
            String(route.distanceKilometers.bitPattern),
            String(route.durationHours.bitPattern),
            String(route.elevationGainMeters),
            geometry.joined(separator: ":"),
            route.id.uuidString
        ]).joined(separator: "|")
    }

    private static func canonicalGeometryComponents(_ path: [Coordinate]) -> [String] {
        guard !path.isEmpty else { return [] }
        let maximumCount = 32
        let indices: [Int] = if path.count <= maximumCount {
            Array(path.indices)
        } else {
            (0..<maximumCount).map { index in
                Int((Double(index) * Double(path.count - 1) / Double(maximumCount - 1)).rounded())
            }
        }
        return indices.map { index in
            let point = path[index]
            return "\(Int((point.latitude * 100_000).rounded())),\(Int((point.longitude * 100_000).rounded()))"
        }
    }

    private static func isUniqueMinimum(
        route: TrailRoute,
        values: [(UUID, Double)]
    ) -> Bool {
        guard let minimum = values.map(\.1).min() else { return false }
        let matching = values.filter { abs($0.1 - minimum) <= 0.000_001 }
        return matching.count == 1 && matching.first?.0 == route.id
    }

    private static func normalized(_ value: Double) -> Double? {
        guard value.isFinite else { return nil }
        return min(max(value, 0), 1)
    }

    private static func difficultyRank(_ difficulty: RouteDifficulty) -> Int {
        switch difficulty {
        case .easy: 0
        case .moderate: 1
        case .challenging: 2
        }
    }

    private static func uniqueWarnings(_ warnings: [RouteQualityWarning]) -> [RouteQualityWarning] {
        var seen = Set<RouteQualityWarning>()
        return warnings.filter { seen.insert($0).inserted }
    }

    private static func uniqueItems(
        _ items: [RouteQualityPresentationItem]
    ) -> [RouteQualityPresentationItem] {
        var seen = Set<RouteQualityExplanationCode>()
        return items.filter { seen.insert($0.code).inserted }
    }

    private static func distanceLabel(_ distance: Double) -> String {
        distance.formatted(
            .number
                .locale(Locale(identifier: "en_US_POSIX"))
                .precision(.fractionLength(distance.rounded() == distance ? 0 : 1))
        ) + " km"
    }

    private static func durationLabel(_ minutes: Int) -> String {
        let hours = minutes / 60
        let remainder = minutes % 60
        if hours == 0 { return "\(minutes) min" }
        if remainder == 0 { return "\(hours) hr" }
        return "\(hours) hr \(remainder) min"
    }

    private static func percentLabel(_ ratio: Double) -> String {
        "\(Int((min(max(ratio, 0), 1) * 100).rounded()))%"
    }
}
