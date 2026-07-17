import SwiftUI

enum PlanningAccessibilityID {
    static let promptInput = "composer.prompt"
    static let submit = "composer.submit"
    static let loading = "planning.loading"
    static let clarificationQuestion = "planning.clarification.question"
    static let clarificationAnswer = "planning.clarification.answer"
    static let clarificationContinue = "planning.clarification.continue"
    static let cancel = "generation.cancel"
    static let retry = "planning.retry"
    static let editPrompt = "planning.editPrompt"
    static let error = "planning.error"
    static let noRoutes = "planning.noRoutes"
    static let cancelled = "planning.cancelled"
    static let suggestions = "planning.suggestions"
    static let startOver = "planning.startOver"
}

struct GeneratingRouteView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
                    .animation(
                        reduceMotion ? nil : .smooth(duration: 0.6),
                        value: planner.completedGenerationStageCount
                    )

                Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                    .font(.system(size: 46, weight: .medium))
                    .foregroundStyle(theme.forest)
                    .contentTransition(.symbolEffect(.replace))
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

            VStack(spacing: 12) {
                Text(planner.generationFooter)
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)

                Button("Cancel", role: .cancel, action: planner.cancelGeneration)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.forest)
                    .accessibilityIdentifier(PlanningAccessibilityID.cancel)
            }
            .padding(.bottom, 20)
        }
        .accessibilityIdentifier(PlanningAccessibilityID.loading)
    }

    private var currentTitle: String {
        planner.generationStages.first { $0.status == .active }?.title
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

struct PlanningClarificationView: View {
    @Environment(TrailTheme.self) private var theme
    @FocusState private var isTextAnswerFocused: Bool
    let clarification: PlannerViewModel.PendingClarification
    let onSubmit: (PlannerViewModel.ClarificationAnswer) -> Void
    let onCancel: () -> Void
    let onEditPrompt: () -> Void
    @State private var textAnswer = ""
    @State private var routeTypeSelection: TrailRouteType?

    var body: some View {
        ScrollView {
            VStack(spacing: TrailSpacing.section) {
                ClarificationHeader(originalPrompt: clarification.originalPrompt)

                VStack(alignment: .leading, spacing: 18) {
                    Label("One quick detail", systemImage: "questionmark.bubble.fill")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(theme.moss)

                    Text(clarification.question)
                        .font(.trailSection)
                        .foregroundStyle(theme.graphite)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier(PlanningAccessibilityID.clarificationQuestion)

                    answerContent

                    PrimaryButton(title: "Continue", symbol: "arrow.right") {
                        submitAnswer()
                    }
                    .disabled(!canContinue)
                    .opacity(canContinue ? 1 : 0.45)
                    .accessibilityIdentifier(PlanningAccessibilityID.clarificationContinue)
                }
                .trailCard()

                HStack(spacing: 12) {
                    Button("Edit prompt", action: onEditPrompt)
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier(PlanningAccessibilityID.editPrompt)

                    Button("Cancel", role: .cancel, action: onCancel)
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier(PlanningAccessibilityID.cancel)
                }

                Text("TrailMind will only add this answer to the missing part of your request.")
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)
                    .multilineTextAlignment(.center)
            }
            .padding(TrailSpacing.page)
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Clarify route")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    isTextAnswerFocused = false
                }
                .accessibilityIdentifier("composer.keyboardDone")
            }
        }
    }

    @ViewBuilder
    private var answerContent: some View {
        switch clarification.kind {
        case .location:
            TextField("Enter a place or trailhead", text: $textAnswer)
                .focused($isTextAnswerFocused)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .padding(.horizontal, 15)
                .padding(.vertical, 14)
                .frame(minHeight: 52)
                .background(theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(theme.forest.opacity(0.12), lineWidth: 1)
                }
                .accessibilityIdentifier(PlanningAccessibilityID.clarificationAnswer)

        case .routeType:
            VStack(spacing: 10) {
                ClarificationChoiceButton(
                    title: "Loop route",
                    symbol: "arrow.trianglehead.2.clockwise.rotate.90",
                    isSelected: routeTypeSelection == .loop
                ) {
                    routeTypeSelection = .loop
                }
                ClarificationChoiceButton(
                    title: "Route to a destination",
                    symbol: "point.bottomleft.forward.to.point.topright.scurvepath",
                    isSelected: routeTypeSelection == .pointToPoint
                ) {
                    routeTypeSelection = .pointToPoint
                }
            }
            .accessibilityIdentifier(PlanningAccessibilityID.clarificationAnswer)
        }
    }

    private var canContinue: Bool {
        switch clarification.kind {
        case .location:
            !textAnswer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .routeType:
            routeTypeSelection != nil
        }
    }

    private func submitAnswer() {
        switch clarification.kind {
        case .location:
            onSubmit(.text(textAnswer))
        case .routeType:
            guard let routeTypeSelection else { return }
            onSubmit(.routeType(routeTypeSelection))
        }
    }
}

