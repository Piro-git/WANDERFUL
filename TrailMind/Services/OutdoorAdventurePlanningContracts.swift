import CoreFoundation
import Foundation

enum AdventureResearchActivityV1: String, Encodable, Hashable, Sendable {
    case hiking
    case trailRunning = "trail_running"
    case biking
}

enum AdventureResearchRouteTypeV1: String, Encodable, Hashable, Sendable {
    case loop
    case pointToPoint = "point_to_point"
    case outAndBack = "out_and_back"
}

enum AdventureResearchTechnicalDifficultyV1: String, Encodable, Hashable, Sendable {
    case strolling
    case hiking
    case mountainHiking = "mountain_hiking"
    case demandingMountainHiking = "demanding_mountain_hiking"
    case alpineHiking = "alpine_hiking"
    case demandingAlpineHiking = "demanding_alpine_hiking"
    case difficultAlpineHiking = "difficult_alpine_hiking"
}

enum AdventureResearchExperienceV1: String, Encodable, Hashable, Sendable {
    case viewpoint
    case waterfall
    case peak
    case lake
    case forest
    case quietTrails = "quiet_trails"
    case officialHikingRoute = "official_hiking_route"
    case alpineHut = "alpine_hut"
    case wildernessHut = "wilderness_hut"
    case landmark
}

enum AdventureResearchAvoidedExperienceV1: String, Encodable, Hashable, Sendable {
    case exposedTrails = "exposed_trails"
    case technicalTerrain = "technical_terrain"
    case majorRoads = "major_roads"
    case steepClimbs = "steep_climbs"
    case repeatedPath = "repeated_path"
    case crowds
    case unpavedSurface = "unpaved_surface"
}

enum AdventureResearchRequiredFacilityV1: String, Encodable, Hashable, Sendable {
    case drinkingWater = "drinking_water"
    case lunchHut = "lunch_hut"
    case emergencyShelter = "emergency_shelter"
    case publicTransport = "public_transport"
    case officialCampsite = "official_campsite"
    case designatedBivouac = "designated_bivouac"
    case toilets
}

enum AdventureResearchAnchorRequirementV1: String, Encodable, Hashable, Sendable {
    case locationRequired = "location_required"
    case startRequired = "start_required"
    case destinationRequired = "destination_required"
}

enum AdventureResearchMobilityV1: String, Encodable, Hashable, Sendable {
    case standard
    case limited
    case unknown
}

enum AdventureResearchExperienceLevelV1: String, Encodable, Hashable, Sendable {
    case beginner
    case intermediate
    case advanced
    case unknown
}

enum AdventureResearchSeasonV1: String, Encodable, Hashable, Sendable {
    case spring
    case summer
    case autumn
    case winter
}

enum AdventureResearchAccommodationTypeV1: String, Encodable, Hashable, Sendable {
    case alpineHut = "alpine_hut"
    case wildernessHut = "wilderness_hut"
    case officialCampsite = "official_campsite"
    case designatedBivouac = "designated_bivouac"
}

enum AdventureResearchArrivalModeV1: String, Encodable, Hashable, Sendable {
    case walking
    case bicycle
    case car
    case publicTransport = "public_transport"
    case unknown
}

enum AdventureResearchClarificationCodeV1: String, Encodable, Hashable, Sendable {
    case locationRequired = "location_required"
    case startRequired = "start_required"
    case destinationRequired = "destination_required"
    case distanceRequired = "distance_required"
    case durationRequired = "duration_required"
    case dateOrSeasonRequired = "date_or_season_required"
    case overnightLegalityRequired = "overnight_legality_required"
    case transportRequirementRequired = "transport_requirement_required"
    case difficultyClarificationRequired = "difficulty_clarification_required"
}

enum AdventureResearchClarificationFieldV1: String, Encodable, Hashable, Sendable {
    case geographicAnchor
    case routeType
    case distanceRangeKm
    case durationRangeMinutes
    case dateOrSeason
    case overnightRequirements
    case transportRequirements
    case maximumTechnicalDifficulty
}

struct AdventureResearchCoordinateV1: Encodable, Equatable, Sendable {
    let latitude: Double
    let longitude: Double

    init(latitude: Double, longitude: Double) throws {
        guard latitude.isFinite, (-90...90).contains(latitude),
              longitude.isFinite, (-180...180).contains(longitude)
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidRequest
        }
        self.latitude = latitude
        self.longitude = longitude
    }
}

struct AdventureResearchDistanceRangeV1: Encodable, Equatable, Sendable {
    let min: Double
    let max: Double

    init(min: Double, max: Double) throws {
        guard min.isFinite, max.isFinite,
              (0.1...500).contains(min),
              (0.1...500).contains(max),
              min <= max
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidRequest
        }
        self.min = min
        self.max = max
    }
}

struct AdventureResearchDurationRangeV1: Encodable, Equatable, Sendable {
    let min: Int
    let max: Int

    init(min: Int, max: Int) throws {
        guard (15...10_080).contains(min),
              (15...10_080).contains(max),
              min <= max
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidRequest
        }
        self.min = min
        self.max = max
    }
}

enum AdventureResearchGeographicAnchorV1: Encodable, Equatable, Sendable {
    case resolved(
        name: String,
        coordinate: AdventureResearchCoordinateV1,
        regionEntityID: UUID?
    )
    case unresolved(requirementCode: AdventureResearchAnchorRequirementV1)

    private enum CodingKeys: String, CodingKey {
        case state
        case name
        case coordinate
        case regionEntityId
        case requirementCode
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .resolved(name, coordinate, regionEntityID):
            try container.encode("resolved", forKey: .state)
            try container.encode(name, forKey: .name)
            try container.encode(coordinate, forKey: .coordinate)
            if let regionEntityID {
                try container.encode(
                    regionEntityID.uuidString.lowercased(),
                    forKey: .regionEntityId
                )
            } else {
                try container.encodeNil(forKey: .regionEntityId)
            }
        case let .unresolved(requirementCode):
            try container.encode("unresolved", forKey: .state)
            try container.encode(requirementCode, forKey: .requirementCode)
        }
    }

    fileprivate func validate() throws {
        if case let .resolved(name, _, _) = self {
            guard OutdoorAdventurePlanningContractValidationV1.isBoundedString(
                name,
                minimumUTF16Length: 1,
                maximumUTF16Length: 160,
                rejectsHTMLDelimiters: true,
                rejectsAllControlCharacters: false
            ) else {
                throw OutdoorAdventurePlanningClientFailure.invalidRequest
            }
        }
    }
}

