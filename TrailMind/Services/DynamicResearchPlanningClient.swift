import Foundation
import CryptoKit
import CoreLocation

nonisolated struct DynamicResearchCoordinate: Codable, Hashable, Sendable {
    let latitude: Double
    let longitude: Double

    var isValid: Bool {
        latitude.isFinite && longitude.isFinite && (-90...90).contains(latitude) && (-180...180).contains(longitude)
    }
}

nonisolated struct DynamicResearchStop: Codable, Hashable, Identifiable, Sendable {
    struct Source: Codable, Hashable, Sendable {
        let provider: String
        let url: URL
        let license: String
        let attribution: String
        let version: Int
        let updatedAt: String
        let retrievedAt: String
        let snapshotAt: String
    }
    struct Photo: Codable, Hashable, Sendable {
        let url: URL
        let sourceURL: URL
        let license: String
        let licenseURL: URL
        let credit: String
        let placeSourceURL: URL
    }
    let id: String
    let name: String
    let category: String
    let wikidataId: String?
    let commonsFile: String?
    let coordinate: DynamicResearchCoordinate
    let source: Source
    let photo: Photo?
    var access: RouteAccessEvidence? = nil

    init(
        id: String,
        name: String,
        category: String,
        wikidataId: String?,
        commonsFile: String? = nil,
        coordinate: DynamicResearchCoordinate,
        source: Source,
        photo: Photo?,
        access: RouteAccessEvidence? = nil
    ) {
        self.id = id
        self.name = name
        self.category = category
        self.wikidataId = wikidataId
        self.commonsFile = commonsFile
        self.coordinate = coordinate
        self.source = source
        self.photo = photo
        self.access = access
    }
}

struct DynamicResearchPlanningResult: @unchecked Sendable {
    let suggestion: RouteSuggestion
}

protocol DynamicResearchPlanning: Sendable {
    func validateConfiguration() throws
    func recheck(route: TrailRoute, plannedStartAt: Date?) async throws -> RouteLocalConditions
    func plan(prompt: String, request: RoutePlanningRequest, start: Coordinate,
              end: Coordinate?, context: ResearchLedPlanningContext) async throws -> DynamicResearchPlanningResult
}

extension DynamicResearchPlanning {
    func validateConfiguration() throws {}
    func recheck(route: TrailRoute, plannedStartAt: Date?) async throws -> RouteLocalConditions {
        throw OutdoorAdventurePlanningClientFailure.unavailable
    }
}

struct BackendDynamicResearchPlanningClient: DynamicResearchPlanning {
    let baseURL: URL
    let session: URLSession
    let authorizer: any RouteSessionAuthorizing

