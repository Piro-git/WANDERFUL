import Foundation

protocol OutdoorAdventurePlanningClientV1: Sendable {
    func plan(
        _ request: OutdoorAdventurePlanningRequestV1
    ) async throws -> OutdoorAdventurePlanningResultV1
}

struct OutdoorAdventurePlanningTransportLimitsV1: Equatable, Sendable {
    static let standard = OutdoorAdventurePlanningTransportLimitsV1(
        maximumRequestBodyBytes: 64 * 1_024,
        maximumSuccessBodyBytes: 9 * 1_024 * 1_024,
        maximumErrorBodyBytes: 64 * 1_024
    )

    let maximumRequestBodyBytes: Int
    let maximumSuccessBodyBytes: Int
    let maximumErrorBodyBytes: Int

    fileprivate var routeTransportLimits: RouteTransportLimits {
        let standard = RouteTransportLimits.standard
        return RouteTransportLimits(
            maximumSuccessBodyBytes: maximumSuccessBodyBytes,
            maximumErrorBodyBytes: maximumErrorBodyBytes,
            maximumPaths: standard.maximumPaths,
            maximumCoordinatesPerPath: standard.maximumCoordinatesPerPath,
            maximumInstructionsPerPath: standard.maximumInstructionsPerPath,
            maximumPathDetailsPerPath: standard.maximumPathDetailsPerPath,
            maximumAbsoluteElevationMeters:
                standard.maximumAbsoluteElevationMeters
        )
    }
}