struct AdventureResearchExperienceRequirementV1: Encodable, Equatable, Sendable {
    let experience: AdventureResearchExperienceV1
    let minimumCount: Int

    init(
        experience: AdventureResearchExperienceV1,
        minimumCount: Int
    ) throws {
        guard (1...8).contains(minimumCount) else {
            throw OutdoorAdventurePlanningClientFailure.invalidRequest
        }
        self.experience = experience
        self.minimumCount = minimumCount
    }
}

struct AdventureResearchGroupContextV1: Encodable, Equatable, Sendable {
    let partySize: Int
    let includesChildren: Bool
    let youngestAge: Int?
    let mobility: AdventureResearchMobilityV1
    let experienceLevel: AdventureResearchExperienceLevelV1

    init(
        partySize: Int,
        includesChildren: Bool,
        youngestAge: Int?,
        mobility: AdventureResearchMobilityV1,
        experienceLevel: AdventureResearchExperienceLevelV1
    ) throws {
        let youngestAgeIsValid = youngestAge.map(
            { (0...17).contains($0) }
        ) ?? true
        guard (1...100).contains(partySize),
              youngestAgeIsValid,
              includesChildren == (youngestAge != nil)
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidRequest
        }
        self.partySize = partySize
        self.includesChildren = includesChildren
        self.youngestAge = youngestAge
        self.mobility = mobility
        self.experienceLevel = experienceLevel
    }

    private enum CodingKeys: String, CodingKey {
        case partySize
        case includesChildren
        case youngestAge
        case mobility
        case experienceLevel
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(partySize, forKey: .partySize)
        try container.encode(includesChildren, forKey: .includesChildren)
        if let youngestAge {
            try container.encode(youngestAge, forKey: .youngestAge)
        } else {
            try container.encodeNil(forKey: .youngestAge)
        }
        try container.encode(mobility, forKey: .mobility)
        try container.encode(experienceLevel, forKey: .experienceLevel)
    }
}

enum AdventureResearchDateOrSeasonV1: Encodable, Equatable, Sendable {
    case date(String)
    case season(AdventureResearchSeasonV1, year: Int?)

    private enum CodingKeys: String, CodingKey {
        case kind
        case date
        case season
        case year
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .date(value):
            try container.encode("date", forKey: .kind)
            try container.encode(value, forKey: .date)
        case let .season(season, year):
            try container.encode("season", forKey: .kind)
            try container.encode(season, forKey: .season)
            if let year {
                try container.encode(year, forKey: .year)
            } else {
                try container.encodeNil(forKey: .year)
            }
        }
    }

    fileprivate func validate() throws {
        switch self {
        case let .date(value):
            guard OutdoorAdventurePlanningContractValidationV1.isStrictISODate(value) else {
                throw OutdoorAdventurePlanningClientFailure.invalidRequest
            }
        case let .season(_, year):
            let yearIsValid = year.map(
                { (2020...2100).contains($0) }
            ) ?? true
            guard yearIsValid else {
                throw OutdoorAdventurePlanningClientFailure.invalidRequest
            }
        }
    }
}

struct AdventureResearchOvernightRequirementsV1: Encodable, Equatable, Sendable {
    let required: Bool
    let nights: Int
    let allowedAccommodationTypes: [AdventureResearchAccommodationTypeV1]

    init(
        required: Bool,
        nights: Int,
        allowedAccommodationTypes: [AdventureResearchAccommodationTypeV1]
    ) throws {
        guard (0...30).contains(nights),
              allowedAccommodationTypes.count <= 8,
              Set(allowedAccommodationTypes).count == allowedAccommodationTypes.count,
              required
                ? nights >= 1 && !allowedAccommodationTypes.isEmpty
                : nights == 0 && allowedAccommodationTypes.isEmpty
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidRequest
        }
        self.required = required
        self.nights = nights
        self.allowedAccommodationTypes = allowedAccommodationTypes
    }
}

struct AdventureResearchTransportRequirementsV1: Encodable, Equatable, Sendable {
    let arrivalMode: AdventureResearchArrivalModeV1
    let returnToStart: Bool
    let publicTransportRequired: Bool

    init(
        arrivalMode: AdventureResearchArrivalModeV1,
        returnToStart: Bool,
        publicTransportRequired: Bool
    ) {
        self.arrivalMode = arrivalMode
        self.returnToStart = returnToStart
        self.publicTransportRequired = publicTransportRequired
    }
}

struct AdventureResearchClarificationQuestionV1: Encodable, Equatable, Hashable, Sendable {
    let code: AdventureResearchClarificationCodeV1
    let field: AdventureResearchClarificationFieldV1

    init(
        code: AdventureResearchClarificationCodeV1,
        field: AdventureResearchClarificationFieldV1
    ) {
        self.code = code
        self.field = field
    }
}

struct AdventureResearchIntentV1: Encodable, Equatable, Sendable {
    let schemaVersion = 1
    let activity: AdventureResearchActivityV1
    let geographicAnchor: AdventureResearchGeographicAnchorV1
    let routeType: AdventureResearchRouteTypeV1
    let distanceRangeKm: AdventureResearchDistanceRangeV1?
    let durationRangeMinutes: AdventureResearchDurationRangeV1?
    let maximumElevationGainMeters: Int?
    let maximumTechnicalDifficulty: AdventureResearchTechnicalDifficultyV1?
    let mustHaveExperiences: [AdventureResearchExperienceRequirementV1]
    let preferredExperiences: [AdventureResearchExperienceV1]
    let avoidedExperiences: [AdventureResearchAvoidedExperienceV1]
    let requiredFacilities: [AdventureResearchRequiredFacilityV1]
    let groupContext: AdventureResearchGroupContextV1
    let dateOrSeason: AdventureResearchDateOrSeasonV1?
    let overnightRequirements: AdventureResearchOvernightRequirementsV1
    let transportRequirements: AdventureResearchTransportRequirementsV1
    let unresolvedClarificationQuestions: [AdventureResearchClarificationQuestionV1]

