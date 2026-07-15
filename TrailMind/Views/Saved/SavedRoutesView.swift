import SwiftUI

enum SavedRoutesViewContent {
    static let headerSubtitle = "Reopen and review routes you’ve saved."
    static let emptyTitle = "Nothing saved yet"
    static let emptyMessage = "Save a verified route from its detail page and it will appear here."
    static let loadingMessage = "Loading saved routes…"
    static let unavailableTitle = "Saved routes unavailable"
    static let unavailableMessage = "Your saved route data could not be read. It has not been replaced."
    static let unverifiedLabel = "Unverified legacy route · details are not verified"
    static let deleteAllTitle = "Delete All Saved Routes?"
    static let stateAccessibilityIdentifiers = [
        "saved.loadingState",
        "saved.emptyState",
        "saved.populatedState",
        "saved.recoveryNotice",
        "saved.unavailableState",
        "saved.unverifiedRoute"
    ]
}

struct SavedRoutesView: View {
    @Environment(AppModel.self) private var appModel
    @State private var destructiveAction: SavedRoutesDestructiveAction?

    private var isShowingDestructiveConfirmation: Binding<Bool> {
        Binding(
            get: { destructiveAction != nil },
            set: { if !$0 { destructiveAction = nil } }
        )
    }

    private var isShowingFailure: Binding<Bool> {
        Binding(
            get: { appModel.savedRoutes.failure != nil },
            set: { if !$0 { appModel.savedRoutes.clearError() } }
        )
    }

    var body: some View {
        NavigationStack {
            ZStack {
                TrailBackground()

                ScrollView {
                    VStack(alignment: .leading, spacing: TrailSpacing.section) {
                        SavedRoutesHeader()

                        if let notice = appModel.savedRoutes.loadNotice {
                            SavedRouteRecoveryNoticeView(
                                message: notice,
                                canDiscardUnusableRecords: appModel.savedRoutes.canDiscardUnusableRecords,
                                isWorking: appModel.savedRoutes.isPerformingAnyOperation,
                                discardAction: confirmDiscardUnusableRecords
                            )
                        }

                        SavedRoutesContentView(
                            state: appModel.savedRoutes.contentState,
                            snapshots: appModel.savedRoutes.snapshots,
                            pendingRouteIDs: appModel.savedRoutes.pendingRouteIDs,
                            isPerformingAnyOperation: appModel.savedRoutes.isPerformingAnyOperation,
                            removeAction: remove,
                            retryAction: retryLoad,
                            resetAction: confirmReset
                        )
                    }
                    .padding(TrailSpacing.page)
                }
            }
            .navigationTitle("Saved")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: TrailRoute.self) { route in
                RouteDetailView(route: route)
            }
            .toolbar {
                if !appModel.savedRoutes.snapshots.isEmpty || appModel.savedRoutes.recoveryReport.hasNotice {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(role: .destructive, action: confirmDeleteAll) {
                            Image(systemName: "trash")
                        }
                        .disabled(appModel.savedRoutes.isPerformingAnyOperation)
                        .accessibilityLabel("Delete all saved routes")
                    }
                }
            }
            .task(loadSavedRoutes)
            .confirmationDialog(
                destructiveAction?.title ?? "Confirm Saved Route Cleanup",
                isPresented: isShowingDestructiveConfirmation,
                titleVisibility: .visible
            ) {
                if let destructiveAction {
                    Button(destructiveAction.buttonTitle, role: .destructive) {
                        perform(destructiveAction)
                    }
                    .disabled(appModel.savedRoutes.isPerformingAnyOperation)
                }
                Button("Cancel", role: .cancel) {
                    destructiveAction = nil
                }
            } message: {
                if let destructiveAction {
                    Text(destructiveAction.message)
                }
            }
            .alert(
                appModel.savedRoutes.failure?.title ?? "Saved Routes",
                isPresented: isShowingFailure
            ) {
                if appModel.savedRoutes.failure?.kind == .load {
                    Button("Retry", action: retryLoad)
                }
                Button("OK", role: .cancel) {
                    appModel.savedRoutes.clearError()
                }
            } message: {
                Text(appModel.savedRoutes.failure?.message ?? "Please try again.")
            }
        }
    }

    private func loadSavedRoutes() async {
        await appModel.savedRoutes.loadIfNeeded()
    }

    private func retryLoad() {
        Task { await appModel.savedRoutes.retryLoad() }
    }

    private func remove(_ routeID: UUID) {
        Task { await appModel.savedRoutes.remove(routeID: routeID) }
    }

    private func confirmDeleteAll() {
        destructiveAction = .deleteAll
    }

    private func confirmDiscardUnusableRecords() {
        destructiveAction = .discardUnusableRecords
    }

    private func confirmReset() {
        destructiveAction = .resetUnavailableStore
    }

    private func perform(_ action: SavedRoutesDestructiveAction) {
        destructiveAction = nil
        Task {
            switch action {
            case .deleteAll, .resetUnavailableStore:
                await appModel.savedRoutes.removeAll()
            case .discardUnusableRecords:
                await appModel.savedRoutes.discardUnusableRecords()
            }
        }
    }
}

private enum SavedRoutesDestructiveAction {
    case deleteAll
    case discardUnusableRecords
    case resetUnavailableStore

    var title: String {
        switch self {
        case .deleteAll: SavedRoutesViewContent.deleteAllTitle
        case .discardUnusableRecords: "Remove Unusable Records?"
        case .resetUnavailableStore: "Reset Saved Route Data?"
        }
    }

