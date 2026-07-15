import Foundation
import XCTest
@testable import TrailMind

final class SavedRouteStoreTests: XCTestCase {
    private var temporaryURLs: [URL] = []

    override func tearDown() {
        for url in temporaryURLs { try? FileManager.default.removeItem(at: url) }
        temporaryURLs = []
        super.tearDown()
    }

    @MainActor
    func testFreshStoreIsEmptyAndDoesNotSeedMocks() async throws {
        let store = makeStore()
        let result = try await store.load()

        XCTAssertTrue(result.snapshots.isEmpty)
        XCTAssertEqual(result.skippedRecordCount, 0)
        XCTAssertFalse(result.snapshots.contains { $0.id == MockRoutes.luneburgLoop.id })
    }

    @MainActor
    func testCompleteRouteSurvivesStoreRecreation() async throws {
        let directory = makeDirectoryURL()
        let route = makeCompleteRoute()
        let savedAt = Date(timeIntervalSince1970: 1_700_000_000)
        _ = try await LocalSavedRouteStore(directoryURL: directory).save(route, at: savedAt)

        let result = try await LocalSavedRouteStore(directoryURL: directory).load()
        let restored = try XCTUnwrap(result.snapshots.first?.route)

        XCTAssertEqual(result.snapshots.first?.savedAt, savedAt)
        XCTAssertEqual(restored.id, route.id)
        XCTAssertEqual(restored.title, route.title)
        XCTAssertEqual(restored.provenance, route.provenance)
        XCTAssertEqual(restored.location, route.location)
        XCTAssertEqual(restored.activity, route.activity)
        XCTAssertEqual(restored.routeType, route.routeType)
        XCTAssertEqual(restored.difficulty, route.difficulty)
        XCTAssertEqual(restored.distanceKilometers, route.distanceKilometers)
        XCTAssertEqual(restored.durationHours, route.durationHours)
        XCTAssertEqual(restored.elevationGainMeters, route.elevationGainMeters)
        XCTAssertEqual(restored.elevationLossMeters, route.elevationLossMeters)
        XCTAssertEqual(restored.path, route.path)
        XCTAssertEqual(restored.path.map(\.elevationMeters), route.path.map(\.elevationMeters))
        XCTAssertEqual(restored.elevationProfile, route.elevationProfile)
        XCTAssertEqual(restored.planningMetadata, route.planningMetadata)
        XCTAssertEqual(restored.verifiedCharacteristics, route.verifiedCharacteristics)
        XCTAssertEqual(restored.safetyNotes, route.safetyNotes)
        XCTAssertEqual(restored.routeInstructions, route.routeInstructions)
        XCTAssertEqual(restored.waypoints, route.waypoints)
        XCTAssertEqual(restored.days, route.days)
        XCTAssertEqual(restored.highlights, route.highlights)
        XCTAssertNil(restored.intentDebugMetadata)
        XCTAssertTrue(restored.isVerifiedRoutedResult)
    }

    @MainActor
    func testDemoRouteCannotBeSavedOrExported() async throws {
        let route = MockRoutes.luneburgLoop

        do {
            _ = try await makeStore().save(route, at: Date())
            XCTFail("Demo routes must not be persisted as normal saved routes.")
        } catch let error as RouteEligibilityError {
            guard case let .unverified(purpose, provenance) = error else {
                return XCTFail("Unexpected eligibility error: \(error)")
            }
            XCTAssertEqual(purpose, .persistence)
            XCTAssertEqual(provenance, .demo(.mock))
        }

        XCTAssertThrowsError(try DefaultGPXService().exportRouteAsGPX(route: route)) { error in
            guard
                let eligibilityError = error as? RouteEligibilityError,
                case let .unverified(purpose, provenance) = eligibilityError
            else { return XCTFail("Unexpected export error: \(error)") }
            XCTAssertEqual(purpose, .export)
            XCTAssertEqual(provenance, .demo(.mock))
        }
    }

    @MainActor
    func testChangedMetricsInvalidateOriginalRoutedEvidence() async throws {
        let route = makeCompleteRoute()
        let changedRoute = copy(route, distanceKilometers: route.distanceKilometers + 1)

        XCTAssertThrowsError(
            try RouteEligibilityPolicy.validate(changedRoute, for: .productionSuccess)
        ) { error in
            guard
                let eligibilityError = error as? RouteEligibilityError,
                case let .routedFactsChanged(purpose) = eligibilityError
            else { return XCTFail("Unexpected truth error: \(error)") }
            XCTAssertEqual(purpose, .productionSuccess)
        }
        do {
            _ = try await makeStore().save(changedRoute, at: Date())
            XCTFail("Changed facts must require a fresh routing response before saving.")
        } catch let error as RouteEligibilityError {
            guard case let .routedFactsChanged(purpose) = error else {
                return XCTFail("Unexpected save error: \(error)")
            }
            XCTAssertEqual(purpose, .persistence)
        }
    }

    @MainActor
    func testChangedVerifiedCharacteristicsInvalidateOriginalRoutedEvidence() throws {
        let route = makeCompleteRoute()
        let characteristics = try XCTUnwrap(route.verifiedCharacteristics)
        let changedCharacteristics = VerifiedRouteCharacteristics(
            routeDistanceMeters: characteristics.routeDistanceMeters,
            surfaceBreakdown: [
                VerifiedRouteCharacteristicValue(
                    value: "unpaved",
                    distanceMeters: 11_999
                )
            ],
            roadClassBreakdown: characteristics.roadClassBreakdown,
            hikeRatingBreakdown: characteristics.hikeRatingBreakdown,
            surfaceCoverageMeters: characteristics.surfaceCoverageMeters,
            roadClassCoverageMeters: characteristics.roadClassCoverageMeters,
            hikeRatingCoverageMeters: characteristics.hikeRatingCoverageMeters
        )
        let changedRoute = copy(
            route,
            verifiedCharacteristics: changedCharacteristics
        )

        XCTAssertFalse(changedRoute.isVerifiedRoutedResult)
        XCTAssertThrowsError(
            try RouteEligibilityPolicy.validate(changedRoute, for: .productionSuccess)
        ) { error in
            guard
                let eligibilityError = error as? RouteEligibilityError,
                case let .routedFactsChanged(purpose) = eligibilityError
            else { return XCTFail("Unexpected truth error: \(error)") }
            XCTAssertEqual(purpose, .productionSuccess)
        }
    }

