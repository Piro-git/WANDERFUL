import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class OnboardingProfileBridgeTests: XCTestCase {
    func testUnknownInterfaceDraftProducesOnlyNilProfileDefaults() {
        let core = OnboardingProfileBridgeV1.coreDraft(
            from: OnboardingView.Draft(),
            step: .activity,
            existing: nil
        )

        XCTAssertEqual(core.currentStepID, OnboardingView.Step.activity.rawValue)
        XCTAssertEqual(core.profile.metadata.revision, 0)
        XCTAssertNil(core.profile.defaultActivity)
        XCTAssertNil(core.profile.comfortableOuting)
        XCTAssertNil(core.profile.preferredRouteShape)
        XCTAssertNil(core.profile.requestedExperiences)
        XCTAssertNil(core.profile.softAvoidances)
    }

    func testEverySupportedActivityMapsWithoutChangingMeaning() {
        let mappings: [(ActivityType, HikingProfileActivityV1)] = [
            (.hiking, .hiking),
            (.trailRunning, .trailRunning),
            (.biking, .biking)
        ]

        for (interfaceActivity, expectedCoreActivity) in mappings {
            let core = OnboardingProfileBridgeV1.coreDraft(
                from: OnboardingView.Draft(activity: interfaceActivity),
                step: .distance,
                existing: nil
            )
            XCTAssertEqual(core.profile.defaultActivity, expectedCoreActivity)
        }
    }

    func testCompleteInterfaceDraftMapsEveryTypedFieldExactly() {
        let interface = OnboardingView.Draft(
            activity: .biking,
            comfortRange: .init(minimum: 2, maximum: 4, unit: .hours),
            routeShape: .pointToPoint,
            softAvoidances: [.steepClimbs, .longRoadSections, .repeatedSections],
            requestedExperiences: [.viewpoints, .forest, .lakes]
        )

        let core = OnboardingProfileBridgeV1.coreDraft(
            from: interface,
            step: .ready,
            existing: nil
        )

        XCTAssertEqual(core.profile.defaultActivity, .biking)
        XCTAssertEqual(
            core.profile.comfortableOuting,
            .durationMinutes(minimum: 120, maximum: 240)
        )
        XCTAssertEqual(core.profile.preferredRouteShape, .pointToPoint)
        XCTAssertEqual(
            core.profile.softAvoidances,
            [.majorRoads, .repeatedSections, .steepClimbs]
        )
        XCTAssertEqual(
            core.profile.requestedExperiences,
            [.forest, .lakes, .viewpoints]
        )
    }

    func testResumingPreservesDraftAndProfileIdentity() {
        let startedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let draftID = UUID(uuidString: "D18FD807-8B27-46DA-B7A4-A54BB10FE6CE")!
        let profileID = UUID(uuidString: "49B0BD91-090A-4853-9FD0-6BED6592767E")!
        let existing = HikingOnboardingDraftV1(
            draftID: draftID,
            currentStepID: OnboardingView.Step.distance.rawValue,
            profile: HikingPreferenceProfileV1(
                metadata: .init(profileID: profileID, createdAt: startedAt),
                defaultActivity: .hiking
            ),
            startedAt: startedAt,
            updatedAt: startedAt
        )

        let resumed = OnboardingProfileBridgeV1.coreDraft(
            from: OnboardingView.Draft(activity: .trailRunning),
            step: .routeShape,
            existing: existing
        )

        XCTAssertEqual(resumed.draftID, draftID)
        XCTAssertEqual(resumed.startedAt, startedAt)
        XCTAssertEqual(resumed.profile.metadata.profileID, profileID)
        XCTAssertEqual(resumed.profile.defaultActivity, .trailRunning)
        XCTAssertEqual(resumed.currentStepID, OnboardingView.Step.routeShape.rawValue)
        XCTAssertGreaterThan(resumed.updatedAt, startedAt)
    }

    func testRoundTripKeepsExplicitEmptyCollectionsDistinctFromUnknown() {
        let explicitNone = HikingPreferenceProfileV1(
            requestedExperiences: [],
            softAvoidances: []
        )
        let interface = OnboardingProfileBridgeV1.interfaceDraft(from: explicitNone)
        let roundTripped = OnboardingProfileBridgeV1.coreDraft(
            from: interface,
            step: .interests,
            existing: nil
        )

        XCTAssertEqual(interface.requestedExperiences, [])
        XCTAssertEqual(interface.softAvoidances, [])
        XCTAssertEqual(interface.requestedExperiencesLabel, "None selected")
        XCTAssertEqual(interface.softAvoidancesLabel, "None selected")
        XCTAssertEqual(roundTripped.profile.requestedExperiences, [])
        XCTAssertEqual(roundTripped.profile.softAvoidances, [])

        let unknownInterface = OnboardingProfileBridgeV1.interfaceDraft(
            from: HikingPreferenceProfileV1()
        )
        XCTAssertNil(unknownInterface.requestedExperiences)
        XCTAssertNil(unknownInterface.softAvoidances)
        XCTAssertEqual(unknownInterface.requestedExperiencesLabel, "Not set")
        XCTAssertEqual(unknownInterface.softAvoidancesLabel, "Not set")
    }

    func testUnknownStoredStepFailsClosedToWelcome() {
        XCTAssertEqual(
            OnboardingProfileBridgeV1.step(from: "future-step"),
            .welcome
        )
    }

    func testProgressOrderingTokenAlwaysMovesForward() {
        let future = Date().addingTimeInterval(60)
        let existing = HikingOnboardingDraftV1(
            currentStepID: OnboardingView.Step.activity.rawValue,
            startedAt: future.addingTimeInterval(-10),
            updatedAt: future
        )

        let updated = OnboardingProfileBridgeV1.coreDraft(
            from: OnboardingView.Draft(activity: .hiking),
            step: .distance,
            existing: existing
        )

        XCTAssertGreaterThan(updated.updatedAt, future)
    }
}