    init(
        activity: AdventureResearchActivityV1,
        geographicAnchor: AdventureResearchGeographicAnchorV1,
        routeType: AdventureResearchRouteTypeV1,
        distanceRangeKm: AdventureResearchDistanceRangeV1?,
        durationRangeMinutes: AdventureResearchDurationRangeV1?,
        maximumElevationGainMeters: Int?,
        maximumTechnicalDifficulty: AdventureResearchTechnicalDifficultyV1?,
        mustHaveExperiences: [AdventureResearchExperienceRequirementV1],
        preferredExperiences: [AdventureResearchExperienceV1],
        avoidedExperiences: [AdventureResearchAvoidedExperienceV1],
        requiredFacilities: [AdventureResearchRequiredFacilityV1],
        groupContext: AdventureResearchGroupContextV1,
        dateOrSeason: AdventureResearchDateOrSeasonV1?,
        overnightRequirements: AdventureResearchOvernightRequirementsV1,
        transportRequirements: AdventureResearchTransportRequirementsV1,
        unresolvedClarificationQuestions: [AdventureResearchClarificationQuestionV1]
    ) throws {
        try geographicAnchor.validate()
        try dateOrSeason?.validate()
        let maximumElevationIsValid = maximumElevationGainMeters.map(
            { (0...20_000).contains($0) }
        ) ?? true
        guard maximumElevationIsValid,
              Self.isUnique(mustHaveExperiences.map(\.experience), maximum: 16),
              Self.isUnique(preferredExperiences, maximum: 16),
              Self.isUnique(avoidedExperiences, maximum: 16),
              Self.isUnique(requiredFacilities, maximum: 16),
              unresolvedClarificationQuestions.count <= 16
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidRequest
        }
        if case .unresolved = geographicAnchor {
            guard unresolvedClarificationQuestions.contains(where: {
                $0.code == .locationRequired || $0.code == .startRequired
            }) else {
                throw OutdoorAdventurePlanningClientFailure.invalidRequest
            }
        }

        self.activity = activity
        self.geographicAnchor = geographicAnchor
        self.routeType = routeType
        self.distanceRangeKm = distanceRangeKm
        self.durationRangeMinutes = durationRangeMinutes
        self.maximumElevationGainMeters = maximumElevationGainMeters
        self.maximumTechnicalDifficulty = maximumTechnicalDifficulty
        self.mustHaveExperiences = mustHaveExperiences
        self.preferredExperiences = preferredExperiences
        self.avoidedExperiences = avoidedExperiences
        self.requiredFacilities = requiredFacilities
        self.groupContext = groupContext
        self.dateOrSeason = dateOrSeason
        self.overnightRequirements = overnightRequirements
        self.transportRequirements = transportRequirements
        self.unresolvedClarificationQuestions = unresolvedClarificationQuestions
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case activity
        case geographicAnchor
        case routeType
        case distanceRangeKm
        case durationRangeMinutes
        case maximumElevationGainMeters
        case maximumTechnicalDifficulty
        case mustHaveExperiences
        case preferredExperiences
        case avoidedExperiences
        case requiredFacilities
        case groupContext
        case dateOrSeason
        case overnightRequirements
        case transportRequirements
        case unresolvedClarificationQuestions
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(activity, forKey: .activity)
        try container.encode(geographicAnchor, forKey: .geographicAnchor)
        try container.encode(routeType, forKey: .routeType)
        try Self.encodeNullable(distanceRangeKm, to: &container, forKey: .distanceRangeKm)
        try Self.encodeNullable(
            durationRangeMinutes,
            to: &container,
            forKey: .durationRangeMinutes
        )
        try Self.encodeNullable(
            maximumElevationGainMeters,
            to: &container,
            forKey: .maximumElevationGainMeters
        )
        try Self.encodeNullable(
            maximumTechnicalDifficulty,
            to: &container,
            forKey: .maximumTechnicalDifficulty
        )
        try container.encode(mustHaveExperiences, forKey: .mustHaveExperiences)
        try container.encode(preferredExperiences, forKey: .preferredExperiences)
        try container.encode(avoidedExperiences, forKey: .avoidedExperiences)
        try container.encode(requiredFacilities, forKey: .requiredFacilities)
        try container.encode(groupContext, forKey: .groupContext)
        try Self.encodeNullable(dateOrSeason, to: &container, forKey: .dateOrSeason)
        try container.encode(overnightRequirements, forKey: .overnightRequirements)
        try container.encode(transportRequirements, forKey: .transportRequirements)
        try container.encode(
            unresolvedClarificationQuestions,
            forKey: .unresolvedClarificationQuestions
        )
    }

    private static func encodeNullable<Value: Encodable>(
        _ value: Value?,
        to container: inout KeyedEncodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) throws {
        if let value {
            try container.encode(value, forKey: key)
        } else {
            try container.encodeNil(forKey: key)
        }
    }

    private static func isUnique<Value: Hashable>(
        _ values: [Value],
        maximum: Int
    ) -> Bool {
        values.count <= maximum && Set(values).count == values.count
    }
}

struct OutdoorAdventurePlanningRequestV1: Encodable, Equatable, Sendable {
    let schemaVersion = 1
    let intent: AdventureResearchIntentV1

    init(intent: AdventureResearchIntentV1) {
        self.intent = intent
    }
}

enum OutdoorAdventurePlanningStateV1: String, Equatable, Sendable {
    case clarificationRequired = "clarification_required"
    case unsupported
    case noViableRoute = "no_viable_route"
    case partial
    case routed
}

