import SwiftUI
import UIKit

struct PlanFlowView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(TrailTheme.self) private var theme
    @State private var planner: PlannerViewModel

    init(planner: PlannerViewModel = PlannerViewModel()) {
        _planner = State(initialValue: planner)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                TrailBackground()

                switch planner.state {
                case .idle, .editing:
                    HomeView(
                        initialPrompt: planner.prompt,
                        automaticallyPresentsComposer: planner.isEditing,
                        onPlan: startPlanning
                    )
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))

                case .understanding, .resolvingLocations, .generatingRoutes, .preparingSuggestions:
                    GeneratingRouteView(planner: planner)
                        .transition(.opacity)

                case let .awaitingClarification(clarification):
                    PlanningClarificationView(
                        clarification: clarification,
                        onSubmit: planner.submitClarification,
                        onCancel: planner.cancelGeneration,
                        onEditPrompt: planner.editRequest
                    )
                    .id(clarification.id)
                    .transition(.opacity.combined(with: .move(edge: .trailing)))

                case let .suggestionsReady(success):
                    RouteSuggestionsView(
                        prompt: success.originalPrompt,
                        suggestions: success.suggestions,
                        notice: success.notice,
                        researchContext: success.researchContext,
                        onStartOver: planner.reset
                    )
                    .transition(.opacity.combined(with: .move(edge: .trailing)))

                case let .noRoutes(recovery):
                    PlanningRecoveryView(
                        recovery: recovery,
                        presentation: .noRoutes,
                        onRetry: planner.retryGeneration,
                        onEditPrompt: planner.editRequest
                    )
                    .transition(.opacity)

                case let .recoverableError(recovery):
                    PlanningRecoveryView(
                        recovery: recovery,
                        presentation: .error,
                        onRetry: planner.retryGeneration,
                        onEditPrompt: planner.editRequest
                    )
                    .transition(.opacity)

                case let .cancelled(recovery):
                    PlanningRecoveryView(
                        recovery: recovery,
                        presentation: .cancelled,
                        onRetry: planner.retryGeneration,
                        onEditPrompt: planner.editRequest
                    )
                    .transition(.opacity)
                }
            }
            .animation(reduceMotion ? nil : .smooth, value: planner.phase)
        }
    }

    private func startPlanning(_ prompt: String) {
        withAnimation(reduceMotion ? nil : .smooth) {
            planner.startPlanning(prompt: prompt)
        }
    }
}

struct HomeRouteExample: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let prompt: String
    let symbol: String
}

struct HomeView: View {
    struct ComposerMode: Identifiable {
        let id = UUID()
        let startsListening: Bool
    }

    @Environment(TrailTheme.self) private var theme
    let initialPrompt: String
    let automaticallyPresentsComposer: Bool
    let onPlan: (String) -> Void
    @State private var composerMode: ComposerMode?
    @State private var voiceLanguage = VoicePlanningLanguage.deviceDefault

    static let routeExamples = [
        HomeRouteExample(
            id: "loop",
            title: "15 km loop",
            prompt: "15 km Rundwanderung um Ilsenburg",
            symbol: "arrow.trianglehead.2.clockwise.rotate.90"
        ),
        HomeRouteExample(
            id: "pointToPoint",
            title: "Ilsenburg to Schierke",
            prompt: "Plan a hike from Ilsenburg to Schierke",
            symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
        ),
        HomeRouteExample(
            id: "trailRun",
            title: "2-hour trail run",
            prompt: "Trailrun loop from Ilsenburg for 2 hours",
            symbol: "figure.run"
        ),
        HomeRouteExample(
            id: "bike",
            title: "Lüneburg bike route",
            prompt: "Radroute von Lüneburg nach Amelinghausen",
            symbol: "figure.outdoor.cycle"
        )
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: TrailSpacing.section) {
                hero

                VStack(alignment: .leading, spacing: 14) {
                    SectionHeader(title: "Start with a thought", subtitle: "Tap an idea and make it yours.")

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(Self.routeExamples) { example in
                                PromptChip(
                                    title: example.title,
                                    symbol: example.symbol,
                                    accessibilityID: "home.example.\(example.id)"
                                ) {
                                    onPlan(example.prompt)
                                }
                            }
                        }
                    }
                    .contentMargins(.horizontal, TrailSpacing.page, for: .scrollContent)
                    .contentMargins(.horizontal, -TrailSpacing.page)
                }

            }
            .padding(.horizontal, TrailSpacing.page)
            .padding(.bottom, 30)
        }
        .scrollIndicators(.hidden)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(item: $composerMode) { mode in
            PromptComposerView(
                startsListening: mode.startsListening,
                initialPrompt: initialPrompt,
                language: $voiceLanguage,
                onSubmit: onPlan
            )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(theme.warmWhite)
        }
        .onAppear(perform: presentComposerForEditingIfNeeded)
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HStack(spacing: 8) {
                    Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                    Text("TrailMind")
                        .fontWeight(.bold)
                }
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.82))
            }

            Spacer(minLength: 36)

            Text("Where should\nwe go next?")
                .font(.trailHero)
                .foregroundStyle(.white)
                .tracking(-1.1)

            Text("Describe a route. TrailMind calculates it on mapped paths.")
                .font(.body)
                .foregroundStyle(.white.opacity(0.68))
                .padding(.top, 12)
                .frame(maxWidth: 270, alignment: .leading)

            Spacer(minLength: 28)

            HStack(alignment: .center, spacing: 18) {
                VoiceInputOrb {
                    composerMode = ComposerMode(startsListening: true)
                }

                VStack(alignment: .leading, spacing: 7) {
                    Text("Tell me the route")
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text("Start, destination or loop, plus distance or time.")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.6))
                }
            }

            Button {
                composerMode = ComposerMode(startsListening: false)
            } label: {
                Label("Type instead", systemImage: "keyboard")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .frame(minHeight: 48)
            }
            .buttonStyle(.plain)
            .trailGlass(cornerRadius: 16, interactive: true)
            .padding(.top, 22)
            .accessibilityIdentifier("home.typeInstead")
        }
        .padding(22)
        .frame(minHeight: 505)
        .background {
            LinearGradient(
                colors: [theme.forest, Color(red: 0.04, green: 0.31, blue: 0.22)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .overlay {
                ContourLines()
                    .stroke(.white.opacity(0.075), lineWidth: 1)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 34, style: .continuous))
        .shadow(color: theme.forest.opacity(0.22), radius: 30, y: 15)
        .padding(.top, 10)
    }

    private func presentComposerForEditingIfNeeded() {
        guard automaticallyPresentsComposer, composerMode == nil else { return }
        composerMode = ComposerMode(startsListening: false)
    }

}

