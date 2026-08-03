import Foundation

enum ActivityType: String, CaseIterable, Codable, Identifiable, Hashable, Sendable {
    case hiking = "Hiking"
    case biking = "Biking"
    case trailRunning = "Trail running"

    var id: Self { self }

    var symbol: String {
        switch self {
        case .hiking: "figure.hiking"
        case .biking: "figure.outdoor.cycle"
        case .trailRunning: "figure.run"
        }
    }
}

enum RouteDifficulty: String, CaseIterable, Codable, Hashable, Sendable {
    case easy = "Easy"
    case moderate = "Moderate"
    case challenging = "Challenging"

    var symbol: String {
        switch self {
        case .easy: "leaf.fill"
        case .moderate: "mountain.2.fill"
        case .challenging: "bolt.fill"
        }
    }

    static func estimated(
        distanceKilometers: Double,
        elevationGainMeters: Int
    ) -> RouteDifficulty {
        if distanceKilometers >= 18 || elevationGainMeters >= 800 {
            return .challenging
        }
        if distanceKilometers >= 10 || elevationGainMeters >= 350 {
            return .moderate
        }
        return .easy
    }
}

enum TrailRouteType: String, Hashable, Sendable {
    case loop = "Loop"
    case pointToPoint = "Point to point"
    case multiDay = "Multi-day"
}

enum RouteProviderIdentity: String, Decodable, Hashable, Sendable {
    case graphHopper = "graphhopper"
}

enum RouteRoutingStrategy: String, Hashable, Sendable {
    case backend
    case directGraphHopper
    case loopFallback
}

enum RouteDemoKind: String, Hashable, Sendable {
    case mock
    case preview
    case testFixture
}

enum UnverifiedRouteReason: String, Hashable, Sendable {
    case legacyRecord
    case modifiedWithoutRouting
    case unknown
}

struct RouteFactFingerprint: Hashable, Sendable {
    let rawValue: String

    init(rawValue: String) {
        self.rawValue = rawValue
    }

    static func make(
        activity: ActivityType,
        routeType: TrailRouteType,
        distanceKilometers: Double,
        elevationGainMeters: Int,
        elevationLossMeters: Int?,
        durationHours: Double,
        difficulty: RouteDifficulty,
        path: [GeoPoint],
        verifiedCharacteristics: VerifiedRouteCharacteristics?
    ) -> RouteFactFingerprint {
        var hasher = StableRouteFactHasher()
        hasher.combine("trailmind-route-facts-v2")
        hasher.combine(activity.rawValue)
        hasher.combine(routeType.rawValue)
        hasher.combine(distanceKilometers.bitPattern)
        hasher.combine(elevationGainMeters)
        if let elevationLossMeters {
            hasher.combine(UInt8(1))
            hasher.combine(elevationLossMeters)
        } else {
            hasher.combine(UInt8(0))
        }
        hasher.combine(durationHours.bitPattern)
        hasher.combine(difficulty.rawValue)
        hasher.combine(path.count)
        for point in path {
            hasher.combine(point.latitude.bitPattern)
            hasher.combine(point.longitude.bitPattern)
            if let elevationMeters = point.elevationMeters {
                hasher.combine(UInt8(1))
                hasher.combine(elevationMeters.bitPattern)
            } else {
                hasher.combine(UInt8(0))
            }
        }
        if let verifiedCharacteristics {
            hasher.combine(UInt8(1))
            hasher.combine(verifiedCharacteristics.routeDistanceMeters.bitPattern)
            combine(
                verifiedCharacteristics.surfaceBreakdown,
                into: &hasher
            )
            combine(
                verifiedCharacteristics.roadClassBreakdown,
                into: &hasher
            )
            combine(
                verifiedCharacteristics.hikeRatingBreakdown,
                into: &hasher
            )
            hasher.combine(verifiedCharacteristics.surfaceCoverageMeters.bitPattern)
            hasher.combine(verifiedCharacteristics.roadClassCoverageMeters.bitPattern)
            hasher.combine(verifiedCharacteristics.hikeRatingCoverageMeters.bitPattern)
        } else {
            hasher.combine(UInt8(0))
        }
        return RouteFactFingerprint(rawValue: String(hasher.value, radix: 16))
    }

    private static func combine(
        _ values: [VerifiedRouteCharacteristicValue],
        into hasher: inout StableRouteFactHasher
    ) {
        let canonicalValues = values.sorted { left, right in
            if left.value != right.value {
                return left.value < right.value
            }
            return left.distanceMeters.bitPattern < right.distanceMeters.bitPattern
        }
        hasher.combine(canonicalValues.count)
        for value in canonicalValues {
            hasher.combine(value.value)
            hasher.combine(value.distanceMeters.bitPattern)
        }
    }
}

private struct StableRouteFactHasher {
    private(set) var value: UInt64 = 14_695_981_039_346_656_037

    mutating func combine(_ value: String) {
        combine(value.utf8.count)
        for byte in value.utf8 {
            combine(byte)
        }
    }

    mutating func combine(_ value: Int) {
        combine(UInt64(bitPattern: Int64(value)))
    }

    mutating func combine(_ value: UInt64) {
        for shift in stride(from: 56, through: 0, by: -8) {
            combine(UInt8((value >> UInt64(shift)) & 0xff))
        }
    }

    mutating func combine(_ byte: UInt8) {
        value ^= UInt64(byte)
        value &*= 1_099_511_628_211
    }
}

struct RoutedRouteProvenance: Hashable, Sendable {
    let provider: RouteProviderIdentity
    let strategy: RouteRoutingStrategy
    let factFingerprint: RouteFactFingerprint

    func withStrategy(_ strategy: RouteRoutingStrategy) -> RoutedRouteProvenance {
        RoutedRouteProvenance(
            provider: provider,
            strategy: strategy,
            factFingerprint: factFingerprint
        )
    }
}

enum RouteProvenance: Hashable, Sendable {
    case routed(RoutedRouteProvenance)
    case demo(RouteDemoKind)
    case unverified(UnverifiedRouteReason)

    static func routingEngineOutput(
        provider: RouteProviderIdentity,
        strategy: RouteRoutingStrategy,
        activity: ActivityType,
        routeType: TrailRouteType,
        distanceKilometers: Double,
        elevationGainMeters: Int,
        elevationLossMeters: Int?,
        durationHours: Double,
        difficulty: RouteDifficulty,
        path: [GeoPoint],
        verifiedCharacteristics: VerifiedRouteCharacteristics?
    ) -> RouteProvenance {
        .routed(
            RoutedRouteProvenance(
                provider: provider,
                strategy: strategy,
                factFingerprint: RouteFactFingerprint.make(
                    activity: activity,
                    routeType: routeType,
                    distanceKilometers: distanceKilometers,
                    elevationGainMeters: elevationGainMeters,
                    elevationLossMeters: elevationLossMeters,
                    durationHours: durationHours,
                    difficulty: difficulty,
                    path: path,
                    verifiedCharacteristics: verifiedCharacteristics
                )
            )
        )
    }
}

enum DesiredFeature: String, CaseIterable, Hashable, Sendable {
    case viewpoint
    case forest
    case water
    case quiet
    case sunset

    var label: String {
        switch self {
        case .viewpoint: "Views"
        case .forest: "Forest"
        case .water: "Water"
        case .quiet: "Quiet route"
        case .sunset: "Sunset"
        }
    }

    var symbol: String {
        switch self {
        case .viewpoint: "binoculars.fill"
        case .forest: "tree.fill"
        case .water: "drop.fill"
        case .quiet: "leaf.fill"
        case .sunset: "sunset.fill"
        }
    }
}

enum ResearchExperience: String, CaseIterable, Hashable, Sendable {
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

struct MustHaveResearchExperienceConstraint: Hashable, Sendable {
    let experience: ResearchExperience
    let minimumCount: Int

