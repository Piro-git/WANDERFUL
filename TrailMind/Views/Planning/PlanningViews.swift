import SwiftUI

struct GeneratingRouteView: View {
    @Environment(TrailTheme.self) private var theme
    let planner: PlannerViewModel

    var body: some View {
        VStack(spacing: 30) {
            Spacer()

            ZStack {
                Circle()
                    .stroke(theme.mossSoft.opacity(0.5), lineWidth: 20)
                    .frame(width: 170, height: 170)

                Circle()
                    .trim(from: 0, to: progressFraction)
                    .stroke(
                        AngularGradient(colors: [theme.moss, theme.forestBright, theme.moss], center: .center),
                        style: StrokeStyle(lineWidth: 20, lineCap: .round)
                    )
                    .frame(width: 170, height: 170)
                    .rotationEffect(.degrees(-90))
                    .animation(.smooth(duration: 0.6), value: planner.completedGenerationStageCount)

                if planner.generationFailure != nil {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 42, weight: .medium))
                        .foregroundStyle(theme.warning)
                } else {
                    Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                        .font(.system(size: 46, weight: .medium))
                        .foregroundStyle(theme.forest)
                        .contentTransition(.symbolEffect(.replace))
                }
            }

            VStack(spacing: 10) {
                Text(currentTitle)
                    .font(.trailSection)
                    .contentTransition(.numericText())
                    .id(currentTitle)
                    .transition(.blurReplace)

                Text("“\(planner.prompt)”")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .padding(.horizontal, 30)
            }

            VStack(spacing: 12) {
                ForEach(planner.generationStages) { stage in
                    HStack {
                        stageIndicator(for: stage.status)
                            .frame(width: 20, height: 20)
                        Text(stage.title)
                            .font(.subheadline)
                            .foregroundStyle(textColor(for: stage.status))
                        Spacer()
                    }
                }
            }
            .trailCard()
            .padding(.horizontal, TrailSpacing.page)

            Spacer()
            if let failure = planner.generationFailure {
                VStack(spacing: 12) {
                    Text(failure.message)
                        .font(.footnote)
                        .foregroundStyle(theme.graphite)
                        .multilineTextAlignment(.center)

                    HStack(spacing: 12) {
                        Button("Edit request", action: planner.editRequest)
                            .buttonStyle(.bordered)
                        Button("Try again", action: planner.retryGeneration)
                            .buttonStyle(.borderedProminent)
                            .tint(theme.forest)
                    }
                }
                .padding(.horizontal, TrailSpacing.page)
                .padding(.bottom, 20)
                .accessibilityIdentifier("generation.recovery")
            } else {
                VStack(spacing: 12) {
                    Text(planner.generationFooter)
                        .font(.caption)
                        .foregroundStyle(theme.secondaryText)

                    Button("Cancel", role: .cancel, action: planner.cancelGeneration)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(theme.forest)
                        .accessibilityIdentifier("generation.cancel")
                }
                .padding(.bottom, 20)
            }
        }
        .task(id: planner.generationRequestID) {
            guard planner.generationRequestID != nil else { return }
            await planner.generate()
        }
    }

    private var currentTitle: String {
        planner.generationStages.first { $0.status == .active || $0.status == .failed }?.title
            ?? "Preparing your route"
    }

    private var progressFraction: CGFloat {
        guard !planner.generationStages.isEmpty else { return 0 }
        return CGFloat(planner.completedGenerationStageCount) / CGFloat(planner.generationStages.count)
    }

    @ViewBuilder
    private func stageIndicator(for status: PlannerViewModel.GenerationStageStatus) -> some View {
        switch status {
        case .completed:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(theme.moss)
        case .active:
            ProgressView()
                .controlSize(.small)
                .tint(theme.moss)
        case .pending:
            Image(systemName: "circle")
                .foregroundStyle(theme.secondaryText.opacity(0.3))
        case .failed:
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(theme.warning)
        }
    }

    private func textColor(for status: PlannerViewModel.GenerationStageStatus) -> Color {
        switch status {
        case .active, .completed, .failed:
            theme.graphite
        case .pending:
            theme.secondaryText.opacity(0.55)
        }
    }
}

struct RouteSuggestionsView: View {
    @Environment(TrailTheme.self) private var theme
    let prompt: String
    let suggestions: [RouteSuggestion]
    let notice: String?
    let onStartOver: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TrailSpacing.section) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(routeCountTitle)
                        .font(.trailTitle)
                    Text("Built around “\(prompt)”")
                        .font(.body)
                        .foregroundStyle(theme.secondaryText)
                        .lineLimit(3)
                }

                if let notice {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "info.circle.fill")
                            .foregroundStyle(theme.moss)
                        Text(notice)
                            .font(.footnote)
                            .foregroundStyle(theme.graphite)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(14)
                    .background(theme.sand.opacity(0.62), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                }

                ForEach(suggestions) { suggestion in
                    NavigationLink(value: suggestion.route) {
                        RouteCard(
                            route: suggestion.route,
                            matchScore: suggestion.matchScore,
                            qualityExplanations: RouteQualityExplanationGenerator.explanations(
                                for: suggestion.route,
                                debugMetadata: suggestion.debugMetadata,
                                maximumCount: 3
                            )
                        )
                    }
                    .buttonStyle(.plain)
                }

                Button(action: onStartOver) {
                    Label("Plan something different", systemImage: "arrow.counterclockwise")
                        .font(.headline)
                        .foregroundStyle(theme.forest)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.plain)

                Text("Always check local rules, weather, trail conditions and water availability before starting.")
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
            }
            .padding(TrailSpacing.page)
        }
        .navigationTitle("Your routes")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var routeCountTitle: String {
        switch suggestions.count {
        case 2:
            "2 routes to compare"
        case 3:
            "3 routes to compare"
        default:
            "Your routes"
        }
    }
}
