import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class HikingPreferenceProfileResolverTests: XCTestCase {
    private let resolver = HikingProfileDefaultResolverV1()

    func testExplicitRequestWinsOverProfileAndEngineFallbackForEveryField() throws {
        let profile = makeProfile(
            activity: .hiking,
            comfort: .distanceKilometers(minimum: 10, maximum: 15),
            shape: .loop,
            experiences: [.forest],
            avoidances: [.steepClimbs]
        )
        let explicit = HikingExplicitRouteRequestV1(
            activity: .specified(.trailRunning),
            comfortableOuting: .specified(.durationMinutes(minimum: 90, maximum: 120)),
            routeShape: .specified(.pointToPoint),
            requestedExperiences: .specified([.viewpoints]),
            softAvoidances: .specified([.majorRoads])
        )
        let fallback = HikingProfileEngineFallbacksV1(
            activity: .biking,
            comfortableOuting: .distanceKilometers(minimum: 25, maximum: 25),
            routeShape: .loop,
            requestedExperiences: [.quietNature],
            softAvoidances: [.repeatedSections]
        )

        let result = try resolver.resolve(
            explicitRequest: explicit,
            profile: profile,
            engineFallbacks: fallback
        )

        XCTAssertEqual(result.activity, resolved(.trailRunning, .explicitRequest))
        XCTAssertEqual(
            result.comfortableOuting,
            resolved(.durationMinutes(minimum: 90, maximum: 120), .explicitRequest)
        )
        XCTAssertEqual(result.routeShape, resolved(.pointToPoint, .explicitRequest))
        XCTAssertEqual(result.requestedExperiences, resolved([.viewpoints], .explicitRequest))
        XCTAssertEqual(result.softAvoidances, resolved([.majorRoads], .explicitRequest))
    }

    func testProfileWinsOnlyWhenCurrentRequestOmitsField() throws {
        let profile = makeProfile(
            activity: .trailRunning,
            comfort: .distanceKilometers(minimum: 10, maximum: 15),
            shape: .loop,
            experiences: [.viewpoints],
            avoidances: [.majorRoads]
        )

        let result = try resolver.resolve(
            explicitRequest: HikingExplicitRouteRequestV1(),
            profile: profile,
            engineFallbacks: HikingProfileEngineFallbacksV1(
                activity: .hiking,
                routeShape: .pointToPoint
            )
        )

        XCTAssertEqual(result.activity.source, .profileDefault)
        XCTAssertEqual(result.activity.value, .trailRunning)
        XCTAssertEqual(result.comfortableOuting.source, .profileDefault)
        XCTAssertEqual(result.routeShape.source, .profileDefault)
        XCTAssertEqual(result.requestedExperiences.source, .profileDefault)
        XCTAssertEqual(result.softAvoidances.source, .profileDefault)
    }

    func testNoPreferenceSuppressesProfileWithoutFabricatingCollections() throws {
        let profile = makeProfile(
            activity: .trailRunning,
            comfort: .distanceKilometers(minimum: 10, maximum: 15),
            shape: .loop,
            experiences: [.viewpoints],
            avoidances: [.majorRoads]
        )
        let explicit = HikingExplicitRouteRequestV1(
            activity: .noPreference,
            comfortableOuting: .noPreference,
            routeShape: .noPreference,
            requestedExperiences: .noPreference,
            softAvoidances: .noPreference
        )

        let result = try resolver.resolve(
            explicitRequest: explicit,
            profile: profile,
            engineFallbacks: HikingProfileEngineFallbacksV1(
                activity: .hiking,
                routeShape: .pointToPoint
            )
        )

        XCTAssertEqual(result.activity, resolved(.hiking, .explicitNoPreference))
        XCTAssertEqual(result.comfortableOuting, resolved(nil, .explicitNoPreference))
        XCTAssertEqual(result.routeShape, resolved(.pointToPoint, .explicitNoPreference))
        XCTAssertEqual(result.requestedExperiences, resolved([], .explicitNoPreference))
        XCTAssertEqual(result.softAvoidances, resolved([], .explicitNoPreference))
    }

    func testMissingValuesUseFallbackThenRemainAbsent() throws {
        let result = try resolver.resolve(
            explicitRequest: HikingExplicitRouteRequestV1(),
            profile: nil,
            engineFallbacks: HikingProfileEngineFallbacksV1(activity: .hiking)
        )

        XCTAssertEqual(result.activity, resolved(.hiking, .engineFallback))
        XCTAssertEqual(result.comfortableOuting, resolved(nil, .absent))
        XCTAssertEqual(result.routeShape, resolved(nil, .absent))
        XCTAssertEqual(result.requestedExperiences, resolved(nil, .absent))
        XCTAssertEqual(result.softAvoidances, resolved(nil, .absent))
    }

    func testExplicitCollectionsAreCanonicalAndDuplicatesAreRejected() throws {
        let canonical = try resolver.resolve(
            explicitRequest: HikingExplicitRouteRequestV1(
                requestedExperiences: .specified([.viewpoints, .forest]),
                softAvoidances: .specified([.steepClimbs, .majorRoads])
            ),
            profile: nil
        )
        XCTAssertEqual(canonical.requestedExperiences.value, [.forest, .viewpoints])
        XCTAssertEqual(canonical.softAvoidances.value, [.majorRoads, .steepClimbs])

        XCTAssertThrowsError(
            try resolver.resolve(
                explicitRequest: HikingExplicitRouteRequestV1(
                    requestedExperiences: .specified([.forest, .forest])
                ),
                profile: nil
            )
        ) { error in
            XCTAssertEqual(
                error as? HikingProfileValidationErrorV1,
                HikingProfileValidationErrorV1(
                    issues: [.duplicateRequestedExperience(.forest)]
                )
            )
        }
    }

    func testAdapterAppliesProfileDefaultsAndReportsInformationLoss() throws {
        let base = makeBaseRequest()
        let profile = makeProfile(
            activity: .trailRunning,
            comfort: .distanceKilometers(minimum: 10, maximum: 14),
            shape: .loop,
            experiences: [.viewpoints, .waterfalls, .forest],
            avoidances: [.majorRoads, .repeatedSections]
        )

        let result = try HikingProfileRoutePlanningAdapterV1().adapt(
            baseRequest: base,
            explicitRequest: HikingExplicitRouteRequestV1(),
            profile: profile
        )

        XCTAssertEqual(result.request.activityType, .trailRunning)
        XCTAssertEqual(result.request.graphHopperProfile, "foot")
        XCTAssertEqual(result.request.routeType, .loop)
        XCTAssertEqual(result.request.targetDistanceKm, 12)
        XCTAssertNil(result.request.targetDurationMinutes)
        XCTAssertEqual(result.request.desiredFeatures, [.forest, .viewpoint])
        XCTAssertEqual(result.request.avoidFeatures, [.majorRoads, .repeatedPath])
        XCTAssertEqual(
            result.gaps,
            [
                .comfortableOutingRangeReducedToMidpoint(.distanceKilometers),
                .unsupportedRequestedExperience(.waterfalls)
            ]
        )
        XCTAssertEqual(result.resolvedDefaults.activity.source, .profileDefault)
    }

    func testAdapterNeverOverwritesExplicitCurrentRequest() throws {
        let base = makeBaseRequest(
            activity: .biking,
            routeType: .pointToPoint,
            endQuery: "Schierke",
            distance: nil,
            duration: 120,
            desiredFeatures: [.quiet],
            avoidFeatures: [.steepClimbs]
        )
        let explicit = HikingExplicitRouteRequestV1(
            activity: .specified(.biking),
            comfortableOuting: .specified(.durationMinutes(minimum: 120, maximum: 120)),
            routeShape: .specified(.pointToPoint),
            requestedExperiences: .specified([.quietNature]),
            softAvoidances: .specified([.steepClimbs])
        )
        let profile = makeProfile(
            activity: .hiking,
            comfort: .distanceKilometers(minimum: 5, maximum: 10),
            shape: .loop,
            experiences: [.forest],
            avoidances: [.majorRoads]
        )

        let result = try HikingProfileRoutePlanningAdapterV1().adapt(
            baseRequest: base,
            explicitRequest: explicit,
            profile: profile
        )

        XCTAssertEqual(result.request.activityType, .biking)
        XCTAssertEqual(result.request.graphHopperProfile, "bike")
        XCTAssertEqual(result.request.routeType, .pointToPoint)
        XCTAssertNil(result.request.targetDistanceKm)
        XCTAssertEqual(result.request.targetDurationMinutes, 120)
        XCTAssertEqual(result.request.desiredFeatures, [.quiet])
        XCTAssertEqual(result.request.avoidFeatures, [.steepClimbs])
        XCTAssertTrue(result.gaps.isEmpty)
    }

    func testAdapterDoesNotCreatePointToPointRouteWithoutDestination() throws {
        let result = try HikingProfileRoutePlanningAdapterV1().adapt(
            baseRequest: makeBaseRequest(routeType: .loop, endQuery: nil),
            explicitRequest: HikingExplicitRouteRequestV1(),
            profile: makeProfile(shape: .pointToPoint)
        )

        XCTAssertEqual(result.request.routeType, .loop)
        XCTAssertEqual(result.gaps, [.pointToPointRequiresDestination])
        XCTAssertEqual(result.resolvedDefaults.routeShape.source, .profileDefault)
    }

    func testValidatedIntentExplicitnessControlsProfileApplicationFieldByField() throws {
        let explicitness = AdventureIntentPreferenceExplicitnessV1(
            activity: .omitted,
            comfortableOuting: .specified,
            routeShape: .specified,
            requestedExperiences: .noPreference,
            softAvoidances: .omitted
        )
        let intent = ValidatedAdventureIntent(
            intent: AdventureIntent(
                rawPrompt: "10 km loop from Ilsenburg with no special requests",
                parserSource: .localRuleBased,
                confidence: 1,
                activityType: .hiking,
                routeType: .loop,
                startLocationQuery: "Ilsenburg",
                endLocationQuery: nil,
                regionQuery: nil,
                targetDistanceKm: 10,
                targetDurationMinutes: nil,
                difficulty: nil,
                desiredFeatures: [],
                avoidFeatures: [],
                preferenceExplicitness: explicitness
            )
        )
        let profile = makeProfile(
            activity: .biking,
            comfort: .distanceKilometers(minimum: 40, maximum: 60),
            shape: .pointToPoint,
            experiences: [.forest],
            avoidances: [.majorRoads]
        )

        let result = try HikingProfileRoutePlanningAdapterV1().adapt(
            baseRequest: RoutePlanningRequest(validatedIntent: intent),
            validatedIntent: intent,
            profile: profile
        )

        XCTAssertEqual(result.request.activityType, .biking)
        XCTAssertEqual(result.request.targetDistanceKm, 10)
        XCTAssertEqual(result.request.routeType, .loop)
        XCTAssertEqual(result.request.desiredFeatures, [])
        XCTAssertEqual(result.request.avoidFeatures, [.majorRoads])
    }

    private func resolved<Value: Hashable & Sendable>(
        _ value: Value?,
        _ source: HikingPreferenceValueSourceV1
    ) -> HikingResolvedPreferenceV1<Value> {
        HikingResolvedPreferenceV1(value: value, source: source)
    }

    private func makeProfile(
        activity: HikingProfileActivityV1? = nil,
        comfort: HikingComfortableOutingV1? = nil,
        shape: HikingPreferredRouteShapeV1? = nil,
        experiences: [HikingRequestedExperienceV1]? = nil,
        avoidances: [HikingSoftAvoidanceV1]? = nil
    ) -> HikingPreferenceProfileV1 {
        HikingPreferenceProfileV1(
            metadata: HikingPreferenceProfileMetadataV1(
                profileID: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!,
                createdAt: Date(timeIntervalSince1970: 1_700_000_000)
            ),
            defaultActivity: activity,
            comfortableOuting: comfort,
            preferredRouteShape: shape,
            requestedExperiences: experiences,
            softAvoidances: avoidances
        )
    }

    private func makeBaseRequest(
        activity: ActivityType = .hiking,
        routeType: TrailRouteType = .loop,
        endQuery: String? = nil,
        distance: Double? = 10,
        duration: Int? = nil,
        desiredFeatures: [DesiredFeature] = [],
        avoidFeatures: [AvoidFeature] = []
    ) -> RoutePlanningRequest {
        RoutePlanningRequest(
            routeType: routeType,
            startQuery: "Ilsenburg",
            endQuery: endQuery,
            activityType: activity,
            graphHopperProfile: activity == .biking ? "bike" : "foot",
            targetDistanceKm: distance,
            targetDurationMinutes: duration,
            difficulty: nil,
            desiredFeatures: desiredFeatures,
            avoidFeatures: avoidFeatures
        )
    }
}
