import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class HikingRouteQualityEngineTests: XCTestCase {
    private let engine = HikingRouteQualityEngine(policy: .v1)

    func testOfflineFixtureCorpusIsVersionedSeparateAndCoversRequiredFamilies() throws {
        let suite = try HikingQualityFixtureSuite.load()

        XCTAssertEqual(suite.schemaVersion, 1)
        XCTAssertEqual(suite.benchmarkKind, "deterministic_engine_contract")
        XCTAssertEqual(suite.policyVersion, HikingRouteQualityPolicyVersion.v1.rawValue)
        XCTAssertGreaterThanOrEqual(suite.cases.count, 40)
        XCTAssertEqual(Set(suite.cases.map(\.id)).count, suite.cases.count)

        let allTags = Set(suite.cases.flatMap(\.tags))
        let requiredTags: Set<String> = [
            "loop", "pointToPoint", "distanceTarget", "durationTarget",
            "easy", "moderate", "challenging", "avoidMajorRoads",
            "avoidSteepClimbs", "avoidRepeatedPath", "missingEvidence",
            "partialEvidence", "malformedEvidence", "technicalSections",
            "surfaceEvidence", "roadEvidence", "pathEvidence", "dominance",
            "nonDominance", "nearDuplicate", "directionReversal", "inputOrder",
            "familyCasual"
        ]
        XCTAssertTrue(
            requiredTags.isSubset(of: allTags),
            "Missing fixture families: \(requiredTags.subtracting(allTags).sorted())"
        )

        for fixture in suite.cases {
            XCTAssertFalse(fixture.candidates.isEmpty, fixture.id)
            XCTAssertEqual(
                Set(fixture.candidates.map(\.id)).count,
                fixture.candidates.count,
                "Duplicate candidate IDs in \(fixture.id)"
            )
            let candidateIDs = Set(fixture.candidates.map(\.id))
            XCTAssertTrue(
                Set(fixture.expectedSelected).isSubset(of: candidateIDs),
                "Unknown selected candidate in \(fixture.id)"
            )
            XCTAssertTrue(
                Set(fixture.expectedRejections.keys).isSubset(of: candidateIDs),
                "Unknown rejected candidate in \(fixture.id)"
            )
            XCTAssertTrue(
                Set(fixture.expectedSelected).isDisjoint(with: fixture.expectedRejections.keys),
                "A rejected candidate is selected in \(fixture.id)"
            )
            XCTAssertLessThanOrEqual(fixture.expectedSelected.count, 3, fixture.id)
            for candidate in fixture.candidates {
                XCTAssertEqual(
                    candidate.difficulty,
                    RouteDifficulty.estimated(
                        distanceKilometers: candidate.distanceKm,
                        elevationGainMeters: candidate.elevationGainMeters
                    ).rawValue,
                    "Fixture difficulty must satisfy production provenance in \(fixture.id)/\(candidate.id)"
                )
            }
        }
    }

    func testGoldenV1SelectionsRejectionsAndExplanations() throws {
        let suite = try HikingQualityFixtureSuite.load()

        for fixture in suite.cases {
            let built = try FixtureFactory.build(fixture)
            let selection = engine.select(
                built.suggestions,
                request: built.request,
                maximumSuggestions: 3
            )
            let selectedIDs = built.candidateIDs(for: selection.selected.map(\.route))
            XCTAssertEqual(selectedIDs, fixture.expectedSelected, fixture.id)
            XCTAssertEqual(selection.policyVersion, .v1, fixture.id)

            let actualRejections = Dictionary(uniqueKeysWithValues: selection.assessments.compactMap { assessment in
                assessment.eligibility.rejection.map {
                    (built.candidateID(for: assessment.route), $0.rawValue)
                }
            })
            XCTAssertEqual(actualRejections, fixture.expectedRejections, fixture.id)

            if let first = selection.selected.first {
                let expectedExplanationCodes = Set(fixture.expectedFirstExplanationCodes)
                var contractItems = [first.explanations.primaryFit].compactMap { $0 }
                    + first.explanations.verifiedCharacteristics
                if expectedExplanationCodes.contains(
                    RouteQualityExplanationCode.physicalEffortEstimate.rawValue
                ) {
                    contractItems.append(contentsOf: first.explanations.estimates)
                }
                XCTAssertEqual(
                    Set(contractItems.map(\.code.rawValue)),
                    expectedExplanationCodes,
                    "Unexpected or missing factual explanation in \(fixture.id)"
                )
                let limitationCodes = Set(first.explanations.limitations.map(\.code.rawValue))
                XCTAssertEqual(
                    limitationCodes,
                    Set(fixture.expectedFirstLimitationCodes),
                    "Unexpected or missing limitation in \(fixture.id)"
                )
            }

            for assessment in selection.assessments {
                for objective in assessment.objectives {
                    if let loss = objective.normalizedLoss {
                        XCTAssertTrue(loss.isFinite, "Non-finite \(objective.kind) in \(fixture.id)")
                        XCTAssertTrue((0...1).contains(loss), "Out-of-range \(objective.kind) in \(fixture.id)")
                    }
                }
            }
        }
    }

    func testFrozenBaselineVersusV1Comparison() throws {
        let fixtures = try HikingQualityFixtureSuite.load().cases.filter {
            $0.expectedBaselineSelected != nil
        }
        var firstChoiceChanges = 0
        var selectionChanges = 0
        var hardEligibilityChanges = 0
        var evidenceConfidenceChanges = 0
        var reviewedRegressions = 0

        XCTAssertGreaterThanOrEqual(fixtures.count, 12)
        for fixture in fixtures {
            let built = try FixtureFactory.build(fixture)
            let baseline = RouteAlternativeQuality.selectBaseline(
                built.suggestions,
                request: built.request,
                maximumSuggestions: 3
            )
            let baselineIDs = built.candidateIDs(
                for: baseline.selected.map(\.suggestion.route)
            )
            let expectedBaseline = try XCTUnwrap(fixture.expectedBaselineSelected, fixture.id)
            XCTAssertEqual(baselineIDs, expectedBaseline, "Frozen baseline drift in \(fixture.id)")

            let v1 = engine.select(built.suggestions, request: built.request, maximumSuggestions: 3)
            let v1IDs = built.candidateIDs(for: v1.selected.map(\.route))
            let changed = baselineIDs != v1IDs
            XCTAssertEqual(changed, fixture.expectedComparison == "changed", fixture.id)
            if baselineIDs.first != v1IDs.first { firstChoiceChanges += 1 }
            if changed { selectionChanges += 1 }
            if fixture.tags.contains("hardEligibilityChange") { hardEligibilityChanges += 1 }
            if fixture.tags.contains("evidenceConfidenceChange") { evidenceConfidenceChanges += 1 }
            if fixture.expectedComparison == "regression" { reviewedRegressions += 1 }
        }

        XCTAssertGreaterThan(firstChoiceChanges, 0)
        XCTAssertGreaterThan(selectionChanges, 0)
        XCTAssertGreaterThan(hardEligibilityChanges, 0)
        XCTAssertGreaterThan(evidenceConfidenceChanges, 0)
        XCTAssertEqual(reviewedRegressions, 0)
        print(
            "Offline hiking quality comparison: cases=\(fixtures.count) " +
                "first_choice_changes=\(firstChoiceChanges) " +
                "selection_changes=\(selectionChanges) " +
                "hard_eligibility_changes=\(hardEligibilityChanges) " +
                "evidence_confidence_changes=\(evidenceConfidenceChanges) " +
                "reviewed_regressions=\(reviewedRegressions) provider_proof=false"
        )
    }

    func testInputPermutationDoesNotChangeV1Selection() throws {
        let fixture = try fixture(tagged: "inputOrder")
        let built = try FixtureFactory.build(fixture)
        let expected = built.candidateIDs(
            for: engine.select(built.suggestions, request: built.request).selected.map(\.route)
        )

        for ordering in Self.permutations(of: built.suggestions) {
            let actual = built.candidateIDs(
                for: engine.select(ordering, request: built.request).selected.map(\.route)
            )
            XCTAssertEqual(actual, expected, fixture.id)
        }
    }

    func testReversingEveryGeometryDoesNotChangeV1Selection() throws {
        let fixture = try fixture(tagged: "directionReversal")
        let built = try FixtureFactory.build(fixture)
        let original = built.candidateIDs(
            for: engine.select(built.suggestions, request: built.request).selected.map(\.route)
        )
        let reversed = built.suggestions.map { suggestion in
            RouteSuggestion(
                id: suggestion.id,
                route: FixtureFactory.copy(
                    suggestion.route,
                    path: Array(suggestion.route.path.reversed())
                ),
                explanation: suggestion.explanation,
                debugMetadata: suggestion.debugMetadata
            )
        }
        let reversedSelection = built.candidateIDs(
            for: engine.select(reversed, request: built.request).selected.map(\.route)
        )

        XCTAssertEqual(reversedSelection, original)
    }

    func testMissingEvidenceIsNotEquivalentToStrongGoodEvidence() throws {
        let fixture = try fixture(withID: "missing-vs-strong-evidence")
        let built = try FixtureFactory.build(fixture)
        let selection = engine.select(built.suggestions, request: built.request)
        let missing = try assessment(candidateID: "missing", in: selection, built: built)
        let strong = try assessment(candidateID: "strong", in: selection, built: built)
        let comparison = engine.comparison(strong, missing)

        XCTAssertEqual(comparison.dominance, .leftDominates)
        XCTAssertLessThan(
            try XCTUnwrap(strong.objective(.evidenceConfidence)?.normalizedLoss),
            try XCTUnwrap(missing.objective(.evidenceConfidence)?.normalizedLoss)
        )
        XCTAssertFalse(
            missing.explanations.verifiedCharacteristics.contains {
                $0.code == .pathsAndTracks || $0.code == .majorRoadExposure
            }
        )
    }

    func testStaleEvidenceIsUnknownAndCannotBecomeRankingPositive() {
        let metric = RouteEvidenceMetric<Double>.stale(
            source: .futureOutdoorEvidenceProvider
        )

        XCTAssertEqual(metric.status, .stale)
        XCTAssertEqual(metric.freshness, .stale)
        XCTAssertNil(metric.value)
        XCTAssertFalse(metric.isKnown)
        XCTAssertFalse(metric.hasStrongCoverage(using: .v1))
    }

    func testIncreasingTargetDistanceDeviationCannotImproveDistanceObjective() throws {
        let fixture = try fixture(withID: "easy-loop-distance-fit")
        let built = try FixtureFactory.build(fixture)
        let selection = engine.select(built.suggestions, request: built.request)
        let exact = try assessment(candidateID: "exact", in: selection, built: built)
        let farther = try assessment(candidateID: "farther", in: selection, built: built)

        XCTAssertLessThanOrEqual(
            try XCTUnwrap(exact.objective(.distanceDeviation)?.normalizedLoss),
            try XCTUnwrap(farther.objective(.distanceDeviation)?.normalizedLoss)
        )
    }

    func testLongerRouteWithSameAscentCannotGainPhysicalEffortAdvantage() throws {
        let fixture = try fixture(withID: "easy-loop-distance-fit")
        let built = try FixtureFactory.build(fixture)
        let selection = engine.select(built.suggestions, request: built.request)
        let exact = try assessment(candidateID: "exact", in: selection, built: built)
        let farther = try assessment(candidateID: "farther", in: selection, built: built)

        XCTAssertEqual(
            try XCTUnwrap(exact.objective(.physicalEffortFit)?.normalizedLoss),
            try XCTUnwrap(farther.objective(.physicalEffortFit)?.normalizedLoss),
            accuracy: 0.000_001
        )
        XCTAssertEqual(engine.comparison(exact, farther).dominance, .leftDominates)
    }

    func testIncreasingKnownMajorRoadExposureCannotImproveAvoidanceObjective() throws {
        let fixture = try fixture(withID: "explicit-major-road-hard-rejection")
        let built = try FixtureFactory.build(fixture)
        let selection = engine.select(built.suggestions, request: built.request)
        let lowExposure = try assessment(candidateID: "road-light", in: selection, built: built)
        let highExposure = try assessment(candidateID: "road-heavy", in: selection, built: built)

        XCTAssertLessThanOrEqual(
            try XCTUnwrap(lowExposure.objective(.majorRoadExposure)?.normalizedLoss),
            try XCTUnwrap(highExposure.objective(.majorRoadExposure)?.normalizedLoss)
        )
        XCTAssertEqual(highExposure.eligibility.rejection, .excessiveKnownMajorRoadExposure)
    }

    func testIncreasingEligibleOverlapCannotImproveObjectiveOrOrder() throws {
        let fixture = try fixture(withID: "clean-loop-repetition-fact")
        let built = try FixtureFactory.build(fixture)
        let selection = engine.select(built.suggestions, request: built.request)
        let clean = try assessment(candidateID: "clean", in: selection, built: built)
        let overlapping = try assessment(candidateID: "minor-overlap", in: selection, built: built)

        XCTAssertTrue(clean.eligibility.isEligible)
        XCTAssertTrue(overlapping.eligibility.isEligible)
        XCTAssertLessThanOrEqual(
            try XCTUnwrap(clean.objective(.selfOverlap)?.normalizedLoss),
            try XCTUnwrap(overlapping.objective(.selfOverlap)?.normalizedLoss)
        )
        XCTAssertEqual(
            built.candidateID(for: try XCTUnwrap(selection.selected.first).route),
            "clean"
        )
    }

    func testIncreasingKnownTechnicalClassificationCannotImproveEasyFit() throws {
        let fixture = try fixture(withID: "easy-known-technical-hard-rejection")
        let built = try FixtureFactory.build(fixture)
        let selection = engine.select(built.suggestions, request: built.request)
        let basic = try assessment(candidateID: "basic", in: selection, built: built)
        let technical = try assessment(candidateID: "technical", in: selection, built: built)

        XCTAssertLessThanOrEqual(
            try XCTUnwrap(basic.objective(.technicalDifficulty)?.normalizedLoss),
            try XCTUnwrap(technical.objective(.technicalDifficulty)?.normalizedLoss)
        )
        XCTAssertEqual(
            technical.eligibility.rejection,
            .knownTechnicalDifficultyAboveEasyRequest
        )
    }

    func testHardEligibilityRunsBeforeRankingAndDiversity() throws {
        let fixture = try fixture(withID: "easy-known-technical-hard-rejection")
        let built = try FixtureFactory.build(fixture)
        let selection = engine.select(built.suggestions, request: built.request)

        XCTAssertEqual(
            built.candidateIDs(for: selection.selected.map(\.route)),
            ["basic"]
        )
        let rejected = try assessment(candidateID: "technical", in: selection, built: built)
        XCTAssertEqual(
            rejected.eligibility.rejection,
            .knownTechnicalDifficultyAboveEasyRequest
        )
        XCTAssertFalse(selection.selected.contains { $0.route.id == rejected.route.id })
    }

    func testDominatedCandidateCannotOutrankDominator() throws {
        let fixture = try fixture(withID: "strict-dominance-contract")
        let built = try FixtureFactory.build(fixture)
        let selection = engine.select(built.suggestions, request: built.request)
        let dominator = try assessment(candidateID: "dominator", in: selection, built: built)
        let dominated = try assessment(candidateID: "dominated", in: selection, built: built)

        XCTAssertEqual(engine.comparison(dominator, dominated).dominance, .leftDominates)
        XCTAssertEqual(built.candidateID(for: try XCTUnwrap(selection.selected.first).route), "dominator")
        XCTAssertLessThan(dominator.paretoRank, dominated.paretoRank)
    }

    func testSelectionIsDeterministicallyRepeatable() throws {
        let fixture = try fixture(withID: "deterministic-stable-tie")
        let built = try FixtureFactory.build(fixture)
        let reference = engine.select(built.suggestions, request: built.request)
        let expectedIDs = built.candidateIDs(for: reference.selected.map(\.route))
        let expectedRejections = reference.rejectionCounts

        for _ in 0..<20 {
            let selection = engine.select(built.suggestions, request: built.request)
            XCTAssertEqual(built.candidateIDs(for: selection.selected.map(\.route)), expectedIDs)
            XCTAssertEqual(selection.rejectionCounts, expectedRejections)
            XCTAssertEqual(selection.policyVersion, .v1)
        }
    }

    func testHighQualityEarlyStopRequiresStrongTechnicalEvidenceForEasyHiking() throws {
        let strongFixture = try fixture(withID: "easy-loop-duration-fit")
        let strong = try FixtureFactory.build(strongFixture)
        let unknownFixture = try fixture(
            withID: "missing-evidence-and-requested-preference-limitations"
        )
        let unknown = try FixtureFactory.build(unknownFixture)

        XCTAssertTrue(
            engine.hasSufficientHighQualityDistinctCandidates(
                [try XCTUnwrap(strong.suggestions.first)],
                request: strong.request,
                minimumCandidateCount: 1
            )
        )
        XCTAssertFalse(
            engine.hasSufficientHighQualityDistinctCandidates(
                unknown.suggestions,
                request: unknown.request,
                minimumCandidateCount: 1
            )
        )
    }

    func testHighQualityEarlyStopRequiresStrongRoadEvidenceForExplicitAvoidance() throws {
        let strongFixture = try fixture(withID: "explicit-major-road-hard-rejection")
        let strong = try FixtureFactory.build(strongFixture)
        let partialFixture = try fixture(withID: "low-coverage-road-zero-is-not-positive")
        let partial = try FixtureFactory.build(partialFixture)

        XCTAssertTrue(
            engine.hasSufficientHighQualityDistinctCandidates(
                strong.suggestions,
                request: strong.request,
                minimumCandidateCount: 1
            )
        )
        XCTAssertFalse(
            engine.hasSufficientHighQualityDistinctCandidates(
                partial.suggestions,
                request: partial.request,
                minimumCandidateCount: 1
            )
        )
    }

    func testExplanationNumbersMatchTheEvidenceUsedForSelection() throws {
        let completeFixture = try fixture(withID: "easy-loop-distance-fit")
        let complete = try FixtureFactory.build(completeFixture)
        let completeSelection = engine.select(
            complete.suggestions,
            request: complete.request
        )
        let first = try XCTUnwrap(completeSelection.selected.first)

        XCTAssertEqual(first.explanations.primaryFit?.title, "At your requested distance")
        XCTAssertEqual(
            first.explanations.primaryFit?.detail,
            "Actual 10 km versus requested 10 km."
        )
        let paths = try XCTUnwrap(
            first.explanations.verifiedCharacteristics.first { $0.code == .pathsAndTracks }
        )
        XCTAssertEqual(paths.title, "80% paths and tracks")
        XCTAssertEqual(paths.detail, "Road-class data covers 100% of this route.")
        let roads = try XCTUnwrap(
            first.explanations.verifiedCharacteristics.first { $0.code == .majorRoadExposure }
        )
        XCTAssertEqual(roads.title, "1% major-road exposure")
        XCTAssertEqual(roads.detail, "Road-class data covers 100% of this route.")

        let partialFixture = try fixture(withID: "partial-surface-limitation")
        let partial = try FixtureFactory.build(partialFixture)
        let limitation = try XCTUnwrap(
            engine.select(partial.suggestions, request: partial.request)
                .selected.first?.explanations.limitations.first {
                    $0.code == .surfaceCoverageLimited
                }
        )
        XCTAssertEqual(limitation.title, "Surface information covers only 25%")
        XCTAssertEqual(limitation.detail, "Unknown sections are not treated as paved or unpaved.")
    }

    private func fixture(withID id: String) throws -> HikingQualityFixture {
        try XCTUnwrap(try HikingQualityFixtureSuite.load().cases.first { $0.id == id })
    }

    private func fixture(tagged tag: String) throws -> HikingQualityFixture {
        try XCTUnwrap(try HikingQualityFixtureSuite.load().cases.first { $0.tags.contains(tag) })
    }

    private func assessment(
        candidateID: String,
        in selection: RouteQualitySelection,
        built: BuiltHikingQualityFixture
    ) throws -> RouteQualityAssessment {
        try XCTUnwrap(selection.assessments.first {
            built.candidateID(for: $0.route) == candidateID
        })
    }

    private static func permutations<T>(of values: [T]) -> [[T]] {
        guard let first = values.first else { return [[]] }
        return permutations(of: Array(values.dropFirst())).flatMap { tail in
            (0...tail.count).map { index in
                var value = tail
                value.insert(first, at: index)
                return value
            }
        }
    }
}