struct BackendOutdoorAdventurePlanningClientV1:
    OutdoorAdventurePlanningClientV1,
    Sendable
{
    private static let authorizationCost = 12
    private static let requestTimeout: TimeInterval = 30

    private let baseURL: URL?
    private let session: URLSession
    private let authorizer: any RouteSessionAuthorizing
    private let limits: OutdoorAdventurePlanningTransportLimitsV1
    private let adapter: ResearchGuidedRoutingContractAdapterV1
    private let adapterV2: ResearchGuidedRoutingContractAdapterV2
    private let usesRoutableHighlightAccessV2: Bool
    private let responseValidationDidFinish:
        @Sendable (Duration) -> Void

    init(
        baseURL: URL? = TrailMindBackendConfiguration.baseURL(),
        session: URLSession = .shared,
        authorizer: (any RouteSessionAuthorizing)? = nil,
        limits: OutdoorAdventurePlanningTransportLimitsV1 = .standard,
        adapter: ResearchGuidedRoutingContractAdapterV1? = nil,
        adapterV2: ResearchGuidedRoutingContractAdapterV2? = nil,
        usesRoutableHighlightAccessV2: Bool = false,
        responseValidationDidFinish:
            @escaping @Sendable (Duration) -> Void = { _ in }
    ) {
        self.baseURL = baseURL
        self.session = session
        self.authorizer = authorizer ??
            TrailMindBackendSecurity.makeSessionAuthorizer(baseURL: baseURL)
        self.limits = limits
        self.adapter = adapter ?? ResearchGuidedRoutingContractAdapterV1(
            limits: limits.routeTransportLimits
        )
        self.adapterV2 = adapterV2 ?? ResearchGuidedRoutingContractAdapterV2(
            limits: limits.routeTransportLimits
        )
        self.usesRoutableHighlightAccessV2 = usesRoutableHighlightAccessV2
        self.responseValidationDidFinish =
            responseValidationDidFinish
    }

    func plan(
        _ request: OutdoorAdventurePlanningRequestV1
    ) async throws -> OutdoorAdventurePlanningResultV1 {
        try Task.checkCancellation()
        guard let baseURL,
              let endpoint = URL(
                string: "api/outdoor-research/plan-route",
                relativeTo: baseURL
              )?.absoluteURL
        else {
            throw OutdoorAdventurePlanningClientFailure.unavailable
        }

        let body: Data
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            if usesRoutableHighlightAccessV2 {
                body = try encoder.encode(
                    OutdoorAdventurePlanningRequestV2(intent: request.intent)
                )
            } else {
                body = try encoder.encode(request)
            }
        } catch {
            throw OutdoorAdventurePlanningClientFailure.invalidRequest
        }
        guard body.count <= limits.maximumRequestBodyBytes else {
            throw OutdoorAdventurePlanningClientFailure.requestTooLarge
        }

        do {
            return try await perform(
                body: body,
                endpoint: endpoint,
                mayRefresh: true
            )
        } catch OutdoorAdventurePlanningInternalFailureV1.refreshSession {
            return try await perform(
                body: body,
                endpoint: endpoint,
                mayRefresh: false
            )
        }
    }

    private func perform(
        body: Data,
        endpoint: URL,
        mayRefresh: Bool
    ) async throws -> OutdoorAdventurePlanningResultV1 {
        try Task.checkCancellation()
        let authorization: RouteSessionAuthorization
        do {
            authorization = try await authorizer.authorization(
                cost: Self.authorizationCost
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as AppAttestServiceError {
            if error == .networkUnavailable {
                throw OutdoorAdventurePlanningClientFailure.unavailable
            }
            throw OutdoorAdventurePlanningClientFailure.authorizationFailed
        } catch {
            throw OutdoorAdventurePlanningClientFailure.authorizationFailed
        }
        try Task.checkCancellation()

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = Self.requestTimeout
        request.setValue(
            "application/json",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue(
            "application/json",
            forHTTPHeaderField: "Accept"
        )
        request.setValue(
            "TrailMindRouteSession \(authorization.token)",
            forHTTPHeaderField: "Authorization"
        )
        request.setValue(
            authorization.requestID.uuidString,
            forHTTPHeaderField: "X-TrailMind-Request-ID"
        )
        request.httpBody = body

        do {
            let transport = BoundedRouteHTTPTransport(
                session: session,
                limits: limits.routeTransportLimits
            )
            let (data, response) = try await transport.data(for: request)
            guard let response = response as? HTTPURLResponse else {
                throw OutdoorAdventurePlanningClientFailure.invalidResponse
            }
            guard (200..<300).contains(response.statusCode) else {
                let code = try? JSONDecoder().decode(
                    OutdoorAdventurePlanningErrorEnvelopeV1.self,
                    from: data
                ).error.code
                if mayRefresh, Self.isRefreshableSessionError(code) {
                    await authorizer.invalidate(token: authorization.token)
                    throw OutdoorAdventurePlanningInternalFailureV1.refreshSession
                }
                throw Self.failure(
                    statusCode: response.statusCode,
                    code: code
                )
            }
            try Task.checkCancellation()
            if usesRoutableHighlightAccessV2 {
                return try OutdoorAdventurePlanningResponseValidatorV1
                    .validateV2(
                        data,
                        adapter: adapterV2,
                        validationDidFinish: responseValidationDidFinish
                    )
            }
            return try OutdoorAdventurePlanningResponseValidatorV1.validate(
                data,
                adapter: adapter,
                validationDidFinish: responseValidationDidFinish
            )
        } catch is CancellationError {
            throw CancellationError()
        } catch RouteTransportValidationError.responseTooLarge {
            throw OutdoorAdventurePlanningClientFailure.responseTooLarge
        } catch let failure as OutdoorAdventurePlanningInternalFailureV1 {
            throw failure
        } catch let failure as OutdoorAdventurePlanningClientFailure {
            throw failure
        } catch let error as URLError {
            if error.code == .cancelled, Task.isCancelled {
                throw CancellationError()
            }
            if error.code == .timedOut {
                throw OutdoorAdventurePlanningClientFailure.timedOut
            }
            throw OutdoorAdventurePlanningClientFailure.unavailable
        } catch {
            throw OutdoorAdventurePlanningClientFailure.invalidResponse
        }
    }

    private nonisolated static func isRefreshableSessionError(
        _ code: String?
    ) -> Bool {
        code == "route_session_expired" ||
            code == "route_session_exhausted" ||
            code == "route_session_invalid"
    }

    private nonisolated static func failure(
        statusCode: Int,
        code: String?
    ) -> OutdoorAdventurePlanningClientFailure {
        switch code {
        case "authorization_failed",
             "route_session_expired",
             "route_session_exhausted",
             "route_session_invalid":
            .authorizationFailed
        case "rate_limited":
            .rateLimited
        case "timed_out":
            .timedOut
        case "invalid_request", "unsupported":
            .rejected
        case "response_too_large":
            .responseTooLarge
        case "internal_failure":
            .unavailable
        case "feature_unavailable",
             "authorization_unavailable",
             "research_unavailable",
             "routing_unavailable":
            .unavailable
        default:
            statusCode == 429
                ? .rateLimited
                : statusCode >= 400 && statusCode < 500
                    ? .rejected
                    : .unavailable
        }
    }
}

struct NoOpOutdoorAdventurePlanningClientV1:
    OutdoorAdventurePlanningClientV1,
    Sendable
{
    func plan(
        _ request: OutdoorAdventurePlanningRequestV1
    ) async throws -> OutdoorAdventurePlanningResultV1 {
        try Task.checkCancellation()
        return .unsupported(
            OutdoorAdventurePlanningNonRoutedStateV1(
                state: .unsupported,
                normalizedIntent: request.intent,
                planningGaps: [],
                clarificationQuestions: []
            )
        )
    }
}

enum OutdoorAdventurePlanningClientFactory {
    static func makeDefault(
        configuration: WanderfulAppConfiguration? =
            WanderfulAppConfigurationSnapshot.configuration,
        session: URLSession = .shared,
        authorizer: (any RouteSessionAuthorizing)? = nil,
        limits: OutdoorAdventurePlanningTransportLimitsV1 = .standard
    ) -> any OutdoorAdventurePlanningClientV1 {
        guard let configuration,
              configuration.features.researchGuidedPlanning,
              let baseURL = configuration.backend.configuredValue?.baseURL
        else {
            return NoOpOutdoorAdventurePlanningClientV1()
        }
        return BackendOutdoorAdventurePlanningClientV1(
            baseURL: baseURL,
            session: session,
            authorizer: authorizer,
            limits: limits,
            usesRoutableHighlightAccessV2:
                configuration.features.routableHighlightAccess
        )
    }

    static func makeDefault(
        bundle: Bundle,
        session: URLSession = .shared,
        authorizer: (any RouteSessionAuthorizing)? = nil,
        limits: OutdoorAdventurePlanningTransportLimitsV1 = .standard
    ) -> any OutdoorAdventurePlanningClientV1 {
        let configuration = try? WanderfulAppConfiguration.resolve(
            infoDictionary: bundle.infoDictionary ?? [:],
            signedIdentity: WanderfulSignedLaneIdentity.value
        )
        return makeDefault(
            configuration: configuration,
            session: session,
            authorizer: authorizer,
            limits: limits
        )
    }
}

private enum OutdoorAdventurePlanningInternalFailureV1: Error {
    case refreshSession
}

private struct OutdoorAdventurePlanningErrorEnvelopeV1: Decodable {
    struct Body: Decodable {
        let code: String
    }

    let error: Body
}
