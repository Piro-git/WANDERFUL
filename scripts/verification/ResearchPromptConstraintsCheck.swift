import Foundation

@main
struct ResearchPromptConstraintsCheck {
    static func main() throws {
        let limits: [(String, Double?, Double?)] = [
            ("15 km maximum", 15, nil),
            ("15 km, no more", 15, nil),
            ("Maximum 15 km", 15, nil),
            ("15 km maximal", 15, nil),
            ("höchstens 12,5 km", 12.5, nil),
            ("No more than 15 km and 3 hours maximum", 15, 180),
            ("2 hours and 30 minutes maximum", nil, 150),
            ("maximal 2 Stunden 30 Minuten", nil, 150),
            ("maximum 3 hours, maximum 150 minutes", nil, 150),
            ("about 15 km", nil, nil),
            ("at least 15 km", nil, nil),
            ("not less than 15 km", nil, nil)
        ]
        for (prompt, distance, duration) in limits {
            let parsed = ResearchPromptConstraints(prompt: prompt)
            precondition(parsed.maximumDistanceKm == distance, "distance: \(prompt)")
            precondition(parsed.maximumDurationMinutes == duration, "duration: \(prompt)")
            precondition(!parsed.requiresClarification, "unexpected clarification: \(prompt)")
        }
        for prompt in ["no maximum 15 km", "not 15 km maximum", "maximum fifteen km", "15 km maximum, at most three hours"] {
            precondition(ResearchPromptConstraints(prompt: prompt).requiresClarification, prompt)
        }
        precondition(ResearchPromptConstraints(prompt: "under 15 km").maximumDistanceKm! < 15)
        for prompt in ["No more than 15 km; prefer to avoid major roads", "No waterfall needed; steep climbs are okay", "Don't avoid major roads", "No need to avoid steep climbs"] {
            precondition(ResearchPromptConstraints(prompt: prompt).hardAvoidances.isEmpty, prompt)
        }
        precondition(ResearchPromptConstraints(prompt: "No major roads, without steep climbs").hardAvoidances == ["majorRoads", "steepClimbs"])
        print("22 production prompt-constraint checks passed")
    }
}
