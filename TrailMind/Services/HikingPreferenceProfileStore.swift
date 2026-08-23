import Foundation

nonisolated enum HikingProfileStoreRecordKindV1: String, Equatable, Sendable {
    case profile
    case onboardingDraft
}

nonisolated enum HikingPreferenceProfileStoreErrorV1: Error, Equatable, Sendable {
    case corruptRecord(HikingProfileStoreRecordKindV1)
    case unsupportedStorageVersion(record: HikingProfileStoreRecordKindV1, version: Int)
    case invalidProfile([HikingProfileValidationIssueV1])
    case invalidDraft([HikingOnboardingDraftValidationIssueV1])
    case profileIdentityConflict(existing: UUID, supplied: UUID)
    case staleProfileRevision(expected: UInt64?, actual: UInt64?)
    case profileRevisionOverflow
}

nonisolated protocol HikingPreferenceProfileStoreV1: Sendable {
    func loadProfile() async throws -> HikingPreferenceProfileV1?
    func saveProfile(_ profile: HikingPreferenceProfileV1, at date: Date) async throws -> HikingPreferenceProfileV1
    func deleteProfile() async

    func loadDraft() async throws -> HikingOnboardingDraftV1?
    /// `draft.updatedAt` is the ordering token. `date` is only the caller's
    /// observation time and must never make an older snapshot win.
    func saveDraft(_ draft: HikingOnboardingDraftV1, at date: Date) async throws -> HikingOnboardingDraftV1
    func deleteDraft() async

    func resetAll() async
}

/// `UserDefaults` is documented as thread-safe. This wrapper makes the
/// boundary explicit while the actor still serializes every profile access.
/// It also permits isolated test suites without sharing mutable app state.
nonisolated struct HikingPreferenceProfileDefaultsBackingV1: @unchecked Sendable {
    let defaults: UserDefaults

    init(_ defaults: UserDefaults) {
        self.defaults = defaults
    }

    static let standard = HikingPreferenceProfileDefaultsBackingV1(.standard)
}

