import XCTest
@testable import TrailMind

@MainActor
final class RouteGuidanceGeometryTests: XCTestCase {
    func testProjectionFindsNearestPositionAlongPolyline() throws {
        let polyline = try XCTUnwrap(
            RouteGuidancePolyline(
                points: [
                    point(0, 0),
                    point(0, 0.001),
                    point(0, 0.002)
                ]
            )
        )

        let projection = try XCTUnwrap(
            polyline.projection(of: point(0.0001, 0.0005))
        )

        XCTAssertEqual(
            projection.distanceAlongRouteMeters,
            polyline.totalDistanceMeters * 0.25,
            accuracy: 1
        )
        XCTAssertEqual(projection.distanceFromRouteMeters, 11.1, accuracy: 1)
        XCTAssertEqual(projection.segmentIndex, 0)
    }

    func testProgressNeverMovesBackward() throws {
        let route = verifiedRoute(
            path: [point(0, 0), point(0, 0.001), point(0, 0.002)]
        )
        let plan = try XCTUnwrap(RouteGuidancePlan(route: route))
        var engine = RouteGuidanceEngine(plan: plan)

        let forward = try XCTUnwrap(
            engine.process(sample(point(0, 0.0015)))
        )
        let backward = try XCTUnwrap(
            engine.process(sample(point(0, 0.0005), seconds: 1))
        )

        XCTAssertGreaterThan(forward.metrics.progressFraction, 0.7)
        XCTAssertEqual(
            backward.metrics.distanceAlongRouteMeters,
            forward.metrics.distanceAlongRouteMeters,
            accuracy: 0.01
        )
    }

    func testLoopStartFinishAmbiguityUsesProgressContext() throws {
        let path = [
            point(0, 0),
            point(0, 0.001),
            point(0.001, 0.001),
            point(0.001, 0),
            point(0, 0)
        ]
        let polyline = try XCTUnwrap(RouteGuidancePolyline(points: path))

        let atStart = try XCTUnwrap(polyline.projection(of: point(0, 0)))
        let nearFinish = try XCTUnwrap(
            polyline.projection(
                of: point(0, 0),
                previousDistanceAlongRouteMeters: polyline.totalDistanceMeters - 10
            )
        )

        XCTAssertEqual(atStart.distanceAlongRouteMeters, 0, accuracy: 0.01)
        XCTAssertEqual(
            nearFinish.distanceAlongRouteMeters,
            polyline.totalDistanceMeters,
            accuracy: 0.01
        )
    }

    func testRemainingDistanceAndTimeUseVerifiedStatsProportionally() throws {
        let route = verifiedRoute(
            path: [point(0, 0), point(0, 0.002)],
            distanceKilometers: 10,
            durationHours: 2
        )
        var engine = RouteGuidanceEngine(
            plan: try XCTUnwrap(RouteGuidancePlan(route: route))
        )

        let snapshot = try XCTUnwrap(
            engine.process(sample(point(0, 0.001)))
        )

        XCTAssertEqual(snapshot.metrics.progressFraction, 0.5, accuracy: 0.01)
        XCTAssertEqual(
            snapshot.metrics.remainingVerifiedDistanceMeters,
            5_000,
            accuracy: 30
        )
        XCTAssertEqual(
            snapshot.metrics.estimatedRemainingSeconds,
            3_600,
            accuracy: 30
        )
        XCTAssertEqual(
            RouteGuidanceModel.conservativeTimeLabel(seconds: 3_601),
            "1 hr 5 min"
        )
    }

    func testInstructionAdvancesAfterPassingMappedCoordinate() throws {
        let instructions = [
            instruction("Bear left", longitude: 0.0005),
            instruction("Continue straight", longitude: 0.0015)
        ]
        let route = verifiedRoute(
            path: [point(0, 0), point(0, 0.001), point(0, 0.002)],
            instructions: instructions
        )
        var engine = RouteGuidanceEngine(
            plan: try XCTUnwrap(RouteGuidancePlan(route: route))
        )

        let first = try XCTUnwrap(
            engine.process(sample(point(0, 0.0002)))
        )
        let second = try XCTUnwrap(
            engine.process(sample(point(0, 0.0010), seconds: 1))
        )

        XCTAssertEqual(first.nextInstruction?.text, "Bear left")
        XCTAssertEqual(second.nextInstruction?.text, "Continue straight")
        XCTAssertGreaterThan(second.distanceToNextInstructionMeters ?? 0, 40)
    }

