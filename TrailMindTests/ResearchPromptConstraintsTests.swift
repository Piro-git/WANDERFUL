import XCTest
@testable import TrailMind

@MainActor
final class ResearchPromptConstraintsTests: XCTestCase {
    func testGermanStrictLimitsAndInflections() {
        for prompt in ["Rundwanderung unter 2 Stunden", "weniger als 2 Stunden", "unter zwei Stunden"] {
            assertLimits(prompt, duration: Double(120).nextDown)
        }
        for prompt in ["mit weniger als 200 Höhenmetern", "unter 200 Höhenmeter", "weniger als 200 hm",
                       "unter 200 Hoehenmetern", "unter 200 Metern Aufstieg"] {
            assertLimits(prompt, elevation: Double(200).nextDown)
        }
        for prompt in ["unter 12 Kilometern", "weniger als 12 km"] {
            assertLimits(prompt, distance: Double(12).nextDown)
        }
    }

    func testInclusiveLimitsAndTightestLimit() {
        for prompt in ["höchstens 2 Stunden", "maximal 2 Stunden", "nicht länger als 2 Stunden",
                       "nicht mehr als 2 Stunden", "bis zu 2 Stunden", "2 Stunden maximal"] {
            assertLimits(prompt, duration: 120)
        }
        assertLimits("höchstens 200 Höhenmetern", elevation: 200)
        assertLimits("maximal 15 km und höchstens 12 Kilometer", distance: 12)
        assertLimits("höchstens 2 Stunden und unter 2 Stunden", duration: Double(120).nextDown)
        assertLimits("2 Stunden, maximal 12 km", distance: 12)
        assertLimits("nicht  mehr   als 2 Stunden", duration: 120)
        assertLimits("maximal 12 km, unter 2 Stunden und weniger als 200 Höhenmetern",
                     distance: 12, duration: Double(120).nextDown, elevation: Double(200).nextDown)
    }

    func testDecimalAndCompoundDurations() {
        assertLimits("unter 1,5 Stunden", duration: Double(90).nextDown)
        assertLimits("höchstens 1.5 hours", duration: 90)
        assertLimits("unter 2 Stunden und 30 Minuten", duration: Double(150).nextDown)
        assertLimits("maximal 1 Stunde 45 Minuten", duration: 105)
        assertLimits("maximum 2 hours and 30 minutes", duration: 150)
        assertLimits("maximum 2 hrs and 30 mins", duration: 150)
        assertLimits("höchstens eineinhalb Stunden", duration: 90)
        assertLimits("unter anderthalb Stunden", duration: Double(90).nextDown)
        assertLimits("maximal eine Stunde und zehn Minuten", duration: 70)
        assertLimits("max. 2 h", duration: 120)
        assertLimits("maximal 2 Std", duration: 120)
        assertLimits("maximal 90 Minuten", duration: 90)
        assertLimits("unter 12,5 km", distance: Double(12.5).nextDown)
    }

    func testSoftAndNonQuantitativePhrasesDoNotAskFalseQuestions() {
        for prompt in ["Rundwanderung mit maximal viel Aussicht", "A hike under the trees",
                       "Wanderung unter Bäumen", "over the hill", "maximal schöne Aussicht, 15 km Runde",
                       "etwa 2 Stunden", "ca. 200 Höhenmeter", "15 km Rundwanderung",
                       "möglichst unter 2 Stunden", "idealerweise maximal 200 Höhenmeter",
                       "preferably under 2 hours", "under 2 hours if possible", "2 hours at most if possible", "unter 2 Stunden, wenn möglich",
                       "maximal viel Aussicht und under the trees", "15 km, maximal viel Aussicht"] {
            assertLimits(prompt)
        }
        assertLimits("maximal viel Aussicht, aber höchstens 2 Stunden", duration: 120)
        assertLimits("möglichst unter 2 Stunden, aber maximal 12 km", distance: 12)
    }

    func testUnsupportedHardRelationshipsAndAmountsRequireClarification() {
        for prompt in ["nicht unter 2 Stunden", "nicht weniger als 200 Höhenmeter", "not under 2 hours",
                       "not less than 12 km", "mindestens 12 km", "mehr als 200 Höhenmeter",
                       "nicht maximal 2 Stunden", "höchstens zwölf Stunden", "maximal ca. 2 Stunden",
                       "maximal 2 bis 3 Stunden", "maximal 250 feet ascent", "unter 2h30min",
                       "maximal 2 Stunden und eine halbe Stunde", "maximal 2 Stunden und 30 Minuten und 10 Sekunden",
                       "maximal viele Höhenmeter", "maximal 1.200 Höhenmeter", "nicht länger als", "keine 2 Stunden", "nicht 200 Höhenmeter", "maximal -2 Stunden", "maximal 2 Stunden und -30 Minuten", "maximal 0 km"] {
            XCTAssertTrue(ResearchPromptConstraints(prompt: prompt).requiresClarification, prompt)
        }
        XCTAssertNil(ResearchPromptConstraints(prompt: "nicht unter 2 Stunden").maximumDurationMinutes)
        XCTAssertNil(ResearchPromptConstraints(prompt: "maximal -2 Stunden").maximumDurationMinutes)
        XCTAssertNil(ResearchPromptConstraints(prompt: "maximal 0 km").maximumDistanceKm)
    }

    func testEnglishLimitsAndStrictSerializationRemainCompatible() throws {
        assertLimits("under 2 hours", duration: Double(120).nextDown)
        assertLimits("less than 200 meters ascent", elevation: Double(200).nextDown)
        assertLimits("no more than 12 km", distance: 12)
        assertLimits("don't exceed 2 hours", duration: 120)
        assertLimits("don’t exceed 2 hours", duration: 120)
        assertLimits("2 hours at most", duration: 120)
        let limit = try XCTUnwrap(ResearchPromptConstraints(prompt: "unter 2 Stunden").maximumDurationMinutes)
        let data = try JSONEncoder().encode(["maximumDurationMinutes": limit])
        let decoded = try JSONDecoder().decode([String: Double].self, from: data)
        XCTAssertEqual(decoded["maximumDurationMinutes"], Double(120).nextDown)
        XCTAssertFalse(120 <= decoded["maximumDurationMinutes"]!)
        XCTAssertTrue(119 <= decoded["maximumDurationMinutes"]!)
    }

    func testHardAvoidancesStayScopedToTheirOwnPhrase() {
        XCTAssertEqual(ResearchPromptConstraints(prompt: "ohne Hauptstraßen und unter 2 Stunden").hardAvoidances, ["majorRoads"])
        for prompt in ["möglichst ohne Hauptstraßen", "prefer to avoid major roads", "don't avoid major roads",
                       "no need to avoid major roads", "nicht ohne Hauptstraßen"] {
            XCTAssertEqual(ResearchPromptConstraints(prompt: prompt).hardAvoidances, [], prompt)
        }
    }

    private func assertLimits(_ prompt: String, distance: Double? = nil, duration: Double? = nil,
                              elevation: Double? = nil, file: StaticString = #filePath, line: UInt = #line) {
        let result = ResearchPromptConstraints(prompt: prompt)
        XCTAssertEqual(result.maximumDistanceKm, distance, prompt, file: file, line: line)
        XCTAssertEqual(result.maximumDurationMinutes, duration, prompt, file: file, line: line)
        XCTAssertEqual(result.maximumElevationGainMeters, elevation, prompt, file: file, line: line)
        XCTAssertFalse(result.requiresClarification, prompt, file: file, line: line)
    }
}