private struct HikingQualityFixtureSuite: Decodable {
    let schemaVersion: Int
    let benchmarkKind: String
    let policyVersion: String
    let cases: [HikingQualityFixture]

    static func load(from testFilePath: String = #filePath) throws -> HikingQualityFixtureSuite {
        let fixtureURL = URL(fileURLWithPath: testFilePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("hiking_route_quality_v1_eval.json")
        return try JSONDecoder().decode(
            HikingQualityFixtureSuite.self,
            from: Data(contentsOf: fixtureURL)
        )
    }
}

private struct HikingQualityFixture: Decodable {
    let id: String
    let tags: [String]
    let request: HikingQualityRequestFixture
    let candidates: [HikingQualityCandidateFixture]
    let expectedSelected: [String]
    let expectedRejections: [String: String]
    let expectedFirstExplanationCodes: [String]
    let expectedFirstLimitationCodes: [String]
    let expectedBaselineSelected: [String]?
    let expectedComparison: String?
}

private struct HikingQualityRequestFixture: Decodable {
    let routeType: String
    let activity: String
    let targetDistanceKm: Double?
    let targetDurationMinutes: Int?
    let difficulty: String?
    let avoid: [String]
    let desired: [String]
}

private struct HikingQualityCandidateFixture: Decodable {
    let id: String
    let distanceKm: Double
    let durationMinutes: Int
    let elevationGainMeters: Int
    let difficulty: String
    let geometry: String
    let geometryOffset: Double
    let evidenceProfile: String
    let routeType: String?
    let activity: String?
}

@MainActor
private struct BuiltHikingQualityFixture {
    let request: RoutePlanningRequest
    let suggestions: [RouteSuggestion]
    let candidateIDByRouteID: [UUID: String]

