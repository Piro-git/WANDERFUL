import SwiftUI

struct SuperwallOnboardingHost: View {
    private enum Phase {
        case preparing
        case native
        case recoveryRequired
    }

    @Environment(AppModel.self) private var appModel
    @Environment(TrailTheme.self) private var theme
    @Binding var isComplete: Bool
    @State private var phase: Phase = .preparing
    @State private var hasStarted = false
    @State private var nativeDraft: HikingOnboardingDraftV1?
    @State private var isPersistingNativeCompletion = false
    @State private var nativePersistenceTail: Task<Void, Never>?

    var body: some View {
        Group {
            switch phase {
            case .preparing:
                SuperwallOnboardingLoadingView()
            case .native:
                nativeOnboarding
            case .recoveryRequired:
                localRecoveryView
            }
        }
        .task {
            beginIfNeeded()
        }
    }

    private var nativeOnboarding: some View {
        let initialProfile = nativeDraft?.profile ?? HikingPreferenceProfileV1()
        let initialStep = nativeDraft.map {
            OnboardingProfileBridgeV1.step(from: $0.currentStepID)
        } ?? .welcome

        return OnboardingView(
            isComplete: Binding(
                get: { isComplete },
                set: { requestedValue in
                    if !requestedValue { isComplete = false }
                    // A true value is accepted only after the local profile
                    // store confirms persistence in completeNativeOnboarding.
                }
            ),
            initialDraft: OnboardingProfileBridgeV1.interfaceDraft(from: initialProfile),
            initialStep: initialStep,
            onProgress: persistNativeProgress,
            onCompleteDraft: completeNativeOnboarding
        )
    }

    private var localRecoveryView: some View {
        ZStack {
            LinearGradient(
                colors: [theme.brandFill, theme.brandFillBright],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 18) {
                Image(systemName: "externaldrive.badge.exclamationmark")
                    .font(.system(size: 42, weight: .semibold))
                    .foregroundStyle(theme.onBrandAccent)
                    .accessibilityHidden(true)

                Text("Your local Trail Profile needs a fresh start")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(theme.onBrandPrimary)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)

                Text("The saved record can’t be read safely. Discard it to begin again. No account or network connection is required.")
                    .font(.body)
                    .foregroundStyle(theme.onBrandSecondary)
                    .multilineTextAlignment(.center)

                Button("Discard unreadable record") {
                    Task { @MainActor in
                        await appModel.discardUnreadableHikingProfileData()
                        startNativeOnboarding()
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(theme.onBrandAccent)
                .foregroundStyle(theme.onBrandAccentForeground)
                .accessibilityIdentifier("onboarding.recovery.discard")
            }
            .padding(28)
        }
    }

    private func persistNativeProgress(
        _ interfaceDraft: OnboardingView.Draft,
        _ step: OnboardingView.Step
    ) {
        guard !isPersistingNativeCompletion else { return }
        let updatedDraft = OnboardingProfileBridgeV1.coreDraft(
            from: interfaceDraft,
            step: step,
            existing: nativeDraft
        )
        nativeDraft = updatedDraft
        let predecessor = nativePersistenceTail
        let persistence = Task { @MainActor in
            await predecessor?.value
            await appModel.saveHikingOnboardingProgress(updatedDraft)
        }
        nativePersistenceTail = persistence
    }

    private func completeNativeOnboarding(_ interfaceDraft: OnboardingView.Draft) {
        guard !isPersistingNativeCompletion else { return }
        let completedDraft = OnboardingProfileBridgeV1.coreDraft(
            from: interfaceDraft,
            step: .ready,
            existing: nativeDraft
        )
        nativeDraft = completedDraft
        isPersistingNativeCompletion = true
        let predecessor = nativePersistenceTail
        let persistence = Task { @MainActor in
            // Completion must observe every earlier progress write before it
            // saves the profile and deletes the resumable draft. Otherwise a
            // late progress task could recreate a stale draft after deletion.
            await predecessor?.value
            let didSave = await appModel.completeHikingOnboarding(completedDraft)
            isPersistingNativeCompletion = false
            if didSave {
                isComplete = true
            }
        }
        nativePersistenceTail = persistence
    }

    private func beginIfNeeded() {
        guard !hasStarted else { return }
        hasStarted = true

        // Crash recovery: the local profile may have been committed just
        // before the AppStorage completion bit was written. A loaded,
        // validated V1 profile is sufficient to finish that interrupted
        // transition without presenting onboarding twice.
        if let profile = appModel.hikingProfile,
           (try? HikingPreferenceProfileValidatorV1.canonicalized(profile)) != nil {
            isComplete = true
            return
        }
        if appModel.hikingProfileRecoveryRequired {
            phase = .recoveryRequired
            return
        }
        startNativeOnboarding()
    }

    private func startNativeOnboarding() {
        let initialDraft = appModel.hikingOnboardingDraft ?? HikingOnboardingDraftV1(
            currentStepID: OnboardingView.Step.welcome.rawValue
        )
        nativeDraft = initialDraft
        phase = .native
        if appModel.hikingOnboardingDraft == nil {
            let predecessor = nativePersistenceTail
            let persistence = Task { @MainActor in
                await predecessor?.value
                await appModel.saveHikingOnboardingProgress(initialDraft)
            }
            nativePersistenceTail = persistence
        }
    }
}

struct SuperwallOnboardingLoadingView: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.brandFill, theme.brandFillBright],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ContourLines()
                .stroke(.white.opacity(0.075), lineWidth: 1)
                .ignoresSafeArea()

            VStack(spacing: 20) {
                ZStack {
                    Circle()
                        .fill(theme.onBrandAccent.opacity(0.18))
                        .frame(width: 112, height: 112)
                    Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                        .font(.system(size: 42, weight: .semibold))
                        .foregroundStyle(theme.onBrandAccent)
                }

                VStack(spacing: 8) {
                    Text("Preparing your route setup")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(theme.onBrandPrimary)
                    Text("Opening local setup…")
                        .font(.subheadline)
                        .foregroundStyle(theme.onBrandSecondary)
                        .multilineTextAlignment(.center)
                }

                ProgressView()
                    .tint(theme.onBrandProgress)
            }
            .padding(28)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Preparing onboarding")
    }
}
