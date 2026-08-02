#if DEBUG
import CryptoKit
import Foundation
import Observation
import SwiftUI

enum StagingProofCaseID: String, CaseIterable, Codable, Sendable {
    case case01 =
        "case-01-harz-ilsenburg-loop-viewpoints-forest"
    case case02 =
        "case-02-harz-schierke-easy-loop-paths-avoid-roads"
    case case03 =
        "case-03-harz-trail-running-loop"
    case case04 =
        "case-04-harz-brocken-must-have-landmark"
    case case05 =
        "case-05-harz-unsatisfied-must-have-highlight"
    case case06 =
        "case-06-outside-imported-coverage"
    case case07 =
        "case-07-innsbruck-viewpoint-loop"
    case case08 =
        "case-08-innsbruck-easy-conservative-loop"
    case case09 =
        "case-09-broad-alps-requires-clarification"
    case case10 =
        "case-10-innsbruck-missing-official-current-evidence"
    case case11 =
        "case-11-biking-unsupported-legacy-once"
    case case12 =
        "case-12-point-to-point-unsupported-documented-fallback"
    case case13 =
        "case-13-cancel-during-postgis-research"
    case case14 =
        "case-14-timeout-during-graphhopper"
    case case15 =
        "case-15-partial-provider-failure-survivor"
    case case16 =
        "case-16-malformed-backend-response-rejected-by-ios"
    case case17 =
        "case-17-feature-disabled-zero-research-work"
    case case18 =
        "case-18-retry-does-not-reuse-stale-state"
}

enum StagingProofInputFixtureID:
    String,
    CaseIterable,
    Codable,
    Sendable
{
    case case01 =
        "case-01-harz-ilsenburg-loop-viewpoints-forest-input-v1"
    case case02 =
        "case-02-harz-schierke-easy-loop-paths-avoid-roads-input-v1"
    case case03 =
        "case-03-harz-trail-running-loop-input-v1"
    case case04 =
        "case-04-harz-brocken-must-have-landmark-input-v1"
    case case05 =
        "case-05-harz-unsatisfied-must-have-highlight-input-v1"
    case case06 =
        "case-06-outside-imported-coverage-input-v1"
    case case07 =
        "case-07-innsbruck-viewpoint-loop-input-v1"
    case case08 =
        "case-08-innsbruck-easy-conservative-loop-input-v1"
    case case09 =
        "case-09-broad-alps-requires-clarification-input-v1"
    case case10 =
        "case-10-innsbruck-missing-official-current-evidence-input-v1"
    case case11 =
        "case-11-biking-unsupported-legacy-once-input-v1"
    case case12 =
        "case-12-point-to-point-unsupported-documented-fallback-input-v1"
    case case13 =
        "case-13-cancel-during-postgis-research-input-v1"
    case case14 =
        "case-14-timeout-during-graphhopper-input-v1"
    case case15 =
        "case-15-partial-provider-failure-survivor-input-v1"
    case case16 =
        "case-16-malformed-backend-response-rejected-by-ios-input-v1"
    case case17 =
        "case-17-feature-disabled-zero-research-work-input-v1"
    case case18 =
        "case-18-retry-does-not-reuse-stale-state-input-v1"

    var proofCaseID: StagingProofCaseID {
        switch self {
        case .case01: .case01
        case .case02: .case02
        case .case03: .case03
        case .case04: .case04
        case .case05: .case05
        case .case06: .case06
        case .case07: .case07
        case .case08: .case08
        case .case09: .case09
        case .case10: .case10
        case .case11: .case11
        case .case12: .case12
        case .case13: .case13
        case .case14: .case14
        case .case15: .case15
        case .case16: .case16
        case .case17: .case17
        case .case18: .case18
        }
    }
}

struct StagingProofLaunchRequest: Equatable, Sendable {
    let fixtureID: StagingProofInputFixtureID
    let nonceDigest: String
}

enum StagingProofLaunchRequestError: Error, Equatable, Sendable {
    case malformedArguments
    case unknownFixture
    case invalidNonceDigest
}

enum StagingProofLaunchRequestParser {
    static let marker = "--trailmind-staging-proof"
    static let fixtureKey = "--trailmind-staging-proof-fixture"
    static let nonceDigestKey =
        "--trailmind-staging-proof-nonce-digest"

    static func parse(
        arguments: [String]
    ) throws -> StagingProofLaunchRequest? {
        let markerIndexes = arguments.indices.filter {
            arguments[$0] == marker
        }
        let fixtureIndexes = arguments.indices.filter {
            arguments[$0] == fixtureKey
        }
        let nonceIndexes = arguments.indices.filter {
            arguments[$0] == nonceDigestKey
        }

        guard !markerIndexes.isEmpty ||
                !fixtureIndexes.isEmpty ||
                !nonceIndexes.isEmpty
        else {
            return nil
        }
        guard markerIndexes.count == 1,
              fixtureIndexes.count == 1,
              nonceIndexes.count == 1,
              let fixtureValue = value(
                after: fixtureIndexes[0],
                in: arguments
              ),
              let nonceDigest = value(
                after: nonceIndexes[0],
                in: arguments
              )
        else {
            throw StagingProofLaunchRequestError
                .malformedArguments
        }
        guard let fixtureID =
                StagingProofInputFixtureID(rawValue: fixtureValue)
        else {
            throw StagingProofLaunchRequestError.unknownFixture
        }
        guard StagingProofDigest.isSHA256(nonceDigest) else {
            throw StagingProofLaunchRequestError.invalidNonceDigest
        }
        return StagingProofLaunchRequest(
            fixtureID: fixtureID,
            nonceDigest: nonceDigest
        )
    }

    private static func value(
        after index: Int,
        in arguments: [String]
    ) -> String? {
        let valueIndex = index + 1
        guard arguments.indices.contains(valueIndex) else {
            return nil
        }
        let value = arguments[valueIndex]
        guard !value.isEmpty, !value.hasPrefix("--") else {
            return nil
        }
        return value
    }
}

enum StagingProofPostgresCancellationGatePhase:
    String,
    Sendable
{
    case queryActive = "query_active"
    case cancelSettled = "cancel_settled"
}

enum StagingProofPostgresCancellationGateClientError:
    Error,
    Equatable,
    Sendable
{
    case invalidEndpoint
    case invalidResponse
}

struct StagingProofPostgresCancellationGateClient: Sendable {
    typealias DataLoader =
        @Sendable (URLRequest) async throws -> (Data, URLResponse)

    private struct RequestEnvelope: Encodable {
        let schemaVersion: Int
        let caseId: String
        let nonceDigest: String
        let phase: String
    }

    private let baseURL: URL
    private let nonceDigest: String
    private let dataLoader: DataLoader

    init(
        baseURL: URL,
        nonceDigest: String,
        session: URLSession = .shared
    ) {
        let standard = RouteTransportLimits.standard
        let limits = RouteTransportLimits(
            maximumSuccessBodyBytes: 1_024,
            maximumErrorBodyBytes: 1_024,
            maximumPaths: standard.maximumPaths,
            maximumCoordinatesPerPath:
                standard.maximumCoordinatesPerPath,
            maximumInstructionsPerPath:
                standard.maximumInstructionsPerPath,
            maximumPathDetailsPerPath:
                standard.maximumPathDetailsPerPath,
            maximumAbsoluteElevationMeters:
                standard.maximumAbsoluteElevationMeters
        )
        self.init(
            baseURL: baseURL,
            nonceDigest: nonceDigest,
            dataLoader: { request in
                return try await BoundedRouteHTTPTransport(
                    session: session,
                    limits: limits
                ).data(for: request)
            }
        )
    }

    init(
        baseURL: URL,
        nonceDigest: String,
        dataLoader: @escaping DataLoader
    ) {
        self.baseURL = baseURL
        self.nonceDigest = nonceDigest
        self.dataLoader = dataLoader
    }