    func candidateID(for route: TrailRoute) -> String {
        candidateIDByRouteID[route.id] ?? "unknown-candidate"
    }

    func candidateIDs(for routes: [TrailRoute]) -> [String] {
        routes.map(candidateID(for:))
    }
}

@MainActor
private enum FixtureFactory {
    static func build(_ fixture: HikingQualityFixture) throws -> BuiltHikingQualityFixture {
        let routeType = try parsedRouteType(fixture.request.routeType)
        let activity = try parsedActivity(fixture.request.activity)
        let difficulty = try fixture.request.difficulty.map(parsedDifficulty)
        let avoid = try fixture.request.avoid.map(parsedAvoid)
        let desired = try fixture.request.desired.map(parsedDesired)
        let request = RoutePlanningRequest(
            routeType: routeType,
            startQuery: "Synthetic start",
            endQuery: routeType == .loop ? nil : "Synthetic finish",
            activityType: activity,
            graphHopperProfile: activity == .biking ? "bike" : "foot",
            targetDistanceKm: fixture.request.targetDistanceKm,
            targetDurationMinutes: fixture.request.targetDurationMinutes,
            difficulty: difficulty,
            desiredFeatures: desired,
            avoidFeatures: avoid
        )

        var idMap: [UUID: String] = [:]
        let suggestions = try fixture.candidates.map { candidate in
            let candidateRouteType = try candidate.routeType.map(parsedRouteType) ?? routeType
            let candidateActivity = try candidate.activity.map(parsedActivity) ?? activity
            let candidateDifficulty = try parsedDifficulty(candidate.difficulty)
            let candidatePath = try path(
                named: candidate.geometry,
                longitudeOffset: candidate.geometryOffset
            )
            let verifiedCharacteristics = try evidence(
                profile: candidate.evidenceProfile,
                routeDistanceMeters: candidate.distanceKm * 1_000
            )
            let durationHours = Double(candidate.durationMinutes) / 60
            let provenance = RouteProvenance.routingEngineOutput(
                provider: .graphHopper,
                strategy: .backend,
                activity: candidateActivity,
                routeType: candidateRouteType,
                distanceKilometers: candidate.distanceKm,
                elevationGainMeters: candidate.elevationGainMeters,
                elevationLossMeters: candidate.elevationGainMeters,
                durationHours: durationHours,
                difficulty: candidateDifficulty,
                path: candidatePath,
                verifiedCharacteristics: verifiedCharacteristics
            )
            let routeID = stableUUID("\(fixture.id)|\(candidate.id)")
            idMap[routeID] = candidate.id
            let route = TrailRoute(
                id: routeID,
                provenance: provenance,
                title: candidate.id,
                location: "Synthetic fixture",
                activity: candidateActivity,
                distanceKilometers: candidate.distanceKm,
                elevationGainMeters: candidate.elevationGainMeters,
                elevationLossMeters: candidate.elevationGainMeters,
                durationHours: durationHours,
                difficulty: candidateDifficulty,
                routeType: candidateRouteType,
                summary: "Deterministic offline engine-contract fixture.",
                whyItMatches: "Fixture candidate",
                highlights: [],
                waypoints: [],
                days: [],
                safetyNotes: [],
                elevationProfile: [],
                path: candidatePath,
                routeInstructions: [],
                planningMetadata: request.metadata,
                verifiedCharacteristics: verifiedCharacteristics
            )
            return RouteSuggestion(route: route, explanation: "Fixture candidate")
        }
        return BuiltHikingQualityFixture(
            request: request,
            suggestions: suggestions,
            candidateIDByRouteID: idMap
        )
    }

