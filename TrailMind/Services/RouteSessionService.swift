import Foundation

struct RouteSession: Sendable, Equatable {
    let token: String
    let expiresAt: Date
    let remainingCost: Int
}

struct RouteSessionAuthorization: Sendable, Equatable {
    let token: String
    let requestID: UUID
}

protocol RouteSessionOpening: Sendable {
    func openRouteSession() async throws -> RouteSession
}

protocol RouteSessionAuthorizing: Sendable {
    func authorization(cost: Int) async throws -> RouteSessionAuthorization
    func invalidate(token: String) async
}

enum TrailMindBackendSecurity {
    static let appAttestService = AppAttestService()
    static let attestedSessionAuthorizer: any RouteSessionAuthorizing = RouteSessionService(
        opener: appAttestService
    )

    static func makeSessionAuthorizer(
        baseURL: URL?,
        allowsInsecureLoopback: Bool = TrailMindBackendConfiguration
            .insecureLocalBackendAuthorizationEnabled(),
        attestedSessionAuthorizer: any RouteSessionAuthorizing = TrailMindBackendSecurity.attestedSessionAuthorizer
    ) -> any RouteSessionAuthorizing {
        #if DEBUG && targetEnvironment(simulator)
        if allowsInsecureLoopback,
           LoopbackDevelopmentSessionAuthorizer.supports(baseURL: baseURL) {
            return LoopbackDevelopmentSessionAuthorizer()
        }
        #endif
        return attestedSessionAuthorizer
    }
}

#if DEBUG && targetEnvironment(simulator)
/// Supplies a non-secret placeholder only to an explicitly insecure backend on this Mac.
/// Release and physical-device builds do not contain this type.
struct LoopbackDevelopmentSessionAuthorizer: RouteSessionAuthorizing {
    static let placeholderToken = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

    static func supports(baseURL: URL?) -> Bool {
        guard
            let baseURL,
            baseURL.scheme?.lowercased() == "http",
            let host = baseURL.host?.lowercased(),
            ["127.0.0.1", "localhost", "::1"].contains(host)
        else {
            return false
        }
        return true
    }

    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        guard cost > 0 else { throw AppAttestServiceError.invalidResponse }
        return RouteSessionAuthorization(token: Self.placeholderToken, requestID: UUID())
    }

    func invalidate(token: String) async {}
}
#endif

actor RouteSessionService: RouteSessionAuthorizing {
    private let opener: any RouteSessionOpening
    private let now: @Sendable () -> Date
    private let refreshLeeway: TimeInterval
    private var cachedSession: RouteSession?
    private var refreshTask: (id: UUID, task: Task<RouteSession, Error>)?

    init(
        opener: any RouteSessionOpening,
        now: @escaping @Sendable () -> Date = Date.init,
        refreshLeeway: TimeInterval = 10
    ) {
        self.opener = opener
        self.now = now
        self.refreshLeeway = refreshLeeway
    }

    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        guard cost > 0 else { throw AppAttestServiceError.invalidResponse }
        try Task.checkCancellation()
        if let session = usableSession(cost: cost) {
            cachedSession = RouteSession(
                token: session.token,
                expiresAt: session.expiresAt,
                remainingCost: session.remainingCost - cost
            )
            return RouteSessionAuthorization(token: session.token, requestID: UUID())
        }

        let refresh: (id: UUID, task: Task<RouteSession, Error>)
        if let refreshTask {
            refresh = refreshTask
        } else {
            let newTask = Task { try await opener.openRouteSession() }
            let newRefresh = (id: UUID(), task: newTask)
            refreshTask = newRefresh
            refresh = newRefresh
        }

        do {
            let openedSession = try await refresh.task.value
            clearRefreshTask(ifMatching: refresh.id)
            try Task.checkCancellation()
            let minimumExpiry = now().addingTimeInterval(refreshLeeway)
            guard openedSession.remainingCost >= cost, openedSession.expiresAt > minimumExpiry else {
                throw AppAttestServiceError.invalidResponse
            }
            let session: RouteSession
            if let cachedSession, cachedSession.token == openedSession.token {
                if cachedSession.remainingCost < cost {
                    return try await authorization(cost: cost)
                }
                session = cachedSession
            } else {
                session = openedSession
            }
            guard session.expiresAt > minimumExpiry else {
                throw AppAttestServiceError.invalidResponse
            }
            cachedSession = RouteSession(
                token: session.token,
                expiresAt: session.expiresAt,
                remainingCost: session.remainingCost - cost
            )
            return RouteSessionAuthorization(token: session.token, requestID: UUID())
        } catch {
            clearRefreshTask(ifMatching: refresh.id)
            throw error
        }
    }

    func invalidate(token: String) {
        guard cachedSession?.token == token else { return }
        cachedSession = nil
    }

    private func usableSession(cost: Int) -> RouteSession? {
        guard
            let cachedSession,
            cachedSession.remainingCost >= cost,
            cachedSession.expiresAt > now().addingTimeInterval(refreshLeeway)
        else {
            return nil
        }
        return cachedSession
    }

    private func clearRefreshTask(ifMatching id: UUID) {
        guard refreshTask?.id == id else { return }
        refreshTask = nil
    }
}
