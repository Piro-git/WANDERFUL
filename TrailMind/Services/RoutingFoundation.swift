import Foundation

struct LoopSearchPolicy: Hashable, Sendable {
    static let comparisonDefault = LoopSearchPolicy()

    let targetSuggestionCount: Int
    let minimumComparableSuggestionCount: Int
    let totalBudgetSeconds: TimeInterval
    let maximumConcurrentRequests: Int

    init(
        targetSuggestionCount: Int = 3,
        minimumComparableSuggestionCount: Int = 2,
        totalBudgetSeconds: TimeInterval = 25,
        maximumConcurrentRequests: Int = 2
    ) {
        self.targetSuggestionCount = targetSuggestionCount
        self.minimumComparableSuggestionCount = minimumComparableSuggestionCount
        self.totalBudgetSeconds = totalBudgetSeconds
        self.maximumConcurrentRequests = maximumConcurrentRequests
    }
}

enum LoopSearchOutcome: Hashable, Sendable {
    case comparison(routeCount: Int)
    case singleRoute
}

struct LoopSearchDiagnostics: Hashable, Sendable {
    let elapsedMilliseconds: Int
    let directRouteCount: Int
    let fallbackRouteCount: Int
    let rejectionCounts: [String: Int]
    let didReachTimeBudget: Bool

    static func empty(elapsedMilliseconds: Int = 0) -> LoopSearchDiagnostics {
        LoopSearchDiagnostics(
            elapsedMilliseconds: elapsedMilliseconds,
            directRouteCount: 0,
            fallbackRouteCount: 0,
            rejectionCounts: [:],
            didReachTimeBudget: false
        )
    }
}

struct RouteIntent: Hashable {
    let request: RoutePlanningRequest
    let start: Coordinate
    let end: Coordinate?
    let parsedIntent: ValidatedAdventureIntent?
    let loopSearchPolicy: LoopSearchPolicy?
    let loopSearchDeadline: Date?

    init(
        request: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate?,
        parsedIntent: ValidatedAdventureIntent? = nil,
        loopSearchPolicy: LoopSearchPolicy? = nil,
        loopSearchDeadline: Date? = nil
    ) {
        self.request = request
        self.start = start
        self.end = end
        self.parsedIntent = parsedIntent
        self.loopSearchPolicy = loopSearchPolicy
        self.loopSearchDeadline = loopSearchDeadline
    }

    var hasExpiredLoopSearchBudget: Bool {
        guard let loopSearchDeadline else { return false }
        return Date() >= loopSearchDeadline
    }
}

struct RoutingResult {
    let suggestions: [RouteSuggestion]
    let notice: String?
    let loopSearchOutcome: LoopSearchOutcome?
    let loopSearchDiagnostics: LoopSearchDiagnostics?
    let routeQualityPolicyVersion: String?

    init(
        suggestions: [RouteSuggestion],
        notice: String?,
        loopSearchOutcome: LoopSearchOutcome? = nil,
        loopSearchDiagnostics: LoopSearchDiagnostics? = nil,
        routeQualityPolicyVersion: String? = nil
    ) {
        self.suggestions = suggestions
        self.notice = notice
        self.loopSearchOutcome = loopSearchOutcome
        self.loopSearchDiagnostics = loopSearchDiagnostics
        self.routeQualityPolicyVersion = routeQualityPolicyVersion
    }
}

enum RoutingError: LocalizedError, Equatable {
    case loopRouteNotFound
    case routeQualityRejected

    var errorDescription: String? {
        switch self {
        case .loopRouteNotFound:
            "GraphHopper couldn’t build a loop route from this start. Try a nearby trailhead or a different duration."
        case .routeQualityRejected:
            "The routing provider did not return a structurally usable route. Try nearby start or finish points."
        }
    }
}

protocol RoutingCoordinating {
    func routeSuggestions(for intent: RouteIntent) async throws -> RoutingResult
}

protocol RoutingProvider {
    func routeSuggestions(for intent: RouteIntent) async throws -> [RouteSuggestion]
}

struct RoutingCoordinator: RoutingCoordinating {
    private let primaryProvider: any RoutingProvider
    private let loopFallbackProvider: any RoutingProvider
    private let loopSearchPolicy: LoopSearchPolicy

