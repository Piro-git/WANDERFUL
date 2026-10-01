import SwiftUI

struct RouteLocalConditionsView: View {
    let conditions: RouteLocalConditions?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            VStack(alignment: .leading, spacing: 14) {
                Label("Before you set off", systemImage: "leaf")
                    .font(.title3.weight(.semibold))
                if let conditions {
                    let stale = conditions.needsRefresh(at: context.date)
                    Text(stale ? "Saved information needs a fresh check." : "A limited check of local sources.")
                        .font(.subheadline.weight(.medium))
                        .accessibilityIdentifier("route.conditions.status")
                    Text(conditions.visitTime == nil
                         ? "No hiking date was provided. These reports describe the checked time, not a future trip."
                         : "Reports were compared with your planned start. Conditions can still change.")
                        .font(.caption).foregroundStyle(.secondary)
                    if conditions.sources.contains(where: { $0.reason == "final_itinerary_changed" }) {
                        Text("The route changed after the local search. Added areas or stops have not been checked.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    if conditions.notices.isEmpty {
                        Text("No relevant report was returned by the listed sources. This does not confirm that paths are open.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    ForEach(Array(conditions.notices.prefix(3))) { notice in
                        noticeRow(notice, stale: stale)
                    }
                    if conditions.notices.count > 3 {
                        DisclosureGroup("More local reports (\(conditions.notices.count - 3))") {
                            ForEach(Array(conditions.notices.dropFirst(3))) { notice in
                                noticeRow(notice, stale: stale).padding(.top, 10)
                            }
                        }.font(.subheadline)
                    }
                    DisclosureGroup("Sources and coverage") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(conditions.sources) { source in
                                VStack(alignment: .leading, spacing: 3) {
                                    if let url = source.url {
                                        Link(source.name, destination: url)
                                    } else { Text(source.name) }
                                    Text(source.state == "checked" ? "Checked within the search area; coverage is limited."
                                         : source.state == "unavailable" ? "Could not be checked." : "Not checked for this area.")
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Text("Check weather, local rules and signs before starting. A lack of reports is not an assurance of access or safety.")
                                .foregroundStyle(.secondary)
                        }.font(.caption).padding(.top, 8)
                    }.font(.subheadline)
                    if let research = conditions.researchEvidence, research.isAvailable(at: context.date) {
                        DynamicRouteEvidenceView(stops: [], explanation: nil, research: research)
                    }
                    if let checked = PlanningEvidenceDate.parse(conditions.checkedAt) {
                        Text("Checked: \(checked.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                } else {
                    Text("Current local conditions have not been checked for this route.")
                        .font(.subheadline).accessibilityIdentifier("route.conditions.status")
                    Text("Review official local notices, weather and signs before starting.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(18)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22))
            .accessibilityIdentifier("route.conditions")
        }
    }

    private func noticeRow(_ notice: RouteLocalConditions.Notice, stale: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(notice.title).font(.subheadline.weight(.semibold))
            Text(notice.areaLabel).font(.caption)
            Text(notice.spatial == "route" ? "The route intersects the reported area."
                 : notice.spatial == "area" ? "Reported in the surrounding area; route impact is unconfirmed."
                 : "Location could not be matched to the route.")
                .font(.caption).foregroundStyle(.secondary)
            Text(validityLabel(notice, stale: stale)).font(.caption.weight(.medium))
            if let start = PlanningEvidenceDate.parse(notice.validFrom),
               let end = PlanningEvidenceDate.parse(notice.validUntil) {
                Text("Applies: \(start.formatted(date: .abbreviated, time: .shortened)) – \(end.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if let reason = notice.relevanceReason { Text(reason).font(.caption).foregroundStyle(.secondary) }
            Text(notice.action).font(.caption)
            if let excerpt = notice.sourceExcerpt {
                DisclosureGroup("Reported details") { Text(excerpt).font(.caption).padding(.top, 6) }.font(.caption)
            }
            Link(notice.source.name, destination: notice.source.url).font(.caption)
            if let published = PlanningEvidenceDate.parse(notice.publishedAt) {
                Text("Published: \(published.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2).foregroundStyle(.secondary)
            } else {
                Text("Publication date not provided.").font(.caption2).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 4)
    }

    private func validityLabel(_ notice: RouteLocalConditions.Notice, stale: Bool) -> String {
        if stale { return "Saved report — check the source again." }
        switch notice.validity {
        case "active": return "Reported as active for the checked time."
        case "expired": return "The reported period has ended; current access is unconfirmed."
        case "revoked": return "This report was withdrawn; other restrictions may still apply."
        case "conflicting": return "Sources disagree. Confirm the situation with the operator."
        case "future": return "Reported for a later period."
        case "stale": return "The report is too old to confirm current conditions."
        default: return "The applicable period is unconfirmed."
        }
    }
}

#Preview { RouteLocalConditionsView(conditions: nil) }
