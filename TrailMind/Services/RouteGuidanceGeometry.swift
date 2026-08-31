import Foundation

struct RouteGuidancePolicy: Equatable, Sendable {
    /// Samples less accurate than this are displayed, but do not change route
    /// progress or off-route state.
    let maximumReliableHorizontalAccuracyMeters: Double
    /// Progress is accepted only when the projected position is this close to
    /// the verified polyline.
    let progressCaptureDistanceMeters: Double
    /// Three reliable samples beyond this distance enter the warning state.
    let offRouteEntryDistanceMeters: Double
    let offRouteEntrySampleCount: Int
    /// Two reliable samples inside this distance clear the warning state.
    let offRouteRecoveryDistanceMeters: Double
    let offRouteRecoverySampleCount: Int
    let projectionAmbiguityToleranceMeters: Double
    let instructionPassToleranceMeters: Double
    let instructionMaximumSnapDistanceMeters: Double
    let completionDistanceMeters: Double
    let completionSampleCount: Int
    let noUpdateTimeoutSeconds: TimeInterval

    static let v1 = RouteGuidancePolicy(
        maximumReliableHorizontalAccuracyMeters: 50,
        progressCaptureDistanceMeters: 80,
        offRouteEntryDistanceMeters: 60,
        offRouteEntrySampleCount: 3,
        offRouteRecoveryDistanceMeters: 30,
        offRouteRecoverySampleCount: 2,
        projectionAmbiguityToleranceMeters: 8,
        instructionPassToleranceMeters: 20,
        instructionMaximumSnapDistanceMeters: 50,
        completionDistanceMeters: 35,
        completionSampleCount: 2,
        noUpdateTimeoutSeconds: 30
    )
}

enum RouteGuidanceEligibilityFailure: Equatable, Sendable {
    case unverifiedRoute
    case guidanceIntegrityUnavailable
    case guidanceIntegrityMismatch
    case unusableGeometry
    case invalidRouteStatistics
}

struct RouteGuidanceEligibility: Equatable, Sendable {
    let failure: RouteGuidanceEligibilityFailure?

    var isEligible: Bool { failure == nil }

    init(route: TrailRoute) {
        guard route.isVerifiedRoutedResult else {
            failure = .unverifiedRoute
            return
        }
        guard case let .routed(provenance) = route.provenance,
              let expectedFingerprint = provenance.guidanceFingerprint
        else {
            failure = .guidanceIntegrityUnavailable
            return
        }
        let currentFingerprint = RouteGuidanceFingerprint.make(
            path: route.path,
            instructions: route.routeInstructions
        )
        guard currentFingerprint == expectedFingerprint else {
            failure = .guidanceIntegrityMismatch
            return
        }
        guard let polyline = RouteGuidancePolyline(points: route.path),
              polyline.totalDistanceMeters >= 20
        else {
            failure = .unusableGeometry
            return
        }
        guard route.distanceKilometers.isFinite,
              route.distanceKilometers > 0,
              route.durationHours.isFinite,
              route.durationHours > 0
        else {
            failure = .invalidRouteStatistics
            return
        }
        failure = nil
    }
}

struct RouteLocationSample: Equatable, Sendable {
    let coordinate: Coordinate
    let horizontalAccuracyMeters: Double
    let timestamp: Date

    init(
        coordinate: Coordinate,
        horizontalAccuracyMeters: Double,
        timestamp: Date
    ) {
        self.coordinate = coordinate
        self.horizontalAccuracyMeters = horizontalAccuracyMeters
        self.timestamp = timestamp
    }

    var hasUsableCoordinate: Bool {
        coordinate.latitude.isFinite &&
            coordinate.longitude.isFinite &&
            (-90...90).contains(coordinate.latitude) &&
            (-180...180).contains(coordinate.longitude) &&
            horizontalAccuracyMeters.isFinite &&
            horizontalAccuracyMeters >= 0
    }
}

struct RouteGeometryProjection: Equatable, Sendable {
    let coordinate: Coordinate
    let distanceAlongRouteMeters: Double
    let distanceFromRouteMeters: Double
    let segmentIndex: Int
}

struct RouteGuidancePolyline: Equatable, Sendable {
    let points: [Coordinate]
    let cumulativeDistancesMeters: [Double]
    let totalDistanceMeters: Double

    init?(points: [Coordinate]) {
        guard points.count >= 2,
              points.allSatisfy(Self.isValid)
        else { return nil }

        var cumulative = [Double](repeating: 0, count: points.count)
        var total = 0.0
        for index in 1..<points.count {
            let distance = Self.distanceMeters(
                from: points[index - 1],
                to: points[index]
            )
            guard distance.isFinite else { return nil }
            total += distance
            cumulative[index] = total
        }
        guard total > 0 else { return nil }

        self.points = points
        cumulativeDistancesMeters = cumulative
        totalDistanceMeters = total
    }

