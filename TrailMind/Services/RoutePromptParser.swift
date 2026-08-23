import Foundation

struct ParsedRoutePrompt: Equatable, Sendable {
    let routeType: TrailRouteType
    let startLocationQuery: String
    let endLocationQuery: String?
    let activityType: ActivityType
    let preferredDistanceKilometers: Double?
    let preferredDurationHours: Double?
    let difficulty: RouteDifficulty?
    let desiredFeatures: [DesiredFeature]
    let avoidFeatures: [AvoidFeature]

    var graphHopperProfile: String {
        switch activityType {
        case .biking:
            "bike"
        case .hiking, .trailRunning:
            "foot"
        }
    }
}

enum RoutePromptParserError: LocalizedError, Equatable {
    case invalidPrompt

    var errorDescription: String? {
        "Which area should I plan around?"
    }
}

struct RoutePromptParser: Sendable {
    private enum CaptureLayout {
        case startEnd
        case endStart
    }

    private static let loopPatterns: [NSRegularExpression] = [
        try! NSRegularExpression(
            pattern: #"^\s*.*?\b(?:rundwanderung|rundtour|wanderung|tour|hike|walk|trailrun|trail\s+run)\b.*?\b(?:in\s+den|in\s+der|in\s+the|im|in)\s+(.+?)(?:\s+(?:machen|planen|unternehmen|gehen|with|mit|for|für)\b|[.!?]|$)"#,
            options: [.caseInsensitive]
        ),
        try! NSRegularExpression(
            pattern: #"^\s*(?:.+?\s+)?(?:rundwanderung|rundtour|runde)\s+(?:um|ab|bei)\s+(.+?)\s*$"#,
            options: [.caseInsensitive]
        ),
        try! NSRegularExpression(
            pattern: #"^\s*(?:.+?\s+)?(?:wanderung|tour|lauf|trailrun|trail\s+run|hike|walk|run)\s+(?:um|ab|bei|around|near)\s+(.+?)\s*$"#,
            options: [.caseInsensitive]
        ),
        try! NSRegularExpression(
            pattern: #"^\s*(?:.+?\s+)?(?:um|bei|around|near)\s+(.+?)\s+.*(?:wandern|wanderung|hike|trail\s*run|trailrun|laufen|run)\b.*$"#,
            options: [.caseInsensitive]
        ),
        try! NSRegularExpression(
            pattern: #"^\s*(?:.+?\s+)?(?:im|in der|in den)\s+(.+?)\s+.*(?:wandern|wanderung|hike|laufen|trailrun|trail\s*run|run)\b.*$"#,
            options: [.caseInsensitive]
        ),
        try! NSRegularExpression(
            pattern: #"^\s*(?:.+?\s+)?(?:loop|round\s+trip)\s+(?:around|from)\s+(.+?)\s*$"#,
            options: [.caseInsensitive]
        )
    ]