    @MainActor
    func testGeometryFreeMockEditIsExplicitlyUnverified() async throws {
        let route = makeCompleteRoute()
        let edited = try await MockAIPlannerService().editRoute(
            route: route,
            instruction: "Make it shorter"
        )

        XCTAssertEqual(edited.provenance, .unverified(.modifiedWithoutRouting))
        XCTAssertEqual(edited.path, route.path)
        XCTAssertNotEqual(edited.distanceKilometers, route.distanceKilometers)
        XCTAssertFalse(edited.isVerifiedRoutedResult)
    }

    @MainActor
    func testSavingSameRouteTwiceDoesNotDuplicate() async throws {
        let store = makeStore()
        let route = makeCompleteRoute()
        _ = try await store.save(route, at: Date(timeIntervalSince1970: 100))
        _ = try await store.save(route, at: Date(timeIntervalSince1970: 200))

        let result = try await store.load()
        XCTAssertEqual(result.snapshots.count, 1)
        XCTAssertEqual(result.snapshots.first?.createdAt, Date(timeIntervalSince1970: 100))
        XCTAssertEqual(result.snapshots.first?.savedAt, Date(timeIntervalSince1970: 200))
    }

    @MainActor
    func testRemovingRoutePersistsAcrossStoreRecreation() async throws {
        let directory = makeDirectoryURL()
        let route = makeCompleteRoute()
        let store = LocalSavedRouteStore(directoryURL: directory)
        _ = try await store.save(route, at: Date())
        try await store.remove(routeID: route.id)

        let result = try await LocalSavedRouteStore(directoryURL: directory).load()
        XCTAssertTrue(result.snapshots.isEmpty)
    }

    @MainActor
    func testMultipleRoutesSortNewestFirst() async throws {
        let store = makeStore()
        let older = makeCompleteRoute(id: UUID())
        let newer = makeCompleteRoute(id: UUID())
        _ = try await store.save(older, at: Date(timeIntervalSince1970: 100))
        _ = try await store.save(newer, at: Date(timeIntervalSince1970: 200))

        let result = try await store.load()
        XCTAssertEqual(result.snapshots.map(\.id), [newer.id, older.id])
    }