    func testOffRouteWarningUsesEntryAndRecoveryHysteresis() {
        var monitor = RouteOffRouteMonitor()

        for _ in 0..<2 {
            XCTAssertEqual(
                monitor.update(
                    distanceFromRouteMeters: 75,
                    horizontalAccuracyMeters: 10
                ),
                .onRoute
            )
        }
        XCTAssertEqual(
            monitor.update(
                distanceFromRouteMeters: 75,
                horizontalAccuracyMeters: 10
            ),
            .offRoute(distanceMeters: 75)
        )
        XCTAssertEqual(
            monitor.update(
                distanceFromRouteMeters: 20,
                horizontalAccuracyMeters: 10
            ),
            .offRoute(distanceMeters: 20)
        )
        XCTAssertEqual(
            monitor.update(
                distanceFromRouteMeters: 20,
                horizontalAccuracyMeters: 10
            ),
            .onRoute
        )
    }

    func testInaccurateSamplesDoNotChangeOffRouteState() {
        var monitor = RouteOffRouteMonitor()
        for _ in 0..<5 {
            XCTAssertEqual(
                monitor.update(
                    distanceFromRouteMeters: 200,
                    horizontalAccuracyMeters: 80
                ),
                .onRoute
            )
        }
    }

    func testCompletionRequiresProgressAndConsecutiveFinishReadings() throws {
        let route = verifiedRoute(
            path: [point(0, 0), point(0, 0.001)]
        )
        var engine = RouteGuidanceEngine(
            plan: try XCTUnwrap(RouteGuidancePlan(route: route))
        )

        _ = engine.process(sample(point(0, 0.00085)))
        let firstFinish = try XCTUnwrap(
            engine.process(sample(point(0, 0.001), seconds: 1))
        )
        let secondFinish = try XCTUnwrap(
            engine.process(sample(point(0, 0.001), seconds: 2))
        )

        XCTAssertFalse(firstFinish.isComplete)
        XCTAssertTrue(secondFinish.isComplete)
    }

    func testNoUpdateTimeoutIsDeterministic() {
        var monitor = RouteLocationStalenessMonitor()
        let start = Date(timeIntervalSince1970: 1_000)
        monitor.recordUpdate(at: start)

        XCTAssertFalse(monitor.isDelayed(at: start.addingTimeInterval(29.9)))
        XCTAssertTrue(monitor.isDelayed(at: start.addingTimeInterval(30)))
    }

    func testGuidanceFailsClosedForUnverifiedMalformedAndLegacyRoutes() throws {
        let valid = verifiedRoute(
            path: [point(0, 0), point(0, 0.001)]
        )
        XCTAssertTrue(RouteGuidanceEligibility(route: valid).isEligible)

        let demo = replacing(valid, provenance: .demo(.testFixture))
        XCTAssertEqual(
            RouteGuidanceEligibility(route: demo).failure,
            .unverifiedRoute
        )

        let routed = try XCTUnwrap(valid.routedProvenance)
        let legacy = replacing(
            valid,
            provenance: .routed(
                RoutedRouteProvenance(
                    provider: routed.provider,
                    strategy: routed.strategy,
                    factFingerprint: routed.factFingerprint
                )
            )
        )
        XCTAssertEqual(
            RouteGuidanceEligibility(route: legacy).failure,
            .guidanceIntegrityUnavailable
        )

        let tooShort = verifiedRoute(
            path: [point(0, 0), point(0, 0.00001)]
        )
        XCTAssertEqual(
            RouteGuidanceEligibility(route: tooShort).failure,
            .unusableGeometry
        )
    }

    func testInstructionModificationInvalidatesGuidanceIntegrity() {
        let original = verifiedRoute(
            path: [point(0, 0), point(0, 0.001)],
            instructions: [instruction("Continue", longitude: 0.0005)]
        )
        let modified = replacing(
            original,
            instructions: [instruction("Unverified shortcut", longitude: 0.0005)]
        )

        XCTAssertTrue(original.isVerifiedRoutedResult)
        XCTAssertEqual(
            RouteGuidanceEligibility(route: modified).failure,
            .guidanceIntegrityMismatch
        )
    }
}

