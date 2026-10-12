import Foundation

/// Transient response for the submitting user. Deliberately absent from PersistedRoute.
nonisolated struct DynamicWebResearch: Decodable, Hashable, Sendable {
    struct Citation: Decodable, Hashable, Sendable {
        let url: URL
        let title: String
        enum Scope: String, Decodable, Hashable, Sendable { case passage, source }
        let startIndex: Int?
        let endIndex: Int?
        let scope: Scope

        init(url: URL, title: String, startIndex: Int? = nil, endIndex: Int? = nil, scope: Scope = .passage) {
            self.url = url; self.title = title
            self.startIndex = startIndex; self.endIndex = endIndex; self.scope = scope
        }

        private enum CodingKeys: String, CodingKey { case url, title, startIndex, endIndex, scope }
        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            url = try values.decode(URL.self, forKey: .url)
            title = try values.decode(String.self, forKey: .title)
            startIndex = try values.decodeIfPresent(Int.self, forKey: .startIndex)
            endIndex = try values.decodeIfPresent(Int.self, forKey: .endIndex)
            // Older transient responses contain complete spans without a scope.
            scope = try values.decodeIfPresent(Scope.self, forKey: .scope) ?? .passage
        }

        func passage(in text: String) -> String? {
            guard scope == .passage, DynamicWebResearch.validRange(self, in: text),
                  let startIndex, let endIndex else { return nil }
            return (text as NSString).substring(with: NSRange(location: startIndex, length: endIndex - startIndex))
        }
    }
    struct Block: Decodable, Hashable, Sendable {
        let text: String
        let citations: [Citation]
    }
    let provider: String
    let retrievedAt: String
    let blocks: [Block]
    let searchSuggestions: [String]
    let retrievedSourceURLs: [URL]
    let observedSearchQueries: Int?
    var observedSearchCalls: Int? = nil

    var routeEvidence: DynamicRouteEvidence? = nil

    func isAvailable(at now: Date = .now) -> Bool {
        guard let retrieved = Self.retrievalDate(retrievedAt) else { return false }
        return retrieved <= now.addingTimeInterval(300) && now.timeIntervalSince(retrieved) <= 86_400
    }

    private static func retrievalDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    // Provider offsets may end within a composed grapheme, but never split a scalar.
    static func validRange(_ citation: Citation, in text: String) -> Bool {
        let units = Array(text.utf16)
        func boundary(_ index: Int) -> Bool {
            index >= 0 && index <= units.count &&
                (index == 0 || index == units.count || !(0xDC00...0xDFFF).contains(units[index]))
        }
        guard citation.scope == .passage, let start = citation.startIndex, let end = citation.endIndex else { return false }
        return end > start && boundary(start) && boundary(end)
    }

    func validate() throws {
        guard provider == "google_grounding", Self.retrievalDate(retrievedAt) != nil, (1...8).contains(blocks.count),
              (0...5).contains(searchSuggestions.count), searchSuggestions.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
              searchSuggestions.reduce(0, { $0 + $1.utf8.count }) <= 65_536,
              !retrievedSourceURLs.isEmpty, retrievedSourceURLs.count <= 20,
              retrievedSourceURLs.allSatisfy(Self.isPublicCitation),
              observedSearchQueries.map({ (0...1200).contains($0) }) ?? true,
              observedSearchCalls.map({ (1...60).contains($0) }) ?? (observedSearchQueries.map({ $0 > 0 }) ?? false),
              blocks.reduce(0, { $0 + $1.text.utf16.count }) <= 12_000,
              blocks.reduce(0, { $0 + $1.citations.count }) <= 40 else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
        for block in blocks {
            guard !block.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !block.citations.isEmpty else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
            for citation in block.citations {
                guard Self.isPublicCitation(citation.url), citation.title.utf16.count <= 500 else {
                    throw OutdoorAdventurePlanningClientFailure.invalidResponse
                }
                switch citation.scope {
                case .passage:
                    guard Self.validRange(citation, in: block.text) else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
                case .source:
                    guard citation.startIndex == nil, citation.endIndex == nil,
                          retrievedSourceURLs.contains(citation.url) else { throw OutdoorAdventurePlanningClientFailure.invalidResponse }
                }
            }
        }
        guard blocks.contains(where: { block in block.citations.contains(where: { retrievedSourceURLs.contains($0.url) }) }) else {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
    }

    static func isPublicCitation(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host, host.contains("."), url.user == nil,
              url.password == nil, url.port == nil, !host.hasPrefix("["),
              host.range(of: "^[0-9.]+$", options: .regularExpression) == nil else { return false }
        return !["localhost", "local", "internal", "invalid", "test"].contains(where: { host == $0 || host.hasSuffix("." + $0) })
    }
}