    func wait(
        for phase: StagingProofPostgresCancellationGatePhase
    ) async throws {
        guard baseURL.host != nil,
              baseURL.scheme == "https" ||
                (
                    baseURL.scheme == "http" &&
                    ["127.0.0.1", "localhost", "::1"]
                        .contains(baseURL.host ?? "")
                ),
              StagingProofDigest.isSHA256(nonceDigest)
        else {
            throw StagingProofPostgresCancellationGateClientError
                .invalidEndpoint
        }
        let endpoint = baseURL
            .appending(path: "api")
            .appending(path: "staging-proof")
            .appending(path: "postgres-cancellation-gate")
        let envelope = RequestEnvelope(
            schemaVersion: 1,
            caseId: StagingProofCaseID.case13.rawValue,
            nonceDigest: nonceDigest,
            phase: phase.rawValue
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue(
            "application/json",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue(
            "application/json",
            forHTTPHeaderField: "Accept"
        )
        request.httpBody = try encoder.encode(envelope)

        let (data, response) = try await dataLoader(request)
        guard let response = response as? HTTPURLResponse,
              response.url == endpoint,
              response.statusCode == 200,
              response.mimeType == "application/json",
              let object = try JSONSerialization.jsonObject(
                with: data
              ) as? [String: Any],
              Set(object.keys) == ["schemaVersion", "state"],
              object["schemaVersion"] as? Int == 1,
              object["state"] as? String == phase.rawValue
        else {
            throw StagingProofPostgresCancellationGateClientError
                .invalidResponse
        }
    }
}

private enum StagingProofExecutionMode {
    case standard
    case cancelAfterAuthorization
    case retryAfterLegacyFallback
    case controlledResponseRejection
    case featureDisabledObservation
}

struct StagingProofFixture {
    let id: StagingProofInputFixtureID

    var proofCaseID: StagingProofCaseID {
        id.proofCaseID
    }

    fileprivate var executionMode: StagingProofExecutionMode {
        switch id {
        case .case13:
            .cancelAfterAuthorization
        case .case16:
            .controlledResponseRejection
        case .case17:
            .featureDisabledObservation
        case .case18:
            .retryAfterLegacyFallback
        case .case01, .case02, .case03, .case04, .case05,
             .case06, .case07, .case08, .case09, .case10,
             .case11, .case12, .case14, .case15:
            .standard
        }
    }

    fileprivate var expectedProofTerminal:
        StagingProofTerminalState
    {
        switch id {
        case .case01, .case02, .case03, .case04,
             .case07, .case08:
            .partial
        case .case05, .case06, .case11, .case12, .case14:
            .legacyFallback
        case .case09:
            .clarification
        case .case10, .case15:
            .partial
        case .case13:
            .cancelled
        case .case16:
            .rejected
        case .case17:
            .disabled
        case .case18:
            .retrySucceeded
        }
    }

    fileprivate var requiresResearchConfiguration: Bool {
        id != .case16 && id != .case17
    }

    fileprivate var requiresCausalServerBinding: Bool {
        switch id {
        case .case01, .case02, .case03, .case04, .case05,
             .case06, .case07, .case08, .case10, .case13,
             .case14, .case15, .case16, .case18:
            true
        case .case09, .case11, .case12, .case17:
            false
        }
    }

    fileprivate var expectedSemanticObservationIDs: Set<String> {
        switch id {
        case .case01:
            [
                "canonical_intent_bound",
                "real_route_quality_ranked",
                "research_waypoints_visited",
                "viewpoint_forest_preferences_preserved"
            ]
        case .case02:
            [
                "canonical_intent_bound",
                "conservative_difficulty_applied",
                "path_and_road_preferences_preserved",
                "real_route_quality_ranked",
                "research_waypoints_visited"
            ]
        case .case03:
            [
                "canonical_intent_bound",
                "real_route_quality_ranked",
                "research_waypoints_visited",
                "trail_running_activity_preserved"
            ]
        case .case04:
            [
                "brocken_anchor_returned",
                "canonical_intent_bound",
                "named_brocken_must_have_satisfied",
                "real_route_quality_ranked",
                "research_waypoints_visited"
            ]
        case .case05:
            [
                "canonical_intent_bound",
                "legacy_fallback_once",
                "must_have_shortfall_observed"
            ]
        case .case06:
            [
                "canonical_intent_bound",
                "legacy_fallback_once",
                "outside_coverage_unsupported"
            ]
        case .case07:
            [
                "canonical_intent_bound",
                "real_route_quality_ranked",
                "research_waypoints_visited",
                "viewpoint_preference_preserved"
            ]
        case .case08:
            [
                "canonical_intent_bound",
                "conservative_difficulty_applied",
                "real_route_quality_ranked",
                "research_waypoints_visited"
            ]
        case .case09:
            ["broad_region_clarification"]
        case .case10:
            [
                "canonical_intent_bound",
                "missing_official_current_evidence_visible",
                "real_route_quality_ranked",
                "research_waypoints_visited",
                "viewpoint_preference_preserved"
            ]
        case .case11:
            [
                "legacy_fallback_once",
                "unsupported_biking_fallback"
            ]
        case .case12:
            [
                "legacy_fallback_once",
                "unsupported_point_to_point_fallback"
            ]
        case .case13:
            [
                "cancelled_during_postgis",
                "canonical_intent_bound"
            ]
        case .case14:
            [
                "canonical_intent_bound",
                "graphhopper_timeout_observed",
                "legacy_fallback_once"
            ]
        case .case15:
            [
                "canonical_intent_bound",
                "partial_provider_failure_survivor",
                "real_route_quality_ranked",
                "research_waypoints_visited"
            ]
        case .case16:
            ["malformed_response_rejected_by_ios"]
        case .case17:
            ["feature_disabled_zero_research"]
        case .case18:
            [
                "canonical_intent_bound",
                "fresh_retry_after_failure",
                "legacy_fallback_once",
                "real_route_quality_ranked",
                "research_waypoints_visited"
            ]
        }
    }

    fileprivate var expectedLimitationCauseIDs: Set<String> {
        switch id {
        case .case01, .case02, .case03, .case04, .case07,
             .case08:
            ["access_unverified"]
        case .case05:
            ["insufficient_candidate_count"]
        case .case06:
            ["unsupported_region"]
        case .case09:
            ["unresolved_geography"]
        case .case10:
            ["access_unverified", "official_status_unverified"]
        case .case11:
            ["unsupported_activity"]
        case .case12:
            ["unsupported_route_type"]
        case .case13:
            []
        case .case14:
            ["graphhopper_timeout"]
        case .case15:
            ["access_unverified", "provider_failure"]
        case .case16:
            ["malformed_response"]
        case .case17:
            ["feature_disabled"]
        case .case18:
            ["access_unverified", "prior_attempt_failed"]
        }
    }

    func adventureIntent() -> AdventureIntent {
        let values = intentValues
        return AdventureIntent(
            rawPrompt: id.rawValue,
            parserSource: .localRuleBased,
            confidence: 1,
            activityType: values.activity,
            routeType: values.routeType,
            startLocationQuery: values.startQuery,
            endLocationQuery: values.endQuery,
            regionQuery: nil,
            targetDistanceKm: values.targetDistance,
            targetDurationMinutes: nil,
            difficulty: values.difficulty,
            desiredFeatures: values.desiredFeatures,
            avoidFeatures: values.avoidFeatures,
            mustHaveResearchExperiences:
                values.mustHaveExperiences
        )
    }

    func locationResolution(
        for query: String
    ) -> LocationResolution {
        let values = intentValues
        if query == values.startQuery {
            return .resolved(anchorCandidate)
        }
        if query == values.endQuery,
           id == .case12
        {
            return .resolved(Self.schierkeCandidate)
        }
        return .noResults(query: query)
    }

    private var intentValues: IntentValues {
        switch id {
        case .case01:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Ilsenburg",
                targetDistance: 15,
                desiredFeatures: [.forest, .viewpoint]
            )
        case .case02:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Schierke",
                targetDistance: 10,
                difficulty: .easy,
                desiredFeatures: [.quiet],
                avoidFeatures: [.majorRoads]
            )
        case .case03:
            IntentValues(
                activity: .trailRunning,
                routeType: .loop,
                startQuery: "Schierke",
                targetDistance: 10
            )
        case .case04:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Brocken",
                targetDistance: 15,
                mustHaveExperiences: [
                    MustHaveResearchExperienceConstraint(
                        experience: .peak
                    )
                ]
            )
        case .case05:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Ilsenburg",
                targetDistance: 12,
                mustHaveExperiences: [
                    MustHaveResearchExperienceConstraint(
                        experience: .landmark
                    )
                ]
            )
        case .case06:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Lüneburg",
                targetDistance: 10
            )
        case .case07:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Hungerburg",
                targetDistance: 12,
                desiredFeatures: [.viewpoint]
            )
        case .case08:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Hungerburg",
                targetDistance: 8,
                difficulty: .easy,
                avoidFeatures: [.steepClimbs]
            )
        case .case09:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Alps",
                targetDistance: nil
            )
        case .case10:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Hungerburg",
                targetDistance: 12,
                desiredFeatures: [.viewpoint]
            )
        case .case11:
            IntentValues(
                activity: .biking,
                routeType: .loop,
                startQuery: "Ilsenburg",
                targetDistance: 25
            )
        case .case12:
            IntentValues(
                activity: .hiking,
                routeType: .pointToPoint,
                startQuery: "Ilsenburg",
                endQuery: "Schierke",
                targetDistance: nil
            )
        case .case13, .case14:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: id == .case13
                    ? "Ilsenburg"
                    : "Schierke",
                targetDistance: 12
            )
        case .case15:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Schierke",
                targetDistance: 12,
                desiredFeatures: [.viewpoint]
            )
        case .case16, .case17:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Ilsenburg",
                targetDistance: id == .case16 ? 12 : 10
            )
        case .case18:
            IntentValues(
                activity: .hiking,
                routeType: .loop,
                startQuery: "Ilsenburg",
                targetDistance: 12,
                desiredFeatures: [.viewpoint]
            )
        }
    }

    private var anchorCandidate: LocationCandidate {
        switch id {
        case .case02, .case03, .case14, .case15:
            Self.schierkeCandidate
        case .case04:
            Self.brockenCandidate
        case .case06:
            Self.outsideCoverageCandidate
        case .case07, .case08, .case10:
            Self.hungerburgCandidate
        case .case09:
            Self.alpsCandidate
        case .case01, .case05, .case11, .case12, .case13,
             .case16, .case17, .case18:
            Self.ilsenburgCandidate
        }
    }

    private struct IntentValues {
        let activity: ActivityType
        let routeType: TrailRouteType
        let startQuery: String
        let endQuery: String?
        let targetDistance: Double?
        let difficulty: RouteDifficulty?
        let desiredFeatures: [DesiredFeature]
        let avoidFeatures: [AvoidFeature]
        let mustHaveExperiences:
            [MustHaveResearchExperienceConstraint]

        init(
            activity: ActivityType,
            routeType: TrailRouteType,
            startQuery: String,
            endQuery: String? = nil,
            targetDistance: Double?,
            difficulty: RouteDifficulty? = nil,
            desiredFeatures: [DesiredFeature] = [],
            avoidFeatures: [AvoidFeature] = [],
            mustHaveExperiences:
                [MustHaveResearchExperienceConstraint] = []
        ) {
            self.activity = activity
            self.routeType = routeType
            self.startQuery = startQuery
            self.endQuery = endQuery
            self.targetDistance = targetDistance
            self.difficulty = difficulty
            self.desiredFeatures = desiredFeatures
            self.avoidFeatures = avoidFeatures
            self.mustHaveExperiences = mustHaveExperiences
        }
    }

    private static let ilsenburgCandidate = candidate(
        id: "staging-anchor-harz-ilsenburg-v1",
        name: "Ilsenburg",
        coordinate: Coordinate(
            latitude: 51.8666,
            longitude: 10.6782
        ),
        semanticKind: .settlement,
        countryCode: "DE"
    )

    private static let schierkeCandidate = candidate(
        id: "staging-anchor-harz-schierke-v1",
        name: "Schierke",
        coordinate: Coordinate(
            latitude: 51.7636,
            longitude: 10.6647
        ),
        semanticKind: .settlement,
        countryCode: "DE"
    )

    private static let brockenCandidate = candidate(
        id: "staging-anchor-harz-brocken-v1",
        name: "Brocken",
        coordinate: Coordinate(
            latitude: 51.7992,
            longitude: 10.6171
        ),
        semanticKind: .landmark,
        countryCode: "DE"
    )

    private static let hungerburgCandidate = candidate(
        id: "staging-anchor-innsbruck-hungerburg-v1",
        name: "Hungerburg",
        coordinate: Coordinate(
            latitude: 47.2868,
            longitude: 11.3997
        ),
        semanticKind: .trailhead,
        countryCode: "AT"
    )

    private static let outsideCoverageCandidate = candidate(
        id: "staging-anchor-outside-reviewed-coverage-v1",
        name: "Lüneburg",
        coordinate: Coordinate(
            latitude: 53.2487,
            longitude: 10.4079
        ),
        semanticKind: .settlement,
        countryCode: "DE"
    )

    private static let alpsCandidate = candidate(
        id: "staging-anchor-alps-broad-region-v1",
        name: "Alps",
        coordinate: Coordinate(
            latitude: 47.0,
            longitude: 11.0
        ),
        semanticKind: .mountainRange,
        countryCode: nil
    )

    private static func candidate(
        id: String,
        name: String,
        coordinate: Coordinate,
        semanticKind: LocationSemanticKind,
        countryCode: String?
    ) -> LocationCandidate {
        LocationCandidate(
            id: id,
            name: name,
            displayName: name,
            coordinate: coordinate,
            semanticKind: semanticKind,
            countryCode: countryCode,
            provider: .appleGeocoder
        )
    }
}

private struct StagingProofIntentParsingProvider:
    IntentParsingProvider,
    Sendable
{
    let parserSource: IntentParserSource = .localRuleBased
    let fixture: StagingProofFixture

    func parseIntent(
        rawPrompt: String
    ) async throws -> AdventureIntent {
        guard rawPrompt == fixture.id.rawValue else {
            throw StagingProofLaunchRequestError
                .malformedArguments
        }
        return fixture.adventureIntent()
    }
}

@MainActor
private struct StagingProofLocationResolver: LocationResolving {
    let fixture: StagingProofFixture

    func resolve(
        _ context: LocationQueryContext
    ) async throws -> LocationResolution {
        fixture.locationResolution(for: context.originalQuery)
    }
}

enum StagingProofDigest {
    static func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    static func joined(_ values: [String]) -> String {
        sha256(
            values.enumerated().map {
                "\($0.offset):\($0.element.utf8.count):\($0.element)"
            }
            .joined(separator: "|")
        )
    }

    static func isSHA256(_ value: String) -> Bool {
        value.utf8.count == 64 &&
            value.unicodeScalars.allSatisfy {
                ($0.value >= 48 && $0.value <= 57) ||
                    ($0.value >= 97 && $0.value <= 102)
            }
    }
}

enum StagingProofTerminalState: String, Codable, Sendable {
    case routed
    case partial
    case clarification
    case unsupported
    case legacyFallback = "legacy_fallback"
    case cancelled
    case timedOut = "timed_out"
    case rejected
    case disabled
    case retrySucceeded = "retry_succeeded"
    case failed
}

enum StagingProofPlannerTerminalState: String, Codable, Sendable {
    case idle
    case generating
    case clarification
    case suggestionsReady = "suggestions_ready"
    case noRoutes = "no_routes"
    case recoverableError = "recoverable_error"
    case cancelled
}

enum StagingProofLane: String, Codable, Sendable {
    case live
    case controlled
}

enum StagingProofTimingBucket: String, Codable, Sendable {
    case under100Milliseconds = "under_100ms"
    case milliseconds100To499 = "100ms_to_499ms"
    case milliseconds500To999 = "500ms_to_999ms"
    case seconds1To4 = "1s_to_4s"
    case seconds5To14 = "5s_to_14s"
    case seconds15OrMore = "15s_or_more"

    static func measured(
        from startedAt: ContinuousClock.Instant,
        to finishedAt: ContinuousClock.Instant =
            ContinuousClock().now
    ) -> Self {
        measured(duration: startedAt.duration(to: finishedAt))
    }

    static func measured(duration: Duration) -> Self {
        let components = duration.components
        let milliseconds =
            Double(components.seconds) * 1_000 +
            Double(components.attoseconds) / 1_000_000_000_000_000
        return switch milliseconds {
        case ..<100:
            .under100Milliseconds
        case ..<500:
            .milliseconds100To499
        case ..<1_000:
            .milliseconds500To999
        case ..<5_000:
            .seconds1To4
        case ..<15_000:
            .seconds5To14
        default:
            .seconds15OrMore
        }
    }
}

enum StagingProofCheckState: String, Codable, Sendable {
    case passed
    case failed
    case notApplicable = "not_applicable"
}

struct StagingProofContractConversionReceipt:
    Codable,
    Equatable,
    Sendable
{
    let coordinatorSelectionOrderDigest: String?
    let plannerSuggestionOrderDigest: String?
    let acceptedCount: Int
    let rejectedCount: Int

    enum CodingKeys: String, CodingKey, CaseIterable {
        case coordinatorSelectionOrderDigest
        case plannerSuggestionOrderDigest
        case acceptedCount
        case rejectedCount
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(
            coordinatorSelectionOrderDigest,
            forKey: .coordinatorSelectionOrderDigest
        )
        try container.encode(
            plannerSuggestionOrderDigest,
            forKey: .plannerSuggestionOrderDigest
        )
        try container.encode(acceptedCount, forKey: .acceptedCount)
        try container.encode(rejectedCount, forKey: .rejectedCount)
    }
}

struct StagingProofPresentationReceipt:
    Codable,
    Equatable,
    Sendable
{
    let inputOrderDigest: String?
    let outputOrderDigest: String?
    let count: Int
    let kinds: [String]

    fileprivate enum CodingKeys: String, CodingKey, CaseIterable {
        case inputOrderDigest
        case outputOrderDigest
        case count
        case kinds
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(
            inputOrderDigest,
            forKey: .inputOrderDigest
        )
        try container.encode(
            outputOrderDigest,
            forKey: .outputOrderDigest
        )
        try container.encode(count, forKey: .count)
        try container.encode(kinds, forKey: .kinds)
    }
}