    func projection(
        of coordinate: Coordinate,
        previousDistanceAlongRouteMeters: Double? = nil,
        ambiguityToleranceMeters: Double = RouteGuidancePolicy.v1.projectionAmbiguityToleranceMeters
    ) -> RouteGeometryProjection? {
        guard Self.isValid(coordinate) else { return nil }

        var candidates: [RouteGeometryProjection] = []
        candidates.reserveCapacity(points.count - 1)
        for index in 0..<(points.count - 1) {
            let start = points[index]
            let end = points[index + 1]
            let segmentDistance = cumulativeDistancesMeters[index + 1]
                - cumulativeDistancesMeters[index]
            guard segmentDistance > 0,
                  let candidate = Self.project(
                    coordinate,
                    ontoSegmentFrom: start,
                    to: end,
                    segmentIndex: index,
                    segmentDistanceMeters: segmentDistance,
                    cumulativeDistanceMeters: cumulativeDistancesMeters[index]
                  )
            else { continue }
            candidates.append(candidate)
        }
        guard let minimumDistance = candidates.map(\.distanceFromRouteMeters).min() else {
            return nil
        }

        let plausible = candidates.filter {
            $0.distanceFromRouteMeters <= minimumDistance + ambiguityToleranceMeters
        }
        if let previousDistanceAlongRouteMeters {
            return plausible.min { left, right in
                let leftDelta = abs(
                    left.distanceAlongRouteMeters - previousDistanceAlongRouteMeters
                )
                let rightDelta = abs(
                    right.distanceAlongRouteMeters - previousDistanceAlongRouteMeters
                )
                if leftDelta != rightDelta { return leftDelta < rightDelta }
                if left.distanceFromRouteMeters != right.distanceFromRouteMeters {
                    return left.distanceFromRouteMeters < right.distanceFromRouteMeters
                }
                return left.distanceAlongRouteMeters < right.distanceAlongRouteMeters
            }
        }
        return plausible.min { left, right in
            if left.distanceFromRouteMeters != right.distanceFromRouteMeters {
                return left.distanceFromRouteMeters < right.distanceFromRouteMeters
            }
            return left.distanceAlongRouteMeters < right.distanceAlongRouteMeters
        }
    }

    private static func project(
        _ coordinate: Coordinate,
        ontoSegmentFrom start: Coordinate,
        to end: Coordinate,
        segmentIndex: Int,
        segmentDistanceMeters: Double,
        cumulativeDistanceMeters: Double
    ) -> RouteGeometryProjection? {
        let startVector = localMeters(of: start, relativeTo: coordinate)
        let endVector = localMeters(of: end, relativeTo: coordinate)
        let deltaX = endVector.x - startVector.x
        let deltaY = endVector.y - startVector.y
        let lengthSquared = deltaX * deltaX + deltaY * deltaY
        guard lengthSquared.isFinite, lengthSquared > 0 else { return nil }

        let unclamped = -(startVector.x * deltaX + startVector.y * deltaY)
            / lengthSquared
        let fraction = min(max(unclamped, 0), 1)
        let closestX = startVector.x + deltaX * fraction
        let closestY = startVector.y + deltaY * fraction
        let distance = hypot(closestX, closestY)
        guard distance.isFinite else { return nil }

        return RouteGeometryProjection(
            coordinate: Coordinate(
                latitude: start.latitude + (end.latitude - start.latitude) * fraction,
                longitude: start.longitude + (end.longitude - start.longitude) * fraction
            ),
            distanceAlongRouteMeters: cumulativeDistanceMeters
                + segmentDistanceMeters * fraction,
            distanceFromRouteMeters: distance,
            segmentIndex: segmentIndex
        )
    }

    private static func localMeters(
        of point: Coordinate,
        relativeTo origin: Coordinate
    ) -> (x: Double, y: Double) {
        let radians = Double.pi / 180
        let meanLatitude = (point.latitude + origin.latitude) * 0.5 * radians
        let x = (point.longitude - origin.longitude) * radians
            * 6_371_008.8 * cos(meanLatitude)
        let y = (point.latitude - origin.latitude) * radians * 6_371_008.8
        return (x, y)
    }

