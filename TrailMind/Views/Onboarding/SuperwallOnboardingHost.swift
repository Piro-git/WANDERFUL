import SwiftUI

struct SuperwallOnboardingHost: View {
    private enum Phase {
        case preparing
        case presenting
        case nativeFallback
    }

    @Environment(AppModel.self) private var appModel
    @Environment(TrailTheme.self) private var theme
    @Binding var isComplete: Bool
    let client: SuperwallOnboardingClient
    @State private var phase: Phase = .preparing
    @State private var hasStarted = false

    var body: some View {
        Group {
            switch phase {
            case .preparing, .presenting:
                SuperwallOnboardingLoadingView()
            case .nativeFallback:
                OnboardingView(isComplete: $isComplete)
            }
        }
        .task {
            beginIfNeeded()
        }
    }

    private func beginIfNeeded() {
        guard !hasStarted else { return }
        hasStarted = true

        client.setPreferencesHandler { attributes in
            let preferences = SuperwallOnboardingPreferenceMapper.merging(
                attributes: attributes,
                into: appModel.preferences
            )
            appModel.updatePreferences(preferences)
        }
        client.presentOnboarding(
            onPresent: {
                phase = .presenting
            },
            onComplete: {
                isComplete = true
            },
            onFallback: {
                phase = .nativeFallback
            }
        )
    }
}

private struct SuperwallOnboardingLoadingView: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.forest, Color(red: 0.04, green: 0.30, blue: 0.21)],
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
                        .fill(theme.mossSoft.opacity(0.16))
                        .frame(width: 112, height: 112)
                    Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                        .font(.system(size: 42, weight: .semibold))
                        .foregroundStyle(theme.sand)
                }

                VStack(spacing: 8) {
                    Text("Preparing your route setup")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                    Text("Loading your personalized Wanderful experience…")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.66))
                        .multilineTextAlignment(.center)
                }

                ProgressView()
                    .tint(theme.mossSoft)
            }
            .padding(28)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Preparing onboarding")
    }
}
