import SwiftUI

@main
struct TrailMindApp: App {
    @AppStorage("hasCompletedTrailMindOnboarding") private var hasCompletedOnboarding = false
    @State private var theme = TrailTheme()
    @State private var appModel: AppModel
    @State private var productionPlanner: PlannerViewModel
    @State private var premiumAccess: PremiumAccessStore
    @State private var languageController: AppLanguageController
    @State private var sessionStartup = TrailMindSessionStartupState()
    #if DEBUG
    private let stagingProofComposition:
        StagingProofLaunchComposition?
    #endif
    #if DEBUG && targetEnvironment(simulator)
    @State private var hasCompletedUITestOnboarding = false
    private let uiTestComposition: UITestLaunchComposition?
    #endif
    private let gpxService = DefaultGPXService()

    init() {
        let resolvedAppModel: AppModel
        #if DEBUG
        let stagingProofComposition =
            StagingProofLaunchComposition.resolve()
        self.stagingProofComposition = stagingProofComposition
        #if targetEnvironment(simulator)
        let uiTestComposition = UITestLaunchComposition.resolve()
        self.uiTestComposition = uiTestComposition
        resolvedAppModel =
            stagingProofComposition?.appModel ??
            uiTestComposition?.appModel ??
            Self.makeProductionAppModel()
        #else
        resolvedAppModel =
            stagingProofComposition?.appModel ??
            Self.makeProductionAppModel()
        #endif
        #else
        resolvedAppModel = Self.makeProductionAppModel()
        #endif
        _appModel = State(initialValue: resolvedAppModel)
        _languageController = State(initialValue: AppLanguageController())
        #if DEBUG && targetEnvironment(simulator)
        _premiumAccess = State(
            initialValue: uiTestComposition?.premiumAccess ??
                PremiumAccessFactory.makeProduction()
        )
        #else
        _premiumAccess = State(initialValue: PremiumAccessFactory.makeProduction())
        #endif
        _productionPlanner = State(
            initialValue: PlannerViewModel(
                hikingProfileProvider: { [weak resolvedAppModel] in
                    resolvedAppModel?.hikingProfile
                }
            )
        )
    }

    private static func makeProductionAppModel() -> AppModel {
        let preferencesStore = UserPreferencesStore()
        return AppModel(
            preferences: preferencesStore.load(),
            preferencesStore: preferencesStore,
            hikingProfileStore: LocalHikingPreferenceProfileStoreV1(),
            hikingProfileSyncClient: HikingPreferenceProfileSyncFactoryV1.make()
        )
    }

    var body: some Scene {
        WindowGroup {
            Group {
                rootView
            }
            .environment(theme)
            .environment(appModel)
            .environment(premiumAccess)
            .environment(languageController)
            .environment(\.locale, languageController.language.locale)
            .tint(theme.forestBright)
            #if DEBUG && WANDERFUL_PRIVATE_OWNER
            .task {
                await exportOwnerPublicKeyIfRequested()
            }
            #endif
            .task {
                await premiumAccess.start()
            }
            .task {
                async let hikingProfileLoad: Void = appModel.loadHikingProfileStateIfNeeded()
                if sessionStartup.claimGPXRecovery() {
                    async let savedRoutesLoad: Void = appModel.savedRoutes.loadIfNeeded()
                    async let abandonedExportRecovery: Bool = gpxService.recoverAbandonedExports()
                    _ = await (savedRoutesLoad, abandonedExportRecovery, hikingProfileLoad)
                } else {
                    async let savedRoutesLoad: Void = appModel.savedRoutes.loadIfNeeded()
                    _ = await (savedRoutesLoad, hikingProfileLoad)
                }
            }
        }
    }

    #if DEBUG && WANDERFUL_PRIVATE_OWNER
    /// Operator-only launch action; exports public enrollment material, never the device secret.
    private func exportOwnerPublicKeyIfRequested() async {
        guard ProcessInfo.processInfo.arguments.contains("--wanderful-export-owner-public-key"),
              let configuration = OwnerAccessConfiguration.load() else { return }
        do {
            let directory = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true
            )
            let destination = directory.appendingPathComponent("OwnerPublicKey.json")
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            let client = OwnerAccessClient(configuration: configuration)
            let publicKey = try await client.exportEnrollmentPublicKey()
            let data = try JSONEncoder().encode(publicKey)
            try data.write(to: destination, options: .atomic)
        } catch {
            // No raw keychain or transport errors enter device logs.
            // An absent export means enrollment must not proceed.
        }
    }
    #endif

    @ViewBuilder
    private var rootView: some View {
        #if DEBUG
        if let stagingProofComposition {
            StagingProofHostView(
                composition: stagingProofComposition
            )
        } else {
            #if targetEnvironment(simulator)
            if let uiTestComposition {
                Group {
                    switch uiTestComposition.startDestination {
                    case .onboarding:
                        if hasCompletedUITestOnboarding {
                            AppShellView(
                                planner: uiTestComposition.planner
                            )
                        } else {
                            OnboardingView(
                                isComplete:
                                    $hasCompletedUITestOnboarding
                            )
                        }
                    case .onboardingLoading:
                        SuperwallOnboardingLoadingView()
                    case .appShell:
                        if ProcessInfo.processInfo.arguments.contains("--trailmind-ui-evidence") {
                            DynamicEvidenceUITestView()
                        } else {
                            AppShellView(planner: uiTestComposition.planner)
                        }
                    case .routeGuidance:
                        RouteGuidanceView(
                            route: uiTestComposition.guidanceRoute,
                            dependencies: uiTestComposition.guidanceDependencies
                        )
                    }
                }
                .environment(\.dynamicTypeSize, uiTestComposition.dynamicTypeSize)
                .preferredColorScheme(uiTestComposition.colorScheme)
                .environment(
                    \.routeGuidanceDependencies,
                    uiTestComposition.guidanceDependencies
                )
            } else {
                productionRootView
            }
            #else
            productionRootView
            #endif
        }
        #else
        productionRootView
        #endif
    }

    @ViewBuilder
    private var productionRootView: some View {
        if !appModel.isHikingProfileStateLoaded {
            HikingProfileLaunchLoadingView()
        } else if !languageController.hasChosenLanguage {
            AppLanguageSelectionView(initialLanguage: languageController.language)
        } else if hasCompletedOnboarding {
            AppShellView(planner: productionPlanner)
        } else {
            SuperwallOnboardingHost(
                isComplete: $hasCompletedOnboarding
            )
        }
    }
}

private struct HikingProfileLaunchLoadingView: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.brandFill, theme.brandFillBright],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ProgressView()
                .tint(theme.onBrandProgress)
                .accessibilityLabel("Loading your Trail Profile")
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

            Tab("Profile", systemImage: "person.crop.circle.fill", value: .profile) {
                ProfilePreferencesView()
            }
        }
    }
}