struct StagingProofCancellationReceipt:
    Codable,
    Equatable,
    Sendable
{
    let attemptDigest: String?
    let postCancelTerminalState: String?
    let postCancelCoordinatorResultCount: Int
    let postCancelLegacyRoutingCount: Int

    fileprivate enum CodingKeys: String, CodingKey, CaseIterable {
        case attemptDigest
        case postCancelTerminalState
        case postCancelCoordinatorResultCount
        case postCancelLegacyRoutingCount
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(attemptDigest, forKey: .attemptDigest)
        try container.encode(
            postCancelTerminalState,
            forKey: .postCancelTerminalState
        )
        try container.encode(
            postCancelCoordinatorResultCount,
            forKey: .postCancelCoordinatorResultCount
        )
        try container.encode(
            postCancelLegacyRoutingCount,
            forKey: .postCancelLegacyRoutingCount
        )
    }
}

struct StagingProofRetryReceipt:
    Codable,
    Equatable,
    Sendable
{
    let priorAttemptDigest: String?
    let currentAttemptDigest: String?
    let priorRequestIdDigest: String?
    let currentRequestIdDigest: String?
    let priorResultDigest: String?
    let priorTerminalState: String?
    let currentTerminalState: String?
    let currentResultDigest: String?
    let postResetPlannerTerminalState: String?
    let postResetSuggestionCount: Int
    let postResetResearchContextDigest: String?
    let postResetClarificationDigest: String?
    let postResetRecoveryDigest: String?

    fileprivate enum CodingKeys: String, CodingKey, CaseIterable {
        case priorAttemptDigest
        case currentAttemptDigest
        case priorRequestIdDigest
        case currentRequestIdDigest
        case priorResultDigest
        case priorTerminalState
        case currentTerminalState
        case currentResultDigest
        case postResetPlannerTerminalState
        case postResetSuggestionCount
        case postResetResearchContextDigest
        case postResetClarificationDigest
        case postResetRecoveryDigest
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(
            priorAttemptDigest,
            forKey: .priorAttemptDigest
        )
        try container.encode(
            currentAttemptDigest,
            forKey: .currentAttemptDigest
        )
        try container.encode(
            priorRequestIdDigest,
            forKey: .priorRequestIdDigest
        )
        try container.encode(
            currentRequestIdDigest,
            forKey: .currentRequestIdDigest
        )
        try container.encode(
            priorResultDigest,
            forKey: .priorResultDigest
        )
        try container.encode(
            priorTerminalState,
            forKey: .priorTerminalState
        )
        try container.encode(
            currentTerminalState,
            forKey: .currentTerminalState
        )
        try container.encode(
            currentResultDigest,
            forKey: .currentResultDigest
        )
        try container.encode(
            postResetPlannerTerminalState,
            forKey: .postResetPlannerTerminalState
        )
        try container.encode(
            postResetSuggestionCount,
            forKey: .postResetSuggestionCount
        )
        try container.encode(
            postResetResearchContextDigest,
            forKey: .postResetResearchContextDigest
        )
        try container.encode(
            postResetClarificationDigest,
            forKey: .postResetClarificationDigest
        )
        try container.encode(
            postResetRecoveryDigest,
            forKey: .postResetRecoveryDigest
        )
    }
}

struct StagingProofDiagnosticChecks:
    Codable,
    Equatable,
    Sendable
{
    let productionClientPath: StagingProofCheckState
    let contractConversion: StagingProofCheckState
    let qualityRanking: StagingProofCheckState
    let presentation: StagingProofCheckState
    let cancellation: StagingProofCheckState
    let retryFreshness: StagingProofCheckState

    fileprivate enum CodingKeys: String, CodingKey, CaseIterable {
        case productionClientPath
        case contractConversion
        case qualityRanking
        case presentation
        case cancellation
        case retryFreshness
    }
}

struct StagingProofReceiptV1: Codable, Equatable, Sendable {
    static let schemaVersion = 1
    static let proofVersion =
        "outdoor-adventure-staging-proof-v1"
    static let manifestDigest =
        "283a4f5c6210dbbc77516e3d6de684bfda800391c4f4aa3d08290193e77638a0"
    static let attachmentName =
        "TrailMind Outdoor Adventure Staging Proof Receipt v1"

    let schemaVersion: Int
    let proofVersion: String
    let manifestDigest: String
    let caseId: String
    let inputFixtureId: String
    let lane: StagingProofLane
    let nonceDigest: String
    let requestIdDigest: String?
    var resultDigest: String
    let proofTerminalState: StagingProofTerminalState
    let plannerTerminalState: StagingProofPlannerTerminalState
    let adapterState: String
    let researchOutcome: String
    let researchCoordinatorRequestCount: Int
    let legacyRoutingRequestCount: Int
    let plannerAttemptCount: Int
    let backendPlanningGapCodes: [String]
    let semanticObservationIds: [String]
    let limitationCauseIds: [String]
    let selectionState: String?
    let sourceEnvelopeState: String?
    let alternativeCount: Int
    let contractConversion: StagingProofContractConversionReceipt
    let presentation: StagingProofPresentationReceipt
    let cancellation: StagingProofCancellationReceipt
    let retry: StagingProofRetryReceipt
    let iosStageTimings: [String: [StagingProofTimingBucket]]
    let diagnosticChecks: StagingProofDiagnosticChecks
    let blockerCode: String?

    enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion
        case proofVersion
        case manifestDigest
        case caseId
        case inputFixtureId
        case lane
        case nonceDigest
        case requestIdDigest
        case resultDigest
        case proofTerminalState
        case plannerTerminalState
        case adapterState
        case researchOutcome
        case researchCoordinatorRequestCount
        case legacyRoutingRequestCount
        case plannerAttemptCount
        case backendPlanningGapCodes
        case semanticObservationIds
        case limitationCauseIds
        case selectionState
        case sourceEnvelopeState
        case alternativeCount
        case contractConversion
        case presentation
        case cancellation
        case retry
        case iosStageTimings
        case diagnosticChecks
        case blockerCode
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(proofVersion, forKey: .proofVersion)
        try container.encode(manifestDigest, forKey: .manifestDigest)
        try container.encode(caseId, forKey: .caseId)
        try container.encode(inputFixtureId, forKey: .inputFixtureId)
        try container.encode(lane, forKey: .lane)
        try container.encode(nonceDigest, forKey: .nonceDigest)
        try container.encode(requestIdDigest, forKey: .requestIdDigest)
        try container.encode(resultDigest, forKey: .resultDigest)
        try container.encode(
            proofTerminalState,
            forKey: .proofTerminalState
        )
        try container.encode(
            plannerTerminalState,
            forKey: .plannerTerminalState
        )
        try container.encode(adapterState, forKey: .adapterState)
        try container.encode(researchOutcome, forKey: .researchOutcome)
        try container.encode(
            researchCoordinatorRequestCount,
            forKey: .researchCoordinatorRequestCount
        )
        try container.encode(
            legacyRoutingRequestCount,
            forKey: .legacyRoutingRequestCount
        )
        try container.encode(
            plannerAttemptCount,
            forKey: .plannerAttemptCount
        )
        try container.encode(
            backendPlanningGapCodes,
            forKey: .backendPlanningGapCodes
        )
        try container.encode(
            semanticObservationIds,
            forKey: .semanticObservationIds
        )
        try container.encode(
            limitationCauseIds,
            forKey: .limitationCauseIds
        )
        try container.encode(selectionState, forKey: .selectionState)
        try container.encode(
            sourceEnvelopeState,
            forKey: .sourceEnvelopeState
        )
        try container.encode(alternativeCount, forKey: .alternativeCount)
        try container.encode(
            contractConversion,
            forKey: .contractConversion
        )
        try container.encode(presentation, forKey: .presentation)
        try container.encode(cancellation, forKey: .cancellation)
        try container.encode(retry, forKey: .retry)
        try container.encode(
            iosStageTimings,
            forKey: .iosStageTimings
        )
        try container.encode(
            diagnosticChecks,
            forKey: .diagnosticChecks
        )
        try container.encode(blockerCode, forKey: .blockerCode)
    }
}

enum StagingProofResultDigestV1 {
    static let schema =
        "trailmind-ios-runtime-result-digest-v1"
    static let stageOrder = [
        "adapter_conversion",
        "research_coordinator",
        "legacy_routing",
        "response_conversion",
        "route_quality",
        "presentation_projection",
        "end_to_end"
    ]

    static func compute(
        _ receipt: StagingProofReceiptV1
    ) -> String {
        var components = [schema]

        func append(_ label: String, _ value: String) {
            components.append(label)
            components.append(value)
        }
        func appendOptional(
            _ label: String,
            _ value: String?
        ) {
            append(label, value ?? "null")
        }
        func appendList(
            _ label: String,
            _ values: [String]
        ) {
            components.append(label)
            components.append(String(values.count))
            components.append(contentsOf: values)
        }

        append("schemaVersion", String(receipt.schemaVersion))
        append("proofVersion", receipt.proofVersion)
        append("manifestDigest", receipt.manifestDigest)
        append("caseId", receipt.caseId)
        append("inputFixtureId", receipt.inputFixtureId)
        append("lane", receipt.lane.rawValue)
        append("nonceDigest", receipt.nonceDigest)
        appendOptional(
            "requestIdDigest",
            receipt.requestIdDigest
        )
        append(
            "proofTerminalState",
            receipt.proofTerminalState.rawValue
        )
        append(
            "plannerTerminalState",
            receipt.plannerTerminalState.rawValue
        )
        append("adapterState", receipt.adapterState)
        append("researchOutcome", receipt.researchOutcome)
        append(
            "researchCoordinatorRequestCount",
            String(receipt.researchCoordinatorRequestCount)
        )
        append(
            "legacyRoutingRequestCount",
            String(receipt.legacyRoutingRequestCount)
        )
        append(
            "plannerAttemptCount",
            String(receipt.plannerAttemptCount)
        )
        appendList(
            "backendPlanningGapCodes",
            receipt.backendPlanningGapCodes
        )
        appendList(
            "semanticObservationIds",
            receipt.semanticObservationIds
        )
        appendList(
            "limitationCauseIds",
            receipt.limitationCauseIds
        )
        appendOptional(
            "selectionState",
            receipt.selectionState
        )
        appendOptional(
            "sourceEnvelopeState",
            receipt.sourceEnvelopeState
        )
        append(
            "alternativeCount",
            String(receipt.alternativeCount)
        )
        appendOptional(
            "contractConversion.coordinatorSelectionOrderDigest",
            receipt.contractConversion
                .coordinatorSelectionOrderDigest
        )
        appendOptional(
            "contractConversion.plannerSuggestionOrderDigest",
            receipt.contractConversion
                .plannerSuggestionOrderDigest
        )
        append(
            "contractConversion.acceptedCount",
            String(receipt.contractConversion.acceptedCount)
        )
        append(
            "contractConversion.rejectedCount",
            String(receipt.contractConversion.rejectedCount)
        )
        appendOptional(
            "presentation.inputOrderDigest",
            receipt.presentation.inputOrderDigest
        )
        appendOptional(
            "presentation.outputOrderDigest",
            receipt.presentation.outputOrderDigest
        )
        append(
            "presentation.count",
            String(receipt.presentation.count)
        )
        appendList(
            "presentation.kinds",
            receipt.presentation.kinds
        )
        appendOptional(
            "cancellation.attemptDigest",
            receipt.cancellation.attemptDigest
        )
        appendOptional(
            "cancellation.postCancelTerminalState",
            receipt.cancellation.postCancelTerminalState
        )
        append(
            "cancellation.postCancelCoordinatorResultCount",
            String(
                receipt.cancellation
                    .postCancelCoordinatorResultCount
            )
        )
        append(
            "cancellation.postCancelLegacyRoutingCount",
            String(
                receipt.cancellation
                    .postCancelLegacyRoutingCount
            )
        )
        appendOptional(
            "retry.priorAttemptDigest",
            receipt.retry.priorAttemptDigest
        )
        appendOptional(
            "retry.currentAttemptDigest",
            receipt.retry.currentAttemptDigest
        )
        appendOptional(
            "retry.priorRequestIdDigest",
            receipt.retry.priorRequestIdDigest
        )
        appendOptional(
            "retry.currentRequestIdDigest",
            receipt.retry.currentRequestIdDigest
        )
        appendOptional(
            "retry.priorResultDigest",
            receipt.retry.priorResultDigest
        )
        appendOptional(
            "retry.priorTerminalState",
            receipt.retry.priorTerminalState
        )
        appendOptional(
            "retry.currentTerminalState",
            receipt.retry.currentTerminalState
        )
        appendOptional(
            "retry.currentResultDigest",
            receipt.retry.currentResultDigest
        )
        appendOptional(
            "retry.postResetPlannerTerminalState",
            receipt.retry.postResetPlannerTerminalState
        )
        append(
            "retry.postResetSuggestionCount",
            String(receipt.retry.postResetSuggestionCount)
        )
        appendOptional(
            "retry.postResetResearchContextDigest",
            receipt.retry.postResetResearchContextDigest
        )
        appendOptional(
            "retry.postResetClarificationDigest",
            receipt.retry.postResetClarificationDigest
        )
        appendOptional(
            "retry.postResetRecoveryDigest",
            receipt.retry.postResetRecoveryDigest
        )
        for stage in stageOrder {
            appendList(
                "iosStageTimings.\(stage)",
                (receipt.iosStageTimings[stage] ?? [])
                    .map(\.rawValue)
            )
        }
        append(
            "diagnosticChecks.productionClientPath",
            receipt.diagnosticChecks.productionClientPath.rawValue
        )
        append(
            "diagnosticChecks.contractConversion",
            receipt.diagnosticChecks.contractConversion.rawValue
        )
        append(
            "diagnosticChecks.qualityRanking",
            receipt.diagnosticChecks.qualityRanking.rawValue
        )
        append(
            "diagnosticChecks.presentation",
            receipt.diagnosticChecks.presentation.rawValue
        )
        append(
            "diagnosticChecks.cancellation",
            receipt.diagnosticChecks.cancellation.rawValue
        )
        append(
            "diagnosticChecks.retryFreshness",
            receipt.diagnosticChecks.retryFreshness.rawValue
        )
        appendOptional("blockerCode", receipt.blockerCode)
        return StagingProofDigest.joined(components)
    }
}

