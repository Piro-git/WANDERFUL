import SwiftUI

@main
struct TrailMindApp: App {
    @AppStorage("hasCompletedTrailMindOnboarding") private var hasCompletedOnboarding = false
    @State private var theme = TrailTheme()
    @State private var appModel: AppModel
    @State private var sessionStartup = TrailMindSessionStartupState()
    #if DEBUG && targetEnvironment(simulator)
    @State private var hasCompletedUITestOnboarding = false
    private let uiTestComposition: UITestLaunchComposition?
    #endif
    private let gpxService = DefaultGPXService()

    init() {
        #if DEBUG && targetEnvironment(simulator)
        let uiTestComposition = UITestLaunchComposition.resolve()
        self.uiTestComposition = uiTestComposition
        _appModel = State(initialValue: uiTestComposition?.appModel ?? AppModel())
        #else
        _appModel = State(initialValue: AppModel())
        #endif
    }

    var body: some Scene {
        WindowGroup {
            Group {
                rootView
            }
            .environment(theme)
            .environment(appModel)
            .tint(theme.forestBright)
            .preferredColorScheme(.light)
            .task {
                if sessionStartup.claimGPXRecovery() {
                    async let savedRoutesLoad: Void = appModel.savedRoutes.loadIfNeeded()
                    async let abandonedExportRecovery: Bool = gpxService.recoverAbandonedExports()
                    _ = await (savedRoutesLoad, abandonedExportRecovery)
                } else {
                    await appModel.savedRoutes.loadIfNeeded()
                }
            }
        }
    }

    @ViewBuilder
    private var rootView: some View {
        #if DEBUG && targetEnvironment(simulator)
        if let uiTestComposition {
            switch uiTestComposition.startDestination {
            case .onboarding:
                if hasCompletedUITestOnboarding {
                    AppShellView(planner: uiTestComposition.planner)
                } else {
                    OnboardingView(isComplete: $hasCompletedUITestOnboarding)
                }
            case .appShell:
                AppShellView(planner: uiTestComposition.planner)
            }
        } else {
            productionRootView
        }
        #else
        productionRootView
        #endif
    }

    @ViewBuilder
    private var productionRootView: some View {
        if hasCompletedOnboarding {
            AppShellView()
        } else {
            OnboardingView(isComplete: $hasCompletedOnboarding)
        }
    }
}

struct TrailMindSessionStartupState: Equatable {
    private(set) var hasClaimedGPXRecovery = false

    mutating func claimGPXRecovery() -> Bool {
        guard !hasClaimedGPXRecovery else { return false }
        hasClaimedGPXRecovery = true
        return true
    }
}

enum AppTab: Hashable, CaseIterable {
    case plan
    case saved
    case profile
}

struct AppShellView: View {
    @State private var selectedTab: AppTab = .plan
    private let planner: PlannerViewModel

    init(planner: PlannerViewModel = PlannerViewModel()) {
        self.planner = planner
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("Plan", systemImage: "sparkles", value: .plan) {
                PlanFlowView(planner: planner)
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