    init(experience: ResearchExperience) {
        self.experience = experience
        minimumCount = 1
    }

    init?(
        experience: ResearchExperience,
        minimumCount: Int
    ) {
        guard (1...8).contains(minimumCount) else {
            return nil
        }
        self.experience = experience
        self.minimumCount = minimumCount
    }
}

enum AvoidFeature: String, CaseIterable, Hashable, Sendable {
    case majorRoads
    case steepClimbs
    case repeatedPath

    var label: String {
        switch self {
        case .majorRoads: "Avoid major roads"
        case .steepClimbs: "Avoid steep climbs"
        case .repeatedPath: "Reduce repeated path"
        }
    }
}

enum RouteShapingPreference: String, Hashable, Sendable {
    case activityProfile
    case targetDistance
    case targetDuration
    case lowerElevation
    case avoidMajorRoads
    case reduceRepeatedPath

    var label: String {
        switch self {
        case .activityProfile: "Activity profile"
        case .targetDistance: "Distance target"
        case .targetDuration: "Duration target"
        case .lowerElevation: "Lower elevation"
        case .avoidMajorRoads: "Avoid major roads"
        case .reduceRepeatedPath: "Reduce repeated path"
        }
    }
}

struct RouteShapingSummary: Hashable, Sendable {
    let applied: [RouteShapingPreference]
    let requestedOnly: [RouteShapingPreference]

    var isEmpty: Bool {
        applied.isEmpty && requestedOnly.isEmpty
    }

    static func pointToPoint(
        request: RoutePlanningRequest,
        customModelApplied: Bool,
        alternativeRoutesApplied: Bool
    ) -> RouteShapingSummary {
        var applied: [RouteShapingPreference] = [.activityProfile]
        var requestedOnly: [RouteShapingPreference] = []

        if request.targetDistanceKm != nil {
            if alternativeRoutesApplied {
                applied.append(.targetDistance)
            } else {
                requestedOnly.append(.targetDistance)
            }
        }
        if request.targetDurationMinutes != nil {
            requestedOnly.append(.targetDuration)
        }
        if request.avoidFeatures.contains(.steepClimbs) || request.difficulty == .easy {
            if customModelApplied {
                applied.append(.lowerElevation)
            } else {
                requestedOnly.append(.lowerElevation)
            }
        }
        if request.avoidFeatures.contains(.majorRoads) {
            if customModelApplied {
                applied.append(.avoidMajorRoads)
            } else {
                requestedOnly.append(.avoidMajorRoads)
            }
        }
        if request.avoidFeatures.contains(.repeatedPath) {
            requestedOnly.append(.reduceRepeatedPath)
        }
        return RouteShapingSummary(applied: applied, requestedOnly: requestedOnly)
    }

    static func loop(
        request: RoutePlanningRequest,
        lowerElevationApplied: Bool
    ) -> RouteShapingSummary {
        var applied: [RouteShapingPreference] = [.activityProfile]
        var requestedOnly: [RouteShapingPreference] = []

        if request.targetDistanceKm != nil {
            applied.append(.targetDistance)
        }
        if request.targetDurationMinutes != nil {
            applied.append(.targetDuration)
        }
        if request.avoidFeatures.contains(.repeatedPath) {
            applied.append(.reduceRepeatedPath)
        }
        if request.avoidFeatures.contains(.steepClimbs) || request.difficulty == .easy {
            if lowerElevationApplied {
                applied.append(.lowerElevation)
            } else {
                requestedOnly.append(.lowerElevation)
            }
        }
        if request.avoidFeatures.contains(.majorRoads) {
            requestedOnly.append(.avoidMajorRoads)
        }
        return RouteShapingSummary(applied: applied, requestedOnly: requestedOnly)
    }
}

struct RoutePlanningRequest: Hashable, Sendable {
    let routeType: TrailRouteType
    let startQuery: String
    let endQuery: String?
    let activityType: ActivityType
    let graphHopperProfile: String
    let targetDistanceKm: Double?
    let targetDurationMinutes: Int?
    let difficulty: RouteDifficulty?
    let desiredFeatures: [DesiredFeature]
    let avoidFeatures: [AvoidFeature]

    init(
        routeType: TrailRouteType = .pointToPoint,
        startQuery: String,
        endQuery: String?,
        activityType: ActivityType,
        graphHopperProfile: String,
        targetDistanceKm: Double?,
        targetDurationMinutes: Int?,
        difficulty: RouteDifficulty?,
        desiredFeatures: [DesiredFeature],
        avoidFeatures: [AvoidFeature] = []
    ) {
        self.routeType = routeType
        self.startQuery = startQuery
        self.endQuery = endQuery
        self.activityType = activityType
        self.graphHopperProfile = graphHopperProfile
        self.targetDistanceKm = targetDistanceKm
        self.targetDurationMinutes = targetDurationMinutes
        self.difficulty = difficulty
        self.desiredFeatures = desiredFeatures
        self.avoidFeatures = avoidFeatures
    }

    init(parsedPrompt: ParsedRoutePrompt) {
        let targetDurationMinutes = parsedPrompt.preferredDurationHours.map { Int(($0 * 60).rounded()) }
        let targetDistanceKm = parsedPrompt.preferredDistanceKilometers
            ?? (parsedPrompt.routeType == .loop ? Self.loopDistanceKm(for: parsedPrompt.activityType, durationMinutes: targetDurationMinutes) : nil)
        self.init(
            routeType: parsedPrompt.routeType,
            startQuery: parsedPrompt.startLocationQuery,
            endQuery: parsedPrompt.endLocationQuery,
            activityType: parsedPrompt.activityType,
            graphHopperProfile: parsedPrompt.graphHopperProfile,
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: targetDurationMinutes,
            difficulty: parsedPrompt.difficulty,
            desiredFeatures: parsedPrompt.desiredFeatures,
            avoidFeatures: parsedPrompt.avoidFeatures + (
                parsedPrompt.difficulty == .easy && !parsedPrompt.avoidFeatures.contains(.steepClimbs)
                    ? [.steepClimbs]
                    : []
            )
        )
    }

    init(validatedIntent: ValidatedAdventureIntent) {
        let startQuery = validatedIntent.startLocationQuery ?? validatedIntent.regionQuery ?? ""
        self.init(
            routeType: validatedIntent.routeType,
            startQuery: startQuery,
            endQuery: validatedIntent.endLocationQuery,
            activityType: validatedIntent.activityType,
            graphHopperProfile: validatedIntent.graphHopperProfile,
            targetDistanceKm: validatedIntent.targetDistanceKm
                ?? (validatedIntent.routeType == .loop ? Self.loopDistanceKm(for: validatedIntent.activityType, durationMinutes: validatedIntent.targetDurationMinutes) : nil),
            targetDurationMinutes: validatedIntent.targetDurationMinutes,
            difficulty: validatedIntent.difficulty,
            desiredFeatures: validatedIntent.desiredFeatures,
            avoidFeatures: validatedIntent.avoidFeatures
        )
    }

    var metadata: RoutePlanningMetadata {
        RoutePlanningMetadata(
            routeType: routeType,
            activityType: activityType,
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: targetDurationMinutes,
            difficulty: difficulty,
            desiredFeatures: desiredFeatures,
            avoidFeatures: avoidFeatures
        )
    }

    func title(startName: String, endName: String, actualDistanceKm: Double? = nil) -> String {
        if routeType == .loop {
            return loopTitle(startName: startName, actualDistanceKm: actualDistanceKm)
        }

        switch activityType {
        case .hiking:
            return "Hike from \(startName) to \(endName)"
        case .biking:
            return "Bike route from \(startName) to \(endName)"
        case .trailRunning:
            return "Trail run from \(startName) to \(endName)"
        }
    }

