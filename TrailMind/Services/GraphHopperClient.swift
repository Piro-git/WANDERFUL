import Foundation

protocol GraphHopperRouteCalculating {
    func calculateGraphHopperRoute(
        request: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate
    ) async throws -> TrailRoute

    func calculateRoundTripRoute(
        start: Coordinate,
        request: RoutePlanningRequest,
        seed: Int?
    ) async throws -> TrailRoute

    func calculateRoundTripRouteVariants(
        start: Coordinate,
        request: RoutePlanningRequest,
        seeds: [Int]
    ) async throws -> [TrailRoute]
}

extension GraphHopperRouteCalculating {
    func calculateGraphHopperRoute(
        start: Coordinate,
        end: Coordinate,
        profile: String,
        startName: String?,
        endName: String?
    ) async throws -> TrailRoute {
        let activityType: ActivityType = switch profile {
        case "bike", "mtb", "racingbike": .biking
        case "foot": .hiking
        default: .trailRunning
        }
        let planningRequest = RoutePlanningRequest(
            routeType: .pointToPoint,
            startQuery: startName ?? "Start",
            endQuery: endName ?? "Finish",
            activityType: activityType,
            graphHopperProfile: profile,
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )
        return try await calculateGraphHopperRoute(
            request: planningRequest,
            start: start,
            end: end
        )
    }

    func calculateRoundTripRoute(
        start: Coordinate,
        request: RoutePlanningRequest,
        seed: Int?
    ) async throws -> TrailRoute {
        let routes = try await calculateRoundTripRouteVariants(
            start: start,
            request: request,
            seeds: seed.map { [$0] } ?? [11, 29, 47]
        )
        guard let first = routes.first else {
            throw GraphHopperError.noRouteFound
        }
        return first
    }

    func calculateRoundTripRouteVariants(
        start: Coordinate,
        request: RoutePlanningRequest,
        seeds: [Int]
    ) async throws -> [TrailRoute] {
        let fallbackEnd = Coordinate(
            latitude: start.latitude + 0.001,
            longitude: start.longitude + 0.001,
            elevationMeters: start.elevationMeters
        )
        let route = try await calculateGraphHopperRoute(
            request: request,
            start: start,
            end: fallbackEnd
        )
        return [route]
    }
}

enum GraphHopperError: LocalizedError, Sendable {
    case missingAPIKey
    case invalidEndpoint
    case invalidResponse
    case noRouteFound
    case api(statusCode: Int, message: String, hints: [String])
    case network(message: String)
    case decoding(message: String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey:
            "GraphHopper isn’t configured yet. Add your key to Configuration/Local.xcconfig."
        case .invalidEndpoint:
            "The GraphHopper endpoint could not be created."
        case .invalidResponse:
            "GraphHopper returned a response TrailMind couldn’t validate."
        case .noRouteFound:
            "GraphHopper couldn’t find a walkable route between these points."
        case let .api(statusCode, message, hints):
            {
                if Self.isFlexibleModeMessage(message, hints: hints) {
                    return "Live loop routing needs GraphHopper flexible mode, which is not available on this API plan."
                }
                let detail = ([message] + hints).filter { !$0.isEmpty }.joined(separator: " ")
                return detail.isEmpty ? "GraphHopper request failed with status \(statusCode)." : detail
            }()
        case let .network(message):
            "GraphHopper could not be reached. \(message)"
        case let .decoding(message):
            "GraphHopper returned an unexpected route format. \(message)"
        }
    }

    var isFlexibleModeUnavailable: Bool {
        switch self {
        case let .api(_, message, hints):
            Self.isFlexibleModeMessage(message, hints: hints)
        default:
            false
        }
    }

    private static func isFlexibleModeMessage(_ message: String, hints: [String]) -> Bool {
        ([message] + hints).contains { value in
            value.localizedCaseInsensitiveContains("flexible mode")
        }
    }
}

struct GraphHopperClient: RoutingService, GraphHopperRouteCalculating, GraphHopperMultiPointRouteCalculating {
    private let session: URLSession
    private let configurationProvider: @Sendable () throws -> GraphHopperConfiguration