    var buttonTitle: String {
        switch self {
        case .deleteAll: "Delete All"
        case .discardUnusableRecords: "Remove Unusable Records"
        case .resetUnavailableStore: "Reset Saved Data"
        }
    }

    var message: String {
        switch self {
        case .deleteAll:
            "This permanently removes every saved route and any unusable saved-route records from this device."
        case .discardUnusableRecords:
            "Only records that could not be restored will be removed. Valid saved routes remain available."
        case .resetUnavailableStore:
            "This permanently removes unreadable saved-route data and creates an empty Saved screen."
        }
    }
}

private struct SavedRoutesHeader: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your trail shelf")
                .font(.trailTitle)
            Text(SavedRoutesViewContent.headerSubtitle)
                .foregroundStyle(theme.secondaryText)
        }
    }
}

private struct SavedRouteRecoveryNoticeView: View {
    @Environment(TrailTheme.self) private var theme

    let message: String
    let canDiscardUnusableRecords: Bool
    let isWorking: Bool
    let discardAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(theme.secondaryText)

            if canDiscardUnusableRecords {
                Button("Remove unusable records", action: discardAction)
                    .font(.footnote.weight(.semibold))
                    .disabled(isWorking)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.sand.opacity(0.65), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityIdentifier(SavedRoutesViewContent.stateAccessibilityIdentifiers[3])
    }
}

private struct SavedRoutesContentView: View {
    let state: SavedRoutesContentState
    let snapshots: [SavedRouteSnapshot]
    let pendingRouteIDs: Set<UUID>
    let isPerformingAnyOperation: Bool
    let removeAction: (UUID) -> Void
    let retryAction: () -> Void
    let resetAction: () -> Void

    var body: some View {
        Group {
            switch state {
            case .loading:
                SavedRoutesLoadingView()
            case .empty:
                EmptyStateView(
                    title: SavedRoutesViewContent.emptyTitle,
                    message: SavedRoutesViewContent.emptyMessage,
                    symbol: "bookmark"
                )
                .accessibilityIdentifier(SavedRoutesViewContent.stateAccessibilityIdentifiers[1])
            case .populated:
                LazyVStack(spacing: TrailSpacing.section) {
                    ForEach(snapshots) { snapshot in
                        SavedRouteRow(
                            snapshot: snapshot,
                            isPending: pendingRouteIDs.contains(snapshot.id) || isPerformingAnyOperation,
                            removeAction: { removeAction(snapshot.id) }
                        )
                    }
                }
                .accessibilityIdentifier(SavedRoutesViewContent.stateAccessibilityIdentifiers[2])
            case .unavailable:
                SavedRoutesUnavailableView(
                    isWorking: isPerformingAnyOperation,
                    retryAction: retryAction,
                    resetAction: resetAction
                )
            }
        }
    }
}

private struct SavedRoutesLoadingView: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(SavedRoutesViewContent.loadingMessage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(theme.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .trailCard()
        .accessibilityIdentifier(SavedRoutesViewContent.stateAccessibilityIdentifiers[0])
    }
}

private struct SavedRoutesUnavailableView: View {
    @Environment(TrailTheme.self) private var theme

    let isWorking: Bool
    let retryAction: () -> Void
    let resetAction: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.shield.fill")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(theme.warning)
            Text(SavedRoutesViewContent.unavailableTitle)
                .font(.title3.weight(.bold))
            Text(SavedRoutesViewContent.unavailableMessage)
                .font(.subheadline)
                .foregroundStyle(theme.secondaryText)
                .multilineTextAlignment(.center)
            Button("Try Again", action: retryAction)
                .buttonStyle(.borderedProminent)
                .disabled(isWorking)
            Button("Reset Saved Data", role: .destructive, action: resetAction)
                .font(.footnote.weight(.semibold))
                .disabled(isWorking)
        }
        .frame(maxWidth: .infinity)
        .trailCard()
        .accessibilityIdentifier(SavedRoutesViewContent.stateAccessibilityIdentifiers[4])
    }
}

private struct SavedRouteRow: View {
    @Environment(TrailTheme.self) private var theme

    let snapshot: SavedRouteSnapshot
    let isPending: Bool
    let removeAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !snapshot.route.isVerifiedRoutedResult {
                Label(SavedRoutesViewContent.unverifiedLabel, systemImage: "exclamationmark.shield.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.warning)
                    .accessibilityIdentifier(SavedRoutesViewContent.stateAccessibilityIdentifiers[5])
            }

            NavigationLink(value: snapshot.route) {
                RouteCard(route: snapshot.route, matchScore: nil)
            }
            .buttonStyle(.plain)

            HStack(spacing: 12) {
                Label {
                    Text(snapshot.savedAt, format: .dateTime.day().month(.abbreviated).year())
                } icon: {
                    Image(systemName: "bookmark.fill")
                }
                .font(.caption)
                .foregroundStyle(theme.secondaryText)

                Spacer()

                Button(role: .destructive, action: removeAction) {
                    Label("Remove", systemImage: "trash")
                }
                .font(.caption.weight(.semibold))
                .disabled(isPending)
            }
            .padding(.horizontal, 6)
        }
        .contextMenu {
            Button("Remove from Saved", systemImage: "trash", role: .destructive, action: removeAction)
                .disabled(isPending)
        }
        .accessibilityAction(named: "Remove from Saved") {
            guard !isPending else { return }
            removeAction()
        }
    }
}
