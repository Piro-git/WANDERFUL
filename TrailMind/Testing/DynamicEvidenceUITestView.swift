#if DEBUG && targetEnvironment(simulator)
import SwiftUI

/// Synthetic data only. Reachable only through the existing explicit simulator test launch.
struct DynamicEvidenceUITestView: View {
    private let route: TrailRoute = {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("TrailMindTests/Fixtures/dynamic-evidence-revised-offline.json")
        let request = RoutePlanningRequest(routeType: .loop, startQuery: "Offline village", endQuery: nil,
            activityType: .hiking, graphHopperProfile: "foot", targetDistanceKm: 6,
            targetDurationMinutes: nil, difficulty: .moderate, desiredFeatures: [])
        let fixtureDate = ISO8601DateFormatter().date(from: "2026-09-07T01:00:00Z")!
        var route = try! BackendDynamicResearchPlanningClient.validate(Data(contentsOf: file), request: request,
            start: Coordinate(latitude: 57.2, longitude: -4.7), end: nil, context: .unspecified, now: fixtureDate).suggestion.route
        if ProcessInfo.processInfo.arguments.contains("--trailmind-ui-evidence-missing") {
            route.dynamicWebResearch = nil
        } else if !ProcessInfo.processInfo.arguments.contains("--trailmind-ui-evidence-expired"), let web = route.dynamicWebResearch {
            route.dynamicWebResearch = DynamicWebResearch(provider: web.provider,
                retrievedAt: ISO8601DateFormatter().string(from: .now), blocks: web.blocks,
                searchSuggestions: web.searchSuggestions, retrievedSourceURLs: web.retrievedSourceURLs,
                observedSearchQueries: web.observedSearchQueries, routeEvidence: web.routeEvidence)
        }
        if ProcessInfo.processInfo.arguments.contains("--trailmind-ui-preparation-persistence") {
            // Dedicated synthetic identity; exercise the real store without touching saved routes.
            return TrailRoute(id: UUID(uuidString: "E8AC8640-04F5-4D99-A646-85EFB2880917")!,
                provenance: route.provenance, title: route.title, location: route.location,
                activity: route.activity, distanceKilometers: route.distanceKilometers,
                elevationGainMeters: route.elevationGainMeters, durationHours: route.durationHours,
                difficulty: route.difficulty, routeType: route.routeType, summary: route.summary,
                whyItMatches: route.whyItMatches, highlights: route.highlights, waypoints: route.waypoints,
                days: route.days, safetyNotes: route.safetyNotes, elevationProfile: route.elevationProfile,
                path: route.path)
        }
        return route
    }()

    private var stayEvidence: RouteStays? {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("TrailMindTests/Fixtures/route-stays-offline.json")
        guard let data = try? Data(contentsOf: file),
              let fixture = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              var evidence = fixture["evidence"] as? [String: Any] else { return nil }
        for state in ["empty", "unavailable"] where ProcessInfo.processInfo.arguments.contains("--trailmind-ui-stays-" + state) {
            evidence["state"] = state
            evidence["candidates"] = []
        }
        if ProcessInfo.processInfo.arguments.contains("--trailmind-ui-stays-stale") {
            evidence["checkedAt"] = "2020-01-01T00:00:00Z"
            if var candidates = evidence["candidates"] as? [[String: Any]] {
                for index in candidates.indices {
                    if var source = candidates[index]["source"] as? [String: Any] {
                        source["snapshotAt"] = "2020-01-01T00:00:00Z"
                        source["retrievedAt"] = "2020-01-01T00:00:00Z"
                        source["updatedAt"] = "2019-01-01T00:00:00Z"
                        candidates[index]["source"] = source
                    }
                }
                evidence["candidates"] = candidates
            }
        }
        guard let encoded = try? JSONSerialization.data(withJSONObject: evidence) else { return nil }
        return try? JSONDecoder().decode(RouteStays.self, from: encoded)
    }

    var body: some View {
        if ProcessInfo.processInfo.arguments.contains("--trailmind-ui-card-photo") {
            RouteCardPhotoUITestView(route: route)
        } else if ProcessInfo.processInfo.arguments.contains("--trailmind-ui-photo-source") {
            // Source sheet only: no image or metadata request, no real place/photo claim.
            CommonsPhotoSourceView(photo: CommonsRoutePhoto(stopID: "synthetic-ui-credit", wikidataID: nil,
                imageURL: URL(string: "https://fixture.invalid/photo.jpg")!,
                sourceURL: URL(string: "https://commons.wikimedia.org/wiki/File:Synthetic_UI_fixture.jpg")!,
                licence: "CC BY-SA 4.0", licenceURL: URL(string: "https://creativecommons.org/licenses/by-sa/4.0/")!,
                author: String(repeating: "Synthetic attribution for layout verification. ", count: 8) + "Credit ends here.",
                retrievedAt: .distantPast))
        } else if ProcessInfo.processInfo.arguments.contains("--trailmind-ui-preparation") {
            HikePreparationView(route: route)
        } else {
            NavigationStack {
                ScrollView {
                    if ProcessInfo.processInfo.arguments.contains("--trailmind-ui-stays") {
                        RouteStaysView(evidence: stayEvidence)
                            .environment(\.locale, Locale(identifier: ProcessInfo.processInfo.arguments.contains("--trailmind-ui-stays-de") ? "de_DE" : "en_US"))
                            .padding(20)
                    } else {
                        DynamicRouteEvidenceView(stops: route.dynamicResearchStops,
                            explanation: nil, research: route.dynamicWebResearch)
                            .padding(20)
                    }
                }
                .navigationTitle("Offline evidence check")
            }
        }
    }
}
#endif