    func loopTitle(startName: String, actualDistanceKm: Double? = nil) -> String {
        let distancePrefix = actualDistanceKm.map {
            "\($0.formatted(.number.locale(Locale(identifier: "en_US_POSIX")).precision(.fractionLength(1)))) km "
        } ?? ""

        switch activityType {
        case .hiking:
            return "\(distancePrefix)Hike loop around \(startName)"
        case .biking:
            return "\(distancePrefix)Bike loop around \(startName)"
        case .trailRunning:
            return "\(distancePrefix)Trail run loop around \(startName)"
        }
    }

    static func defaultLoopDistanceKm(for activityType: ActivityType) -> Double {
        switch activityType {
        case .hiking:
            return 10
        case .trailRunning:
            return 8
        case .biking:
            return 25
        }
    }

    static func loopDistanceKm(for activityType: ActivityType, durationMinutes: Int?) -> Double {
        guard let durationMinutes, durationMinutes > 0 else {
            return defaultLoopDistanceKm(for: activityType)
        }

        let hours = Double(durationMinutes) / 60
        let speedKmh: Double = switch activityType {
        case .hiking:
            4
        case .trailRunning:
            8
        case .biking:
            15
        }
        return max(3, min((hours * speedKmh).rounded(), 80))
    }
}

struct RoutePlanningMetadata: Hashable, Sendable {
    enum DistanceFit: Equatable, Sendable {
        case withinTolerance
        case shorter
        case longer
    }

    let routeType: TrailRouteType
    let activityType: ActivityType
    let targetDistanceKm: Double?
    let targetDurationMinutes: Int?
    let difficulty: RouteDifficulty?
    let desiredFeatures: [DesiredFeature]
    let avoidFeatures: [AvoidFeature]
    let seed: Int?
    let variantLabel: String?
    let loopSearchOutcome: LoopSearchOutcome?
    let routeShapingSummary: RouteShapingSummary?

    var isEmpty: Bool {
        routeType == .pointToPoint &&
        targetDistanceKm == nil &&
        targetDurationMinutes == nil &&
        difficulty == nil &&
        desiredFeatures.isEmpty &&
        avoidFeatures.isEmpty &&
        seed == nil &&
        variantLabel == nil &&
        loopSearchOutcome == nil &&
        routeShapingSummary == nil
    }

    var requestedDifficultySummary: String? {
        difficulty.map { "Requested: \($0.rawValue)" }
    }

    init(
        routeType: TrailRouteType,
        activityType: ActivityType,
        targetDistanceKm: Double?,
        targetDurationMinutes: Int?,
        difficulty: RouteDifficulty?,
        desiredFeatures: [DesiredFeature],
        avoidFeatures: [AvoidFeature],
        seed: Int? = nil,
        variantLabel: String? = nil,
        loopSearchOutcome: LoopSearchOutcome? = nil,
        routeShapingSummary: RouteShapingSummary? = nil
    ) {
        self.routeType = routeType
        self.activityType = activityType
        self.targetDistanceKm = targetDistanceKm
        self.targetDurationMinutes = targetDurationMinutes
        self.difficulty = difficulty
        self.desiredFeatures = desiredFeatures
        self.avoidFeatures = avoidFeatures
        self.seed = seed
        self.variantLabel = variantLabel
        self.loopSearchOutcome = loopSearchOutcome
        self.routeShapingSummary = routeShapingSummary
    }

    func withVariant(seed: Int?, label: String?) -> RoutePlanningMetadata {
        RoutePlanningMetadata(
            routeType: routeType,
            activityType: activityType,
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: targetDurationMinutes,
            difficulty: difficulty,
            desiredFeatures: desiredFeatures,
            avoidFeatures: avoidFeatures,
            seed: seed,
            variantLabel: label,
            loopSearchOutcome: loopSearchOutcome,
            routeShapingSummary: routeShapingSummary
        )
    }

    func withLoopSearchOutcome(_ outcome: LoopSearchOutcome?) -> RoutePlanningMetadata {
        RoutePlanningMetadata(
            routeType: routeType,
            activityType: activityType,
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: targetDurationMinutes,
            difficulty: difficulty,
            desiredFeatures: desiredFeatures,
            avoidFeatures: avoidFeatures,
            seed: seed,
            variantLabel: variantLabel,
            loopSearchOutcome: outcome,
            routeShapingSummary: routeShapingSummary
        )
    }

    func withRouteShapingSummary(_ summary: RouteShapingSummary?) -> RoutePlanningMetadata {
        RoutePlanningMetadata(
            routeType: routeType,
            activityType: activityType,
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: targetDurationMinutes,
            difficulty: difficulty,
            desiredFeatures: desiredFeatures,
            avoidFeatures: avoidFeatures,
            seed: seed,
            variantLabel: variantLabel,
            loopSearchOutcome: loopSearchOutcome,
            routeShapingSummary: summary
        )
    }

    var requestedFeatureSummary: String? {
        guard !desiredFeatures.isEmpty else { return nil }
        return "Requested: \(desiredFeatures.map(\.label).joined(separator: ", "))"
    }

    var requestedDistanceSummary: String? {
        guard let targetDistanceKm else { return nil }
        return "Requested: about \(Self.distanceLabel(targetDistanceKm))"
    }

    func distanceFit(actualDistanceKm: Double) -> DistanceFit? {
        guard let targetDistanceKm, targetDistanceKm > 0 else { return nil }
        let difference = actualDistanceKm - targetDistanceKm
        let tolerance = max(1.0, targetDistanceKm * 0.12)
        if abs(difference) <= tolerance { return .withinTolerance }
        return difference < 0 ? .shorter : .longer
    }

    func distanceNote(actualDistanceKm: Double) -> String? {
        guard let targetDistanceKm, let fit = distanceFit(actualDistanceKm: actualDistanceKm) else { return nil }
        guard fit != .withinTolerance else { return nil }
        return "Actual \(Self.distanceLabel(actualDistanceKm)) vs requested \(Self.distanceLabel(targetDistanceKm))."
    }

    func durationFit(actualDurationMinutes: Int) -> DistanceFit? {
        guard let targetDurationMinutes, targetDurationMinutes > 0 else { return nil }
        let difference = actualDurationMinutes - targetDurationMinutes
        let tolerance = max(15, Int((Double(targetDurationMinutes) * 0.12).rounded()))
        if abs(difference) <= tolerance { return .withinTolerance }
        return difference < 0 ? .shorter : .longer
    }

    func durationNote(actualDurationMinutes: Int) -> String? {
        guard
            let targetDurationMinutes,
            let fit = durationFit(actualDurationMinutes: actualDurationMinutes),
            fit != .withinTolerance
        else { return nil }
        return "Actual \(Self.durationLabel(actualDurationMinutes)) vs requested \(Self.durationLabel(targetDurationMinutes))."
    }

    private static func distanceLabel(_ value: Double) -> String {
        "\(value.formatted(.number.locale(Locale(identifier: "en_US_POSIX")).precision(.fractionLength(value.rounded() == value ? 0 : 1)))) km"
    }

    private static func durationLabel(_ minutes: Int) -> String {
        let hours = minutes / 60
        let remainder = minutes % 60
        if hours == 0 { return "\(minutes) min" }
        if remainder == 0 { return "\(hours) hr" }
        return "\(hours) hr \(remainder) min"
    }
}

struct RouteQualityExplanation: Identifiable, Hashable, Sendable {
    let title: String
    let detail: String?
    let symbol: String

    var id: String {
        [title, detail, symbol].compactMap(\.self).joined(separator: "|")
    }
}

struct VerifiedRouteCharacteristicValue: Identifiable, Hashable, Sendable {
    let value: String
    let distanceMeters: Double

    var id: String { value }
}

struct VerifiedRouteCharacteristics: Hashable, Sendable {
    static let minimumDisplayCoverage = 0.60

    let routeDistanceMeters: Double
    let surfaceBreakdown: [VerifiedRouteCharacteristicValue]
    let roadClassBreakdown: [VerifiedRouteCharacteristicValue]
    let hikeRatingBreakdown: [VerifiedRouteCharacteristicValue]
    let surfaceCoverageMeters: Double
    let roadClassCoverageMeters: Double
    let hikeRatingCoverageMeters: Double

