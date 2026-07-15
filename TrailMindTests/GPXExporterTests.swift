import Foundation
import UniformTypeIdentifiers
import XCTest
@testable import TrailMind

final class GPXExporterTests: XCTestCase {
    private var temporaryURLs: [URL] = []

    override func tearDown() {
        for url in temporaryURLs {
            try? FileManager.default.removeItem(at: url)
        }
        temporaryURLs = []
        super.tearDown()
    }

    @MainActor
    func testVerifiedRouteExportsRealTypedProtectedFile() async throws {
        let fileSystem = RecordingGPXFileSystem()
        let service = makeService(fileSystem: fileSystem)
        let route = makeRoute(title: "Harz Ridge")

        let export = try await service.prepareExport(route: route)

        XCTAssertTrue(FileManager.default.fileExists(atPath: export.fileURL.path))
        XCTAssertEqual(export.fileURL.pathExtension, "gpx")
        XCTAssertEqual(export.filename, "Harz Ridge.gpx")
        XCTAssertEqual(export.fileURL.lastPathComponent, export.filename)
        XCTAssertEqual(export.contentTypeIdentifier, GPXContentType.gpx.identifier)
        XCTAssertTrue(export.contentType.conforms(to: .xml))
        XCTAssertEqual(fileSystem.atomicWrites, [export.fileURL])
        XCTAssertEqual(fileSystem.protectedFiles, [export.fileURL])
        let attributes = try FileManager.default.attributesOfItem(atPath: export.fileURL.path)
        if let protection = attributes[.protectionKey] as? FileProtectionType {
            XCTAssertEqual(protection, .complete)
        }

        let data = try Data(contentsOf: export.fileURL)
        let expectedData = try await service.encodedGPX(for: route)
        XCTAssertEqual(data, expectedData)
        let initialCleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(initialCleanupSucceeded)
        XCTAssertFalse(FileManager.default.fileExists(atPath: export.fileURL.path))
        let repeatedCleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(
            repeatedCleanupSucceeded,
            "Cleanup should be idempotent when the export is already absent."
        )
    }

    @MainActor
    func testPreparationEncodingAndFileWorkRunOffMainThread() async throws {
        let probe = ThreadExecutionProbe()
        let service = makeService(executionProbe: {
            probe.record(isMainThread: Thread.isMainThread)
        })

        let export = try await service.prepareExport(route: makeRoute())

        XCTAssertEqual(probe.recordedIsMainThread, false)
        let cleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(cleanupSucceeded)
    }

    @MainActor
    func testCleanupFileWorkRunsOffMainThread() async throws {
        let probe = ThreadExecutionProbe()
        let service = makeService(executionProbe: {
            probe.record(isMainThread: Thread.isMainThread)
        })
        let export = try await service.prepareExport(route: makeRoute())
        probe.reset()

        let cleanupSucceeded = await service.cleanup(export)

        XCTAssertTrue(cleanupSucceeded)
        XCTAssertEqual(probe.recordedIsMainThread, false)
    }

    @MainActor
    func testCleanupIsIdempotentWhenEntireExportRootIsAlreadyMissing() async throws {
        let service = makeService()
        let export = try await service.prepareExport(route: makeRoute())

        try FileManager.default.removeItem(at: service.exportRootDirectory)

        let initialCleanupSucceeded = await service.cleanup(export)
        let repeatedCleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(initialCleanupSucceeded)
        XCTAssertTrue(repeatedCleanupSucceeded)
    }

    @MainActor
    func testCleanupUsesStableCanonicalRootWhenTemporaryDirectoryIsASymlink() async throws {
        let realTemporaryDirectory = makeTemporaryDirectory()
        let symlinkContainer = makeTemporaryDirectory()
        let symlinkedTemporaryDirectory = symlinkContainer.appendingPathComponent("Temporary-Alias")
        try FileManager.default.createDirectory(
            at: realTemporaryDirectory,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: symlinkContainer,
            withIntermediateDirectories: true
        )
        try FileManager.default.createSymbolicLink(
            at: symlinkedTemporaryDirectory,
            withDestinationURL: realTemporaryDirectory
        )
        let service = DefaultGPXService(temporaryDirectory: symlinkedTemporaryDirectory)

        let export = try await service.prepareExport(route: makeRoute())

        let initialCleanupSucceeded = await service.cleanup(export)
        let repeatedCleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(initialCleanupSucceeded)
        XCTAssertTrue(repeatedCleanupSucceeded)
    }