    static func copy(_ route: TrailRoute, path: [Coordinate]) -> TrailRoute {
        let provenance = RouteProvenance.routingEngineOutput(
            provider: .graphHopper,
            strategy: .backend,
            activity: route.activity,
            routeType: route.routeType,
            distanceKilometers: route.distanceKilometers,
            elevationGainMeters: route.elevationGainMeters,
            elevationLossMeters: route.elevationLossMeters,
            durationHours: route.durationHours,
            difficulty: route.difficulty,
            path: path,
            verifiedCharacteristics: route.verifiedCharacteristics
        )
        return TrailRoute(
            id: route.id,
            provenance: provenance,
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
            path: path,
            routeInstructions: route.routeInstructions,
            planningMetadata: route.planningMetadata,
            intentDebugMetadata: route.intentDebugMetadata,
            verifiedCharacteristics: route.verifiedCharacteristics
        )
    }

    private static func evidence(
        profile: String,
        routeDistanceMeters: Double
    ) throws -> VerifiedRouteCharacteristics? {
        switch profile {
        case "none":
            return nil
        case "goodFull":
            return characteristics(routeDistanceMeters, surface: (1, 0.80, 0.05), road: (1, 0.80, 0.01), hike: (1, 1, 0))
        case "goodPartial":
            return characteristics(routeDistanceMeters, surface: (0.20, 0.16, 0.01), road: (0.20, 0.16, 0), hike: (0.20, 1, 0))
        case "roadHighFull":
            return characteristics(routeDistanceMeters, surface: (1, 0.80, 0.05), road: (1, 0.20, 0.35), hike: (1, 1, 0))
        case "roadLowFull":
            return characteristics(routeDistanceMeters, surface: (1, 0.80, 0.05), road: (1, 0.85, 0.01), hike: (1, 1, 0))
        case "roadHighPartial":
            return characteristics(routeDistanceMeters, surface: (1, 0.80, 0.05), road: (0.20, 0.04, 0.12), hike: (1, 1, 0))
        case "pathHighFull":
            return characteristics(routeDistanceMeters, surface: (1, 0.70, 0.10), road: (1, 0.90, 0.01), hike: (1, 1, 0))
        case "pathLowFull":
            return characteristics(routeDistanceMeters, surface: (1, 0.70, 0.10), road: (1, 0.20, 0.10), hike: (1, 1, 0))
        case "stableFull":
            return characteristics(routeDistanceMeters, surface: (1, 0.95, 0), road: (1, 0.75, 0.01), hike: (1, 1, 0))
        case "roughFull":
            return characteristics(routeDistanceMeters, surface: (1, 0.05, 0.85), road: (1, 0.75, 0.01), hike: (1, 1, 0))
        case "technical2Full":
            return characteristics(routeDistanceMeters, surface: (1, 0.75, 0.10), road: (1, 0.75, 0.01), hike: (1, 2, 0.20))
        case "technical2Partial":
            return characteristics(routeDistanceMeters, surface: (1, 0.75, 0.10), road: (1, 0.75, 0.01), hike: (0.20, 2, 0.20))
        case "technical3Full":
            return characteristics(routeDistanceMeters, surface: (1, 0.70, 0.15), road: (1, 0.75, 0.01), hike: (1, 3, 0.30))
        case "surfacePartial":
            return characteristics(routeDistanceMeters, surface: (0.25, 0.20, 0.03), road: (1, 0.80, 0.01), hike: (1, 1, 0))
        case "roadPartial":
            return characteristics(routeDistanceMeters, surface: (1, 0.80, 0.05), road: (0.25, 0.20, 0.01), hike: (1, 1, 0))
        case "hikePartial":
            return characteristics(routeDistanceMeters, surface: (1, 0.80, 0.05), road: (1, 0.80, 0.01), hike: (0.25, 1, 0))
        case "malformedCoverage":
            return VerifiedRouteCharacteristics(
                routeDistanceMeters: routeDistanceMeters,
                surfaceBreakdown: [], roadClassBreakdown: [], hikeRatingBreakdown: [],
                surfaceCoverageMeters: routeDistanceMeters * 1.20,
                roadClassCoverageMeters: 0,
                hikeRatingCoverageMeters: 0
            )
        case "malformedRating":
            return VerifiedRouteCharacteristics(
                routeDistanceMeters: routeDistanceMeters,
                surfaceBreakdown: [], roadClassBreakdown: [],
                hikeRatingBreakdown: [
                    VerifiedRouteCharacteristicValue(value: "T2", distanceMeters: routeDistanceMeters)
                ],
                surfaceCoverageMeters: 0,
                roadClassCoverageMeters: 0,
                hikeRatingCoverageMeters: routeDistanceMeters
            )
        case "malformedNegative":
            return VerifiedRouteCharacteristics(
                routeDistanceMeters: routeDistanceMeters,
                surfaceBreakdown: [
                    VerifiedRouteCharacteristicValue(value: "gravel", distanceMeters: -10)
                ],
                roadClassBreakdown: [], hikeRatingBreakdown: [],
                surfaceCoverageMeters: 10,
                roadClassCoverageMeters: 0,
                hikeRatingCoverageMeters: 0
            )
        case "underfilledSurface":
            return VerifiedRouteCharacteristics(
                routeDistanceMeters: routeDistanceMeters,
                surfaceBreakdown: [
                    VerifiedRouteCharacteristicValue(
                        value: "compacted",
                        distanceMeters: routeDistanceMeters * 0.10
                    )
                ],
                roadClassBreakdown: [
                    VerifiedRouteCharacteristicValue(
                        value: "path",
                        distanceMeters: routeDistanceMeters
                    )
                ],
                hikeRatingBreakdown: [
                    VerifiedRouteCharacteristicValue(
                        value: "1",
                        distanceMeters: routeDistanceMeters
                    )
                ],
                surfaceCoverageMeters: routeDistanceMeters,
                roadClassCoverageMeters: routeDistanceMeters,
                hikeRatingCoverageMeters: routeDistanceMeters
            )
        case "underfilledRoad":
            return VerifiedRouteCharacteristics(
                routeDistanceMeters: routeDistanceMeters,
                surfaceBreakdown: [
                    VerifiedRouteCharacteristicValue(
                        value: "compacted",
                        distanceMeters: routeDistanceMeters
                    )
                ],
                roadClassBreakdown: [
                    VerifiedRouteCharacteristicValue(
                        value: "path",
                        distanceMeters: routeDistanceMeters * 0.10
                    )
                ],
                hikeRatingBreakdown: [
                    VerifiedRouteCharacteristicValue(
                        value: "1",
                        distanceMeters: routeDistanceMeters
                    )
                ],
                surfaceCoverageMeters: routeDistanceMeters,
                roadClassCoverageMeters: routeDistanceMeters,
                hikeRatingCoverageMeters: routeDistanceMeters
            )
        default:
            throw FixtureBuildError.invalidEvidenceProfile(profile)
        }
    }