    var surfaceCoverageRatio: Double {
        ratio(surfaceCoverageMeters)
    }

    var roadClassCoverageRatio: Double {
        ratio(roadClassCoverageMeters)
    }

    var hikeRatingCoverageRatio: Double {
        ratio(hikeRatingCoverageMeters)
    }

    var hasDisplayableSurfaceData: Bool {
        surfaceCoverageRatio >= Self.minimumDisplayCoverage
    }

    var hasDisplayableRoadClassData: Bool {
        roadClassCoverageRatio >= Self.minimumDisplayCoverage
    }

    var pavedRatio: Double? {
        guard hasDisplayableSurfaceData else { return nil }
        return ratio(distance(for: Self.pavedSurfaceValues, in: surfaceBreakdown))
    }

    var unpavedRatio: Double? {
        guard hasDisplayableSurfaceData else { return nil }
        return ratio(distance(for: Self.unpavedSurfaceValues, in: surfaceBreakdown))
    }

    var unknownSurfaceRatio: Double? {
        guard hasDisplayableSurfaceData else { return nil }
        return max(0, 1 - (pavedRatio ?? 0) - (unpavedRatio ?? 0))
    }

    var pathAndTrackRatio: Double? {
        guard hasDisplayableRoadClassData else { return nil }
        return ratio(distance(for: Self.pathAndTrackRoadClasses, in: roadClassBreakdown))
    }

    var majorRoadRatio: Double? {
        guard hasDisplayableRoadClassData else { return nil }
        return ratio(distance(for: Self.majorRoadClasses, in: roadClassBreakdown))
    }

    var maximumHikeRating: Int? {
        hikeRatingBreakdown.compactMap { Int($0.value) }.max()
    }

    var mountainHikingDistanceMeters: Double {
        hikeRatingBreakdown.reduce(into: 0) { total, entry in
            guard let rating = Int(entry.value), rating >= 2 else { return }
            total += entry.distanceMeters
        }
    }

    var hasDisplayableData: Bool {
        hasDisplayableSurfaceData
            || hasDisplayableRoadClassData
            || maximumHikeRating != nil
    }

    var cardFacts: [RouteQualityExplanation] {
        var facts: [RouteQualityExplanation] = []

        if let unpavedRatio, unpavedRatio >= 0.01 {
            facts.append(
                RouteQualityExplanation(
                    title: "\(Self.percentLabel(unpavedRatio)) unpaved",
                    detail: nil,
                    symbol: "leaf.fill"
                )
            )
        } else if let pavedRatio, pavedRatio >= 0.01 {
            facts.append(
                RouteQualityExplanation(
                    title: "\(Self.percentLabel(pavedRatio)) paved",
                    detail: nil,
                    symbol: "road.lanes"
                )
            )
        }

        if let pathAndTrackRatio, pathAndTrackRatio >= 0.60 {
            facts.append(
                RouteQualityExplanation(
                    title: "Mostly paths and tracks",
                    detail: nil,
                    symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
                )
            )
        } else if let majorRoadRatio, majorRoadRatio >= 0.01 {
            facts.append(
                RouteQualityExplanation(
                    title: "\(Self.percentLabel(majorRoadRatio)) major roads",
                    detail: nil,
                    symbol: "road.lanes"
                )
            )
        }

        if let maximumHikeRating, maximumHikeRating >= 2 {
            facts.append(
                RouteQualityExplanation(
                    title: "Mountain-hiking sections",
                    detail: nil,
                    symbol: "mountain.2.fill"
                )
            )
        }

        return Array(facts.prefix(2))
    }

    private func ratio(_ distanceMeters: Double) -> Double {
        guard routeDistanceMeters > 0 else { return 0 }
        return min(max(distanceMeters / routeDistanceMeters, 0), 1)
    }

    private func distance(
        for values: Set<String>,
        in breakdown: [VerifiedRouteCharacteristicValue]
    ) -> Double {
        breakdown.reduce(into: 0) { total, entry in
            if values.contains(entry.value) {
                total += entry.distanceMeters
            }
        }
    }

    private static func percentLabel(_ ratio: Double) -> String {
        "\(Int((ratio * 100).rounded()))%"
    }

    private static let pavedSurfaceValues: Set<String> = [
        "paved", "asphalt", "concrete", "concrete:lanes", "concrete:plates",
        "paving_stones", "sett", "unhewn_cobblestone", "cobblestone", "metal"
    ]

    private static let unpavedSurfaceValues: Set<String> = [
        "unpaved", "compacted", "fine_gravel", "gravel", "pebblestone", "rock",
        "dirt", "earth", "ground", "grass", "grass_paver", "mud", "sand", "woodchips"
    ]

    private static let pathAndTrackRoadClasses: Set<String> = [
        "track", "footway", "path", "steps"
    ]

    private static let majorRoadClasses: Set<String> = [
        "motorway", "trunk", "primary", "secondary"
    ]
}

enum RouteQualityExplanationGenerator {
    static func explanations(
        for route: TrailRoute,
        debugMetadata: RouteSuggestionDebugMetadata? = nil,
        maximumCount: Int = 4
    ) -> [RouteQualityExplanation] {
        var explanations: [RouteQualityExplanation] = []

        if let metadata = route.planningMetadata {
            appendDistanceExplanation(
                route: route,
                metadata: metadata,
                to: &explanations
            )

            appendDurationExplanation(
                route: route,
                metadata: metadata,
                to: &explanations
            )

            appendDifficultyMismatchExplanation(
                route: route,
                metadata: metadata,
                to: &explanations
            )

            if metadata.routeType == .loop || route.routeType == .loop {
                explanations.append(
                    RouteQualityExplanation(
                        title: "Loop route",
                        detail: "Route type returned by routing: loop.",
                        symbol: "arrow.trianglehead.2.clockwise.rotate.90"
                    )
                )
            }

            appendVariantExplanation(metadata: metadata, to: &explanations)
        }

        if let debugMetadata,
           route.routeType == .loop,
           let overlapRatio = debugMetadata.overlapRatio,
           overlapRatio <= 0.10
        {
            explanations.append(
                RouteQualityExplanation(
                    title: "Low repeated path",
                    detail: "Measured overlap is \(Self.percentLabel(overlapRatio)).",
                    symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
                )
            )
        }

        if route.isVerifiedRoutedResult {
            explanations.append(
                RouteQualityExplanation(
                    title: "Calculated from live trail-network data",
                    detail: "Distance, duration and elevation come from routed geometry.",
                    symbol: "map.fill"
                )
            )
        }

        return Array(unique(explanations).prefix(maximumCount))
    }

    private static func appendDistanceExplanation(
        route: TrailRoute,
        metadata: RoutePlanningMetadata,
        to explanations: inout [RouteQualityExplanation]
    ) {
        guard
            let targetDistanceKm = metadata.targetDistanceKm,
            targetDistanceKm > 0,
            let distanceFit = metadata.distanceFit(actualDistanceKm: route.distanceKilometers)
        else { return }

        let actualDistanceKm = route.distanceKilometers
        let detail = "Actual \(Self.distanceLabel(actualDistanceKm)) vs requested \(Self.distanceLabel(targetDistanceKm))."

        switch distanceFit {
        case .withinTolerance:
            explanations.append(
                RouteQualityExplanation(
                    title: "Close to your target distance",
                    detail: detail,
                    symbol: "ruler"
                )
            )
        case .shorter:
            explanations.append(
                RouteQualityExplanation(
                    title: "Shorter than target",
                    detail: detail,
                    symbol: "minus.circle.fill"
                )
            )
        case .longer:
            explanations.append(
                RouteQualityExplanation(
                    title: "Longer than target",
                    detail: detail,
                    symbol: "plus.circle.fill"
                )
            )
        }
    }

