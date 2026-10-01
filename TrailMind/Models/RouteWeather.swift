import Foundation

nonisolated struct RouteWeather: Decodable, Sendable {
    enum State: String, Decodable, Sendable {
        case available, dateRequired = "date_required", outsideHorizon = "outside_horizon"
        case durationUnsupported = "duration_unsupported", unavailable
    }
    struct Source: Decodable, Sendable {
        let name: String
        let url: URL
        let licenseURL: URL
    }
    struct Sample: Decodable, Sendable, Identifiable {
        var id: Double { fraction }
        let fraction: Double
        let latitude: Double
        let longitude: Double
        let temperatureMinC: Double
        let temperatureMaxC: Double
        let windMaxKmh: Double
        let precipitationMaxMmPerHour: Double
        let intervalHours: Int
        let sourceUpdatedAt: String
        let retrievedAt: String
        let expiresAt: String
    }
    let version: Int
    let state: State
    let geometryDigest: String
    let plannedStartAt: String?
    let durationHours: Double
    let checkedAt: String
    let windowEnd: String?
    let source: Source?
    let samples: [Sample]

    func isFresh(at now: Date) -> Bool {
        !samples.isEmpty && samples.allSatisfy { sample in
            guard let expires = PlanningEvidenceDate.parse(sample.expiresAt),
                  let updated = PlanningEvidenceDate.parse(sample.sourceUpdatedAt) else { return false }
            return expires > now && now.timeIntervalSince(updated) < 24 * 3600
        }
    }

    func validate(digest: String, start: Date?, duration: Double, now: Date = .now) throws {
        func invalid() throws { throw CocoaError(.coderReadCorrupt) }
        guard version == 1, geometryDigest == digest, durationHours == duration,
              let checked = PlanningEvidenceDate.parse(checkedAt), checked <= now.addingTimeInterval(300),
              checked >= now.addingTimeInterval(-300),
              PlanningEvidenceDate.parse(plannedStartAt) == start.map({ Date(timeIntervalSince1970: floor($0.timeIntervalSince1970)) }) else { return try invalid() }
        guard state == .available else {
            guard samples.isEmpty, source == nil, windowEnd == nil else { return try invalid() }
            return
        }
        guard let start, let end = PlanningEvidenceDate.parse(windowEnd),
              abs(end.timeIntervalSince(start) - duration * 3600) < 1,
              duration <= 24, (samples.map(\.fraction) == [0, 0.5, 1] || samples.map(\.fraction) == [0, 0.33, 0.67]),
              source?.name == "MET Norway", source?.url.absoluteString == "https://api.met.no/",
              source?.licenseURL.absoluteString == "https://creativecommons.org/licenses/by/4.0/",
              isFresh(at: now) else { return try invalid() }
        for sample in samples {
            guard sample.latitude.isFinite, (-90...90).contains(sample.latitude),
                  sample.longitude.isFinite, (-180...180).contains(sample.longitude),
                  (-100...65).contains(sample.temperatureMinC), (-100...65).contains(sample.temperatureMaxC),
                  sample.temperatureMinC <= sample.temperatureMaxC, (0...540).contains(sample.windMaxKmh),
                  (0...2000).contains(sample.precipitationMaxMmPerHour), [1, 6].contains(sample.intervalHours),
                  let updated = PlanningEvidenceDate.parse(sample.sourceUpdatedAt), updated <= now.addingTimeInterval(300),
                  let retrieved = PlanningEvidenceDate.parse(sample.retrievedAt), retrieved <= now.addingTimeInterval(300),
                  retrieved >= updated.addingTimeInterval(-300) else { return try invalid() }
        }
    }
}