    func plan(prompt: String, request: RoutePlanningRequest, start: Coordinate,
              end: Coordinate?, context: ResearchLedPlanningContext) async throws -> DynamicResearchPlanningResult {
        try Task.checkCancellation()
        guard (request.routeType == .loop && end == nil) || (request.routeType == .pointToPoint && end != nil) else {
            throw OutdoorAdventurePlanningClientFailure.rejected
        }
        // Encode once. Only an explicit pre-provider expiry can trigger one fresh session.
        let body = try Self.requestBody(prompt: prompt, request: request, start: start, end: end, context: context)
        for attempt in 0...1 {
            let authorization = try await authorizer.authorization(cost: 12)
            try Task.checkCancellation()
            var http = URLRequest(url: baseURL.appendingPathComponent("api/llm-plan-route"))
            http.httpMethod = "POST"
            http.timeoutInterval = 160
            http.setValue("application/json", forHTTPHeaderField: "Content-Type")
            http.setValue("application/json", forHTTPHeaderField: "Accept")
            http.setValue("TrailMindRouteSession \(authorization.token)", forHTTPHeaderField: "Authorization")
            http.setValue(authorization.requestID.uuidString, forHTTPHeaderField: "X-TrailMind-Request-ID")
            http.httpBody = body
            do {
                let (data, response) = try await BoundedRouteHTTPTransport(session: session, limits: .standard, rejectsRedirects: true).data(for: http)
                guard let response = response as? HTTPURLResponse else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
                if response.statusCode == 401 {
                    let envelope = try? JSONDecoder().decode(SessionErrorEnvelope.self, from: data)
                    await authorizer.invalidate(token: authorization.token)
                    if attempt == 0, envelope?.error.code == "route_session_expired" {
                        try Task.checkCancellation()
                        continue
                    }
                    throw OutdoorAdventurePlanningClientFailure.authorizationFailed
                }
                guard response.statusCode == 200 else {
                    if response.statusCode == 422,
                       (try? JSONDecoder().decode(SessionErrorEnvelope.self, from: data))?.error.code == "research_no_acceptable_route" {
                        throw OutdoorAdventurePlanningClientFailure.noAcceptableRoute
                    }
                    switch response.statusCode {
                    case 403: throw OutdoorAdventurePlanningClientFailure.authorizationFailed
                    case 504: throw OutdoorAdventurePlanningClientFailure.timedOut
                    case 429: throw OutdoorAdventurePlanningClientFailure.rateLimited
                    case 400, 409, 422: throw OutdoorAdventurePlanningClientFailure.rejected
                    case 499: throw CancellationError()
                    default: throw OutdoorAdventurePlanningClientFailure.unavailable
                    }
                }
                try Task.checkCancellation()
                return try Self.validate(data, request: request, start: start, end: end, context: context, requiresWebResearch: true)
            } catch let error as URLError where error.code == .cancelled {
                throw CancellationError()
            } catch let error as URLError where error.code == .timedOut {
                throw OutdoorAdventurePlanningClientFailure.timedOut
            } catch is URLError {
                throw OutdoorAdventurePlanningClientFailure.unavailable
            }
        }
        throw OutdoorAdventurePlanningClientFailure.authorizationFailed
    }

    func recheck(route: TrailRoute, plannedStartAt: Date?) async throws -> RouteLocalConditions {
        let geometryData = try JSONSerialization.data(withJSONObject: route.path.map { [$0.longitude, $0.latitude] })
        guard geometryData.count <= 500_000, route.path.count <= 20_000,
              let geometryJSON = String(data: geometryData, encoding: .utf8) else {
            throw OutdoorAdventurePlanningClientFailure.requestTooLarge
        }
        let digest = SHA256.hash(data: geometryData).map { String(format: "%02x", $0) }.joined()
        let body = try JSONSerialization.data(withJSONObject: ["schemaVersion": 4, "geometryJSON": geometryJSON,
            "locationName": route.waypoints.first(where: { $0.kind == .start })?.name ?? route.location,
            "routePlaces": route.dynamicResearchStops.map { ["name": $0.name,
                "coordinate": ["latitude": $0.coordinate.latitude, "longitude": $0.coordinate.longitude],
                "source": ["url": $0.source.url.absoluteString]] as [String: Any] },
            "plannedStartAt": plannedStartAt.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? NSNull()])
        for attempt in 0...1 {
            try Task.checkCancellation()
            let authorization = try await authorizer.authorization(cost: 12)
            var http = URLRequest(url: baseURL.appendingPathComponent("api/llm-plan-route"))
            http.httpMethod = "POST"; http.httpBody = body; http.timeoutInterval = 130
            http.setValue("application/json", forHTTPHeaderField: "Content-Type")
            http.setValue("TrailMindRouteSession \(authorization.token)", forHTTPHeaderField: "Authorization")
            http.setValue(authorization.requestID.uuidString, forHTTPHeaderField: "X-TrailMind-Request-ID")
            let (data, response) = try await BoundedRouteHTTPTransport(session: session, limits: .standard, rejectsRedirects: true).data(for: http)
            guard let response = response as? HTTPURLResponse else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
            if response.statusCode == 401 {
                await authorizer.invalidate(token: authorization.token)
                if attempt == 0, (try? JSONDecoder().decode(SessionErrorEnvelope.self, from: data))?.error.code == "route_session_expired" { continue }
                throw OutdoorAdventurePlanningClientFailure.authorizationFailed
            }
            guard response.statusCode == 200 else { throw OutdoorAdventurePlanningClientFailure.unavailable }
            guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  envelope["schemaVersion"] as? Int == 4, envelope["state"] as? String == "checked",
                  envelope["geometryDigest"] as? String == digest, let raw = envelope["localConditions"] as? [String: Any] else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            let evidence = try JSONDecoder().decode(RouteLocalConditions.self, from: JSONSerialization.data(withJSONObject: raw))
            try evidence.validate()
            guard !evidence.needsRefresh(at: .now),
                  PlanningEvidenceDate.parse(evidence.visitTime) == plannedStartAt.map({ Date(timeIntervalSince1970: floor($0.timeIntervalSince1970)) }),
                  let checked = PlanningEvidenceDate.parse(evidence.checkedAt), checked <= Date.now.addingTimeInterval(300) else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            try Task.checkCancellation()
            return evidence
        }
        throw OutdoorAdventurePlanningClientFailure.authorizationFailed
    }

