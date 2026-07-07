import SwiftUI

struct SavedRoutesView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(AppModel.self) private var appModel

    private var savedRoutes: [TrailRoute] {
        MockRoutes.all.filter { appModel.savedRouteIDs.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                TrailBackground()

                ScrollView {
                    VStack(alignment: .leading, spacing: TrailSpacing.section) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Your trail shelf")
                                .font(.trailTitle)
                            Text("Plans you want within reach, even before offline maps arrive.")
                                .foregroundStyle(theme.secondaryText)
                        }

                        if savedRoutes.isEmpty {
                            EmptyStateView(
                                title: "Nothing saved yet",
                                message: "Save a route from its detail page and it will wait here.",
                                symbol: "bookmark"
                            )
                        } else {
                            ForEach(savedRoutes) { route in
                                NavigationLink(value: route) {
                                    RouteCard(route: route, matchScore: nil)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(TrailSpacing.page)
                }
            }
            .navigationTitle("Saved")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: TrailRoute.self) { route in
                RouteDetailView(route: route)
            }
        }
    }
}
