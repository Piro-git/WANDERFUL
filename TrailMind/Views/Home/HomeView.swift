import SwiftUI
import UIKit

struct PlanFlowView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(TrailTheme.self) private var theme
    @State private var planner: PlannerViewModel

    #if DEBUG && WANDERFUL_OWNER_PHONE_TEST
    private let ownerAcceptancePrompt: String?
    @State private var hasStartedOwnerAcceptance = false
    #endif

    init(planner: PlannerViewModel = PlannerViewModel()) {
        #if DEBUG && WANDERFUL_OWNER_PHONE_TEST
        let selected = ProcessInfo.processInfo.environment["WANDERFUL_OWNER_ACCEPTANCE_CASE"]
        let publicPrompt: String? = switch selected {
        case "ilsenburg": "Plan an approximately 15 km hiking loop from Ilsenburg with viewpoints"
        case "innsbruck": "Plan an approximately 10 km hiking loop from Innsbruck with viewpoints"
        default: nil
        }
        ownerAcceptancePrompt = OwnerPhoneTestConfiguration.load() == nil ? nil : publicPrompt
        // Same live provider factories and UI, with no saved personal profile in the public test.
        _planner = State(initialValue: ownerAcceptancePrompt == nil ? planner : PlannerViewModel())
        #else
        _planner = State(initialValue: planner)
        #endif
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
                        onPlan: startPlanning,
                        onDateChange: { planner.plannedStartAt = $0 },
                        initialPlannedStartAt: planner.plannedStartAt
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
        #if DEBUG && WANDERFUL_OWNER_PHONE_TEST
        .task {
            guard !hasStartedOwnerAcceptance, let ownerAcceptancePrompt else { return }
            hasStartedOwnerAcceptance = true
            startPlanning(ownerAcceptancePrompt)
        }
        #endif
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

    var routeType: TrailRouteType = .loop

    func displayTitle(for language: AppLanguage) -> String {
        guard language == .german else { return title }
        return switch id {
        case "loop":
            "15-km-Rundweg"
        case "pointToPoint":
            "Streckenwanderung"
        case "trailRun":
            "2-stündiger Trailrun"
        case "bike":
            "Radtour"
        default:
            title
        }
    }

    var needsDestination: Bool { routeType == .pointToPoint }

    func completedPrompt(start: String, destination: String) -> String? {
        let start = start.trimmingCharacters(in: .whitespacesAndNewlines)
        let destination = destination.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !start.isEmpty, !needsDestination || !destination.isEmpty else { return nil }
        // Keep preferences after the location so the shipping parser can
        // distinguish the chosen place from requested features.
        let featureStart = prompt.range(of: " with ")?.lowerBound ?? prompt.endIndex
        let request = prompt[..<featureStart]
        let features = prompt[featureStart...]
        return needsDestination
            ? "\(request) from \(start) to \(destination)\(features)"
            : "\(request) around \(start)\(features)"
    }
}

struct HomeView: View {
    struct ComposerMode: Identifiable {
        let id = UUID()
        let startsListening: Bool
    }

    @Environment(TrailTheme.self) private var theme
    @Environment(AppModel.self) private var appModel
    @Environment(AppLanguageController.self) private var languageController
    let initialPrompt: String
    let automaticallyPresentsComposer: Bool
    let onPlan: (String) -> Void
    var onDateChange: (Date?) -> Void = { _ in }
    var initialPlannedStartAt: Date? = nil
    @State private var schedulesStart = false
    @State private var selectedStart = Date.now
    @State private var composerMode: ComposerMode?
    @State private var selectedExample: HomeRouteExample?
    @State private var voiceLanguage = VoicePlanningLanguage.deviceDefault

