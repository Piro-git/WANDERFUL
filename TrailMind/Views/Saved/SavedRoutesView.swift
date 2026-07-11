import SwiftUI

struct SavedRoutesView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(AppModel.self) private var appModel

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

                        if let notice = appModel.savedRoutes.loadNotice {
                            Label(notice, systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote)
                                .foregroundStyle(theme.secondaryText)
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(theme.sand.opacity(0.65), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .accessibilityIdentifier("saved.loadNotice")
                        }

                        if appModel.savedRoutes.routes.isEmpty {
                            EmptyStateView(
                                title: "Nothing saved yet",
                                message: "Save a route from its detail page and it will wait here.",
                                symbol: "bookmark"
                            )
                        } else {
                            ForEach(appModel.savedRoutes.routes) { route in
                                NavigationLink(value: route) {
                                    RouteCard(route: route, matchScore: nil)
                                }
                                .buttonStyle(.plain)
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        Task { await appModel.savedRoutes.remove(routeID: route.id) }
                                    } label: {
                                        Label("Remove", systemImage: "trash")
                                    }
                                    .disabled(appModel.savedRoutes.pendingRouteIDs.contains(route.id))
                                }
                                .contextMenu {
                                    Button(role: .destructive) {
                                        Task { await appModel.savedRoutes.remove(routeID: route.id) }
                                    } label: {
                                        Label("Remove from Saved", systemImage: "trash")
                                    }
                                }
                                .accessibilityAction(named: "Remove from Saved") {
                                    Task { await appModel.savedRoutes.remove(routeID: route.id) }
                                }
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
            .task {
                await appModel.savedRoutes.loadIfNeeded()
            }
            .alert(
                "Saved Routes",
                isPresented: Binding(
                    get: { appModel.savedRoutes.errorMessage != nil },
                    set: { if !$0 { appModel.savedRoutes.clearError() } }
                )
            ) {
                Button("Reload") { Task { await appModel.savedRoutes.retryLoad() } }
                Button("Cancel", role: .cancel) { appModel.savedRoutes.clearError() }
            } message: {
                Text(appModel.savedRoutes.errorMessage ?? "Please try again.")
            }
        }
    }
}
