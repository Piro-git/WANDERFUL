import Foundation
import XCTest
@testable import TrailMind

private struct LocationResolutionFixture: Decodable {
    struct CandidateFixture: Decodable {
        let id: String
        let name: String
        let display: String
        let kind: String
        let countryCode: String?
        let rank: Int
        let lat: Double
        let lon: Double

        @MainActor
        var candidate: LocationCandidate {
            LocationCandidate(
                id: id,
                name: name,
                displayName: display,
                coordinate: Coordinate(latitude: lat, longitude: lon),
                semanticKind: LocationSemanticKind(rawValue: kind) ?? .unknown,
                countryCode: countryCode,
                provider: .appleGeocoder,
                providerRank: rank
            )
        }
    }

    let id: String
    let prompt: String
    let query: String
    let field: String
    let routeType: String
    let candidates: [CandidateFixture]
    let expected: String
    let expectedID: String?

    static func load(from testFilePath: String = #filePath) throws -> [LocationResolutionFixture] {
        let testFile = URL(fileURLWithPath: testFilePath)
        let fixtureURL = testFile
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures")
            .appendingPathComponent("location_resolution_eval.json")
        return try JSONDecoder().decode(
            [LocationResolutionFixture].self,
            from: Data(contentsOf: fixtureURL)
        )
    }

    @MainActor
    var context: LocationQueryContext {
        LocationQueryContext(
            originalQuery: query,
            originalPrompt: prompt,
            localeIdentifier: prompt.range(of: #"[äöüß]|\b(?:ich|wanderung|rund)\b"#, options: [.regularExpression, .caseInsensitive]) == nil
                ? "en_US"
                : "de_DE",
            routeType: routeType == "pointToPoint" ? .pointToPoint : .loop,
            activityType: .hiking,
            requestedField: IntentMissingField(rawValue: field) ?? .startLocationQuery
        )
    }
}

@MainActor
private final class StubLocationCandidateProvider: LocationCandidateProviding {
    let results: [LocationCandidate]
    private(set) var contexts: [LocationQueryContext] = []

    init(results: [LocationCandidate]) {
        self.results = results
    }

    func candidates(for context: LocationQueryContext) async throws -> [LocationCandidate] {
        contexts.append(context)
        return results
    }
}

@MainActor
final class LocationResolutionTests: XCTestCase {
    func testEvaluationFixtureCoversAtLeastThirtyGermanAndEnglishHikingCases() throws {
        let fixtures = try LocationResolutionFixture.load()

        XCTAssertGreaterThanOrEqual(fixtures.count, 30)
        XCTAssertTrue(fixtures.contains { $0.prompt.localizedCaseInsensitiveContains("Wander") })
        XCTAssertTrue(fixtures.contains { $0.prompt.localizedCaseInsensitiveContains("hike") })
        XCTAssertTrue(fixtures.contains { $0.routeType == "loop" })
        XCTAssertTrue(fixtures.contains { $0.routeType == "pointToPoint" })
        XCTAssertTrue(fixtures.contains { $0.field == IntentMissingField.endLocationQuery.rawValue })
        XCTAssertTrue(fixtures.contains { $0.candidates.count > 1 })
        XCTAssertTrue(fixtures.contains { $0.candidates.contains { $0.kind == LocationSemanticKind.trailhead.rawValue } })
        XCTAssertTrue(fixtures.contains { $0.candidates.contains { $0.kind == LocationSemanticKind.park.rawValue } })
    }

    func testEvaluationFixtureOutcomesAreDeterministic() throws {
        let fixtures = try LocationResolutionFixture.load()

        for fixture in fixtures {
            let resolution = LocationResolutionPolicy.resolve(
                context: fixture.context,
                candidates: fixture.candidates.map(\.candidate)
            )
            switch (fixture.expected, resolution) {
            case let ("resolved", .resolved(candidate)):
                XCTAssertEqual(candidate.id, fixture.expectedID, fixture.id)
                XCTAssertTrue(candidate.semanticKind.isUsableRouteAnchor, fixture.id)
            case ("clarification", .needsClarification):
                break
            default:
                XCTFail("Unexpected outcome for \(fixture.id): \(resolution)")
            }
        }
    }

    func testAlpsAndHarzBroadRegionsNeverInvokeProvider() async throws {
        for query in ["den Alpen", "the Alps", "Harz"] {
            let provider = StubLocationCandidateProvider(results: [])
            let resolver = LocationResolutionService(provider: provider)
            let resolution = try await resolver.resolve(
                LocationQueryContext(
                    originalQuery: query,
                    originalPrompt: "Plan a light hike in \(query)",
                    routeType: .loop,
                    activityType: .hiking,
                    requestedField: .startLocationQuery
                )
            )

            guard case let .needsClarification(clarification) = resolution else {
                return XCTFail("\(query) should require clarification")
            }
            XCTAssertTrue(clarification.allowsFreeText)
            XCTAssertTrue(clarification.candidates.isEmpty)
            XCTAssertTrue(clarification.supportingText.contains("town, valley or trailhead"))
            XCTAssertEqual(provider.contexts.count, 0)
        }
    }

