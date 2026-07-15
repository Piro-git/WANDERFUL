import Foundation
import Observation

enum SavedRoutesLoadState: Equatable {
    case idle
    case loading
    case loaded
    case unavailable
}

enum SavedRoutesContentState: Equatable {
    case loading
    case empty
    case populated
    case unavailable
}

enum SavedRoutesFailureKind: String, Equatable, Sendable {
    case load
    case save
    case remove
    case removeAll
    case recoveryCleanup
}

struct SavedRoutesFailure: Identifiable, Equatable, Sendable {
    let kind: SavedRoutesFailureKind
    let message: String

    var id: String { kind.rawValue }

    var title: String {
        switch kind {
        case .load: "Saved Routes Unavailable"
        case .save: "Route Not Saved"
        case .remove: "Route Not Removed"
        case .removeAll: "Saved Routes Not Cleared"
        case .recoveryCleanup: "Cleanup Not Completed"
        }
    }
}

@MainActor
@Observable
final class SavedRoutesModel {
    static let recentRouteLimit = 3

    private let store: any SavedRouteStore
    private var snapshotsByID: [UUID: SavedRouteSnapshot] = [:]
    private var hasLoaded = false
    private var operationWaiters: [CheckedContinuation<Void, Never>] = []

    private(set) var snapshots: [SavedRouteSnapshot] = []
    private(set) var pendingRouteIDs: Set<UUID> = []
    private(set) var loadState: SavedRoutesLoadState = .idle
    private(set) var recoveryReport: SavedRouteRecoveryReport = .none
    private(set) var failure: SavedRoutesFailure?
    private(set) var isRecoveryCleanupInventoryCurrent = false
    private(set) var isBulkActionPendingOrActive = false
    private(set) var isPerformingBulkAction = false
    private(set) var isPerformingAnyOperation = false

    var routes: [TrailRoute] { snapshots.map(\.route) }

    /// Real, persisted records ordered by the most recent successful save/update.
    /// No placeholder is returned when persistence is empty.
    var recentSnapshots: [SavedRouteSnapshot] {
        Array(snapshots.prefix(Self.recentRouteLimit))
    }

    var canDiscardUnusableRecords: Bool {
        isRecoveryCleanupInventoryCurrent && recoveryReport.unusableRecordCount > 0
    }

    var contentState: SavedRoutesContentState {
        switch loadState {
        case .idle, .loading:
            return .loading
        case .loaded:
            return snapshots.isEmpty ? .empty : .populated
        case .unavailable:
            return .unavailable
        }
    }

    var loadNotice: String? {
        guard recoveryReport.hasNotice else { return nil }
        guard isRecoveryCleanupInventoryCurrent else {
            return "Saved route recovery details require a successful reload before cleanup."
        }

        let recoveredCount = recoveryReport.recoveredLegacyRecordCount
        let unusableCount = recoveryReport.unusableRecordCount
        switch (recoveredCount, unusableCount) {
        case (0, 1):
            return "One unusable saved-route record was kept aside. Your other routes are still available."
        case (0, _):
            return "Some unusable saved-route records were kept aside. Your other routes are still available."
        case (1, 0):
            return "One older saved route was recovered as unverified. Review it before relying on its details."
        case (_, 0):
            return "Some older saved routes were recovered as unverified. Review them before relying on their details."
        case (1, 1):
            return "One older route was recovered as unverified, and one unusable record was kept aside."
        default:
            return "Older routes were recovered as unverified, and unusable records were kept aside."
        }
    }

    var errorMessage: String? { failure?.message }

    init(store: any SavedRouteStore = LocalSavedRouteStore.applicationStore()) {
        self.store = store
    }

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        loadState = .loading
        if failure?.kind == .load {
            failure = nil
        }

        await withSerializedOperation {
            await loadFromStore()
        }
    }

    func retryLoad() async {
        await withSerializedOperation {
            hasLoaded = true
            loadState = .loading
            failure = nil
            await loadFromStore()
        }
    }

    func isSaved(_ route: TrailRoute) -> Bool {
        snapshotsByID[route.id] != nil
    }

    func toggle(_ route: TrailRoute) async {
        guard
            !pendingRouteIDs.contains(route.id),
            !isBulkActionPendingOrActive
        else { return }
        pendingRouteIDs.insert(route.id)
        defer { pendingRouteIDs.remove(route.id) }

        await withSerializedOperation {
            if isSaved(route) {
                await removeFromStore(routeID: route.id)
            } else {
                await saveToStore(route)
            }
        }
    }

    func save(_ route: TrailRoute) async {
        guard
            !pendingRouteIDs.contains(route.id),
            !isBulkActionPendingOrActive
        else { return }
        pendingRouteIDs.insert(route.id)
        defer { pendingRouteIDs.remove(route.id) }

        await withSerializedOperation {
            await saveToStore(route)
        }
    }

    func remove(routeID: UUID) async {
        guard
            !pendingRouteIDs.contains(routeID),
            snapshotsByID[routeID] != nil,
            !isBulkActionPendingOrActive
        else { return }
        pendingRouteIDs.insert(routeID)
        defer { pendingRouteIDs.remove(routeID) }

        await withSerializedOperation {
            await removeFromStore(routeID: routeID)
        }
    }

    func removeAll() async {
        guard !isBulkActionPendingOrActive else { return }
        isBulkActionPendingOrActive = true
        defer { isBulkActionPendingOrActive = false }

        await withSerializedOperation {
            isPerformingBulkAction = true
            defer { isPerformingBulkAction = false }
            do {
                try await store.removeAll()
                snapshotsByID = [:]
                recoveryReport = .none
                isRecoveryCleanupInventoryCurrent = true
                loadState = .loaded
                hasLoaded = true
                failure = nil
                refreshSnapshots()
            } catch {
                failure = SavedRoutesFailure(
                    kind: .removeAll,
                    message: "Saved routes could not be cleared. Existing records were not hidden from this screen."
                )
            }
        }
    }

    func discardUnusableRecords() async {
        guard
            canDiscardUnusableRecords,
            !isBulkActionPendingOrActive
        else { return }
        isBulkActionPendingOrActive = true
        defer { isBulkActionPendingOrActive = false }

        await withSerializedOperation {
            guard canDiscardUnusableRecords else { return }
            isPerformingBulkAction = true
            defer { isPerformingBulkAction = false }
            do {
                try await store.discardUnusableRecords()
                recoveryReport = recoveryReport.removingUnusableRecords
                isRecoveryCleanupInventoryCurrent = true
                failure = nil
            } catch {
                await reloadAfterCleanupFailure()
            }
        }
    }

    func clearError() { failure = nil }

    private func loadFromStore() async {
        do {
            let result = try await store.load()
            applyLoadResult(result)
            failure = nil
        } catch {
            hasLoaded = false
            loadState = .unavailable
            isRecoveryCleanupInventoryCurrent = false
            failure = SavedRoutesFailure(
                kind: .load,
                message: "Your saved route data could not be read. No saved data was replaced. Try again or reset Saved after confirmation."
            )
        }
    }

    private func reloadAfterCleanupFailure() async {
        do {
            let result = try await store.load()
            applyLoadResult(result)
            failure = SavedRoutesFailure(
                kind: .recoveryCleanup,
                message: "Some unusable saved-route records could not be removed. The remaining records are shown accurately."
            )
        } catch {
            hasLoaded = false
            loadState = .unavailable
            isRecoveryCleanupInventoryCurrent = false
            failure = SavedRoutesFailure(
                kind: .recoveryCleanup,
                message: "Cleanup did not finish, and saved route data could not be reloaded. Try loading Saved again before cleanup."
            )
        }
    }

    private func applyLoadResult(_ result: SavedRouteLoadResult) {
        snapshotsByID = Dictionary(uniqueKeysWithValues: result.snapshots.map { ($0.id, $0) })
        recoveryReport = result.recoveryReport
        isRecoveryCleanupInventoryCurrent = true
        hasLoaded = true
        loadState = .loaded
        refreshSnapshots()
    }

    private func saveToStore(_ route: TrailRoute) async {
        do {
            let snapshot = try await store.save(route, at: Date())
            snapshotsByID[route.id] = snapshot
            failure = nil
            refreshSnapshots()
        } catch is RouteEligibilityError {
            failure = SavedRoutesFailure(
                kind: .save,
                message: "Only a current, verified routing result can be saved."
            )
        } catch {
            failure = SavedRoutesFailure(
                kind: .save,
                message: "This route could not be saved. Check available storage and try again."
            )
        }
    }

    private func removeFromStore(routeID: UUID) async {
        guard let removedSnapshot = snapshotsByID[routeID] else { return }
        do {
            try await store.remove(routeID: routeID)
            snapshotsByID.removeValue(forKey: routeID)
            if removedSnapshot.route.provenance == .unverified(.legacyRecord) {
                recoveryReport = recoveryReport.removingRecoveredLegacyRecord
            }
            failure = nil
            refreshSnapshots()
        } catch {
            failure = SavedRoutesFailure(
                kind: .remove,
                message: "This route could not be removed. Your saved copy is still available."
            )
        }
    }

    private func refreshSnapshots() {
        snapshots = snapshotsByID.values.sorted(by: SavedRouteSnapshot.newestFirst)
    }

    private func withSerializedOperation(_ operation: () async -> Void) async {
        await beginSerializedOperation()
        defer { finishSerializedOperation() }
        await operation()
    }

    private func beginSerializedOperation() async {
        guard isPerformingAnyOperation else {
            isPerformingAnyOperation = true
            return
        }
        await withCheckedContinuation { continuation in
            operationWaiters.append(continuation)
        }
    }

    private func finishSerializedOperation() {
        guard !operationWaiters.isEmpty else {
            isPerformingAnyOperation = false
            return
        }
        operationWaiters.removeFirst().resume()
    }
}
