import Foundation

#if canImport(Supabase)
import Supabase
#endif

nonisolated enum SupabaseOnboardingSyncConfigurationStateV1: Equatable, Sendable {
    case disabled
    case invalid
    case enabled(SupabaseOnboardingSyncConfigurationV1)
}

nonisolated struct SupabaseOnboardingSyncConfigurationV1: Equatable, Sendable {
    static let enabledKey = "SUPABASE_ONBOARDING_SYNC_ENABLED"
    static let projectURLKey = "SUPABASE_PROJECT_URL"
    static let publishableKeyKey = "SUPABASE_PUBLISHABLE_KEY"

    let projectURL: URL
    let publishableKey: String

    static func resolve(infoDictionary: [String: Any]) -> SupabaseOnboardingSyncConfigurationStateV1 {
        guard featureFlag(infoDictionary[enabledKey]) else { return .disabled }
        guard let rawURL = normalizedString(infoDictionary[projectURLKey]),
              let url = URL(string: rawURL),
              url.scheme?.lowercased() == "https",
              isSupabaseProjectURL(url),
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil,
              let key = normalizedString(infoDictionary[publishableKeyKey]),
              isPublicClientKey(key)
        else {
            return .invalid
        }
        return .enabled(Self(projectURL: url, publishableKey: key))
    }

    private static func featureFlag(_ value: Any?) -> Bool {
        if let value = value as? Bool { return value }
        if let value = value as? NSNumber { return value.boolValue }
        guard let value = normalizedString(value) else { return false }
        return ["true", "yes", "1"].contains(value.lowercased())
    }

    private static func normalizedString(_ value: Any?) -> String? {
        guard let value = value as? String else { return nil }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty,
              !normalized.contains("$("),
              normalized.utf8.count <= 2_048
        else {
            return nil
        }
        return normalized
    }

    private static func isPublicClientKey(_ value: String) -> Bool {
        if value.hasPrefix("sb_publishable_") {
            let suffix = value.dropFirst("sb_publishable_".count)
            let normalized = suffix.lowercased()
            return suffix.count >= 20 &&
                !normalized.contains("example") &&
                !normalized.contains("placeholder") &&
                !normalized.contains("your_") &&
                suffix.utf8.allSatisfy {
                    (48...57).contains($0) ||
                    (65...90).contains($0) ||
                    (97...122).contains($0) ||
                    $0 == 45 || $0 == 95
                }
        }
        return legacyJWTRole(value) == "anon"
    }

    private static func isSupabaseProjectURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased(),
              host.hasSuffix(".supabase.co"),
              url.path.isEmpty || url.path == "/"
        else { return false }
        let projectReference = host.dropLast(".supabase.co".count)
        return projectReference.count == 20 && projectReference.utf8.allSatisfy {
            (48...57).contains($0) || (97...122).contains($0)
        }
    }

    private static func legacyJWTRole(_ value: String) -> String? {
        let segments = value.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3 else { return nil }
        var payload = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        payload.append(String(repeating: "=", count: (4 - payload.count % 4) % 4))
        guard let data = Data(base64Encoded: payload),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }
        return object["role"] as? String
    }
}

nonisolated enum HikingPreferenceProfileSyncErrorV1: Error, Equatable, Sendable {
    case invalidProfile([HikingProfileValidationIssueV1])
    case invalidRevision
    case unavailable
}

nonisolated protocol HikingPreferenceProfileSyncingV1: Sendable {
    func syncProfile(_ profile: HikingPreferenceProfileV1, mutationID: UUID) async throws
    func deleteProfile(profileID: UUID, clientRevision: UInt64, mutationID: UUID) async throws
}

nonisolated struct NoOpHikingPreferenceProfileSyncClientV1: HikingPreferenceProfileSyncingV1 {
    func syncProfile(_: HikingPreferenceProfileV1, mutationID _: UUID) async throws {}

    func deleteProfile(
        profileID _: UUID,
        clientRevision _: UInt64,
        mutationID _: UUID
    ) async throws {}
}

