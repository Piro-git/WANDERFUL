#if DEBUG && targetEnvironment(simulator)
import SwiftUI
import UIKit

/// Explicit offline UI fixture. The image is a labeled test pattern, never a place photograph.
struct RouteCardPhotoUITestView: View {
    private let suggestion: RouteSuggestion
    private let service: RouteCardStopPhotoService

    init(route: TrailRoute) {
        let args = ProcessInfo.processInfo.arguments
        var route = route
        let original = route.dynamicResearchStops[0]
        let point = route.path[0]
        let name = "Synthetic stop · offline image fixture"
        route.dynamicWebResearch = nil
        route.dynamicResearchStops = [DynamicResearchStop(id: original.id, name: name,
            category: original.category, wikidataId: nil, commonsFile: "Synthetic_UI_fixture.png",
            coordinate: .init(latitude: point.latitude, longitude: point.longitude), source: original.source,
            photo: .init(url: URL(string: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Synthetic_UI_fixture.png/480px-Synthetic_UI_fixture.png")!,
                sourceURL: URL(string: "https://commons.wikimedia.org/wiki/File:Synthetic_UI_fixture.png")!,
                license: "CC BY 4.0", licenseURL: URL(string: "https://creativecommons.org/licenses/by/4.0/")!,
                credit: args.contains("--card-photo-invalid") ? "" : "Synthetic fixture author — no real photograph",
                placeSourceURL: original.source.url))]
        if args.contains("--card-photo-none") { route.dynamicResearchStops = [] }
        suggestion = RouteSuggestion(route: route, explanation: "Closest Match")
        CardPhotoFixtureProtocol.imageData = UIGraphicsImageRenderer(size: CGSize(width: 480, height: 320)).pngData { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 480, height: 320))
            UIColor.systemYellow.setFill()
            context.fill(CGRect(x: 0, y: 180, width: 480, height: 140))
            ("SYNTHETIC\nUI FIXTURE" as NSString).draw(in: CGRect(x: 30, y: 75, width: 420, height: 170),
                withAttributes: [.font: UIFont.boldSystemFont(ofSize: 40), .foregroundColor: UIColor.black])
        }
        URLProtocol.registerClass(CardPhotoFixtureProtocol.self)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CardPhotoFixtureProtocol.self]
        service = RouteCardStopPhotoService(session: URLSession(configuration: configuration))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                RouteSuggestionCardRow(suggestion: suggestion, researchPresentation: nil, photoService: service)
                    .padding(20)
            }
            .navigationTitle("Offline card fixture")
        }
    }
}

private nonisolated final class CardPhotoFixtureProtocol: URLProtocol {
    nonisolated(unsafe) static var imageData = Data()
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "upload.wikimedia.org" &&
            request.url?.lastPathComponent.contains("Synthetic_UI_fixture.png") == true
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let args = ProcessInfo.processInfo.arguments
        // Intentionally pending until cancellation; exercises navigation during a slow request.
        if args.contains("--card-photo-slow") { return }
        if args.contains("--card-photo-offline") {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let body = args.contains("--card-photo-corrupt") ? Data("not an image".utf8) : Self.imageData
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
            headerFields: ["Content-Type": "image/png"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif
