import Foundation
import XCTest
@testable import TrailMind

// This suite guards public disclosure and default composition. Dedicated behavior
// coverage remains in IntentParsingFoundationTests, SavedRouteStoreTests,
// GPXExporterTests, BackendRouteClientTests and AppAttestServiceTests.
@MainActor
final class PrivacyReleaseContentTests: XCTestCase {
    func testDisclosureCoversResearchPlanningBeyondLocalIntentParsing() throws {
        let client = try source(relativePath: "TrailMind/Services/OutdoorAdventurePlanningClient.swift")
        XCTAssertTrue(client.contains("api/llm-plan-route"))
        let detail = try dataFlowDetail(id: "about.data.promptParsing")
        XCTAssertEqual(detail, TrailMindAboutContent.releasePromptParsingDetail)
        for recipient in ["backend", "Google Gemini", "GraphHopper"] {
            XCTAssertTrue(detail.contains(recipient))
            XCTAssertTrue(TrailMindAboutContent.onlinePlanningPermissionDetail.contains(recipient))
        }
        XCTAssertFalse(detail.contains("do not send the full prompt"))
    }

    func testRemoteIntentReleaseCompositionHonorsFeatureFlagWithoutLocalFallback() throws {
        let parsingSource = try source(relativePath: "TrailMind/Services/IntentParsingFoundation.swift")
        let factoryBody = try declarationBody(startingWith: "enum IntentParsingProviderFactory", in: parsingSource)
        let defaultProviderBody = try declarationBody(startingWith: "static func makeDefaultProvider(", in: factoryBody)

        // Disabling remote intent still yields the local parser without starting a request.
        let disabledProvider = IntentParsingProviderFactory.makeDefaultProvider(
            environment: [:], remoteIntentEnabled: false
        )
        XCTAssertTrue(disabledProvider is LocalIntentParsingProvider)
        XCTAssertTrue(defaultProviderBody.contains("guard remoteIntentEnabled else { return LocalIntentParsingProvider() }"))
        // The enabled Release branch must use the real remote provider, not the
        // developer fallback that could disguise a failed AI request as success.
        XCTAssertEqual(try releaseBranchStatements(in: defaultProviderBody), [
            "_ = environment",
            "return RemoteAIIntentParsingProvider()"
        ])
        #if !DEBUG
        XCTAssertTrue(IntentParsingProviderFactory.makeDefaultProvider(
            environment: [:], remoteIntentEnabled: true
        ) is RemoteAIIntentParsingProvider)
        #endif

        let remoteBody = try declarationBody(startingWith: "struct RemoteAIIntentParsingProvider", in: parsingSource)
        let endpointBody = try declarationBody(startingWith: "private func endpointURL(", in: remoteBody)
        XCTAssertTrue(endpointBody.contains("guard let baseURL else { return nil }"))
        XCTAssertTrue(endpointBody.contains("baseURL.appending(path: \"api\").appending(path: \"parse-intent\")"))
        for token in ["struct RemoteAIIntentParsingProvider", "private struct RemoteIntentRequest", "private struct RemoteAdventureIntentResponse"] {
            XCTAssertTrue(parsingSource.contains(token))
            XCTAssertFalse(try everyOccurrenceIsDebugOnly(token, in: parsingSource))
        }

        let plannerSource = try source(relativePath: "TrailMind/ViewModels/PlannerViewModel.swift")
        let remoteErrorToken = "error is RemoteAIIntentParsingProvider.ProviderError"
        XCTAssertTrue(plannerSource.contains(remoteErrorToken))
        XCTAssertFalse(try everyOccurrenceIsDebugOnly(remoteErrorToken, in: plannerSource))
        XCTAssertTrue(plannerSource.contains("Route understanding isn’t available right now. Try again or edit the request."))
    }

    func testVoiceDisclosureMatchesRecognitionRequestMode() throws {
        let voiceSource = try source(
            relativePath: "TrailMind/Services/VoicePlanningService.swift"
        )
        let recognitionManagerBody = try declarationBody(
            startingWith: "private final class AppleVoiceRecognitionManager: VoiceRecognitionManaging",
            in: voiceSource
        )
        let transcriptionBody = try declarationBody(
            startingWith: "func start(",
            in: recognitionManagerBody
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
                + " Wanderful does not retain raw audio or send it to its own backend; you can review the transcript before planning."
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
            "Apple geocoding resolves the place names you enter. Wanderful then sends route coordinates and routing constraints to its backend, which asks GraphHopper to calculate the route."
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
            "Export creates a protected temporary GPX file containing route coordinates. The app or person you select in the share sheet receives those coordinates. Wanderful runs cleanup after sharing and recovers abandoned export files on a later launch."
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
            "Apple App Attest helps protect backend requests. Its key identifier is stored in the device Keychain. Wanderful's backend keeps an app-scoped installation record and stores a one-way hash of the request connection source for rate limiting. This is not a Wanderful account and is not used for tracking."
        )
    }

    func testBuiltAndTrackedPermissionPurposesMatchExactDisclosure() throws {
        let trackedInfo = try trackedInfoPlist()
        let builtInfo = try XCTUnwrap(Bundle.main.infoDictionary)

        for (label, info) in [("tracked", trackedInfo), ("built", builtInfo)] {
            XCTAssertEqual(
                info["NSLocationWhenInUseUsageDescription"] as? String,
                TrailMindPermissionCopy.locationWhenInUse,
                "Unexpected \(label) When In Use location purpose."
            )
            XCTAssertNil(info["NSLocationAlwaysUsageDescription"])
            XCTAssertNil(info["NSLocationAlwaysAndWhenInUseUsageDescription"])
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
            "During active Route Guidance, Wanderful uses your precise location to show position and progress, including during screen lock and app changes. Pause or end guidance to stop updates. No location track is stored or sent by Wanderful. If the app is terminated, reopen it and resume guidance manually."
        )
    }