enum StagingProofReceiptCodec {
    static let maximumBytes = 64 * 1_024
    static let stageKeys =
        Set(StagingProofResultDigestV1.stageOrder)
    static let semanticObservationVocabulary: Set<String> = [
        "broad_region_clarification",
        "brocken_anchor_returned",
        "cancelled_during_postgis",
        "canonical_intent_bound",
        "conservative_difficulty_applied",
        "feature_disabled_zero_research",
        "fresh_retry_after_failure",
        "named_brocken_must_have_satisfied",
        "graphhopper_timeout_observed",
        "legacy_fallback_once",
        "malformed_response_rejected_by_ios",
        "missing_official_current_evidence_visible",
        "must_have_shortfall_observed",
        "outside_coverage_unsupported",
        "partial_provider_failure_survivor",
        "path_and_road_preferences_preserved",
        "real_route_quality_ranked",
        "research_waypoints_visited",
        "trail_running_activity_preserved",
        "unsupported_biking_fallback",
        "unsupported_point_to_point_fallback",
        "viewpoint_forest_preferences_preserved",
        "viewpoint_preference_preserved"
    ]
    static let limitationCauseVocabulary: Set<String> = [
        "access_unverified",
        "feature_disabled",
        "graphhopper_timeout",
        "malformed_response",
        "insufficient_candidate_count",
        "official_status_unverified",
        "prior_attempt_failed",
        "provider_failure",
        "unresolved_geography",
        "unsupported_activity",
        "unsupported_route_type",
        "unsupported_region"
    ]
    static let blockerVocabulary: Set<String> = [
        "physical_device_required",
        "research_feature_disabled",
        "research_feature_unexpectedly_enabled",
        "backend_base_url_missing",
        "controlled_case_requires_external_runner",
        "causal_server_binding_missing",
        "unexpected_terminal",
        "retry_precondition_missing",
        "retry_stale_state",
        "cancellation_authorization_not_observed",
        "postgres_cancellation_gate_failed",
        "simulator_development_session_non_proof",
        "receipt_encoding_failed"
    ]
    static let presentationKindVocabulary: Set<String> = [
        "research_guided",
        "research_guided_partial",
        "standard_route_fallback",
        "standard_route",
        "clarification",
        "unsupported"
    ]
    static let planningGapCodeVocabulary: Set<String> = [
        "unsupported_region",
        "unsupported_evidence_dimension",
        "official_source_unavailable",
        "current_source_unavailable",
        "mapped_source_unavailable",
        "derived_source_unavailable",
        "operation_type_unavailable",
        "predicate_unavailable",
        "transport_evidence_not_modeled",
        "biking_network_not_modeled",
        "toilet_evidence_not_modeled",
        "scenic_quality_not_verifiable",
        "water_availability_source_missing"
    ]

    enum CodecError: Error, Equatable {
        case tooLarge
        case malformed
        case unexpectedFields
        case invalidValue
    }

    static func encode(
        _ receipt: StagingProofReceiptV1
    ) throws -> Data {
        try validate(receipt)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(receipt)
        guard data.count <= maximumBytes else {
            throw CodecError.tooLarge
        }
        return data
    }

    static func decode(_ data: Data) throws -> StagingProofReceiptV1 {
        guard data.count <= maximumBytes else {
            throw CodecError.tooLarge
        }
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(
                with: data,
                options: []
            )
        } catch {
            throw CodecError.malformed
        }
        guard let root = object as? [String: Any],
              Set(root.keys) ==
                Set(StagingProofReceiptV1.CodingKeys.allCases.map(\.rawValue)),
              exactNestedFields(
                root["contractConversion"],
                keys: StagingProofContractConversionReceipt
                    .CodingKeys.allCases.map(\.rawValue)
              ),
              exactNestedFields(
                root["presentation"],
                keys: StagingProofPresentationReceipt
                    .CodingKeys.allCases.map(\.rawValue)
              ),
              exactNestedFields(
                root["cancellation"],
                keys: StagingProofCancellationReceipt
                    .CodingKeys.allCases.map(\.rawValue)
              ),
              exactNestedFields(
                root["retry"],
                keys: StagingProofRetryReceipt
                    .CodingKeys.allCases.map(\.rawValue)
              ),
              exactNestedFields(
                root["diagnosticChecks"],
                keys: StagingProofDiagnosticChecks
                    .CodingKeys.allCases.map(\.rawValue)
              ),
              let timings = root["iosStageTimings"] as? [String: Any],
              Set(timings.keys) == stageKeys
        else {
            throw CodecError.unexpectedFields
        }
        let receipt: StagingProofReceiptV1
        do {
            receipt = try JSONDecoder().decode(
                StagingProofReceiptV1.self,
                from: data
            )
        } catch {
            throw CodecError.malformed
        }
        try validate(receipt)
        return receipt
    }

    static func validate(
        _ receipt: StagingProofReceiptV1
    ) throws {
        let optionalDigests = [
            receipt.requestIdDigest,
            receipt.contractConversion
                .coordinatorSelectionOrderDigest,
            receipt.contractConversion
                .plannerSuggestionOrderDigest,
            receipt.presentation.inputOrderDigest,
            receipt.presentation.outputOrderDigest,
            receipt.cancellation.attemptDigest,
            receipt.retry.priorAttemptDigest,
            receipt.retry.currentAttemptDigest,
            receipt.retry.priorRequestIdDigest,
            receipt.retry.currentRequestIdDigest,
            receipt.retry.priorResultDigest,
            receipt.retry.currentResultDigest,
            receipt.retry.postResetResearchContextDigest,
            receipt.retry.postResetClarificationDigest,
            receipt.retry.postResetRecoveryDigest
        ]
        guard receipt.schemaVersion ==
                StagingProofReceiptV1.schemaVersion,
              receipt.proofVersion ==
                StagingProofReceiptV1.proofVersion,
              receipt.manifestDigest ==
                StagingProofReceiptV1.manifestDigest,
              StagingProofDigest.isSHA256(receipt.nonceDigest),
              StagingProofDigest.isSHA256(receipt.resultDigest),
              receipt.resultDigest ==
                StagingProofResultDigestV1.compute(receipt),
              optionalDigests.compactMap({ $0 }).allSatisfy(
                StagingProofDigest.isSHA256
              ),
              StagingProofCaseID(rawValue: receipt.caseId) != nil,
              StagingProofInputFixtureID(
                rawValue: receipt.inputFixtureId
              )?.proofCaseID.rawValue == receipt.caseId,
              (0...2).contains(
                  receipt.researchCoordinatorRequestCount
              ),
              (0...1).contains(receipt.legacyRoutingRequestCount),
              (0...2).contains(receipt.plannerAttemptCount),
              (0...32).contains(receipt.alternativeCount),
              (0...32).contains(
                  receipt.contractConversion.acceptedCount
              ),
              (0...32).contains(
                  receipt.contractConversion.rejectedCount
              ),
              (0...32).contains(receipt.presentation.count),
              receipt.cancellation
                .postCancelCoordinatorResultCount >= 0,
              receipt.cancellation
                .postCancelCoordinatorResultCount <= 2,
              receipt.cancellation
                .postCancelLegacyRoutingCount >= 0,
              receipt.cancellation
                .postCancelLegacyRoutingCount <= 1,
              Set(receipt.iosStageTimings.keys) == stageKeys,
              receipt.iosStageTimings.values.allSatisfy({
                  $0.count <= 8
              }),
              [
                  "not_observed",
                  "ready",
                  "clarification_required",
                  "unsupported"
              ].contains(receipt.adapterState),
              [
                  "none",
                  "failure",
                  "clarification_required",
                  "unsupported",
                  "no_viable_route",
                  "partial",
                  "routed"
              ].contains(receipt.researchOutcome),
              receipt.selectionState.map({
                  [
                      "routed",
                      "partial",
                      "no_viable_route",
                      "unsupported"
                  ].contains($0)
              }) ?? true,
              receipt.sourceEnvelopeState.map({
                  [
                      "routed",
                      "partial",
                      "no_viable_route",
                      "unsupported"
                  ].contains($0)
              }) ?? true,
              receipt.backendPlanningGapCodes.allSatisfy(
                  planningGapCodeVocabulary.contains
              ),
              receipt.semanticObservationIds.allSatisfy(
                  semanticObservationVocabulary.contains
              ),
              receipt.limitationCauseIds.allSatisfy(
                  limitationCauseVocabulary.contains
              ),
              receipt.presentation.kinds.allSatisfy(
                  presentationKindVocabulary.contains
              ),
              receipt.blockerCode.map(
                  blockerVocabulary.contains
              ) ?? true,
              receipt.contractConversion.acceptedCount == 0 ||
                (
                    receipt.contractConversion
                        .coordinatorSelectionOrderDigest != nil &&
                    receipt.contractConversion
                        .plannerSuggestionOrderDigest != nil
                ),
              receipt.presentation.kinds.count ==
                receipt.presentation.count,
              (
                  receipt.presentation.count == 0 &&
                    receipt.presentation.inputOrderDigest == nil &&
                    receipt.presentation.outputOrderDigest == nil
              ) ||
                (
                    receipt.presentation.count == 1 &&
                    receipt.presentation.kinds == ["clarification"] &&
                    receipt.presentation.inputOrderDigest == nil &&
                    receipt.presentation.outputOrderDigest != nil
                ) ||
                (
                    receipt.presentation.inputOrderDigest != nil &&
                    receipt.presentation.outputOrderDigest != nil
                ),
              receipt.cancellation.postCancelTerminalState.map({
                  StagingProofPlannerTerminalState(rawValue: $0) != nil
              }) ?? true,
              receipt.retry.priorTerminalState.map({
                  StagingProofPlannerTerminalState(rawValue: $0) != nil
              }) ?? true,
              receipt.retry.currentTerminalState.map({
                  StagingProofPlannerTerminalState(rawValue: $0) != nil
              }) ?? true,
              receipt.retry.postResetPlannerTerminalState.map({
                  StagingProofPlannerTerminalState(rawValue: $0) != nil
              }) ?? true,
              (0...32).contains(
                  receipt.retry.postResetSuggestionCount
              ),
              receipt.retry.postResetPlannerTerminalState != nil ||
                (
                    receipt.retry.postResetSuggestionCount == 0 &&
                    receipt.retry
                        .postResetResearchContextDigest == nil &&
                    receipt.retry
                        .postResetClarificationDigest == nil &&
                    receipt.retry.postResetRecoveryDigest == nil
                ),
              receipt.semanticObservationIds ==
                Array(Set(receipt.semanticObservationIds)).sorted(),
              receipt.limitationCauseIds ==
                Array(Set(receipt.limitationCauseIds)).sorted(),
              receipt.backendPlanningGapCodes ==
                Array(Set(receipt.backendPlanningGapCodes)).sorted()
        else {
            throw CodecError.invalidValue
        }
    }

    private static func exactNestedFields(
        _ input: Any?,
        keys: [String]
    ) -> Bool {
        guard let object = input as? [String: Any] else {
            return false
        }
        return Set(object.keys) == Set(keys)
    }
}

private struct StagingProofRecorderSnapshot: Sendable {
    let attemptDigests: [String]
    let requestIdDigests: [String]
    let researchFeatureGateEvaluationCount: Int
    let lastResearchFeatureGateValue: Bool?
    let adapterState: String
    let submittedIntentDigest: String?
    let normalizedIntentDigest: String?
    let researchCoordinatorRequestCount: Int
    let researchCoordinatorResultCount: Int
    let legacyRoutingRequestCount: Int
    let researchOutcome: String
    let backendPlanningGapCodes: [String]
    let semanticObservationIds: [String]
    let limitationCauseIds: [String]
    let selectionState: String?
    let sourceEnvelopeState: String?
    let alternativeCount: Int
    let coordinatorSelectionOrderDigest: String?
    let acceptedCount: Int
    let rejectedCount: Int
    let cancellationAttemptDigest: String?
    let postCancelCoordinatorResultCount: Int
    let postCancelLegacyRoutingCount: Int
    let retryPriorTerminalState: String?
    let retryPriorResultDigest: String?
    let retryPriorAttemptDigest: String?
    let retryPriorRequestIdDigest: String?
    let retryPostResetPlannerTerminalState: String?
    let retryPostResetSuggestionCount: Int
    let retryPostResetResearchContextDigest: String?
    let retryPostResetClarificationDigest: String?
    let retryPostResetRecoveryDigest: String?
    let timings: [String: [StagingProofTimingBucket]]
}

