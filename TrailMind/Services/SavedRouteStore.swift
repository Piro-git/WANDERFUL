import Foundation

// Route models are immutable value snapshots. Persistence transfers them across
// the store actor without sharing mutable state.
extension TrailRoute: @unchecked Sendable { }

struct SavedRouteSnapshot: Identifiable, Hashable, Sendable {
    let route: TrailRoute
    let savedAt: Date
    let createdAt: Date

    var id: UUID { route.id }

    static func newestFirst(_ lhs: SavedRouteSnapshot, _ rhs: SavedRouteSnapshot) -> Bool {
        if lhs.savedAt == rhs.savedAt {
            return lhs.id.uuidString < rhs.id.uuidString
        }
        return lhs.savedAt > rhs.savedAt
    }
}

nonisolated struct SavedRouteRecoveryReport: Equatable, Sendable {
    static let none = SavedRouteRecoveryReport()

    let recoveredLegacyRecordCount: Int
    let corruptRecordCount: Int
    let invalidRecordCount: Int
    let unsupportedSchemaRecordCount: Int

    init(
        recoveredLegacyRecordCount: Int = 0,
        corruptRecordCount: Int = 0,
        invalidRecordCount: Int = 0,
        unsupportedSchemaRecordCount: Int = 0
    ) {
        self.recoveredLegacyRecordCount = recoveredLegacyRecordCount
        self.corruptRecordCount = corruptRecordCount
        self.invalidRecordCount = invalidRecordCount
        self.unsupportedSchemaRecordCount = unsupportedSchemaRecordCount
    }

    var unusableRecordCount: Int {
        corruptRecordCount + invalidRecordCount + unsupportedSchemaRecordCount
    }

    var hasNotice: Bool {
        recoveredLegacyRecordCount > 0 || unusableRecordCount > 0
    }

    var removingUnusableRecords: SavedRouteRecoveryReport {
        SavedRouteRecoveryReport(recoveredLegacyRecordCount: recoveredLegacyRecordCount)
    }

    var removingRecoveredLegacyRecord: SavedRouteRecoveryReport {
        SavedRouteRecoveryReport(
            recoveredLegacyRecordCount: max(0, recoveredLegacyRecordCount - 1),
            corruptRecordCount: corruptRecordCount,
            invalidRecordCount: invalidRecordCount,
            unsupportedSchemaRecordCount: unsupportedSchemaRecordCount
        )
    }
}

nonisolated struct SavedRouteLoadResult: Sendable {
    let snapshots: [SavedRouteSnapshot]
    let recoveryReport: SavedRouteRecoveryReport

    var skippedRecordCount: Int { recoveryReport.unusableRecordCount }
}

nonisolated enum SavedRouteStoreError: LocalizedError, Equatable, Sendable {
    case unreadableStore
    case writeFailed
    case deleteFailed
    case deleteAllFailed
    case recoveryCleanupUnavailable
    case recoveryCleanupFailed

    var errorDescription: String? {
        switch self {
        case .unreadableStore:
            "Saved route data could not be read. No saved data was replaced."
        case .writeFailed:
            "The saved route data could not be written."
        case .deleteFailed:
            "The saved route could not be removed."
        case .deleteAllFailed:
            "Saved route data could not be cleared."
        case .recoveryCleanupUnavailable:
            "Saved route cleanup requires a successful reload first."
        case .recoveryCleanupFailed:
            "Unusable saved route data could not be removed."
        }
    }
}

nonisolated protocol SavedRouteRecordWriting: Sendable {
    func writeAtomically(_ data: Data, to url: URL) throws
}

