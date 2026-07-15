import SwiftUI

@main
struct TrailMindApp: App {
    @AppStorage("hasCompletedTrailMindOnboarding") private var hasCompletedOnboarding = false
    @State private var theme = TrailTheme()
    @State private var appModel = AppModel()

    var body: some Scene {
        WindowGroup {
            Group {
                if hasCompletedOnboarding {
                    AppShellView()
                } else {
                    OnboardingView(isComplete: $hasCompletedOnboarding)
                }
            }
            .environment(theme)
            .environment(appModel)
            .tint(theme.forestBright)
            .preferredColorScheme(.light)
            .task {
                await appModel.savedRoutes.loadIfNeeded()
            }
        }
    }
}

enum AppTab: Hashable, CaseIterable {
    case plan
    case saved
    case profile
}

struct AppShellView: View {
    @State private var selectedTab: AppTab = .plan

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Plan", systemImage: "sparkles", value: .plan) {
                PlanFlowView()
            }

            Tab("Saved", systemImage: "bookmark.fill", value: .saved) {
                SavedRoutesView()
            }

            Tab("About", systemImage: "info.circle.fill", value: .profile) {
                ProfilePreferencesView()
            }
        }
    }
}