struct VoiceInputOrb: View {
    @Environment(TrailTheme.self) private var theme
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(theme.mossSoft.opacity(0.18))
                    .frame(width: 92, height: 92)
                Circle()
                    .fill(theme.sand)
                    .frame(width: 72, height: 72)
                Image(systemName: "waveform")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(theme.forest)
            }
        }
        .buttonStyle(.plain)
        .trailGlass(cornerRadius: 46, interactive: true)
        .accessibilityLabel("Plan a route by voice")
        .accessibilityHint("Opens the route composer and starts microphone permission handling.")
        .accessibilityIdentifier("home.voice")
    }
}

struct PromptChip: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    let symbol: String
    let accessibilityID: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(theme.graphite)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .frame(minHeight: 44)
                .background(theme.surface, in: Capsule())
                .overlay {
                    Capsule().stroke(theme.forest.opacity(0.08), lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(accessibilityID)
    }
}

struct PromptComposerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(TrailTheme.self) private var theme
    @FocusState private var isFocused: Bool
    @State private var voiceModel: VoicePlanningModel
    @Binding private var language: VoicePlanningLanguage

    let startsListening: Bool
    let onSubmit: (String) -> Void

    init(
        startsListening: Bool,
        initialPrompt: String,
        language: Binding<VoicePlanningLanguage>,
        service: (any VoicePlanningService)? = nil,
        onSubmit: @escaping (String) -> Void
    ) {
        self.startsListening = startsListening
        self.onSubmit = onSubmit
        _language = language
        _voiceModel = State(
            initialValue: VoicePlanningModel(
                service: service ?? AppleSpeechVoicePlanningService(),
                initialPrompt: initialPrompt,
                language: language.wrappedValue
            )
        )
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(title)
                        .font(.trailTitle)
                    Text(subtitle)
                        .foregroundStyle(theme.secondaryText)
                }

                Picker("Voice language", selection: $voiceModel.language) {
                    ForEach(VoicePlanningLanguage.allCases) { language in
                        Text(language.displayName).tag(language)
                    }
                }
                .pickerStyle(.segmented)
                .disabled(voiceModel.state.isCapturing)
                .accessibilityHint("Chooses the language used for speech recognition.")

                ZStack(alignment: .topLeading) {
                    if voiceModel.prompt.isEmpty {
                        Text("Ilsenburg nach Schierke")
                            .foregroundStyle(theme.secondaryText.opacity(0.7))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 18)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }

                    TextEditor(text: $voiceModel.prompt)
                        .scrollContentBackground(.hidden)
                        .padding(11)
                        .focused($isFocused)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Route request")
                        .accessibilityHint("Describe a start, destination or loop, plus distance or time.")
                        .accessibilityIdentifier(PlanningAccessibilityID.promptInput)
                }
                .frame(minHeight: 155)
                .background(theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(theme.forest.opacity(0.1), lineWidth: 1)
                }

                voiceControls

                PrimaryButton(title: "Build my route", symbol: "sparkles") {
                    let prompt = voiceModel.trimmedPrompt
                    voiceModel.dismiss()
                    dismiss()
                    onSubmit(prompt)
                }
                .disabled(!voiceModel.canSubmit)
                .opacity(voiceModel.canSubmit ? 1 : 0.45)
                .accessibilityIdentifier(PlanningAccessibilityID.submit)

                }
                .padding(TrailSpacing.page)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(TrailBackground())
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if voiceModel.state.isCapturing || voiceModel.state == .completed {
                        Button("Cancel") {
                            voiceModel.cancelRecording()
                        }
                        .accessibilityHint("Stops listening and restores the text from before recording.")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") {
                        voiceModel.dismiss()
                        dismiss()
                    }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        isFocused = false
                    }
                    .accessibilityIdentifier("composer.keyboardDone")
                }
            }
            .task {
                if startsListening {
                    await voiceModel.start()
                } else {
                    isFocused = true
                }
            }
            .onChange(of: voiceModel.language) {
                language = voiceModel.language
            }
            .onChange(of: voiceModel.state) { oldState, newState in
                if oldState != .listening, newState == .listening {
                    AccessibilityNotification.Announcement("Listening started").post()
                } else if oldState == .listening, newState != .listening {
                    AccessibilityNotification.Announcement("Listening stopped").post()
                }
            }
            .onChange(of: scenePhase) {
                guard scenePhase != .active, voiceModel.state.isCapturing else { return }
                if voiceModel.state == .listening {
                    voiceModel.stop()
                } else {
                    voiceModel.dismiss()
                }
            }
            .onDisappear {
                voiceModel.dismiss()
            }
        }
    }

    @ViewBuilder
    private var voiceControls: some View {
        switch voiceModel.state {
        case .requestingPermission, .preparing:
            HStack(spacing: 12) {
                ProgressView()
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button("Cancel") { voiceModel.cancelRecording() }
            }
            .accessibilityElement(children: .combine)

        case .listening:
            HStack(spacing: 12) {
                listeningIcon
                Text("Listening…")
                    .font(.subheadline.weight(.bold))
                Spacer()
                Button("Stop") { voiceModel.stop() }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.forest)
                    .accessibilityHint("Stops microphone capture and keeps the transcript for review.")
            }

        case .permissionDenied:
            VStack(alignment: .leading, spacing: 12) {
                Label(permissionMessage, systemImage: "mic.slash.fill")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
                Button("Open Settings") {
                    if let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                        openURL(settingsURL)
                    }
                }
                .buttonStyle(.bordered)
            }

        case let .unavailable(message), let .failed(message):
            VStack(alignment: .leading, spacing: 12) {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
                Button("Try again") {
                    Task { await voiceModel.retry() }
                }
                .buttonStyle(.bordered)
            }

        case .idle, .completed:
            Button {
                isFocused = false
                Task { await voiceModel.start() }
            } label: {
                Label(voiceModel.state == .completed ? "Record again" : "Use voice", systemImage: "mic.fill")
            }
            .buttonStyle(.bordered)
            .tint(theme.forest)

        case .stopping:
            Label("Finishing transcription…", systemImage: "stop.circle")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(theme.secondaryText)
        }
    }

    @ViewBuilder
    private var listeningIcon: some View {
        if reduceMotion {
            Image(systemName: "mic.fill")
                .foregroundStyle(theme.warning)
        } else {
            Image(systemName: "mic.fill")
                .foregroundStyle(theme.warning)
                .symbolEffect(.pulse)
        }
    }

    private var title: String {
        switch voiceModel.state {
        case .requestingPermission: "Waiting for microphone access…"
        case .preparing: "Preparing microphone…"
        case .listening: "Listening…"
        case .stopping: "Finishing transcription…"
        case .completed: "Review your request"
        case .permissionDenied: "Microphone access needed"
        case .unavailable: "Voice input unavailable"
        case .failed: "Voice input stopped"
        case .idle: "Describe your route"
        }
    }

    private var subtitle: String {
        switch voiceModel.state {
        case .completed:
            "Edit anything you like, then build your route."
        case .permissionDenied:
            "Enable microphone and speech recognition access in Settings to plan by voice."
        default:
            "Tell me where to start and finish. German or English both work naturally."
        }
    }

    private var permissionMessage: String {
        guard case let .permissionDenied(reason) = voiceModel.state else { return "" }
        return switch reason {
        case .microphone:
            "TrailMind needs microphone access to turn your route request into text."
        case .speechRecognition:
            "TrailMind needs speech recognition access to transcribe your route request."
        case .restricted:
            "Speech recognition is restricted on this device."
        }
    }
}

#Preview("Voice composer") {
    PromptComposerView(
        startsListening: false,
        initialPrompt: "15 km Rundwanderung um Ilsenburg",
        language: .constant(.german),
        service: FakeVoicePlanningService(),
        onSubmit: { _ in }
    )
    .environment(TrailTheme())
}