nonisolated protocol HikingPreferenceProfileRemoteSyncingV1: Sendable {
    func upsertProfile(_ profile: HikingPreferenceProfileV1, mutationID: UUID) async throws
    func deleteProfile(profileID: UUID, clientRevision: UInt64, mutationID: UUID) async throws
}

actor RetryingHikingPreferenceProfileSyncClientV1: HikingPreferenceProfileSyncingV1 {
    typealias Sleeper = @Sendable (Duration) async throws -> Void

    private let remote: any HikingPreferenceProfileRemoteSyncingV1
    private let maximumAttempts: Int
    private let retryDelay: Duration
    private let sleeper: Sleeper

    init(
        remote: any HikingPreferenceProfileRemoteSyncingV1,
        maximumAttempts: Int = 2,
        retryDelay: Duration = .milliseconds(250),
        sleeper: @escaping Sleeper = { duration in
            try await Task.sleep(for: duration)
        }
    ) {
        self.remote = remote
        self.maximumAttempts = min(max(maximumAttempts, 1), 3)
        self.retryDelay = retryDelay
        self.sleeper = sleeper
    }

    func syncProfile(_ profile: HikingPreferenceProfileV1, mutationID: UUID) async throws {
        try validate(profile)
        try await performWithBoundedRetry {
            try await self.remote.upsertProfile(profile, mutationID: mutationID)
        }
    }

    func deleteProfile(profileID: UUID, clientRevision: UInt64, mutationID: UUID) async throws {
        guard clientRevision > 0,
              clientRevision <= HikingPreferenceProfileMetadataV1.maximumPersistedRevision + 1
        else {
            throw HikingPreferenceProfileSyncErrorV1.invalidRevision
        }
        try await performWithBoundedRetry {
            try await self.remote.deleteProfile(
                profileID: profileID,
                clientRevision: clientRevision,
                mutationID: mutationID
            )
        }
    }

    private func validate(_ profile: HikingPreferenceProfileV1) throws {
        do {
            try HikingPreferenceProfileValidatorV1.validate(profile)
        } catch let error as HikingProfileValidationErrorV1 {
            throw HikingPreferenceProfileSyncErrorV1.invalidProfile(error.issues)
        }
        guard profile.metadata.revision > 0,
              profile.metadata.revision <= HikingPreferenceProfileMetadataV1.maximumPersistedRevision
        else {
            throw HikingPreferenceProfileSyncErrorV1.invalidRevision
        }
    }

    private func performWithBoundedRetry(
        _ operation: @escaping @Sendable () async throws -> Void
    ) async throws {
        var attempt = 1
        while true {
            try Task.checkCancellation()
            do {
                try await operation()
                return
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                guard attempt < maximumAttempts else { throw error }
                attempt += 1
                try await sleeper(retryDelay)
            }
        }
    }
}

enum HikingPreferenceProfileSyncFactoryV1 {
    /// Remote profile sync is intentionally non-activatable in V1. The dormant
    /// implementation remains reviewable, but no bundle value can compose it.
    static let remoteSyncAvailableInV1 = false
    typealias EnabledBuilder = @Sendable (
        SupabaseOnboardingSyncConfigurationV1
    ) -> any HikingPreferenceProfileSyncingV1

    static func make(
        configuration: WanderfulAppConfiguration? =
            WanderfulAppConfigurationSnapshot.configuration
    ) -> any HikingPreferenceProfileSyncingV1 {
        guard remoteSyncAvailableInV1,
              configuration?.features.supabaseOnboardingSync == true,
              let resolved = configuration?.supabaseOnboarding.configuredValue
        else {
            return NoOpHikingPreferenceProfileSyncClientV1()
        }
        let legacyConfiguration = SupabaseOnboardingSyncConfigurationV1(
            projectURL: resolved.projectURL,
            publishableKey: resolved.publishableKey
        )
        #if canImport(Supabase)
        let remote = SupabaseHikingPreferenceProfileRemoteSyncClientV1(
            configuration: legacyConfiguration
        )
        return RetryingHikingPreferenceProfileSyncClientV1(remote: remote)
        #else
        return NoOpHikingPreferenceProfileSyncClientV1()
        #endif
    }