@MainActor
final class RouteLocationTemporalGateTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000)

    func testExactAgeAndFutureSkewBoundariesAreAccepted() {
        var ageGate = RouteLocationTemporalGate()
        ageGate.beginMonitoring(at: now.addingTimeInterval(-10))
        XCTAssertTrue(
            ageGate.accept(
                timestamp: now.addingTimeInterval(-5),
                receivedAt: now
            )
        )

        var futureGate = RouteLocationTemporalGate()
        futureGate.beginMonitoring(at: now)
        XCTAssertTrue(
            futureGate.accept(
                timestamp: now.addingTimeInterval(1),
                receivedAt: now
            )
        )
    }

    func testSamplesBeyondAgeAndFutureSkewBoundariesAreRejected() {
        var staleGate = RouteLocationTemporalGate()
        staleGate.beginMonitoring(at: now.addingTimeInterval(-10))
        XCTAssertFalse(
            staleGate.accept(
                timestamp: now.addingTimeInterval(-5.001),
                receivedAt: now
            )
        )

        var futureGate = RouteLocationTemporalGate()
        futureGate.beginMonitoring(at: now)
        XCTAssertFalse(
            futureGate.accept(
                timestamp: now.addingTimeInterval(1.001),
                receivedAt: now
            )
        )
    }

    func testCachedSampleBeforeMonitoringIsRejectedAndBoundaryIsAccepted() {
        var gate = RouteLocationTemporalGate()
        gate.beginMonitoring(at: now)

        XCTAssertFalse(
            gate.accept(
                timestamp: now.addingTimeInterval(-0.001),
                receivedAt: now
            )
        )
        XCTAssertTrue(gate.accept(timestamp: now, receivedAt: now))
    }

    func testDuplicateEqualAndReversedTimestampsAreRejected() {
        var gate = RouteLocationTemporalGate()
        gate.beginMonitoring(at: now)
        let first = now.addingTimeInterval(0.5)

        XCTAssertTrue(gate.accept(timestamp: first, receivedAt: now))
        XCTAssertFalse(gate.accept(timestamp: first, receivedAt: now))
        XCTAssertFalse(
            gate.accept(
                timestamp: now.addingTimeInterval(0.25),
                receivedAt: now
            )
        )
    }

    func testPauseResumeIntervalRejectsPausedCacheAndRetainsOrdering() {
        var gate = RouteLocationTemporalGate()
        gate.beginMonitoring(at: now)
        XCTAssertTrue(gate.accept(timestamp: now, receivedAt: now))
        gate.endMonitoring()

        let resumedAt = now.addingTimeInterval(10)
        gate.beginMonitoring(at: resumedAt)
        XCTAssertFalse(
            gate.accept(
                timestamp: resumedAt.addingTimeInterval(-0.001),
                receivedAt: resumedAt
            )
        )
        XCTAssertTrue(
            gate.accept(timestamp: resumedAt, receivedAt: resumedAt)
        )
    }

    func testNewGateStartsANewNavigationSessionWithoutPriorOrderingState() {
        var firstSession = RouteLocationTemporalGate()
        firstSession.beginMonitoring(at: now)
        XCTAssertTrue(
            firstSession.accept(
                timestamp: now.addingTimeInterval(1),
                receivedAt: now
            )
        )

        var newSession = RouteLocationTemporalGate()
        newSession.beginMonitoring(at: now)
        XCTAssertTrue(newSession.accept(timestamp: now, receivedAt: now))
    }
}

@MainActor
final class RouteGuidanceModelTests: XCTestCase {
    func testDeniedRestrictedReducedAndDisabledPermissionsBlockGuidance() async {
        let cases: [(RouteLocationAuthorization, RouteGuidanceBlockReason)] = [
            (.denied, .permissionDenied),
            (.restricted, .permissionRestricted),
            (.reducedAccuracy, .preciseLocationRequired),
            (.servicesDisabled, .locationServicesDisabled)
        ]

        for (authorization, expected) in cases {
            let harness = makeHarness(authorization: authorization)
            await harness.model.start()
            XCTAssertEqual(harness.model.phase, .blocked(expected))
            XCTAssertFalse(harness.awake.isGuidanceActive)
            XCTAssertEqual(harness.location.startCount, 0)
        }
    }

    func testNotDeterminedPermissionRequestsWhenInUseThenStarts() async {
        let harness = makeHarness(
            authorization: .notDetermined,
            requestedAuthorization: .authorized
        )

        await harness.model.start()

        XCTAssertEqual(harness.location.requestCount, 1)
        XCTAssertEqual(harness.model.phase, .guiding)
        XCTAssertTrue(harness.awake.isGuidanceActive)
        XCTAssertEqual(harness.location.startCount, 1)
        harness.model.shutdown()
    }

    func testPauseResumeBackgroundAndEndCancelLocationAndRestoreAwakeState() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        XCTAssertEqual(harness.model.phase, .guiding)
        XCTAssertTrue(harness.awake.isGuidanceActive)

        harness.model.pause()
        XCTAssertEqual(harness.model.phase, .paused(.user))
        XCTAssertFalse(harness.awake.isGuidanceActive)

        harness.model.resume()
        XCTAssertEqual(harness.model.phase, .guiding)
        XCTAssertTrue(harness.awake.isGuidanceActive)

