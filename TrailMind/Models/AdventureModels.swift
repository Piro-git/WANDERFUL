import Foundation

enum ActivityType: String, CaseIterable, Identifiable, Hashable, Sendable {
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

enum RouteDifficulty: String, CaseIterable, Hashable, Sendable {
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
}

enum TrailRouteType: String, Hashable, Sendable {
    case loop = "Loop"
    case pointToPoint = "Point to point"
    case multiDay = "Multi-day"
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

enum AvoidFeature: String, CaseIterable, Hashable, Sendable {
    case majorRoads
    case steepClimbs

    var label: String {
        switch self {
        case .majorRoads: "Avoid major roads"
        case .steepClimbs: "Avoid steep climbs"
        }
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
        let targetDistanceKm = parsedPrompt.preferredDistanceKilometers
            ?? (parsedPrompt.routeType == .loop ? Self.defaultLoopDistanceKm(for: parsedPrompt.activityType) : nil)
        self.init(
            routeType: parsedPrompt.routeType,
            startQuery: parsedPrompt.startLocationQuery,
            endQuery: parsedPrompt.endLocationQuery,
            activityType: parsedPrompt.activityType,
            graphHopperProfile: parsedPrompt.graphHopperProfile,
            targetDistanceKm: targetDistanceKm,
            targetDurationMinutes: parsedPrompt.preferredDurationHours.map { Int(($0 * 60).rounded()) },
            difficulty: parsedPrompt.difficulty,
            desiredFeatures: parsedPrompt.desiredFeatures,
            avoidFeatures: parsedPrompt.difficulty == .easy ? [.steepClimbs] : []
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
                ?? (validatedIntent.routeType == .loop ? Self.defaultLoopDistanceKm(for: validatedIntent.activityType) : nil),
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

    func title(startName: String, endName: String) -> String {
        if routeType == .loop {
            return loopTitle(startName: startName)
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

    func loopTitle(startName: String) -> String {
        let distancePrefix = targetDistanceKm.map {
            "\($0.formatted(.number.precision(.fractionLength($0.rounded() == $0 ? 0 : 1)))) km "
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
}

struct RoutePlanningMetadata: Hashable, Sendable {
    let routeType: TrailRouteType
    let activityType: ActivityType
    let targetDistanceKm: Double?
    let targetDurationMinutes: Int?
    let difficulty: RouteDifficulty?
    let desiredFeatures: [DesiredFeature]
    let avoidFeatures: [AvoidFeature]
    let seed: Int?
    let variantLabel: String?

    var isEmpty: Bool {
        routeType == .pointToPoint &&
        targetDistanceKm == nil &&
        targetDurationMinutes == nil &&
        difficulty == nil &&
        desiredFeatures.isEmpty &&
        avoidFeatures.isEmpty &&
        seed == nil &&
        variantLabel == nil
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
        variantLabel: String? = nil
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
            variantLabel: label
        )
    }

    var requestedFeatureSummary: String? {
        guard !desiredFeatures.isEmpty else { return nil }
        return "Requested: \(desiredFeatures.map(\.label).joined(separator: ", "))"
    }

    func distanceNote(actualDistanceKm: Double) -> String? {
        guard let targetDistanceKm else { return nil }
        let difference = abs(actualDistanceKm - targetDistanceKm)
        let threshold = max(2.0, targetDistanceKm * 0.2)
        guard difference >= threshold else { return nil }
        return "Actual route is \(actualDistanceKm.formatted(.number.precision(.fractionLength(1)))) km based on available paths."
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

            if metadata.routeType == .loop || route.routeType == .loop {
                explanations.append(
                    RouteQualityExplanation(
                        title: "Loop route",
                        detail: "Starts and finishes at the same area.",
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

        if hasLiveRoutingEvidence(route: route, debugMetadata: debugMetadata) {
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
        guard let targetDistanceKm = metadata.targetDistanceKm, targetDistanceKm > 0 else { return }

        let actualDistanceKm = route.distanceKilometers
        let difference = actualDistanceKm - targetDistanceKm
        let tolerance = max(1.0, targetDistanceKm * 0.12)
        let detail = "Actual \(Self.distanceLabel(actualDistanceKm)) vs requested \(Self.distanceLabel(targetDistanceKm))."

        if abs(difference) <= tolerance {
            explanations.append(
                RouteQualityExplanation(
                    title: "Close to your target distance",
                    detail: detail,
                    symbol: "ruler"
                )
            )
        } else if difference < 0 {
            explanations.append(
                RouteQualityExplanation(
                    title: "Shorter than target",
                    detail: detail,
                    symbol: "minus.circle.fill"
                )
            )
        } else {
            explanations.append(
                RouteQualityExplanation(
                    title: "Longer than target",
                    detail: detail,
                    symbol: "plus.circle.fill"
                )
            )
        }
    }

    private static func appendVariantExplanation(
        metadata: RoutePlanningMetadata,
        to explanations: inout [RouteQualityExplanation]
    ) {
        switch metadata.variantLabel {
        case "Easier Option":
            explanations.append(
                RouteQualityExplanation(
                    title: "Easier elevation option",
                    detail: "Lower climb among the generated route variants.",
                    symbol: "leaf.fill"
                )
            )
        case "More Elevation":
            explanations.append(
                RouteQualityExplanation(
                    title: "More elevation option",
                    detail: "Higher climb among the generated route variants.",
                    symbol: "mountain.2.fill"
                )
            )
        case "Shorter Loop":
            explanations.append(
                RouteQualityExplanation(
                    title: "Shorter loop option",
                    detail: "A shorter generated variant for comparison.",
                    symbol: "minus.circle.fill"
                )
            )
        case "Longer Loop":
            explanations.append(
                RouteQualityExplanation(
                    title: "Longer loop option",
                    detail: "A longer generated variant for comparison.",
                    symbol: "plus.circle.fill"
                )
            )
        default:
            break
        }
    }

    private static func hasLiveRoutingEvidence(
        route: TrailRoute,
        debugMetadata: RouteSuggestionDebugMetadata?
    ) -> Bool {
        if !route.routeInstructions.isEmpty {
            return true
        }

        return debugMetadata?.provider == "LoopFallbackProvider"
    }

    private static func unique(_ explanations: [RouteQualityExplanation]) -> [RouteQualityExplanation] {
        var seen = Set<String>()
        return explanations.filter { explanation in
            seen.insert(explanation.title).inserted
        }
    }

    private static func distanceLabel(_ distanceKm: Double) -> String {
        distanceKm.formatted(.number.precision(.fractionLength(distanceKm.rounded() == distanceKm ? 0 : 1))) + " km"
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
    let geocodedStartLabel: String?
    let geocodedEndLabel: String?

    init(
        intent: ValidatedAdventureIntent,
        validationStatus: String = "validated",
        localFallbackUsed: Bool? = nil,
        geocodedStartLabel: String?,
        geocodedEndLabel: String?
    ) {
        self.intent = intent
        self.validationStatus = validationStatus
        self.localFallbackUsed = localFallbackUsed ?? (intent.parserSource == .localRuleBased)
        self.geocodedStartLabel = geocodedStartLabel
        self.geocodedEndLabel = geocodedEndLabel
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

    private static func featureList(_ features: [DesiredFeature]) -> String {
        features.isEmpty ? "[]" : features.map(\.rawValue).joined(separator: ", ")
    }

    private static func avoidList(_ features: [AvoidFeature]) -> String {
        features.isEmpty ? "[]" : features.map(\.rawValue).joined(separator: ", ")
    }
}

struct TrailRoute: Identifiable, Hashable {
    let id: UUID
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

    init(
        id: UUID,
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
        intentDebugMetadata: RouteIntentDebugMetadata? = nil
    ) {
        self.id = id
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
            intentDebugMetadata: intentDebugMetadata
        )
    }

    func withIntentDebugMetadata(_ metadata: RouteIntentDebugMetadata?) -> TrailRoute {
        TrailRoute(
            id: id,
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
            intentDebugMetadata: metadata
        )
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
            avoidFeatures: parsedPrompt.difficulty == .easy ? [.steepClimbs] : []
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
    let matchScore: Int
    let explanation: String
    let debugMetadata: RouteSuggestionDebugMetadata?

    init(
        id: UUID = UUID(),
        route: TrailRoute,
        matchScore: Int,
        explanation: String,
        debugMetadata: RouteSuggestionDebugMetadata? = nil
    ) {
        self.id = id
        self.route = route
        self.matchScore = matchScore
        self.explanation = explanation
        self.debugMetadata = debugMetadata
    }
}

struct UserPreferences: Hashable {
    var preferredActivity: ActivityType = .hiking
    var fitnessLevel: RouteDifficulty = .moderate
    var preferredDistanceKilometers: Double = 15
    var avoidsSteepClimbs = false
    var interests: Set<String> = ["Views", "Forest", "Waterfalls"]
    var cautiousSafetyMode = true
    var prefersOfflineMaps = true
    var hapticsEnabled = true
}
