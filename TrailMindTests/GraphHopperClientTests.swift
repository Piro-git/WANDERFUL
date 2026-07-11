import Foundation
import XCTest
@testable import TrailMind

final class GraphHopperClientTests: XCTestCase {
    @MainActor
    func testFlexibleModeErrorUsesFriendlyDescription() {
        let error = GraphHopperError.api(
            statusCode: 400,
            message: "Free packages cannot use flexible mode",
            hints: []
        )

        XCTAssertTrue(error.isFlexibleModeUnavailable)
        XCTAssertEqual(
            error.localizedDescription,
            "Live loop routing needs GraphHopper flexible mode, which is not available on this API plan."
        )
    }

    @MainActor
    func testGeneratedRouteIncludesIntentMetadataAndActivityTitle() async throws {
        let routeData = try Self.routeResponseData(distanceMeters: 14_400, timeMilliseconds: 13_740_000)
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 200, data: routeData)
            ]
        )
        let client = try makeClient()
        let planningRequest = RoutePlanningRequest(
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .trailRunning,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: 120,
            difficulty: .moderate,
            desiredFeatures: [.viewpoint, .quiet]
        )

        let route = try await client.calculateGraphHopperRoute(
            request: planningRequest,
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            end: Coordinate(latitude: 51.7636, longitude: 10.6647)
        )

        XCTAssertEqual(route.title, "Trail run from Ilsenburg to Schierke")
        XCTAssertEqual(route.activity, .trailRunning)
        XCTAssertEqual(route.difficulty, .moderate)
        XCTAssertEqual(route.planningMetadata?.targetDistanceKm, 15)
        XCTAssertEqual(route.planningMetadata?.targetDurationMinutes, 120)
        XCTAssertEqual(route.planningMetadata?.desiredFeatures, [.viewpoint, .quiet])
        XCTAssertTrue(route.whyItMatches.contains("Requested: Views, Quiet route"))
    }

    @MainActor
    func testPathDetailsAreDecodedAndWeightedByGeometryDistance() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseWithDetailsData()
                )
            ]
        )
        let client = try makeClient()
        let request = RoutePlanningRequest(
            startQuery: "Start",
            endQuery: "Finish",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )

        let route = try await client.calculateGraphHopperRoute(
            request: request,
            start: Coordinate(latitude: 0, longitude: 0),
            end: Coordinate(latitude: 0, longitude: 0.03)
        )

        let characteristics = try XCTUnwrap(route.verifiedCharacteristics)
        XCTAssertEqual(characteristics.surfaceCoverageRatio, 1, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(characteristics.pavedRatio), 1.0 / 3.0, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(characteristics.unpavedRatio), 2.0 / 3.0, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(characteristics.majorRoadRatio), 1.0 / 3.0, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(characteristics.pathAndTrackRatio), 2.0 / 3.0, accuracy: 0.01)
        XCTAssertEqual(characteristics.maximumHikeRating, 2)
        XCTAssertEqual(
            characteristics.mountainHikingDistanceMeters / characteristics.routeDistanceMeters,
            2.0 / 3.0,
            accuracy: 0.01
        )
        XCTAssertEqual(
            characteristics.cardFacts.map(\.title),
            ["67% unpaved", "Mostly paths and tracks"]
        )
        let factualText = characteristics.cardFacts.map(\.title).joined(separator: " ").lowercased()
        XCTAssertFalse(factualText.contains("scenic"))
        XCTAssertFalse(factualText.contains("safe"))
        XCTAssertFalse(factualText.contains("water"))
        XCTAssertFalse(factualText.contains("closure"))
    }

    @MainActor
    func testNullUnknownAndOutOfRangeDetailsDoNotInvalidateRoute() async throws {
        let details = #"""
        {
          "surface": [["broken"], [-4, 1, "asphalt"], [1, 2, null], [2, 99, "volcanic_glass"], [3, 1, "gravel"]],
          "road_class": [],
          "hike_rating": []
        }
        """#
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseWithDetailsData(
                        coordinates: "[0, 0, 0], [0.01, 0, 0], [0.02, 0, 0], [0.03, 0, 0]",
                        detailsJSON: details
                    )
                )
            ]
        )
        let client = try makeClient()
        let request = RoutePlanningRequest(
            startQuery: "Start",
            endQuery: "Finish",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )

        let route = try await client.calculateGraphHopperRoute(
            request: request,
            start: Coordinate(latitude: 0, longitude: 0),
            end: Coordinate(latitude: 0, longitude: 0.03)
        )

        let characteristics = try XCTUnwrap(route.verifiedCharacteristics)
        XCTAssertEqual(characteristics.surfaceCoverageRatio, 2.0 / 3.0, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(characteristics.pavedRatio), 1.0 / 3.0, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(characteristics.unpavedRatio), 0, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(characteristics.unknownSurfaceRatio), 2.0 / 3.0, accuracy: 0.01)
        XCTAssertTrue(characteristics.surfaceBreakdown.contains { $0.value == "volcanic_glass" })
    }

    @MainActor
    func testSurfacePercentagesStayHiddenBelowCoverageThreshold() async throws {
        let details = #"{"surface":[[0,1,"asphalt"]]}"#
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseWithDetailsData(detailsJSON: details)
                )
            ]
        )
        let client = try makeClient()
        let request = RoutePlanningRequest(
            startQuery: "Start",
            endQuery: "Finish",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )

        let route = try await client.calculateGraphHopperRoute(
            request: request,
            start: Coordinate(latitude: 0, longitude: 0),
            end: Coordinate(latitude: 0, longitude: 0.03)
        )

        let characteristics = try XCTUnwrap(route.verifiedCharacteristics)
        XCTAssertEqual(characteristics.surfaceCoverageRatio, 1.0 / 3.0, accuracy: 0.01)
        XCTAssertFalse(characteristics.hasDisplayableSurfaceData)
        XCTAssertNil(characteristics.pavedRatio)
        XCTAssertNil(characteristics.unpavedRatio)
        XCTAssertTrue(characteristics.cardFacts.isEmpty)
    }

    @MainActor
    func testMissingDetailsLeaveVerifiedCharacteristicsUnknown() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 200, data: try Self.routeResponseData(distanceMeters: 10_000, timeMilliseconds: 7_200_000))
            ]
        )
        let client = try makeClient()
        let request = RoutePlanningRequest(
            startQuery: "Start",
            endQuery: "Finish",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )

        let route = try await client.calculateGraphHopperRoute(
            request: request,
            start: Coordinate(latitude: 51.8, longitude: 10.6),
            end: Coordinate(latitude: 51.7, longitude: 10.7)
        )

        XCTAssertNil(route.verifiedCharacteristics)
    }

    @MainActor
    func testCustomModelFailureFallsBackToNormalRouteRequest() async throws {
        let errorData = Data(#"{"message":"custom model rejected","hints":[]}"#.utf8)
        let routeData = try Self.routeResponseData(distanceMeters: 20_300, timeMilliseconds: 14_640_000)
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 400, data: errorData),
                .init(statusCode: 200, data: routeData)
            ]
        )
        let client = try makeClient()
        let planningRequest = RoutePlanningRequest(
            startQuery: "Lüneburg",
            endQuery: "Amelinghausen",
            activityType: .biking,
            graphHopperProfile: "bike",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [.quiet]
        )

        let route = try await client.calculateGraphHopperRoute(
            request: planningRequest,
            start: Coordinate(latitude: 53.2487, longitude: 10.4079),
            end: Coordinate(latitude: 53.1305, longitude: 10.2147)
        )

        let bodies = URLProtocolStub.requestBodies()
        XCTAssertEqual(bodies.count, 2)
        XCTAssertTrue(String(data: bodies[0], encoding: .utf8)?.contains(#""custom_model""#) == true)
        XCTAssertTrue(String(data: bodies[0], encoding: .utf8)?.contains(#""ch.disable""#) == true)
        XCTAssertFalse(String(data: bodies[1], encoding: .utf8)?.contains(#""custom_model""#) == true)
        XCTAssertEqual(route.title, "Bike route from Lüneburg to Amelinghausen")
        XCTAssertEqual(route.activity, .biking)
        XCTAssertEqual(route.planningMetadata?.desiredFeatures, [.quiet])
    }

    @MainActor
    func testRoadAndSlopePreferencesAreAppliedWhenCustomModelSucceeds() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseData(
                        distanceMeters: 12_400,
                        timeMilliseconds: 10_800_000
                    )
                )
            ]
        )
        let client = try makeClient()
        let planningRequest = RoutePlanningRequest(
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: .easy,
            desiredFeatures: [],
            avoidFeatures: [.majorRoads, .steepClimbs]
        )

        let route = try await client.calculateGraphHopperRoute(
            request: planningRequest,
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            end: Coordinate(latitude: 51.7636, longitude: 10.6647)
        )

        let body = try XCTUnwrap(String(data: URLProtocolStub.requestBodies()[0], encoding: .utf8))
        XCTAssertTrue(body.contains("road_class == TRUNK"))
        XCTAssertTrue(body.contains("road_class == PRIMARY"))
        XCTAssertTrue(body.contains("max_slope > 12"))
        XCTAssertTrue(body.contains("max_slope > 20"))
        XCTAssertEqual(
            route.planningMetadata?.routeShapingSummary?.applied,
            [.activityProfile, .lowerElevation, .avoidMajorRoads]
        )
        XCTAssertTrue(route.planningMetadata?.routeShapingSummary?.requestedOnly.isEmpty == true)
    }

    @MainActor
    func testRejectedCustomModelKeepsRoadAndSlopePreferencesRequestedOnly() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 400, data: Data(#"{"message":"flexible mode unavailable","hints":[]}"#.utf8)),
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseData(
                        distanceMeters: 12_400,
                        timeMilliseconds: 10_800_000
                    )
                )
            ]
        )
        let client = try makeClient()
        let planningRequest = RoutePlanningRequest(
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: .easy,
            desiredFeatures: [],
            avoidFeatures: [.majorRoads, .steepClimbs]
        )

        let route = try await client.calculateGraphHopperRoute(
            request: planningRequest,
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            end: Coordinate(latitude: 51.7636, longitude: 10.6647)
        )

        XCTAssertEqual(route.planningMetadata?.routeShapingSummary?.applied, [.activityProfile])
        XCTAssertEqual(
            route.planningMetadata?.routeShapingSummary?.requestedOnly,
            [.lowerElevation, .avoidMajorRoads]
        )
    }

    @MainActor
    func testTargetDistanceRequestsAlternativesAndSelectsClosestPath() async throws {
        let routeData = try Self.routeResponseData(
            paths: [
                (distanceMeters: 22_000, timeMilliseconds: 18_000_000),
                (distanceMeters: 14_600, timeMilliseconds: 13_200_000),
                (distanceMeters: 10_000, timeMilliseconds: 9_000_000)
            ]
        )
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 200, data: routeData)
            ]
        )
        let client = try makeClient()
        let planningRequest = RoutePlanningRequest(
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [.viewpoint]
        )

        let route = try await client.calculateGraphHopperRoute(
            request: planningRequest,
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            end: Coordinate(latitude: 51.7636, longitude: 10.6647)
        )

        let body = String(data: URLProtocolStub.requestBodies()[0], encoding: .utf8)
        XCTAssertTrue(body?.contains(#""algorithm":"alternative_route""#) == true)
        XCTAssertTrue(body?.contains(#""alternative_route.max_paths""#) == true)
        XCTAssertEqual(route.distanceKilometers, 14.6, accuracy: 0.01)
        XCTAssertEqual(route.planningMetadata?.targetDistanceKm, 15)
    }

    @MainActor
    func testRoundTripRequestBodyUsesOnePointDistanceAndSeed() async throws {
        let routeData = try Self.loopRouteResponseData(distanceMeters: 15_200, timeMilliseconds: 13_800_000)
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 200, data: routeData)
            ]
        )
        let client = try makeClient()
        let planningRequest = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [.viewpoint]
        )

        let route = try await client.calculateRoundTripRoute(
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            request: planningRequest,
            seed: 29
        )

        let body = String(data: URLProtocolStub.requestBodies()[0], encoding: .utf8)
        XCTAssertTrue(body?.contains(#""algorithm":"round_trip""#) == true)
        XCTAssertTrue(body?.contains(#""round_trip.distance":15000"#) == true)
        XCTAssertTrue(body?.contains(#""round_trip.seed":29"#) == true)
        XCTAssertTrue(body?.contains(#""ch.disable":true"#) == true)
        let payload = try JSONSerialization.jsonObject(with: URLProtocolStub.requestBodies()[0]) as? [String: Any]
        XCTAssertEqual((payload?["points"] as? [[Double]])?.count, 1)
        XCTAssertEqual(route.routeType, .loop)
        XCTAssertEqual(route.title, "15.2 km Hike loop around Ilsenburg")
        XCTAssertEqual(route.planningMetadata?.routeType, .loop)
        XCTAssertEqual(route.planningMetadata?.targetDistanceKm, 15)
    }

    @MainActor
    func testMultiPointFallbackRequestUsesNormalRouteEndpointWithoutFlexibleMode() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 200, data: try Self.loopRouteResponseData(distanceMeters: 14_800, timeMilliseconds: 13_200_000))
            ]
        )
        let client = try makeClient()
        let planningRequest = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )

        let route = try await client.calculateGraphHopperRoute(
            waypoints: [
                Coordinate(latitude: 51.8666, longitude: 10.6782),
                Coordinate(latitude: 51.8900, longitude: 10.7200),
                Coordinate(latitude: 51.8400, longitude: 10.7100),
                Coordinate(latitude: 51.8666, longitude: 10.6782)
            ],
            request: planningRequest,
            seed: 47
        )

        let body = try XCTUnwrap(String(data: URLProtocolStub.requestBodies()[0], encoding: .utf8))
        XCTAssertFalse(body.contains(#""algorithm":"round_trip""#))
        XCTAssertFalse(body.contains(#""round_trip.distance""#))
        XCTAssertFalse(body.contains(#""round_trip.seed""#))
        XCTAssertFalse(body.contains(#""ch.disable""#))
        XCTAssertFalse(body.contains(#""custom_model""#))
        let payload = try JSONSerialization.jsonObject(with: URLProtocolStub.requestBodies()[0]) as? [String: Any]
        XCTAssertEqual((payload?["points"] as? [[Double]])?.count, 4)
        XCTAssertEqual(route.routeType, .loop)
        XCTAssertEqual(route.planningMetadata?.seed, 47)
    }

    @MainActor
    func testLiveLoopTitleUsesActualDistanceAndRetainsRequestedTarget() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.loopRouteResponseData(
                        distanceMeters: 12_200,
                        timeMilliseconds: 10_800_000
                    )
                )
            ]
        )
        let client = try makeClient()
        let request = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )

        let route = try await client.calculateRoundTripRoute(
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            request: request,
            seed: 11
        )

        XCTAssertEqual(route.title, "12.2 km Hike loop around Ilsenburg")
        XCTAssertEqual(route.distanceKilometers, 12.2, accuracy: 0.001)
        XCTAssertEqual(route.planningMetadata?.targetDistanceKm, 15)
        XCTAssertEqual(
            route.planningMetadata?.distanceNote(actualDistanceKm: route.distanceKilometers),
            "Closest available mapped loop to your 15 km request."
        )
    }

    @MainActor
    func testRoundTripVariantsUseSeedsPreserveValidRoutesAndRankByDistance() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 200, data: try Self.loopRouteResponseData(distanceMeters: 20_000, timeMilliseconds: 18_000_000)),
                .init(statusCode: 200, data: try Self.loopRouteResponseData(distanceMeters: 14_700, timeMilliseconds: 13_500_000)),
                .init(statusCode: 200, data: try Self.loopRouteResponseData(distanceMeters: 9_800, timeMilliseconds: 9_000_000))
            ]
        )
        let client = try makeClient()
        let planningRequest = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )

        let routes = try await client.calculateRoundTripRouteVariants(
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            request: planningRequest,
            seeds: [11, 29, 47]
        )

        let bodies = URLProtocolStub.requestBodies().compactMap { String(data: $0, encoding: .utf8) }
        XCTAssertEqual(bodies.count, 3)
        XCTAssertTrue(bodies[0].contains(#""round_trip.seed":11"#))
        XCTAssertTrue(bodies[1].contains(#""round_trip.seed":29"#))
        XCTAssertTrue(bodies[2].contains(#""round_trip.seed":47"#))
        XCTAssertEqual(routes.map(\.distanceKilometers), [14.7, 20.0, 9.8])
        XCTAssertEqual(routes.map { $0.planningMetadata?.seed }, [29, 11, 47])
        XCTAssertEqual(routes.map { $0.planningMetadata?.variantLabel }, ["Closest Match", "Longer Loop", "Shorter Loop"])
    }

    @MainActor
    func testMajorRoadAvoidanceBreaksOnlyNearLoopRankingTies() async throws {
        let lowRoadDetails = #"{"road_class":[[0,3,"footway"]]}"#
        let highRoadDetails = #"{"road_class":[[0,3,"primary"]]}"#
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 200, data: try Self.loopRouteResponseData(distanceMeters: 14_800, timeMilliseconds: 13_500_000, detailsJSON: lowRoadDetails)),
                .init(statusCode: 200, data: try Self.loopRouteResponseData(distanceMeters: 15_100, timeMilliseconds: 13_500_000, detailsJSON: highRoadDetails))
            ]
        )
        let client = try makeClient()
        let request = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: [.majorRoads]
        )

        let routes = try await client.calculateRoundTripRouteVariants(
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            request: request,
            seeds: [11, 29]
        )

        XCTAssertEqual(routes.map(\.distanceKilometers), [14.8, 15.1])
    }

    @MainActor
    func testMajorRoadAvoidanceDoesNotOverrideMateriallyBetterDistanceMatch() async throws {
        let highRoadDetails = #"{"road_class":[[0,3,"primary"]]}"#
        let lowRoadDetails = #"{"road_class":[[0,3,"footway"]]}"#
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 200, data: try Self.loopRouteResponseData(distanceMeters: 14_900, timeMilliseconds: 13_500_000, detailsJSON: highRoadDetails)),
                .init(statusCode: 200, data: try Self.loopRouteResponseData(distanceMeters: 15_700, timeMilliseconds: 13_500_000, detailsJSON: lowRoadDetails))
            ]
        )
        let client = try makeClient()
        let request = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: [],
            avoidFeatures: [.majorRoads]
        )

        let routes = try await client.calculateRoundTripRouteVariants(
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            request: request,
            seeds: [11, 29]
        )

        XCTAssertEqual(routes.map(\.distanceKilometers), [14.9, 15.7])
    }

    @MainActor
    func testRoundTripSingleRouteStillWorks() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 200, data: try Self.loopRouteResponseData(distanceMeters: 14_900, timeMilliseconds: 13_500_000))
            ]
        )
        let client = try makeClient()
        let planningRequest = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )

        let route = try await client.calculateRoundTripRoute(
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            request: planningRequest,
            seed: 11
        )

        XCTAssertEqual(route.distanceKilometers, 14.9, accuracy: 0.01)
        XCTAssertEqual(route.planningMetadata?.seed, 11)
        XCTAssertEqual(route.planningMetadata?.variantLabel, "Closest Match")
    }

    @MainActor
    func testRoundTripFailedSeedDoesNotFailWholeVariantRequest() async throws {
        let errorData = Data(#"{"message":"round trip failed","hints":[]}"#.utf8)
        URLProtocolStub.reset(
            responses: [
                .init(statusCode: 400, data: errorData),
                .init(statusCode: 200, data: try Self.loopRouteResponseData(distanceMeters: 15_100, timeMilliseconds: 13_500_000)),
                .init(statusCode: 400, data: errorData)
            ]
        )
        let client = try makeClient()
        let planningRequest = RoutePlanningRequest(
            routeType: .loop,
            startQuery: "Ilsenburg",
            endQuery: nil,
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: 15,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )

        let routes = try await client.calculateRoundTripRouteVariants(
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            request: planningRequest,
            seeds: [11, 29, 47]
        )

        XCTAssertEqual(routes.count, 1)
        let route = try XCTUnwrap(routes.first)
        XCTAssertEqual(route.distanceKilometers, 15.1, accuracy: 0.01)
        XCTAssertEqual(routes.first?.planningMetadata?.seed, 29)
        XCTAssertEqual(routes.first?.planningMetadata?.variantLabel, "Closest Match")
        XCTAssertEqual(URLProtocolStub.requestBodies().count, 3)
    }

    @MainActor
    private func makeClient() throws -> GraphHopperClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        return GraphHopperClient(
            session: session,
            configurationProvider: {
                try GraphHopperConfiguration(
                    apiKey: "test-key",
                    baseURL: URL(string: "https://example.com/api/1")!
                )
            }
        )
    }

    private static func routeResponseData(
        distanceMeters: Int,
        timeMilliseconds: Int
    ) throws -> Data {
        try routeResponseData(
            paths: [
                (distanceMeters: distanceMeters, timeMilliseconds: timeMilliseconds)
            ]
        )
    }

    private static func routeResponseData(
        paths: [(distanceMeters: Int, timeMilliseconds: Int)]
    ) throws -> Data {
        let pathPayload = paths.map { path in
            """
            {
              "distance": \(path.distanceMeters),
              "time": \(path.timeMilliseconds),
              "ascend": 667,
              "descend": 120,
              "points": {
                "type": "LineString",
                "coordinates": [
                  [10.6782, 51.8666, 250],
                  [10.6700, 51.8200, 420],
                  [10.6647, 51.7636, 600]
                ]
              },
              "instructions": [
                {
                  "text": "Geradeaus",
                  "street_name": "",
                  "distance": \(path.distanceMeters),
                  "time": \(path.timeMilliseconds),
                  "interval": [0, 2],
                  "sign": 0
                }
              ]
            }
            """
        }
        .joined(separator: ",")

        let json = """
        {
          "paths": [
            \(pathPayload)
          ]
        }
        """
        return Data(json.utf8)
    }

    private static func routeResponseWithDetailsData(
        coordinates: String = "[0, 0, 0], [0.01, 0, 0], [0.03, 0, 0]",
        detailsJSON: String = #"""
        {
          "surface": [[0, 1, "asphalt"], [1, 2, "gravel"]],
          "road_class": [[0, 1, "primary"], [1, 2, "footway"]],
          "hike_rating": [[0, 1, 1], [1, 2, 2]]
        }
        """#
    ) throws -> Data {
        let json = """
        {
          "paths": [
            {
              "distance": 3335,
              "time": 2400000,
              "ascend": 20,
              "descend": 20,
              "points": {
                "type": "LineString",
                "coordinates": [\(coordinates)]
              },
              "details": \(detailsJSON),
              "instructions": []
            }
          ]
        }
        """
        return Data(json.utf8)
    }

    private static func loopRouteResponseData(
        distanceMeters: Int,
        timeMilliseconds: Int,
        detailsJSON: String? = nil
    ) throws -> Data {
        let detailsPayload = detailsJSON.map { ",\n              \"details\": \($0)" } ?? ""
        let json = """
        {
          "paths": [
            {
              "distance": \(distanceMeters),
              "time": \(timeMilliseconds),
              "ascend": 400,
              "descend": 390,
              "points": {
                "type": "LineString",
                "coordinates": [
                  [10.6782, 51.8666, 250],
                  [10.6900, 51.8400, 420],
                  [10.6600, 51.8200, 500],
                  [10.6784, 51.8664, 255]
                ]
              },
              "instructions": [
                {
                  "text": "Loop starten",
                  "street_name": "",
                  "distance": \(distanceMeters),
                  "time": \(timeMilliseconds),
                  "interval": [0, 3],
                  "sign": 0
                }
              ]\(detailsPayload)
            }
          ]
        }
        """
        return Data(json.utf8)
    }
}

private final class URLProtocolStub: URLProtocol {
    struct Response {
        let statusCode: Int
        let data: Data
    }

    private static let lock = NSLock()
    private nonisolated(unsafe) static var responses: [Response] = []
    private nonisolated(unsafe) static var bodies: [Data] = []

    static func reset(responses newResponses: [Response]) {
        lock.lock()
        responses = newResponses
        bodies = []
        lock.unlock()
    }

    static func requestBodies() -> [Data] {
        lock.lock()
        let value = bodies
        lock.unlock()
        return value
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let body = request.httpBody ?? Self.readBodyStream(request.httpBodyStream)

        Self.lock.lock()
        Self.bodies.append(body)
        let response = Self.responses.isEmpty
            ? Response(statusCode: 500, data: Data(#"{"message":"missing test response"}"#.utf8))
            : Self.responses.removeFirst()
        Self.lock.unlock()

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

    override func stopLoading() {}

    private static func readBodyStream(_ stream: InputStream?) -> Data {
        guard let stream else { return Data() }
        stream.open()
        defer { stream.close() }

        var data = Data()
        let bufferSize = 1_024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        while stream.hasBytesAvailable {
            let count = stream.read(buffer, maxLength: bufferSize)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