    private static let patterns: [(regex: NSRegularExpression, layout: CaptureLayout)] = [
        // "Start: Ilsenburg, Ziel: Schierke"
        (
            try! NSRegularExpression(
                pattern: #"^\s*(?:(?:route|tour|wanderung|hike)\s*)?(?:start|startpunkt|von|from)\s*[:=-]?\s*(.+?)\s*(?:,|;|\||\s+)\s*(?:ziel|zielort|ende|nach|zum|zur|to)\s*[:=-]?\s*(.+?)\s*$"#,
                options: [.caseInsensitive]
            ),
            .startEnd
        ),
        // "Ilsenburg → Schierke"
        (
            try! NSRegularExpression(
                pattern: #"^\s*(.+?)\s*(?:→|->|–>|=>)\s*(.+?)\s*$"#,
                options: [.caseInsensitive]
            ),
            .startEnd
        ),
        // "nach Schierke von Ilsenburg"
        (
            try! NSRegularExpression(
                pattern: #"^\s*(?:.+?\s+)?nach\s+(.+?)\s+von\s+(.+?)\s*$"#,
                options: [.caseInsensitive]
            ),
            .endStart
        ),
        // "mach mir eine schöne Wanderung von Ilsenburg nach Schierke"
        (
            try! NSRegularExpression(
                pattern: #"^\s*(?:.+?\s+)?von\s+(.+?)\s+(?:nach|zum|zur)\s+(.+?)\s*$"#,
                options: [.caseInsensitive]
            ),
            .startEnd
        ),
        // "Ilsenburg nach Schierke"
        (
            try! NSRegularExpression(
                pattern: #"^\s*(?:(?:wanderung|tour|route|strecke|radroute|radtour|lauf|trailrun)\s+)?(.+?)\s+(?:nach|zum|zur|bis)\s+(.+?)\s*$"#,
                options: [.caseInsensitive]
            ),
            .startEnd
        ),
        // "Plan a hike from Ilsenburg to Schierke"
        (
            try! NSRegularExpression(
                pattern: #"^\s*(?:.+?\s+)?from\s+(.+?)\s+to\s+(.+?)\s*$"#,
                options: [.caseInsensitive]
            ),
            .startEnd
        ),
        // "Ilsenburg to Schierke"
        (
            try! NSRegularExpression(
                pattern: #"^\s*(?:(?:hike|walk|route|tour|bike ride|run|trail run)\s+)?(.+?)\s+to\s+(.+?)\s*$"#,
                options: [.caseInsensitive]
            ),
            .startEnd
        )
    ]

    private static let trailingLocationPatterns = [
        #"\s+(?:mit|with)\s+(?:aussicht|views?|panorama|wald|forest|wasser|water|wasserfall|waterfall|ruhig|quiet|sonnenuntergang|sunset)\b.*$"#,
        #"\s+(?:mit|with)\s+(?:wenig|little|not too much)\s+(?:gleicher|same|shared|zuruck|zurück|back)\b.*$"#,
        #"\s+(?:moglichst|möglichst)\s+(?:wenig|kaum)\s+(?:gleicher|denselben|gleichen|same)\b.*$"#,
        #"\s+(?:,|;|-)?\s*(?:eher|rather)?\s*(?:easy|leicht|einfach|entspannt|relaxed|gentle)\b.*$"#,
        #"\s+(?:für|for)\s+\d+(?:[,.]\d+)?\s*(?:km|kilometer|h|std\.?|stunden?|hours?|hrs?)\b.*$"#,
        #"\s+(?:ca\.?|circa|ungefähr|ungefaehr|about|around)\s+\d+(?:[,.]\d+)?\s*(?:km|kilometer|h|std\.?|stunden?|hours?|hrs?|minutes?|minuten?|mins?)\b.*$"#,
        #"\s+(?:heute|morgen|today|tomorrow)\b.*$"#
    ]

    func parse(_ prompt: String) throws -> ParsedRoutePrompt {
        let candidates = promptCandidates(from: prompt)
        if candidates.count > 1 {
            for candidate in candidates {
                if let parsedPrompt = try? parseSingle(candidate) {
                    return parsedPrompt
                }
            }
        }

        return try parseSingle(prompt)
    }

