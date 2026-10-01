#if DEBUG && WANDERFUL_OWNER_PHONE_TEST
import Foundation

/// Explicit owner-only Debug build. Not compiled into ordinary Debug, Staging or Release.
/// The temporary credential authorizes bounded test requests; it is never a provider key.
nonisolated struct OwnerPhoneTestConfiguration: Decodable, Sendable {
    let baseURL: URL
    let token: String
    let expiresAt: Double

    static func allowsIdentity(environment: String?, bundleIdentifier: String?) -> Bool {
        environment == "local" &&
            (bundleIdentifier == "com.trailmind.app.local" ||
             bundleIdentifier == "com.piroscheibe.wanderful.local")
    }

    static func load(bundle: Bundle = .main, now: Date = .now) -> Self? {
        guard allowsIdentity(
                environment: bundle.object(forInfoDictionaryKey: "TRAILMIND_APP_ENVIRONMENT") as? String,
                bundleIdentifier: bundle.bundleIdentifier
              ),
              let url = bundle.url(forResource: "OwnerPhoneTest", withExtension: "json"),
              let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size <= 4096,
              let data = try? Data(contentsOf: url) else { return nil }
        return decode(data, now: now)
    }

    static func loadForResearch(
        bundle: Bundle,
        configuration: WanderfulAppConfiguration
    ) -> Self? {
        guard configuration.environment == .local,
              configuration.features.researchGuidedPlanning,
              configuration.features.routableHighlightAccess else { return nil }
        return load(bundle: bundle)
    }

    static func decode(_ data: Data, now: Date) -> Self? {
        guard data.count <= 4096,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == Set(["baseURL", "token", "expiresAt"]),
              let value = try? JSONDecoder().decode(Self.self, from: data),
              let parts = URLComponents(url: value.baseURL, resolvingAgainstBaseURL: false),
              parts.scheme == "https", let host = parts.host,
              host.contains("."), host == host.lowercased(),
              host.range(of: "^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$", options: .regularExpression) != nil,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.port == nil, parts.path == "/",
              value.token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              value.expiresAt.isFinite,
              value.expiresAt > now.timeIntervalSince1970,
              value.expiresAt <= now.timeIntervalSince1970 + 7200 else { return nil }
        return value
    }
}

actor OwnerPhoneTestAuthorizer: RouteSessionAuthorizing {
    let configuration: OwnerPhoneTestConfiguration
    private var invalidated = false

    init(configuration: OwnerPhoneTestConfiguration) {
        self.configuration = configuration
    }

    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        try Task.checkCancellation()
        guard !invalidated, (1...12).contains(cost), Date.now.timeIntervalSince1970 < configuration.expiresAt else {
            throw AppAttestServiceError.verificationFailed
        }
        return RouteSessionAuthorization(token: configuration.token, requestID: UUID())
    }

    func invalidate(token: String) async {
        if token == configuration.token { invalidated = true }
    }
}
#endif