        let startsBeforeBackground = harness.location.startCount
        let stopsBeforeBackground = harness.location.stopCount
        harness.model.appDidEnterBackground()
        XCTAssertEqual(harness.model.phase, .guiding)
        XCTAssertFalse(harness.awake.isGuidanceActive)

        XCTAssertEqual(harness.location.stopCount, stopsBeforeBackground)
        await harness.model.appDidBecomeActive()
        XCTAssertEqual(harness.location.startCount, startsBeforeBackground)
        XCTAssertTrue(harness.awake.isGuidanceActive)
        harness.model.end()
        XCTAssertEqual(harness.model.phase, .ended)
        XCTAssertFalse(harness.awake.isGuidanceActive)
        XCTAssertGreaterThanOrEqual(harness.location.stopCount, 3)
    }

    func testEndCancelsStreamAndIgnoresLaterUpdates() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        harness.model.end()

        harness.location.send(sample(point(0, 0.0005)))
        await Task.yield()

        XCTAssertNil(harness.model.latestLocation)
        XCTAssertNil(harness.model.snapshot)
        XCTAssertEqual(harness.model.phase, .ended)
        XCTAssertGreaterThan(harness.location.stopCount, 0)
    }

    func testLocationServiceFailureMovesToRecoverableErrorAndStopsAwake() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        harness.location.finish(throwing: RouteLocationServiceError.unavailable)
        for _ in 0..<20 where harness.model.phase == .guiding {
            try? await Task.sleep(for: .milliseconds(10))
        }

        guard case .failed = harness.model.phase else {
            harness.model.shutdown()
            return XCTFail("Expected a recoverable failed phase")
        }
        XCTAssertFalse(harness.awake.isGuidanceActive)
        harness.model.shutdown()
    }

    func testRejectedSampleHasZeroEffectOnLocationSnapshotInstructionAndMapState() async {
        let route = verifiedRoute(
            path: [point(0, 0), point(0, 0.001), point(0, 0.002)],
            instructions: [
                instruction("Bear left", longitude: 0.0005),
                instruction("Continue", longitude: 0.0015)
            ]
        )
        let harness = makeHarness(authorization: .authorized, route: route)
        await harness.model.start()
        await sendAndDrain(
            sample(point(0, 0.0002), seconds: 0),
            through: harness
        )
        let acceptedLocation = harness.model.latestLocation
        let acceptedSnapshot = harness.model.snapshot
        let acceptedMapSummary = harness.model.mapAccessibilitySummary

        await sendAndDrain(
            sample(point(0, 0.0012), seconds: -0.001),
            through: harness
        )

        XCTAssertEqual(harness.model.latestLocation, acceptedLocation)
        XCTAssertEqual(harness.model.snapshot, acceptedSnapshot)
        XCTAssertEqual(
            harness.model.snapshot?.nextInstruction?.text,
            "Bear left"
        )
        XCTAssertEqual(harness.model.mapAccessibilitySummary, acceptedMapSummary)
        harness.model.shutdown()
    }

    func testRejectedOffRouteSamplesDoNotIncrementHysteresisCounter() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        await sendAndDrain(sample(point(0, 0), seconds: 0), through: harness)

        for _ in 0..<3 {
            await sendAndDrain(
                sample(point(0.001, 0), seconds: -0.001),
                through: harness
            )
        }

        for second in 1...2 {
            harness.clock.date = Date(timeIntervalSince1970: 1_000 + Double(second))
            await sendAndDrain(
                sample(point(0.001, 0), seconds: Double(second)),
                through: harness
            )
            XCTAssertEqual(harness.model.snapshot?.adherence, .onRoute)
        }
        harness.clock.date = Date(timeIntervalSince1970: 1_003)
        await sendAndDrain(
            sample(point(0.001, 0), seconds: 3),
            through: harness
        )
        guard case .offRoute = harness.model.snapshot?.adherence else {
            harness.model.shutdown()
            return XCTFail("Only three fresh samples should enter off-route state")
        }
        harness.model.shutdown()
    }

    func testRejectedFinishSamplesCannotCompleteGuidance() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        await sendAndDrain(
            sample(point(0, 0.00085), seconds: 0),
            through: harness
        )
        for _ in 0..<2 {
            await sendAndDrain(
                sample(point(0, 0.001), seconds: -0.001),
                through: harness
            )
        }

        harness.clock.date = Date(timeIntervalSince1970: 1_001)
        await sendAndDrain(
            sample(point(0, 0.001), seconds: 1),
            through: harness
        )
        XCTAssertEqual(harness.model.phase, .guiding)
        harness.clock.date = Date(timeIntervalSince1970: 1_002)
        await sendAndDrain(
            sample(point(0, 0.001), seconds: 2),
            through: harness
        )
        XCTAssertEqual(harness.model.phase, .completed)
        let completedLocation = harness.model.latestLocation
        await sendAndDrain(
            sample(point(0.001, 0), seconds: 3),
            through: harness
        )
        XCTAssertEqual(harness.model.latestLocation, completedLocation)
        XCTAssertEqual(harness.model.phase, .completed)
    }

    func testRejectedSampleCannotClearLocationDelay() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        await drainTasks()
        harness.clock.advance(by: 30)
        await drainTasks()
        XCTAssertTrue(harness.model.isLocationDelayed)

        await sendAndDrain(
            sample(point(0, 0.0005), seconds: 0),
            through: harness
        )
        XCTAssertTrue(harness.model.isLocationDelayed)
        XCTAssertNil(harness.model.latestLocation)
        harness.model.shutdown()
    }

    func testPauseResumeRejectsCachedAndPausedSamplesButAcceptsFreshSample() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        await sendAndDrain(sample(point(0, 0), seconds: 0), through: harness)
        harness.model.pause()
        harness.clock.date = Date(timeIntervalSince1970: 1_001)
        await sendAndDrain(
            sample(point(0, 0.0005), seconds: 1),
            through: harness
        )
        XCTAssertEqual(harness.model.latestLocation?.coordinate, point(0, 0))

        harness.model.resume()
        await sendAndDrain(
            sample(point(0, 0.00025), seconds: 0),
            through: harness
        )
        XCTAssertEqual(harness.model.latestLocation?.coordinate, point(0, 0))
        await sendAndDrain(
            sample(point(0, 0.0005), seconds: 1),
            through: harness
        )
        XCTAssertEqual(
            harness.model.latestLocation?.coordinate,
            point(0, 0.0005)
        )
        harness.model.shutdown()
    }

    func testSettingsRecoveryRechecksAuthorizationWhenAppBecomesActive() async {
        let harness = makeHarness(authorization: .denied)
        await harness.model.start()
        XCTAssertEqual(harness.model.phase, .blocked(.permissionDenied))

        harness.location.authorization = .authorized
        await harness.model.appDidBecomeActive()

        XCTAssertEqual(harness.model.phase, .guiding)
        XCTAssertEqual(harness.location.startCount, 1)
        harness.model.shutdown()
    }

    func testFailureRetryRejectsPriorStreamCacheAndAcceptsFreshFix() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        await sendAndDrain(sample(point(0, 0), seconds: 0), through: harness)
        harness.location.finish(throwing: RouteLocationServiceError.unavailable)
        for _ in 0..<20 where harness.model.phase == .guiding {
            try? await Task.sleep(for: .milliseconds(10))
        }
        guard case .failed = harness.model.phase else {
            return XCTFail("Expected the location stream failure to be observed")
        }

        harness.clock.date = Date(timeIntervalSince1970: 1_001)
        await harness.model.retry()
        XCTAssertEqual(harness.model.locationStatus, .locating)
        await sendAndDrain(
            sample(point(0, 0.00025), seconds: 0),
            through: harness
        )
        XCTAssertEqual(harness.model.latestLocation?.coordinate, point(0, 0))

        await sendAndDrain(
            sample(point(0, 0.0005), seconds: 1),
            through: harness
        )
        XCTAssertEqual(
            harness.model.latestLocation?.coordinate,
            point(0, 0.0005)
        )
        harness.model.shutdown()
    }

    func testStatusNeedsReliableCurrentFixAfterStartAndResume() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        XCTAssertEqual(harness.model.locationStatus, .locating)

        await sendAndDrain(sample(point(0, 0), accuracy: 100), through: harness)
        XCTAssertEqual(harness.model.locationStatus, .locating)
        harness.clock.date = Date(timeIntervalSince1970: 1_001)
        await sendAndDrain(sample(point(0, 0), seconds: 1), through: harness)
        XCTAssertEqual(harness.model.locationStatus, .onRoute)

        harness.model.pause()
        // Resume in the same clock instant: the previous fix still cannot count.
        harness.model.resume()
        XCTAssertNotNil(harness.model.snapshot, "The map may retain the previous snapshot")
        XCTAssertEqual(harness.model.locationStatus, .locating)
        harness.clock.date = Date(timeIntervalSince1970: 1_002)
        await sendAndDrain(sample(point(0, 0.0001), seconds: 2), through: harness)
        XCTAssertEqual(harness.model.locationStatus, .onRoute)
        harness.model.shutdown()
    }

    func testStatusLosesConfirmationForInaccurateAndDelayedUpdates() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        await sendAndDrain(sample(point(0, 0)), through: harness)
        XCTAssertEqual(harness.model.locationStatus, .onRoute)
        harness.clock.date = Date(timeIntervalSince1970: 1_001)
        await sendAndDrain(sample(point(0, 0), accuracy: 100, seconds: 1), through: harness)
        XCTAssertEqual(harness.model.locationStatus, .locating)
        harness.clock.date = Date(timeIntervalSince1970: 1_002)
        await sendAndDrain(sample(point(0, 0), seconds: 2), through: harness)
        XCTAssertEqual(harness.model.locationStatus, .onRoute)
        await drainTasks()
        harness.clock.advance(by: 30)
        await drainTasks()
        XCTAssertTrue(harness.model.isLocationDelayed)
        XCTAssertEqual(harness.model.locationStatus, .locating)
        harness.model.shutdown()
    }

    func testFirstDistantFixDoesNotClaimOnRouteDuringWarningHysteresis() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        await sendAndDrain(sample(point(0.002, 0.0005)), through: harness)
        XCTAssertEqual(harness.model.snapshot?.adherence, .onRoute)
        XCTAssertEqual(harness.model.locationStatus, .checkRoute)
        harness.model.shutdown()
    }

    func testBackgroundContinuesProgressWithoutRestartingStream() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        await sendAndDrain(sample(point(0, 0.0002)), through: harness)
        let before = harness.model.snapshot?.metrics.progressFraction ?? 0
        let starts = harness.location.startCount
        let stops = harness.location.stopCount
        harness.model.appDidEnterBackground()
        await sendAndDrain(sample(point(0, 0.0006), seconds: 1), through: harness)
        XCTAssertEqual(harness.model.phase, .guiding)
        XCTAssertGreaterThan(harness.model.snapshot?.metrics.progressFraction ?? 0, before)
        XCTAssertEqual(harness.location.startCount, starts)
        XCTAssertEqual(harness.location.stopCount, stops)
        harness.model.pause()
        await harness.model.appDidBecomeActive()
        XCTAssertEqual(harness.model.phase, .paused(.user))
        XCTAssertFalse(harness.awake.isGuidanceActive)
        harness.model.end()
    }

    func testPermissionRevokedDuringBackgroundStopsSession() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        harness.model.appDidEnterBackground()
        harness.location.authorization = .denied
        await harness.model.appDidBecomeActive()
        XCTAssertEqual(harness.model.phase, .blocked(.permissionDenied))
        XCTAssertFalse(harness.awake.isGuidanceActive)
        harness.model.end()
    }

    func testMissingBackgroundConfigurationFailsHonestly() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        harness.location.finish(throwing: RouteLocationServiceError.backgroundModeUnavailable)
        await drainTasks()
        guard case .failed = harness.model.phase else {
            return XCTFail("Missing background mode must not claim active guidance")
        }
        XCTAssertFalse(harness.awake.isGuidanceActive)
        harness.model.end()
    }

    func testPreparedRouteReopensWithInstructionsAndGuidesWithoutNetworkService() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let route = verifiedRoute(path: [point(0, 0), point(0, 0.002)],
                                  instructions: [instruction("Turn left", longitude: 0.001)])
        _ = try await LocalSavedRouteStore(directoryURL: directory).save(route, at: .now)
        let reloaded = try await LocalSavedRouteStore(directoryURL: directory).load()
        XCTAssertTrue(RouteOfflineReadiness.hasMatchingRoute(route, in: reloaded.snapshots))
        let restored = try XCTUnwrap(reloaded.snapshots.first?.route)
        XCTAssertEqual(restored.routeInstructions, route.routeInstructions)
        let harness = makeHarness(authorization: .authorized, route: restored)
        await harness.model.start()
        await sendAndDrain(sample(point(0, 0.0005)), through: harness)
        XCTAssertNotNil(harness.model.snapshot)
        XCTAssertEqual(harness.model.snapshot?.nextInstruction?.text, "Turn left")
        harness.model.end()
        try await LocalSavedRouteStore(directoryURL: directory).remove(routeID: route.id)
        let afterDeletion = try await LocalSavedRouteStore(directoryURL: directory).load()
        XCTAssertFalse(RouteOfflineReadiness.hasMatchingRoute(route, in: afterDeletion.snapshots))
    }

    private func makeHarness(
        authorization: RouteLocationAuthorization,
        requestedAuthorization: RouteLocationAuthorization? = nil,
        route: TrailRoute? = nil
    ) -> RouteGuidanceHarness {
        let location = TestRouteLocationService(
            authorization: authorization,
            requestedAuthorization: requestedAuthorization ?? authorization
        )
        let clock = TestRouteGuidanceClock()
        let awake = TestRouteScreenAwakeController()
        let dependencies = RouteGuidanceDependencies(
            makeLocationService: { _ in location },
            makeClock: { clock },
            makeScreenAwakeController: { awake }
        )
        return RouteGuidanceHarness(
            model: RouteGuidanceModel(
                route: route ?? verifiedRoute(
                    path: [point(0, 0), point(0, 0.001)]
                ),
                dependencies: dependencies
            ),
            location: location,
            clock: clock,
            awake: awake
        )
    }
}