    init(
        session: URLSession = .shared,
        configurationProvider: @escaping @Sendable () throws -> GraphHopperConfiguration = {
            try GraphHopperConfiguration.local()
        }
    ) {
        self.session = session
        self.configurationProvider = configurationProvider
    }

    func calculateGraphHopperRoute(
        start: Coordinate,
        end: Coordinate,
        profile: String = "foot",
        startName: String? = nil,
        endName: String? = nil
    ) async throws -> TrailRoute {
        let planningRequest = RoutePlanningRequest(
            routeType: .pointToPoint,
            startQuery: startName ?? "Ilsenburg",
            endQuery: endName ?? "Schierke",
            activityType: Self.activity(for: profile),
            graphHopperProfile: profile,
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )
        return try await calculateGraphHopperRoute(
            request: planningRequest,
            start: start,
            end: end
        )
    }

    func calculateRoundTripRoute(
        start: Coordinate,
        request planningRequest: RoutePlanningRequest,
        seed: Int? = nil
    ) async throws -> TrailRoute {
        let routes = try await calculateRoundTripRouteVariants(
            start: start,
            request: planningRequest,
            seeds: seed.map { [$0] } ?? [11, 29, 47]
        )
        guard let first = routes.first else {
            throw GraphHopperError.noRouteFound
        }
        return first
    }

    func calculateRoundTripRouteVariants(
        start: Coordinate,
        request planningRequest: RoutePlanningRequest,
        seeds: [Int] = [11, 29, 47]
    ) async throws -> [TrailRoute] {
        let configuration = try configurationProvider()
        var variants: [(seed: Int, route: TrailRoute)] = []
        var firstError: Error?

        for seed in seeds {
            do {
                let request = try makeRoundTripRequest(
                    configuration: configuration,
                    start: start,
                    planningRequest: planningRequest,
                    seed: seed
                )
                let route = try await execute(
                    request: request,
                    requestedStart: start,
                    requestedEnd: start,
                    planningRequest: planningRequest
                )
                variants.append((seed, route))
            } catch {
                if firstError == nil {
                    firstError = error
                }
            }
        }

        let rankedRoutes = Self.rankedLoopVariants(
            variants,
            targetDistanceKm: planningRequest.targetDistanceKm ?? RoutePlanningRequest.defaultLoopDistanceKm(for: planningRequest.activityType)
        )
        if !rankedRoutes.isEmpty {
            return rankedRoutes
        }

        throw firstError ?? GraphHopperError.noRouteFound
    }

    func calculateGraphHopperRoute(
        request planningRequest: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate
    ) async throws -> TrailRoute {
        let configuration = try configurationProvider()
        let routePreferences = GraphHopperRoutePreferences.conservative(for: planningRequest)
        let request = try makeRequest(
            configuration: configuration,
            start: start,
            end: end,
            planningRequest: planningRequest,
            routePreferences: routePreferences
        )

        do {
            return try await execute(
                request: request,
                requestedStart: start,
                requestedEnd: end,
                planningRequest: planningRequest
            )
        } catch let error as GraphHopperError {
            guard routePreferences.usesFlexibleRouting, error.isFlexibleRoutingFallbackCandidate else {
                throw error
            }

            let fallbackRequest = try makeRequest(
                configuration: configuration,
                start: start,
                end: end,
                planningRequest: planningRequest,
                routePreferences: nil
            )
            return try await execute(
                request: fallbackRequest,
                requestedStart: start,
                requestedEnd: end,
                planningRequest: planningRequest
            )
        }
    }

    func calculateGraphHopperRoute(
        waypoints: [Coordinate],
        request planningRequest: RoutePlanningRequest,
        seed: Int? = nil
    ) async throws -> TrailRoute {
        guard let start = waypoints.first, let end = waypoints.last, waypoints.count >= 2 else {
            throw TrailServiceError.noWaypoints
        }

        let configuration = try configurationProvider()
        let request = try makeMultiPointRequest(
            configuration: configuration,
            waypoints: waypoints,
            planningRequest: planningRequest
        )
        let route = try await execute(
            request: request,
            requestedStart: start,
            requestedEnd: end,
            planningRequest: planningRequest
        )

        guard let seed else {
            return route
        }
        return route.withPlanningMetadata(route.planningMetadata?.withVariant(seed: seed, label: nil))
    }