private final class StagingProofRuntimeRecorder:
    @unchecked Sendable
{
    private let lock = NSLock()
    private var attemptDigests: [String] = []
    private var requestIdDigests: [String] = []
    private var researchFeatureGateEvaluations: [Bool] = []
    private var adapterState = "not_observed"
    private var submittedIntentDigest: String?
    private var normalizedIntentDigest: String?
    private var researchCoordinatorRequestCount = 0
    private var researchCoordinatorResultCount = 0
    private var legacyRoutingRequestCount = 0
    private var researchOutcome = "none"
    private var backendPlanningGapCodes: Set<String> = []
    private var semanticObservationIds: Set<String> = []
    private var limitationCauseIds: Set<String> = []
    private var selectionState: String?
    private var sourceEnvelopeState: String?
    private var alternativeCount = 0
    private var coordinatorSelectionOrderDigest: String?
    private var acceptedCount = 0
    private var rejectedCount = 0
    private var cancellationAttemptDigest: String?
    private var cancellationCoordinatorResultBaseline: Int?
    private var cancellationLegacyRoutingBaseline: Int?
    private var retryPriorTerminalState: String?
    private var retryPriorResultDigest: String?
    private var retryPriorAttemptDigest: String?
    private var retryPriorRequestIdDigest: String?
    private var retryPostResetPlannerTerminalState: String?
    private var retryPostResetSuggestionCount = 0
    private var retryPostResetResearchContextDigest: String?
    private var retryPostResetClarificationDigest: String?
    private var retryPostResetRecoveryDigest: String?
    private var timings: [
        String: [StagingProofTimingBucket]
    ] = Dictionary(
        uniqueKeysWithValues:
            StagingProofReceiptCodec.stageKeys.map {
                ($0, [StagingProofTimingBucket]())
            }
    )

    func recordAttempt(_ id: UUID) {
        withLock {
            attemptDigests.append(
                StagingProofDigest.sha256(
                    id.uuidString.lowercased()
                )
            )
        }
    }

    func recordRequestID(_ id: UUID) {
        withLock {
            requestIdDigests.append(
                StagingProofDigest.sha256(
                    id.uuidString.lowercased()
                )
            )
        }
    }

    func recordResearchFeatureGate(_ isEnabled: Bool) {
        withLock {
            researchFeatureGateEvaluations.append(isEnabled)
        }
    }

    func recordAdapter(
        result: AdventureResearchIntentAdapterResultV1,
        timing: StagingProofTimingBucket
    ) {
        withLock {
            adapterState = result.state.rawValue
            timings["adapter_conversion", default: []].append(timing)
            guard let intent = result.intent else {
                if result.gaps.contains(.activityNotSupported) {
                    semanticObservationIds.insert(
                        "unsupported_biking_fallback"
                    )
                    limitationCauseIds.insert("unsupported_activity")
                }
                if result.gaps.contains(
                    .pointToPointDestinationNotRepresentable
                ) {
                    semanticObservationIds.insert(
                        "unsupported_point_to_point_fallback"
                    )
                    limitationCauseIds.insert("unsupported_route_type")
                }
                return
            }
            submittedIntentDigest = Self.intentDigest(intent)
            observeSubmittedIntent(intent)
            if result.state == .clarificationRequired {
                semanticObservationIds.insert(
                    "broad_region_clarification"
                )
                limitationCauseIds.insert("unresolved_geography")
            }
        }
    }

    func recordCoordinatorStart(
        intent: AdventureResearchIntentV1
    ) {
        withLock {
            researchCoordinatorRequestCount += 1
            if Self.intentDigest(intent) == submittedIntentDigest {
                semanticObservationIds.insert(
                    "canonical_intent_bound"
                )
            }
        }
    }

    func recordCoordinator(
        result: OutdoorAdventurePlanningCoordinatorResultV1,
        timing: StagingProofTimingBucket
    ) {
        withLock {
            researchCoordinatorResultCount += 1
            researchOutcome = result.state.rawValue
            timings["research_coordinator", default: []].append(timing)
            normalizedIntentDigest = Self.intentDigest(
                result.normalizedIntent
            )
            if normalizedIntentDigest == submittedIntentDigest {
                semanticObservationIds.insert(
                    "canonical_intent_bound"
                )
            }
            observePlanningGaps(result.planningGaps)

            guard let selection = result.routeSelection else {
                if result.state == .noViableRoute {
                    researchOutcome = "no_viable_route"
                } else if result.state == .unsupported {
                    researchOutcome = "unsupported"
                }
                return
            }
            selectionState = selection.state.rawValue
            sourceEnvelopeState =
                selection.sourceEnvelopeState.rawValue
            alternativeCount = selection.alternatives.count
            acceptedCount = selection.alternatives.count
            rejectedCount = selection.rejectionCounts.values.reduce(
                0,
                +
            )
            coordinatorSelectionOrderDigest =
                Self.routeOrderDigest(
                    selection.alternatives.map(\.suggestion)
                )
            if !selection.alternatives.isEmpty {
                semanticObservationIds.insert(
                    "real_route_quality_ranked"
                )
            }
            let viaVisits = selection.alternatives.flatMap {
                $0.waypointVisits.filter { $0.role == .via }
            }
            for alternative in selection.alternatives {
                observeLimitations(
                    alternative.researchProvenance
                        .knownLimitations.map(\.rawValue)
                )
            }
            if !viaVisits.isEmpty,
               viaVisits.allSatisfy(\.isResearchWaypointReached)
            {
                semanticObservationIds.insert(
                    "research_waypoints_visited"
                )
            }
            observeSelectionSemantics(
                selection,
                normalizedIntent: result.normalizedIntent
            )
            observeLimitations(selection.remainingLimitations)
        }
    }

    func recordCoordinatorFailure(
        _ error: Error,
        timing: StagingProofTimingBucket
    ) {
        withLock {
            researchOutcome = "failure"
            timings["research_coordinator", default: []].append(timing)
            if let failure =
                error as? OutdoorAdventurePlanningCoordinatorFailureV1,
               failure == .timedOut
            {
                semanticObservationIds.insert(
                    "graphhopper_timeout_observed"
                )
                limitationCauseIds.insert("graphhopper_timeout")
            }
            if let failure =
                error as? OutdoorAdventurePlanningCoordinatorFailureV1,
               failure == .invalidResult
            {
                semanticObservationIds.insert(
                    "malformed_response_rejected_by_ios"
                )
                limitationCauseIds.insert("malformed_response")
            }
        }
    }

    func recordResponseValidation(
        duration: Duration
    ) {
        withLock {
            timings["response_conversion", default: []].append(
                .measured(duration: duration)
            )
        }
    }

    func recordQualitySelection(
        duration: Duration
    ) {
        withLock {
            timings["route_quality", default: []].append(
                .measured(duration: duration)
            )
        }
    }

    func recordLegacyRouting(
        timing: StagingProofTimingBucket
    ) {
        withLock {
            legacyRoutingRequestCount += 1
            timings["legacy_routing", default: []].append(timing)
            if legacyRoutingRequestCount == 1 {
                semanticObservationIds.insert("legacy_fallback_once")
            }
        }
    }

    func recordTiming(
        _ stage: String,
        _ timing: StagingProofTimingBucket
    ) {
        withLock {
            guard StagingProofReceiptCodec.stageKeys.contains(stage) else {
                return
            }
            timings[stage, default: []].append(timing)
        }
    }

    func markCancellation() {
        withLock {
            cancellationAttemptDigest = attemptDigests.last
            cancellationCoordinatorResultBaseline =
                researchCoordinatorResultCount
            cancellationLegacyRoutingBaseline =
                legacyRoutingRequestCount
        }
    }

    func markRetryPrior(
        terminalState: StagingProofPlannerTerminalState,
        resultDigest: String
    ) {
        withLock {
            retryPriorTerminalState = terminalState.rawValue
            retryPriorResultDigest = resultDigest
            retryPriorAttemptDigest = attemptDigests.last
            retryPriorRequestIdDigest = requestIdDigests.last
            limitationCauseIds.insert("prior_attempt_failed")
        }
    }

    func recordRetryPostResetState(
        plannerTerminalState: StagingProofPlannerTerminalState,
        suggestionCount: Int,
        hasResearchContext: Bool,
        hasClarification: Bool,
        hasRecovery: Bool
    ) {
        withLock {
            retryPostResetPlannerTerminalState =
                plannerTerminalState.rawValue
            retryPostResetSuggestionCount = suggestionCount
            retryPostResetResearchContextDigest =
                hasResearchContext
                    ? StagingProofDigest.sha256(
                        "post_reset_research_context_present"
                    )
                    : nil
            retryPostResetClarificationDigest =
                hasClarification
                    ? StagingProofDigest.sha256(
                        "post_reset_clarification_present"
                    )
                    : nil
            retryPostResetRecoveryDigest =
                hasRecovery
                    ? StagingProofDigest.sha256(
                        "post_reset_recovery_present"
                    )
                    : nil
        }
    }

    func addSemanticObservation(_ value: String) {
        _ = withLock {
            semanticObservationIds.insert(value)
        }
    }

    func addLimitationCause(_ value: String) {
        _ = withLock {
            limitationCauseIds.insert(value)
        }
    }

    func snapshot() -> StagingProofRecorderSnapshot {
        withLock {
            StagingProofRecorderSnapshot(
                attemptDigests: attemptDigests,
                requestIdDigests: requestIdDigests,
                researchFeatureGateEvaluationCount:
                    researchFeatureGateEvaluations.count,
                lastResearchFeatureGateValue:
                    researchFeatureGateEvaluations.last,
                adapterState: adapterState,
                submittedIntentDigest: submittedIntentDigest,
                normalizedIntentDigest: normalizedIntentDigest,
                researchCoordinatorRequestCount:
                    researchCoordinatorRequestCount,
                researchCoordinatorResultCount:
                    researchCoordinatorResultCount,
                legacyRoutingRequestCount:
                    legacyRoutingRequestCount,
                researchOutcome: researchOutcome,
                backendPlanningGapCodes:
                    backendPlanningGapCodes.sorted(),
                semanticObservationIds:
                    semanticObservationIds.sorted(),
                limitationCauseIds: limitationCauseIds.sorted(),
                selectionState: selectionState,
                sourceEnvelopeState: sourceEnvelopeState,
                alternativeCount: alternativeCount,
                coordinatorSelectionOrderDigest:
                    coordinatorSelectionOrderDigest,
                acceptedCount: acceptedCount,
                rejectedCount: rejectedCount,
                cancellationAttemptDigest:
                    cancellationAttemptDigest,
                postCancelCoordinatorResultCount: max(
                    0,
                    researchCoordinatorResultCount -
                        (cancellationCoordinatorResultBaseline ??
                            researchCoordinatorResultCount)
                ),
                postCancelLegacyRoutingCount: max(
                    0,
                    legacyRoutingRequestCount -
                        (cancellationLegacyRoutingBaseline ??
                            legacyRoutingRequestCount)
                ),
                retryPriorTerminalState:
                    retryPriorTerminalState,
                retryPriorResultDigest: retryPriorResultDigest,
                retryPriorAttemptDigest: retryPriorAttemptDigest,
                retryPriorRequestIdDigest:
                    retryPriorRequestIdDigest,
                retryPostResetPlannerTerminalState:
                    retryPostResetPlannerTerminalState,
                retryPostResetSuggestionCount:
                    retryPostResetSuggestionCount,
                retryPostResetResearchContextDigest:
                    retryPostResetResearchContextDigest,
                retryPostResetClarificationDigest:
                    retryPostResetClarificationDigest,
                retryPostResetRecoveryDigest:
                    retryPostResetRecoveryDigest,
                timings: timings
            )
        }
    }

    private func observeSubmittedIntent(
        _ intent: AdventureResearchIntentV1
    ) {
        let preferred = Set(intent.preferredExperiences)
        let avoided = Set(intent.avoidedExperiences)
        if preferred.isSuperset(of: [.forest, .viewpoint]) {
            semanticObservationIds.insert(
                "viewpoint_forest_preferences_preserved"
            )
        }
        if preferred.contains(.viewpoint),
           !preferred.contains(.forest)
        {
            semanticObservationIds.insert(
                "viewpoint_preference_preserved"
            )
        }
        if preferred.contains(.quietTrails),
           avoided.contains(.majorRoads)
        {
            semanticObservationIds.insert(
                "path_and_road_preferences_preserved"
            )
        }
        if intent.maximumTechnicalDifficulty == .hiking,
           avoided.contains(.steepClimbs) ||
            preferred.contains(.quietTrails)
        {
            semanticObservationIds.insert(
                "conservative_difficulty_applied"
            )
        }
        if intent.activity == .trailRunning {
            semanticObservationIds.insert(
                "trail_running_activity_preserved"
            )
        }
    }

    private func observeSelectionSemantics(
        _ selection: ResearchGuidedRouteSelectionV1,
        normalizedIntent: AdventureResearchIntentV1
    ) {
        let brockenAnchorCoordinate:
            AdventureResearchCoordinateV1?
        if case let .resolved(name, coordinate, _) =
                normalizedIntent.geographicAnchor,
           name == "Brocken"
        {
            brockenAnchorCoordinate = coordinate
        } else {
            brockenAnchorCoordinate = nil
        }
        guard let brockenAnchorCoordinate else {
            return
        }
        var allBrockenAlternativesBound =
            !selection.alternatives.isEmpty

        for alternative in selection.alternatives {
            let reachedMustHavePeaks =
                alternative.researchProvenance
                    .selectedWaypoints.filter { waypoint in
                        guard waypoint.role == .mustHave,
                              waypoint.highlightCategory == .peak,
                              waypoint.selectionReasons.contains(
                                  .requiredExperience
                              ),
                              Self.sameHorizontalCoordinate(
                                  waypoint.coordinate,
                                  brockenAnchorCoordinate
                              )
                        else {
                            return false
                        }
                        return alternative.waypointVisits.contains {
                            visit in
                            visit.role == .via &&
                                visit.entityID ==
                                    waypoint.entityID &&
                                visit.isResearchWaypointReached &&
                                Self.sameHorizontalCoordinate(
                                    visit.requestedCoordinate,
                                    waypoint.coordinate
                                ) &&
                                Self.sameHorizontalCoordinate(
                                    visit.requestedCoordinate,
                                    brockenAnchorCoordinate
                                )
                        }
                    }
            let reachedNamedBrockenPeak =
                !reachedMustHavePeaks.isEmpty
            guard reachedNamedBrockenPeak else {
                allBrockenAlternativesBound = false
                continue
            }
            let reachedAnchor =
                alternative.waypointVisits.contains {
                    $0.role == .anchor &&
                    $0.snappedCoordinate != nil &&
                    $0.snapDistanceMeters != nil &&
                    Self.sameHorizontalCoordinate(
                        $0.requestedCoordinate,
                        brockenAnchorCoordinate
                    ) &&
                    $0.withinVisitTolerance
                }
            let reachedReturnAnchor =
                alternative.waypointVisits.contains {
                    $0.role == .returnAnchor &&
                    $0.snappedCoordinate != nil &&
                    $0.snapDistanceMeters != nil &&
                    Self.sameHorizontalCoordinate(
                        $0.requestedCoordinate,
                        brockenAnchorCoordinate
                    ) &&
                    $0.withinVisitTolerance
                }
            if !reachedAnchor || !reachedReturnAnchor {
                allBrockenAlternativesBound = false
            }
        }
        if allBrockenAlternativesBound {
            semanticObservationIds.insert(
                "named_brocken_must_have_satisfied"
            )
            semanticObservationIds.insert(
                "brocken_anchor_returned"
            )
        }
    }

    private static func sameHorizontalCoordinate(
        _ lhs: Coordinate,
        _ rhs: Coordinate
    ) -> Bool {
        lhs.latitude == rhs.latitude &&
            lhs.longitude == rhs.longitude
    }

    private static func sameHorizontalCoordinate(
        _ lhs: Coordinate,
        _ rhs: AdventureResearchCoordinateV1
    ) -> Bool {
        lhs.latitude == rhs.latitude &&
            lhs.longitude == rhs.longitude
    }

    private func observePlanningGaps(
        _ gaps: [OutdoorAdventurePlanningGapV1]
    ) {
        for gap in gaps {
            backendPlanningGapCodes.insert(gap.code.rawValue)
            if let affectedValue = gap.affectedValue {
                observeLimitations([affectedValue])
            }
            switch gap.code {
            case .unsupportedRegion:
                semanticObservationIds.insert(
                    "outside_coverage_unsupported"
                )
                limitationCauseIds.insert("unsupported_region")
            case .officialSourceUnavailable,
                 .currentSourceUnavailable:
                semanticObservationIds.insert(
                    "missing_official_current_evidence_visible"
                )
                limitationCauseIds.insert(
                    "official_status_unverified"
                )
            case .unsupportedEvidenceDimension,
                 .mappedSourceUnavailable,
                 .derivedSourceUnavailable,
                 .operationTypeUnavailable,
                 .predicateUnavailable,
                 .transportEvidenceNotModeled,
                 .bikingNetworkNotModeled,
                 .toiletEvidenceNotModeled,
                 .scenicQualityNotVerifiable,
                 .waterAvailabilitySourceMissing:
                break
            }
        }
    }

    private func observeLimitations(_ limitations: [String]) {
        for value in limitations {
            switch value {
            case "insufficient_candidate_count":
                semanticObservationIds.insert(
                    "must_have_shortfall_observed"
                )
                limitationCauseIds.insert(
                    "insufficient_candidate_count"
                )
            case "provider_failure", "routing_unavailable":
                semanticObservationIds.insert(
                    "partial_provider_failure_survivor"
                )
                limitationCauseIds.insert("provider_failure")
            case "graphhopper_timeout", "route_timed_out":
                semanticObservationIds.insert(
                    "graphhopper_timeout_observed"
                )
                limitationCauseIds.insert("graphhopper_timeout")
            case "official_status_unverified",
                 "current_conditions_unavailable":
                semanticObservationIds.insert(
                    "missing_official_current_evidence_visible"
                )
                limitationCauseIds.insert(
                    "official_status_unverified"
                )
            case "access_unverified":
                limitationCauseIds.insert("access_unverified")
            case "unsupported_region":
                semanticObservationIds.insert(
                    "outside_coverage_unsupported"
                )
                limitationCauseIds.insert("unsupported_region")
            default:
                break
            }
        }
    }

    private static func intentDigest(
        _ intent: AdventureResearchIntentV1
    ) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(intent) else {
            return nil
        }
        return StagingProofDigest.sha256(
            data.base64EncodedString()
        )
    }

    static func routeOrderDigest(
        _ suggestions: [RouteSuggestion]
    ) -> String? {
        guard !suggestions.isEmpty else { return nil }
        let values = suggestions.compactMap { suggestion -> String? in
            guard case let .routed(provenance) =
                    suggestion.route.provenance
            else {
                return nil
            }
            return provenance.factFingerprint.rawValue
        }
        guard values.count == suggestions.count else {
            return nil
        }
        return StagingProofDigest.joined(values)
    }

    private func withLock<T>(_ operation: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return operation()
    }
}

