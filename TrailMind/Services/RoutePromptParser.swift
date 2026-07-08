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
        "Bitte gib Start und Ziel ein, z.B. 'Ilsenburg nach Schierke'."
    }
}

struct RoutePromptParser: Sendable {
    private enum CaptureLayout {
        case startEnd
        case endStart
    }

    private static let loopPatterns: [NSRegularExpression] = [
        try! NSRegularExpression(
            pattern: #"^\s*(?:.+?\s+)?(?:rundwanderung|rundtour|runde)\s+(?:um|ab|bei)\s+(.+?)\s*$"#,
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
                pattern: #"^\s*(?:(?:wanderung|tour|route|strecke|radroute|radtour|lauf|trailrun)\s+)?(.+?)\s+(?:nach|zum|zur)\s+(.+?)\s*$"#,
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
        #"\s+(?:für|for)\s+\d+(?:[,.]\d+)?\s*(?:km|kilometer|h|std\.?|stunden?|hours?|hrs?)\b.*$"#,
        #"\s+(?:ca\.?|circa|ungefähr|ungefaehr|about|around)\s+\d+(?:[,.]\d+)?\s*(?:km|kilometer|h|std\.?|stunden?|hours?|hrs?)\b.*$"#,
        #"\s+(?:heute|morgen|today|tomorrow)\b.*$"#
    ]

    func parse(_ prompt: String) throws -> ParsedRoutePrompt {
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
                desiredFeatures: desiredFeatures(in: prompt)
            )
        }

        throw RoutePromptParserError.invalidPrompt
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
                desiredFeatures: desiredFeatures(in: prompt)
            )
        }

        return nil
    }

    private func cleanLocation(_ value: String) -> String {
        var cleaned = value.trimmingCharacters(
            in: CharacterSet.whitespacesAndNewlines.union(
                CharacterSet(charactersIn: #",.;:!?'"„“"#)
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
                CharacterSet(charactersIn: #",.;:!?'"„“"#)
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
        firstDouble(
            in: prompt,
            pattern: #"(?:ca\.?|circa|ungefähr|ungefaehr|about|around)?\s*(\d+(?:[,.]\d+)?)\s*(?:km|kilometer)\b"#
        )
    }

    private func preferredDurationHours(in prompt: String) -> Double? {
        firstDouble(
            in: prompt,
            pattern: #"(\d+(?:[,.]\d+)?)\s*(?:h|std\.?|stunden?|hours?|hrs?)\b"#
        )
    }

    private func difficulty(in prompt: String) -> RouteDifficulty? {
        let normalized = normalized(prompt)

        if ["anspruchsvoll", "fordernd", "schwer", "steil", "challenging", "hard", "tough"].contains(where: normalized.contains) {
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

    private func normalized(_ prompt: String) -> String {
        prompt.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "de_DE")
        )
    }
}