enum OutdoorAdventurePlanningGapCodeV1: String, Hashable, Sendable {
    case unsupportedRegion = "unsupported_region"
    case unsupportedEvidenceDimension = "unsupported_evidence_dimension"
    case officialSourceUnavailable = "official_source_unavailable"
    case currentSourceUnavailable = "current_source_unavailable"
    case mappedSourceUnavailable = "mapped_source_unavailable"
    case derivedSourceUnavailable = "derived_source_unavailable"
    case operationTypeUnavailable = "operation_type_unavailable"
    case predicateUnavailable = "predicate_unavailable"
    case transportEvidenceNotModeled = "transport_evidence_not_modeled"
    case bikingNetworkNotModeled = "biking_network_not_modeled"
    case toiletEvidenceNotModeled = "toilet_evidence_not_modeled"
    case scenicQualityNotVerifiable = "scenic_quality_not_verifiable"
    case waterAvailabilitySourceMissing = "water_availability_source_missing"
}

enum OutdoorAdventurePlanningGapAffectedFieldV1: String, Hashable, Sendable {
    case activity
    case geographicAnchor
    case maximumElevationGainMeters
    case maximumTechnicalDifficulty
    case mustHaveExperiences
    case preferredExperiences
    case avoidedExperiences
    case requiredFacilities
    case groupContext
    case dateOrSeason
    case overnightRequirements
    case transportRequirements
    case capabilities
    case researchPlan
}

enum OutdoorAdventurePlanningGapReasonV1: String, Hashable, Sendable {
    case coverageNotConfigured = "coverage_not_configured"
    case contractDimensionMissing = "contract_dimension_missing"
    case acceptedSourceNotAvailable = "accepted_source_not_available"
    case operationNotEnabled = "operation_not_enabled"
    case predicateNotSupported = "predicate_not_supported"
    case authorityNotAvailable = "authority_not_available"
    case currentEvidenceNotAvailable = "current_evidence_not_available"
    case clarificationNeeded = "clarification_needed"
}

struct OutdoorAdventurePlanningGapV1: Equatable, Hashable, Sendable {
    let code: OutdoorAdventurePlanningGapCodeV1
    let affectedField: OutdoorAdventurePlanningGapAffectedFieldV1
    let affectedValue: String?
    let reason: OutdoorAdventurePlanningGapReasonV1
    let requiresClarification: Bool
    let requiresCapability: Bool
}

struct OutdoorAdventurePlanningNonRoutedStateV1: Equatable, Sendable {
    let state: OutdoorAdventurePlanningStateV1
    let normalizedIntent: AdventureResearchIntentV1
    let planningGaps: [OutdoorAdventurePlanningGapV1]
    let clarificationQuestions: [AdventureResearchClarificationQuestionV1]
}

struct OutdoorAdventurePlanningRoutedStateV1 {
    let state: OutdoorAdventurePlanningStateV1
    let normalizedIntent: AdventureResearchIntentV1
    let planningGaps: [OutdoorAdventurePlanningGapV1]
    let routeSelection: ResearchGuidedRouteSelectionV1
}

enum OutdoorAdventurePlanningResultV1 {
    case clarificationRequired(OutdoorAdventurePlanningNonRoutedStateV1)
    case unsupported(OutdoorAdventurePlanningNonRoutedStateV1)
    case noViableRoute(OutdoorAdventurePlanningNonRoutedStateV1)
    case partial(OutdoorAdventurePlanningRoutedStateV1)
    case routed(OutdoorAdventurePlanningRoutedStateV1)

    var state: OutdoorAdventurePlanningStateV1 {
        switch self {
        case .clarificationRequired: .clarificationRequired
        case .unsupported: .unsupported
        case .noViableRoute: .noViableRoute
        case .partial: .partial
        case .routed: .routed
        }
    }
}

enum OutdoorAdventurePlanningClientFailure: LocalizedError, Equatable, Sendable {
    case invalidRequest
    case requestTooLarge
    case unavailable
    case authorizationFailed
    case rateLimited
    case timedOut
    case rejected
    case invalidResponse
    case responseTooLarge

    var errorDescription: String? {
        switch self {
        case .invalidRequest, .requestTooLarge, .rejected:
            "TrailMind couldn’t use this planning request."
        case .authorizationFailed:
            "TrailMind couldn’t authorize outdoor planning."
        case .rateLimited:
            "Outdoor planning is temporarily busy. Please try again."
        case .timedOut:
            "Outdoor planning took too long. Please try again."
        case .invalidResponse, .responseTooLarge:
            "TrailMind couldn’t verify the planning result."
        case .unavailable:
            "Outdoor planning is currently unavailable."
        }
    }
}

private enum OutdoorAdventurePlanningContractValidationV1 {
    static let intentFields = [
        "schemaVersion",
        "activity",
        "geographicAnchor",
        "routeType",
        "distanceRangeKm",
        "durationRangeMinutes",
        "maximumElevationGainMeters",
        "maximumTechnicalDifficulty",
        "mustHaveExperiences",
        "preferredExperiences",
        "avoidedExperiences",
        "requiredFacilities",
        "groupContext",
        "dateOrSeason",
        "overnightRequirements",
        "transportRequirements",
        "unresolvedClarificationQuestions"
    ]

    static func isBoundedString(
        _ value: String,
        minimumUTF16Length: Int,
        maximumUTF16Length: Int,
        rejectsHTMLDelimiters: Bool,
        rejectsAllControlCharacters: Bool
    ) -> Bool {
        let length = value.utf16.count
        guard length >= minimumUTF16Length,
              length <= maximumUTF16Length,
              value == value.trimmingCharacters(in: .whitespacesAndNewlines)
        else {
            return false
        }
        if rejectsHTMLDelimiters, value.contains("<") || value.contains(">") {
            return false
        }
        return !value.unicodeScalars.contains { scalar in
            let code = scalar.value
            if rejectsAllControlCharacters {
                return code <= 0x1F || code == 0x7F
            }
            return code <= 0x08 ||
                code == 0x0B ||
                code == 0x0C ||
                (0x0E...0x1F).contains(code) ||
                code == 0x7F
        }
    }

