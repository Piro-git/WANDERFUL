import Foundation
import XCTest
@testable import TrailMind

@MainActor
final class PublicAppLinksTests: XCTestCase {
    func testMissingAndEmptyValuesRemainUnavailable() {
        XCTAssertEqual(WanderfulPublicLinks.configuration(value: nil), .unavailable)
        XCTAssertEqual(WanderfulPublicLinks.configuration(value: ""), .unavailable)
    }

    func testCanonicalPublicHTTPSURLsAreAccepted() {
        XCTAssertEqual(
            WanderfulPublicLinks.configuration(
                value: "https://wanderful.app/privacy"
            ),
            .configured(URL(string: "https://wanderful.app/privacy")!)
        )
        XCTAssertEqual(
            WanderfulPublicLinks.configuration(
                value: "https://support.wanderful.app/help/"
            ),
            .configured(URL(string: "https://support.wanderful.app/help/")!)
        )
    }

    func testUnsafeMalformedAndPlaceholderValuesFailClosed() {
        let rejected: [Any] = [
            42,
            " https://wanderful.app/privacy",
            "http://wanderful.app/privacy",
            "https://localhost/privacy",
            "https://127.0.0.1/privacy",
            "https://[::1]/privacy",
            "https://user@wanderful.app/privacy",
            "https://wanderful.app:443/privacy",
            "https://wanderful.app/privacy?source=app",
            "https://wanderful.app/privacy#section",
            "https://example.com/privacy",
            "https://support.placeholder.test/help",
            "$(PRODUCTION_PRIVACY_POLICY_URL)",
            "not a URL"
        ]

        for value in rejected {
            XCTAssertEqual(
                WanderfulPublicLinks.configuration(value: value),
                .invalid,
                "Unexpectedly accepted \(value)"
            )
        }
    }

    func testEachConfiguredDestinationResolvesIndependently() {
        let links = WanderfulPublicLinks.resolve(
            infoDictionary: [
                PublicAppLinkKind.privacyPolicy.rawValue:
                    "https://wanderful.app/privacy",
                PublicAppLinkKind.support.rawValue: "",
                PublicAppLinkKind.termsOfUse.rawValue:
                    "https://wanderful.app/terms"
            ]
        )

        XCTAssertEqual(
            links.privacyPolicy.url,
            URL(string: "https://wanderful.app/privacy")
        )
        XCTAssertEqual(links.support, .unavailable)
        XCTAssertEqual(
            links.termsOfUse.url,
            URL(string: "https://wanderful.app/terms")
        )
    }
}
