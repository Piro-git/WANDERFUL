import CoreLocation
import Foundation

enum LocationSemanticKind: String, CaseIterable, Hashable, Sendable {
    case settlement
    case trailhead
    case landmark
    case park
    case mountainRange
    case broadRegion
    case unknown

    var userFacingLabel: String {
        switch self {
        case .settlement:
            "Town or settlement"
        case .trailhead:
            "Trailhead"
        case .landmark:
            "Landmark"
        case .park:
            "Park"
        case .mountainRange:
            "Mountain region"
        case .broadRegion:
            "Region"
        case .unknown:
            "Place"
        }
    }

    /// Route generation needs a concrete anchor. Parks and geographic regions
    /// can span many trail networks, so their centroids are never accepted.
    var isUsableRouteAnchor: Bool {
        switch self {
        case .settlement, .trailhead, .landmark:
            true
        case .park, .mountainRange, .broadRegion, .unknown:
            false
        }
    }
}

enum LocationProviderSource: String, Hashable, Sendable {
    case appleGeocoder
    case legacyCoordinateAdapter
}

struct LocationCandidate: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let displayName: String
    let coordinate: Coordinate
    let semanticKind: LocationSemanticKind
    let locality: String?
    let administrativeRegion: String?
    let country: String?
    let countryCode: String?
    let provider: LocationProviderSource
    let providerRank: Int

    init(
        id: String,
        name: String,
        displayName: String,
        coordinate: Coordinate,
        semanticKind: LocationSemanticKind,
        locality: String? = nil,
        administrativeRegion: String? = nil,
        country: String? = nil,
        countryCode: String? = nil,
        provider: LocationProviderSource,
        providerRank: Int = 0
    ) {
        self.id = id
        self.name = name
        self.displayName = displayName
        self.coordinate = coordinate
        self.semanticKind = semanticKind
        self.locality = locality
        self.administrativeRegion = administrativeRegion
        self.country = country
        self.countryCode = countryCode?.uppercased()
        self.provider = provider
        self.providerRank = providerRank
    }
}

struct LocationQueryContext: Hashable, Sendable {
    let originalQuery: String
    let originalPrompt: String
    let localeIdentifier: String
    let routeType: TrailRouteType
    let activityType: ActivityType
    let requestedField: IntentMissingField
    let preferredCoordinate: Coordinate?
    let explicitlyRequestsNearby: Bool

    init(
        originalQuery: String,
        originalPrompt: String,
        localeIdentifier: String = Locale.current.identifier,
        routeType: TrailRouteType,
        activityType: ActivityType,
        requestedField: IntentMissingField,
        preferredCoordinate: Coordinate? = nil,
        explicitlyRequestsNearby: Bool = false
    ) {
        self.originalQuery = originalQuery
        self.originalPrompt = originalPrompt
        self.localeIdentifier = localeIdentifier
        self.routeType = routeType
        self.activityType = activityType
        self.requestedField = requestedField
        self.preferredCoordinate = preferredCoordinate
        self.explicitlyRequestsNearby = explicitlyRequestsNearby
    }

    var explicitCountryCode: String? {
        LocationLanguageContext.explicitCountryCode(in: originalQuery)
            ?? LocationLanguageContext.explicitCountryCode(in: originalPrompt)
    }
}

struct LocationClarification: Hashable, Sendable {
    let query: String
    let question: String
    let supportingText: String
    let candidates: [LocationCandidate]
    let allowsFreeText: Bool
}

enum LocationResolution: Hashable, Sendable {
    case resolved(LocationCandidate)
    case needsClarification(LocationClarification)
    case noResults(query: String)
    case unavailable
}

@MainActor
protocol LocationCandidateProviding {
    func candidates(for context: LocationQueryContext) async throws -> [LocationCandidate]
}

@MainActor
protocol LocationResolving {
    func resolve(_ context: LocationQueryContext) async throws -> LocationResolution
}

struct RankedLocationCandidate: Hashable, Sendable {
    let candidate: LocationCandidate
    let score: Double
    let evidence: [String]
}

struct BroadRegionDescriptor: Hashable, Sendable {
    let canonicalName: String
    let questionName: String
    let kind: LocationSemanticKind
    let scopeDescription: String
}

enum LocationLanguageContext {
    private static let countryCodeByName: [String: String] = {
        let displayLocales = [Locale(identifier: "en"), Locale(identifier: "de")]
        return Locale.Region.isoRegions.reduce(into: [:]) { namesByCode, region in
            let code = region.identifier.uppercased()
            namesByCode[normalizedWords(code)] = code
            for locale in displayLocales {
                if let name = locale.localizedString(forRegionCode: code) {
                    namesByCode[normalizedWords(name)] = code
                }
            }
        }
    }()

    private static let broadRegionsByAlias: [String: BroadRegionDescriptor] = {
        let descriptors: [([String], BroadRegionDescriptor)] = [
            (
                ["alps", "alpen"],
                BroadRegionDescriptor(
                    canonicalName: "Alps",
                    questionName: "the Alps",
                    kind: .mountainRange,
                    scopeDescription: "The Alps cover several countries and regions."
                )
            ),
            (
                ["harz"],
                BroadRegionDescriptor(
                    canonicalName: "Harz",
                    questionName: "the Harz",
                    kind: .mountainRange,
                    scopeDescription: "The Harz covers a large mountain region with many possible starting areas."
                )
            ),
            (
                ["black forest", "schwarzwald"],
                BroadRegionDescriptor(
                    canonicalName: "Black Forest",
                    questionName: "the Black Forest",
                    kind: .broadRegion,
                    scopeDescription: "The Black Forest covers a large region with many possible starting areas."
                )
            ),
            (
                ["dolomites", "dolomiten"],
                BroadRegionDescriptor(
                    canonicalName: "Dolomites",
                    questionName: "the Dolomites",
                    kind: .mountainRange,
                    scopeDescription: "The Dolomites cover many valleys and trail networks."
                )
            ),
            (
                ["bavarian alps", "bayerische alpen", "bayerischen alpen"],
                BroadRegionDescriptor(
                    canonicalName: "Bavarian Alps",
                    questionName: "the Bavarian Alps",
                    kind: .mountainRange,
                    scopeDescription: "The Bavarian Alps cover many towns, valleys and trailheads."
                )
            ),
            (
                ["austrian alps", "osterreichische alpen", "osterreichischen alpen"],
                BroadRegionDescriptor(
                    canonicalName: "Austrian Alps",
                    questionName: "the Austrian Alps",
                    kind: .mountainRange,
                    scopeDescription: "The Austrian Alps cover many valleys, towns and trail networks."
                )
            ),
            (
                ["swiss alps", "schweizer alpen"],
                BroadRegionDescriptor(
                    canonicalName: "Swiss Alps",
                    questionName: "the Swiss Alps",
                    kind: .mountainRange,
                    scopeDescription: "The Swiss Alps cover many valleys, towns and trail networks."
                )
            ),
            (
                ["saxon switzerland", "sachsische schweiz"],
                BroadRegionDescriptor(
                    canonicalName: "Saxon Switzerland",
                    questionName: "Saxon Switzerland",
                    kind: .broadRegion,
                    scopeDescription: "Saxon Switzerland contains several distinct hiking areas and trailheads."
                )
            )
        ]

        return descriptors.reduce(into: [:]) { aliases, entry in
            for alias in entry.0 {
                aliases[normalizedWords(alias)] = entry.1
            }
        }
    }()