    static let routeExamples = [
        HomeRouteExample(
            id: "loop",
            title: "15 km loop",
            prompt: "Plan a 15 km hiking loop",
            symbol: "arrow.trianglehead.2.clockwise.rotate.90"
        ),
        HomeRouteExample(
            id: "pointToPoint",
            title: "Point-to-point hike",
            prompt: "Plan a point-to-point hike",
            symbol: "point.bottomleft.forward.to.point.topright.scurvepath",
            routeType: .pointToPoint
        ),
        HomeRouteExample(
            id: "trailRun",
            title: "2-hour trail run",
            prompt: "Plan a 2 hour trail run loop",
            symbol: "figure.run"
        ),
        HomeRouteExample(
            id: "bike",
            title: "Bike route",
            prompt: "Plan a point-to-point bike route",
            symbol: "figure.outdoor.cycle",
            routeType: .pointToPoint
        )
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: TrailSpacing.section) {
                hero
                VStack(alignment: .leading, spacing: 10) {
                    Toggle("Plan for a date", isOn: $schedulesStart)
                        .accessibilityIdentifier("planning.schedule.enabled")
                    if schedulesStart {
                        DatePicker("Start", selection: $selectedStart, in: Date.now..., displayedComponents: [.date, .hourAndMinute])
                            .accessibilityIdentifier("planning.schedule.date")
                        Text(scheduleDateNote)
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .onChange(of: schedulesStart) { _, enabled in onDateChange(enabled ? selectedStart : nil) }
                .onChange(of: selectedStart) { _, date in if schedulesStart { onDateChange(date) } }

                VStack(alignment: .leading, spacing: 14) {
                    SectionHeader(title: routeIdeasTitle, subtitle: routeIdeasSubtitle)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(displayedRouteExamples) { example in
                                PromptChip(
                                    title: example.displayTitle(for: languageController.language),
                                    symbol: example.symbol,
                                    accessibilityID: "home.example.\(example.id)"
                                ) {
                                    selectedExample = example
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
        .sheet(item: $selectedExample) { example in
            HomeExampleLocationView(
                example: example,
                displayTitle: example.displayTitle(for: languageController.language),
                onSubmit: onPlan
            )
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
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
        .onAppear {
            if let initialPlannedStartAt { selectedStart = initialPlannedStartAt; schedulesStart = true }
            presentComposerForEditingIfNeeded()
        }
    }

    private var displayedRouteExamples: [HomeRouteExample] {
        if let personalizedRouteExample {
            return [personalizedRouteExample] + Self.routeExamples
        }
        return Self.routeExamples
    }

    private var scheduleDateNote: String {
        languageController.language == .german
            ? "Lokale Hinweise werden mit diesem Datum abgeglichen. Prüfe sie vor dem Start noch einmal."
            : "Local reports will be compared with this date. Check again before starting."
    }

    private var routeIdeasTitle: String {
        languageController.language == .german
            ? "Ideen für deine Tour"
            : "Start with a thought"
    }

    private var routeIdeasSubtitle: String {
        languageController.language == .german
            ? "Wähle eine Idee, dann deine Orte."
            : "Pick an idea, then choose your places."
    }

    private var personalizedRouteExample: HomeRouteExample? {
        guard let profile = appModel.hikingProfile,
              let activity = profile.defaultActivity,
              profile.preferredRouteShape == .loop,
              let comfort = profile.comfortableOuting
        else {
            return nil
        }

        let requestedFeatures = (profile.requestedExperiences ?? [])
            .map(Self.promptName)
            .prefix(2)
            .joined(separator: " and ")
        let featureSuffix = requestedFeatures.isEmpty ? "" : " with \(requestedFeatures)"
        let activityPhrase: String
        switch activity {
        case .hiking:
            activityPhrase = "hiking"
        case .trailRunning:
            activityPhrase = "trail run"
        case .biking:
            activityPhrase = "bike"
        }

        let prompt: String
        let title: String
        switch comfort {
        case let .distanceKilometers(minimum, maximum):
            let distance = Int(((minimum + maximum) / 2).rounded())
            prompt = "Plan a \(distance) km \(activityPhrase) loop\(featureSuffix)"
            title = "Your \(distance) km \(activityPhrase)"
        case let .durationMinutes(minimum, maximum):
            let minutes = Int((Double(minimum + maximum) / 2).rounded())
            prompt = "Plan a \(minutes)-minute \(activityPhrase) loop\(featureSuffix)"
            title = minutes.isMultiple(of: 60)
                ? "Your \(minutes / 60)-hour \(activityPhrase)"
                : "Your \(minutes)-minute \(activityPhrase)"
        }

        return HomeRouteExample(
            id: "personalized",
            title: title,
            prompt: prompt,
            symbol: activity.activityType.symbol
        )
    }

    private static func promptName(_ experience: HikingRequestedExperienceV1) -> String {
        switch experience {
        case .viewpoints: "viewpoints"
        case .forest: "forest"
        case .quietNature: "quiet paths"
        case .waterfalls: "waterfalls"
        case .lakes: "lakes"
        case .peaks: "peaks"
        case .huts: "huts"
        case .landmarks: "landmarks"
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HStack(spacing: 8) {
                    Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                    Text("Wanderful")
                        .fontWeight(.bold)
                }
                .font(.subheadline)
                .foregroundStyle(theme.onBrandSecondary)
            }

            Spacer(minLength: 36)

            Text("Where should\nwe go next?")
                .font(.trailHero)
                .foregroundStyle(theme.onBrandPrimary)
                .tracking(-1.1)

            Text("Describe a route. Wanderful calculates it on mapped paths.")
                .font(.body)
                .foregroundStyle(theme.onBrandSecondary)
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
                        .foregroundStyle(theme.onBrandPrimary)
                    Text("Start, destination or loop, plus distance or time.")
                        .font(.caption)
                        .foregroundStyle(theme.onBrandSecondary)
                }
            }

            Button {
                composerMode = ComposerMode(startsListening: false)
            } label: {
                Label("Type instead", systemImage: "keyboard")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.onBrandPrimary)
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
                colors: [theme.brandFill, theme.brandFillBright],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .overlay {
                ContourLines()
                    .stroke(.white.opacity(0.075), lineWidth: 1)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 34, style: .continuous))
        .shadow(color: theme.cardShadow, radius: 30, y: 15)
        .padding(.top, 10)
    }

    private func presentComposerForEditingIfNeeded() {
        guard automaticallyPresentsComposer, composerMode == nil else { return }
        composerMode = ComposerMode(startsListening: false)
    }

}

private struct HomeExampleLocationView: View {
    @Environment(\.dismiss) private var dismiss
    let example: HomeRouteExample
    let displayTitle: String
    let onSubmit: (String) -> Void
    @State private var allowsOnlinePlanning = false
    @State private var start = ""
    @State private var destination = ""
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case start, destination }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Start town or trailhead", text: $start)
                        .focused($focusedField, equals: .start)
                        .accessibilityLabel("Start place")
                        .accessibilityIdentifier("home.example.start")
                    if example.needsDestination {
                        TextField("Destination", text: $destination)
                            .focused($focusedField, equals: .destination)
                            .accessibilityIdentifier("home.example.destination")
                    }
                } header: {
                    Text("Where would you like to go?")
                } footer: {
                    Text("Choose your places. Wanderful will check them before calculating a route.")
                }
                Section {
                    OnlinePlanningPermissionView(isAllowed: $allowsOnlinePlanning)
                }
                Section {
                    Button("Build my route") {
                        guard allowsOnlinePlanning, let prompt = example.completedPrompt(start: start, destination: destination) else { return }
                        dismiss()
                        onSubmit(prompt)
                    }
                    .disabled(!allowsOnlinePlanning || example.completedPrompt(start: start, destination: destination) == nil)
                    .accessibilityIdentifier("home.example.submit")
                }
            }
            .task { focusedField = .start }
            .navigationTitle(displayTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focusedField = nil }
                        .accessibilityIdentifier("home.example.keyboardDone")
                }
            }
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
                    .fill(theme.onBrandAccent.opacity(0.18))
                    .frame(width: 92, height: 92)
                Circle()
                    .fill(theme.onBrandAccent)
                    .frame(width: 72, height: 72)
                Image(systemName: "waveform")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(theme.onBrandAccentForeground)
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
    @State private var allowsOnlinePlanning = false
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
                        Text("Describe your route and where to start")
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

                OnlinePlanningPermissionView(isAllowed: $allowsOnlinePlanning)

                PrimaryButton(title: "Build my route", symbol: "sparkles") {
                    guard allowsOnlinePlanning, voiceModel.canSubmit else { return }
                    let prompt = voiceModel.trimmedPrompt
                    voiceModel.dismiss()
                    dismiss()
                    onSubmit(prompt)
                }
                .disabled(!voiceModel.canSubmit || !allowsOnlinePlanning)
                .opacity(voiceModel.canSubmit && allowsOnlinePlanning ? 1 : 0.45)
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
        case .permissionDenied: "Voice permission needed"
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
            "Wanderful needs microphone access to turn your route request into text."
        case .speechRecognition:
            "Wanderful needs speech recognition access to transcribe your route request."
        case .microphoneRestricted:
            "Microphone access is restricted on this device."
        case .speechRecognitionRestricted:
            "Speech recognition is restricted on this device."
        case .microphoneUnavailable:
            "A microphone is not currently available on this device."
        case .speechRecognitionUnavailable:
            "Speech recognition is not currently available on this device."
        }
    }
}

