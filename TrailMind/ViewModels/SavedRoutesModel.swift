import Foundation
import Observation

@MainActor
@Observable
final class SavedRoutesModel {
    private let store: any SavedRouteStore
    private var snapshotsByID: [UUID: SavedRouteSnapshot] = [:]
    private var hasLoaded = false

    private(set) var snapshots: [SavedRouteSnapshot] = []
    private(set) var pendingRouteIDs: Set<UUID> = []
    private(set) var errorMessage: String?
    private(set) var loadNotice: String?

    var routes: [TrailRoute] { snapshots.map(\.route) }

    init(store: any SavedRouteStore = LocalSavedRouteStore.applicationStore()) {
        self.store = store
    }

    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        do {
            let result = try await store.load()
            snapshotsByID = Dictionary(uniqueKeysWithValues: result.snapshots.map { ($0.id, $0) })
            refreshSnapshots()
            if result.skippedRecordCount > 0 {
                loadNotice = result.skippedRecordCount == 1
                    ? "One saved route could not be restored. Your other routes are still available."
                    : "Some saved routes could not be restored. Your other routes are still available."
            }
        } catch {
            hasLoaded = false
            errorMessage = "Saved routes could not be loaded. Try again."
        }
    }

    func retryLoad() async {
        hasLoaded = false
        errorMessage = nil
        await loadIfNeeded()
    }

    func isSaved(_ route: TrailRoute) -> Bool {
        snapshotsByID[route.id] != nil
    }

    func toggle(_ route: TrailRoute) async {
        guard !pendingRouteIDs.contains(route.id) else { return }
        if isSaved(route) {
            await remove(routeID: route.id)
        } else {
            await save(route)
        }
    }

    func save(_ route: TrailRoute) async {
        guard !pendingRouteIDs.contains(route.id) else { return }
        pendingRouteIDs.insert(route.id)
        defer { pendingRouteIDs.remove(route.id) }
        do {
            let snapshot = try await store.save(route, at: Date())
            snapshotsByID[route.id] = snapshot
            errorMessage = nil
            refreshSnapshots()
        } catch {
            errorMessage = "This route could not be saved. Check available storage and try again."
        }
    }

    func remove(routeID: UUID) async {
        guard !pendingRouteIDs.contains(routeID), snapshotsByID[routeID] != nil else { return }
        pendingRouteIDs.insert(routeID)
        defer { pendingRouteIDs.remove(routeID) }
        do {
            try await store.remove(routeID: routeID)
            snapshotsByID.removeValue(forKey: routeID)
            errorMessage = nil
            refreshSnapshots()
        } catch {
            errorMessage = "This route could not be removed. Try again."
        }
    }

    func clearError() { errorMessage = nil }
    func clearLoadNotice() { loadNotice = nil }

    private func refreshSnapshots() {
        snapshots = snapshotsByID.values.sorted { lhs, rhs in
            if lhs.savedAt == rhs.savedAt { return lhs.id.uuidString < rhs.id.uuidString }
            return lhs.savedAt > rhs.savedAt
        }
    }
}
