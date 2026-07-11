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
    private var refreshTask: Task<RouteSession, Error>?

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

        let task: Task<RouteSession, Error>
        if let refreshTask {
            task = refreshTask
        } else {
            let newTask = Task { try await opener.openRouteSession() }
            refreshTask = newTask
            task = newTask
        }

        do {
            let session = try await task.value
            refreshTask = nil
            try Task.checkCancellation()
            guard session.remainingCost >= cost, session.expiresAt > now().addingTimeInterval(refreshLeeway) else {
                throw AppAttestServiceError.invalidResponse
            }
            cachedSession = RouteSession(
                token: session.token,
                expiresAt: session.expiresAt,
                remainingCost: session.remainingCost - cost
            )
            return RouteSessionAuthorization(token: session.token, requestID: UUID())
        } catch {
            refreshTask = nil
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
}