    private struct SessionErrorEnvelope: Decodable {
        struct Failure: Decodable { let code: String }
        let error: Failure
    }

    static func requestBody(prompt: String, request: RoutePlanningRequest, start: Coordinate,
                            end: Coordinate?, context: ResearchLedPlanningContext) throws -> Data {
        let null = NSNull()
        let body: [String: Any] = [
            "schemaVersion": 3, "parserSource": "remoteAI", "prompt": prompt,
            "plannedStartAt": request.plannedStartAt.map { ISO8601DateFormatter().string(from: $0) } as Any? ?? null,
            "researchMode": "web_and_map", "locationName": request.startQuery,
            "anchor": ["latitude": start.latitude, "longitude": start.longitude],
            "end": end.map { ["latitude": $0.latitude, "longitude": $0.longitude] as Any } ?? null,
            "intent": ["activityType": request.activityType == .trailRunning ? "trailRunning" : request.activityType == .biking ? "biking" : "hiking", "routeType": request.routeType == .loop ? "loop" : "pointToPoint",
                       "targetDistanceKm": request.targetDistanceKm as Any? ?? null,
                       "difficulty": request.difficulty.map { $0 == .challenging ? "hard" : $0.rawValue.lowercased() } as Any? ?? null],
            "preferences": ["desiredFeatures": request.desiredFeatures.map(\.label),
                            "avoidFeatures": request.avoidFeatures.map(\.label),
                            "targetDurationMinutes": request.targetDurationMinutes as Any? ?? null,
                            "distanceOrigin": context.distanceOrigin, "preferenceOrigin": context.preferenceOrigin],
            "constraints": ["maximumDistanceKm": context.maximumDistanceKm as Any? ?? null,
                            "maximumDurationMinutes": context.maximumDurationMinutes as Any? ?? null,
                            "maximumElevationGainMeters": (context.maximumElevationGainMeters ?? ResearchPromptConstraints(prompt: prompt).maximumElevationGainMeters) as Any? ?? null, "hardAvoidances": context.hardAvoidances]
        ]
        let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        guard data.count <= 16_384 else { throw OutdoorAdventurePlanningClientFailure.requestTooLarge }
        return data
    }