    @MainActor
    func testSameSecondSaveOrderingSurvivesStoreRecreation() async throws {
        let directory = makeDirectoryURL()
        let store = LocalSavedRouteStore(directoryURL: directory)
        let older = makeCompleteRoute(
            id: try XCTUnwrap(UUID(uuidString: "00000000-0000-0000-0000-000000000001"))
        )
        let newer = makeCompleteRoute(
            id: try XCTUnwrap(UUID(uuidString: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"))
        )
        let olderDate = Date(timeIntervalSince1970: 1_000.125)
        let newerDate = Date(timeIntervalSince1970: 1_000.875)
        _ = try await store.save(older, at: olderDate)
        _ = try await store.save(newer, at: newerDate)

        let recreated = try await LocalSavedRouteStore(directoryURL: directory).load()

        XCTAssertEqual(recreated.snapshots.map(\.id), [newer.id, older.id])
        XCTAssertEqual(
            try XCTUnwrap(recreated.snapshots.first?.savedAt).timeIntervalSince1970,
            newerDate.timeIntervalSince1970,
            accuracy: 0.001
        )
        XCTAssertEqual(
            try XCTUnwrap(recreated.snapshots.last?.savedAt).timeIntervalSince1970,
            olderDate.timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    @MainActor
    func testWholeSecondISO8601TimestampsRemainBackwardCompatible() async throws {
        let directory = makeDirectoryURL()
        let route = makeCompleteRoute()
        let store = LocalSavedRouteStore(directoryURL: directory)
        _ = try await store.save(route, at: Date(timeIntervalSince1970: 1_000.5))
        let url = directory
            .appendingPathComponent(route.id.uuidString)
            .appendingPathExtension("json")
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        )
        object["savedAt"] = "1970-01-01T00:16:40Z"
        object["createdAt"] = "1970-01-01T00:16:40Z"
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            .write(to: url, options: .atomic)

        let restored = try await LocalSavedRouteStore(directoryURL: directory).load()

        XCTAssertEqual(restored.snapshots.map(\.id), [route.id])
        XCTAssertEqual(restored.snapshots.first?.savedAt, Date(timeIntervalSince1970: 1_000))
        XCTAssertEqual(restored.snapshots.first?.createdAt, Date(timeIntervalSince1970: 1_000))
    }

    @MainActor
    func testCorruptRecordDoesNotPreventValidRouteLoading() async throws {
        let directory = makeDirectoryURL()
        let store = LocalSavedRouteStore(directoryURL: directory)
        let route = makeCompleteRoute()
        _ = try await store.save(route, at: Date())
        try Data("not-json".utf8).write(to: directory.appendingPathComponent("corrupt.json"))

        let result = try await store.load()
        XCTAssertEqual(result.snapshots.map(\.id), [route.id])
        XCTAssertEqual(result.skippedRecordCount, 1)
        XCTAssertEqual(result.recoveryReport.corruptRecordCount, 1)
    }

    @MainActor
    func testVersionTwoRecordWithMismatchedFactsIsSkippedSafely() async throws {
        let directory = makeDirectoryURL()
        let route = makeCompleteRoute()
        let store = LocalSavedRouteStore(directoryURL: directory)
        _ = try await store.save(route, at: Date())

        let url = directory
            .appendingPathComponent(route.id.uuidString)
            .appendingPathExtension("json")
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        )
        object["distanceKilometers"] = route.distanceKilometers + 1
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            .write(to: url, options: .atomic)

        let result = try await LocalSavedRouteStore(directoryURL: directory).load()

        XCTAssertTrue(result.snapshots.isEmpty)
        XCTAssertEqual(result.skippedRecordCount, 1)
        XCTAssertEqual(result.recoveryReport.invalidRecordCount, 1)
    }

    @MainActor
    func testUnsupportedSchemaIsSkippedSafely() async throws {
        let directory = makeDirectoryURL()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data(#"{"schemaVersion":999,"future":"value"}"#.utf8)
            .write(to: directory.appendingPathComponent("future.json"))

        let result = try await LocalSavedRouteStore(directoryURL: directory).load()
        XCTAssertTrue(result.snapshots.isEmpty)
        XCTAssertEqual(result.skippedRecordCount, 1)
        XCTAssertEqual(result.recoveryReport.unsupportedSchemaRecordCount, 1)
    }

    @MainActor
    func testLegacySchemaMigratesConservativelyWithoutDataLoss() async throws {
        let directory = makeDirectoryURL()
        let route = makeCompleteRoute()
        let store = LocalSavedRouteStore(directoryURL: directory)
        _ = try await store.save(route, at: Date(timeIntervalSince1970: 123))

        let url = directory
            .appendingPathComponent(route.id.uuidString)
            .appendingPathExtension("json")
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        )
        object["schemaVersion"] = 1
        object.removeValue(forKey: "provenance")
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            .write(to: url, options: .atomic)

        let result = try await LocalSavedRouteStore(directoryURL: directory).load()
        let restored = try XCTUnwrap(result.snapshots.first?.route)

        XCTAssertEqual(result.skippedRecordCount, 0)
        XCTAssertEqual(result.recoveryReport.recoveredLegacyRecordCount, 1)
        XCTAssertEqual(restored.id, route.id)
        XCTAssertEqual(restored.path, route.path)
        XCTAssertEqual(restored.distanceKilometers, route.distanceKilometers)
        XCTAssertEqual(restored.provenance, .unverified(.legacyRecord))
        XCTAssertFalse(restored.isVerifiedRoutedResult)
        XCTAssertThrowsError(try DefaultGPXService().exportRouteAsGPX(route: restored)) { error in
            guard
                let eligibilityError = error as? RouteEligibilityError,
                case let .unverified(purpose, provenance) = eligibilityError
            else { return XCTFail("Unexpected legacy export error: \(error)") }
            XCTAssertEqual(purpose, .export)
            XCTAssertEqual(provenance, .unverified(.legacyRecord))
        }
    }

    @MainActor
    func testVerifiedSaveDoesNotSilentlyUpgradeExistingLegacyRecord() async throws {
        let directory = makeDirectoryURL()
        let route = makeCompleteRoute()
        let store = LocalSavedRouteStore(directoryURL: directory)
        _ = try await store.save(route, at: Date(timeIntervalSince1970: 123))
        let url = directory
            .appendingPathComponent(route.id.uuidString)
            .appendingPathExtension("json")
        var object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        )
        object["schemaVersion"] = 1
        object.removeValue(forKey: "provenance")
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            .write(to: url, options: .atomic)

        do {
            _ = try await store.save(route, at: Date(timeIntervalSince1970: 456))
            XCTFail("A legacy record must not be upgraded by replacement under the same identity.")
        } catch let error as SavedRouteStoreError {
            XCTAssertEqual(error, .writeFailed)
        }

        let result = try await store.load()
        let restored = try XCTUnwrap(result.snapshots.first)
        XCTAssertEqual(restored.savedAt, Date(timeIntervalSince1970: 123))
        XCTAssertEqual(restored.route.provenance, .unverified(.legacyRecord))
        XCTAssertFalse(restored.route.isVerifiedRoutedResult)
    }

    @MainActor
    func testWriteFailureDoesNotPublishFalseSavedState() async {
        let invalidDirectory = makeDirectoryURL()
        try? Data("file".utf8).write(to: invalidDirectory)
        let model = SavedRoutesModel(store: LocalSavedRouteStore(directoryURL: invalidDirectory))
        let route = makeCompleteRoute()

        await model.save(route)

        XCTAssertFalse(model.isSaved(route))
        XCTAssertTrue(model.routes.isEmpty)
        XCTAssertNotNil(model.errorMessage)
    }

    @MainActor
    func testSavedGeneratedRouteAppearsInSharedModelAndCanBeRemoved() async {
        let model = SavedRoutesModel(store: InMemorySavedRouteStore())
        let route = makeCompleteRoute()
        await model.loadIfNeeded()

        await model.save(route)
        XCTAssertEqual(model.routes.map(\.id), [route.id])
        XCTAssertTrue(model.isSaved(route))

        await model.remove(routeID: route.id)
        XCTAssertTrue(model.routes.isEmpty)
        XCTAssertFalse(model.isSaved(route))
    }

    @MainActor
    func testRestoredRouteProducesGPXWithAllTrackPoints() async throws {
        let store = makeStore()
        let route = makeCompleteRoute()
        _ = try await store.save(route, at: Date())
        let result = try await store.load()
        let restored = try XCTUnwrap(result.snapshots.first?.route)

        let gpx = try DefaultGPXService().exportRouteAsGPX(route: restored)
        XCTAssertTrue(gpx.contains(restored.title))
        XCTAssertEqual(gpx.components(separatedBy: "<trkpt ").count - 1, restored.path.count)
        XCTAssertTrue(gpx.contains("lat=\"51.8666\""))
    }

    @MainActor
    func testRepresentativeEncodedSizeIsReasonable() async throws {
        let route = makeCompleteRoute(pathPointCount: 2_000)
        let bytes = try await makeStore().encodedSize(of: route)

        XCTAssertGreaterThan(bytes, 1_000)
        XCTAssertLessThan(bytes, 1_000_000)
        print("Representative saved route size (2,000 points): \(bytes) bytes")
    }

    @MainActor
    func testVerifiedRouteCanBeSavedAtPersistenceBoundary() async throws {
        let store = makeStore()
        let route = makeCompleteRoute()

        let snapshot = try await store.save(route, at: Date(timeIntervalSince1970: 100))
        let result = try await store.load()

        XCTAssertEqual(snapshot.route, route)
        XCTAssertTrue(snapshot.route.isVerifiedRoutedResult)
        XCTAssertEqual(result.snapshots.map(\.id), [route.id])
    }

    @MainActor
    func testUnverifiedLegacyModifiedAndUnknownRoutesAreRejected() async throws {
        let provenances: [RouteProvenance] = [
            .unverified(.legacyRecord),
            .unverified(.modifiedWithoutRouting),
            .unverified(.unknown)
        ]

        for provenance in provenances {
            let route = copy(makeCompleteRoute(), provenance: provenance)
            do {
                _ = try await makeStore().save(route, at: Date())
                XCTFail("Unverified provenance must not be newly persisted: \(provenance)")
            } catch let error as RouteEligibilityError {
                guard case let .unverified(purpose, rejectedProvenance) = error else {
                    return XCTFail("Unexpected eligibility error: \(error)")
                }
                XCTAssertEqual(purpose, .persistence)
                XCTAssertEqual(rejectedProvenance, provenance)
            }
        }
    }

    @MainActor
    func testEveryDemoProvenanceIsRejected() async throws {
        let demoKinds: [RouteDemoKind] = [.mock, .preview, .testFixture]

        for demoKind in demoKinds {
            let route = copy(makeCompleteRoute(), provenance: .demo(demoKind))
            do {
                _ = try await makeStore().save(route, at: Date())
                XCTFail("Demo provenance must not be persisted: \(demoKind)")
            } catch let error as RouteEligibilityError {
                guard case let .unverified(purpose, provenance) = error else {
                    return XCTFail("Unexpected eligibility error: \(error)")
                }
                XCTAssertEqual(purpose, .persistence)
                XCTAssertEqual(provenance, .demo(demoKind))
            }
        }
    }

    @MainActor
    func testMalformedGeometryIsRejectedAtPersistenceBoundary() async throws {
        let route = makeCompleteRoute()
        let malformed = copy(route, path: Array(route.path.prefix(1)))

        do {
            _ = try await makeStore().save(malformed, at: Date())
            XCTFail("A route without routed geometry must not be saved.")
        } catch let error as RouteEligibilityError {
            guard case let .invalidGeometry(purpose) = error else {
                return XCTFail("Unexpected eligibility error: \(error)")
            }
            XCTAssertEqual(purpose, .persistence)
        }
    }

    @MainActor
    func testRecreatedModelReopensPersistedRouteWithRequiredFields() async throws {
        let directory = makeDirectoryURL()
        let route = makeCompleteRoute()
        _ = try await LocalSavedRouteStore(directoryURL: directory).save(
            route,
            at: Date(timeIntervalSince1970: 500)
        )

        let recreatedModel = SavedRoutesModel(
            store: LocalSavedRouteStore(directoryURL: directory)
        )
        await recreatedModel.loadIfNeeded()
        let restored = try XCTUnwrap(recreatedModel.routes.first)

        XCTAssertEqual(restored.id, route.id)
        XCTAssertEqual(restored.provenance, route.provenance)
        XCTAssertEqual(restored.path, route.path)
        XCTAssertEqual(restored.path.map(\.elevationMeters), route.path.map(\.elevationMeters))
        XCTAssertEqual(restored.distanceKilometers, route.distanceKilometers)
        XCTAssertEqual(restored.durationHours, route.durationHours)
        XCTAssertEqual(restored.elevationGainMeters, route.elevationGainMeters)
        XCTAssertEqual(restored.elevationLossMeters, route.elevationLossMeters)
        XCTAssertEqual(restored.activity, route.activity)
        XCTAssertEqual(restored.routeType, route.routeType)
        XCTAssertEqual(restored.planningMetadata, route.planningMetadata)
        XCTAssertEqual(recreatedModel.contentState, .populated)
    }

    @MainActor
    func testRealRecentsComeOnlyFromPersistedNewestFirstRecordsAndAreBounded() async throws {
        let directory = makeDirectoryURL()
        let store = LocalSavedRouteStore(directoryURL: directory)
        let routes = (0..<4).map { _ in makeCompleteRoute(id: UUID()) }
        for (index, route) in routes.enumerated() {
            _ = try await store.save(
                route,
                at: Date(timeIntervalSince1970: TimeInterval(index + 1) * 100)
            )
        }

        let model = SavedRoutesModel(store: LocalSavedRouteStore(directoryURL: directory))
        await model.loadIfNeeded()

        XCTAssertEqual(model.recentSnapshots.count, SavedRoutesModel.recentRouteLimit)
        XCTAssertEqual(model.recentSnapshots.map(\.id), [routes[3].id, routes[2].id, routes[1].id])
        XCTAssertEqual(model.recentSnapshots.map(\.savedAt), [
            Date(timeIntervalSince1970: 400),
            Date(timeIntervalSince1970: 300),
            Date(timeIntervalSince1970: 200)
        ])
    }

    @MainActor
    func testEmptyPersistenceProducesEmptyRecents() async {
        let model = SavedRoutesModel(store: InMemorySavedRouteStore())

        await model.loadIfNeeded()

        XCTAssertTrue(model.recentSnapshots.isEmpty)
        XCTAssertEqual(model.contentState, .empty)
    }

    @MainActor
    func testDeleteOneLeavesOtherPersistedRecordsIntact() async throws {
        let directory = makeDirectoryURL()
        let store = LocalSavedRouteStore(directoryURL: directory)
        let first = makeCompleteRoute(id: UUID())
        let second = makeCompleteRoute(id: UUID())
        _ = try await store.save(first, at: Date(timeIntervalSince1970: 100))
        _ = try await store.save(second, at: Date(timeIntervalSince1970: 200))

        try await store.remove(routeID: second.id)

        let result = try await LocalSavedRouteStore(directoryURL: directory).load()
        XCTAssertEqual(result.snapshots.map(\.id), [first.id])
    }

    @MainActor
    func testDeleteAllEmptiesValidAndUnusableRecords() async throws {
        let directory = makeDirectoryURL()
        let store = LocalSavedRouteStore(directoryURL: directory)
        _ = try await store.save(makeCompleteRoute(), at: Date())
        try Data("corrupt".utf8).write(to: directory.appendingPathComponent("corrupt.json"))
        let recovered = try await store.load()
        XCTAssertEqual(recovered.recoveryReport.corruptRecordCount, 1)

        try await store.removeAll()

        let result = try await LocalSavedRouteStore(directoryURL: directory).load()
        XCTAssertTrue(result.snapshots.isEmpty)
        XCTAssertEqual(result.recoveryReport, .none)
    }

    @MainActor
    func testIndividualDeleteFailureIsSurfacedAndRecordRemains() async {
        let route = makeCompleteRoute()
        let date = Date(timeIntervalSince1970: 100)
        let store = InMemorySavedRouteStore(
            snapshots: [SavedRouteSnapshot(route: route, savedAt: date, createdAt: date)]
        )
        let model = SavedRoutesModel(store: store)
        await model.loadIfNeeded()
        await store.setRemoveError(SavedRouteStoreError.deleteFailed)

        await model.remove(routeID: route.id)

        XCTAssertEqual(model.failure?.kind, .remove)
        XCTAssertEqual(model.routes.map(\.id), [route.id])
    }

    @MainActor
    func testDeleteAllFailureIsSurfacedAndRecordsRemain() async {
        let route = makeCompleteRoute()
        let date = Date(timeIntervalSince1970: 100)
        let store = InMemorySavedRouteStore(
            snapshots: [SavedRouteSnapshot(route: route, savedAt: date, createdAt: date)]
        )
        let model = SavedRoutesModel(store: store)
        await model.loadIfNeeded()
        await store.setRemoveAllError(SavedRouteStoreError.deleteAllFailed)

        await model.removeAll()

        XCTAssertEqual(model.failure?.kind, .removeAll)
        XCTAssertEqual(model.routes.map(\.id), [route.id])
    }

    @MainActor
    func testDelayedStartupLoadCannotOverwriteASuccessfulSave() async throws {
        let store = SuspendedSavedRouteStore()
        await store.suspendNextLoad()
        let model = SavedRoutesModel(store: store)
        let route = makeCompleteRoute()

        let loadTask = Task { @MainActor in
            await model.loadIfNeeded()
        }
        await store.waitUntilLoadStarts()

        let saveTask = Task { @MainActor in
            await model.save(route)
        }
        await waitUntil { model.pendingRouteIDs.contains(route.id) }

        XCTAssertTrue(model.isPerformingAnyOperation)
        let saveCallsBeforeLoadResumed = await store.saveInvocationCount()
        XCTAssertEqual(saveCallsBeforeLoadResumed, 0)

        await store.resumeLoad()
        await loadTask.value
        await saveTask.value

        XCTAssertFalse(model.isPerformingAnyOperation)
        XCTAssertTrue(model.isSaved(route))
        XCTAssertEqual(model.recentSnapshots.map(\.id), [route.id])
        let persistedAfterLoad = try await store.load()
        XCTAssertEqual(persistedAfterLoad.snapshots.map(\.id), [route.id])
    }

    @MainActor
    func testDeleteAllWaitsForPendingSaveAndCannotBeRepopulatedByIt() async throws {
        let existingRoute = makeCompleteRoute(id: UUID())
        let date = Date(timeIntervalSince1970: 100)
        let existingSnapshot = SavedRouteSnapshot(
            route: existingRoute,
            savedAt: date,
            createdAt: date
        )
        let store = SuspendedSavedRouteStore(
            snapshotsByID: [existingRoute.id: existingSnapshot]
        )
        let model = SavedRoutesModel(store: store)
        await model.loadIfNeeded()

        let routeBeingSaved = makeCompleteRoute(id: UUID())
        await store.suspendNextSave()
        let saveTask = Task { @MainActor in
            await model.save(routeBeingSaved)
        }
        await store.waitUntilSaveStarts()

        let deleteAllTask = Task { @MainActor in
            await model.removeAll()
        }
        await waitUntil { model.isBulkActionPendingOrActive }

        XCTAssertTrue(model.isPerformingAnyOperation)
        XCTAssertTrue(model.pendingRouteIDs.contains(routeBeingSaved.id))
        let removeAllCallsBeforeSaveResumed = await store.removeAllInvocationCount()
        XCTAssertEqual(removeAllCallsBeforeSaveResumed, 0)

        await store.resumeSave()
        await saveTask.value
        await deleteAllTask.value

        XCTAssertFalse(model.isPerformingAnyOperation)
        XCTAssertTrue(model.routes.isEmpty)
        XCTAssertTrue(model.recentSnapshots.isEmpty)
        let persistedAfterDeleteAll = try await store.load()
        XCTAssertTrue(persistedAfterDeleteAll.snapshots.isEmpty)
    }

    @MainActor
    func testUnreadableRecordMakesCachedStateUnavailableAndInvalidatesCleanupInventory() async throws {
        let directory = makeDirectoryURL()
        let route = makeCompleteRoute()
        _ = try await LocalSavedRouteStore(directoryURL: directory).save(route, at: Date())
        let corruptURL = directory.appendingPathComponent("corrupt.json")
        try Data("corrupt".utf8).write(to: corruptURL)

        let reader = ControllableSavedRouteRecordReader()
        let store = LocalSavedRouteStore(directoryURL: directory, recordReader: reader)
        let model = SavedRoutesModel(store: store)
        await model.loadIfNeeded()
        XCTAssertEqual(model.contentState, .populated)
        XCTAssertEqual(model.recoveryReport.corruptRecordCount, 1)
        XCTAssertTrue(model.canDiscardUnusableRecords)

        let routeURL = directory
            .appendingPathComponent(route.id.uuidString)
            .appendingPathExtension("json")
        reader.makeUnreadable(routeURL)

        await model.retryLoad()

        XCTAssertEqual(model.contentState, .unavailable)
        XCTAssertEqual(model.routes.map(\.id), [route.id])
        XCTAssertFalse(model.isRecoveryCleanupInventoryCurrent)
        XCTAssertFalse(model.canDiscardUnusableRecords)
        XCTAssertEqual(
            model.loadNotice,
            "Saved route recovery details require a successful reload before cleanup."
        )

        await model.discardUnusableRecords()
        XCTAssertTrue(FileManager.default.fileExists(atPath: routeURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: corruptURL.path))
        do {
            try await store.discardUnusableRecords()
            XCTFail("Cleanup must be rejected until a successful inventory reload.")
        } catch let error as SavedRouteStoreError {
            XCTAssertEqual(error, .recoveryCleanupUnavailable)
        }

        reader.makeReadable(routeURL)
        await model.retryLoad()
        XCTAssertEqual(model.contentState, .populated)
        XCTAssertTrue(model.canDiscardUnusableRecords)
        XCTAssertEqual(model.recoveryReport.corruptRecordCount, 1)
    }

    @MainActor
    func testPartialCleanupFailureReloadsTruthfulRemainingInventory() async throws {
        let directory = makeDirectoryURL()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let firstURL = directory.appendingPathComponent("a-corrupt.json")
        let secondURL = directory.appendingPathComponent("b-corrupt.json")
        try Data("first-corrupt-record".utf8).write(to: firstURL)
        try Data("second-corrupt-record".utf8).write(to: secondURL)
        let remover = ControllableSavedRouteRecordRemover()
        remover.makeRemovalFail(secondURL)
        let model = SavedRoutesModel(
            store: LocalSavedRouteStore(
                directoryURL: directory,
                recordRemover: remover
            )
        )
        await model.loadIfNeeded()
        XCTAssertEqual(model.recoveryReport.corruptRecordCount, 2)

        await model.discardUnusableRecords()

        XCTAssertEqual(model.failure?.kind, .recoveryCleanup)
        XCTAssertEqual(model.loadState, .loaded)
        XCTAssertEqual(model.contentState, .empty)
        XCTAssertTrue(model.isRecoveryCleanupInventoryCurrent)
        XCTAssertTrue(model.canDiscardUnusableRecords)
        XCTAssertEqual(model.recoveryReport.corruptRecordCount, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: firstURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: secondURL.path))
    }