    static func isStrictISODate(_ value: String) -> Bool {
        guard value.range(
            of: #"^\d{4}-\d{2}-\d{2}$"#,
            options: .regularExpression
        ) != nil else {
            return false
        }
        let components = value.split(separator: "-").compactMap { Int($0) }
        guard components.count == 3 else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let dateComponents = DateComponents(
            calendar: calendar,
            timeZone: calendar.timeZone,
            year: components[0],
            month: components[1],
            day: components[2]
        )
        guard let date = calendar.date(from: dateComponents) else { return false }
        let resolved = calendar.dateComponents([.year, .month, .day], from: date)
        return resolved.year == components[0] &&
            resolved.month == components[1] &&
            resolved.day == components[2]
    }
}

extension AdventureResearchIntentV1 {
    fileprivate init(validatingJSONObject input: Any) throws {
        let value = try StrictOutdoorAdventurePlanningJSONV1.object(
            input,
            exactKeys: OutdoorAdventurePlanningContractValidationV1.intentFields
        )
        guard try StrictOutdoorAdventurePlanningJSONV1.integer(value["schemaVersion"]) == 1
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }

        let activity = try StrictOutdoorAdventurePlanningJSONV1.enumValue(
            value["activity"],
            as: AdventureResearchActivityV1.self
        )
        let geographicAnchor = try Self.geographicAnchor(
            value["geographicAnchor"]
        )
        let routeType = try StrictOutdoorAdventurePlanningJSONV1.enumValue(
            value["routeType"],
            as: AdventureResearchRouteTypeV1.self
        )
        let distanceRangeKm = try Self.optionalDistanceRange(
            value["distanceRangeKm"]
        )
        let durationRangeMinutes = try Self.optionalDurationRange(
            value["durationRangeMinutes"]
        )
        let maximumElevationGainMeters = try StrictOutdoorAdventurePlanningJSONV1
            .optionalInteger(value["maximumElevationGainMeters"], in: 0...20_000)
        let maximumTechnicalDifficulty = try StrictOutdoorAdventurePlanningJSONV1
            .optionalEnum(
                value["maximumTechnicalDifficulty"],
                as: AdventureResearchTechnicalDifficultyV1.self
            )
        let mustHaveExperiences = try StrictOutdoorAdventurePlanningJSONV1.array(
            value["mustHaveExperiences"],
            count: 0...16
        ).map { raw -> AdventureResearchExperienceRequirementV1 in
            let requirement = try StrictOutdoorAdventurePlanningJSONV1.object(
                raw,
                exactKeys: ["experience", "minimumCount"]
            )
            return try AdventureResearchExperienceRequirementV1(
                experience: StrictOutdoorAdventurePlanningJSONV1.enumValue(
                    requirement["experience"],
                    as: AdventureResearchExperienceV1.self
                ),
                minimumCount: StrictOutdoorAdventurePlanningJSONV1.integer(
                    requirement["minimumCount"],
                    in: 1...8
                )
            )
        }
        let preferredExperiences = try Self.enumArray(
            value["preferredExperiences"],
            as: AdventureResearchExperienceV1.self
        )
        let avoidedExperiences = try Self.enumArray(
            value["avoidedExperiences"],
            as: AdventureResearchAvoidedExperienceV1.self
        )
        let requiredFacilities = try Self.enumArray(
            value["requiredFacilities"],
            as: AdventureResearchRequiredFacilityV1.self
        )
        let groupContext = try Self.groupContext(value["groupContext"])
        let dateOrSeason = try Self.optionalDateOrSeason(value["dateOrSeason"])
        let overnightRequirements = try Self.overnightRequirements(
            value["overnightRequirements"]
        )
        let transportRequirements = try Self.transportRequirements(
            value["transportRequirements"]
        )
        let clarificationQuestions = try Self.clarificationQuestions(
            value["unresolvedClarificationQuestions"]
        )

        do {
            try self.init(
                activity: activity,
                geographicAnchor: geographicAnchor,
                routeType: routeType,
                distanceRangeKm: distanceRangeKm,
                durationRangeMinutes: durationRangeMinutes,
                maximumElevationGainMeters: maximumElevationGainMeters,
                maximumTechnicalDifficulty: maximumTechnicalDifficulty,
                mustHaveExperiences: mustHaveExperiences,
                preferredExperiences: preferredExperiences,
                avoidedExperiences: avoidedExperiences,
                requiredFacilities: requiredFacilities,
                groupContext: groupContext,
                dateOrSeason: dateOrSeason,
                overnightRequirements: overnightRequirements,
                transportRequirements: transportRequirements,
                unresolvedClarificationQuestions: clarificationQuestions
            )
        } catch {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
    }

