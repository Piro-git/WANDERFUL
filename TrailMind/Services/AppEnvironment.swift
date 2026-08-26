import Foundation

nonisolated enum WanderfulEnvironment: String, CaseIterable, Sendable {
    case local
    case staging
    case production
}

nonisolated enum WanderfulAppAttestEnvironment: String, Sendable {
    case development
    case production
}

nonisolated enum WanderfulBackendIdentityPolicy: Equatable, Sendable {
    case loopbackOnly
    case unavailable
    case exactHost(String)
}

nonisolated enum WanderfulSupabaseIdentityPolicy: Equatable, Sendable {
    case unavailable
    case exactProjectReference(String)
}

nonisolated struct WanderfulLaneIdentityPolicy: Equatable, Sendable {
    let environment: WanderfulEnvironment
    let bundleIdentifier: String
    let displayName: String
    let appAttestEnvironment: WanderfulAppAttestEnvironment
    let backend: WanderfulBackendIdentityPolicy
    let supabase: WanderfulSupabaseIdentityPolicy
}

// A build must contain exactly one marker. Runtime data never selects this value.
#if (TRAILMIND_ENV_LOCAL && TRAILMIND_ENV_STAGING) || (TRAILMIND_ENV_LOCAL && TRAILMIND_ENV_PRODUCTION) || (TRAILMIND_ENV_STAGING && TRAILMIND_ENV_PRODUCTION)
#error("TrailMind requires exactly one signed build environment marker.")
#endif

// Only the active conditional branch is compiled into a signed application.
// Service URL/key injection has no input capable of changing this policy.
nonisolated enum WanderfulSignedLaneIdentity {
    #if TRAILMIND_ENV_LOCAL
    static let value = WanderfulLaneIdentityPolicy(
        environment: .local,
        bundleIdentifier: "com.trailmind.app.local",
        displayName: "Wanderful Local",
        appAttestEnvironment: .development,
        backend: .loopbackOnly,
        supabase: .unavailable
    )
    #elseif TRAILMIND_ENV_STAGING
    static let value = WanderfulLaneIdentityPolicy(
        environment: .staging,
        bundleIdentifier: "com.trailmind.app.staging",
        displayName: "Wanderful Staging",
        appAttestEnvironment: .production,
        backend: .unavailable,
        supabase: .exactProjectReference("mbvzwsrtqcrwhvykugcd")
    )
    #elseif TRAILMIND_ENV_PRODUCTION
    static let value = WanderfulLaneIdentityPolicy(
        environment: .production,
        bundleIdentifier: "com.trailmind.app",
        displayName: "Wanderful",
        appAttestEnvironment: .production,
        backend: .unavailable,
        supabase: .exactProjectReference("bejvhhjbgtvctpsnlwid")
    )
    #else
    #error("TrailMind requires one signed build environment marker.")
    #endif
}

nonisolated enum WanderfulEnvironmentConfigurationError: Error, Equatable, Sendable {
    case missingValue(String)
    case duplicateValue(String)
    case nonStringValue(String)
    case invalidCanonicalValue(String)
    case signedEnvironmentMismatch
    case bundleIdentifierMismatch
    case displayNameMismatch
    case appAttestEnvironmentMismatch
}

nonisolated enum WanderfulServiceConfigurationIssue: String, Error, Equatable, Sendable {
    case duplicateValue
    case nonStringValue
    case whitespaceConfusedValue
    case unexpandedBuildSetting
    case incompleteConfiguration
    case malformedURL
    case insecureTransport
    case invalidHost
    case unexpectedURLComponent
    case missingExpectedIdentity
    case identityMismatch
    case invalidPublicClientKey
    case prohibitedSecretKey
}

nonisolated enum WanderfulServiceConfiguration<Value: Equatable & Sendable>: Equatable, Sendable {
    case unavailable
    case invalid(WanderfulServiceConfigurationIssue)
    case configured(Value)

    var configuredValue: Value? {
        guard case let .configured(value) = self else { return nil }
        return value
    }

    var isAvailable: Bool { configuredValue != nil }
}

nonisolated struct WanderfulBackendConfiguration: Equatable, Sendable {
    let baseURL: URL
}

nonisolated struct WanderfulSupabaseConfiguration: Equatable, Sendable {
    let projectURL: URL
    let projectReference: String
    let publishableKey: String
}

nonisolated struct WanderfulSuperwallConfiguration: Equatable, Sendable {
    let publicSDKKey: String
}

