import Foundation

/// Uses the existing bounded transport and route session. No automatic requests/retries.
struct PreparationPersonalizationClient {
    private let baseURL: URL?
    private let session: URLSession
    private let authorizer: any RouteSessionAuthorizing
    init(baseURL: URL? = TrailMindBackendConfiguration.baseURL(), session: URLSession = .shared,
         authorizer: (any RouteSessionAuthorizing)? = nil) {
        self.baseURL = baseURL
        self.session = session
        self.authorizer = authorizer ?? TrailMindBackendSecurity.makeSessionAuthorizer(baseURL: baseURL)
    }
    func suggestions(input: PreparationInput, stay: PreparationStay) async throws -> PreparationEnrichment {
        guard input.isHiking, let baseURL,
              let url = URL(string: "api/preparation", relativeTo: baseURL)?.absoluteURL else {
            throw CocoaError(.featureUnsupported)
        }
        let body = PreparationEnrichment(version: 1, stay: stay, distanceKM: input.distanceKM,
                                         durationHours: input.durationHours, additions: [], checks: [])
        try body.validate()
        let authorization = try await authorizer.authorization(cost: 1)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("TrailMindRouteSession \(authorization.token)", forHTTPHeaderField: "Authorization")
        request.setValue(authorization.requestID.uuidString, forHTTPHeaderField: "X-TrailMind-Request-ID")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await BoundedRouteHTTPTransport(session: session, limits: RouteTransportLimits(
            maximumSuccessBodyBytes: 8192, maximumErrorBodyBytes: 2048,
            maximumPaths: 1, maximumCoordinatesPerPath: 1, maximumInstructionsPerPath: 1,
            maximumPathDetailsPerPath: 1, maximumAbsoluteElevationMeters: 1)).data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            if (response as? HTTPURLResponse)?.statusCode == 401 {
                await authorizer.invalidate(token: authorization.token)
            }
            throw CocoaError(.featureUnsupported)
        }
        return try PreparationEnrichment.decode(data, input: input, stay: stay)
    }
}