private struct ClarificationHeader: View {
    @Environment(TrailTheme.self) private var theme
    let originalPrompt: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your request")
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.moss)
                .textCase(.uppercase)
                .tracking(0.8)
            Text("“\(originalPrompt)”")
                .font(.body)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ClarificationChoiceButton: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    let symbol: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .frame(width: 24)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? theme.moss : theme.secondaryText.opacity(0.4))
            }
            .foregroundStyle(theme.graphite)
            .padding(.horizontal, 15)
            .padding(.vertical, 14)
            .frame(minHeight: 52)
            .background(
                isSelected ? theme.mossSoft.opacity(0.7) : theme.surface,
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(isSelected ? theme.moss.opacity(0.45) : theme.forest.opacity(0.1), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityValue(isSelected ? "Selected" : "Not selected")
    }
}

enum PlanningRecoveryPresentation: Equatable {
    case error
    case noRoutes
    case cancelled

    var title: String {
        switch self {
        case .error:
            "We couldn’t finish that route"
        case .noRoutes:
            "No mapped route found"
        case .cancelled:
            "Planning cancelled"
        }
    }

    var symbol: String {
        switch self {
        case .error:
            "exclamationmark.triangle.fill"
        case .noRoutes:
            "map.fill"
        case .cancelled:
            "xmark.circle.fill"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .error:
            PlanningAccessibilityID.error
        case .noRoutes:
            PlanningAccessibilityID.noRoutes
        case .cancelled:
            PlanningAccessibilityID.cancelled
        }
    }
}

struct PlanningRecoveryView: View {
    @Environment(TrailTheme.self) private var theme
    let recovery: PlannerViewModel.PlanningRecovery
    let presentation: PlanningRecoveryPresentation
    let onRetry: () -> Void
    let onEditPrompt: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: TrailSpacing.section) {
                Spacer(minLength: 44)

                Image(systemName: presentation.symbol)
                    .font(.system(size: 46, weight: .medium))
                    .foregroundStyle(presentation == .error ? theme.warning : theme.forest)
                    .frame(width: 96, height: 96)
                    .background(theme.mossSoft.opacity(0.55), in: Circle())

                VStack(spacing: 10) {
                    Text(presentation.title)
                        .font(.trailTitle)
                        .multilineTextAlignment(.center)

                    Text(recovery.message)
                        .font(.body)
                        .foregroundStyle(theme.secondaryText)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 7) {
                    Text("Your request")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(theme.moss)
                        .textCase(.uppercase)
                        .tracking(0.8)
                    Text("“\(recovery.originalPrompt)”")
                        .font(.subheadline)
                        .foregroundStyle(theme.graphite)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .trailCard()

                VStack(spacing: 12) {
                    PrimaryButton(title: "Try again", symbol: "arrow.clockwise", action: onRetry)
                        .accessibilityIdentifier(PlanningAccessibilityID.retry)

                    Button("Edit prompt", action: onEditPrompt)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(theme.forest)
                        .accessibilityIdentifier(PlanningAccessibilityID.editPrompt)
                }
            }
            .padding(TrailSpacing.page)
        }
        .accessibilityIdentifier(presentation.accessibilityIdentifier)
        .navigationTitle("Route planning")
        .navigationBarTitleDisplayMode(.inline)
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
                    PlanningNoticeView(message: notice, symbol: "info.circle.fill")
                }

                if let requestedPreferenceDisclosure {
                    PlanningNoticeView(
                        message: requestedPreferenceDisclosure,
                        symbol: "checklist.unchecked"
                    )
                }

                ForEach(suggestions) { suggestion in
                    NavigationLink {
                        RouteDetailView(route: suggestion.route)
                    } label: {
                        RouteCard(
                            route: suggestion.route,
                            comparisonLabel: suggestion.explanation,
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
                .accessibilityIdentifier(PlanningAccessibilityID.startOver)

                Text("Always check local rules, weather, trail conditions and water availability before starting.")
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
            }
            .padding(TrailSpacing.page)
        }
        .accessibilityIdentifier(PlanningAccessibilityID.suggestions)
        .navigationTitle("Your routes")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var requestedPreferenceDisclosure: String? {
        var summaries: [String] = []
        for suggestion in suggestions {
            guard let metadata = suggestion.route.planningMetadata else { continue }
            for summary in [metadata.requestedFeatureSummary, metadata.requestedDifficultySummary].compactMap({ $0 })
                where !summaries.contains(summary) {
                summaries.append(summary)
            }
        }
        guard !summaries.isEmpty else { return nil }
        return "\(summaries.joined(separator: " · ")). These are requested preferences, not verified guarantees."
    }

    private var routeCountTitle: String {
        switch suggestions.count {
        case 1:
            "1 route found"
        case 2:
            "2 routes to compare"
        case 3:
            "3 routes to compare"
        default:
            "Your routes"
        }
    }
}

private struct PlanningNoticeView: View {
    @Environment(TrailTheme.self) private var theme
    let message: String
    let symbol: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(theme.moss)
            Text(message)
                .font(.footnote)
                .foregroundStyle(theme.graphite)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(theme.sand.opacity(0.62), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
    }
}