    func testAlpenMunicipalityQualifierBypassesBroadRegionGuard() {
        let candidate = LocationCandidate(
            id: "alpen-nrw",
            name: "Alpen",
            displayName: "Alpen, North Rhine-Westphalia, Germany",
            coordinate: Coordinate(latitude: 51.58, longitude: 6.51),
            semanticKind: .settlement,
            administrativeRegion: "North Rhine-Westphalia",
            country: "Germany",
            countryCode: "DE",
            provider: .appleGeocoder
        )
        let resolution = LocationResolutionPolicy.resolve(
            context: LocationQueryContext(
                originalQuery: "Alpen, Nordrhein-Westfalen",
                originalPrompt: "10 km Rundwanderung um Alpen, Nordrhein-Westfalen.",
                routeType: .loop,
                activityType: .hiking,
                requestedField: .startLocationQuery
            ),
            candidates: [candidate]
        )

        XCTAssertEqual(resolution, .resolved(candidate))
    }

    func testExplicitCountryOutranksProviderOrderAndNearbyHint() {
        let austrian = LocationCandidate(
            id: "innsbruck-at",
            name: "Innsbruck",
            displayName: "Innsbruck, Tyrol, Austria",
            coordinate: Coordinate(latitude: 47.27, longitude: 11.40),
            semanticKind: .settlement,
            countryCode: "AT",
            provider: .appleGeocoder,
            providerRank: 1
        )
        let wrongCountry = LocationCandidate(
            id: "innsbruck-wrong",
            name: "Innsbruck",
            displayName: "Innsbruck, Germany",
            coordinate: Coordinate(latitude: 51.86, longitude: 10.68),
            semanticKind: .settlement,
            countryCode: "DE",
            provider: .appleGeocoder,
            providerRank: 0
        )
        let resolution = LocationResolutionPolicy.resolve(
            context: LocationQueryContext(
                originalQuery: "Innsbruck, Austria",
                originalPrompt: "Easy hike near Innsbruck, Austria.",
                routeType: .loop,
                activityType: .hiking,
                requestedField: .startLocationQuery,
                preferredCoordinate: wrongCountry.coordinate
            ),
            candidates: [wrongCountry, austrian]
        )

        XCTAssertEqual(resolution, .resolved(austrian))
    }

    func testCloseCandidateScoresRequireChoiceWithoutExposingPercentages() {
        let candidates = [
            LocationCandidate(
                id: "one",
                name: "Neustadt",
                displayName: "Neustadt, Rhineland-Palatinate, Germany",
                coordinate: Coordinate(latitude: 49.35, longitude: 8.15),
                semanticKind: .settlement,
                countryCode: "DE",
                provider: .appleGeocoder,
                providerRank: 0
            ),
            LocationCandidate(
                id: "two",
                name: "Neustadt",
                displayName: "Neustadt, Lower Saxony, Germany",
                coordinate: Coordinate(latitude: 52.50, longitude: 9.46),
                semanticKind: .settlement,
                countryCode: "DE",
                provider: .appleGeocoder,
                providerRank: 1
            )
        ]
        let context = LocationQueryContext(
            originalQuery: "Neustadt",
            originalPrompt: "Wanderung bei Neustadt",
            routeType: .loop,
            activityType: .hiking,
            requestedField: .startLocationQuery
        )

        let ranked = LocationResolutionPolicy.rank(candidates: candidates, for: context)
        XCTAssertLessThan(
            ranked[0].score - ranked[1].score,
            LocationResolutionPolicy.automaticResolutionMargin
        )
        guard case let .needsClarification(clarification) = LocationResolutionPolicy.resolve(
            context: context,
            candidates: candidates
        ) else {
            return XCTFail("Close candidates must be clarified")
        }
        XCTAssertEqual(clarification.candidates.map(\.id), ["one", "two"])
        XCTAssertFalse(clarification.question.contains("%"))
        XCTAssertFalse(clarification.supportingText.contains("%"))
    }

    func testResolverCachesEquivalentContextWithoutRepeatingProviderCall() async throws {
        let candidate = LocationCandidate(
            id: "ilsenburg",
            name: "Ilsenburg",
            displayName: "Ilsenburg, Saxony-Anhalt, Germany",
            coordinate: Coordinate(latitude: 51.87, longitude: 10.68),
            semanticKind: .settlement,
            countryCode: "DE",
            provider: .appleGeocoder
        )
        let provider = StubLocationCandidateProvider(results: [candidate])
        let resolver = LocationResolutionService(provider: provider)
        let context = LocationQueryContext(
            originalQuery: "Ilsenburg",
            originalPrompt: "15 km loop around Ilsenburg",
            routeType: .loop,
            activityType: .hiking,
            requestedField: .startLocationQuery
        )

        _ = try await resolver.resolve(context)
        _ = try await resolver.resolve(context)

        XCTAssertEqual(provider.contexts.count, 1)
    }

    func testExplicitCountryParsingSupportsGermanEnglishAndNeverAddsGermany() {
        XCTAssertEqual(LocationLanguageContext.explicitCountryCode(in: "Innsbruck, Austria"), "AT")
        XCTAssertEqual(LocationLanguageContext.explicitCountryCode(in: "Hallstatt, Österreich"), "AT")
        XCTAssertEqual(LocationLanguageContext.explicitCountryCode(in: "Paris, France."), "FR")
        XCTAssertNil(LocationLanguageContext.explicitCountryCode(in: "Ilsenburg"))
        XCTAssertEqual(NativeGeocodingService.contextualizedQuery("Paris, France"), "Paris, France")
        XCTAssertEqual(NativeGeocodingService.contextualizedQuery("Ilsenburg"), "Ilsenburg")
    }
}
