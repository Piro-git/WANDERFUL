import Foundation

/// Conservative deterministic limits used before the authorized 20-fixture live baseline.
/// These values deliberately reject only structural failures and extreme target misses.
/// They must not be presented as live-provider tuning until that baseline is run.
struct RouteAlternativeQualityPolicy: Hashable, Sendable {
    static let preBaseline = RouteAlternativeQualityPolicy(
        maximumSuggestions: 3,
        similarityCorridorMeters: 35,
        nearDuplicateSimilarity: 0.86,
        maximumLoopClosureMeters: 250,
        loopClosureLengthFraction: 0.015,
        maximumSelfBacktrackingRatio: 0.55,
        maximumSelfOverlapRatio: 0.55,
        minimumLoopShapeQuality: 0.025,
        minimumDistanceRatio: 0.55,
        maximumDistanceRatio: 1.75,
        minimumDurationRatio: 0.40,
        maximumDurationRatio: 2.50,
        maximumPointToPointDetourRatio: 5.0,
        minimumExtremeDetourExcessMeters: 10_000
    )

    let maximumSuggestions: Int
    let similarityCorridorMeters: Double
    let nearDuplicateSimilarity: Double
    let maximumLoopClosureMeters: Double
    let loopClosureLengthFraction: Double
    let maximumSelfBacktrackingRatio: Double
    let maximumSelfOverlapRatio: Double
    let minimumLoopShapeQuality: Double
    let minimumDistanceRatio: Double
    let maximumDistanceRatio: Double
    let minimumDurationRatio: Double
    let maximumDurationRatio: Double
    let maximumPointToPointDetourRatio: Double
    let minimumExtremeDetourExcessMeters: Double
}

enum RouteAlternativeRejection: String, Hashable, Sendable {
    case invalidGeometry = "invalid_geometry"
    case openLoop = "open_loop"
    case excessiveBacktracking = "excessive_backtracking"
    case excessiveSelfOverlap = "excessive_self_overlap"
    case degenerateLoopShape = "degenerate_loop_shape"
    case extremeDetour = "extreme_detour"
    case distanceOutsideEnvelope = "distance_outside_hard_envelope"
    case durationOutsideEnvelope = "duration_outside_hard_envelope"
    case nearDuplicate = "near_duplicate_geometry"
}

struct RouteGeometryQualityAnalysis: Hashable, Sendable {
    let geometryLengthMeters: Double
    let closureGapMeters: Double?
    let closureToleranceMeters: Double?
    let isClosedLoop: Bool?
    let selfBacktrackingRatio: Double?
    let selfOverlapRatio: Double?
    let shapeQualityScore: Double?
    let directDistanceMeters: Double?
    let detourRatio: Double?
    let distanceRatio: Double?
    let durationRatio: Double?
}

struct RouteAlternativeSelection {
    struct Selected {
        let suggestion: RouteSuggestion
        let analysis: RouteGeometryQualityAnalysis
        let providerIndex: Int
    }

    let selected: [Selected]
    let rejectionCounts: [String: Int]
}

enum RouteAlternativeQuality {
    private struct ProjectedPoint: Hashable {
        let x: Double
        let y: Double
    }

    private struct RankedCandidate {
        let suggestion: RouteSuggestion
        let analysis: RouteGeometryQualityAnalysis
        let providerIndex: Int
    }