    @MainActor
    func testDeletingLegacyRouteClearsRecoveredLegacyNotice() async {
        let legacyRoute = copy(
            makeCompleteRoute(),
            provenance: .unverified(.legacyRecord)
        )
        let date = Date(timeIntervalSince1970: 100)
        let model = SavedRoutesModel(
            store: InMemorySavedRouteStore(
                snapshots: [SavedRouteSnapshot(route: legacyRoute, savedAt: date, createdAt: date)],
                recoveryReport: SavedRouteRecoveryReport(recoveredLegacyRecordCount: 1)
            )
        )
        await model.loadIfNeeded()
        XCTAssertNotNil(model.loadNotice)

        await model.remove(routeID: legacyRoute.id)

        XCTAssertEqual(model.recoveryReport.recoveredLegacyRecordCount, 0)
        XCTAssertNil(model.loadNotice)
        XCTAssertTrue(model.routes.isEmpty)
    }

    @MainActor
    func testDiscardingUnusableRecordPreservesValidRecords() async throws {
        let directory = makeDirectoryURL()
        let store = LocalSavedRouteStore(directoryURL: directory)
        let route = makeCompleteRoute()
        _ = try await store.save(route, at: Date())
        try Data("corrupt".utf8).write(to: directory.appendingPathComponent("corrupt.json"))
        let recovered = try await store.load()
        XCTAssertEqual(recovered.skippedRecordCount, 1)

        try await store.discardUnusableRecords()

        let result = try await LocalSavedRouteStore(directoryURL: directory).load()
        XCTAssertEqual(result.snapshots.map(\.id), [route.id])
        XCTAssertEqual(result.recoveryReport, .none)
    }

