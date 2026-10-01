import SwiftUI

struct DynamicResearchStopsView: View {
    let stops: [DynamicResearchStop]
    let explanation: String?
    var research: DynamicWebResearch? = nil

    var body: some View {
        if !stops.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                Text("Stops on this route").font(.title3.weight(.semibold))
                if let explanation {
                    Text(explanation).font(.subheadline).foregroundStyle(.secondary)
                }
                Text("Check local access and conditions before you go.")
                    .font(.subheadline).foregroundStyle(.secondary)
                CommonsRoutePhotoGallery(stops: stops)
                ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(index + 1). \(stop.name)").font(.headline)
                        if let access = stop.access, access.state == .documented {
                            Text(LocalizedStringKey(access.target?.kind == "entrance"
                                 ? "Route to a mapped entrance. Visiting the place itself is not confirmed."
                                 : "Mapped connection found. Current access is not guaranteed."))
                                .font(.caption).foregroundStyle(.secondary)
                            if let target = access.target, target.kind == "entrance" {
                                DisclosureGroup("Entrance details") {
                                    Text("Entrance is \(target.straightLineOffsetMeters) m from the mapped centre in a straight line. Remaining walking distance is unknown.")
                                        .font(.caption).foregroundStyle(.secondary)
                                    if let reference = access.evidence.first(where: { $0.id == target.osmId }) {
                                        Link("Mapped entrance", destination: reference.url).font(.caption).frame(minHeight: 44)
                                    }
                                }.font(.caption).frame(minHeight: 44)
                            }
                        } else {
                            Text("Access connection is unconfirmed. Check local signs and rules.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if let claims = research?.routeEvidence?.claims.filter({ $0.placeId == stop.id && $0.relationship == "source_passage" }), !claims.isEmpty {
                            DisclosureGroup("Source passages") {
                                ForEach(claims, id: \.id) { claim in
                                    if let passage = claim.sourcePassage {
                                        VStack(alignment: .leading, spacing: 6) {
                                            Text(passage.text).font(.caption)
                                            Link("Read source", destination: passage.url).font(.caption)
                                            Text("Source statement; current route conditions are not confirmed.").font(.caption2).foregroundStyle(.secondary)
                                        }.padding(.vertical, 6)
                                    }
                                }
                            }.font(.caption)
                        }
                        DisclosureGroup {
                            VStack(alignment: .leading, spacing: 8) {
                                webStatus(for: stop).font(.caption).foregroundStyle(.secondary)
                                    .accessibilityIdentifier("route.evidence.\(stop.id)")
                                Link("OpenStreetMap source", destination: stop.source.url).font(.caption).frame(minHeight: 44)
                                Text("© OpenStreetMap contributors · ODbL 1.0").font(.caption2).foregroundStyle(.secondary)
                                Text("Source date: \(String(stop.source.snapshotAt.prefix(10)))").font(.caption2).foregroundStyle(.secondary)
                            }
                        } label: {
                            Text("Sources & details").frame(minHeight: 44)
                                .accessibilityIdentifier("route.sources.\(stop.id)")
                        }.font(.subheadline)

                    }
                    if index < stops.count - 1 { Divider() }
                }
            }
            .padding(18)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22))
        }
    }
    private func webStatus(for stop: DynamicResearchStop) -> Text {
        guard let research, research.isAvailable() else {
            return Text("Web evidence unavailable in this view. It is not stored with saved routes.")
        }
        let claims = research.routeEvidence?.claims.filter { $0.placeId == stop.id && ["source_identity", "source_passage"].contains($0.relationship) } ?? []
        guard !claims.isEmpty else { return Text("No web passage reliably linked to this stop.") }
        let references = claims.map { "\($0.blockIndex + 1).\($0.citationIndex + 1)" }.joined(separator: ", ")
        return Text("Research links a source identity or named passage (\(references)). Read the original research for context; its statements are not confirmed route conditions.")
    }
}

#Preview {
    DynamicResearchStopsView(stops: [], explanation: nil)
}

/// Shared by the route detail and the simulator's deterministic display check.
struct DynamicRouteEvidenceView: View {
    let stops: [DynamicResearchStop]
    let explanation: String?
    let research: DynamicWebResearch?
    @State private var isResearchExpanded = false
    @State private var now = Date.now

    var body: some View {
        let available = research.flatMap { $0.isAvailable(at: now) ? $0 : nil }
        VStack(alignment: .leading, spacing: 18) {
            DynamicResearchStopsView(stops: stops, explanation: explanation, research: available)
            if let available {
                DisclosureGroup("Research and alternatives", isExpanded: $isResearchExpanded) {
                    DynamicWebResearchView(research: available)
                }
                .accessibilityIdentifier("route.evidence.originalResearch")
            }
        }
        .task(id: research?.retrievedAt) {
            now = .now
            guard let research else { return }
            while research.isAvailable(at: now) {
                do { try await Task.sleep(for: .seconds(60)) }
                catch { return }
                guard !Task.isCancelled else { return }
                now = .now
            }
        }
    }
}
