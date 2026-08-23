import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class HikingPreferenceProfileSyncTests: XCTestCase {
    func testV1FactoryNeverConstructsRemoteClientEvenWithValidEnabledConfiguration() async throws {
        let probe = SyncBuilderProbe()
        let client = HikingPreferenceProfileSyncFactoryV1.make(
            infoDictionary: [
                SupabaseOnboardingSyncConfigurationV1.enabledKey: "true",
                SupabaseOnboardingSyncConfigurationV1.projectURLKey: "https://abcdefghijklmnopqrst.supabase.co",
                SupabaseOnboardingSyncConfigurationV1.publishableKeyKey: "sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWX1234"
            ]
        ) { _ in
            probe.recordInvocation()
            return NoOpHikingPreferenceProfileSyncClientV1()
        }

        try await client.syncProfile(Self.persistedProfile(), mutationID: UUID())

        XCTAssertEqual(probe.invocationCount, 0)
        XCTAssertFalse(HikingPreferenceProfileSyncFactoryV1.remoteSyncAvailableInV1)
    }

    func testConfigurationRejectsExamplesAndRequiresHTTPSPublicClientKey() {
        XCTAssertEqual(
            SupabaseOnboardingSyncConfigurationV1.resolve(
                infoDictionary: [
                    SupabaseOnboardingSyncConfigurationV1.enabledKey: true,
                    SupabaseOnboardingSyncConfigurationV1.projectURLKey: "http://abcdefghijklmnopqrst.supabase.co",
                    SupabaseOnboardingSyncConfigurationV1.publishableKeyKey: "sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWX1234"
                ]
            ),
            .invalid
        )
        XCTAssertEqual(
            SupabaseOnboardingSyncConfigurationV1.resolve(
                infoDictionary: [
                    SupabaseOnboardingSyncConfigurationV1.enabledKey: true,
                    SupabaseOnboardingSyncConfigurationV1.projectURLKey: "https://abcdefghijklmnopqrst.supabase.co",
                    SupabaseOnboardingSyncConfigurationV1.publishableKeyKey: "sb_secret_not_allowed"
                ]
            ),
            .invalid
        )
        XCTAssertEqual(
            SupabaseOnboardingSyncConfigurationV1.resolve(
                infoDictionary: [
                    SupabaseOnboardingSyncConfigurationV1.enabledKey: true,
                    SupabaseOnboardingSyncConfigurationV1.projectURLKey: "https://your-project-ref.supabase.co",
                    SupabaseOnboardingSyncConfigurationV1.publishableKeyKey: "sb_publishable_your_public_key"
                ]
            ),
            .invalid
        )

        guard case .enabled(let configuration) = SupabaseOnboardingSyncConfigurationV1.resolve(
            infoDictionary: [
                SupabaseOnboardingSyncConfigurationV1.enabledKey: "true",
                SupabaseOnboardingSyncConfigurationV1.projectURLKey: "https://abcdefghijklmnopqrst.supabase.co",
                SupabaseOnboardingSyncConfigurationV1.publishableKeyKey: "sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWX1234"
            ]
        ) else {
            return XCTFail("Expected a validated public-client configuration")
        }
        XCTAssertEqual(
            configuration.projectURL.absoluteString,
            "https://abcdefghijklmnopqrst.supabase.co"
        )
    }

    func testRetryIsBoundedAndReusesMutationID() async throws {
        let remote = RecordingProfileRemote(failuresBeforeSuccess: 1)
        let client = RetryingHikingPreferenceProfileSyncClientV1(
            remote: remote,
            maximumAttempts: 2,
            retryDelay: .zero,
            sleeper: { _ in }
        )
        let mutationID = UUID()

        try await client.syncProfile(Self.persistedProfile(), mutationID: mutationID)

        let mutationIDs = await remote.recordedMutationIDs()
        XCTAssertEqual(mutationIDs, [mutationID, mutationID])
    }

    func testRetryStopsAfterConfiguredMaximum() async {
        let remote = RecordingProfileRemote(failuresBeforeSuccess: 10)
        let client = RetryingHikingPreferenceProfileSyncClientV1(
            remote: remote,
            maximumAttempts: 2,
            retryDelay: .zero,
            sleeper: { _ in }
        )

        do {
            try await client.syncProfile(Self.persistedProfile(), mutationID: UUID())
            XCTFail("Expected retry exhaustion")
        } catch {
            XCTAssertEqual(error as? HikingPreferenceProfileSyncErrorV1, .unavailable)
        }
        let attemptCount = await remote.attemptCount()
        XCTAssertEqual(attemptCount, 2)
    }

    func testCancellationStopsRetryImmediately() async {
        let remote = RecordingProfileRemote(failuresBeforeSuccess: 10)
        let client = RetryingHikingPreferenceProfileSyncClientV1(
            remote: remote,
            maximumAttempts: 3,
            retryDelay: .zero,
            sleeper: { _ in throw CancellationError() }
        )

        do {
            try await client.syncProfile(Self.persistedProfile(), mutationID: UUID())
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            let attemptCount = await remote.attemptCount()
            XCTAssertEqual(attemptCount, 1)
        } catch {
            XCTFail("Expected CancellationError, got \(type(of: error))")
        }
    }

    func testInvalidUnsavedRevisionNeverReachesRemote() async {
        let remote = RecordingProfileRemote(failuresBeforeSuccess: 0)
        let client = RetryingHikingPreferenceProfileSyncClientV1(remote: remote)

        do {
            try await client.syncProfile(HikingPreferenceProfileV1(), mutationID: UUID())
            XCTFail("Expected the unsaved revision to be rejected")
        } catch {
            XCTAssertEqual(error as? HikingPreferenceProfileSyncErrorV1, .invalidRevision)
        }
        let attemptCount = await remote.attemptCount()
        XCTAssertEqual(attemptCount, 0)
    }

    func testAnalyticsVocabularyIsClosedAndContainsNoPromptOrCoordinateField() {
        XCTAssertEqual(
            Set(HikingOnboardingEventNameV1.allCases.map(\.rawValue)),
            [
                "flow_started", "step_viewed", "answer_selected", "answer_unknown",
                "step_completed", "flow_completed", "flow_abandoned", "profile_edited",
                "profile_reset"
            ]
        )
        XCTAssertEqual(
            Set(HikingOnboardingEventStepV1.allCases.map(\.rawValue)),
            [
                "welcome", "activity", "comfort", "route_shape", "avoidances",
                "experiences", "trust", "profile"
            ]
        )
        XCTAssertEqual(
            Set(HikingOnboardingEventValueCodeV1.allCases.map(\.rawValue)),
            [
                "hiking", "trail_running", "biking", "distance_kilometers",
                "duration_minutes", "loop", "point_to_point", "steep_climbs",
                "major_roads", "repeated_sections", "viewpoints", "forest",
                "quiet_nature", "waterfalls", "lakes", "peaks", "huts",
                "landmarks", "none"
            ]
        )
    }

    func testCheckedInSQLMatchesSwiftVocabularyAndOwnerOnlyPolicyShape() throws {
        let repositoryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let migrationURL = repositoryURL.appendingPathComponent(
            "supabase/migrations/20260819113710_hiking_intelligence_onboarding_v1.sql"
        )
        let sql = try String(contentsOf: migrationURL, encoding: .utf8)

        for value in HikingOnboardingEventNameV1.allCases.map(\.rawValue) +
            HikingOnboardingEventStepV1.allCases.map(\.rawValue) +
            HikingOnboardingEventValueCodeV1.allCases.map(\.rawValue) {
            XCTAssertTrue(sql.contains("'\(value)'"), "SQL is missing bounded value \(value)")
        }
        XCTAssertTrue(sql.contains("alter table public.onboarding_profiles force row level security"))
        XCTAssertTrue(sql.contains("create policy onboarding_profiles_update_owner"))
        XCTAssertTrue(sql.contains("using ("))
        XCTAssertTrue(sql.contains("with check ("))
        XCTAssertTrue(sql.contains("(select auth.uid()) is not null"))
        XCTAssertTrue(sql.contains("(select auth.uid()) = user_id"))
        XCTAssertTrue(sql.contains("revoke all on table public.onboarding_profiles from public, anon, authenticated"))
        XCTAssertFalse(sql.contains("grant all on table public.onboarding_profiles"))
        XCTAssertFalse(sql.localizedCaseInsensitiveContains("service_role key"))
    }

    private static func persistedProfile() -> HikingPreferenceProfileV1 {
        let timestamp = Date(timeIntervalSince1970: 1_700_000_000)
        return HikingPreferenceProfileV1(
            metadata: HikingPreferenceProfileMetadataV1(
                profileID: UUID(uuidString: "7A282B6E-2B26-457B-A18A-B113E7D59F60")!,
                revision: 1,
                createdAt: timestamp,
                updatedAt: timestamp
            ),
            defaultActivity: .hiking,
            requestedExperiences: [.forest]
        )
    }
}