    static func distanceMeters(from start: Coordinate, to end: Coordinate) -> Double {
        let radians = Double.pi / 180
        let startLatitude = start.latitude * radians
        let endLatitude = end.latitude * radians
        let latitudeDelta = (end.latitude - start.latitude) * radians
        let longitudeDelta = (end.longitude - start.longitude) * radians
        let a = sin(latitudeDelta / 2) * sin(latitudeDelta / 2)
            + cos(startLatitude) * cos(endLatitude)
            * sin(longitudeDelta / 2) * sin(longitudeDelta / 2)
        let bounded = min(max(a, 0), 1)
        return 6_371_008.8 * 2 * atan2(sqrt(bounded), sqrt(1 - bounded))
    }

    private static func isValid(_ point: Coordinate) -> Bool {
        point.latitude.isFinite &&
            point.longitude.isFinite &&
            (-90...90).contains(point.latitude) &&
            (-180...180).contains(point.longitude)
    }
}

struct RouteGuidanceInstruction: Equatable, Sendable {
    let id: UUID
    let text: String
    let streetName: String?
    let distanceAlongRouteMeters: Double
}

struct RouteGuidancePlan: Equatable, Sendable {
    let polyline: RouteGuidancePolyline
    let verifiedDistanceMeters: Double
    let verifiedDurationSeconds: Double
    let instructions: [RouteGuidanceInstruction]

    init?(route: TrailRoute, policy: RouteGuidancePolicy = .v1) {
        guard RouteGuidanceEligibility(route: route).isEligible,
              let polyline = RouteGuidancePolyline(points: route.path)
        else { return nil }

        self.polyline = polyline
        verifiedDistanceMeters = route.distanceKilometers * 1_000
        verifiedDurationSeconds = route.durationHours * 3_600
        instructions = Self.mapInstructions(
            route.routeInstructions,
            onto: polyline,
            policy: policy
        )
    }

    private static func mapInstructions(
        _ instructions: [RouteInstruction],
        onto polyline: RouteGuidancePolyline,
        policy: RouteGuidancePolicy
    ) -> [RouteGuidanceInstruction] {
        var mapped: [RouteGuidanceInstruction] = []
        var previousDistance: Double?
        for instruction in instructions {
            let text = instruction.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty,
                  instruction.distanceMeters.isFinite,
                  instruction.distanceMeters >= 0,
                  instruction.durationSeconds.isFinite,
                  instruction.durationSeconds >= 0,
                  let coordinate = instruction.coordinate,
                  let projection = polyline.projection(
                    of: coordinate,
                    previousDistanceAlongRouteMeters: previousDistance,
                    ambiguityToleranceMeters: policy.projectionAmbiguityToleranceMeters
                  ),
                  projection.distanceFromRouteMeters
                    <= policy.instructionMaximumSnapDistanceMeters,
                  previousDistance.map({
                    projection.distanceAlongRouteMeters
                        + policy.instructionPassToleranceMeters >= $0
                  }) ?? true
            else { continue }

            let distance = max(
                previousDistance ?? 0,
                projection.distanceAlongRouteMeters
            )
            let trimmedStreetName = instruction.streetName?.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            mapped.append(
                RouteGuidanceInstruction(
                    id: instruction.id,
                    text: text,
                    streetName: trimmedStreetName?.isEmpty == true
                        ? nil
                        : trimmedStreetName,
                    distanceAlongRouteMeters: distance
                )
            )
            previousDistance = distance
        }
        return mapped
    }
}

enum RouteAdherenceState: Equatable, Sendable {
    case onRoute
    case offRoute(distanceMeters: Double)
}

struct RouteOffRouteMonitor: Equatable, Sendable {
    private(set) var state: RouteAdherenceState = .onRoute
    private var entryCount = 0
    private var recoveryCount = 0

    mutating func update(
        distanceFromRouteMeters: Double,
        horizontalAccuracyMeters: Double,
        policy: RouteGuidancePolicy = .v1
    ) -> RouteAdherenceState {
        guard distanceFromRouteMeters.isFinite,
              horizontalAccuracyMeters.isFinite,
              horizontalAccuracyMeters >= 0,
              horizontalAccuracyMeters
                <= policy.maximumReliableHorizontalAccuracyMeters
        else { return state }

        switch state {
        case .onRoute:
            recoveryCount = 0
            if distanceFromRouteMeters > policy.offRouteEntryDistanceMeters {
                entryCount += 1
                if entryCount >= policy.offRouteEntrySampleCount {
                    state = .offRoute(distanceMeters: distanceFromRouteMeters)
                    entryCount = 0
                }
            } else {
                entryCount = 0
            }
        case .offRoute:
            entryCount = 0
            state = .offRoute(distanceMeters: distanceFromRouteMeters)
            if distanceFromRouteMeters < policy.offRouteRecoveryDistanceMeters {
                recoveryCount += 1
                if recoveryCount >= policy.offRouteRecoverySampleCount {
                    state = .onRoute
                    recoveryCount = 0
                }
            } else {
                recoveryCount = 0
            }
        }
        return state
    }
}

