import Foundation
import XCTest
@testable import TrailMind

// This suite guards public disclosure and default composition. Dedicated behavior
// coverage remains in IntentParsingFoundationTests, SavedRouteStoreTests,
// GPXExporterTests, BackendRouteClientTests and AppAttestServiceTests.
@MainActor
final class PrivacyReleaseContentTests: XCTestCase {
    func testReleaseParserDisclosureMatchesFactoryReleaseBranch() throws {
        let factorySource = try source(
            relativePath: "TrailMind/Services/IntentParsingFoundation.swift"
        )
        let factoryBody = try declarationBody(
            startingWith: "enum IntentParsingProviderFactory",
            in: factorySource
        )
        let defaultProviderBody = try declarationBody(
            startingWith: "static func makeDefaultProvider(",
            in: factoryBody
        )

        XCTAssertEqual(
            try releaseBranchStatements(in: defaultProviderBody),
            ["_ = environment", "return LocalIntentParsingProvider()"]
        )
        XCTAssertEqual(
            TrailMindAboutContent.releasePromptParsingDetail,
            "Release builds parse your full typed route request on this device. They do not send the full prompt to a remote AI provider."
        )
        XCTAssertTrue(
            try dataFlowDetail(id: "about.data.promptParsing")
                .hasPrefix(TrailMindAboutContent.releasePromptParsingDetail)
        )
    }

    func testVoiceDisclosureMatchesRecognitionRequestMode() throws {
        let voiceSource = try source(
            relativePath: "TrailMind/Services/VoicePlanningService.swift"
        )
        let serviceBody = try declarationBody(
            startingWith: "final class AppleSpeechVoicePlanningService: VoicePlanningService",
            in: voiceSource
        )
        let transcriptionBody = try declarationBody(
            startingWith: "func startTranscription(language: VoicePlanningLanguage)",
            in: serviceBody
        )
        let requestVariables = try captureGroups(
            pattern: #"\blet\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*SFSpeechAudioBufferRecognitionRequest\s*\(\s*\)"#,
            in: transcriptionBody
        )

        XCTAssertEqual(requestVariables, ["request"])
        let requestVariable = try XCTUnwrap(requestVariables.first)
        let onDeviceAssignmentPattern =
            #"\b"# + NSRegularExpression.escapedPattern(for: requestVariable)
            + #"\s*\.\s*requiresOnDeviceRecognition\s*="#
        XCTAssertEqual(try matchCount(pattern: onDeviceAssignmentPattern, in: transcriptionBody), 0)

        let expectedServerDisclosure =
            "Apple Speech can send captured audio to Apple's servers for processing."
        XCTAssertEqual(
            TrailMindPermissionCopy.appleSpeechServerDisclosure,
            expectedServerDisclosure
        )
        XCTAssertEqual(
            try dataFlowDetail(id: "about.data.voice"),
            expectedServerDisclosure
                + " TrailMind does not retain raw audio or send it to its own backend; you can review the transcript before planning."
        )
    }

    func testDefaultRoutingDisclosureMatchesBackendComposition() throws {
        let coordinator = RoutingCoordinator()
        let primaryProvider = try reflectedValue(named: "primaryProvider", in: coordinator)
        XCTAssertTrue(primaryProvider is GraphHopperRoutingProvider)

        let client = try reflectedValue(named: "client", in: primaryProvider)
        XCTAssertTrue(client is GraphHopperClient)

        let optionalGateway = try reflectedValue(named: "gateway", in: client)
        let gateway = try unwrappedOptional(optionalGateway)
        XCTAssertTrue(gateway is BackendRouteGateway)

        XCTAssertEqual(
            try dataFlowDetail(id: "about.data.routing"),
            "Apple geocoding resolves the place names you enter. TrailMind then sends route coordinates and routing constraints to its backend, which asks GraphHopper to calculate the route."
        )
    }

    func testSavedDisclosureMatchesVerifiedOnlySavesAndUnverifiedLegacyRecovery() throws {
        // SavedRouteStoreTests behavior-proves verified-only persistence and
        // conservative legacy migration to .unverified(.legacyRecord).
        XCTAssertEqual(
            try currentCapabilityDetail(id: "about.capability.localSavedPlans"),
            "New saves accept only verified routed results. Recovered legacy records remain labeled unverified."
        )
        XCTAssertEqual(
            try dataFlowDetail(id: "about.data.savedRoutes"),
            "New saves accept only verified routed results and are stored as protected files on this device, excluded from device backups. Recovered legacy records remain labeled unverified. In Saved, use the trash button to delete all saved routes."
        )
        XCTAssertEqual(
            SavedRoutesViewContent.unverifiedLabel,
            "Unverified legacy route · details are not verified"
        )
    }