@MainActor
private struct RouteGuidanceHarness {
    let model: RouteGuidanceModel
    let location: TestRouteLocationService
    let clock: TestRouteGuidanceClock
    let awake: TestRouteScreenAwakeController
}

@MainActor
private final class TestRouteLocationService: RouteLocationProviding {
    var authorization: RouteLocationAuthorization
    let requestedAuthorization: RouteLocationAuthorization
    private(set) var requestCount = 0
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private var continuation:
        AsyncThrowingStream<RouteLocationSample, Error>.Continuation?

    init(
        authorization: RouteLocationAuthorization,
        requestedAuthorization: RouteLocationAuthorization
    ) {
        self.authorization = authorization
        self.requestedAuthorization = requestedAuthorization
    }

    func requestWhenInUseAuthorization() async -> RouteLocationAuthorization {
        requestCount += 1
        authorization = requestedAuthorization
        return authorization
    }

    func locationUpdates() -> AsyncThrowingStream<RouteLocationSample, Error> {
        startCount += 1
        return AsyncThrowingStream { continuation in
            self.continuation = continuation
        }
    }

    func stopUpdatingLocation() {
        stopCount += 1
        let active = continuation
        continuation = nil
        active?.finish()
    }

    func send(_ sample: RouteLocationSample) {
        continuation?.yield(sample)
    }