    /// Evaluates the raw prompt itself. Callers must retain this alongside the
    /// parsed result instead of reconstructing explicitness from parser
    /// defaults such as the default hiking activity.
    func hikingPreferenceExplicitness(
        in prompt: String
    ) -> AdventureIntentPreferenceExplicitnessV1 {
        let value = normalized(prompt)
        let noGeneralPreferences = containsAny(
            value,
            [
                "no special preferences", "anything is fine",
                "keine besonderen wunsche", "keine besondere praferenz", "egal was"
            ]
        )

        let activity: AdventureIntentPreferenceFieldStateV1
        if containsAny(
            value,
            ["any activity", "no activity preference", "egal welche aktivitat"]
        ) {
            activity = .noPreference
        } else if containsAny(
            value,
            [
                "fahrrad", "radfahrt", "radtour", "radroute", "bike", "biking", "cycling",
                "trailrun", "trail run", "running", "joggen", "lauf",
                "wandern", "wanderung", "hike", "hiking", "walk"
            ]
        ) {
            activity = .specified
        } else {
            activity = .omitted
        }

        let comfort: AdventureIntentPreferenceFieldStateV1
        if containsAny(
            value,
            [
                "any distance", "any duration", "no distance preference",
                "no duration preference", "egal wie weit", "egal wie lange"
            ]
        ) {
            comfort = .noPreference
        } else if preferredDistanceKilometers(in: prompt) != nil ||
                    preferredDurationHours(in: prompt) != nil {
            comfort = .specified
        } else {
            comfort = .omitted
        }

        let routeShape: AdventureIntentPreferenceFieldStateV1
        if containsAny(
            value,
            [
                "any route shape", "no route shape preference",
                "loop or point to point", "egal welche streckenform"
            ]
        ) {
            routeShape = .noPreference
        } else if containsRouteShapeCue(value) {
            routeShape = .specified
        } else {
            routeShape = .omitted
        }

        let requestedExperiences: AdventureIntentPreferenceFieldStateV1
        if noGeneralPreferences || containsAny(
            value,
            ["no scenery preference", "keine landschaftspraferenz"]
        ) {
            requestedExperiences = .noPreference
        } else if !desiredFeatures(in: prompt).isEmpty {
            requestedExperiences = .specified
        } else {
            requestedExperiences = .omitted
        }

        let softAvoidances: AdventureIntentPreferenceFieldStateV1
        if noGeneralPreferences || containsAny(
            value,
            ["no avoidances", "nothing to avoid", "nichts vermeiden", "keine vermeidungen"]
        ) {
            softAvoidances = .noPreference
        } else if !avoidFeatures(in: prompt).isEmpty {
            softAvoidances = .specified
        } else {
            softAvoidances = .omitted
        }

        return AdventureIntentPreferenceExplicitnessV1(
            activity: activity,
            comfortableOuting: comfort,
            routeShape: routeShape,
            requestedExperiences: requestedExperiences,
            softAvoidances: softAvoidances
        )
    }

    private func parseSingle(_ prompt: String) throws -> ParsedRoutePrompt {
        let fullRange = NSRange(prompt.startIndex..<prompt.endIndex, in: prompt)

        if let loopPrompt = parseLoop(prompt, fullRange: fullRange) {
            return loopPrompt
        }

        for pattern in Self.patterns {
            guard
                let match = pattern.regex.firstMatch(in: prompt, range: fullRange),
                let startRange = Range(match.range(at: 1), in: prompt),
                let endRange = Range(match.range(at: 2), in: prompt)
            else {
                continue
            }

            let firstLocation = cleanLocation(String(prompt[startRange]))
            let secondLocation = cleanLocation(String(prompt[endRange]))
            let start: String
            let end: String
            switch pattern.layout {
            case .startEnd:
                start = firstLocation
                end = secondLocation
            case .endStart:
                start = secondLocation
                end = firstLocation
            }

            guard
                !start.isEmpty,
                !end.isEmpty,
                start.compare(end, options: [.caseInsensitive, .diacriticInsensitive]) != .orderedSame
            else {
                throw RoutePromptParserError.invalidPrompt
            }

            return ParsedRoutePrompt(
                routeType: .pointToPoint,
                startLocationQuery: start,
                endLocationQuery: end,
                activityType: activityType(in: prompt),
                preferredDistanceKilometers: preferredDistanceKilometers(in: prompt),
                preferredDurationHours: preferredDurationHours(in: prompt),
                difficulty: difficulty(in: prompt),
                desiredFeatures: desiredFeatures(in: prompt),
                avoidFeatures: avoidFeatures(in: prompt)
            )
        }

        throw RoutePromptParserError.invalidPrompt
    }