    func testGPXDisclosureNamesCoordinateRecipient() throws {
        // GPXExporterTests behavior-proves coordinate encoding, protected temporary
        // storage, share-lifecycle cleanup and abandoned-export recovery.
        XCTAssertEqual(
            try dataFlowDetail(id: "about.data.gpx"),
            "Export creates a protected temporary GPX file containing route coordinates. The app or person you select in the share sheet receives those coordinates. TrailMind runs cleanup after sharing and recovers abandoned TrailMind export files on a later launch."
        )
    }

    func testPrivacyManifestMatchesRequiredReasonAndAppAttestDataFlowContracts() throws {
        let trackedManifest = try trackedPrivacyManifest()
        let builtManifest = try builtPrivacyManifest()

        for (label, manifest) in [("tracked", trackedManifest), ("built", builtManifest)] {
            XCTAssertEqual(manifest["NSPrivacyTracking"] as? Bool, false, "Unexpected \(label) tracking declaration.")
            XCTAssertNil(manifest["NSPrivacyTrackingDomains"], "Tracking domains must be absent when tracking is disabled.")

            let accessedTypes = try XCTUnwrap(
                manifest["NSPrivacyAccessedAPITypes"] as? [[String: Any]],
                "Missing \(label) required-reason API declarations."
            )
            let accessedReasons = try Dictionary(
                uniqueKeysWithValues: accessedTypes.map { item in
                    (
                        try XCTUnwrap(item["NSPrivacyAccessedAPIType"] as? String),
                        try XCTUnwrap(item["NSPrivacyAccessedAPITypeReasons"] as? [String])
                    )
                }
            )
            XCTAssertEqual(
                accessedReasons,
                [
                    "NSPrivacyAccessedAPICategoryFileTimestamp": ["C617.1"],
                    "NSPrivacyAccessedAPICategoryUserDefaults": ["CA92.1"]
                ],
                "Unexpected \(label) required-reason API scope."
            )

            let collectedTypes = try XCTUnwrap(
                manifest["NSPrivacyCollectedDataTypes"] as? [[String: Any]],
                "Missing \(label) collected-data declaration."
            )
            XCTAssertEqual(collectedTypes.count, 1)
            let deviceIdentifier = try XCTUnwrap(collectedTypes.first)
            XCTAssertEqual(
                deviceIdentifier["NSPrivacyCollectedDataType"] as? String,
                "NSPrivacyCollectedDataTypeDeviceID"
            )
            XCTAssertEqual(deviceIdentifier["NSPrivacyCollectedDataTypeLinked"] as? Bool, true)
            XCTAssertEqual(deviceIdentifier["NSPrivacyCollectedDataTypeTracking"] as? Bool, false)
            XCTAssertEqual(
                deviceIdentifier["NSPrivacyCollectedDataTypePurposes"] as? [String],
                ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
            )
        }

        XCTAssertEqual(
            try dataFlowDetail(id: "about.data.appAttest"),
            "Apple App Attest helps protect backend requests. Its key identifier is stored in the device Keychain. TrailMind's backend keeps an app-scoped installation record and stores a one-way hash of the request connection source for rate limiting. This is not a TrailMind account and is not used for tracking."
        )
    }

    func testBuiltAndTrackedPermissionPurposesMatchExactDisclosure() throws {
        let trackedInfo = try trackedInfoPlist()
        let builtInfo = try XCTUnwrap(Bundle.main.infoDictionary)

        for (label, info) in [("tracked", trackedInfo), ("built", builtInfo)] {
            XCTAssertNil(
                info["NSLocationWhenInUseUsageDescription"],
                "The \(label) plist must not request unavailable location access."
            )
            XCTAssertEqual(
                info["NSMicrophoneUsageDescription"] as? String,
                TrailMindPermissionCopy.microphone,
                "Unexpected \(label) microphone purpose."
            )
            XCTAssertEqual(
                info["NSSpeechRecognitionUsageDescription"] as? String,
                TrailMindPermissionCopy.speechRecognition,
                "Unexpected \(label) speech-recognition purpose."
            )
            XCTAssertNil(
                info["NSAppTransportSecurity"],
                "The \(label) plist must not grant broad local-network transport access."
            )
        }

        XCTAssertEqual(
            try dataFlowDetail(id: "about.data.deviceLocation"),
            "TrailMind does not currently access your device's location. Enter a place name when choosing a route start."
        )
    }