private struct StagingProofObservingIntentAdapter:
    AdventureResearchIntentAdaptingV1,
    Sendable
{
    let base: any AdventureResearchIntentAdaptingV1
    let recorder: StagingProofRuntimeRecorder

    func adapt(
        _ input: AdventureResearchIntentAdapterInputV1
    ) -> AdventureResearchIntentAdapterResultV1 {
        let startedAt = ContinuousClock().now
        let result = base.adapt(input)
        recorder.recordAdapter(
            result: result,
            timing: .measured(from: startedAt)
        )
        return result
    }
}

private struct StagingProofObservingAuthorizer:
    RouteSessionAuthorizing,
    Sendable
{
    let base: any RouteSessionAuthorizing
    let recorder: StagingProofRuntimeRecorder

    func authorization(
        cost: Int
    ) async throws -> RouteSessionAuthorization {
        let authorization = try await base.authorization(cost: cost)
        recorder.recordRequestID(authorization.requestID)
        return authorization
    }

    func invalidate(token: String) async {
        await base.invalidate(token: token)
    }
}

private struct StagingProofObservingPlanningCoordinator:
    OutdoorAdventurePlanningCoordinatingV1,
    Sendable
{
    let base: any OutdoorAdventurePlanningCoordinatingV1
    let recorder: StagingProofRuntimeRecorder

    func plan(
        intent: AdventureResearchIntentV1
    ) async throws -> OutdoorAdventurePlanningCoordinatorResultV1 {
        recorder.recordCoordinatorStart(intent: intent)
        let startedAt = ContinuousClock().now
        do {
            let result = try await base.plan(intent: intent)
            recorder.recordCoordinator(
                result: result,
                timing: .measured(from: startedAt)
            )
            return result
        } catch {
            recorder.recordCoordinatorFailure(
                error,
                timing: .measured(from: startedAt)
            )
            throw error
        }
    }
}

#if targetEnvironment(simulator)
@MainActor
private struct StagingProofSimulatorLegacyRoutingCoordinator:
    RoutingCoordinating
{
    func routeSuggestions(
        for intent: RouteIntent
    ) async throws -> RoutingResult {
        let request = intent.request
        let path: [Coordinate]
        if request.routeType == .pointToPoint,
           let end = intent.end
        {
            path = [
                intent.start,
                Coordinate(
                    latitude:
                        (intent.start.latitude + end.latitude) / 2,
                    longitude:
                        (intent.start.longitude + end.longitude) / 2,
                    elevationMeters: 320
                ),
                end
            ]
        } else {
            let start = intent.start
            path = [
                start,
                Coordinate(
                    latitude: start.latitude + 0.018,
                    longitude: start.longitude + 0.012,
                    elevationMeters: 340
                ),
                Coordinate(
                    latitude: start.latitude + 0.006,
                    longitude: start.longitude + 0.031,
                    elevationMeters: 420
                ),
                Coordinate(
                    latitude: start.latitude - 0.017,
                    longitude: start.longitude + 0.015,
                    elevationMeters: 360
                ),
                start
            ]
        }
        let distance = request.targetDistanceKm ?? 10
        let elevationGain = request.difficulty == .easy
            ? 180
            : 320
        let duration = max(distance / 3.5, 0.5)
        let difficulty = RouteDifficulty.estimated(
            distanceKilometers: distance,
            elevationGainMeters: elevationGain
        )
        let route = TrailRoute(
            id: UUID(
                uuidString:
                    "7A000000-0000-4000-8000-000000000001"
            )!,
            provenance: .routingEngineOutput(
                provider: .graphHopper,
                strategy: .backend,
                activity: request.activityType,
                routeType: request.routeType,
                distanceKilometers: distance,
                elevationGainMeters: elevationGain,
                elevationLossMeters: elevationGain,
                durationHours: duration,
                difficulty: difficulty,
                path: path,
                verifiedCharacteristics: nil
            ),
            title: "Controlled Simulator Route",
            location: "Controlled staging fixture",
            activity: request.activityType,
            distanceKilometers: distance,
            elevationGainMeters: elevationGain,
            elevationLossMeters: elevationGain,
            durationHours: duration,
            difficulty: difficulty,
            routeType: request.routeType,
            summary:
                "A bounded non-network route used only for controlled Simulator diagnostics.",
            whyItMatches:
                "Exercises the legacy presentation path without provider traffic.",
            highlights: [],
            waypoints: [],
            days: [],
            safetyNotes: [
                SafetyNote(
                    title: "Diagnostic only",
                    message:
                        "This controlled Simulator route is not live proof.",
                    severity: .info
                )
            ],
            elevationProfile:
                path.compactMap(\.elevationMeters),
            path: path
        )
        let suggestion = RouteSuggestion(
            id: UUID(
                uuidString:
                    "7B000000-0000-4000-8000-000000000001"
            )!,
            route: route,
            explanation:
                "Controlled non-network legacy diagnostic."
        )
        return RoutingResult(
            suggestions: [suggestion],
            notice: nil,
            loopSearchOutcome:
                request.routeType == .loop
                    ? .singleRoute
                    : nil,
            loopSearchDiagnostics:
                request.routeType == .loop
                    ? .empty(elapsedMilliseconds: 0)
                    : nil
        )
    }
}
#endif

@MainActor
private final class StagingProofObservingRoutingCoordinator:
    RoutingCoordinating
{
    private let base: any RoutingCoordinating
    private let recorder: StagingProofRuntimeRecorder
    private let firstInvocationReturnsNoRoutes: Bool
    private var invocationCount = 0

    init(
        base: any RoutingCoordinating,
        recorder: StagingProofRuntimeRecorder,
        firstInvocationReturnsNoRoutes: Bool = false
    ) {
        self.base = base
        self.recorder = recorder
        self.firstInvocationReturnsNoRoutes =
            firstInvocationReturnsNoRoutes
    }

    func routeSuggestions(
        for intent: RouteIntent
    ) async throws -> RoutingResult {
        invocationCount += 1
        let startedAt = ContinuousClock().now
        defer {
            recorder.recordLegacyRouting(
                timing: .measured(from: startedAt)
            )
        }
        if firstInvocationReturnsNoRoutes &&
            invocationCount == 1
        {
            throw GraphHopperError.noRouteFound
        }
        return try await base.routeSuggestions(for: intent)
    }
}

@MainActor
@Observable
final class StagingProofLaunchComposition {
    static let receiptAccessibilityIdentifier =
        "staging.proof.receipt"
    static let pendingReceiptValue = "pending"

    let appModel: AppModel
    let planner: PlannerViewModel
    private(set) var receiptPayload = pendingReceiptValue

    @ObservationIgnored private let request:
        StagingProofLaunchRequest
    @ObservationIgnored private let fixture: StagingProofFixture
    @ObservationIgnored private let recorder:
        StagingProofRuntimeRecorder
    @ObservationIgnored private let proofLane: StagingProofLane
    @ObservationIgnored private let initialBlockerCode: String?
    @ObservationIgnored private let postExecutionBlockerCode:
        String?
    @ObservationIgnored private let postgresCancellationGateClient:
        StagingProofPostgresCancellationGateClient?
    @ObservationIgnored private var executionBlockerCode: String?
    @ObservationIgnored private var hasRun = false

    static func resolve(
        arguments: [String] =
            ProcessInfo.processInfo.arguments,
        bundle: Bundle = .main
    ) -> StagingProofLaunchComposition? {
        let parsed: StagingProofLaunchRequest?
        do {
            parsed = try StagingProofLaunchRequestParser.parse(
                arguments: arguments
            )
        } catch {
            preconditionFailure(
                "Malformed TrailMind staging-proof launch request."
            )
        }
        guard let request = parsed else { return nil }
        return StagingProofLaunchComposition(
            request: request,
            bundle: bundle
        )
    }