    @MainActor
    func testEntireStoreCorruptionProducesTypedRecoveryStateWithoutReplacement() async throws {
        let directory = makeDirectoryURL()
        try Data("unreadable-store".utf8).write(to: directory)
        let store = LocalSavedRouteStore(directoryURL: directory)

        do {
            _ = try await store.load()
            XCTFail("A file in place of the store directory must not be treated as an empty store.")
        } catch let error as SavedRouteStoreError {
            XCTAssertEqual(error, .unreadableStore)
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.path))

        let model = SavedRoutesModel(store: store)
        await model.loadIfNeeded()
        XCTAssertEqual(model.loadState, .unavailable)
        XCTAssertEqual(model.contentState, .unavailable)
        XCTAssertEqual(model.failure?.kind, .load)

        await model.removeAll()
        XCTAssertEqual(model.contentState, .empty)
        XCTAssertNil(model.failure)
        let resetResult = try await store.load()
        XCTAssertTrue(resetResult.snapshots.isEmpty)
    }

    @MainActor
    func testInterruptedAtomicWriteDoesNotReplaceValidRecordWithPartialData() async throws {
        let directory = makeDirectoryURL()
        let route = makeCompleteRoute()
        let originalDate = Date(timeIntervalSince1970: 100)
        _ = try await LocalSavedRouteStore(directoryURL: directory).save(route, at: originalDate)
        let interruptedStore = LocalSavedRouteStore(
            directoryURL: directory,
            recordWriter: InterruptedSavedRouteRecordWriter()
        )

        do {
            _ = try await interruptedStore.save(route, at: Date(timeIntervalSince1970: 200))
            XCTFail("The simulated interrupted write must fail.")
        } catch let error as SavedRouteStoreError {
            XCTAssertEqual(error, .writeFailed)
        }

        let result = try await LocalSavedRouteStore(directoryURL: directory).load()
        XCTAssertEqual(result.snapshots.count, 1)
        XCTAssertEqual(result.snapshots.first?.savedAt, originalDate)
        XCTAssertEqual(result.snapshots.first?.route, route)
    }

    @MainActor
    func testErrorsAndSourceDoNotExposePreciseRouteData() async {
        let sensitiveValues = ["51.8666", "10.6782", "15.2 km Hike loop around Ilsenburg"]
        let errors: [SavedRouteStoreError] = [
            .unreadableStore,
            .writeFailed,
            .deleteFailed,
            .deleteAllFailed,
            .recoveryCleanupUnavailable,
            .recoveryCleanupFailed
        ]

        for error in errors {
            let description = error.localizedDescription
            for sensitiveValue in sensitiveValues {
                XCTAssertFalse(description.contains(sensitiveValue))
            }
        }

        let invalidDirectory = makeDirectoryURL()
        try? Data("file".utf8).write(to: invalidDirectory)
        let model = SavedRoutesModel(store: LocalSavedRouteStore(directoryURL: invalidDirectory))
        await model.save(makeCompleteRoute())
        for sensitiveValue in sensitiveValues {
            XCTAssertFalse(model.errorMessage?.contains(sensitiveValue) ?? false)
        }
    }

    @MainActor
    func testSavedRoutesModelRepresentsLoadingEmptyPopulatedWarningAndFailureStates() async {
        let emptyModel = SavedRoutesModel(store: InMemorySavedRouteStore())
        XCTAssertEqual(emptyModel.contentState, .loading)
        await emptyModel.loadIfNeeded()
        XCTAssertEqual(emptyModel.contentState, .empty)

        let route = makeCompleteRoute()
        let date = Date(timeIntervalSince1970: 100)
        let populatedModel = SavedRoutesModel(
            store: InMemorySavedRouteStore(
                snapshots: [SavedRouteSnapshot(route: route, savedAt: date, createdAt: date)]
            )
        )
        await populatedModel.loadIfNeeded()
        XCTAssertEqual(populatedModel.contentState, .populated)

        let warningModel = SavedRoutesModel(
            store: InMemorySavedRouteStore(
                recoveryReport: SavedRouteRecoveryReport(
                    recoveredLegacyRecordCount: 1,
                    corruptRecordCount: 1
                )
            )
        )
        await warningModel.loadIfNeeded()
        XCTAssertNotNil(warningModel.loadNotice)
        XCTAssertEqual(warningModel.recoveryReport.recoveredLegacyRecordCount, 1)
        XCTAssertEqual(warningModel.recoveryReport.corruptRecordCount, 1)

        let unavailableStore = InMemorySavedRouteStore()
        await unavailableStore.setLoadError(SavedRouteStoreError.unreadableStore)
        let unavailableModel = SavedRoutesModel(store: unavailableStore)
        await unavailableModel.loadIfNeeded()
        XCTAssertEqual(unavailableModel.contentState, .unavailable)
        XCTAssertEqual(unavailableModel.failure?.kind, .load)
    }

    @MainActor
    func testSavedRoutesViewContainsHonestStatesAndNoOfflineClaim() {
        XCTAssertEqual(SavedRoutesViewContent.stateAccessibilityIdentifiers, [
            "saved.loadingState",
            "saved.emptyState",
            "saved.populatedState",
            "saved.recoveryNotice",
            "saved.unavailableState",
            "saved.unverifiedRoute"
        ])
        XCTAssertEqual(SavedRoutesViewContent.deleteAllTitle, "Delete All Saved Routes?")

        let visibleCopy = [
            SavedRoutesViewContent.headerSubtitle,
            SavedRoutesViewContent.emptyTitle,
            SavedRoutesViewContent.emptyMessage,
            SavedRoutesViewContent.loadingMessage,
            SavedRoutesViewContent.unavailableTitle,
            SavedRoutesViewContent.unavailableMessage,
            SavedRoutesViewContent.unverifiedLabel
        ].joined(separator: " ")
        XCTAssertFalse(visibleCopy.localizedCaseInsensitiveContains("offline map"))
        XCTAssertTrue(visibleCopy.localizedCaseInsensitiveContains("verified route"))
        XCTAssertTrue(visibleCopy.localizedCaseInsensitiveContains("not been replaced"))
    }

    private func makeDirectoryURL() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("TrailMind-SavedRouteTests-\(UUID().uuidString)", isDirectory: true)
        temporaryURLs.append(url)
        return url
    }

    @MainActor
    private func waitUntil(
        maxYields: Int = 100,
        _ condition: @MainActor () -> Bool
    ) async {
        for _ in 0..<maxYields {
            if condition() { return }
            await Task.yield()
        }
        XCTFail("Timed out waiting for the deterministic test condition.")
    }

    @MainActor
    private func makeStore() -> LocalSavedRouteStore {
        LocalSavedRouteStore(directoryURL: makeDirectoryURL())
    }

    @MainActor
    private func makeCompleteRoute(id: UUID = UUID(), pathPointCount: Int = 3) -> TrailRoute {
        let path = (0..<pathPointCount).map { index in
            Coordinate(
                latitude: 51.8666 + Double(index) * 0.0001,
                longitude: 10.6782 + Double(index) * 0.0001,
                elevationMeters: 260 + Double(index)
            )
        }
        let metadata = RoutePlanningMetadata(
            routeType: .loop,
            activityType: .hiking,
            targetDistanceKm: 15,
            targetDurationMinutes: 210,
            difficulty: .moderate,
            desiredFeatures: [.viewpoint, .forest],
            avoidFeatures: [.majorRoads],
            seed: 29,
            variantLabel: "Closest Match",
            loopSearchOutcome: .comparison(routeCount: 3),
            routeShapingSummary: RouteShapingSummary(
                applied: [.activityProfile, .targetDistance],
                requestedOnly: [.avoidMajorRoads]
            )
        )
        let characteristics = VerifiedRouteCharacteristics(
            routeDistanceMeters: 15_200,
            surfaceBreakdown: [VerifiedRouteCharacteristicValue(value: "unpaved", distanceMeters: 12_000)],
            roadClassBreakdown: [VerifiedRouteCharacteristicValue(value: "path", distanceMeters: 13_000)],
            hikeRatingBreakdown: [VerifiedRouteCharacteristicValue(value: "2", distanceMeters: 4_000)],
            surfaceCoverageMeters: 14_000,
            roadClassCoverageMeters: 14_500,
            hikeRatingCoverageMeters: 10_000
        )
        let provenance = RouteProvenance.routingEngineOutput(
            provider: .graphHopper,
            strategy: .backend,
            activity: .hiking,
            routeType: .loop,
            distanceKilometers: 15.2,
            elevationGainMeters: 430,
            elevationLossMeters: 425,
            durationHours: 3.75,
            difficulty: .moderate,
            path: path,
            verifiedCharacteristics: characteristics
        )

        return TrailRoute(
            id: id,
            provenance: provenance,
            title: "15.2 km Hike loop around Ilsenburg",
            location: "Ilsenburg, Harz",
            activity: .hiking,
            distanceKilometers: 15.2,
            elevationGainMeters: 430,
            elevationLossMeters: 425,
            durationHours: 3.75,
            difficulty: .moderate,
            routeType: .loop,
            summary: "A generated route fixture with complete persisted data.",
            whyItMatches: "Closest available mapped loop to the requested distance.",
            highlights: [Highlight(title: "Route shape", subtitle: "Verified geometry", symbol: "point.topleft.down.to.point.bottomright.curvepath")],
            waypoints: [Waypoint(name: "Trailhead", detail: "Start", distanceKilometers: 0, kind: .start, coordinate: path[0])],
            days: [RouteDay(dayNumber: 1, title: "Harz loop", distanceKilometers: 15.2, elevationGainMeters: 430, durationHours: 3.75, summary: "Complete the loop.")],
            safetyNotes: [SafetyNote(title: "Review conditions", message: "Check weather and trail access before starting.", severity: .caution)],
            elevationProfile: path.compactMap(\.elevationMeters),
            path: path,
            routeInstructions: [RouteInstruction(text: "Continue on the trail", streetName: "Harzweg", distanceMeters: 850, durationSeconds: 600, sign: 0, coordinate: path[0])],
            planningMetadata: metadata,
            verifiedCharacteristics: characteristics
        )
    }

    @MainActor
    private func copy(
        _ route: TrailRoute,
        provenance: RouteProvenance? = nil,
        path: [GeoPoint]? = nil,
        distanceKilometers: Double? = nil,
        verifiedCharacteristics: VerifiedRouteCharacteristics? = nil
    ) -> TrailRoute {
        TrailRoute(
            id: route.id,
            provenance: provenance ?? route.provenance,
            title: route.title,
            location: route.location,
            activity: route.activity,
            distanceKilometers: distanceKilometers ?? route.distanceKilometers,
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
            path: path ?? route.path,
            routeInstructions: route.routeInstructions,
            planningMetadata: route.planningMetadata,
            intentDebugMetadata: route.intentDebugMetadata,
            verifiedCharacteristics: verifiedCharacteristics ?? route.verifiedCharacteristics
        )
    }
}

