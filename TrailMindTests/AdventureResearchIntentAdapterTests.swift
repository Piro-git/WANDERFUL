import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class AdventureResearchIntentAdapterTests: XCTestCase {
    private let adapter = AdventureResearchIntentAdapterV1()

    func testHikingLoopMapsSuccessfully() throws {
        let payload = try readyPayload(adapter.adapt(makeInput()))

        XCTAssertEqual(payload.intent.activity, .hiking)
        XCTAssertEqual(payload.intent.routeType, .loop)
        XCTAssertTrue(payload.intent.unresolvedClarificationQuestions.isEmpty)
    }

    func testTrailRunningLoopMapsSuccessfully() throws {
        let payload = try readyPayload(
            adapter.adapt(makeInput(activity: .trailRunning))
        )

        XCTAssertEqual(payload.intent.activity, .trailRunning)
        XCTAssertEqual(payload.intent.routeType, .loop)
    }

    func testBikingIsUnsupported() throws {
        let gaps = try unsupportedGaps(
            adapter.adapt(makeInput(activity: .biking))
        )

        XCTAssertEqual(gaps, [.activityNotSupported])
    }

    func testPointToPointIsUnsupportedWithoutLoopConversion() throws {
        let result = adapter.adapt(makeInput(routeType: .pointToPoint))
        let gaps = try unsupportedGaps(result)

        XCTAssertEqual(gaps, [.pointToPointDestinationNotRepresentable])
        XCTAssertNil(result.intent)
    }

    func testMultiDayIsUnsupportedWithoutOvernightConversion() throws {
        let result = adapter.adapt(makeInput(routeType: .multiDay))
        let gaps = try unsupportedGaps(result)

        XCTAssertEqual(gaps, [.multiDayNotSupported])
        XCTAssertNil(result.intent)
    }

    func testUnsupportedCapabilityDominatesMissingAnchorClarification() throws {
        let result = adapter.adapt(
            makeInput(activity: .biking, anchor: .missing)
        )

        XCTAssertEqual(result.state, .unsupported)
        XCTAssertNil(result.intent)
        XCTAssertEqual(try unsupportedGaps(result), [.activityNotSupported])
    }

    func testSettlementAnchorMapsProviderDisplayNameExactly() throws {
        let candidate = makeCandidate(
            semanticKind: .settlement,
            name: "Innsbruck",
            displayName: "Innsbruck, Tirol, Austria"
        )
        let intent = try readyPayload(
            adapter.adapt(makeInput(anchor: .candidate(candidate)))
        ).intent

        guard case let .resolved(name, _, regionEntityID) =
            intent.geographicAnchor
        else {
            return XCTFail("Expected a resolved anchor.")
        }
        XCTAssertEqual(name, candidate.displayName)
        XCTAssertNil(regionEntityID)
    }

    func testTrailheadAnchorMapsSuccessfully() throws {
        try assertUsableCandidateMapsExactly(
            kind: .trailhead,
            name: "Nordkette Trailhead",
            displayName: "Nordkette Trailhead, Innsbruck"
        )
    }

    func testLandmarkAnchorMapsSuccessfully() throws {
        try assertUsableCandidateMapsExactly(
            kind: .landmark,
            name: "Golden Roof",
            displayName: "Golden Roof, Innsbruck"
        )
    }

    func testMissingAnchorRequiresExactLocationClarification() throws {
        let payload = try clarificationPayload(
            adapter.adapt(makeInput(anchor: .missing))
        )
        let expectedQuestion = AdventureResearchClarificationQuestionV1(
            code: .locationRequired,
            field: .geographicAnchor
        )

        XCTAssertEqual(payload.gaps.first, .resolvedAnchorRequired)
        XCTAssertEqual(
            payload.intent.geographicAnchor,
            .unresolved(requirementCode: .locationRequired)
        )
        XCTAssertEqual(
            payload.intent.unresolvedClarificationQuestions,
            [expectedQuestion]
        )
    }

    func testParkRequiresClarificationWithoutUsingCentroid() throws {
        try assertBroadCandidateRequiresClarification(kind: .park)
    }

    func testMountainRangeRequiresClarificationWithoutUsingCentroid() throws {
        try assertBroadCandidateRequiresClarification(kind: .mountainRange)
    }

    func testBroadRegionRequiresClarificationWithoutUsingCentroid() throws {
        try assertBroadCandidateRequiresClarification(kind: .broadRegion)
    }

    func testUnknownSemanticKindRequiresResolvedAnchorClarification() throws {
        let candidate = makeCandidate(semanticKind: .unknown)
        let payload = try clarificationPayload(
            adapter.adapt(makeInput(anchor: .candidate(candidate)))
        )

        XCTAssertEqual(payload.gaps.first, .resolvedAnchorRequired)
        XCTAssertEqual(
            payload.intent.geographicAnchor,
            .unresolved(requirementCode: .locationRequired)
        )
    }

    func testBroadCandidateWithInvalidCoordinatesStillUsesNoCentroid() throws {
        let candidate = makeCandidate(
            semanticKind: .broadRegion,
            latitude: 999,
            longitude: .nan
        )
        let result = adapter.adapt(
            makeInput(anchor: .candidate(candidate))
        )

        XCTAssertEqual(result.state, .clarificationRequired)
        XCTAssertTrue(result.satisfiesStateInvariants)
    }

    func testResolvedCoordinatesArePreservedBitForBit() throws {
        let candidate = makeCandidate(
            latitude: 47.269_212_345_678,
            longitude: 11.404_198_765_432
        )
        let intent = try readyPayload(
            adapter.adapt(makeInput(anchor: .candidate(candidate)))
        ).intent

        guard case let .resolved(_, coordinate, _) =
            intent.geographicAnchor
        else {
            return XCTFail("Expected a resolved anchor.")
        }
        XCTAssertEqual(
            coordinate.latitude.bitPattern,
            candidate.coordinate.latitude.bitPattern
        )
        XCTAssertEqual(
            coordinate.longitude.bitPattern,
            candidate.coordinate.longitude.bitPattern
        )
    }

    func testCandidateIDIsNeverConvertedIntoRegionUUID() throws {
        let candidateID = "33333333-3333-4333-8333-333333333333"
        let candidate = makeCandidate(id: candidateID)
        let intent = try readyPayload(
            adapter.adapt(makeInput(anchor: .candidate(candidate)))
        ).intent
        let object = try encodedJSONObject(intent)
        let anchor = try XCTUnwrap(
            object["geographicAnchor"] as? [String: Any]
        )

        XCTAssertTrue(anchor["regionEntityId"] is NSNull)
        XCTAssertFalse(
            try encodedString(intent).contains(candidateID.lowercased())
        )
    }

    func testInvalidResolvedCoordinatesFailClosed() throws {
        let invalidCandidates = [
            makeCandidate(latitude: .nan),
            makeCandidate(latitude: 91),
            makeCandidate(longitude: -181)
        ]

        for candidate in invalidCandidates {
            let result = adapter.adapt(
                makeInput(anchor: .candidate(candidate))
            )
            XCTAssertEqual(result.state, .unsupported)
            XCTAssertEqual(
                try unsupportedGaps(result),
                [.resolvedAnchorCoordinatesInvalid]
            )
        }
    }

    func testInvalidResolvedNameFailsClosedWithoutSanitizing() throws {
        let invalidNames = [
            "",
            " Innsbruck",
            "Innsbruck ",
            "<Innsbruck>",
            String(repeating: "a", count: 161)
        ]

        for name in invalidNames {
            let result = adapter.adapt(
                makeInput(
                    anchor: .candidate(
                        makeCandidate(displayName: name)
                    )
                )
            )
            XCTAssertEqual(result.state, .unsupported)
            XCTAssertEqual(
                try unsupportedGaps(result),
                [.resolvedAnchorNameInvalid]
            )
        }
    }

    func testExplicitDistanceMapsToExactRange() throws {
        let intent = try readyPayload(
            adapter.adapt(makeInput(distanceKm: 15.25))
        ).intent

        XCTAssertEqual(intent.distanceRangeKm?.min, 15.25)
        XCTAssertEqual(intent.distanceRangeKm?.max, 15.25)
    }

    func testMissingDistanceRemainsNilWithoutLoopDefault() throws {
        let intent = try readyPayload(
            adapter.adapt(
                makeInput(distanceKm: nil, durationMinutes: 120)
            )
        ).intent

        XCTAssertNil(intent.distanceRangeKm)
        XCTAssertEqual(intent.durationRangeMinutes?.min, 120)
    }

    func testDistanceContractBoundsAreAcceptedExactly() throws {
        for value in [0.1, 500.0] {
            let intent = try readyPayload(
                adapter.adapt(makeInput(distanceKm: value))
            ).intent
            XCTAssertEqual(intent.distanceRangeKm?.min, value)
            XCTAssertEqual(intent.distanceRangeKm?.max, value)
        }
    }

    func testInvalidDistanceFailsClosedWithoutClamping() throws {
        for value in [0.05, 500.01, .nan, .infinity] {
            let result = adapter.adapt(makeInput(distanceKm: value))
            XCTAssertEqual(result.state, .unsupported)
            XCTAssertEqual(
                try unsupportedGaps(result),
                [.distanceNotRepresentable]
            )
            XCTAssertNil(result.intent)
        }
    }

    func testExplicitDurationMapsToExactRange() throws {
        let intent = try readyPayload(
            adapter.adapt(makeInput(durationMinutes: 195))
        ).intent

        XCTAssertEqual(intent.durationRangeMinutes?.min, 195)
        XCTAssertEqual(intent.durationRangeMinutes?.max, 195)
    }

    func testMissingDurationRemainsNil() throws {
        let intent = try readyPayload(
            adapter.adapt(makeInput(durationMinutes: nil))
        ).intent

        XCTAssertNil(intent.durationRangeMinutes)
    }

    func testDurationContractBoundsAreAcceptedExactly() throws {
        for value in [15, 10_080] {
            let intent = try readyPayload(
                adapter.adapt(makeInput(durationMinutes: value))
            ).intent
            XCTAssertEqual(intent.durationRangeMinutes?.min, value)
            XCTAssertEqual(intent.durationRangeMinutes?.max, value)
        }
    }

    func testInvalidDurationFailsClosed() throws {
        for value in [-1, 14, 10_081] {
            let result = adapter.adapt(
                makeInput(durationMinutes: value)
            )
            XCTAssertEqual(result.state, .unsupported)
            XCTAssertEqual(
                try unsupportedGaps(result),
                [.durationNotRepresentable]
            )
            XCTAssertNil(result.intent)
        }
    }

    func testEasyDifficultyUsesConservativeHikingMaximum() throws {
        let payload = try readyPayload(
            adapter.adapt(makeInput(difficulty: .easy))
        )

        XCTAssertEqual(
            payload.intent.maximumTechnicalDifficulty,
            .hiking
        )
        XCTAssertFalse(
            payload.gaps.contains(.technicalDifficultyNotEquivalent)
        )
    }

    func testModerateDoesNotBecomeTechnicalMountainHikingGrade() throws {
        let payload = try readyPayload(
            adapter.adapt(makeInput(difficulty: .moderate))
        )

        XCTAssertNil(payload.intent.maximumTechnicalDifficulty)
        XCTAssertTrue(
            payload.gaps.contains(.technicalDifficultyNotEquivalent)
        )
    }

    func testChallengingDoesNotBecomeAlpineGrade() throws {
        let payload = try readyPayload(
            adapter.adapt(makeInput(difficulty: .challenging))
        )

        XCTAssertNil(payload.intent.maximumTechnicalDifficulty)
        XCTAssertTrue(
            payload.gaps.contains(.technicalDifficultyNotEquivalent)
        )
    }

    func testEquivalentPreferencesMapInStableFirstOccurrenceOrder() throws {
        let payload = try readyPayload(
            adapter.adapt(
                makeInput(
                    desiredFeatures: [
                        .quiet,
                        .viewpoint,
                        .quiet,
                        .forest,
                        .viewpoint
                    ]
                )
            )
        )

        XCTAssertEqual(
            payload.intent.preferredExperiences,
            [.quietTrails, .viewpoint, .forest]
        )
    }

    func testWaterRemainsAmbiguousAndNeverBecomesFacilityOrExperience()
        throws
    {
        let payload = try readyPayload(
            adapter.adapt(
                makeInput(desiredFeatures: [.water, .water])
            )
        )

        XCTAssertEqual(payload.intent.preferredExperiences, [])
        XCTAssertEqual(payload.intent.requiredFacilities, [])
        XCTAssertEqual(
            payload.gaps.filter { $0 == .waterPreferenceAmbiguous },
            [.waterPreferenceAmbiguous]
        )
    }

    func testSunsetRemainsExplicitUnmodeledPreferenceGap() throws {
        let payload = try readyPayload(
            adapter.adapt(
                makeInput(desiredFeatures: [.sunset, .sunset])
            )
        )

        XCTAssertEqual(payload.intent.preferredExperiences, [])
        XCTAssertEqual(
            payload.gaps.filter { $0 == .sunsetNotModeled },
            [.sunsetNotModeled]
        )
    }

    func testAvoidFeaturesMapExactlyWithStableDeduplication() throws {
        let payload = try readyPayload(
            adapter.adapt(
                makeInput(
                    avoidFeatures: [
                        .repeatedPath,
                        .majorRoads,
                        .repeatedPath,
                        .steepClimbs,
                        .majorRoads
                    ]
                )
            )
        )

        XCTAssertEqual(
            payload.intent.avoidedExperiences,
            [.repeatedPath, .majorRoads, .steepClimbs]
        )
    }

    func testNoMustHaveCountOrRequiredFacilityIsInvented() throws {
        let intent = try readyPayload(
            adapter.adapt(
                makeInput(
                    desiredFeatures: [
                        .viewpoint,
                        .forest,
                        .water
                    ]
                )
            )
        ).intent

        XCTAssertTrue(intent.mustHaveExperiences.isEmpty)
        XCTAssertTrue(intent.requiredFacilities.isEmpty)
    }

    func testMaximumElevationGainRemainsNil() throws {
        let intent = try readyPayload(adapter.adapt(makeInput())).intent

        XCTAssertNil(intent.maximumElevationGainMeters)
    }

    func testNeutralGroupContextAlwaysCarriesExplicitGap() throws {
        let payload = try readyPayload(adapter.adapt(makeInput()))
        let context = payload.intent.groupContext

        XCTAssertEqual(context.partySize, 1)
        XCTAssertFalse(context.includesChildren)
        XCTAssertNil(context.youngestAge)
        XCTAssertEqual(context.mobility, .unknown)
        XCTAssertEqual(context.experienceLevel, .unknown)
        XCTAssertTrue(payload.gaps.contains(.groupContextUnavailable))
    }

    func testDateAndSeasonRemainNil() throws {
        let intent = try readyPayload(adapter.adapt(makeInput())).intent

        XCTAssertNil(intent.dateOrSeason)
    }

    func testNoOvernightRequirementIsInvented() throws {
        let requirements = try readyPayload(
            adapter.adapt(makeInput())
        ).intent.overnightRequirements

        XCTAssertFalse(requirements.required)
        XCTAssertEqual(requirements.nights, 0)
        XCTAssertTrue(requirements.allowedAccommodationTypes.isEmpty)
    }

    func testArrivalContextRemainsUnknownAndExplicitlyGapped() throws {
        let payload = try readyPayload(adapter.adapt(makeInput()))
        let requirements = payload.intent.transportRequirements

        XCTAssertEqual(requirements.arrivalMode, .unknown)
        XCTAssertTrue(requirements.returnToStart)
        XCTAssertFalse(requirements.publicTransportRequired)
        XCTAssertTrue(payload.gaps.contains(.arrivalContextUnavailable))
    }

    func testClarificationIntentAlsoCarriesNeutralContextAndExplicitGaps()
        throws
    {
        let payload = try clarificationPayload(
            adapter.adapt(makeInput(anchor: .missing))
        )
        let context = payload.intent.groupContext
        let transport = payload.intent.transportRequirements

        XCTAssertEqual(context.partySize, 1)
        XCTAssertFalse(context.includesChildren)
        XCTAssertNil(context.youngestAge)
        XCTAssertEqual(context.mobility, .unknown)
        XCTAssertEqual(context.experienceLevel, .unknown)
        XCTAssertEqual(transport.arrivalMode, .unknown)
        XCTAssertTrue(transport.returnToStart)
        XCTAssertFalse(transport.publicTransportRequired)
        XCTAssertTrue(payload.gaps.contains(.groupContextUnavailable))
        XCTAssertTrue(payload.gaps.contains(.arrivalContextUnavailable))
    }

    func testRawPromptParserAndProviderMetadataNeverAppearInEncodedOutput()
        throws
    {
        let rawPrompt = "RAW_PROMPT_SENTINEL_DO_NOT_CROSS"
        let locationID = "LOCATION_ID_SENTINEL_DO_NOT_CROSS"
        let startQuery = "START_QUERY_SENTINEL_DO_NOT_CROSS"
        let destinationQuery =
            "DESTINATION_QUERY_SENTINEL_DO_NOT_CROSS"
        let regionQuery = "REGION_QUERY_SENTINEL_DO_NOT_CROSS"
        let candidateName = "CANDIDATE_NAME_SENTINEL_DO_NOT_CROSS"
        let locality = "LOCALITY_SENTINEL_DO_NOT_CROSS"
        let administrativeRegion =
            "ADMIN_REGION_SENTINEL_DO_NOT_CROSS"
        let country = "COUNTRY_SENTINEL_DO_NOT_CROSS"
        let input = makeInput(
            anchor: .candidate(
                makeCandidate(
                    id: locationID,
                    name: candidateName,
                    provider: .legacyCoordinateAdapter,
                    locality: locality,
                    administrativeRegion: administrativeRegion,
                    country: country,
                    countryCode: "ZZ",
                    providerRank: 73
                )
            ),
            rawPrompt: rawPrompt,
            parserSource: .remoteAI,
            confidence: 0.123_456_789,
            startLocationQuery: startQuery,
            endLocationQuery: destinationQuery,
            regionQuery: regionQuery
        )
        let intent = try readyPayload(adapter.adapt(input)).intent
        let encoded = try encodedString(intent)
        let object = try encodedJSONObject(intent)
        let expectedKeys: Set<String> = [
            "schemaVersion",
            "activity",
            "geographicAnchor",
            "routeType",
            "distanceRangeKm",
            "durationRangeMinutes",
            "maximumElevationGainMeters",
            "maximumTechnicalDifficulty",
            "mustHaveExperiences",
            "preferredExperiences",
            "avoidedExperiences",
            "requiredFacilities",
            "groupContext",
            "dateOrSeason",
            "overnightRequirements",
            "transportRequirements",
            "unresolvedClarificationQuestions"
        ]

        XCTAssertEqual(Set(object.keys), expectedKeys)
        for forbidden in [
            rawPrompt,
            locationID,
            startQuery,
            destinationQuery,
            regionQuery,
            candidateName,
            locality,
            administrativeRegion,
            country,
            "remoteAI",
            "legacyCoordinateAdapter",
            "providerRank",
            "backendURL",
            "authorization",
            "apiKey",
            "routeGeometry",
            "elevationMeters"
        ] {
            XCTAssertFalse(
                encoded.contains(forbidden),
                "Encoded output leaked \(forbidden)."
            )
        }
        let allKeys = allJSONKeys(object)
        for forbiddenKey in [
            "rawPrompt",
            "parserSource",
            "confidence",
            "startLocationQuery",
            "endLocationQuery",
            "regionQuery",
            "candidateId",
            "provider",
            "providerRank",
            "locality",
            "administrativeRegion",
            "country",
            "countryCode",
            "routeGeometry"
        ] {
            XCTAssertFalse(
                allKeys.contains(forbiddenKey),
                "Encoded output leaked key \(forbiddenKey)."
            )
        }
    }

    func testMappingIsDeterministicAcrossRepeatedCalls() throws {
        let input = makeInput(
            difficulty: .moderate,
            desiredFeatures: [
                .quiet,
                .water,
                .viewpoint,
                .sunset,
                .quiet
            ],
            avoidFeatures: [
                .repeatedPath,
                .majorRoads,
                .repeatedPath
            ]
        )

        let first = adapter.adapt(input)
        let second = adapter.adapt(input)

        XCTAssertEqual(first, second)
        XCTAssertEqual(
            try first.intent.map(encodedString),
            try second.intent.map(encodedString)
        )
    }

    func testInputCollectionsAndGapsAreDeduplicatedDeterministically()
        throws
    {
        let payload = try readyPayload(
            adapter.adapt(
                makeInput(
                    difficulty: .moderate,
                    desiredFeatures: [
                        .water,
                        .sunset,
                        .water,
                        .sunset
                    ],
                    avoidFeatures: [
                        .majorRoads,
                        .majorRoads
                    ]
                )
            )
        )

        XCTAssertEqual(payload.intent.avoidedExperiences, [.majorRoads])
        XCTAssertEqual(
            payload.gaps,
            [
                .technicalDifficultyNotEquivalent,
                .waterPreferenceAmbiguous,
                .sunsetNotModeled,
                .groupContextUnavailable,
                .arrivalContextUnavailable
            ]
        )
        XCTAssertEqual(Set(payload.gaps).count, payload.gaps.count)
    }

    func testAllProducedResultStatesSatisfyInvariants() {
        let results = [
            adapter.adapt(makeInput()),
            adapter.adapt(makeInput(anchor: .missing)),
            adapter.adapt(makeInput(activity: .biking))
        ]

        XCTAssertEqual(results.map(\.state), [
            .ready,
            .clarificationRequired,
            .unsupported
        ])
        XCTAssertTrue(results.allSatisfy(\.satisfiesStateInvariants))
        XCTAssertNotNil(results[0].intent)
        XCTAssertNotNil(results[1].intent)
        XCTAssertNil(results[2].intent)
    }

    func testManuallyConstructedInvalidResultShapesFailInvariantCheck()
        throws
    {
        let ready = try readyPayload(adapter.adapt(makeInput())).intent
        let clarification = try clarificationPayload(
            adapter.adapt(makeInput(anchor: .missing))
        ).intent
        let invalidResults: [AdventureResearchIntentAdapterResultV1] = [
            .ready(intent: ready, gaps: []),
            .ready(
                intent: ready,
                gaps: [.activityNotSupported]
            ),
            .clarificationRequired(
                intent: clarification,
                gaps: [
                    .groupContextUnavailable,
                    .arrivalContextUnavailable
                ]
            ),
            .unsupported(gaps: [.groupContextUnavailable])
        ]

        XCTAssertTrue(
            invalidResults.allSatisfy {
                !$0.satisfiesStateInvariants
            }
        )
    }

    func testSourceHasNoNetworkAuthorizationResearchOrRoutingWork()
        throws
    {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sourceURL = repositoryRoot
            .appendingPathComponent("TrailMind")
            .appendingPathComponent("Services")
            .appendingPathComponent(
                "AdventureResearchIntentAdapter.swift"
            )
        let source = try String(contentsOf: sourceURL, encoding: .utf8)

        for forbidden in [
            "URLSession",
            "LocationResolutionService",
            "OutdoorAdventurePlanningCoordinator",
            "GraphHopper",
            "RouteSessionAuthorizing",
            "RoutePlanningRequest",
            "rawPrompt",
            "parserSource",
            "confidence",
            "startLocationQuery",
            "endLocationQuery",
            "regionQuery",
            "resolvedStart.id",
            "resolvedStart.name",
            "resolvedStart.locality",
            "resolvedStart.administrativeRegion",
            "resolvedStart.country",
            "resolvedStart.countryCode",
            "providerRank",
            ".provider",
            "async"
        ] {
            XCTAssertFalse(
                source.contains(forbidden),
                "Adapter source crossed the pure boundary with \(forbidden)."
            )
        }
    }

    private func assertBroadCandidateRequiresClarification(
        kind: LocationSemanticKind
    ) throws {
        let candidate = makeCandidate(semanticKind: kind)
        let payload = try clarificationPayload(
            adapter.adapt(makeInput(anchor: .candidate(candidate)))
        )

        XCTAssertEqual(
            payload.gaps.first,
            .broadRegionRequiresClarification
        )
        XCTAssertEqual(
            payload.intent.geographicAnchor,
            .unresolved(requirementCode: .locationRequired)
        )
        XCTAssertTrue(payload.intent.requiredFacilities.isEmpty)
    }

    private func assertUsableCandidateMapsExactly(
        kind: LocationSemanticKind,
        name: String,
        displayName: String
    ) throws {
        let candidate = makeCandidate(
            semanticKind: kind,
            latitude: 47.123_456_789,
            longitude: 11.987_654_321,
            name: name,
            displayName: displayName
        )
        let payload = try readyPayload(
            adapter.adapt(makeInput(anchor: .candidate(candidate)))
        )

        guard case let .resolved(
            mappedName,
            mappedCoordinate,
            regionEntityID
        ) = payload.intent.geographicAnchor else {
            return XCTFail("Expected a resolved anchor.")
        }
        XCTAssertEqual(mappedName, displayName)
        XCTAssertEqual(
            mappedCoordinate.latitude.bitPattern,
            candidate.coordinate.latitude.bitPattern
        )
        XCTAssertEqual(
            mappedCoordinate.longitude.bitPattern,
            candidate.coordinate.longitude.bitPattern
        )
        XCTAssertNil(regionEntityID)
        XCTAssertTrue(payload.intent.unresolvedClarificationQuestions.isEmpty)
        XCTAssertTrue(
            AdventureResearchIntentAdapterResultV1.ready(
                intent: payload.intent,
                gaps: payload.gaps
            ).satisfiesStateInvariants
        )
    }

    private func readyPayload(
        _ result: AdventureResearchIntentAdapterResultV1
    ) throws -> (
        intent: AdventureResearchIntentV1,
        gaps: [AdventureResearchIntentAdapterGapV1]
    ) {
        guard case let .ready(intent, gaps) = result else {
            XCTFail("Expected ready, received \(result.state.rawValue).")
            throw FixtureFailure.unexpectedResult
        }
        return (intent, gaps)
    }

    private func clarificationPayload(
        _ result: AdventureResearchIntentAdapterResultV1
    ) throws -> (
        intent: AdventureResearchIntentV1,
        gaps: [AdventureResearchIntentAdapterGapV1]
    ) {
        guard case let .clarificationRequired(intent, gaps) = result else {
            XCTFail(
                "Expected clarification, received \(result.state.rawValue)."
            )
            throw FixtureFailure.unexpectedResult
        }
        return (intent, gaps)
    }

    private func unsupportedGaps(
        _ result: AdventureResearchIntentAdapterResultV1
    ) throws -> [AdventureResearchIntentAdapterGapV1] {
        guard case let .unsupported(gaps) = result else {
            XCTFail(
                "Expected unsupported, received \(result.state.rawValue)."
            )
            throw FixtureFailure.unexpectedResult
        }
        return gaps
    }

    private func makeInput(
        activity: ActivityType = .hiking,
        routeType: TrailRouteType = .loop,
        anchor: AnchorFixture = .standard,
        distanceKm: Double? = 12,
        durationMinutes: Int? = 180,
        difficulty: RouteDifficulty? = nil,
        desiredFeatures: [DesiredFeature] = [],
        avoidFeatures: [AvoidFeature] = [],
        rawPrompt: String = "RAW_PROMPT_DEFAULT_SENTINEL",
        parserSource: IntentParserSource = .localRuleBased,
        confidence: Double? = 0.75,
        startLocationQuery: String? = "PRIVATE_START_QUERY",
        endLocationQuery: String? = nil,
        regionQuery: String? = nil
    ) -> AdventureResearchIntentAdapterInputV1 {
        let resolvedStart: LocationCandidate?
        switch anchor {
        case .standard:
            resolvedStart = makeCandidate()
        case .missing:
            resolvedStart = nil
        case let .candidate(candidate):
            resolvedStart = candidate
        }
        let resolvedEndLocationQuery: String?
        if let endLocationQuery {
            resolvedEndLocationQuery = endLocationQuery
        } else if routeType == .loop {
            resolvedEndLocationQuery = nil
        } else {
            resolvedEndLocationQuery = "PRIVATE_DESTINATION_QUERY"
        }
        let intent = AdventureIntent(
            rawPrompt: rawPrompt,
            parserSource: parserSource,
            confidence: confidence,
            activityType: activity,
            routeType: routeType,
            startLocationQuery: startLocationQuery,
            endLocationQuery: resolvedEndLocationQuery,
            regionQuery: regionQuery,
            targetDistanceKm: distanceKm,
            targetDurationMinutes: durationMinutes,
            difficulty: difficulty,
            desiredFeatures: desiredFeatures,
            avoidFeatures: avoidFeatures
        )
        return AdventureResearchIntentAdapterInputV1(
            validatedIntent: ValidatedAdventureIntent(intent: intent),
            resolvedStart: resolvedStart
        )
    }

    private func makeCandidate(
        id: String = "candidate-private-id",
        semanticKind: LocationSemanticKind = .settlement,
        latitude: Double = 47.2692,
        longitude: Double = 11.4041,
        name: String = "Innsbruck",
        displayName: String = "Innsbruck, Austria",
        provider: LocationProviderSource = .appleGeocoder,
        locality: String? = "Innsbruck",
        administrativeRegion: String? = "Tirol",
        country: String? = "Austria",
        countryCode: String? = "AT",
        providerRank: Int = 4
    ) -> LocationCandidate {
        LocationCandidate(
            id: id,
            name: name,
            displayName: displayName,
            coordinate: Coordinate(
                latitude: latitude,
                longitude: longitude,
                elevationMeters: 574
            ),
            semanticKind: semanticKind,
            locality: locality,
            administrativeRegion: administrativeRegion,
            country: country,
            countryCode: countryCode,
            provider: provider,
            providerRank: providerRank
        )
    }

    private func encodedString(
        _ intent: AdventureResearchIntentV1
    ) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(intent)
        return try XCTUnwrap(String(data: data, encoding: .utf8))
    }

    private func encodedJSONObject(
        _ intent: AdventureResearchIntentV1
    ) throws -> [String: Any] {
        let data = try JSONEncoder().encode(intent)
        return try XCTUnwrap(
            JSONSerialization.jsonObject(with: data)
                as? [String: Any]
        )
    }

    private func allJSONKeys(_ value: Any) -> Set<String> {
        if let object = value as? [String: Any] {
            return object.reduce(into: Set(object.keys)) { result, element in
                result.formUnion(allJSONKeys(element.value))
            }
        }
        if let array = value as? [Any] {
            return array.reduce(into: Set<String>()) { result, element in
                result.formUnion(allJSONKeys(element))
            }
        }
        return []
    }
}

private enum AnchorFixture {
    case standard
    case missing
    case candidate(LocationCandidate)
}

private enum FixtureFailure: Error {
    case unexpectedResult
}