    private static func characteristics(
        _ routeDistance: Double,
        surface: (coverage: Double, stable: Double, rough: Double),
        road: (coverage: Double, path: Double, major: Double),
        hike: (coverage: Double, rating: Int, demanding: Double)
    ) -> VerifiedRouteCharacteristics {
        let surfaceOther = max(surface.coverage - surface.stable - surface.rough, 0)
        let roadOther = max(road.coverage - road.path - road.major, 0)
        let basicHike = max(hike.coverage - hike.demanding, 0)
        var surfaceBreakdown = [
            VerifiedRouteCharacteristicValue(value: "compacted", distanceMeters: surface.stable * routeDistance),
            VerifiedRouteCharacteristicValue(value: "rock", distanceMeters: surface.rough * routeDistance)
        ]
        if surfaceOther > 0 {
            surfaceBreakdown.append(
                VerifiedRouteCharacteristicValue(value: "unknown_surface", distanceMeters: surfaceOther * routeDistance)
            )
        }
        var roadBreakdown = [
            VerifiedRouteCharacteristicValue(value: "path", distanceMeters: road.path * routeDistance),
            VerifiedRouteCharacteristicValue(value: "primary", distanceMeters: road.major * routeDistance)
        ]
        if roadOther > 0 {
            roadBreakdown.append(
                VerifiedRouteCharacteristicValue(value: "residential", distanceMeters: roadOther * routeDistance)
            )
        }
        var hikeBreakdown: [VerifiedRouteCharacteristicValue] = []
        if basicHike > 0 {
            hikeBreakdown.append(
                VerifiedRouteCharacteristicValue(value: "1", distanceMeters: basicHike * routeDistance)
            )
        }
        if hike.demanding > 0 {
            hikeBreakdown.append(
                VerifiedRouteCharacteristicValue(
                    value: String(hike.rating),
                    distanceMeters: hike.demanding * routeDistance
                )
            )
        }
        return VerifiedRouteCharacteristics(
            routeDistanceMeters: routeDistance,
            surfaceBreakdown: surface.coverage > 0 ? surfaceBreakdown : [],
            roadClassBreakdown: road.coverage > 0 ? roadBreakdown : [],
            hikeRatingBreakdown: hike.coverage > 0 ? hikeBreakdown : [],
            surfaceCoverageMeters: surface.coverage * routeDistance,
            roadClassCoverageMeters: road.coverage * routeDistance,
            hikeRatingCoverageMeters: hike.coverage * routeDistance
        )
    }

