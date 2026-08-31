import Foundation
import Observation

enum RouteGuidancePauseReason: Equatable, Sendable {
    case user
    case appBackgrounded
}

enum RouteGuidanceBlockReason: Equatable, Sendable {
    case routeUnavailable
    case permissionDenied
    case permissionRestricted
    case preciseLocationRequired
    case locationServicesDisabled
}

enum RouteGuidancePhase: Equatable, Sendable {
    case starting
    case guiding
    case paused(RouteGuidancePauseReason)
    case completed
    case ended
    case blocked(RouteGuidanceBlockReason)
    case failed(message: String)
}

@MainActor
@Observable
final class RouteGuidanceModel {
    let route: TrailRoute
    let policy: RouteGuidancePolicy
    let eligibility: RouteGuidanceEligibility

    private(set) var phase: RouteGuidancePhase = .starting
    private(set) var latestLocation: RouteLocationSample?
    private(set) var snapshot: RouteGuidanceSnapshot?
    private(set) var isLocationDelayed = false

    @ObservationIgnored private let locationService:
        any RouteLocationProviding
    @ObservationIgnored private let clock: any RouteGuidanceClock
    @ObservationIgnored private let screenAwakeController:
        any RouteScreenAwakeControlling
    @ObservationIgnored private var engine: RouteGuidanceEngine?
    @ObservationIgnored private var stalenessMonitor =
        RouteLocationStalenessMonitor()
    @ObservationIgnored private var updatesTask: Task<Void, Never>?
    @ObservationIgnored private var noUpdateTask: Task<Void, Never>?

    init(
        route: TrailRoute,
        dependencies: RouteGuidanceDependencies = .live,
        policy: RouteGuidancePolicy = .v1
    ) {
        self.route = route
        self.policy = policy
        eligibility = RouteGuidanceEligibility(route: route)
        locationService = dependencies.makeLocationService(route.activity)
        clock = dependencies.makeClock()
        screenAwakeController = dependencies.makeScreenAwakeController()
        if let plan = RouteGuidancePlan(route: route, policy: policy) {
            engine = RouteGuidanceEngine(plan: plan, policy: policy)
        }
    }

    var isActivelyGuiding: Bool { phase == .guiding }

    var remainingDistanceLabel: String {
        guard let metrics = snapshot?.metrics else { return route.distanceLabel }
        return Self.conservativeDistanceLabel(
            meters: metrics.remainingVerifiedDistanceMeters
        )
    }

    var remainingTimeLabel: String {
        guard let metrics = snapshot?.metrics else { return route.durationLabel }
        return Self.conservativeTimeLabel(
            seconds: metrics.estimatedRemainingSeconds
        )
    }

    var progressLabel: String {
        let percent = Int(((snapshot?.metrics.progressFraction ?? 0) * 100).rounded(.down))
        return "\(min(max(percent, 0), 100))%"
    }

    var nextInstructionDistanceLabel: String? {
        snapshot?.distanceToNextInstructionMeters.map {
            Self.conservativeDistanceLabel(meters: $0)
        }
    }

    var mapAccessibilitySummary: String {
        guard let snapshot else {
            return "Waiting for a precise foreground location update."
        }
        switch snapshot.adherence {
        case .onRoute:
            return "Position is near the mapped route. Progress \(progressLabel). Remaining distance \(remainingDistanceLabel)."
        case let .offRoute(distanceMeters):
            return "Position may be off route, approximately \(Self.conservativeDistanceLabel(meters: distanceMeters)) from the mapped line. Progress is paused."
        }
    }

    func start() async {
        guard engine != nil, eligibility.isEligible else {
            phase = .blocked(.routeUnavailable)
            return
        }
        guard phase == .starting || isRetryablePhase else { return }
        phase = .starting
        let authorization: RouteLocationAuthorization
        if locationService.authorization == .notDetermined {
            authorization = await locationService.requestWhenInUseAuthorization()
        } else {
            authorization = locationService.authorization
        }
        guard !Task.isCancelled else { return }
        handleAuthorization(authorization)
    }

    func pause() {
        guard phase == .guiding else { return }
        phase = .paused(.user)
        stopMonitoring()
    }

    func resume() {
        guard case .paused = phase else { return }
        handleAuthorization(locationService.authorization)
    }

    func end() {
        guard phase != .ended else { return }
        stopMonitoring()
        phase = .ended
    }

    func retry() async {
        guard isRetryablePhase else { return }
        await start()
    }

    func appDidEnterBackground() {
        guard phase == .guiding else { return }
        phase = .paused(.appBackgrounded)
        stopMonitoring()
    }

    func shutdown() {
        stopMonitoring()
    }

    private var isRetryablePhase: Bool {
        switch phase {
        case .failed, .blocked:
            true
        case .starting, .guiding, .paused, .completed, .ended:
            false
        }
    }