    private static func geographicAnchor(
        _ input: Any?
    ) throws -> AdventureResearchGeographicAnchorV1 {
        let value = try StrictOutdoorAdventurePlanningJSONV1.object(input)
        let state = try StrictOutdoorAdventurePlanningJSONV1.string(value["state"])
        if state == "resolved" {
            try StrictOutdoorAdventurePlanningJSONV1.requireExactKeys(
                value,
                ["state", "name", "coordinate", "regionEntityId"]
            )
            let name = try StrictOutdoorAdventurePlanningJSONV1.string(
                value["name"]
            )
            guard OutdoorAdventurePlanningContractValidationV1.isBoundedString(
                name,
                minimumUTF16Length: 1,
                maximumUTF16Length: 160,
                rejectsHTMLDelimiters: true,
                rejectsAllControlCharacters: false
            ) else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            let coordinateObject = try StrictOutdoorAdventurePlanningJSONV1.object(
                value["coordinate"],
                exactKeys: ["latitude", "longitude"]
            )
            let coordinate = try AdventureResearchCoordinateV1(
                latitude: StrictOutdoorAdventurePlanningJSONV1.number(
                    coordinateObject["latitude"],
                    in: -90...90
                ),
                longitude: StrictOutdoorAdventurePlanningJSONV1.number(
                    coordinateObject["longitude"],
                    in: -180...180
                )
            )
            let regionEntityID = try StrictOutdoorAdventurePlanningJSONV1
                .optionalUUID(value["regionEntityId"])
            return .resolved(
                name: name,
                coordinate: coordinate,
                regionEntityID: regionEntityID
            )
        }
        guard state == "unresolved" else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        try StrictOutdoorAdventurePlanningJSONV1.requireExactKeys(
            value,
            ["state", "requirementCode"]
        )
        return .unresolved(
            requirementCode: try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                value["requirementCode"],
                as: AdventureResearchAnchorRequirementV1.self
            )
        )
    }

    private static func optionalDistanceRange(
        _ input: Any?
    ) throws -> AdventureResearchDistanceRangeV1? {
        guard !StrictOutdoorAdventurePlanningJSONV1.isNull(input) else {
            return nil
        }
        let value = try StrictOutdoorAdventurePlanningJSONV1.object(
            input,
            exactKeys: ["min", "max"]
        )
        return try AdventureResearchDistanceRangeV1(
            min: StrictOutdoorAdventurePlanningJSONV1.number(
                value["min"],
                in: 0.1...500
            ),
            max: StrictOutdoorAdventurePlanningJSONV1.number(
                value["max"],
                in: 0.1...500
            )
        )
    }

    private static func optionalDurationRange(
        _ input: Any?
    ) throws -> AdventureResearchDurationRangeV1? {
        guard !StrictOutdoorAdventurePlanningJSONV1.isNull(input) else {
            return nil
        }
        let value = try StrictOutdoorAdventurePlanningJSONV1.object(
            input,
            exactKeys: ["min", "max"]
        )
        return try AdventureResearchDurationRangeV1(
            min: StrictOutdoorAdventurePlanningJSONV1.integer(
                value["min"],
                in: 15...10_080
            ),
            max: StrictOutdoorAdventurePlanningJSONV1.integer(
                value["max"],
                in: 15...10_080
            )
        )
    }

    private static func enumArray<Value>(
        _ input: Any?,
        as type: Value.Type
    ) throws -> [Value] where Value: RawRepresentable & Hashable, Value.RawValue == String {
        let result = try StrictOutdoorAdventurePlanningJSONV1.array(
            input,
            count: 0...16
        ).map {
            try StrictOutdoorAdventurePlanningJSONV1.enumValue($0, as: type)
        }
        guard Set(result).count == result.count else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return result
    }

    private static func groupContext(
        _ input: Any?
    ) throws -> AdventureResearchGroupContextV1 {
        let value = try StrictOutdoorAdventurePlanningJSONV1.object(
            input,
            exactKeys: [
                "partySize",
                "includesChildren",
                "youngestAge",
                "mobility",
                "experienceLevel"
            ]
        )
        do {
            return try AdventureResearchGroupContextV1(
                partySize: StrictOutdoorAdventurePlanningJSONV1.integer(
                    value["partySize"],
                    in: 1...100
                ),
                includesChildren: StrictOutdoorAdventurePlanningJSONV1.boolean(
                    value["includesChildren"]
                ),
                youngestAge: StrictOutdoorAdventurePlanningJSONV1.optionalInteger(
                    value["youngestAge"],
                    in: 0...17
                ),
                mobility: StrictOutdoorAdventurePlanningJSONV1.enumValue(
                    value["mobility"],
                    as: AdventureResearchMobilityV1.self
                ),
                experienceLevel: StrictOutdoorAdventurePlanningJSONV1.enumValue(
                    value["experienceLevel"],
                    as: AdventureResearchExperienceLevelV1.self
                )
            )
        } catch {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
    }

    private static func optionalDateOrSeason(
        _ input: Any?
    ) throws -> AdventureResearchDateOrSeasonV1? {
        guard !StrictOutdoorAdventurePlanningJSONV1.isNull(input) else {
            return nil
        }
        let value = try StrictOutdoorAdventurePlanningJSONV1.object(input)
        let kind = try StrictOutdoorAdventurePlanningJSONV1.string(value["kind"])
        if kind == "date" {
            try StrictOutdoorAdventurePlanningJSONV1.requireExactKeys(
                value,
                ["kind", "date"]
            )
            let date = try StrictOutdoorAdventurePlanningJSONV1.string(value["date"])
            guard OutdoorAdventurePlanningContractValidationV1.isStrictISODate(date) else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            return .date(date)
        }
        guard kind == "season" else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        try StrictOutdoorAdventurePlanningJSONV1.requireExactKeys(
            value,
            ["kind", "season", "year"]
        )
        return .season(
            try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                value["season"],
                as: AdventureResearchSeasonV1.self
            ),
            year: try StrictOutdoorAdventurePlanningJSONV1.optionalInteger(
                value["year"],
                in: 2020...2100
            )
        )
    }

    private static func overnightRequirements(
        _ input: Any?
    ) throws -> AdventureResearchOvernightRequirementsV1 {
        let value = try StrictOutdoorAdventurePlanningJSONV1.object(
            input,
            exactKeys: ["required", "nights", "allowedAccommodationTypes"]
        )
        let accommodations = try StrictOutdoorAdventurePlanningJSONV1.array(
            value["allowedAccommodationTypes"],
            count: 0...8
        ).map {
            try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                $0,
                as: AdventureResearchAccommodationTypeV1.self
            )
        }
        do {
            return try AdventureResearchOvernightRequirementsV1(
                required: StrictOutdoorAdventurePlanningJSONV1.boolean(
                    value["required"]
                ),
                nights: StrictOutdoorAdventurePlanningJSONV1.integer(
                    value["nights"],
                    in: 0...30
                ),
                allowedAccommodationTypes: accommodations
            )
        } catch {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
    }

    private static func transportRequirements(
        _ input: Any?
    ) throws -> AdventureResearchTransportRequirementsV1 {
        let value = try StrictOutdoorAdventurePlanningJSONV1.object(
            input,
            exactKeys: [
                "arrivalMode",
                "returnToStart",
                "publicTransportRequired"
            ]
        )
        return AdventureResearchTransportRequirementsV1(
            arrivalMode: try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                value["arrivalMode"],
                as: AdventureResearchArrivalModeV1.self
            ),
            returnToStart: try StrictOutdoorAdventurePlanningJSONV1.boolean(
                value["returnToStart"]
            ),
            publicTransportRequired: try StrictOutdoorAdventurePlanningJSONV1
                .boolean(value["publicTransportRequired"])
        )
    }

    fileprivate static func clarificationQuestions(
        _ input: Any?
    ) throws -> [AdventureResearchClarificationQuestionV1] {
        try StrictOutdoorAdventurePlanningJSONV1.array(
            input,
            count: 0...16
        ).map { raw in
            let value = try StrictOutdoorAdventurePlanningJSONV1.object(
                raw,
                exactKeys: ["code", "field"]
            )
            return AdventureResearchClarificationQuestionV1(
                code: try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                    value["code"],
                    as: AdventureResearchClarificationCodeV1.self
                ),
                field: try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                    value["field"],
                    as: AdventureResearchClarificationFieldV1.self
                )
            )
        }
    }
}