#if DEBUG
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
#endif

private struct OnlinePlanningPermissionView: View {
    @Environment(AppLanguageController.self) private var languageController
    @Binding var isAllowed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(permissionTitle)
                .font(.subheadline.weight(.semibold))
            Text(permissionDetail)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let privacyURL = WanderfulPublicLinks.current.privacyPolicy.url {
                Link(privacyPolicyTitle, destination: privacyURL)
                    .font(.footnote)
                    .accessibilityIdentifier("planning.privacyPolicy")
            }
            Toggle(permissionToggleTitle, isOn: $isAllowed)
                .font(.subheadline)
                .accessibilityIdentifier("planning.onlinePermission")
            Text(permissionFooter)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var isGerman: Bool { languageController.language == .german }

    private var permissionTitle: String {
        isGerman ? "So verwendet die Online-Planung deine Anfrage" : "How online planning uses your request"
    }

    private var permissionDetail: String {
        isGerman
            ? "Mit deiner Erlaubnis sendet Wanderful diese Anfrage, angefragte Orte oder Koordinaten sowie relevante Einstellungen deines Wanderprofils an das Backend. Die KI-Planung nutzt Google Gemini, Recherche-Dienste erhalten passende Suchanfragen und GraphHopper erhält Routing-Koordinaten und Vorgaben. Das gilt auch für Rückfragen und erneute Versuche zu dieser Anfrage. Teile keine privaten Informationen, die diese Dienste nicht erhalten sollen."
            : TrailMindAboutContent.onlinePlanningPermissionDetail
    }

    private var privacyPolicyTitle: String {
        isGerman ? "Datenschutzrichtlinie" : "Privacy policy"
    }

    private var permissionToggleTitle: String {
        isGerman ? "Online-Planung für diese Anfrage erlauben" : "Allow online planning for this request"
    }

    private var permissionFooter: String {
        isGerman
            ? "Du kannst diesen Bildschirm schließen, ohne eine Anfrage zu senden. Gespeicherte Routen bleiben verfügbar."
            : "You can close this screen without sending a request. Saved routes remain available."
    }
}