    static func normalizedWords(_ value: String) -> String {
        value.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "en_US_POSIX")
        )
        .unicodeScalars
        .map { CharacterSet.alphanumerics.contains($0) ? Character(String($0)) : " " }
        .reduce(into: "") { $0.append($1) }
        .split(whereSeparator: \.isWhitespace)
        .joined(separator: " ")
    }

    static func explicitCountryCode(in text: String) -> String? {
        let commaComponents = text.split(separator: ",", omittingEmptySubsequences: true)
        for component in commaComponents.reversed() {
            let normalized = normalizedWords(String(component))
            if let code = countryCodeByName[normalized] {
                return code
            }
        }

        let normalizedText = normalizedWords(text)
        return countryCodeByName
            .filter { name, _ in name.count > 2 }
            .sorted { $0.key.count > $1.key.count }
            .first { name, _ in
                normalizedText == name || normalizedText.hasSuffix(" \(name)")
            }?
            .value
    }

    static func broadRegion(in query: String) -> BroadRegionDescriptor? {
        // A qualifier such as “Alpen, Nordrhein-Westfalen” makes this a
        // settlement request. A country alone does not make “the Alps” a safe
        // route start, so only non-country qualifiers bypass this guard.
        let components = query.split(separator: ",", omittingEmptySubsequences: true)
        if components.count > 1 {
            let qualifiers = components.dropFirst().map { normalizedWords(String($0)) }
            let onlyCountryQualifiers = qualifiers.allSatisfy { countryCodeByName[$0] != nil }
            if !onlyCountryQualifiers {
                return nil
            }
        }

        var words = normalizedWords(String(components.first ?? Substring(query)))
            .split(separator: " ")
            .map(String.init)
        let removablePrefixes: Set<String> = [
            "in", "im", "den", "die", "der", "the", "around", "um", "bei", "near"
        ]
        while let first = words.first, removablePrefixes.contains(first) {
            words.removeFirst()
        }
        return broadRegionsByAlias[words.joined(separator: " ")]
    }

    static func meaningfulTokens(in value: String) -> Set<String> {
        let ignored: Set<String> = [
            "a", "an", "and", "around", "bei", "der", "die", "das", "den", "easy", "eine", "einen",
            "for", "from", "hike", "hiking", "im", "in", "km", "loop", "machen", "near", "plan",
            "route", "rundwanderung", "the", "to", "um", "von", "wanderung"
        ]
        return Set(normalizedWords(value).split(separator: " ").map(String.init).filter {
            $0.count > 1 && !ignored.contains($0)
        })
    }
}

enum LocationSemanticClassifier {
    private static let trailheadCues = [
        "trailhead", "trail head", "wanderparkplatz", "parkplatz", "starting point", "ausgangspunkt"
    ]
    private static let parkCues = ["national park", "nationalpark", "nature park", "naturpark"]

    static func classify(
        query: String,
        hasLocality: Bool,
        hasAreaOfInterest: Bool
    ) -> LocationSemanticKind {
        if let broadRegion = LocationLanguageContext.broadRegion(in: query) {
            return broadRegion.kind
        }
        let normalized = LocationLanguageContext.normalizedWords(query)
        if trailheadCues.contains(where: normalized.contains) {
            return .trailhead
        }
        if parkCues.contains(where: normalized.contains) {
            return .park
        }
        if hasLocality {
            return .settlement
        }
        if hasAreaOfInterest {
            return .landmark
        }
        return .unknown
    }
}

enum LocationResolutionPolicy {
    /// Auto-resolution requires both an absolute score and separation from the
    /// runner-up. A close tie is intentionally treated as a useful clarification.
    static let automaticResolutionThreshold = 0.72
    static let automaticResolutionMargin = 0.12
    static let maximumClarificationCandidates = 4

    static func resolve(
        context: LocationQueryContext,
        candidates: [LocationCandidate]
    ) -> LocationResolution {
        let cleanQuery = context.originalQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanQuery.isEmpty else { return .noResults(query: cleanQuery) }

        if let region = LocationLanguageContext.broadRegion(in: cleanQuery) {
            return .needsClarification(
                broadRegionClarification(region, context: context)
            )
        }

        let ranked = rank(candidates: candidates, for: context)
        guard let leading = ranked.first else {
            return .noResults(query: cleanQuery)
        }

        if !leading.candidate.semanticKind.isUsableRouteAnchor {
            return .needsClarification(
                concreteAnchorClarification(
                    context: context,
                    candidates: ranked.map(\.candidate)
                )
            )
        }

        let margin = leading.score - (ranked.dropFirst().first?.score ?? 0)
        guard leading.score >= automaticResolutionThreshold,
              ranked.count == 1 || margin >= automaticResolutionMargin else {
            return .needsClarification(
                ambiguousClarification(
                    context: context,
                    candidates: ranked.map(\.candidate)
                )
            )
        }

        return .resolved(leading.candidate)
    }