    static func make(bundle: Bundle) -> any HikingPreferenceProfileSyncingV1 {
        let configuration = try? WanderfulAppConfiguration.resolve(
            infoDictionary: bundle.infoDictionary ?? [:],
            signedIdentity: WanderfulSignedLaneIdentity.value
        )
        return make(configuration: configuration)
    }

    static func make(
        infoDictionary: [String: Any],
        enabledBuilder: EnabledBuilder
    ) -> any HikingPreferenceProfileSyncingV1 {
        _ = infoDictionary
        _ = enabledBuilder
        return NoOpHikingPreferenceProfileSyncClientV1()
    }
}

#if canImport(Supabase)
actor SupabaseHikingPreferenceProfileRemoteSyncClientV1:
    HikingPreferenceProfileRemoteSyncingV1
{
    private let client: SupabaseClient

    init(configuration: SupabaseOnboardingSyncConfigurationV1) {
        client = SupabaseClient(
            supabaseURL: configuration.projectURL,
            supabaseKey: configuration.publishableKey
        )
    }

    func upsertProfile(_ profile: HikingPreferenceProfileV1, mutationID: UUID) async throws {
        try Task.checkCancellation()
        try await ensureAnonymousSession()
        let payload = try SupabaseHikingProfileUpsertPayloadV1(
            profile: profile,
            mutationID: mutationID
        )
        do {
            try await client
                .rpc("upsert_onboarding_profile_v1", params: payload)
                .execute()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw HikingPreferenceProfileSyncErrorV1.unavailable
        }
    }

    func deleteProfile(profileID: UUID, clientRevision: UInt64, mutationID: UUID) async throws {
        try Task.checkCancellation()
        try await ensureAnonymousSession()
        guard clientRevision > 0,
              clientRevision <= HikingPreferenceProfileMetadataV1.maximumPersistedRevision + 1
        else {
            throw HikingPreferenceProfileSyncErrorV1.invalidRevision
        }
        do {
            try await client
                .rpc(
                    "delete_onboarding_profile_v1",
                    params: SupabaseHikingProfileDeletePayloadV1(
                        profileID: profileID,
                        clientRevision: Int64(clientRevision),
                        mutationID: mutationID
                    )
                )
                .execute()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw HikingPreferenceProfileSyncErrorV1.unavailable
        }
    }

    private func ensureAnonymousSession() async throws {
        if client.auth.currentSession != nil { return }
        do {
            _ = try await client.auth.signInAnonymously()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw HikingPreferenceProfileSyncErrorV1.unavailable
        }
    }
}