    func testActiveGuidanceDeclaresBackgroundLocationWithoutAlwaysPermission() throws {
        let locationSource = try source(relativePath: "TrailMind/Services/RouteLocationService.swift")
        for info in [try trackedInfoPlist(), try XCTUnwrap(Bundle.main.infoDictionary)] {
            XCTAssertEqual(info["UIBackgroundModes"] as? [String], ["location"])
            XCTAssertNil(info["NSLocationAlwaysUsageDescription"])
            XCTAssertNil(info["NSLocationAlwaysAndWhenInUseUsageDescription"])
        }
        XCTAssertTrue(locationSource.contains("requestWhenInUseAuthorization"))
        XCTAssertTrue(locationSource.contains("allowsBackgroundLocationUpdates = true"))
        XCTAssertTrue(locationSource.contains("pausesLocationUpdatesAutomatically = false"))
        XCTAssertTrue(locationSource.contains("showsBackgroundLocationIndicator = true"))
        // The service resets both background flags when its active stream stops.
        let serviceBody = try declarationBody(startingWith: "final class CoreLocationRouteLocationService", in: locationSource)
        let streamBody = try declarationBody(startingWith: "private lazy var locationStream", in: serviceBody)
        XCTAssertTrue(streamBody.contains("stopUpdatingLocation()"))
        XCTAssertTrue(streamBody.contains("allowsBackgroundLocationUpdates = false"))
        XCTAssertTrue(streamBody.contains("showsBackgroundLocationIndicator = false"))
        for forbiddenToken in ["requestAlwaysAuthorization", "startMonitoringSignificantLocationChanges", "startMonitoringVisits"] {
            XCTAssertFalse(locationSource.contains(forbiddenToken))
        }
        // RouteGuidanceModelTests cover actual progress, pause/end and revocation;
        // these source/config contracts do not constitute physical lock-screen proof.
    }

    func testPlacePhotoDisclosureNamesRecipientsAndLimits() throws {
        let detail = try dataFlowDetail(id: "about.data.photos")
        for phrase in ["Wikidata", "Wikimedia Commons", "network address", "do not confirm current access"] {
            XCTAssertTrue(detail.contains(phrase))
        }
    }

    func testReleaseArtifactPermissionContractMatchesShippingDisclosure() throws {
        let data = Data(try source(relativePath: "scripts/release-contract.json").utf8)
        let contract = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let product = try XCTUnwrap(contract["product"] as? [String: Any])
        let usage = try XCTUnwrap(product["usage_descriptions"] as? [String: String])
        XCTAssertEqual(usage["NSLocationWhenInUseUsageDescription"], TrailMindPermissionCopy.locationWhenInUse)
        XCTAssertEqual(product["background_modes"] as? [String], ["location"])
        let info = try trackedInfoPlist()
        XCTAssertEqual(info["UIBackgroundModes"] as? [String], product["background_modes"] as? [String])
        let markers = try XCTUnwrap(contract["required_binary_markers"] as? [String])
        let displayedCopy = TrailMindAboutContent.credits.map(\.detail).joined(separator: " ")
            + TrailMindAboutContent.credits.map(\.title).joined(separator: " ")
            + TrailMindAboutContent.planningBoundaryItems.map(\.detail).joined(separator: " ")
        for marker in markers { XCTAssertTrue(displayedCopy.contains(marker), "Required release copy must be displayed: \(marker)") }
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
                "Route Guidance is a planning aid, not a safety guarantee. Check signs, weather, trail conditions, closures, local rules and water availability. Saved route data does not download the Apple basemap; offline maps are not provided. AI planning and route recalculation are unavailable without an internet connection.",
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

    private func everyOccurrenceIsDebugOnly(_ token: String, in source: String) throws -> Bool {
        var conditionalStack: [String] = []
        var occurrenceCount = 0

        for lineSlice in source.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(lineSlice)
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix("#if ") {
                conditionalStack.append(String(trimmed.dropFirst(4)))
                continue
            }
            if trimmed.hasPrefix("#elseif ") {
                guard !conditionalStack.isEmpty else {
                    throw SourceContractError.malformedConditionalCompilation
                }
                conditionalStack[conditionalStack.count - 1] = String(trimmed.dropFirst(8))
                continue
            }
            if trimmed == "#else" {
                guard !conditionalStack.isEmpty else {
                    throw SourceContractError.malformedConditionalCompilation
                }
                conditionalStack[conditionalStack.count - 1] = "!(\(conditionalStack.last!))"
                continue
            }
            if trimmed == "#endif" {
                guard conditionalStack.popLast() != nil else {
                    throw SourceContractError.malformedConditionalCompilation
                }
                continue
            }

            var searchStart = line.startIndex
            while let range = line.range(of: token, range: searchStart..<line.endIndex) {
                occurrenceCount += 1
                guard conditionalStack.contains("DEBUG") else { return false }
                searchStart = range.upperBound
            }
        }

        guard conditionalStack.isEmpty else {
            throw SourceContractError.malformedConditionalCompilation
        }
        return occurrenceCount > 0
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
    case malformedConditionalCompilation
}