nonisolated struct AtomicSavedRouteRecordWriter: SavedRouteRecordWriting {
    func writeAtomically(_ data: Data, to url: URL) throws {
        try data.write(
            to: url,
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
    }
}

nonisolated protocol SavedRouteRecordReading: Sendable {
    func read(from url: URL) throws -> Data
}

nonisolated struct FileSavedRouteRecordReader: SavedRouteRecordReading {
    func read(from url: URL) throws -> Data {
        try Data(contentsOf: url)
    }
}

nonisolated protocol SavedRouteRecordRemoving: Sendable {
    func remove(at url: URL) throws
}

nonisolated struct FileSavedRouteRecordRemover: SavedRouteRecordRemoving {
    func remove(at url: URL) throws {
        try FileManager.default.removeItem(at: url)
    }
}

protocol SavedRouteStore: Sendable {
    func load() async throws -> SavedRouteLoadResult
    func save(_ route: TrailRoute, at date: Date) async throws -> SavedRouteSnapshot
    func remove(routeID: UUID) async throws
    func removeAll() async throws
    func discardUnusableRecords() async throws
}

actor LocalSavedRouteStore: SavedRouteStore {
    nonisolated static let currentSchemaVersion = 2
    nonisolated private static let supportedSchemaVersions = 1...currentSchemaVersion

    private let directoryURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let recordReader: any SavedRouteRecordReading
    private let recordRemover: any SavedRouteRecordRemoving
    private let recordWriter: any SavedRouteRecordWriting
    private let excludesFromBackup: Bool
    private var unusableRecordURLs: Set<URL> = []
    private var hasCurrentCleanupInventory = false
    private var isOperationInProgress = false
    private var operationWaiters: [CheckedContinuation<Void, Never>] = []

    static func applicationStore() -> LocalSavedRouteStore {
        let baseURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return LocalSavedRouteStore(
            directoryURL: baseURL.appendingPathComponent("SavedRoutes", isDirectory: true),
            excludesFromBackup: true
        )
    }

    init(
        directoryURL: URL,
        recordReader: any SavedRouteRecordReading = FileSavedRouteRecordReader(),
        recordRemover: any SavedRouteRecordRemoving = FileSavedRouteRecordRemover(),
        recordWriter: any SavedRouteRecordWriting = AtomicSavedRouteRecordWriter(),
        excludesFromBackup: Bool = false
    ) {
        self.directoryURL = directoryURL
        self.recordReader = recordReader
        self.recordRemover = recordRemover
        self.recordWriter = recordWriter
        self.excludesFromBackup = excludesFromBackup
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(SavedRouteDateCoding.string(from: date))
        }
        encoder.outputFormatting = [.sortedKeys]
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            guard let date = SavedRouteDateCoding.date(from: value) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Invalid saved-route timestamp."
                )
            }
            return date
        }
    }

    func load() async throws -> SavedRouteLoadResult {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }
        hasCurrentCleanupInventory = false

        let fileManager = FileManager.default
        let urls: [URL]
        do {
            try createDirectoryIfNeeded()
            urls = try fileManager.contentsOfDirectory(
                at: directoryURL,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            )
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        } catch {
            unusableRecordURLs = []
            throw SavedRouteStoreError.unreadableStore
        }

        var snapshots: [SavedRouteSnapshot] = []
        var recoveredLegacyRecordCount = 0
        var corruptRecordCount = 0
        var invalidRecordCount = 0
        var unsupportedSchemaRecordCount = 0
        var recoveredUnusableURLs: Set<URL> = []
        for url in urls {
            do {
                let loadedRecord = try await loadRecord(at: url)
                snapshots.append(loadedRecord.snapshot)
                if loadedRecord.wasMigratedFromLegacySchema {
                    recoveredLegacyRecordCount += 1
                }
            } catch let error as SavedRouteRecordLoadError {
                switch error {
                case .unreadable:
                    unusableRecordURLs = []
                    throw SavedRouteStoreError.unreadableStore
                case .corrupt:
                    recoveredUnusableURLs.insert(url)
                    corruptRecordCount += 1
                case .invalid:
                    recoveredUnusableURLs.insert(url)
                    invalidRecordCount += 1
                case .unsupportedSchema:
                    recoveredUnusableURLs.insert(url)
                    unsupportedSchemaRecordCount += 1
                }
            } catch {
                unusableRecordURLs = []
                throw SavedRouteStoreError.unreadableStore
            }
        }
        unusableRecordURLs = recoveredUnusableURLs
        hasCurrentCleanupInventory = true

        let sortedSnapshots = await MainActor.run {
            snapshots.sorted(by: SavedRouteSnapshot.newestFirst)
        }
        return SavedRouteLoadResult(
            snapshots: sortedSnapshots,
            recoveryReport: SavedRouteRecoveryReport(
                recoveredLegacyRecordCount: recoveredLegacyRecordCount,
                corruptRecordCount: corruptRecordCount,
                invalidRecordCount: invalidRecordCount,
                unsupportedSchemaRecordCount: unsupportedSchemaRecordCount
            )
        )
    }

    func save(_ route: TrailRoute, at date: Date = Date()) async throws -> SavedRouteSnapshot {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }

        try await MainActor.run {
            try RouteEligibilityPolicy.validate(route, for: .persistence)
        }
        do {
            try createDirectoryIfNeeded()
        } catch {
            throw SavedRouteStoreError.writeFailed
        }
        let url = recordURL(for: route.id)
        let existing: PersistedRoute?
        if FileManager.default.fileExists(atPath: url.path) {
            do {
                let record = try decodeSupportedRecord(at: url)
                guard record.schemaVersion == Self.currentSchemaVersion else {
                    throw PersistedRouteError.unsupportedSchema
                }
                _ = try await MainActor.run { try record.snapshot }
                existing = record
            } catch {
                throw SavedRouteStoreError.writeFailed
            }
        } else {
            existing = nil
        }
        let record = await MainActor.run {
            PersistedRoute(
                route: route,
                createdAt: existing?.createdAt ?? date,
                savedAt: date
            )
        }
        do {
            let data = try encoder.encode(record)
            try recordWriter.writeAtomically(data, to: url)
        } catch {
            throw SavedRouteStoreError.writeFailed
        }
        unusableRecordURLs.remove(url)
        return SavedRouteSnapshot(
            route: route,
            savedAt: date,
            createdAt: existing?.createdAt ?? date
        )
    }

    func remove(routeID: UUID) async throws {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }

        let fileManager = FileManager.default
        let url = recordURL(for: routeID)
        guard fileManager.fileExists(atPath: url.path) else { return }
        do {
            try fileManager.removeItem(at: url)
            unusableRecordURLs.remove(url)
        } catch {
            throw SavedRouteStoreError.deleteFailed
        }
    }

    func removeAll() async throws {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }

        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: directoryURL.path) else {
            unusableRecordURLs = []
            hasCurrentCleanupInventory = true
            return
        }
        do {
            try fileManager.removeItem(at: directoryURL)
            unusableRecordURLs = []
            hasCurrentCleanupInventory = true
        } catch {
            throw SavedRouteStoreError.deleteAllFailed
        }
    }

    func discardUnusableRecords() async throws {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }

        guard hasCurrentCleanupInventory else {
            throw SavedRouteStoreError.recoveryCleanupUnavailable
        }

        let fileManager = FileManager.default
        for url in unusableRecordURLs.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard fileManager.fileExists(atPath: url.path) else {
                unusableRecordURLs.remove(url)
                continue
            }
            do {
                try recordRemover.remove(at: url)
                unusableRecordURLs.remove(url)
            } catch {
                throw SavedRouteStoreError.recoveryCleanupFailed
            }
        }
    }

    func encodedSize(of route: TrailRoute, at date: Date = Date()) async throws -> Int {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }

        try await MainActor.run {
            try RouteEligibilityPolicy.validate(route, for: .persistence)
        }
        let record = await MainActor.run { PersistedRoute(route: route, createdAt: date, savedAt: date) }
        return try encoder.encode(record).count
    }

    private func loadRecord(at url: URL) async throws -> LoadedSavedRouteRecord {
        let data: Data
        let header: SchemaHeader
        let record: PersistedRoute
        do {
            data = try recordReader.read(from: url)
        } catch {
            throw SavedRouteRecordLoadError.unreadable
        }
        do {
            header = try decoder.decode(SchemaHeader.self, from: data)
        } catch {
            throw SavedRouteRecordLoadError.corrupt
        }
        guard Self.supportedSchemaVersions.contains(header.schemaVersion) else {
            throw SavedRouteRecordLoadError.unsupportedSchema
        }
        do {
            record = try decoder.decode(PersistedRoute.self, from: data)
        } catch {
            throw SavedRouteRecordLoadError.corrupt
        }
        let snapshot: SavedRouteSnapshot
        do {
            snapshot = try await MainActor.run { try record.snapshot }
        } catch {
            throw SavedRouteRecordLoadError.invalid
        }
        let filenameMatchesIdentity = await MainActor.run {
            url.deletingPathExtension().lastPathComponent.caseInsensitiveCompare(snapshot.id.uuidString) == .orderedSame
        }
        guard filenameMatchesIdentity else {
            throw SavedRouteRecordLoadError.invalid
        }
        return LoadedSavedRouteRecord(
            snapshot: snapshot,
            wasMigratedFromLegacySchema: header.schemaVersion == 1
        )
    }

    private func decodeSupportedRecord(at url: URL) throws -> PersistedRoute {
        let data = try recordReader.read(from: url)
        let header = try decoder.decode(SchemaHeader.self, from: data)
        guard Self.supportedSchemaVersions.contains(header.schemaVersion) else {
            throw PersistedRouteError.unsupportedSchema
        }
        return try decoder.decode(PersistedRoute.self, from: data)
    }

    private func createDirectoryIfNeeded() throws {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        if excludesFromBackup {
            var resourceValues = URLResourceValues()
            resourceValues.isExcludedFromBackup = true
            var mutableDirectoryURL = directoryURL
            try mutableDirectoryURL.setResourceValues(resourceValues)
        }
    }

    private func recordURL(for id: UUID) -> URL {
        directoryURL.appendingPathComponent(id.uuidString).appendingPathExtension("json")
    }

    private func beginSerializedOperation() async {
        guard isOperationInProgress else {
            isOperationInProgress = true
            return
        }
        await withCheckedContinuation { continuation in
            operationWaiters.append(continuation)
        }
    }

    private func finishSerializedOperation() {
        guard !operationWaiters.isEmpty else {
            isOperationInProgress = false
            return
        }
        operationWaiters.removeFirst().resume()
    }
}

