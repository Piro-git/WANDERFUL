import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class OutdoorRouteEvidenceTests: XCTestCase {
    override func tearDown() {
        OutdoorEvidenceURLProtocolStub.reset(responses: [])
        super.tearDown()
    }

    func testRequestEncodingPreservesLatitudeLongitudeNamesAndAuthorization() async throws {
        OutdoorEvidenceURLProtocolStub.reset(responses: [.init(statusCode: 200, data: Self.knownResponse())])
        let authorizer = RecordingOutdoorEvidenceAuthorizer()
        let snapshot = try await makeProvider(authorizer: authorizer).evidence(for: Self.query)

        XCTAssertEqual(snapshot.mappedHikingRouteRatio.value, 0.5)
        let request = try XCTUnwrap(OutdoorEvidenceURLProtocolStub.requests().first)
        let body = try XCTUnwrap(request.httpBody)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(object["schemaVersion"] as? Int, 1)
        XCTAssertEqual(object["routeFingerprint"] as? String, "abc123")
        let geometry = try XCTUnwrap(object["geometry"] as? [[String: Double]])
        XCTAssertEqual(geometry[0], ["latitude": 51.8, "longitude": 10.61])
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "TrailMindRouteSession test-session-token")
        XCTAssertNotNil(request.value(forHTTPHeaderField: "X-TrailMind-Request-ID"))
        let costs = await authorizer.costs()
        XCTAssertEqual(costs, [4])
    }

    func testKnownResponsePreservesProvenanceAndMergesIntoQualityEvidence() async throws {
        OutdoorEvidenceURLProtocolStub.reset(responses: [.init(statusCode: 200, data: Self.knownResponse())])
        let outdoor = try await makeProvider().evidence(for: Self.query)
        XCTAssertEqual(outdoor.provenance?.regionID, "harz-v1")
        XCTAssertEqual(outdoor.regionCoverage?.isPartial, false)
        XCTAssertEqual(outdoor.provenance?.freshness, .sourceCurrent)
        XCTAssertEqual(outdoor.mappedPointOfInterestCount.value, 2)
        XCTAssertEqual(outdoor.explicitAccessRestrictionCount.value, 1)
        XCTAssertEqual(outdoor.mappedPointsOfInterest.first?.coordinate.longitude, 10.63)

        let route = TestRouteFixtures.luneburgLoop
        let request = RoutePlanningRequest(
            routeType: route.routeType,
            startQuery: "Start",
            endQuery: nil,
            activityType: route.activity,
            graphHopperProfile: "foot",
            targetDistanceKm: route.distanceKilometers,
            targetDurationMinutes: nil,
            difficulty: route.difficulty,
            desiredFeatures: []
        )
        let analysis = RouteAlternativeQuality.analyze(
            route: route,
            request: request,
            policy: HikingRouteQualityPolicy.v1.structuralPolicy
        )
        let engine = HikingRouteQualityEngine(policy: .v1)
        let baseline = engine.assessment(
            for: RouteSuggestion(route: route, explanation: route.whyItMatches),
            providerIndex: 0,
            request: request,
            analysis: analysis
        )
        let merged = engine.assessment(
            for: RouteSuggestion(route: route, explanation: route.whyItMatches),
            providerIndex: 0,
            request: request,
            analysis: analysis,
            outdoorEvidence: outdoor
        )
        XCTAssertEqual(merged.evidence.mappedHikingRouteRatio.value, 0.5)
        XCTAssertEqual(merged.evidence.mappedPointOfInterestCount.value, 2)
        XCTAssertEqual(merged.eligibility.isEligible, baseline.eligibility.isEligible)
        XCTAssertEqual(merged.objectives.map(\.normalizedLoss), baseline.objectives.map(\.normalizedLoss))
    }

    func testStalePartialUnavailableAndUnsupportedStatesNeverBecomeKnownZero() async throws {
        for (data, expectedStatus) in [
            (Self.knownResponse(status: "stale", freshness: "stale", regionalCoverage: 0.5), RouteEvidenceStatus.stale),
            (Self.knownResponse(status: "unavailable", freshness: "sourceTimestampUnavailable", sourceTimestamp: nil), .unavailable),
            (Self.unsupportedResponse(), .unsupported)
        ] {
            OutdoorEvidenceURLProtocolStub.reset(responses: [.init(statusCode: 200, data: data)])
            let snapshot = try await makeProvider().evidence(for: Self.query)
            XCTAssertEqual(snapshot.mappedHikingRouteRatio.status, expectedStatus)
            XCTAssertNil(snapshot.mappedHikingRouteRatio.value)
            XCTAssertNil(snapshot.mappedPointOfInterestCount.value)
        }
    }

    func testUnavailableDatasetRetainsExplicitPartialRegionCoverage() async throws {
        OutdoorEvidenceURLProtocolStub.reset(responses: [
            .init(statusCode: 200, data: Self.unavailableDatasetResponse())
        ])
        let snapshot = try await makeProvider().evidence(for: Self.query)
        XCTAssertEqual(snapshot.mappedHikingRouteRatio.status, .unavailable)
        XCTAssertEqual(snapshot.regionCoverage?.regionID, "harz-v1")
        XCTAssertEqual(snapshot.regionCoverage?.isPartial, true)
        XCTAssertEqual(snapshot.regionCoverage?.routeCoverageRatio, 0.42)
        XCTAssertNil(snapshot.provenance)
        XCTAssertTrue(snapshot.warningCodes.contains("partialRegionalCoverage"))
    }

    func testMultiRegionResponsePreservesIndependentCurrentAndStaleImports() async throws {
        OutdoorEvidenceURLProtocolStub.reset(responses: [
            .init(statusCode: 200, data: Self.multiRegionResponse(alpineFreshness: "stale"))
        ])
        let snapshot = try await makeProvider().evidence(for: Self.query)
        XCTAssertEqual(snapshot.regionStates.map(\.coverage.regionID), ["harz-v1", "innsbruck-alps-v1"])
        XCTAssertEqual(snapshot.regionStates.map(\.evidenceStatus), [.known, .stale])
        XCTAssertEqual(snapshot.regionStates.compactMap(\.provenance).count, 2)
        XCTAssertEqual(snapshot.overallRegionalCoverageRatio, 1)
        XCTAssertEqual(snapshot.mappedHikingRouteRatio.status, .stale)
        XCTAssertNil(snapshot.mappedPointOfInterestCount.value)
    }

    func testMalformedVersionRatiosCoordinatesAndUnknownFieldsFailClosed() async throws {
        let payloads = [
            Self.knownResponse(schemaVersion: 3),
            Self.knownResponse(mappedHikingRatio: 1.1),
            Self.knownResponse(poiLatitude: 95),
            Self.knownResponse(extraTopLevelField: true),
            Self.knownResponse(extraNestedField: true)
        ]
        for payload in payloads {
            OutdoorEvidenceURLProtocolStub.reset(responses: [.init(statusCode: 200, data: payload)])
            let snapshot = try await makeProvider().evidence(for: Self.query)
            XCTAssertEqual(snapshot.mappedHikingRouteRatio.status, .malformed)
            XCTAssertNil(snapshot.mappedPointOfInterestCount.value)
        }
    }

    func testOversizedResponseAndSafeBackendErrorsMapWithoutKnownZeros() async throws {
        let smallLimits = OutdoorEvidenceTransportLimits(
            maximumRequestBodyBytes: 128 * 1_024,
            maximumSuccessBodyBytes: 512,
            maximumErrorBodyBytes: 128,
            maximumRequestCoordinates: 1_600,
            maximumSimplificationDeviationMeters: 15,
            maximumMappedPointsOfInterest: 100
        )
        OutdoorEvidenceURLProtocolStub.reset(responses: [
            .init(statusCode: 200, data: Data(repeating: 0x20, count: 513))
        ])
        var snapshot = try await makeProvider(limits: smallLimits).evidence(for: Self.query)
        XCTAssertEqual(snapshot.mappedHikingRouteRatio.status, .rejected)

        for (statusCode, code, expected) in [
            (503, "evidence_unavailable", RouteEvidenceStatus.unavailable),
            (400, "invalid_coordinates", .rejected)
        ] {
            OutdoorEvidenceURLProtocolStub.reset(responses: [
                .init(statusCode: statusCode, data: Self.errorResponse(code: code, message: "private database detail"))
            ])
            snapshot = try await makeProvider().evidence(for: Self.query)
            XCTAssertEqual(snapshot.mappedHikingRouteRatio.status, expected)
            XCTAssertNil(snapshot.provenance)
        }
    }

    func testExpiredSessionRefreshesExactlyOnce() async throws {
        OutdoorEvidenceURLProtocolStub.reset(responses: [
            .init(statusCode: 401, data: Self.errorResponse(code: "route_session_expired", message: "expired")),
            .init(statusCode: 200, data: Self.knownResponse())
        ])
        let authorizer = RecordingOutdoorEvidenceAuthorizer()
        let snapshot = try await makeProvider(authorizer: authorizer).evidence(for: Self.query)
        XCTAssertEqual(snapshot.mappedHikingRouteRatio.status, .known)
        let costs = await authorizer.costs()
        let invalidatedTokens = await authorizer.invalidatedTokens()
        XCTAssertEqual(costs, [4, 4])
        XCTAssertEqual(invalidatedTokens, ["test-session-token"])
        XCTAssertEqual(OutdoorEvidenceURLProtocolStub.requests().count, 2)
    }

    func testCancellationRejectsLateResponse() async throws {
        OutdoorEvidenceURLProtocolStub.reset(responses: [
            .init(statusCode: 200, data: Self.knownResponse(), delay: 0.2, deliversAfterStop: true)
        ])
        let task = Task { try await makeProvider().evidence(for: Self.query) }
        for _ in 0..<50 where OutdoorEvidenceURLProtocolStub.requests().isEmpty {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(OutdoorEvidenceURLProtocolStub.requests().count, 1)
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("Cancellation must not become a known evidence snapshot.")
        } catch is CancellationError {
            // Expected.
        }
        try await Task.sleep(for: .milliseconds(220))
        XCTAssertGreaterThanOrEqual(OutdoorEvidenceURLProtocolStub.stopLoadingCount(), 1)
    }

    func testGeometrySimplifierPreservesEndpointsAndMaterialTurnsWithinBound() throws {
        var points = (0..<2_000).map { index in
            Coordinate(latitude: 51.8, longitude: 10.6 + Double(index) * 0.000_001)
        }
        points[1_000] = Coordinate(latitude: 51.801, longitude: points[1_000].longitude)
        let simplified = try OutdoorEvidenceGeometrySimplifier.simplify(
            points,
            maximumCount: 100,
            maximumDeviationMeters: 15
        )
        XCTAssertLessThanOrEqual(simplified.count, 100)
        XCTAssertEqual(simplified.first, points.first)
        XCTAssertEqual(simplified.last, points.last)
        XCTAssertTrue(simplified.contains(points[1_000]))
    }

    func testNoOpAndMissingBackendRemainDeterministicFallbacks() async throws {
        let noOp = try await NoOpOutdoorRouteEvidenceProvider().evidence(for: Self.query)
        XCTAssertEqual(noOp.mappedHikingRouteRatio.status, .unsupported)
        let missing = try await BackendOutdoorRouteEvidenceProvider(
            baseURL: nil,
            authorizer: RecordingOutdoorEvidenceAuthorizer()
        ).evidence(for: Self.query)
        XCTAssertEqual(missing.mappedHikingRouteRatio.status, .unsupported)
        XCTAssertTrue(OutdoorEvidenceURLProtocolStub.requests().isEmpty)
    }

    func testMissingFlagSelectsNoOpProviderEvenWithValidBackendURL() throws {
        let bundle = try makeConfigurationBundle([
            "INTENT_BACKEND_BASE_URL": "https://example.com"
        ])

        let provider = OutdoorRouteEvidenceProviderFactory.makeDefault(bundle: bundle)

        XCTAssertTrue(provider is NoOpOutdoorRouteEvidenceProvider)
        XCTAssertFalse(provider.collectionEnabled)
    }

    func testExplicitFalseValuesSelectNoOpProvider() throws {
        for value: Any in [false, "false", "no", "0"] {
            let bundle = try makeConfigurationBundle([
                "INTENT_BACKEND_BASE_URL": "https://example.com",
                "OUTDOOR_EVIDENCE_ENABLED": value
            ])

            let provider = OutdoorRouteEvidenceProviderFactory.makeDefault(bundle: bundle)

            XCTAssertTrue(provider is NoOpOutdoorRouteEvidenceProvider, "Unexpected value: \(value)")
            XCTAssertFalse(provider.collectionEnabled)
        }
    }

    func testMalformedFlagValuesSelectNoOpProvider() throws {
        for value: Any in ["enabled", "2", "", 2, ["true"]] {
            let bundle = try makeConfigurationBundle([
                "INTENT_BACKEND_BASE_URL": "https://example.com",
                "OUTDOOR_EVIDENCE_ENABLED": value
            ])

            let provider = OutdoorRouteEvidenceProviderFactory.makeDefault(bundle: bundle)

            XCTAssertTrue(provider is NoOpOutdoorRouteEvidenceProvider, "Unexpected value: \(value)")
            XCTAssertFalse(provider.collectionEnabled)
        }
    }

    func testExplicitTrueValuesWithValidBackendURLSelectBackendProvider() throws {
        for value: Any in [true, "true", "yes", "1"] {
            let bundle = try makeConfigurationBundle([
                "INTENT_BACKEND_BASE_URL": "https://example.com",
                "OUTDOOR_EVIDENCE_ENABLED": value
            ])

            let provider = OutdoorRouteEvidenceProviderFactory.makeDefault(bundle: bundle)

            XCTAssertTrue(provider is BackendOutdoorRouteEvidenceProvider, "Unexpected value: \(value)")
            XCTAssertTrue(provider.collectionEnabled)
        }
    }

    func testExplicitTrueWithoutValidBackendURLSelectsNoOpProvider() throws {
        let bundle = try makeConfigurationBundle([
            "OUTDOOR_EVIDENCE_ENABLED": "true"
        ])

        let provider = OutdoorRouteEvidenceProviderFactory.makeDefault(bundle: bundle)

        XCTAssertTrue(provider is NoOpOutdoorRouteEvidenceProvider)
        XCTAssertFalse(provider.collectionEnabled)
    }

    func testPostRoutingCompositionFetchesEvidenceWithoutChangingSuggestions() async throws {
        let suggestion = RouteSuggestion(
            id: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            route: TestRouteFixtures.luneburgLoop,
            explanation: "Verified routed fixture"
        )
        let provider = RecordingOutdoorRouteEvidenceProvider()
        guard case let .routed(provenance) = suggestion.route.provenance else {
            return XCTFail("Fixture must be routed")
        }
        let snapshots = await OutdoorEvidencePostRoutingCollector(provider: provider).collect([
            OutdoorEvidencePostRoutingCandidate(
                suggestionID: suggestion.id,
                query: OutdoorRouteEvidenceQuery(
                    routeFingerprint: provenance.factFingerprint,
                    geometry: suggestion.route.path
                )
            )
        ])

        XCTAssertEqual(suggestion, RouteSuggestion(
            id: suggestion.id,
            route: suggestion.route,
            explanation: suggestion.explanation
        ))
        XCTAssertEqual(snapshots[suggestion.id]?.mappedHikingRouteRatio.status, .unsupported)
        let queries = await provider.queries()
        XCTAssertEqual(queries.count, 1)
        XCTAssertEqual(queries[0].geometry, suggestion.route.path)
        XCTAssertEqual(queries[0].routeFingerprint, provenance.factFingerprint)
    }

    private func makeProvider(
        authorizer: any RouteSessionAuthorizing = RecordingOutdoorEvidenceAuthorizer(),
        limits: OutdoorEvidenceTransportLimits = .standard
    ) -> BackendOutdoorRouteEvidenceProvider {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OutdoorEvidenceURLProtocolStub.self]
        return BackendOutdoorRouteEvidenceProvider(
            baseURL: URL(string: "https://example.com")!,
            session: URLSession(configuration: configuration),
            authorizer: authorizer,
            limits: limits
        )
    }

    private func makeConfigurationBundle(_ values: [String: Any]) throws -> Bundle {
        let identifier = UUID().uuidString.lowercased()
        let bundleURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("TrailMindConfiguration-\(identifier)", isDirectory: true)
            .appendingPathExtension("bundle")
        try FileManager.default.createDirectory(
            at: bundleURL,
            withIntermediateDirectories: true
        )
        var info: [String: Any] = [
            "CFBundleIdentifier": "com.trailmind.tests.\(identifier)",
            "CFBundleInfoDictionaryVersion": "6.0",
            "CFBundleName": "TrailMindConfigurationTests",
            "CFBundlePackageType": "BNDL",
            "CFBundleVersion": "1"
        ]
        for (key, value) in values { info[key] = value }
        let data = try PropertyListSerialization.data(
            fromPropertyList: info,
            format: .xml,
            options: 0
        )
        try data.write(to: bundleURL.appendingPathComponent("Info.plist", isDirectory: false))
        addTeardownBlock { try? FileManager.default.removeItem(at: bundleURL) }
        return try XCTUnwrap(Bundle(url: bundleURL))
    }

    private static let query = OutdoorRouteEvidenceQuery(
        routeFingerprint: RouteFactFingerprint(rawValue: "abc123"),
        geometry: [
            Coordinate(latitude: 51.8, longitude: 10.61),
            Coordinate(latitude: 51.81, longitude: 10.63)
        ]
    )

    private static func knownResponse(
        schemaVersion: Int = 2,
        status: String = "known",
        freshness: String = "current",
        regionalCoverage: Double = 1,
        sourceTimestamp: String? = "2026-07-19T00:00:00Z",
        mappedHikingRatio: Double = 0.5,
        poiLatitude: Double = 51.81,
        extraTopLevelField: Bool = false,
        extraNestedField: Bool = false
    ) -> Data {
        var warnings: [String] = []
        if regionalCoverage != 1 { warnings.append("partialRegionalCoverage") }
        if freshness == "stale" { warnings.append("datasetStale") }
        if freshness == "sourceTimestampUnavailable" {
            warnings.append("sourceTimestampUnavailable")
        }
        if status != "unavailable" {
            warnings.append("osmMappedEvidenceOnly")
            warnings.append("missingTagsRemainUnknown")
        }
        let importID = "11111111-1111-4111-8111-111111111111"
        let datasetName = "Geofabrik regional extract"
        let dataset: [String: Any] = [
            "importId": importID,
            "sourceDataset": datasetName,
            "sourceIdentifier": "https://download.geofabrik.de/europe/germany.html",
            "sourceDataTimestamp": sourceTimestamp ?? NSNull(),
            "importedTimestamp": "2026-07-19T02:00:00Z",
            "freshnessStatus": freshness
        ]
        let region: [String: Any] = [
            "id": "harz-v1", "name": "Harz v1",
            "coverageStatus": regionalCoverage == 1 ? "full" : "partial",
            "routeCoverageRatio": regionalCoverage,
            "evidenceStatus": status,
            "dataset": dataset
        ]
        let hasEvidence = status != "unavailable"
        func evidenceValue(_ value: Any) -> Any {
            if hasEvidence { return value }
            return NSNull()
        }
        var object: [String: Any] = [
            "schemaVersion": schemaVersion,
            "routeFingerprint": "abc123",
            "evidenceStatus": status,
            "regions": [region],
            "overallRegionalCoverageRatio": regionalCoverage,
            "osmAttribution": [
                "notice": "© OpenStreetMap contributors", "license": "ODbL 1.0",
                "url": "https://www.openstreetmap.org/copyright"
            ],
            "attributeCoverage": [
                "highway": evidenceValue(0.8),
                "surface": evidenceValue(0.6),
                "trailVisibility": evidenceValue(0.4),
                "sacScale": evidenceValue(0.3),
                "explicitAccess": evidenceValue(0.2)
            ],
            "mappedHikingRouteCoverageRatio": evidenceValue(mappedHikingRatio),
            "highwayLengthBreakdown": hasEvidence ? [["value": "path", "lengthMeters": 800]] : [],
            "surfaceLengthBreakdown": hasEvidence ? [["value": "ground", "lengthMeters": 600]] : [],
            "trailVisibilityLengthBreakdown": hasEvidence ? [["value": "good", "lengthMeters": 400]] : [],
            "sacScaleLengthBreakdown": hasEvidence ? [["value": "mountain_hiking", "lengthMeters": 300]] : [],
            "maximumKnownSacScale": evidenceValue("mountain_hiking"),
            "explicitAccessRestrictions": hasEvidence ? [[
                "sourceIdentity": ["osmType": "way", "osmId": "42"],
                "access": "private", "foot": NSNull(), "conditional": false,
                "seasonal": false, "permitRequired": false
            ]] : [],
            "mappedPoiCounts": evidenceValue([
                "viewpoint": 1, "peak": 1, "lake": 0, "waterfall": 0,
                "alpineHut": 0, "wildernessHut": 0
            ]),
            "mappedPois": hasEvidence ? [[
                "sourceIdentity": ["osmType": "node", "osmId": "7"],
                "category": "viewpoint", "name": "Mapped Lookout",
                "coordinate": ["latitude": poiLatitude, "longitude": 10.63],
                "distanceFromRouteMeters": 12,
                "provenance": [
                    "regionId": "harz-v1", "importId": importID,
                    "sourceDataset": datasetName,
                    "sourceVersion": 3, "sourceTimestamp": "2026-07-18T00:00:00Z"
                ]
            ]] : [],
            "warnings": warnings
        ]
        if extraTopLevelField { object["rawTags"] = ["secret": "value"] }
        if extraNestedField {
            var region = (object["regions"] as! [[String: Any]])[0]
            region["official"] = true
            object["regions"] = [region]
        }
        return try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private static func unsupportedResponse() -> Data {
        let object: [String: Any] = [
            "schemaVersion": 2, "routeFingerprint": "abc123", "evidenceStatus": "unsupported",
            "regions": [], "overallRegionalCoverageRatio": 0,
            "osmAttribution": [
                "notice": "© OpenStreetMap contributors", "license": "ODbL 1.0",
                "url": "https://www.openstreetmap.org/copyright"
            ],
            "attributeCoverage": [
                "highway": NSNull(), "surface": NSNull(), "trailVisibility": NSNull(),
                "sacScale": NSNull(), "explicitAccess": NSNull()
            ],
            "mappedHikingRouteCoverageRatio": NSNull(),
            "highwayLengthBreakdown": [], "surfaceLengthBreakdown": [],
            "trailVisibilityLengthBreakdown": [], "sacScaleLengthBreakdown": [],
            "maximumKnownSacScale": NSNull(), "explicitAccessRestrictions": [],
            "mappedPoiCounts": NSNull(), "mappedPois": [],
            "warnings": ["routeOutsideSupportedRegion"]
        ]
        return try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private static func unavailableDatasetResponse() -> Data {
        let object: [String: Any] = [
            "schemaVersion": 2, "routeFingerprint": "abc123", "evidenceStatus": "unavailable",
            "regions": [[
                "id": "harz-v1", "name": "Harz v1", "coverageStatus": "partial",
                "routeCoverageRatio": 0.42, "evidenceStatus": "unavailable",
                "dataset": NSNull()
            ]],
            "overallRegionalCoverageRatio": 0.42,
            "osmAttribution": [
                "notice": "© OpenStreetMap contributors", "license": "ODbL 1.0",
                "url": "https://www.openstreetmap.org/copyright"
            ],
            "attributeCoverage": [
                "highway": NSNull(), "surface": NSNull(), "trailVisibility": NSNull(),
                "sacScale": NSNull(), "explicitAccess": NSNull()
            ],
            "mappedHikingRouteCoverageRatio": NSNull(),
            "highwayLengthBreakdown": [], "surfaceLengthBreakdown": [],
            "trailVisibilityLengthBreakdown": [], "sacScaleLengthBreakdown": [],
            "maximumKnownSacScale": NSNull(), "explicitAccessRestrictions": [],
            "mappedPoiCounts": NSNull(), "mappedPois": [],
            "warnings": ["partialRegionalCoverage", "datasetUnavailable"]
        ]
        return try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private static func multiRegionResponse(alpineFreshness: String) -> Data {
        var object = try! JSONSerialization.jsonObject(with: knownResponse()) as! [String: Any]
        var harz = (object["regions"] as! [[String: Any]])[0]
        harz["coverageStatus"] = "partial"
        harz["routeCoverageRatio"] = 0.6
        let alpineDataset: [String: Any] = [
            "importId": "22222222-2222-4222-8222-222222222222",
            "sourceDataset": "Operator-selected Tyrol regional OSM extract",
            "sourceIdentifier": "operator-supplied-tyrol-pilot-extract",
            "sourceDataTimestamp": alpineFreshness == "stale"
                ? "2026-05-01T00:00:00Z" : "2026-07-19T00:00:00Z",
            "importedTimestamp": "2026-07-19T02:00:00Z",
            "freshnessStatus": alpineFreshness
        ]
        let alpine: [String: Any] = [
            "id": "innsbruck-alps-v1", "name": "Innsbruck Alpine Pilot v1",
            "coverageStatus": "partial", "routeCoverageRatio": 0.4,
            "evidenceStatus": alpineFreshness == "stale" ? "stale" : "known",
            "dataset": alpineDataset
        ]
        object["regions"] = [harz, alpine]
        object["overallRegionalCoverageRatio"] = 1
        if alpineFreshness == "stale" {
            object["evidenceStatus"] = "stale"
            var warnings = object["warnings"] as! [String]
            warnings.insert("datasetStale", at: 0)
            object["warnings"] = warnings
        }
        return try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    private static func errorResponse(code: String, message: String) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            "error": ["code": code, "message": message]
        ])
    }
}