    static func analyze(
        route: TrailRoute,
        request: RoutePlanningRequest,
        policy: RouteAlternativeQualityPolicy = .preBaseline
    ) -> RouteGeometryQualityAnalysis {
        let validPath = route.path.allSatisfy {
            $0.latitude.isFinite && $0.longitude.isFinite &&
                (-90...90).contains($0.latitude) && (-180...180).contains($0.longitude)
        }
        let geometryLengthMeters = validPath ? polylineLengthMeters(route.path) : 0
        let isLoop = request.routeType == .loop || route.routeType == .loop
        let closureGapMeters = isLoop && route.path.count >= 2
            ? distanceMeters(route.path[0], route.path[route.path.count - 1])
            : nil
        let closureToleranceMeters = isLoop
            ? min(
                policy.maximumLoopClosureMeters,
                max(75, geometryLengthMeters * policy.loopClosureLengthFraction)
            )
            : nil
        let directDistanceMeters = !isLoop && route.path.count >= 2
            ? distanceMeters(route.path[0], route.path[route.path.count - 1])
            : nil
        let routedDistanceMeters = route.distanceKilometers * 1_000
        let isClosedLoop: Bool? = if
            let closureGapMeters,
            let closureToleranceMeters
        {
            closureGapMeters <= closureToleranceMeters
        } else {
            nil
        }

        return RouteGeometryQualityAnalysis(
            geometryLengthMeters: geometryLengthMeters,
            closureGapMeters: closureGapMeters,
            closureToleranceMeters: closureToleranceMeters,
            isClosedLoop: isClosedLoop,
            selfBacktrackingRatio: isLoop
                ? repeatedSegmentRatio(
                    route.path,
                    corridorMeters: policy.similarityCorridorMeters,
                    direction: .oppositeOnly
                )
                : nil,
            selfOverlapRatio: isLoop
                ? repeatedSegmentRatio(
                    route.path,
                    corridorMeters: policy.similarityCorridorMeters,
                    direction: .eitherParallelDirection
                )
                : nil,
            shapeQualityScore: isLoop ? shapeQualityScore(route.path) : nil,
            directDistanceMeters: directDistanceMeters,
            detourRatio: directDistanceMeters.flatMap { direct in
                direct > 100 ? routedDistanceMeters / direct : nil
            },
            distanceRatio: request.targetDistanceKm.flatMap { target in
                target > 0 ? route.distanceKilometers / target : nil
            },
            durationRatio: request.targetDurationMinutes.flatMap { target in
                target > 0 ? Double(route.durationMinutes) / Double(target) : nil
            }
        )
    }

    static func rejection(
        for route: TrailRoute,
        analysis: RouteGeometryQualityAnalysis,
        request: RoutePlanningRequest,
        policy: RouteAlternativeQualityPolicy = .preBaseline
    ) -> RouteAlternativeRejection? {
        guard
            route.path.count >= 2,
            analysis.geometryLengthMeters >= 100,
            route.distanceKilometers.isFinite,
            route.distanceKilometers > 0,
            route.durationMinutes > 0
        else {
            return .invalidGeometry
        }

        if request.routeType == .loop || route.routeType == .loop {
            guard route.path.count >= 4 else { return .invalidGeometry }
            guard analysis.isClosedLoop == true else { return .openLoop }
            if (analysis.selfBacktrackingRatio ?? 1) > policy.maximumSelfBacktrackingRatio {
                return .excessiveBacktracking
            }
            if (analysis.selfOverlapRatio ?? 1) > policy.maximumSelfOverlapRatio {
                return .excessiveSelfOverlap
            }
            if (analysis.shapeQualityScore ?? 0) < policy.minimumLoopShapeQuality {
                return .degenerateLoopShape
            }
        } else if
            let directDistanceMeters = analysis.directDistanceMeters,
            let detourRatio = analysis.detourRatio,
            detourRatio > policy.maximumPointToPointDetourRatio,
            route.distanceKilometers * 1_000 - directDistanceMeters > policy.minimumExtremeDetourExcessMeters
        {
            return .extremeDetour
        }

        if let ratio = analysis.distanceRatio,
           !(policy.minimumDistanceRatio...policy.maximumDistanceRatio).contains(ratio)
        {
            return .distanceOutsideEnvelope
        }
        if let ratio = analysis.durationRatio,
           !(policy.minimumDurationRatio...policy.maximumDurationRatio).contains(ratio)
        {
            return .durationOutsideEnvelope
        }
        return nil
    }

