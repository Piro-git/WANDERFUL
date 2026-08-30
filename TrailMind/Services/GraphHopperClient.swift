import Foundation

protocol GraphHopperRouteCalculating {
    func calculateGraphHopperRoute(
        request: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate
    ) async throws -> TrailRoute

    func calculatePointToPointRouteVariants(
        request: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate
    ) async throws -> [TrailRoute]

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
    /// Compatibility seam for clients and test doubles that only support one
    /// point-to-point route. Production GraphHopperClient overrides this to
    /// expose every validated provider path without fabricating alternatives.
    func calculatePointToPointRouteVariants(
        request: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate
    ) async throws -> [TrailRoute] {
        [
            try await calculateGraphHopperRoute(
                request: request,
                start: start,
                end: end
            )
        ]
    }

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
            "Route planning is unavailable because the routing service is not configured."
        case .invalidEndpoint:
            "The GraphHopper endpoint could not be created."
        case .invalidResponse:
            "GraphHopper returned a response Wanderful couldn’t validate."
        case .noRouteFound:
            "GraphHopper couldn’t find a walkable route between these points."
        case let .api(statusCode, message, hints):
            Self.isFlexibleModeMessage(statusCode: statusCode, message: message, hints: hints)
                ? "Loop route planning needs GraphHopper flexible mode, which is not available on this API plan."
                : "GraphHopper rejected the route request (status \(statusCode))."
        case let .network(message):
            message.localizedCaseInsensitiveContains("timed out")
                ? "GraphHopper route calculation timed out."
                : "GraphHopper could not be reached. Please try again."
        case .decoding:
            "GraphHopper returned an unexpected route format."
        }
    }

    var isFlexibleModeUnavailable: Bool {
        switch self {
        case let .api(statusCode, message, hints):
            Self.isFlexibleModeMessage(
                statusCode: statusCode,
                message: message,
                hints: hints
            )
        default:
            false
        }
    }

    private static func isFlexibleModeMessage(
        statusCode: Int,
        message: String,
        hints: [String]
    ) -> Bool {
        guard statusCode == 400 || statusCode == 422 else { return false }
        let rejectionTerms = [
            "unavailable", "not available", "unsupported", "not supported",
            "cannot", "can't", "not allowed", "requires"
        ]
        return ([message] + hints).contains { value in
            let normalized = value.lowercased()
            let noRouteTerms = ["no route", "cannot find route", "cannot find a route"]
            guard !noRouteTerms.contains(where: normalized.contains) else { return false }

            if normalized.contains("flexible mode") {
                return rejectionTerms.contains(where: normalized.contains)
            }
            let identifiesCHConfiguration = normalized.contains("ch.disable")
                || normalized.contains("ch disable")
            let chRejectionTerms = [
                "unavailable", "unsupported", "not supported", "not allowed",
                "cannot use", "can't use", "requires", "must"
            ]
            return identifiesCHConfiguration
                && chRejectionTerms.contains(where: normalized.contains)
        }
    }
}

struct GraphHopperClient: RoutingService, GraphHopperRouteCalculating, GraphHopperMultiPointRouteCalculating, ConcurrentGraphHopperMultiPointRouteCalculating {
    private static let routingInstructionLocale = "en"

    private let session: URLSession
    private let configurationProvider: @Sendable () throws -> GraphHopperConfiguration
    private let gateway: (any BackendRouteGatewayRouting)?
    private let limits: RouteTransportLimits

    init() {
        session = .shared
        configurationProvider = { throw GraphHopperError.missingAPIKey }
        gateway = BackendRouteGateway()
        limits = .standard
    }

    init(
        session: URLSession,
        configurationProvider: @escaping @Sendable () throws -> GraphHopperConfiguration,
        limits: RouteTransportLimits = .standard
    ) {
        self.session = session
        self.configurationProvider = configurationProvider
        gateway = nil
        self.limits = limits
    }

