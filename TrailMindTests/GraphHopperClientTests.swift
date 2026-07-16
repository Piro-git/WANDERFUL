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
        guard case let .routed(provenance) = route.provenance else {
            return XCTFail("Point-to-point GraphHopper output must be explicitly routed.")
        }
        XCTAssertEqual(provenance.provider, .graphHopper)
        XCTAssertEqual(provenance.strategy, .directGraphHopper)
        XCTAssertTrue(route.isVerifiedRoutedResult)
    }

    @MainActor
    func testRequestedEasyDoesNotOverrideChallengingReturnedFacts() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseData(
                        distanceMeters: 20_000,
                        timeMilliseconds: 18_000_000
                    )
                )
            ]
        )
        let client = try makeClient()
        let request = RoutePlanningRequest(
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: nil,
            targetDurationMinutes: nil,
            difficulty: .easy,
            desiredFeatures: [],
            avoidFeatures: [.steepClimbs]
        )

        let route = try await client.calculateGraphHopperRoute(
            request: request,
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            end: Coordinate(latitude: 51.7636, longitude: 10.6647)
        )

        XCTAssertEqual(route.difficulty, .challenging)
        XCTAssertEqual(route.planningMetadata?.difficulty, .easy)
        XCTAssertEqual(route.planningMetadata?.requestedDifficultySummary, "Requested: Easy")
        XCTAssertTrue(route.isVerifiedRoutedResult)
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
    func testNullAndUnknownDetailsRemainRepresentable() async throws {
        let details = #"""
        {
          "surface": [[0, 1, "asphalt"], [1, 2, null], [2, 3, "volcanic_glass"]],
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
    func testFlexibleModeFailureFallsBackToNormalRouteRequest() async throws {
        let errorData = Data(#"{"message":"Free packages cannot use flexible mode","hints":[]}"#.utf8)
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
    func testPointToPointRequestBodyKeepsExactCoordinateAndProfileContract() async throws {
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
        _ = try await client.calculateGraphHopperRoute(
            request: RoutePlanningRequest(
                startQuery: "Ilsenburg",
                endQuery: "Schierke",
                activityType: .hiking,
                graphHopperProfile: "foot",
                targetDistanceKm: nil,
                targetDurationMinutes: nil,
                difficulty: nil,
                desiredFeatures: []
            ),
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            end: Coordinate(latitude: 51.7636, longitude: 10.6647)
        )

        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: URLProtocolStub.requestBodies()[0]) as? [String: Any]
        )
        let expected: [String: Any] = [
            "profile": "foot",
            "points": [[10.6782, 51.8666], [10.6647, 51.7636]],
            "locale": "de",
            "elevation": true,
            "points_encoded": false,
            "instructions": true,
            "details": ["surface", "road_class", "hike_rating"],
            "ch.disable": true,
            "custom_model": [
                "priority": [
                    ["if": "road_class == PRIMARY", "multiply_by": "0.85"],
                    ["if": "road_class == SECONDARY", "multiply_by": "0.9"]
                ]
            ]
        ]
        XCTAssertEqual(payload as NSDictionary, expected as NSDictionary)
    }

    @MainActor
    func testLegacySingleRouteCalculatorGetsSafeVariantCompatibilityDefault() async throws {
        let expected = TestRouteFixtures.luneburgLoop
        let calculator: any GraphHopperRouteCalculating = LegacySingleRouteCalculator(route: expected)

        let routes = try await calculator.calculatePointToPointRouteVariants(
            request: Self.pointToPointRequest(targetDistanceKm: 15),
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            end: Coordinate(latitude: 51.7636, longitude: 10.6647)
        )

        XCTAssertEqual(routes.map(\.id), [expected.id])
    }

    @MainActor
    func testPointToPointVariantsExposeOneTwoAndThreePathsInProviderOrder() async throws {
        let cases: [[(distanceMeters: Int, timeMilliseconds: Int)]] = [
            [(distanceMeters: 12_000, timeMilliseconds: 9_000_000)],
            [
                (distanceMeters: 18_000, timeMilliseconds: 13_000_000),
                (distanceMeters: 11_500, timeMilliseconds: 8_500_000)
            ],
            [
                (distanceMeters: 22_000, timeMilliseconds: 18_000_000),
                (distanceMeters: 14_600, timeMilliseconds: 13_200_000),
                (distanceMeters: 10_000, timeMilliseconds: 9_000_000)
            ]
        ]

        for paths in cases {
            URLProtocolStub.reset(
                responses: [
                    .init(statusCode: 200, data: try Self.routeResponseData(paths: paths))
                ]
            )

            let routes = try await makeClient().calculatePointToPointRouteVariants(
                request: Self.pointToPointRequest(targetDistanceKm: 15),
                start: Coordinate(latitude: 51.8666, longitude: 10.6782),
                end: Coordinate(latitude: 51.7636, longitude: 10.6647)
            )

            XCTAssertEqual(
                routes.map(\.distanceKilometers),
                paths.map { Double($0.distanceMeters) / 1_000 }
            )
            XCTAssertTrue(routes.allSatisfy {
                $0.path.compactMap(\.elevationMeters) == [250, 420, 600]
                    && $0.routeInstructions.count == 1
            })
            XCTAssertTrue(routes.allSatisfy { route in
                guard case let .routed(provenance) = route.provenance else { return false }
                return provenance.provider == .graphHopper
                    && provenance.strategy == .directGraphHopper
                    && route.isVerifiedRoutedResult
            })
        }
    }

    @MainActor
    func testLegacySingleRouteWithoutTargetKeepsFirstProviderPath() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseData(
                        paths: [
                            (distanceMeters: 22_000, timeMilliseconds: 18_000_000),
                            (distanceMeters: 11_000, timeMilliseconds: 9_000_000)
                        ]
                    )
                )
            ]
        )

        let route = try await makeClient().calculateGraphHopperRoute(
            request: Self.pointToPointRequest(targetDistanceKm: nil),
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            end: Coordinate(latitude: 51.7636, longitude: 10.6647)
        )

        XCTAssertEqual(route.distanceKilometers, 22)
    }

    @MainActor
    func testPointToPointVariantsRejectWholeEnvelopeWhenOneAlternativeIsInvalid() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseData(
                        paths: [
                            (distanceMeters: 12_000, timeMilliseconds: 9_000_000),
                            (distanceMeters: 5, timeMilliseconds: 1_000)
                        ]
                    )
                )
            ]
        )

        do {
            _ = try await makeClient().calculatePointToPointRouteVariants(
                request: Self.pointToPointRequest(targetDistanceKm: 15),
                start: Coordinate(latitude: 51.8666, longitude: 10.6782),
                end: Coordinate(latitude: 51.7636, longitude: 10.6647)
            )
            XCTFail("An invalid alternative must reject the complete provider envelope.")
        } catch GraphHopperError.noRouteFound {
            // Existing too-short path contract, applied strictly to every path.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    @MainActor
    func testPointToPointVariantsRejectWholeEnvelopeWhenOneAlternativeIsMalformed() async throws {
        let response = Data(
            #"""
            {
              "paths": [
                {
                  "distance": 12000,
                  "time": 9000000,
                  "ascend": 300,
                  "descend": 250,
                  "points": {
                    "type": "LineString",
                    "coordinates": [[10.6782, 51.8666], [10.6700, 51.8200], [10.6647, 51.7636]]
                  },
                  "instructions": []
                },
                {
                  "distance": 14000,
                  "time": 10000000,
                  "ascend": 320,
                  "descend": 270,
                  "points": {
                    "type": "LineString",
                    "coordinates": [[10.6782, 51.8666], [10.6782, 51.8666]]
                  },
                  "instructions": []
                }
              ]
            }
            """#.utf8
        )
        URLProtocolStub.reset(responses: [.init(statusCode: 200, data: response)])

        do {
            _ = try await makeClient().calculatePointToPointRouteVariants(
                request: Self.pointToPointRequest(targetDistanceKm: 15),
                start: Coordinate(latitude: 51.8666, longitude: 10.6782),
                end: Coordinate(latitude: 51.7636, longitude: 10.6647)
            )
            XCTFail("A malformed alternative must reject the complete provider envelope.")
        } catch GraphHopperError.invalidResponse {
            // Strict decoder validates every alternative before exposing any.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    @MainActor
    func testPointToPointVariantsPreserveFallbackPathsAndFallbackMetadata() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 400,
                    data: Data(#"{"message":"flexible mode unavailable","hints":[]}"#.utf8)
                ),
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseData(
                        paths: [
                            (distanceMeters: 16_000, timeMilliseconds: 12_000_000),
                            (distanceMeters: 13_000, timeMilliseconds: 10_000_000)
                        ]
                    )
                )
            ]
        )

        let routes = try await makeClient().calculatePointToPointRouteVariants(
            request: Self.pointToPointRequest(targetDistanceKm: 15),
            start: Coordinate(latitude: 51.8666, longitude: 10.6782),
            end: Coordinate(latitude: 51.7636, longitude: 10.6647)
        )

        XCTAssertEqual(routes.map(\.distanceKilometers), [16, 13])
        XCTAssertTrue(routes.allSatisfy {
            $0.planningMetadata?.routeShapingSummary?.applied == [.activityProfile]
                && $0.planningMetadata?.routeShapingSummary?.requestedOnly == [.targetDistance]
        })
        let bodies = URLProtocolStub.requestBodies()
        XCTAssertEqual(bodies.count, 2)
        XCTAssertTrue(String(decoding: bodies[0], as: UTF8.self).contains(#""algorithm":"alternative_route""#))
        XCTAssertFalse(String(decoding: bodies[1], as: UTF8.self).contains(#""algorithm":"alternative_route""#))
    }

    @MainActor
    func testPointToPointVariantsRespectProviderPathLimit() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseData(
                        paths: [
                            (distanceMeters: 12_000, timeMilliseconds: 9_000_000),
                            (distanceMeters: 13_000, timeMilliseconds: 10_000_000),
                            (distanceMeters: 14_000, timeMilliseconds: 11_000_000)
                        ]
                    )
                )
            ]
        )

        do {
            _ = try await makeClient(
                limits: Self.testLimits(maximumPaths: 2)
            ).calculatePointToPointRouteVariants(
                request: Self.pointToPointRequest(targetDistanceKm: 15),
                start: Coordinate(latitude: 51.8666, longitude: 10.6782),
                end: Coordinate(latitude: 51.7636, longitude: 10.6647)
            )
            XCTFail("The variants API must retain the provider path ceiling.")
        } catch GraphHopperError.invalidResponse {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
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
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: URLProtocolStub.requestBodies()[0]) as? [String: Any]
        )
        XCTAssertEqual(payload["algorithm"] as? String, "alternative_route")
        XCTAssertEqual(payload["alternative_route.max_paths"] as? Int, 3)
        XCTAssertEqual(payload["alternative_route.max_weight_factor"] as? Double, 1.4)
        XCTAssertEqual(payload["alternative_route.max_share_factor"] as? Double, 0.65)
        XCTAssertEqual(payload["ch.disable"] as? Bool, true)
        XCTAssertNil(payload["round_trip.distance"])
        XCTAssertNil(payload["round_trip.seed"])
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
        XCTAssertEqual(payload?["profile"] as? String, "foot")
        XCTAssertEqual(payload?["points"] as? [[Double]], [[10.6782, 51.8666]])
        XCTAssertEqual(payload?["locale"] as? String, "de")
        XCTAssertEqual(payload?["elevation"] as? Bool, true)
        XCTAssertEqual(payload?["points_encoded"] as? Bool, false)
        XCTAssertEqual(payload?["instructions"] as? Bool, true)
        XCTAssertEqual(payload?["details"] as? [String], ["surface", "road_class", "hike_rating"])
        XCTAssertNil(payload?["custom_model"])
        XCTAssertNil(payload?["alternative_route.max_paths"])
        XCTAssertEqual(route.routeType, .loop)
        XCTAssertEqual(route.title, "15.2 km Hike loop around Ilsenburg")
        XCTAssertEqual(route.planningMetadata?.routeType, .loop)
        XCTAssertEqual(route.planningMetadata?.targetDistanceKm, 15)
        guard case let .routed(provenance) = route.provenance else {
            return XCTFail("Round-trip GraphHopper output must be explicitly routed.")
        }
        XCTAssertEqual(provenance.provider, .graphHopper)
        XCTAssertEqual(provenance.strategy, .directGraphHopper)
        XCTAssertTrue(route.isVerifiedRoutedResult)
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
        XCTAssertEqual(payload?["profile"] as? String, "foot")
        XCTAssertEqual(
            payload?["points"] as? [[Double]],
            [
                [10.6782, 51.8666],
                [10.72, 51.89],
                [10.71, 51.84],
                [10.6782, 51.8666]
            ]
        )
        XCTAssertEqual(payload?["locale"] as? String, "de")
        XCTAssertEqual(payload?["elevation"] as? Bool, true)
        XCTAssertEqual(payload?["points_encoded"] as? Bool, false)
        XCTAssertEqual(payload?["instructions"] as? Bool, true)
        XCTAssertEqual(payload?["details"] as? [String], ["surface", "road_class", "hike_rating"])
        XCTAssertEqual(
            Set(payload?.keys.map { $0 } ?? []),
            Set(["profile", "points", "locale", "elevation", "points_encoded", "instructions", "details"])
        )
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
    func testZeroPathsFailsAsNoRoute() async throws {
        URLProtocolStub.reset(
            responses: [.init(statusCode: 200, data: Data(#"{"paths":[]}"#.utf8))]
        )

        do {
            _ = try await calculateStandardRoute(using: makeClient())
            XCTFail("An empty provider result must not become a route.")
        } catch GraphHopperError.noRouteFound {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    @MainActor
    func testMalformedJSONAndStructuredPayloadsFailClosed() async throws {
        let payloads = [
            Data(#"{"paths":["#.utf8),
            Data(#"{"paths":[{"distance":1000,"time":1000,"points":"not-geometry"}]}"#.utf8)
        ]

        for payload in payloads {
            URLProtocolStub.reset(responses: [.init(statusCode: 200, data: payload)])
            do {
                _ = try await calculateStandardRoute(using: makeClient())
                XCTFail("Malformed provider data must fail closed.")
            } catch let error as GraphHopperError {
                switch error {
                case .decoding, .invalidResponse:
                    break
                default:
                    XCTFail("Unexpected GraphHopper error: \(error)")
                }
            }
        }
    }

    @MainActor
    func testMalformedOutOfRangeAndDegenerateCoordinatesFailClosed() async throws {
        let coordinatePayloads = [
            "[10.6], [10.7, 51.7]",
            "[181, 51.8], [10.7, 51.7]",
            "[10.6, 91], [10.7, 51.7]",
            "[10.6, 51.8, 200, 1], [10.7, 51.7, 210]",
            "[10.6, 51.8], [10.6, 51.8]"
        ]

        for coordinates in coordinatePayloads {
            URLProtocolStub.reset(
                responses: [
                    .init(
                        statusCode: 200,
                        data: try Self.routeResponseWithDetailsData(
                            coordinates: coordinates,
                            detailsJSON: "{}"
                        )
                    )
                ]
            )
            do {
                _ = try await calculateStandardRoute(using: makeClient())
                XCTFail("Invalid coordinates must not be discarded into a successful route.")
            } catch GraphHopperError.invalidResponse {
                // Expected.
            } catch {
                XCTFail("Unexpected error: \(error)")
            }
        }
    }

    @MainActor
    func testInvalidMetricsFailClosed() async throws {
        let payloads = [
            Self.customRouteResponseData(distance: "0", time: "1000", ascend: "10", descend: "10"),
            Self.customRouteResponseData(distance: "1000", time: "0", ascend: "10", descend: "10"),
            Self.customRouteResponseData(distance: "1000", time: "1000", ascend: "-1", descend: "10"),
            Self.customRouteResponseData(distance: "1000", time: "1000", ascend: "10", descend: "-1"),
            Self.customRouteResponseData(
                distance: "1000",
                time: "1000",
                ascend: "9223372036854775808",
                descend: "10"
            )
        ]

        for payload in payloads {
            URLProtocolStub.reset(responses: [.init(statusCode: 200, data: payload)])
            do {
                _ = try await calculateStandardRoute(using: makeClient())
                XCTFail("Invalid route metrics must fail closed.")
            } catch GraphHopperError.invalidResponse {
                // Expected.
            } catch {
                XCTFail("Unexpected error: \(error)")
            }
        }
    }

    @MainActor
    func testStructuralCeilingsRejectExcessiveCollections() async throws {
        let cases: [(Data, RouteTransportLimits)] = [
            (
                try Self.routeResponseData(paths: [
                    (distanceMeters: 1_000, timeMilliseconds: 1_000),
                    (distanceMeters: 1_100, timeMilliseconds: 1_100),
                    (distanceMeters: 1_200, timeMilliseconds: 1_200)
                ]),
                Self.testLimits(maximumPaths: 2)
            ),
            (
                try Self.routeResponseData(distanceMeters: 1_000, timeMilliseconds: 1_000),
                Self.testLimits(maximumCoordinatesPerPath: 2)
            ),
            (
                try Self.routeResponseData(distanceMeters: 1_000, timeMilliseconds: 1_000),
                Self.testLimits(maximumInstructionsPerPath: 0)
            ),
            (
                try Self.routeResponseWithDetailsData(
                    detailsJSON: #"{"surface":[[0,1,"asphalt"],[1,2,"gravel"]]}"#
                ),
                Self.testLimits(maximumPathDetailsPerPath: 1)
            )
        ]

        for (payload, limits) in cases {
            URLProtocolStub.reset(responses: [.init(statusCode: 200, data: payload)])
            do {
                _ = try await calculateStandardRoute(using: makeClient(limits: limits))
                XCTFail("A structural ceiling must fail closed.")
            } catch GraphHopperError.invalidResponse {
                // Expected.
            } catch {
                XCTFail("Unexpected error: \(error)")
            }
        }
    }

    @MainActor
    func testMalformedAndOutOfRangePathDetailsFailClosed() async throws {
        let repeatedOverlappingIntervals = Array(
            repeating: #"[0,2,"asphalt"]"#,
            count: 512
        ).joined(separator: ",")
        let detailsPayloads = [
            #"{"surface":[["broken"]]}"#,
            #"{"surface":[[-1,1,"asphalt"]]}"#,
            #"{"surface":[[0,99,"asphalt"]]}"#,
            #"{"surface":[[2,1,"asphalt"]]}"#,
            "{\"surface\":[\(repeatedOverlappingIntervals)]}"
        ]

        for details in detailsPayloads {
            URLProtocolStub.reset(
                responses: [
                    .init(
                        statusCode: 200,
                        data: try Self.routeResponseWithDetailsData(detailsJSON: details)
                    )
                ]
            )
            do {
                _ = try await calculateStandardRoute(using: makeClient())
                XCTFail("Malformed path details must fail closed.")
            } catch let error as GraphHopperError {
                switch error {
                case .decoding, .invalidResponse:
                    break
                default:
                    XCTFail("Unexpected GraphHopper error: \(error)")
                }
            }
        }
    }

    @MainActor
    func testUnrepresentableIntegralPathDetailCannotCrashOrBecomeVerifiedData() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseWithDetailsData(
                        detailsJSON: #"{"hike_rating":[[0,2,9223372036854775808]]}"#
                    )
                )
            ]
        )

        let route = try await calculateStandardRoute(using: makeClient())

        XCTAssertNil(route.verifiedCharacteristics)
        XCTAssertTrue(route.isVerifiedRoutedResult)
    }

    @MainActor
    func testThreeDimensionalCoordinatesProvideElevationFallback() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: Self.customRouteResponseData(
                        distance: "2500",
                        time: "1800000",
                        ascend: nil,
                        descend: nil,
                        coordinates: "[10.6,51.8,100],[10.65,51.75,150],[10.7,51.7,120]"
                    )
                )
            ]
        )

        let route = try await calculateStandardRoute(using: makeClient())

        XCTAssertEqual(route.elevationGainMeters, 50)
        XCTAssertEqual(route.elevationLossMeters, 30)
        XCTAssertEqual(route.path.compactMap(\.elevationMeters), [100, 150, 120])
        XCTAssertTrue(route.isVerifiedRoutedResult)
    }

    @MainActor
    func testAdvertisedOversizedResponseFailsBeforeDecode() async throws {
        let limits = Self.testLimits(maximumSuccessBodyBytes: 512)
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: Data(#"{"paths":[]}"#.utf8),
                    headerFields: ["Content-Length": "513"]
                )
            ]
        )

        try await assertOversizedFailure(using: makeClient(limits: limits))
    }

    @MainActor
    func testStreamedOversizedResponseWithoutContentLengthFailsOnActualBytes() async throws {
        let limits = Self.testLimits(maximumSuccessBodyBytes: 512)
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: Data(repeating: 0x20, count: 513),
                    chunkSize: 31
                )
            ]
        )

        try await assertOversizedFailure(using: makeClient(limits: limits))
    }

    @MainActor
    func testMisleadingSmallContentLengthCannotBypassActualByteLimit() async throws {
        let limits = Self.testLimits(maximumSuccessBodyBytes: 512)
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: Data(repeating: 0x20, count: 513),
                    headerFields: ["Content-Length": "16"],
                    chunkSize: 29
                )
            ]
        )

        try await assertOversizedFailure(using: makeClient(limits: limits))
    }

    @MainActor
    func testGenericAuthenticationRateLimitAndNoRouteErrorsDoNotRetryFlexibleMode() async throws {
        let errors = [
            GraphHopperError.api(statusCode: 401, message: "flexible mode unavailable", hints: []),
            GraphHopperError.api(statusCode: 429, message: "flexible mode unavailable", hints: []),
            GraphHopperError.api(statusCode: 400, message: "custom model rejected", hints: []),
            GraphHopperError.api(statusCode: 400, message: "no route found", hints: []),
            GraphHopperError.api(statusCode: 400, message: "cannot find a route in flexible mode", hints: [])
        ]
        XCTAssertTrue(errors.allSatisfy { !$0.isFlexibleModeUnavailable })

        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 400,
                    data: Data(#"{"message":"custom model rejected","hints":[]}"#.utf8)
                )
            ]
        )
        do {
            _ = try await calculateStandardRoute(using: makeClient())
            XCTFail("A generic API rejection must not retry without flexible parameters.")
        } catch let error as GraphHopperError {
            guard case .api = error else { return XCTFail("Unexpected error: \(error)") }
        }
        XCTAssertEqual(URLProtocolStub.requestBodies().count, 1)
    }

    @MainActor
    func testTimeoutFailsSafelyWithoutFallbackRetry() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 0,
                    data: Data(),
                    failureCode: .timedOut
                )
            ]
        )

        do {
            _ = try await calculateStandardRoute(using: makeClient())
            XCTFail("A timed-out request must fail.")
        } catch let error as GraphHopperError {
            guard case let .network(message) = error else {
                return XCTFail("Unexpected error: \(error)")
            }
            XCTAssertTrue(message.localizedCaseInsensitiveContains("timed out"))
        }
        XCTAssertEqual(URLProtocolStub.requestBodies().count, 1)
    }

    @MainActor
    func testCallerCancellationStopsTransportAndLateResponseCannotSucceed() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseData(distanceMeters: 1_000, timeMilliseconds: 1_000),
                    delay: 0.2,
                    deliversAfterStop: true
                )
            ]
        )
        let client = try makeClient()
        let task = Task { try await self.calculateStandardRoute(using: client) }
        try await Task.sleep(for: .milliseconds(30))
        task.cancel()

        do {
            _ = try await task.value
            XCTFail("Cancellation must not become a late route success.")
        } catch is CancellationError {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        try await Task.sleep(for: .milliseconds(250))
        XCTAssertGreaterThanOrEqual(URLProtocolStub.stopLoadingCount(), 1)
    }

    @MainActor
    func testPointToPointVariantsCancellationStopsTransportAndRejectsLateSuccess() async throws {
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 200,
                    data: try Self.routeResponseData(
                        paths: [
                            (distanceMeters: 12_000, timeMilliseconds: 9_000_000),
                            (distanceMeters: 14_000, timeMilliseconds: 10_000_000)
                        ]
                    ),
                    delay: 0.2,
                    deliversAfterStop: true
                )
            ]
        )
        let client = try makeClient()
        let task = Task {
            try await client.calculatePointToPointRouteVariants(
                request: Self.pointToPointRequest(targetDistanceKm: 15),
                start: Coordinate(latitude: 51.8666, longitude: 10.6782),
                end: Coordinate(latitude: 51.7636, longitude: 10.6647)
            )
        }
        try await Task.sleep(for: .milliseconds(30))
        task.cancel()

        do {
            _ = try await task.value
            XCTFail("Variants cancellation must not become a late route success.")
        } catch is CancellationError {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        try await Task.sleep(for: .milliseconds(250))
        XCTAssertGreaterThanOrEqual(URLProtocolStub.stopLoadingCount(), 1)
    }

    @MainActor
    func testProviderBodyAndRequestSecretsAreNotReturnedInErrors() async throws {
        let sensitive = "provider-secret test-key exact-payload [10.6782,51.8666]"
        URLProtocolStub.reset(
            responses: [
                .init(
                    statusCode: 400,
                    data: Data("{\"message\":\"\(sensitive)\",\"hints\":[]}".utf8)
                )
            ]
        )

        do {
            _ = try await calculateStandardRoute(using: makeClient())
            XCTFail("The request must fail.")
        } catch let error as GraphHopperError {
            let description = error.localizedDescription
            XCTAssertFalse(description.contains(sensitive))
            XCTAssertFalse(description.contains("test-key"))
            if case let .api(_, message, hints) = error {
                XCTAssertFalse(message.contains(sensitive))
                XCTAssertTrue(hints.isEmpty)
            }
        }
    }

    @MainActor
    private func makeClient(
        limits: RouteTransportLimits = .standard
    ) throws -> GraphHopperClient {
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
            },
            limits: limits
        )
    }

    @MainActor
    private static func pointToPointRequest(
        targetDistanceKm: Double?
    ) -> RoutePlanningRequest {
        RoutePlanningRequest(
            routeType: .pointToPoint,
            startQuery: "Ilsenburg",
            endQuery: "Schierke",
            activityType: .hiking,
            graphHopperProfile: "foot",
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: nil,
            difficulty: nil,
            desiredFeatures: []
        )
    }

    @MainActor
    private func calculateStandardRoute(using client: GraphHopperClient) async throws -> TrailRoute {
        try await client.calculateGraphHopperRoute(
            request: RoutePlanningRequest(
                startQuery: "Start",
                endQuery: "Finish",
                activityType: .hiking,
                graphHopperProfile: "foot",
                targetDistanceKm: nil,
                targetDurationMinutes: nil,
                difficulty: nil,
                desiredFeatures: []
            ),
            start: Coordinate(latitude: 51.8, longitude: 10.6),
            end: Coordinate(latitude: 51.7, longitude: 10.7)
        )
    }

    @MainActor
    private func assertOversizedFailure(using client: GraphHopperClient) async {
        do {
            _ = try await calculateStandardRoute(using: client)
            XCTFail("An oversized response must fail closed.")
        } catch let error as GraphHopperError {
            guard case .decoding = error else {
                return XCTFail("Unexpected GraphHopper error: \(error)")
            }
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    private static func testLimits(
        maximumSuccessBodyBytes: Int = 1_024 * 1_024,
        maximumPaths: Int = 8,
        maximumCoordinatesPerPath: Int = 100_000,
        maximumInstructionsPerPath: Int = 25_000,
        maximumPathDetailsPerPath: Int = 100_000
    ) -> RouteTransportLimits {
        RouteTransportLimits(
            maximumSuccessBodyBytes: maximumSuccessBodyBytes,
            maximumErrorBodyBytes: 64 * 1_024,
            maximumPaths: maximumPaths,
            maximumCoordinatesPerPath: maximumCoordinatesPerPath,
            maximumInstructionsPerPath: maximumInstructionsPerPath,
            maximumPathDetailsPerPath: maximumPathDetailsPerPath,
            maximumAbsoluteElevationMeters: 100_000
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

    private static func customRouteResponseData(
        distance: String,
        time: String,
        ascend: String?,
        descend: String?,
        coordinates: String = "[10.6,51.8,200],[10.7,51.7,210]"
    ) -> Data {
        let ascendField = ascend.map { "\"ascend\":\($0)," } ?? ""
        let descendField = descend.map { "\"descend\":\($0)," } ?? ""
        return Data(
            """
            {
              "paths": [{
                "distance": \(distance),
                "time": \(time),
                \(ascendField)
                \(descendField)
                "points": {
                  "type": "LineString",
                  "coordinates": [\(coordinates)]
                },
                "instructions": []
              }]
            }
            """.utf8
        )
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

private struct LegacySingleRouteCalculator: GraphHopperRouteCalculating {
    let route: TrailRoute

    func calculateGraphHopperRoute(
        request: RoutePlanningRequest,
        start: Coordinate,
        end: Coordinate
    ) async throws -> TrailRoute {
        route
    }
}

final class URLProtocolStub: URLProtocol, @unchecked Sendable {
    struct Response: @unchecked Sendable {
        let statusCode: Int
        let chunks: [Data]
        let headerFields: [String: String]
        let delay: TimeInterval
        let failureCode: URLError.Code?
        let deliversAfterStop: Bool

        init(
            statusCode: Int,
            data: Data,
            headerFields: [String: String] = [:],
            chunkSize: Int? = nil,
            delay: TimeInterval = 0,
            failureCode: URLError.Code? = nil,
            deliversAfterStop: Bool = false
        ) {
            self.statusCode = statusCode
            if let chunkSize, chunkSize > 0 {
                chunks = stride(from: 0, to: data.count, by: chunkSize).map { offset in
                    data.subdata(in: offset..<min(offset + chunkSize, data.count))
                }
            } else {
                chunks = [data]
            }
            self.headerFields = headerFields
            self.delay = delay
            self.failureCode = failureCode
            self.deliversAfterStop = deliversAfterStop
        }
    }

    private static let lock = NSLock()
    private nonisolated(unsafe) static var responses: [Response] = []
    private nonisolated(unsafe) static var bodies: [Data] = []
    private nonisolated(unsafe) static var stops = 0
    private let stateLock = NSLock()
    private var stopped = false

    static func reset(responses newResponses: [Response]) {
        lock.lock()
        responses = newResponses
        bodies = []
        stops = 0
        lock.unlock()
    }

    static func requestBodies() -> [Data] {
        lock.lock()
        let value = bodies
        lock.unlock()
        return value
    }

    static func stopLoadingCount() -> Int {
        lock.lock()
        let value = stops
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

        let deliver: @Sendable () -> Void = { [weak self] in
            self?.deliver(response)
        }
        if response.delay > 0 {
            DispatchQueue.global().asyncAfter(
                deadline: .now() + response.delay,
                execute: deliver
            )
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

        if let failureCode = response.failureCode {
            client?.urlProtocol(self, didFailWithError: URLError(failureCode))
            return
        }
        let httpResponse = HTTPURLResponse(
            url: request.url!,
            statusCode: response.statusCode,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"].merging(
                response.headerFields,
                uniquingKeysWith: { _, new in new }
            )
        )!
        client?.urlProtocol(self, didReceive: httpResponse, cacheStoragePolicy: .notAllowed)
        for chunk in response.chunks {
            client?.urlProtocol(self, didLoad: chunk)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

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
