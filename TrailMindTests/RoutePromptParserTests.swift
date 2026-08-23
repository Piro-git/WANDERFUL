import XCTest
@testable import TrailMind

final class RoutePromptParserTests: XCTestCase {
    @MainActor
    func testRawPromptExplicitnessIsCapturedBeforeParserDefaults() throws {
        let parser = RoutePromptParser()
        let implicitActivity = parser.hikingPreferenceExplicitness(
            in: "10 km loop around Ilsenburg with views"
        )
        XCTAssertEqual(implicitActivity.activity, .omitted)
        XCTAssertEqual(implicitActivity.comfortableOuting, .specified)
        XCTAssertEqual(implicitActivity.routeShape, .specified)
        XCTAssertEqual(implicitActivity.requestedExperiences, .specified)
        XCTAssertEqual(implicitActivity.softAvoidances, .omitted)

        let explicitNone = parser.hikingPreferenceExplicitness(
            in: "Loop around Ilsenburg, any activity, any distance, no special preferences"
        )
        XCTAssertEqual(explicitNone.activity, .noPreference)
        XCTAssertEqual(explicitNone.comfortableOuting, .noPreference)
        XCTAssertEqual(explicitNone.routeShape, .specified)
        XCTAssertEqual(explicitNone.requestedExperiences, .noPreference)
        XCTAssertEqual(explicitNone.softAvoidances, .noPreference)

        for prompt in [
            "Schierke zum Brocken",
            "Schierke zur Brockenstraße",
            "Lüneburg bis Bardowick"
        ] {
            XCTAssertEqual(
                parser.hikingPreferenceExplicitness(in: prompt).routeShape,
                .specified
            )
        }
    }

    @MainActor
    func testRequiredGermanPrompts() throws {
        let parser = RoutePromptParser()
        let cases = [
            ("Ilsenburg nach Schierke", "Ilsenburg", "Schierke"),
            ("Schierke zum Brocken", "Schierke", "Brocken"),
            ("Schierke zur Brockenstraße", "Schierke", "Brockenstraße"),
            ("von Ilsenburg nach Brocken", "Ilsenburg", "Brocken"),
            ("Wanderung von Lüneburg nach Amelinghausen", "Lüneburg", "Amelinghausen")
        ]

        for (prompt, expectedStart, expectedEnd) in cases {
            let result = try parser.parse(prompt)

            XCTAssertEqual(result.startLocationQuery, expectedStart)
            XCTAssertEqual(result.endLocationQuery, expectedEnd)
            XCTAssertEqual(result.activityType, .hiking)
            XCTAssertEqual(result.graphHopperProfile, "foot")
        }
    }