enum OutdoorAdventurePlanningResponseValidatorV1 {
    private static let policyVersion = "outdoor-adventure-orchestration-v1"
    private static let responseFields = [
        "schemaVersion",
        "policyVersion",
        "state",
        "normalizedIntent",
        "planningGaps",
        "clarificationQuestions",
        "routedAlternatives"
    ]

    static func validate(
        _ data: Data,
        adapter: ResearchGuidedRoutingContractAdapterV1,
        validationDidFinish:
            @Sendable (Duration) -> Void = { _ in }
    ) throws -> OutdoorAdventurePlanningResultV1 {
        let validationStartedAt = ContinuousClock().now
        defer {
            validationDidFinish(
                validationStartedAt.duration(
                    to: ContinuousClock().now
                )
            )
        }
        let root: Any
        do {
            root = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        do {
            let value = try StrictOutdoorAdventurePlanningJSONV1.object(
                root,
                exactKeys: responseFields
            )
            guard try StrictOutdoorAdventurePlanningJSONV1.integer(
                value["schemaVersion"]
            ) == 1,
                try StrictOutdoorAdventurePlanningJSONV1.string(
                    value["policyVersion"]
                ) == policyVersion
            else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            let state = try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                value["state"],
                as: OutdoorAdventurePlanningStateV1.self
            )
            let intent = try AdventureResearchIntentV1(
                validatingJSONObject: value["normalizedIntent"] as Any
            )
            let gaps = try planningGaps(value["planningGaps"])
            let questions = try AdventureResearchIntentV1.clarificationQuestions(
                value["clarificationQuestions"]
            )
            guard Set(questions).count == questions.count else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }

            let routedObject: [String: Any]?
            let selection: ResearchGuidedRouteSelectionV1?
            if StrictOutdoorAdventurePlanningJSONV1.isNull(
                value["routedAlternatives"]
            ) {
                routedObject = nil
                selection = nil
            } else {
                let object = try StrictOutdoorAdventurePlanningJSONV1.object(
                    value["routedAlternatives"]
                )
                let nestedIntent = try AdventureResearchIntentV1(
                    validatingJSONObject: object["normalizedIntent"] as Any
                )
                guard nestedIntent == intent else {
                    throw OutdoorAdventurePlanningClientFailure.invalidResponse
                }
                let nestedData = try JSONSerialization.data(
                    withJSONObject: object,
                    options: [.sortedKeys]
                )
                let validatedSelection: ResearchGuidedRouteSelectionV1
                do {
                    validatedSelection = try adapter.decodeConvertAndSelect(
                        nestedData
                    )
                } catch ResearchGuidedRoutingContractErrorV1.envelopeTooLarge {
                    throw OutdoorAdventurePlanningClientFailure.responseTooLarge
                } catch {
                    throw OutdoorAdventurePlanningClientFailure.invalidResponse
                }
                routedObject = object
                selection = validatedSelection
            }

            return try result(
                state: state,
                intent: intent,
                gaps: gaps,
                questions: questions,
                routedObject: routedObject,
                selection: selection
            )
        } catch let failure as OutdoorAdventurePlanningClientFailure {
            throw failure
        } catch {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
    }