struct RouteGuidanceMetrics: Equatable, Sendable {
    let progressFraction: Double
    let distanceAlongRouteMeters: Double
    let remainingVerifiedDistanceMeters: Double
    let estimatedRemainingSeconds: Double
}

struct RouteGuidanceSnapshot: Equatable, Sendable {
    let projection: RouteGeometryProjection
    let adherence: RouteAdherenceState
    let metrics: RouteGuidanceMetrics
    let nextInstruction: RouteGuidanceInstruction?
    let distanceToNextInstructionMeters: Double?
    let isComplete: Bool
}

struct RouteGuidanceEngine: Equatable, Sendable {
    let plan: RouteGuidancePlan
    let policy: RouteGuidancePolicy

    private(set) var acceptedDistanceAlongRouteMeters = 0.0
    private var offRouteMonitor = RouteOffRouteMonitor()
    private var completionConfirmations = 0

    init(plan: RouteGuidancePlan, policy: RouteGuidancePolicy = .v1) {
        self.plan = plan
        self.policy = policy
    }

    mutating func process(_ sample: RouteLocationSample) -> RouteGuidanceSnapshot? {
        guard sample.hasUsableCoordinate,
              let projection = plan.polyline.projection(
                of: sample.coordinate,
                previousDistanceAlongRouteMeters: acceptedDistanceAlongRouteMeters,
                ambiguityToleranceMeters: policy.projectionAmbiguityToleranceMeters
              )
        else { return nil }

        let previousProgressFraction = acceptedDistanceAlongRouteMeters
            / plan.polyline.totalDistanceMeters
        let adherence = offRouteMonitor.update(
            distanceFromRouteMeters: projection.distanceFromRouteMeters,
            horizontalAccuracyMeters: sample.horizontalAccuracyMeters,
            policy: policy
        )
        let isReliable = sample.horizontalAccuracyMeters
            <= policy.maximumReliableHorizontalAccuracyMeters
        let mayAdvance = isReliable
            && projection.distanceFromRouteMeters <= policy.progressCaptureDistanceMeters
            && adherence == .onRoute
        if mayAdvance {
            acceptedDistanceAlongRouteMeters = min(
                max(
                    acceptedDistanceAlongRouteMeters,
                    projection.distanceAlongRouteMeters
                ),
                plan.polyline.totalDistanceMeters
            )
        }

        let progressFraction = min(
            max(
                acceptedDistanceAlongRouteMeters
                    / plan.polyline.totalDistanceMeters,
                0
            ),
            1
        )
        let remainingFraction = 1 - progressFraction
        let metrics = RouteGuidanceMetrics(
            progressFraction: progressFraction,
            distanceAlongRouteMeters: acceptedDistanceAlongRouteMeters,
            remainingVerifiedDistanceMeters: plan.verifiedDistanceMeters
                * remainingFraction,
            estimatedRemainingSeconds: plan.verifiedDurationSeconds
                * remainingFraction
        )

        let nextInstruction = plan.instructions.first {
            $0.distanceAlongRouteMeters + policy.instructionPassToleranceMeters
                >= acceptedDistanceAlongRouteMeters
        }
        let distanceToInstruction = nextInstruction.map {
            max(0, $0.distanceAlongRouteMeters - acceptedDistanceAlongRouteMeters)
        }

        let geometricRemaining = plan.polyline.totalDistanceMeters
            - acceptedDistanceAlongRouteMeters
        let completionCandidate = isReliable
            && adherence == .onRoute
            && previousProgressFraction >= 0.8
            && geometricRemaining <= policy.completionDistanceMeters
        if completionCandidate {
            completionConfirmations += 1
        } else {
            completionConfirmations = 0
        }

        return RouteGuidanceSnapshot(
            projection: projection,
            adherence: adherence,
            metrics: metrics,
            nextInstruction: nextInstruction,
            distanceToNextInstructionMeters: distanceToInstruction,
            isComplete: completionConfirmations >= policy.completionSampleCount
        )
    }
}

struct RouteLocationStalenessMonitor: Equatable, Sendable {
    private(set) var lastUpdateAt: Date?

    mutating func recordUpdate(at date: Date) {
        lastUpdateAt = date
    }

    func isDelayed(
        at date: Date,
        timeoutSeconds: TimeInterval = RouteGuidancePolicy.v1.noUpdateTimeoutSeconds
    ) -> Bool {
        guard let lastUpdateAt else { return true }
        return date.timeIntervalSince(lastUpdateAt) >= timeoutSeconds
    }
}