private actor RecordingOutdoorRouteEvidenceProvider: OutdoorRouteEvidenceProviding {
    private var recordedQueries: [OutdoorRouteEvidenceQuery] = []

    func evidence(for query: OutdoorRouteEvidenceQuery) async throws -> OutdoorRouteEvidenceSnapshot {
        recordedQueries.append(query)
        return .unsupported
    }

    func queries() -> [OutdoorRouteEvidenceQuery] { recordedQueries }
}

private actor RecordingOutdoorEvidenceAuthorizer: RouteSessionAuthorizing {
    private var recordedCosts: [Int] = []
    private var invalidations: [String] = []

    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        recordedCosts.append(cost)
        return RouteSessionAuthorization(
            token: recordedCosts.count == 1 ? "test-session-token" : "refreshed-session-token",
            requestID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        )
    }

    func invalidate(token: String) async { invalidations.append(token) }
    func costs() -> [Int] { recordedCosts }
    func invalidatedTokens() -> [String] { invalidations }
}

private final class OutdoorEvidenceURLProtocolStub: URLProtocol, @unchecked Sendable {
    struct Response: @unchecked Sendable {
        let statusCode: Int
        let data: Data
        let delay: TimeInterval
        let deliversAfterStop: Bool

        init(
            statusCode: Int,
            data: Data,
            delay: TimeInterval = 0,
            deliversAfterStop: Bool = false
        ) {
            self.statusCode = statusCode
            self.data = data
            self.delay = delay
            self.deliversAfterStop = deliversAfterStop
        }
    }

