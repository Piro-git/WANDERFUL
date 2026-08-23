import Foundation

nonisolated enum HikingProfileActivityV1: String, CaseIterable, Codable, Hashable, Sendable {
    case hiking
    case trailRunning = "trail_running"
    case biking

    init(_ activityType: ActivityType) {
        switch activityType {
        case .hiking:
            self = .hiking
        case .trailRunning:
            self = .trailRunning
        case .biking:
            self = .biking
        }
    }

    var activityType: ActivityType {
        switch self {
        case .hiking: .hiking
        case .trailRunning: .trailRunning
        case .biking: .biking
        }
    }
}

nonisolated enum HikingComfortBasisV1: String, CaseIterable, Codable, Hashable, Sendable {
    case distanceKilometers = "distance_kilometers"
    case durationMinutes = "duration_minutes"
}

/// A comfortable outing is intentionally a band rather than a fitness claim.
/// Distance and duration stay as separate typed cases so an unanswered basis
/// cannot be guessed during serialization or planning.
nonisolated enum HikingComfortableOutingV1: Codable, Hashable, Sendable {
    case distanceKilometers(minimum: Double, maximum: Double)
    case durationMinutes(minimum: Int, maximum: Int)

    private enum CodingKeys: String, CodingKey {
        case basis
        case minimum
        case maximum
    }

    var basis: HikingComfortBasisV1 {
        switch self {
        case .distanceKilometers: .distanceKilometers
        case .durationMinutes: .durationMinutes
        }
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let basis = try container.decode(HikingComfortBasisV1.self, forKey: .basis)
        switch basis {
        case .distanceKilometers:
            self = .distanceKilometers(
                minimum: try container.decode(Double.self, forKey: .minimum),
                maximum: try container.decode(Double.self, forKey: .maximum)
            )
        case .durationMinutes:
            self = .durationMinutes(
                minimum: try container.decode(Int.self, forKey: .minimum),
                maximum: try container.decode(Int.self, forKey: .maximum)
            )
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(basis, forKey: .basis)
        switch self {
        case let .distanceKilometers(minimum, maximum):
            try container.encode(minimum, forKey: .minimum)
            try container.encode(maximum, forKey: .maximum)
        case let .durationMinutes(minimum, maximum):
            try container.encode(minimum, forKey: .minimum)
            try container.encode(maximum, forKey: .maximum)
        }
    }
}

nonisolated enum HikingPreferredRouteShapeV1: String, CaseIterable, Codable, Hashable, Sendable {
    case loop
    case pointToPoint = "point_to_point"

    init?(_ routeType: TrailRouteType) {
        switch routeType {
        case .loop:
            self = .loop
        case .pointToPoint:
            self = .pointToPoint
        case .multiDay:
            return nil
        }
    }

    var routeType: TrailRouteType {
        switch self {
        case .loop: .loop
        case .pointToPoint: .pointToPoint
        }
    }
}

nonisolated enum HikingRequestedExperienceV1: String, CaseIterable, Codable, Hashable, Sendable {
    case viewpoints
    case forest
    case quietNature = "quiet_nature"
    case waterfalls
    case lakes
    case peaks
    case huts
    case landmarks
}

nonisolated enum HikingSoftAvoidanceV1: String, CaseIterable, Codable, Hashable, Sendable {
    case steepClimbs = "steep_climbs"
    case majorRoads = "major_roads"
    case repeatedSections = "repeated_sections"
}

nonisolated struct HikingPreferenceProfileMetadataV1: Codable, Hashable, Sendable {
    static let currentSchemaVersion = 1
    /// Leaves one signed-64-bit revision available for an owner deletion after
    /// the final storable edit. PostgreSQL `bigint` is the remote boundary.
    static let maximumPersistedRevision = UInt64(Int64.max - 2)

    var schemaVersion: Int
    var profileID: UUID
    var onboardingVersion: String
    var revision: UInt64
    var createdAt: Date
    var updatedAt: Date

    init(
        schemaVersion: Int = HikingPreferenceProfileMetadataV1.currentSchemaVersion,
        profileID: UUID = UUID(),
        onboardingVersion: String = "hiking_intelligence_v1",
        revision: UInt64 = 0,
        createdAt: Date = Date(),
        updatedAt: Date? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.profileID = profileID
        self.onboardingVersion = onboardingVersion
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
    }
}

/// Versioned, nil-preserving preferences for route defaults. Every field is
/// optional by design: `nil` means unknown/skipped, while an empty array means
/// the user explicitly selected no preferences in that category.
nonisolated struct HikingPreferenceProfileV1: Codable, Hashable, Sendable {
    var metadata: HikingPreferenceProfileMetadataV1
    var defaultActivity: HikingProfileActivityV1?
    var comfortableOuting: HikingComfortableOutingV1?
    var preferredRouteShape: HikingPreferredRouteShapeV1?
    var requestedExperiences: [HikingRequestedExperienceV1]?
    var softAvoidances: [HikingSoftAvoidanceV1]?

    init(
        metadata: HikingPreferenceProfileMetadataV1 = HikingPreferenceProfileMetadataV1(),
        defaultActivity: HikingProfileActivityV1? = nil,
        comfortableOuting: HikingComfortableOutingV1? = nil,
        preferredRouteShape: HikingPreferredRouteShapeV1? = nil,
        requestedExperiences: [HikingRequestedExperienceV1]? = nil,
        softAvoidances: [HikingSoftAvoidanceV1]? = nil
    ) {
        self.metadata = metadata
        self.defaultActivity = defaultActivity
        self.comfortableOuting = comfortableOuting
        self.preferredRouteShape = preferredRouteShape
        self.requestedExperiences = requestedExperiences
        self.softAvoidances = softAvoidances
    }
}

nonisolated enum HikingProfileValidationIssueV1: Equatable, Sendable {
    case unsupportedSchemaVersion(Int)
    case invalidOnboardingVersion
    case invalidRevision
    case invalidMetadataTimestamp
    case invalidMetadataChronology
    case invalidDistanceRange
    case invalidDurationRange
    case tooManyRequestedExperiences(actual: Int, maximum: Int)
    case duplicateRequestedExperience(HikingRequestedExperienceV1)
    case tooManySoftAvoidances(actual: Int, maximum: Int)
    case duplicateSoftAvoidance(HikingSoftAvoidanceV1)
}

nonisolated struct HikingProfileValidationErrorV1: Error, Equatable, Sendable {
    let issues: [HikingProfileValidationIssueV1]
}

nonisolated enum HikingPreferenceProfileValidatorV1 {
    static let maximumRequestedExperienceCount = 8
    static let maximumSoftAvoidanceCount = 3
    static let distanceBoundsKilometers = 1.0...300.0
    static let durationBoundsMinutes = 15...1_440

    static func validate(_ profile: HikingPreferenceProfileV1) throws {
        var issues: [HikingProfileValidationIssueV1] = []

        if profile.metadata.schemaVersion != HikingPreferenceProfileMetadataV1.currentSchemaVersion {
            issues.append(.unsupportedSchemaVersion(profile.metadata.schemaVersion))
        }
        if !isValidVersionIdentifier(profile.metadata.onboardingVersion) {
            issues.append(.invalidOnboardingVersion)
        }
        if profile.metadata.revision > HikingPreferenceProfileMetadataV1.maximumPersistedRevision {
            issues.append(.invalidRevision)
        }
        if !HikingProfileDateCodingV1.canEncode(profile.metadata.createdAt) ||
            !HikingProfileDateCodingV1.canEncode(profile.metadata.updatedAt) {
            issues.append(.invalidMetadataTimestamp)
        } else if profile.metadata.updatedAt < profile.metadata.createdAt {
            issues.append(.invalidMetadataChronology)
        }

        if let comfortableOuting = profile.comfortableOuting {
            switch comfortableOuting {
            case let .distanceKilometers(minimum, maximum):
                if !minimum.isFinite || !maximum.isFinite ||
                    !distanceBoundsKilometers.contains(minimum) ||
                    !distanceBoundsKilometers.contains(maximum) ||
                    minimum > maximum ||
                    !hasAtMostOneFractionDigit(minimum) ||
                    !hasAtMostOneFractionDigit(maximum) {
                    issues.append(.invalidDistanceRange)
                }
            case let .durationMinutes(minimum, maximum):
                if !durationBoundsMinutes.contains(minimum) ||
                    !durationBoundsMinutes.contains(maximum) ||
                    minimum > maximum {
                    issues.append(.invalidDurationRange)
                }
            }
        }

        validateRequestedExperiences(profile.requestedExperiences, issues: &issues)
        validateSoftAvoidances(profile.softAvoidances, issues: &issues)

        guard issues.isEmpty else {
            throw HikingProfileValidationErrorV1(issues: issues)
        }
    }

    static func canonicalized(_ profile: HikingPreferenceProfileV1) throws -> HikingPreferenceProfileV1 {
        try validate(profile)
        var result = profile
        result.metadata.createdAt = HikingProfileDateCodingV1.canonicalDate(profile.metadata.createdAt)
        result.metadata.updatedAt = HikingProfileDateCodingV1.canonicalDate(profile.metadata.updatedAt)
        result.requestedExperiences = profile.requestedExperiences?.sorted { $0.rawValue < $1.rawValue }
        result.softAvoidances = profile.softAvoidances?.sorted { $0.rawValue < $1.rawValue }
        return result
    }

    private static func validateRequestedExperiences(
        _ values: [HikingRequestedExperienceV1]?,
        issues: inout [HikingProfileValidationIssueV1]
    ) {
        guard let values else { return }
        if values.count > maximumRequestedExperienceCount {
            issues.append(
                .tooManyRequestedExperiences(
                    actual: values.count,
                    maximum: maximumRequestedExperienceCount
                )
            )
        }
        appendDuplicateIssues(
            values,
            makeIssue: HikingProfileValidationIssueV1.duplicateRequestedExperience,
            issues: &issues
        )
    }

    private static func validateSoftAvoidances(
        _ values: [HikingSoftAvoidanceV1]?,
        issues: inout [HikingProfileValidationIssueV1]
    ) {
        guard let values else { return }
        if values.count > maximumSoftAvoidanceCount {
            issues.append(
                .tooManySoftAvoidances(
                    actual: values.count,
                    maximum: maximumSoftAvoidanceCount
                )
            )
        }
        appendDuplicateIssues(
            values,
            makeIssue: HikingProfileValidationIssueV1.duplicateSoftAvoidance,
            issues: &issues
        )
    }

    private static func appendDuplicateIssues<Value: Hashable>(
        _ values: [Value],
        makeIssue: (Value) -> HikingProfileValidationIssueV1,
        issues: inout [HikingProfileValidationIssueV1]
    ) {
        var seen = Set<Value>()
        var reported = Set<Value>()
        for value in values where !seen.insert(value).inserted && reported.insert(value).inserted {
            issues.append(makeIssue(value))
        }
    }

    private static func isValidVersionIdentifier(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard (1...32).contains(bytes.count),
              let first = bytes.first,
              isLowercaseASCIIAlphanumeric(first)
        else { return false }
        return bytes.dropFirst().allSatisfy {
            isLowercaseASCIIAlphanumeric($0) || $0 == 95
        }
    }

    private static func isLowercaseASCIIAlphanumeric(_ byte: UInt8) -> Bool {
        (48...57).contains(byte) || (97...122).contains(byte)
    }

    private static func hasAtMostOneFractionDigit(_ value: Double) -> Bool {
        let scaled = value * 10
        return scaled.isFinite && abs(scaled - scaled.rounded()) <= 0.000_000_001
    }
}

nonisolated enum HikingPreferenceProfileCodecV1 {
    static func encode(_ profile: HikingPreferenceProfileV1) throws -> Data {
        let canonicalProfile = try HikingPreferenceProfileValidatorV1.canonicalized(profile)
        return try makeEncoder().encode(canonicalProfile)
    }

    static func decode(_ data: Data) throws -> HikingPreferenceProfileV1 {
        let profile = try makeDecoder().decode(HikingPreferenceProfileV1.self, from: data)
        return try HikingPreferenceProfileValidatorV1.canonicalized(profile)
    }

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(HikingProfileDateCodingV1.millisecondsSince1970(date))
        }
        return encoder
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let milliseconds = try container.decode(Int64.self)
            return HikingProfileDateCodingV1.date(millisecondsSince1970: milliseconds)
        }
        return decoder
    }
}