nonisolated private struct SupabaseHikingProfileUpsertPayloadV1: Encodable, Sendable {
    let profileID: UUID
    let clientRevision: Int64
    let clientMutationID: UUID
    let onboardingVersion: String
    let profileCreatedAt: String
    let profileUpdatedAt: String
    let defaultActivity: String?
    let comfortBasis: String?
    let comfortableDistanceMinimumKilometers: Double?
    let comfortableDistanceMaximumKilometers: Double?
    let comfortableDurationMinimumMinutes: Int?
    let comfortableDurationMaximumMinutes: Int?
    let preferredRouteShape: String?
    let requestedExperiences: [String]?
    let softAvoidances: [String]?

    enum CodingKeys: String, CodingKey {
        case profileID = "p_profile_id"
        case clientRevision = "p_client_revision"
        case clientMutationID = "p_client_mutation_id"
        case onboardingVersion = "p_onboarding_version"
        case profileCreatedAt = "p_profile_created_at"
        case profileUpdatedAt = "p_profile_updated_at"
        case defaultActivity = "p_default_activity"
        case comfortBasis = "p_comfort_basis"
        case comfortableDistanceMinimumKilometers = "p_comfortable_distance_min_km"
        case comfortableDistanceMaximumKilometers = "p_comfortable_distance_max_km"
        case comfortableDurationMinimumMinutes = "p_comfortable_duration_min_minutes"
        case comfortableDurationMaximumMinutes = "p_comfortable_duration_max_minutes"
        case preferredRouteShape = "p_preferred_route_shape"
        case requestedExperiences = "p_requested_experiences"
        case softAvoidances = "p_soft_avoidances"
    }

    init(profile: HikingPreferenceProfileV1, mutationID: UUID) throws {
        do {
            try HikingPreferenceProfileValidatorV1.validate(profile)
        } catch let error as HikingProfileValidationErrorV1 {
            throw HikingPreferenceProfileSyncErrorV1.invalidProfile(error.issues)
        }
        guard profile.metadata.revision > 0,
              profile.metadata.revision <= HikingPreferenceProfileMetadataV1.maximumPersistedRevision
        else {
            throw HikingPreferenceProfileSyncErrorV1.invalidRevision
        }

        profileID = profile.metadata.profileID
        clientRevision = Int64(profile.metadata.revision)
        clientMutationID = mutationID
        onboardingVersion = profile.metadata.onboardingVersion
        profileCreatedAt = Self.timestamp(profile.metadata.createdAt)
        profileUpdatedAt = Self.timestamp(profile.metadata.updatedAt)
        defaultActivity = profile.defaultActivity?.rawValue
        preferredRouteShape = profile.preferredRouteShape?.rawValue
        requestedExperiences = profile.requestedExperiences?.map(\HikingRequestedExperienceV1.rawValue)
        softAvoidances = profile.softAvoidances?.map(\HikingSoftAvoidanceV1.rawValue)

        switch profile.comfortableOuting {
        case let .distanceKilometers(minimum, maximum):
            comfortBasis = HikingComfortBasisV1.distanceKilometers.rawValue
            comfortableDistanceMinimumKilometers = minimum
            comfortableDistanceMaximumKilometers = maximum
            comfortableDurationMinimumMinutes = nil
            comfortableDurationMaximumMinutes = nil
        case let .durationMinutes(minimum, maximum):
            comfortBasis = HikingComfortBasisV1.durationMinutes.rawValue
            comfortableDistanceMinimumKilometers = nil
            comfortableDistanceMaximumKilometers = nil
            comfortableDurationMinimumMinutes = minimum
            comfortableDurationMaximumMinutes = maximum
        case nil:
            comfortBasis = nil
            comfortableDistanceMinimumKilometers = nil
            comfortableDistanceMaximumKilometers = nil
            comfortableDurationMinimumMinutes = nil
            comfortableDurationMaximumMinutes = nil
        }
    }

    private static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

nonisolated private struct SupabaseHikingProfileDeletePayloadV1: Encodable, Sendable {
    let profileID: UUID
    let clientRevision: Int64
    let mutationID: UUID

    enum CodingKeys: String, CodingKey {
        case profileID = "p_profile_id"
        case clientRevision = "p_client_revision"
        case mutationID = "p_client_mutation_id"
    }
}
#endif

// Analytics is deliberately separate from personalization. V1 exposes only
// bounded, typed event vocabulary and records nothing unless a future consented
// recorder is explicitly composed.
nonisolated enum HikingOnboardingEventNameV1: String, CaseIterable, Sendable {
    case flowStarted = "flow_started"
    case stepViewed = "step_viewed"
    case answerSelected = "answer_selected"
    case answerUnknown = "answer_unknown"
    case stepCompleted = "step_completed"
    case flowCompleted = "flow_completed"
    case flowAbandoned = "flow_abandoned"
    case profileEdited = "profile_edited"
    case profileReset = "profile_reset"
}

nonisolated enum HikingOnboardingEventStepV1: String, CaseIterable, Sendable {
    case welcome
    case activity
    case comfort
    case routeShape = "route_shape"
    case avoidances
    case experiences
    case trust
    case profile
}

nonisolated enum HikingOnboardingEventValueCodeV1: String, CaseIterable, Sendable {
    case hiking
    case trailRunning = "trail_running"
    case biking
    case distanceKilometers = "distance_kilometers"
    case durationMinutes = "duration_minutes"
    case loop
    case pointToPoint = "point_to_point"
    case steepClimbs = "steep_climbs"
    case majorRoads = "major_roads"
    case repeatedSections = "repeated_sections"
    case viewpoints
    case forest
    case quietNature = "quiet_nature"
    case waterfalls
    case lakes
    case peaks
    case huts
    case landmarks
    case none
}