    private func execute(
        request: URLRequest,
        requestedStart: Coordinate,
        requestedEnd: Coordinate,
        planningRequest: RoutePlanningRequest
    ) async throws -> TrailRoute {
        do {
            let (data, urlResponse) = try await session.data(for: request)
            guard let httpResponse = urlResponse as? HTTPURLResponse else {
                throw GraphHopperError.invalidResponse
            }

            guard (200..<300).contains(httpResponse.statusCode) else {
                let envelope = try? JSONDecoder().decode(GraphHopperErrorEnvelope.self, from: data)
                throw GraphHopperError.api(
                    statusCode: httpResponse.statusCode,
                    message: envelope?.message ?? "GraphHopper request failed with status \(httpResponse.statusCode).",
                    hints: envelope?.hints.compactMap(\.displayMessage) ?? []
                )
            }

            let routeResponse: GraphHopperRouteResponse
            do {
                routeResponse = try JSONDecoder().decode(GraphHopperRouteResponse.self, from: data)
            } catch {
                throw GraphHopperError.decoding(message: error.localizedDescription)
            }

            guard let path = Self.bestPath(
                in: routeResponse.paths,
                targetDistanceKm: planningRequest.targetDistanceKm
            ) else {
                throw GraphHopperError.noRouteFound
            }
            return try makeTrailRoute(
                from: path,
                requestedStart: requestedStart,
                requestedEnd: requestedEnd,
                planningRequest: planningRequest
            )
        } catch let error as GraphHopperError {
            throw error
        } catch let error as URLError {
            throw GraphHopperError.network(message: error.localizedDescription)
        } catch {
            throw GraphHopperError.network(message: error.localizedDescription)
        }
    }

    func generateHarzDemoRoute() async throws -> TrailRoute {
        let ilsenburg = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let schierke = Coordinate(latitude: 51.7636, longitude: 10.6647)
        return try await calculateGraphHopperRoute(start: ilsenburg, end: schierke, profile: "foot")
    }

    func calculateRoute(waypoints: [Waypoint]) async throws -> TrailRoute {
        guard
            let start = waypoints.first?.coordinate,
            let end = waypoints.last?.coordinate,
            waypoints.count >= 2
        else {
            throw TrailServiceError.noWaypoints
        }
        return try await calculateGraphHopperRoute(
            start: start,
            end: end,
            profile: "foot",
            startName: waypoints.first?.name,
            endName: waypoints.last?.name
        )
    }

    func getElevationProfile(route: TrailRoute) async throws -> [Double] {
        let elevations = route.path.compactMap(\.elevationMeters)
        return elevations.isEmpty ? route.elevationProfile : elevations
    }

    private func makeRequest(
        configuration: GraphHopperConfiguration,
        start: Coordinate,
        end: Coordinate,
        profile: String
    ) throws -> URLRequest {
        let planningRequest = RoutePlanningRequest(
            routeType: .pointToPoint,
            startQuery: "Start",
            endQuery: "Finish",
            activityType: Self.activity(for: profile),
            graphHopperProfile: profile,
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )
        return try makeRequest(
            configuration: configuration,
            start: start,
            end: end,
            planningRequest: planningRequest,
            routePreferences: nil
        )
    }

