import Foundation

enum MockRoutes {
    static let all: [TrailRoute] = [harzWeekend, luneburgLoop, sunsetRidge]

    static let harzWeekend = TrailRoute(
        id: UUID(uuidString: "29EE13DB-1808-42BD-9BDF-F8B991A2E811")!,
        provenance: .demo(.mock),
        title: "Harz Waterfall Weekend",
        location: "Harz, Germany",
        activity: .hiking,
        distanceKilometers: 47,
        elevationGainMeters: 1_250,
        durationHours: 14,
        difficulty: .challenging,
        routeType: .multiDay,
        summary: "Two unhurried days through deep spruce forest, tumbling water and high Harz views.",
        whyItMatches: "The strongest match for waterfalls, forest and a memorable overnight—balanced near your 25 km/day target.",
        highlights: [
            Highlight(title: "Ilsefälle", subtitle: "A long chain of forest waterfalls", symbol: "water.waves"),
            Highlight(title: "Brocken view", subtitle: "Open ridgeline panorama", symbol: "mountain.2.fill"),
            Highlight(title: "Schierke", subtitle: "A warm overnight trail village", symbol: "house.lodge.fill"),
            Highlight(title: "Quiet forest", subtitle: "Soft paths away from the busiest trail", symbol: "tree.fill")
        ],
        waypoints: [
            Waypoint(name: "Ilsenburg trailhead", detail: "Start · supplies nearby", distanceKilometers: 0, kind: .start, coordinate: .init(latitude: 51.8640, longitude: 10.6785)),
            Waypoint(name: "Ilsefälle", detail: "Waterfall series", distanceKilometers: 5.8, kind: .water, coordinate: .init(latitude: 51.8340, longitude: 10.6708)),
            Waypoint(name: "Brocken overlook", detail: "Best wide view", distanceKilometers: 18.6, kind: .viewpoint, coordinate: .init(latitude: 51.7990, longitude: 10.6150)),
            Waypoint(name: "Schierke", detail: "Night one · inns and food", distanceKilometers: 24.1, kind: .stay, coordinate: .init(latitude: 51.7669, longitude: 10.6642)),
            Waypoint(name: "Elendstal", detail: "Creekside rest", distanceKilometers: 35.7, kind: .rest, coordinate: .init(latitude: 51.7423, longitude: 10.6890)),
            Waypoint(name: "Drei Annen Hohne", detail: "Finish · rail connection", distanceKilometers: 47, kind: .finish, coordinate: .init(latitude: 51.7701, longitude: 10.7263))
        ],
        days: [
            RouteDay(dayNumber: 1, title: "Waterfalls to Schierke", distanceKilometers: 24.1, elevationGainMeters: 810, durationHours: 7.5, summary: "Follow the Ilse upstream, climb through shaded forest, then descend into Schierke for the night."),
            RouteDay(dayNumber: 2, title: "Quiet valleys & steam rail", distanceKilometers: 22.9, elevationGainMeters: 440, durationHours: 6.5, summary: "A gentler woodland day with creek crossings and an easy rail connection at the finish.")
        ],
        safetyNotes: [
            SafetyNote(title: "Exposed upper trail", message: "Wind and visibility can change quickly near the Brocken. Check the summit forecast before leaving.", severity: .caution),
            SafetyNote(title: "AI-assisted plan", message: "Review local rules, trail conditions and water availability before starting.", severity: .info)
        ],
        elevationProfile: [190, 220, 280, 390, 510, 650, 820, 910, 760, 610, 530, 480, 560, 620, 570, 450, 380, 330, 410, 360, 290],
        path: [
            .init(latitude: 51.8640, longitude: 10.6785),
            .init(latitude: 51.8500, longitude: 10.6740),
            .init(latitude: 51.8340, longitude: 10.6708),
            .init(latitude: 51.8180, longitude: 10.6530),
            .init(latitude: 51.7990, longitude: 10.6150),
            .init(latitude: 51.7820, longitude: 10.6380),
            .init(latitude: 51.7669, longitude: 10.6642),
            .init(latitude: 51.7540, longitude: 10.6800),
            .init(latitude: 51.7423, longitude: 10.6890),
            .init(latitude: 51.7530, longitude: 10.7100),
            .init(latitude: 51.7701, longitude: 10.7263)
        ]
    )