@MainActor
final class HikingProfileAppModelTests: XCTestCase {
    func testLocalCompletionPerformsZeroRemoteSyncWork() async throws {
        let syncClient = RecordingProfileSyncClient()
        let fixture = try makeFixture(syncClient: syncClient)
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }
        let draft = HikingOnboardingDraftV1(
            currentStepID: "trail_profile",
            profile: HikingPreferenceProfileV1(
                defaultActivity: .trailRunning,
                requestedExperiences: nil,
                softAvoidances: []
            )
        )

        let didComplete = await fixture.appModel.completeHikingOnboarding(draft)

        XCTAssertTrue(didComplete)
        XCTAssertEqual(fixture.appModel.hikingProfile?.defaultActivity, .trailRunning)
        XCTAssertNil(fixture.appModel.hikingProfile?.requestedExperiences)
        XCTAssertEqual(fixture.appModel.hikingProfile?.softAvoidances, [])
        let storedProfile = try await fixture.store.loadProfile()
        let storedDraft = try await fixture.store.loadDraft()
        XCTAssertNotNil(storedProfile)
        XCTAssertNil(storedDraft)
        let syncCallCount = await syncClient.callCount()
        XCTAssertEqual(syncCallCount, 0)
    }

    func testResetPreservesProfileIdentityAndClearsEveryAnswer() async throws {
        let fixture = try makeFixture(syncClient: NoOpHikingPreferenceProfileSyncClientV1())
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }
        let draft = HikingOnboardingDraftV1(
            currentStepID: "trail_profile",
            profile: HikingPreferenceProfileV1(
                defaultActivity: .hiking,
                comfortableOuting: .distanceKilometers(minimum: 10, maximum: 15),
                preferredRouteShape: .loop,
                requestedExperiences: [.viewpoints],
                softAvoidances: [.steepClimbs]
            )
        )
        let didComplete = await fixture.appModel.completeHikingOnboarding(draft)
        XCTAssertTrue(didComplete)
        let original = try XCTUnwrap(fixture.appModel.hikingProfile)

        let didReset = await fixture.appModel.resetHikingProfile()
        XCTAssertTrue(didReset)

        let reset = try XCTUnwrap(fixture.appModel.hikingProfile)
        XCTAssertEqual(reset.metadata.profileID, original.metadata.profileID)
        XCTAssertEqual(reset.metadata.revision, original.metadata.revision + 1)
        XCTAssertNil(reset.defaultActivity)
        XCTAssertNil(reset.comfortableOuting)
        XCTAssertNil(reset.preferredRouteShape)
        XCTAssertNil(reset.requestedExperiences)
        XCTAssertNil(reset.softAvoidances)
    }

    func testDeleteRemovesProfileAndDraftWithoutTouchingSavedRouteModel() async throws {
        let syncClient = RecordingProfileSyncClient()
        let fixture = try makeFixture(syncClient: syncClient)
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }
        let draft = HikingOnboardingDraftV1(
            currentStepID: "trail_profile",
            profile: HikingPreferenceProfileV1(defaultActivity: .biking)
        )
        let didComplete = await fixture.appModel.completeHikingOnboarding(draft)
        XCTAssertTrue(didComplete)

        await fixture.appModel.deleteHikingProfile()

        XCTAssertNil(fixture.appModel.hikingProfile)
        let storedProfile = try await fixture.store.loadProfile()
        let storedDraft = try await fixture.store.loadDraft()
        XCTAssertNil(storedProfile)
        XCTAssertNil(storedDraft)
        let syncCallCount = await syncClient.callCount()
        XCTAssertEqual(syncCallCount, 0)
    }

    func testCompletionDoesNotWriteGuessedLegacyValuesAndResetClearsOldCompatibility() async throws {
        let initialPreferences = UserPreferences(
            preferredActivity: .biking,
            fitnessLevel: .challenging,
            preferredDistanceKilometers: 72,
            avoidsSteepClimbs: true,
            interests: ["Old value"],
            cautiousSafetyMode: false,
            prefersOfflineMaps: false,
            hapticsEnabled: false
        )
        let fixture = try makeFixture(
            syncClient: NoOpHikingPreferenceProfileSyncClientV1(),
            preferences: initialPreferences
        )
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }

        let didComplete = await fixture.appModel.completeHikingOnboarding(
            HikingOnboardingDraftV1(
                currentStepID: "profile",
                profile: HikingPreferenceProfileV1(
                    defaultActivity: nil,
                    comfortableOuting: nil,
                    preferredRouteShape: nil,
                    requestedExperiences: nil,
                    softAvoidances: nil
                )
            )
        )

        XCTAssertTrue(didComplete)
        XCTAssertEqual(fixture.appModel.preferences, initialPreferences)
        let didReset = await fixture.appModel.resetHikingProfile()
        XCTAssertTrue(didReset)
        XCTAssertEqual(fixture.appModel.preferences.preferredActivity, .hiking)
        XCTAssertEqual(fixture.appModel.preferences.fitnessLevel, .moderate)
        XCTAssertEqual(fixture.appModel.preferences.preferredDistanceKilometers, 15)
        XCTAssertFalse(fixture.appModel.preferences.avoidsSteepClimbs)
        XCTAssertEqual(fixture.appModel.preferences.interests, [])
        XCTAssertFalse(fixture.appModel.preferences.cautiousSafetyMode)
        XCTAssertFalse(fixture.appModel.preferences.prefersOfflineMaps)
        XCTAssertFalse(fixture.appModel.preferences.hapticsEnabled)
    }

    func testCorruptLocalRecordHasReachableDiscardAndFreshSaveRecovery() async throws {
        let fixture = try makeFixture(syncClient: NoOpHikingPreferenceProfileSyncClientV1())
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }
        fixture.defaults.set(
            Data("corrupt-profile".utf8),
            forKey: LocalHikingPreferenceProfileStoreV1.defaultProfileKey
        )

        await fixture.appModel.loadHikingProfileStateIfNeeded()
        XCTAssertTrue(fixture.appModel.hikingProfileRecoveryRequired)
        XCTAssertNil(fixture.appModel.hikingProfile)

        await fixture.appModel.discardUnreadableHikingProfileData()
        XCTAssertFalse(fixture.appModel.hikingProfileRecoveryRequired)
        XCTAssertNil(
            fixture.defaults.data(
                forKey: LocalHikingPreferenceProfileStoreV1.defaultProfileKey
            )
        )

        let didSave = await fixture.appModel.completeHikingOnboarding(
            HikingOnboardingDraftV1(
                currentStepID: "profile",
                profile: HikingPreferenceProfileV1(defaultActivity: .hiking)
            )
        )
        XCTAssertTrue(didSave)
        XCTAssertEqual(fixture.appModel.hikingProfile?.defaultActivity, .hiking)
    }

    private func makeFixture(
        syncClient: any HikingPreferenceProfileSyncingV1,
        preferences: UserPreferences = UserPreferences()
    ) throws -> (
        appModel: AppModel,
        store: LocalHikingPreferenceProfileStoreV1,
        defaults: UserDefaults,
        suiteName: String
    ) {
        let suiteName = "HikingProfileAppModelTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let store = LocalHikingPreferenceProfileStoreV1(
            backing: HikingPreferenceProfileDefaultsBackingV1(defaults)
        )
        let appModel = AppModel(
            preferences: preferences,
            preferencesStore: UserPreferencesStore(defaults: defaults, key: "legacy"),
            hikingProfileStore: store,
            hikingProfileSyncClient: syncClient
        )
        return (appModel, store, defaults, suiteName)
    }
}

