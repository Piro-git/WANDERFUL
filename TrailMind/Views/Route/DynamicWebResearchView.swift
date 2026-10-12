import SwiftUI
import WebKit

struct DynamicWebResearchView: View {
    let research: DynamicWebResearch
    @Environment(AppLanguageController.self) private var languageController
    private var isGerman: Bool { languageController.language == .german }
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(isGerman ? "Web-Recherche mit Google" : "Web research with Google").font(.title3.weight(.semibold))
            Text(isGerman ? "Die Recherche enthält auch Alternativen. Nur die oben genannten Stopps gehören zur Route. Quellen können veraltet sein und bestätigen keine aktuellen Bedingungen." : "Research includes alternatives. Only the stops listed above belong to this route. Sources may be outdated and do not confirm current conditions.")
                .font(.caption).foregroundStyle(.secondary)
            if let evidence = research.routeEvidence {
                let excluded = evidence.places.filter { $0.selection == "excluded" }
                if !excluded.isEmpty {
                    Text((isGerman ? "Nicht auf dieser Route: " : "Not on this route: ") + excluded.map(\.name).joined(separator: ", "))
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
                    .accessibilityLabel(isGerman ? "Suchvorschläge von Google" : "Google Search suggestions")
            }
            // Separate from the complete provider result: preserve every citation,
            // including overlapping ranges that a single inline link cannot represent.
            DisclosureGroup {
                ForEach(Array(research.blocks.enumerated()), id: \.offset) { blockIndex, block in
                    ForEach(Array(block.citations.enumerated()), id: \.offset) { citationIndex, citation in
                        VStack(alignment: .leading, spacing: 6) {
                            Link("\(blockIndex + 1).\(citationIndex + 1) · \(citation.title.isEmpty ? citation.url.host ?? (isGerman ? "Quelle" : "Source") : citation.title)", destination: citation.url)
                                .accessibilityIdentifier("route.evidence.sourceLink.\(blockIndex).\(citationIndex)")
                            if let passage = citation.passage(in: block.text) {
                                Text(passage).textSelection(.enabled)
                                Text(isGerman ? "Dieser Text verweist auf die Quelle. Aktuelle Bedingungen sind nicht bestätigt." : "This text cites the source. Current conditions are not confirmed.")
                                    .foregroundStyle(.secondary)
                            } else {
                                Text(isGerman ? "In der Recherche genannt und gelesen. Die Quelle ist keinem bestimmten Satz zugeordnet." : "Cited and read during research. The source is not linked to a specific sentence.")
                                    .foregroundStyle(.secondary)
                                    .accessibilityIdentifier("route.evidence.sourceScope.\(blockIndex).\(citationIndex)")
                            }
                        }.font(.caption).padding(.vertical, 6)
                    }
                }
            } label: {
                Text(isGerman ? "Quellen" : "Sources")
                    .accessibilityIdentifier("route.evidence.sources")
            }
        }
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22))
    }

    private func attributed(_ block: DynamicWebResearch.Block) -> AttributedString {
        var text = AttributedString(block.text)
        for citation in block.citations {
            guard citation.scope == .passage, DynamicWebResearch.validRange(citation, in: block.text),
                  let start = citation.startIndex, let end = citation.endIndex else { continue }
            let range = NSRange(location: start, length: end - start)
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