    static func select(
        _ suggestions: [RouteSuggestion],
        request: RoutePlanningRequest,
        maximumSuggestions: Int? = nil,
        policy: RouteAlternativeQualityPolicy = .preBaseline
    ) -> RouteAlternativeSelection {
        var rejectionCounts: [String: Int] = [:]
        let candidates = suggestions.enumerated().compactMap { index, suggestion -> RankedCandidate? in
            let analysis = analyze(route: suggestion.route, request: request, policy: policy)
            if let reason = rejection(
                for: suggestion.route,
                analysis: analysis,
                request: request,
                policy: policy
            ) {
                rejectionCounts[reason.rawValue, default: 0] += 1
                return nil
            }
            return RankedCandidate(
                suggestion: suggestion,
                analysis: analysis,
                providerIndex: index
            )
        }
        .sorted { ranksBefore($0, $1, request: request) }

        var selected: [RankedCandidate] = []
        let limit = max(1, maximumSuggestions ?? policy.maximumSuggestions)
        for candidate in candidates {
            let duplicatesExisting = selected.contains { existing in
                pairwiseSimilarity(
                    candidate.suggestion.route.path,
                    existing.suggestion.route.path,
                    corridorMeters: policy.similarityCorridorMeters
                ) >= policy.nearDuplicateSimilarity
            }
            if duplicatesExisting {
                rejectionCounts[RouteAlternativeRejection.nearDuplicate.rawValue, default: 0] += 1
                continue
            }
            selected.append(candidate)
            if selected.count == limit { break }
        }

        return RouteAlternativeSelection(
            selected: selected.map {
                .init(
                    suggestion: $0.suggestion,
                    analysis: $0.analysis,
                    providerIndex: $0.providerIndex
                )
            },
            rejectionCounts: rejectionCounts
        )
    }

    /// Symmetric corridor coverage. It is unchanged by route reversal and robust
    /// to provider paths using different point densities.
    static func pairwiseSimilarity(
        _ lhs: [Coordinate],
        _ rhs: [Coordinate],
        corridorMeters: Double = RouteAlternativeQualityPolicy.preBaseline.similarityCorridorMeters
    ) -> Double {
        guard lhs.count >= 2, rhs.count >= 2 else { return 0 }
        let originLatitude = (lhs[0].latitude + rhs[0].latitude) / 2
        let originLongitude = (lhs[0].longitude + rhs[0].longitude) / 2
        let projectedLHS = project(lhs, originLatitude: originLatitude, originLongitude: originLongitude)
        let projectedRHS = project(rhs, originLatitude: originLatitude, originLongitude: originLongitude)
        let lhsSamples = resample(projectedLHS, maximumSampleCount: 192)
        let rhsSamples = resample(projectedRHS, maximumSampleCount: 192)
        return min(
            directedCoverage(lhsSamples, by: rhsSamples, corridorMeters: corridorMeters),
            directedCoverage(rhsSamples, by: lhsSamples, corridorMeters: corridorMeters)
        )
    }

    static func factualLabel(
        route: TrailRoute,
        request: RoutePlanningRequest,
        selectedRoutes: [TrailRoute]
    ) -> String {
        var deltas: [String] = []
        if let targetDistanceKm = request.targetDistanceKm, targetDistanceKm > 0 {
            let difference = route.distanceKilometers - targetDistanceKm
            if abs(difference) < 0.05 {
                deltas.append("At distance target")
            } else {
                deltas.append(
                    "\(abs(difference).formatted(.number.locale(Locale(identifier: "en_US_POSIX")).precision(.fractionLength(1)))) km \(difference < 0 ? "under" : "over") target"
                )
            }
        }
        if let targetDurationMinutes = request.targetDurationMinutes, targetDurationMinutes > 0 {
            let difference = route.durationMinutes - targetDurationMinutes
            if difference == 0 {
                deltas.append("At time target")
            } else {
                deltas.append("\(abs(difference)) min \(difference < 0 ? "under" : "over") target")
            }
        }
        if !deltas.isEmpty {
            return deltas.joined(separator: " • ")
        }

        guard selectedRoutes.count > 1 else { return "Only distinct route" }
        let minimumClimb = selectedRoutes.map(\.elevationGainMeters).min() ?? route.elevationGainMeters
        let climbDelta = route.elevationGainMeters - minimumClimb
        if climbDelta == 0 { return "Lowest climb" }
        return "+\(climbDelta) m climb"
    }

