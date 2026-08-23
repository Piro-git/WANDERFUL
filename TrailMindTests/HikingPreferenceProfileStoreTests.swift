import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class HikingPreferenceProfileStoreTests: XCTestCase {
    func testCreateLoadAndEditUseMonotonicRevisions() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let createdAt = Date(timeIntervalSince1970: 1_700_000_000)
        let editedAt = createdAt.addingTimeInterval(30)
        var profile = makeProfile(createdAt: createdAt)
        profile.defaultActivity = .hiking

        let created = try await context.store.saveProfile(profile, at: createdAt)
        var edited = created
        edited.defaultActivity = .trailRunning
        let savedEdit = try await context.store.saveProfile(edited, at: editedAt)
        let loaded = try await context.store.loadProfile()

        XCTAssertEqual(created.metadata.revision, 1)
        XCTAssertEqual(savedEdit.metadata.revision, 2)
        XCTAssertEqual(savedEdit.metadata.createdAt, createdAt)
        XCTAssertEqual(savedEdit.metadata.updatedAt, editedAt)
        XCTAssertEqual(loaded, savedEdit)
    }

    func testStaleRevisionIsRejectedWithoutReplacingStoredProfile() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let saved = try await context.store.saveProfile(makeProfile(createdAt: date), at: date)
        var stale = saved
        stale.metadata.revision = 0
        stale.defaultActivity = .biking

        do {
            _ = try await context.store.saveProfile(stale, at: date.addingTimeInterval(10))
            XCTFail("A stale edit must not overwrite a newer local profile.")
        } catch let error as HikingPreferenceProfileStoreErrorV1 {
            XCTAssertEqual(error, .staleProfileRevision(expected: 0, actual: 1))
        }
        let retained = try await context.store.loadProfile()
        XCTAssertEqual(retained, saved)
    }

    func testDifferentProfileIdentityCannotOverwriteExistingProfile() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let existing = try await context.store.saveProfile(makeProfile(createdAt: date), at: date)
        var replacement = makeProfile(
            profileID: fixedUUID("CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC"),
            createdAt: date
        )
        replacement.metadata.revision = existing.metadata.revision

        do {
            _ = try await context.store.saveProfile(replacement, at: date)
            XCTFail("Replacing a profile identity requires an explicit delete/reset.")
        } catch let error as HikingPreferenceProfileStoreErrorV1 {
            XCTAssertEqual(
                error,
                .profileIdentityConflict(
                    existing: existing.metadata.profileID,
                    supplied: replacement.metadata.profileID
                )
            )
        }
    }

    func testDraftRoundTripSupportsResumeAndPreservesNilVersusEmpty() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        var profile = makeProfile(createdAt: date)
        profile.requestedExperiences = []
        profile.softAvoidances = nil
        var draft = HikingOnboardingDraftV1(
            currentStepID: "requested_experiences",
            profile: profile,
            startedAt: date
        )
        draft.updatedAt = date.addingTimeInterval(5)

        let saved = try await context.store.saveDraft(draft, at: date.addingTimeInterval(5))
        let loaded = try await context.store.loadDraft()

        XCTAssertEqual(loaded, saved)
        XCTAssertEqual(loaded?.profile.requestedExperiences, [])
        XCTAssertNil(loaded?.profile.softAvoidances)
        XCTAssertEqual(loaded?.currentStepID, "requested_experiences")
    }

    func testSavingExistingDraftPreservesOriginalStartTime() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var draft = HikingOnboardingDraftV1(currentStepID: "activity", startedAt: start)
        draft = try await context.store.saveDraft(draft, at: start)
        draft.currentStepID = "comfortable_outing"
        draft.startedAt = start.addingTimeInterval(100)
        draft.updatedAt = start.addingTimeInterval(200)

        let resumed = try await context.store.saveDraft(draft, at: start.addingTimeInterval(200))

        XCTAssertEqual(resumed.startedAt, start)
        XCTAssertEqual(resumed.updatedAt, start.addingTimeInterval(200))
        XCTAssertEqual(resumed.currentStepID, "comfortable_outing")
    }

    func testOutOfOrderSameDraftSaveCannotReplaceNewerProgress() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let original = try await context.store.saveDraft(
            HikingOnboardingDraftV1(currentStepID: "activity", startedAt: start),
            at: start
        )

        var olderProgress = original
        olderProgress.currentStepID = "route_shape"
        olderProgress.profile.defaultActivity = .hiking
        olderProgress.updatedAt = start.addingTimeInterval(0.000_1)

        var newerProgress = original
        newerProgress.currentStepID = "requested_experiences"
        newerProgress.profile.defaultActivity = .biking
        newerProgress.updatedAt = start.addingTimeInterval(0.000_4)

        let savedNewer = try await context.store.saveDraft(
            newerProgress,
            at: start.addingTimeInterval(10)
        )
        let staleSaveResult = try await context.store.saveDraft(
            olderProgress,
            at: start.addingTimeInterval(20)
        )
        let afterStaleSave = try await context.store.loadDraft()

        XCTAssertEqual(staleSaveResult, savedNewer)
        XCTAssertEqual(afterStaleSave, savedNewer)
        XCTAssertEqual(afterStaleSave?.currentStepID, "requested_experiences")
        XCTAssertEqual(afterStaleSave?.profile.defaultActivity, .biking)

        var legitimateNextEdit = savedNewer
        legitimateNextEdit.currentStepID = "trust"
        legitimateNextEdit.profile.defaultActivity = .trailRunning
        legitimateNextEdit.updatedAt = start.addingTimeInterval(0.000_7)
        let savedNextEdit = try await context.store.saveDraft(
            legitimateNextEdit,
            at: start.addingTimeInterval(30)
        )

        XCTAssertEqual(savedNextEdit.currentStepID, "trust")
        XCTAssertEqual(savedNextEdit.profile.defaultActivity, .trailRunning)
    }

    func testDeleteAndResetHaveNarrowExplicitSemantics() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        _ = try await context.store.saveProfile(makeProfile(createdAt: date), at: date)
        _ = try await context.store.saveDraft(
            HikingOnboardingDraftV1(currentStepID: "activity", startedAt: date),
            at: date
        )

        await context.store.deleteDraft()
        let profileAfterDraftDelete = try await context.store.loadProfile()
        let draftAfterDraftDelete = try await context.store.loadDraft()
        XCTAssertNotNil(profileAfterDraftDelete)
        XCTAssertNil(draftAfterDraftDelete)

        await context.store.resetAll()
        let profileAfterReset = try await context.store.loadProfile()
        let draftAfterReset = try await context.store.loadDraft()
        XCTAssertNil(profileAfterReset)
        XCTAssertNil(draftAfterReset)
    }

    func testDeletingProfileDoesNotDiscardResumableDraft() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        _ = try await context.store.saveProfile(makeProfile(createdAt: date), at: date)
        let savedDraft = try await context.store.saveDraft(
            HikingOnboardingDraftV1(currentStepID: "route_shape", startedAt: date),
            at: date
        )

        await context.store.deleteProfile()
        let profile = try await context.store.loadProfile()
        let draft = try await context.store.loadDraft()

        XCTAssertNil(profile)
        XCTAssertEqual(draft, savedDraft)
    }

    func testCorruptProfileIsReportedAndNotDeleted() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let corrupt = Data("not-json".utf8)
        context.defaults.set(corrupt, forKey: context.profileKey)

        do {
            _ = try await context.store.loadProfile()
            XCTFail("Corrupt profile data must be surfaced, not replaced with defaults.")
        } catch let error as HikingPreferenceProfileStoreErrorV1 {
            XCTAssertEqual(error, .corruptRecord(.profile))
        }
        XCTAssertEqual(context.defaults.data(forKey: context.profileKey), corrupt)
    }

    func testFutureStorageVersionIsRejectedAndPreserved() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let future = Data(#"{"storageVersion":2,"profile":{}}"#.utf8)
        context.defaults.set(future, forKey: context.profileKey)

        do {
            _ = try await context.store.loadProfile()
            XCTFail("A future storage version must not be interpreted as V1.")
        } catch let error as HikingPreferenceProfileStoreErrorV1 {
            XCTAssertEqual(error, .unsupportedStorageVersion(record: .profile, version: 2))
        }
        XCTAssertEqual(context.defaults.data(forKey: context.profileKey), future)
    }

    func testSafeUnwrappedV1MigrationAddsOnlyStorageEnvelope() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        var profile = makeProfile(createdAt: Date(timeIntervalSince1970: 1_700_000_000))
        profile.requestedExperiences = []
        let unwrappedData = try HikingPreferenceProfileCodecV1.encode(profile)
        context.defaults.set(unwrappedData, forKey: context.profileKey)

        let loaded = try await context.store.loadProfile()
        let migratedData = try XCTUnwrap(context.defaults.data(forKey: context.profileKey))
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: migratedData) as? [String: Any]
        )

        XCTAssertEqual(loaded, profile)
        XCTAssertEqual(json["storageVersion"] as? Int, 1)
        XCTAssertNotNil(json["profile"])
        XCTAssertEqual(loaded?.requestedExperiences, [])
    }

    func testInvalidProfileIsRejectedBeforeAnyWrite() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        var profile = makeProfile(createdAt: Date(timeIntervalSince1970: 1_700_000_000))
        profile.softAvoidances = [.steepClimbs, .steepClimbs]

        do {
            _ = try await context.store.saveProfile(profile, at: profile.metadata.createdAt)
            XCTFail("Invalid preferences must be rejected rather than normalized.")
        } catch let error as HikingPreferenceProfileStoreErrorV1 {
            XCTAssertEqual(error, .invalidProfile([.duplicateSoftAvoidance(.steepClimbs)]))
        }
        XCTAssertNil(context.defaults.data(forKey: context.profileKey))
    }

    func testFinalPersistableRevisionCannotOverflowDuringEdit() async throws {
        let context = try makeContext()
        defer { context.cleanup() }
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        var profile = makeProfile(createdAt: date)
        profile.metadata.revision = HikingPreferenceProfileMetadataV1.maximumPersistedRevision
        context.defaults.set(
            try HikingPreferenceProfileCodecV1.encode(profile),
            forKey: context.profileKey
        )
        let stored = try await context.store.loadProfile()
        let loaded = try XCTUnwrap(stored)

        do {
            _ = try await context.store.saveProfile(loaded, at: date.addingTimeInterval(1))
            XCTFail("The final persistable revision must be reserved for deletion.")
        } catch let error as HikingPreferenceProfileStoreErrorV1 {
            XCTAssertEqual(error, .profileRevisionOverflow)
        }
    }

    private func makeContext() throws -> StoreTestContext {
        let suiteName = "HikingPreferenceProfileStoreTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let profileKey = "profile"
        let draftKey = "draft"
        return StoreTestContext(
            suiteName: suiteName,
            defaults: defaults,
            profileKey: profileKey,
            draftKey: draftKey,
            store: LocalHikingPreferenceProfileStoreV1(
                backing: HikingPreferenceProfileDefaultsBackingV1(defaults),
                profileKey: profileKey,
                draftKey: draftKey
            )
        )
    }

    private func makeProfile(
        profileID: UUID = UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!,
        createdAt: Date
    ) -> HikingPreferenceProfileV1 {
        HikingPreferenceProfileV1(
            metadata: HikingPreferenceProfileMetadataV1(
                profileID: profileID,
                createdAt: createdAt
            )
        )
    }

    private func fixedUUID(_ value: String) -> UUID {
        UUID(uuidString: value)!
    }
}

private struct StoreTestContext {
    let suiteName: String
    let defaults: UserDefaults
    let profileKey: String
    let draftKey: String
    let store: LocalHikingPreferenceProfileStoreV1

    func cleanup() {
        defaults.removePersistentDomain(forName: suiteName)
    }
}
