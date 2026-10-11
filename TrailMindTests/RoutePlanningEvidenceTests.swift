import Foundation
import XCTest
import SwiftUI
import UIKit
@testable import TrailMind

@MainActor
final class RoutePlanningEvidenceTests: XCTestCase {
    static let current = Date(timeIntervalSince1970: 1_788_940_800)

    static func conditions() -> RouteLocalConditions {
        .init(schemaVersion: 1, checkedAt: "2026-09-09T08:00:00Z", expiresAt: "2026-09-09T09:00:00Z", visitTime: nil,
              scope: "route_corridor", coverage: "partial",
              sources: [.init(id: "coverage", name: "Local sources", url: nil, authority: "unknown", checkedAt: "2026-09-09T08:00:00Z", state: "not_checked", reason: "no_reviewed_adapter")],
              notices: [], blockingNoticeIds: [], limitations: ["Current information only."])
    }

    func testRecordedRegionalFormatsKeepArticleSourcesAndTemporalUncertainty() throws {
        for region in ["ilsenburg", "innsbruck"] {
            let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .appendingPathComponent("Fixtures/conditions-\(region)-recorded.json")
            let report = try JSONDecoder().decode(RouteLocalConditions.self, from: Data(contentsOf: url))
            XCTAssertNoThrow(try report.validate())
            XCTAssertEqual(report.coverage, "partial")
            XCTAssertFalse(report.notices.isEmpty)
            if region == "ilsenburg" {
                XCTAssertTrue(report.notices.contains { $0.source.id == "harz-official-news" && $0.source.url.path.hasPrefix("/de/aktuelles/") })
            } else {
                XCTAssertTrue(report.sources.contains { $0.id == "weather-coverage" && $0.state == "not_checked" })
                XCTAssertTrue(report.notices.contains { $0.validity == "expired" })
            }
        }
    }

    func testUnknownConditionsSurviveRoundTripAndExpireWithoutBecomingClearance() throws {
        let original = Self.conditions()
        try original.validate()
        let restored = try JSONDecoder().decode(RouteLocalConditions.self, from: JSONEncoder().encode(original))
        XCTAssertEqual(restored, original)
        XCTAssertEqual(restored.coverage, "partial")
        XCTAssertEqual(restored.sources.first?.state, "not_checked")
        XCTAssertFalse(restored.needsRefresh(at: PlanningEvidenceDate.parse("2026-09-09T08:59:00Z")!))
        XCTAssertTrue(restored.needsRefresh(at: PlanningEvidenceDate.parse("2026-09-09T09:00:00Z")!))
    }

    func testUnknownAccessCannotCarryAnEntranceOrVisitClaim() throws {
        let stop = DynamicResearchStop(id: "osm:way:8", name: "Test lake", category: "lake", wikidataId: nil,
            coordinate: .init(latitude: 51, longitude: 10), source: .init(provider: "openstreetmap",
            url: URL(string: "https://www.openstreetmap.org/way/8")!, license: "ODbL-1.0", attribution: "© OpenStreetMap contributors", version: 1,
            updatedAt: "2026-09-08T00:00:00Z", retrievedAt: "2026-09-09T08:00:00Z", snapshotAt: "2026-09-09T08:00:00Z"), photo: nil)
        let access = RouteAccessEvidence(schemaVersion: 1, placeId: stop.id, state: .unknown, reason: "connection_not_documented",
            checkedAt: "2026-09-09T08:00:00Z", evidence: [], target: .init(kind: "entrance", osmId: "osm:node:1", coordinate: stop.coordinate,
            relationship: "entrance_node_on_poi_boundary", straightLineOffsetMeters: 0, remainingWalkMeters: nil, poiVisitConfirmed: false))
        XCTAssertThrowsError(try access.validate(place: stop, now: PlanningEvidenceDate.parse("2026-09-09T08:00:00Z")!))
    }

    func testUnsafeSourceURLAndContradictoryCoverageAreRejected() throws {
        let data = try JSONEncoder().encode(Self.conditions())
        var value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        value["coverage"] = "all_clear"
        let invalid = try JSONDecoder().decode(RouteLocalConditions.self, from: JSONSerialization.data(withJSONObject: value))
        XCTAssertThrowsError(try invalid.validate())
        XCTAssertFalse(PlanningEvidenceDate.validURL(URL(string: "javascript:alert(1)")!))
    }
    func testNativeConditionCardsRenderAtStandardAndAccessibilitySizes() throws {
        let formatter = ISO8601DateFormatter()
        let now = Date.now
        let checked = formatter.string(from: now.addingTimeInterval(-60))
        let url = URL(string: "https://park.example.org/closures")!
        let report = RouteLocalConditions(schemaVersion: 1, checkedAt: checked,
            expiresAt: formatter.string(from: now.addingTimeInterval(3_540)), visitTime: nil,
            scope: "route_corridor", coverage: "partial",
            sources: [.init(id: "park", name: "Offline park fixture", url: url, authority: "official", checkedAt: checked,
                            state: "checked", reason: "bounded_source_only"),
                      .init(id: "other", name: "Other local sources", url: nil, authority: "unknown", checkedAt: checked,
                            state: "unavailable", reason: "source_unavailable")],
            notices: [.init(id: "report-1", eventId: "event-1", title: "Mapped path restriction", areaLabel: "Offline trail example",
                kind: "closure", status: "unknown", publishedAt: nil, retrievedAt: checked,
                eventStart: nil, eventEnd: nil, validFrom: nil, validUntil: nil,
                source: .init(id: "park", name: "Offline park fixture", url: url, authority: "official"),
                action: "Check the official map and follow posted signs.", validity: "unknown", spatial: "area", blocksRoute: false)],
            blockingNoticeIds: [], limitations: ["Fixture for native rendering only."])
        try report.validate()
        for size in [DynamicTypeSize.large, .accessibility3] {
            let root = ScrollView {
                RouteLocalConditionsView(conditions: report).padding()
            }.environment(\.dynamicTypeSize, size).environment(\.colorScheme, .light)
            let host = UIHostingController(rootView: root)
            let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
            window.rootViewController = host
            window.makeKeyAndVisible()
            host.view.frame = window.bounds
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            RunLoop.main.run(until: Date.now.addingTimeInterval(0.1))
            let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
            let image = renderer.image { _ in
                XCTAssertTrue(window.drawHierarchy(in: window.bounds, afterScreenUpdates: true))
            }
            let pixels = try XCTUnwrap(image.cgImage?.dataProvider?.data) as Data
            XCTAssertGreaterThan(Set(pixels).count, 16, "A blank image is not visual verification")
            XCTAssertEqual(image.size.width, 393)
            XCTAssertEqual(image.size.height, 852)
            let attachment = XCTAttachment(image: image)
            attachment.name = "Local conditions native \(size) – offline fixture"
            attachment.lifetime = .keepAlways
            add(attachment)
            window.isHidden = true
        }
    }

}
