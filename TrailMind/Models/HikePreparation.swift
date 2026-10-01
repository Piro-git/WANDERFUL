import Foundation

nonisolated enum PreparationStay: String, Codable, CaseIterable, Identifiable {
    case day = "Day hike", camping = "Overnight · camping", hut = "Overnight · hut"
    var id: String { rawValue }
}
nonisolated enum PreparationGroup: String, Codable, CaseIterable {
    case clothing = "Clothing", food = "Food & drink", essentials = "Essentials", overnight = "Overnight", personal = "Your additions"
}
nonisolated enum PackingStatus: String, Codable { case unpacked, packed, excluded }
nonisolated struct PreparationItem: Identifiable, Codable, Equatable {
    let id: String
    var label: String
    let reason: String
    let group: PreparationGroup
    let source: PreparationSource?

    func localizedLabel(locale: Locale) -> String {
        // User-written text and persisted IDs must never change with interface language.
        guard !id.hasPrefix("custom."),
              let path = Bundle.main.path(forResource: locale.language.languageCode?.identifier ?? "en", ofType: "lproj"),
              let bundle = Bundle(path: path) else { return label }
        return bundle.localizedString(forKey: label, value: label, table: nil)
    }
}
nonisolated enum PreparationSource: String, Codable, CaseIterable {
    case essentials, overnight, hut
    var title: String {
        switch self {
        case .essentials: "National Park Service · Ten Essentials"
        case .overnight: "Recreation.gov · Overnight backpacking"
        case .hut: "German Alpine Club · Hut visits"
        }
    }
    var url: URL {
        let address: String
        switch self {
        case .essentials: address = "https://www.nps.gov/articles/10essentials.htm"
        case .overnight: address = "https://www.recreation.gov/articles/list/helpful-tips-for-planning-an-overnight-backpacking-trip/1146"
        case .hut: address = "https://www.alpenverein.de/artikel/zu-gast-auf-alpenvereinshutten_7bf6cdc6-934f-4a00-9ff7-9829cb6180d0"
        }
        return URL(string: address)!
    }
    static let reviewedOn = "2026-09-06"
}
nonisolated struct PreparationInput: Equatable {
    let routeID: UUID
    let isHiking: Bool
    let distanceKM: Double
    let durationHours: Double
}
nonisolated struct PreparationState: Codable, Equatable {
    var version = 1
    let routeID: UUID
    var stay: PreparationStay = .day
    var statuses: [String: PackingStatus] = [:]
    var customItems: [PreparationItem] = []
    var activeIDs: Set<String> = []
    var revisionNotice = false
    var enrichment: PreparationEnrichment?

    func status(_ id: String) -> PackingStatus { statuses[id] ?? .unpacked }
    func progress(items: [PreparationItem]) -> (packed: Int, total: Int) {
        let included = items.filter { status($0.id) != .excluded }
        return (included.filter { status($0.id) == .packed }.count, included.count)
    }
    mutating func add(_ label: String) {
        let clean = String(label.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
        guard !clean.isEmpty else { return }
        customItems.append(.init(id: "custom." + UUID().uuidString, label: clean, reason: "Added by you for this trip.", group: .personal, source: nil))
    }
}

/// Controlled catalogue IDs are the future personalization boundary. External
/// suggestions must resolve against this catalogue; no free-form equipment claims.
nonisolated enum PreparationCatalogue {
    static func items(for input: PreparationInput, stay: PreparationStay) -> [PreparationItem] {
        guard input.isHiking else { return [] }
        func item(_ id: String, _ label: String, _ reason: String, _ group: PreparationGroup, _ source: PreparationSource = .essentials) -> PreparationItem {
            .init(id: id, label: label, reason: reason, group: group, source: source)
        }
        var result = [
            item("layers", "Extra layer & rain shell", "Choose layers after checking conditions.", .clothing),
            item("sun", "Hat, sunglasses & sunscreen", "Plan for sun exposure.", .clothing),
            item("water", "Water & carrying bottles", "Plan your supply; refills are unverified.", .food),
            item("treatment", "Water treatment supplies", "If collecting water, choose a suitable method.", .food),
            item("food", "Food & spare snacks", "Allow for delays as well as your planned outing.", .food),
            item("navigation", "Map & navigation backup", "Bring tools you know how to use.", .essentials),
            item("power", "Phone & backup power", "Charge before leaving.", .essentials),
            item("light", "Headlamp & spare power", "Delays can extend into darkness.", .essentials),
            item("aid", "First aid & personal medication", "Check supplies and expiry dates.", .essentials),
            item("shelter", "Emergency blanket or bivy", "Emergency cover, separate from camping equipment.", .essentials),
            item("repair", "Small repair kit", "Choose tools for your equipment.", .essentials),
            item("fire", "Emergency fire kit", "Check local fire restrictions; carrying a kit is not permission to light fires.", .essentials)
        ]
        // Editorial planning threshold, not an exertion or safety classification.
        if input.durationHours >= 4 || input.distanceKM >= 15 {
            result.append(item("meal", "A meal for the longer outing", "Make room for a meal in your food plan.", .food, .overnight))
        }
        if stay != .day {
            result += [item("change", "Dry change & spare socks", "Keep sleeping clothes dry.", .clothing, .overnight), item("overnightFood", "Overnight meals & toiletries", "Plan each meal and personal supplies.", .overnight, .overnight)]
        }
        if stay == .camping {
            result += [item("tent", "Tent & pitching kit", "Check equipment and permitted places to stay.", .overnight, .overnight), item("sleep", "Sleeping bag & sleeping pad", "Choose for checked overnight conditions.", .overnight, .overnight)]
        }
        if stay == .hut {
            result.append(item("hutKit", "Hut sleeping kit", "Ask the hut what bedding or liner to bring.", .overnight, .hut))
        }
        return result
    }

    static func reconcile(_ old: PreparationState, input: PreparationInput) -> PreparationState {
        guard old.routeID == input.routeID else {
            return reconcile(PreparationState(routeID: input.routeID), input: input)
        }
        var next = old
        if let enrichment = next.enrichment, !enrichment.matches(input: input, stay: old.stay) {
            next.enrichment = nil
        }
        let ids = Set((items(for: input, stay: old.stay) + (next.enrichment?.items ?? [])).map(\.id))
        let custom = Set(old.customItems.map(\.id))
        // Keep a user's completion/exclusion choice for a valid item while its
        // context is temporarily hidden (for example camping -> day -> camping).
        // Unknown IDs are still discarded, so stale/corrupt state cannot grow.
        let catalogueIDs = Set(PreparationStay.allCases.flatMap {
            items(for: input, stay: $0).map(\.id)
        })
        .union(["meal"])
        .union(PreparationAddition.allCases.map { "ai." + $0.rawValue })
        next.statuses = old.statuses.filter { catalogueIDs.contains($0.key) || custom.contains($0.key) }
        next.revisionNotice = old.revisionNotice || (!old.activeIDs.isEmpty && !ids.subtracting(old.activeIDs).isEmpty)
        next.activeIDs = ids
        return next
    }
}

/// Versioned local UserDefaults records, following the preference-store convention.
/// A damaged/newer record is preserved. The screen blocks edits when loading fails.
@MainActor final class PreparationStore {
    private let defaults: UserDefaults
    init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    func key(_ id: UUID) -> String { "trailmind.preparation.v1." + id.uuidString }
    func load(_ input: PreparationInput) throws -> PreparationState {
        guard let data = defaults.data(forKey: key(input.routeID)) else {
            return PreparationCatalogue.reconcile(.init(routeID: input.routeID), input: input)
        }
        let state = try JSONDecoder().decode(PreparationState.self, from: data)
        guard state.version == 1, state.routeID == input.routeID,
              Set(state.customItems.map(\.id)).count == state.customItems.count,
              state.customItems.allSatisfy({ $0.id.hasPrefix("custom.") && $0.group == .personal }) else {
            throw CocoaError(.coderReadCorrupt)
        }
        if let enrichment = state.enrichment { try enrichment.validate() }
        return PreparationCatalogue.reconcile(state, input: input)
    }
    func save(_ state: PreparationState) throws {
        defaults.set(try JSONEncoder().encode(state), forKey: key(state.routeID))
    }
}
