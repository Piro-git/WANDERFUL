import Foundation

// Route models are immutable value snapshots. Persistence transfers them across
// the store actor without sharing mutable state.
extension TrailRoute: @unchecked Sendable { }

struct SavedRouteSnapshot: Identifiable, Hashable, Sendable {
    let route: TrailRoute
    let savedAt: Date
    let createdAt: Date

    var id: UUID { route.id }
}

struct SavedRouteLoadResult: Sendable {
    let snapshots: [SavedRouteSnapshot]
    let skippedRecordCount: Int
}

protocol SavedRouteStore: Sendable {
    func load() async throws -> SavedRouteLoadResult
    func save(_ route: TrailRoute, at date: Date) async throws -> SavedRouteSnapshot
    func remove(routeID: UUID) async throws
}

actor LocalSavedRouteStore: SavedRouteStore {
    nonisolated static let currentSchemaVersion = 2
    nonisolated private static let supportedSchemaVersions = 1...currentSchemaVersion

    private let directoryURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    static func applicationStore() -> LocalSavedRouteStore {
        let baseURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return LocalSavedRouteStore(directoryURL: baseURL.appendingPathComponent("SavedRoutes", isDirectory: true))
    }

    init(directoryURL: URL) {
        self.directoryURL = directoryURL
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    func load() async throws -> SavedRouteLoadResult {
        let fileManager = FileManager.default
        try createDirectoryIfNeeded()
        let urls = try fileManager.contentsOfDirectory(
            at: directoryURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ).filter { $0.pathExtension == "json" }

        var snapshots: [SavedRouteSnapshot] = []
        var skipped = 0
        for url in urls {
            do {
                let data = try Data(contentsOf: url)
                let header = try decoder.decode(SchemaHeader.self, from: data)
                guard Self.supportedSchemaVersions.contains(header.schemaVersion) else {
                    skipped += 1
                    continue
                }
                let record = try decoder.decode(PersistedRoute.self, from: data)
                snapshots.append(try await MainActor.run { try record.snapshot })
            } catch {
                skipped += 1
            }
        }

        return SavedRouteLoadResult(
            snapshots: snapshots.sorted { $0.savedAt > $1.savedAt },
            skippedRecordCount: skipped
        )
    }

    func save(_ route: TrailRoute, at date: Date = Date()) async throws -> SavedRouteSnapshot {
        try await MainActor.run {
            try RouteEligibilityPolicy.validate(route, for: .persistence)
        }
        try createDirectoryIfNeeded()
        let url = recordURL(for: route.id)
        let existing = try? decodeRecord(at: url)
        let record = await MainActor.run {
            PersistedRoute(
                route: route,
                createdAt: existing?.createdAt ?? date,
                savedAt: existing?.savedAt ?? date
            )
        }
        let data = try encoder.encode(record)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return try await MainActor.run { try record.snapshot }
    }

    func remove(routeID: UUID) async throws {
        let fileManager = FileManager.default
        let url = recordURL(for: routeID)
        guard fileManager.fileExists(atPath: url.path) else { return }
        try fileManager.removeItem(at: url)
    }

    func encodedSize(of route: TrailRoute, at date: Date = Date()) async throws -> Int {
        try await MainActor.run {
            try RouteEligibilityPolicy.validate(route, for: .persistence)
        }
        let record = await MainActor.run { PersistedRoute(route: route, createdAt: date, savedAt: date) }
        return try encoder.encode(record).count
    }

    private func decodeRecord(at url: URL) throws -> PersistedRoute {
        try decoder.decode(PersistedRoute.self, from: Data(contentsOf: url))
    }

    private func createDirectoryIfNeeded() throws {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    }

    private func recordURL(for id: UUID) -> URL {
        directoryURL.appendingPathComponent(id.uuidString).appendingPathExtension("json")
    }
}

actor InMemorySavedRouteStore: SavedRouteStore {
    private var snapshots: [UUID: SavedRouteSnapshot]
    var saveError: Error?
    var removeError: Error?

    init(snapshots: [SavedRouteSnapshot] = []) {
        self.snapshots = Dictionary(uniqueKeysWithValues: snapshots.map { ($0.id, $0) })
    }

    func load() async throws -> SavedRouteLoadResult {
        SavedRouteLoadResult(
            snapshots: snapshots.values.sorted { $0.savedAt > $1.savedAt },
            skippedRecordCount: 0
        )
    }

    func save(_ route: TrailRoute, at date: Date = Date()) async throws -> SavedRouteSnapshot {
        if let saveError { throw saveError }
        try await MainActor.run {
            try RouteEligibilityPolicy.validate(route, for: .persistence)
        }
        let existing = snapshots[route.id]
        let snapshot = SavedRouteSnapshot(
            route: route,
            savedAt: existing?.savedAt ?? date,
            createdAt: existing?.createdAt ?? date
        )
        snapshots[route.id] = snapshot
        return snapshot
    }

    func remove(routeID: UUID) async throws {
        if let removeError { throw removeError }
        snapshots.removeValue(forKey: routeID)
    }

    func setSaveError(_ error: Error?) { saveError = error }
    func setRemoveError(_ error: Error?) { removeError = error }
}

nonisolated private struct SchemaHeader: Decodable {
    let schemaVersion: Int
}

nonisolated private struct PersistedRoute: Codable {
    let schemaVersion: Int
    let savedAt: Date
    let createdAt: Date
    let id: UUID
    let provenance: PersistedRouteProvenance?
    let title: String
    let location: String
    let activity: String
    let distanceKilometers: Double
    let elevationGainMeters: Int
    let elevationLossMeters: Int?
    let durationHours: Double
    let difficulty: String
    let routeType: String
    let summary: String
    let whyItMatches: String
    let highlights: [PersistedHighlight]
    let waypoints: [PersistedWaypoint]
    let days: [PersistedRouteDay]
    let safetyNotes: [PersistedSafetyNote]
    let elevationProfile: [Double]
    let path: [PersistedPoint]
    let routeInstructions: [PersistedInstruction]
    let planningMetadata: PersistedPlanningMetadata?
    let verifiedCharacteristics: PersistedVerifiedCharacteristics?

    @MainActor init(route: TrailRoute, createdAt: Date, savedAt: Date) {
        schemaVersion = LocalSavedRouteStore.currentSchemaVersion
        self.savedAt = savedAt
        self.createdAt = createdAt
        id = route.id
        provenance = PersistedRouteProvenance(route.provenance)
        title = route.title
        location = route.location
        activity = route.activity.rawValue
        distanceKilometers = route.distanceKilometers
        elevationGainMeters = route.elevationGainMeters
        elevationLossMeters = route.elevationLossMeters
        durationHours = route.durationHours
        difficulty = route.difficulty.rawValue
        routeType = route.routeType.rawValue
        summary = route.summary
        whyItMatches = route.whyItMatches
        highlights = route.highlights.map(PersistedHighlight.init)
        waypoints = route.waypoints.map(PersistedWaypoint.init)
        days = route.days.map(PersistedRouteDay.init)
        safetyNotes = route.safetyNotes.map { PersistedSafetyNote($0) }
        elevationProfile = route.elevationProfile
        path = route.path.map(PersistedPoint.init)
        routeInstructions = route.routeInstructions.map(PersistedInstruction.init)
        planningMetadata = route.planningMetadata.map(PersistedPlanningMetadata.init)
        verifiedCharacteristics = route.verifiedCharacteristics.map(PersistedVerifiedCharacteristics.init)
    }

    @MainActor var snapshot: SavedRouteSnapshot {
        get throws {
            guard
                let activity = ActivityType(rawValue: activity),
                let difficulty = RouteDifficulty(rawValue: difficulty),
                let routeType = TrailRouteType(rawValue: routeType)
            else { throw PersistedRouteError.invalidEnumValue }

            let routeProvenance: RouteProvenance
            switch schemaVersion {
            case 1:
                routeProvenance = .unverified(.legacyRecord)
            case LocalSavedRouteStore.currentSchemaVersion:
                guard let provenance else {
                    throw PersistedRouteError.invalidProvenance
                }
                routeProvenance = try provenance.value
            default:
                throw PersistedRouteError.unsupportedSchema
            }

            let route = TrailRoute(
                id: id,
                provenance: routeProvenance,
                title: title,
                location: location,
                activity: activity,
                distanceKilometers: distanceKilometers,
                elevationGainMeters: elevationGainMeters,
                elevationLossMeters: elevationLossMeters,
                durationHours: durationHours,
                difficulty: difficulty,
                routeType: routeType,
                summary: summary,
                whyItMatches: whyItMatches,
                highlights: highlights.map(\.value),
                waypoints: try waypoints.map { try $0.value },
                days: days.map(\.value),
                safetyNotes: try safetyNotes.map { try $0.value },
                elevationProfile: elevationProfile,
                path: path.map(\.value),
                routeInstructions: routeInstructions.map(\.value),
                planningMetadata: try planningMetadata?.value,
                intentDebugMetadata: nil,
                verifiedCharacteristics: verifiedCharacteristics?.value
            )
            if schemaVersion == LocalSavedRouteStore.currentSchemaVersion {
                try RouteEligibilityPolicy.validate(route, for: .persistence)
            }
            return SavedRouteSnapshot(
                route: route,
                savedAt: savedAt,
                createdAt: createdAt
            )
        }
    }
}

nonisolated private enum PersistedRouteError: Error {
    case invalidEnumValue
    case invalidProvenance
    case unsupportedSchema
}

nonisolated private struct PersistedRouteProvenance: Codable {
    let kind: String
    let provider: String?
    let routingStrategy: String?
    let factFingerprint: String?
    let demoKind: String?
    let unverifiedReason: String?

    @MainActor init(_ value: RouteProvenance) {
        switch value {
        case let .routed(routed):
            kind = "routed"
            provider = routed.provider.rawValue
            routingStrategy = routed.strategy.rawValue
            factFingerprint = routed.factFingerprint.rawValue
            demoKind = nil
            unverifiedReason = nil
        case let .demo(demo):
            kind = "demo"
            provider = nil
            routingStrategy = nil
            factFingerprint = nil
            demoKind = demo.rawValue
            unverifiedReason = nil
        case let .unverified(reason):
            kind = "unverified"
            provider = nil
            routingStrategy = nil
            factFingerprint = nil
            demoKind = nil
            unverifiedReason = reason.rawValue
        }
    }

    @MainActor var value: RouteProvenance {
        get throws {
            switch kind {
            case "routed":
                guard
                    let provider,
                    let provider = RouteProviderIdentity(rawValue: provider),
                    let routingStrategy,
                    let routingStrategy = RouteRoutingStrategy(rawValue: routingStrategy),
                    let factFingerprint,
                    !factFingerprint.isEmpty,
                    demoKind == nil,
                    unverifiedReason == nil
                else { throw PersistedRouteError.invalidProvenance }
                return .routed(
                    RoutedRouteProvenance(
                        provider: provider,
                        strategy: routingStrategy,
                        factFingerprint: RouteFactFingerprint(rawValue: factFingerprint)
                    )
                )
            case "demo":
                guard
                    provider == nil,
                    routingStrategy == nil,
                    factFingerprint == nil,
                    let demoKind,
                    let demoKind = RouteDemoKind(rawValue: demoKind),
                    unverifiedReason == nil
                else { throw PersistedRouteError.invalidProvenance }
                return .demo(demoKind)
            case "unverified":
                guard
                    provider == nil,
                    routingStrategy == nil,
                    factFingerprint == nil,
                    demoKind == nil,
                    let unverifiedReason,
                    let unverifiedReason = UnverifiedRouteReason(rawValue: unverifiedReason)
                else { throw PersistedRouteError.invalidProvenance }
                return .unverified(unverifiedReason)
            default:
                throw PersistedRouteError.invalidProvenance
            }
        }
    }
}

nonisolated private struct PersistedPoint: Codable {
    let latitude: Double
    let longitude: Double
    let elevationMeters: Double?

    init(_ point: GeoPoint) {
        latitude = point.latitude
        longitude = point.longitude
        elevationMeters = point.elevationMeters
    }

    @MainActor var value: GeoPoint { GeoPoint(latitude: latitude, longitude: longitude, elevationMeters: elevationMeters) }
}

nonisolated private struct PersistedHighlight: Codable {
    let id: UUID
    let title: String
    let subtitle: String
    let symbol: String

    init(_ value: Highlight) { id = value.id; title = value.title; subtitle = value.subtitle; symbol = value.symbol }
    @MainActor var value: Highlight { Highlight(id: id, title: title, subtitle: subtitle, symbol: symbol) }
}

nonisolated private struct PersistedWaypoint: Codable {
    let id: UUID
    let name: String
    let detail: String
    let distanceKilometers: Double
    let kind: String
    let coordinate: PersistedPoint

    init(_ value: Waypoint) {
        id = value.id; name = value.name; detail = value.detail
        distanceKilometers = value.distanceKilometers; kind = value.kind.rawValue
        coordinate = PersistedPoint(value.coordinate)
    }

    @MainActor var value: Waypoint {
        get throws {
            guard let kind = WaypointKind(rawValue: kind) else { throw PersistedRouteError.invalidEnumValue }
            return Waypoint(id: id, name: name, detail: detail, distanceKilometers: distanceKilometers, kind: kind, coordinate: coordinate.value)
        }
    }
}

nonisolated private struct PersistedRouteDay: Codable {
    let id: UUID
    let dayNumber: Int
    let title: String
    let distanceKilometers: Double
    let elevationGainMeters: Int
    let durationHours: Double
    let summary: String

    init(_ value: RouteDay) {
        id = value.id; dayNumber = value.dayNumber; title = value.title
        distanceKilometers = value.distanceKilometers; elevationGainMeters = value.elevationGainMeters
        durationHours = value.durationHours; summary = value.summary
    }

    @MainActor var value: RouteDay {
        RouteDay(id: id, dayNumber: dayNumber, title: title, distanceKilometers: distanceKilometers, elevationGainMeters: elevationGainMeters, durationHours: durationHours, summary: summary)
    }
}

nonisolated private struct PersistedSafetyNote: Codable {
    let id: UUID
    let title: String
    let message: String
    let severity: String

    @MainActor init(_ value: SafetyNote) {
        id = value.id; title = value.title; message = value.message
        severity = value.severity == .caution ? "caution" : "info"
    }

    @MainActor var value: SafetyNote {
        get throws {
            let severity: SafetyNote.Severity
            switch self.severity {
            case "info": severity = .info
            case "caution": severity = .caution
            default: throw PersistedRouteError.invalidEnumValue
            }
            return SafetyNote(id: id, title: title, message: message, severity: severity)
        }
    }
}

nonisolated private struct PersistedInstruction: Codable {
    let id: UUID
    let text: String
    let streetName: String?
    let distanceMeters: Double
    let durationSeconds: Double
    let sign: Int
    let coordinate: PersistedPoint?

    init(_ value: RouteInstruction) {
        id = value.id; text = value.text; streetName = value.streetName
        distanceMeters = value.distanceMeters; durationSeconds = value.durationSeconds; sign = value.sign
        coordinate = value.coordinate.map(PersistedPoint.init)
    }

    @MainActor var value: RouteInstruction {
        RouteInstruction(id: id, text: text, streetName: streetName, distanceMeters: distanceMeters, durationSeconds: durationSeconds, sign: sign, coordinate: coordinate?.value)
    }
}

nonisolated private struct PersistedPlanningMetadata: Codable {
    let routeType: String
    let activityType: String
    let targetDistanceKm: Double?
    let targetDurationMinutes: Int?
    let difficulty: String?
    let desiredFeatures: [String]
    let avoidFeatures: [String]
    let seed: Int?
    let variantLabel: String?
    let loopRouteCount: Int?
    let isSingleLoop: Bool
    let appliedShaping: [String]
    let requestedOnlyShaping: [String]

    init(_ value: RoutePlanningMetadata) {
        routeType = value.routeType.rawValue; activityType = value.activityType.rawValue
        targetDistanceKm = value.targetDistanceKm; targetDurationMinutes = value.targetDurationMinutes
        difficulty = value.difficulty?.rawValue
        desiredFeatures = value.desiredFeatures.map(\.rawValue); avoidFeatures = value.avoidFeatures.map(\.rawValue)
        seed = value.seed; variantLabel = value.variantLabel
        switch value.loopSearchOutcome {
        case .comparison(let count): loopRouteCount = count; isSingleLoop = false
        case .singleRoute: loopRouteCount = nil; isSingleLoop = true
        case nil: loopRouteCount = nil; isSingleLoop = false
        }
        appliedShaping = value.routeShapingSummary?.applied.map(\.rawValue) ?? []
        requestedOnlyShaping = value.routeShapingSummary?.requestedOnly.map(\.rawValue) ?? []
    }

    @MainActor var value: RoutePlanningMetadata {
        get throws {
            guard let routeType = TrailRouteType(rawValue: routeType), let activityType = ActivityType(rawValue: activityType) else {
                throw PersistedRouteError.invalidEnumValue
            }
            let desired = desiredFeatures.compactMap(DesiredFeature.init(rawValue:))
            let avoided = avoidFeatures.compactMap(AvoidFeature.init(rawValue:))
            guard desired.count == desiredFeatures.count, avoided.count == avoidFeatures.count else { throw PersistedRouteError.invalidEnumValue }
            let applied = appliedShaping.compactMap(RouteShapingPreference.init(rawValue:))
            let requested = requestedOnlyShaping.compactMap(RouteShapingPreference.init(rawValue:))
            guard applied.count == appliedShaping.count, requested.count == requestedOnlyShaping.count else { throw PersistedRouteError.invalidEnumValue }
            let outcome: LoopSearchOutcome? = isSingleLoop ? .singleRoute : loopRouteCount.map { .comparison(routeCount: $0) }
            let shaping = applied.isEmpty && requested.isEmpty ? nil : RouteShapingSummary(applied: applied, requestedOnly: requested)
            return RoutePlanningMetadata(
                routeType: routeType,
                activityType: activityType,
                targetDistanceKm: targetDistanceKm,
                targetDurationMinutes: targetDurationMinutes,
                difficulty: try difficulty.map {
                    guard let value = RouteDifficulty(rawValue: $0) else { throw PersistedRouteError.invalidEnumValue }
                    return value
                },
                desiredFeatures: desired,
                avoidFeatures: avoided,
                seed: seed,
                variantLabel: variantLabel,
                loopSearchOutcome: outcome,
                routeShapingSummary: shaping
            )
        }
    }
}

nonisolated private struct PersistedCharacteristicValue: Codable {
    let value: String
    let distanceMeters: Double
    init(_ entry: VerifiedRouteCharacteristicValue) { value = entry.value; distanceMeters = entry.distanceMeters }
    @MainActor var model: VerifiedRouteCharacteristicValue { VerifiedRouteCharacteristicValue(value: value, distanceMeters: distanceMeters) }
}

nonisolated private struct PersistedVerifiedCharacteristics: Codable {
    let routeDistanceMeters: Double
    let surfaceBreakdown: [PersistedCharacteristicValue]
    let roadClassBreakdown: [PersistedCharacteristicValue]
    let hikeRatingBreakdown: [PersistedCharacteristicValue]
    let surfaceCoverageMeters: Double
    let roadClassCoverageMeters: Double
    let hikeRatingCoverageMeters: Double

    init(_ value: VerifiedRouteCharacteristics) {
        routeDistanceMeters = value.routeDistanceMeters
        surfaceBreakdown = value.surfaceBreakdown.map(PersistedCharacteristicValue.init)
        roadClassBreakdown = value.roadClassBreakdown.map(PersistedCharacteristicValue.init)
        hikeRatingBreakdown = value.hikeRatingBreakdown.map(PersistedCharacteristicValue.init)
        surfaceCoverageMeters = value.surfaceCoverageMeters
        roadClassCoverageMeters = value.roadClassCoverageMeters
        hikeRatingCoverageMeters = value.hikeRatingCoverageMeters
    }

    @MainActor var value: VerifiedRouteCharacteristics {
        VerifiedRouteCharacteristics(
            routeDistanceMeters: routeDistanceMeters,
            surfaceBreakdown: surfaceBreakdown.map(\.model),
            roadClassBreakdown: roadClassBreakdown.map(\.model),
            hikeRatingBreakdown: hikeRatingBreakdown.map(\.model),
            surfaceCoverageMeters: surfaceCoverageMeters,
            roadClassCoverageMeters: roadClassCoverageMeters,
            hikeRatingCoverageMeters: hikeRatingCoverageMeters
        )
    }
}