    func finish(throwing error: Error) {
        let active = continuation
        continuation = nil
        active?.finish(throwing: error)
    }
}

@MainActor
private final class TestRouteGuidanceClock: RouteGuidanceClock {
    var date = Date(timeIntervalSince1970: 1_000)
    private var sleepers: [UUID: CheckedContinuation<Void, Error>] = [:]

    func now() -> Date { date }

    func sleep(seconds: TimeInterval) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation {
                (continuation: CheckedContinuation<Void, Error>) in
                guard !Task.isCancelled else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                sleepers[id] = continuation
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                self?.cancelSleep(id)
            }
        }
    }

    func advance(by seconds: TimeInterval) {
        date = date.addingTimeInterval(seconds)
        let pending = sleepers.values
        sleepers.removeAll()
        pending.forEach { $0.resume() }
    }

    private func cancelSleep(_ id: UUID) {
        sleepers.removeValue(forKey: id)?.resume(
            throwing: CancellationError()
        )
    }
}

@MainActor
private final class TestRouteScreenAwakeController:
    RouteScreenAwakeControlling
{
    private(set) var isGuidanceActive = false

    func setGuidanceActive(_ isActive: Bool) {
        isGuidanceActive = isActive
    }
}

@MainActor
private func point(_ latitude: Double, _ longitude: Double) -> Coordinate {
    Coordinate(latitude: latitude, longitude: longitude)
}

