import XCTest
import SwiftUI
@testable import TrailMind

final class RouteWeatherTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_642_600) // fixed fixture clock, no network
    private func stamp(_ offset: TimeInterval) -> String { ISO8601DateFormatter().string(from: now.addingTimeInterval(offset)) }
    private func fixture() -> [String: Any] {
        ["version": 1, "state": "available", "geometryDigest": "fixture-digest", "durationHours": 4,
         "plannedStartAt": stamp(3600), "windowEnd": stamp(18000), "checkedAt": stamp(0),
         "source": ["name": "MET Norway", "url": "https://api.met.no/", "licenseURL": "https://creativecommons.org/licenses/by/4.0/"],
         "samples": [0.0, 0.5, 1.0].map { fraction in
            ["fraction": fraction, "latitude": 50.0, "longitude": 10.0 + fraction / 10,
             "temperatureMinC": 8.0, "temperatureMaxC": 14.0, "windMaxKmh": 22.0,
             "precipitationMaxMmPerHour": 1.2, "intervalHours": 6,
             "sourceUpdatedAt": stamp(-1800), "retrievedAt": stamp(-600), "expiresAt": stamp(3600)] as [String: Any]
         }]
    }
    private func decode(_ raw: [String: Any]) throws -> RouteWeather {
        try JSONDecoder().decode(RouteWeather.self, from: JSONSerialization.data(withJSONObject: raw))
    }
    func testTypedFixtureAndExpiry() throws {
        let value = try decode(fixture())
        try value.validate(digest: "fixture-digest", start: now.addingTimeInterval(3600), duration: 4, now: now)
        XCTAssertTrue(value.isFresh(at: now))
        XCTAssertFalse(value.isFresh(at: now.addingTimeInterval(3601)))
        XCTAssertEqual(value.samples.count, 3)
    }
    func testRejectsWrongRouteTimeDurationAndSource() throws {
        let value = try decode(fixture())
        XCTAssertThrowsError(try value.validate(digest: "other-route", start: now.addingTimeInterval(3600), duration: 4, now: now))
        XCTAssertThrowsError(try value.validate(digest: "fixture-digest", start: now.addingTimeInterval(7200), duration: 4, now: now))
        XCTAssertThrowsError(try value.validate(digest: "fixture-digest", start: now.addingTimeInterval(3600), duration: 5, now: now))
        var raw = fixture(); raw["source"] = ["name": "MET Norway", "url": "https://example.org", "licenseURL": "https://creativecommons.org/licenses/by/4.0/"]
        XCTAssertThrowsError(try decode(raw).validate(digest: "fixture-digest", start: now.addingTimeInterval(3600), duration: 4, now: now))
    }
    func testRejectsMissingRainAndPartialForecast() throws {
        var raw = fixture()
        var samples = raw["samples"] as! [[String: Any]]
        samples[0]["precipitationMaxMmPerHour"] = NSNull(); raw["samples"] = samples
        XCTAssertThrowsError(try decode(raw))
        raw = fixture(); raw["samples"] = Array((raw["samples"] as! [[String: Any]]).prefix(2))
        XCTAssertThrowsError(try decode(raw).validate(digest: "fixture-digest", start: now.addingTimeInterval(3600), duration: 4, now: now))
    }
    func testUnavailableStatesNeverContainWeatherValues() throws {
        for state in ["date_required", "outside_horizon", "duration_unsupported", "unavailable"] {
            var raw = fixture(); raw["state"] = state; raw["samples"] = []; raw.removeValue(forKey: "source"); raw.removeValue(forKey: "windowEnd")
            let value = try decode(raw)
            try value.validate(digest: "fixture-digest", start: now.addingTimeInterval(3600), duration: 4, now: now)
            XCTAssertFalse(value.isFresh(at: now))
        }
    }
    func testOldAndFutureModelUpdatesRejected() throws {
        for offset: TimeInterval in [-90000, 3600] {
            var raw = fixture(); var samples = raw["samples"] as! [[String: Any]]
            samples[0]["sourceUpdatedAt"] = stamp(offset); raw["samples"] = samples
            XCTAssertThrowsError(try decode(raw).validate(digest: "fixture-digest", start: now.addingTimeInterval(3600), duration: 4, now: now))
        }
    }
    @MainActor
    func testNativeCardSnapshotsInEnglishGermanAndLargeText() throws {
        var raw = fixture()
        let formatter = ISO8601DateFormatter()
        let snapshotNow = Date(timeIntervalSince1970: floor(Date.now.timeIntervalSince1970))
        let start = snapshotNow.addingTimeInterval(3600)
        raw["plannedStartAt"] = formatter.string(from: start)
        raw["windowEnd"] = formatter.string(from: start.addingTimeInterval(4 * 3600))
        raw["checkedAt"] = formatter.string(from: snapshotNow)
        var samples = raw["samples"] as! [[String: Any]]
        for i in samples.indices {
            samples[i]["sourceUpdatedAt"] = formatter.string(from: snapshotNow.addingTimeInterval(-1800))
            samples[i]["retrievedAt"] = formatter.string(from: snapshotNow.addingTimeInterval(-600))
            samples[i]["expiresAt"] = formatter.string(from: snapshotNow.addingTimeInterval(3600))
        }
        raw["samples"] = samples
        let forecast = try decode(raw)
        try forecast.validate(digest: "fixture-digest", start: start, duration: 4, now: snapshotNow)
        XCTAssertGreaterThan(try XCTUnwrap(PlanningEvidenceDate.parse(forecast.plannedStartAt)), snapshotNow)
        XCTAssertGreaterThan(try XCTUnwrap(PlanningEvidenceDate.parse(forecast.windowEnd)), start)
        for (language, size, available) in [("en", DynamicTypeSize.large, true), ("de", .large, true), ("de", .accessibility3, true), ("de", .large, false)] {
            let root = ScrollView {
                RouteWeatherCard(route: TestRouteFixtures.luneburgLoop, initialForecast: available ? forecast : nil).padding()
            }.environment(\.locale, Locale(identifier: language)).environment(\.dynamicTypeSize, size)
            let host = UIHostingController(rootView: root)
            let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(x: 0, y: 0, width: 393, height: 852)
            window.rootViewController = host; window.makeKeyAndVisible()
            host.view.frame = window.bounds; host.view.setNeedsLayout(); host.view.layoutIfNeeded()
            RunLoop.main.run(until: Date.now.addingTimeInterval(0.1))
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                XCTAssertTrue(window.drawHierarchy(in: window.bounds, afterScreenUpdates: true))
            }
            let pixels = try XCTUnwrap(image.cgImage?.dataProvider?.data) as Data
            XCTAssertGreaterThan(Set(pixels).count, 16)
            let attachment = XCTAttachment(image: image)
            attachment.name = "Weather fixture \(language) \(size) \(available ? "forecast" : "no date")"
            attachment.lifetime = .keepAlways; add(attachment)
            window.isHidden = true
        }
    }

}