nonisolated struct WanderfulFeatureFlags: Equatable, Sendable {
    let outdoorEvidence: Bool
    let researchGuidedPlanning: Bool
    let routableHighlightAccess: Bool
    let remoteIntent: Bool
    let directGraphHopper: Bool
    let insecureLocalBackendAuthorization: Bool
    let inMemoryAppAttest: Bool
    let supabaseOnboardingSync: Bool
    let superwall: Bool
    let invalidKeys: [String]

    static let disabled = Self(
        outdoorEvidence: false,
        researchGuidedPlanning: false,
        routableHighlightAccess: false,
        remoteIntent: false,
        directGraphHopper: false,
        insecureLocalBackendAuthorization: false,
        inMemoryAppAttest: false,
        supabaseOnboardingSync: false,
        superwall: false,
        invalidKeys: []
    )

    var allControlledFlagsAreFalse: Bool {
        !outdoorEvidence && !researchGuidedPlanning && !routableHighlightAccess &&
            !remoteIntent && !directGraphHopper && !insecureLocalBackendAuthorization &&
            !inMemoryAppAttest && !supabaseOnboardingSync && !superwall
    }
}

nonisolated struct WanderfulEnvironmentDiagnostics: Equatable, Sendable {
    let environmentName: String
    let backendAvailable: Bool
    let supabaseOnboardingAvailable: Bool
    let superwallAvailable: Bool
    let researchGuidedPlanningAvailable: Bool
    let outdoorEvidenceAvailable: Bool

    // Deliberately contains no URL, host, project reference, or credential.
}

nonisolated struct WanderfulConfigurationInput {
    private let entries: [String: [Any]]

    init(infoDictionary: [String: Any]) {
        entries = infoDictionary.mapValues { [$0] }
    }

    init(entries: [(String, Any)]) {
        self.entries = Dictionary(grouping: entries, by: \.0)
            .mapValues { $0.map(\.1) }
    }

    fileprivate func requiredCanonicalString(
        _ key: String
    ) throws -> String {
        guard let values = entries[key], !values.isEmpty else {
            throw WanderfulEnvironmentConfigurationError.missingValue(key)
        }
        guard values.count == 1 else {
            throw WanderfulEnvironmentConfigurationError.duplicateValue(key)
        }
        guard let value = values[0] as? String else {
            throw WanderfulEnvironmentConfigurationError.nonStringValue(key)
        }
        guard Self.isCanonical(value), !value.isEmpty else {
            throw WanderfulEnvironmentConfigurationError.invalidCanonicalValue(key)
        }
        return value
    }

    fileprivate func serviceString(
        _ key: String
    ) -> Result<String, WanderfulServiceConfigurationIssue> {
        guard let values = entries[key], !values.isEmpty else { return .success("") }
        guard values.count == 1 else { return .failure(.duplicateValue) }
        guard let value = values[0] as? String else { return .failure(.nonStringValue) }
        guard value == value.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return .failure(.whitespaceConfusedValue)
        }
        guard !value.contains("$(") else { return .failure(.unexpandedBuildSetting) }
        guard value.utf8.count <= 2_048 else { return .failure(.invalidHost) }
        return .success(value)
    }

    fileprivate static func isCanonical(_ value: String) -> Bool {
        value == value.trimmingCharacters(in: .whitespacesAndNewlines) &&
            !value.contains("$(") && value.utf8.count <= 2_048
    }
}

