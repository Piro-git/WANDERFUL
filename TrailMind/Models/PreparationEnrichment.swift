import Foundation

/// AI selects reviewed options; model-authored prose never enters the checklist.
nonisolated enum PreparationAddition: String, Codable, CaseIterable {
    case spareSocks, snackPouch, sitMat, dryBags, tentRepair, hutEarplugs

    func allowed(stay: PreparationStay) -> Bool {
        switch self {
        case .spareSocks: stay == .day
        case .tentRepair: stay == .camping
        case .hutEarplugs: stay == .hut
        default: true
        }
    }
    var item: PreparationItem {
        let content: (String, String, PreparationGroup) = switch self {
        case .spareSocks: ("Spare walking socks", "An optional dry pair to change into during your outing.", .clothing)
        case .snackPouch: ("Easy-to-reach snack pouch", "Keep your planned snacks accessible while walking.", .food)
        case .sitMat: ("Small sit mat", "An optional seat for planned breaks.", .essentials)
        case .dryBags: ("Dry bags for spare kit", "Separate spare clothing and supplies inside your pack.", .essentials)
        case .tentRepair: ("Tent repair supplies", "For your selected camping stay, match spares to your tent.", .overnight)
        case .hutEarplugs: ("Earplugs for the hut", "For your selected hut stay, consider shared sleeping spaces.", .overnight)
        }
        return .init(id: "ai." + rawValue, label: content.0, reason: "AI-selected option · " + content.1, group: content.2, source: nil)
    }
}
nonisolated enum PreparationCheck: String, Codable, CaseIterable {
    case layers, mealPlan, footwear, campingKit, hutRequirements
    func allowed(stay: PreparationStay) -> Bool {
        switch self {
        case .campingKit: stay == .camping
        case .hutRequirements: stay == .hut
        default: true
        }
    }
    var text: String {
        switch self {
        case .layers: "Choose your clothing after checking the forecast for your departure."
        case .mealPlan: "Plan meals and breaks around the mapped duration, with room for delays."
        case .footwear: "Check that your footwear fits and suits the terrain you have reviewed."
        case .campingKit: "Check your tent setup and sleeping kit before your camping stay."
        case .hutRequirements: "Ask your booked hut about meals, bedding and arrival times."
        }
    }
}
nonisolated struct PreparationEnrichment: Codable, Equatable {
    let version: Int
    let stay: PreparationStay
    let distanceKM: Double
    let durationHours: Double
    let additions: [PreparationAddition]
    let checks: [PreparationCheck]

    var items: [PreparationItem] { additions.map(\.item) }
    func validate() throws {
        guard version == 1, distanceKM.isFinite, distanceKM > 0, distanceKM <= 1000,
              durationHours.isFinite, durationHours > 0, durationHours <= 1000,
              additions.count <= 4, checks.count <= 3,
              Set(additions).count == additions.count, Set(checks).count == checks.count,
              additions.allSatisfy({ $0.allowed(stay: stay) }),
              checks.allSatisfy({ $0.allowed(stay: stay) }) else { throw CocoaError(.coderReadCorrupt) }
    }
    func matches(input: PreparationInput, stay: PreparationStay) -> Bool {
        input.isHiking && self.stay == stay && distanceKM == input.distanceKM && durationHours == input.durationHours
    }
    static func decode(_ data: Data, input: PreparationInput, stay: PreparationStay) throws -> Self {
        guard data.count <= 8192,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(["version", "stay", "distanceKM", "durationHours", "additions", "checks"]) else {
            throw CocoaError(.coderReadCorrupt)
        }
        let value = try JSONDecoder().decode(Self.self, from: data)
        try value.validate()
        guard value.matches(input: input, stay: stay) else { throw CocoaError(.coderReadCorrupt) }
        return value
    }
}