    private func promptCandidates(from prompt: String) -> [String] {
        prompt.components(separatedBy: .newlines)
            .map {
                $0.trimmingCharacters(
                    in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "#"))
                )
            }
            .filter { !$0.isEmpty }
    }

    private func parseLoop(_ prompt: String, fullRange: NSRange) -> ParsedRoutePrompt? {
        for pattern in Self.loopPatterns {
            guard
                let match = pattern.firstMatch(in: prompt, range: fullRange),
                let startRange = Range(match.range(at: 1), in: prompt)
            else {
                continue
            }

            let start = cleanLocation(String(prompt[startRange]))
            guard !start.isEmpty else {
                continue
            }

            return ParsedRoutePrompt(
                routeType: .loop,
                startLocationQuery: start,
                endLocationQuery: nil,
                activityType: activityType(in: prompt),
                preferredDistanceKilometers: preferredDistanceKilometers(in: prompt),
                preferredDurationHours: preferredDurationHours(in: prompt),
                difficulty: difficulty(in: prompt),
                desiredFeatures: desiredFeatures(in: prompt),
                avoidFeatures: avoidFeatures(in: prompt)
            )
        }

        return nil
    }

    private func cleanLocation(_ value: String) -> String {
        var cleaned = value.trimmingCharacters(
            in: CharacterSet.whitespacesAndNewlines.union(
                CharacterSet(charactersIn: #",.;:!?'"„“#"#)
            )
        )

        for pattern in Self.trailingLocationPatterns {
            cleaned = cleaned.replacingOccurrences(
                of: pattern,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        return cleaned.trimmingCharacters(
            in: CharacterSet.whitespacesAndNewlines.union(
                CharacterSet(charactersIn: #",.;:!?'"„“#"#)
            )
        )
    }

    private func activityType(in prompt: String) -> ActivityType {
        let normalized = prompt.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "de_DE")
        )

        if ["fahrrad", "radfahrt", "radtour", "radroute", "bike", "biking", "cycling"].contains(where: normalized.contains) {
            return .biking
        }
        if ["trailrun", "trail run", "running", "joggen", "lauf"].contains(where: normalized.contains) {
            return .trailRunning
        }
        return .hiking
    }

    private func preferredDistanceKilometers(in prompt: String) -> Double? {
        if let rangeValue = firstDistanceRange(in: prompt) {
            return rangeValue
        }

        return firstDouble(
            in: prompt,
            pattern: #"(?:ca\.?|circa|ungefähr|ungefaehr|about|around)?\s*(\d+(?:[,.]\d+)?)\s*(?:km|kilometer)\b"#
        )
    }

    private func preferredDurationHours(in prompt: String) -> Double? {
        if let minutes = firstDouble(
            in: prompt,
            pattern: #"(?:about|around|ca\.?|circa|ungefähr|ungefaehr)?\s*(\d+(?:[,.]\d+)?)\s*(?:minutes?|minuten?|mins?)\b"#
        ) {
            return minutes / 60
        }

        return firstDouble(
            in: prompt,
            pattern: #"(\d+(?:[,.]\d+)?)\s*(?:h|std\.?|stunden?|hours?|hrs?)\b"#
        )
    }

    private func difficulty(in prompt: String) -> RouteDifficulty? {
        let normalized = normalized(prompt)

        if ["nicht zu steil", "not too steep", "wenig steil"].contains(where: normalized.contains) {
            return .easy
        }
        if ["anspruchsvoll", "fordernd", "schwer", "steil", "sportlich", "challenging", "hard", "tough", "sporty"].contains(where: normalized.contains) {
            return .challenging
        }
        if ["leicht", "einfach", "entspannt", "spaziergang", "easy", "relaxed", "gentle"].contains(where: normalized.contains) {
            return .easy
        }
        if ["moderat", "mittel", "medium", "moderate"].contains(where: normalized.contains) {
            return .moderate
        }
        return nil
    }

    private func avoidFeatures(in prompt: String) -> [AvoidFeature] {
        let normalized = normalized(prompt)
        var features: [AvoidFeature] = []

        if ["hauptstraßen", "hauptstrassen", "major roads", "busy roads", "verkehrsreich"].contains(where: normalized.contains) {
            features.append(.majorRoads)
        }
        if ["nicht zu steil", "not too steep", "wenig steil", "avoid steep", "wenig höhenmeter", "wenig hoehenmeter"].contains(where: normalized.contains) {
            features.append(.steepClimbs)
        }
        if ["wenig gleicher strecke", "wenig gleichen weg", "wenig denselben weg", "gleiche strecke zurück", "gleiche strecke zuruck", "avoid backtracking", "little backtracking", "low repeat", "repeated path"].contains(where: normalized.contains) {
            features.append(.repeatedPath)
        }
        return features
    }

    private func desiredFeatures(in prompt: String) -> [DesiredFeature] {
        let normalized = normalized(prompt)
        var features: [DesiredFeature] = []

        append(.viewpoint, to: &features, when: ["aussicht", "blick", "panorama", "view", "views", "scenic"].contains(where: normalized.contains))
        append(.forest, to: &features, when: ["wald", "forest", "woods"].contains(where: normalized.contains))
        append(.water, to: &features, when: ["wasser", "wasserfall", "see", "bach", "fluss", "lake", "river", "waterfall", "water"].contains(where: normalized.contains))
        append(.quiet, to: &features, when: ["ruhig", "einsam", "wenig los", "quiet", "peaceful"].contains(where: normalized.contains))
        append(.sunset, to: &features, when: ["sonnenuntergang", "abendlicht", "sunset", "golden hour"].contains(where: normalized.contains))

        return features
    }

    private func append(_ value: DesiredFeature, to features: inout [DesiredFeature], when condition: Bool) {
        guard condition, !features.contains(value) else { return }
        features.append(value)
    }

    private func firstDouble(in prompt: String, pattern: String) -> Double? {
        guard
            let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
            let match = regex.firstMatch(
                in: prompt,
                range: NSRange(prompt.startIndex..<prompt.endIndex, in: prompt)
            ),
            let valueRange = Range(match.range(at: 1), in: prompt)
        else {
            return nil
        }

        return Double(prompt[valueRange].replacingOccurrences(of: ",", with: "."))
    }

    private func firstDistanceRange(in prompt: String) -> Double? {
        guard
            let regex = try? NSRegularExpression(
                pattern: #"(\d+(?:[,.]\d+)?)\s*(?:-|–|—|bis|to)\s*(\d+(?:[,.]\d+)?)\s*(?:km|kilometer)\b"#,
                options: [.caseInsensitive]
            ),
            let match = regex.firstMatch(
                in: prompt,
                range: NSRange(prompt.startIndex..<prompt.endIndex, in: prompt)
            ),
            let lowerRange = Range(match.range(at: 1), in: prompt),
            let upperRange = Range(match.range(at: 2), in: prompt),
            let lower = Double(prompt[lowerRange].replacingOccurrences(of: ",", with: ".")),
            let upper = Double(prompt[upperRange].replacingOccurrences(of: ",", with: "."))
        else {
            return nil
        }

        return (lower + upper) / 2
    }

    private func normalized(_ prompt: String) -> String {
        prompt.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "de_DE")
        )
    }

    private func containsAny(_ value: String, _ needles: [String]) -> Bool {
        needles.contains(where: value.contains)
    }

    private func containsRouteShapeCue(_ value: String) -> Bool {
        containsAny(
            value,
            [
                "rundwanderung", "rundtour", "runde", "loop", "round trip",
                " von ", " nach ", " zum ", " zur ", " bis ",
                " from ", " to ", "→", "->",
                "start:", "ziel:"
            ]
        )
    }
}
