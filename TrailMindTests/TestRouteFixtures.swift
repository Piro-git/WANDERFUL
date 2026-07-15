@testable import TrailMind

@MainActor
enum TestRouteFixtures {
    static var luneburgLoop: TrailRoute {
        verifiedCopy(of: MockRoutes.luneburgLoop)
    }

    static var sunsetRidge: TrailRoute {
        verifiedCopy(of: MockRoutes.sunsetRidge)
    }

    static var legacyRoute: TrailRoute {
        copy(
            MockRoutes.luneburgLoop,
            provenance: .unverified(.legacyRecord),
            difficulty: MockRoutes.luneburgLoop.difficulty
        )
    }

    private static func verifiedCopy(of route: TrailRoute) -> TrailRoute {
        let difficulty = RouteDifficulty.estimated(
            distanceKilometers: route.distanceKilometers,
            elevationGainMeters: route.elevationGainMeters
        )
        let provenance = RouteProvenance.routingEngineOutput(
            provider: .graphHopper,
            strategy: .backend,
            activity: route.activity,
            routeType: route.routeType,
            distanceKilometers: route.distanceKilometers,
            elevationGainMeters: route.elevationGainMeters,
            elevationLossMeters: route.elevationLossMeters,
            durationHours: route.durationHours,
            difficulty: difficulty,
            path: route.path,
            verifiedCharacteristics: route.verifiedCharacteristics
        )
        return copy(route, provenance: provenance, difficulty: difficulty)
    }

    private static func copy(
        _ route: TrailRoute,
        provenance: RouteProvenance,
        difficulty: RouteDifficulty
    ) -> TrailRoute {
        TrailRoute(
            id: route.id,
            provenance: provenance,
            title: route.title,
            location: route.location,
            activity: route.activity,
            distanceKilometers: route.distanceKilometers,
            elevationGainMeters: route.elevationGainMeters,
            elevationLossMeters: route.elevationLossMeters,
            durationHours: route.durationHours,
            difficulty: difficulty,
            routeType: route.routeType,
            summary: route.summary,
            whyItMatches: route.whyItMatches,
            highlights: route.highlights,
            waypoints: route.waypoints,
            days: route.days,
            safetyNotes: route.safetyNotes,
            elevationProfile: route.elevationProfile,
            path: route.path,
            routeInstructions: route.routeInstructions,
            planningMetadata: route.planningMetadata,
            intentDebugMetadata: route.intentDebugMetadata,
            verifiedCharacteristics: route.verifiedCharacteristics
        )
    }
}