    init(
        gateway: any BackendRouteGatewayRouting,
        limits: RouteTransportLimits = .standard
    ) {
        session = .shared
        configurationProvider = { throw GraphHopperError.missingAPIKey }
        self.gateway = gateway
        self.limits = limits
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
        let routes = try await calculatePointToPointRouteVariants(
            request: planningRequest,
            start: start,
            end: end
        )
        guard let route = Self.bestRoute(
            in: routes,
            targetDistanceKm: planningRequest.targetDistanceKm
        ) else {
            throw GraphHopperError.noRouteFound
        }
        return route
    }

    func calculatePointToPointRouteVariants(
        request planningRequest: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate
    ) async throws -> [TrailRoute] {
        let routePreferences = GraphHopperRoutePreferences.conservative(for: planningRequest)
        if let gateway {
            return try await calculateGatewayPointToPointRouteVariants(
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
            let routes = try await executePointToPointRouteVariants(
                request: request,
                requestedStart: start,
                requestedEnd: end,
                planningRequest: planningRequest
            )
            return routes.map { route in
                route.withPlanningMetadata(
                    route.planningMetadata?.withRouteShapingSummary(
                        .pointToPoint(
                            request: planningRequest,
                            customModelApplied: routePreferences.customModel != nil,
                            alternativeRoutesApplied: routePreferences.alternativeRoute != nil
                        )
                    )
                )
            }
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
            let routes = try await executePointToPointRouteVariants(
                request: fallbackRequest,
                requestedStart: start,
                requestedEnd: end,
                planningRequest: planningRequest
            )
            return routes.map { route in
                route.withPlanningMetadata(
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

    private func calculateGatewayPointToPointRouteVariants(
        gateway: any BackendRouteGatewayRouting,
        planningRequest: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate,
        routePreferences: GraphHopperRoutePreferences
    ) async throws -> [TrailRoute] {
        do {
            let routes = try await executeGatewayPointToPointRouteVariants(
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
            return routes.map { route in
                route.withPlanningMetadata(
                    route.planningMetadata?.withRouteShapingSummary(
                        .pointToPoint(
                            request: planningRequest,
                            customModelApplied: routePreferences.customModel != nil,
                            alternativeRoutesApplied: routePreferences.alternativeRoute != nil
                        )
                    )
                )
            }
        } catch let error as GraphHopperError {
            guard routePreferences.usesFlexibleRouting, error.isFlexibleRoutingFallbackCandidate else {
                throw error
            }
            let routes = try await executeGatewayPointToPointRouteVariants(
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
            return routes.map { route in
                route.withPlanningMetadata(
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
        try Task.checkCancellation()
        let response = try decodeRouteResponse(data, source: .backend)
        try Task.checkCancellation()
        guard let provider = response.provider else {
            throw GraphHopperError.invalidResponse
        }
        guard let path = Self.bestPath(
            in: response.paths,
            targetDistanceKm: planningRequest.targetDistanceKm
        ) else {
            throw GraphHopperError.noRouteFound
        }
        let route = try makeTrailRoute(
            from: path,
            requestedStart: requestedStart,
            requestedEnd: requestedEnd,
            planningRequest: planningRequest,
            provider: provider,
            routingStrategy: .backend
        )
        try Task.checkCancellation()
        return route
    }

    private func executeGatewayPointToPointRouteVariants(
        gateway: any BackendRouteGatewayRouting,
        request: BackendRouteRequest,
        requestedStart: Coordinate,
        requestedEnd: Coordinate,
        planningRequest: RoutePlanningRequest
    ) async throws -> [TrailRoute] {
        let data = try await gateway.route(request)
        try Task.checkCancellation()
        let response = try decodeRouteResponse(data, source: .backend)
        try Task.checkCancellation()
        guard let provider = response.provider else {
            throw GraphHopperError.invalidResponse
        }
        return try makeTrailRoutes(
            from: response.paths,
            requestedStart: requestedStart,
            requestedEnd: requestedEnd,
            planningRequest: planningRequest,
            provider: provider,
            routingStrategy: .backend
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
            locale: Self.routingInstructionLocale,
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
            locale: Self.routingInstructionLocale,
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
            locale: Self.routingInstructionLocale,
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
            let transport = BoundedRouteHTTPTransport(session: session, limits: limits)
            let (data, urlResponse) = try await transport.data(for: request)
            try Task.checkCancellation()
            guard let httpResponse = urlResponse as? HTTPURLResponse else {
                throw GraphHopperError.invalidResponse
            }

            guard (200..<300).contains(httpResponse.statusCode) else {
                let envelope = try? JSONDecoder().decode(GraphHopperErrorEnvelope.self, from: data)
                let providerError = GraphHopperError.api(
                    statusCode: httpResponse.statusCode,
                    message: envelope?.message ?? "GraphHopper request failed with status \(httpResponse.statusCode).",
                    hints: envelope?.hints.compactMap(\.displayMessage) ?? []
                )
                throw GraphHopperError.api(
                    statusCode: httpResponse.statusCode,
                    message: providerError.isFlexibleModeUnavailable
                        ? "GraphHopper flexible mode is unavailable."
                        : "GraphHopper rejected the route request.",
                    hints: []
                )
            }

            let routeResponse = try decodeRouteResponse(data, source: .direct)
            try Task.checkCancellation()

            guard let path = Self.bestPath(
                in: routeResponse.paths,
                targetDistanceKm: planningRequest.targetDistanceKm
            ) else {
                throw GraphHopperError.noRouteFound
            }
            let route = try makeTrailRoute(
                from: path,
                requestedStart: requestedStart,
                requestedEnd: requestedEnd,
                planningRequest: planningRequest,
                provider: .graphHopper,
                routingStrategy: .directGraphHopper
            )
            try Task.checkCancellation()
            return route
        } catch is CancellationError {
            throw CancellationError()
        } catch RouteTransportValidationError.responseTooLarge {
            throw GraphHopperError.decoding(
                message: "The route response exceeded Wanderful’s safety limit."
            )
        } catch let error as GraphHopperError {
            throw error
        } catch let error as URLError {
            if error.code == .cancelled, Task.isCancelled {
                throw CancellationError()
            }
            if error.code == .timedOut {
                throw GraphHopperError.network(message: "The route calculation timed out.")
            }
            throw GraphHopperError.network(message: "The route request failed.")
        } catch {
            throw GraphHopperError.network(message: "The route request failed.")
        }
    }

    private func executePointToPointRouteVariants(
        request: URLRequest,
        requestedStart: Coordinate,
        requestedEnd: Coordinate,
        planningRequest: RoutePlanningRequest
    ) async throws -> [TrailRoute] {
        do {
            let transport = BoundedRouteHTTPTransport(session: session, limits: limits)
            let (data, urlResponse) = try await transport.data(for: request)
            try Task.checkCancellation()
            guard let httpResponse = urlResponse as? HTTPURLResponse else {
                throw GraphHopperError.invalidResponse
            }

            guard (200..<300).contains(httpResponse.statusCode) else {
                let envelope = try? JSONDecoder().decode(GraphHopperErrorEnvelope.self, from: data)
                let providerError = GraphHopperError.api(
                    statusCode: httpResponse.statusCode,
                    message: envelope?.message ?? "GraphHopper request failed with status \(httpResponse.statusCode).",
                    hints: envelope?.hints.compactMap(\.displayMessage) ?? []
                )
                throw GraphHopperError.api(
                    statusCode: httpResponse.statusCode,
                    message: providerError.isFlexibleModeUnavailable
                        ? "GraphHopper flexible mode is unavailable."
                        : "GraphHopper rejected the route request.",
                    hints: []
                )
            }

            let response = try decodeRouteResponse(data, source: .direct)
            try Task.checkCancellation()
            return try makeTrailRoutes(
                from: response.paths,
                requestedStart: requestedStart,
                requestedEnd: requestedEnd,
                planningRequest: planningRequest,
                provider: .graphHopper,
                routingStrategy: .directGraphHopper
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch RouteTransportValidationError.responseTooLarge {
            throw GraphHopperError.decoding(
                message: "The route response exceeded Wanderful’s safety limit."
            )
        } catch let error as GraphHopperError {
            throw error
        } catch let error as URLError {
            if error.code == .cancelled, Task.isCancelled {
                throw CancellationError()
            }
            if error.code == .timedOut {
                throw GraphHopperError.network(message: "The route calculation timed out.")
            }
            throw GraphHopperError.network(message: "The route request failed.")
        } catch {
            throw GraphHopperError.network(message: "The route request failed.")
        }
    }

    private enum RouteResponseSource {
        case direct
        case backend
    }

    private func decodeRouteResponse(
        _ data: Data,
        source: RouteResponseSource
    ) throws -> GraphHopperRouteResponse {
        guard data.count <= limits.maximumSuccessBodyBytes else {
            throw GraphHopperError.decoding(
                message: "The route response exceeded Wanderful’s safety limit."
            )
        }

        let decoder = JSONDecoder()
        decoder.userInfo[.routeTransportLimits] = limits
        do {
            return try decoder.decode(GraphHopperRouteResponse.self, from: data)
        } catch is CancellationError {
            throw CancellationError()
        } catch is RouteTransportValidationError {
            throw GraphHopperError.invalidResponse
        } catch {
            let message = switch source {
            case .direct:
                "GraphHopper returned an unexpected response."
            case .backend:
                "Wanderful’s routing service returned an unexpected response."
            }
            throw GraphHopperError.decoding(message: message)
        }
    }

    /// Internal conversion seam for trusted backend contracts that already
    /// contain one sanitized GraphHopper path. This deliberately reuses the
    /// production decoder, route-fact fingerprinting, and eligibility checks;
    /// research evidence never participates in routed provenance.
    static func verifiedBackendRoute(
        fromSinglePathResponse data: Data,
        requestedStart: Coordinate,
        requestedEnd: Coordinate,
        planningRequest: RoutePlanningRequest,
        limits: RouteTransportLimits
    ) throws -> TrailRoute {
        let converter = GraphHopperClient(
            session: .shared,
            configurationProvider: { throw GraphHopperError.missingAPIKey },
            limits: limits
        )
        let response = try converter.decodeRouteResponse(
            data,
            source: .backend
        )
        guard
            response.provider == .graphHopper,
            response.paths.count == 1,
            let path = response.paths.first
        else {
            throw GraphHopperError.invalidResponse
        }
        return try converter.makeTrailRoute(
            from: path,
            requestedStart: requestedStart,
            requestedEnd: requestedEnd,
            planningRequest: planningRequest,
            provider: .graphHopper,
            routingStrategy: .backend
        )
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
            locale: Self.routingInstructionLocale,
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
            locale: Self.routingInstructionLocale,
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
            locale: Self.routingInstructionLocale,
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

    /// Provider alternatives are an integrity unit: every path must become a
    /// verified route or the entire envelope fails. This prevents a malformed
    /// alternative from being silently hidden behind a partial success.
    private func makeTrailRoutes(
        from paths: [GraphHopperRoutePath],
        requestedStart: Coordinate,
        requestedEnd: Coordinate,
        planningRequest: RoutePlanningRequest,
        provider: RouteProviderIdentity,
        routingStrategy: RouteRoutingStrategy
    ) throws -> [TrailRoute] {
        guard !paths.isEmpty else {
            throw GraphHopperError.noRouteFound
        }

        var routes: [TrailRoute] = []
        routes.reserveCapacity(paths.count)
        for path in paths {
            try Task.checkCancellation()
            routes.append(
                try makeTrailRoute(
                    from: path,
                    requestedStart: requestedStart,
                    requestedEnd: requestedEnd,
                    planningRequest: planningRequest,
                    provider: provider,
                    routingStrategy: routingStrategy
                )
            )
        }
        try Task.checkCancellation()
        return routes
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
            planningRequest: planningRequest,
            provider: .graphHopper,
            routingStrategy: .directGraphHopper
        )
    }

    private func makeTrailRoute(
        from path: GraphHopperRoutePath,
        requestedStart: Coordinate,
        requestedEnd: Coordinate,
        planningRequest: RoutePlanningRequest,
        provider: RouteProviderIdentity,
        routingStrategy: RouteRoutingStrategy
    ) throws -> TrailRoute {
        try Task.checkCancellation()
        guard
            path.distance.isFinite,
            path.distance > 0,
            path.time > 0,
            path.ascend.map({ $0.isFinite && $0 >= 0 }) ?? true,
            path.descend.map({ $0.isFinite && $0 >= 0 }) ?? true
        else {
            throw GraphHopperError.invalidResponse
        }
        guard path.distance >= 10 else {
            throw GraphHopperError.noRouteFound
        }
        guard let rawCoordinates = path.points?.coordinates else {
            throw GraphHopperError.invalidResponse
        }
        var coordinates: [Coordinate] = []
        coordinates.reserveCapacity(rawCoordinates.count)
        for (index, rawCoordinate) in rawCoordinates.enumerated() {
            if index.isMultiple(of: 4_096) {
                try Task.checkCancellation()
            }
            coordinates.append(try Self.decodeCoordinate(rawCoordinate))
        }
        guard
            coordinates.count >= 2,
            coordinates.dropFirst().contains(where: {
                $0.latitude != coordinates[0].latitude || $0.longitude != coordinates[0].longitude
            })
        else {
            throw GraphHopperError.invalidResponse
        }
        let verifiedCharacteristics = try Self.verifiedCharacteristics(
            details: path.details,
            coordinates: coordinates
        )
        try Task.checkCancellation()

        let distanceKilometers = path.distance / 1_000
        let durationHours = Double(path.time) / 3_600_000
        let computedGain = Self.elevationChange(in: coordinates, ascending: true)
        let computedLoss = Self.elevationChange(in: coordinates, ascending: false)
        guard
            computedGain.isFinite,
            computedLoss.isFinite,
            let elevationGain = Self.nonnegativeRoundedInt(path.ascend ?? computedGain),
            let elevationLoss = Self.nonnegativeRoundedInt(path.descend ?? computedLoss)
        else {
            throw GraphHopperError.invalidResponse
        }
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
        try Task.checkCancellation()

        let snappedStart = coordinates.first ?? requestedStart
        let snappedEnd = coordinates.last ?? requestedEnd
        let activity = planningRequest.activityType
        let resolvedStartName = planningRequest.startQuery
        let resolvedEndName = planningRequest.endQuery ?? planningRequest.startQuery
        let routeDifficulty = RouteDifficulty.estimated(
            distanceKilometers: distanceKilometers,
            elevationGainMeters: elevationGain
        )
        let routeType = planningRequest.routeType
        let provenance = RouteProvenance.routingEngineOutput(
            provider: provider,
            strategy: routingStrategy,
            activity: activity,
            routeType: routeType,
            distanceKilometers: distanceKilometers,
            elevationGainMeters: elevationGain,
            elevationLossMeters: elevationLoss,
            durationHours: durationHours,
            difficulty: routeDifficulty,
            path: coordinates,
            verifiedCharacteristics: verifiedCharacteristics
        )

        let route = TrailRoute(
            id: UUID(),
            provenance: provenance,
            title: planningRequest.title(
                startName: resolvedStartName,
                endName: resolvedEndName,
                actualDistanceKm: distanceKilometers
            ),
            location: Self.displayLocation(for: planningRequest) ?? "",
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
                Highlight(title: "Mapped route geometry", subtitle: "\(coordinates.count.formatted()) mapped route points", symbol: "point.bottomleft.forward.to.point.topright.scurvepath"),
                Highlight(title: "Elevation-aware", subtitle: "+\(elevationGain.formatted()) m ascent · −\(elevationLoss.formatted()) m descent", symbol: "mountain.2.fill"),
                Highlight(title: "Route directions", subtitle: "\(routeInstructions.count.formatted()) route instructions", symbol: "signpost.right.fill")
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
                    message: "This routed result still requires a check of current weather, closures, local rules and trail conditions.",
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
        try RouteEligibilityPolicy.validate(route, for: .productionSuccess)
        try Task.checkCancellation()
        return route
    }

    nonisolated static func displayLocation(for request: RoutePlanningRequest) -> String? {
        let start = request.startQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !start.isEmpty else { return nil }

        guard request.routeType == .pointToPoint else {
            return start
        }

        let end = request.endQuery?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !end.isEmpty, end.caseInsensitiveCompare(start) != .orderedSame else {
            return start
        }
        return "\(start) → \(end)"
    }

    private static func decodeCoordinate(_ values: [Double]) throws -> Coordinate {
        guard
            values.count == 2 || values.count == 3,
            values.allSatisfy(\.isFinite),
            (-180...180).contains(values[0]),
            (-90...90).contains(values[1]),
            values.count < 3 || abs(values[2]) <= RouteTransportLimits.standard.maximumAbsoluteElevationMeters
        else {
            throw GraphHopperError.invalidResponse
        }
        return Coordinate(
            latitude: values[1],
            longitude: values[0],
            elevationMeters: values.count >= 3 ? values[2] : nil
        )
    }

    private static func nonnegativeRoundedInt(_ value: Double) -> Int? {
        guard value.isFinite, value >= 0 else { return nil }
        return Int(exactly: value.rounded())
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
    ) throws -> VerifiedRouteCharacteristics? {
        guard let details, coordinates.count >= 2 else { return nil }
        try Task.checkCancellation()

        let segmentDistances = zip(coordinates, coordinates.dropFirst()).map(distanceMeters)
        let routeDistanceMeters = segmentDistances.reduce(0, +)
        guard routeDistanceMeters > 0 else { return nil }

        let surface = try characteristicBreakdown(
            details.surface,
            segmentDistances: segmentDistances
        )
        let roadClass = try characteristicBreakdown(
            details.roadClass,
            segmentDistances: segmentDistances
        )
        let hikeRating = try characteristicBreakdown(
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
    ) throws -> (values: [VerifiedRouteCharacteristicValue], coverage: Double) {
        guard !details.isEmpty, !segmentDistances.isEmpty else { return ([], 0) }

        var segmentValues = Array<String?>(repeating: nil, count: segmentDistances.count)
        for (detailIndex, detail) in details.enumerated() {
            if detailIndex.isMultiple(of: 4_096) {
                try Task.checkCancellation()
            }
            guard let value = detail.value?.normalizedValue else { continue }
            let lowerBound = min(max(detail.fromIndex, 0), segmentDistances.count)
            let upperBound = min(max(detail.toIndex, 0), segmentDistances.count)
            guard lowerBound < upperBound else { continue }

            for index in lowerBound..<upperBound {
                if index.isMultiple(of: 4_096) {
                    try Task.checkCancellation()
                }
                if segmentValues[index] == nil {
                    segmentValues[index] = value
                }
            }
        }

        var distancesByValue: [String: Double] = [:]
        var coverage = 0.0
        for (index, value) in segmentValues.enumerated() {
            if index.isMultiple(of: 4_096) {
                try Task.checkCancellation()
            }
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

    private static func bestRoute(
        in routes: [TrailRoute],
        targetDistanceKm: Double?
    ) -> TrailRoute? {
        guard let first = routes.first, let targetDistanceKm else {
            return routes.first
        }
        var best = first
        var bestDifference = abs(first.distanceKilometers - targetDistanceKm)
        for route in routes.dropFirst() {
            let difference = abs(route.distanceKilometers - targetDistanceKm)
            if difference < bestDifference {
                best = route
                bestDifference = difference
            }
        }
        return best
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

    private static func whyItMatches(
        planningRequest: RoutePlanningRequest,
        distanceKilometers: Double
    ) -> String {
        var parts = ["Mapped route geometry, elevation and route instructions returned by GraphHopper."]
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
            return "A GraphHopper \(planningRequest.activityType.rawValue.lowercased()) loop around \(startName), calculated from mapped routing data."
        }
        return "A GraphHopper \(planningRequest.activityType.rawValue.lowercased()) route from \(startName) to \(endName), calculated from mapped routing data."
    }
}

private extension GraphHopperError {
    var isFlexibleRoutingFallbackCandidate: Bool {
        isFlexibleModeUnavailable
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
    let provider: RouteProviderIdentity?
    let paths: [GraphHopperRoutePath]

    init(from decoder: Decoder) throws {
        let limits = decoder.userInfo[.routeTransportLimits] as? RouteTransportLimits ?? .standard
        let container = try decoder.container(keyedBy: CodingKeys.self)
        provider = try container.decodeIfPresent(RouteProviderIdentity.self, forKey: .provider)
        paths = try container.decodeBoundedArray(
            GraphHopperRoutePath.self,
            forKey: .paths,
            maximumCount: limits.maximumPaths
        )
    }

    enum CodingKeys: String, CodingKey {
        case provider
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
        let limits = decoder.userInfo[.routeTransportLimits] as? RouteTransportLimits ?? .standard
        let container = try decoder.container(keyedBy: CodingKeys.self)
        distance = try container.decode(Double.self, forKey: .distance)
        time = try container.decode(Int64.self, forKey: .time)
        ascend = try container.decodeIfPresent(Double.self, forKey: .ascend)
        descend = try container.decodeIfPresent(Double.self, forKey: .descend)
        points = try container.decodeIfPresent(GraphHopperLineString.self, forKey: .points)
        instructions = try container.decodeBoundedArray(
            GraphHopperInstruction.self,
            forKey: .instructions,
            maximumCount: limits.maximumInstructionsPerPath
        )
        details = try container.decodeIfPresent(GraphHopperPathDetails.self, forKey: .details)

        guard
            distance.isFinite,
            distance > 0,
            time > 0,
            ascend.map({ $0.isFinite && $0 >= 0 }) ?? true,
            descend.map({ $0.isFinite && $0 >= 0 }) ?? true
        else {
            throw RouteTransportValidationError.invalidMetrics
        }
        guard let points else {
            throw RouteTransportValidationError.invalidGeometry
        }

        let maximumCoordinateIndex = points.coordinates.count - 1
        guard instructions.allSatisfy({ $0.isValid(maximumCoordinateIndex: maximumCoordinateIndex) }) else {
            throw RouteTransportValidationError.invalidInstruction
        }
        try details?.validate(segmentCount: maximumCoordinateIndex)
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
        let limits = decoder.userInfo[.routeTransportLimits] as? RouteTransportLimits ?? .standard
        let container = try decoder.container(keyedBy: CodingKeys.self)
        surface = try container.decodeBoundedArray(
            GraphHopperPathDetail.self,
            forKey: .surface,
            maximumCount: limits.maximumPathDetailsPerPath
        )
        roadClass = try container.decodeBoundedArray(
            GraphHopperPathDetail.self,
            forKey: .roadClass,
            maximumCount: limits.maximumPathDetailsPerPath - surface.count
        )
        hikeRating = try container.decodeBoundedArray(
            GraphHopperPathDetail.self,
            forKey: .hikeRating,
            maximumCount: limits.maximumPathDetailsPerPath - surface.count - roadClass.count
        )
    }

    func validate(segmentCount: Int) throws {
        guard segmentCount > 0 else {
            throw RouteTransportValidationError.invalidPathDetail
        }
        for collection in [surface, roadClass, hikeRating] {
            var previousUpperBound = 0
            for (index, detail) in collection.enumerated() {
                if index.isMultiple(of: 4_096) {
                    try Task.checkCancellation()
                }
                guard
                    detail.fromIndex >= previousUpperBound,
                    detail.fromIndex < detail.toIndex,
                    detail.toIndex <= segmentCount
                else {
                    throw RouteTransportValidationError.invalidPathDetail
                }
                previousUpperBound = detail.toIndex
            }
        }
    }
}

private struct GraphHopperPathDetail: Decodable {
    let fromIndex: Int
    let toIndex: Int
    let value: GraphHopperPathDetailValue?

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        fromIndex = try container.decode(Int.self)
        toIndex = try container.decode(Int.self)

        if try container.decodeNil() {
            value = nil
        } else {
            value = try container.decode(GraphHopperPathDetailValue.self)
        }
        guard container.isAtEnd else {
            throw RouteTransportValidationError.invalidPathDetail
        }
    }
}

private enum GraphHopperPathDetailValue: Decodable {
    case string(String)
    case number(Double)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            self = .string(string)
        } else if let number = try? container.decode(Double.self), number.isFinite {
            self = .number(number)
        } else if let boolean = try? container.decode(Bool.self) {
            self = .string(boolean ? "true" : "false")
        } else {
            throw RouteTransportValidationError.invalidPathDetail
        }
    }

    var normalizedValue: String? {
        switch self {
        case let .string(value):
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return normalized.isEmpty ? nil : normalized
        case let .number(value):
            guard value.isFinite else { return nil }
            if value.rounded() == value {
                guard let integer = Int(exactly: value) else { return nil }
                return String(integer)
            }
            return String(value)
        }
    }
}

private struct GraphHopperLineString: Decodable {
    let type: String
    let coordinates: [[Double]]

    init(from decoder: Decoder) throws {
        let limits = decoder.userInfo[.routeTransportLimits] as? RouteTransportLimits ?? .standard
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(String.self, forKey: .type)
        guard type == "LineString" else {
            throw RouteTransportValidationError.invalidGeometry
        }
        let decodedCoordinates = try container.decodeBoundedArray(
            GraphHopperRawCoordinate.self,
            forKey: .coordinates,
            maximumCount: limits.maximumCoordinatesPerPath
        )
        coordinates = decodedCoordinates.map(\.values)
        guard
            coordinates.count >= 2,
            coordinates.dropFirst().contains(where: {
                $0[0] != coordinates[0][0] || $0[1] != coordinates[0][1]
            })
        else {
            throw RouteTransportValidationError.invalidGeometry
        }
    }

    enum CodingKeys: String, CodingKey {
        case type
        case coordinates
    }
}

private struct GraphHopperRawCoordinate: Decodable {
    let values: [Double]

    init(from decoder: Decoder) throws {
        let limits = decoder.userInfo[.routeTransportLimits] as? RouteTransportLimits ?? .standard
        var container = try decoder.unkeyedContainer()
        var decoded: [Double] = []
        decoded.reserveCapacity(3)
        while !container.isAtEnd {
            guard decoded.count < 3 else {
                throw RouteTransportValidationError.invalidGeometry
            }
            decoded.append(try container.decode(Double.self))
        }
        guard
            decoded.count == 2 || decoded.count == 3,
            decoded.allSatisfy(\.isFinite),
            (-180...180).contains(decoded[0]),
            (-90...90).contains(decoded[1]),
            decoded.count < 3 || abs(decoded[2]) <= limits.maximumAbsoluteElevationMeters
        else {
            throw RouteTransportValidationError.invalidGeometry
        }
        values = decoded
    }
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

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        text = try container.decode(String.self, forKey: .text)
        streetName = try container.decodeIfPresent(String.self, forKey: .streetName)
        distance = try container.decode(Double.self, forKey: .distance)
        time = try container.decode(Int64.self, forKey: .time)
        sign = try container.decode(Int.self, forKey: .sign)
        interval = try container.decodeBoundedArray(
            Int.self,
            forKey: .interval,
            maximumCount: 2
        )
    }

    func isValid(maximumCoordinateIndex: Int) -> Bool {
        guard
            distance.isFinite,
            distance >= 0,
            time >= 0,
            interval.count == 2
        else { return false }
        return interval[0] >= 0
            && interval[0] <= interval[1]
            && interval[1] <= maximumCoordinateIndex
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

private extension KeyedDecodingContainer {
    func decodeBoundedArray<Element: Decodable>(
        _ type: Element.Type,
        forKey key: Key,
        maximumCount: Int
    ) throws -> [Element] {
        guard contains(key) else { return [] }
        if try decodeNil(forKey: key) { return [] }

        var container = try nestedUnkeyedContainer(forKey: key)
        var values: [Element] = []
        if let count = container.count {
            guard count <= maximumCount else {
                throw RouteTransportValidationError.structuralLimitExceeded
            }
            values.reserveCapacity(count)
        }
        while !container.isAtEnd {
            guard values.count < maximumCount else {
                throw RouteTransportValidationError.structuralLimitExceeded
            }
            if values.count.isMultiple(of: 4_096) {
                try Task.checkCancellation()
            }
            values.append(try container.decode(Element.self))
        }
        return values
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
