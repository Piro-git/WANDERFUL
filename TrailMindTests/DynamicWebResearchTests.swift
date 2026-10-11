import Foundation
import XCTest
@testable import TrailMind

final class DynamicWebResearchTests: XCTestCase {
    func testGroundedTextRequiresCitationsSuccessfulSourceAndSuggestions() throws {
        let url = URL(string: "https://park.example.org/ridge")!
        let citation = DynamicWebResearch.Citation(url: url, title: "Park source", startIndex: 0, endIndex: 36)
        let block = DynamicWebResearch.Block(text: "The park describes a ridge viewpoint.", citations: [citation])
        let research = DynamicWebResearch(provider: "google_grounding", retrievedAt: "2026-09-07T00:00:00Z",
            blocks: [block], searchSuggestions: ["<div>Provider suggestions</div>"], retrievedSourceURLs: [url], observedSearchQueries: 1)
        XCTAssertNoThrow(try research.validate())
        let missing = DynamicWebResearch(provider: research.provider, retrievedAt: research.retrievedAt,
            blocks: research.blocks, searchSuggestions: [], retrievedSourceURLs: [url], observedSearchQueries: 1)
        XCTAssertThrowsError(try missing.validate())
        XCTAssertEqual(research.blocks[0].text, block.text)
    }
    func testUnsafeCitationLinksAreNotAccepted() {
        for string in ["http://127.0.0.1/", "https://user:secret@park.example.org/", "https://host.local/", "file:///private/tmp/a"] {
            XCTAssertFalse(DynamicWebResearch.isPublicCitation(URL(string: string)!))
        }
    }
    func testBackendUnicodeCitationFixtureUsesNativeUTF16Ranges() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dynamic-web-unicode.json")
        let envelopes = try JSONDecoder().decode([DynamicWebResearch].self, from: Data(contentsOf: url))
        XCTAssertEqual(envelopes.count, 4)
        for research in envelopes {
            try research.validate()
            let block = try XCTUnwrap(research.blocks.first)
            let citation = try XCTUnwrap(block.citations.first)
            let range = try XCTUnwrap(Range(NSRange(location: citation.startIndex,
                length: citation.endIndex - citation.startIndex), in: block.text))
            XCTAssertEqual(String(block.text[range]), citation.title)
        }
    }

    func testScalarBoundariesAndExpiryAreConservative() throws {
        let url = URL(string: "https://park.example.org/ridge")!
        let text = "🥾 e\u{301} 山"
        for (start, end, valid) in [(0, 2, true), (3, 4, true), (4, 5, true), (1, 2, false), (0, 1, false), (-1, 2, false), (0, 99, false)] {
            let citation = DynamicWebResearch.Citation(url: url, title: "Source", startIndex: start, endIndex: end)
            let web = DynamicWebResearch(provider: "google_grounding", retrievedAt: "2026-09-07T00:00:00Z",
                blocks: [.init(text: text, citations: [citation])], searchSuggestions: ["<div>Offline</div>"],
                retrievedSourceURLs: [url], observedSearchQueries: 1)
            if valid { XCTAssertNoThrow(try web.validate()) } else { XCTAssertThrowsError(try web.validate()) }
            let now = ISO8601DateFormatter().date(from: "2026-09-07T01:00:00Z")!
            XCTAssertTrue(web.isAvailable(at: now))
            XCTAssertFalse(web.isAvailable(at: now.addingTimeInterval(86_400)))
            XCTAssertFalse(web.isAvailable(at: now.addingTimeInterval(-7_200)))
        }
    }

}
