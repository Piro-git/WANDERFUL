import Foundation
import CoreLocation
import XCTest
@testable import TrailMind

@MainActor
final class DynamicResearchPlanningClientTests: XCTestCase {
    private let start = Coordinate(latitude: 57.2, longitude: -4.7)
    private var request: RoutePlanningRequest {
        RoutePlanningRequest(routeType: .loop, startQuery: "An independently chosen village", endQuery: nil,
            activityType: .hiking, graphHopperProfile: "foot", targetDistanceKm: 6,
            targetDurationMinutes: nil, difficulty: .moderate, desiredFeatures: [.viewpoint])
    }

    func testOriginalPromptsAndEnumsSurviveNativeContractEncoding() throws {
        for prompt in ["Find me a walk near our village with a hilltop stop, then return.",
                       "Eine Runde ab meinem Dorf, mit Wasserfall und einem ruhigen Rückweg."] {
            let data = try BackendDynamicResearchPlanningClient.requestBody(prompt: prompt, request: request,
                start: start, end: nil, context: .unspecified)
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual(body["schemaVersion"] as? Int, 3)
            XCTAssertEqual(body["researchMode"] as? String, "web_and_map")
            XCTAssertEqual(body["locationName"] as? String, request.startQuery)
            XCTAssertEqual(body["prompt"] as? String, prompt)
            XCTAssertEqual(body["parserSource"] as? String, "remoteAI")
            let intent = try XCTUnwrap(body["intent"] as? [String: Any])
            XCTAssertEqual(intent["activityType"] as? String, "hiking")
            XCTAssertEqual(intent["routeType"] as? String, "loop")
            XCTAssertEqual(intent["difficulty"] as? String, "moderate")
            XCTAssertTrue(body["end"] is NSNull)
        }
    }

    func testMockProvenanceAndPlainModelSuccessCannotBecomeRoutes() throws {
        for source in ["localParser", "mock", "deterministic"] {
            let data = try JSONSerialization.data(withJSONObject: ["schemaVersion": 3, "state": "routed",
                "route": ["accepted": true, "plannerSource": source, "geometryProvider": "graphhopper"]])
            XCTAssertThrowsError(try BackendDynamicResearchPlanningClient.validate(data, request: request,
                start: start, end: nil, context: .unspecified))
        }
    }