    private static func planningGaps(
        _ input: Any?
    ) throws -> [OutdoorAdventurePlanningGapV1] {
        let gaps = try StrictOutdoorAdventurePlanningJSONV1.array(
            input,
            count: 0...64
        ).map { raw -> OutdoorAdventurePlanningGapV1 in
            let value = try StrictOutdoorAdventurePlanningJSONV1.object(
                raw,
                exactKeys: [
                    "code",
                    "affectedField",
                    "affectedValue",
                    "reason",
                    "requiresClarification",
                    "requiresCapability"
                ]
            )
            let affectedValue: String?
            if StrictOutdoorAdventurePlanningJSONV1.isNull(
                value["affectedValue"]
            ) {
                affectedValue = nil
            } else {
                let candidate = try StrictOutdoorAdventurePlanningJSONV1.string(
                    value["affectedValue"]
                )
                guard OutdoorAdventurePlanningContractValidationV1
                    .isBoundedString(
                        candidate,
                        minimumUTF16Length: 1,
                        maximumUTF16Length: 80,
                        rejectsHTMLDelimiters: false,
                        rejectsAllControlCharacters: true
                    )
                else {
                    throw OutdoorAdventurePlanningClientFailure.invalidResponse
                }
                affectedValue = candidate
            }
            return OutdoorAdventurePlanningGapV1(
                code: try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                    value["code"],
                    as: OutdoorAdventurePlanningGapCodeV1.self
                ),
                affectedField: try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                    value["affectedField"],
                    as: OutdoorAdventurePlanningGapAffectedFieldV1.self
                ),
                affectedValue: affectedValue,
                reason: try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                    value["reason"],
                    as: OutdoorAdventurePlanningGapReasonV1.self
                ),
                requiresClarification: try StrictOutdoorAdventurePlanningJSONV1
                    .boolean(value["requiresClarification"]),
                requiresCapability: try StrictOutdoorAdventurePlanningJSONV1
                    .boolean(value["requiresCapability"])
            )
        }
        guard Set(gaps).count == gaps.count else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return gaps
    }

    private static func result(
        state: OutdoorAdventurePlanningStateV1,
        intent: AdventureResearchIntentV1,
        gaps: [OutdoorAdventurePlanningGapV1],
        questions: [AdventureResearchClarificationQuestionV1],
        routedObject: [String: Any]?,
        selection: ResearchGuidedRouteSelectionV1?
    ) throws -> OutdoorAdventurePlanningResultV1 {
        let nestedState = try routedObject.map {
            try StrictOutdoorAdventurePlanningJSONV1.enumValue(
                $0["state"],
                as: ResearchGuidedRoutedEnvelopeStateV1.self
            )
        }
        let routeResultCount = try routedObject.map(routeResultCount) ?? 0

        if state == .clarificationRequired {
            guard routedObject == nil,
                  !questions.isEmpty,
                  questions == intent.unresolvedClarificationQuestions
            else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            return .clarificationRequired(
                OutdoorAdventurePlanningNonRoutedStateV1(
                    state: state,
                    normalizedIntent: intent,
                    planningGaps: gaps,
                    clarificationQuestions: questions
                )
            )
        }

        guard questions.isEmpty else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        if state == .unsupported {
            guard routedObject == nil ||
                (nestedState == .unsupported && routeResultCount == 0)
            else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            return .unsupported(
                OutdoorAdventurePlanningNonRoutedStateV1(
                    state: state,
                    normalizedIntent: intent,
                    planningGaps: gaps,
                    clarificationQuestions: []
                )
            )
        }
        if state == .noViableRoute {
            guard routedObject == nil ||
                (nestedState == .noViableRoute && routeResultCount == 0)
            else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            return .noViableRoute(
                OutdoorAdventurePlanningNonRoutedStateV1(
                    state: state,
                    normalizedIntent: intent,
                    planningGaps: gaps,
                    clarificationQuestions: []
                )
            )
        }

        guard let selection,
              let nestedState,
              routeResultCount >= 1,
              nestedState == .routed || nestedState == .partial,
              !selection.alternatives.isEmpty
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        if state == .routed {
            guard nestedState == .routed, gaps.isEmpty else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            return .routed(
                OutdoorAdventurePlanningRoutedStateV1(
                    state: state,
                    normalizedIntent: intent,
                    planningGaps: gaps,
                    routeSelection: selection
                )
            )
        }
        guard state == .partial else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return .partial(
            OutdoorAdventurePlanningRoutedStateV1(
                state: state,
                normalizedIntent: intent,
                planningGaps: gaps,
                routeSelection: selection
            )
        )
    }

    private static func routeResultCount(
        _ routedObject: [String: Any]
    ) throws -> Int {
        let attempts = try StrictOutdoorAdventurePlanningJSONV1.array(
            routedObject["attempts"]
        )
        return try attempts.reduce(into: 0) { count, raw in
            let attempt = try StrictOutdoorAdventurePlanningJSONV1.object(raw)
            count += try StrictOutdoorAdventurePlanningJSONV1.array(
                attempt["routeResults"]
            ).count
        }
    }

}

private enum StrictOutdoorAdventurePlanningJSONV1 {
    static func object(
        _ input: Any?,
        exactKeys: [String]? = nil
    ) throws -> [String: Any] {
        guard let value = input as? [String: Any] else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        if let exactKeys {
            try requireExactKeys(value, exactKeys)
        }
        return value
    }

    static func requireExactKeys(
        _ value: [String: Any],
        _ keys: [String]
    ) throws {
        let expected = Set(keys)
        guard value.count == keys.count,
              Set(value.keys) == expected
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
    }

    static func array(
        _ input: Any?,
        count: ClosedRange<Int>? = nil
    ) throws -> [Any] {
        guard let value = input as? [Any],
              count.map({ $0.contains(value.count) }) ?? true
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return value
    }

    static func string(_ input: Any?) throws -> String {
        guard let value = input as? String else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return value
    }

    static func boolean(_ input: Any?) throws -> Bool {
        guard let number = input as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID()
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return number.boolValue
    }

    static func number(
        _ input: Any?,
        in range: ClosedRange<Double>
    ) throws -> Double {
        guard let number = input as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID()
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        let value = number.doubleValue
        guard value.isFinite, range.contains(value) else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return value
    }

    static func integer(_ input: Any?) throws -> Int {
        guard let number = input as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID()
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        let double = number.doubleValue
        guard double.isFinite,
              double.rounded(.towardZero) == double,
              double >= Double(Int.min),
              double <= Double(Int.max)
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return Int(double)
    }

    static func integer(
        _ input: Any?,
        in range: ClosedRange<Int>
    ) throws -> Int {
        let value = try integer(input)
        guard range.contains(value) else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return value
    }

    static func optionalInteger(
        _ input: Any?,
        in range: ClosedRange<Int>
    ) throws -> Int? {
        isNull(input) ? nil : try integer(input, in: range)
    }

    static func optionalUUID(_ input: Any?) throws -> UUID? {
        guard !isNull(input) else { return nil }
        let value = try string(input)
        guard value.range(
            of: #"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"#,
            options: .regularExpression
        ) != nil,
            let uuid = UUID(uuidString: value)
        else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return uuid
    }

    static func enumValue<Value>(
        _ input: Any?,
        as type: Value.Type
    ) throws -> Value where Value: RawRepresentable, Value.RawValue == String {
        guard let value = Value(rawValue: try string(input)) else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
        return value
    }

    static func optionalEnum<Value>(
        _ input: Any?,
        as type: Value.Type
    ) throws -> Value? where Value: RawRepresentable, Value.RawValue == String {
        isNull(input) ? nil : try enumValue(input, as: type)
    }

    static func isNull(_ input: Any?) -> Bool {
        input is NSNull
    }
}
