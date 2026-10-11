import XCTest
@testable import TrailMind

final class WikimediaCommonsPhotoResolverTests: XCTestCase {
    override func tearDown() { CommonsURLProtocol.handler = nil; super.tearDown() }

    func testResolvesOnlyWikidataP18WithVerifiedCommonsMetadata() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession(), capacity: 1)
        CommonsURLProtocol.handler = { request in
            if request.url?.host == "www.wikidata.org" {
                return Self.response(Self.wikidataFixture())
            }
            return Self.response(Self.commonsFixture(licence: "CC BY 4.0", licenceURL: "https://creativecommons.org/licenses/by/4.0/", author: "<a href='x'>Ada Hiker</a>"))
        }
        let photo = try await resolver.photo(for: fixtureStop(wikidataID: "Q42"))
        XCTAssertEqual(photo?.wikidataID, "Q42")
        XCTAssertEqual(photo?.author, "Ada Hiker")
        XCTAssertEqual(photo?.licence, "CC BY 4.0")
        let cachedCount = await resolver.cachedCount()
        XCTAssertEqual(cachedCount, 1)
    }

    func testRejectsMissingLicenceAndDoesNotCacheIt() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        CommonsURLProtocol.handler = { request in
            if request.url?.host == "www.wikidata.org" {
                return Self.response(Self.wikidataFixture())
            }
            return Self.response(Self.commonsFixture(licence: "All rights reserved", licenceURL: "https://example.com/licence", author: "Ada"))
        }
        let photo = try await resolver.photo(for: fixtureStop(wikidataID: "Q42"))
        let cachedCount = await resolver.cachedCount()
        XCTAssertNil(photo)
        XCTAssertEqual(cachedCount, 0)
    }

    func testSkipsStopsWithoutIdentityInsteadOfNameSearching() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        let photo = try await resolver.photo(for: fixtureStop(wikidataID: nil))
        XCTAssertNil(photo)
    }

    func testRejectsACommonsPageWhoseFileNameDoesNotMatchWikidataP18() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        CommonsURLProtocol.handler = { request in
            request.url?.host == "www.wikidata.org"
                ? Self.response(Self.wikidataFixture())
                : Self.response(Self.commonsFixture(licence: "CC BY 4.0", licenceURL: "https://creativecommons.org/licenses/by/4.0/", author: "Ada", title: "File:Different.jpg"))
        }
        let photo = try await resolver.photo(for: fixtureStop(wikidataID: "Q42"))
        XCTAssertNil(photo)
    }

    func testRejectsAttributionPageAndThumbnailForDifferentFiles() async throws {
        for change in ["descriptionurl", "thumburl"] {
            let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
            CommonsURLProtocol.handler = { request in
                if request.url?.host == "www.wikidata.org" { return Self.response(Self.wikidataFixture()) }
                var payload = Self.commonsFixture(licence: "CC BY 4.0", licenceURL: "https://creativecommons.org/licenses/by/4.0/", author: "Ada")
                var query = payload["query"] as! [String: Any]
                var pages = query["pages"] as! [String: Any]
                var page = pages["7"] as! [String: Any]
                var info = (page["imageinfo"] as! [[String: Any]])[0]
                info[change] = change == "thumburl" ? "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Other.jpg/800px-Other.jpg" : "https://commons.wikimedia.org/wiki/File:Other.jpg"
                page["imageinfo"] = [info]; pages["7"] = page; query["pages"] = pages; payload["query"] = query
                return Self.response(payload)
            }
            let photo = try await resolver.photo(for: fixtureStop(wikidataID: "Q42"))
            XCTAssertNil(photo, change)
        }
    }

    func testSameIDWithChangedCoordinatesDoesNotReuseCachedPhoto() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        CommonsURLProtocol.handler = { request in
            request.url?.host == "www.wikidata.org" ? Self.response(Self.wikidataFixture()) : Self.response(Self.commonsFixture(licence: "CC BY 4.0", licenceURL: "https://creativecommons.org/licenses/by/4.0/", author: "Ada"))
        }
        let first = try await resolver.photo(for: fixtureStop(wikidataID: "Q42"))
        XCTAssertNotNil(first)
        let far = try await resolver.photo(for: fixtureStop(wikidataID: "Q42", latitude: -33.86, longitude: 151.21))
        XCTAssertNil(far)
    }

    func testNormalizesCommonsSpacesAndLicenseTransport() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        CommonsURLProtocol.handler = { _ in Self.response(Self.commonsFixture(licence: "CC BY 4.0", licenceURL: "//creativecommons.org/licenses/by/4.0", author: "Ada", title: "File:Mapped_peak.jpg", fileName: "Mapped_peak.jpg")) }
        let photo = try await resolver.photo(for: fixtureStop(wikidataID: nil, commonsFile: "Mapped peak.jpg"))
        XCTAssertEqual(photo?.sourceURL.lastPathComponent, "File:Mapped_peak.jpg")
    }

    func testRejectsAnImageWithoutAnAttributableAuthor() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        CommonsURLProtocol.handler = { request in
            request.url?.host == "www.wikidata.org"
                ? Self.response(Self.wikidataFixture())
                : Self.response(Self.commonsFixture(licence: "CC BY 4.0", licenceURL: "https://creativecommons.org/licenses/by/4.0/", author: ""))
        }
        let photo = try await resolver.photo(for: fixtureStop(wikidataID: "Q42"))
        XCTAssertNil(photo)
    }

    func testCacheHasBoundedRetentionAcrossDifferentStopsAndRegions() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession(), capacity: 1)
        CommonsURLProtocol.handler = { request in
            request.url?.host == "www.wikidata.org" ? Self.response(Self.wikidataFixture()) : Self.response(Self.commonsFixture(licence: "CC BY 4.0", licenceURL: "https://creativecommons.org/licenses/by/4.0/", author: "Ada"))
        }
        _ = try await resolver.photo(for: fixtureStop(wikidataID: "Q42"))
        _ = try await resolver.photo(for: fixtureStop(id: "osm:node:8", wikidataID: "Q42", latitude: -33.86, longitude: 151.21))
        let cachedCount = await resolver.cachedCount()
        XCTAssertEqual(cachedCount, 1)
    }

    func testIdenticallyNamedStopsRemainBoundToTheirOwnWikidataP18Photo() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        CommonsURLProtocol.handler = { request in
            let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            if request.url?.host == "www.wikidata.org" {
                let id = items.first(where: { $0.name == "ids" })?.value ?? ""
                let file = id == "Q42" ? "North.jpg" : "South.jpg"
                return Self.response(Self.wikidataFixture(id: id, file: file))
            }
            let title = items.first(where: { $0.name == "titles" })?.value ?? "File:Unexpected.jpg"
            let file = String(title.dropFirst("File:".count))
            return Self.response(Self.commonsFixture(licence: "CC BY 4.0", licenceURL: "https://creativecommons.org/licenses/by/4.0/", author: "Ada", title: title, fileName: file))
        }
        let north = fixtureStop(id: "osm:node:1", name: "Twin Peak", wikidataID: "Q42")
        let south = fixtureStop(id: "osm:node:2", name: "Twin Peak", wikidataID: "Q64")
        async let northPhoto = resolver.photo(for: north)
        async let southPhoto = resolver.photo(for: south)
        let photos = try await [northPhoto, southPhoto]
        XCTAssertEqual(photos.map { $0?.stopID }, [north.id, south.id])
        XCTAssertEqual(photos.map { $0?.sourceURL.lastPathComponent }, ["File:North.jpg", "File:South.jpg"])
    }

    func testMissingP18IsOmittedWithoutCaching() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        CommonsURLProtocol.handler = { _ in Self.response(["entities": ["Q42": ["claims": [:]]]]) }
        let photo = try await resolver.photo(for: fixtureStop(wikidataID: "Q42"))
        XCTAssertNil(photo)
        let cachedCount = await resolver.cachedCount()
        XCTAssertEqual(cachedCount, 0)
    }

    func testDirectMappedCommonsFileResolvesWithoutWikidata() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        CommonsURLProtocol.handler = { _ in
            Self.response(Self.commonsFixture(licence: "CC BY 4.0", licenceURL: "https://creativecommons.org/licenses/by/4.0/", author: "Mapper", title: "File:Mapped.jpg", fileName: "Mapped.jpg"))
        }
        let stop = fixtureStop(wikidataID: nil, commonsFile: "Mapped.jpg")
        let photo = try await resolver.photo(for: stop)
        XCTAssertNil(photo?.wikidataID)
        XCTAssertEqual(photo?.stopID, stop.id)
        XCTAssertEqual(photo?.sourceURL.lastPathComponent, "File:Mapped.jpg")
    }

    func testNetworkFailureIsNotCached() async throws {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        CommonsURLProtocol.handler = { request in
            request.url?.host == "www.wikidata.org" ? Self.response(Self.wikidataFixture()) : Self.response([:], statusCode: 503)
        }
        do {
            _ = try await resolver.photo(for: fixtureStop(wikidataID: "Q42"))
            XCTFail("Expected an unavailable provider")
        } catch WikimediaCommonsPhotoFailure.unavailable {}
        let cachedCount = await resolver.cachedCount()
        XCTAssertEqual(cachedCount, 0)
    }

    @MainActor
    func testGalleryModelFinishesWithAnHonestEmptyStateWhenPhotosCannotBeVerified() async {
        let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
        CommonsURLProtocol.handler = { _ in Self.response([:], statusCode: 503) }
        let model = CommonsRoutePhotoGalleryModel(resolver: resolver)

        await model.load(stops: [fixtureStop(wikidataID: "Q42")])

        XCTAssertTrue(model.hasLoaded)
        XCTAssertTrue(model.photos.isEmpty)
    }

    @MainActor
    func testDatedLiveMetadataPassesAppContractAndInvalidSavedCreditIsOmitted() throws {
        // Real public metadata, but synthetic OSM stop: this is contract parity,
        // not proof of a live route or a source-to-route geographic match.
        let file = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("docs/engineering/photos-packing-20260929/live-metadata.json")
        let root = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
        let results = root["results"] as! [[String: Any]]
        var accepted = 0
        for result in results {
            guard let payload = result["photo"] as? [String: Any] else { continue }
            let photo = try JSONDecoder().decode(DynamicResearchStop.Photo.self, from: JSONSerialization.data(withJSONObject: payload))
            let stop = fixtureStop(wikidataID: result["wikidataId"] as? String, photo: photo)
            XCTAssertNoThrow(try BackendDynamicResearchPlanningClient.validateStoredEvidence([stop]))
            XCTAssertNotNil(CommonsRoutePhotoGalleryModel.storedPhoto(for: stop))
            let invalid = DynamicResearchStop.Photo(url: photo.url, sourceURL: photo.sourceURL, license: photo.license,
                licenseURL: photo.licenseURL, credit: "", placeSourceURL: photo.placeSourceURL)
            XCTAssertNil(CommonsRoutePhotoGalleryModel.storedPhoto(for: fixtureStop(wikidataID: stop.wikidataId, photo: invalid)))
            accepted += 1
        }
        XCTAssertEqual(accepted, 2)
    }

    func testRejectsMismatchedWikidataEntityAndAmbiguousP18() async throws {
        for mode in ["identity", "ambiguous", "deprecated"] {
            let resolver = WikimediaCommonsPhotoResolver(session: fixtureSession())
            CommonsURLProtocol.handler = { _ in
                var payload = Self.wikidataFixture()
                var entities = payload["entities"] as! [String: Any]
                var entity = entities["Q42"] as! [String: Any]
                if mode == "identity" { entity["id"] = "Q64" }
                else {
                    var claims = entity["claims"] as! [String: Any]
                    var images = claims["P18"] as! [[String: Any]]
                    if mode == "ambiguous" { images.append(images[0]) }
                    else { images[0]["rank"] = "deprecated" }
                    claims["P18"] = images; entity["claims"] = claims
                }
                entities["Q42"] = entity; payload["entities"] = entities
                return Self.response(payload)
            }
            let photo = try await resolver.photo(for: fixtureStop(wikidataID: "Q42"))
            XCTAssertNil(photo, mode)
        }
    }

    private func fixtureSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CommonsURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    private func fixtureStop(id: String = "osm:node:7", name: String = "Example peak", wikidataID: String?, commonsFile: String? = nil, photo: DynamicResearchStop.Photo? = nil, latitude: Double = 48.1, longitude: Double = 11.5) -> DynamicResearchStop {
        DynamicResearchStop(id: id, name: name, category: "peak", wikidataId: wikidataID, commonsFile: commonsFile,
            coordinate: .init(latitude: latitude, longitude: longitude), source: .init(provider: "openstreetmap",
            url: URL(string: "https://www.openstreetmap.org/" + id.dropFirst(4).replacingOccurrences(of: ":", with: "/"))!, license: "ODbL-1.0",
            attribution: "© OpenStreetMap contributors", version: 1, updatedAt: "2026-09-15T00:00:00Z",
            retrievedAt: "2026-09-15T00:00:00Z", snapshotAt: "2026-09-15T00:00:00Z"), photo: photo)
    }

    private static func response(_ object: Any, statusCode: Int = 200) -> (HTTPURLResponse, Data) {
        let data = try! JSONSerialization.data(withJSONObject: object)
        return (HTTPURLResponse(url: URL(string: "https://fixture.invalid")!, statusCode: statusCode, httpVersion: nil, headerFields: nil)!, data)
    }

    private static func wikidataFixture(id: String = "Q42", file: String = "Example.jpg", latitude: Double = 48.1, longitude: Double = 11.5) -> [String: Any] {
        func claim(_ value: Any) -> [String: Any] { ["rank": "normal", "mainsnak": ["snaktype": "value", "datavalue": ["value": value]]] }
        return ["entities": [id: ["id": id, "type": "item", "claims": ["P18": [claim(file)], "P625": [claim(["latitude": latitude, "longitude": longitude, "globe": "http://www.wikidata.org/entity/Q2"])]]]]]
    }

    private static func commonsFixture(licence: String, licenceURL: String, author: String, title: String = "File:Example.jpg", fileName: String = "Example.jpg") -> [String: Any] {
        let metadata: [String: Any] = ["LicenseShortName": ["value": licence], "LicenseUrl": ["value": licenceURL], "Artist": ["value": author]]
        let info: [String: Any] = ["mime": "image/jpeg", "thumburl": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/\(fileName)/1280px-\(fileName)", "descriptionurl": "https://commons.wikimedia.org/wiki/File:\(fileName)", "extmetadata": metadata]
        return ["query": ["pages": ["7": ["title": title, "imageinfo": [info]]]]]
    }
}

private final class CommonsURLProtocol: URLProtocol {
    // URLProtocol invokes this fixture on its own callback context. XCTest installs
    // one handler per test and tearDown clears it, so this deliberately opt-outs of
    // strict global-state checking without changing production concurrency behavior.
    nonisolated(unsafe) static var handler: ((URLRequest) -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = Self.handler else { fatalError("Missing fixture") }
        let (response, data) = handler(request)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