    /// Release surfaces only render labels that can be reproduced from measured
    /// route facts in the current comparison. Persisted legacy marketing labels
    /// are intentionally ignored.
    static func displayLabel(
        candidate: String?,
        for route: TrailRoute
    ) -> String? {
        guard let candidate else { return nil }
        if let metadata = route.planningMetadata,
           metadata.targetDistanceKm != nil || metadata.targetDurationMinutes != nil
        {
            let request = RoutePlanningRequest(
                routeType: metadata.routeType,
                startQuery: "Start",
                endQuery: metadata.routeType == .loop ? nil : "Finish",
                activityType: metadata.activityType,
                graphHopperProfile: metadata.activityType == .biking ? "bike" : "foot",
                targetDistanceKm: metadata.targetDistanceKm,
                targetDurationMinutes: metadata.targetDurationMinutes,
                difficulty: metadata.difficulty,
                desiredFeatures: metadata.desiredFeatures,
                avoidFeatures: metadata.avoidFeatures
            )
            return factualLabel(route: route, request: request, selectedRoutes: [route])
        }
        if candidate == "Lowest climb" || candidate == "Only distinct route" {
            return candidate
        }
        if candidate.hasPrefix("+"), candidate.hasSuffix(" m climb") {
            let number = candidate.dropFirst().dropLast(" m climb".count)
            if Int(number) != nil { return candidate }
        }
        return nil
    }

    /// Route detail has no active comparison context. It can reproduce target
    /// deltas, but it must not repeat persisted relative labels such as
    /// “Lowest climb” or legacy marketing labels.
    static func detailDisplayLabel(for route: TrailRoute) -> String? {
        guard
            let metadata = route.planningMetadata,
            metadata.variantLabel != nil,
            metadata.targetDistanceKm != nil || metadata.targetDurationMinutes != nil
        else { return nil }
        return displayLabel(candidate: metadata.variantLabel, for: route)
    }