    private func handleAuthorization(_ authorization: RouteLocationAuthorization) {
        switch authorization {
        case .authorized:
            beginMonitoring()
        case .notDetermined:
            phase = .failed(message: "Location permission was not completed. Try again when you’re ready.")
        case .reducedAccuracy:
            phase = .blocked(.preciseLocationRequired)
        case .denied:
            phase = .blocked(.permissionDenied)
        case .restricted:
            phase = .blocked(.permissionRestricted)
        case .servicesDisabled:
            phase = .blocked(.locationServicesDisabled)
        }
    }

    private func beginMonitoring() {
        guard engine != nil else {
            phase = .blocked(.routeUnavailable)
            return
        }
        stopMonitoring()
        phase = .guiding
        isLocationDelayed = false
        stalenessMonitor.recordUpdate(at: clock.now())
        screenAwakeController.setGuidanceActive(true)
        restartNoUpdateTimer()

        let stream = locationService.locationUpdates()
        updatesTask = Task { [weak self] in
            guard let self else { return }
            do {
                for try await sample in stream {
                    try Task.checkCancellation()
                    receive(sample)
                }
                guard !Task.isCancelled, phase == .guiding else { return }
                failLocationUpdates(
                    message: "Location updates stopped. Check Location Services and try again."
                )
            } catch is CancellationError {
                return
            } catch let error as RouteLocationServiceError {
                guard !Task.isCancelled else { return }
                handleLocationServiceError(error)
            } catch {
                guard !Task.isCancelled else { return }
                failLocationUpdates(
                    message: "Your location is temporarily unavailable. Try again in an open area."
                )
            }
        }
    }

    private func receive(_ sample: RouteLocationSample) {
        guard phase == .guiding, sample.hasUsableCoordinate else { return }
        latestLocation = sample
        stalenessMonitor.recordUpdate(at: clock.now())
        isLocationDelayed = false
        restartNoUpdateTimer()

        guard var engine else { return }
        let nextSnapshot = engine.process(sample)
        self.engine = engine
        guard let nextSnapshot else { return }
        snapshot = nextSnapshot
        if nextSnapshot.isComplete {
            stopMonitoring()
            phase = .completed
        }
    }

    private func restartNoUpdateTimer() {
        noUpdateTask?.cancel()
        noUpdateTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await clock.sleep(seconds: policy.noUpdateTimeoutSeconds)
                try Task.checkCancellation()
                guard phase == .guiding else { return }
                isLocationDelayed = stalenessMonitor.isDelayed(
                    at: clock.now(),
                    timeoutSeconds: policy.noUpdateTimeoutSeconds
                )
            } catch is CancellationError {
                return
            } catch {
                return
            }
        }
    }

    private func stopMonitoring() {
        updatesTask?.cancel()
        updatesTask = nil
        noUpdateTask?.cancel()
        noUpdateTask = nil
        locationService.stopUpdatingLocation()
        screenAwakeController.setGuidanceActive(false)
        isLocationDelayed = false
    }

    private func handleLocationServiceError(_ error: RouteLocationServiceError) {
        stopMonitoring()
        switch error {
        case .permissionDenied:
            phase = .blocked(.permissionDenied)
        case .permissionRestricted:
            phase = .blocked(.permissionRestricted)
        case .preciseLocationRequired:
            phase = .blocked(.preciseLocationRequired)
        case .servicesDisabled:
            phase = .blocked(.locationServicesDisabled)
        case .unavailable:
            phase = .failed(
                message: "Your location is temporarily unavailable. Try again in an open area."
            )
        }
    }

    private func failLocationUpdates(message: String) {
        stopMonitoring()
        phase = .failed(message: message)
    }

    static func conservativeDistanceLabel(meters: Double) -> String {
        let safeMeters = max(0, meters.isFinite ? meters : 0)
        if safeMeters >= 1_000 {
            let kilometers = ceil(safeMeters / 100) / 10
            return kilometers.formatted(
                .number.precision(.fractionLength(1))
            ) + " km"
        }
        let roundedMeters = Int(ceil(safeMeters / 10) * 10)
        return "\(roundedMeters.formatted()) m"
    }

    static func conservativeTimeLabel(seconds: Double) -> String {
        let safeSeconds = max(0, seconds.isFinite ? seconds : 0)
        let roundedMinutes = max(0, Int(ceil(safeSeconds / 300) * 5))
        if roundedMinutes == 0 { return "0 min" }
        if roundedMinutes < 60 { return "\(roundedMinutes) min" }
        let hours = roundedMinutes / 60
        let minutes = roundedMinutes % 60
        return minutes == 0
            ? "\(hours) hr"
            : "\(hours) hr \(minutes) min"
    }
}
