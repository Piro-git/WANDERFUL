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
final class RouteLocationSampleTemporalGateTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000)

    func testExactAgeAndFutureBoundariesAreAccepted() {
        var ageGate = RouteLocationSampleTemporalGate()
        let exactAge = timestampedSample(
            at: now.addingTimeInterval(
                -RouteGuidancePolicy.v1.maximumLocationSampleAgeSeconds
            )
        )
        XCTAssertEqual(
            ageGate.evaluate(exactAge, receivedAt: now),
            .accepted
        )

        var futureGate = RouteLocationSampleTemporalGate()
        let exactFuture = timestampedSample(
            at: now.addingTimeInterval(
                RouteGuidancePolicy.v1.maximumLocationSampleFutureSkewSeconds
            )
        )
        XCTAssertEqual(
            futureGate.evaluate(exactFuture, receivedAt: now),
            .accepted
        )
    }

    func testCachedSampleBeyondAgeBoundaryIsRejectedWithoutWatermark() {
        var gate = RouteLocationSampleTemporalGate()
        let stale = timestampedSample(
            at: now.addingTimeInterval(
                -RouteGuidancePolicy.v1.maximumLocationSampleAgeSeconds - 0.001
            )
        )

        XCTAssertEqual(
            gate.evaluate(stale, receivedAt: now),
            .rejected(.stale)
        )
        XCTAssertNil(gate.lastAcceptedTimestamp)
    }

    func testSampleBeyondFutureSkewBoundaryIsRejectedWithoutWatermark() {
        var gate = RouteLocationSampleTemporalGate()
        let future = timestampedSample(
            at: now.addingTimeInterval(
                RouteGuidancePolicy.v1.maximumLocationSampleFutureSkewSeconds
                    + 0.001
            )
        )

        XCTAssertEqual(
            gate.evaluate(future, receivedAt: now),
            .rejected(.futureDated)
        )
        XCTAssertNil(gate.lastAcceptedTimestamp)
    }

    func testDuplicateSampleIsRejected() {
        var gate = RouteLocationSampleTemporalGate()
        let original = timestampedSample(at: now)

        XCTAssertEqual(gate.evaluate(original, receivedAt: now), .accepted)
        XCTAssertEqual(
            gate.evaluate(original, receivedAt: now),
            .rejected(.nonMonotonic)
        )
        XCTAssertEqual(gate.lastAcceptedTimestamp, original.timestamp)
    }

    func testDifferentSampleWithEqualTimestampIsRejected() {
        var gate = RouteLocationSampleTemporalGate()
        let first = timestampedSample(at: now, coordinate: point(0, 0))
        let equalTimestamp = timestampedSample(
            at: now,
            coordinate: point(0, 0.0005)
        )

        XCTAssertEqual(gate.evaluate(first, receivedAt: now), .accepted)
        XCTAssertEqual(
            gate.evaluate(equalTimestamp, receivedAt: now),
            .rejected(.nonMonotonic)
        )
        XCTAssertEqual(gate.lastAcceptedTimestamp, first.timestamp)
    }

    func testReversedSampleIsRejectedAndDoesNotPoisonLaterValidFix() {
        var gate = RouteLocationSampleTemporalGate()
        let first = timestampedSample(
            at: now.addingTimeInterval(1),
            coordinate: point(0, 0.0002)
        )
        let reversed = timestampedSample(
            at: now,
            coordinate: point(0, 0.0008)
        )
        let later = timestampedSample(
            at: now.addingTimeInterval(2),
            coordinate: point(0, 0.0009)
        )

        XCTAssertEqual(
            gate.evaluate(first, receivedAt: now.addingTimeInterval(1)),
            .accepted
        )
        XCTAssertEqual(
            gate.evaluate(reversed, receivedAt: now.addingTimeInterval(1)),
            .rejected(.nonMonotonic)
        )
        XCTAssertEqual(
            gate.evaluate(later, receivedAt: now.addingTimeInterval(2)),
            .accepted
        )
        XCTAssertEqual(gate.lastAcceptedTimestamp, later.timestamp)
    }

    func testResetStartsANewTemporalSession() {
        var gate = RouteLocationSampleTemporalGate()
        let sample = timestampedSample(at: now)
        XCTAssertEqual(gate.evaluate(sample, receivedAt: now), .accepted)

        gate.reset()

        XCTAssertNil(gate.lastAcceptedTimestamp)
        XCTAssertEqual(gate.evaluate(sample, receivedAt: now), .accepted)
    }

    func testNonFiniteTimestampsAreRejected() {
        var gate = RouteLocationSampleTemporalGate()
        let invalid = timestampedSample(
            at: Date(timeIntervalSinceReferenceDate: .nan)
        )

        XCTAssertEqual(
            gate.evaluate(invalid, receivedAt: now),
            .rejected(.invalidTimestamp)
        )
        XCTAssertNil(gate.lastAcceptedTimestamp)
    }

    private func timestampedSample(
        at timestamp: Date,
        coordinate: Coordinate = Coordinate(latitude: 0, longitude: 0)
    ) -> RouteLocationSample {
        RouteLocationSample(
            coordinate: coordinate,
            horizontalAccuracyMeters: 5,
            timestamp: timestamp
        )
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

        harness.model.appDidEnterBackground()
        XCTAssertEqual(harness.model.phase, .paused(.appBackgrounded))
        XCTAssertFalse(harness.awake.isGuidanceActive)

        harness.model.resume()
        harness.model.end()
        XCTAssertEqual(harness.model.phase, .ended)
        XCTAssertFalse(harness.awake.isGuidanceActive)
        XCTAssertGreaterThanOrEqual(harness.location.stopCount, 4)
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

    func testStaleCachedSampleCannotMutateLatestProgressStalenessOrMapState() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        let first = sample(point(0, 0.0002))
        harness.location.send(first)
        await assertEventually { harness.model.latestLocation == first }
        let snapshot = harness.model.snapshot
        let mapSummary = harness.model.mapAccessibilitySummary

        harness.clock.date = Date(timeIntervalSince1970: 1_030)
        let staleButNewer = sample(point(0, 0.0008), seconds: 14)
        harness.location.send(staleButNewer)
        await settleAsyncWork()
        harness.model.refreshLocationDelayState()

        XCTAssertEqual(harness.model.latestLocation, first)
        XCTAssertEqual(harness.model.snapshot, snapshot)
        XCTAssertEqual(harness.model.mapAccessibilitySummary, mapSummary)
        XCTAssertEqual(harness.model.lastAcceptedLocationTimestamp, first.timestamp)
        XCTAssertTrue(
            harness.model.isLocationDelayed,
            "A rejected cached sample must not refresh the no-update timer."
        )
        harness.model.shutdown()
    }

    func testFutureDatedSampleCannotMutateMapOrProgressAndDoesNotPoisonNextFix() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        let first = sample(point(0, 0.0002))
        harness.location.send(first)
        await assertEventually { harness.model.latestLocation == first }
        let firstSnapshot = harness.model.snapshot
        let firstMapSummary = harness.model.mapAccessibilitySummary

        harness.clock.date = Date(timeIntervalSince1970: 1_001)
        let future = sample(point(0.002, 0.0008), seconds: 6.001)
        harness.location.send(future)
        await settleAsyncWork()

        XCTAssertEqual(harness.model.latestLocation, first)
        XCTAssertEqual(harness.model.snapshot, firstSnapshot)
        XCTAssertEqual(harness.model.mapAccessibilitySummary, firstMapSummary)

        let next = sample(point(0, 0.0004), seconds: 1)
        harness.location.send(next)
        await assertEventually { harness.model.latestLocation == next }
        XCTAssertGreaterThan(
            harness.model.snapshot?.metrics.progressFraction ?? 0,
            firstSnapshot?.metrics.progressFraction ?? 0
        )
        harness.model.shutdown()
    }

    func testDuplicateEqualAndReversedSamplesHaveZeroDownstreamEffect() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        let first = sample(point(0, 0.0003))
        harness.location.send(first)
        await assertEventually { harness.model.latestLocation == first }
        let firstSnapshot = harness.model.snapshot
        let firstSummary = harness.model.mapAccessibilitySummary

        harness.location.send(first)
        harness.location.send(sample(point(0, 0.0008)))
        harness.location.send(sample(point(0.002, 0.0009), seconds: -1))
        await settleAsyncWork()

        XCTAssertEqual(harness.model.latestLocation, first)
        XCTAssertEqual(harness.model.snapshot, firstSnapshot)
        XCTAssertEqual(harness.model.mapAccessibilitySummary, firstSummary)
        XCTAssertEqual(harness.model.lastAcceptedLocationTimestamp, first.timestamp)
        harness.model.shutdown()
    }

    func testPauseResumePreservesWatermarkAndRestartsFreshnessWindow() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        let first = sample(point(0, 0.0002))
        harness.location.send(first)
        await assertEventually { harness.model.latestLocation == first }

        harness.model.pause()
        XCTAssertEqual(harness.model.lastAcceptedLocationTimestamp, first.timestamp)
        harness.clock.date = Date(timeIntervalSince1970: 1_001)
        harness.model.resume()
        XCTAssertEqual(harness.model.lastAcceptedLocationTimestamp, first.timestamp)

        let replayed = sample(point(0, 0.0007))
        harness.location.send(replayed)
        await settleAsyncWork()
        XCTAssertEqual(harness.model.latestLocation, first)

        harness.clock.date = Date(timeIntervalSince1970: 1_030.9)
        harness.model.refreshLocationDelayState()
        XCTAssertFalse(harness.model.isLocationDelayed)
        harness.clock.date = Date(timeIntervalSince1970: 1_031)
        harness.model.refreshLocationDelayState()
        XCTAssertTrue(harness.model.isLocationDelayed)

        let fresh = sample(point(0, 0.0007), seconds: 31)
        harness.location.send(fresh)
        await assertEventually { harness.model.latestLocation == fresh }
        XCTAssertFalse(harness.model.isLocationDelayed)

        harness.model.end()
        XCTAssertNil(harness.model.lastAcceptedLocationTimestamp)
    }

    func testFailureAndRetryResetTemporalWatermark() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        let beforeFailure = sample(point(0, 0.0002))
        harness.location.send(beforeFailure)
        await assertEventually {
            harness.model.latestLocation == beforeFailure
        }

        harness.location.finish(throwing: RouteLocationServiceError.unavailable)
        await assertEventually {
            if case .failed = harness.model.phase { return true }
            return false
        }
        XCTAssertNil(harness.model.lastAcceptedLocationTimestamp)

        await harness.model.retry()
        let equalTimestampInNewAttempt = sample(point(0, 0.0004))
        harness.location.send(equalTimestampInNewAttempt)
        await assertEventually {
            harness.model.latestLocation == equalTimestampInNewAttempt
        }
        XCTAssertEqual(
            harness.model.lastAcceptedLocationTimestamp,
            equalTimestampInNewAttempt.timestamp
        )
        harness.model.shutdown()
    }

    func testNewNavigationModelAcceptsTimestampUsedByEndedSession() async {
        let firstSession = makeHarness(authorization: .authorized)
        await firstSession.model.start()
        let sharedTimestamp = sample(point(0, 0.0002))
        firstSession.location.send(sharedTimestamp)
        await assertEventually {
            firstSession.model.latestLocation == sharedTimestamp
        }
        firstSession.model.end()
        XCTAssertNil(firstSession.model.lastAcceptedLocationTimestamp)

        let secondSession = makeHarness(authorization: .authorized)
        XCTAssertNil(secondSession.model.lastAcceptedLocationTimestamp)
        await secondSession.model.start()
        let reusedTimestamp = sample(point(0, 0.0004))
        secondSession.location.send(reusedTimestamp)
        await assertEventually {
            secondSession.model.latestLocation == reusedTimestamp
        }
        XCTAssertEqual(secondSession.model.latestLocation, reusedTimestamp)
        secondSession.model.shutdown()
    }

    func testRejectedSamplesDoNotIncrementOffRouteCounter() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()
        let onRoute = sample(point(0, 0.0002))
        harness.location.send(onRoute)
        await assertEventually { harness.model.latestLocation == onRoute }
        let beforeRejectedSamples = harness.model.snapshot

        harness.location.send(sample(point(0.001, 0.0002), seconds: 6))
        harness.location.send(sample(point(0.001, 0.0002), seconds: 7))
        await settleAsyncWork()
        XCTAssertEqual(harness.model.snapshot, beforeRejectedSamples)

        for seconds in 1...2 {
            harness.clock.date = Date(
                timeIntervalSince1970: 1_000 + TimeInterval(seconds)
            )
            let offRoute = sample(
                point(0.001, 0.0002),
                seconds: TimeInterval(seconds)
            )
            harness.location.send(offRoute)
            await assertEventually {
                harness.model.latestLocation == offRoute
            }
            XCTAssertEqual(harness.model.snapshot?.adherence, .onRoute)
        }

        harness.clock.date = Date(timeIntervalSince1970: 1_003)
        let thirdOffRoute = sample(point(0.001, 0.0002), seconds: 3)
        harness.location.send(thirdOffRoute)
        await assertEventually {
            harness.model.latestLocation == thirdOffRoute
        }
        guard case .offRoute = harness.model.snapshot?.adherence else {
            harness.model.shutdown()
            return XCTFail("Three accepted off-route fixes should enter warning state.")
        }
        harness.model.shutdown()
    }

    func testRejectedFinishSamplesDoNotIncrementCompletionCounter() async {
        let harness = makeHarness(authorization: .authorized)
        await harness.model.start()

        let nearFinish = sample(point(0, 0.00085))
        harness.location.send(nearFinish)
        await assertEventually { harness.model.latestLocation == nearFinish }

        harness.clock.date = Date(timeIntervalSince1970: 1_001)
        let firstFinish = sample(point(0, 0.001), seconds: 1)
        harness.location.send(firstFinish)
        await assertEventually { harness.model.latestLocation == firstFinish }
        XCTAssertEqual(harness.model.phase, .guiding)

        harness.location.send(firstFinish)
        harness.location.send(sample(point(0, 0.001), seconds: 7))
        await settleAsyncWork()
        XCTAssertEqual(harness.model.phase, .guiding)
        XCTAssertFalse(harness.model.snapshot?.isComplete ?? true)

        harness.clock.date = Date(timeIntervalSince1970: 1_002)
        let secondFinish = sample(point(0, 0.001), seconds: 2)
        harness.location.send(secondFinish)
        await assertEventually { harness.model.phase == .completed }
        XCTAssertNil(harness.model.lastAcceptedLocationTimestamp)
    }

    func testRejectedSampleCannotAdvanceInstruction() async {
        let route = verifiedRoute(
            path: [point(0, 0), point(0, 0.001), point(0, 0.002)],
            instructions: [
                instruction("Bear left", longitude: 0.0005),
                instruction("Continue straight", longitude: 0.0015)
            ]
        )
        let harness = makeHarness(
            authorization: .authorized,
            route: route
        )
        await harness.model.start()
        let first = sample(point(0, 0.0002))
        harness.location.send(first)
        await assertEventually { harness.model.latestLocation == first }
        XCTAssertEqual(harness.model.snapshot?.nextInstruction?.text, "Bear left")

        harness.location.send(sample(point(0, 0.001), seconds: 6))
        await settleAsyncWork()
        XCTAssertEqual(harness.model.snapshot?.nextInstruction?.text, "Bear left")

        harness.clock.date = Date(timeIntervalSince1970: 1_001)
        let validAdvance = sample(point(0, 0.001), seconds: 1)
        harness.location.send(validAdvance)
        await assertEventually {
            harness.model.latestLocation == validAdvance
        }
        XCTAssertEqual(
            harness.model.snapshot?.nextInstruction?.text,
            "Continue straight"
        )
        harness.model.shutdown()
    }

    func testSettingsRecoveryRechecksRecoverablePermissionBlocks() async {
        for authorization in [
            RouteLocationAuthorization.denied,
            .reducedAccuracy,
            .servicesDisabled
        ] {
            let harness = makeHarness(authorization: authorization)
            await harness.model.start()
            harness.location.authorization = .authorized

            await harness.model.appDidBecomeActive()

            XCTAssertEqual(harness.model.phase, .guiding)
            XCTAssertEqual(harness.location.startCount, 1)
            XCTAssertTrue(harness.awake.isGuidanceActive)
            harness.model.shutdown()
        }
    }

    func testRestrictedPermissionDoesNotOfferFalseSettingsRecovery() async {
        let harness = makeHarness(authorization: .restricted)
        await harness.model.start()
        harness.location.authorization = .authorized

        await harness.model.appDidBecomeActive()

        XCTAssertEqual(harness.model.phase, .blocked(.permissionRestricted))
        XCTAssertEqual(harness.location.startCount, 0)
        XCTAssertFalse(harness.awake.isGuidanceActive)
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

    private func waitUntil(
        _ condition: @escaping @MainActor () -> Bool
    ) async -> Bool {
        for _ in 0..<100 {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(2))
        }
        return condition()
    }

    private func assertEventually(
        _ condition: @escaping @MainActor () -> Bool,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        let succeeded = await waitUntil(condition)
        XCTAssertTrue(succeeded, file: file, line: line)
    }

    private func settleAsyncWork() async {
        for _ in 0..<20 {
            await Task.yield()
        }
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

    func now() -> Date { date }

    func sleep(seconds: TimeInterval) async throws {
        try await Task.sleep(for: .seconds(3_600))
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