private struct InterruptedSavedRouteRecordWriter: SavedRouteRecordWriting {
    func writeAtomically(_ data: Data, to url: URL) throws {
        let partialURL = url
            .deletingPathExtension()
            .appendingPathExtension("interrupted")
        try Data(data.prefix(max(1, data.count / 3))).write(to: partialURL)
        throw SavedRouteStoreError.writeFailed
    }
}

private final class ControllableSavedRouteRecordReader: SavedRouteRecordReading, @unchecked Sendable {
    private let lock = NSLock()
    private var unreadablePaths: Set<String> = []

    func read(from url: URL) throws -> Data {
        lock.lock()
        let isUnreadable = unreadablePaths.contains(url.path)
        lock.unlock()
        if isUnreadable {
            throw CocoaError(.fileReadNoPermission)
        }
        return try Data(contentsOf: url)
    }

    func makeUnreadable(_ url: URL) {
        lock.lock()
        unreadablePaths.insert(url.path)
        lock.unlock()
    }

    func makeReadable(_ url: URL) {
        lock.lock()
        unreadablePaths.remove(url.path)
        lock.unlock()
    }
}

private final class ControllableSavedRouteRecordRemover: SavedRouteRecordRemoving, @unchecked Sendable {
    private let lock = NSLock()
    private var failingPaths: Set<String> = []

