import XCTest
import UIKit
@testable import TrailMind

@MainActor
final class RouteCardStopPhotoTests: XCTestCase {
    override func setUp() {
        RouteCardImageURLProtocol.responseData = Data()
        RouteCardImageURLProtocol.requestCount = 0
        RouteCardImageURLProtocol.headers = ["Content-Type": "image/png"]
        RouteCardImageURLProtocol.status = 200
        RouteCardImageURLProtocol.failure = nil
    }

    func testOversizedAndWrongTypeResponsesKeepMapFallback() async {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RouteCardImageURLProtocol.self]
        for headers in [
            ["Content-Type": "image/png", "Content-Length": "5000001"],
            ["Content-Type": "text/html"]
        ] {
            RouteCardImageURLProtocol.headers = headers
            RouteCardImageURLProtocol.responseData = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).pngData { _ in }
            let service = RouteCardStopPhotoService(session: URLSession(configuration: config))
            let result = await service.load(stops: [stop(id: "osm:node:7", latitude: 53.2, longitude: 10.4)])
            XCTAssertNil(result)
        }
    }

    func testOfflineAndHTTPFailureKeepMapFallbackAndAreRetried() async {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RouteCardImageURLProtocol.self]
        let service = RouteCardStopPhotoService(session: URLSession(configuration: config))
        let stops = [stop(id: "osm:node:7", latitude: 53.2, longitude: 10.4)]
        RouteCardImageURLProtocol.failure = URLError(.notConnectedToInternet)
        let offline = await service.load(stops: stops)
        XCTAssertNil(offline)
        RouteCardImageURLProtocol.failure = nil
        RouteCardImageURLProtocol.status = 503
        let serverFailure = await service.load(stops: stops)
        XCTAssertNil(serverFailure)
        RouteCardImageURLProtocol.status = 200
        RouteCardImageURLProtocol.responseData = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).pngData { _ in }
        let retry = await service.load(stops: stops)
        XCTAssertNotNil(retry)
        XCTAssertEqual(RouteCardImageURLProtocol.requestCount, 3)
    }

    func testOnlyValidatedStopsOnAcceptedGeometryCanSupplyCardPhoto() throws {
        var route = TestRouteFixtures.luneburgLoop
        let point = try XCTUnwrap(route.path.first)
        let accepted = stop(id: "osm:node:7", latitude: point.latitude, longitude: point.longitude)
        let distant = stop(id: "osm:node:8", latitude: -33.86, longitude: 151.21)
        let badPhoto = DynamicResearchStop.Photo(
            url: accepted.photo!.url, sourceURL: accepted.photo!.sourceURL,
            license: accepted.photo!.license, licenseURL: accepted.photo!.licenseURL,
            credit: "", placeSourceURL: accepted.photo!.placeSourceURL
        )
        let corrupt = stop(id: "osm:node:9", latitude: point.latitude, longitude: point.longitude, photo: badPhoto)
        route.dynamicResearchStops = [distant, corrupt, accepted]

        XCTAssertEqual(RouteCardPhotoEligibility.stops(on: route).map(\.id), [accepted.id])
        route.dynamicResearchStops = []
        XCTAssertTrue(RouteCardPhotoEligibility.stops(on: route).isEmpty)
    }

    func testSparseSegmentMidpointIsAcceptedButAnOffRouteStopIsNot() {
        let path = [GeoPoint(latitude: 0, longitude: 0), GeoPoint(latitude: 0, longitude: 0.02)]
        XCTAssertTrue(RouteCardPhotoEligibility.isOnRoute(
            .init(latitude: 0, longitude: 0.01), path: path
        ))
        XCTAssertFalse(RouteCardPhotoEligibility.isOnRoute(
            .init(latitude: 0.002, longitude: 0.01), path: path
        ))
    }

    func testSparseSegmentAcrossDateLineAndAtHighLatitude() {
        let dateLine = [GeoPoint(latitude: 0, longitude: 179.99), GeoPoint(latitude: 0, longitude: -179.99)]
        XCTAssertTrue(RouteCardPhotoEligibility.isOnRoute(
            .init(latitude: 0, longitude: 180), path: dateLine
        ))
        XCTAssertFalse(RouteCardPhotoEligibility.isOnRoute(
            .init(latitude: 0.002, longitude: 180), path: dateLine
        ))

        let highLatitude = [GeoPoint(latitude: 80, longitude: 0), GeoPoint(latitude: 80, longitude: 0.02)]
        XCTAssertTrue(RouteCardPhotoEligibility.isOnRoute(
            .init(latitude: 80, longitude: 0.01), path: highLatitude
        ))
        XCTAssertFalse(RouteCardPhotoEligibility.isOnRoute(
            .init(latitude: 80.002, longitude: 0.01), path: highLatitude
        ))
    }

    func testOneValidatedThumbnailIsDecodedAndCachedAcrossCards() async throws {
        let protocolClass = RouteCardImageURLProtocol.self
        protocolClass.responseData = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).pngData { context in
            UIColor.systemGreen.setFill()
            context.cgContext.fill(CGRect(x: 0, y: 0, width: 20, height: 20))
        }
        protocolClass.requestCount = 0
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [protocolClass]
        let service = RouteCardStopPhotoService(session: URLSession(configuration: config))
        let first = stop(id: "osm:node:7", latitude: 53.2, longitude: 10.4)
        let second = stop(id: "osm:node:8", latitude: 53.2, longitude: 10.4)

        let firstImage = await service.load(stops: [first])
        let secondImage = await service.load(stops: [second])
        XCTAssertEqual(firstImage?.stopName, first.name)
        XCTAssertEqual(secondImage?.stopName, second.name)
        XCTAssertEqual(protocolClass.requestCount, 1)
    }

    func testInvalidImageBytesLeaveMapFallback() async {
        RouteCardImageURLProtocol.responseData = Data("invalid image".utf8)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RouteCardImageURLProtocol.self]
        let service = RouteCardStopPhotoService(session: URLSession(configuration: config))

        let result = await service.load(stops: [stop(id: "osm:node:7", latitude: 53.2, longitude: 10.4)])
        XCTAssertNil(result)
    }

    private func stop(id: String, latitude: Double, longitude: Double, photo: DynamicResearchStop.Photo? = nil) -> DynamicResearchStop {
        let sourceURL = URL(string: "https://www.openstreetmap.org/" + id.dropFirst(4).replacingOccurrences(of: ":", with: "/"))!
        return DynamicResearchStop(
            id: id, name: "Synthetic accepted stop", category: "peak", wikidataId: "Q42",
            coordinate: .init(latitude: latitude, longitude: longitude),
            source: .init(provider: "openstreetmap", url: sourceURL, license: "ODbL-1.0",
                attribution: "© OpenStreetMap contributors", version: 1,
                updatedAt: "2026-09-29T00:00:00Z", retrievedAt: "2026-09-29T00:00:00Z",
                snapshotAt: "2026-09-29T00:00:00Z"),
            photo: photo ?? .init(
                url: URL(string: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Example.jpg/480px-Example.jpg")!,
                sourceURL: URL(string: "https://commons.wikimedia.org/wiki/File:Example.jpg")!,
                license: "CC BY 4.0",
                licenseURL: URL(string: "https://creativecommons.org/licenses/by/4.0/")!,
                credit: "Synthetic fixture author",
                placeSourceURL: URL(string: "https://www.wikidata.org/wiki/Q42")!
            )
        )
    }
}

private final class RouteCardImageURLProtocol: URLProtocol {
    nonisolated(unsafe) static var responseData = Data()
    nonisolated(unsafe) static var requestCount = 0
    nonisolated(unsafe) static var headers = ["Content-Type": "image/png"]
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var failure: URLError?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requestCount += 1
        if let failure = Self.failure { client?.urlProtocol(self, didFailWithError: failure); return }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil,
            headerFields: Self.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseData)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