    private static func appendDurationExplanation(
        route: TrailRoute,
        metadata: RoutePlanningMetadata,
        to explanations: inout [RouteQualityExplanation]
    ) {
        guard
            let targetDurationMinutes = metadata.targetDurationMinutes,
            targetDurationMinutes > 0,
            let durationFit = metadata.durationFit(actualDurationMinutes: route.durationMinutes)
        else { return }

        let detail = "Actual \(durationLabel(route.durationMinutes)) vs requested \(durationLabel(targetDurationMinutes))."
        switch durationFit {
        case .withinTolerance:
            explanations.append(
                RouteQualityExplanation(
                    title: "Close to your target time",
                    detail: detail,
                    symbol: "clock"
                )
            )
        case .shorter:
            explanations.append(
                RouteQualityExplanation(
                    title: "Shorter than target time",
                    detail: detail,
                    symbol: "clock.badge.checkmark"
                )
            )
        case .longer:
            explanations.append(
                RouteQualityExplanation(
                    title: "Longer than target time",
                    detail: detail,
                    symbol: "clock.badge.exclamationmark"
                )
            )
        }
    }

    private static func appendDifficultyMismatchExplanation(
        route: TrailRoute,
        metadata: RoutePlanningMetadata,
        to explanations: inout [RouteQualityExplanation]
    ) {
        guard
            let requestedDifficulty = metadata.difficulty,
            difficultyRank(route.difficulty) > difficultyRank(requestedDifficulty)
        else { return }

        explanations.append(
            RouteQualityExplanation(
                title: "Harder than requested",
                detail: "Requested \(requestedDifficulty.rawValue). Measured \(distanceLabel(route.distanceKilometers)) and \(route.elevationGainMeters) m climb produce Wanderful’s \(route.difficulty.rawValue) estimate.",
                symbol: "exclamationmark.triangle.fill"
            )
        )
    }

    private static func appendVariantExplanation(
        metadata: RoutePlanningMetadata,
        to explanations: inout [RouteQualityExplanation]
    ) {
        switch metadata.variantLabel {
        case "Lowest climb":
            explanations.append(
                RouteQualityExplanation(
                    title: "Lowest measured climb",
                    detail: "Lowest elevation gain among these distinct routed options.",
                    symbol: "leaf.fill"
                )
            )
        default:
            break
        }
    }

    private static func unique(_ explanations: [RouteQualityExplanation]) -> [RouteQualityExplanation] {
        var seen = Set<String>()
        return explanations.filter { explanation in
            seen.insert(explanation.title).inserted
        }
    }

    private static func distanceLabel(_ distanceKm: Double) -> String {
        distanceKm.formatted(
            .number
                .locale(Locale(identifier: "en_US_POSIX"))
                .precision(.fractionLength(distanceKm.rounded() == distanceKm ? 0 : 1))
        ) + " km"
    }

    private static func durationLabel(_ minutes: Int) -> String {
        let hours = minutes / 60
        let remainder = minutes % 60
        if hours == 0 { return "\(minutes) min" }
        if remainder == 0 { return "\(hours) hr" }
        return "\(hours) hr \(remainder) min"
    }

    private static func difficultyRank(_ difficulty: RouteDifficulty) -> Int {
        switch difficulty {
        case .easy: 0
        case .moderate: 1
        case .challenging: 2
        }
    }

    private static func percentLabel(_ ratio: Double) -> String {
        ratio.formatted(.percent.precision(.fractionLength(0)))
    }
}

enum WaypointKind: String, Hashable {
    case start
    case viewpoint
    case water
    case rest
    case stay
    case finish

    var symbol: String {
        switch self {
        case .start: "location.fill"
        case .viewpoint: "binoculars.fill"
        case .water: "drop.fill"
        case .rest: "cup.and.saucer.fill"
        case .stay: "bed.double.fill"
        case .finish: "flag.checkered"
        }
    }
}

struct GeoPoint: Hashable, Sendable {
    let latitude: Double
    let longitude: Double
    let elevationMeters: Double?

    init(latitude: Double, longitude: Double, elevationMeters: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.elevationMeters = elevationMeters
    }
}

typealias Coordinate = GeoPoint

struct RouteInstruction: Identifiable, Hashable, Sendable {
    let id: UUID
    let text: String
    let streetName: String?
    let distanceMeters: Double
    let durationSeconds: Double
    let sign: Int
    let coordinate: Coordinate?

    init(
        id: UUID = UUID(),
        text: String,
        streetName: String?,
        distanceMeters: Double,
        durationSeconds: Double,
        sign: Int,
        coordinate: Coordinate?
    ) {
        self.id = id
        self.text = text
        self.streetName = streetName
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
        self.sign = sign
        self.coordinate = coordinate
    }
}

struct Waypoint: Identifiable, Hashable {
    let id: UUID
    let name: String
    let detail: String
    let distanceKilometers: Double
    let kind: WaypointKind
    let coordinate: GeoPoint

    init(
        id: UUID = UUID(),
        name: String,
        detail: String,
        distanceKilometers: Double,
        kind: WaypointKind,
        coordinate: GeoPoint
    ) {
        self.id = id
        self.name = name
        self.detail = detail
        self.distanceKilometers = distanceKilometers
        self.kind = kind
        self.coordinate = coordinate
    }
}

struct RouteDay: Identifiable, Hashable {
    let id: UUID
    let dayNumber: Int
    let title: String
    let distanceKilometers: Double
    let elevationGainMeters: Int
    let durationHours: Double
    let summary: String

    init(
        id: UUID = UUID(),
        dayNumber: Int,
        title: String,
        distanceKilometers: Double,
        elevationGainMeters: Int,
        durationHours: Double,
        summary: String
    ) {
        self.id = id
        self.dayNumber = dayNumber
        self.title = title
        self.distanceKilometers = distanceKilometers
        self.elevationGainMeters = elevationGainMeters
        self.durationHours = durationHours
        self.summary = summary
    }
}

struct Highlight: Identifiable, Hashable {
    let id: UUID
    let title: String
    let subtitle: String
    let symbol: String

    init(id: UUID = UUID(), title: String, subtitle: String, symbol: String) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.symbol = symbol
    }
}

struct SafetyNote: Identifiable, Hashable {
    enum Severity: Hashable {
        case info
        case caution
    }

    let id: UUID
    let title: String
    let message: String
    let severity: Severity

    init(id: UUID = UUID(), title: String, message: String, severity: Severity) {
        self.id = id
        self.title = title
        self.message = message
        self.severity = severity
    }
}

struct RouteIntentDebugMetadata: Hashable, Sendable {
    let intent: ValidatedAdventureIntent
    let validationStatus: String
    let localFallbackUsed: Bool
    let parserDebugInfo: IntentParserDebugInfo?
    let repaired: Bool
    let repairReason: String?
    let missingFields: [String]
    let clarificationQuestion: String?
    let geocodedStartLabel: String?
    let geocodedEndLabel: String?
    let loopSearchOutcome: LoopSearchOutcome?
    let loopSearchDiagnostics: LoopSearchDiagnostics?

    init(
        intent: ValidatedAdventureIntent,
        validationStatus: String = IntentValidationStatus.valid.rawValue,
        localFallbackUsed: Bool? = nil,
        parserDebugInfo: IntentParserDebugInfo? = nil,
        repaired: Bool = false,
        repairReason: String? = nil,
        missingFields: [String] = [],
        clarificationQuestion: String? = nil,
        geocodedStartLabel: String?,
        geocodedEndLabel: String?,
        loopSearchOutcome: LoopSearchOutcome? = nil,
        loopSearchDiagnostics: LoopSearchDiagnostics? = nil
    ) {
        self.intent = intent
        self.validationStatus = validationStatus
        self.localFallbackUsed = localFallbackUsed ?? (intent.parserSource == .localRuleBased)
        self.parserDebugInfo = parserDebugInfo
        self.repaired = repaired
        self.repairReason = repairReason
        self.missingFields = missingFields
        self.clarificationQuestion = clarificationQuestion
        self.geocodedStartLabel = geocodedStartLabel
        self.geocodedEndLabel = geocodedEndLabel
        self.loopSearchOutcome = loopSearchOutcome
        self.loopSearchDiagnostics = loopSearchDiagnostics
    }
}

