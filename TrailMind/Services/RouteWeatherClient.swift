import Foundation
import CryptoKit

protocol RouteWeatherProviding {
    func forecast(route: TrailRoute, start: Date) async throws -> RouteWeather
}

struct RouteWeatherClient: RouteWeatherProviding {
    private let baseURL: URL?
    private let session: URLSession
    private let authorizer: any RouteSessionAuthorizing
    init(baseURL: URL? = TrailMindBackendConfiguration.baseURL(), session: URLSession = .shared,
         authorizer: (any RouteSessionAuthorizing)? = nil) {
        self.baseURL = baseURL
        self.session = session
        self.authorizer = authorizer ?? TrailMindBackendSecurity.makeSessionAuthorizer(baseURL: baseURL)
    }
    func forecast(route: TrailRoute, start: Date) async throws -> RouteWeather {
        guard let baseURL, route.path.count >= 2, route.path.count <= 20_000,
              route.durationHours.isFinite, route.durationHours > 0 else { throw CocoaError(.featureUnsupported) }
        let geometry = try JSONSerialization.data(withJSONObject: route.path.map { [$0.longitude, $0.latitude] })
        guard geometry.count <= 500_000, let geometryJSON = String(data: geometry, encoding: .utf8) else { throw CocoaError(.featureUnsupported) }
        let digest = SHA256.hash(data: geometry).map { String(format: "%02x", $0) }.joined()
        let body = try JSONSerialization.data(withJSONObject: ["version": 1, "geometryJSON": geometryJSON,
            "durationHours": route.durationHours, "plannedStartAt": ISO8601DateFormatter().string(from: start)])
        for attempt in 0...1 {
            try Task.checkCancellation()
            let authorization = try await authorizer.authorization(cost: 1)
            var request = URLRequest(url: baseURL.appendingPathComponent("api/route-weather"))
            request.httpMethod = "POST"; request.httpBody = body; request.timeoutInterval = 20
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("TrailMindRouteSession \(authorization.token)", forHTTPHeaderField: "Authorization")
            request.setValue(authorization.requestID.uuidString, forHTTPHeaderField: "X-TrailMind-Request-ID")
            let (data, response) = try await BoundedRouteHTTPTransport(session: session, limits: RouteTransportLimits(
                maximumSuccessBodyBytes: 16_384, maximumErrorBodyBytes: 2048, maximumPaths: 1,
                maximumCoordinatesPerPath: 1, maximumInstructionsPerPath: 1, maximumPathDetailsPerPath: 1,
                maximumAbsoluteElevationMeters: 1), rejectsRedirects: true).data(for: request)
            try Task.checkCancellation()
            guard let http = response as? HTTPURLResponse else { throw CocoaError(.coderReadCorrupt) }
            if http.statusCode == 401 {
                await authorizer.invalidate(token: authorization.token)
                let error = try? JSONDecoder().decode(SessionError.self, from: data)
                if attempt == 0, error?.error.code == "route_session_expired" { continue }
            }
            guard http.statusCode == 200 else { throw CocoaError(.featureUnsupported) }
            let forecast = try JSONDecoder().decode(RouteWeather.self, from: data)
            try forecast.validate(digest: digest, start: start, duration: route.durationHours)
            return forecast
        }
        throw CocoaError(.featureUnsupported)
    }
    private struct SessionError: Decodable { struct Detail: Decodable { let code: String }; let error: Detail }
}