    private static func path(named name: String, longitudeOffset: Double) throws -> [Coordinate] {
        let loop = cleanLoop(longitudeOffset: longitudeOffset)
        switch name {
        case "loop": return loop
        case "loopReversed": return Array(loop.reversed())
        case "loopOpen": return Array(loop.dropLast(3))
        case "loopOutAndBack":
            let start = Coordinate(latitude: 51, longitude: 10 + longitudeOffset)
            let one = Coordinate(latitude: 51.01, longitude: 10.01 + longitudeOffset)
            let two = Coordinate(latitude: 51.02, longitude: 10.02 + longitudeOffset)
            let three = Coordinate(latitude: 51.03, longitude: 10.03 + longitudeOffset)
            return [start, one, two, three, two, one, start]
        case "loopMinorOverlap":
            return Array(loop.prefix(9)) +
                [loop[9], loop[8], loop[9]] +
                Array(loop.dropFirst(10))
        case "loopRepeated": return loop + loop.dropFirst()
        case "loopDegenerate":
            let start = Coordinate(latitude: 51, longitude: 10 + longitudeOffset)
            return [
                start,
                Coordinate(latitude: 51.0025, longitude: 10.07 + longitudeOffset),
                Coordinate(latitude: 51.0025, longitude: 10 + longitudeOffset),
                Coordinate(latitude: 51, longitude: 10.07 + longitudeOffset),
                start
            ]
        case "point": return pointPath(longitudeOffset: longitudeOffset, latitudeArc: 0)
        case "pointNorth": return pointPath(longitudeOffset: longitudeOffset, latitudeArc: 0.01)
        case "pointSouth": return pointPath(longitudeOffset: longitudeOffset, latitudeArc: -0.01)
        case "pointLong": return pointPath(
            longitudeOffset: longitudeOffset,
            latitudeArc: 0,
            longitudeSpan: 0.20
        )
        case "invalid": return [Coordinate(latitude: 51, longitude: 10 + longitudeOffset)]
        default: throw FixtureBuildError.invalidGeometry(name)
        }
    }

