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
        }
    }
}

enum AppTab: Hashable {
    case plan
    case explore
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

            Tab("Explore", systemImage: "map.fill", value: .explore) {
                ExploreView()
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

struct ExploreView: View {
    @Environment(TrailTheme.self) private var theme
    @State private var path: [TrailRoute] = []
    @State private var isGeneratingGraphHopperRoute = false
    @State private var graphHopperNotice: String?

    private let graphHopperClient = GraphHopperClient()

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                TrailBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: TrailSpacing.section) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Curated for the open air")
                                .font(.trailTitle)
                            Text("Beautiful starting points while your personal recommendations learn your rhythm.")
                                .foregroundStyle(theme.secondaryText)
                        }

                        graphHopperDemo

                        if let graphHopperNotice {
                            Label(graphHopperNotice, systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote)
                                .foregroundStyle(theme.warning)
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    theme.sand.opacity(0.6),
                                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                                )
                                .transition(.opacity.combined(with: .move(edge: .top)))
                        }

                        ForEach(MockRoutes.all) { route in
                            NavigationLink(value: route) {
                                RouteCard(route: route, matchScore: nil)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(TrailSpacing.page)
                    .padding(.bottom, 24)
                }
            }
            .navigationTitle("Explore")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: TrailRoute.self) { route in
                RouteDetailView(route: route)
            }
        }
    }

    private var graphHopperDemo: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("LIVE ROUTING DEMO", systemImage: "network")
                .font(.caption.weight(.bold))
                .tracking(1)
                .foregroundStyle(theme.moss)

            Text("Ilsenburg → Schierke")
                .font(.headline)
                .foregroundStyle(theme.graphite)

            Text("Temporary developer path using GraphHopper’s foot profile and live trail geometry.")
                .font(.subheadline)
                .foregroundStyle(theme.secondaryText)

            Button {
                Task { await generateGraphHopperDemo() }
            } label: {
                HStack(spacing: 10) {
                    if isGeneratingGraphHopperRoute {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                    }
                    Text(isGeneratingGraphHopperRoute ? "Generating Harz route…" : "Generate GraphHopper Harz Route")
                }
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(theme.forest, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(isGeneratingGraphHopperRoute)
            .accessibilityIdentifier("explore.graphHopperDemo")
        }
        .trailCard()
    }

    private func generateGraphHopperDemo() async {
        guard !isGeneratingGraphHopperRoute else { return }
        isGeneratingGraphHopperRoute = true
        graphHopperNotice = nil
        defer { isGeneratingGraphHopperRoute = false }

        do {
            let route = try await graphHopperClient.generateHarzDemoRoute()
            path.append(route)
        } catch is CancellationError {
            return
        } catch {
            graphHopperNotice = "\(error.localizedDescription) Showing the existing mock routes below."
        }
    }
}