    private static func ranksBefore(
        _ lhs: RankedCandidate,
        _ rhs: RankedCandidate,
        request: RoutePlanningRequest
    ) -> Bool {
        let lhsRoute = lhs.suggestion.route
        let rhsRoute = rhs.suggestion.route

        if let targetDuration = request.targetDurationMinutes, targetDuration > 0 {
            let lhsDifference = abs(Double(lhsRoute.durationMinutes - targetDuration)) / Double(targetDuration)
            let rhsDifference = abs(Double(rhsRoute.durationMinutes - targetDuration)) / Double(targetDuration)
            if lhsDifference != rhsDifference { return lhsDifference < rhsDifference }
        }
        let prioritizesGentlerRoute = request.difficulty == .easy ||
            request.avoidFeatures.contains(.steepClimbs)
        if let targetDistance = request.targetDistanceKm, targetDistance > 0 {
            let lhsDifference = abs(lhsRoute.distanceKilometers - targetDistance) / targetDistance
            let rhsDifference = abs(rhsRoute.distanceKilometers - targetDistance) / targetDistance
            if prioritizesGentlerRoute {
                let lhsBucket = lhsDifference <= 0.12 ? 0 : 1
                let rhsBucket = rhsDifference <= 0.12 ? 0 : 1
                if lhsBucket != rhsBucket { return lhsBucket < rhsBucket }
            } else if lhsDifference != rhsDifference {
                return lhsDifference < rhsDifference
            }
        }
        if let requestedDifficulty = request.difficulty {
            let lhsDifference = abs(difficultyRank(lhsRoute.difficulty) - difficultyRank(requestedDifficulty))
            let rhsDifference = abs(difficultyRank(rhsRoute.difficulty) - difficultyRank(requestedDifficulty))
            if lhsDifference != rhsDifference { return lhsDifference < rhsDifference }
        }
        if lhsRoute.difficulty != rhsRoute.difficulty {
            return difficultyRank(lhsRoute.difficulty) < difficultyRank(rhsRoute.difficulty)
        }
        if lhsRoute.elevationGainMeters != rhsRoute.elevationGainMeters {
            return lhsRoute.elevationGainMeters < rhsRoute.elevationGainMeters
        }
        if prioritizesGentlerRoute,
           let targetDistance = request.targetDistanceKm,
           targetDistance > 0
        {
            let lhsDifference = abs(lhsRoute.distanceKilometers - targetDistance)
            let rhsDifference = abs(rhsRoute.distanceKilometers - targetDistance)
            if lhsDifference != rhsDifference { return lhsDifference < rhsDifference }
        }
        if let lhsBacktracking = lhs.analysis.selfBacktrackingRatio,
           let rhsBacktracking = rhs.analysis.selfBacktrackingRatio,
           lhsBacktracking != rhsBacktracking
        {
            return lhsBacktracking < rhsBacktracking
        }
        if let lhsOverlap = lhs.analysis.selfOverlapRatio,
           let rhsOverlap = rhs.analysis.selfOverlapRatio,
           lhsOverlap != rhsOverlap
        {
            return lhsOverlap < rhsOverlap
        }
        if let lhsShape = lhs.analysis.shapeQualityScore,
           let rhsShape = rhs.analysis.shapeQualityScore,
           lhsShape != rhsShape
        {
            return lhsShape > rhsShape
        }
        if let lhsDetour = lhs.analysis.detourRatio,
           let rhsDetour = rhs.analysis.detourRatio,
           lhsDetour != rhsDetour
        {
            return lhsDetour < rhsDetour
        }
        if lhsRoute.durationMinutes != rhsRoute.durationMinutes {
            return lhsRoute.durationMinutes < rhsRoute.durationMinutes
        }
        if lhsRoute.distanceKilometers != rhsRoute.distanceKilometers {
            return lhsRoute.distanceKilometers < rhsRoute.distanceKilometers
        }
        return lhs.providerIndex < rhs.providerIndex
    }

    private static func difficultyRank(_ difficulty: RouteDifficulty) -> Int {
        switch difficulty {
        case .easy: 0
        case .moderate: 1
        case .challenging: 2
        }
    }

    private enum RepeatedSegmentDirection {
        case oppositeOnly
        case eitherParallelDirection
    }