struct IntentDebugRow: Identifiable, Hashable, Sendable {
    let label: String
    let value: String

    var id: String {
        "\(label):\(value)"
    }
}

enum IntentDebugFormatter {
    static func rows(for metadata: RouteIntentDebugMetadata) -> [IntentDebugRow] {
        let intent = metadata.intent
        return [
            row("parserSource", parserSourceLabel(intent.parserSource)),
            row("validationStatus", metadata.validationStatus),
            row("localFallbackUsed", metadata.localFallbackUsed ? "yes" : "no"),
            row("remoteAttempted", boolLabel(metadata.parserDebugInfo?.remoteAttempted)),
            row("remoteSucceeded", boolLabel(metadata.parserDebugInfo?.remoteSucceeded)),
            row("remoteFailureReason", optional(metadata.parserDebugInfo?.remoteFailureReason)),
            row("remoteStatusCode", statusCodeLabel(metadata.parserDebugInfo?.remoteStatusCode)),
            row("remoteValidationError", optional(metadata.parserDebugInfo?.remoteValidationError)),
            row("backendBaseURL", optional(metadata.parserDebugInfo?.backendBaseURL)),
            row("parserMode", metadata.parserDebugInfo?.parserMode.debugLabel ?? "unknown"),
            row("repaired", metadata.repaired ? "yes" : "no"),
            row("repairReason", optional(metadata.repairReason)),
            row("missingFields", metadata.missingFields.isEmpty ? "[]" : metadata.missingFields.joined(separator: ", ")),
            row("clarificationQuestion", optional(metadata.clarificationQuestion)),
            row("loopSearchStatus", loopSearchStatus(metadata.loopSearchDiagnostics, outcome: metadata.loopSearchOutcome)),
            row("loopSearchElapsed", loopSearchElapsed(metadata.loopSearchDiagnostics)),
            row("loopDirectCount", loopRouteCount(metadata.loopSearchDiagnostics?.directRouteCount)),
            row("loopFallbackCount", loopRouteCount(metadata.loopSearchDiagnostics?.fallbackRouteCount)),
            row("loopRejections", rejectionSummary(metadata.loopSearchDiagnostics?.rejectionCounts)),
            row("loopBudgetReached", boolLabel(metadata.loopSearchDiagnostics?.didReachTimeBudget)),
            row("rawPrompt", intent.rawPrompt),
            row("activityType", intent.activityType.rawValue),
            row("routeType", intent.routeType.rawValue),
            row("startLocationQuery", optional(intent.startLocationQuery)),
            row("endLocationQuery", optional(intent.endLocationQuery)),
            row("regionQuery", optional(intent.regionQuery)),
            row("targetDistanceKm", distanceLabel(intent.targetDistanceKm)),
            row("targetDurationMinutes", minutesLabel(intent.targetDurationMinutes)),
            row("difficulty", intent.difficulty?.rawValue ?? "nil"),
            row("desiredFeatures", featureList(intent.desiredFeatures)),
            row("avoidFeatures", avoidList(intent.avoidFeatures)),
            row("transportMode", intent.transportMode?.rawValue ?? "nil"),
            row("confidence", confidenceLabel(intent.confidence)),
            row("geocodedStartLabel", optional(metadata.geocodedStartLabel)),
            row("geocodedEndLabel", optional(metadata.geocodedEndLabel))
        ]
    }

    static func parserSourceLabel(_ source: IntentParserSource) -> String {
        switch source {
        case .localRuleBased:
            "localRuleBased"
        case .remoteAI:
            "remoteAI"
        }
    }

    private static func row(_ label: String, _ value: String) -> IntentDebugRow {
        IntentDebugRow(label: label, value: value)
    }

    private static func optional(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "nil" }
        return value
    }

    private static func boolLabel(_ value: Bool?) -> String {
        guard let value else { return "unknown" }
        return value ? "yes" : "no"
    }

    private static func statusCodeLabel(_ value: Int?) -> String {
        guard let value else { return "nil" }
        return "\(value)"
    }

    private static func distanceLabel(_ value: Double?) -> String {
        guard let value else { return "nil" }
        return value.formatted(.number.precision(.fractionLength(value.rounded() == value ? 0 : 1))) + " km"
    }

    private static func minutesLabel(_ value: Int?) -> String {
        guard let value else { return "nil" }
        return "\(value) min"
    }

    private static func confidenceLabel(_ value: Double?) -> String {
        guard let value else { return "nil" }
        return value.formatted(.number.precision(.fractionLength(2)))
    }

    private static func loopSearchStatus(
        _ diagnostics: LoopSearchDiagnostics?,
        outcome: LoopSearchOutcome?
    ) -> String {
        guard diagnostics != nil || outcome != nil else { return "not_applicable" }
        switch outcome {
        case let .comparison(routeCount):
            return "comparison (\(routeCount) routes)"
        case .singleRoute:
            return "single distinct route"
        case nil:
            return "unknown"
        }
    }

    private static func loopSearchElapsed(_ diagnostics: LoopSearchDiagnostics?) -> String {
        guard let diagnostics else { return "nil" }
        return "\(diagnostics.elapsedMilliseconds) ms"
    }

    private static func loopRouteCount(_ count: Int?) -> String {
        count.map(String.init) ?? "nil"
    }

    private static func rejectionSummary(_ values: [String: Int]?) -> String {
        guard let values, !values.isEmpty else { return "[]" }
        return values.keys.sorted().map { "\($0): \(values[$0] ?? 0)" }.joined(separator: ", ")
    }

    private static func featureList(_ features: [DesiredFeature]) -> String {
        features.isEmpty ? "[]" : features.map(\.rawValue).joined(separator: ", ")
    }

    private static func avoidList(_ features: [AvoidFeature]) -> String {
        features.isEmpty ? "[]" : features.map(\.rawValue).joined(separator: ", ")
    }
}

struct TrailRoute: Identifiable, Hashable {
    let id: UUID
    let provenance: RouteProvenance
    let title: String
    let location: String
    let activity: ActivityType
    let distanceKilometers: Double
    let elevationGainMeters: Int
    let elevationLossMeters: Int?
    let durationHours: Double
    let difficulty: RouteDifficulty
    let routeType: TrailRouteType
    let summary: String
    let whyItMatches: String
    let highlights: [Highlight]
    let waypoints: [Waypoint]
    let days: [RouteDay]
    let safetyNotes: [SafetyNote]
    let elevationProfile: [Double]
    let path: [GeoPoint]
    let routeInstructions: [RouteInstruction]
    let planningMetadata: RoutePlanningMetadata?
    let intentDebugMetadata: RouteIntentDebugMetadata?
    let verifiedCharacteristics: VerifiedRouteCharacteristics?

