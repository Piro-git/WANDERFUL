import CoreLocation
import Foundation
import MapKit

@MainActor
protocol GeocodingService {
    func geocodeLocation(_ query: String) async throws -> Coordinate
    func geocodeLocation(_ query: String, near preferredCoordinate: Coordinate?) async throws -> Coordinate
}

extension GeocodingService {
    func geocodeLocation(_ query: String) async throws -> Coordinate {
        try await geocodeLocation(query, near: nil)
    }
}

enum GeocodingServiceError: LocalizedError {
    case emptyQuery
    case noResults(query: String)
    case requestInProgress
    case endpointsTooClose
    case needsClarification(query: String)
    case network
    case unavailable
    case failed(message: String)

    var errorDescription: String? {
        switch self {
        case .emptyQuery:
            "Enter a place name."
        case let .noResults(query):
            "“\(query)” could not be found. Check the place name and try again."
        case .requestInProgress:
            "Place search is already in progress. Try again in a moment."
        case .endpointsTooClose:
            "Start and destination could not be distinguished. Use more specific place names."
        case let .needsClarification(query):
            "“\(query)” needs a more specific town, valley or trailhead."
        case .network:
            "Place search is unavailable right now. Check your connection and try again."
        case .unavailable:
            "Place search is not available on this device right now."
        case .failed:
            "Place search failed. Try again."
        }
    }
}

@MainActor
final class NativeGeocodingService: GeocodingService, LocationCandidateProviding {
    private struct PlacemarkContext {
        let locality: String?
        let subAdministrativeArea: String?
        let administrativeArea: String?
        let countryCode: String?
    }

    private var candidateCache: [String: [LocationCandidate]] = [:]
    private var contextByCoordinate: [String: PlacemarkContext] = [:]
    private var lastRequestDate: Date?

    static let nearbyBiasRadiusMeters: CLLocationDistance = 150_000

    func geocodeLocation(_ query: String, near preferredCoordinate: Coordinate?) async throws -> Coordinate {
        let context = LocationQueryContext(
            originalQuery: query,
            originalPrompt: query,
            routeType: .pointToPoint,
            activityType: .hiking,
            requestedField: preferredCoordinate == nil ? .startLocationQuery : .endLocationQuery,
            preferredCoordinate: preferredCoordinate
        )
        let resolution = LocationResolutionPolicy.resolve(
            context: context,
            candidates: try await candidates(for: context)
        )
        switch resolution {
        case let .resolved(candidate):
            return candidate.coordinate
        case .needsClarification:
            throw GeocodingServiceError.needsClarification(query: query)
        case let .noResults(query):
            throw GeocodingServiceError.noResults(query: query)
        case .unavailable:
            throw GeocodingServiceError.unavailable
        }
    }

    func candidates(for context: LocationQueryContext) async throws -> [LocationCandidate] {
        let cleanQuery = context.originalQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanQuery.isEmpty else {
            throw GeocodingServiceError.emptyQuery
        }

        let cacheKey = Self.cacheKey(for: context)
        if let cached = candidateCache[cacheKey] { return cached }

        if let lastRequestDate {
            let elapsed = Date().timeIntervalSince(lastRequestDate)
            if elapsed < 0.4 {
                try await Task.sleep(for: .seconds(0.4 - elapsed))
            }
        }
        try Task.checkCancellation()
        lastRequestDate = Date()

        let nearbyContext = context.preferredCoordinate.flatMap {
            contextByCoordinate[coordinateCacheKey($0)]
        }
        let contextualQuery = Self.contextualizedQuery(
            cleanQuery,
            locality: nearbyContext?.locality,
            subAdministrativeArea: nearbyContext?.subAdministrativeArea,
            administrativeArea: nearbyContext?.administrativeArea
        )
        let searchRegion = Self.searchRegion(for: cleanQuery, near: context.preferredCoordinate)
        guard let geocodingRequest = MKGeocodingRequest(addressString: contextualQuery) else {
            throw GeocodingServiceError.noResults(query: cleanQuery)
        }
        geocodingRequest.preferredLocale = Locale(identifier: context.localeIdentifier)
        if let searchRegion {
            geocodingRequest.region = MKCoordinateRegion(
                center: searchRegion.center,
                latitudinalMeters: searchRegion.radius * 2,
                longitudinalMeters: searchRegion.radius * 2
            )
        }

        do {
            let mapItems = try await geocodingRequest.mapItems
            try Task.checkCancellation()
            var candidates = mapItems.enumerated().map { index, mapItem in
                Self.candidate(from: mapItem, query: cleanQuery, providerRank: index)
            }
            if let preferredCoordinate = context.preferredCoordinate,
               Self.shouldPreferNearbyResults(for: cleanQuery, near: preferredCoordinate) {
                let preferredLocation = CLLocation(
                    latitude: preferredCoordinate.latitude,
                    longitude: preferredCoordinate.longitude
                )
                candidates.sort {
                    let first = CLLocation(
                        latitude: $0.coordinate.latitude,
                        longitude: $0.coordinate.longitude
                    )
                    let second = CLLocation(
                        latitude: $1.coordinate.latitude,
                        longitude: $1.coordinate.longitude
                    )
                    return first.distance(from: preferredLocation) < second.distance(from: preferredLocation)
                }
            }

            guard !candidates.isEmpty else {
                throw GeocodingServiceError.noResults(query: cleanQuery)
            }
            candidateCache[cacheKey] = candidates
            for candidate in candidates {
                contextByCoordinate[coordinateCacheKey(candidate.coordinate)] = PlacemarkContext(
                    locality: candidate.locality,
                    subAdministrativeArea: nil,
                    administrativeArea: candidate.administrativeRegion,
                    countryCode: candidate.countryCode
                )
            }
            return candidates
        } catch is CancellationError {
            geocodingRequest.cancel()
            throw CancellationError()
        } catch let error as GeocodingServiceError {
            throw error
        } catch let error as NSError where error.domain == MKErrorDomain {
            switch MKError.Code(rawValue: UInt(error.code)) {
            case .placemarkNotFound:
                throw GeocodingServiceError.noResults(query: cleanQuery)
            case .serverFailure, .loadingThrottled:
                throw GeocodingServiceError.network
            default:
                throw GeocodingServiceError.failed(message: error.localizedDescription)
            }
        } catch {
            throw GeocodingServiceError.failed(message: error.localizedDescription)
        }
    }