    private static func repeatedSegmentRatio(
        _ coordinates: [Coordinate],
        corridorMeters: Double,
        direction: RepeatedSegmentDirection
    ) -> Double {
        guard coordinates.count >= 4 else { return 1 }
        let projected = project(
            coordinates,
            originLatitude: coordinates[0].latitude,
            originLongitude: coordinates[0].longitude
        )
        // Keep the sampling step below the comparison corridor for practical
        // same-day loops, otherwise two identical passes can land on staggered
        // midpoints and falsely appear distinct.
        let points = resample(projected, maximumSampleCount: 1_024)
        guard points.count >= 4 else { return 1 }
        let segmentCount = points.count - 1
        let minimumSeparation = max(4, segmentCount / 18)
        var matched = Set<Int>()

        for lhsIndex in 0..<segmentCount {
            let lhsStart = points[lhsIndex]
            let lhsEnd = points[lhsIndex + 1]
            let lhsVector = ProjectedPoint(x: lhsEnd.x - lhsStart.x, y: lhsEnd.y - lhsStart.y)
            let lhsLength = hypot(lhsVector.x, lhsVector.y)
            guard lhsLength > 0 else { continue }
            let lhsMidpoint = ProjectedPoint(x: (lhsStart.x + lhsEnd.x) / 2, y: (lhsStart.y + lhsEnd.y) / 2)

            for rhsIndex in (lhsIndex + 1)..<segmentCount {
                let linearSeparation = rhsIndex - lhsIndex
                let circularSeparation = min(linearSeparation, segmentCount - linearSeparation)
                guard circularSeparation >= minimumSeparation else { continue }
                let rhsStart = points[rhsIndex]
                let rhsEnd = points[rhsIndex + 1]
                let rhsVector = ProjectedPoint(x: rhsEnd.x - rhsStart.x, y: rhsEnd.y - rhsStart.y)
                let rhsLength = hypot(rhsVector.x, rhsVector.y)
                guard rhsLength > 0 else { continue }
                let rhsMidpoint = ProjectedPoint(x: (rhsStart.x + rhsEnd.x) / 2, y: (rhsStart.y + rhsEnd.y) / 2)
                guard hypot(lhsMidpoint.x - rhsMidpoint.x, lhsMidpoint.y - rhsMidpoint.y) <= corridorMeters else {
                    continue
                }
                let dot = (lhsVector.x * rhsVector.x + lhsVector.y * rhsVector.y) / (lhsLength * rhsLength)
                let isRepeated = switch direction {
                case .oppositeOnly:
                    dot <= -0.75
                case .eitherParallelDirection:
                    abs(dot) >= 0.75
                }
                if isRepeated {
                    matched.insert(lhsIndex)
                    matched.insert(rhsIndex)
                }
            }
        }
        return Double(matched.count) / Double(segmentCount)
    }

    private static func shapeQualityScore(_ coordinates: [Coordinate]) -> Double {
        guard coordinates.count >= 4 else { return 0 }
        let points = project(
            coordinates,
            originLatitude: coordinates[0].latitude,
            originLongitude: coordinates[0].longitude
        )
        guard
            let minX = points.map(\.x).min(), let maxX = points.map(\.x).max(),
            let minY = points.map(\.y).min(), let maxY = points.map(\.y).max()
        else { return 0 }
        let width = max(maxX - minX, 1)
        let height = max(maxY - minY, 1)
        let meanX = points.map(\.x).reduce(0, +) / Double(points.count)
        let meanY = points.map(\.y).reduce(0, +) / Double(points.count)
        let covarianceXX = points.reduce(0) { $0 + pow($1.x - meanX, 2) } / Double(points.count)
        let covarianceYY = points.reduce(0) { $0 + pow($1.y - meanY, 2) } / Double(points.count)
        let covarianceXY = points.reduce(0) { $0 + ($1.x - meanX) * ($1.y - meanY) } / Double(points.count)
        let trace = covarianceXX + covarianceYY
        let discriminant = sqrt(max(0, pow(covarianceXX - covarianceYY, 2) + 4 * pow(covarianceXY, 2)))
        let majorSpread = max((trace + discriminant) / 2, 0)
        let minorSpread = max((trace - discriminant) / 2, 0)
        let twoDimensionalSpread = majorSpread > 0 ? sqrt(minorSpread / majorSpread) : 0
        let area = polygonArea(points)
        let perimeter = zip(points, points.dropFirst()).reduce(0.0) {
            $0 + hypot($1.1.x - $1.0.x, $1.1.y - $1.0.y)
        }
        guard perimeter > 0 else { return 0 }
        let compactness = min(4 * Double.pi * area / (perimeter * perimeter), 1)
        let areaFill = min(area / (width * height), 1)
        return max(0, min(twoDimensionalSpread * 0.35 + compactness * 0.45 + areaFill * 0.20, 1))
    }

    private static func directedCoverage(
        _ samples: [ProjectedPoint],
        by reference: [ProjectedPoint],
        corridorMeters: Double
    ) -> Double {
        guard !samples.isEmpty, reference.count >= 2 else { return 0 }
        let covered = samples.reduce(into: 0) { count, point in
            let minimumDistance = zip(reference, reference.dropFirst()).reduce(Double.greatestFiniteMagnitude) {
                min($0, distanceFromPoint(point, toSegmentFrom: $1.0, to: $1.1))
            }
            if minimumDistance <= corridorMeters { count += 1 }
        }
        return Double(covered) / Double(samples.count)
    }