@MainActor
private func sample(
    _ coordinate: Coordinate,
    accuracy: Double = 5,
    seconds: TimeInterval = 0
) -> RouteLocationSample {
    RouteLocationSample(
        coordinate: coordinate,
        horizontalAccuracyMeters: accuracy,
        timestamp: Date(timeIntervalSince1970: 1_000 + seconds)
    )
}

@MainActor
private func sendAndDrain(
    _ sample: RouteLocationSample,
    through harness: RouteGuidanceHarness
) async {
    harness.location.send(sample)
    await drainTasks()
}

@MainActor
private func drainTasks() async {
    for _ in 0..<8 { await Task.yield() }
}

@MainActor
private func instruction(_ text: String, longitude: Double) -> RouteInstruction {
    RouteInstruction(
        text: text,
        streetName: nil,
        distanceMeters: 50,
        durationSeconds: 30,
        sign: 0,
        coordinate: point(0, longitude)
    )
}

@MainActor
private func verifiedRoute(
    path: [Coordinate],
    distanceKilometers: Double = 1,
    durationHours: Double = 1,
    instructions: [RouteInstruction] = []
) -> TrailRoute {
    let elevationGain = 0
    let difficulty = RouteDifficulty.estimated(
        distanceKilometers: distanceKilometers,
        elevationGainMeters: elevationGain
    )
    let provenance = RouteProvenance.routingEngineOutput(
        provider: .graphHopper,
        strategy: .backend,
        activity: .hiking,
        routeType: .pointToPoint,
        distanceKilometers: distanceKilometers,
        elevationGainMeters: elevationGain,
        elevationLossMeters: 0,
        durationHours: durationHours,
        difficulty: difficulty,
        path: path,
        routeInstructions: instructions,
        verifiedCharacteristics: nil
    )
    return TrailRoute(
        id: UUID(),
        provenance: provenance,
        title: "Verified guidance route",
        location: "Test",
        activity: .hiking,
        distanceKilometers: distanceKilometers,
        elevationGainMeters: elevationGain,
        elevationLossMeters: 0,
        durationHours: durationHours,
        difficulty: difficulty,
        routeType: .pointToPoint,
        summary: "Verified test route",
        whyItMatches: "Verified test route",
        highlights: [],
        waypoints: [],
        days: [],
        safetyNotes: [],
        elevationProfile: [],
        path: path,
        routeInstructions: instructions
    )
}