    static func rank(
        candidates: [LocationCandidate],
        for context: LocationQueryContext
    ) -> [RankedLocationCandidate] {
        candidates.map { candidate in
            score(candidate: candidate, context: context)
        }
        .sorted {
            if abs($0.score - $1.score) > 0.000_001 {
                return $0.score > $1.score
            }
            if $0.candidate.providerRank != $1.candidate.providerRank {
                return $0.candidate.providerRank < $1.candidate.providerRank
            }
            return $0.candidate.id < $1.candidate.id
        }
    }

    private static func score(
        candidate: LocationCandidate,
        context: LocationQueryContext
    ) -> RankedLocationCandidate {
        let query = LocationLanguageContext.normalizedWords(context.originalQuery)
        let primaryQueryName = LocationLanguageContext.normalizedWords(
            String(context.originalQuery.split(separator: ",", omittingEmptySubsequences: true).first ?? "")
        )
        let name = LocationLanguageContext.normalizedWords(candidate.name)
        let display = LocationLanguageContext.normalizedWords(candidate.displayName)
        let queryTokens = LocationLanguageContext.meaningfulTokens(in: context.originalQuery)
        let displayTokens = LocationLanguageContext.meaningfulTokens(in: candidate.displayName)
        let promptTokens = LocationLanguageContext.meaningfulTokens(in: context.originalPrompt)

        var score = 0.20
        var evidence = ["provider candidate"]

        if query == name || primaryQueryName == name {
            score += 0.32
            evidence.append("exact place name")
        } else if query.contains(name) || display.contains(query) {
            score += 0.22
            evidence.append("place name contained in query")
        }

        if !queryTokens.isEmpty {
            let overlap = Double(queryTokens.intersection(displayTokens).count) / Double(queryTokens.count)
            score += overlap * 0.18
            if overlap >= 0.5 { evidence.append("query context match") }
        }

        if candidate.semanticKind.isUsableRouteAnchor {
            score += 0.16
            evidence.append("usable route anchor")
        } else {
            score -= 0.10
        }

        if let explicitCountryCode = context.explicitCountryCode {
            if candidate.countryCode == explicitCountryCode {
                score += 0.18
                evidence.append("explicit country match")
            } else {
                score -= 0.35
                evidence.append("explicit country mismatch")
            }
        }

        let qualifierTokens = queryTokens.subtracting(LocationLanguageContext.meaningfulTokens(in: candidate.name))
        if !qualifierTokens.isEmpty,
           qualifierTokens.isSubset(of: displayTokens) {
            score += 0.12
            evidence.append("administrative context match")
        }

        let promptOverlap = promptTokens.intersection(displayTokens).subtracting(queryTokens).count
        if promptOverlap > 0 {
            score += min(Double(promptOverlap) * 0.025, 0.075)
            evidence.append("full prompt context match")
        }

        if let preferredCoordinate = context.preferredCoordinate {
            let distance = CLLocation(
                latitude: preferredCoordinate.latitude,
                longitude: preferredCoordinate.longitude
            ).distance(
                from: CLLocation(
                    latitude: candidate.coordinate.latitude,
                    longitude: candidate.coordinate.longitude
                )
            )
            let nearbyContribution = max(0, 1 - min(distance / 150_000, 1)) * 0.08
            score += nearbyContribution
            if nearbyContribution >= 0.03 { evidence.append("near route start") }
        }

        score += max(0, 0.06 - Double(candidate.providerRank) * 0.01)
        return RankedLocationCandidate(
            candidate: candidate,
            score: min(max(score, 0), 1),
            evidence: evidence
        )
    }

