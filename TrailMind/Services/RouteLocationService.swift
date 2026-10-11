import CoreLocation
import SwiftUI
import UIKit

enum RouteLocationAuthorization: Equatable, Sendable {
    case notDetermined
    case authorized
    case reducedAccuracy
    case denied
    case restricted
    case servicesDisabled
}

enum RouteLocationServiceError: LocalizedError, Equatable, Sendable {
    case permissionDenied
    case permissionRestricted
    case preciseLocationRequired
    case servicesDisabled
    case unavailable
    case backgroundModeUnavailable

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            "Location permission is off for Wanderful."
        case .permissionRestricted:
            "Location access is restricted on this device."
        case .preciseLocationRequired:
            "Precise Location is required to compare your position with the mapped route."
        case .servicesDisabled:
            "Location Services are turned off on this device."
        case .unavailable:
            "Your location is temporarily unavailable."
        case .backgroundModeUnavailable:
            "Background guidance is unavailable in this build. Location updates were not started."
        }
    }
}

@MainActor
protocol RouteLocationProviding: AnyObject {
    var authorization: RouteLocationAuthorization { get }
    func requestWhenInUseAuthorization() async -> RouteLocationAuthorization
    func locationUpdates() -> AsyncThrowingStream<RouteLocationSample, Error>
    func stopUpdatingLocation()
}

/// Owns the production stream independently of Core Location so replacement and
/// delayed consumer cancellation can be checked without starting device location.
@MainActor
final class RouteLocationStreamSource {
    private var generation: UUID?
    private var continuation: AsyncThrowingStream<RouteLocationSample, Error>.Continuation?
    private let stopLocation: () -> Void

    var isActive: Bool { continuation != nil }

    init(stopLocation: @escaping () -> Void) {
        self.stopLocation = stopLocation
    }

    func updates() -> AsyncThrowingStream<RouteLocationSample, Error> {
        finish()
        let id = UUID()
        generation = id
        return AsyncThrowingStream { continuation in
            self.continuation = continuation
            continuation.onTermination = { @Sendable [weak self] _ in
                Task { @MainActor in
                    // An old stream may terminate after Resume installed a new one.
                    guard self?.generation == id else { return }
                    self?.finish()
                }
            }
        }
    }

    func yield(_ sample: RouteLocationSample) {
        continuation?.yield(sample)
    }

    func finish(throwing error: Error? = nil) {
        let active = continuation
        generation = nil
        continuation = nil
        stopLocation()
        if let error {
            active?.finish(throwing: error)
        } else {
            active?.finish()
        }
    }
}

@MainActor
final class CoreLocationRouteLocationService: NSObject, RouteLocationProviding {
    private let manager: CLLocationManager
    private var authorizationWaiters:
        [CheckedContinuation<RouteLocationAuthorization, Never>] = []
    private lazy var locationStream = RouteLocationStreamSource { [weak self] in
        self?.manager.stopUpdatingLocation()
        self?.manager.allowsBackgroundLocationUpdates = false
        self?.manager.showsBackgroundLocationIndicator = false
    }

    override init() {
        manager = CLLocationManager()
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 8
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
        manager.allowsBackgroundLocationUpdates = false
        manager.showsBackgroundLocationIndicator = false
    }

    var authorization: RouteLocationAuthorization {
        guard CLLocationManager.locationServicesEnabled() else {
            return .servicesDisabled
        }
        switch manager.authorizationStatus {
        case .notDetermined:
            return .notDetermined
        case .restricted:
            return .restricted
        case .denied:
            return .denied
        case .authorizedAlways, .authorizedWhenInUse:
            return manager.accuracyAuthorization == .reducedAccuracy
                ? .reducedAccuracy
                : .authorized
        @unknown default:
            return .restricted
        }
    }

    func requestWhenInUseAuthorization() async -> RouteLocationAuthorization {
        guard authorization == .notDetermined else { return authorization }
        return await withCheckedContinuation { continuation in
            authorizationWaiters.append(continuation)
            if authorizationWaiters.count == 1 {
                manager.requestWhenInUseAuthorization()
            }
        }
    }