    func testHardConstraintsAreEncodedWithoutRoundingOrSoftening() throws {
        let context = ResearchLedPlanningContext(maximumDistanceKm: 12.5, maximumDurationMinutes: 150,
            distanceOrigin: "prompt", preferenceOrigin: "prompt", hardAvoidances: ["majorRoads"])
        let data = try BackendDynamicResearchPlanningClient.requestBody(prompt: "At most 12.5 km, avoiding major roads.",
            request: request, start: start, end: nil, context: context)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let constraints = try XCTUnwrap(body["constraints"] as? [String: Any])
        XCTAssertEqual(constraints["maximumDistanceKm"] as? Double, 12.5)
        XCTAssertEqual(constraints["maximumDurationMinutes"] as? Double, 150)
        XCTAssertEqual(constraints["hardAvoidances"] as? [String], ["majorRoads"])
    }
    func testMeasuredBackendFixtureRetainsSourcesAndRejectsUnknownOrStaleIdentity() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dynamic-research-offline.json")
        let data = try Data(contentsOf: fixtureURL)
        let now = ISO8601DateFormatter().date(from: "2026-09-07T01:00:00Z")!
        let result = try BackendDynamicResearchPlanningClient.validate(data, request: request,
            start: start, end: nil, context: .unspecified, now: now)
        XCTAssertThrowsError(try BackendDynamicResearchPlanningClient.validate(data, request: request, start: start, end: nil, context: .unspecified, now: now, requiresWebResearch: true))
        XCTAssertTrue(result.suggestion.route.isVerifiedRoutedResult)
        XCTAssertEqual(result.suggestion.route.dynamicResearchStops.count, 3)
        let copied = result.suggestion.route.withPlanningMetadata(nil)
        XCTAssertEqual(copied.dynamicResearchStops, result.suggestion.route.dynamicResearchStops)
        XCTAssertThrowsError(try BackendDynamicResearchPlanningClient.validate(data, request: request,
            start: start, end: nil, context: .unspecified, now: now.addingTimeInterval(8 * 86_400)))
    }

    func testOptionalStayEvidenceBindsToNativeRouteAndFailsClosedWithoutLosingRoute() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dynamic-research-offline.json")
        let data = try Data(contentsOf: fixtureURL)
        let now = ISO8601DateFormatter().date(from: "2026-09-07T01:00:00Z")!
        let original = try BackendDynamicResearchPlanningClient.validate(data, request: request,
            start: start, end: nil, context: .unspecified, now: now).suggestion.route
        let stop = try XCTUnwrap(original.dynamicResearchStops.first)
        let evidence = RouteStays(schemaVersion: 1, geometryDigest: RouteStays.digest(path: original.path),
            checkedAt: "2026-09-07T01:00:00Z", coverage: "partial", maximumOffsetMeters: 2000, state: .available,
            candidates: [.init(id: stop.id, name: stop.name, category: .hut, coordinate: stop.coordinate,
                coordinateKind: "mapped_point", source: stop.source, nameKnown: true, operator: nil, website: nil,
                straightLineDistanceToPathMeters: Int(RouteStays.distanceToPath(stop.coordinate, path: original.path).rounded()))])
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        var response = try XCTUnwrap(object["route"] as? [String: Any])
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(evidence)) as? [String: Any])
        for valid in [true, false] {
            if !valid { raw["geometryDigest"] = String(repeating: "0", count: 64) }
            response["routeStays"] = raw
            object["route"] = response
            let route = try BackendDynamicResearchPlanningClient.validate(JSONSerialization.data(withJSONObject: object),
                request: request, start: start, end: nil, context: .unspecified, now: now).suggestion.route
            XCTAssertEqual(route.path, original.path)
            XCTAssertTrue(route.isVerifiedRoutedResult)
            XCTAssertEqual(route.routeStays?.state, valid ? .available : .unavailable)
            XCTAssertEqual(route.withPlanningMetadata(nil).routeStays, route.routeStays)
        }
    }

    func testRevisedEvidenceReferencesAndLegacyResponses() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dynamic-evidence-revised-offline.json")
        let data = try Data(contentsOf: fixtureURL)
        let now = ISO8601DateFormatter().date(from: "2026-09-07T01:00:00Z")!
        func validate(_ object: [String: Any]) throws -> TrailRoute {
            try BackendDynamicResearchPlanningClient.validate(JSONSerialization.data(withJSONObject: object),
                request: request, start: start, end: nil, context: .unspecified, now: now, requiresWebResearch: true).suggestion.route
        }
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let route = try validate(object)
        let evidence = try XCTUnwrap(route.dynamicWebResearch?.routeEvidence)
        XCTAssertEqual(evidence.places.last?.selection, "excluded")
        XCTAssertEqual(evidence.claims[1].placeId, "osm:node:4")
        XCTAssertNil(evidence.claims[2].placeId)
        XCTAssertFalse(route.dynamicResearchStops.contains(where: { $0.id == "osm:node:4" }))
        XCTAssertEqual(route.withPlanningMetadata(nil).dynamicWebResearch, route.dynamicWebResearch)
        for change in ["placeId", "citationIndex", "blockIndex", "id", "relationship", "selection", "routeId", "schemaVersion", "empty"] {
            var invalid = object
            var result = invalid["route"] as! [String: Any]
            var web = result["webResearch"] as! [String: Any]
            var mapping = web["routeEvidence"] as! [String: Any]
            var claims = mapping["claims"] as! [[String: Any]]
            switch change {
            case "placeId": claims[0][change] = "osm:node:999"
            case "citationIndex", "blockIndex": claims[0][change] = 99
            case "id", "relationship": claims[0][change] = "invented"
            case "selection":
                var places = mapping["places"] as! [[String: Any]]
                places[0]["selection"] = "excluded"
                mapping["places"] = places
            case "routeId": mapping[change] = "measured-1"
            case "schemaVersion": mapping[change] = 99
            default: claims = []
            }
            mapping["claims"] = claims; web["routeEvidence"] = mapping
            result["webResearch"] = web; invalid["route"] = result
            XCTAssertThrowsError(try validate(invalid), change)
        }
        var legacy = object
        var result = legacy["route"] as! [String: Any]
        var web = result["webResearch"] as! [String: Any]
        web.removeValue(forKey: "routeEvidence"); result["webResearch"] = web; legacy["route"] = result
        XCTAssertNil(try validate(legacy).dynamicWebResearch?.routeEvidence)
        web["retrievedAt"] = "2026-09-05T00:00:00Z"; result["webResearch"] = web; legacy["route"] = result
        XCTAssertNil(try validate(legacy).dynamicWebResearch)
        XCTAssertEqual(try validate(legacy).path.count, route.path.count)
    }

    func testDocumentedEntranceKeepsPOIIdentityAndRejectsUnrelatedBoundaryNode() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dynamic-research-offline.json")
        var envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: Any])
        var route = try XCTUnwrap(envelope["route"] as? [String: Any])
        var places = try XCTUnwrap(route["places"] as? [[String: Any]])
        let originalTarget = try XCTUnwrap(places[0]["coordinate"] as? [String: Any])
        let poi: [String: Any] = ["latitude": 57.213, "longitude": -4.675]
        let offset = CLLocation(latitude: 57.213, longitude: -4.675)
            .distance(from: CLLocation(latitude: 57.21, longitude: -4.68))
        var source = try XCTUnwrap(places[0]["source"] as? [String: Any])
        source["url"] = "https://www.openstreetmap.org/way/8"
        places[0]["id"] = "osm:way:8"
        places[0]["source"] = source
        places[0]["coordinate"] = poi
        let now = PlanningEvidenceDate.parse("2026-09-07T01:00:00Z")!
        func reference(_ id: String, nodes: [Int]? = nil) -> [String: Any] {
            var result: [String: Any] = ["id": id,
                "url": "https://www.openstreetmap.org/" + id.dropFirst(4).replacingOccurrences(of: ":", with: "/"),
                "version": 1, "updatedAt": "2020-01-01T00:00:00Z",
                "snapshotAt": "2026-09-07T00:00:00Z", "retrievedAt": "2026-09-07T00:00:00Z",
                "access": "yes", "activityAccess": "yes"]
            if let nodes { result["nodeIds"] = nodes }
            return result
        }
        var access: [String: Any] = ["schemaVersion": 1, "placeId": "osm:way:8", "state": "documented",
            "reason": "entrance_on_connected_path", "checkedAt": "2026-09-07T00:00:00Z",
            "evidence": [reference("osm:way:8", nodes: [1, 4, 5, 1]), reference("osm:node:1")],
            "target": ["kind": "entrance", "osmId": "osm:node:1", "coordinate": originalTarget,
                       "relationship": "entrance_node_on_poi_boundary", "straightLineOffsetMeters": Int(offset.rounded()),
                       "remainingWalkMeters": NSNull(), "poiVisitConfirmed": false]]
        places[0]["access"] = access
        route["places"] = places
        envelope["route"] = route
        let result = try BackendDynamicResearchPlanningClient.validate(JSONSerialization.data(withJSONObject: envelope),
            request: request, start: start, end: nil, context: .unspecified, now: now)
        let stop = try XCTUnwrap(result.suggestion.route.dynamicResearchStops.first)
        XCTAssertEqual(stop.id, "osm:way:8")
        XCTAssertEqual(stop.coordinate.latitude, 57.213)
        XCTAssertEqual(stop.access?.target?.coordinate.latitude, 57.21)
        XCTAssertEqual(stop.access?.target?.poiVisitConfirmed, false)
        XCTAssertNil(stop.access?.target?.remainingWalkMeters)
        access["evidence"] = [reference("osm:way:8", nodes: [4, 5, 6, 4]), reference("osm:node:1")]
        places[0]["access"] = access
        route["places"] = places
        envelope["route"] = route
        XCTAssertThrowsError(try BackendDynamicResearchPlanningClient.validate(JSONSerialization.data(withJSONObject: envelope),
            request: request, start: start, end: nil, context: .unspecified, now: now))
    }

    func testFreshConditionsMustMatchRequestedTripTimeAndAreNotRejuvenatedOnReceipt() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dynamic-research-offline.json")
        var envelope = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: Any])
        var route = try XCTUnwrap(envelope["route"] as? [String: Any])
        var scheduled = request
        scheduled.plannedStartAt = PlanningEvidenceDate.parse("2026-09-08T08:00:00Z")!
        let body = try BackendDynamicResearchPlanningClient.requestBody(prompt: "A planned walk", request: scheduled,
            start: start, end: nil, context: .unspecified)
        XCTAssertEqual((try JSONSerialization.jsonObject(with: body) as? [String: Any])?["plannedStartAt"] as? String,
                       "2026-09-08T08:00:00Z")
        var conditions: [String: Any] = ["schemaVersion": 1, "checkedAt": "2026-09-07T01:00:00Z",
            "expiresAt": "2026-09-07T02:00:00Z", "visitTime": "2026-09-08T08:00:00Z",
            "scope": "route_corridor", "coverage": "partial", "sources": [], "notices": [],
            "blockingNoticeIds": [], "limitations": ["Local sources not checked."]]
        let now = PlanningEvidenceDate.parse("2026-09-07T01:30:00Z")!
        route["localConditions"] = conditions
        envelope["route"] = route
        let validData = try JSONSerialization.data(withJSONObject: envelope)
        let result = try BackendDynamicResearchPlanningClient.validate(validData, request: scheduled,
            start: start, end: nil, context: .unspecified, now: now)
        XCTAssertEqual(result.suggestion.route.localConditions?.visitTime, "2026-09-08T08:00:00Z")
        XCTAssertThrowsError(try BackendDynamicResearchPlanningClient.validate(validData, request: scheduled,
            start: start, end: nil, context: .unspecified, now: now.addingTimeInterval(3600)))
        conditions["visitTime"] = "2026-09-08T09:00:00Z"
        route["localConditions"] = conditions
        envelope["route"] = route
        XCTAssertThrowsError(try BackendDynamicResearchPlanningClient.validate(JSONSerialization.data(withJSONObject: envelope),
            request: scheduled, start: start, end: nil, context: .unspecified, now: now))
    }

    func testNewSourcePassageRemainsBoundToItsSelectedIdentity() throws {
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/dynamic-source-passage-offline.json")
        let data = try Data(contentsOf: file)
        let request = RoutePlanningRequest(routeType: .loop, startQuery: "Offline village", endQuery: nil,
            activityType: .hiking, graphHopperProfile: "foot", targetDistanceKm: 6,
            targetDurationMinutes: nil, difficulty: .moderate, desiredFeatures: [])
        let result = try BackendDynamicResearchPlanningClient.validate(data, request: request,
            start: Coordinate(latitude: 57.2, longitude: -4.7), end: nil, context: .unspecified,
            now: PlanningEvidenceDate.parse("2026-09-07T01:00:00Z")!)
        let research = try XCTUnwrap(result.suggestion.route.dynamicWebResearch)
        XCTAssertEqual(research.routeEvidence?.claims.first?.relationship, "source_passage")
        XCTAssertEqual(research.routeEvidence?.claims.first?.placeId, result.suggestion.route.dynamicResearchStops.first?.id)
    }

    func testFullNativeWishAndCumulativeAscentTransport() throws {
        let prompt = "15 km Rundwanderung, höchstens 150 Höhenmeter und maximal 120 Minuten"
        let limits = ResearchPromptConstraints(prompt: prompt)
        XCTAssertEqual(limits.maximumElevationGainMeters, 150)
        XCTAssertEqual(limits.maximumDurationMinutes, 120)
        XCTAssertFalse(limits.requiresClarification)
        var request = RoutePlanningRequest(routeType: .loop, startQuery: "Ilsenburg", endQuery: nil,
            activityType: .hiking, graphHopperProfile: "foot", targetDistanceKm: 15,
            targetDurationMinutes: 110, difficulty: .easy, desiredFeatures: [.forest], avoidFeatures: [.majorRoads])
        request.plannedStartAt = Date(timeIntervalSince1970: 1_800_000_000)
        let context = ResearchLedPlanningContext(maximumDistanceKm: nil, maximumDurationMinutes: 120,
            distanceOrigin: "prompt", preferenceOrigin: "saved_profile", maximumElevationGainMeters: 150)
        let body = try BackendDynamicResearchPlanningClient.requestBody(prompt: prompt, request: request,
            start: Coordinate(latitude: 51.86, longitude: 10.68), end: nil, context: context)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(object["prompt"] as? String, prompt)
        let constraints = try XCTUnwrap(object["constraints"] as? [String: Any])
        XCTAssertEqual(constraints["maximumElevationGainMeters"] as? Double, 150)
        let preferences = try XCTUnwrap(object["preferences"] as? [String: Any])
        XCTAssertEqual(preferences["desiredFeatures"] as? [String], request.desiredFeatures.map(\.label))
        XCTAssertEqual(preferences["avoidFeatures"] as? [String], request.avoidFeatures.map(\.label))
        XCTAssertEqual(preferences["preferenceOrigin"] as? String, "saved_profile")
        XCTAssertEqual(preferences["targetDurationMinutes"] as? Int, 110)
        XCTAssertNotNil(object["plannedStartAt"] as? String)
    }

    func testDynamicServiceErrorsStayServiceErrors() {
        XCTAssertEqual(PlannerViewModel.recoveryKind(for: OutdoorAdventurePlanningClientFailure.timedOut, stage: .routing), .timedOut)
        XCTAssertEqual(PlannerViewModel.recoveryKind(for: OutdoorAdventurePlanningClientFailure.unavailable, stage: .routing), .routing)
        XCTAssertEqual(PlannerViewModel.recoveryKind(for: OutdoorAdventurePlanningClientFailure.invalidResponse, stage: .routing), .unverified)
        let text = PlannerViewModel.userMessage(for: OutdoorAdventurePlanningClientFailure.unavailable)
        XCTAssertTrue(text.contains("unavailable"))
        XCTAssertFalse(text.contains("No fitting route"))
    }

    func testExplicitPartialQualityReviewIsDisplayedAndUnfinishedReviewsAreRejected() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dynamic-evidence-revised-offline.json")
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: Any])
        var route = try XCTUnwrap(object["route"] as? [String: Any])
        let now = ISO8601DateFormatter().date(from: "2026-09-07T01:00:00Z")!
        for decision in ["partial", "revise", "reject"] {
            route["qualityReview"] = ["schemaVersion": 1, "decision": decision,
                "summary": "This measured route is shorter than requested.", "remainingWishes": ["Requested distance is not reached."], "evidenceIds": []]
            object["route"] = route
            let data = try JSONSerialization.data(withJSONObject: object)
            if decision == "partial" {
                let result = try BackendDynamicResearchPlanningClient.validate(data, request: request,
                    start: start, end: nil, context: .unspecified, now: now, requiresWebResearch: true)
                XCTAssertTrue(result.suggestion.route.dynamicResearchExplanation?.contains("Partial match") == true)
                XCTAssertTrue(result.suggestion.route.dynamicResearchExplanation?.contains("Requested distance is not reached") == true)
            } else {
                XCTAssertThrowsError(try BackendDynamicResearchPlanningClient.validate(data, request: request,
                    start: start, end: nil, context: .unspecified, now: now, requiresWebResearch: true))
            }
        }
        let message = PlannerViewModel.userMessage(for: OutdoorAdventurePlanningClientFailure.noAcceptableRoute)
        XCTAssertTrue(message.contains("in this attempt"))
        XCTAssertTrue(message.contains("hard limits"))
    }

    func testCurrentResearchAttributionIsDecodedValidatedAndNotPersisted() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dynamic-evidence-revised-offline.json")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as? [String: Any])
        let route = try XCTUnwrap(object["route"] as? [String: Any])
        let web = try XCTUnwrap(route["webResearch"] as? [String: Any])
        let conditions: [String: Any] = ["schemaVersion": 1, "checkedAt": "2026-09-07T01:00:00Z",
            "expiresAt": "2026-09-07T02:00:00Z", "visitTime": NSNull(), "scope": "route_corridor", "coverage": "partial",
            "sources": [], "notices": [], "blockingNoticeIds": [], "limitations": [], "researchEvidence": web]
        let decoded = try JSONDecoder().decode(RouteLocalConditions.self, from: JSONSerialization.data(withJSONObject: conditions))
        try decoded.validate()
        XCTAssertNotNil(decoded.researchEvidence)
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(decoded)) as? [String: Any])
        XCTAssertNil(saved["researchEvidence"])
        XCTAssertNotNil(saved["checkedAt"])
    }

}
