import Foundation
import CoreLocation

/// A Commons image whose identity, licence and author came from an exact
/// Wikidata P18 or direct OSM Commons file reference. A missing result is
/// deliberate: never substitute stock or generated imagery for a route stop.
nonisolated struct CommonsRoutePhoto: Hashable, Sendable, Identifiable {
    let stopID: String
    let wikidataID: String?
    let imageURL: URL
    let sourceURL: URL
    let licence: String
    let licenceURL: URL
    let author: String
    let retrievedAt: Date

    var id: String { stopID + ":" + sourceURL.absoluteString }
}

nonisolated enum WikimediaCommonsPhotoFailure: Error, Equatable, Sendable {
    case unavailable
    case noEligiblePhoto
    case malformedResponse
}

/// Resolves only P18 media or an exact OSM `wikimedia_commons=File:*` reference.
/// It never searches by name, category or proximity.
actor WikimediaCommonsPhotoResolver {
    static let shared = WikimediaCommonsPhotoResolver()

    private let session: URLSession
    private let capacity: Int
    private var cache: [String: CommonsRoutePhoto] = [:]
    private var insertionOrder: [String] = []

    init(session: URLSession = .shared, capacity: Int = 48) {
        self.session = session
        self.capacity = max(1, capacity)
    }

    func photo(for stop: DynamicResearchStop) async throws -> CommonsRoutePhoto? {
        let directFile = Self.directMappedCommonsFile(for: stop)
        guard let wikidataID = stop.wikidataId, Self.isWikidataID(wikidataID) else {
            return try await directPhoto(fileName: directFile, stop: stop)
        }
        let key = stop.id + ":" + wikidataID + ":" + (directFile ?? "") + ":\(stop.coordinate.latitude),\(stop.coordinate.longitude)"
        if let cached = cache[key] { return cached }
        do {
            try Task.checkCancellation()
            let fileName = try await featuredFileName(for: wikidataID, coordinate: stop.coordinate)
            try Task.checkCancellation()
            let photo = try await commonsPhoto(fileName: fileName, stopID: stop.id, wikidataID: wikidataID)
            store(photo, for: key)
            return photo
        } catch WikimediaCommonsPhotoFailure.noEligiblePhoto {
            return try await directPhoto(fileName: directFile, stop: stop)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            guard directFile != nil else { throw error }
            return try await directPhoto(fileName: directFile, stop: stop)
        }
    }

    private func directPhoto(fileName: String?, stop: DynamicResearchStop) async throws -> CommonsRoutePhoto? {
        guard let fileName else { return nil }
        let key = stop.id + ":osm:" + fileName
        if let cached = cache[key] { return cached }
        do {
            let photo = try await commonsPhoto(fileName: fileName, stopID: stop.id, wikidataID: nil)
            store(photo, for: key)
            return photo
        } catch WikimediaCommonsPhotoFailure.noEligiblePhoto { return nil }
    }

    func removeAll() { cache.removeAll(); insertionOrder.removeAll() }
    func cachedCount() -> Int { cache.count }

    private func featuredFileName(for wikidataID: String, coordinate: DynamicResearchCoordinate) async throws -> String {
        var components = URLComponents(string: "https://www.wikidata.org/w/api.php")!
        components.queryItems = [
            .init(name: "action", value: "wbgetentities"), .init(name: "format", value: "json"),
            .init(name: "ids", value: wikidataID), .init(name: "props", value: "claims")
        ]
        let data = try await data(from: components.url!)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let entity = (root["entities"] as? [String: Any])?[wikidataID] as? [String: Any],
              entity["id"] as? String == wikidataID, entity["type"] as? String == "item",
              let claims = entity["claims"] as? [String: Any] else { throw WikimediaCommonsPhotoFailure.noEligiblePhoto }
        func values(_ property: String) -> [Any] {
            (claims[property] as? [[String: Any]] ?? []).compactMap { claim in
                guard claim["rank"] as? String != "deprecated",
                      let snak = claim["mainsnak"] as? [String: Any], snak["snaktype"] as? String == "value" else { return nil }
                return (snak["datavalue"] as? [String: Any])?["value"]
            }
        }
        let locations = values("P625"), images = values("P18")
        guard coordinate.isValid, locations.count == 1,
              let location = locations.first as? [String: Any],
              location["globe"] as? String == "http://www.wikidata.org/entity/Q2",
              let latitude = location["latitude"] as? Double, let longitude = location["longitude"] as? Double,
              DynamicResearchCoordinate(latitude: latitude, longitude: longitude).isValid,
              CLLocation(latitude: latitude, longitude: longitude).distance(from:
                CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)) <= 250,
              images.count == 1, let file = images.first as? String,
              Self.isSafeFileName(file) else { throw WikimediaCommonsPhotoFailure.noEligiblePhoto }
        return file
    }

    private func commonsPhoto(fileName: String, stopID: String, wikidataID: String?) async throws -> CommonsRoutePhoto {
        var components = URLComponents(string: "https://commons.wikimedia.org/w/api.php")!
        components.queryItems = [
            .init(name: "action", value: "query"), .init(name: "format", value: "json"),
            .init(name: "titles", value: "File:" + fileName), .init(name: "prop", value: "imageinfo"),
            .init(name: "iiprop", value: "url|mime|thumbmime|extmetadata"), .init(name: "iiurlwidth", value: "1280")
        ]
        let data = try await data(from: components.url!)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let pages = ((root["query"] as? [String: Any])?["pages"] as? [String: Any])?.values,
              pages.count == 1, let page = pages.first as? [String: Any], page["missing"] == nil,
              (page["title"] as? String)?.replacingOccurrences(of: "_", with: " ") == "File:" + fileName.replacingOccurrences(of: "_", with: " "),
              (page["imageinfo"] as? [[String: Any]])?.count == 1,
              let info = (page["imageinfo"] as? [[String: Any]])?.first,
              let thumbURL = URL(string: (info["thumburl"] as? String) ?? ""),
              let originalURL = URL(string: (info["descriptionurl"] as? String) ?? ""),
              let metadata = info["extmetadata"] as? [String: Any] else {
            throw WikimediaCommonsPhotoFailure.noEligiblePhoto
        }
        let licence = Self.metadataValue(metadata, "LicenseShortName")
        let attribution = Self.metadataValue(metadata, "Attribution")
        let author = Self.cleanCredit(attribution.isEmpty ? Self.metadataValue(metadata, "Artist") : attribution)
        let rawLicenceURL = Self.metadataValue(metadata, "LicenseUrl")
        let normalizedLicenceURL = rawLicenceURL.hasPrefix("//") ? "https:" + rawLicenceURL : rawLicenceURL.replacingOccurrences(of: "http://", with: "https://", options: .anchored)
        guard !licence.isEmpty,
              let licenceURL = URL(string: normalizedLicenceURL.hasSuffix("/") ? normalizedLicenceURL : normalizedLicenceURL + "/"),
              !author.isEmpty, author.count <= 500,
              ["image/jpeg", "image/png", "image/webp"].contains(info["mime"] as? String ?? ""),
              ["image/jpeg", "image/png", "image/webp"].contains((info["thumbmime"] ?? info["mime"]) as? String ?? ""),
              Self.isTrustedMediaURL(thumbURL), Self.isCommonsFileURL(originalURL),
              originalURL.lastPathComponent.replacingOccurrences(of: "_", with: " ") == "File:" + fileName.replacingOccurrences(of: "_", with: " "),
              Self.mediaURL(thumbURL, matches: fileName),
              Self.acceptedLicences[licence] == licenceURL.absoluteString else {
            throw WikimediaCommonsPhotoFailure.noEligiblePhoto
        }
        return CommonsRoutePhoto(stopID: stopID, wikidataID: wikidataID, imageURL: thumbURL,
            sourceURL: originalURL, licence: licence, licenceURL: licenceURL, author: author, retrievedAt: .now)
    }

    private func data(from url: URL) async throws -> Data {
        guard url.scheme == "https", ["www.wikidata.org", "commons.wikimedia.org"].contains(url.host) else {
            throw WikimediaCommonsPhotoFailure.malformedResponse
        }
        do {
            var request = URLRequest(url: url)
            // Photos enhance a route but must never hold up the route itself.
            request.timeoutInterval = 5
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count <= 1_000_000 else {
                throw WikimediaCommonsPhotoFailure.unavailable
            }
            return data
        } catch is CancellationError { throw CancellationError() }
        catch { throw WikimediaCommonsPhotoFailure.unavailable }
    }

    private func store(_ photo: CommonsRoutePhoto, for key: String) {
        cache[key] = photo; insertionOrder.removeAll { $0 == key }; insertionOrder.append(key)
        while insertionOrder.count > capacity { cache.removeValue(forKey: insertionOrder.removeFirst()) }
    }

    nonisolated private static let acceptedLicences = [
        "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
        "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
        "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
        "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
        "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/"
    ]
    nonisolated private static func metadataValue(_ metadata: [String: Any], _ key: String) -> String {
        ((metadata[key] as? [String: Any])?["value"] as? String) ?? ""
    }
    nonisolated private static func cleanCredit(_ value: String) -> String {
        guard value.count <= 4000, value.range(of: "<\\s*(script|style|iframe)\\b", options: [.regularExpression, .caseInsensitive]) == nil else { return "" }
        let text = value.replacingOccurrences(of: "<[^>]*>", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'").replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.range(of: "&(?:[a-z]+|#[^;]+);", options: [.regularExpression, .caseInsensitive]) == nil ? text : ""
    }

    /// File identity must agree across the Commons page and thumbnail path.
    nonisolated static func mediaURL(_ url: URL, matches fileName: String) -> Bool {
        let parts = url.pathComponents
        let file = parts.contains("thumb") ? parts.dropLast().last : parts.last
        return file?.replacingOccurrences(of: "_", with: " ") == fileName.replacingOccurrences(of: "_", with: " ")
    }

    nonisolated private static func isWikidataID(_ value: String) -> Bool {
        value.range(of: "^Q[1-9][0-9]*$", options: .regularExpression) != nil
    }
    nonisolated private static func isSafeFileName(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 240 && !value.lowercased().hasPrefix("file:") &&
            !value.lowercased().hasPrefix("category:") && !value.contains("/") && !value.contains("\\") &&
            !value.contains("..") && value.range(of: "[\\x00-\\x1f|{}\\[\\]]", options: .regularExpression) == nil
    }
    nonisolated private static func directMappedCommonsFile(for stop: DynamicResearchStop) -> String? {
        guard let file = stop.commonsFile, isSafeFileName(file), stop.coordinate.isValid,
              stop.source.provider == "openstreetmap", stop.source.url.scheme == "https",
              stop.source.url.host == "www.openstreetmap.org" else { return nil }
        let parts = stop.id.split(separator: ":")
        guard parts.count == 3, parts[0] == "osm", ["node", "way", "relation"].contains(String(parts[1])),
              let numericID = Int(parts[2]), numericID > 0,
              stop.source.url.path == "/\(parts[1])/\(numericID)" else { return nil }
        return file
    }
    nonisolated private static func isTrustedMediaURL(_ url: URL) -> Bool {
        url.scheme == "https" && ["upload.wikimedia.org", "thumb.wikimedia.org"].contains(url.host) &&
            url.path.hasPrefix("/wikipedia/commons/") && url.user == nil && url.password == nil && url.port == nil && url.fragment == nil
    }
    nonisolated private static func isCommonsFileURL(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == "commons.wikimedia.org" && url.path.hasPrefix("/wiki/File:") && url.user == nil && url.password == nil && url.port == nil && url.fragment == nil && url.query == nil
    }
}
