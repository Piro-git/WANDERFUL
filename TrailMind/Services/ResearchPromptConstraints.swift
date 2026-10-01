import Foundation

/// A conservative typed boundary over explicit numeric constraints in the original request.
/// Unresolved limiting language asks for clarification instead of becoming an approximate target.
struct ResearchPromptConstraints: Equatable, Sendable {
    let maximumDistanceKm: Double?
    let maximumDurationMinutes: Double?
    let maximumElevationGainMeters: Double?
    let hardAvoidances: [String]
    let requiresClarification: Bool

    init(prompt: String) {
        let text = prompt.lowercased().replacingOccurrences(of: "’", with: "'")
            .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        let distance = Self.limits(text, unit: #"km|kilometers?|kilometres?|kilometern?"#, duration: false)
        let duration = Self.limits(text, unit: #"hours?|hrs?|h|std\.?|stunden?|minutes?|mins?|minuten?|min"#, duration: true)
        let elevation = Self.limits(text, unit: #"höhenmetern?|hoehenmetern?|hm|m(?:eters?|etres?|etern?)?\s+(?:of\s+)?(?:ascent|elevation(?: gain)?|aufstieg)"#, duration: false)
        maximumElevationGainMeters = elevation.value
        maximumDistanceKm = distance.value
        maximumDurationMinutes = duration.value
        let cueMatches = (try? NSRegularExpression(pattern: Self.relationPattern))?.matches(
            in: text, range: NSRange(text.startIndex..., in: text)) ?? []
        let recognized = distance.recognized + duration.recognized + elevation.recognized
        let ns = text as NSString
        requiresClarification = distance.ambiguous || duration.ambiguous || elevation.ambiguous || cueMatches.contains { match in
            guard !recognized.contains(where: { NSIntersectionRange($0, match.range).length == match.range.length }) else { return false }
            // A limiting word alone is not a numeric route constraint ("maximal viel Aussicht",
            // "under the trees"). Only a quantity/dimension relation warrants clarification.
            let after = ns.substring(from: NSMaxRange(match.range))
            let cue = ns.substring(with: match.range)
            return Self.matches(#"^\s*(?:of\s+)?(?:(?:ca\.?|circa|etwa|about|around|approximately)\s+)?(?:[-+]?\d|"# + Self.wordNumberPattern + #"\b)"#, in: after)
                || Self.matches(#"^\s*(?:[\p{L}\d+-]+(?:[.,]\d+)?\s+){0,3}(?:stunden?|minutes?|minuten?|hours?|km|kilometern?|höhenmetern?|hoehenmetern?|hm|dauer|distanz|aufstieg)\b"#, in: after)
                || Self.matches(#"länger|longer|farther|exceed|obergrenze"#, in: cue)
        }
        // Match each exclusion's own phrase. An unrelated "no" cannot promote profile defaults.
        let exclusions = [
            ("majorRoads", #"major roads?|main roads?|highways?|hauptstraßen?|hauptstrassen?|autobahnen?"#),
            ("steepClimbs", #"steep climbs?|steep ascents?|steile[nr]? anstiege?|steile steigungen?"#),
            ("repeatedPath", #"repeated (?:paths?|sections?)|backtracking|wiederholte wege?|doppelte wegabschnitte"#)
        ]
        hardAvoidances = exclusions.compactMap { key, noun in
            let prefix = #"\b(?:without|exclude|no|ohne|keine[nr]?|vermeide|avoid)\s+(?:any\s+|all\s+|alle\s+)?(?:"# + noun + #")\b"#
            guard let range = text.range(of: prefix, options: .regularExpression) else { return nil }
            let before = String(text[..<range.lowerBound].suffix(35))
            // "Prefer to avoid", "don't avoid" and "no need to avoid" remain preferences/negations.
            if Self.matches(#"(?:prefer(?:ably)?(?: to)?|if possible|don't|do not|not|no need to|nicht|möglichst)\s*$"#, in: before) { return nil }
            return key
        }
    }

    // A bounded quantity grammar, not general intent understanding. Unknown numeric limits
    // and unsupported lower bounds must be clarified; soft targets remain the intent layer's job.
    private static let wordNumberPattern = #"(?:ein(?:e[nmr]?)?|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|anderthalb|eineinhalb)"#
    private static let relationPattern = #"\b(?:nicht mehr als|nicht länger als|nicht weniger als|nicht unter|nicht über|not less than|not under|no more than|not more than|not longer than|no farther than|do not exceed|don't exceed|at most|at least|less than|more than|fewer than|weniger als|mehr als|bis zu|höchstens|hoechstens|mindestens|maximum|maximal|max\.?|minimum|minimal|obergrenze|unter|über|under|over|kein[enmr]?|nicht|not)(?![\p{L}])"#

    private static func limits(_ text: String, unit: String, duration: Bool) -> (value: Double?, ambiguous: Bool, recognized: [NSRange]) {
        let number = #"([-+]?\d+(?:[.,]\d+)?|"# + wordNumberPattern + #")"#
        let pattern = #"(?<![\p{L}\d.,])"# + number + #"\s*("# + unit + #")\b"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return (nil, true, []) }
        let ns = text as NSString
        let tokens = regex.matches(in: text, range: NSRange(location: 0, length: ns.length))
        var values: [Double] = []
        var ambiguous = false
        var recognized: [NSRange] = []
        var index = 0
        while index < tokens.count {
            let first = tokens[index]
            var last = first
            func amount(_ match: NSTextCheckingResult) -> Double {
                let raw = ns.substring(with: match.range(at: 1)).replacingOccurrences(of: ",", with: ".")
                let words: [String: Double] = ["zwei": 2, "drei": 3, "vier": 4, "fünf": 5, "sechs": 6,
                    "sieben": 7, "acht": 8, "neun": 9, "zehn": 10, "anderthalb": 1.5, "eineinhalb": 1.5]
                let n = Double(raw) ?? words[raw] ?? 1
                return duration && isHour(ns.substring(with: match.range(at: 2))) ? n * 60 : n
            }
            var value = amount(first)
            // Three decimal places can also be a thousands grouping (German "1.200 hm").
            // Do not silently turn an ambiguous grouped amount into a much smaller limit.
            var invalidAmount = value <= 0 || !value.isFinite
                || Self.matches(#"^[-+]?\d+[.,]\d{3}$"#, in: ns.substring(with: first.range(at: 1)))
            // A compound time is one limit, e.g. "unter 2 Stunden und 30 Minuten".
            if duration, index + 1 < tokens.count {
                let next = tokens[index + 1]
                let gap = ns.substring(with: NSRange(location: NSMaxRange(first.range), length: next.range.location - NSMaxRange(first.range)))
                if isHour(ns.substring(with: first.range(at: 2))), ns.substring(with: next.range(at: 2)).hasPrefix("min"),
                   Self.matches(#"^\s*(?:(?:and|und)\s*)?$"#, in: gap) {
                    invalidAmount = invalidAmount || amount(next) < 0 || !amount(next).isFinite
                    value += amount(next); last = next; index += 1
                }
            }
            let prefix = ns.substring(to: first.range.location)
            let suffix = ns.substring(from: NSMaxRange(last.range))
            // Do not accept only the first part of a time expression we cannot fully read.
            // The supported hour + minute form was consumed above; further time terms need clarification.
            if duration, Self.matches(#"^\s*(?:(?:and|und)\s+)?(?:[-+]?\d+(?:[.,]\d+)?|"# + wordNumberPattern
                + #")(?:\s+[\p{L}]+){0,2}\s*(?:hours?|hrs?|h|std\.?|stunden?|minutes?|mins?|minuten?|min|seconds?|sekunden?)\b"#, in: suffix) {
                invalidAmount = true
            }
            let prefixCue = relationPattern + #"\s*(?:of\s*)?$"#
            let suffixCue = #"^\s*[,;:-]?\s*(?:maximum|maximal|max\.?|höchstens|at most|no more(?: than that)?|not more|nicht mehr)(?=\s*(?:[,;.!?]|$|(?:und|and|aber|but|wenn|if)\b))"#
            if let cueRange = prefix.range(of: prefixCue, options: .regularExpression) {
                recognized.append(NSRange(cueRange, in: prefix))
                let beforeCue = String(prefix[..<cueRange.lowerBound].suffix(80))
                let cueText = String(prefix[cueRange]).trimmingCharacters(in: .whitespaces)
                if isSoft(beforeCue) || isSoftSuffix(suffix) {
                    // An explicitly qualified preference does not become a hard limit.
                } else if invalidAmount || Self.matches(#"^(?:nicht weniger als|nicht unter|not less than|not under|at least|mindestens|minimum|minimal|mehr als|more than|über|over|kein[enmr]?|nicht$|not$)\b"#, in: cueText)
                    || Self.matches(#"(?:not|no|kein[enmr]?|nicht|don't|do not)\s*$"#, in: beforeCue) {
                    // The upper-bound transport cannot represent a lower bound or an ambiguous
                    // negation. Never silently discard it or reverse its meaning.
                    ambiguous = true
                } else {
                    values.append(Self.matches(#"^(?:under|unter|less than|fewer than|weniger als)\b"#, in: cueText) ? value.nextDown : value)
                }
            } else if let range = suffix.range(of: suffixCue, options: .regularExpression) {
                let local = NSRange(range, in: suffix)
                recognized.append(NSRange(location: NSMaxRange(last.range) + local.location, length: local.length))
                if isSoft(prefix) || isSoftSuffix(String(suffix[range.upperBound...])) { }
                else if invalidAmount || Self.matches(#"(?:not|nicht|kein[enmr]?)\s*$"#, in: prefix) { ambiguous = true }
                else { values.append(value) }
            }
            index += 1
        }
        if values.contains(where: { $0 <= 0 || !($0.isFinite) }) { ambiguous = true }
        return (values.filter { $0 > 0 && $0.isFinite }.min(), ambiguous, recognized)
    }

    private static func isHour(_ unit: String) -> Bool {
        unit.hasPrefix("h") || unit.hasPrefix("stunde") || unit.hasPrefix("std")
    }

    private static func isSoftSuffix(_ suffix: String) -> Bool {
        matches(#"^\s*[,;]?\s*(?:wenn möglich|wenn moeglich|if possible|ideally|wäre schön|would be nice)(?=\s|[.!?,;]|$)"#, in: suffix)
    }

    private static func isSoft(_ prefix: String) -> Bool {
        matches(#"(?:möglichst|moeglichst|idealerweise|wenn möglich|wenn moeglich|am liebsten|vorzugsweise|preferably|ideally|if possible|prefer(?: to)?|wäre schön|would be nice)\s*[,;:]?\s*$"#, in: prefix)
    }

    private static func matches(_ pattern: String, in text: String) -> Bool {
        text.range(of: pattern, options: .regularExpression) != nil
    }
}
