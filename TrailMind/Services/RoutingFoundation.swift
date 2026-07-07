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

struct LoopFallbackProvider: RoutingProvider {
    struct Candidate: Hashable {
        let seed: Int
        let waypoints: [Coordinate]
    }

    private let client: any GraphHopperMultiPointRouteCalculating
    private let seeds: [Int]
    private let maximumSuggestions: Int

    init(
        client: any GraphHopperMultiPointRouteCalculating = GraphHopperClient(),
        seeds: [Int] = [11, 29, 47],
        maximumSuggestions: Int = 3
    ) {
        self.client = client
        self.seeds = seeds
        self.maximumSuggestions = maximumSuggestions
    }

    func routeSuggestions(for intent: RouteIntent) async throws -> [RouteSuggestion] {
        guard intent.request.routeType == .loop else {
            throw RoutePromptParserError.invalidPrompt
        }

        let targetDistanceKm = intent.request.targetDistanceKm
            ?? RoutePlanningRequest.defaultLoopDistanceKm(for: intent.request.activityType)
        var variants: [(seed: Int, route: TrailRoute)] = []
        var signatures = Set<String>()
        var firstError: Error?

        for candidate in Self.makeCandidates(
            start: intent.start,
            targetDistanceKm: targetDistanceKm,
            seeds: seeds
        ) {
            do {
                let route = try await client.calculateGraphHopperRoute(
                    waypoints: candidate.waypoints,
                    request: intent.request,
                    seed: candidate.seed
                )
                guard Self.isUsable(route) else { continue }

                let signature = Self.geometrySignature(for: route)
                guard !signature.isEmpty, signatures.insert(signature).inserted else { continue }
                variants.append((candidate.seed, route))
            } catch {
                if firstError == nil {
                    firstError = error
                }
            }
        }

        let rankedRoutes = LoopRouteVariantRanker.rank(
            variants,
            targetDistanceKm: targetDistanceKm
        )
        .prefix(maximumSuggestions)

        let suggestions = RouteSuggestionNormalizer.suggestions(from: Array(rankedRoutes))
        if !suggestions.isEmpty {
            return suggestions
        }

        throw firstError ?? GraphHopperError.noRouteFound
    }

    static func makeCandidates(
        start: Coordinate,
        targetDistanceKm: Double,
        seeds: [Int] = [11, 29, 47]
    ) -> [Candidate] {
        seeds.enumerated().map { index, seed in
            let baseBearing = Double((seed * 37) % 360)
            let legDistanceKm = max(targetDistanceKm / Double(index == 2 ? 4 : 3), 0.8)
            let bearings: [Double] = if index == 2 {
                [
                    baseBearing,
                    baseBearing + 95,
                    baseBearing + 205
                ]
            } else {
                [
                    baseBearing,
                    baseBearing + 125
                ]
            }
            let viaPoints = bearings.map {
                offsetCoordinate(from: start, distanceKm: legDistanceKm, bearingDegrees: $0)
            }
            return Candidate(seed: seed, waypoints: [start] + viaPoints + [start])
        }
    }

    static func isUsable(_ route: TrailRoute) -> Bool {
        route.path.count >= 12 &&
            route.distanceKilometers >= 0.5 &&
            route.durationMinutes > 0
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
    static func rank(
        _ variants: [(seed: Int, route: TrailRoute)],
        targetDistanceKm: Double
    ) -> [TrailRoute] {
        let sorted = variants.sorted { lhs, rhs in
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
            return variant.route.withPlanningMetadata(metadata)
        }
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
