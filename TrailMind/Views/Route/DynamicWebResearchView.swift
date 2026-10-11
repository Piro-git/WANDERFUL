import SwiftUI
import WebKit

struct DynamicWebResearchView: View {
    let research: DynamicWebResearch
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Original web research").font(.title3.weight(.semibold))
            Text("Research before route selection — includes alternatives and unconfirmed context. Only the stops listed above belong to this route. Source statements may be outdated; they do not verify route conditions.")
                .font(.caption).foregroundStyle(.secondary)
            if let evidence = research.routeEvidence {
                let excluded = evidence.places.filter { $0.selection == "excluded" }
                if !excluded.isEmpty {
                    Text("Not on this route: " + excluded.map(\.name).joined(separator: ", "))
                        .font(.subheadline.weight(.medium))
                        .accessibilityIdentifier("route.evidence.excluded")
                }
            }
            ForEach(Array(research.blocks.enumerated()), id: \.offset) { _, block in
                Text(attributed(block)).font(.subheadline).textSelection(.enabled)
            }
            // Keep the provider's complete suggestions alongside its unchanged grounded answer.
            ForEach(Array(research.searchSuggestions.enumerated()), id: \.offset) { _, html in
                GroundedSearchSuggestions(html: html, openLink: { openURL($0) })
                    .frame(height: 180)
                    .accessibilityLabel("Google Search suggestions")
            }
            // Separate from the complete provider result: preserve every citation,
            // including overlapping ranges that a single inline link cannot represent.
            DisclosureGroup("Source passages") {
                ForEach(Array(research.blocks.enumerated()), id: \.offset) { blockIndex, block in
                    ForEach(Array(block.citations.enumerated()), id: \.offset) { citationIndex, citation in
                        VStack(alignment: .leading, spacing: 6) {
                            Link("\(blockIndex + 1).\(citationIndex + 1) · \(citation.title.isEmpty ? citation.url.host ?? "Source" : citation.title)", destination: citation.url)
                            Text((block.text as NSString).substring(with: NSRange(location: citation.startIndex, length: citation.endIndex - citation.startIndex)))
                                .textSelection(.enabled)
                            Text("Attributed research passage, not a verified statement about this route.")
                                .foregroundStyle(.secondary)
                        }.font(.caption).padding(.vertical, 6)
                    }
                }
            }
        }
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22))
    }

    private func attributed(_ block: DynamicWebResearch.Block) -> AttributedString {
        var text = AttributedString(block.text)
        for citation in block.citations {
            let range = NSRange(location: citation.startIndex, length: citation.endIndex - citation.startIndex)
            if let stringRange = Range(range, in: block.text),
               let attributedRange = Range(stringRange, in: text) {
                text[attributedRange].link = citation.url
            }
        }
        return text
    }
}

private struct GroundedSearchSuggestions: UIViewRepresentable {
    let html: String
    let openLink: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(openLink: openLink) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.navigationDelegate = context.coordinator
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        // The snippet is unchanged. The container prevents scripts, forms and arbitrary subresource requests.
        let policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https://www.gstatic.com https://www.google.com; base-uri 'none'; form-action 'none'"
        view.loadHTMLString("<html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"\(policy)\"></head><body>\(html)</body></html>", baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var loadedHTML: String?
        let openLink: (URL) -> Void
        init(openLink: @escaping (URL) -> Void) { self.openLink = openLink }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
            if navigationAction.navigationType == .linkActivated, DynamicWebResearch.isPublicCitation(url) {
                openLink(url)
            }
            decisionHandler(.cancel)
        }
    }
}
