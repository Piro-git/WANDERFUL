import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class GlobalFixesAcceptanceTests: XCTestCase {
    func testOriginalRequestLimitsSurviveContextAndWireFormat() async throws {
        let cases: [(String, String, Double, Bool)] = [
            ("Rundwanderung ab Goslar unter 2 Stunden", "maximumDurationMinutes", 120, true),
            ("Rundwanderung ab Goslar mit weniger als 200 Höhenmetern", "maximumElevationGainMeters", 200, true),
            ("Rundwanderung ab Goslar höchstens 200 Höhenmeter", "maximumElevationGainMeters", 200, false),
            ("Rundwanderung ab Goslar maximal 2 Stunden", "maximumDurationMinutes", 120, false),
            ("Ich habe wenig Zeit: eine Runde ab Dieulefit, weniger als 1 Stunde und 30 Minuten.", "maximumDurationMinutes", 90, true),
            ("Eine Wanderung ab Keswick, unter 6,5 km, bitte.", "maximumDistanceKm", 6.5, true),
            ("Ab Keswick eine Runde, nicht mehr als 200 Höhenmeter.", "maximumElevationGainMeters", 200, false)
        ]
        var exports: [[String: Any]] = []
        for (prompt, field, boundary, strict) in cases {
            let parsed = try await remoteFixtureIntent(prompt: prompt)
            let context = ResearchLedPlanningContext(intent: ValidatedAdventureIntent(intent: parsed),
                distanceFromProfile: true, preferencesFromProfile: true)
            XCTAssertFalse(context.requiresConstraintClarification, prompt)
            let request = RoutePlanningRequest(routeType: .loop, startQuery: "Keswick, Cumbria, United Kingdom",
                endQuery: nil, activityType: .hiking, graphHopperProfile: "foot", targetDistanceKm: nil,
                targetDurationMinutes: nil, difficulty: .moderate, desiredFeatures: [.viewpoint])
            let data = try BackendDynamicResearchPlanningClient.requestBody(prompt: prompt, request: request,
                start: Coordinate(latitude: 57.2, longitude: -4.7), end: nil, context: context)
            let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            let constraints = try XCTUnwrap(body["constraints"] as? [String: Any])
            let maximum = try XCTUnwrap(constraints[field] as? Double, prompt)
            if strict { XCTAssertLessThan(maximum, boundary, prompt) }
            else { XCTAssertEqual(maximum, boundary, prompt) }
            XCTAssertGreaterThan(maximum, boundary - 0.000001, prompt)
            XCTAssertEqual(body["prompt"] as? String, prompt)
            if field == "maximumDurationMinutes" {
                XCTAssertEqual(context.accepts(distanceKilometers: 5, durationHours: boundary / 60), !strict, prompt)
            }
            if field == "maximumDistanceKm" {
                XCTAssertEqual(context.accepts(distanceKilometers: boundary, durationHours: 1), !strict, prompt)
            }
            exports.append(["prompt": prompt, "field": field, "boundary": boundary, "strict": strict, "request": body])
        }
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: exports, options: [.prettyPrinted, .sortedKeys]), uniformTypeIdentifier: "public.json")
        attachment.name = "acceptance-native-requests.json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testNonNumericAndSoftWishesDoNotBecomeHardLimits() async throws {
        for prompt in ["A hike under the trees", "Rundwanderung mit maximal viel Aussicht",
                       "Eine Runde ab Goslar, möglichst unter 2 Stunden", "A loop near Keswick, preferably under 2 hours"] {
            let parsed = try await remoteFixtureIntent(prompt: prompt)
            let context = ResearchLedPlanningContext(intent: ValidatedAdventureIntent(intent: parsed),
                distanceFromProfile: true, preferencesFromProfile: true)
            XCTAssertFalse(context.requiresConstraintClarification, prompt)
            XCTAssertNil(context.maximumDurationMinutes, prompt)
            XCTAssertNil(context.maximumElevationGainMeters, prompt)
        }
    }

    func testUnsupportedLowerBoundCannotSilentlyDisappear() {
        for prompt in ["Rundwanderung nicht unter 2 Stunden", "Rundwanderung mindestens 200 Höhenmeter"] {
            let parsed = ResearchPromptConstraints(prompt: prompt)
            XCTAssertNil(parsed.maximumDurationMinutes, prompt)
            XCTAssertNil(parsed.maximumElevationGainMeters, prompt)
            XCTAssertTrue(parsed.requiresClarification, prompt)
        }
    }
    // Exercise the shipping remote-intent boundary with a controlled model response.
    // The local rule-based parser requires its own supported location grammar and
    // would reject some original free-form wishes before the constraints under test.
    // No model-derived numeric limits are supplied: every hard limit still comes
    // from the unchanged original wish through ResearchLedPlanningContext.
    private func remoteFixtureIntent(prompt: String) async throws -> AdventureIntent {
        let null = NSNull()
        let data = try JSONSerialization.data(withJSONObject: [
            "activityType": "hiking", "routeType": "loop", "startLocationQuery": "Resolved fixture place",
            "endLocationQuery": null, "regionQuery": null, "targetDistanceKm": null,
            "targetDurationMinutes": null, "difficulty": null, "desiredFeatures": [],
            "avoidFeatures": [], "transportMode": "walking", "rawPrompt": prompt,
            "parserSource": "remoteAI", "confidence": 0.9
        ] as [String: Any])
        let provider = RemoteAIIntentParsingProvider(baseURL: URL(string: "https://acceptance.example.com"),
            authorizer: AcceptanceIntentAuthorizer(), dataLoader: { request in
                let sent = try JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any]
                guard sent?["prompt"] as? String == prompt else { throw NSError(domain: "AcceptancePromptTransport", code: 1) }
                return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            })
        let intent = try await provider.parseIntent(rawPrompt: prompt)
        XCTAssertEqual(intent.rawPrompt, prompt)
        XCTAssertEqual(intent.parserSource, .remoteAI)
        return intent
    }

}


private actor AcceptanceIntentAuthorizer: RouteSessionAuthorizing {
    func authorization(cost: Int) async throws -> RouteSessionAuthorization {
        RouteSessionAuthorization(token: String(repeating: "A", count: 43), requestID: UUID())
    }
    func invalidate(token: String) async {}
}