    private static func distanceFromPoint(
        _ point: ProjectedPoint,
        toSegmentFrom start: ProjectedPoint,
        to end: ProjectedPoint
    ) -> Double {
        let dx = end.x - start.x
        let dy = end.y - start.y
        let squaredLength = dx * dx + dy * dy
        guard squaredLength > 0 else { return hypot(point.x - start.x, point.y - start.y) }
        let projection = max(0, min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squaredLength))
        return hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy))
    }

    private static func resample(
        _ points: [ProjectedPoint],
        maximumSampleCount: Int
    ) -> [ProjectedPoint] {
        guard points.count >= 2 else { return points }
        var cumulative = [0.0]
        for pair in zip(points, points.dropFirst()) {
            cumulative.append(cumulative.last! + hypot(pair.1.x - pair.0.x, pair.1.y - pair.0.y))
        }
        guard let total = cumulative.last, total > 0 else { return [points[0]] }
        let sampleCount = min(maximumSampleCount, max(16, Int(total / 25) + 1))
        var result: [ProjectedPoint] = []
        var segmentIndex = 0
        for sampleIndex in 0..<sampleCount {
            let target = total * Double(sampleIndex) / Double(sampleCount - 1)
            while segmentIndex + 1 < cumulative.count - 1, cumulative[segmentIndex + 1] < target {
                segmentIndex += 1
            }
            let segmentLength = cumulative[segmentIndex + 1] - cumulative[segmentIndex]
            let fraction = segmentLength > 0 ? (target - cumulative[segmentIndex]) / segmentLength : 0
            let start = points[segmentIndex]
            let end = points[segmentIndex + 1]
            result.append(
                ProjectedPoint(
                    x: start.x + (end.x - start.x) * fraction,
                    y: start.y + (end.y - start.y) * fraction
                )
            )
        }
        return result
    }

    private static func project(
        _ coordinates: [Coordinate],
        originLatitude: Double,
        originLongitude: Double
    ) -> [ProjectedPoint] {
        let latitudeRadians = originLatitude * .pi / 180
        return coordinates.map {
            ProjectedPoint(
                x: ($0.longitude - originLongitude) * cos(latitudeRadians) * 111_320,
                y: ($0.latitude - originLatitude) * 110_570
            )
        }
    }

    private static func polylineLengthMeters(_ coordinates: [Coordinate]) -> Double {
        zip(coordinates, coordinates.dropFirst()).reduce(0) {
            $0 + distanceMeters($1.0, $1.1)
        }
    }

    private static func distanceMeters(_ lhs: Coordinate, _ rhs: Coordinate) -> Double {
        let earthRadiusMeters = 6_371_000.0
        let lhsLatitude = lhs.latitude * .pi / 180
        let rhsLatitude = rhs.latitude * .pi / 180
        let latitudeDelta = (rhs.latitude - lhs.latitude) * .pi / 180
        let longitudeDelta = (rhs.longitude - lhs.longitude) * .pi / 180
        let value = sin(latitudeDelta / 2) * sin(latitudeDelta / 2) +
            cos(lhsLatitude) * cos(rhsLatitude) *
            sin(longitudeDelta / 2) * sin(longitudeDelta / 2)
        return earthRadiusMeters * 2 * atan2(sqrt(value), sqrt(max(0, 1 - value)))
    }

    private static func polygonArea(_ points: [ProjectedPoint]) -> Double {
        guard points.count >= 3 else { return 0 }
        return abs(zip(points, Array(points.dropFirst()) + [points[0]]).reduce(0.0) {
            $0 + ($1.0.x * $1.1.y - $1.1.x * $1.0.y)
        }) / 2
    }
}