    private init(
        request: StagingProofLaunchRequest,
        bundle: Bundle
    ) {
        self.request = request
        fixture = StagingProofFixture(id: request.fixtureID)
        let recorder = StagingProofRuntimeRecorder()
        self.recorder = recorder

        let savedRoutes = SavedRoutesModel(
            store: InMemorySavedRouteStore()
        )
        appModel = AppModel(savedRoutes: savedRoutes)

        let baseURL = TrailMindBackendConfiguration.baseURL(
            bundle: bundle
        )
        postgresCancellationGateClient = baseURL.map {
            StagingProofPostgresCancellationGateClient(
                baseURL: $0,
                nonceDigest: request.nonceDigest
            )
        }
        let researchEnabled = TrailMindBackendConfiguration
            .researchGuidedPlanningEnabled(bundle: bundle)
        var blockerCode: String?
        var postExecutionBlockerCode: String?
        #if targetEnvironment(simulator)
        proofLane = .controlled
        switch fixture.executionMode {
        case .controlledResponseRejection:
            if baseURL == nil {
                blockerCode = "backend_base_url_missing"
            } else if !researchEnabled {
                blockerCode = "research_feature_disabled"
            }
        case .featureDisabledObservation:
            postExecutionBlockerCode =
                "simulator_development_session_non_proof"
        case .standard, .cancelAfterAuthorization,
             .retryAfterLegacyFallback:
            if baseURL == nil {
                blockerCode = "backend_base_url_missing"
            } else if !researchEnabled {
                blockerCode = "research_feature_disabled"
            } else {
                postExecutionBlockerCode =
                    "simulator_development_session_non_proof"
            }
        }
        #else
        proofLane =
            fixture.executionMode ==
                .controlledResponseRejection
                ? .controlled
                : .live
        switch fixture.executionMode {
        case .controlledResponseRejection:
            blockerCode =
                "controlled_case_requires_external_runner"
        case .featureDisabledObservation:
            break
        case .standard, .cancelAfterAuthorization,
             .retryAfterLegacyFallback:
            if baseURL == nil {
                blockerCode = "backend_base_url_missing"
            } else if !researchEnabled {
                blockerCode = "research_feature_disabled"
            }
        }
        #endif
        initialBlockerCode = blockerCode
        self.postExecutionBlockerCode =
            postExecutionBlockerCode
        let effectiveResearchEnabled =
            fixture.executionMode ==
                .featureDisabledObservation
                ? false
                : researchEnabled

        let baseAuthorizer =
            TrailMindBackendSecurity.makeSessionAuthorizer(
                baseURL: baseURL
            )
        let observingAuthorizer =
            StagingProofObservingAuthorizer(
                base: baseAuthorizer,
                recorder: recorder
            )
        let contractAdapter =
            ResearchGuidedRoutingContractAdapterV1(
                qualitySelectionDidFinish: { duration in
                    MainActor.assumeIsolated {
                        recorder.recordQualitySelection(
                            duration: duration
                        )
                    }
                }
            )
        let productionClient =
            BackendOutdoorAdventurePlanningClientV1(
                baseURL: baseURL,
                authorizer: observingAuthorizer,
                adapter: contractAdapter,
                responseValidationDidFinish: { duration in
                    MainActor.assumeIsolated {
                        recorder.recordResponseValidation(
                            duration: duration
                        )
                    }
                }
            )
        let productionCoordinator =
            OutdoorAdventurePlanningCoordinatorV1(
                client: productionClient
            )
        let observingCoordinator =
            StagingProofObservingPlanningCoordinator(
                base: productionCoordinator,
                recorder: recorder
            )
        let observingAdapter =
            StagingProofObservingIntentAdapter(
                base: AdventureResearchIntentAdapterV1(),
                recorder: recorder
            )
        #if targetEnvironment(simulator)
        let legacyRoutingCoordinator:
            any RoutingCoordinating =
                StagingProofSimulatorLegacyRoutingCoordinator()
        #else
        let legacyRoutingCoordinator:
            any RoutingCoordinating = RoutingCoordinator()
        #endif
        let observingRouting =
            StagingProofObservingRoutingCoordinator(
                base: legacyRoutingCoordinator,
                recorder: recorder,
                firstInvocationReturnsNoRoutes:
                    fixture.executionMode ==
                        .retryAfterLegacyFallback
            )
        planner = PlannerViewModel(
            intentParsingProvider:
                StagingProofIntentParsingProvider(
                    fixture: fixture
                ),
            locationResolver: StagingProofLocationResolver(
                fixture: fixture
            ),
            routingCoordinator: observingRouting,
            researchIntentAdapter: observingAdapter,
            researchPlanningCoordinator:
                observingCoordinator,
            researchFeatureAvailable: {
                recorder.recordResearchFeatureGate(
                    effectiveResearchEnabled
                )
                return effectiveResearchEnabled
            },
            outdoorEvidenceProvider:
                NoOpOutdoorRouteEvidenceProvider(),
            operationTimeouts: .production,
            attemptIDProvider: {
                let id = UUID()
                recorder.recordAttempt(id)
                return id
            }
        )
    }

    func runIfNeeded() async {
        guard !hasRun else { return }
        hasRun = true
        let startedAt = ContinuousClock().now
        var blockerCode = initialBlockerCode

        if blockerCode == nil {
            switch fixture.executionMode {
            case .standard:
                await runStandardAttempt()

            case .cancelAfterAuthorization:
                await runCancellationAttempt()

            case .retryAfterLegacyFallback:
                await runRetryAttempt()

            case .featureDisabledObservation:
                await runFeatureDisabledObservation()

            case .controlledResponseRejection:
                await runStandardAttempt()
            }
            blockerCode =
                postExecutionBlockerCode ??
                terminalBlocker()
        }
        recorder.recordTiming(
            "end_to_end",
            .measured(from: startedAt)
        )
        publishReceipt(blockerCode: blockerCode)
    }

    private func runStandardAttempt() async {
        planner.startPlanning(prompt: fixture.id.rawValue)
        await planner.generate()
        if case let .awaitingClarification(clarification) =
                planner.state,
           case .location =
                clarification.kind
        {
            recorder.addSemanticObservation(
                "broad_region_clarification"
            )
            recorder.addLimitationCause(
                "unresolved_geography"
            )
        }
    }

    private func runCancellationAttempt() async {
        guard let postgresCancellationGateClient else {
            executionBlockerCode =
                "postgres_cancellation_gate_failed"
            return
        }
        planner.startPlanning(prompt: fixture.id.rawValue)
        guard let planningTask =
                planner.stagingProofPlanningTaskForQuiescence()
        else {
            planner.cancelGeneration()
            executionBlockerCode =
                "postgres_cancellation_gate_failed"
            return
        }
        do {
            try await postgresCancellationGateClient.wait(
                for: .queryActive
            )
        } catch {
            planner.cancelGeneration()
            await planningTask.value
            executionBlockerCode =
                "postgres_cancellation_gate_failed"
            return
        }
        recorder.markCancellation()
        planner.cancelGeneration()
        do {
            try await postgresCancellationGateClient.wait(
                for: .cancelSettled
            )
        } catch {
            await planningTask.value
            executionBlockerCode =
                "postgres_cancellation_gate_failed"
            return
        }
        await planningTask.value
        if plannerTerminalState == .cancelled {
            let snapshot = recorder.snapshot()
            if snapshot.postCancelCoordinatorResultCount == 0,
               snapshot.postCancelLegacyRoutingCount == 0
            {
                recorder.addSemanticObservation(
                    "cancelled_during_postgis"
                )
            }
        }
    }

    private func runFeatureDisabledObservation() async {
        // Probe the exact gate used by PlannerViewModel's production research
        // decision. The probe intentionally starts no user attempt so a
        // disabled proof can causally establish zero authorization, endpoint,
        // research-provider, or legacy-routing work.
        let featureAvailable =
            planner.stagingProofEvaluateResearchGuidedPlanningGate()
        let snapshot = recorder.snapshot()
        guard !featureAvailable,
              snapshot.researchFeatureGateEvaluationCount == 1,
              snapshot.lastResearchFeatureGateValue == false,
              plannerTerminalState == .idle,
              snapshot.attemptDigests.isEmpty,
              snapshot.requestIdDigests.isEmpty,
              snapshot.researchCoordinatorRequestCount == 0,
              snapshot.legacyRoutingRequestCount == 0
        else {
            return
        }
        recorder.addSemanticObservation(
            "feature_disabled_zero_research"
        )
        recorder.addLimitationCause("feature_disabled")
    }

    private func runRetryAttempt() async {
        planner.startPlanning(prompt: fixture.id.rawValue)
        await planner.generate()
        let priorTerminal = plannerTerminalState
        let priorDigest = plannerResultDigest()
        recorder.markRetryPrior(
            terminalState: priorTerminal,
            resultDigest: priorDigest
        )

        guard priorTerminal == .noRoutes ||
                priorTerminal == .recoverableError
        else {
            return
        }
        planner.startPlanning(prompt: fixture.id.rawValue)
        recorder.recordRetryPostResetState(
            plannerTerminalState: plannerTerminalState,
            suggestionCount: planner.suggestions.count,
            hasResearchContext:
                planner.researchPlanningContext != nil,
            hasClarification:
                planner.currentClarification != nil,
            hasRecovery:
                planner.currentRecovery != nil
        )
        await planner.generate()

        let snapshot = recorder.snapshot()
        let hasFreshAttempt =
            snapshot.attemptDigests.count >= 2 &&
            snapshot.attemptDigests[
                snapshot.attemptDigests.count - 2
            ] != snapshot.attemptDigests.last
        let hasFreshRequest =
            snapshot.requestIdDigests.count >= 2 &&
            snapshot.requestIdDigests[
                snapshot.requestIdDigests.count - 2
            ] != snapshot.requestIdDigests.last
        if hasFreshAttempt, hasFreshRequest,
           plannerTerminalState == .suggestionsReady
        {
            recorder.addSemanticObservation(
                "fresh_retry_after_failure"
            )
        }
    }

    private func terminalBlocker() -> String? {
        if let executionBlockerCode {
            return executionBlockerCode
        }
        let snapshot = recorder.snapshot()
        if fixture.executionMode == .featureDisabledObservation,
           (
               snapshot.researchFeatureGateEvaluationCount != 1 ||
               snapshot.lastResearchFeatureGateValue != false
           )
        {
            return "research_feature_unexpectedly_enabled"
        }
        if fixture.executionMode == .featureDisabledObservation,
           (
               !snapshot.attemptDigests.isEmpty ||
               !snapshot.requestIdDigests.isEmpty ||
               snapshot.researchCoordinatorRequestCount != 0 ||
               snapshot.legacyRoutingRequestCount != 0 ||
               plannerTerminalState != .idle
           )
        {
            return "unexpected_terminal"
        }
        if fixture.executionMode == .cancelAfterAuthorization,
           snapshot.requestIdDigests.isEmpty
        {
            return "cancellation_authorization_not_observed"
        }
        if fixture.requiresCausalServerBinding,
           snapshot.requestIdDigests.isEmpty
        {
            return "causal_server_binding_missing"
        }
        if fixture.executionMode == .retryAfterLegacyFallback {
            guard snapshot.retryPriorTerminalState ==
                    StagingProofPlannerTerminalState
                        .noRoutes.rawValue ||
                    snapshot.retryPriorTerminalState ==
                    StagingProofPlannerTerminalState
                        .recoverableError.rawValue
            else {
                return "retry_precondition_missing"
            }
            guard snapshot.attemptDigests.count >= 2,
                  snapshot.requestIdDigests.count >= 2,
                  snapshot.attemptDigests[
                    snapshot.attemptDigests.count - 2
                  ] != snapshot.attemptDigests.last,
                  snapshot.requestIdDigests[
                    snapshot.requestIdDigests.count - 2
                  ] != snapshot.requestIdDigests.last
            else {
                return "retry_stale_state"
            }
            guard snapshot.retryPostResetPlannerTerminalState ==
                    StagingProofPlannerTerminalState
                        .generating.rawValue,
                  snapshot.retryPostResetSuggestionCount == 0,
                  snapshot.retryPostResetResearchContextDigest == nil,
                  snapshot.retryPostResetClarificationDigest == nil,
                  snapshot.retryPostResetRecoveryDigest == nil,
                  snapshot.retryPriorResultDigest != nil,
                  snapshot.retryPriorResultDigest !=
                    plannerResultDigest()
            else {
                return "retry_stale_state"
            }
        }
        return actualProofTerminal == fixture.expectedProofTerminal
            ? nil
            : "unexpected_terminal"
    }

    private var plannerTerminalState:
        StagingProofPlannerTerminalState
    {
        switch planner.state {
        case .idle, .editing:
            .idle
        case .understanding, .resolvingLocations,
             .generatingRoutes, .preparingSuggestions:
            .generating
        case .awaitingClarification:
            .clarification
        case .suggestionsReady:
            .suggestionsReady
        case .noRoutes:
            .noRoutes
        case .recoverableError:
            .recoverableError
        case .cancelled:
            .cancelled
        }
    }