private actor RecordingProfileRemote: HikingPreferenceProfileRemoteSyncingV1 {
    private var remainingFailures: Int
    private var mutationIDs: [UUID] = []

    init(failuresBeforeSuccess: Int) {
        remainingFailures = failuresBeforeSuccess
    }

    func upsertProfile(_: HikingPreferenceProfileV1, mutationID: UUID) async throws {
        mutationIDs.append(mutationID)
        if remainingFailures > 0 {
            remainingFailures -= 1
            throw HikingPreferenceProfileSyncErrorV1.unavailable
        }
    }

    func deleteProfile(profileID _: UUID, clientRevision _: UInt64, mutationID: UUID) async throws {
        mutationIDs.append(mutationID)
        if remainingFailures > 0 {
            remainingFailures -= 1
            throw HikingPreferenceProfileSyncErrorV1.unavailable
        }
    }

    func recordedMutationIDs() -> [UUID] { mutationIDs }
    func attemptCount() -> Int { mutationIDs.count }
}

private struct AlwaysFailingProfileSyncClient: HikingPreferenceProfileSyncingV1 {
    func syncProfile(_: HikingPreferenceProfileV1, mutationID _: UUID) async throws {
        throw HikingPreferenceProfileSyncErrorV1.unavailable
    }

    func deleteProfile(profileID _: UUID, clientRevision _: UInt64, mutationID _: UUID) async throws {
        throw HikingPreferenceProfileSyncErrorV1.unavailable
    }
}

private actor RecordingProfileSyncClient: HikingPreferenceProfileSyncingV1 {
    private var calls = 0

    func syncProfile(_: HikingPreferenceProfileV1, mutationID _: UUID) async throws {
        calls += 1
    }

    func deleteProfile(
        profileID _: UUID,
        clientRevision _: UInt64,
        mutationID _: UUID
    ) async throws {
        calls += 1
    }

    func callCount() -> Int { calls }
}

private final class SyncBuilderProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    var invocationCount: Int {
        lock.withLock { count }
    }

    func recordInvocation() {
        lock.withLock { count += 1 }
    }
}
