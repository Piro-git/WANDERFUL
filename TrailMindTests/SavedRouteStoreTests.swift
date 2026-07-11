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
    }

    @MainActor
    func testSavingSameRouteTwiceDoesNotDuplicate() async throws {
        let store = makeStore()
        let route = makeCompleteRoute()
        _ = try await store.save(route, at: Date(timeIntervalSince1970: 100))
        _ = try await store.save(route, at: Date(timeIntervalSince1970: 200))

        let result = try await store.load()
        XCTAssertEqual(result.snapshots.count, 1)
        XCTAssertEqual(result.snapshots.first?.savedAt, Date(timeIntervalSince1970: 100))
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
    func testCorruptRecordDoesNotPreventValidRouteLoading() async throws {
        let directory = makeDirectoryURL()
        let store = LocalSavedRouteStore(directoryURL: directory)
        let route = makeCompleteRoute()
        _ = try await store.save(route, at: Date())
        try Data("not-json".utf8).write(to: directory.appendingPathComponent("corrupt.json"))

        let result = try await store.load()
        XCTAssertEqual(result.snapshots.map(\.id), [route.id])
        XCTAssertEqual(result.skippedRecordCount, 1)
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

    private func makeDirectoryURL() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("TrailMind-SavedRouteTests-\(UUID().uuidString)", isDirectory: true)
        temporaryURLs.append(url)
        return url
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

        return TrailRoute(
            id: id,
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
}