/// Response-scoped references only; never encoded into saved routes.
nonisolated struct DynamicRouteEvidence: Decodable, Hashable, Sendable {
    struct Place: Decodable, Hashable, Sendable {
        let placeId: String
        let name: String
        let sourceURL: URL
        let selection: String
    }
    struct Claim: Decodable, Hashable, Sendable {
        struct Passage: Decodable, Hashable, Sendable {
            let url: URL
            let text: String
            let retrievedAt: String
        }
        let id: String
        let blockIndex: Int
        let citationIndex: Int
        let placeId: String?
        let relationship: String
        var identityMethod: String? = nil
        var sourcePassage: Passage? = nil
    }
    let schemaVersion: Int
    let routeId: String
    let places: [Place]
    let claims: [Claim]

    func validate(research: DynamicWebResearch, routeId expectedRouteID: String, stops: [DynamicResearchStop], now: Date = .now) throws {
        let failure = OutdoorAdventurePlanningClientFailure.invalidResponse
        guard schemaVersion == 1, routeId == expectedRouteID,
              routeId.range(of: "^measured-[1-9][0-9]*$", options: .regularExpression) != nil,
              (1...10).contains(places.count), Set(places.map(\.placeId)).count == places.count,
              places.filter({ $0.selection == "selected" }).map(\.placeId) == stops.map(\.id),
              claims.count == research.blocks.reduce(0, { $0 + $1.citations.count }) else { throw failure }
        for place in places {
            guard ["selected", "excluded"].contains(place.selection),
                  place.placeId.range(of: "^osm:(node|way|relation):[1-9][0-9]*$", options: .regularExpression) != nil,
                  place.sourceURL.absoluteString == "https://www.openstreetmap.org/" + place.placeId.dropFirst(4).replacingOccurrences(of: ":", with: "/"),
                  !place.name.isEmpty, place.name.utf16.count <= 180,
                  !place.name.unicodeScalars.contains(where: { $0.value < 32 || $0 == "<" || $0 == ">" }) else { throw failure }
            if place.selection == "selected" {
                guard let stop = stops.first(where: { $0.id == place.placeId }),
                      stop.name == place.name, stop.source.url == place.sourceURL else { throw failure }
            }
        }
        var index = 0
        for (blockIndex, block) in research.blocks.enumerated() {
            for (citationIndex, citation) in block.citations.enumerated() {
                let claim = claims[index]
                let identity = citation.scope == .passage && research.retrievedSourceURLs.contains(citation.url)
                    ? places.first(where: { $0.sourceURL == citation.url }) : nil
                guard claim.id == "b\(blockIndex)-c\(citationIndex)", claim.blockIndex == blockIndex,
                      claim.citationIndex == citationIndex else { throw failure }
                if claim.relationship == "source_passage" {
                    guard citation.scope == .passage, identity == nil, let placeId = claim.placeId,
                          let place = places.first(where: { $0.placeId == placeId }),
                          ["stable_reference", "structured_name_coordinate"].contains(claim.identityMethod ?? ""),
                          let passage = claim.sourcePassage,
                          passage.url.host == citation.url.host, DynamicWebResearch.isPublicCitation(passage.url),
                          research.retrievedSourceURLs.contains(citation.url),
                          (12...1200).contains(passage.text.utf16.count),
                          !passage.text.contains("<"), !passage.text.contains(">"),
                          passage.text.localizedCaseInsensitiveContains(place.name),
                          citation.passage(in: block.text)?.localizedCaseInsensitiveContains(place.name) == true,
                          let retrieved = PlanningEvidenceDate.parse(passage.retrievedAt),
                          retrieved <= now.addingTimeInterval(300), now.timeIntervalSince(retrieved) <= 86_400 else { throw failure }
                } else {
                    guard claim.placeId == identity?.placeId,
                          claim.relationship == (identity == nil ? "unconfirmed" : "source_identity"),
                          claim.identityMethod == nil, claim.sourcePassage == nil else { throw failure }
                }
                index += 1
            }
        }
    }
}