    private static func broadRegionClarification(
        _ region: BroadRegionDescriptor,
        context: LocationQueryContext
    ) -> LocationClarification {
        let question: String
        if context.requestedField == .endLocationQuery {
            question = "Which specific place in \(region.questionName) should be the destination?"
        } else {
            question = "Where in \(region.questionName) should the hike start?"
        }
        return LocationClarification(
            query: context.originalQuery,
            question: question,
            supportingText: "\(region.scopeDescription) Enter a nearby town, valley or trailhead so Wanderful can build the right route.",
            candidates: [],
            allowsFreeText: true
        )
    }

    private static func concreteAnchorClarification(
        context: LocationQueryContext,
        candidates: [LocationCandidate]
    ) -> LocationClarification {
        LocationClarification(
            query: context.originalQuery,
            question: context.requestedField == .endLocationQuery
                ? "Which specific place should be the destination?"
                : "Where should the hike start?",
            supportingText: "This place covers a wider area. Enter a nearby town, valley or trailhead so Wanderful does not route from an arbitrary map center.",
            candidates: Array(candidates.prefix(maximumClarificationCandidates)),
            allowsFreeText: true
        )
    }

    private static func ambiguousClarification(
        context: LocationQueryContext,
        candidates: [LocationCandidate]
    ) -> LocationClarification {
        LocationClarification(
            query: context.originalQuery,
            question: "Which “\(context.originalQuery)” did you mean?",
            supportingText: "Choose the place that matches your route, or enter a more specific town, valley or trailhead.",
            candidates: Array(candidates.prefix(maximumClarificationCandidates)),
            allowsFreeText: true
        )
    }
}

@MainActor
final class LocationResolutionService: LocationResolving {
    private let provider: any LocationCandidateProviding
    private var cache: [LocationQueryContext: LocationResolution] = [:]

    init(provider: any LocationCandidateProviding) {
        self.provider = provider
    }

    func resolve(_ context: LocationQueryContext) async throws -> LocationResolution {
        if let cached = cache[context] {
            return cached
        }

        if LocationLanguageContext.broadRegion(in: context.originalQuery) != nil {
            let resolution = LocationResolutionPolicy.resolve(context: context, candidates: [])
            cache[context] = resolution
            return resolution
        }

        do {
            let candidates = try await provider.candidates(for: context)
            try Task.checkCancellation()
            let resolution = LocationResolutionPolicy.resolve(context: context, candidates: candidates)
            cache[context] = resolution
            return resolution
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as GeocodingServiceError {
            switch error {
            case .noResults:
                return .noResults(query: context.originalQuery)
            case .network, .unavailable, .requestInProgress, .failed:
                return .unavailable
            case .emptyQuery:
                return .noResults(query: context.originalQuery)
            case .endpointsTooClose, .needsClarification:
                throw error
            }
        }
    }
}

@MainActor
final class LegacyGeocodingLocationResolver: LocationResolving {
    private let geocodingService: any GeocodingService

    init(geocodingService: any GeocodingService) {
        self.geocodingService = geocodingService
    }

    func resolve(_ context: LocationQueryContext) async throws -> LocationResolution {
        if LocationLanguageContext.broadRegion(in: context.originalQuery) != nil {
            return LocationResolutionPolicy.resolve(context: context, candidates: [])
        }
        let coordinate = try await geocodingService.geocodeLocation(
            context.originalQuery,
            near: context.preferredCoordinate
        )
        return .resolved(
            LocationCandidate(
                id: "legacy:\(LocationLanguageContext.normalizedWords(context.originalQuery)):\(coordinate.latitude):\(coordinate.longitude)",
                name: context.originalQuery,
                displayName: context.originalQuery,
                coordinate: coordinate,
                semanticKind: .settlement,
                provider: .legacyCoordinateAdapter
            )
        )
    }
}
