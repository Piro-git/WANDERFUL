import Foundation

struct RouteIntent: Hashable {
    let request: RoutePlanningRequest
    let start: Coordinate
    let end: Coordinate?
}

struct RoutingResult {
    let suggestions: [RouteSuggestion]
    let notice: String?
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

    init(
        primaryProvider: any RoutingProvider = GraphHopperRoutingProvider(),
        loopFallbackProvider: any RoutingProvider = LoopFallbackProvider()
    ) {
        self.primaryProvider = primaryProvider
        self.loopFallbackProvider = loopFallbackProvider
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> RoutingResult {
        do {
            return RoutingResult(
                suggestions: try await primaryProvider.routeSuggestions(for: intent),
                notice: nil
            )
        } catch let error as GraphHopperError
            where intent.request.routeType == .loop && error.isFlexibleModeUnavailable
        {
            return RoutingResult(
                suggestions: try await loopFallbackProvider.routeSuggestions(for: intent),
                notice: "GraphHopper round trips need flexible mode on this API plan, so TrailMind built loop options from normal routed segments."
            )
        }
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
                seeds: loopSeeds
            )
        case .pointToPoint, .multiDay:
            guard let end = intent.end else {
                throw RoutePromptParserError.invalidPrompt
            }
            routes = [
                try await client.calculateGraphHopperRoute(
                    request: intent.request,
                    start: intent.start,
                    end: end
                )
            ]
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
}

enum LoopFallbackBearingPattern: String, CaseIterable, Hashable {
    case leftArc = "left_arc"
    case rightArc = "right_arc"
    case wideTriangle = "wide_triangle"
    case compactTriangle = "compact_triangle"
    case clockwise = "clockwise"
    case counterclockwise = "counterclockwise"
}

struct LoopFallbackProvider: RoutingProvider {
    struct Candidate: Hashable {
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
        var firstError: Error?

        var allRejectedAsTooLong: Bool {
            !rejectionReasons.isEmpty &&
                rejectionReasons.allSatisfy { $0 == RejectionReason.tooLong.rawValue || $0 == RejectionReason.tooLongHard.rawValue }
        }

        var allRejectedAsTooShort: Bool {
            !rejectionReasons.isEmpty &&
                rejectionReasons.allSatisfy { $0 == RejectionReason.tooShort.rawValue || $0 == RejectionReason.tooShortHard.rawValue }
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
    }

    private let client: any GraphHopperMultiPointRouteCalculating
    private let seeds: [Int]
    private let maximumSuggestions: Int
    private let baseRadiusFactors: [Double]
    private let bearingPatterns: [LoopFallbackBearingPattern]

    init(
        client: any GraphHopperMultiPointRouteCalculating = GraphHopperClient(),
        seeds: [Int] = [11, 29, 47],
        maximumSuggestions: Int = 3,
        baseRadiusFactors: [Double] = [0.16, 0.19, 0.22],
        bearingPatterns: [LoopFallbackBearingPattern] = LoopFallbackBearingPattern.allCases
    ) {
        self.client = client
        self.seeds = seeds
        self.maximumSuggestions = maximumSuggestions
        self.baseRadiusFactors = baseRadiusFactors
        self.bearingPatterns = bearingPatterns
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> [RouteSuggestion] {
        guard intent.request.routeType == .loop else {
            throw RoutePromptParserError.invalidPrompt
        }

        let targetDistanceKm = intent.request.targetDistanceKm
            ?? RoutePlanningRequest.defaultLoopDistanceKm(for: intent.request.activityType)
        var signatures = Set<String>()

        let initialOutcome = await evaluateCandidates(
            start: intent.start,
            targetDistanceKm: targetDistanceKm,
            radiusFactors: baseRadiusFactors,
            intent: intent,
            signatures: &signatures
        )
        var variants = initialOutcome.accepted
        var firstError = initialOutcome.firstError

        if variants.isEmpty, initialOutcome.allRejectedAsTooLong {
            let retryOutcome = await evaluateCandidates(
                start: intent.start,
                targetDistanceKm: targetDistanceKm,
                radiusFactors: baseRadiusFactors.map { max($0 * 0.72, 0.08) },
                intent: intent,
                signatures: &signatures
            )
            variants.append(contentsOf: retryOutcome.accepted)
            firstError = firstError ?? retryOutcome.firstError
        } else if variants.isEmpty, initialOutcome.allRejectedAsTooShort {
            let retryOutcome = await evaluateCandidates(
                start: intent.start,
                targetDistanceKm: targetDistanceKm,
                radiusFactors: baseRadiusFactors.map { min($0 * 1.18, 0.28) },
                intent: intent,
                signatures: &signatures
            )
            variants.append(contentsOf: retryOutcome.accepted)
            firstError = firstError ?? retryOutcome.firstError
        }

        let rankedVariants = LoopRouteVariantRanker.rank(
            variants,
            targetDistanceKm: targetDistanceKm
        )
        .prefix(maximumSuggestions)

        let suggestions = rankedVariants.enumerated().map { index, variant in
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
                matchScore: max(96 - index * 4, 84),
                explanation: variant.route.planningMetadata?.variantLabel ?? variant.route.whyItMatches,
                debugMetadata: debugMetadata
            )
        }
        if !suggestions.isEmpty {
            return suggestions
        }

        throw firstError ?? GraphHopperError.noRouteFound
    }