    init(
        primaryProvider: any RoutingProvider = GraphHopperRoutingProvider(),
        loopFallbackProvider: any RoutingProvider = LoopFallbackProvider(),
        loopSearchPolicy: LoopSearchPolicy = .comparisonDefault
    ) {
        self.primaryProvider = primaryProvider
        self.loopFallbackProvider = loopFallbackProvider
        self.loopSearchPolicy = loopSearchPolicy
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> RoutingResult {
        let searchStartedAt = Date()
        let routingIntent = intent.request.routeType == .loop
            ? RouteIntent(
                request: intent.request,
                start: intent.start,
                end: intent.end,
                parsedIntent: intent.parsedIntent,
                loopSearchPolicy: loopSearchPolicy,
                loopSearchDeadline: searchStartedAt.addingTimeInterval(loopSearchPolicy.totalBudgetSeconds)
            )
            : intent
        do {
            let primarySuggestions = try await primaryProvider.routeSuggestions(for: routingIntent)
            try Self.validateProductionSuggestions(primarySuggestions)
            switch routingIntent.request.routeType {
            case .multiDay:
                return RoutingResult(suggestions: primarySuggestions, notice: nil)
            case .pointToPoint:
                let normalization = RouteSuggestionNormalizer.normalizedSuggestions(
                    from: primarySuggestions,
                    request: routingIntent.request,
                    maximumSuggestions: RouteAlternativeQualityPolicy.preBaseline.maximumSuggestions
                )
                guard !normalization.suggestions.isEmpty else {
                    throw RoutingError.routeQualityRejected
                }
                return RoutingResult(
                    suggestions: normalization.suggestions,
                    notice: nil,
                    routeQualityPolicyVersion: normalization.qualityPolicyVersion
                )
            case .loop:
                break
            }

            let primaryNormalization = RouteSuggestionNormalizer.normalizedSuggestions(
                from: primarySuggestions,
                request: routingIntent.request,
                maximumSuggestions: loopSearchPolicy.targetSuggestionCount
            )
            let distinctPrimary = primaryNormalization.suggestions
            let hasSufficientPrimaryQuality = HikingRouteQualityEngine()
                .hasSufficientHighQualityDistinctCandidates(
                    distinctPrimary,
                    request: routingIntent.request,
                    minimumCandidateCount: loopSearchPolicy.minimumComparableSuggestionCount
                )
            if distinctPrimary.count >= loopSearchPolicy.minimumComparableSuggestionCount,
               hasSufficientPrimaryQuality
            {
                return loopResult(
                    suggestions: distinctPrimary,
                    notice: nil,
                    searchStartedAt: searchStartedAt,
                    directRouteCount: distinctPrimary.count,
                    fallbackRouteCount: 0,
                    rejectionCounts: primaryNormalization.rejectionCounts,
                    request: routingIntent.request
                )
            }

            return try await supplementedLoopSuggestions(
                primarySuggestions: distinctPrimary,
                primaryRejectionCounts: primaryNormalization.rejectionCounts,
                for: routingIntent,
                searchStartedAt: searchStartedAt
            )
        } catch let error as GraphHopperError
            where routingIntent.request.routeType == .loop && error.shouldTryLoopFallback
        {
            let notice = error.isFlexibleModeUnavailable
                ? "GraphHopper round trips need flexible mode on this API plan, so Wanderful built loop options from normal routed segments."
                : "GraphHopper could not build a direct round trip, so Wanderful tried alternate loop shapes from the same start."
            do {
                let fallback = try await fallbackSearch(
                    for: routingIntent,
                    excluding: []
                )
                return loopResult(
                    suggestions: fallback.suggestions,
                    notice: notice,
                    searchStartedAt: searchStartedAt,
                    directRouteCount: 0,
                    fallbackRouteCount: fallback.suggestions.count,
                    rejectionCounts: fallback.rejectionCounts,
                    request: routingIntent.request
                )
            } catch let fallbackError as GraphHopperError where fallbackError.isNoRouteFound {
                throw RoutingError.loopRouteNotFound
            }
        } catch let error as GraphHopperError
            where routingIntent.request.routeType == .loop && error.isNoRouteFound {
            throw RoutingError.loopRouteNotFound
        }
    }

    private func supplementedLoopSuggestions(
        primarySuggestions: [RouteSuggestion],
        primaryRejectionCounts: [String: Int],
        for intent: RouteIntent,
        searchStartedAt: Date
    ) async throws -> RoutingResult {
        let distinctPrimary = primarySuggestions

        guard !intent.hasExpiredLoopSearchBudget else {
            return loopResult(
                suggestions: distinctPrimary,
                notice: nil,
                searchStartedAt: searchStartedAt,
                directRouteCount: distinctPrimary.count,
                fallbackRouteCount: 0,
                rejectionCounts: Self.mergingRejectionCounts(
                    primaryRejectionCounts,
                    ["time_budget_expired": 1]
                ),
                request: intent.request
            )
        }

        do {
            let fallback = try await fallbackSearch(
                for: intent,
                excluding: distinctPrimary.map(\.route)
            )
            let combinedNormalization = RouteSuggestionNormalizer.normalizedSuggestions(
                from: distinctPrimary + fallback.suggestions,
                request: intent.request,
                maximumSuggestions: loopSearchPolicy.targetSuggestionCount
            )
            let comparableSuggestions = combinedNormalization.suggestions
            let notice = comparableSuggestions.count >= loopSearchPolicy.minimumComparableSuggestionCount
                ? "Wanderful found distinct real loop options from the same start for comparison."
                : nil
            return loopResult(
                suggestions: comparableSuggestions,
                notice: notice,
                searchStartedAt: searchStartedAt,
                directRouteCount: distinctPrimary.count,
                fallbackRouteCount: fallback.suggestions.count,
                rejectionCounts: Self.mergingRejectionCounts(
                    primaryRejectionCounts,
                    fallback.rejectionCounts,
                    combinedNormalization.rejectionCounts
                ),
                request: intent.request
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            guard !distinctPrimary.isEmpty else {
                throw RoutingError.loopRouteNotFound
            }
            return loopResult(
                suggestions: distinctPrimary,
                notice: nil,
                searchStartedAt: searchStartedAt,
                directRouteCount: distinctPrimary.count,
                fallbackRouteCount: 0,
                rejectionCounts: Self.mergingRejectionCounts(
                    primaryRejectionCounts,
                    ["fallback_unavailable": 1]
                ),
                request: intent.request
            )
        }
    }

    private func fallbackSearch(
        for intent: RouteIntent,
        excluding routes: [TrailRoute]
    ) async throws -> LoopFallbackSearchResult {
        let signatures = routes.compactMap { route -> String? in
            let signature = LoopFallbackProvider.geometrySignature(for: route)
            return signature.isEmpty ? nil : signature
        }
        if let provider = loopFallbackProvider as? LoopFallbackProvider {
            let result = try await provider.search(
                for: intent,
                excluding: Set(signatures),
                excludingGeometries: routes.map(\.path)
            )
            try Self.validateProductionSuggestions(result.suggestions)
            let normalization = RouteSuggestionNormalizer.normalizedSuggestions(
                from: result.suggestions,
                request: intent.request,
                maximumSuggestions: loopSearchPolicy.targetSuggestionCount
            )
            guard !normalization.suggestions.isEmpty else {
                throw GraphHopperError.noRouteFound
            }
            return LoopFallbackSearchResult(
                suggestions: normalization.suggestions,
                rejectionCounts: Self.mergingRejectionCounts(
                    result.rejectionCounts,
                    normalization.rejectionCounts
                ),
                didReachTimeBudget: result.didReachTimeBudget
            )
        }
        let suggestions = try await loopFallbackProvider.routeSuggestions(for: intent)
        try Self.validateProductionSuggestions(suggestions)
        let normalization = RouteSuggestionNormalizer.normalizedSuggestions(
            from: suggestions,
            request: intent.request,
            maximumSuggestions: loopSearchPolicy.targetSuggestionCount
        )
        guard !normalization.suggestions.isEmpty else {
            throw GraphHopperError.noRouteFound
        }
        return LoopFallbackSearchResult(
            suggestions: normalization.suggestions,
            rejectionCounts: normalization.rejectionCounts,
            didReachTimeBudget: intent.hasExpiredLoopSearchBudget
        )
    }

    private static func validateProductionSuggestions(
        _ suggestions: [RouteSuggestion]
    ) throws {
        for suggestion in suggestions {
            try RouteEligibilityPolicy.validate(
                suggestion.route,
                for: .productionSuccess
            )
        }
    }

    private static func mergingRejectionCounts(
        _ dictionaries: [String: Int]...
    ) -> [String: Int] {
        dictionaries.reduce(into: [:]) { result, dictionary in
            for (reason, count) in dictionary {
                result[reason, default: 0] += count
            }
        }
    }

    private func loopResult(
        suggestions: [RouteSuggestion],
        notice: String?,
        searchStartedAt: Date,
        directRouteCount: Int,
        fallbackRouteCount: Int,
        rejectionCounts: [String: Int],
        request: RoutePlanningRequest
    ) -> RoutingResult {
        let elapsedMilliseconds = max(0, Int(Date().timeIntervalSince(searchStartedAt) * 1_000))
        let diagnostics = LoopSearchDiagnostics(
            elapsedMilliseconds: elapsedMilliseconds,
            directRouteCount: directRouteCount,
            fallbackRouteCount: fallbackRouteCount,
            rejectionCounts: rejectionCounts,
            didReachTimeBudget: elapsedMilliseconds >= Int(loopSearchPolicy.totalBudgetSeconds * 1_000)
                || rejectionCounts["time_budget_expired"] != nil
        )
        let outcome: LoopSearchOutcome = suggestions.count >= loopSearchPolicy.minimumComparableSuggestionCount
            ? .comparison(routeCount: suggestions.count)
            : .singleRoute
        let minimumElevation = suggestions.map(\.route.elevationGainMeters).min()
        let shapedSuggestions = suggestions.enumerated().map { index, suggestion in
            let shapingSummary = RouteShapingSummary.loop(
                request: request,
                lowerElevationApplied: suggestions.count >= 2
                    && index == 0
                    && suggestion.route.elevationGainMeters == minimumElevation
            )
            let metadata = (suggestion.route.planningMetadata ?? request.metadata)
                .withRouteShapingSummary(shapingSummary)
            return RouteSuggestion(
                id: suggestion.id,
                route: suggestion.route.withPlanningMetadata(metadata),
                explanation: suggestion.explanation,
                debugMetadata: suggestion.debugMetadata
            )
        }
        return RoutingResult(
            suggestions: shapedSuggestions,
            notice: notice,
            loopSearchOutcome: outcome,
            loopSearchDiagnostics: diagnostics,
            routeQualityPolicyVersion: HikingRouteQualityPolicyVersion.v1.rawValue
        )
    }
}

private extension GraphHopperError {
    var isNoRouteFound: Bool {
        if case .noRouteFound = self {
            return true
        }
        return false
    }

    var shouldTryLoopFallback: Bool {
        isFlexibleModeUnavailable || isNoRouteFound
    }
}

struct GraphHopperRoutingProvider: RoutingProvider {
    private let client: any GraphHopperRouteCalculating
    private let loopSeeds: [Int]

    init(
        client: any GraphHopperRouteCalculating = GraphHopperClient(),
        loopSeeds: [Int] = [11, 29, 47]
    ) {
        self.client = client
        self.loopSeeds = loopSeeds
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> [RouteSuggestion] {
        let routes: [TrailRoute]
        switch intent.request.routeType {
        case .loop:
            routes = try await client.calculateRoundTripRouteVariants(
                start: intent.start,
                request: intent.request,
                seeds: loopSeeds,
                deadline: intent.loopSearchDeadline,
                maximumConcurrentRequests: intent.loopSearchPolicy?.maximumConcurrentRequests ?? 1
            )
        case .pointToPoint:
            guard let end = intent.end else {
                throw RoutePromptParserError.invalidPrompt
            }
            routes = try await client.calculatePointToPointRouteVariants(
                request: intent.request,
                start: intent.start,
                end: end
            )
        case .multiDay:
            guard let end = intent.end else {
                throw RoutePromptParserError.invalidPrompt
            }
            routes = [try await client.calculateGraphHopperRoute(
                request: intent.request,
                start: intent.start,
                end: end
            )]
        }

        for route in routes {
            try RouteEligibilityPolicy.validate(route, for: .productionSuccess)
        }

        return RouteSuggestionNormalizer.suggestions(from: routes)
    }
}

protocol GraphHopperMultiPointRouteCalculating {
    func calculateGraphHopperRoute(
        waypoints: [Coordinate],
        request: RoutePlanningRequest,
        seed: Int?
    ) async throws -> TrailRoute

    func calculateGraphHopperRoute(
        waypoints: [Coordinate],
        request: RoutePlanningRequest,
        seed: Int?,
        deadline: Date?
    ) async throws -> TrailRoute
}

extension GraphHopperMultiPointRouteCalculating {
    func calculateGraphHopperRoute(
        waypoints: [Coordinate],
        request: RoutePlanningRequest,
        seed: Int?,
        deadline: Date?
    ) async throws -> TrailRoute {
        try await calculateGraphHopperRoute(
            waypoints: waypoints,
            request: request,
            seed: seed
        )
    }
}

// The production URLSession client supports two in-flight requests. Other
// conformers stay sequential unless they opt in, which keeps custom/test
// clients deterministic.
protocol ConcurrentGraphHopperMultiPointRouteCalculating: GraphHopperMultiPointRouteCalculating { }

enum LoopFallbackBearingPattern: String, CaseIterable, Hashable {
    case leftArc = "left_arc"
    case rightArc = "right_arc"
    case wideTriangle = "wide_triangle"
    case compactTriangle = "compact_triangle"
    case clockwise = "clockwise"
    case counterclockwise = "counterclockwise"
}

struct LoopFallbackSearchResult {
    let suggestions: [RouteSuggestion]
    let rejectionCounts: [String: Int]
    let didReachTimeBudget: Bool
}

struct LoopFallbackProvider: RoutingProvider {
    private static let maximumAcceptableOverlap = 0.40
    private static let maximumShapeAwareOverlap = 0.65
    private static let minimumShapeQualityForSharedSections = 0.35

    struct Candidate: Hashable {
        let index: Int
        let seed: Int
        let radiusKm: Double
        let radiusFactor: Double
        let baseBearingDegrees: Double
        let bearingPattern: LoopFallbackBearingPattern
        let waypoints: [Coordinate]
    }

    private struct CandidateOutcome {
        var accepted: [LoopRouteVariantRanker.Variant] = []
        var rejectionReasons: [String] = []
        var rejectionCounts: [String: Int] = [:]
        var rejectedAsTooLong: Set<LoopFallbackBearingPattern> = []
        var rejectedAsTooShort: Set<LoopFallbackBearingPattern> = []
        var didReachTimeBudget = false
        var firstError: Error?

        var allRejectedAsTooLong: Bool {
            !rejectionReasons.isEmpty &&
                rejectionReasons.allSatisfy { $0 == RejectionReason.tooLong.rawValue || $0 == RejectionReason.tooLongHard.rawValue }
        }

        var allRejectedAsTooShort: Bool {
            !rejectionReasons.isEmpty &&
                rejectionReasons.allSatisfy { $0 == RejectionReason.tooShort.rawValue || $0 == RejectionReason.tooShortHard.rawValue }
        }

        var hasRejectedAsTooLong: Bool {
            rejectionReasons.contains(RejectionReason.tooLong.rawValue) ||
                rejectionReasons.contains(RejectionReason.tooLongHard.rawValue)
        }

        var hasRejectedAsTooShort: Bool {
            rejectionReasons.contains(RejectionReason.tooShort.rawValue) ||
                rejectionReasons.contains(RejectionReason.tooShortHard.rawValue)
        }

        mutating func record(
            _ reason: RejectionReason,
            pattern: LoopFallbackBearingPattern
        ) {
            rejectionReasons.append(reason.rawValue)
            rejectionCounts[reason.rawValue, default: 0] += 1
            switch reason {
            case .tooLong, .tooLongHard:
                rejectedAsTooLong.insert(pattern)
            case .tooShort, .tooShortHard:
                rejectedAsTooShort.insert(pattern)
            default:
                break
            }
        }

        mutating func recordRoutingFailure() {
            rejectionCounts["routing_failure", default: 0] += 1
        }

        mutating func merge(_ other: CandidateOutcome) {
            accepted.append(contentsOf: other.accepted)
            rejectionReasons.append(contentsOf: other.rejectionReasons)
            for (reason, count) in other.rejectionCounts {
                rejectionCounts[reason, default: 0] += count
            }
            rejectedAsTooLong.formUnion(other.rejectedAsTooLong)
            rejectedAsTooShort.formUnion(other.rejectedAsTooShort)
            didReachTimeBudget = didReachTimeBudget || other.didReachTimeBudget
            firstError = firstError ?? other.firstError
        }
    }

    enum RejectionReason: String {
        case tooShort = "below_acceptable_distance_window"
        case tooLong = "above_acceptable_distance_window"
        case tooShortHard = "below_hard_distance_window"
        case tooLongHard = "above_hard_distance_window"
        case insufficientGeometry = "insufficient_geometry"
        case duplicateGeometry = "duplicate_geometry"
        case tooMuchOverlap = "too_much_overlap"
        case openLoop = "open_loop"
        case degenerateLoopShape = "degenerate_loop_shape"
        case durationOutsideEnvelope = "duration_outside_hard_envelope"
        case routeTypeMismatch = "route_type_mismatch"
        case activityMismatch = "activity_mismatch"
        case unusableEvidencePayload = "unusable_evidence_payload"
        case knownTechnicalDifficultyAboveEasyRequest = "known_technical_difficulty_above_easy_request"
        case excessiveKnownMajorRoadExposure = "excessive_known_major_road_exposure"
    }

    private let client: any GraphHopperMultiPointRouteCalculating
    private let seeds: [Int]
    private let maximumSuggestions: Int
    private let maximumCandidatePoolCount: Int
    private let baseRadiusFactors: [Double]
    private let bearingPatterns: [LoopFallbackBearingPattern]

    init(
        client: any GraphHopperMultiPointRouteCalculating = GraphHopperClient(),
        seeds: [Int] = [11, 29, 47],
        maximumSuggestions: Int = 3,
        maximumCandidatePoolCount: Int = HikingRouteQualityPolicy.v1.maximumCandidatePoolCount,
        baseRadiusFactors: [Double] = [0.16, 0.19, 0.22],
        bearingPatterns: [LoopFallbackBearingPattern] = LoopFallbackBearingPattern.allCases
    ) {
        self.client = client
        self.seeds = seeds
        let boundedSuggestions = max(
            1,
            min(maximumSuggestions, HikingRouteQualityPolicy.v1.maximumSuggestions)
        )
        self.maximumSuggestions = boundedSuggestions
        self.maximumCandidatePoolCount = max(
            boundedSuggestions,
            min(maximumCandidatePoolCount, HikingRouteQualityPolicy.v1.maximumCandidatePoolCount)
        )
        self.baseRadiusFactors = baseRadiusFactors
        self.bearingPatterns = bearingPatterns
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> [RouteSuggestion] {
        try await search(for: intent).suggestions
    }

    func search(
        for intent: RouteIntent,
        excluding initialSignatures: Set<String> = [],
        excludingGeometries initialGeometries: [[Coordinate]] = []
    ) async throws -> LoopFallbackSearchResult {
        try Task.checkCancellation()
        guard intent.request.routeType == .loop else {
            throw RoutePromptParserError.invalidPrompt
        }

        let targetDistanceKm = intent.request.targetDistanceKm
            ?? RoutePlanningRequest.defaultLoopDistanceKm(for: intent.request.activityType)
        var signatures = initialSignatures
        var comparisonGeometries = initialGeometries

        let initialOutcome = try await evaluateCandidates(
            start: intent.start,
            targetDistanceKm: targetDistanceKm,
            radiusFactors: baseRadiusFactors,
            intent: intent,
            signatures: &signatures,
            comparisonGeometries: &comparisonGeometries,
            maximumAcceptedCandidates: maximumCandidatePoolCount
        )
        try Task.checkCancellation()
        var variants = initialOutcome.accepted
        var accumulatedOutcome = initialOutcome
        let qualityEngine = HikingRouteQualityEngine()

        if variants.count < maximumCandidatePoolCount,
           !qualityEngine.hasSufficientHighQualityDistinctCandidates(
                variants.map { RouteSuggestion(route: $0.route, explanation: $0.route.whyItMatches) },
                request: intent.request,
                minimumCandidateCount: maximumSuggestions
           ),
           initialOutcome.hasRejectedAsTooLong
        {
            let retryOutcome = try await evaluateCandidates(
                start: intent.start,
                targetDistanceKm: targetDistanceKm,
                radiusFactors: baseRadiusFactors.map { max($0 * 0.72, 0.08) },
                intent: intent,
                signatures: &signatures,
                comparisonGeometries: &comparisonGeometries,
                patterns: orderedPatterns(from: initialOutcome.rejectedAsTooLong),
                maximumAcceptedCandidates: maximumCandidatePoolCount - variants.count
            )
            try Task.checkCancellation()
            variants.append(contentsOf: retryOutcome.accepted)
            accumulatedOutcome.merge(retryOutcome)
        }

        if variants.count < maximumCandidatePoolCount,
           !qualityEngine.hasSufficientHighQualityDistinctCandidates(
                variants.map { RouteSuggestion(route: $0.route, explanation: $0.route.whyItMatches) },
                request: intent.request,
                minimumCandidateCount: maximumSuggestions
           ),
           accumulatedOutcome.hasRejectedAsTooShort
        {
            let retryOutcome = try await evaluateCandidates(
                start: intent.start,
                targetDistanceKm: targetDistanceKm,
                radiusFactors: baseRadiusFactors.map { min($0 * 1.18, 0.28) },
                intent: intent,
                signatures: &signatures,
                comparisonGeometries: &comparisonGeometries,
                patterns: orderedPatterns(from: accumulatedOutcome.rejectedAsTooShort),
                maximumAcceptedCandidates: maximumCandidatePoolCount - variants.count
            )
            try Task.checkCancellation()
            variants.append(contentsOf: retryOutcome.accepted)
            accumulatedOutcome.merge(retryOutcome)
        }

        try Task.checkCancellation()
        let rankingRequest = RoutePlanningRequest(
            routeType: intent.request.routeType,
            startQuery: intent.request.startQuery,
            endQuery: intent.request.endQuery,
            activityType: intent.request.activityType,
            graphHopperProfile: intent.request.graphHopperProfile,
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: intent.request.targetDurationMinutes,
            difficulty: intent.request.difficulty,
            desiredFeatures: intent.request.desiredFeatures,
            avoidFeatures: intent.request.avoidFeatures
        )
        let rankedVariants = LoopRouteVariantRanker.rank(
            variants,
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: intent.request.targetDurationMinutes,
            prefersLowerElevation: intent.request.avoidFeatures.contains(.steepClimbs)
                || intent.request.difficulty == .easy,
            request: rankingRequest
        )
        .prefix(maximumSuggestions)

        let suggestions = rankedVariants.map { variant in
            #if DEBUG
            let debugMetadata = RouteSuggestionDebugMetadata(
                targetDistanceKm: targetDistanceKm,
                actualDistanceKm: variant.route.distanceKilometers,
                distanceRatio: variant.route.distanceKilometers / targetDistanceKm,
                overlapRatio: variant.overlapRatio,
                shapeQualityScore: variant.shapeQualityScore,
                radiusKm: variant.radiusKm,
                bearingSeed: variant.seed,
                bearingPattern: variant.bearingPattern,
                provider: "LoopFallbackProvider",
                rejectionReason: nil
            )
            #else
            let debugMetadata: RouteSuggestionDebugMetadata? = nil
            #endif

            return RouteSuggestion(
                route: variant.route,
                explanation: variant.route.planningMetadata?.variantLabel ?? variant.route.whyItMatches,
                debugMetadata: debugMetadata
            )
        }
        if !suggestions.isEmpty {
            try Task.checkCancellation()
            return LoopFallbackSearchResult(
                suggestions: suggestions,
                rejectionCounts: accumulatedOutcome.rejectionCounts,
                didReachTimeBudget: accumulatedOutcome.didReachTimeBudget
            )
        }

        throw accumulatedOutcome.firstError ?? GraphHopperError.noRouteFound
    }

    private func evaluateCandidates(
        start: Coordinate,
        targetDistanceKm: Double,
        radiusFactors: [Double],
        intent: RouteIntent,
        signatures: inout Set<String>,
        comparisonGeometries: inout [[Coordinate]],
        patterns: [LoopFallbackBearingPattern]? = nil,
        maximumAcceptedCandidates: Int
    ) async throws -> CandidateOutcome {
        try Task.checkCancellation()
        var outcome = CandidateOutcome()

        let usableSeeds = seeds.isEmpty ? [11, 29, 47] : seeds
        let candidatePatterns = patterns?.isEmpty == false ? patterns! : bearingPatterns
        let candidates = candidatePatterns.enumerated().map { index, pattern in
            let seed = usableSeeds[index % usableSeeds.count]
            return Self.candidate(
                start: start,
                targetDistanceKm: targetDistanceKm,
                seed: seed,
                index: index,
                radiusFactors: radiusFactors,
                bearingPattern: pattern
            )
        }
        let concurrency = client is any ConcurrentGraphHopperMultiPointRouteCalculating
            ? max(intent.loopSearchPolicy?.maximumConcurrentRequests ?? 2, 1)
            : 1
        var nextCandidateIndex = 0

        while nextCandidateIndex < candidates.count {
            try Task.checkCancellation()
            if intent.hasExpiredLoopSearchBudget {
                outcome.didReachTimeBudget = true
                outcome.rejectionCounts["time_budget_expired", default: 0] += 1
                break
            }

            let batchEnd = min(nextCandidateIndex + concurrency, candidates.count)
            let batch = Array(candidates[nextCandidateIndex..<batchEnd])
            let results = try await routeResults(for: batch, intent: intent)
            try Task.checkCancellation()
            for (candidate, result) in results {
                try Task.checkCancellation()
                switch result {
                case let .success(route):
                let analysis = RouteAlternativeQuality.analyze(
                    route: route,
                    request: intent.request
                )
                if let qualityRejection = RouteAlternativeQuality.rejection(
                    for: route,
                    analysis: analysis,
                    request: intent.request
                ) {
                    let rejectionReason = Self.fallbackRejectionReason(
                        qualityRejection,
                        distanceRatio: analysis.distanceRatio
                    )
                    outcome.record(rejectionReason, pattern: candidate.bearingPattern)
                    Self.debugCandidateRejection(
                        pattern: candidate.bearingPattern,
                        reason: rejectionReason.rawValue
                    )
                    continue
                }

                let qualityAssessment = HikingRouteQualityEngine().assessment(
                    for: RouteSuggestion(route: route, explanation: route.whyItMatches),
                    providerIndex: candidate.index,
                    request: intent.request,
                    analysis: analysis
                )
                if let qualityRejection = qualityAssessment.eligibility.rejection {
                    let rejectionReason = Self.fallbackRejectionReason(
                        qualityRejection,
                        distanceRatio: analysis.distanceRatio
                    )
                    outcome.record(rejectionReason, pattern: candidate.bearingPattern)
                    Self.debugCandidateRejection(
                        pattern: candidate.bearingPattern,
                        reason: rejectionReason.rawValue
                    )
                    continue
                }

                let signature = Self.geometrySignature(for: route)
                let duplicatesAccepted = comparisonGeometries.contains { existingPath in
                    RouteAlternativeQuality.pairwiseSimilarity(
                        route.path,
                        existingPath
                    ) >= RouteAlternativeQualityPolicy.preBaseline.nearDuplicateSimilarity
                }
                guard
                    !signature.isEmpty,
                    signatures.insert(signature).inserted,
                    !duplicatesAccepted
                else {
                    outcome.record(.duplicateGeometry, pattern: candidate.bearingPattern)
                    Self.debugCandidateRejection(
                        pattern: candidate.bearingPattern,
                        reason: RejectionReason.duplicateGeometry.rawValue
                    )
                    continue
                }
                guard outcome.accepted.count < maximumAcceptedCandidates else { continue }
                outcome.accepted.append(
                    LoopRouteVariantRanker.Variant(
                        seed: candidate.seed,
                        route: route,
                        radiusKm: candidate.radiusKm,
                        radiusFactor: candidate.radiusFactor,
                        bearingDegrees: candidate.baseBearingDegrees,
                        bearingPattern: candidate.bearingPattern.rawValue,
                        overlapRatio: max(
                            analysis.selfBacktrackingRatio ?? 0,
                            analysis.selfOverlapRatio ?? 0
                        ),
                        shapeQualityScore: analysis.shapeQualityScore ?? 0
                    )
                )
                comparisonGeometries.append(route.path)
                case let .failure(error):
                    if outcome.firstError == nil {
                        outcome.firstError = error
                    }
                    outcome.recordRoutingFailure()
                    Self.debugCandidateRejection(
                        pattern: candidate.bearingPattern,
                        reason: "routing failure: \(error.localizedDescription)"
                    )
                }
            }
            nextCandidateIndex = batchEnd
            // Stop at three only when the complete quality policy considers the
            // current set strong and distinct. Otherwise inspect the bounded
            // six-candidate pool before final Pareto ranking.
            if outcome.accepted.count >= maximumSuggestions,
               HikingRouteQualityEngine().hasSufficientHighQualityDistinctCandidates(
                    outcome.accepted.map {
                        RouteSuggestion(route: $0.route, explanation: $0.route.whyItMatches)
                    },
                    request: intent.request
               )
            {
                break
            }
            if outcome.accepted.count >= maximumAcceptedCandidates {
                break
            }
        }

        return outcome
    }

    private static func fallbackRejectionReason(
        _ rejection: RouteAlternativeRejection,
        distanceRatio: Double?
    ) -> RejectionReason {
        switch rejection {
        case .invalidGeometry:
            .insufficientGeometry
        case .openLoop:
            .openLoop
        case .excessiveBacktracking:
            .tooMuchOverlap
        case .excessiveSelfOverlap:
            .tooMuchOverlap
        case .degenerateLoopShape:
            .degenerateLoopShape
        case .distanceOutsideEnvelope:
            (distanceRatio ?? 1) < 1 ? .tooShortHard : .tooLongHard
        case .durationOutsideEnvelope:
            .durationOutsideEnvelope
        case .nearDuplicate:
            .duplicateGeometry
        case .extremeDetour:
            .insufficientGeometry
        }
    }

    private static func fallbackRejectionReason(
        _ rejection: RouteQualityRejection,
        distanceRatio: Double?
    ) -> RejectionReason {
        switch rejection {
        case .invalidGeometry:
            .insufficientGeometry
        case .openLoop:
            .openLoop
        case .excessiveBacktracking, .excessiveSelfOverlap:
            .tooMuchOverlap
        case .degenerateLoopShape:
            .degenerateLoopShape
        case .extremeDetour:
            .insufficientGeometry
        case .distanceOutsideEnvelope:
            (distanceRatio ?? 1) < 1 ? .tooShortHard : .tooLongHard
        case .durationOutsideEnvelope:
            .durationOutsideEnvelope
        case .routeTypeMismatch:
            .routeTypeMismatch
        case .activityMismatch:
            .activityMismatch
        case .unusableEvidencePayload:
            .unusableEvidencePayload
        case .knownTechnicalDifficultyAboveEasyRequest:
            .knownTechnicalDifficultyAboveEasyRequest
        case .excessiveKnownMajorRoadExposure:
            .excessiveKnownMajorRoadExposure
        case .nearDuplicateGeometry:
            .duplicateGeometry
        }
    }

    private func routeResults(
        for candidates: [Candidate],
        intent: RouteIntent
    ) async throws -> [(Candidate, Result<TrailRoute, Error>)] {
        try Task.checkCancellation()
        guard candidates.count == 2 else {
            guard let candidate = candidates.first else { return [] }
            return [(candidate, try await routeResult(for: candidate, intent: intent))]
        }

        async let first = routeResult(for: candidates[0], intent: intent)
        async let second = routeResult(for: candidates[1], intent: intent)
        return [
            (candidates[0], try await first),
            (candidates[1], try await second)
        ]
    }

    private func routeResult(
        for candidate: Candidate,
        intent: RouteIntent
    ) async throws -> Result<TrailRoute, Error> {
        try Task.checkCancellation()
        do {
            let route = try await client.calculateGraphHopperRoute(
                waypoints: candidate.waypoints,
                request: intent.request,
                seed: candidate.seed,
                deadline: intent.loopSearchDeadline
            )
            try Task.checkCancellation()
            try RouteEligibilityPolicy.validate(route, for: .productionSuccess)
            return .success(try route.withRoutingStrategy(.loopFallback))
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            return .failure(error)
        }
    }

    private func orderedPatterns(
        from patterns: Set<LoopFallbackBearingPattern>
    ) -> [LoopFallbackBearingPattern] {
        bearingPatterns.filter { patterns.contains($0) }
    }

    static func makeCandidates(
        start: Coordinate,
        targetDistanceKm: Double,
        seeds: [Int] = [11, 29, 47],
        radiusFactors: [Double] = [0.16, 0.19, 0.22],
        bearingPatterns: [LoopFallbackBearingPattern] = LoopFallbackBearingPattern.allCases
    ) -> [Candidate] {
        let usableSeeds = seeds.isEmpty ? [11, 29, 47] : seeds
        return bearingPatterns.enumerated().map { index, pattern in
            let seed = usableSeeds[index % usableSeeds.count]
            return candidate(
                start: start,
                targetDistanceKm: targetDistanceKm,
                seed: seed,
                index: index,
                radiusFactors: radiusFactors,
                bearingPattern: pattern
            )
        }
    }

    static func hasUsableGeometry(_ route: TrailRoute) -> Bool {
        route.path.count >= 12 &&
            route.distanceKilometers >= 0.5 &&
            route.durationMinutes > 0
    }

    static func distanceRejectionReason(
        route: TrailRoute,
        targetDistanceKm: Double
    ) -> RejectionReason? {
        guard targetDistanceKm > 0 else { return nil }
        let ratio = route.distanceKilometers / targetDistanceKm
        if ratio < RouteAlternativeQualityPolicy.preBaseline.minimumDistanceRatio {
            return .tooShortHard
        }
        if ratio > RouteAlternativeQualityPolicy.preBaseline.maximumDistanceRatio {
            return .tooLongHard
        }
        return nil
    }

    static func geometrySignature(for route: TrailRoute) -> String {
        guard route.path.count >= 2 else { return "" }
        let stride = max(route.path.count / 8, 1)
        return route.path.enumerated()
            .filter { index, _ in index % stride == 0 || index == route.path.count - 1 }
            .map { _, point in
                "\(Int((point.latitude * 10_000).rounded())):\(Int((point.longitude * 10_000).rounded()))"
            }
            .joined(separator: "|")
    }

    struct QualityAnalysis: Hashable {
        let overlapRatio: Double
        let shapeQualityScore: Double
    }

    static func qualityAnalysis(for route: TrailRoute) -> QualityAnalysis {
        QualityAnalysis(
            overlapRatio: overlapRatio(for: route.path),
            shapeQualityScore: shapeQualityScore(for: route.path)
        )
    }

    static func acceptsLoopQuality(_ quality: QualityAnalysis) -> Bool {
        if quality.overlapRatio <= maximumAcceptableOverlap {
            return true
        }
        return quality.overlapRatio <= maximumShapeAwareOverlap &&
            quality.shapeQualityScore >= minimumShapeQualityForSharedSections
    }

    private static func debugCandidateRejection(
        pattern: LoopFallbackBearingPattern,
        reason: String
    ) {
        #if DEBUG
        print("TrailMind loop fallback [\(pattern.rawValue)]: \(reason)")
        #endif
    }

    static func overlapRatio(for coordinates: [Coordinate]) -> Double {
        guard coordinates.count >= 2 else { return 1 }
        var seenLengths: [SegmentKey: Double] = [:]
        var repeatedLength = 0.0
        var totalLength = 0.0

        for pair in zip(coordinates, coordinates.dropFirst()) {
            let length = distanceKm(from: pair.0, to: pair.1)
            guard length > 0.005 else { continue }
            totalLength += length
            let key = SegmentKey(pair.0, pair.1)
            if seenLengths[key] != nil {
                repeatedLength += length
            } else {
                seenLengths[key] = length
            }
        }

        guard totalLength > 0 else { return 1 }
        return min(repeatedLength / totalLength, 1)
    }

    static func shapeQualityScore(for coordinates: [Coordinate]) -> Double {
        guard coordinates.count >= 4 else { return 0 }
        let origin = coordinates[0]
        let originLatitudeRadians = origin.latitude * .pi / 180
        let projected = coordinates.map { point in
            let x = (point.longitude - origin.longitude) * cos(originLatitudeRadians) * 111.32
            let y = (point.latitude - origin.latitude) * 110.57
            return (x: x, y: y)
        }
        let xs = projected.map(\.x)
        let ys = projected.map(\.y)
        guard
            let minX = xs.min(),
            let maxX = xs.max(),
            let minY = ys.min(),
            let maxY = ys.max()
        else { return 0 }

        let width = max(maxX - minX, 0.001)
        let height = max(maxY - minY, 0.001)
        let elongationScore = min(width, height) / max(width, height)
        let area = polygonArea(projected)
        let perimeter = zip(coordinates, coordinates.dropFirst()).reduce(0.0) {
            $0 + distanceKm(from: $1.0, to: $1.1)
        }
        guard perimeter > 0 else { return 0 }
        let compactness = min((4 * .pi * area) / (perimeter * perimeter), 1)
        let boundingArea = width * height
        let areaFill = boundingArea > 0 ? min(area / boundingArea, 1) : 0
        return max(0, min((elongationScore * 0.35) + (compactness * 0.45) + (areaFill * 0.20), 1))
    }

    private static func offsetCoordinate(
        from coordinate: Coordinate,
        distanceKm: Double,
        bearingDegrees: Double
    ) -> Coordinate {
        let earthRadiusKm = 6_371.0
        let angularDistance = distanceKm / earthRadiusKm
        let bearing = bearingDegrees.normalizedDegrees * .pi / 180
        let latitude = coordinate.latitude * .pi / 180
        let longitude = coordinate.longitude * .pi / 180

        let destinationLatitude = asin(
            sin(latitude) * cos(angularDistance) +
                cos(latitude) * sin(angularDistance) * cos(bearing)
        )
        let destinationLongitude = longitude + atan2(
            sin(bearing) * sin(angularDistance) * cos(latitude),
            cos(angularDistance) - sin(latitude) * sin(destinationLatitude)
        )

        return Coordinate(
            latitude: destinationLatitude * 180 / .pi,
            longitude: destinationLongitude * 180 / .pi,
            elevationMeters: coordinate.elevationMeters
        )
    }

    private static func candidate(
        start: Coordinate,
        targetDistanceKm: Double,
        seed: Int,
        index: Int,
        radiusFactors: [Double],
        bearingPattern: LoopFallbackBearingPattern
    ) -> Candidate {
        let usableRadiusFactors = radiusFactors.isEmpty ? [0.16, 0.19, 0.22] : radiusFactors
        let radiusFactor = usableRadiusFactors[index % usableRadiusFactors.count]
        let radiusKm = max(targetDistanceKm * radiusFactor, 0.7)
        let baseBearing = Double((seed * 37) % 360)
        let bearings: [Double] = switch bearingPattern {
        case .leftArc:
            [baseBearing + 35, baseBearing + 115, baseBearing + 205]
        case .rightArc:
            [baseBearing - 35, baseBearing - 115, baseBearing - 205]
        case .wideTriangle:
            [baseBearing, baseBearing + 120, baseBearing + 240]
        case .compactTriangle:
            [baseBearing + 25, baseBearing + 145, baseBearing + 265]
        case .clockwise:
            [baseBearing + 20, baseBearing + 110, baseBearing + 200]
        case .counterclockwise:
            [baseBearing - 20, baseBearing - 110, baseBearing - 200]
        }
        let viaPoints = bearings.enumerated().map { pointIndex, bearing in
            let radiusMultiplier = if bearingPattern == .wideTriangle {
                pointIndex == 1 ? 1.16 : 1.0
            } else if bearingPattern == .compactTriangle {
                pointIndex == 1 ? 0.88 : 1.0
            } else {
                1.0
            }
            return offsetCoordinate(
                from: start,
                distanceKm: radiusKm * radiusMultiplier,
                bearingDegrees: bearing
            )
        }
        return Candidate(
            index: index,
            seed: seed,
            radiusKm: radiusKm,
            radiusFactor: radiusFactor,
            baseBearingDegrees: baseBearing,
            bearingPattern: bearingPattern,
            waypoints: [start] + viaPoints + [start]
        )
    }

    private static func distanceKm(from lhs: Coordinate, to rhs: Coordinate) -> Double {
        let earthRadiusKm = 6_371.0
        let lhsLatitude = lhs.latitude * .pi / 180
        let rhsLatitude = rhs.latitude * .pi / 180
        let latitudeDelta = (rhs.latitude - lhs.latitude) * .pi / 180
        let longitudeDelta = (rhs.longitude - lhs.longitude) * .pi / 180
        let a = sin(latitudeDelta / 2) * sin(latitudeDelta / 2) +
            cos(lhsLatitude) * cos(rhsLatitude) *
            sin(longitudeDelta / 2) * sin(longitudeDelta / 2)
        return earthRadiusKm * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    private static func polygonArea(_ points: [(x: Double, y: Double)]) -> Double {
        guard points.count >= 3 else { return 0 }
        let closedPoints = Array(points.dropFirst()) + [points[0]]
        let signedArea = zip(points, closedPoints).reduce(0.0) { area, pair in
            area + ((pair.0.x * pair.1.y) - (pair.1.x * pair.0.y))
        }
        return abs(signedArea) / 2
    }

    private struct SegmentKey: Hashable {
        let first: QuantizedCoordinate
        let second: QuantizedCoordinate

        init(_ lhs: Coordinate, _ rhs: Coordinate) {
            let firstCandidate = QuantizedCoordinate(lhs)
            let secondCandidate = QuantizedCoordinate(rhs)
            if firstCandidate <= secondCandidate {
                first = firstCandidate
                second = secondCandidate
            } else {
                first = secondCandidate
                second = firstCandidate
            }
        }
    }

    private struct QuantizedCoordinate: Hashable, Comparable {
        let latitude: Int
        let longitude: Int

        init(_ coordinate: Coordinate) {
            latitude = Int((coordinate.latitude / 0.0004).rounded())
            longitude = Int((coordinate.longitude / 0.0004).rounded())
        }

        static func < (lhs: QuantizedCoordinate, rhs: QuantizedCoordinate) -> Bool {
            if lhs.latitude != rhs.latitude {
                return lhs.latitude < rhs.latitude
            }
            return lhs.longitude < rhs.longitude
        }
    }
}

enum RouteSuggestionNormalizer {
    struct NormalizationResult {
        let suggestions: [RouteSuggestion]
        let rejectionCounts: [String: Int]
        let qualityPolicyVersion: String
        let qualityTelemetry: RouteQualityTelemetrySummary?
    }

    static func suggestions(from routes: [TrailRoute]) -> [RouteSuggestion] {
        routes.map { route in
            RouteSuggestion(
                route: route,
                explanation: route.planningMetadata?.variantLabel ?? route.whyItMatches
            )
        }
    }

    static func normalizedSuggestions(
        from suggestions: [RouteSuggestion],
        request: RoutePlanningRequest,
        maximumSuggestions: Int = 3
    ) -> NormalizationResult {
        let selection = RouteAlternativeQuality.select(
            suggestions,
            request: request,
            maximumSuggestions: maximumSuggestions
        )
        let routes = selection.selected.map(\.suggestion.route)
        let normalized = selection.selected.map { selected in
            let suggestion = selected.suggestion
            let label = RouteAlternativeQuality.factualLabel(
                route: suggestion.route,
                request: request,
                selectedRoutes: routes
            )
            let metadata = (suggestion.route.planningMetadata ?? request.metadata).withVariant(
                seed: suggestion.route.planningMetadata?.seed,
                label: label
            )
            return RouteSuggestion(
                id: suggestion.id,
                route: suggestion.route.withPlanningMetadata(metadata),
                explanation: label,
                debugMetadata: suggestion.debugMetadata
            )
        }
        return NormalizationResult(
            suggestions: normalized,
            rejectionCounts: selection.rejectionCounts,
            qualityPolicyVersion: selection.policyVersion,
            qualityTelemetry: selection.telemetry
        )
    }

    static func comparableLoopSuggestions(
        from suggestions: [RouteSuggestion],
        targetDistanceKm: Double,
        maximumSuggestions: Int = 3,
        request: RoutePlanningRequest? = nil
    ) -> [RouteSuggestion] {
        let resolvedRequest = request ?? RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Start",
            endQuery: nil,
            activityType: suggestions.first?.route.activity ?? .hiking,
            graphHopperProfile: suggestions.first?.route.activity == .biking ? "bike" : "foot",
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )
        return normalizedSuggestions(
            from: suggestions,
            request: resolvedRequest,
            maximumSuggestions: maximumSuggestions
        ).suggestions
    }
}

enum LoopRouteVariantRanker {
    struct Variant: Hashable {
        let seed: Int
        let route: TrailRoute
        let radiusKm: Double?
        let radiusFactor: Double?
        let bearingDegrees: Double?
        let bearingPattern: String?
        let overlapRatio: Double
        let shapeQualityScore: Double
    }

    static func rank(
        _ variants: [(seed: Int, route: TrailRoute)],
        targetDistanceKm: Double
    ) -> [TrailRoute] {
        rank(
            variants.map {
                Variant(
                    seed: $0.seed,
                    route: $0.route,
                    radiusKm: nil,
                    radiusFactor: nil,
                    bearingDegrees: nil,
                    bearingPattern: nil,
                    overlapRatio: 0,
                    shapeQualityScore: 1
                )
            },
            targetDistanceKm: targetDistanceKm
        )
        .map(\.route)
    }

    static func rank(
        _ variants: [Variant],
        targetDistanceKm: Double,
        targetDurationMinutes: Int? = nil,
        prefersLowerElevation: Bool = false,
        request suppliedRequest: RoutePlanningRequest? = nil
    ) -> [Variant] {
        guard let firstRoute = variants.first?.route else { return [] }
        let request = suppliedRequest ?? RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Start",
            endQuery: nil,
            activityType: firstRoute.activity,
            graphHopperProfile: firstRoute.activity == .biking ? "bike" : "foot",
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: targetDurationMinutes,
            difficulty: prefersLowerElevation ? .easy : nil,
            desiredFeatures: []
        )
        let selection = RouteAlternativeQuality.select(
            variants.map { RouteSuggestion(route: $0.route, explanation: $0.route.whyItMatches) },
            request: request,
            maximumSuggestions: variants.count
        )
        let ordered = selection.selected.map { variants[$0.providerIndex] }
        let selectedRoutes = ordered.map(\.route)

        return ordered.map { variant in
            let label = RouteAlternativeQuality.factualLabel(
                route: variant.route,
                request: request,
                selectedRoutes: selectedRoutes
            )
            let metadata = variant.route.planningMetadata?.withVariant(seed: variant.seed, label: label)
            return Variant(
                seed: variant.seed,
                route: variant.route.withPlanningMetadata(metadata),
                radiusKm: variant.radiusKm,
                radiusFactor: variant.radiusFactor,
                bearingDegrees: variant.bearingDegrees,
                bearingPattern: variant.bearingPattern,
                overlapRatio: variant.overlapRatio,
                shapeQualityScore: variant.shapeQualityScore
            )
        }
    }
}

private extension Double {
    var normalizedDegrees: Double {
        let value = truncatingRemainder(dividingBy: 360)
        return value < 0 ? value + 360 : value
    }
}