    private var actualProofTerminal: StagingProofTerminalState {
        if fixture.executionMode == .featureDisabledObservation {
            let snapshot = recorder.snapshot()
            return plannerTerminalState == .idle &&
                snapshot.researchFeatureGateEvaluationCount == 1 &&
                snapshot.lastResearchFeatureGateValue == false &&
                snapshot.attemptDigests.isEmpty &&
                snapshot.requestIdDigests.isEmpty &&
                snapshot.researchCoordinatorRequestCount == 0 &&
                snapshot.legacyRoutingRequestCount == 0 &&
                snapshot.semanticObservationIds.contains(
                    "feature_disabled_zero_research"
                )
                    ? .disabled
                    : .failed
        }
        if fixture.executionMode ==
                .controlledResponseRejection,
           recorder.snapshot().semanticObservationIds.contains(
               "malformed_response_rejected_by_ios"
           )
        {
            return .rejected
        }
        if fixture.executionMode == .retryAfterLegacyFallback,
           plannerTerminalState == .suggestionsReady
        {
            return .retrySucceeded
        }
        switch planner.state {
        case let .suggestionsReady(success):
            guard let context = success.researchContext else {
                return .routed
            }
            switch context.outcome {
            case .routed:
                return .routed
            case .partial:
                return .partial
            case .legacyFallback:
                return .legacyFallback
            }
        case .awaitingClarification:
            return .clarification
        case .cancelled:
            return .cancelled
        case .recoverableError, .noRoutes, .idle, .editing,
             .understanding, .resolvingLocations,
             .generatingRoutes, .preparingSuggestions:
            return .failed
        }
    }

    private func publishReceipt(blockerCode: String?) {
        let receipt = makeReceipt(blockerCode: blockerCode)
        do {
            let data = try StagingProofReceiptCodec.encode(receipt)
            receiptPayload = String(
                decoding: data,
                as: UTF8.self
            )
        } catch {
            let fallback = makeReceipt(
                blockerCode: "receipt_encoding_failed",
                forceFailedTerminal: true
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            if let data = try? encoder.encode(fallback) {
                receiptPayload = String(
                    decoding: data,
                    as: UTF8.self
                )
            }
        }
    }

    private func makeReceipt(
        blockerCode: String?,
        forceFailedTerminal: Bool = false
    ) -> StagingProofReceiptV1 {
        let presentationStartedAt = ContinuousClock().now
        let presentation = presentationReceipt()
        if presentation.count > 0 {
            recorder.recordTiming(
                "presentation_projection",
                .measured(from: presentationStartedAt)
            )
        }

        let plannerOrderDigest =
            StagingProofRuntimeRecorder.routeOrderDigest(
                planner.suggestions
            )
        let preQualitySnapshot = recorder.snapshot()
        let hasResearchSelection =
            preQualitySnapshot.coordinatorSelectionOrderDigest != nil

        let snapshot = recorder.snapshot()
        let currentResultDigest = plannerResultDigest()
        let topRequestDigest = snapshot.requestIdDigests.last
        let retryCurrentAttempt =
            fixture.executionMode == .retryAfterLegacyFallback
                ? snapshot.attemptDigests.last
                : nil
        let retryCurrentRequest =
            fixture.executionMode == .retryAfterLegacyFallback
                ? snapshot.requestIdDigests.last
                : nil
        let terminal =
            forceFailedTerminal
                ? StagingProofTerminalState.failed
                : actualProofTerminal
        let cancellationTerminal =
            fixture.executionMode == .cancelAfterAuthorization
                ? plannerTerminalState.rawValue
                : nil
        let retryCurrentTerminal =
            fixture.executionMode == .retryAfterLegacyFallback
                ? plannerTerminalState.rawValue
                : nil
        let contractCheck: StagingProofCheckState
        if let coordinatorOrder =
            snapshot.coordinatorSelectionOrderDigest
        {
            contractCheck =
                coordinatorOrder == plannerOrderDigest &&
                snapshot.acceptedCount ==
                    planner.suggestions.count
                    ? .passed
                    : .failed
        } else {
            contractCheck = .notApplicable
        }
        let qualityCheck: StagingProofCheckState =
            hasResearchSelection
                ? (
                    contractCheck == .passed &&
                    !(preQualitySnapshot.timings[
                        "route_quality"
                    ] ?? []).isEmpty
                        ? .passed
                        : .failed
                )
                : .notApplicable
        let presentationCheck: StagingProofCheckState
        if presentation.count > 0 {
            presentationCheck =
                presentation.count == planner.suggestions.count ||
                plannerTerminalState == .clarification
                    ? .passed
                    : .failed
        } else {
            presentationCheck = .notApplicable
        }
        let cancellationCheck: StagingProofCheckState =
            fixture.executionMode == .cancelAfterAuthorization
                ? (
                    plannerTerminalState == .cancelled &&
                    snapshot.postCancelCoordinatorResultCount == 0 &&
                    snapshot.postCancelLegacyRoutingCount == 0
                        ? .passed
                        : .failed
                )
                : .notApplicable
        let retryCheck: StagingProofCheckState =
            fixture.executionMode == .retryAfterLegacyFallback
                ? (
                    snapshot.attemptDigests.count >= 2 &&
                    snapshot.requestIdDigests.count >= 2 &&
                    snapshot.attemptDigests[
                        snapshot.attemptDigests.count - 2
                    ] != snapshot.attemptDigests.last &&
                    snapshot.requestIdDigests[
                        snapshot.requestIdDigests.count - 2
                    ] != snapshot.requestIdDigests.last &&
                    snapshot.retryPriorResultDigest != nil &&
                    snapshot.retryPriorResultDigest !=
                        currentResultDigest &&
                    snapshot.retryPostResetPlannerTerminalState ==
                        StagingProofPlannerTerminalState
                            .generating.rawValue &&
                    snapshot.retryPostResetSuggestionCount == 0 &&
                    snapshot
                        .retryPostResetResearchContextDigest == nil &&
                    snapshot
                        .retryPostResetClarificationDigest == nil &&
                    snapshot.retryPostResetRecoveryDigest == nil
                        ? .passed
                        : .failed
                )
                : .notApplicable

        var receipt = StagingProofReceiptV1(
            schemaVersion: StagingProofReceiptV1.schemaVersion,
            proofVersion: StagingProofReceiptV1.proofVersion,
            manifestDigest: StagingProofReceiptV1.manifestDigest,
            caseId: fixture.proofCaseID.rawValue,
            inputFixtureId: fixture.id.rawValue,
            lane: proofLane,
            nonceDigest: request.nonceDigest,
            requestIdDigest: topRequestDigest,
            resultDigest: String(repeating: "0", count: 64),
            proofTerminalState: terminal,
            plannerTerminalState: plannerTerminalState,
            adapterState: snapshot.adapterState,
            researchOutcome: snapshot.researchOutcome,
            researchCoordinatorRequestCount:
                snapshot.researchCoordinatorRequestCount,
            legacyRoutingRequestCount:
                snapshot.legacyRoutingRequestCount,
            plannerAttemptCount: snapshot.attemptDigests.count,
            backendPlanningGapCodes:
                snapshot.backendPlanningGapCodes,
            semanticObservationIds:
                snapshot.semanticObservationIds.filter(
                    fixture.expectedSemanticObservationIDs.contains
                ),
            limitationCauseIds:
                snapshot.limitationCauseIds.filter(
                    fixture.expectedLimitationCauseIDs.contains
                ),
            selectionState: snapshot.selectionState,
            sourceEnvelopeState: snapshot.sourceEnvelopeState,
            alternativeCount: snapshot.alternativeCount,
            contractConversion:
                StagingProofContractConversionReceipt(
                    coordinatorSelectionOrderDigest:
                        snapshot.coordinatorSelectionOrderDigest,
                    plannerSuggestionOrderDigest:
                        plannerOrderDigest,
                    acceptedCount: snapshot.acceptedCount,
                    rejectedCount: snapshot.rejectedCount
                ),
            presentation: presentation,
            cancellation: StagingProofCancellationReceipt(
                attemptDigest:
                    snapshot.cancellationAttemptDigest,
                postCancelTerminalState: cancellationTerminal,
                postCancelCoordinatorResultCount:
                    snapshot.postCancelCoordinatorResultCount,
                postCancelLegacyRoutingCount:
                    snapshot.postCancelLegacyRoutingCount
            ),
            retry: StagingProofRetryReceipt(
                priorAttemptDigest:
                    snapshot.retryPriorAttemptDigest,
                currentAttemptDigest: retryCurrentAttempt,
                priorRequestIdDigest:
                    snapshot.retryPriorRequestIdDigest,
                currentRequestIdDigest: retryCurrentRequest,
                priorResultDigest:
                    snapshot.retryPriorResultDigest,
                priorTerminalState:
                    snapshot.retryPriorTerminalState,
                currentTerminalState: retryCurrentTerminal,
                currentResultDigest:
                    fixture.executionMode ==
                        .retryAfterLegacyFallback
                        ? currentResultDigest
                        : nil,
                postResetPlannerTerminalState:
                    snapshot
                        .retryPostResetPlannerTerminalState,
                postResetSuggestionCount:
                    snapshot.retryPostResetSuggestionCount,
                postResetResearchContextDigest:
                    snapshot
                        .retryPostResetResearchContextDigest,
                postResetClarificationDigest:
                    snapshot.retryPostResetClarificationDigest,
                postResetRecoveryDigest:
                    snapshot.retryPostResetRecoveryDigest
            ),
            iosStageTimings: snapshot.timings,
            diagnosticChecks: StagingProofDiagnosticChecks(
                productionClientPath:
                    snapshot.researchCoordinatorRequestCount > 0
                        ? .passed
                        : .notApplicable,
                contractConversion: contractCheck,
                qualityRanking: qualityCheck,
                presentation: presentationCheck,
                cancellation: cancellationCheck,
                retryFreshness: retryCheck
            ),
            blockerCode: blockerCode
        )
        receipt.resultDigest =
            StagingProofResultDigestV1.compute(receipt)
        return receipt
    }

    private func presentationReceipt()
        -> StagingProofPresentationReceipt
    {
        switch planner.state {
        case let .suggestionsReady(success):
            let presentations =
                ResearchPresentationProjector.routePresentations(
                    suggestions: success.suggestions,
                    context: success.researchContext
                )
            let ordered = success.suggestions.compactMap {
                presentations[$0.id]
            }
            let kinds = ordered.map {
                Self.presentationKind($0.kind)
            }
            let rows = ordered.map { value in
                [
                    Self.presentationKind(value.kind),
                    value.cardFacts.map(\.code.rawValue)
                        .joined(separator: ","),
                    value.fitReasons.map(\.code.rawValue)
                        .joined(separator: ","),
                    value.limitations.map(\.code.rawValue)
                        .joined(separator: ","),
                    String(value.highlights.count)
                ].joined(separator: "|")
            }
            let inputDigest =
                StagingProofRuntimeRecorder.routeOrderDigest(
                    success.suggestions
                )
            return StagingProofPresentationReceipt(
                inputOrderDigest: inputDigest,
                outputOrderDigest:
                    rows.isEmpty
                        ? nil
                        : StagingProofDigest.joined(rows),
                count: ordered.count,
                kinds: kinds
            )

        case .awaitingClarification:
            return StagingProofPresentationReceipt(
                inputOrderDigest: nil,
                outputOrderDigest: StagingProofDigest.joined([
                    "clarification"
                ]),
                count: 1,
                kinds: ["clarification"]
            )

        case .idle, .editing, .understanding,
             .resolvingLocations, .generatingRoutes,
             .preparingSuggestions, .noRoutes,
             .recoverableError, .cancelled:
            return StagingProofPresentationReceipt(
                inputOrderDigest: nil,
                outputOrderDigest: nil,
                count: 0,
                kinds: []
            )
        }
    }

    private func plannerResultDigest() -> String {
        let orderDigest =
            StagingProofRuntimeRecorder.routeOrderDigest(
                planner.suggestions
            ) ?? "none"
        let contextValue: String
        if let context = planner.researchPlanningContext {
            switch context.outcome {
            case .routed:
                contextValue = "routed"
            case .partial:
                contextValue = "partial"
            case .legacyFallback:
                contextValue = "legacy_fallback"
            }
        } else {
            contextValue = "none"
        }
        return StagingProofDigest.joined([
            plannerTerminalState.rawValue,
            orderDigest,
            contextValue,
            String(planner.suggestions.count)
        ])
    }

    private static func presentationKind(
        _ kind: ResearchResultKind
    ) -> String {
        switch kind {
        case .researchGuided:
            "research_guided"
        case .researchGuidedPartial:
            "research_guided_partial"
        case .standardRouteFallback:
            "standard_route_fallback"
        case .standardRoute:
            "standard_route"
        case .clarification:
            "clarification"
        case .unsupported:
            "unsupported"
        }
    }
}

struct StagingProofHostView: View {
    let composition: StagingProofLaunchComposition

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            AppShellView(planner: composition.planner)

            Text("proof")
                .font(.system(size: 1))
                .foregroundStyle(Color.primary.opacity(0.01))
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier(
                    StagingProofLaunchComposition
                        .receiptAccessibilityIdentifier
                )
                .accessibilityLabel("Staging proof receipt")
                .accessibilityValue(composition.receiptPayload)
                .allowsHitTesting(false)
        }
        .task {
            await composition.runIfNeeded()
        }
    }
}
#endif