    private static func cleanLoop(longitudeOffset: Double) -> [Coordinate] {
        let center = Coordinate(latitude: 51, longitude: 10 + longitudeOffset)
        return (0...16).map { index in
            let angle = Double(index) / 16 * 2 * Double.pi
            return Coordinate(
                latitude: center.latitude + sin(angle) * 0.012,
                longitude: center.longitude + cos(angle) * 0.018
            )
        }
    }

    private static func pointPath(
        longitudeOffset: Double,
        latitudeArc: Double,
        longitudeSpan: Double = 0.05
    ) -> [Coordinate] {
        (0...8).map { index in
            let progress = Double(index) / 8
            return Coordinate(
                latitude: 51 + sin(progress * Double.pi) * latitudeArc,
                longitude: 10 + longitudeOffset + progress * longitudeSpan
            )
        }
    }

    private static func stableUUID(_ value: String) -> UUID {
        func hash(seed: UInt64) -> UInt64 {
            value.utf8.reduce(seed) { partial, byte in
                (partial ^ UInt64(byte)) &* 1_099_511_628_211
            }
        }
        let raw = String(format: "%016llx%016llx", hash(seed: 14_695_981_039_346_656_037), hash(seed: 10_995_116_282_11))
        let uuid = "\(raw.prefix(8))-\(raw.dropFirst(8).prefix(4))-\(raw.dropFirst(12).prefix(4))-\(raw.dropFirst(16).prefix(4))-\(raw.dropFirst(20).prefix(12))"
        return UUID(uuidString: uuid)!
    }