    @MainActor
    func testCleanupKeepsCanonicalRootAfterTemporaryDirectorySymlinkIsRetargeted() async throws {
        let firstTarget = makeTemporaryDirectory()
        let secondTarget = makeTemporaryDirectory()
        let symlinkContainer = makeTemporaryDirectory()
        let symlinkedTemporaryDirectory = symlinkContainer.appendingPathComponent("Temporary-Alias")
        try FileManager.default.createDirectory(at: firstTarget, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: secondTarget, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: symlinkContainer, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(
            at: symlinkedTemporaryDirectory,
            withDestinationURL: firstTarget
        )
        let service = DefaultGPXService(temporaryDirectory: symlinkedTemporaryDirectory)
        let stableRoot = service.exportRootDirectory
        let export = try await service.prepareExport(route: makeRoute())

        try FileManager.default.removeItem(at: symlinkedTemporaryDirectory)
        try FileManager.default.createSymbolicLink(
            at: symlinkedTemporaryDirectory,
            withDestinationURL: secondTarget
        )

        XCTAssertEqual(service.exportRootDirectory, stableRoot)
        XCTAssertEqual(
            stableRoot.deletingLastPathComponent().standardizedFileURL,
            firstTarget.standardizedFileURL
        )
        let cleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(cleanupSucceeded)
        XCTAssertFalse(FileManager.default.fileExists(atPath: export.fileURL.path))
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: secondTarget.appendingPathComponent("TrailMind-GPX-Exports").path
            )
        )
    }

    @MainActor
    func testEveryIneligibleProvenanceCategoryIsRejectedByExporter() async throws {
        let provenances: [RouteProvenance] = [
            .demo(.mock),
            .demo(.preview),
            .demo(.testFixture),
            .unverified(.legacyRecord),
            .unverified(.modifiedWithoutRouting),
            .unverified(.unknown)
        ]
        let service = makeService()

        for provenance in provenances {
            let route = makeRoute(provenance: provenance)
            await assertThrowsErrorAsync({ try await service.prepareExport(route: route) }) { error in
                guard
                    let eligibilityError = error as? RouteEligibilityError,
                    case let .unverified(purpose, actualProvenance) = eligibilityError
                else { return XCTFail("Unexpected error: \(error)") }
                XCTAssertEqual(purpose, .export)
                XCTAssertEqual(actualProvenance, provenance)
            }
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: service.exportRootDirectory.path))
    }

    @MainActor
    func testChangedRoutedFactsAreRejectedByExporter() async throws {
        let route = makeRoute()
        let modified = copy(route, distanceKilometers: route.distanceKilometers + 1)

        await assertThrowsErrorAsync({ try await makeService().prepareExport(route: modified) }) { error in
            guard
                let eligibilityError = error as? RouteEligibilityError,
                case let .routedFactsChanged(purpose) = eligibilityError
            else { return XCTFail("Unexpected error: \(error)") }
            XCTAssertEqual(purpose, .export)
        }
    }

    @MainActor
    func testInvalidQuantitativeFactsAreRejectedByExporter() async {
        let route = makeRoute()
        let invalidRoutes = [
            copy(route, distanceKilometers: 0),
            copy(route, distanceKilometers: -1),
            copy(route, distanceKilometers: .nan),
            copy(route, distanceKilometers: .infinity),
            copy(route, durationHours: 0),
            copy(route, durationHours: -1),
            copy(route, durationHours: .nan),
            copy(route, durationHours: .infinity),
            copy(route, elevationGainMeters: -1),
            copy(route, elevationLossMeters: -1)
        ]

        for invalidRoute in invalidRoutes {
            await assertThrowsErrorAsync({ try await makeService().prepareExport(route: invalidRoute) }) { error in
                guard
                    let eligibilityError = error as? RouteEligibilityError,
                    case let .invalidQuantitativeFacts(purpose) = eligibilityError
                else { return XCTFail("Unexpected error: \(error)") }
                XCTAssertEqual(purpose, .export)
            }
        }
    }

    @MainActor
    func testFactualDifficultyMismatchIsRejectedByExporter() async {
        let route = makeRoute()
        let changed = copy(route, difficulty: .moderate)

        await assertThrowsErrorAsync({ try await makeService().prepareExport(route: changed) }) { error in
            guard
                let eligibilityError = error as? RouteEligibilityError,
                case let .factualDifficultyMismatch(purpose, expected, actual) = eligibilityError
            else { return XCTFail("Unexpected error: \(error)") }
            XCTAssertEqual(purpose, .export)
            XCTAssertEqual(expected, .easy)
            XCTAssertEqual(actual, .moderate)
        }
    }

    @MainActor
    func testValidGeometryMutationInvalidatesRoutedFingerprint() async {
        let route = makeRoute()
        var changedPath = route.path
        changedPath[1] = Coordinate(
            latitude: changedPath[1].latitude + 0.0001,
            longitude: changedPath[1].longitude,
            elevationMeters: changedPath[1].elevationMeters
        )
        let changed = copy(route, path: changedPath)

        await assertThrowsErrorAsync({ try await makeService().prepareExport(route: changed) }) { error in
            guard
                let eligibilityError = error as? RouteEligibilityError,
                case let .routedFactsChanged(purpose) = eligibilityError
            else { return XCTFail("Unexpected error: \(error)") }
            XCTAssertEqual(purpose, .export)
        }
    }

    @MainActor
    func testEmptyGeometryIsRejected() async {
        await assertInvalidGeometry([])
    }

    @MainActor
    func testSinglePointGeometryIsRejected() async {
        await assertInvalidGeometry([Coordinate(latitude: 51, longitude: 10)])
    }

    @MainActor
    func testRepeatedSingleLocationGeometryIsRejected() async {
        await assertInvalidGeometry([
            Coordinate(latitude: 51, longitude: 10),
            Coordinate(latitude: 51, longitude: 10)
        ])
    }

    @MainActor
    func testOutOfRangeLatitudeIsRejected() async {
        await assertInvalidGeometry([
            Coordinate(latitude: 91, longitude: 10),
            Coordinate(latitude: 51.1, longitude: 10.1)
        ])
        await assertInvalidGeometry([
            Coordinate(latitude: -91, longitude: 10),
            Coordinate(latitude: 51.1, longitude: 10.1)
        ])
    }

    @MainActor
    func testOutOfRangeLongitudeIsRejected() async {
        await assertInvalidGeometry([
            Coordinate(latitude: 51, longitude: 181),
            Coordinate(latitude: 51.1, longitude: 10.1)
        ])
        await assertInvalidGeometry([
            Coordinate(latitude: 51, longitude: -181),
            Coordinate(latitude: 51.1, longitude: 10.1)
        ])
    }

    @MainActor
    func testNaNAndInfiniteCoordinatesAreRejected() async {
        let invalidPoints = [
            Coordinate(latitude: .nan, longitude: 10),
            Coordinate(latitude: .infinity, longitude: 10),
            Coordinate(latitude: -.infinity, longitude: 10),
            Coordinate(latitude: 51, longitude: .nan),
            Coordinate(latitude: 51, longitude: .infinity),
            Coordinate(latitude: 51, longitude: -.infinity)
        ]

        for invalidPoint in invalidPoints {
            await assertInvalidGeometry([
                invalidPoint,
                Coordinate(latitude: 51.1, longitude: 10.1)
            ])
        }
    }

    @MainActor
    func testNonfiniteElevationIsRejectedRatherThanInventedOrOmitted() async {
        for elevation in [Double.nan, .infinity, -.infinity] {
            await assertInvalidGeometry([
                Coordinate(latitude: 51, longitude: 10, elevationMeters: elevation),
                Coordinate(latitude: 51.1, longitude: 10.1, elevationMeters: 220)
            ])
        }
    }

    @MainActor
    func testGPX11StructureParsesAndPointCountMatchesExactly() async throws {
        let path = [
            Coordinate(latitude: 51.8666, longitude: 10.6782, elevationMeters: 260),
            Coordinate(latitude: 51.8671, longitude: 10.6791),
            Coordinate(latitude: 51.868, longitude: 10.68, elevationMeters: 275.5)
        ]
        let route = makeRoute(title: "Ilsenburg Loop", path: path)
        let data = try await makeService().encodedGPX(for: route)
        let xml = String(decoding: data, as: UTF8.self)
        let probe = try parse(data)

        XCTAssertTrue(xml.hasPrefix(#"<?xml version="1.0" encoding="UTF-8"?>"#))
        XCTAssertEqual(probe.rootElement, "gpx")
        XCTAssertEqual(probe.rootNamespace, DefaultGPXService.namespace)
        XCTAssertEqual(probe.rootAttributes["version"], "1.1")
        XCTAssertEqual(probe.rootAttributes["creator"], DefaultGPXService.creator)
        XCTAssertTrue(probe.elements.contains("trk"))
        XCTAssertTrue(probe.elements.contains("trkseg"))
        XCTAssertEqual(probe.trackName, route.title)
        XCTAssertEqual(probe.trackPoints.count, path.count)
        XCTAssertEqual(probe.elevations, ["260", "275.5"])
        XCTAssertFalse(probe.elements.contains("metadata"))
        XCTAssertFalse(probe.elements.contains("time"))
        XCTAssertFalse(probe.elements.contains("wpt"))
        XCTAssertFalse(probe.elements.contains("rte"))
    }

    @MainActor
    func testTrackPointsUseLatitudeThenLongitudeAndSerializeSignsAndZero() throws {
        let path = [
            Coordinate(latitude: 0, longitude: -0.0),
            Coordinate(latitude: -12.5, longitude: 34.25),
            Coordinate(latitude: 0.0000001, longitude: -0.0000002)
        ]
        let xml = try makeService().exportRouteAsGPX(route: makeRoute(path: path))

        XCTAssertTrue(xml.contains(#"<trkpt lat="0" lon="0">"#))
        XCTAssertTrue(xml.contains(#"<trkpt lat="-12.5" lon="34.25">"#))
        XCTAssertTrue(xml.contains(#"<trkpt lat="0.0000001" lon="-0.0000002">"#))
        XCTAssertFalse(xml.contains("e-"))
        XCTAssertFalse(xml.contains("e+"))
        XCTAssertFalse(xml.contains("12,5"))
        XCTAssertLessThan(
            try XCTUnwrap(xml.range(of: #"lat="-12.5""#)?.lowerBound),
            try XCTUnwrap(xml.range(of: #"lon="34.25""#)?.lowerBound)
        )
    }

    @MainActor
    func testDecimalFormattingIsLocaleIndependentAndNeverUsesExponentNotation() {
        XCTAssertEqual(DefaultGPXService.decimalString(1.25), "1.25")
        XCTAssertEqual(DefaultGPXService.decimalString(-1.25), "-1.25")
        XCTAssertEqual(DefaultGPXService.decimalString(-0.0), "0")
        XCTAssertEqual(DefaultGPXService.decimalString(1e-7), "0.0000001")
        XCTAssertEqual(DefaultGPXService.decimalString(1e20), "100000000000000000000")
    }

    @MainActor
    func testFiniteElevationIsPreservedAndMissingElevationIsOmitted() async throws {
        let path = [
            Coordinate(latitude: 51, longitude: 10, elevationMeters: 0),
            Coordinate(latitude: 51.1, longitude: 10.1),
            Coordinate(latitude: 51.2, longitude: 10.2, elevationMeters: -12.75)
        ]
        let data = try await makeService().encodedGPX(for: makeRoute(path: path))
        let probe = try parse(data)

        XCTAssertEqual(probe.elevations, ["0", "-12.75"])
        XCTAssertEqual(probe.trackPoints.count, 3)
        XCTAssertEqual(probe.elevations.count, 2)
    }

    @MainActor
    func testXMLControlledCharactersAndUnicodeRoundTripThroughParser() async throws {
        let title = "A&B <Ridge> \"North\" 'Loop' — Über den Hügel"
        let data = try await makeService().encodedGPX(for: makeRoute(title: title))
        let xml = String(decoding: data, as: UTF8.self)
        let probe = try parse(data)

        XCTAssertTrue(xml.contains("A&amp;B"))
        XCTAssertTrue(xml.contains("&lt;Ridge&gt;"))
        XCTAssertTrue(xml.contains("&quot;North&quot;"))
        XCTAssertTrue(xml.contains("&apos;Loop&apos;"))
        XCTAssertEqual(probe.trackName, title)
    }

    @MainActor
    func testInvalidXMLControlCharactersAreRemovedSafely() async throws {
        let title = "North\u{0001} Ridge\u{000B}\nÜber"
        let data = try await makeService().encodedGPX(for: makeRoute(title: title))
        let probe = try parse(data)

        XCTAssertEqual(probe.trackName, "North Ridge\nÜber")
    }

    @MainActor
    func testFilenameSanitizesTraversalSeparatorsControlsAndEmptyNames() {
        XCTAssertEqual(DefaultGPXService.sanitizedFilename(for: "../../Secrets.gpx"), "Secrets.gpx")
        XCTAssertEqual(DefaultGPXService.sanitizedFilename(for: "Folder/Route\\Name"), "Folder-Route-Name.gpx")
        XCTAssertEqual(DefaultGPXService.sanitizedFilename(for: "\u{0001}/\\"), DefaultGPXService.fallbackFilename)
        XCTAssertEqual(DefaultGPXService.sanitizedFilename(for: "   "), DefaultGPXService.fallbackFilename)
        XCTAssertEqual(DefaultGPXService.sanitizedFilename(for: ".gpx"), DefaultGPXService.fallbackFilename)
    }

    @MainActor
    func testFilenamePreservesUnicodeBoundsLengthAndUsesExactlyOneExtension() {
        XCTAssertEqual(DefaultGPXService.sanitizedFilename(for: "Über den Hügel"), "Über den Hügel.gpx")
        XCTAssertEqual(DefaultGPXService.sanitizedFilename(for: "Route.GPX.gpx"), "Route.gpx")

        let filename = DefaultGPXService.sanitizedFilename(for: String(repeating: "Ä", count: 300))
        XCTAssertLessThanOrEqual(filename.utf8.count, DefaultGPXService.maximumFilenameStemBytes + 4)
        XCTAssertTrue(filename.hasSuffix(".gpx"))
        XCTAssertFalse(filename.lowercased().hasSuffix(".gpx.gpx"))
        XCTAssertFalse(filename.hasPrefix("."))
    }

    @MainActor
    func testSameTitleUsesUniqueDirectoriesWithoutChangingFriendlyFilename() async throws {
        let service = makeService(useRandomIdentifiers: true)
        let route = makeRoute(title: "Harz Loop")
        let first = try await service.prepareExport(route: route)
        let second = try await service.prepareExport(route: route)

        XCTAssertEqual(first.filename, second.filename)
        XCTAssertNotEqual(first.fileURL, second.fileURL)
        XCTAssertNotEqual(first.fileURL.deletingLastPathComponent(), second.fileURL.deletingLastPathComponent())
        _ = await service.cleanup(first)
        _ = await service.cleanup(second)
    }

    @MainActor
    func testAtomicWriteFailureProducesTypedPrivacySafeError() async {
        let fileSystem = RecordingGPXFileSystem()
        fileSystem.failure = .write
        let service = makeService(fileSystem: fileSystem)

        await assertThrowsErrorAsync({ try await service.prepareExport(route: makeRoute()) }) { error in
            XCTAssertEqual(error as? GPXExportError, .fileWriteFailed)
            XCTAssertFalse(error.localizedDescription.contains("51.8666"))
            XCTAssertFalse(error.localizedDescription.contains("<gpx"))
            XCTAssertFalse(error.localizedDescription.contains(service.exportRootDirectory.path))
        }
        XCTAssertEqual(fileSystem.atomicWrites.count, 1)
        XCTAssertEqual(fileSystem.removedItems.count, 1)
    }

    @MainActor
    func testPartialWriteAndRemovalDualFailureReturnsTrackedCleanupToken() async throws {
        let fileSystem = RecordingGPXFileSystem()
        fileSystem.failure = .partialWrite
        let service = makeService(fileSystem: fileSystem)
        let exportDirectory = deterministicExportDirectory(for: service)
        fileSystem.failedRemovals.insert(exportDirectory)

        let cleanupRequired: GPXCleanupRequiredError
        do {
            _ = try await service.prepareExport(route: makeRoute())
            return XCTFail("Expected a partial write plus removal failure to retain a cleanup token.")
        } catch let error as GPXCleanupRequiredError {
            cleanupRequired = error
        }

        XCTAssertEqual(cleanupRequired.primaryError, .fileWriteFailed)
        XCTAssertEqual(cleanupRequired.export.fileURL.deletingLastPathComponent(), exportDirectory)
        XCTAssertTrue(FileManager.default.fileExists(atPath: cleanupRequired.export.fileURL.path))
        XCTAssertTrue(fileSystem.protectedFiles.isEmpty)

        fileSystem.failure = nil
        fileSystem.failedRemovals.remove(exportDirectory)
        let cleanupSucceeded = await service.cleanup(cleanupRequired.export)
        XCTAssertTrue(cleanupSucceeded)
        XCTAssertFalse(FileManager.default.fileExists(atPath: cleanupRequired.export.fileURL.path))
    }

    @MainActor
    func testProtectionFailureDoesNotLeavePreciseLocationFile() async {
        let fileSystem = RecordingGPXFileSystem()
        fileSystem.failure = .protection
        let service = makeService(fileSystem: fileSystem)

        await assertThrowsErrorAsync({ try await service.prepareExport(route: makeRoute()) }) { error in
            XCTAssertEqual(error as? GPXExportError, .fileProtectionFailed)
        }
        XCTAssertEqual(fileSystem.protectedFiles.count, 1)
        XCTAssertEqual(fileSystem.removedItems.count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fileSystem.protectedFiles[0].path))
    }

    @MainActor
    func testProtectionAndRemovalDualFailureReturnsTrackedCleanupToken() async throws {
        let fileSystem = RecordingGPXFileSystem()
        fileSystem.failure = .protection
        let service = makeService(fileSystem: fileSystem)
        let exportDirectory = deterministicExportDirectory(for: service)
        fileSystem.failedRemovals.insert(exportDirectory)

        let cleanupRequired: GPXCleanupRequiredError
        do {
            _ = try await service.prepareExport(route: makeRoute())
            return XCTFail("Expected protection plus removal failure to retain a cleanup token.")
        } catch let error as GPXCleanupRequiredError {
            cleanupRequired = error
        }

        XCTAssertEqual(cleanupRequired.primaryError, .fileProtectionFailed)
        XCTAssertEqual(cleanupRequired.export.fileURL.deletingLastPathComponent(), exportDirectory)
        XCTAssertTrue(FileManager.default.fileExists(atPath: cleanupRequired.export.fileURL.path))
        XCTAssertFalse(cleanupRequired.localizedDescription.contains("51.8666"))

        fileSystem.failure = nil
        fileSystem.failedRemovals.remove(exportDirectory)
        let cleanupSucceeded = await service.cleanup(cleanupRequired.export)
        XCTAssertTrue(cleanupSucceeded)
        XCTAssertFalse(FileManager.default.fileExists(atPath: cleanupRequired.export.fileURL.path))
    }

    @MainActor
    func testCancellationCleanupFailureReturnsRetryableToken() async throws {
        let fileSystem = RecordingGPXFileSystem()
        let writeCompleted = expectation(description: "Atomic GPX write completed")
        let allowWriteToReturn = DispatchSemaphore(value: 0)
        fileSystem.afterAtomicWrite = {
            writeCompleted.fulfill()
            allowWriteToReturn.wait()
        }
        let service = makeService(fileSystem: fileSystem)
        let route = makeRoute()
        let exportDirectory = deterministicExportDirectory(for: service)
        fileSystem.failedRemovals.insert(exportDirectory)

        let preparation = Task { @MainActor in
            try await service.prepareExport(route: route)
        }
        await fulfillment(of: [writeCompleted], timeout: 5)
        preparation.cancel()
        allowWriteToReturn.signal()

        let cleanupRequired: GPXCleanupRequiredError
        do {
            _ = try await preparation.value
            return XCTFail("Expected cancelled preparation with failed cleanup to return its token.")
        } catch let error as GPXCleanupRequiredError {
            cleanupRequired = error
        }

        XCTAssertNil(cleanupRequired.primaryError)
        XCTAssertEqual(cleanupRequired.export.fileURL.deletingLastPathComponent(), exportDirectory)
        XCTAssertTrue(FileManager.default.fileExists(atPath: cleanupRequired.export.fileURL.path))

        fileSystem.failedRemovals.remove(exportDirectory)
        let cleanupSucceeded = await service.cleanup(cleanupRequired.export)
        XCTAssertTrue(cleanupSucceeded)
        XCTAssertFalse(FileManager.default.fileExists(atPath: cleanupRequired.export.fileURL.path))
    }

    @MainActor
    func testExportSurvivesUntilFlowFinishesThenCleanupIsIdempotent() async throws {
        let service = makeService()
        var flow = GPXExportFlow()

        XCTAssertTrue(flow.begin())
        XCTAssertFalse(flow.begin())
        let export = try await service.prepareExport(route: makeRoute())
        XCTAssertTrue(flow.didPrepare(export))
        XCTAssertEqual(flow.activeExport, export)
        XCTAssertEqual(flow.presentedExport, export)
        XCTAssertTrue(FileManager.default.fileExists(atPath: export.fileURL.path))
        XCTAssertFalse(flow.begin())

        flow.didDismissShareSheet()
        XCTAssertEqual(flow.activeExport, export)
        XCTAssertNil(flow.presentedExport)
        XCTAssertTrue(FileManager.default.fileExists(atPath: export.fileURL.path))

        let context = try XCTUnwrap(flow.beginFinishingSharing(export, outcome: .cancelled))
        let cleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(flow.finishCleanup(context, succeeded: cleanupSucceeded))
        XCTAssertNil(flow.activeExport)
        XCTAssertFalse(FileManager.default.fileExists(atPath: export.fileURL.path))

        XCTAssertNil(flow.beginFinishingSharing(export, outcome: .cancelled))
        let repeatedCleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(repeatedCleanupSucceeded, "Cleanup itself should remain idempotent.")
    }

    @MainActor
    func testCompletedAndCancelledSharingBothUsePreciseCleanup() async throws {
        let service = makeService(useRandomIdentifiers: true)
        for outcome in [GPXShareOutcome.completed, .cancelled] {
            var flow = GPXExportFlow()
            XCTAssertTrue(flow.begin())
            let export = try await service.prepareExport(route: makeRoute())
            XCTAssertTrue(flow.didPrepare(export))
            XCTAssertTrue(FileManager.default.fileExists(atPath: export.fileURL.path))
            let context = try XCTUnwrap(flow.beginFinishingSharing(export, outcome: outcome))
            let cleanupSucceeded = await service.cleanup(export)
            XCTAssertTrue(flow.finishCleanup(context, succeeded: cleanupSucceeded))
            XCTAssertFalse(FileManager.default.fileExists(atPath: export.fileURL.path))
            XCTAssertNil(flow.activeExport)
        }
    }

    @MainActor
    func testCancelledShareCleanupFailureRetainsHandleUntilRetrySucceeds() async throws {
        let fileSystem = RecordingGPXFileSystem()
        let service = makeService(fileSystem: fileSystem)
        let export = try await service.prepareExport(route: makeRoute())
        let exportDirectory = export.fileURL.deletingLastPathComponent().standardizedFileURL
        fileSystem.failedRemovals.insert(exportDirectory)
        var flow = GPXExportFlow()
        XCTAssertTrue(flow.begin())
        XCTAssertTrue(flow.didPrepare(export))

        let context = try XCTUnwrap(flow.beginFinishingSharing(export, outcome: .cancelled))
        let initialCleanupSucceeded = await service.cleanup(export)
        XCTAssertFalse(initialCleanupSucceeded)
        XCTAssertTrue(flow.finishCleanup(context, succeeded: initialCleanupSucceeded))
        XCTAssertEqual(flow.activeExport, export)
        XCTAssertTrue(flow.hasPendingCleanup)
        XCTAssertEqual(
            flow.errorMessage,
            GPXExportError.userMessage(for: GPXExportError.cleanupFailed)
        )
        XCTAssertFalse(flow.errorMessage?.localizedCaseInsensitiveContains("share") == true)

        fileSystem.failedRemovals.remove(exportDirectory)
        let retryContext = try XCTUnwrap(flow.beginCleanupRetry())
        let retrySucceeded = await service.cleanup(export)
        XCTAssertTrue(retrySucceeded)
        XCTAssertTrue(flow.finishCleanup(retryContext, succeeded: retrySucceeded))
        XCTAssertNil(flow.activeExport)
        XCTAssertNil(flow.errorMessage)
        XCTAssertFalse(FileManager.default.fileExists(atPath: export.fileURL.path))
    }

    @MainActor
    func testSheetTeardownFallbackIsExportKeyedAndIgnoresLateCompletion() async throws {
        let service = makeService()
        let export = try await service.prepareExport(route: makeRoute())
        let dispatcher = SuspendedGPXMainActorDispatcher()
        var flow = GPXExportFlow()
        XCTAssertTrue(flow.begin())
        XCTAssertTrue(flow.didPrepare(export))
        flow.didDismissShareSheet()
        XCTAssertNil(flow.beginFinishingDismissedShare(exportID: UUID()))

        var fallbackContext: GPXCleanupContext?
        var lateCompletionContext: GPXCleanupContext?
        let lifecycle = GPXShareLifecycleCoordinator(
            exportID: export.id,
            onComplete: { outcome in
                lateCompletionContext = flow.beginFinishingSharing(export, outcome: outcome)
            },
            onTeardown: { exportID in
                fallbackContext = flow.beginFinishingDismissedShare(exportID: exportID)
            },
            dispatcher: dispatcher
        )

        lifecycle.tearDown()
        lifecycle.receiveCompletion(.completed)
        XCTAssertEqual(dispatcher.pendingCount, 1)
        dispatcher.deliverAll()

        let context = try XCTUnwrap(fallbackContext)
        XCTAssertNil(lateCompletionContext)
        XCTAssertNil(flow.beginFinishingSharing(export, outcome: .completed))
        XCTAssertEqual(flow.activeExport, export)

        let cleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(cleanupSucceeded)
        XCTAssertTrue(flow.finishCleanup(context, succeeded: cleanupSucceeded))
        XCTAssertNil(flow.activeExport)
    }

    @MainActor
    func testUIKitCompletionClaimsLifecycleBeforePendingMainActorDeliveryAndTeardown() async {
        let dispatcher = SuspendedGPXMainActorDispatcher()
        let exportID = UUID()
        var deliveredOutcome: GPXShareOutcome?
        var teardownIDs: [UUID] = []
        let lifecycle = GPXShareLifecycleCoordinator(
            exportID: exportID,
            onComplete: { deliveredOutcome = $0 },
            onTeardown: { teardownIDs.append($0) },
            dispatcher: dispatcher
        )

        await Task.detached {
            lifecycle.receiveCompletion(.failed)
        }.value
        lifecycle.tearDown()

        XCTAssertNil(deliveredOutcome)
        XCTAssertTrue(teardownIDs.isEmpty)
        XCTAssertEqual(dispatcher.pendingCount, 1)

        dispatcher.deliverAll()

        XCTAssertEqual(deliveredOutcome, .failed)
        XCTAssertTrue(teardownIDs.isEmpty)
    }

    @MainActor
    func testMismatchedShareCallbackCannotCleanActiveExport() async throws {
        let service = makeService(useRandomIdentifiers: true)
        let activeExport = try await service.prepareExport(route: makeRoute(title: "Active"))
        let otherExport = try await service.prepareExport(route: makeRoute(title: "Other"))
        var flow = GPXExportFlow()
        XCTAssertTrue(flow.begin())
        XCTAssertTrue(flow.didPrepare(activeExport))

        XCTAssertNil(flow.beginFinishingSharing(otherExport, outcome: .completed))
        XCTAssertTrue(FileManager.default.fileExists(atPath: activeExport.fileURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: otherExport.fileURL.path))

        let context = try XCTUnwrap(flow.beginFinishingSharing(activeExport, outcome: .completed))
        let activeCleanupSucceeded = await service.cleanup(activeExport)
        XCTAssertTrue(flow.finishCleanup(context, succeeded: activeCleanupSucceeded))
        let otherCleanupSucceeded = await service.cleanup(otherExport)
        XCTAssertTrue(otherCleanupSucceeded)
    }

    @MainActor
    func testShareAndCleanupFailureRetainsHandleDisclosesBothAndRetries() async throws {
        let service = makeService(useRandomIdentifiers: true)
        let export = try await service.prepareExport(route: makeRoute())
        var flow = GPXExportFlow()
        XCTAssertTrue(flow.begin())
        XCTAssertTrue(flow.didPrepare(export))

        let context = try XCTUnwrap(flow.beginFinishingSharing(export, outcome: .failed))
        XCTAssertTrue(flow.finishCleanup(context, succeeded: false))
        XCTAssertEqual(flow.activeExport, export)
        XCTAssertTrue(flow.hasPendingCleanup)
        XCTAssertTrue(flow.errorMessage?.contains("could not share") == true)
        XCTAssertTrue(flow.errorMessage?.contains("remove") == true)
        XCTAssertFalse(flow.begin(), "A pending precise-file cleanup must block another export.")

        flow.dismissError()
        XCTAssertNil(flow.errorMessage)
        XCTAssertNotNil(flow.cleanupPendingMessage)

        let retryContext = try XCTUnwrap(flow.beginCleanupRetry())
        XCTAssertTrue(flow.isCleanupRetrying)
        let cleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(flow.finishCleanup(retryContext, succeeded: cleanupSucceeded))
        XCTAssertNil(flow.activeExport)
        XCTAssertEqual(
            flow.errorMessage,
            GPXExportError.userMessage(for: GPXExportError.shareFailed)
        )
        flow.dismissError()
        XCTAssertNil(flow.errorMessage)
    }

    @MainActor
    func testFlowClearsStaleErrorAndPreventsRepeatedAttempts() async throws {
        let service = makeService()
        var flow = GPXExportFlow()
        XCTAssertTrue(flow.begin())
        flow.didFail(GPXExportError.fileWriteFailed)
        XCTAssertNotNil(flow.errorMessage)

        XCTAssertTrue(flow.begin())
        XCTAssertNil(flow.errorMessage)
        XCTAssertFalse(flow.begin())

        let export = try await service.prepareExport(route: makeRoute())
        XCTAssertTrue(flow.didPrepare(export))
        XCTAssertFalse(flow.begin())
        let context = try XCTUnwrap(flow.beginFinishingSharing(export, outcome: .completed))
        let cleanupSucceeded = await service.cleanup(export)
        XCTAssertTrue(flow.finishCleanup(context, succeeded: cleanupSucceeded))
    }

    @MainActor
    func testRapidRepeatedAttemptsInvokePreparationOnlyOnce() async throws {
        let service = makeService()
        var flow = GPXExportFlow()
        var preparationCount = 0
        var export: PreparedGPXExport?

        for _ in 0..<10 where flow.begin() {
            preparationCount += 1
            export = try await service.prepareExport(route: makeRoute())
        }

        XCTAssertEqual(preparationCount, 1)
        let preparedExport = try XCTUnwrap(export)
        XCTAssertTrue(flow.didPrepare(preparedExport))
        let context = try XCTUnwrap(flow.beginFinishingSharing(preparedExport, outcome: .completed))
        let cleanupSucceeded = await service.cleanup(preparedExport)
        XCTAssertTrue(flow.finishCleanup(context, succeeded: cleanupSucceeded))
    }

    @MainActor
    func testStaleCleanupIsBoundedAndNeverRemovesUnrelatedFilesOrSymlinks() async throws {
        let base = makeTemporaryDirectory()
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let service = DefaultGPXService(
            temporaryDirectory: base,
            now: { now },
            staleExportAge: 60,
            maximumStaleRemovals: 2
        )
        try FileManager.default.createDirectory(
            at: service.exportRootDirectory,
            withIntermediateDirectories: true
        )

        let oldDirectories = try (0..<3).map { _ -> URL in
            let url = service.exportRootDirectory.appendingPathComponent("Export-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
            try FileManager.default.setAttributes(
                [.modificationDate: now.addingTimeInterval(-120)],
                ofItemAtPath: url.path
            )
            return url
        }
        let recentDirectory = service.exportRootDirectory.appendingPathComponent("Export-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: recentDirectory, withIntermediateDirectories: false)
        try FileManager.default.setAttributes(
            [.modificationDate: now],
            ofItemAtPath: recentDirectory.path
        )
        let unrelatedInsideRoot = service.exportRootDirectory.appendingPathComponent("notes.txt")
        try Data("keep".utf8).write(to: unrelatedInsideRoot)
        let nonUUIDDirectory = service.exportRootDirectory.appendingPathComponent("Export-not-a-uuid")
        try FileManager.default.createDirectory(at: nonUUIDDirectory, withIntermediateDirectories: false)
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-120)],
            ofItemAtPath: nonUUIDDirectory.path
        )
        let unrelatedOutsideRoot = base.appendingPathComponent("unrelated.txt")
        try Data("keep".utf8).write(to: unrelatedOutsideRoot)
        let symlinkTarget = base.appendingPathComponent("outside-directory")
        try FileManager.default.createDirectory(at: symlinkTarget, withIntermediateDirectories: false)
        let symlink = service.exportRootDirectory.appendingPathComponent("Export-\(UUID().uuidString)")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: symlinkTarget)

        try await service.cleanupStaleExports()

        XCTAssertEqual(oldDirectories.filter { FileManager.default.fileExists(atPath: $0.path) }.count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: recentDirectory.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: unrelatedInsideRoot.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: nonUUIDDirectory.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: unrelatedOutsideRoot.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: symlink.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: symlinkTarget.path))
    }

    @MainActor
    func testStaleCleanupRejectsSymlinkedExportRootWithoutDeletingTargetContents() async throws {
        let base = makeTemporaryDirectory()
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        let outsideRoot = makeTemporaryDirectory()
        try FileManager.default.createDirectory(at: outsideRoot, withIntermediateDirectories: true)
        let unrelatedExport = outsideRoot.appendingPathComponent("Export-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: unrelatedExport, withIntermediateDirectories: false)

        let service = DefaultGPXService(temporaryDirectory: base)
        try FileManager.default.createSymbolicLink(
            at: service.exportRootDirectory,
            withDestinationURL: outsideRoot
        )

        await assertThrowsErrorAsync({ try await service.cleanupStaleExports() }) { error in
            XCTAssertEqual(error as? GPXExportError, .temporaryStorageUnavailable)
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: unrelatedExport.path))
    }

    @MainActor
    func testActiveExportIsNeverRemovedByStaleSweepAcrossServiceInstances() async throws {
        let base = makeTemporaryDirectory()
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let serviceA = DefaultGPXService(
            temporaryDirectory: base,
            now: { now },
            staleExportAge: 60
        )
        let serviceB = DefaultGPXService(
            temporaryDirectory: base,
            now: { now },
            staleExportAge: 60
        )
        let export = try await serviceA.prepareExport(route: makeRoute())
        let exportDirectory = export.fileURL.deletingLastPathComponent()
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-120)],
            ofItemAtPath: exportDirectory.path
        )

        try await serviceB.cleanupStaleExports()

        XCTAssertTrue(FileManager.default.fileExists(atPath: export.fileURL.path))
        let cleanupSucceeded = await serviceA.cleanup(export)
        XCTAssertTrue(cleanupSucceeded)
    }

    @MainActor
    func testStaleCleanupContinuesAfterOneRemovalFailure() async throws {
        let base = makeTemporaryDirectory()
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let fileSystem = RecordingGPXFileSystem()
        let service = DefaultGPXService(
            temporaryDirectory: base,
            fileSystem: fileSystem,
            now: { now },
            staleExportAge: 60,
            maximumStaleRemovals: 2
        )
        try FileManager.default.createDirectory(
            at: service.exportRootDirectory,
            withIntermediateDirectories: true
        )
        let first = service.exportRootDirectory.appendingPathComponent("Export-\(UUID().uuidString)")
        let second = service.exportRootDirectory.appendingPathComponent("Export-\(UUID().uuidString)")
        for (url, age) in [(first, -180.0), (second, -120.0)] {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
            try FileManager.default.setAttributes(
                [.modificationDate: now.addingTimeInterval(age)],
                ofItemAtPath: url.path
            )
        }
        fileSystem.failedRemovals.insert(first.standardizedFileURL)

        try await service.cleanupStaleExports()

        XCTAssertTrue(FileManager.default.fileExists(atPath: first.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: second.path))
        let attemptedPaths = Set(fileSystem.removedItems.map { $0.standardizedFileURL.path })
        XCTAssertTrue(attemptedPaths.contains(first.standardizedFileURL.path))
        XCTAssertTrue(attemptedPaths.contains(second.standardizedFileURL.path))
    }

    @MainActor
    func testCleanupFailureLeavesBoundedRecordForLaterStaleRetry() async throws {
        let base = makeTemporaryDirectory()
        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let fileSystem = RecordingGPXFileSystem()
        let service = DefaultGPXService(
            temporaryDirectory: base,
            fileSystem: fileSystem,
            now: { now },
            staleExportAge: 60
        )
        let export = try await service.prepareExport(route: makeRoute())
        let exportDirectory = export.fileURL.deletingLastPathComponent().standardizedFileURL
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-120)],
            ofItemAtPath: exportDirectory.path
        )
        fileSystem.failedRemovals.insert(exportDirectory)

        let initialCleanupSucceeded = await service.cleanup(export)
        XCTAssertFalse(initialCleanupSucceeded)
        XCTAssertTrue(FileManager.default.fileExists(atPath: export.fileURL.path))

        fileSystem.failedRemovals.remove(exportDirectory)
        try await service.cleanupStaleExports()
        XCTAssertFalse(FileManager.default.fileExists(atPath: export.fileURL.path))
    }

    @MainActor
    func testPersistentCleanupFailureBlocksSecondPreparationAcrossServiceInstances() async throws {
        let base = makeTemporaryDirectory()
        let fileSystem = RecordingGPXFileSystem()
        let firstService = DefaultGPXService(
            temporaryDirectory: base,
            fileSystem: fileSystem,
            makeIdentifier: { UUID(uuidString: "11111111-2222-3333-4444-555555555555")! }
        )
        let export = try await firstService.prepareExport(route: makeRoute())
        let exportDirectory = export.fileURL.deletingLastPathComponent().standardizedFileURL
        fileSystem.failedRemovals.insert(exportDirectory)
        let initialCleanupSucceeded = await firstService.cleanup(export)
        XCTAssertFalse(initialCleanupSucceeded)
        let writeCountBeforeRetry = fileSystem.atomicWrites.count

        let freshService = DefaultGPXService(
            temporaryDirectory: base,
            fileSystem: fileSystem,
            makeIdentifier: { UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")! }
        )
        await assertThrowsErrorAsync({
            try await freshService.prepareExport(route: self.makeRoute(title: "Blocked second export"))
        }) { error in
            XCTAssertEqual(error as? GPXExportError, .cleanupFailed)
        }

        XCTAssertEqual(fileSystem.atomicWrites.count, writeCountBeforeRetry)
        XCTAssertTrue(FileManager.default.fileExists(atPath: export.fileURL.path))

        fileSystem.failedRemovals.remove(exportDirectory)
        let recovered = await freshService.recoverAbandonedExports()
        XCTAssertTrue(recovered)
        XCTAssertFalse(FileManager.default.fileExists(atPath: export.fileURL.path))
    }

    @MainActor
    func testPendingCleanupRetriesAreNotLimitedByStaleRemovalCap() async throws {
        let base = makeTemporaryDirectory()
        let fileSystem = RecordingGPXFileSystem()
        let service = DefaultGPXService(
            temporaryDirectory: base,
            fileSystem: fileSystem,
            makeIdentifier: { UUID() },
            maximumStaleRemovals: 1
        )
        var exports: [PreparedGPXExport] = []
        for index in 0..<21 {
            exports.append(
                try await service.prepareExport(route: makeRoute(title: "Pending \(index)"))
            )
        }
        let exportDirectories = Set(
            exports.map { $0.fileURL.deletingLastPathComponent().standardizedFileURL }
        )
        fileSystem.failedRemovals = exportDirectories

        for export in exports {
            let cleanupSucceeded = await service.cleanup(export)
            XCTAssertFalse(cleanupSucceeded)
        }

        fileSystem.failedRemovals.removeAll()
        try await service.cleanupStaleExports()

        XCTAssertTrue(exports.allSatisfy { !FileManager.default.fileExists(atPath: $0.fileURL.path) })
    }

    @MainActor
    func testSessionRecoveryRemovesRecentPriorProcessArtifactWithoutPreparingRoute() async throws {
        let base = makeTemporaryDirectory()
        let service = DefaultGPXService(temporaryDirectory: base)
        try FileManager.default.createDirectory(
            at: service.exportRootDirectory,
            withIntermediateDirectories: true
        )
        let abandonedDirectory = service.exportRootDirectory.appendingPathComponent(
            "Export-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: abandonedDirectory,
            withIntermediateDirectories: false
        )
        try Data("prior-process GPX".utf8).write(
            to: abandonedDirectory.appendingPathComponent("Route.gpx")
        )

        let recovered = await service.recoverAbandonedExports()

        XCTAssertTrue(recovered)
        XCTAssertFalse(FileManager.default.fileExists(atPath: abandonedDirectory.path))
    }

    @MainActor
    func testAppSessionClaimsStartupGPXRecoveryOnlyOnce() {
        var startup = TrailMindSessionStartupState()

        XCTAssertTrue(startup.claimGPXRecovery())
        XCTAssertTrue(startup.hasClaimedGPXRecovery)
        XCTAssertFalse(startup.claimGPXRecovery())
    }

    @MainActor
    func testSessionRecoveryExcludesRegistryActiveCurrentExport() async throws {
        let base = makeTemporaryDirectory()
        let owner = DefaultGPXService(temporaryDirectory: base)
        let recoveryService = DefaultGPXService(temporaryDirectory: base)
        let activeExport = try await owner.prepareExport(route: makeRoute())
        let abandonedDirectory = recoveryService.exportRootDirectory.appendingPathComponent(
            "Export-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: abandonedDirectory,
            withIntermediateDirectories: false
        )

        let recovered = await recoveryService.recoverAbandonedExports()

        XCTAssertTrue(recovered)
        XCTAssertTrue(FileManager.default.fileExists(atPath: activeExport.fileURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: abandonedDirectory.path))
        let cleanupSucceeded = await owner.cleanup(activeExport)
        XCTAssertTrue(cleanupSucceeded)
    }

    @MainActor
    func testCleanupRejectsExportOwnedByAnotherRoot() async throws {
        let owner = makeService()
        let otherService = makeService()
        let export = try await owner.prepareExport(route: makeRoute())

        let otherCleanupSucceeded = await otherService.cleanup(export)
        XCTAssertFalse(otherCleanupSucceeded)
        XCTAssertTrue(FileManager.default.fileExists(atPath: export.fileURL.path))
        let ownerCleanupSucceeded = await owner.cleanup(export)
        XCTAssertTrue(ownerCleanupSucceeded)
    }

    @MainActor
    func testTemporaryStorageFailuresMapToTypedPrivacySafeError() async throws {
        let base = makeTemporaryDirectory()
        let identifier = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!

        let rootFailureFileSystem = RecordingGPXFileSystem()
        let rootFailureService = DefaultGPXService(
            temporaryDirectory: base.appendingPathComponent("root-failure"),
            fileSystem: rootFailureFileSystem,
            makeIdentifier: { identifier }
        )
        rootFailureFileSystem.failedDirectoryCreations.insert(
            rootFailureService.exportRootDirectory.standardizedFileURL
        )
        await assertTemporaryStorageFailure(service: rootFailureService)
        XCTAssertTrue(rootFailureFileSystem.atomicWrites.isEmpty)

        let listingFailureFileSystem = RecordingGPXFileSystem()
        let listingFailureService = DefaultGPXService(
            temporaryDirectory: base.appendingPathComponent("listing-failure"),
            fileSystem: listingFailureFileSystem,
            makeIdentifier: { identifier }
        )
        listingFailureFileSystem.failedDirectoryListings.insert(
            listingFailureService.exportRootDirectory.standardizedFileURL
        )
        await assertTemporaryStorageFailure(service: listingFailureService)
        XCTAssertTrue(listingFailureFileSystem.atomicWrites.isEmpty)

        let exportDirectoryFailureFileSystem = RecordingGPXFileSystem()
        let exportDirectoryFailureService = DefaultGPXService(
            temporaryDirectory: base.appendingPathComponent("export-directory-failure"),
            fileSystem: exportDirectoryFailureFileSystem,
            makeIdentifier: { identifier }
        )
        let exportDirectory = exportDirectoryFailureService.exportRootDirectory
            .appendingPathComponent("Export-\(identifier.uuidString)", isDirectory: true)
            .standardizedFileURL
        exportDirectoryFailureFileSystem.failedDirectoryCreations.insert(exportDirectory)
        await assertTemporaryStorageFailure(service: exportDirectoryFailureService)
        XCTAssertTrue(exportDirectoryFailureFileSystem.atomicWrites.isEmpty)
    }

    @MainActor
    func testPartiallyCreatedExportDirectoryFailureRetainsRetryableCleanupToken() async throws {
        let base = makeTemporaryDirectory()
        let identifier = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        let fileSystem = RecordingGPXFileSystem()
        let service = DefaultGPXService(
            temporaryDirectory: base,
            fileSystem: fileSystem,
            makeIdentifier: { identifier }
        )
        let exportDirectory = service.exportRootDirectory
            .appendingPathComponent("Export-\(identifier.uuidString)", isDirectory: true)
            .standardizedFileURL

        fileSystem.partiallyCreatedDirectoryFailures.insert(exportDirectory)
        fileSystem.failedRemovals.insert(exportDirectory)

        var cleanupRequired: GPXCleanupRequiredError?
        await assertThrowsErrorAsync({ try await service.prepareExport(route: self.makeRoute()) }) { error in
            cleanupRequired = error as? GPXCleanupRequiredError
        }

        let retryableError = try XCTUnwrap(cleanupRequired)
        XCTAssertEqual(retryableError.primaryError, .temporaryStorageUnavailable)
        XCTAssertEqual(retryableError.export.fileURL.deletingLastPathComponent(), exportDirectory)
        XCTAssertTrue(FileManager.default.fileExists(atPath: exportDirectory.path))
        XCTAssertTrue(fileSystem.atomicWrites.isEmpty)

        fileSystem.failedRemovals.remove(exportDirectory)
        let cleanupSucceeded = await service.cleanup(retryableError.export)
        XCTAssertTrue(cleanupSucceeded)
        XCTAssertFalse(FileManager.default.fileExists(atPath: exportDirectory.path))
    }

    @MainActor
    func testSafeUserErrorsNeverExposeRouteOrFileDetails() {
        let errors: [GPXExportError] = [
            .temporaryStorageUnavailable,
            .fileWriteFailed,
            .fileProtectionFailed,
            .invalidDocument,
            .shareFailed,
            .cleanupFailed
        ]
        for error in errors {
            for message in [error.localizedDescription, GPXExportError.userMessage(for: error)] {
                XCTAssertFalse(message.contains("51.8666"))
                XCTAssertFalse(message.contains("10.6782"))
                XCTAssertFalse(message.contains("<gpx"))
                XCTAssertFalse(message.contains("/private/"))
            }
        }

        var flow = GPXExportFlow()
        XCTAssertTrue(flow.begin())
        flow.didFail(RouteEligibilityError.invalidGeometry(purpose: .export))
        XCTAssertEqual(
            flow.errorMessage,
            "This route cannot be exported because its verified route data is unavailable or invalid."
        )
    }

    @MainActor
    private func assertInvalidGeometry(
        _ path: [Coordinate],
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        let route = makeRoute(path: path)
        await assertThrowsErrorAsync(
            { try await self.makeService().prepareExport(route: route) },
            file: file,
            line: line
        ) { error in
            guard
                let eligibilityError = error as? RouteEligibilityError,
                case let .invalidGeometry(purpose) = eligibilityError
            else {
                return XCTFail("Unexpected error: \(error)", file: file, line: line)
            }
            XCTAssertEqual(purpose, .export, file: file, line: line)
        }
    }

    @MainActor
    private func assertTemporaryStorageFailure(
        service: DefaultGPXService,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        await assertThrowsErrorAsync(
            { try await service.prepareExport(route: self.makeRoute()) },
            file: file,
            line: line
        ) { error in
            XCTAssertEqual(
                error as? GPXExportError,
                .temporaryStorageUnavailable,
                file: file,
                line: line
            )
        }
    }

    @MainActor
    private func assertThrowsErrorAsync<T>(
        _ operation: () async throws -> T,
        file: StaticString = #filePath,
        line: UInt = #line,
        _ errorHandler: (Error) -> Void = { _ in }
    ) async {
        do {
            _ = try await operation()
            XCTFail("Expected operation to throw.", file: file, line: line)
        } catch {
            errorHandler(error)
        }
    }

    @MainActor
    private func makeService(
        fileSystem: any GPXFileSystem = SystemGPXFileSystem(),
        useRandomIdentifiers: Bool = false,
        executionProbe: @escaping @Sendable () -> Void = {}
    ) -> DefaultGPXService {
        let identifier = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        let identifierFactory: @Sendable () -> UUID
        if useRandomIdentifiers {
            identifierFactory = { UUID() }
        } else {
            identifierFactory = { identifier }
        }
        return DefaultGPXService(
            temporaryDirectory: makeTemporaryDirectory(),
            fileSystem: fileSystem,
            makeIdentifier: identifierFactory,
            executionProbe: executionProbe
        )
    }

    private func deterministicExportDirectory(for service: DefaultGPXService) -> URL {
        let identifier = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        return service.exportRootDirectory
            .appendingPathComponent("Export-\(identifier.uuidString)", isDirectory: true)
            .standardizedFileURL
    }

    private func makeTemporaryDirectory() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("TrailMind-GPXTests-\(UUID().uuidString)", isDirectory: true)
        temporaryURLs.append(url)
        return url
    }

    @MainActor
    private func makeRoute(
        title: String = "Verified Route",
        path: [Coordinate] = [
            Coordinate(latitude: 51.8666, longitude: 10.6782, elevationMeters: 260),
            Coordinate(latitude: 51.8671, longitude: 10.6791, elevationMeters: 265)
        ],
        provenance: RouteProvenance? = nil,
        distanceKilometers: Double = 2
    ) -> TrailRoute {
        let difficulty = RouteDifficulty.estimated(
            distanceKilometers: distanceKilometers,
            elevationGainMeters: 30
        )
        let routeProvenance = provenance ?? RouteProvenance.routingEngineOutput(
            provider: .graphHopper,
            strategy: .backend,
            activity: .hiking,
            routeType: .pointToPoint,
            distanceKilometers: distanceKilometers,
            elevationGainMeters: 30,
            elevationLossMeters: 20,
            durationHours: 0.75,
            difficulty: difficulty,
            path: path,
            verifiedCharacteristics: nil
        )
        return TrailRoute(
            id: UUID(),
            provenance: routeProvenance,
            title: title,
            location: "Harz",
            activity: .hiking,
            distanceKilometers: distanceKilometers,
            elevationGainMeters: 30,
            elevationLossMeters: 20,
            durationHours: 0.75,
            difficulty: difficulty,
            routeType: .pointToPoint,
            summary: "Verified routing result.",
            whyItMatches: "Matches the requested route.",
            highlights: [],
            waypoints: [],
            days: [],
            safetyNotes: [],
            elevationProfile: path.compactMap(\.elevationMeters),
            path: path
        )
    }

    @MainActor
    private func copy(
        _ route: TrailRoute,
        distanceKilometers: Double? = nil,
        elevationGainMeters: Int? = nil,
        elevationLossMeters: Int? = nil,
        durationHours: Double? = nil,
        difficulty: RouteDifficulty? = nil,
        path: [Coordinate]? = nil
    ) -> TrailRoute {
        TrailRoute(
            id: route.id,
            provenance: route.provenance,
            title: route.title,
            location: route.location,
            activity: route.activity,
            distanceKilometers: distanceKilometers ?? route.distanceKilometers,
            elevationGainMeters: elevationGainMeters ?? route.elevationGainMeters,
            elevationLossMeters: elevationLossMeters ?? route.elevationLossMeters,
            durationHours: durationHours ?? route.durationHours,
            difficulty: difficulty ?? route.difficulty,
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
            verifiedCharacteristics: route.verifiedCharacteristics
        )
    }

    private func parse(_ data: Data) throws -> GPXParserProbe {
        let probe = GPXParserProbe()
        let parser = XMLParser(data: data)
        parser.shouldProcessNamespaces = true
        parser.delegate = probe
        XCTAssertTrue(parser.parse(), parser.parserError?.localizedDescription ?? "XML did not parse")
        if let error = parser.parserError { throw error }
        return probe
    }
}

private final class RecordingGPXFileSystem: GPXFileSystem, @unchecked Sendable {
    enum Failure {
        case write
        case partialWrite
        case protection
    }

    var failure: Failure?
    var failedDirectoryCreations: Set<URL> = []
    var partiallyCreatedDirectoryFailures: Set<URL> = []
    var failedDirectoryListings: Set<URL> = []
    var failedRemovals: Set<URL> = []
    var afterAtomicWrite: (@Sendable () -> Void)?
    private(set) var atomicWrites: [URL] = []
    private(set) var protectedFiles: [URL] = []
    private(set) var removedItems: [URL] = []
    private let system = SystemGPXFileSystem()

    func createDirectory(at url: URL, withIntermediateDirectories: Bool) throws {
        let standardizedURL = url.standardizedFileURL
        if failedDirectoryCreations.contains(standardizedURL) {
            throw TestFileSystemError.expectedFailure
        }
        try system.createDirectory(at: url, withIntermediateDirectories: withIntermediateDirectories)
        if partiallyCreatedDirectoryFailures.contains(standardizedURL) {
            throw TestFileSystemError.expectedFailure
        }
    }

    func atomicWrite(_ data: Data, to url: URL) throws {
        atomicWrites.append(url)
        switch failure {
        case .write:
            throw TestFileSystemError.expectedFailure
        case .partialWrite:
            try system.atomicWrite(data, to: url)
            afterAtomicWrite?()
            throw TestFileSystemError.expectedFailure
        case .protection, nil:
            try system.atomicWrite(data, to: url)
            afterAtomicWrite?()
        }
    }

    func protectFile(at url: URL) throws {
        protectedFiles.append(url)
        if failure == .protection { throw TestFileSystemError.expectedFailure }
        try system.protectFile(at: url)
    }

    func directoryEntry(at url: URL) throws -> GPXDirectoryEntry {
        try system.directoryEntry(at: url)
    }

    func contentsOfDirectory(at url: URL) throws -> [GPXDirectoryEntry] {
        if failedDirectoryListings.contains(url.standardizedFileURL) {
            throw TestFileSystemError.expectedFailure
        }
        return try system.contentsOfDirectory(at: url)
    }

    func removeItem(at url: URL) throws {
        removedItems.append(url)
        if failedRemovals.contains(url.standardizedFileURL) {
            throw TestFileSystemError.expectedFailure
        }
        try system.removeItem(at: url)
    }
}

private final class SuspendedGPXMainActorDispatcher: GPXMainActorDispatching, @unchecked Sendable {
    private let lock = NSLock()
    private var operations: [@MainActor @Sendable () -> Void] = []

    var pendingCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return operations.count
    }

    func dispatch(_ operation: @escaping @MainActor @Sendable () -> Void) {
        lock.lock()
        operations.append(operation)
        lock.unlock()
    }

    @MainActor
    func deliverAll() {
        lock.lock()
        let pendingOperations = operations
        operations.removeAll()
        lock.unlock()

        for operation in pendingOperations {
            operation()
        }
    }
}