    static func contextualizedQuery(
        _ query: String,
        locality: String? = nil,
        subAdministrativeArea: String? = nil,
        administrativeArea: String? = nil
    ) -> String {
        // Nearby route context is deliberately carried as a search/ranking
        // hint, never rewritten into the user's query as if it were explicit.
        _ = locality
        _ = subAdministrativeArea
        _ = administrativeArea
        return query
    }

    static func searchRegion(
        for query: String,
        near preferredCoordinate: Coordinate?
    ) -> CLCircularRegion? {
        if LocationLanguageContext.explicitCountryCode(in: query) != nil {
            return nil
        }
        if let preferredCoordinate {
            return CLCircularRegion(
                center: CLLocationCoordinate2D(
                    latitude: preferredCoordinate.latitude,
                    longitude: preferredCoordinate.longitude
                ),
                radius: nearbyBiasRadiusMeters,
                identifier: "RouteStartBias"
            )
        }
        return nil
    }

    static func shouldPreferNearbyResults(
        for query: String,
        near preferredCoordinate: Coordinate?
    ) -> Bool {
        guard preferredCoordinate != nil else { return false }
        return LocationLanguageContext.explicitCountryCode(in: query) == nil
    }

    private func coordinateCacheKey(_ coordinate: Coordinate) -> String {
        "\(Int(coordinate.latitude * 1_000)),\(Int(coordinate.longitude * 1_000))"
    }

    private static func cacheKey(for context: LocationQueryContext) -> String {
        let coordinateKey = context.preferredCoordinate.map {
            "\(Int($0.latitude * 10)),\(Int($0.longitude * 10))"
        } ?? "none"
        return [
            LocationLanguageContext.normalizedWords(context.originalQuery),
            context.explicitCountryCode ?? "none",
            coordinateKey
        ].joined(separator: "|")
    }

    private static func candidate(
        from mapItem: MKMapItem,
        query: String,
        providerRank: Int
    ) -> LocationCandidate {
        let location = mapItem.location
        let coordinate = Coordinate(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            elevationMeters: location.altitude.isFinite ? location.altitude : nil
        )
        let representations = mapItem.addressRepresentations
        let name = mapItem.name ?? representations?.cityName ?? query
        let locality = representations?.cityName
        let country = representations?.regionName
        let cityContext = representations?.cityWithContext(.full)
        let components = [
            name,
            cityContext,
            mapItem.address?.shortAddress,
            cityContext == nil ? country : nil
        ]
        let displayName = deduplicatedComponents(components).joined(separator: ", ")
        let semanticKind = LocationSemanticClassifier.classify(
            query: query,
            hasLocality: locality != nil,
            hasAreaOfInterest: mapItem.pointOfInterestCategory != nil
        )
        let stableCoordinate = String(format: "%.5f,%.5f", coordinate.latitude, coordinate.longitude)
        return LocationCandidate(
            id: "apple:\(stableCoordinate):\(LocationLanguageContext.normalizedWords(displayName))",
            name: name,
            displayName: displayName,
            coordinate: coordinate,
            semanticKind: semanticKind,
            locality: locality,
            administrativeRegion: cityContext,
            country: country,
            countryCode: country.flatMap(LocationLanguageContext.explicitCountryCode(in:)),
            provider: .appleGeocoder,
            providerRank: providerRank
        )
    }

    private static func deduplicatedComponents(_ components: [String?]) -> [String] {
        var seen: Set<String> = []
        return components.compactMap { component in
            guard let component = component?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !component.isEmpty else { return nil }
            let normalized = LocationLanguageContext.normalizedWords(component)
            guard seen.insert(normalized).inserted else { return nil }
            return component
        }
    }
}