    func locationUpdates() -> AsyncThrowingStream<RouteLocationSample, Error> {
        let stream = locationStream.updates()
        guard authorization == .authorized else {
            finishLocationUpdates(throwing: serviceError(for: authorization))
            return stream
        }
        guard (Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String])?.contains("location") == true else {
            finishLocationUpdates(throwing: RouteLocationServiceError.backgroundModeUnavailable)
            return stream
        }
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        return stream
    }

    func stopUpdatingLocation() {
        locationStream.finish()
    }

    private func finishLocationUpdates(throwing error: Error) {
        locationStream.finish(throwing: error)
    }

    private func resumeAuthorizationWaiters() {
        let status = authorization
        let waiters = authorizationWaiters
        authorizationWaiters.removeAll()
        waiters.forEach { $0.resume(returning: status) }
    }

    private func serviceError(
        for authorization: RouteLocationAuthorization
    ) -> RouteLocationServiceError {
        switch authorization {
        case .denied:
            .permissionDenied
        case .restricted:
            .permissionRestricted
        case .reducedAccuracy:
            .preciseLocationRequired
        case .servicesDisabled:
            .servicesDisabled
        case .notDetermined, .authorized:
            .unavailable
        }
    }
}

extension CoreLocationRouteLocationService: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        resumeAuthorizationWaiters()
        if locationStream.isActive, authorization != .authorized {
            finishLocationUpdates(throwing: serviceError(for: authorization))
        }
    }

    func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard let location = locations.last,
              location.horizontalAccuracy >= 0
        else { return }
        locationStream.yield(
            RouteLocationSample(
                coordinate: Coordinate(
                    latitude: location.coordinate.latitude,
                    longitude: location.coordinate.longitude,
                    elevationMeters: location.altitude.isFinite
                        ? location.altitude
                        : nil
                ),
                horizontalAccuracyMeters: location.horizontalAccuracy,
                timestamp: location.timestamp
            )
        )
    }

    func locationManager(
        _ manager: CLLocationManager,
        didFailWithError error: Error
    ) {
        if let locationError = error as? CLError,
           locationError.code == .locationUnknown
        {
            return
        }
        if let locationError = error as? CLError,
           locationError.code == .denied
        {
            finishLocationUpdates(throwing: serviceError(for: authorization))
        } else {
            finishLocationUpdates(throwing: RouteLocationServiceError.unavailable)
        }
    }
}

@MainActor
protocol RouteGuidanceClock: AnyObject {
    func now() -> Date
    func sleep(seconds: TimeInterval) async throws
}

@MainActor
final class SystemRouteGuidanceClock: RouteGuidanceClock {
    func now() -> Date { Date() }

    func sleep(seconds: TimeInterval) async throws {
        try await Task.sleep(for: .seconds(seconds))
    }
}

@MainActor
protocol RouteScreenAwakeControlling: AnyObject {
    var isGuidanceActive: Bool { get }
    func setGuidanceActive(_ isActive: Bool)
}

@MainActor
final class ApplicationRouteScreenAwakeController:
    RouteScreenAwakeControlling
{
    private var previousIdleTimerValue: Bool?
    private(set) var isGuidanceActive = false

    func setGuidanceActive(_ isActive: Bool) {
        guard isActive != isGuidanceActive else { return }
        isGuidanceActive = isActive
        if isActive {
            previousIdleTimerValue = UIApplication.shared.isIdleTimerDisabled
            UIApplication.shared.isIdleTimerDisabled = true
        } else if let previousIdleTimerValue {
            UIApplication.shared.isIdleTimerDisabled = previousIdleTimerValue
            self.previousIdleTimerValue = nil
        }
    }

}

@MainActor
struct RouteGuidanceDependencies {
    let makeLocationService: (ActivityType) -> any RouteLocationProviding
    let makeClock: () -> any RouteGuidanceClock
    let makeScreenAwakeController: () -> any RouteScreenAwakeControlling

    static let live = RouteGuidanceDependencies(
        makeLocationService: { _ in CoreLocationRouteLocationService() },
        makeClock: { SystemRouteGuidanceClock() },
        makeScreenAwakeController: {
            ApplicationRouteScreenAwakeController()
        }
    )
}

private struct RouteGuidanceDependenciesKey: EnvironmentKey {
    @MainActor static let defaultValue = RouteGuidanceDependencies.live
}

extension EnvironmentValues {
    var routeGuidanceDependencies: RouteGuidanceDependencies {
        get { self[RouteGuidanceDependenciesKey.self] }
        set { self[RouteGuidanceDependenciesKey.self] = newValue }
    }
}
