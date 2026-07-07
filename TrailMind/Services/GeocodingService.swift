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
            "Bitte gib einen Ortsnamen ein."
        case let .noResults(query):
            "„\(query)“ konnte nicht gefunden werden. Bitte prüfe den Ortsnamen."
        case .requestInProgress:
            "Die Ortssuche läuft bereits. Bitte versuche es gleich noch einmal."
        case .endpointsTooClose:
            "Start und Ziel konnten nicht eindeutig unterschieden werden. Bitte verwende genauere Ortsnamen."
        case .network:
            "Die Ortssuche ist gerade nicht erreichbar. Bitte prüfe deine Verbindung."
        case .unavailable:
            "Die Ortssuche ist auf diesem Gerät gerade nicht verfügbar."
        case let .failed(message):
            "Die Ortssuche ist fehlgeschlagen. \(message)"
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

    private let germanyRegion = CLCircularRegion(
        center: CLLocationCoordinate2D(latitude: 51.1657, longitude: 10.4515),
        radius: 700_000,
        identifier: "Germany"
    )

    func geocodeLocation(_ query: String, near preferredCoordinate: Coordinate?) async throws -> Coordinate {
        let cleanQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanQuery.isEmpty else {
            throw GeocodingServiceError.emptyQuery
        }

        let normalizedQuery = cleanQuery.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "de_DE")
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
        let germanyBiasedQuery = contextualizedQuery(
            cleanQuery,
            nearbyContext: nearbyContext
        )
        let searchRegion: CLRegion
        if let preferredCoordinate {
            searchRegion = CLCircularRegion(
                center: CLLocationCoordinate2D(
                    latitude: preferredCoordinate.latitude,
                    longitude: preferredCoordinate.longitude
                ),
                radius: 150_000,
                identifier: "RouteStartBias"
            )
        } else {
            searchRegion = germanyRegion
        }

        do {
            let placemarks = try await geocoder.geocodeAddressString(
                germanyBiasedQuery,
                in: searchRegion
            )
            try Task.checkCancellation()

            let selectedPlacemark: CLPlacemark?
            if let preferredCoordinate {
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

    private func contextualizedQuery(
        _ query: String,
        nearbyContext: PlacemarkContext?
    ) -> String {
        guard !isAlreadyCountryQualified(query) else { return query }

        var components = [query]
        if let nearbyContext {
            if let subAdministrativeArea = nearbyContext.subAdministrativeArea {
                components.append(subAdministrativeArea)
            } else if let locality = nearbyContext.locality {
                components.append(locality)
            }
            if let administrativeArea = nearbyContext.administrativeArea {
                components.append(administrativeArea)
            }
        }
        components.append("Deutschland")

        var seen: Set<String> = []
        return components.filter { component in
            let normalized = component.folding(
                options: [.caseInsensitive, .diacriticInsensitive],
                locale: Locale(identifier: "de_DE")
            )
            return seen.insert(normalized).inserted
        }
        .joined(separator: ", ")
    }

    private func coordinateCacheKey(_ coordinate: Coordinate) -> String {
        "\(Int(coordinate.latitude * 1_000)),\(Int(coordinate.longitude * 1_000))"
    }

    private func isAlreadyCountryQualified(_ query: String) -> Bool {
        let normalized = query.folding(
            options: [.caseInsensitive, .diacriticInsensitive],
            locale: Locale(identifier: "de_DE")
        )
        return normalized.contains("deutschland") || normalized.contains("germany")
    }
}
