import SwiftUI

struct RouteOfflinePreparationView: View {
    let route: TrailRoute
    let savedRoutes: SavedRoutesModel
    @Environment(\.dismiss) private var dismiss
    @State private var isWorking = false
    @State private var didVerify = false
    @State private var message: String?

    private var isPrepared: Bool {
        didVerify && RouteOfflineReadiness.hasMatchingRoute(route, in: savedRoutes.snapshots)
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Route on this iPhone") {
                    Label(isPrepared ? "Route and instructions saved" : "Local route not verified",
                          systemImage: isPrepared ? "checkmark.circle.fill" : "internaldrive")
                        .accessibilityIdentifier("guidance.offline.routeStatus")
                    Text("Save the mapped route and available instructions. Reopen it from Saved after closing the app; start guidance again manually.")
                    if route.routeInstructions.isEmpty {
                        Text("This route has no turn instructions. Only its mapped line and route statistics can be saved.")
                    }
                    Button(isPrepared ? "Verify saved route" : "Save route and instructions") {
                        Task { await prepare() }
                    }
                    .disabled(isWorking || savedRoutes.isPerformingAnyOperation)
                    .accessibilityIdentifier("guidance.offline.save")
                    if isWorking { ProgressView("Checking local storage…") }
                    if let message { Text(message).foregroundStyle(.secondary) }
                }
                Section("Maps are not downloaded") {
                    Label("Offline map unavailable", systemImage: "wifi.slash")
                    Text("The Apple basemap needs connectivity. Previously viewed areas may disappear without a network connection. Saving this route does not download a map.")
                    Text("GPS can follow the saved line without internet. There is no offline route recalculation or AI planning. Prepare another reliable map before leaving coverage.")
                }
                Section("While guidance is active") {
                    Text("Start guidance while the app is open. Location updates continue during screen lock and app changes. Pause or End stops location use. Force-quitting the app or restarting your iPhone ends the session.")
                    Text("No location track is saved or sent. Check weather, local rules and trail conditions before starting.")
                }
                if savedRoutes.isSaved(route) {
                    Section {
                        Button("Delete saved route", role: .destructive) {
                            Task {
                                isWorking = true
                                await savedRoutes.remove(routeID: route.id)
                                didVerify = false
                                message = savedRoutes.errorMessage
                                isWorking = false
                            }
                        }
                        .disabled(isWorking || savedRoutes.isPerformingAnyOperation)
                        Text("Removes this route from Saved. The current guidance session keeps its route until you end it.")
                    }
                }
            }
            .navigationTitle("Offline preparation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .interactiveDismissDisabled(isWorking)
            .task {
                isWorking = true
                await savedRoutes.retryLoad()
                didVerify = savedRoutes.errorMessage == nil
                message = savedRoutes.errorMessage
                isWorking = false
            }
        }
    }

    private func prepare() async {
        isWorking = true
        didVerify = false
        message = nil
        await savedRoutes.save(route)
        if let error = savedRoutes.errorMessage {
            message = error
        } else {
            // Read back from the existing durable store before claiming readiness.
            await savedRoutes.retryLoad()
            didVerify = savedRoutes.errorMessage == nil
            message = savedRoutes.errorMessage
            if didVerify && !isPrepared {
                message = "The saved route could not be verified. Keep the app open and try saving again."
            }
        }
        isWorking = false
    }
}