@MainActor
private func replacing(
    _ route: TrailRoute,
    provenance: RouteProvenance? = nil,
    instructions: [RouteInstruction]? = nil
) -> TrailRoute {
    TrailRoute(
        id: route.id,
        provenance: provenance ?? route.provenance,
        title: route.title,
        location: route.location,
        activity: route.activity,
        distanceKilometers: route.distanceKilometers,
        elevationGainMeters: route.elevationGainMeters,
        elevationLossMeters: route.elevationLossMeters,
        durationHours: route.durationHours,
        difficulty: route.difficulty,
        routeType: route.routeType,
        summary: route.summary,
        whyItMatches: route.whyItMatches,
        highlights: route.highlights,
        waypoints: route.waypoints,
        days: route.days,
        safetyNotes: route.safetyNotes,
        elevationProfile: route.elevationProfile,
        path: route.path,
        routeInstructions: instructions ?? route.routeInstructions,
        planningMetadata: route.planningMetadata,
        intentDebugMetadata: route.intentDebugMetadata,
        verifiedCharacteristics: route.verifiedCharacteristics
    )
}

private extension TrailRoute {
    @MainActor
    var routedProvenance: RoutedRouteProvenance? {
        guard case let .routed(provenance) = provenance else { return nil }
        return provenance
    }
}

@MainActor
final class RouteLocationStreamSourceTests: XCTestCase {
    func testDelayedOldTerminationCannotStopReplacementStream() async throws {
        var stopCount = 0
        let source = RouteLocationStreamSource { stopCount += 1 }
        let oldStream = source.updates()
        source.finish()
        let replacement = source.updates()
        let stopsBeforeCleanup = stopCount

        // The old onTermination task is queued on this actor; replacement is
        // already installed before it can execute, reproducing the failing order.
        await drainTasks()
        XCTAssertTrue(source.isActive)
        XCTAssertEqual(stopCount, stopsBeforeCleanup)
        let fix = sample(point(0, 0))
        source.yield(fix)
        var iterator = replacement.makeAsyncIterator()
        let received = try await iterator.next()
        XCTAssertEqual(received, fix)
        var oldIterator = oldStream.makeAsyncIterator()
        let oldResult = try await oldIterator.next()
        XCTAssertNil(oldResult)
        source.finish()
    }

    func testFailureCleanupCannotStopRetryStream() async throws {
        var stopCount = 0
        let source = RouteLocationStreamSource { stopCount += 1 }
        let failed = source.updates()
        source.finish(throwing: RouteLocationServiceError.unavailable)
        let retry = source.updates()
        let stopsBeforeCleanup = stopCount
        await drainTasks()
        XCTAssertEqual(stopCount, stopsBeforeCleanup)
        XCTAssertTrue(source.isActive)
        var failedIterator = failed.makeAsyncIterator()
        do {
            _ = try await failedIterator.next()
            XCTFail("The original stream must preserve its failure")
        } catch {
            XCTAssertEqual(error as? RouteLocationServiceError, .unavailable)
        }
        let fix = sample(point(0, 0))
        source.yield(fix)
        var retryIterator = retry.makeAsyncIterator()
        let received = try await retryIterator.next()
        XCTAssertEqual(received, fix)
        source.finish()
    }

    func testCancellingCurrentConsumerStillStopsLocation() async {
        var stopCount = 0
        let source = RouteLocationStreamSource { stopCount += 1 }
        let stream = source.updates()
        let stopsBeforeCancellation = stopCount
        let consumer = Task {
            do {
                for try await _ in stream {}
            } catch {}
        }
        await drainTasks()
        consumer.cancel()
        await consumer.value
        await drainTasks()
        XCTAssertFalse(source.isActive)
        XCTAssertEqual(stopCount, stopsBeforeCancellation + 1)
    }
}