    func testShippingSourceHasNoDormantLocationAuthorizationOrTrackingSurface() throws {
        let servicesSource = try source(relativePath: "TrailMind/Services/TrailServices.swift")

        for forbiddenToken in [
            "LocationService",
            "CLLocationManager",
            "requestWhenInUseAuthorization",
            "startUpdatingLocation"
        ] {
            XCTAssertFalse(
                servicesSource.contains(forbiddenToken),
                "Shipping services must not retain unused location capability: \(forbiddenToken)"
            )
        }
    }

    func testClosedBetaDeclaresOnlyProvenIPhonePortraitSurface() throws {
        let trackedInfo = try trackedInfoPlist()
        let builtInfo = try XCTUnwrap(Bundle.main.infoDictionary)

        XCTAssertNil(trackedInfo["UISupportedInterfaceOrientations~ipad"])
        XCTAssertEqual(
            trackedInfo["UISupportedInterfaceOrientations"] as? [String],
            ["UIInterfaceOrientationPortrait"]
        )
        XCTAssertEqual(builtInfo["UIDeviceFamily"] as? [Int], [1])
        XCTAssertEqual(
            builtInfo["UISupportedInterfaceOrientations"] as? [String],
            ["UIInterfaceOrientationPortrait"]
        )
    }

    func testPlanningBoundaryRemainsExact() {
        XCTAssertEqual(
            TrailMindAboutContent.planningBoundaryItems.map(\.detail),
            [
                "TrailMind is a planning aid, not live navigation. Check weather, trail conditions, closures, local rules and water availability.",
                "Requested features are shown separately unless mapped route data verifies them."
            ]
        )
    }

    func testProviderCreditsUseOfficialHTTPSDestinations() throws {
        let credits = Dictionary(
            uniqueKeysWithValues: TrailMindAboutContent.credits.map { ($0.id, $0) }
        )

        XCTAssertEqual(
            try XCTUnwrap(credits["about.credit.graphHopper"]).destination.absoluteString,
            "https://www.graphhopper.com/attribution/"
        )
        XCTAssertEqual(
            try XCTUnwrap(credits["about.credit.openStreetMap"]).destination.absoluteString,
            "https://www.openstreetmap.org/copyright"
        )
        XCTAssertEqual(
            try XCTUnwrap(credits["about.credit.mapterhorn"]).destination.absoluteString,
            "https://www.graphhopper.com/attribution/"
        )
        XCTAssertTrue(
            TrailMindAboutContent.credits.allSatisfy {
                $0.destination.scheme == "https" && $0.destination.host != nil
            }
        )
        XCTAssertEqual(
            try XCTUnwrap(credits["about.credit.openStreetMap"]).title,
            "Map data © OpenStreetMap contributors"
        )
        XCTAssertEqual(
            try XCTUnwrap(credits["about.credit.openStreetMap"]).detail,
            "OpenStreetMap data is available under the Open Data Commons Open Database License (ODbL)."
        )
    }

    func testAboutAccessibilityIdentifiersAreSemanticExactAndUnique() {
        let identifiers = [
            TrailMindAboutAccessibilityID.header,
            TrailMindAboutAccessibilityID.currentCapabilitiesSection,
            TrailMindAboutAccessibilityID.dataFlowSection,
            TrailMindAboutAccessibilityID.planningBoundarySection,
            TrailMindAboutAccessibilityID.creditsSection,
            "about.data.footer"
        ] + TrailMindAboutContent.currentCapabilityItems.map(\.id)
            + TrailMindAboutContent.dataFlowItems.map(\.id)
            + TrailMindAboutContent.planningBoundaryItems.map(\.id)
            + [TrailMindAboutContent.mapDisplayItem.id]
            + TrailMindAboutContent.credits.map(\.id)

        XCTAssertEqual(Set(identifiers).count, identifiers.count)
        XCTAssertTrue(identifiers.allSatisfy { $0.hasPrefix("about.") })
        XCTAssertFalse(identifiers.contains(where: \.isEmpty))
    }