    static func validate(_ data: Data, request: RoutePlanningRequest, start: Coordinate,
                         end: Coordinate?, context: ResearchLedPlanningContext, now: Date = .now, requiresWebResearch: Bool = false) throws -> DynamicResearchPlanningResult {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["schemaVersion"] as? Int == 3, object["state"] as? String == "routed",
              let result = object["route"] as? [String: Any], result["accepted"] as? Bool == true,
              result["plannerSource"] as? String == "gemini_tools",
              result["geometryProvider"] as? String == "graphhopper",
              let path = result["path"] as? [String: Any], let places = result["places"] as? [[String: Any]],
              (0...3).contains(places.count), (request.routeType == .pointToPoint || !places.isEmpty) else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
        let stops = try JSONDecoder().decode([DynamicResearchStop].self, from: JSONSerialization.data(withJSONObject: places))
        guard Set(stops.map(\.id)).count == stops.count else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
        let pathData = try JSONSerialization.data(withJSONObject: ["provider": "graphhopper", "paths": [path]])
        var route = try GraphHopperClient.verifiedBackendRoute(fromSinglePathResponse: pathData,
            requestedStart: start, requestedEnd: end ?? start, planningRequest: request, limits: .standard)
        guard context.accepts(distanceKilometers: route.distanceKilometers, durationHours: route.durationHours) else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        if let maximum = context.maximumElevationGainMeters {
            guard let measuredAscent = path["ascend"] as? Double, measuredAscent.isFinite,
                  measuredAscent <= maximum else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
        }
        if let target = request.targetDistanceKm {
            guard route.distanceKilometers >= target * 0.8, route.distanceKilometers <= target * 1.3 else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
        }
        let dates = ISO8601DateFormatter()
        dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var minimumIndex = 0
        for stop in stops {
            guard stop.coordinate.isValid, !stop.name.isEmpty, stop.name.count <= 180,
                  !stop.name.contains("<"), !stop.name.contains(">"),
                  ["viewpoint", "peak", "waterfall", "lake", "hut", "landmark", "named_place"].contains(stop.category),
                  stop.source.provider == "openstreetmap", stop.source.license == "ODbL-1.0", stop.source.version > 0,
                  stop.source.attribution == "© OpenStreetMap contributors",
                  stop.id.range(of: "^osm:(node|way|relation):[1-9][0-9]*$", options: .regularExpression) != nil,
                  stop.source.url.absoluteString == "https://www.openstreetmap.org/" + stop.id.dropFirst(4).replacingOccurrences(of: ":", with: "/"),
                  let snapshot = dates.date(from: stop.source.snapshotAt), let retrieved = dates.date(from: stop.source.retrievedAt),
                  snapshot <= now.addingTimeInterval(300), now.timeIntervalSince(snapshot) <= 7 * 86_400,
                  retrieved <= now.addingTimeInterval(300), now.timeIntervalSince(retrieved) <= 86_400 else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            try stop.access?.validate(place: stop, now: now, requireFresh: true)
            guard stop.access?.state != .excluded else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
            let target = stop.access?.state == .documented ? stop.access?.target?.coordinate ?? stop.coordinate : stop.coordinate
            let location = CLLocation(latitude: target.latitude, longitude: target.longitude)
            guard let index = route.path.indices.dropFirst(minimumIndex).first(where: { index in
                let point = route.path[index]
                return location.distance(from: CLLocation(latitude: point.latitude, longitude: point.longitude)) <= 100
            }) else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
            minimumIndex = index
            if let photo = stop.photo { try validatePhoto(photo, stop: stop) }
        }
        if let web = result["webResearch"] as? [String: Any] {
            let evidence = try JSONDecoder().decode(DynamicWebResearch.self, from: JSONSerialization.data(withJSONObject: web))
            try evidence.validate()
            if let mapping = evidence.routeEvidence {
                guard let routeID = result["routeId"] as? String else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
                try mapping.validate(research: evidence, routeId: routeID, stops: stops, now: now)
            }
            route.dynamicWebResearch = evidence.isAvailable(at: now) ? evidence : nil
        } else if requiresWebResearch {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        if let conditions = result["localConditions"] as? [String: Any] {
            let evidence = try JSONDecoder().decode(RouteLocalConditions.self, from: JSONSerialization.data(withJSONObject: conditions))
            try evidence.validate()
            let returnedVisit = PlanningEvidenceDate.parse(evidence.visitTime)
            guard returnedVisit == request.plannedStartAt.map({ Date(timeIntervalSince1970: floor($0.timeIntervalSince1970)) }),
                  let checked = PlanningEvidenceDate.parse(evidence.checkedAt), checked <= now.addingTimeInterval(300),
                  !evidence.needsRefresh(at: now) else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
            guard evidence.blockingNoticeIds.isEmpty else { throw OutdoorAdventurePlanningClientFailure.rejected }
            route.localConditions = evidence
        }
        if let review = result["qualityReview"] as? [String: Any] {
            guard review["schemaVersion"] as? Int == 1, let decision = review["decision"] as? String, ["complete", "partial"].contains(decision),
                  let summary = review["summary"] as? String, PlanningEvidenceDate.validLabel(summary, maximum: 600),
                  let remaining = review["remainingWishes"] as? [String], remaining.count <= 12,
                  remaining.allSatisfy({ PlanningEvidenceDate.validLabel($0, maximum: 240) }),
                  decision != "partial" || !remaining.isEmpty else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            route.dynamicResearchExplanation = ((decision == "partial" ? ["Partial match — some wishes remain open."] : []) + [summary] + remaining).joined(separator: "\n")
        } else if requiresWebResearch {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        if result["routeStays"] != nil {
            route.routeStays = .unavailable(path: route.path, now: now)
            let rawStays = result["routeStays"] as? [String: Any] ?? [:]
            // Optional enrichment must not make a verified route unusable if evidence is malformed.
            if let evidence = try? JSONDecoder().decode(RouteStays.self, from: JSONSerialization.data(withJSONObject: rawStays)),
               (try? evidence.validate(path: route.path, now: now, requireFresh: true)) != nil {
                route.routeStays = evidence
            }
        }
        route.dynamicResearchStops = stops
        route.dynamicResearchExplanation = route.dynamicResearchExplanation ?? "Gemini selected and ordered these sourced places. GraphHopper measured \(route.distanceLabel). Mapped categories do not verify current views, access or safety."
        return DynamicResearchPlanningResult(suggestion: RouteSuggestion(route: route, explanation: route.dynamicResearchExplanation ?? route.whyItMatches))
    }

    static func validateStoredEvidence(_ stops: [DynamicResearchStop]) throws {
        guard stops.count <= 3, Set(stops.map(\.id)).count == stops.count else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
        for stop in stops {
            guard stop.coordinate.isValid, !stop.name.isEmpty, stop.name.count <= 180,
                  stop.id.range(of: "^osm:(node|way|relation):[1-9][0-9]*$", options: .regularExpression) != nil,
                  stop.source.provider == "openstreetmap", stop.source.license == "ODbL-1.0",
                  stop.source.url.absoluteString == "https://www.openstreetmap.org/" + stop.id.dropFirst(4).replacingOccurrences(of: ":", with: "/") else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            try stop.access?.validate(place: stop)
            if let photo = stop.photo { try validatePhoto(photo, stop: stop) }
        }
    }

    static func validatePhoto(_ photo: DynamicResearchStop.Photo, stop: DynamicResearchStop) throws {
        let licenses = ["CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
            "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/", "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
            "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/", "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/"]
        let identityURLs: [URL] = [photo.sourceURL, photo.licenseURL, photo.placeSourceURL]
        for url in identityURLs {
            guard url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.port == nil else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
        }
        guard photo.url.user == nil, photo.url.password == nil, photo.url.fragment == nil, photo.url.port == nil else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        let hasWikidataIdentity = stop.wikidataId?.range(of: "^Q[1-9][0-9]*$", options: .regularExpression) != nil &&
            photo.placeSourceURL.absoluteString == "https://www.wikidata.org/wiki/" + (stop.wikidataId ?? "")
        let hasDirectOsmCommonsIdentity = validCommonsFile(stop.commonsFile) && photo.placeSourceURL == stop.source.url &&
            photo.sourceURL.lastPathComponent.replacingOccurrences(of: "_", with: " ") == "File:" + (stop.commonsFile ?? "").replacingOccurrences(of: "_", with: " ")
        guard hasWikidataIdentity || hasDirectOsmCommonsIdentity,
              WikimediaCommonsPhotoResolver.mediaURL(photo.url, matches: String(photo.sourceURL.lastPathComponent.dropFirst(5))),
              photo.url.scheme == "https", ["upload.wikimedia.org", "thumb.wikimedia.org"].contains(photo.url.host), photo.url.path.hasPrefix("/wikipedia/commons/"),
              photo.sourceURL.scheme == "https", photo.sourceURL.host == "commons.wikimedia.org", photo.sourceURL.path.hasPrefix("/wiki/File:"),
              licenses[photo.license] == photo.licenseURL.absoluteString, !photo.credit.isEmpty, photo.credit.count <= 500,
              !photo.credit.contains("<"), !photo.credit.contains(">") else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
    }

    private static func validCommonsFile(_ value: String?) -> Bool {
        guard let value, !value.isEmpty, value.count <= 240 else { return false }
        return !value.contains("/") && !value.contains("\\") && !value.contains("..") && !value.contains("|") && !value.contains("{") && !value.contains("[")
    }
}

enum DynamicResearchPlanningClientFactory {
    static func makeDefault() -> (any DynamicResearchPlanning)? {
        #if DEBUG && WANDERFUL_OWNER_PHONE_TEST
        if let configuration = WanderfulAppConfigurationSnapshot.configuration,
           let owner = OwnerPhoneTestConfiguration.loadForResearch(bundle: .main, configuration: configuration) {
            return BackendDynamicResearchPlanningClient(baseURL: owner.baseURL, session: .shared,
                authorizer: OwnerPhoneTestAuthorizer(configuration: owner))
        }
        #endif
        return make(configuration: WanderfulAppConfigurationSnapshot.configuration)
    }

    static func make(configuration: WanderfulAppConfiguration?, session: URLSession = .shared,
                     authorizer: (any RouteSessionAuthorizing)? = nil) -> (any DynamicResearchPlanning)? {
        guard let configuration else { return UnavailableDynamicResearchClient() }
        guard !configuration.features.invalidKeys.contains("RESEARCH_GUIDED_PLANNING_ENABLED") else {
            return UnavailableDynamicResearchClient()
        }
        guard configuration.features.researchGuidedPlanning else { return nil }
        guard configuration.features.remoteIntent,
              let backend = configuration.backend.configuredValue else {
            return UnavailableDynamicResearchClient()
        }
        // Bind verification to the same validated origin as the planning request.
        let attested = RouteSessionService(opener: AppAttestService(
            api: URLSessionAppAttestAPI(baseURL: backend.baseURL, session: session)
        ))
        let sessions = authorizer ?? TrailMindBackendSecurity.makeSessionAuthorizer(
            baseURL: backend.baseURL,
            allowsInsecureLoopback: configuration.environment == .local &&
                configuration.features.insecureLocalBackendAuthorization,
            attestedSessionAuthorizer: attested
        )
        return BackendDynamicResearchPlanningClient(baseURL: backend.baseURL, session: session,
            authorizer: sessions)
    }
}

struct DynamicResearchConfigurationFailure: LocalizedError, Sendable {
    var errorDescription: String? {
        "Research planning isn’t configured for this app version. Please install a configured version of Wanderful."
    }
}

private struct UnavailableDynamicResearchClient: DynamicResearchPlanning {
    func validateConfiguration() throws { throw DynamicResearchConfigurationFailure() }
    func plan(prompt: String, request: RoutePlanningRequest, start: Coordinate,
              end: Coordinate?, context: ResearchLedPlanningContext) async throws -> DynamicResearchPlanningResult {
        throw DynamicResearchConfigurationFailure()
    }
}
