import Foundation
import CoreLocation

nonisolated enum PlanningEvidenceDate {
    static func parse(_ text: String?) -> Date? {
        guard let text, text.count <= 40 else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let result = formatter.date(from: text) { return result }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }
    static func validLabel(_ text: String, maximum: Int = 300) -> Bool {
        !text.isEmpty && text.count <= maximum && !text.contains("<") && !text.contains(">") &&
        !text.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
    static func validURL(_ url: URL) -> Bool {
        url.scheme == "https" && url.host != nil && url.user == nil && url.password == nil && url.port == nil
    }
}

nonisolated struct RouteAccessEvidence: Codable, Hashable, Sendable {
    enum State: String, Codable, Sendable { case documented, unknown, excluded }
    struct Reference: Codable, Hashable, Sendable {
        let id: String
        let url: URL
        let version: Int
        let updatedAt: String
        let snapshotAt: String
        let retrievedAt: String
        let nodeIds: [Int]?
        let access: String?
        let activityAccess: String?
    }
    struct Target: Codable, Hashable, Sendable {
        let kind: String
        let osmId: String
        let coordinate: DynamicResearchCoordinate
        let relationship: String
        let straightLineOffsetMeters: Int
        let remainingWalkMeters: Double?
        let poiVisitConfirmed: Bool
    }
    let schemaVersion: Int
    let placeId: String
    let state: State
    let reason: String
    let checkedAt: String
    let evidence: [Reference]
    let target: Target?

    func validate(place: DynamicResearchStop, now: Date = .now, requireFresh: Bool = false) throws {
        func reject() throws { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
        guard schemaVersion == 1, placeId == place.id, evidence.count <= 4,
              Set(evidence.map(\.id)).count == evidence.count,
              PlanningEvidenceDate.validLabel(reason),
              let checked = PlanningEvidenceDate.parse(checkedAt), checked <= now.addingTimeInterval(300) else { return try reject() }
        for reference in evidence {
            guard reference.version > 0,
                  reference.id.range(of: "^osm:(node|way|relation):[1-9][0-9]*$", options: .regularExpression) != nil,
                  reference.url.absoluteString == "https://www.openstreetmap.org/" + reference.id.dropFirst(4).replacingOccurrences(of: ":", with: "/"),
                  let snapshot = PlanningEvidenceDate.parse(reference.snapshotAt),
                  let updated = PlanningEvidenceDate.parse(reference.updatedAt),
                  let retrieved = PlanningEvidenceDate.parse(reference.retrievedAt),
                  updated <= snapshot.addingTimeInterval(300), snapshot <= retrieved.addingTimeInterval(300),
                  retrieved <= checked.addingTimeInterval(300), (reference.nodeIds?.count ?? 0) <= 500,
                  reference.nodeIds?.allSatisfy({ $0 > 0 }) ?? true,
                  !requireFresh || (now.timeIntervalSince(snapshot) <= 7 * 86_400 && now.timeIntervalSince(retrieved) <= 86_400)
            else { return try reject() }
        }
        guard state == .documented else {
            guard target == nil else { return try reject() }
            return
        }
        guard let target, target.coordinate.isValid, !target.poiVisitConfirmed,
              target.remainingWalkMeters == nil, target.straightLineOffsetMeters >= 0,
              let poi = evidence.first(where: { $0.id == placeId }), poi.version == place.source.version,
              evidence.contains(where: { $0.id == target.osmId }) else { return try reject() }
        let offset = CLLocation(latitude: place.coordinate.latitude, longitude: place.coordinate.longitude)
            .distance(from: CLLocation(latitude: target.coordinate.latitude, longitude: target.coordinate.longitude))
        guard abs(offset - Double(target.straightLineOffsetMeters)) <= max(5, offset * 0.01) else { return try reject() }
        if target.kind == "entrance" {
            guard placeId.hasPrefix("osm:way:"), target.osmId.hasPrefix("osm:node:"),
                  target.relationship == "entrance_node_on_poi_boundary",
                  let nodeID = Int(target.osmId.split(separator: ":").last ?? ""),
                  let nodes = poi.nodeIds, nodes.count >= 4, nodes.first == nodes.last, nodes.contains(nodeID)
            else { return try reject() }
        } else {
            guard target.kind == "poi", target.osmId == placeId, target.relationship == "same_osm_node", offset <= 1 else { return try reject() }
        }
    }
}

nonisolated struct RouteLocalConditions: Codable, Hashable, Sendable {
    struct Source: Codable, Hashable, Identifiable, Sendable {
        let id: String
        let name: String
        let url: URL?
        let authority: String
        let checkedAt: String
        let state: String
        let reason: String
    }
    struct Notice: Codable, Hashable, Identifiable, Sendable {
        struct Origin: Codable, Hashable, Sendable {
            let id: String
            let name: String
            let url: URL
            let authority: String
        }
        let id: String
        let eventId: String
        let title: String
        let areaLabel: String
        let kind: String
        let status: String
        let publishedAt: String?
        let retrievedAt: String
        let eventStart: String?
        let eventEnd: String?
        let validFrom: String?
        let validUntil: String?
        let source: Origin
        let action: String
        let validity: String
        let spatial: String
        let blocksRoute: Bool
        var freshness: String? = nil
        var temporalBasis: String? = nil
        var sourceUpdatedAt: String? = nil
        var sourceExcerpt: String? = nil
        var relevanceReason: String? = nil
    }
    let schemaVersion: Int
    let checkedAt: String
    let expiresAt: String
    let visitTime: String?
    let scope: String
    let coverage: String
    let sources: [Source]
    let notices: [Notice]
    let blockingNoticeIds: [String]
    let limitations: [String]
    // Grounded provider text belongs only to this response, never saved-route storage.
    var researchEvidence: DynamicWebResearch? = nil

    enum CodingKeys: String, CodingKey {
        case schemaVersion, checkedAt, expiresAt, visitTime, scope, coverage, sources, notices, blockingNoticeIds, limitations, researchEvidence
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(schemaVersion, forKey: .schemaVersion)
        try values.encode(checkedAt, forKey: .checkedAt)
        try values.encode(expiresAt, forKey: .expiresAt)
        try values.encodeIfPresent(visitTime, forKey: .visitTime)
        try values.encode(scope, forKey: .scope)
        try values.encode(coverage, forKey: .coverage)
        try values.encode(sources, forKey: .sources)
        try values.encode(notices, forKey: .notices)
        try values.encode(blockingNoticeIds, forKey: .blockingNoticeIds)
        try values.encode(limitations, forKey: .limitations)
    }

    func needsRefresh(at now: Date) -> Bool {
        guard let expires = PlanningEvidenceDate.parse(expiresAt) else { return true }
        return expires <= now
    }

    func validate() throws {
        func reject() throws { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
        guard schemaVersion == 1, coverage == "partial", ["area", "route_corridor"].contains(scope),
              let checked = PlanningEvidenceDate.parse(checkedAt), let expires = PlanningEvidenceDate.parse(expiresAt),
              expires > checked, expires.timeIntervalSince(checked) <= 3600,
              visitTime == nil || PlanningEvidenceDate.parse(visitTime) != nil,
              sources.count <= 12, notices.count <= 40, limitations.count <= 6,
              Set(sources.map(\.id)).count == sources.count, Set(notices.map(\.id)).count == notices.count,
              limitations.allSatisfy({ PlanningEvidenceDate.validLabel($0) }),
              Set(blockingNoticeIds) == Set(notices.filter(\.blocksRoute).map(\.id)) else { return try reject() }
        try researchEvidence?.validate()
        for source in sources {
            guard PlanningEvidenceDate.validLabel(source.id), PlanningEvidenceDate.validLabel(source.name),
                  PlanningEvidenceDate.validLabel(source.reason), PlanningEvidenceDate.parse(source.checkedAt) != nil,
                  ["official", "local_news", "unknown"].contains(source.authority),
                  ["checked", "not_checked", "unavailable"].contains(source.state),
                  source.url.map(PlanningEvidenceDate.validURL) ?? (source.state != "checked") else { return try reject() }
        }
        for notice in notices {
            guard [notice.id, notice.eventId, notice.title, notice.areaLabel, notice.action, notice.source.name].allSatisfy({ PlanningEvidenceDate.validLabel($0) }),
                  ["closure", "weather", "fire", "flood", "access", "transport"].contains(notice.kind),
                  ["active", "revoked", "unknown"].contains(notice.status),
                  ["active", "revoked", "expired", "stale", "unknown", "future", "conflicting"].contains(notice.validity),
                  ["route", "area", "unknown"].contains(notice.spatial),
                  PlanningEvidenceDate.validURL(notice.source.url),
                  sources.contains(where: { source in
                      source.id == notice.source.id && source.authority == notice.source.authority &&
                      (source.url == notice.source.url || (source.id == "harz-official-news" && source.authority == "official" &&
                       source.url?.host == "www.nationalpark-harz.de" && notice.source.url.host == source.url?.host &&
                       notice.source.url.path.hasPrefix("/de/aktuelles/")))
                  }),
                  PlanningEvidenceDate.parse(notice.retrievedAt) != nil,
                  [notice.publishedAt, notice.eventStart, notice.eventEnd, notice.validFrom, notice.validUntil].allSatisfy({ $0 == nil || PlanningEvidenceDate.parse($0) != nil })
            else { return try reject() }
            guard notice.freshness.map({ ["fresh", "stale", "unknown"].contains($0) }) ?? true,
                  notice.temporalBasis.map({ ["explicit_interval", "until_revoked", "maintained_listing", "publication_only"].contains($0) }) ?? true,
                  notice.sourceUpdatedAt == nil || PlanningEvidenceDate.parse(notice.sourceUpdatedAt) != nil,
                  notice.sourceExcerpt.map({ PlanningEvidenceDate.validLabel($0, maximum: 600) }) ?? true,
                  notice.relevanceReason.map({ PlanningEvidenceDate.validLabel($0, maximum: 300) }) ?? true else { return try reject() }
            if notice.blocksRoute {
                guard notice.source.authority == "official", notice.validity == "active", notice.spatial == "route",
                      notice.status == "active", ["closure", "access"].contains(notice.kind),
                      notice.publishedAt != nil, notice.validFrom != nil, notice.validUntil != nil else { return try reject() }
            }
        }
    }
}
