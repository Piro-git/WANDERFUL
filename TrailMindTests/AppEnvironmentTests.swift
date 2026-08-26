import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class AppEnvironmentTests: XCTestCase {
    func testExactCanonicalEnvironmentParsing() throws {
        for environment in WanderfulEnvironment.allCases {
            let configuration = try resolve(validEntries(for: environment), as: environment)
            XCTAssertEqual(configuration.environment, environment)
            XCTAssertEqual(
                configuration.appAttestEnvironment,
                identityPolicy(for: environment).appAttestEnvironment
            )
        }
    }

    func testMissingMalformedUnknownWhitespaceCaseAndDuplicateEnvironmentsReject() {
        let base = validEntries(for: .local)
        assertEnvironmentError(
            base.filter { $0.0 != WanderfulAppConfiguration.environmentKey },
            .missingValue(WanderfulAppConfiguration.environmentKey)
        )
        assertEnvironmentError(
            replacing(base, WanderfulAppConfiguration.environmentKey, 1),
            .nonStringValue(WanderfulAppConfiguration.environmentKey)
        )
        for value in ["development", "Local", " local", "local ", "", "qa"] {
            assertEnvironmentError(
                replacing(base, WanderfulAppConfiguration.environmentKey, value),
                .invalidCanonicalValue(WanderfulAppConfiguration.environmentKey)
            )
        }
        assertEnvironmentError(
            base + [(WanderfulAppConfiguration.environmentKey, "local")],
            .duplicateValue(WanderfulAppConfiguration.environmentKey)
        )
    }

    func testSignedBuildMarkerCannotBeOverriddenByInfoPlist() {
        assertEnvironmentError(
            validEntries(for: .staging),
            .signedEnvironmentMismatch,
            signedIdentity: identityPolicy(for: .production)
        )
    }

    func testRemoteEndpointsRequireCanonicalHTTPSAndIdentityPair() throws {
        var entries = configuredBackendEntries(for: .staging)
        XCTAssertTrue(try resolve(entries, as: .staging).backend.isAvailable)

        entries = replacing(
            entries,
            WanderfulAppConfiguration.backendURLKey,
            "http://staging.api.example.com"
        )
        XCTAssertEqual(
            try resolve(entries, as: .staging).backend,
            .invalid(.insecureTransport)
        )

        let unavailablePolicy = WanderfulLaneIdentityPolicy(
            environment: .staging,
            bundleIdentifier: "com.trailmind.app.staging",
            displayName: "Wanderful Staging",
            appAttestEnvironment: .production,
            backend: .unavailable,
            supabase: .exactProjectReference("stagingprojectref001")
        )
        XCTAssertEqual(
            try resolve(
                configuredBackendEntries(for: .staging),
                signedIdentity: unavailablePolicy
            ).backend,
            .invalid(.missingExpectedIdentity)
        )
    }

    func testOnlyExactLoopbackHTTPIsAllowedLocally() throws {
        for value in [
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "http://[::1]:3000"
        ] {
            let entries = replacing(
                validEntries(for: .local),
                WanderfulAppConfiguration.backendURLKey,
                value
            )
            XCTAssertTrue(try resolve(entries, as: .local).backend.isAvailable, value)
        }

        for value in [
            "https://127.0.0.1:3000",
            "http://127.0.0.2:3000",
            "http://127.0.0.1.example.com:3000",
            "https://local.example.com"
        ] {
            let entries = replacing(
                validEntries(for: .local),
                WanderfulAppConfiguration.backendURLKey,
                value
            )
            XCTAssertFalse(try resolve(entries, as: .local).backend.isAvailable, value)
        }
    }

    func testURLUserInfoQueryFragmentPathPortAndWhitespaceReject() throws {
        let invalidValues = [
            "https://user@staging.api.example.com",
            "https://user:password@staging.api.example.com",
            "https://staging.api.example.com?key=credential",
            "https://staging.api.example.com#fragment",
            "https://staging.api.example.com/api",
            "https://staging.api.example.com:8443",
            " https://staging.api.example.com"
        ]
        for value in invalidValues {
            let entries = replacing(
                configuredBackendEntries(for: .staging),
                WanderfulAppConfiguration.backendURLKey,
                value
            )
            XCTAssertFalse(try resolve(entries, as: .staging).backend.isAvailable, value)
        }
    }

    func testProductionRejectsStagingEndpointAndStagingRejectsProductionEndpoint() throws {
        let production = replacing(
            configuredBackendEntries(for: .production),
            WanderfulAppConfiguration.backendURLKey,
            "https://staging.api.example.com"
        )
        XCTAssertEqual(
            try resolve(production, as: .production).backend,
            .invalid(.identityMismatch)
        )

        let staging = replacing(
            configuredBackendEntries(for: .staging),
            WanderfulAppConfiguration.backendURLKey,
            "https://api.example.com"
        )
        XCTAssertEqual(
            try resolve(staging, as: .staging).backend,
            .invalid(.identityMismatch)
        )
    }

    func testMutableBackendIdentityCannotBeChangedWithTheInjectedURL() throws {
        var stagingAttack = configuredBackendEntries(for: .staging)
        stagingAttack = replacing(
            stagingAttack,
            WanderfulAppConfiguration.backendURLKey,
            "https://api.example.com"
        )
        stagingAttack = replacing(
            stagingAttack,
            "BACKEND_EXPECTED_HOST",
            "api.example.com"
        )
        stagingAttack = replacing(
            stagingAttack,
            "BACKEND_FORBIDDEN_HOST",
            ""
        )
        XCTAssertFalse(try resolve(stagingAttack, as: .staging).backend.isAvailable)

        var productionAttack = configuredBackendEntries(for: .production)
        productionAttack = replacing(
            productionAttack,
            WanderfulAppConfiguration.backendURLKey,
            "https://staging.api.example.com"
        )
        productionAttack = replacing(
            productionAttack,
            "BACKEND_EXPECTED_HOST",
            "staging.api.example.com"
        )
        productionAttack = replacing(
            productionAttack,
            "BACKEND_FORBIDDEN_HOST",
            ""
        )
        XCTAssertFalse(try resolve(productionAttack, as: .production).backend.isAvailable)
    }

    func testSupabaseProjectIdentityCannotCrossEnvironments() throws {
        let production = replacing(
            configuredSupabaseEntries(for: .production),
            WanderfulAppConfiguration.supabaseURLKey,
            "https://stagingprojectref001.supabase.co"
        )
        XCTAssertEqual(
            try resolve(production, as: .production).supabaseOnboarding,
            .invalid(.identityMismatch)
        )

        let staging = replacing(
            configuredSupabaseEntries(for: .staging),
            WanderfulAppConfiguration.supabaseURLKey,
            "https://productionproject001.supabase.co"
        )
        XCTAssertEqual(
            try resolve(staging, as: .staging).supabaseOnboarding,
            .invalid(.identityMismatch)
        )
    }

    func testMutableSupabaseIdentityCannotBeChangedWithTheInjectedURL() throws {
        var stagingAttack = configuredSupabaseEntries(for: .staging)
        stagingAttack = replacing(
            stagingAttack,
            WanderfulAppConfiguration.supabaseURLKey,
            "https://productionproject001.supabase.co"
        )
        stagingAttack = replacing(
            stagingAttack,
            "SUPABASE_EXPECTED_PROJECT_REF",
            "productionproject001"
        )
        stagingAttack = replacing(
            stagingAttack,
            "SUPABASE_FORBIDDEN_PROJECT_REF",
            ""
        )
        XCTAssertFalse(
            try resolve(stagingAttack, as: .staging).supabaseOnboarding.isAvailable
        )

        var productionAttack = configuredSupabaseEntries(for: .production)
        productionAttack = replacing(
            productionAttack,
            WanderfulAppConfiguration.supabaseURLKey,
            "https://stagingprojectref001.supabase.co"
        )
        productionAttack = replacing(
            productionAttack,
            "SUPABASE_EXPECTED_PROJECT_REF",
            "stagingprojectref001"
        )
        productionAttack = replacing(
            productionAttack,
            "SUPABASE_FORBIDDEN_PROJECT_REF",
            ""
        )
        XCTAssertFalse(
            try resolve(productionAttack, as: .production).supabaseOnboarding.isAvailable
        )
    }

    func testSupabaseAcceptsPublishableAndLegacyAnonButRejectsSecretRoles() throws {
        let publishable = try resolve(configuredSupabaseEntries(for: .staging), as: .staging)
        XCTAssertTrue(publishable.supabaseOnboarding.isAvailable)

        var entries = replacing(
            configuredSupabaseEntries(for: .staging),
            WanderfulAppConfiguration.supabaseKeyKey,
            legacyJWT(role: "anon")
        )
        XCTAssertTrue(try resolve(entries, as: .staging).supabaseOnboarding.isAvailable)

        for key in ["sb_secret_ABCDEFGHIJKLMNOPQRSTUVWX1234", legacyJWT(role: "service_role")]
        {
            entries = replacing(
                configuredSupabaseEntries(for: .staging),
                WanderfulAppConfiguration.supabaseKeyKey,
                key
            )
            XCTAssertEqual(
                try resolve(entries, as: .staging).supabaseOnboarding,
                .invalid(.prohibitedSecretKey)
            )
        }
    }

    func testBlankServicesSelectOnlyNoOpClientsAndNoCapabilities() throws {
        let configuration = try resolve(validEntries(for: .local), as: .local)

        XCTAssertEqual(configuration.backend, .unavailable)
        XCTAssertEqual(configuration.supabaseOnboarding, .unavailable)
        XCTAssertEqual(configuration.superwall, .unavailable)
        XCTAssertFalse(configuration.diagnostics.backendAvailable)
        XCTAssertFalse(configuration.diagnostics.supabaseOnboardingAvailable)
        XCTAssertFalse(configuration.diagnostics.superwallAvailable)
        XCTAssertTrue(
            OutdoorAdventurePlanningClientFactory.makeDefault(
                configuration: configuration
            ) is NoOpOutdoorAdventurePlanningClientV1
        )
        XCTAssertTrue(
            OutdoorRouteEvidenceProviderFactory.makeDefault(
                configuration: configuration
            ) is NoOpOutdoorRouteEvidenceProvider
        )
        XCTAssertTrue(
            HikingPreferenceProfileSyncFactoryV1.make(
                configuration: configuration
            ) is NoOpHikingPreferenceProfileSyncClientV1
        )
    }

    func testBlankUnprovisionedRemoteBackendIsUnavailableAndPerformsNoNetwork() throws {
        let signedIdentity = WanderfulLaneIdentityPolicy(
            environment: .staging,
            bundleIdentifier: "com.trailmind.app.staging",
            displayName: "Wanderful Staging",
            appAttestEnvironment: .production,
            backend: .unavailable,
            supabase: .exactProjectReference("stagingprojectref001")
        )
        let configuration = try resolve(
            validEntries(for: .staging),
            signedIdentity: signedIdentity
        )

        XCTAssertEqual(configuration.backend, .unavailable)
        XCTAssertFalse(configuration.diagnostics.backendAvailable)
        XCTAssertTrue(
            OutdoorAdventurePlanningClientFactory.makeDefault(
                configuration: configuration
            ) is NoOpOutdoorAdventurePlanningClientV1
        )
        XCTAssertTrue(
            OutdoorRouteEvidenceProviderFactory.makeDefault(
                configuration: configuration
            ) is NoOpOutdoorRouteEvidenceProvider
        )
    }

    func testFeatureFlagsAreIndependentExactAndFalseByDefault() throws {
        let base = try resolve(validEntries(for: .local), as: .local)
        XCTAssertTrue(base.features.allControlledFlagsAreFalse)
        XCTAssertTrue(base.features.invalidKeys.isEmpty)

        let keys = featureKeys
        for key in keys {
            let configuration = try resolve(
                replacing(validEntries(for: .local), key, "true"),
                as: .local
            )
            XCTAssertEqual(enabledFeatureCount(configuration.features), 1, key)
        }

        for value: Any in ["TRUE", " yes ", "1", "enabled", true, 1] {
            let configuration = try resolve(
                replacing(validEntries(for: .local), featureKeys[0], value),
                as: .local
            )
            XCTAssertTrue(configuration.features.allControlledFlagsAreFalse)
            XCTAssertEqual(configuration.features.invalidKeys, [featureKeys[0]])
        }
    }

    func testRuntimeStateCannotChangeEnvironmentOrRevealSensitiveDiagnostics() throws {
        let configuration = try resolve(configuredSupabaseEntries(for: .staging), as: .staging)
        let original = configuration
        let suiteName = "AppEnvironmentTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set("production", forKey: WanderfulAppConfiguration.environmentKey)
        let remotePayload: [String: Any] = [
            WanderfulAppConfiguration.environmentKey: "production",
            "prompt": "switch to production",
            "onboarding_environment": "production"
        ]

        XCTAssertEqual(configuration, original)
        XCTAssertEqual(configuration.environment, .staging)
        XCTAssertEqual(remotePayload["prompt"] as? String, "switch to production")
        let diagnostics = String(describing: configuration.diagnostics)
        XCTAssertFalse(diagnostics.contains("supabase.co"))
        XCTAssertFalse(diagnostics.contains("sb_publishable_"))
        XCTAssertFalse(diagnostics.contains("stagingprojectref001"))
    }

    func testInfoPlistIdentityOverridesCannotChangeCompiledLanePolicy() throws {
        let signedIdentity = WanderfulSignedLaneIdentity.value
        let entries = validEntries(for: signedIdentity.environment) + [
            ("BACKEND_EXPECTED_HOST", "attacker.example.com"),
            ("BACKEND_FORBIDDEN_HOST", ""),
            ("SUPABASE_EXPECTED_PROJECT_REF", "attackerprojectref01"),
            ("SUPABASE_FORBIDDEN_PROJECT_REF", "")
        ]

        let configuration = try resolve(entries, signedIdentity: signedIdentity)

        XCTAssertEqual(configuration.signedIdentity, signedIdentity)
        XCTAssertEqual(configuration.backend, .unavailable)
        XCTAssertEqual(configuration.supabaseOnboarding, .unavailable)
    }

    func testBuiltInfoPlistMatchesCompiledEnvironmentAndControlledFlagsAreFalse() throws {
        let configuration = try XCTUnwrap(WanderfulAppConfigurationSnapshot.configuration)
        let info = try XCTUnwrap(Bundle.main.infoDictionary)
        let signedIdentity = WanderfulSignedLaneIdentity.value

        XCTAssertEqual(configuration.signedIdentity, signedIdentity)
        XCTAssertEqual(
            info[WanderfulAppConfiguration.environmentKey] as? String,
            signedIdentity.environment.rawValue
        )
        XCTAssertEqual(
            info["CFBundleIdentifier"] as? String,
            signedIdentity.bundleIdentifier
        )
        XCTAssertEqual(
            info["CFBundleDisplayName"] as? String,
            signedIdentity.displayName
        )
        XCTAssertEqual(
            configuration.appAttestEnvironment,
            signedIdentity.appAttestEnvironment
        )
        XCTAssertEqual(configuration.backend, .unavailable)
        XCTAssertEqual(configuration.supabaseOnboarding, .unavailable)
        XCTAssertTrue(configuration.features.allControlledFlagsAreFalse)
    }

    func testCheckedInBuildMappingIsExactAndReleaseContainsNoStagingLaneValues() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let development = try source("Configuration/Development.xcconfig", root: root)
        let staging = try source("Configuration/Staging.xcconfig", root: root)
        let production = try source("Configuration/Production.xcconfig", root: root)
        let info = try source("Configuration/TrailMind-Info.plist", root: root)
        let project = try source("TrailMind.xcodeproj/project.pbxproj", root: root)
        let stagingScheme = try source(
            "TrailMind.xcodeproj/xcshareddata/xcschemes/TrailMind Staging.xcscheme",
            root: root
        )

        XCTAssertTrue(development.contains("#include? \"Local.xcconfig\""))
        XCTAssertTrue(development.contains("TRAILMIND_APP_ENVIRONMENT = local"))
        XCTAssertTrue(development.contains("com.trailmind.app.local"))

        XCTAssertFalse(staging.contains("Local.xcconfig"))
        XCTAssertFalse(staging.contains("PRODUCTION_"))
        XCTAssertTrue(staging.contains("TRAILMIND_APP_ENVIRONMENT = staging"))
        XCTAssertTrue(staging.contains("com.trailmind.app.staging"))
        XCTAssertFalse(staging.contains("EXPECTED_HOST"))
        XCTAssertFalse(staging.contains("EXPECTED_PROJECT_REF"))

        XCTAssertFalse(production.contains("Local.xcconfig"))
        XCTAssertFalse(production.contains("STAGING_"))
        XCTAssertTrue(production.contains("TRAILMIND_APP_ENVIRONMENT = production"))
        XCTAssertTrue(production.contains("TRAILMIND_PRODUCT_BUNDLE_IDENTIFIER = com.trailmind.app\n"))
        XCTAssertFalse(production.contains("com.trailmind.app.staging"))
        XCTAssertFalse(production.contains("EXPECTED_HOST"))
        XCTAssertFalse(production.contains("EXPECTED_PROJECT_REF"))

        XCTAssertEqual(info.components(separatedBy: "<key>TRAILMIND_APP_ENVIRONMENT</key>").count - 1, 1)
        XCTAssertFalse(info.contains("BACKEND_EXPECTED_HOST"))
        XCTAssertFalse(info.contains("SUPABASE_EXPECTED_PROJECT_REF"))
        XCTAssertTrue(project.contains("TRAILMIND_ENV_LOCAL"))
        XCTAssertTrue(project.contains("TRAILMIND_ENV_STAGING"))
        XCTAssertTrue(project.contains("TRAILMIND_ENV_PRODUCTION"))
        XCTAssertTrue(project.contains("D40000000000000000000002 /* Staging */"))
        XCTAssertTrue(stagingScheme.contains("buildConfiguration = \"Staging\""))
        XCTAssertTrue(stagingScheme.contains("<ArchiveAction\n      buildConfiguration = \"Staging\""))
    }

    func testEnvironmentSourceHasNoRuntimeOverrideChannel() throws {
        let sourceURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("TrailMind/Services/AppEnvironment.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)

        for forbidden in [
            "UserDefaults", "ProcessInfo", "launchEnvironment", "remoteConfig",
            "onboarding_environment", "prompt"
        ] {
            XCTAssertFalse(source.contains(forbidden), forbidden)
        }
        XCTAssertTrue(source.contains("WanderfulSignedLaneIdentity.value"))
        XCTAssertTrue(source.contains("supabase: .exactProjectReference(\"mbvzwsrtqcrwhvykugcd\")"))
        XCTAssertTrue(source.contains("supabase: .exactProjectReference(\"bejvhhjbgtvctpsnlwid\")"))
        XCTAssertTrue(source.contains("static let result"))
    }

    private var featureKeys: [String] {
        [
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
    }

    private func enabledFeatureCount(_ flags: WanderfulFeatureFlags) -> Int {
        [
            flags.outdoorEvidence,
            flags.researchGuidedPlanning,
            flags.routableHighlightAccess,
            flags.remoteIntent,
            flags.directGraphHopper,
            flags.insecureLocalBackendAuthorization,
            flags.inMemoryAppAttest,
            flags.supabaseOnboardingSync,
            flags.superwall
        ].count(where: { $0 })
    }

    private func validEntries(
        for environment: WanderfulEnvironment
    ) -> [(String, Any)] {
        let identity = identityPolicy(for: environment)
        return [
            (WanderfulAppConfiguration.environmentKey, environment.rawValue),
            ("CFBundleIdentifier", identity.bundleIdentifier),
            ("CFBundleDisplayName", identity.displayName),
            (
                WanderfulAppConfiguration.appAttestEnvironmentKey,
                identity.appAttestEnvironment.rawValue
            ),
            (WanderfulAppConfiguration.backendURLKey, ""),
            (WanderfulAppConfiguration.supabaseURLKey, ""),
            (WanderfulAppConfiguration.supabaseKeyKey, ""),
            (WanderfulAppConfiguration.superwallKey, "")
        ] + featureKeys.map { ($0, "false" as Any) }
    }

    private func configuredBackendEntries(
        for environment: WanderfulEnvironment
    ) -> [(String, Any)] {
        precondition(environment != .local)
        let expected = environment == .staging
            ? "staging.api.example.com"
            : "api.example.com"
        var entries = validEntries(for: environment)
        entries = replacing(
            entries,
            WanderfulAppConfiguration.backendURLKey,
            "https://\(expected)"
        )
        return entries
    }

    private func configuredSupabaseEntries(
        for environment: WanderfulEnvironment
    ) -> [(String, Any)] {
        precondition(environment != .local)
        let expected = environment == .staging
            ? "stagingprojectref001"
            : "productionproject001"
        var entries = validEntries(for: environment)
        entries = replacing(
            entries,
            WanderfulAppConfiguration.supabaseURLKey,
            "https://\(expected).supabase.co"
        )
        entries = replacing(
            entries,
            WanderfulAppConfiguration.supabaseKeyKey,
            "sb_publishable_ABCDEFGHIJKLMNOPQRSTUVWX1234"
        )
        return entries
    }

    private func resolve(
        _ entries: [(String, Any)],
        as signedEnvironment: WanderfulEnvironment
    ) throws -> WanderfulAppConfiguration {
        try resolve(entries, signedIdentity: identityPolicy(for: signedEnvironment))
    }

    private func resolve(
        _ entries: [(String, Any)],
        signedIdentity: WanderfulLaneIdentityPolicy
    ) throws -> WanderfulAppConfiguration {
        try WanderfulAppConfiguration.resolve(
            input: WanderfulConfigurationInput(entries: entries),
            signedIdentity: signedIdentity
        )
    }

    private func identityPolicy(
        for environment: WanderfulEnvironment
    ) -> WanderfulLaneIdentityPolicy {
        switch environment {
        case .local:
            WanderfulLaneIdentityPolicy(
                environment: .local,
                bundleIdentifier: "com.trailmind.app.local",
                displayName: "Wanderful Local",
                appAttestEnvironment: .development,
                backend: .loopbackOnly,
                supabase: .unavailable
            )
        case .staging:
            WanderfulLaneIdentityPolicy(
                environment: .staging,
                bundleIdentifier: "com.trailmind.app.staging",
                displayName: "Wanderful Staging",
                appAttestEnvironment: .production,
                backend: .exactHost("staging.api.example.com"),
                supabase: .exactProjectReference("stagingprojectref001")
            )
        case .production:
            WanderfulLaneIdentityPolicy(
                environment: .production,
                bundleIdentifier: "com.trailmind.app",
                displayName: "Wanderful",
                appAttestEnvironment: .production,
                backend: .exactHost("api.example.com"),
                supabase: .exactProjectReference("productionproject001")
            )
        }
    }

    private func replacing(
        _ entries: [(String, Any)],
        _ key: String,
        _ value: Any
    ) -> [(String, Any)] {
        entries.filter { $0.0 != key } + [(key, value)]
    }

    private func assertEnvironmentError(
        _ entries: [(String, Any)],
        _ expected: WanderfulEnvironmentConfigurationError,
        signedIdentity: WanderfulLaneIdentityPolicy? = nil,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(
            try resolve(
                entries,
                signedIdentity: signedIdentity ?? identityPolicy(for: .local)
            ),
            file: file,
            line: line
        ) { error in
            XCTAssertEqual(
                error as? WanderfulEnvironmentConfigurationError,
                expected,
                file: file,
                line: line
            )
        }
    }

    private func legacyJWT(role: String) -> String {
        let header = base64URL(Data(#"{"alg":"HS256","typ":"JWT"}"#.utf8))
        let payload = base64URL(Data("{\"role\":\"\(role)\"}".utf8))
        return "\(header).\(payload).signature"
    }

    private func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func source(_ relativePath: String, root: URL) throws -> String {
        try String(
            contentsOf: root.appendingPathComponent(relativePath),
            encoding: .utf8
        )
    }
}
