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
    static let sessionAuthorizer: any RouteSessionAuthorizing = RouteSessionService(
        opener: appAttestService
    )
}

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