nonisolated private enum HikingProfileDateCodingV1 {
    private static let integerSafetyMargin: Int64 = 1_024

    static func canEncode(_ date: Date) -> Bool {
        let milliseconds = date.timeIntervalSince1970 * 1_000
        return milliseconds.isFinite &&
            milliseconds >= Double(Int64.min + integerSafetyMargin) &&
            milliseconds <= Double(Int64.max - integerSafetyMargin)
    }

    static func millisecondsSince1970(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1_000).rounded())
    }

    static func date(millisecondsSince1970: Int64) -> Date {
        Date(timeIntervalSince1970: Double(millisecondsSince1970) / 1_000)
    }

    static func canonicalDate(_ date: Date) -> Date {
        self.date(millisecondsSince1970: millisecondsSince1970(date))
    }
}

nonisolated struct HikingOnboardingDraftV1: Codable, Hashable, Sendable {
    static let currentSchemaVersion = 1

    var schemaVersion: Int
    var draftID: UUID
    var flowVersion: String
    var currentStepID: String
    var profile: HikingPreferenceProfileV1
    var startedAt: Date
    var updatedAt: Date

    init(
        schemaVersion: Int = HikingOnboardingDraftV1.currentSchemaVersion,
        draftID: UUID = UUID(),
        flowVersion: String = "perfect_day_v1",
        currentStepID: String,
        profile: HikingPreferenceProfileV1 = HikingPreferenceProfileV1(),
        startedAt: Date = Date(),
        updatedAt: Date? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.draftID = draftID
        self.flowVersion = flowVersion
        self.currentStepID = currentStepID
        self.profile = profile
        self.startedAt = startedAt
        self.updatedAt = updatedAt ?? startedAt
    }
}