    private func dataFlowDetail(id: String) throws -> String {
        try XCTUnwrap(TrailMindAboutContent.dataFlowItems.first { $0.id == id }).detail
    }

    private func currentCapabilityDetail(id: String) throws -> String {
        try XCTUnwrap(TrailMindAboutContent.currentCapabilityItems.first { $0.id == id }).detail
    }

    private var repositoryURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func source(relativePath: String) throws -> String {
        try String(
            contentsOf: repositoryURL.appendingPathComponent(relativePath, isDirectory: false),
            encoding: .utf8
        )
    }

    private func trackedInfoPlist() throws -> [String: Any] {
        let infoPlistURL = repositoryURL
            .appendingPathComponent("Configuration", isDirectory: true)
            .appendingPathComponent("TrailMind-Info.plist", isDirectory: false)
        let data = try Data(contentsOf: infoPlistURL)
        return try XCTUnwrap(
            PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )
    }

    private func trackedPrivacyManifest() throws -> [String: Any] {
        try propertyList(
            at: repositoryURL
                .appendingPathComponent("TrailMind", isDirectory: true)
                .appendingPathComponent("PrivacyInfo.xcprivacy", isDirectory: false)
        )
    }

    private func builtPrivacyManifest() throws -> [String: Any] {
        let manifestURL = try XCTUnwrap(
            Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"),
            "The app target must bundle PrivacyInfo.xcprivacy."
        )
        return try propertyList(at: manifestURL)
    }

    private func propertyList(at url: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: url)
        return try XCTUnwrap(
            PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )
    }

    private func declarationBody(
        startingWith declaration: String,
        in source: String
    ) throws -> String {
        guard let declarationRange = source.range(of: declaration) else {
            throw SourceContractError.missingDeclaration(declaration)
        }
        guard let openingBrace = source[declarationRange.upperBound...].firstIndex(of: "{") else {
            throw SourceContractError.malformedDeclaration(declaration)
        }

        var depth = 0
        var index = openingBrace
        while index < source.endIndex {
            switch source[index] {
            case "{":
                depth += 1
            case "}":
                depth -= 1
                if depth == 0 {
                    let bodyStart = source.index(after: openingBrace)
                    return String(source[bodyStart..<index])
                }
            default:
                break
            }
            index = source.index(after: index)
        }
        throw SourceContractError.malformedDeclaration(declaration)
    }

    private func releaseBranchStatements(in body: String) throws -> [String] {
        let lines = body.split(separator: "\n", omittingEmptySubsequences: false)
        var conditionalDepth = 0
        var isCapturingRelease = false
        var statements: [String] = []

        for lineSlice in lines {
            let line = lineSlice.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("#if ") {
                conditionalDepth += 1
                continue
            }
            if line == "#else", conditionalDepth == 1 {
                isCapturingRelease = true
                continue
            }
            if line == "#endif" {
                if conditionalDepth == 1, isCapturingRelease {
                    return statements
                }
                conditionalDepth -= 1
                continue
            }
            if isCapturingRelease, conditionalDepth == 1, !line.isEmpty {
                statements.append(line)
            }
        }
        throw SourceContractError.missingReleaseBranch
    }

    private func captureGroups(pattern: String, in source: String) throws -> [String] {
        let expression = try NSRegularExpression(pattern: pattern)
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        return expression.matches(in: source, range: range).compactMap { match in
            guard match.numberOfRanges == 2,
                  let captureRange = Range(match.range(at: 1), in: source)
            else { return nil }
            return String(source[captureRange])
        }
    }

    private func matchCount(pattern: String, in source: String) throws -> Int {
        let expression = try NSRegularExpression(pattern: pattern)
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        return expression.numberOfMatches(in: source, range: range)
    }

    private func reflectedValue(named name: String, in value: Any) throws -> Any {
        guard let child = Mirror(reflecting: value).children.first(where: { $0.label == name }) else {
            throw SourceContractError.missingStoredProperty(name)
        }
        return child.value
    }

    private func unwrappedOptional(_ value: Any) throws -> Any {
        let mirror = Mirror(reflecting: value)
        guard mirror.displayStyle == .optional else { return value }
        guard let wrapped = mirror.children.first?.value else {
            throw SourceContractError.nilStoredProperty
        }
        return wrapped
    }
}

private enum SourceContractError: Error {
    case missingDeclaration(String)
    case malformedDeclaration(String)
    case missingReleaseBranch
    case missingStoredProperty(String)
    case nilStoredProperty
}
