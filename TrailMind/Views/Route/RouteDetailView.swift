import SwiftUI

struct RouteDetailView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(AppModel.self) private var appModel
    @State private var showStartNotice = false
    #if DEBUG
    @State private var showIntentQA = false
    #endif

    let route: TrailRoute

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                MapPreviewView(route: route)
                    .frame(height: 310)
                    .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
                    .padding(.horizontal, 10)

                VStack(alignment: .leading, spacing: TrailSpacing.section) {
                    header
                    RouteStatsRow(route: route)
                    planningContext
                    #if DEBUG
                    intentQA
                    #endif
                    ElevationProfileView(route: route)
                    highlights
                    waypoints

                    if !route.days.isEmpty {
                        dayBreakdown
                    }

                    safety
                    export
                }
                .padding(TrailSpacing.page)
            }
        }
        .background(TrailBackground())
        .scrollIndicators(.hidden)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    appModel.toggleSaved(route)
                } label: {
                    Image(systemName: appModel.isSaved(route) ? "bookmark.fill" : "bookmark")
                }
                .accessibilityLabel(appModel.isSaved(route) ? "Remove from saved routes" : "Save route")
            }
        }
        .safeAreaInset(edge: .bottom) {
            bottomActions
        }
        .alert("Navigation foundation ready", isPresented: $showStartNotice) {
            Button("Got it", role: .cancel) { }
        } message: {
            Text("Turn-by-turn guidance will connect here next. Review the full route, current weather and local trail conditions before starting.")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(route.location, systemImage: "location.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.moss)
                Spacer()
                DifficultyBadge(difficulty: route.difficulty)
            }

            Text(route.title)
                .font(.trailTitle)
                .foregroundStyle(theme.graphite)
                .fixedSize(horizontal: false, vertical: true)

            Text(route.summary)
                .font(.body)
                .foregroundStyle(theme.secondaryText)
                .lineSpacing(4)
        }
    }

    #if DEBUG
    @ViewBuilder
    private var intentQA: some View {
        if let metadata = route.intentDebugMetadata {
            DisclosureGroup(isExpanded: $showIntentQA) {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(IntentDebugFormatter.rows(for: metadata)) { row in
                        HStack(alignment: .top, spacing: 10) {
                            Text(row.label)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(theme.secondaryText)
                                .frame(width: 132, alignment: .leading)
                            Text(row.value)
                                .font(.caption.monospaced())
                                .foregroundStyle(theme.graphite)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .padding(.top, 10)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: metadata.localFallbackUsed ? "arrow.uturn.backward.circle.fill" : "sparkles")
                        .foregroundStyle(theme.forest)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Intent QA")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(theme.graphite)
                        Text("\(IntentDebugFormatter.parserSourceLabel(metadata.intent.parserSource)) · \(metadata.localFallbackUsed ? "local fallback" : "primary parser")")
                            .font(.caption)
                            .foregroundStyle(theme.secondaryText)
                    }
                }
            }
            .trailCard()
        }
    }
    #endif

    private var highlights: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "Why you’ll remember it")
            ForEach(route.highlights) { highlight in
                HStack(spacing: 14) {
                    Image(systemName: highlight.symbol)
                        .font(.headline)
                        .foregroundStyle(theme.forest)
                        .frame(width: 42, height: 42)
                        .background(theme.mossSoft.opacity(0.7), in: RoundedRectangle(cornerRadius: 13, style: .continuous))

                    VStack(alignment: .leading, spacing: 3) {
                        Text(highlight.title)
                            .font(.subheadline.weight(.bold))
                        Text(highlight.subtitle)
                            .font(.caption)
                            .foregroundStyle(theme.secondaryText)
                    }
                }
            }
        }
        .trailCard()
    }

    @ViewBuilder
    private var planningContext: some View {
        if let metadata = route.planningMetadata, !metadata.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(title: "Planned for you", subtitle: "Intent hints from your prompt, kept separate from verified map data.")

                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        PlanningChip(label: metadata.activityType.rawValue, symbol: metadata.activityType.symbol)

                        if metadata.routeType == .loop {
                            PlanningChip(label: "Loop route", symbol: "arrow.trianglehead.2.clockwise.rotate.90")
                        }

                        if let variantLabel = metadata.variantLabel {
                            PlanningChip(label: variantLabel, symbol: "slider.horizontal.3")
                        }

                        if let targetDistanceKm = metadata.targetDistanceKm {
                            PlanningChip(
                                label: "ca. \(targetDistanceKm.formatted(.number.precision(.fractionLength(targetDistanceKm.rounded() == targetDistanceKm ? 0 : 1)))) km",
                                symbol: "ruler"
                            )
                        }

                        if let targetDurationMinutes = metadata.targetDurationMinutes {
                            PlanningChip(label: Self.durationHintLabel(minutes: targetDurationMinutes), symbol: "clock")
                        }

                        if let difficulty = metadata.difficulty {
                            PlanningChip(label: difficulty.rawValue, symbol: difficulty.symbol)
                        }

                        ForEach(metadata.desiredFeatures, id: \.self) { feature in
                            PlanningChip(label: feature.label, symbol: feature.symbol)
                        }
                    }
                    .padding(.vertical, 1)
                }
                .scrollIndicators(.hidden)

                if let requestedFeatureSummary = metadata.requestedFeatureSummary {
                    Text(requestedFeatureSummary)
                        .font(.caption)
                        .foregroundStyle(theme.secondaryText)
                }

                if let distanceNote = metadata.distanceNote(actualDistanceKm: route.distanceKilometers) {
                    Text(distanceNote)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.moss)
                }

                let qualityExplanations = RouteQualityExplanationGenerator.explanations(for: route)
                if !qualityExplanations.isEmpty {
                    RouteQualityExplanationList(explanations: qualityExplanations)
                }
            }
            .trailCard()
        }
    }

    private var waypoints: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "Along the way", subtitle: "\(route.waypoints.count) useful moments, in order")
            WaypointTimelineView(waypoints: route.waypoints)
        }
    }

    private var dayBreakdown: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "Day by day")
            ForEach(route.days) { day in
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top) {
                        Text("DAY \(day.dayNumber)")
                            .font(.caption.weight(.bold))
                            .tracking(1)
                            .foregroundStyle(theme.moss)
                        Spacer()
                        Text("\(day.distanceKilometers.formatted()) km · +\(day.elevationGainMeters) m")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(theme.secondaryText)
                    }
                    Text(day.title)
                        .font(.headline)
                    Text(day.summary)
                        .font(.subheadline)
                        .foregroundStyle(theme.secondaryText)
                        .lineSpacing(3)
                }
                .trailCard()
            }
        }
    }

    private var safety: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Safety & planning", subtitle: "Useful context, never a substitute for current local information.")
            ForEach(route.safetyNotes) { note in
                SafetyNoteCard(note: note)
            }
        }
    }

    private var export: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Take it with you")
            ShareLink(item: (try? DefaultGPXService().exportRouteAsGPX(route: route)) ?? "") {
                Label("Export GPX", systemImage: "square.and.arrow.up")
                    .font(.headline)
                    .foregroundStyle(theme.forest)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
        .padding(.bottom, 18)
    }

    private var bottomActions: some View {
        HStack(spacing: 10) {
            NavigationLink {
                RouteEditAIView(route: route)
            } label: {
                Label("Edit with AI", systemImage: "sparkles")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(theme.forest)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
            }
            .buttonStyle(.plain)
            .trailGlass(cornerRadius: 18, interactive: true)
            .accessibilityIdentifier("route.editAI")

            Button {
                showStartNotice = true
            } label: {
                Label("Start route", systemImage: "location.fill")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(theme.forest, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, TrailSpacing.page)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private static func durationHintLabel(minutes: Int) -> String {
        let hours = minutes / 60
        let remainder = minutes % 60
        if hours == 0 {
            return "ca. \(remainder) min"
        }
        return remainder == 0 ? "ca. \(hours) hr" : "ca. \(hours) hr \(remainder) min"
    }
}

private struct PlanningChip: View {
    @Environment(TrailTheme.self) private var theme

    let label: String
    let symbol: String

    var body: some View {
        Label(label, systemImage: symbol)
            .font(.caption.weight(.bold))
            .foregroundStyle(theme.forest)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(theme.mossSoft.opacity(0.62), in: Capsule())
    }
}

struct RouteStatsRow: View {
    let route: TrailRoute

    var body: some View {
        HStack(spacing: 8) {
            StatPill(value: route.distanceLabel, label: "Distance", symbol: "point.bottomleft.forward.to.point.topright.scurvepath")
            StatPill(value: route.elevationLabel, label: "Elevation", symbol: "mountain.2.fill")
            StatPill(value: route.durationLabel, label: "Duration", symbol: "clock.fill")
            StatPill(value: route.routeType.rawValue, label: "Type", symbol: "arrow.trianglehead.2.clockwise.rotate.90")
        }
        .trailCard()
    }
}