    static let luneburgLoop = TrailRoute(
        id: UUID(uuidString: "B7B60C6A-612F-48A6-B5A4-4277162F4F69")!,
        provenance: .demo(.mock),
        title: "Lüneburg Forest Loop",
        location: "Lüneburg, Germany",
        activity: .hiking,
        distanceKilometers: 12,
        elevationGainMeters: 140,
        durationHours: 3,
        difficulty: .easy,
        routeType: .loop,
        summary: "A soft, quiet loop through pine forest and open heathland, close enough for a slow morning.",
        whyItMatches: "A precise fit for a relaxed 12 km loop with forest, water and quieter paths close to Lüneburg.",
        highlights: [
            Highlight(title: "Pine forest", subtitle: "Springy, shaded paths", symbol: "tree.fill"),
            Highlight(title: "Heathland", subtitle: "Wide open colour and sky", symbol: "camera.macro"),
            Highlight(title: "Quiet water", subtitle: "A small lake-side pause", symbol: "drop.fill")
        ],
        waypoints: [
            Waypoint(name: "Böhmsholz", detail: "Start · parking and bus", distanceKilometers: 0, kind: .start, coordinate: .init(latitude: 53.2140, longitude: 10.3500)),
            Waypoint(name: "Forest lake", detail: "Bench by the water", distanceKilometers: 4.1, kind: .water, coordinate: .init(latitude: 53.2030, longitude: 10.3750)),
            Waypoint(name: "Heath clearing", detail: "Open views", distanceKilometers: 7.8, kind: .viewpoint, coordinate: .init(latitude: 53.1920, longitude: 10.3540)),
            Waypoint(name: "Böhmsholz", detail: "Loop finish", distanceKilometers: 12, kind: .finish, coordinate: .init(latitude: 53.2140, longitude: 10.3500))
        ],
        days: [],
        safetyNotes: [
            SafetyNote(title: "Shared paths", message: "Expect bicycles on the wider forest tracks and keep dogs close near wildlife areas.", severity: .info),
            SafetyNote(title: "Before you go", message: "Outdoor conditions can change quickly. Review current trail conditions before starting.", severity: .info)
        ],
        elevationProfile: [18, 22, 31, 40, 36, 44, 52, 47, 39, 33, 25, 18],
        path: [
            .init(latitude: 53.2140, longitude: 10.3500),
            .init(latitude: 53.2110, longitude: 10.3680),
            .init(latitude: 53.2030, longitude: 10.3750),
            .init(latitude: 53.1940, longitude: 10.3690),
            .init(latitude: 53.1920, longitude: 10.3540),
            .init(latitude: 53.2000, longitude: 10.3380),
            .init(latitude: 53.2110, longitude: 10.3400),
            .init(latitude: 53.2140, longitude: 10.3500)
        ]
    )

    static let sunsetRidge = TrailRoute(
        id: UUID(uuidString: "7724094B-DC78-4B55-8F78-488FE0579A1B")!,
        provenance: .demo(.mock),
        title: "Sunset Ridge Walk",
        location: "Harz Foothills",
        activity: .hiking,
        distanceKilometers: 7.5,
        elevationGainMeters: 220,
        durationHours: 2.25,
        difficulty: .moderate,
        routeType: .loop,
        summary: "A compact golden-hour escape with a broad west-facing viewpoint and an easy return.",
        whyItMatches: "The lightest option: short, scenic and timed around sunset without committing your whole day.",
        highlights: [
            Highlight(title: "Sunset ledge", subtitle: "A west-facing natural balcony", symbol: "sunset.fill"),
            Highlight(title: "Short escape", subtitle: "Big payoff in under three hours", symbol: "sparkles"),
            Highlight(title: "Orchard path", subtitle: "A gentle finish through old fruit trees", symbol: "leaf.fill")
        ],
        waypoints: [
            Waypoint(name: "Ridge trailhead", detail: "Start", distanceKilometers: 0, kind: .start, coordinate: .init(latitude: 51.9020, longitude: 10.4280)),
            Waypoint(name: "West ledge", detail: "Sunset viewpoint", distanceKilometers: 3.2, kind: .viewpoint, coordinate: .init(latitude: 51.9150, longitude: 10.3970)),
            Waypoint(name: "Orchard spring", detail: "Seasonal water", distanceKilometers: 5.8, kind: .water, coordinate: .init(latitude: 51.8950, longitude: 10.4030)),
            Waypoint(name: "Ridge trailhead", detail: "Loop finish", distanceKilometers: 7.5, kind: .finish, coordinate: .init(latitude: 51.9020, longitude: 10.4280))
        ],
        days: [],
        safetyNotes: [
            SafetyNote(title: "Bring a light", message: "The woodland return is dark soon after sunset. Carry a charged headlamp.", severity: .caution),
            SafetyNote(title: "Route review", message: "This route is AI-assisted and should be reviewed before use.", severity: .info)
        ],
        elevationProfile: [95, 120, 160, 220, 270, 300, 286, 245, 190, 150, 120, 95],
        path: [
            .init(latitude: 51.9020, longitude: 10.4280),
            .init(latitude: 51.9100, longitude: 10.4180),
            .init(latitude: 51.9150, longitude: 10.3970),
            .init(latitude: 51.9060, longitude: 10.3880),
            .init(latitude: 51.8950, longitude: 10.4030),
            .init(latitude: 51.8940, longitude: 10.4200),
            .init(latitude: 51.9020, longitude: 10.4280)
        ]
    )
}
