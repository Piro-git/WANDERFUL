import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class HikingPreferenceProfileTests: XCTestCase {
    private let fixedDate = Date(timeIntervalSince1970: 1_700_000_000)

    func testFreshProfilePreservesEveryUnansweredFieldAsNil() {
        let profile = makeProfile()

        XCTAssertNil(profile.defaultActivity)
        XCTAssertNil(profile.comfortableOuting)
        XCTAssertNil(profile.preferredRouteShape)
        XCTAssertNil(profile.requestedExperiences)
        XCTAssertNil(profile.softAvoidances)
        XCTAssertEqual(profile.metadata.revision, 0)
    }

    func testCodecPreservesNilAndExplicitEmptyCollectionsAsDifferentValues() throws {
        let unknown = makeProfile()
        var explicitlyNone = makeProfile()
        explicitlyNone.requestedExperiences = []
        explicitlyNone.softAvoidances = []

        let decodedUnknown = try HikingPreferenceProfileCodecV1.decode(
            HikingPreferenceProfileCodecV1.encode(unknown)
        )
        let decodedNone = try HikingPreferenceProfileCodecV1.decode(
            HikingPreferenceProfileCodecV1.encode(explicitlyNone)
        )

        XCTAssertNil(decodedUnknown.requestedExperiences)
        XCTAssertNil(decodedUnknown.softAvoidances)
        XCTAssertEqual(decodedNone.requestedExperiences, [])
        XCTAssertEqual(decodedNone.softAvoidances, [])
        let unknownData = try HikingPreferenceProfileCodecV1.encode(unknown)
        let explicitlyNoneData = try HikingPreferenceProfileCodecV1.encode(explicitlyNone)
        XCTAssertNotEqual(unknownData, explicitlyNoneData)
    }

    func testCodecCanonicalizesCollectionOrderDeterministically() throws {
        var first = makeProfile()
        first.requestedExperiences = [.viewpoints, .forest, .quietNature]
        first.softAvoidances = [.steepClimbs, .majorRoads, .repeatedSections]
        var second = makeProfile()
        second.requestedExperiences = [.quietNature, .viewpoints, .forest]
        second.softAvoidances = [.repeatedSections, .steepClimbs, .majorRoads]

        let firstData = try HikingPreferenceProfileCodecV1.encode(first)
        let secondData = try HikingPreferenceProfileCodecV1.encode(second)

        XCTAssertEqual(firstData, secondData)
        let decoded = try HikingPreferenceProfileCodecV1.decode(firstData)
        XCTAssertEqual(decoded.requestedExperiences, [.forest, .quietNature, .viewpoints])
        XCTAssertEqual(decoded.softAvoidances, [.majorRoads, .repeatedSections, .steepClimbs])
    }

    func testValidatorRejectsDistanceRangesInsteadOfClamping() {
        let invalidRanges: [HikingComfortableOutingV1] = [
            .distanceKilometers(minimum: 0, maximum: 10),
            .distanceKilometers(minimum: 20, maximum: 10),
            .distanceKilometers(minimum: 10, maximum: 301),
            .distanceKilometers(minimum: 10.04, maximum: 12),
            .distanceKilometers(minimum: .nan, maximum: 10)
        ]

        for range in invalidRanges {
            var profile = makeProfile()
            profile.comfortableOuting = range
            XCTAssertThrowsError(try HikingPreferenceProfileValidatorV1.validate(profile)) { error in
                XCTAssertEqual(
                    error as? HikingProfileValidationErrorV1,
                    HikingProfileValidationErrorV1(issues: [.invalidDistanceRange])
                )
            }
        }
    }

    func testValidatorRejectsDurationRangesInsteadOfClamping() {
        let invalidRanges: [HikingComfortableOutingV1] = [
            .durationMinutes(minimum: 14, maximum: 60),
            .durationMinutes(minimum: 120, maximum: 60),
            .durationMinutes(minimum: 60, maximum: 1_441)
        ]

        for range in invalidRanges {
            var profile = makeProfile()
            profile.comfortableOuting = range
            XCTAssertThrowsError(try HikingPreferenceProfileValidatorV1.validate(profile)) { error in
                XCTAssertEqual(
                    error as? HikingProfileValidationErrorV1,
                    HikingProfileValidationErrorV1(issues: [.invalidDurationRange])
                )
            }
        }
    }

    func testValidatorRejectsDuplicatesAndOversizedCollections() {
        var duplicateExperiences = makeProfile()
        duplicateExperiences.requestedExperiences = [.forest, .forest]
        XCTAssertThrowsError(try HikingPreferenceProfileValidatorV1.validate(duplicateExperiences)) { error in
            XCTAssertEqual(
                error as? HikingProfileValidationErrorV1,
                HikingProfileValidationErrorV1(issues: [.duplicateRequestedExperience(.forest)])
            )
        }

        var duplicateAvoidances = makeProfile()
        duplicateAvoidances.softAvoidances = [.majorRoads, .majorRoads]
        XCTAssertThrowsError(try HikingPreferenceProfileValidatorV1.validate(duplicateAvoidances)) { error in
            XCTAssertEqual(
                error as? HikingProfileValidationErrorV1,
                HikingProfileValidationErrorV1(issues: [.duplicateSoftAvoidance(.majorRoads)])
            )
        }

        var oversized = makeProfile()
        oversized.requestedExperiences = Array(repeating: .forest, count: 9)
        XCTAssertThrowsError(try HikingPreferenceProfileValidatorV1.validate(oversized)) { error in
            let issues = (error as? HikingProfileValidationErrorV1)?.issues ?? []
            XCTAssertTrue(issues.contains(.tooManyRequestedExperiences(actual: 9, maximum: 8)))
            XCTAssertTrue(issues.contains(.duplicateRequestedExperience(.forest)))
        }
    }

    func testValidatorRejectsUnsupportedSchemaAndInvalidMetadata() {
        var profile = makeProfile()
        profile.metadata.schemaVersion = 2
        profile.metadata.onboardingVersion = "contains spaces"
        profile.metadata.updatedAt = fixedDate.addingTimeInterval(-1)

        XCTAssertThrowsError(try HikingPreferenceProfileValidatorV1.validate(profile)) { error in
            XCTAssertEqual(
                (error as? HikingProfileValidationErrorV1)?.issues,
                [
                    .unsupportedSchemaVersion(2),
                    .invalidOnboardingVersion,
                    .invalidMetadataChronology
                ]
            )
        }
    }

    func testOnboardingVersionMatchesDatabaseLowercaseIdentifierContract() {
        let invalidVersions = [
            "Uppercase", "contains-dash", "contains.dot", "_starts_with_underscore",
            String(repeating: "a", count: 33)
        ]

        for version in invalidVersions {
            var profile = makeProfile()
            profile.metadata.onboardingVersion = version
            XCTAssertThrowsError(try HikingPreferenceProfileValidatorV1.validate(profile))
        }

        var valid = makeProfile()
        valid.metadata.onboardingVersion = "hiking_intelligence_v1"
        XCTAssertNoThrow(try HikingPreferenceProfileValidatorV1.validate(valid))
    }

    func testValidatorRejectsUnencodableMetadataTimestampBeforeSerialization() {
        var profile = makeProfile()
        profile.metadata.createdAt = Date(timeIntervalSince1970: .infinity)
        profile.metadata.updatedAt = Date(timeIntervalSince1970: .infinity)

        XCTAssertThrowsError(try HikingPreferenceProfileCodecV1.encode(profile)) { error in
            XCTAssertEqual(
                error as? HikingProfileValidationErrorV1,
                HikingProfileValidationErrorV1(issues: [.invalidMetadataTimestamp])
            )
        }
    }

    func testValidatorRejectsRevisionOutsideDatabaseIntegerContract() {
        var profile = makeProfile()
        profile.metadata.revision = HikingPreferenceProfileMetadataV1.maximumPersistedRevision + 1

        XCTAssertThrowsError(try HikingPreferenceProfileValidatorV1.validate(profile)) { error in
            XCTAssertEqual(
                error as? HikingProfileValidationErrorV1,
                HikingProfileValidationErrorV1(issues: [.invalidRevision])
            )
        }
    }

    func testDraftValidationKeepsPartialProfileAndStepForResume() throws {
        var profile = makeProfile()
        profile.defaultActivity = .trailRunning
        profile.requestedExperiences = []
        let draft = HikingOnboardingDraftV1(
            draftID: fixedUUID("BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"),
            flowVersion: "perfect_day_v1",
            currentStepID: "comfortable_outing",
            profile: profile,
            startedAt: fixedDate
        )

        let canonical = try HikingOnboardingDraftValidatorV1.canonicalized(draft)

        XCTAssertEqual(canonical.currentStepID, "comfortable_outing")
        XCTAssertEqual(canonical.profile.defaultActivity, .trailRunning)
        XCTAssertEqual(canonical.profile.requestedExperiences, [])
        XCTAssertNil(canonical.profile.softAvoidances)
    }

    private func makeProfile() -> HikingPreferenceProfileV1 {
        HikingPreferenceProfileV1(
            metadata: HikingPreferenceProfileMetadataV1(
                profileID: fixedUUID("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"),
                onboardingVersion: "hiking_intelligence_v1",
                revision: 0,
                createdAt: fixedDate
            )
        )
    }

    private func fixedUUID(_ value: String) -> UUID {
        // Test fixtures are compile-time constants.
        UUID(uuidString: value)!
    }
}