/// Local-first persistence for onboarding. No load or save operation performs
/// authentication or network work. Records are versioned independently from
/// the profile schema so storage migrations can evolve without changing the
/// route-planning contract. This store deliberately does not auto-migrate the
/// legacy `UserPreferences`: its nonoptional defaults cannot prove which values
/// a person actually chose, so doing so would violate nil-preserving semantics.
actor LocalHikingPreferenceProfileStoreV1: HikingPreferenceProfileStoreV1 {
    nonisolated static let currentStorageVersion = 1
    nonisolated static let defaultProfileKey = "trailmind.hiking-preference-profile.storage.v1"
    nonisolated static let defaultDraftKey = "trailmind.hiking-onboarding-draft.storage.v1"

    private let defaults: UserDefaults
    private let profileKey: String
    private let draftKey: String

    init(
        backing: HikingPreferenceProfileDefaultsBackingV1 = .standard,
        profileKey: String = LocalHikingPreferenceProfileStoreV1.defaultProfileKey,
        draftKey: String = LocalHikingPreferenceProfileStoreV1.defaultDraftKey
    ) {
        defaults = backing.defaults
        self.profileKey = profileKey
        self.draftKey = draftKey
    }

    func loadProfile() async throws -> HikingPreferenceProfileV1? {
        guard let data = defaults.data(forKey: profileKey) else { return nil }
        let loaded = try decodeProfileRecord(data)
        if loaded.requiresEnvelopeMigration {
            defaults.set(try encodeProfileEnvelope(loaded.profile), forKey: profileKey)
        }
        return loaded.profile
    }

    func saveProfile(
        _ suppliedProfile: HikingPreferenceProfileV1,
        at date: Date = Date()
    ) async throws -> HikingPreferenceProfileV1 {
        let profile = try canonicalProfile(suppliedProfile)
        let existing = try loadProfileRecordWithoutMigration()
        var persisted = profile

        if let existing {
            guard existing.metadata.profileID == profile.metadata.profileID else {
                throw HikingPreferenceProfileStoreErrorV1.profileIdentityConflict(
                    existing: existing.metadata.profileID,
                    supplied: profile.metadata.profileID
                )
            }
            guard profile.metadata.revision == existing.metadata.revision else {
                throw HikingPreferenceProfileStoreErrorV1.staleProfileRevision(
                    expected: profile.metadata.revision,
                    actual: existing.metadata.revision
                )
            }
            guard existing.metadata.revision < HikingPreferenceProfileMetadataV1.maximumPersistedRevision else {
                throw HikingPreferenceProfileStoreErrorV1.profileRevisionOverflow
            }
            persisted.metadata.createdAt = existing.metadata.createdAt
            persisted.metadata.revision = existing.metadata.revision + 1
            persisted.metadata.updatedAt = date
        } else {
            guard profile.metadata.revision == 0 else {
                throw HikingPreferenceProfileStoreErrorV1.staleProfileRevision(
                    expected: profile.metadata.revision,
                    actual: nil
                )
            }
            persisted.metadata.revision = 1
            persisted.metadata.createdAt = date
            persisted.metadata.updatedAt = date
        }

        persisted = try canonicalProfile(persisted)
        defaults.set(try encodeProfileEnvelope(persisted), forKey: profileKey)
        return persisted
    }

    func deleteProfile() async {
        defaults.removeObject(forKey: profileKey)
    }

    func loadDraft() async throws -> HikingOnboardingDraftV1? {
        guard let data = defaults.data(forKey: draftKey) else { return nil }
        let loaded = try decodeDraftRecord(data)
        if loaded.requiresEnvelopeMigration {
            defaults.set(
                try encodeDraftEnvelope(
                    loaded.draft,
                    orderingTimestampMicroseconds: loaded.orderingTimestampMicroseconds
                ),
                forKey: draftKey
            )
        }
        return loaded.draft
    }

    func saveDraft(
        _ suppliedDraft: HikingOnboardingDraftV1,
        at _: Date = Date()
    ) async throws -> HikingOnboardingDraftV1 {
        let suppliedOrderingTimestamp = try draftOrderingTimestamp(suppliedDraft.updatedAt)
        var draft = suppliedDraft
        let loadedExisting = try loadDraftRecordWithoutMigration()
        if let loadedExisting, loadedExisting.draft.draftID == draft.draftID {
            draft.startedAt = loadedExisting.draft.startedAt
        }
        draft = try canonicalDraft(draft)

        if let loadedExisting,
           loadedExisting.draft.draftID == draft.draftID,
           suppliedOrderingTimestamp <= loadedExisting.orderingTimestampMicroseconds {
            if loadedExisting.requiresEnvelopeMigration {
                defaults.set(
                    try encodeDraftEnvelope(
                        loadedExisting.draft,
                        orderingTimestampMicroseconds: loadedExisting.orderingTimestampMicroseconds
                    ),
                    forKey: draftKey
                )
            }
            return loadedExisting.draft
        }

        defaults.set(
            try encodeDraftEnvelope(
                draft,
                orderingTimestampMicroseconds: suppliedOrderingTimestamp
            ),
            forKey: draftKey
        )
        return draft
    }

    func deleteDraft() async {
        defaults.removeObject(forKey: draftKey)
    }

    func resetAll() async {
        defaults.removeObject(forKey: profileKey)
        defaults.removeObject(forKey: draftKey)
    }

    private func loadProfileRecordWithoutMigration() throws -> HikingPreferenceProfileV1? {
        guard let data = defaults.data(forKey: profileKey) else { return nil }
        return try decodeProfileRecord(data).profile
    }

    private func loadDraftRecordWithoutMigration() throws -> LoadedDraftRecordV1? {
        guard let data = defaults.data(forKey: draftKey) else { return nil }
        return try decodeDraftRecord(data)
    }

    private func decodeProfileRecord(_ data: Data) throws -> LoadedProfileRecordV1 {
        let decoder = HikingPreferenceProfileCodecV1.makeDecoder()
        if let header = try? decoder.decode(HikingStorageHeaderV1.self, from: data) {
            guard header.storageVersion == Self.currentStorageVersion else {
                throw HikingPreferenceProfileStoreErrorV1.unsupportedStorageVersion(
                    record: .profile,
                    version: header.storageVersion
                )
            }
            let envelope: PersistedHikingProfileEnvelopeV1
            do {
                envelope = try decoder.decode(PersistedHikingProfileEnvelopeV1.self, from: data)
            } catch {
                throw HikingPreferenceProfileStoreErrorV1.corruptRecord(.profile)
            }
            return LoadedProfileRecordV1(
                profile: try canonicalProfile(envelope.profile),
                requiresEnvelopeMigration: false
            )
        }

        // Safe structural migration from an unwrapped V1 payload. It changes
        // only the persistence envelope and preserves every optional value.
        do {
            let profile = try decoder.decode(HikingPreferenceProfileV1.self, from: data)
            return LoadedProfileRecordV1(
                profile: try canonicalProfile(profile),
                requiresEnvelopeMigration: true
            )
        } catch let error as HikingPreferenceProfileStoreErrorV1 {
            throw error
        } catch let error as HikingProfileValidationErrorV1 {
            throw HikingPreferenceProfileStoreErrorV1.invalidProfile(error.issues)
        } catch {
            throw HikingPreferenceProfileStoreErrorV1.corruptRecord(.profile)
        }
    }

    private func decodeDraftRecord(_ data: Data) throws -> LoadedDraftRecordV1 {
        let decoder = HikingPreferenceProfileCodecV1.makeDecoder()
        if let header = try? decoder.decode(HikingStorageHeaderV1.self, from: data) {
            guard header.storageVersion == Self.currentStorageVersion else {
                throw HikingPreferenceProfileStoreErrorV1.unsupportedStorageVersion(
                    record: .onboardingDraft,
                    version: header.storageVersion
                )
            }
            let envelope: PersistedHikingDraftEnvelopeV1
            do {
                envelope = try decoder.decode(PersistedHikingDraftEnvelopeV1.self, from: data)
            } catch {
                throw HikingPreferenceProfileStoreErrorV1.corruptRecord(.onboardingDraft)
            }
            let draft = try canonicalDraft(envelope.draft)
            let fallbackOrderingTimestamp = try draftOrderingTimestamp(draft.updatedAt)
            let orderingTimestamp = envelope.orderingTimestampMicroseconds
                ?? fallbackOrderingTimestamp
            guard orderingTimestampIsConsistent(
                orderingTimestamp,
                with: fallbackOrderingTimestamp
            ) else {
                throw HikingPreferenceProfileStoreErrorV1.corruptRecord(.onboardingDraft)
            }
            return LoadedDraftRecordV1(
                draft: draft,
                orderingTimestampMicroseconds: orderingTimestamp,
                requiresEnvelopeMigration: envelope.orderingTimestampMicroseconds == nil
            )
        }

        do {
            let draft = try decoder.decode(HikingOnboardingDraftV1.self, from: data)
            let canonicalDraft = try canonicalDraft(draft)
            return LoadedDraftRecordV1(
                draft: canonicalDraft,
                orderingTimestampMicroseconds: try draftOrderingTimestamp(canonicalDraft.updatedAt),
                requiresEnvelopeMigration: true
            )
        } catch let error as HikingPreferenceProfileStoreErrorV1 {
            throw error
        } catch let error as HikingOnboardingDraftValidationErrorV1 {
            throw HikingPreferenceProfileStoreErrorV1.invalidDraft(error.issues)
        } catch {
            throw HikingPreferenceProfileStoreErrorV1.corruptRecord(.onboardingDraft)
        }
    }

    private func canonicalProfile(_ profile: HikingPreferenceProfileV1) throws -> HikingPreferenceProfileV1 {
        do {
            return try HikingPreferenceProfileValidatorV1.canonicalized(profile)
        } catch let error as HikingProfileValidationErrorV1 {
            throw HikingPreferenceProfileStoreErrorV1.invalidProfile(error.issues)
        }
    }

    private func canonicalDraft(_ draft: HikingOnboardingDraftV1) throws -> HikingOnboardingDraftV1 {
        do {
            return try HikingOnboardingDraftValidatorV1.canonicalized(draft)
        } catch let error as HikingOnboardingDraftValidationErrorV1 {
            throw HikingPreferenceProfileStoreErrorV1.invalidDraft(error.issues)
        }
    }

    private func encodeProfileEnvelope(_ profile: HikingPreferenceProfileV1) throws -> Data {
        try HikingPreferenceProfileCodecV1.makeEncoder().encode(
            PersistedHikingProfileEnvelopeV1(
                storageVersion: Self.currentStorageVersion,
                profile: profile
            )
        )
    }

    private func encodeDraftEnvelope(
        _ draft: HikingOnboardingDraftV1,
        orderingTimestampMicroseconds: Int64
    ) throws -> Data {
        try HikingPreferenceProfileCodecV1.makeEncoder().encode(
            PersistedHikingDraftEnvelopeV1(
                storageVersion: Self.currentStorageVersion,
                draft: draft,
                orderingTimestampMicroseconds: orderingTimestampMicroseconds
            )
        )
    }

    private func draftOrderingTimestamp(_ date: Date) throws -> Int64 {
        let microseconds = date.timeIntervalSince1970 * 1_000_000
        guard microseconds.isFinite,
              microseconds >= Double(Int64.min + 1_024),
              microseconds <= Double(Int64.max - 1_024)
        else {
            throw HikingPreferenceProfileStoreErrorV1.invalidDraft([.invalidMetadataTimestamp])
        }
        return Int64(microseconds.rounded())
    }

    private func orderingTimestampIsConsistent(
        _ orderingTimestamp: Int64,
        with canonicalTimestamp: Int64
    ) -> Bool {
        let difference = orderingTimestamp.subtractingReportingOverflow(canonicalTimestamp)
        guard !difference.overflow else { return false }
        return ((-500 as Int64)...500).contains(difference.partialValue)
    }
}

nonisolated private struct HikingStorageHeaderV1: Decodable {
    let storageVersion: Int
}

nonisolated private struct PersistedHikingProfileEnvelopeV1: Codable {
    let storageVersion: Int
    let profile: HikingPreferenceProfileV1
}

nonisolated private struct PersistedHikingDraftEnvelopeV1: Codable {
    let storageVersion: Int
    let draft: HikingOnboardingDraftV1
    let orderingTimestampMicroseconds: Int64?
}

nonisolated private struct LoadedProfileRecordV1 {
    let profile: HikingPreferenceProfileV1
    let requiresEnvelopeMigration: Bool
}

nonisolated private struct LoadedDraftRecordV1 {
    let draft: HikingOnboardingDraftV1
    let orderingTimestampMicroseconds: Int64
    let requiresEnvelopeMigration: Bool
}
