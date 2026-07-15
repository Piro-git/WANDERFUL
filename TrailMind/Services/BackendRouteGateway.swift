import Foundation

protocol BackendRouteGatewayRouting: Sendable {
    func route(_ request: BackendRouteRequest) async throws -> Data
}

struct BackendRouteRequest: Encodable, Sendable {
    struct Point: Encodable, Sendable {
        let latitude: Double
        let longitude: Double

        init(_ coordinate: Coordinate) {
            latitude = coordinate.latitude
            longitude = coordinate.longitude
        }
    }

    struct RoundTrip: Encodable, Sendable {
        let distanceMeters: Double
        let seed: Int
    }

    struct AlternativeRoute: Encodable, Sendable {
        let maxPaths: Int
        let maxWeightFactor: Double
        let maxShareFactor: Double
    }

    struct Preferences: Encodable, Sendable {
        let activityType: String
        let avoid: [String]
        let difficulty: String?
    }

    let profile: String
    let routeType: String
    let points: [Point]
    let algorithm: String?
    let roundTrip: RoundTrip?
    let alternativeRoute: AlternativeRoute?
    let locale: String
    let includeElevation: Bool
    let includeInstructions: Bool
    let includePathDetails: [String]
    let preferences: Preferences?

    var weightedCost: Int {
        if algorithm == "alternative_route" {
            return alternativeRoute?.maxPaths ?? 1
        }
        if routeType == "loop" || preferences != nil { return 2 }
        return 1
    }
}

struct BackendRouteGateway: BackendRouteGatewayRouting, Sendable {
    private let baseURL: URL?
    private let session: URLSession
    private let authorizer: any RouteSessionAuthorizing

    init(
        baseURL: URL? = TrailMindBackendConfiguration.baseURL(),
        session: URLSession = .shared,
        authorizer: (any RouteSessionAuthorizing)? = nil
    ) {
        self.baseURL = baseURL
        self.session = session
        self.authorizer = authorizer ?? TrailMindBackendSecurity.makeSessionAuthorizer(baseURL: baseURL)
    }

    func route(_ routeRequest: BackendRouteRequest) async throws -> Data {
        do {
            return try await perform(routeRequest, mayRefresh: true)
        } catch BackendRouteGatewayError.refreshSession {
            return try await perform(routeRequest, mayRefresh: false)
        }
    }

    private func perform(_ routeRequest: BackendRouteRequest, mayRefresh: Bool) async throws -> Data {
        guard let baseURL, let endpoint = URL(string: "api/route", relativeTo: baseURL)?.absoluteURL else {
            throw AppAttestServiceError.networkUnavailable
        }
        let authorization = try await authorizer.authorization(cost: routeRequest.weightedCost)
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            "TrailMindRouteSession \(authorization.token)",
            forHTTPHeaderField: "Authorization"
        )
        request.setValue(authorization.requestID.uuidString, forHTTPHeaderField: "X-TrailMind-Request-ID")
        request.httpBody = try JSONEncoder().encode(routeRequest)

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw GraphHopperError.invalidResponse
            }
            guard (200..<300).contains(httpResponse.statusCode) else {
                let envelope = try? JSONDecoder().decode(BackendRouteErrorEnvelope.self, from: data)
                let code = envelope?.error.code
                if mayRefresh, Self.isRefreshableSessionError(code) {
                    await authorizer.invalidate(token: authorization.token)
                    throw BackendRouteGatewayError.refreshSession
                }
                throw Self.mapError(
                    statusCode: httpResponse.statusCode,
                    code: code,
                    message: envelope?.error.message
                )
            }
            return data
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as BackendRouteGatewayError {
            throw error
        } catch let error as GraphHopperError {
            throw error
        } catch let error as AppAttestServiceError {
            throw error
        } catch let error as URLError {
            if error.code == .cancelled, Task.isCancelled { throw CancellationError() }
            throw GraphHopperError.network(message: "TrailMind’s routing service could not be reached.")
        } catch {
            throw GraphHopperError.network(message: "TrailMind’s routing service could not be reached.")
        }
    }

    private nonisolated static func isRefreshableSessionError(_ code: String?) -> Bool {
        code == "route_session_expired" || code == "route_session_exhausted" ||
            code == "route_session_invalid"
    }

    private nonisolated static func mapError(
        statusCode: Int,
        code: String?,
        message: String?
    ) -> Error {
        switch code {
        case "route_not_found":
            return GraphHopperError.noRouteFound
        case "flexible_mode_unavailable":
            return GraphHopperError.api(
                statusCode: statusCode,
                message: "GraphHopper flexible mode is unavailable.",
                hints: []
            )
        case "route_session_expired", "route_session_exhausted", "route_session_invalid",
             "app_attest_invalid", "app_attest_environment_mismatch", "app_attest_counter_replayed",
             "app_attest_not_registered", "authorization_unavailable", "request_replayed":
            return AppAttestServiceError.verificationFailed
        case "route_timed_out":
            return GraphHopperError.network(message: "The route calculation timed out.")
        default:
            return GraphHopperError.api(
                statusCode: statusCode,
                message: message ?? "TrailMind’s routing service rejected the request.",
                hints: []
            )
        }
    }
}

private enum BackendRouteGatewayError: Error {
    case refreshSession
}

private struct BackendRouteErrorEnvelope: Decodable {
    let error: BackendRouteErrorBody
}

private struct BackendRouteErrorBody: Decodable {
    let code: String
    let message: String
}