    init(
        id: UUID,
        provenance: RouteProvenance,
        title: String,
        location: String,
        activity: ActivityType,
        distanceKilometers: Double,
        elevationGainMeters: Int,
        elevationLossMeters: Int? = nil,
        durationHours: Double,
        difficulty: RouteDifficulty,
        routeType: TrailRouteType,
        summary: String,
        whyItMatches: String,
        highlights: [Highlight],
        waypoints: [Waypoint],
        days: [RouteDay],
        safetyNotes: [SafetyNote],
        elevationProfile: [Double],
        path: [GeoPoint],
        routeInstructions: [RouteInstruction] = [],
        planningMetadata: RoutePlanningMetadata? = nil,
        intentDebugMetadata: RouteIntentDebugMetadata? = nil,
        verifiedCharacteristics: VerifiedRouteCharacteristics? = nil
    ) {
        self.id = id
        self.provenance = provenance
        self.title = title
        self.location = location
        self.activity = activity
        self.distanceKilometers = distanceKilometers
        self.elevationGainMeters = elevationGainMeters
        self.elevationLossMeters = elevationLossMeters
        self.durationHours = durationHours
        self.difficulty = difficulty
        self.routeType = routeType
        self.summary = summary
        self.whyItMatches = whyItMatches
        self.highlights = highlights
        self.waypoints = waypoints
        self.days = days
        self.safetyNotes = safetyNotes
        self.elevationProfile = elevationProfile
        self.path = path
        self.routeInstructions = routeInstructions
        self.planningMetadata = planningMetadata
        self.intentDebugMetadata = intentDebugMetadata
        self.verifiedCharacteristics = verifiedCharacteristics
    }

    var distanceLabel: String {
        distanceKilometers.formatted(.number.precision(.fractionLength(distanceKilometers.rounded() == distanceKilometers ? 0 : 1))) + " km"
    }

    var elevationLabel: String {
        elevationGainMeters.formatted() + " m"
    }

    var durationMinutes: Int {
        Int((durationHours * 60).rounded())
    }

    var durationLabel: String {
        if durationHours >= 12, !days.isEmpty {
            return "\(days.count) days"
        }
        let hours = Int(durationHours)
        let minutes = Int((durationHours - Double(hours)) * 60)
        return minutes == 0 ? "\(hours) hr" : "\(hours) hr \(minutes) min"
    }

    func withPlanningMetadata(_ metadata: RoutePlanningMetadata?) -> TrailRoute {
        TrailRoute(
            id: id,
            provenance: provenance,
            title: title,
            location: location,
            activity: activity,
            distanceKilometers: distanceKilometers,
            elevationGainMeters: elevationGainMeters,
            elevationLossMeters: elevationLossMeters,
            durationHours: durationHours,
            difficulty: difficulty,
            routeType: routeType,
            summary: summary,
            whyItMatches: whyItMatches,
            highlights: highlights,
            waypoints: waypoints,
            days: days,
            safetyNotes: safetyNotes,
            elevationProfile: elevationProfile,
            path: path,
            routeInstructions: routeInstructions,
            planningMetadata: metadata,
            intentDebugMetadata: intentDebugMetadata,
            verifiedCharacteristics: verifiedCharacteristics
        )
    }

    func withIntentDebugMetadata(_ metadata: RouteIntentDebugMetadata?) -> TrailRoute {
        TrailRoute(
            id: id,
            provenance: provenance,
            title: title,
            location: location,
            activity: activity,
            distanceKilometers: distanceKilometers,
            elevationGainMeters: elevationGainMeters,
            elevationLossMeters: elevationLossMeters,
            durationHours: durationHours,
            difficulty: difficulty,
            routeType: routeType,
            summary: summary,
            whyItMatches: whyItMatches,
            highlights: highlights,
            waypoints: waypoints,
            days: days,
            safetyNotes: safetyNotes,
            elevationProfile: elevationProfile,
            path: path,
            routeInstructions: routeInstructions,
            planningMetadata: planningMetadata,
            intentDebugMetadata: metadata,
            verifiedCharacteristics: verifiedCharacteristics
        )
    }

    func withRoutingStrategy(_ strategy: RouteRoutingStrategy) throws -> TrailRoute {
        guard case let .routed(routedProvenance) = provenance else {
            throw RouteEligibilityError.unverified(
                purpose: .productionSuccess,
                provenance: provenance
            )
        }
        return TrailRoute(
            id: id,
            provenance: .routed(routedProvenance.withStrategy(strategy)),
            title: title,
            location: location,
            activity: activity,
            distanceKilometers: distanceKilometers,
            elevationGainMeters: elevationGainMeters,
            elevationLossMeters: elevationLossMeters,
            durationHours: durationHours,
            difficulty: difficulty,
            routeType: routeType,
            summary: summary,
            whyItMatches: whyItMatches,
            highlights: highlights,
            waypoints: waypoints,
            days: days,
            safetyNotes: safetyNotes,
            elevationProfile: elevationProfile,
            path: path,
            routeInstructions: routeInstructions,
            planningMetadata: planningMetadata,
            intentDebugMetadata: intentDebugMetadata,
            verifiedCharacteristics: verifiedCharacteristics
        )
    }

    var isVerifiedRoutedResult: Bool {
        (try? RouteEligibilityPolicy.validate(self, for: .productionSuccess)) != nil
    }
}

enum RouteEligibilityPurpose: String, Hashable, Sendable {
    case productionSuccess
    case persistence
    case export
}

enum RouteEligibilityError: LocalizedError, Sendable {
    case unverified(purpose: RouteEligibilityPurpose, provenance: RouteProvenance)
    case invalidGeometry(purpose: RouteEligibilityPurpose)
    case invalidQuantitativeFacts(purpose: RouteEligibilityPurpose)
    case factualDifficultyMismatch(
        purpose: RouteEligibilityPurpose,
        expected: RouteDifficulty,
        actual: RouteDifficulty
    )
    case routedFactsChanged(purpose: RouteEligibilityPurpose)

    var errorDescription: String? {
        switch self {
        case let .unverified(purpose, _):
            "Only verified routing-engine results are eligible for \(purpose.label)."
        case let .invalidGeometry(purpose):
            "This route does not have valid routed geometry for \(purpose.label)."
        case let .invalidQuantitativeFacts(purpose):
            "This route does not have valid routed statistics for \(purpose.label)."
        case let .factualDifficultyMismatch(purpose, _, _):
            "This route’s factual difficulty does not match its routed statistics for \(purpose.label)."
        case let .routedFactsChanged(purpose):
            "This route’s geometry or statistics changed without a new routing response, so it cannot be used for \(purpose.label)."
        }
    }
}

private extension RouteEligibilityPurpose {
    nonisolated var label: String {
        switch self {
        case .productionSuccess: "route success"
        case .persistence: "saving"
        case .export: "export"
        }
    }
}

enum RouteEligibilityPolicy {
    static func validate(
        _ route: TrailRoute,
        for purpose: RouteEligibilityPurpose
    ) throws {
        guard case let .routed(routedProvenance) = route.provenance else {
            throw RouteEligibilityError.unverified(
                purpose: purpose,
                provenance: route.provenance
            )
        }

        guard hasValidGeometry(route.path) else {
            throw RouteEligibilityError.invalidGeometry(purpose: purpose)
        }
        guard
            route.distanceKilometers.isFinite,
            route.distanceKilometers > 0,
            route.durationHours.isFinite,
            route.durationHours > 0,
            route.elevationGainMeters >= 0,
            route.elevationLossMeters.map({ $0 >= 0 }) ?? true
        else {
            throw RouteEligibilityError.invalidQuantitativeFacts(purpose: purpose)
        }

        let expectedDifficulty = RouteDifficulty.estimated(
            distanceKilometers: route.distanceKilometers,
            elevationGainMeters: route.elevationGainMeters
        )
        guard route.difficulty == expectedDifficulty else {
            throw RouteEligibilityError.factualDifficultyMismatch(
                purpose: purpose,
                expected: expectedDifficulty,
                actual: route.difficulty
            )
        }

        let actualFingerprint = RouteFactFingerprint.make(
            activity: route.activity,
            routeType: route.routeType,
            distanceKilometers: route.distanceKilometers,
            elevationGainMeters: route.elevationGainMeters,
            elevationLossMeters: route.elevationLossMeters,
            durationHours: route.durationHours,
            difficulty: route.difficulty,
            path: route.path,
            verifiedCharacteristics: route.verifiedCharacteristics
        )
        guard routedProvenance.factFingerprint == actualFingerprint else {
            throw RouteEligibilityError.routedFactsChanged(purpose: purpose)
        }
    }

