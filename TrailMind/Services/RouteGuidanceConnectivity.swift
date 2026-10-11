import Foundation
import Network
import Observation

/// Reachability is an indication only; a satisfied path does not prove map-server access.
@MainActor
@Observable
final class RouteGuidanceConnectivity {
    enum Status: Equatable { case checking, available, unavailable }
    private(set) var status: Status = .checking
    @ObservationIgnored private var monitor: NWPathMonitor?
    @ObservationIgnored private var generation = UUID()

    func start() {
        guard monitor == nil else { return }
        let token = UUID()
        generation = token
        let monitor = NWPathMonitor()
        self.monitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard self?.generation == token else { return }
                self?.status = available ? .available : .unavailable
            }
        }
        monitor.start(queue: DispatchQueue(label: "com.wanderful.guidance.connectivity"))
    }

    func stop() {
        generation = UUID()
        monitor?.cancel()
        monitor = nil
        status = .checking
    }
}

/// A saved ID alone does not establish that the current geometry/instructions survived disk reload.
@MainActor
struct RouteOfflineReadiness {
    static func hasMatchingRoute(_ route: TrailRoute, in snapshots: [SavedRouteSnapshot]) -> Bool {
        snapshots.contains {
            $0.id == route.id && RouteGuidanceEligibility(route: $0.route).isEligible
                && $0.route.path == route.path
                && $0.route.routeInstructions == route.routeInstructions
                && $0.route.distanceKilometers == route.distanceKilometers
                && $0.route.durationHours == route.durationHours
        }
    }
}