    func remove(at url: URL) throws {
        lock.lock()
        let shouldFail = failingPaths.contains(url.path)
        lock.unlock()
        if shouldFail {
            throw CocoaError(.fileWriteNoPermission)
        }
        try FileManager.default.removeItem(at: url)
    }

    func makeRemovalFail(_ url: URL) {
        lock.lock()
        failingPaths.insert(url.path)
        lock.unlock()
    }
}

private actor SuspendedSavedRouteStore: SavedRouteStore {
    private var snapshots: [UUID: SavedRouteSnapshot]
    private var shouldSuspendLoad = false
    private var shouldSuspendSave = false
    private var loadResumeContinuation: CheckedContinuation<Void, Never>?
    private var saveResumeContinuation: CheckedContinuation<Void, Never>?
    private var loadStartWaiters: [CheckedContinuation<Void, Never>] = []
    private var saveStartWaiters: [CheckedContinuation<Void, Never>] = []
    private var loadCallCount = 0
    private var saveCallCount = 0
    private var removeAllCallCount = 0

    init(snapshotsByID: [UUID: SavedRouteSnapshot] = [:]) {
        snapshots = snapshotsByID
    }

    func suspendNextLoad() {
        shouldSuspendLoad = true
    }

    func suspendNextSave() {
        shouldSuspendSave = true
    }

    func waitUntilLoadStarts() async {
        guard loadCallCount == 0 else { return }
        await withCheckedContinuation { continuation in
            loadStartWaiters.append(continuation)
        }
    }

    func waitUntilSaveStarts() async {
        guard saveCallCount == 0 else { return }
        await withCheckedContinuation { continuation in
            saveStartWaiters.append(continuation)
        }
    }

    func resumeLoad() {
        loadResumeContinuation?.resume()
        loadResumeContinuation = nil
    }

    func resumeSave() {
        saveResumeContinuation?.resume()
        saveResumeContinuation = nil
    }

    func saveInvocationCount() -> Int { saveCallCount }
    func removeAllInvocationCount() -> Int { removeAllCallCount }

    func load() async throws -> SavedRouteLoadResult {
        loadCallCount += 1
        let unsortedSnapshots = Array(snapshots.values)
        let capturedSnapshots = await MainActor.run {
            unsortedSnapshots.sorted(by: SavedRouteSnapshot.newestFirst)
        }
        loadStartWaiters.forEach { $0.resume() }
        loadStartWaiters = []
        if shouldSuspendLoad {
            shouldSuspendLoad = false
            await withCheckedContinuation { continuation in
                loadResumeContinuation = continuation
            }
        }
        return SavedRouteLoadResult(
            snapshots: capturedSnapshots,
            recoveryReport: .none
        )
    }

    func save(_ route: TrailRoute, at date: Date) async throws -> SavedRouteSnapshot {
        saveCallCount += 1
        saveStartWaiters.forEach { $0.resume() }
        saveStartWaiters = []
        if shouldSuspendSave {
            shouldSuspendSave = false
            await withCheckedContinuation { continuation in
                saveResumeContinuation = continuation
            }
        }
        try await MainActor.run {
            try RouteEligibilityPolicy.validate(route, for: .persistence)
        }
        let routeID = await MainActor.run { route.id }
        let existingSnapshot = snapshots[routeID]
        let createdAt = await MainActor.run { existingSnapshot?.createdAt ?? date }
        let snapshot = await MainActor.run {
            SavedRouteSnapshot(route: route, savedAt: date, createdAt: createdAt)
        }
        snapshots[routeID] = snapshot
        return snapshot
    }

    func remove(routeID: UUID) async throws {
        snapshots.removeValue(forKey: routeID)
    }

    func removeAll() async throws {
        removeAllCallCount += 1
        snapshots = [:]
    }

    func discardUnusableRecords() async throws { }
}