nonisolated enum HikingOnboardingDraftValidationIssueV1: Equatable, Sendable {
    case unsupportedSchemaVersion(Int)
    case invalidFlowVersion
    case invalidCurrentStepID
    case invalidMetadataTimestamp
    case invalidMetadataChronology
    case invalidProfile([HikingProfileValidationIssueV1])
}

nonisolated struct HikingOnboardingDraftValidationErrorV1: Error, Equatable, Sendable {
    let issues: [HikingOnboardingDraftValidationIssueV1]
}

nonisolated enum HikingOnboardingDraftValidatorV1 {
    static func canonicalized(_ draft: HikingOnboardingDraftV1) throws -> HikingOnboardingDraftV1 {
        var issues: [HikingOnboardingDraftValidationIssueV1] = []
        if draft.schemaVersion != HikingOnboardingDraftV1.currentSchemaVersion {
            issues.append(.unsupportedSchemaVersion(draft.schemaVersion))
        }
        if !isBoundedIdentifier(draft.flowVersion, maximumByteCount: 32) {
            issues.append(.invalidFlowVersion)
        }
        if !isBoundedIdentifier(draft.currentStepID, maximumByteCount: 64) {
            issues.append(.invalidCurrentStepID)
        }
        if !HikingProfileDateCodingV1.canEncode(draft.startedAt) ||
            !HikingProfileDateCodingV1.canEncode(draft.updatedAt) {
            issues.append(.invalidMetadataTimestamp)
        } else if draft.updatedAt < draft.startedAt {
            issues.append(.invalidMetadataChronology)
        }

        let canonicalProfile: HikingPreferenceProfileV1
        do {
            canonicalProfile = try HikingPreferenceProfileValidatorV1.canonicalized(draft.profile)
        } catch let error as HikingProfileValidationErrorV1 {
            issues.append(.invalidProfile(error.issues))
            canonicalProfile = draft.profile
        }

        guard issues.isEmpty else {
            throw HikingOnboardingDraftValidationErrorV1(issues: issues)
        }
        var result = draft
        result.profile = canonicalProfile
        result.startedAt = HikingProfileDateCodingV1.canonicalDate(draft.startedAt)
        result.updatedAt = HikingProfileDateCodingV1.canonicalDate(draft.updatedAt)
        return result
    }

    private static func isBoundedIdentifier(_ value: String, maximumByteCount: Int) -> Bool {
        guard (1...maximumByteCount).contains(value.utf8.count) else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            switch scalar.value {
            case 45, 46, 48...57, 65...90, 95, 97...122:
                true
            default:
                false
            }
        }
    }
}