    @MainActor
    func testRequiredEnglishPrompt() throws {
        let parser = RoutePromptParser()
        let result = try parser.parse("Plan a hike from Ilsenburg to Schierke")

        XCTAssertEqual(result.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(result.endLocationQuery, "Schierke")
        XCTAssertEqual(result.activityType, .hiking)
        XCTAssertEqual(result.graphHopperProfile, "foot")
    }

    @MainActor
    func testPlainEnglishPrompt() throws {
        let parser = RoutePromptParser()
        let result = try parser.parse("Ilsenburg to Schierke")

        XCTAssertEqual(result.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(result.endLocationQuery, "Schierke")
    }

    @MainActor
    func testGermanBisPromptCreatesPointToPointRoute() throws {
        let parser = RoutePromptParser()
        let result = try parser.parse("Lüneburg bis Bardowick")

        XCTAssertEqual(result.routeType, .pointToPoint)
        XCTAssertEqual(result.startLocationQuery, "Lüneburg")
        XCTAssertEqual(result.endLocationQuery, "Bardowick")
    }

    @MainActor
    func testGermanLoopPrompts() throws {
        let parser = RoutePromptParser()
        let cases = [
            ("15 km Rundwanderung um Ilsenburg", "Ilsenburg", 15.0),
            ("Rundtour bei Schierke ca. 12 km", "Schierke", 12.0),
            ("Mach mir eine schöne Rundwanderung ab Ilsenburg mit Aussicht, ca. 15 km", "Ilsenburg", 15.0)
        ]

        for (prompt, expectedStart, expectedDistance) in cases {
            let result = try parser.parse(prompt)

            XCTAssertEqual(result.routeType, .loop)
            XCTAssertEqual(result.startLocationQuery, expectedStart)
            XCTAssertNil(result.endLocationQuery)
            XCTAssertEqual(result.activityType, .hiking)
            XCTAssertEqual(result.preferredDistanceKilometers, expectedDistance)
        }
    }

    @MainActor
    func testEnglishLoopPrompts() throws {
        let parser = RoutePromptParser()

        let loopAround = try parser.parse("10 km loop around Lüneburg")
        XCTAssertEqual(loopAround.routeType, .loop)
        XCTAssertEqual(loopAround.startLocationQuery, "Lüneburg")
        XCTAssertNil(loopAround.endLocationQuery)
        XCTAssertEqual(loopAround.preferredDistanceKilometers, 10)

        let roundTrip = try parser.parse("Round trip from Ilsenburg")
        XCTAssertEqual(roundTrip.routeType, .loop)
        XCTAssertEqual(roundTrip.startLocationQuery, "Ilsenburg")
        XCTAssertNil(roundTrip.endLocationQuery)
    }

    @MainActor
    func testNaturalHikeInRegionPromptsPreserveTheNamedRegion() throws {
        let parser = RoutePromptParser()
        let german = try parser.parse(
            "Ich will mit Freunden eine etwas leichtere Wanderung in den Alpen machen."
        )
        let english = try parser.parse("We want an easy hike in the Alps.")

        XCTAssertEqual(german.routeType, .loop)
        XCTAssertEqual(german.startLocationQuery, "Alpen")
        XCTAssertEqual(german.difficulty, .easy)
        XCTAssertEqual(english.routeType, .loop)
        XCTAssertEqual(english.startLocationQuery, "Alps")
        XCTAssertEqual(english.difficulty, .easy)
    }

    @MainActor
    func testNaturalLoopPromptsFromExamples() throws {
        let parser = RoutePromptParser()

        let relaxedLoop = try parser.parse(
            "Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück"
        )
        XCTAssertEqual(relaxedLoop.routeType, .loop)
        XCTAssertEqual(relaxedLoop.startLocationQuery, "Schierke")
        XCTAssertEqual(relaxedLoop.preferredDistanceKilometers, 15)
        XCTAssertEqual(relaxedLoop.difficulty, .easy)

        let shortLoop = try parser.parse(
            "Mach mir eine kurze Wanderung bei Lüneburg, eher easy, ungefähr 8 km"
        )
        XCTAssertEqual(shortLoop.routeType, .loop)
        XCTAssertEqual(shortLoop.startLocationQuery, "Lüneburg")
        XCTAssertEqual(shortLoop.preferredDistanceKilometers, 8)
        XCTAssertEqual(shortLoop.difficulty, .easy)

        let trailRun = try parser.parse(
            "Plan a trail run around Ilsenburg, about 90 minutes, not too steep"
        )
        XCTAssertEqual(trailRun.routeType, .loop)
        XCTAssertEqual(trailRun.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(trailRun.activityType, .trailRunning)
        XCTAssertEqual(trailRun.preferredDurationHours, 1.5)
        XCTAssertEqual(trailRun.difficulty, .easy)

        let harzLoop = try parser.parse(
            "Wir wollen im Harz sportlich wandern, 18-22 km, möglichst wenig gleichen Weg zurück"
        )
        XCTAssertEqual(harzLoop.routeType, .loop)
        XCTAssertEqual(harzLoop.startLocationQuery, "Harz")
        XCTAssertEqual(harzLoop.preferredDistanceKilometers, 20)
        XCTAssertEqual(harzLoop.difficulty, .challenging)
    }

    @MainActor
    func testLoopPromptExtractsRepeatedPathAvoidance() throws {
        let parser = RoutePromptParser()
        let parsed = try parser.parse(
            "15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück"
        )

        XCTAssertEqual(parsed.routeType, .loop)
        XCTAssertEqual(parsed.avoidFeatures, [.repeatedPath])
        XCTAssertEqual(
            RoutePlanningRequest(parsedPrompt: parsed).avoidFeatures,
            [.repeatedPath]
        )
    }

    @MainActor
    func testMultiLinePasteUsesFirstValidRoutePrompt() throws {
        let parser = RoutePromptParser()
        let result = try parser.parse(
            """
            Lüneburg bis Bardowick
            Ich will eine entspannte 15 km Rundwanderung um Schierke mit wenig gleicher Strecke zurück
            Mach mir eine kurze Wanderung bei Lüneburg, eher easy, ungefähr 8 km
            Plan a trail run around Ilsenburg, about 90 minutes, not too steep
            Wir wollen im Harz sportlich wandern, 18-22 km, möglichst wenig gleichen Weg zurück#
            """
        )

        XCTAssertEqual(result.routeType, .pointToPoint)
        XCTAssertEqual(result.startLocationQuery, "Lüneburg")
        XCTAssertEqual(result.endLocationQuery, "Bardowick")
    }

    @MainActor
    func testLoopDefaultDistancesByActivity() throws {
        let parser = RoutePromptParser()

        let hike = RoutePlanningRequest(parsedPrompt: try parser.parse("Rundwanderung um Ilsenburg"))
        XCTAssertEqual(hike.routeType, .loop)
        XCTAssertEqual(hike.targetDistanceKm, 10)

        let trailRun = RoutePlanningRequest(parsedPrompt: try parser.parse("Trailrun loop from Ilsenburg for 2 hours"))
        XCTAssertEqual(trailRun.routeType, .loop)
        XCTAssertEqual(trailRun.activityType, .trailRunning)
        XCTAssertEqual(trailRun.targetDistanceKm, 16)
        XCTAssertEqual(trailRun.targetDurationMinutes, 120)

        let bike = RoutePlanningRequest(parsedPrompt: try parser.parse("Bike loop around Lüneburg"))
        XCTAssertEqual(bike.routeType, .loop)
        XCTAssertEqual(bike.activityType, .biking)
        XCTAssertEqual(bike.targetDistanceKm, 25)
    }

    @MainActor
    func testRicherGermanPromptExtractsIntentWithoutPollutingDestination() throws {
        let parser = RoutePromptParser()
        let result = try parser.parse("Plane eine schöne Wanderung von Ilsenburg nach Schierke mit Aussicht, ca. 15 km")

        XCTAssertEqual(result.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(result.endLocationQuery, "Schierke")
        XCTAssertEqual(result.activityType, .hiking)
        XCTAssertEqual(result.preferredDistanceKilometers, 15)
        XCTAssertNil(result.preferredDurationHours)
        XCTAssertEqual(result.desiredFeatures, [.viewpoint])
    }

    @MainActor
    func testActivitySpecificPromptsMapToGraphHopperProfiles() throws {
        let parser = RoutePromptParser()

        let bike = try parser.parse("Radroute von Lüneburg nach Amelinghausen")
        XCTAssertEqual(bike.activityType, .biking)
        XCTAssertEqual(bike.graphHopperProfile, "bike")

        let trailRun = try parser.parse("Trailrun from Ilsenburg to Schierke for 2 hours")
        XCTAssertEqual(trailRun.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(trailRun.endLocationQuery, "Schierke")
        XCTAssertEqual(trailRun.activityType, .trailRunning)
        XCTAssertEqual(trailRun.graphHopperProfile, "foot")
        XCTAssertEqual(trailRun.preferredDurationHours, 2)
    }

    @MainActor
    func testLabeledAndArrowPrompts() throws {
        let parser = RoutePromptParser()

        let labeled = try parser.parse("Start: Ilsenburg, Ziel: Brocken")
        XCTAssertEqual(labeled.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(labeled.endLocationQuery, "Brocken")

        let arrow = try parser.parse("Ilsenburg → Schierke")
        XCTAssertEqual(arrow.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(arrow.endLocationQuery, "Schierke")
    }

    @MainActor
    func testReverseGermanOrderPrompt() throws {
        let parser = RoutePromptParser()
        let result = try parser.parse("Ich möchte nach Schierke von Ilsenburg")

        XCTAssertEqual(result.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(result.endLocationQuery, "Schierke")
    }

    @MainActor
    func testDifficultyAndFeatureExtraction() throws {
        let parser = RoutePromptParser()
        let result = try parser.parse("Anspruchsvolle Route von Ilsenburg nach Brocken mit Wald und Wasser")

        XCTAssertEqual(result.difficulty, .challenging)
        XCTAssertEqual(result.desiredFeatures, [.forest, .water])
    }

    @MainActor
    func testTrimsTerminalPunctuation() throws {
        let parser = RoutePromptParser()
        let result = try parser.parse("  von Ilsenburg nach Schierke!  ")

        XCTAssertEqual(result.startLocationQuery, "Ilsenburg")
        XCTAssertEqual(result.endLocationQuery, "Schierke")
    }

    @MainActor
    func testInvalidPromptUsesFriendlyMessage() {
        let parser = RoutePromptParser()
        XCTAssertThrowsError(try parser.parse("mach mir was schönes")) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Which area should I plan around?"
            )
        }
    }

    @MainActor
    func testIdenticalEndpointsAreRejected() {
        let parser = RoutePromptParser()
        XCTAssertThrowsError(try parser.parse("Ilsenburg nach ilsenburg"))
    }
}