actor InMemorySavedRouteStore: SavedRouteStore {
    private var snapshots: [UUID: SavedRouteSnapshot]
    private var recoveryReport: SavedRouteRecoveryReport
    var loadError: Error?
    var saveError: Error?
    var removeError: Error?
    var removeAllError: Error?
    var recoveryCleanupError: Error?
    private var hasCurrentCleanupInventory = false
    private var isOperationInProgress = false
    private var operationWaiters: [CheckedContinuation<Void, Never>] = []

    init(
        snapshots: [SavedRouteSnapshot] = [],
        recoveryReport: SavedRouteRecoveryReport = .none
    ) {
        self.snapshots = Dictionary(uniqueKeysWithValues: snapshots.map { ($0.id, $0) })
        self.recoveryReport = recoveryReport
    }

    func load() async throws -> SavedRouteLoadResult {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }

        if let loadError {
            hasCurrentCleanupInventory = false
            throw loadError
        }
        let unsortedSnapshots = Array(snapshots.values)
        let sortedSnapshots = await MainActor.run {
            unsortedSnapshots.sorted(by: SavedRouteSnapshot.newestFirst)
        }
        hasCurrentCleanupInventory = true
        return SavedRouteLoadResult(
            snapshots: sortedSnapshots,
            recoveryReport: recoveryReport
        )
    }

    func save(_ route: TrailRoute, at date: Date = Date()) async throws -> SavedRouteSnapshot {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }

        try await MainActor.run {
            try RouteEligibilityPolicy.validate(route, for: .persistence)
        }
        if let saveError { throw saveError }
        let existing = snapshots[route.id]
        let snapshot = SavedRouteSnapshot(
            route: route,
            savedAt: date,
            createdAt: existing?.createdAt ?? date
        )
        snapshots[route.id] = snapshot
        return snapshot
    }

    func remove(routeID: UUID) async throws {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }

        if let removeError { throw removeError }
        snapshots.removeValue(forKey: routeID)
    }

    func removeAll() async throws {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }

        if let removeAllError { throw removeAllError }
        snapshots = [:]
        recoveryReport = .none
        hasCurrentCleanupInventory = true
    }

    func discardUnusableRecords() async throws {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }

        guard hasCurrentCleanupInventory else {
            throw SavedRouteStoreError.recoveryCleanupUnavailable
        }
        if let recoveryCleanupError { throw recoveryCleanupError }
        recoveryReport = recoveryReport.removingUnusableRecords
    }

    func setLoadError(_ error: Error?) { loadError = error }
    func setSaveError(_ error: Error?) { saveError = error }
    func setRemoveError(_ error: Error?) { removeError = error }
    func setRemoveAllError(_ error: Error?) { removeAllError = error }
    func setRecoveryCleanupError(_ error: Error?) { recoveryCleanupError = error }

    private func beginSerializedOperation() async {
        guard isOperationInProgress else {
            isOperationInProgress = true
            return
        }
        await withCheckedContinuation { continuation in
            operationWaiters.append(continuation)
        }
    }

    private func finishSerializedOperation() {
        guard !operationWaiters.isEmpty else {
            isOperationInProgress = false
            return
        }
        operationWaiters.removeFirst().resume()
    }
}