    private static func hasValidGeometry(_ path: [GeoPoint]) -> Bool {
        guard path.count >= 2 else { return false }
        guard path.allSatisfy({ point in
            point.latitude.isFinite &&
                point.longitude.isFinite &&
                (-90...90).contains(point.latitude) &&
                (-180...180).contains(point.longitude) &&
                (point.elevationMeters?.isFinite ?? true)
        }) else { return false }

        let first = path[0]
        return path.dropFirst().contains { point in
            point.latitude != first.latitude || point.longitude != first.longitude
        }
    }
}

enum IntentParserSource: String, Hashable, Sendable {
    case localRuleBased
    case remoteAI
}

enum TransportMode: String, Hashable, Sendable {
    case walking
    case cycling

    init(activityType: ActivityType) {
        switch activityType {
        case .hiking, .trailRunning:
            self = .walking
        case .biking:
            self = .cycling
        }
    }
}

struct AdventureIntent: Hashable, Sendable {
    let rawPrompt: String
    let parserSource: IntentParserSource
    let confidence: Double?
    let activityType: ActivityType
    let routeType: TrailRouteType
    let startLocationQuery: String?
    let endLocationQuery: String?
    let regionQuery: String?
    let targetDistanceKm: Double?
    let targetDurationMinutes: Int?
    let difficulty: RouteDifficulty?
    let desiredFeatures: [DesiredFeature]
    let avoidFeatures: [AvoidFeature]
    let mustHaveResearchExperiences:
        [MustHaveResearchExperienceConstraint]
    let transportMode: TransportMode?

    init(
        rawPrompt: String,
        parserSource: IntentParserSource,
        confidence: Double?,
        activityType: ActivityType,
        routeType: TrailRouteType,
        startLocationQuery: String?,
        endLocationQuery: String?,
        regionQuery: String?,
        targetDistanceKm: Double?,
        targetDurationMinutes: Int?,
        difficulty: RouteDifficulty?,
        desiredFeatures: [DesiredFeature],
        avoidFeatures: [AvoidFeature],
        mustHaveResearchExperiences:
            [MustHaveResearchExperienceConstraint] = [],
        transportMode: TransportMode? = nil
    ) {
        self.rawPrompt = rawPrompt
        self.parserSource = parserSource
        self.confidence = confidence
        self.activityType = activityType
        self.routeType = routeType
        self.startLocationQuery = startLocationQuery
        self.endLocationQuery = endLocationQuery
        self.regionQuery = regionQuery
        self.targetDistanceKm = targetDistanceKm
        self.targetDurationMinutes = targetDurationMinutes
        self.difficulty = difficulty
        self.desiredFeatures = desiredFeatures
        self.avoidFeatures = avoidFeatures
        self.mustHaveResearchExperiences =
            mustHaveResearchExperiences
        self.transportMode = transportMode ?? TransportMode(activityType: activityType)
    }

    init(rawPrompt: String, parsedPrompt: ParsedRoutePrompt, parserSource: IntentParserSource = .localRuleBased) {
        self.init(
            rawPrompt: rawPrompt,
            parserSource: parserSource,
            confidence: 1,
            activityType: parsedPrompt.activityType,
            routeType: parsedPrompt.routeType,
            startLocationQuery: parsedPrompt.startLocationQuery,
            endLocationQuery: parsedPrompt.endLocationQuery,
            regionQuery: nil,
            targetDistanceKm: parsedPrompt.preferredDistanceKilometers,
            targetDurationMinutes: parsedPrompt.preferredDurationHours.map { Int(($0 * 60).rounded()) },
            difficulty: parsedPrompt.difficulty,
            desiredFeatures: parsedPrompt.desiredFeatures,
            avoidFeatures: parsedPrompt.avoidFeatures + (
                parsedPrompt.difficulty == .easy && !parsedPrompt.avoidFeatures.contains(.steepClimbs)
                    ? [.steepClimbs]
                    : []
            )
        )
    }

    var requestedFeaturePreferences: [DesiredFeature] {
        desiredFeatures
    }

    var prompt: String {
        rawPrompt
    }
}

struct ValidatedAdventureIntent: Hashable, Sendable {
    let rawPrompt: String
    let parserSource: IntentParserSource
    let confidence: Double?
    let activityType: ActivityType
    let routeType: TrailRouteType
    let startLocationQuery: String?
    let endLocationQuery: String?
    let regionQuery: String?
    let targetDistanceKm: Double?
    let targetDurationMinutes: Int?
    let difficulty: RouteDifficulty?
    let desiredFeatures: [DesiredFeature]
    let avoidFeatures: [AvoidFeature]
    let mustHaveResearchExperiences:
        [MustHaveResearchExperienceConstraint]
    let transportMode: TransportMode?

    init(intent: AdventureIntent) {
        rawPrompt = intent.rawPrompt
        parserSource = intent.parserSource
        confidence = intent.confidence
        activityType = intent.activityType
        routeType = intent.routeType
        startLocationQuery = intent.startLocationQuery
        endLocationQuery = intent.endLocationQuery
        regionQuery = intent.regionQuery
        targetDistanceKm = intent.targetDistanceKm
        targetDurationMinutes = intent.targetDurationMinutes
        difficulty = intent.difficulty
        desiredFeatures = intent.desiredFeatures
        avoidFeatures = intent.avoidFeatures
        mustHaveResearchExperiences =
            intent.mustHaveResearchExperiences
        transportMode = intent.transportMode
    }

    var startOrRegionQuery: String? {
        startLocationQuery ?? regionQuery
    }

    var requestedFeaturePreferences: [DesiredFeature] {
        desiredFeatures
    }

    var graphHopperProfile: String {
        switch activityType {
        case .biking:
            "bike"
        case .hiking, .trailRunning:
            "foot"
        }
    }
}

struct RouteSuggestionDebugMetadata: Hashable, Sendable {
    let targetDistanceKm: Double?
    let actualDistanceKm: Double
    let distanceRatio: Double?
    let overlapRatio: Double?
    let shapeQualityScore: Double?
    let radiusKm: Double?
    let bearingSeed: Int?
    let bearingPattern: String?
    let provider: String
    let rejectionReason: String?

    init(
        targetDistanceKm: Double?,
        actualDistanceKm: Double,
        distanceRatio: Double?,
        overlapRatio: Double? = nil,
        shapeQualityScore: Double? = nil,
        radiusKm: Double?,
        bearingSeed: Int?,
        bearingPattern: String? = nil,
        provider: String,
        rejectionReason: String?
    ) {
        self.targetDistanceKm = targetDistanceKm
        self.actualDistanceKm = actualDistanceKm
        self.distanceRatio = distanceRatio
        self.overlapRatio = overlapRatio
        self.shapeQualityScore = shapeQualityScore
        self.radiusKm = radiusKm
        self.bearingSeed = bearingSeed
        self.bearingPattern = bearingPattern
        self.provider = provider
        self.rejectionReason = rejectionReason
    }
}

struct RouteSuggestion: Identifiable, Hashable {
    let id: UUID
    let route: TrailRoute
    let explanation: String
    let debugMetadata: RouteSuggestionDebugMetadata?

    init(
        id: UUID = UUID(),
        route: TrailRoute,
        explanation: String,
        debugMetadata: RouteSuggestionDebugMetadata? = nil
    ) {
        self.id = id
        self.route = route
        self.explanation = explanation
        self.debugMetadata = debugMetadata
    }
}

struct UserPreferences: Codable, Hashable, Sendable {
    var preferredActivity: ActivityType = .hiking
    var fitnessLevel: RouteDifficulty = .moderate
    var preferredDistanceKilometers: Double = 15
    var avoidsSteepClimbs = false
    var interests: Set<String> = ["Views", "Forest", "Waterfalls"]
    var cautiousSafetyMode = true
    var prefersOfflineMaps = true
    var hapticsEnabled = true
}
