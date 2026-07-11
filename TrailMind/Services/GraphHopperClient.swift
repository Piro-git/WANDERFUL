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

    func calculateRoundTripRouteVariants(
        start: Coordinate,
        request: RoutePlanningRequest,
        seeds: [Int],
        deadline: Date?,
        maximumConcurrentRequests: Int
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

    func calculateRoundTripRouteVariants(
        start: Coordinate,
        request: RoutePlanningRequest,
        seeds: [Int],
        deadline: Date?,
        maximumConcurrentRequests: Int
    ) async throws -> [TrailRoute] {
        try await calculateRoundTripRouteVariants(
            start: start,
            request: request,
            seeds: seeds
        )
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

struct GraphHopperClient: RoutingService, GraphHopperRouteCalculating, GraphHopperMultiPointRouteCalculating, ConcurrentGraphHopperMultiPointRouteCalculating {
    private let session: URLSession
    private let configurationProvider: @Sendable () throws -> GraphHopperConfiguration
    private let gateway: (any BackendRouteGatewayRouting)?

    init() {
        session = .shared
        configurationProvider = { throw GraphHopperError.missingAPIKey }
        gateway = BackendRouteGateway()
    }

    init(
        session: URLSession,
        configurationProvider: @escaping @Sendable () throws -> GraphHopperConfiguration
    ) {
        self.session = session
        self.configurationProvider = configurationProvider
        gateway = nil
    }

    init(gateway: any BackendRouteGatewayRouting) {
        session = .shared
        configurationProvider = { throw GraphHopperError.missingAPIKey }
        self.gateway = gateway
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
        try await calculateRoundTripRouteVariants(
            start: start,
            request: planningRequest,
            seeds: seeds,
            deadline: nil,
            maximumConcurrentRequests: 1
        )
    }

    func calculateRoundTripRouteVariants(
        start: Coordinate,
        request planningRequest: RoutePlanningRequest,
        seeds: [Int],
        deadline: Date?,
        maximumConcurrentRequests: Int
    ) async throws -> [TrailRoute] {
        if let gateway {
            return try await calculateGatewayRoundTripRouteVariants(
                gateway: gateway,
                start: start,
                planningRequest: planningRequest,
                seeds: seeds,
                deadline: deadline,
                maximumConcurrentRequests: maximumConcurrentRequests
            )
        }
        let configuration = try configurationProvider()
        var variants: [(seed: Int, route: TrailRoute)] = []
        var firstError: Error?
        let concurrency = max(maximumConcurrentRequests, 1)
        var nextSeedIndex = 0

        while nextSeedIndex < seeds.count {
            guard deadline.map({ Date() < $0 }) ?? true else { break }
            let batchEnd = min(nextSeedIndex + concurrency, seeds.count)
            let batch = Array(seeds[nextSeedIndex..<batchEnd])
            let results = await roundTripResults(
                for: batch,
                configuration: configuration,
                start: start,
                planningRequest: planningRequest,
                deadline: deadline
            )
            for (seed, result) in results {
                switch result {
                case let .success(route):
                    variants.append((seed, route))
                case let .failure(error):
                    firstError = firstError ?? error
                }
            }
            nextSeedIndex = batchEnd
        }

        let rankedRoutes = Self.rankedLoopVariants(
            variants,
            planningRequest: planningRequest
        )
        if !rankedRoutes.isEmpty {
            return rankedRoutes
        }

        throw firstError ?? GraphHopperError.noRouteFound
    }

    private func roundTripResults(
        for seeds: [Int],
        configuration: GraphHopperConfiguration,
        start: Coordinate,
        planningRequest: RoutePlanningRequest,
        deadline: Date?
    ) async -> [(Int, Result<TrailRoute, Error>)] {
        guard seeds.count == 2 else {
            guard let seed = seeds.first else { return [] }
            return [(
                seed,
                await roundTripResult(
                    seed: seed,
                    configuration: configuration,
                    start: start,
                    planningRequest: planningRequest,
                    deadline: deadline
                )
            )]
        }

        async let first = roundTripResult(
            seed: seeds[0],
            configuration: configuration,
            start: start,
            planningRequest: planningRequest,
            deadline: deadline
        )
        async let second = roundTripResult(
            seed: seeds[1],
            configuration: configuration,
            start: start,
            planningRequest: planningRequest,
            deadline: deadline
        )
        return [(seeds[0], await first), (seeds[1], await second)]
    }

    private func roundTripResult(
        seed: Int,
        configuration: GraphHopperConfiguration,
        start: Coordinate,
        planningRequest: RoutePlanningRequest,
        deadline: Date?
    ) async -> Result<TrailRoute, Error> {
        do {
            let request = try makeRoundTripRequest(
                configuration: configuration,
                start: start,
                planningRequest: planningRequest,
                seed: seed,
                timeoutInterval: requestTimeout(until: deadline)
            )
            let route = try await execute(
                request: request,
                requestedStart: start,
                requestedEnd: start,
                planningRequest: planningRequest
            )
            return .success(route)
        } catch {
            return .failure(error)
        }
    }

    func calculateGraphHopperRoute(
        request planningRequest: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate
    ) async throws -> TrailRoute {
        let routePreferences = GraphHopperRoutePreferences.conservative(for: planningRequest)
        if let gateway {
            return try await calculateGatewayPointToPointRoute(
                gateway: gateway,
                planningRequest: planningRequest,
                start: start,
                end: end,
                routePreferences: routePreferences
            )
        }
        let configuration = try configurationProvider()
        let request = try makeRequest(
            configuration: configuration,
            start: start,
            end: end,
            planningRequest: planningRequest,
            routePreferences: routePreferences
        )

        do {
            let route = try await execute(
                request: request,
                requestedStart: start,
                requestedEnd: end,
                planningRequest: planningRequest
            )
            return route.withPlanningMetadata(
                route.planningMetadata?.withRouteShapingSummary(
                    .pointToPoint(
                        request: planningRequest,
                        customModelApplied: routePreferences.customModel != nil,
                        alternativeRoutesApplied: routePreferences.alternativeRoute != nil
                    )
                )
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
            let route = try await execute(
                request: fallbackRequest,
                requestedStart: start,
                requestedEnd: end,
                planningRequest: planningRequest
            )
            return route.withPlanningMetadata(
                route.planningMetadata?.withRouteShapingSummary(
                    .pointToPoint(
                        request: planningRequest,
                        customModelApplied: false,
                        alternativeRoutesApplied: false
                    )
                )
            )
        }
    }

    func calculateGraphHopperRoute(
        waypoints: [Coordinate],
        request planningRequest: RoutePlanningRequest,
        seed: Int? = nil
    ) async throws -> TrailRoute {
        try await calculateGraphHopperRoute(
            waypoints: waypoints,
            request: planningRequest,
            seed: seed,
            deadline: nil
        )
    }

    func calculateGraphHopperRoute(
        waypoints: [Coordinate],
        request planningRequest: RoutePlanningRequest,
        seed: Int?,
        deadline: Date?
    ) async throws -> TrailRoute {
        guard let start = waypoints.first, let end = waypoints.last, waypoints.count >= 2 else {
            throw TrailServiceError.noWaypoints
        }

        if let gateway {
            let route = try await executeGateway(
                gateway: gateway,
                request: backendMultiPointRequest(
                    waypoints: waypoints,
                    planningRequest: planningRequest
                ),
                requestedStart: start,
                requestedEnd: end,
                planningRequest: planningRequest
            )
            guard let seed else { return route }
            return route.withPlanningMetadata(route.planningMetadata?.withVariant(seed: seed, label: nil))
        }
        let configuration = try configurationProvider()
        let request = try makeMultiPointRequest(
            configuration: configuration,
            waypoints: waypoints,
            planningRequest: planningRequest,
            timeoutInterval: requestTimeout(until: deadline)
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

    private func calculateGatewayPointToPointRoute(
        gateway: any BackendRouteGatewayRouting,
        planningRequest: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate,
        routePreferences: GraphHopperRoutePreferences
    ) async throws -> TrailRoute {
        do {
            let route = try await executeGateway(
                gateway: gateway,
                request: backendPointToPointRequest(
                    start: start,
                    end: end,
                    planningRequest: planningRequest,
                    routePreferences: routePreferences
                ),
                requestedStart: start,
                requestedEnd: end,
                planningRequest: planningRequest
            )
            return route.withPlanningMetadata(
                route.planningMetadata?.withRouteShapingSummary(
                    .pointToPoint(
                        request: planningRequest,
                        customModelApplied: routePreferences.customModel != nil,
                        alternativeRoutesApplied: routePreferences.alternativeRoute != nil
                    )
                )
            )
        } catch let error as GraphHopperError {
            guard routePreferences.usesFlexibleRouting, error.isFlexibleRoutingFallbackCandidate else {
                throw error
            }
            let route = try await executeGateway(
                gateway: gateway,
                request: backendPointToPointRequest(
                    start: start,
                    end: end,
                    planningRequest: planningRequest,
                    routePreferences: nil
                ),
                requestedStart: start,
                requestedEnd: end,
                planningRequest: planningRequest
            )
            return route.withPlanningMetadata(
                route.planningMetadata?.withRouteShapingSummary(
                    .pointToPoint(
                        request: planningRequest,
                        customModelApplied: false,
                        alternativeRoutesApplied: false
                    )
                )
            )
        }
    }

    private func calculateGatewayRoundTripRouteVariants(
        gateway: any BackendRouteGatewayRouting,
        start: Coordinate,
        planningRequest: RoutePlanningRequest,
        seeds: [Int],
        deadline: Date?,
        maximumConcurrentRequests: Int
    ) async throws -> [TrailRoute] {
        var variants: [(seed: Int, route: TrailRoute)] = []
        var firstError: Error?
        var nextSeedIndex = 0
        let concurrency = max(maximumConcurrentRequests, 1)
        while nextSeedIndex < seeds.count {
            guard deadline.map({ Date() < $0 }) ?? true else { break }
            let batchEnd = min(nextSeedIndex + concurrency, seeds.count)
            let batch = Array(seeds[nextSeedIndex..<batchEnd])
            let results = await gatewayRoundTripResults(
                gateway: gateway,
                seeds: batch,
                start: start,
                planningRequest: planningRequest
            )
            for (seed, result) in results {
                switch result {
                case let .success(route): variants.append((seed, route))
                case let .failure(error): firstError = firstError ?? error
                }
            }
            nextSeedIndex = batchEnd
        }
        let routes = Self.rankedLoopVariants(variants, planningRequest: planningRequest)
        if !routes.isEmpty { return routes }
        throw firstError ?? GraphHopperError.noRouteFound
    }

    private func gatewayRoundTripResults(
        gateway: any BackendRouteGatewayRouting,
        seeds: [Int],
        start: Coordinate,
        planningRequest: RoutePlanningRequest
    ) async -> [(Int, Result<TrailRoute, Error>)] {
        guard seeds.count == 2 else {
            guard let seed = seeds.first else { return [] }
            return [(seed, await gatewayRoundTripResult(
                gateway: gateway,
                seed: seed,
                start: start,
                planningRequest: planningRequest
            ))]
        }
        async let first = gatewayRoundTripResult(
            gateway: gateway,
            seed: seeds[0],
            start: start,
            planningRequest: planningRequest
        )
        async let second = gatewayRoundTripResult(
            gateway: gateway,
            seed: seeds[1],
            start: start,
            planningRequest: planningRequest
        )
        return [(seeds[0], await first), (seeds[1], await second)]
    }

    private func gatewayRoundTripResult(
        gateway: any BackendRouteGatewayRouting,
        seed: Int,
        start: Coordinate,
        planningRequest: RoutePlanningRequest
    ) async -> Result<TrailRoute, Error> {
        do {
            let route = try await executeGateway(
                gateway: gateway,
                request: backendRoundTripRequest(
                    start: start,
                    planningRequest: planningRequest,
                    seed: seed
                ),
                requestedStart: start,
                requestedEnd: start,
                planningRequest: planningRequest
            )
            return .success(route.withPlanningMetadata(
                route.planningMetadata?.withVariant(seed: seed, label: nil)
            ))
        } catch {
            return .failure(error)
        }
    }

    private func executeGateway(
        gateway: any BackendRouteGatewayRouting,
        request: BackendRouteRequest,
        requestedStart: Coordinate,
        requestedEnd: Coordinate,
        planningRequest: RoutePlanningRequest
    ) async throws -> TrailRoute {
        let data = try await gateway.route(request)
        let response: GraphHopperRouteResponse
        do {
            response = try JSONDecoder().decode(GraphHopperRouteResponse.self, from: data)
        } catch {
            throw GraphHopperError.decoding(message: "TrailMind’s routing service returned an unexpected response.")
        }
        guard let path = Self.bestPath(
            in: response.paths,
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
    }

    private func backendPointToPointRequest(
        start: Coordinate,
        end: Coordinate,
        planningRequest: RoutePlanningRequest,
        routePreferences: GraphHopperRoutePreferences?
    ) -> BackendRouteRequest {
        BackendRouteRequest(
            profile: planningRequest.graphHopperProfile,
            routeType: "pointToPoint",
            points: [start, end].map(BackendRouteRequest.Point.init),
            algorithm: routePreferences?.algorithm,
            roundTrip: nil,
            alternativeRoute: routePreferences?.alternativeRoute.map {
                BackendRouteRequest.AlternativeRoute(
                    maxPaths: $0.maxPaths,
                    maxWeightFactor: $0.maxWeightFactor,
                    maxShareFactor: $0.maxShareFactor
                )
            },
            locale: "de",
            includeElevation: true,
            includeInstructions: true,
            includePathDetails: ["surface", "road_class", "hike_rating"],
            preferences: routePreferences == nil ? nil : backendPreferences(for: planningRequest)
        )
    }

    private func backendRoundTripRequest(
        start: Coordinate,
        planningRequest: RoutePlanningRequest,
        seed: Int
    ) -> BackendRouteRequest {
        let targetDistance = planningRequest.targetDistanceKm
            ?? RoutePlanningRequest.defaultLoopDistanceKm(for: planningRequest.activityType)
        return BackendRouteRequest(
            profile: planningRequest.graphHopperProfile,
            routeType: "loop",
            points: [BackendRouteRequest.Point(start)],
            algorithm: "round_trip",
            roundTrip: .init(distanceMeters: targetDistance * 1_000, seed: seed),
            alternativeRoute: nil,
            locale: "de",
            includeElevation: true,
            includeInstructions: true,
            includePathDetails: ["surface", "road_class", "hike_rating"],
            preferences: nil
        )
    }

    private func backendMultiPointRequest(
        waypoints: [Coordinate],
        planningRequest: RoutePlanningRequest
    ) -> BackendRouteRequest {
        BackendRouteRequest(
            profile: planningRequest.graphHopperProfile,
            routeType: planningRequest.routeType == .loop ? "loop" : "pointToPoint",
            points: waypoints.map(BackendRouteRequest.Point.init),
            algorithm: nil,
            roundTrip: nil,
            alternativeRoute: nil,
            locale: "de",
            includeElevation: true,
            includeInstructions: true,
            includePathDetails: ["surface", "road_class", "hike_rating"],
            preferences: nil
        )
    }

    private func backendPreferences(
        for planningRequest: RoutePlanningRequest
    ) -> BackendRouteRequest.Preferences {
        var avoid: [String] = []
        if planningRequest.avoidFeatures.contains(.majorRoads) { avoid.append("majorRoads") }
        if planningRequest.avoidFeatures.contains(.steepClimbs) { avoid.append("steepClimbs") }
        let activityType = switch planningRequest.activityType {
        case .hiking: "hiking"
        case .trailRunning: "trailRunning"
        case .biking: "biking"
        }
        return BackendRouteRequest.Preferences(
            activityType: activityType,
            avoid: avoid,
            difficulty: planningRequest.difficulty == .easy ? "easy" : nil
        )
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
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as GraphHopperError {
            throw error
        } catch let error as URLError {
            if error.code == .cancelled, Task.isCancelled {
                throw CancellationError()
            }
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
        planningRequest: RoutePlanningRequest,
        timeoutInterval: TimeInterval = 30
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
        request.timeoutInterval = timeoutInterval
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(payload)
        return request
    }

    private func makeRoundTripRequest(
        configuration: GraphHopperConfiguration,
        start: Coordinate,
        planningRequest: RoutePlanningRequest,
        seed: Int,
        timeoutInterval: TimeInterval = 30
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
        request.timeoutInterval = timeoutInterval
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(payload)
        return request
    }

    private func requestTimeout(until deadline: Date?) -> TimeInterval {
        guard let deadline else { return 30 }
        return min(max(deadline.timeIntervalSinceNow, 0.5), 30)
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
        let verifiedCharacteristics = Self.verifiedCharacteristics(
            details: path.details,
            coordinates: coordinates
        )

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
            title: planningRequest.title(
                startName: resolvedStartName,
                endName: resolvedEndName,
                actualDistanceKm: distanceKilometers
            ),
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
            planningMetadata: planningRequest.metadata,
            verifiedCharacteristics: verifiedCharacteristics
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

    private static func verifiedCharacteristics(
        details: GraphHopperPathDetails?,
        coordinates: [Coordinate]
    ) -> VerifiedRouteCharacteristics? {
        guard let details, coordinates.count >= 2 else { return nil }

        let segmentDistances = zip(coordinates, coordinates.dropFirst()).map(distanceMeters)
        let routeDistanceMeters = segmentDistances.reduce(0, +)
        guard routeDistanceMeters > 0 else { return nil }

        let surface = characteristicBreakdown(
            details.surface,
            segmentDistances: segmentDistances
        )
        let roadClass = characteristicBreakdown(
            details.roadClass,
            segmentDistances: segmentDistances
        )
        let hikeRating = characteristicBreakdown(
            details.hikeRating,
            segmentDistances: segmentDistances
        )

        guard surface.coverage > 0 || roadClass.coverage > 0 || hikeRating.coverage > 0 else {
            return nil
        }

        return VerifiedRouteCharacteristics(
            routeDistanceMeters: routeDistanceMeters,
            surfaceBreakdown: surface.values,
            roadClassBreakdown: roadClass.values,
            hikeRatingBreakdown: hikeRating.values,
            surfaceCoverageMeters: surface.coverage,
            roadClassCoverageMeters: roadClass.coverage,
            hikeRatingCoverageMeters: hikeRating.coverage
        )
    }

    private static func characteristicBreakdown(
        _ details: [GraphHopperPathDetail],
        segmentDistances: [Double]
    ) -> (values: [VerifiedRouteCharacteristicValue], coverage: Double) {
        guard !details.isEmpty, !segmentDistances.isEmpty else { return ([], 0) }

        var segmentValues = Array<String?>(repeating: nil, count: segmentDistances.count)
        for detail in details {
            guard let value = detail.value?.normalizedValue else { continue }
            let lowerBound = min(max(detail.fromIndex, 0), segmentDistances.count)
            let upperBound = min(max(detail.toIndex, 0), segmentDistances.count)
            guard lowerBound < upperBound else { continue }

            for index in lowerBound..<upperBound where segmentValues[index] == nil {
                segmentValues[index] = value
            }
        }

        var distancesByValue: [String: Double] = [:]
        var coverage = 0.0
        for (index, value) in segmentValues.enumerated() {
            guard let value else { continue }
            let distance = segmentDistances[index]
            distancesByValue[value, default: 0] += distance
            coverage += distance
        }

        let values = distancesByValue
            .map { VerifiedRouteCharacteristicValue(value: $0.key, distanceMeters: $0.value) }
            .sorted { lhs, rhs in
                if lhs.distanceMeters != rhs.distanceMeters {
                    return lhs.distanceMeters > rhs.distanceMeters
                }
                return lhs.value < rhs.value
            }
        return (values, coverage)
    }

    private static func distanceMeters(_ from: Coordinate, _ to: Coordinate) -> Double {
        let earthRadiusMeters = 6_371_000.0
        let latitudeDelta = (to.latitude - from.latitude) * .pi / 180
        let longitudeDelta = (to.longitude - from.longitude) * .pi / 180
        let fromLatitude = from.latitude * .pi / 180
        let toLatitude = to.latitude * .pi / 180
        let haversine = sin(latitudeDelta / 2) * sin(latitudeDelta / 2)
            + cos(fromLatitude) * cos(toLatitude)
            * sin(longitudeDelta / 2) * sin(longitudeDelta / 2)
        return earthRadiusMeters * 2 * atan2(sqrt(haversine), sqrt(max(0, 1 - haversine)))
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
        planningRequest: RoutePlanningRequest
    ) -> [TrailRoute] {
        let targetDistanceKm = planningRequest.targetDistanceKm
            ?? RoutePlanningRequest.defaultLoopDistanceKm(for: planningRequest.activityType)
        let sorted = variants.sorted { lhs, rhs in
            let lhsDistanceDifference = abs(lhs.route.distanceKilometers - targetDistanceKm)
            let rhsDistanceDifference = abs(rhs.route.distanceKilometers - targetDistanceKm)

            let routesAreEffectivelyTied = abs(lhsDistanceDifference - rhsDistanceDifference) <= 0.5
                && abs(lhs.route.elevationGainMeters - rhs.route.elevationGainMeters) <= 50
                && abs(lhs.route.durationMinutes - rhs.route.durationMinutes) <= 10
            if routesAreEffectivelyTied,
               planningRequest.avoidFeatures.contains(.majorRoads),
               let lhsMajorRoadRatio = lhs.route.verifiedCharacteristics?.majorRoadRatio,
               let rhsMajorRoadRatio = rhs.route.verifiedCharacteristics?.majorRoadRatio,
               abs(lhsMajorRoadRatio - rhsMajorRoadRatio) > 0.001
            {
                return lhsMajorRoadRatio < rhsMajorRoadRatio
            }

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
        case .hiking:
            priority.append(.init(condition: "road_class == PRIMARY", multiplyBy: "0.85"))
            priority.append(.init(condition: "road_class == SECONDARY", multiplyBy: "0.9"))
        case .trailRunning:
            priority.append(.init(condition: "road_class == PRIMARY", multiplyBy: "0.75"))
            priority.append(.init(condition: "road_class == SECONDARY", multiplyBy: "0.85"))
            priority.append(.init(condition: "road_class == TRACK || road_class == FOOTWAY", multiplyBy: "1.05"))
        case .biking:
            priority.append(.init(condition: "road_class == PRIMARY", multiplyBy: "0.9"))
            priority.append(.init(condition: "road_class == TRACK", multiplyBy: "1.05"))
        }

        if request.avoidFeatures.contains(.majorRoads) {
            priority.append(.init(condition: "road_class == TRUNK", multiplyBy: "0.45"))
            priority.append(.init(condition: "road_class == PRIMARY", multiplyBy: "0.65"))
            priority.append(.init(condition: "road_class == SECONDARY", multiplyBy: "0.82"))
        }

        if request.avoidFeatures.contains(.steepClimbs) || request.difficulty == .easy {
            priority.append(.init(condition: "max_slope > 12", multiplyBy: "0.72"))
            priority.append(.init(condition: "max_slope > 20", multiplyBy: "0.5"))
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
    let details: GraphHopperPathDetails?

    enum CodingKeys: String, CodingKey {
        case distance
        case time
        case ascend
        case descend
        case points
        case instructions
        case details
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        distance = try container.decode(Double.self, forKey: .distance)
        time = try container.decode(Int64.self, forKey: .time)
        ascend = try container.decodeIfPresent(Double.self, forKey: .ascend)
        descend = try container.decodeIfPresent(Double.self, forKey: .descend)
        points = try container.decodeIfPresent(GraphHopperLineString.self, forKey: .points)
        instructions = try container.decodeIfPresent([GraphHopperInstruction].self, forKey: .instructions) ?? []
        details = try? container.decode(GraphHopperPathDetails.self, forKey: .details)
    }
}

private struct GraphHopperPathDetails: Decodable {
    let surface: [GraphHopperPathDetail]
    let roadClass: [GraphHopperPathDetail]
    let hikeRating: [GraphHopperPathDetail]

    enum CodingKeys: String, CodingKey {
        case surface
        case roadClass = "road_class"
        case hikeRating = "hike_rating"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        surface = (try? container.decode([GraphHopperPathDetail].self, forKey: .surface)) ?? []
        roadClass = (try? container.decode([GraphHopperPathDetail].self, forKey: .roadClass)) ?? []
        hikeRating = (try? container.decode([GraphHopperPathDetail].self, forKey: .hikeRating)) ?? []
    }
}

private struct GraphHopperPathDetail: Decodable {
    let fromIndex: Int
    let toIndex: Int
    let value: GraphHopperPathDetailValue?

    init(from decoder: Decoder) throws {
        guard
            var container = try? decoder.unkeyedContainer(),
            let decodedFromIndex = try? container.decode(Int.self),
            let decodedToIndex = try? container.decode(Int.self)
        else {
            fromIndex = 0
            toIndex = 0
            value = nil
            return
        }
        fromIndex = decodedFromIndex
        toIndex = decodedToIndex

        if (try? container.decodeNil()) == true {
            value = nil
        } else if let string = try? container.decode(String.self) {
            value = .string(string)
        } else if let number = try? container.decode(Double.self) {
            value = .number(number)
        } else if let boolean = try? container.decode(Bool.self) {
            value = .string(boolean ? "true" : "false")
        } else {
            value = nil
        }
    }
}

private enum GraphHopperPathDetailValue {
    case string(String)
    case number(Double)

    var normalizedValue: String? {
        switch self {
        case let .string(value):
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return normalized.isEmpty ? nil : normalized
        case let .number(value):
            guard value.isFinite else { return nil }
            if value.rounded() == value {
                return String(Int(value))
            }
            return String(value)
        }
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