    private func evaluateCandidates(
        start: Coordinate,
        targetDistanceKm: Double,
        radiusFactors: [Double],
        intent: RouteIntent,
        signatures: inout Set<String>
    ) async -> CandidateOutcome {
        var outcome = CandidateOutcome()

        let usableSeeds = seeds.isEmpty ? [11, 29, 47] : seeds
        for (index, pattern) in bearingPatterns.enumerated() {
            let seed = usableSeeds[index % usableSeeds.count]
            let candidate = Self.candidate(
                start: start,
                targetDistanceKm: targetDistanceKm,
                seed: seed,
                index: index,
                radiusFactors: radiusFactors,
                bearingPattern: pattern
            )
            do {
                let route = try await client.calculateGraphHopperRoute(
                    waypoints: candidate.waypoints,
                    request: intent.request,
                    seed: candidate.seed
                )
                guard Self.hasUsableGeometry(route) else {
                    outcome.rejectionReasons.append(RejectionReason.insufficientGeometry.rawValue)
                    continue
                }

                if let rejectionReason = Self.distanceRejectionReason(
                    route: route,
                    targetDistanceKm: targetDistanceKm
                ) {
                    outcome.rejectionReasons.append(rejectionReason.rawValue)
                    continue
                }

                let quality = Self.qualityAnalysis(for: route)
                if quality.overlapRatio > 0.25 {
                    outcome.rejectionReasons.append(RejectionReason.tooMuchOverlap.rawValue)
                    continue
                }

                let signature = Self.geometrySignature(for: route)
                guard !signature.isEmpty, signatures.insert(signature).inserted else {
                    outcome.rejectionReasons.append(RejectionReason.duplicateGeometry.rawValue)
                    continue
                }
                outcome.accepted.append(
                    LoopRouteVariantRanker.Variant(
                        seed: candidate.seed,
                        route: route,
                        radiusKm: candidate.radiusKm,
                        radiusFactor: candidate.radiusFactor,
                        bearingDegrees: candidate.baseBearingDegrees,
                        bearingPattern: candidate.bearingPattern.rawValue,
                        overlapRatio: quality.overlapRatio,
                        shapeQualityScore: quality.shapeQualityScore
                    )
                )
            } catch {
                if outcome.firstError == nil {
                    outcome.firstError = error
                }
            }
        }

        return outcome
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
        if ratio < 0.65 {
            return .tooShortHard
        }
        if ratio > 1.35 {
            return .tooLongHard
        }
        if ratio < 0.75 {
            return .tooShort
        }
        if ratio > 1.25 {
            return .tooLong
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
    static func suggestions(from routes: [TrailRoute]) -> [RouteSuggestion] {
        routes.enumerated().map { index, route in
            RouteSuggestion(
                route: route,
                matchScore: max(96 - index * 4, 84),
                explanation: route.planningMetadata?.variantLabel ?? route.whyItMatches
            )
        }
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
        targetDistanceKm: Double
    ) -> [Variant] {
        let preferredVariants = variants.filter { $0.overlapRatio < 0.18 }
        let sortableVariants = preferredVariants.isEmpty ? variants.filter { $0.overlapRatio <= 0.25 } : preferredVariants
        let sorted = sortableVariants.sorted { lhs, rhs in
            let lhsOverlapBucket = overlapBucket(lhs.overlapRatio)
            let rhsOverlapBucket = overlapBucket(rhs.overlapRatio)
            if lhsOverlapBucket != rhsOverlapBucket {
                return lhsOverlapBucket < rhsOverlapBucket
            }
            if lhs.shapeQualityScore != rhs.shapeQualityScore,
               abs(lhs.shapeQualityScore - rhs.shapeQualityScore) >= 0.08
            {
                return lhs.shapeQualityScore > rhs.shapeQualityScore
            }
            let lhsDistanceDifference = abs(lhs.route.distanceKilometers - targetDistanceKm)
            let rhsDistanceDifference = abs(rhs.route.distanceKilometers - targetDistanceKm)
            if lhsDistanceDifference != rhsDistanceDifference {
                return lhsDistanceDifference < rhsDistanceDifference
            }
            if lhs.route.durationMinutes != rhs.route.durationMinutes {
                return lhs.route.durationMinutes < rhs.route.durationMinutes
            }
            return lhs.route.elevationGainMeters < rhs.route.elevationGainMeters
        }

        guard !sorted.isEmpty else { return [] }

        let minimumElevation = sorted.map(\.route.elevationGainMeters).min()
        let maximumElevation = sorted.map(\.route.elevationGainMeters).max()

        return sorted.enumerated().map { index, variant in
            let label = label(
                route: variant.route,
                index: index,
                targetDistanceKm: targetDistanceKm,
                minimumElevation: minimumElevation,
                maximumElevation: maximumElevation
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

    private static func overlapBucket(_ overlapRatio: Double) -> Int {
        if overlapRatio < 0.10 {
            return 0
        }
        if overlapRatio < 0.18 {
            return 1
        }
        return 2
    }

    static func label(
        route: TrailRoute,
        index: Int,
        targetDistanceKm: Double,
        minimumElevation: Int?,
        maximumElevation: Int?
    ) -> String {
        if index == 0 {
            return "Closest Match"
        }

        let difference = route.distanceKilometers - targetDistanceKm
        if difference <= -0.75 {
            return "Shorter Loop"
        }
        if difference >= 0.75 {
            return "Longer Loop"
        }
        if let maximumElevation,
           route.elevationGainMeters == maximumElevation,
           maximumElevation != minimumElevation
        {
            return "More Elevation"
        }
        if let minimumElevation,
           route.elevationGainMeters == minimumElevation,
           maximumElevation != minimumElevation
        {
            return "Easier Option"
        }
        return "Loop Option"
    }
}

private extension Double {
    var normalizedDegrees: Double {
        let value = truncatingRemainder(dividingBy: 360)
        return value < 0 ? value + 360 : value
    }
}