    private static func parsedRouteType(_ value: String) throws -> TrailRouteType {
        guard let result = TrailRouteType(rawValue: value) else {
            throw FixtureBuildError.invalidRouteType(value)
        }
        return result
    }

    private static func parsedActivity(_ value: String) throws -> ActivityType {
        guard let result = ActivityType(rawValue: value) else {
            throw FixtureBuildError.invalidActivity(value)
        }
        return result
    }

    private static func parsedDifficulty(_ value: String) throws -> RouteDifficulty {
        guard let result = RouteDifficulty(rawValue: value) else {
            throw FixtureBuildError.invalidDifficulty(value)
        }
        return result
    }

    private static func parsedAvoid(_ value: String) throws -> AvoidFeature {
        guard let result = AvoidFeature(rawValue: value) else {
            throw FixtureBuildError.invalidAvoid(value)
        }
        return result
    }

    private static func parsedDesired(_ value: String) throws -> DesiredFeature {
        guard let result = DesiredFeature(rawValue: value) else {
            throw FixtureBuildError.invalidDesired(value)
        }
        return result
    }
}

private enum FixtureBuildError: Error {
    case invalidRouteType(String)
    case invalidActivity(String)
    case invalidDifficulty(String)
    case invalidAvoid(String)
    case invalidDesired(String)
    case invalidGeometry(String)
    case invalidEvidenceProfile(String)
}
