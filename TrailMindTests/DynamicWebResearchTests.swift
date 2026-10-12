import Foundation
import XCTest
@testable import TrailMind

final class DynamicWebResearchTests: XCTestCase {
    func testGroundedTextRequiresCitationsAndSuccessfulSourceButSuggestionsAreOptional() throws {
        let url = URL(string: "https://park.example.org/ridge")!
        let citation = DynamicWebResearch.Citation(url: url, title: "Park source", startIndex: 0, endIndex: 36)
        let block = DynamicWebResearch.Block(text: "The park describes a ridge viewpoint.", citations: [citation])
        let research = DynamicWebResearch(provider: "google_grounding", retrievedAt: "2026-09-07T00:00:00Z",
            blocks: [block], searchSuggestions: ["<div>Provider suggestions</div>"], retrievedSourceURLs: [url], observedSearchQueries: 1)
        XCTAssertNoThrow(try research.validate())
        let missing = DynamicWebResearch(provider: research.provider, retrievedAt: research.retrievedAt,
            blocks: research.blocks, searchSuggestions: [], retrievedSourceURLs: [url], observedSearchQueries: 1)
        XCTAssertNoThrow(try missing.validate())
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
            let start = try XCTUnwrap(citation.startIndex), end = try XCTUnwrap(citation.endIndex)
            let range = try XCTUnwrap(Range(NSRange(location: start, length: end - start), in: block.text))
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

    func testSharedOptionalMetadataFixtureHasNoInventedQueryCountOrTextRange() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dynamic-web-optional-metadata.json")
        let research = try JSONDecoder().decode(DynamicWebResearch.self, from: Data(contentsOf: url))
        try research.validate()
        XCTAssertNil(research.observedSearchQueries)
        XCTAssertEqual(research.observedSearchCalls, 1)
        XCTAssertTrue(research.searchSuggestions.isEmpty)
        let block = try XCTUnwrap(research.blocks.first), citation = try XCTUnwrap(block.citations.first)
        XCTAssertEqual(citation.scope, .source)
        XCTAssertNil(citation.startIndex); XCTAssertNil(citation.endIndex)
        XCTAssertNil(citation.passage(in: block.text))
        XCTAssertFalse(DynamicWebResearch.validRange(citation, in: block.text))
    }

    func testUnknownQueriesRequireSuccessfulSearchCallsAndSourceReferencesRequireTheirOwnRead() throws {
        let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/dynamic-web-optional-metadata.json")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        for change in ["missingCalls", "zeroCalls", "negativeQueries", "oversizedQueries", "unread", "scope", "inventedSpan", "missingScope"] {
            var invalid = object
            switch change {
            case "missingCalls": invalid.removeValue(forKey: "observedSearchCalls")
            case "zeroCalls": invalid["observedSearchCalls"] = 0
            case "negativeQueries": invalid["observedSearchQueries"] = -1
            case "oversizedQueries": invalid["observedSearchQueries"] = 1201
            case "unread": invalid["retrievedSourceURLs"] = ["https://other.example.org/source"]
            default:
                var blocks = invalid["blocks"] as! [[String: Any]]
                var citations = blocks[0]["citations"] as! [[String: Any]]
                if change == "scope" { citations[0]["scope"] = "verified" }
                if change == "inventedSpan" { citations[0]["startIndex"] = 0; citations[0]["endIndex"] = 2 }
                if change == "missingScope" { citations[0].removeValue(forKey: "scope") }
                blocks[0]["citations"] = citations; invalid["blocks"] = blocks
            }
            XCTAssertThrowsError(try JSONDecoder().decode(DynamicWebResearch.self,
                from: JSONSerialization.data(withJSONObject: invalid)).validate(), change)
        }
        var zero = object; zero["observedSearchQueries"] = 0
        XCTAssertNoThrow(try JSONDecoder().decode(DynamicWebResearch.self,
            from: JSONSerialization.data(withJSONObject: zero)).validate())
    }

    func testUnicodePassageExtractionAllowsScalarButNotSurrogateSplits() {
        let url = URL(string: "https://park.example.org/source")!
        let text = "🥾 e\u{301} 山"
        XCTAssertEqual(DynamicWebResearch.Citation(url: url, title: "Source", startIndex: 4, endIndex: 5).passage(in: text), "\u{301}")
        XCTAssertNil(DynamicWebResearch.Citation(url: url, title: "Source", startIndex: 1, endIndex: 2).passage(in: text))
    }

}
