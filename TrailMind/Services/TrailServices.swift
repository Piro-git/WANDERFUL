import Foundation
import MapKit

#if DEBUG
protocol AIPlannerService: Sendable {
    func parseAdventurePrompt(prompt: String) async throws -> AdventureIntent
    func generateRouteSuggestions(intent: AdventureIntent) async throws -> [TrailRoute]
    func editRoute(route: TrailRoute, instruction: String) async throws -> TrailRoute
}
#endif

protocol RoutingService: Sendable {
    func calculateRoute(waypoints: [Waypoint]) async throws -> TrailRoute
    func getElevationProfile(route: TrailRoute) async throws -> [Double]
}

protocol MapService: Sendable {
    func getMapPreview(route: TrailRoute) -> MKCoordinateRegion
    func getRoutePolyline(route: TrailRoute) -> MKPolyline
}

enum TrailServiceError: LocalizedError {
    case noWaypoints

    var errorDescription: String? {
        switch self {
        case .noWaypoints: "A route needs at least one waypoint."
        }
    }
}

#if DEBUG
struct MockAIPlannerService: AIPlannerService {
    func parseAdventurePrompt(prompt: String) async throws -> AdventureIntent {
        // TODO: Replace this deterministic parser with the production AI planner endpoint.
        let lowercased = prompt.lowercased()
        let activity: ActivityType = lowercased.contains("bike") ? .biking : (lowercased.contains("run") ? .trailRunning : .hiking)
        var features: [DesiredFeature] = []
        if lowercased.contains("view") {
            features.append(.viewpoint)
        }
        if lowercased.contains("forest") {
            features.append(.forest)
        }
        if lowercased.contains("water") || lowercased.contains("waterfall") {
            features.append(.water)
        }
        if lowercased.contains("quiet") {
            features.append(.quiet)
        }
        let avoidFeatures: [AvoidFeature] = lowercased.contains("steep") ? [.steepClimbs] : []

        return AdventureIntent(
            rawPrompt: prompt,
            parserSource: .localRuleBased,
            confidence: 1,
            activityType: activity,
            routeType: .loop,
            startLocationQuery: nil,
            endLocationQuery: nil,
            regionQuery: lowercased.contains("lüneburg") ? "Lüneburg" : (lowercased.contains("harz") ? "Harz" : nil),
            targetDistanceKm: lowercased.contains("12 km") ? 12 : nil,
            targetDurationMinutes: lowercased.contains("3 hour") ? 180 : nil,
            difficulty: nil,
            desiredFeatures: features,
            avoidFeatures: avoidFeatures
        )
    }

    func generateRouteSuggestions(intent: AdventureIntent) async throws -> [TrailRoute] {
        // TODO: Send the parsed intent to routing, weather and safety services.
        if intent.rawPrompt.lowercased().contains("lüneburg") {
            return [MockRoutes.luneburgLoop, MockRoutes.sunsetRidge, MockRoutes.harzWeekend]
        }
        if intent.rawPrompt.lowercased().contains("sunset") || intent.targetDurationMinutes == 180 {
            return [MockRoutes.sunsetRidge, MockRoutes.luneburgLoop, MockRoutes.harzWeekend]
        }
        return MockRoutes.all
    }

    func editRoute(route: TrailRoute, instruction: String) async throws -> TrailRoute {
        // TODO: Apply an AI-produced route diff, then validate it with the routing service.
        let lowercased = instruction.lowercased()
        if lowercased.contains("short") || lowercased.contains("less elevation") {
            return route.edited(
                title: route.title + " · Easier",
                distanceKilometers: max(route.distanceKilometers * 0.82, 4),
                elevationGainMeters: Int(Double(route.elevationGainMeters) * 0.72),
                durationHours: route.durationHours * 0.82,
                summary: "A gentler revision with the key scenery preserved and the steepest section removed."
            )
        }
        return route.edited(
            title: route.title + " · Scenic",
            summary: "A refined version that adds a scenic pause while preserving the route’s overall rhythm."
        )
    }
}

struct MockRoutingService: RoutingService {
    func calculateRoute(waypoints: [Waypoint]) async throws -> TrailRoute {
        // TODO: Call the selected routing provider with activity-specific constraints.
        guard !waypoints.isEmpty else { throw TrailServiceError.noWaypoints }
        return MockRoutes.luneburgLoop
    }

    func getElevationProfile(route: TrailRoute) async throws -> [Double] {
        // TODO: Sample a production elevation model along the decoded route geometry.
        route.elevationProfile
    }
}
#endif

struct DefaultMapService: MapService {
    func getMapPreview(route: TrailRoute) -> MKCoordinateRegion {
        guard let first = route.path.first else {
            return MKCoordinateRegion(center: .init(latitude: 51.16, longitude: 10.45), span: .init(latitudeDelta: 2, longitudeDelta: 2))
        }

        let latitudes = route.path.map(\.latitude)
        let longitudes = route.path.map(\.longitude)
        let center = CLLocationCoordinate2D(
            latitude: (latitudes.min()! + latitudes.max()!) / 2,
            longitude: (longitudes.min()! + longitudes.max()!) / 2
        )
        let span = MKCoordinateSpan(
            latitudeDelta: max((latitudes.max()! - latitudes.min()!) * 1.65, 0.03),
            longitudeDelta: max((longitudes.max()! - longitudes.min()!) * 1.65, 0.03)
        )
        _ = first
        return MKCoordinateRegion(center: center, span: span)
    }

    func getRoutePolyline(route: TrailRoute) -> MKPolyline {
        let coordinates = route.path.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        return MKPolyline(coordinates: coordinates, count: coordinates.count)
    }
}

#if DEBUG
private extension TrailRoute {
    func edited(
        title: String? = nil,
        distanceKilometers: Double? = nil,
        elevationGainMeters: Int? = nil,
        durationHours: Double? = nil,
        summary: String? = nil
    ) -> TrailRoute {
        TrailRoute(
            id: id,
            provenance: .unverified(.modifiedWithoutRouting),
            title: title ?? self.title,
            location: location,
            activity: activity,
            distanceKilometers: distanceKilometers ?? self.distanceKilometers,
            elevationGainMeters: elevationGainMeters ?? self.elevationGainMeters,
            elevationLossMeters: elevationLossMeters,
            durationHours: durationHours ?? self.durationHours,
            difficulty: difficulty,
            routeType: routeType,
            summary: summary ?? self.summary,
            whyItMatches: whyItMatches,
            highlights: highlights,
            waypoints: waypoints,
            days: days,
            safetyNotes: safetyNotes,
            elevationProfile: elevationProfile,
            path: path,
            routeInstructions: routeInstructions,
            planningMetadata: planningMetadata,
            intentDebugMetadata: intentDebugMetadata
        )
    }
}
#endif
