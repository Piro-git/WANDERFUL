import SwiftUI
import UIKit

struct PlanFlowView: View {
    @Environment(TrailTheme.self) private var theme
    @State private var planner = PlannerViewModel()
    @State private var path: [TrailRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                TrailBackground()

                switch planner.phase {
                case .home:
                    HomeView(
                        initialPrompt: planner.prompt,
                        errorNotice: planner.errorMessage,
                        onPlan: { prompt in
                            withAnimation(.smooth) {
                                planner.startPlanning(prompt: prompt)
                            }
                        },
                        onTextRoute: { prompt in
                            withAnimation(.smooth) {
                                planner.startTextRoute(prompt: prompt)
                            }
                        },
                        onDismissError: planner.dismissError
                    )
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))

                case .generating:
                    GeneratingRouteView(planner: planner)
                        .transition(.opacity)

                case .suggestions:
                    RouteSuggestionsView(
                        prompt: planner.prompt,
                        suggestions: planner.suggestions,
                        notice: planner.suggestionNotice,
                        onStartOver: planner.reset
                    )
                    .transition(.opacity.combined(with: .move(edge: .trailing)))
                }
            }
            .animation(.smooth, value: planner.phase)
            .navigationDestination(for: TrailRoute.self) { route in
                RouteDetailView(route: route)
            }
            .onChange(of: planner.generatedRoute?.id) {
                guard let route = planner.consumeGeneratedRoute() else { return }
                path.append(route)
            }
        }
    }
}

struct HomeView: View {
    struct ComposerMode: Identifiable {
        let id = UUID()
        let startsListening: Bool
    }

    @Environment(TrailTheme.self) private var theme
    @State private var composerMode: ComposerMode?
    @State private var voiceLanguage = VoicePlanningLanguage.deviceDefault
    let initialPrompt: String
    let errorNotice: String?
    let onPlan: (String) -> Void
    let onTextRoute: (String) -> Void
    let onDismissError: () -> Void

    private let prompts = [
        ("2-day Harz hike", "backpack.fill"),
        ("Forest loop nearby", "tree.fill"),
        ("Waterfalls + views", "water.waves"),
        ("Easy sunset walk", "sunset.fill")
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: TrailSpacing.section) {
                hero

                if let errorNotice {
                    HStack(alignment: .top, spacing: 11) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(theme.warning)
                        Text(errorNotice)
                            .font(.footnote)
                            .foregroundStyle(theme.graphite)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button(action: onDismissError) {
                            Image(systemName: "xmark")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(theme.secondaryText)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Dismiss error")
                    }
                    .padding(14)
                    .background(
                        theme.sand.opacity(0.68),
                        in: RoundedRectangle(cornerRadius: 17, style: .continuous)
                    )
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }

                VStack(alignment: .leading, spacing: 14) {
                    SectionHeader(title: "Start with a thought", subtitle: "Tap an idea and make it yours.")

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(prompts, id: \.0) { prompt, symbol in
                                PromptChip(title: prompt, symbol: symbol) {
                                    onPlan(expandedPrompt(for: prompt))
                                }
                            }
                        }
                    }
                    .contentMargins(.horizontal, TrailSpacing.page, for: .scrollContent)
                    .contentMargins(.horizontal, -TrailSpacing.page)
                }

                VStack(alignment: .leading, spacing: 14) {
                    SectionHeader(title: "Continue outside", subtitle: "Recent plans, ready when you are.")
                    NavigationLink(value: MockRoutes.luneburgLoop) {
                        CompactRouteCard(route: MockRoutes.luneburgLoop)
                    }
                    .buttonStyle(.plain)
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
                onSubmit: onTextRoute
            )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(theme.warmWhite)
        }
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

                Spacer()

                Image(systemName: "location.fill")
                    .font(.caption)
                    .foregroundStyle(theme.mossSoft)
                Text("Near you")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.72))
            }

            Spacer(minLength: 36)

            Text("Where should\nwe go next?")
                .font(.trailHero)
                .foregroundStyle(.white)
                .tracking(-1.1)

            Text("Describe your perfect route. TrailMind will shape it.")
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
                    Text("Tell me the feeling")
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text("Place, time, effort—or just a mood.")
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
                    .frame(height: 48)
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

    private func expandedPrompt(for title: String) -> String {
        switch title {
        case "2-day Harz hike":
            "Plan a 2-day Harz hike with waterfalls, forest, wide views and a comfortable place to stay."
        case "Forest loop nearby":
            "Plan a relaxed 12 km forest loop near Lüneburg with water and quiet paths."
        case "Waterfalls + views":
            "Find me a scenic hike in the Harz with waterfalls and a great viewpoint."
        default:
            "I only have 3 hours. Plan an easy sunset walk with a beautiful viewpoint."
        }
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
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(theme.graphite)
                .padding(.horizontal, 14)
                .frame(height: 44)
                .background(theme.surface, in: Capsule())
                .overlay {
                    Capsule().stroke(theme.forest.opacity(0.08), lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
    }
}

struct PromptComposerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
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
                    }

                    TextEditor(text: $voiceModel.prompt)
                        .scrollContentBackground(.hidden)
                        .padding(11)
                        .focused($isFocused)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("composer.prompt")
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
                .accessibilityIdentifier("composer.submit")

                Spacer()
            }
            .padding(TrailSpacing.page)
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
                Image(systemName: "mic.fill")
                    .foregroundStyle(theme.warning)
                    .symbolEffect(.pulse)
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

private struct CompactRouteCard: View {
    @Environment(TrailTheme.self) private var theme
    let route: TrailRoute

    var body: some View {
        HStack(spacing: 15) {
            MiniRouteGlyph(route: route)
                .frame(width: 92, height: 92)
                .background(theme.sand.opacity(0.7), in: RoundedRectangle(cornerRadius: 20, style: .continuous))

            VStack(alignment: .leading, spacing: 7) {
                Text(route.location.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.8)
                    .foregroundStyle(theme.moss)
                Text(route.title)
                    .font(.headline)
                    .foregroundStyle(theme.graphite)
                Text("\(route.distanceLabel)  ·  \(route.durationLabel)")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
            }

            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.secondaryText.opacity(0.5))
        }
        .trailCard()
    }
}