private final class ThreadExecutionProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Bool?

    var recordedIsMainThread: Bool? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func record(isMainThread: Bool) {
        lock.lock()
        value = isMainThread
        lock.unlock()
    }

    func reset() {
        lock.lock()
        value = nil
        lock.unlock()
    }
}

private enum TestFileSystemError: Error {
    case expectedFailure
}

private final class GPXParserProbe: NSObject, XMLParserDelegate {
    private(set) var rootElement: String?
    private(set) var rootNamespace: String?
    private(set) var rootAttributes: [String: String] = [:]
    private(set) var elements: [String] = []
    private(set) var trackPoints: [[String: String]] = []
    private(set) var elevations: [String] = []
    private(set) var trackName: String?

    private var capturedElement: String?
    private var capturedText = ""

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        elements.append(elementName)
        if rootElement == nil {
            rootElement = elementName
            rootNamespace = namespaceURI
            rootAttributes = attributeDict
        }
        if elementName == "trkpt" {
            trackPoints.append(attributeDict)
        }
        if elementName == "name" || elementName == "ele" {
            capturedElement = elementName
            capturedText = ""
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard capturedElement != nil else { return }
        capturedText += string
    }

    func parser(
        _ parser: XMLParser,
        didEndElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?
    ) {
        guard capturedElement == elementName else { return }
        if elementName == "name", trackName == nil {
            trackName = capturedText
        } else if elementName == "ele" {
            elevations.append(capturedText)
        }
        capturedElement = nil
        capturedText = ""
    }
}