nonisolated private struct LoadedSavedRouteRecord: Sendable {
    let snapshot: SavedRouteSnapshot
    let wasMigratedFromLegacySchema: Bool
}

nonisolated private enum SavedRouteRecordLoadError: Error {
    case unreadable
    case corrupt
    case invalid
    case unsupportedSchema
}

nonisolated private struct SchemaHeader: Decodable {
    let schemaVersion: Int
}

nonisolated private enum SavedRouteDateCoding {
    static func string(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }

    static func date(from value: String) -> Date? {
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractionalFormatter.date(from: value) {
            return date
        }

        let legacyFormatter = ISO8601DateFormatter()
        legacyFormatter.formatOptions = [.withInternetDateTime]
        return legacyFormatter.date(from: value)
    }
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
            try PersistedRouteValidator.validate(route)
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
    case invalidRecord
    case invalidProvenance
    case unsupportedSchema
}

private enum PersistedRouteValidator {
    static func validate(_ route: TrailRoute) throws {
        guard
            route.distanceKilometers.isFinite,
            route.distanceKilometers > 0,
            route.durationHours.isFinite,
            route.durationHours > 0,
            route.elevationGainMeters >= 0,
            route.elevationLossMeters.map({ $0 >= 0 }) ?? true,
            route.elevationProfile.allSatisfy(\.isFinite),
            hasValidGeometry(route.path),
            route.waypoints.allSatisfy({ waypoint in
                waypoint.distanceKilometers.isFinite &&
                    waypoint.distanceKilometers >= 0 &&
                    isValid(waypoint.coordinate)
            }),
            route.days.allSatisfy({ day in
                day.distanceKilometers.isFinite &&
                    day.distanceKilometers >= 0 &&
                    day.elevationGainMeters >= 0 &&
                    day.durationHours.isFinite &&
                    day.durationHours >= 0
            }),
            route.routeInstructions.allSatisfy({ instruction in
                instruction.distanceMeters.isFinite &&
                    instruction.distanceMeters >= 0 &&
                    instruction.durationSeconds.isFinite &&
                    instruction.durationSeconds >= 0 &&
                    instruction.coordinate.map(isValid) ?? true
            })
        else { throw PersistedRouteError.invalidRecord }
    }

    private static func hasValidGeometry(_ path: [GeoPoint]) -> Bool {
        guard path.count >= 2, path.allSatisfy(isValid) else { return false }
        let first = path[0]
        return path.dropFirst().contains { point in
            point.latitude != first.latitude || point.longitude != first.longitude
        }
    }

    private static func isValid(_ point: GeoPoint) -> Bool {
        point.latitude.isFinite &&
            point.longitude.isFinite &&
            (-90...90).contains(point.latitude) &&
            (-180...180).contains(point.longitude) &&
            (point.elevationMeters?.isFinite ?? true)
    }
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