nonisolated struct WanderfulAppConfiguration: Equatable, Sendable {
    static let environmentKey = "TRAILMIND_APP_ENVIRONMENT"
    static let appAttestEnvironmentKey = "TRAILMIND_APP_ATTEST_ENVIRONMENT"
    static let backendURLKey = "INTENT_BACKEND_BASE_URL"
    static let supabaseURLKey = "SUPABASE_PROJECT_URL"
    static let supabaseKeyKey = "SUPABASE_PUBLISHABLE_KEY"
    static let superwallKey = "SUPERWALL_API_KEY"

    let signedIdentity: WanderfulLaneIdentityPolicy
    let backend: WanderfulServiceConfiguration<WanderfulBackendConfiguration>
    let supabaseOnboarding: WanderfulServiceConfiguration<WanderfulSupabaseConfiguration>
    let superwall: WanderfulServiceConfiguration<WanderfulSuperwallConfiguration>
    let features: WanderfulFeatureFlags

    var environment: WanderfulEnvironment { signedIdentity.environment }
    var appAttestEnvironment: WanderfulAppAttestEnvironment {
        signedIdentity.appAttestEnvironment
    }

    var diagnostics: WanderfulEnvironmentDiagnostics {
        let backendAvailable = backend.isAvailable
        return WanderfulEnvironmentDiagnostics(
            environmentName: environment.rawValue,
            backendAvailable: backendAvailable,
            // V1 deliberately has no activatable remote onboarding client.
            supabaseOnboardingAvailable: false,
            superwallAvailable: features.superwall && superwall.isAvailable,
            researchGuidedPlanningAvailable:
                features.researchGuidedPlanning && backendAvailable,
            outdoorEvidenceAvailable: features.outdoorEvidence && backendAvailable
        )
    }

    static func resolve(
        input: WanderfulConfigurationInput,
        signedIdentity: WanderfulLaneIdentityPolicy
    ) throws -> Self {
        let rawEnvironment = try input.requiredCanonicalString(environmentKey)
        guard let environment = WanderfulEnvironment(rawValue: rawEnvironment) else {
            throw WanderfulEnvironmentConfigurationError.invalidCanonicalValue(environmentKey)
        }
        guard environment == signedIdentity.environment else {
            throw WanderfulEnvironmentConfigurationError.signedEnvironmentMismatch
        }

        guard try input.requiredCanonicalString("CFBundleIdentifier") ==
                signedIdentity.bundleIdentifier
        else {
            throw WanderfulEnvironmentConfigurationError.bundleIdentifierMismatch
        }
        guard try input.requiredCanonicalString("CFBundleDisplayName") ==
                signedIdentity.displayName
        else {
            throw WanderfulEnvironmentConfigurationError.displayNameMismatch
        }
        let rawAttest = try input.requiredCanonicalString(appAttestEnvironmentKey)
        guard let appAttestEnvironment = WanderfulAppAttestEnvironment(rawValue: rawAttest),
              appAttestEnvironment == signedIdentity.appAttestEnvironment
        else {
            throw WanderfulEnvironmentConfigurationError.appAttestEnvironmentMismatch
        }

        return Self(
            signedIdentity: signedIdentity,
            backend: resolveBackend(input: input, policy: signedIdentity.backend),
            supabaseOnboarding: resolveSupabase(input: input, policy: signedIdentity.supabase),
            superwall: resolveSuperwall(input: input),
            features: resolveFeatures(input: input)
        )
    }

    static func resolve(
        infoDictionary: [String: Any],
        signedIdentity: WanderfulLaneIdentityPolicy
    ) throws -> Self {
        try resolve(
            input: WanderfulConfigurationInput(infoDictionary: infoDictionary),
            signedIdentity: signedIdentity
        )
    }

    private static func resolveBackend(
        input: WanderfulConfigurationInput,
        policy: WanderfulBackendIdentityPolicy
    ) -> WanderfulServiceConfiguration<WanderfulBackendConfiguration> {
        let result = input.serviceString(backendURLKey)
        guard case let .success(rawURL) = result else {
            return .invalid(result.failure ?? .incompleteConfiguration)
        }
        guard !rawURL.isEmpty else { return .unavailable }

        switch policy {
        case .loopbackOnly:
            guard case let .success(url) = localLoopbackURL(rawURL) else {
                return .invalid(localLoopbackURL(rawURL).failure ?? .malformedURL)
            }
            return .configured(WanderfulBackendConfiguration(baseURL: url))
        case .unavailable:
            return .invalid(.missingExpectedIdentity)
        case let .exactHost(expectedHost):
            return remoteBackend(rawURL: rawURL, expectedHost: expectedHost)
        }
    }

    private static func remoteBackend(
        rawURL: String,
        expectedHost: String
    ) -> WanderfulServiceConfiguration<WanderfulBackendConfiguration> {
        guard validDNSHost(expectedHost) else {
            return .invalid(.invalidHost)
        }
        let parsed = remoteHTTPSURL(rawURL)
        guard case let .success((url, host)) = parsed else {
            return .invalid(parsed.failure ?? .malformedURL)
        }
        guard host == expectedHost else { return .invalid(.identityMismatch) }
        return .configured(WanderfulBackendConfiguration(baseURL: url))
    }

    private static func resolveSupabase(
        input: WanderfulConfigurationInput,
        policy: WanderfulSupabaseIdentityPolicy
    ) -> WanderfulServiceConfiguration<WanderfulSupabaseConfiguration> {
        let values = serviceValues(
            input: input,
            keys: [
                supabaseURLKey,
                supabaseKeyKey
            ]
        )
        guard case let .success(raw) = values else {
            return .invalid(values.failure ?? .incompleteConfiguration)
        }
        guard raw.contains(where: { !$0.isEmpty }) else { return .unavailable }
        guard raw.allSatisfy({ !$0.isEmpty }) else {
            return .invalid(.incompleteConfiguration)
        }

        guard case let .exactProjectReference(expectedReference) = policy else {
            return .invalid(.missingExpectedIdentity)
        }

        let rawURL = raw[0]
        let key = raw[1]
        guard validProjectReference(expectedReference) else {
            return .invalid(.invalidHost)
        }
        let parsed = remoteHTTPSURL(rawURL)
        guard case let .success((url, host)) = parsed else {
            return .invalid(parsed.failure ?? .malformedURL)
        }
        guard host.hasSuffix(".supabase.co") else { return .invalid(.invalidHost) }
        let projectReference = String(host.dropLast(".supabase.co".count))
        guard validProjectReference(projectReference) else { return .invalid(.invalidHost) }
        guard projectReference == expectedReference else { return .invalid(.identityMismatch) }

        switch publicSupabaseKeyValidation(key) {
        case .success:
            return .configured(
                WanderfulSupabaseConfiguration(
                    projectURL: url,
                    projectReference: projectReference,
                    publishableKey: key
                )
            )
        case let .failure(issue):
            return .invalid(issue)
        }
    }

    private static func resolveSuperwall(
        input: WanderfulConfigurationInput
    ) -> WanderfulServiceConfiguration<WanderfulSuperwallConfiguration> {
        let result = input.serviceString(superwallKey)
        guard case let .success(key) = result else {
            return .invalid(result.failure ?? .invalidPublicClientKey)
        }
        guard !key.isEmpty else { return .unavailable }
        let allowed = key.hasPrefix("pk_") && key.count > 8 &&
            key.utf8.allSatisfy(Self.isPublicKeyCharacter) &&
            !key.localizedCaseInsensitiveContains("placeholder") &&
            !key.localizedCaseInsensitiveContains("your_")
        return allowed
            ? .configured(WanderfulSuperwallConfiguration(publicSDKKey: key))
            : .invalid(.invalidPublicClientKey)
    }

    private static func resolveFeatures(
        input: WanderfulConfigurationInput
    ) -> WanderfulFeatureFlags {
        let keys = [
            "OUTDOOR_EVIDENCE_ENABLED",
            "RESEARCH_GUIDED_PLANNING_ENABLED",
            "ROUTABLE_HIGHLIGHT_ACCESS_ENABLED",
            "REMOTE_INTENT_ENABLED",
            "DIRECT_GRAPHHOPPER_ENABLED",
            "INSECURE_LOCAL_BACKEND_AUTH_ENABLED",
            "IN_MEMORY_APP_ATTEST_ENABLED",
            "SUPABASE_ONBOARDING_SYNC_ENABLED",
            "SUPERWALL_ENABLED"
        ]
        var values: [String: Bool] = [:]
        var invalid: [String] = []
        for key in keys {
            switch input.serviceString(key) {
            case .success(""):
                values[key] = false
            case .success("false"):
                values[key] = false
            case .success("true"):
                values[key] = true
            case .success, .failure:
                values[key] = false
                invalid.append(key)
            }
        }
        return WanderfulFeatureFlags(
            outdoorEvidence: values[keys[0]] ?? false,
            researchGuidedPlanning: values[keys[1]] ?? false,
            routableHighlightAccess: values[keys[2]] ?? false,
            remoteIntent: values[keys[3]] ?? false,
            directGraphHopper: values[keys[4]] ?? false,
            insecureLocalBackendAuthorization: values[keys[5]] ?? false,
            inMemoryAppAttest: values[keys[6]] ?? false,
            supabaseOnboardingSync: values[keys[7]] ?? false,
            superwall: values[keys[8]] ?? false,
            invalidKeys: invalid.sorted()
        )
    }

    private static func serviceValues(
        input: WanderfulConfigurationInput,
        keys: [String]
    ) -> Result<[String], WanderfulServiceConfigurationIssue> {
        var values: [String] = []
        for key in keys {
            switch input.serviceString(key) {
            case let .success(value): values.append(value)
            case let .failure(issue): return .failure(issue)
            }
        }
        return .success(values)
    }

    private static func localLoopbackURL(
        _ rawValue: String
    ) -> Result<URL, WanderfulServiceConfigurationIssue> {
        guard let components = URLComponents(string: rawValue),
              components.scheme == "http",
              let host = components.host,
              ["127.0.0.1", "localhost", "::1", "[::1]"].contains(host),
              let url = components.url
        else {
            return .failure(.insecureTransport)
        }
        guard components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path.isEmpty || components.path == "/"
        else {
            return .failure(.unexpectedURLComponent)
        }
        if let port = components.port, !(1...65_535).contains(port) {
            return .failure(.unexpectedURLComponent)
        }
        return .success(url)
    }

    private static func remoteHTTPSURL(
        _ rawValue: String
    ) -> Result<(URL, String), WanderfulServiceConfigurationIssue> {
        guard let components = URLComponents(string: rawValue),
              components.scheme == "https",
              let host = components.host,
              validDNSHost(host),
              let url = components.url
        else {
            return .failure(.insecureTransport)
        }
        guard components.user == nil, components.password == nil else {
            return .failure(.unexpectedURLComponent)
        }
        guard components.query == nil, components.fragment == nil,
              components.port == nil,
              components.path.isEmpty || components.path == "/"
        else {
            return .failure(.unexpectedURLComponent)
        }
        return .success((url, host))
    }

    private static func validDNSHost(_ host: String) -> Bool {
        guard host == host.lowercased(), !host.hasPrefix("."), !host.hasSuffix("."),
              host.contains("."), host.utf8.count <= 253
        else { return false }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        return labels.allSatisfy { label in
            !label.isEmpty && label.count <= 63 &&
                label.first != "-" && label.last != "-" &&
                label.utf8.allSatisfy {
                    (48...57).contains($0) || (97...122).contains($0) || $0 == 45
                }
        }
    }

    private static func validProjectReference(_ value: String) -> Bool {
        value.count == 20 && value.utf8.allSatisfy {
            (48...57).contains($0) || (97...122).contains($0)
        }
    }

    private static func publicSupabaseKeyValidation(
        _ value: String
    ) -> Result<Void, WanderfulServiceConfigurationIssue> {
        let lowered = value.lowercased()
        if lowered.hasPrefix("sb_secret_") || lowered.contains("service_role") ||
            lowered.contains("service-role") || lowered.contains("database_password") {
            return .failure(.prohibitedSecretKey)
        }
        if value.hasPrefix("sb_publishable_") {
            let suffix = value.dropFirst("sb_publishable_".count)
            guard suffix.count >= 20,
                  suffix.utf8.allSatisfy(Self.isPublicKeyCharacter),
                  !lowered.contains("placeholder"),
                  !lowered.contains("example"),
                  !lowered.contains("your_")
            else {
                return .failure(.invalidPublicClientKey)
            }
            return .success(())
        }
        guard legacyJWTRole(value) == "anon" else {
            return legacyJWTRole(value) == "service_role"
                ? .failure(.prohibitedSecretKey)
                : .failure(.invalidPublicClientKey)
        }
        return .success(())
    }

    private static func isPublicKeyCharacter(_ byte: UInt8) -> Bool {
        (48...57).contains(byte) || (65...90).contains(byte) ||
            (97...122).contains(byte) || byte == 45 || byte == 95
    }

    private static func legacyJWTRole(_ value: String) -> String? {
        let segments = value.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count == 3 else { return nil }
        var payload = String(segments[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        payload.append(String(repeating: "=", count: (4 - payload.count % 4) % 4))
        guard let data = Data(base64Encoded: payload),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return object["role"] as? String
    }
}

private nonisolated extension Result {
    var failure: Failure? {
        guard case let .failure(error) = self else { return nil }
        return error
    }
}

nonisolated enum WanderfulAppConfigurationSnapshot {
    static let result: Result<
        WanderfulAppConfiguration,
        WanderfulEnvironmentConfigurationError
    > = {
        do {
            return .success(
                try WanderfulAppConfiguration.resolve(
                    infoDictionary: Bundle.main.infoDictionary ?? [:],
                    signedIdentity: WanderfulSignedLaneIdentity.value
                )
            )
        } catch let error as WanderfulEnvironmentConfigurationError {
            return .failure(error)
        } catch {
            return .failure(.invalidCanonicalValue("configuration"))
        }
    }()

    static var configuration: WanderfulAppConfiguration? {
        try? result.get()
    }
}
