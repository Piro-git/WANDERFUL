import CoreLocation
import Foundation

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
final class NativeGeocodingService: GeocodingService {
    private struct PlacemarkContext {
        let locality: String?
        let subAdministrativeArea: String?
        let administrativeArea: String?
    }

    private let geocoder = CLGeocoder()
    private var cache: [String: Coordinate] = [:]
    private var contextByCoordinate: [String: PlacemarkContext] = [:]
    private var lastRequestDate: Date?

    /// Unqualified place names are intentionally biased toward TrailMind's
    /// Germany-first beta region. This is a search hint, not a location claim.
    static let germanyBiasCenter = Coordinate(latitude: 51.1657, longitude: 10.4515)
    static let germanyBiasRadiusMeters: CLLocationDistance = 700_000
    static let nearbyBiasRadiusMeters: CLLocationDistance = 150_000
    private static let germanyRegionCode = "DE"
    private static let countryRegionCodeByName: [String: String] = {
        let displayLocales = [Locale(identifier: "en"), Locale(identifier: "de")]
        return Locale.Region.isoRegions.reduce(into: [:]) { namesByCode, region in
            let regionCode = region.identifier.uppercased()
            namesByCode[normalizedCountryComponent(regionCode)] = regionCode
            for locale in displayLocales {
                if let name = locale.localizedString(forRegionCode: regionCode) {
                    namesByCode[normalizedCountryComponent(name)] = regionCode
                }
            }
        }
    }()

    func geocodeLocation(_ query: String, near preferredCoordinate: Coordinate?) async throws -> Coordinate {
        let cleanQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanQuery.isEmpty else {
            throw GeocodingServiceError.emptyQuery
        }

        let normalizedQuery = cleanQuery.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "en_US_POSIX")
        )
        let cacheKey = if let preferredCoordinate {
            "\(normalizedQuery)|\(Int(preferredCoordinate.latitude * 10)),\(Int(preferredCoordinate.longitude * 10))"
        } else {
            "\(normalizedQuery)|germany"
        }
        if let cached = cache[cacheKey] {
            return cached
        }

        guard !geocoder.isGeocoding else {
            throw GeocodingServiceError.requestInProgress
        }

        if let lastRequestDate {
            let elapsed = Date().timeIntervalSince(lastRequestDate)
            if elapsed < 0.4 {
                try await Task.sleep(for: .seconds(0.4 - elapsed))
            }
        }
        try Task.checkCancellation()
        lastRequestDate = Date()

        let nearbyContext = preferredCoordinate.flatMap {
            contextByCoordinate[coordinateCacheKey($0)]
        }
        let germanyBiasedQuery = Self.contextualizedQuery(
            cleanQuery,
            locality: nearbyContext?.locality,
            subAdministrativeArea: nearbyContext?.subAdministrativeArea,
            administrativeArea: nearbyContext?.administrativeArea
        )
        let searchRegion = Self.searchRegion(for: cleanQuery, near: preferredCoordinate)

        do {
            let placemarks = try await geocoder.geocodeAddressString(
                germanyBiasedQuery,
                in: searchRegion
            )
            try Task.checkCancellation()

            let selectedPlacemark: CLPlacemark?
            if let preferredCoordinate,
               Self.shouldPreferNearbyResults(for: cleanQuery, near: preferredCoordinate) {
                let preferredLocation = CLLocation(
                    latitude: preferredCoordinate.latitude,
                    longitude: preferredCoordinate.longitude
                )
                selectedPlacemark = placemarks
                    .filter { $0.location != nil }
                    .min {
                        $0.location!.distance(from: preferredLocation)
                            < $1.location!.distance(from: preferredLocation)
                    }
            } else {
                selectedPlacemark = placemarks.first { $0.location != nil }
            }

            guard let selectedPlacemark, let location = selectedPlacemark.location else {
                throw GeocodingServiceError.noResults(query: cleanQuery)
            }

            let coordinate = Coordinate(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                elevationMeters: location.altitude.isFinite ? location.altitude : nil
            )
            cache[cacheKey] = coordinate
            contextByCoordinate[coordinateCacheKey(coordinate)] = PlacemarkContext(
                locality: selectedPlacemark.locality,
                subAdministrativeArea: selectedPlacemark.subAdministrativeArea,
                administrativeArea: selectedPlacemark.administrativeArea
            )
            return coordinate
        } catch is CancellationError {
            geocoder.cancelGeocode()
            throw CancellationError()
        } catch let error as GeocodingServiceError {
            throw error
        } catch let error as CLError {
            switch error.code {
            case .geocodeFoundNoResult, .geocodeFoundPartialResult:
                throw GeocodingServiceError.noResults(query: cleanQuery)
            case .network:
                throw GeocodingServiceError.network
            case .denied:
                throw GeocodingServiceError.unavailable
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
        guard !isAlreadyCountryQualified(query) else { return query }

        var components = [query]
        if let subAdministrativeArea {
            components.append(subAdministrativeArea)
        } else if let locality {
            components.append(locality)
        }
        if let administrativeArea {
            components.append(administrativeArea)
        }
        components.append("Germany")

        var seen: Set<String> = []
        return components.filter { component in
            let normalized = component.folding(
                options: [.caseInsensitive, .diacriticInsensitive],
                locale: Locale(identifier: "en_US_POSIX")
            )
            return seen.insert(normalized).inserted
        }
        .joined(separator: ", ")
    }

    static func searchRegion(
        for query: String,
        near preferredCoordinate: Coordinate?
    ) -> CLCircularRegion? {
        if let countryRegionCode = explicitCountryRegionCode(in: query),
           countryRegionCode != germanyRegionCode {
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
        return CLCircularRegion(
            center: CLLocationCoordinate2D(
                latitude: germanyBiasCenter.latitude,
                longitude: germanyBiasCenter.longitude
            ),
            radius: germanyBiasRadiusMeters,
            identifier: "GermanyBias"
        )
    }

    static func shouldPreferNearbyResults(
        for query: String,
        near preferredCoordinate: Coordinate?
    ) -> Bool {
        guard preferredCoordinate != nil else { return false }
        guard let countryRegionCode = explicitCountryRegionCode(in: query) else { return true }
        return countryRegionCode == germanyRegionCode
    }

    private func coordinateCacheKey(_ coordinate: Coordinate) -> String {
        "\(Int(coordinate.latitude * 1_000)),\(Int(coordinate.longitude * 1_000))"
    }

    private static func isAlreadyCountryQualified(_ query: String) -> Bool {
        explicitCountryRegionCode(in: query) != nil
    }

    private static func explicitCountryRegionCode(in query: String) -> String? {
        guard query.contains(","),
              let finalComponent = query.split(separator: ",", omittingEmptySubsequences: false).last else {
            return nil
        }
        return countryRegionCodeByName[normalizedCountryComponent(String(finalComponent))]
    }

    private static func normalizedCountryComponent(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
            .folding(
                options: [.caseInsensitive, .diacriticInsensitive],
                locale: Locale(identifier: "en_US_POSIX")
            )
    }
}