    private func makeRequest(
        configuration: GraphHopperConfiguration,
        start: Coordinate,
        end: Coordinate,
        planningRequest: RoutePlanningRequest,
        routePreferences: GraphHopperRoutePreferences?
    ) throws -> URLRequest {
        guard var components = URLComponents(
            url: configuration.baseURL.appending(path: "route"),
            resolvingAgainstBaseURL: false
        ) else {
            throw GraphHopperError.invalidEndpoint
        }

        // TODO: Production builds must call a TrailMind backend proxy so the
        // GraphHopper key is never shipped inside the iOS application bundle.
        components.queryItems = [URLQueryItem(name: "key", value: configuration.apiKey)]
        guard let url = components.url else {
            throw GraphHopperError.invalidEndpoint
        }

        let payload = GraphHopperRouteRequest(
            profile: planningRequest.graphHopperProfile,
            points: [
                [start.longitude, start.latitude],
                [end.longitude, end.latitude]
            ],
            locale: "de",
            elevation: true,
            pointsEncoded: false,
            instructions: true,
            details: ["surface", "road_class", "hike_rating"],
            chDisable: routePreferences?.usesFlexibleRouting == true ? true : nil,
            customModel: routePreferences?.customModel,
            algorithm: routePreferences?.algorithm,
            alternativeRouteMaxPaths: routePreferences?.alternativeRoute?.maxPaths,
            alternativeRouteMaxWeightFactor: routePreferences?.alternativeRoute?.maxWeightFactor,
            alternativeRouteMaxShareFactor: routePreferences?.alternativeRoute?.maxShareFactor,
            roundTripDistance: nil,
            roundTripSeed: nil
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(payload)
        return request
    }

    private func makeMultiPointRequest(
        configuration: GraphHopperConfiguration,
        waypoints: [Coordinate],
        planningRequest: RoutePlanningRequest
    ) throws -> URLRequest {
        guard var components = URLComponents(
            url: configuration.baseURL.appending(path: "route"),
            resolvingAgainstBaseURL: false
        ) else {
            throw GraphHopperError.invalidEndpoint
        }

        // TODO: Production builds must call a TrailMind backend proxy so the
        // GraphHopper key is never shipped inside the iOS application bundle.
        components.queryItems = [URLQueryItem(name: "key", value: configuration.apiKey)]
        guard let url = components.url else {
            throw GraphHopperError.invalidEndpoint
        }

        let payload = GraphHopperRouteRequest(
            profile: planningRequest.graphHopperProfile,
            points: waypoints.map { [$0.longitude, $0.latitude] },
            locale: "de",
            elevation: true,
            pointsEncoded: false,
            instructions: true,
            details: ["surface", "road_class", "hike_rating"],
            chDisable: nil,
            customModel: nil,
            algorithm: nil,
            alternativeRouteMaxPaths: nil,
            alternativeRouteMaxWeightFactor: nil,
            alternativeRouteMaxShareFactor: nil,
            roundTripDistance: nil,
            roundTripSeed: nil
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(payload)
        return request
    }

    private func makeRoundTripRequest(
        configuration: GraphHopperConfiguration,
        start: Coordinate,
        planningRequest: RoutePlanningRequest,
        seed: Int
    ) throws -> URLRequest {
        guard var components = URLComponents(
            url: configuration.baseURL.appending(path: "route"),
            resolvingAgainstBaseURL: false
        ) else {
            throw GraphHopperError.invalidEndpoint
        }

        // TODO: Production builds must call a TrailMind backend proxy so the
        // GraphHopper key is never shipped inside the iOS application bundle.
        components.queryItems = [URLQueryItem(name: "key", value: configuration.apiKey)]
        guard let url = components.url else {
            throw GraphHopperError.invalidEndpoint
        }

        let targetDistanceKm = planningRequest.targetDistanceKm
            ?? RoutePlanningRequest.defaultLoopDistanceKm(for: planningRequest.activityType)
        let payload = GraphHopperRouteRequest(
            profile: planningRequest.graphHopperProfile,
            points: [
                [start.longitude, start.latitude]
            ],
            locale: "de",
            elevation: true,
            pointsEncoded: false,
            instructions: true,
            details: ["surface", "road_class", "hike_rating"],
            chDisable: true,
            customModel: nil,
            algorithm: "round_trip",
            alternativeRouteMaxPaths: nil,
            alternativeRouteMaxWeightFactor: nil,
            alternativeRouteMaxShareFactor: nil,
            roundTripDistance: targetDistanceKm * 1_000,
            roundTripSeed: seed
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(payload)
        return request
    }

    private func makeTrailRoute(
        from path: GraphHopperRoutePath,
        requestedStart: Coordinate,
        requestedEnd: Coordinate,
        profile: String,
        startName: String?,
        endName: String?
    ) throws -> TrailRoute {
        let planningRequest = RoutePlanningRequest(
            routeType: .pointToPoint,
            startQuery: startName ?? "Ilsenburg",
            endQuery: endName ?? "Schierke",
            activityType: Self.activity(for: profile),
            graphHopperProfile: profile,
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )
        return try makeTrailRoute(
            from: path,
            requestedStart: requestedStart,
            requestedEnd: requestedEnd,
            planningRequest: planningRequest
        )
    }

    private func makeTrailRoute(
        from path: GraphHopperRoutePath,
        requestedStart: Coordinate,
        requestedEnd: Coordinate,
        planningRequest: RoutePlanningRequest
    ) throws -> TrailRoute {
        let coordinates = path.points?.coordinates.compactMap(Self.decodeCoordinate) ?? []
        guard coordinates.count >= 2, path.distance >= 10, path.time > 0 else {
            throw GraphHopperError.noRouteFound
        }

        let distanceKilometers = path.distance / 1_000
        let durationHours = Double(path.time) / 3_600_000
        let computedGain = Self.elevationChange(in: coordinates, ascending: true)
        let computedLoss = Self.elevationChange(in: coordinates, ascending: false)
        let elevationGain = Int((path.ascend ?? computedGain).rounded())
        let elevationLoss = Int((path.descend ?? computedLoss).rounded())
        let routeInstructions = path.instructions.map { instruction in
            let coordinate = instruction.interval.first.flatMap { index in
                coordinates.indices.contains(index) ? coordinates[index] : nil
            }
            return RouteInstruction(
                text: instruction.text,
                streetName: instruction.streetName?.nilIfEmpty,
                distanceMeters: instruction.distance,
                durationSeconds: Double(instruction.time) / 1_000,
                sign: instruction.sign,
                coordinate: coordinate
            )
        }

        let snappedStart = coordinates.first ?? requestedStart
        let snappedEnd = coordinates.last ?? requestedEnd
        let activity = planningRequest.activityType
        let resolvedStartName = planningRequest.startQuery
        let resolvedEndName = planningRequest.endQuery ?? planningRequest.startQuery
        let computedDifficulty = Self.difficulty(distanceKilometers: distanceKilometers, elevationGainMeters: elevationGain)
        let routeDifficulty = planningRequest.difficulty ?? computedDifficulty
        let routeType = planningRequest.routeType

        return TrailRoute(
            id: UUID(),
            title: planningRequest.title(startName: resolvedStartName, endName: resolvedEndName),
            location: "Germany",
            activity: activity,
            distanceKilometers: distanceKilometers,
            elevationGainMeters: elevationGain,
            elevationLossMeters: elevationLoss,
            durationHours: durationHours,
            difficulty: routeDifficulty,
            routeType: routeType,
            summary: Self.summary(
                planningRequest: planningRequest,
                startName: resolvedStartName,
                endName: resolvedEndName
            ),
            whyItMatches: Self.whyItMatches(
                planningRequest: planningRequest,
                distanceKilometers: distanceKilometers
            ),
            highlights: [
                Highlight(title: "Live trail geometry", subtitle: "\(coordinates.count.formatted()) mapped route points", symbol: "point.bottomleft.forward.to.point.topright.scurvepath"),
                Highlight(title: "Elevation-aware", subtitle: "+\(elevationGain.formatted()) m ascent · −\(elevationLoss.formatted()) m descent", symbol: "mountain.2.fill"),
                Highlight(title: "German directions", subtitle: "\(routeInstructions.count.formatted()) route instructions", symbol: "signpost.right.fill")
            ],
            waypoints: [
                Waypoint(
                    name: resolvedStartName,
                    detail: routeType == .loop ? "GraphHopper snapped loop start" : "GraphHopper snapped start",
                    distanceKilometers: 0,
                    kind: .start,
                    coordinate: snappedStart
                ),
                Waypoint(
                    name: routeType == .loop ? resolvedStartName : resolvedEndName,
                    detail: routeType == .loop ? "Loop finish near start" : "GraphHopper snapped finish",
                    distanceKilometers: distanceKilometers,
                    kind: .finish,
                    coordinate: routeType == .loop ? snappedStart : snappedEnd
                )
            ],
            days: [],
            safetyNotes: [
                SafetyNote(
                    title: "Review before use",
                    message: "This live route still requires a check of current weather, closures, local rules and trail conditions.",
                    severity: .caution
                ),
                SafetyNote(
                    title: "Routing data",
                    message: "Geometry and route metrics are provided by GraphHopper using OpenStreetMap data.",
                    severity: .info
                )
            ],
            elevationProfile: Self.downsample(
                coordinates.compactMap(\.elevationMeters),
                maximumCount: 160
            ),
            path: coordinates,
            routeInstructions: routeInstructions,
            planningMetadata: planningRequest.metadata
        )
    }

    private static func decodeCoordinate(_ values: [Double]) -> Coordinate? {
        guard
            values.count >= 2,
            (-180...180).contains(values[0]),
            (-90...90).contains(values[1])
        else {
            return nil
        }
        return Coordinate(
            latitude: values[1],
            longitude: values[0],
            elevationMeters: values.count >= 3 ? values[2] : nil
        )
    }

    private static func elevationChange(in coordinates: [Coordinate], ascending: Bool) -> Double {
        zip(coordinates, coordinates.dropFirst()).reduce(into: 0) { total, pair in
            guard let from = pair.0.elevationMeters, let to = pair.1.elevationMeters else { return }
            let difference = to - from
            if ascending, difference > 0 {
                total += difference
            } else if !ascending, difference < 0 {
                total += abs(difference)
            }
        }
    }

    private static func downsample(_ values: [Double], maximumCount: Int) -> [Double] {
        guard values.count > maximumCount else { return values }
        let stride = Double(values.count - 1) / Double(maximumCount - 1)
        return (0..<maximumCount).map { index in
            values[Int((Double(index) * stride).rounded())]
        }
    }

    private static func bestPath(
        in paths: [GraphHopperRoutePath],
        targetDistanceKm: Double?
    ) -> GraphHopperRoutePath? {
        guard let targetDistanceKm else {
            return paths.first
        }
        return paths.min { lhs, rhs in
            abs((lhs.distance / 1_000) - targetDistanceKm) < abs((rhs.distance / 1_000) - targetDistanceKm)
        }
    }

    private static func rankedLoopVariants(
        _ variants: [(seed: Int, route: TrailRoute)],
        targetDistanceKm: Double
    ) -> [TrailRoute] {
        let sorted = variants.sorted { lhs, rhs in
            let lhsDistanceDifference = abs(lhs.route.distanceKilometers - targetDistanceKm)
            let rhsDistanceDifference = abs(rhs.route.distanceKilometers - targetDistanceKm)
            if lhsDistanceDifference != rhsDistanceDifference {
                return lhsDistanceDifference < rhsDistanceDifference
            }
            if lhs.route.elevationGainMeters != rhs.route.elevationGainMeters {
                return lhs.route.elevationGainMeters < rhs.route.elevationGainMeters
            }
            return lhs.route.durationMinutes < rhs.route.durationMinutes
        }

        guard !sorted.isEmpty else { return [] }

        let minimumElevation = sorted.map(\.route.elevationGainMeters).min()
        let maximumElevation = sorted.map(\.route.elevationGainMeters).max()

        return sorted.enumerated().map { index, variant in
            let label = loopVariantLabel(
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

    private static func loopVariantLabel(
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
        if let maximumElevation, route.elevationGainMeters == maximumElevation, maximumElevation != minimumElevation {
            return "More Elevation"
        }
        if let minimumElevation, route.elevationGainMeters == minimumElevation, maximumElevation != minimumElevation {
            return "Easier Option"
        }
        return "Loop Option"
    }

    private static func activity(for profile: String) -> ActivityType {
        switch profile {
        case "bike", "mtb", "racingbike": .biking
        case "foot": .hiking
        default: .trailRunning
        }
    }

    private static func difficulty(
        distanceKilometers: Double,
        elevationGainMeters: Int
    ) -> RouteDifficulty {
        if distanceKilometers >= 18 || elevationGainMeters >= 800 {
            return .challenging
        }
        if distanceKilometers >= 10 || elevationGainMeters >= 350 {
            return .moderate
        }
        return .easy
    }

    private static func whyItMatches(
        planningRequest: RoutePlanningRequest,
        distanceKilometers: Double
    ) -> String {
        var parts = ["Live route geometry, elevation and German instructions returned by GraphHopper."]
        if let requestedFeatureSummary = planningRequest.metadata.requestedFeatureSummary {
            parts.append(requestedFeatureSummary)
        }
        if let distanceNote = planningRequest.metadata.distanceNote(actualDistanceKm: distanceKilometers) {
            parts.append(distanceNote)
        }
        return parts.joined(separator: " ")
    }

    private static func summary(
        planningRequest: RoutePlanningRequest,
        startName: String,
        endName: String
    ) -> String {
        if planningRequest.routeType == .loop {
            return "A live GraphHopper \(planningRequest.activityType.rawValue.lowercased()) loop around \(startName), calculated from trail-network data."
        }
        return "A live GraphHopper \(planningRequest.activityType.rawValue.lowercased()) route from \(startName) to \(endName), calculated from trail-network data."
    }
}

private extension GraphHopperError {
    var isFlexibleRoutingFallbackCandidate: Bool {
        switch self {
        case .api:
            true
        default:
            false
        }
    }
}

private struct GraphHopperRouteRequest: Encodable {
    let profile: String
    let points: [[Double]]
    let locale: String
    let elevation: Bool
    let pointsEncoded: Bool
    let instructions: Bool
    let details: [String]
    let chDisable: Bool?
    let customModel: GraphHopperCustomModel?
    let algorithm: String?
    let alternativeRouteMaxPaths: Int?
    let alternativeRouteMaxWeightFactor: Double?
    let alternativeRouteMaxShareFactor: Double?
    let roundTripDistance: Double?
    let roundTripSeed: Int?

    enum CodingKeys: String, CodingKey {
        case profile
        case points
        case locale
        case elevation
        case pointsEncoded = "points_encoded"
        case instructions
        case details
        case chDisable = "ch.disable"
        case customModel = "custom_model"
        case algorithm
        case alternativeRouteMaxPaths = "alternative_route.max_paths"
        case alternativeRouteMaxWeightFactor = "alternative_route.max_weight_factor"
        case alternativeRouteMaxShareFactor = "alternative_route.max_share_factor"
        case roundTripDistance = "round_trip.distance"
        case roundTripSeed = "round_trip.seed"
    }
}

private struct GraphHopperRoutePreferences {
    let customModel: GraphHopperCustomModel?
    let alternativeRoute: GraphHopperAlternativeRoute?

    var algorithm: String? {
        alternativeRoute == nil ? nil : "alternative_route"
    }

    var usesFlexibleRouting: Bool {
        customModel != nil || alternativeRoute != nil
    }

    static func conservative(for request: RoutePlanningRequest) -> Self {
        // GraphHopper custom_model support requires flexible mode
        // (`ch.disable=true`). These early rules are intentionally mild. TODO:
        // tune statements against real route/path-detail analytics before making
        // stronger scenic, forest, water or viewpoint claims.
        var priority: [GraphHopperCustomStatement] = []

        switch request.activityType {
        case .hiking, .trailRunning:
            priority.append(.init(condition: "road_class == PRIMARY", multiplyBy: "0.85"))
            priority.append(.init(condition: "road_class == SECONDARY", multiplyBy: "0.9"))
        case .biking:
            priority.append(.init(condition: "road_class == PRIMARY", multiplyBy: "0.9"))
            priority.append(.init(condition: "road_class == TRACK", multiplyBy: "1.05"))
        }

        if request.desiredFeatures.contains(.quiet) || request.avoidFeatures.contains(.majorRoads) {
            priority.append(.init(condition: "road_class == TRUNK", multiplyBy: "0.75"))
        }

        guard !priority.isEmpty else {
            return Self(
                customModel: nil,
                alternativeRoute: Self.alternativeRoute(for: request)
            )
        }

        return Self(
            customModel: GraphHopperCustomModel(
                priority: priority,
                distanceInfluence: request.targetDistanceKm == nil ? nil : 70
            ),
            alternativeRoute: Self.alternativeRoute(for: request)
        )
    }

    private static func alternativeRoute(for request: RoutePlanningRequest) -> GraphHopperAlternativeRoute? {
        guard request.targetDistanceKm != nil else { return nil }
        return GraphHopperAlternativeRoute(
            maxPaths: 3,
            maxWeightFactor: 1.4,
            maxShareFactor: 0.65
        )
    }
}

private struct GraphHopperAlternativeRoute {
    let maxPaths: Int
    let maxWeightFactor: Double
    let maxShareFactor: Double
}

private struct GraphHopperCustomModel: Encodable {
    let priority: [GraphHopperCustomStatement]
    let distanceInfluence: Double?

    enum CodingKeys: String, CodingKey {
        case priority
        case distanceInfluence = "distance_influence"
    }
}

private struct GraphHopperCustomStatement: Encodable {
    let condition: String
    let multiplyBy: String

    init(condition: String, multiplyBy: String) {
        self.condition = condition
        self.multiplyBy = multiplyBy
    }

    enum CodingKeys: String, CodingKey {
        case condition = "if"
        case multiplyBy = "multiply_by"
    }
}

private struct GraphHopperRouteResponse: Decodable {
    let paths: [GraphHopperRoutePath]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        paths = try container.decodeIfPresent([GraphHopperRoutePath].self, forKey: .paths) ?? []
    }

    enum CodingKeys: String, CodingKey {
        case paths
    }
}

private struct GraphHopperRoutePath: Decodable {
    let distance: Double
    let time: Int64
    let ascend: Double?
    let descend: Double?
    let points: GraphHopperLineString?
    let instructions: [GraphHopperInstruction]

    enum CodingKeys: String, CodingKey {
        case distance
        case time
        case ascend
        case descend
        case points
        case instructions
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        distance = try container.decode(Double.self, forKey: .distance)
        time = try container.decode(Int64.self, forKey: .time)
        ascend = try container.decodeIfPresent(Double.self, forKey: .ascend)
        descend = try container.decodeIfPresent(Double.self, forKey: .descend)
        points = try container.decodeIfPresent(GraphHopperLineString.self, forKey: .points)
        instructions = try container.decodeIfPresent([GraphHopperInstruction].self, forKey: .instructions) ?? []
    }
}

private struct GraphHopperLineString: Decodable {
    let type: String
    let coordinates: [[Double]]
}

private struct GraphHopperInstruction: Decodable {
    let text: String
    let streetName: String?
    let distance: Double
    let time: Int64
    let interval: [Int]
    let sign: Int

    enum CodingKeys: String, CodingKey {
        case text
        case streetName = "street_name"
        case distance
        case time
        case interval
        case sign
    }
}

private struct GraphHopperErrorEnvelope: Decodable {
    let message: String?
    let hints: [GraphHopperErrorHint]

    enum CodingKeys: String, CodingKey {
        case message
        case hints
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        message = try container.decodeIfPresent(String.self, forKey: .message)
        hints = try container.decodeIfPresent([GraphHopperErrorHint].self, forKey: .hints) ?? []
    }
}

private struct GraphHopperErrorHint: Decodable {
    let message: String?
    let details: String?

    var displayMessage: String? {
        message?.nilIfEmpty ?? details?.nilIfEmpty
    }

    enum CodingKeys: String, CodingKey {
        case message
        case details
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        message = try? container.decode(String.self, forKey: .message)
        details = try? container.decode(String.self, forKey: .details)
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