    private static let lock = NSLock()
    private nonisolated(unsafe) static var responses: [Response] = []
    private nonisolated(unsafe) static var capturedRequests: [URLRequest] = []
    private nonisolated(unsafe) static var stops = 0
    private let stateLock = NSLock()
    private var stopped = false

    static func reset(responses: [Response]) {
        lock.lock()
        self.responses = responses
        capturedRequests = []
        stops = 0
        lock.unlock()
    }

    static func requests() -> [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return capturedRequests
    }

    static func stopLoadingCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return stops
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var captured = request
        if captured.httpBody == nil {
            captured.httpBody = Self.readBodyStream(captured.httpBodyStream)
        }
        Self.lock.lock()
        Self.capturedRequests.append(captured)
        let response = Self.responses.removeFirst()
        Self.lock.unlock()
        let deliver: @Sendable () -> Void = { [weak self] in self?.deliver(response) }
        if response.delay > 0 {
            DispatchQueue.global().asyncAfter(deadline: .now() + response.delay, execute: deliver)
        } else {
            deliver()
        }
    }

    override func stopLoading() {
        stateLock.lock()
        stopped = true
        stateLock.unlock()
        Self.lock.lock()
        Self.stops += 1
        Self.lock.unlock()
    }

    private func deliver(_ response: Response) {
        stateLock.lock()
        let shouldDeliver = !stopped || response.deliversAfterStop
        stateLock.unlock()
        guard shouldDeliver else { return }
        let httpResponse = HTTPURLResponse(
            url: request.url!,
            statusCode: response.statusCode,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: httpResponse, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: response.data)
        client?.urlProtocolDidFinishLoading(self)
    }

    private static func readBodyStream(_ stream: InputStream?) -> Data {
        guard let stream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1_024)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: 1_024)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
