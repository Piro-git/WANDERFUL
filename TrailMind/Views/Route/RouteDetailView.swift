import SwiftUI
import UIKit

enum GPXShareOutcome: Equatable, Sendable {
    case completed
    case cancelled
    case failed
}

struct GPXCleanupContext: Equatable, Sendable {
    let export: PreparedGPXExport
    let completionErrorMessage: String?
    let cleanupFailureMessage: String
}

struct GPXPendingCleanup: Equatable {
    let context: GPXCleanupContext
    var isRetrying: Bool
    var isAlertPresented: Bool
}

struct GPXExportFlow: Equatable {
    enum State: Equatable {
        case idle
        case preparing
        case sharing(PreparedGPXExport, isPresented: Bool)
        case cleaning(GPXCleanupContext)
        case cleanupPending(GPXPendingCleanup)
        case failed(String)
    }

    private(set) var state: State = .idle

    var isPreparing: Bool {
        state == .preparing
    }

    var isCleanupRetrying: Bool {
        guard case let .cleanupPending(pending) = state else { return false }
        return pending.isRetrying
    }

    var activeExport: PreparedGPXExport? {
        switch state {
        case let .sharing(export, _):
            return export
        case let .cleaning(context):
            return context.export
        case let .cleanupPending(pending):
            return pending.context.export
        case .idle, .preparing, .failed:
            return nil
        }
    }

    var presentedExport: PreparedGPXExport? {
        guard case let .sharing(export, isPresented: true) = state else { return nil }
        return export
    }

    var errorMessage: String? {
        switch state {
        case let .failed(message):
            return message
        case let .cleanupPending(pending) where pending.isAlertPresented:
            return pending.context.cleanupFailureMessage
        case .idle, .preparing, .sharing, .cleaning, .cleanupPending:
            return nil
        }
    }

    var cleanupPendingMessage: String? {
        guard case let .cleanupPending(pending) = state else { return nil }
        return pending.context.cleanupFailureMessage
    }

    var hasPendingCleanup: Bool {
        if case .cleanupPending = state { return true }
        return false
    }

    mutating func begin() -> Bool {
        switch state {
        case .idle, .failed:
            state = .preparing
            return true
        case .preparing, .sharing, .cleaning, .cleanupPending:
            return false
        }
    }

    @discardableResult
    mutating func didPrepare(_ export: PreparedGPXExport) -> Bool {
        guard state == .preparing else { return false }
        state = .sharing(export, isPresented: true)
        return true
    }

    mutating func didFail(_ error: Error) {
        guard state == .preparing else { return }
        state = .failed(GPXExportError.userMessage(for: error))
    }

    mutating func dismissError() {
        switch state {
        case .failed:
            state = .idle
        case var .cleanupPending(pending):
            pending.isAlertPresented = false
            state = .cleanupPending(pending)
        case .idle, .preparing, .sharing, .cleaning:
            break
        }
    }

    mutating func cancelPreparation() {
        guard state == .preparing else { return }
        state = .idle
    }

    mutating func didDismissShareSheet() {
        guard case let .sharing(export, isPresented: true) = state else { return }
        state = .sharing(export, isPresented: false)
    }

    @discardableResult
    mutating func beginFinishingSharing(
        _ export: PreparedGPXExport,
        outcome: GPXShareOutcome
    ) -> GPXCleanupContext? {
        guard
            case let .sharing(activeExport, _) = state,
            activeExport.id == export.id
        else { return nil }

        let completionErrorMessage = outcome == .failed
            ? GPXExportError.userMessage(for: GPXExportError.shareFailed)
            : nil
        let cleanupFailureMessage = outcome == .failed
            ? "TrailMind could not share the GPX file or remove its temporary copy. Retry cleanup before exporting again."
            : GPXExportError.userMessage(for: GPXExportError.cleanupFailed)
        let context = GPXCleanupContext(
            export: export,
            completionErrorMessage: completionErrorMessage,
            cleanupFailureMessage: cleanupFailureMessage
        )
        state = .cleaning(context)
        return context
    }

    @discardableResult
    mutating func beginFinishingDismissedShare(exportID: UUID) -> GPXCleanupContext? {
        guard
            case let .sharing(export, _) = state,
            export.id == exportID
        else { return nil }
        return beginFinishingSharing(export, outcome: .cancelled)
    }

    mutating func requireCleanup(_ context: GPXCleanupContext) {
        state = .cleanupPending(
            GPXPendingCleanup(
                context: context,
                isRetrying: false,
                isAlertPresented: true
            )
        )
    }

    @discardableResult
    mutating func finishCleanup(
        _ context: GPXCleanupContext,
        succeeded: Bool
    ) -> Bool {
        let matchesCurrentState: Bool
        switch state {
        case let .cleaning(activeContext):
            matchesCurrentState = activeContext.export.id == context.export.id
        case let .cleanupPending(pending):
            matchesCurrentState = pending.context.export.id == context.export.id
        case .idle, .preparing, .sharing, .failed:
            matchesCurrentState = false
        }
        guard matchesCurrentState else { return false }

        if succeeded {
            if let completionErrorMessage = context.completionErrorMessage {
                state = .failed(completionErrorMessage)
            } else {
                state = .idle
            }
        } else {
            requireCleanup(context)
        }
        return true
    }

    mutating func beginCleanupRetry() -> GPXCleanupContext? {
        guard case var .cleanupPending(pending) = state, !pending.isRetrying else {
            return nil
        }
        pending.isRetrying = true
        pending.isAlertPresented = false
        state = .cleanupPending(pending)
        return pending.context
    }
}

struct RouteDetailPresentation: Equatable {
    let allowsProductionActions: Bool
    let requestedDifficultyLabel: String?
    let verificationTitle: String?
    let verificationMessage: String?

    init(route: TrailRoute) {
        allowsProductionActions = route.isVerifiedRoutedResult
        requestedDifficultyLabel = route.planningMetadata?.requestedDifficultySummary

        guard !route.isVerifiedRoutedResult else {
            verificationTitle = nil
            verificationMessage = nil
            return
        }

        switch route.provenance {
        case .routed:
            verificationTitle = "Route verification failed"
            verificationMessage = "This result no longer matches its routed geometry or statistics. Save and export are unavailable."
        case .demo:
            verificationTitle = "Demo route"
            verificationMessage = "This fixture is not a verified routing result. Its route facts are for preview or testing only."
        case .unverified(.legacyRecord):
            verificationTitle = "Unverified saved route"
            verificationMessage = "This legacy snapshot remains viewable, but its route facts cannot be verified. Save and export are unavailable."
        case .unverified(.modifiedWithoutRouting), .unverified(.unknown):
            verificationTitle = "Unverified route"
            verificationMessage = "This route was not produced by a current verified routing response. Save and export are unavailable."
        }
    }
}

struct RouteDetailView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(AppModel.self) private var appModel
    @State private var exportFlow = GPXExportFlow()
    #if DEBUG
    @State private var showIntentQA = false
    #endif

    let route: TrailRoute
    private let gpxService: any GPXService

    init(
        route: TrailRoute,
        gpxService: any GPXService = DefaultGPXService()
    ) {
        self.route = route
        self.gpxService = gpxService
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                MapPreviewView(route: route)
                    .frame(height: 310)
                    .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
                    .padding(.horizontal, 10)

                VStack(alignment: .leading, spacing: TrailSpacing.section) {
                    header
                    verificationNotice
                    RouteStatsRow(route: route)
                    planningContext
                    verifiedRouteCharacteristics
                    #if DEBUG
                    intentQA
                    #endif
                    ElevationProfileView(route: route)
                    highlights
                    waypoints

                    if !route.days.isEmpty {
                        dayBreakdown
                    }

                    safety
                    if presentation.allowsProductionActions {
                        export
                    }
                }
                .padding(TrailSpacing.page)
            }
        }
        .background(TrailBackground())
        .scrollIndicators(.hidden)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if presentation.allowsProductionActions {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await appModel.savedRoutes.toggle(route) }
                    } label: {
                        if appModel.savedRoutes.pendingRouteIDs.contains(route.id) {
                            ProgressView()
                        } else {
                            Image(systemName: appModel.savedRoutes.isSaved(route) ? "bookmark.fill" : "bookmark")
                        }
                    }
                    .disabled(
                        appModel.savedRoutes.pendingRouteIDs.contains(route.id)
                            || appModel.savedRoutes.isPerformingAnyOperation
                    )
                    .accessibilityLabel(appModel.savedRoutes.isSaved(route) ? "Remove from saved routes" : "Save route")
                }
            }
        }
        .alert(
            "Saved Routes",
            isPresented: Binding(
                get: { appModel.savedRoutes.errorMessage != nil },
                set: { if !$0 { appModel.savedRoutes.clearError() } }
            )
        ) {
            Button("OK", role: .cancel) { appModel.savedRoutes.clearError() }
        } message: {
            Text(appModel.savedRoutes.errorMessage ?? "Please try again.")
        }
        .sheet(item: presentedExportBinding) { export in
            GPXActivityView(
                export: export,
                onComplete: { outcome in
                    finishSharing(export, outcome: outcome)
                },
                onTeardown: { exportID in
                    finishSharingAfterSheetTeardown(exportID: exportID)
                }
            )
        }
    }

    private var presentation: RouteDetailPresentation {
        RouteDetailPresentation(route: route)
    }

    @ViewBuilder
    private var verificationNotice: some View {
        if let title = presentation.verificationTitle,
           let message = presentation.verificationMessage
        {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "exclamationmark.shield.fill")
                    .foregroundStyle(theme.warning)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(theme.graphite)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(theme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.sand.opacity(0.68), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
            .accessibilityIdentifier("route.unverifiedNotice")
        }
    }

    @ViewBuilder
    private var verifiedRouteCharacteristics: some View {
        if let characteristics = route.verifiedCharacteristics,
           characteristics.hasDisplayableData
        {
            VerifiedRouteCharacteristicsView(characteristics: characteristics)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(route.location, systemImage: "location.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.moss)
                Spacer()
                DifficultyBadge(difficulty: route.difficulty)
            }

            Text(route.title)
                .font(.trailTitle)
                .foregroundStyle(theme.graphite)
                .fixedSize(horizontal: false, vertical: true)

            Text(route.summary)
                .font(.body)
                .foregroundStyle(theme.secondaryText)
                .lineSpacing(4)
        }
    }

    #if DEBUG
    @ViewBuilder
    private var intentQA: some View {
        if let metadata = route.intentDebugMetadata {
            DisclosureGroup(isExpanded: $showIntentQA) {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(IntentDebugFormatter.rows(for: metadata)) { row in
                        HStack(alignment: .top, spacing: 10) {
                            Text(row.label)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(theme.secondaryText)
                                .frame(width: 132, alignment: .leading)
                            Text(row.value)
                                .font(.caption.monospaced())
                                .foregroundStyle(theme.graphite)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .padding(.top, 10)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: metadata.localFallbackUsed ? "arrow.uturn.backward.circle.fill" : "sparkles")
                        .foregroundStyle(theme.forest)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Intent QA")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(theme.graphite)
                        Text("\(IntentDebugFormatter.parserSourceLabel(metadata.intent.parserSource)) · \(metadata.localFallbackUsed ? "local fallback" : "primary parser")")
                            .font(.caption)
                            .foregroundStyle(theme.secondaryText)
                    }
                }
            }
            .trailCard()
        }
    }
    #endif

    private var highlights: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "Why you’ll remember it")
            ForEach(route.highlights) { highlight in
                HStack(spacing: 14) {
                    Image(systemName: highlight.symbol)
                        .font(.headline)
                        .foregroundStyle(theme.forest)
                        .frame(width: 42, height: 42)
                        .background(theme.mossSoft.opacity(0.7), in: RoundedRectangle(cornerRadius: 13, style: .continuous))

                    VStack(alignment: .leading, spacing: 3) {
                        Text(highlight.title)
                            .font(.subheadline.weight(.bold))
                        Text(highlight.subtitle)
                            .font(.caption)
                            .foregroundStyle(theme.secondaryText)
                    }
                }
            }
        }
        .trailCard()
    }

    @ViewBuilder
    private var planningContext: some View {
        if let metadata = route.planningMetadata, !metadata.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(title: "Planned for you", subtitle: "Intent hints from your prompt, kept separate from verified map data.")

                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        PlanningChip(label: metadata.activityType.rawValue, symbol: metadata.activityType.symbol)

                        if metadata.routeType == .loop {
                            PlanningChip(label: "Loop route", symbol: "arrow.trianglehead.2.clockwise.rotate.90")
                        }

                        if let variantLabel = RouteAlternativeQuality.detailDisplayLabel(for: route) {
                            PlanningChip(label: variantLabel, symbol: "slider.horizontal.3")
                        }

                        if let requestedDistanceSummary = metadata.requestedDistanceSummary {
                            PlanningChip(
                                label: requestedDistanceSummary,
                                symbol: "ruler"
                            )
                        }

                        if let targetDurationMinutes = metadata.targetDurationMinutes {
                            PlanningChip(label: Self.durationHintLabel(minutes: targetDurationMinutes), symbol: "clock")
                        }

                        if let requestedDifficultyLabel = presentation.requestedDifficultyLabel,
                           let difficulty = metadata.difficulty
                        {
                            PlanningChip(label: requestedDifficultyLabel, symbol: difficulty.symbol)
                        }

                        ForEach(metadata.desiredFeatures, id: \.self) { feature in
                            PlanningChip(label: feature.label, symbol: feature.symbol)
                        }
                    }
                    .padding(.vertical, 1)
                }
                .scrollIndicators(.hidden)

                if let requestedFeatureSummary = metadata.requestedFeatureSummary {
                    Text(requestedFeatureSummary)
                        .font(.caption)
                        .foregroundStyle(theme.secondaryText)
                }

                if let routeShapingSummary = metadata.routeShapingSummary,
                   !routeShapingSummary.isEmpty
                {
                    RouteShapingSummaryView(summary: routeShapingSummary)
                }

                if let distanceNote = metadata.distanceNote(actualDistanceKm: route.distanceKilometers) {
                    Text(distanceNote)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.moss)
                }

                if case .singleRoute = metadata.loopSearchOutcome {
                    HStack(alignment: .top, spacing: 9) {
                        Image(systemName: "info.circle.fill")
                            .foregroundStyle(theme.moss)
                        Text("TrailMind found one distinct loop for this start and distance. A nearby trailhead or different distance may yield alternatives.")
                            .font(.caption)
                            .foregroundStyle(theme.graphite)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .background(theme.sand.opacity(0.62), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                let qualityExplanations = RouteQualityExplanationGenerator.explanations(for: route)
                if !qualityExplanations.isEmpty {
                    RouteQualityExplanationList(explanations: qualityExplanations)
                }
            }
            .trailCard()
        }
    }

    private var waypoints: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "Along the way", subtitle: "\(route.waypoints.count) useful moments, in order")
            WaypointTimelineView(waypoints: route.waypoints)
        }
    }

    private var dayBreakdown: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "Day by day")
            ForEach(route.days) { day in
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top) {
                        Text("DAY \(day.dayNumber)")
                            .font(.caption.weight(.bold))
                            .tracking(1)
                            .foregroundStyle(theme.moss)
                        Spacer()
                        Text("\(day.distanceKilometers.formatted()) km · +\(day.elevationGainMeters) m")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(theme.secondaryText)
                    }
                    Text(day.title)
                        .font(.headline)
                    Text(day.summary)
                        .font(.subheadline)
                        .foregroundStyle(theme.secondaryText)
                        .lineSpacing(3)
                }
                .trailCard()
            }
        }
    }

    private var safety: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Safety & planning", subtitle: "Useful context, never a substitute for current local information.")
            ForEach(route.safetyNotes) { note in
                SafetyNoteCard(note: note)
            }
        }
    }

    private var export: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Take it with you")
            Button(action: beginExport) {
                Group {
                    if exportFlow.isPreparing {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Preparing GPX")
                        }
                    } else {
                        Label("Export GPX", systemImage: "square.and.arrow.up")
                    }
                }
                    .font(.headline)
                    .foregroundStyle(theme.forest)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(exportFlow.isPreparing || exportFlow.activeExport != nil)
            .accessibilityLabel("Export GPX")
            .accessibilityValue(
                exportFlow.isPreparing
                    ? "Preparing GPX"
                    : (
                        exportFlow.hasPendingCleanup
                            ? "Temporary file cleanup required"
                            : (exportFlow.activeExport == nil ? "Ready" : "Sharing GPX")
                    )
            )
            .accessibilityIdentifier("route.exportGPX")

            if let cleanupMessage = exportFlow.cleanupPendingMessage {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.shield.fill")
                        .foregroundStyle(theme.warning)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(cleanupMessage)
                            .font(.caption)
                            .foregroundStyle(theme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                        Button {
                            requestCleanupRetry()
                        } label: {
                            if exportFlow.isCleanupRetrying {
                                Label("Retrying cleanup", systemImage: "arrow.triangle.2.circlepath")
                            } else {
                                Label("Retry cleanup", systemImage: "trash.slash")
                            }
                        }
                        .font(.caption.weight(.bold))
                        .disabled(exportFlow.isCleanupRetrying)
                        .accessibilityIdentifier("route.exportCleanup.retry")
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.sand.opacity(0.68), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityIdentifier("route.exportCleanup.pending")
            }
        }
        .padding(.bottom, 18)
        .task(id: exportFlow.isPreparing) {
            await prepareExportIfNeeded()
        }
        .alert(
            "Couldn’t Export GPX",
            isPresented: Binding(
                get: { exportFlow.errorMessage != nil },
                set: { if !$0 { exportFlow.dismissError() } }
            )
        ) {
            if exportFlow.hasPendingCleanup {
                Button("Retry Cleanup") { requestCleanupRetry() }
                    .accessibilityIdentifier("route.exportCleanup.alertRetry")
                Button("Later", role: .cancel) { exportFlow.dismissError() }
                    .accessibilityIdentifier("route.exportError.dismiss")
            } else {
                Button("Dismiss", role: .cancel) { exportFlow.dismissError() }
                    .accessibilityIdentifier("route.exportError.dismiss")
            }
        } message: {
            Text(exportFlow.errorMessage ?? "Please try again.")
                .accessibilityIdentifier("route.exportError")
        }
    }

    private var presentedExportBinding: Binding<PreparedGPXExport?> {
        Binding(
            get: { exportFlow.presentedExport },
            set: { newValue in
                if newValue == nil {
                    exportFlow.didDismissShareSheet()
                }
            }
        )
    }

    private func beginExport() {
        _ = exportFlow.begin()
    }

    @MainActor
    private func prepareExportIfNeeded() async {
        guard exportFlow.isPreparing else { return }
        await Task.yield()
        guard !Task.isCancelled else {
            exportFlow.cancelPreparation()
            return
        }

        do {
            let export = try await gpxService.prepareExport(route: route)
            guard !Task.isCancelled, exportFlow.didPrepare(export) else {
                await recoverCancelledExport(export)
                return
            }
        } catch let cleanupRequired as GPXCleanupRequiredError {
            await recoverCleanupRequired(cleanupRequired)
        } catch is CancellationError {
            exportFlow.cancelPreparation()
        } catch {
            guard !Task.isCancelled else {
                exportFlow.cancelPreparation()
                return
            }
            exportFlow.didFail(error)
        }
    }

    private func finishSharing(_ export: PreparedGPXExport, outcome: GPXShareOutcome) {
        guard let context = exportFlow.beginFinishingSharing(export, outcome: outcome) else {
            return
        }
        startCleanup(context)
    }

    private func finishSharingAfterSheetTeardown(exportID: UUID) {
        guard let context = exportFlow.beginFinishingDismissedShare(exportID: exportID) else {
            return
        }
        startCleanup(context)
    }

    private func startCleanup(_ context: GPXCleanupContext) {
        Task { @MainActor in
            let cleanupSucceeded = await gpxService.cleanup(context.export)
            guard exportFlow.finishCleanup(context, succeeded: cleanupSucceeded) else { return }
            if !cleanupSucceeded {
                await retryPendingCleanup()
            }
        }
    }

    @MainActor
    private func recoverCancelledExport(_ export: PreparedGPXExport) async {
        let context = GPXCleanupContext(
            export: export,
            completionErrorMessage: nil,
            cleanupFailureMessage: "TrailMind could not remove the cancelled temporary GPX file. Retry cleanup before exporting again."
        )
        exportFlow.requireCleanup(context)
        await retryPendingCleanup()
    }

    @MainActor
    private func recoverCleanupRequired(_ error: GPXCleanupRequiredError) async {
        let context = GPXCleanupContext(
            export: error.export,
            completionErrorMessage: error.primaryError.map {
                GPXExportError.userMessage(for: $0)
            },
            cleanupFailureMessage: GPXExportError.userMessage(for: error)
        )
        exportFlow.requireCleanup(context)
        await retryPendingCleanup()
    }

    private func requestCleanupRetry() {
        Task { @MainActor in
            await retryPendingCleanup()
        }
    }

    @MainActor
    private func retryPendingCleanup() async {
        guard let context = exportFlow.beginCleanupRetry() else { return }
        let cleanupSucceeded = await gpxService.cleanup(context.export)
        _ = exportFlow.finishCleanup(context, succeeded: cleanupSucceeded)
    }

    private static func durationHintLabel(minutes: Int) -> String {
        let hours = minutes / 60
        let remainder = minutes % 60
        if hours == 0 {
            return "ca. \(remainder) min"
        }
        return remainder == 0 ? "ca. \(hours) hr" : "ca. \(hours) hr \(remainder) min"
    }
}

nonisolated protocol GPXMainActorDispatching: Sendable {
    func dispatch(_ operation: @escaping @MainActor @Sendable () -> Void)
}

nonisolated struct GPXTaskMainActorDispatcher: GPXMainActorDispatching {
    func dispatch(_ operation: @escaping @MainActor @Sendable () -> Void) {
        Task { @MainActor in
            operation()
        }
    }
}

@MainActor
private final class GPXShareLifecycleCallbacks {
    let onComplete: @MainActor (GPXShareOutcome) -> Void
    let onTeardown: @MainActor (UUID) -> Void

    init(
        onComplete: @escaping @MainActor (GPXShareOutcome) -> Void,
        onTeardown: @escaping @MainActor (UUID) -> Void
    ) {
        self.onComplete = onComplete
        self.onTeardown = onTeardown
    }
}

nonisolated final class GPXShareLifecycleCoordinator: @unchecked Sendable {
    let exportID: UUID

    private let lock = NSLock()
    private let callbacks: GPXShareLifecycleCallbacks
    private let dispatcher: any GPXMainActorDispatching
    private var isResolved = false

    @MainActor
    init(
        exportID: UUID,
        onComplete: @escaping @MainActor (GPXShareOutcome) -> Void,
        onTeardown: @escaping @MainActor (UUID) -> Void,
        dispatcher: any GPXMainActorDispatching = GPXTaskMainActorDispatcher()
    ) {
        self.exportID = exportID
        self.callbacks = GPXShareLifecycleCallbacks(
            onComplete: onComplete,
            onTeardown: onTeardown
        )
        self.dispatcher = dispatcher
    }

    func receiveCompletion(_ outcome: GPXShareOutcome) {
        guard claimResolution() else { return }
        let callbacks = callbacks
        dispatcher.dispatch {
            callbacks.onComplete(outcome)
        }
    }

    func tearDown() {
        guard claimResolution() else { return }
        let callbacks = callbacks
        let exportID = exportID
        dispatcher.dispatch {
            callbacks.onTeardown(exportID)
        }
    }

    private func claimResolution() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !isResolved else { return false }
        isResolved = true
        return true
    }
}

private struct GPXActivityView: UIViewControllerRepresentable {
    let export: PreparedGPXExport
    let onComplete: @MainActor (GPXShareOutcome) -> Void
    let onTeardown: @MainActor (UUID) -> Void

    func makeCoordinator() -> GPXShareLifecycleCoordinator {
        GPXShareLifecycleCoordinator(
            exportID: export.id,
            onComplete: onComplete,
            onTeardown: onTeardown
        )
    }

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let itemProvider = NSItemProvider()
        itemProvider.suggestedName = export.filename
        itemProvider.registerFileRepresentation(
            for: export.contentType,
            visibility: .all,
            openInPlace: false
        ) { completion in
            completion(export.fileURL, false, nil)
            return nil
        }

        let items = UIActivityItemsConfiguration(itemProviders: [itemProvider])
        let controller = UIActivityViewController(activityItemsConfiguration: items)
        let lifecycleCoordinator = context.coordinator
        controller.completionWithItemsHandler = { _, completed, _, activityError in
            let outcome: GPXShareOutcome
            if activityError != nil {
                outcome = .failed
            } else {
                outcome = completed ? .completed : .cancelled
            }
            lifecycleCoordinator.receiveCompletion(outcome)
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}

    static func dismantleUIViewController(
        _ uiViewController: UIActivityViewController,
        coordinator: GPXShareLifecycleCoordinator
    ) {
        coordinator.tearDown()
    }
}

private struct PlanningChip: View {
    @Environment(TrailTheme.self) private var theme

    let label: String
    let symbol: String

    var body: some View {
        Label(label, systemImage: symbol)
            .font(.caption.weight(.bold))
            .foregroundStyle(theme.forest)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(theme.mossSoft.opacity(0.62), in: Capsule())
    }
}

private struct RouteShapingSummaryView: View {
    @Environment(TrailTheme.self) private var theme

    let summary: RouteShapingSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !summary.applied.isEmpty {
                preferenceRow(
                    title: "Applied to routing",
                    preferences: summary.applied,
                    symbol: "checkmark.circle.fill",
                    color: theme.forest
                )
            }
            if !summary.requestedOnly.isEmpty {
                preferenceRow(
                    title: "Requested only",
                    preferences: summary.requestedOnly,
                    symbol: "info.circle.fill",
                    color: theme.secondaryText
                )
            }
        }
    }

    private func preferenceRow(
        title: String,
        preferences: [RouteShapingPreference],
        symbol: String,
        color: Color
    ) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(color)
            Text("\(title): \(preferences.map(\.label).joined(separator: ", "))")
                .font(.caption)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct VerifiedRouteCharacteristicsView: View {
    @Environment(TrailTheme.self) private var theme

    let characteristics: VerifiedRouteCharacteristics

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(
                title: "Route surface",
                subtitle: "Measured from mapped GraphHopper route segments."
            )

            if characteristics.hasDisplayableSurfaceData {
                surfaceBar
                HStack(spacing: 18) {
                    if let unpavedRatio = characteristics.unpavedRatio {
                        legendItem(
                            label: "Unpaved",
                            value: percentLabel(unpavedRatio),
                            color: theme.forest
                        )
                    }
                    if let pavedRatio = characteristics.pavedRatio {
                        legendItem(
                            label: "Paved",
                            value: percentLabel(pavedRatio),
                            color: theme.moss
                        )
                    }
                    if let unknownRatio = characteristics.unknownSurfaceRatio, unknownRatio >= 0.01 {
                        legendItem(
                            label: "Unknown",
                            value: percentLabel(unknownRatio),
                            color: theme.secondaryText.opacity(0.45)
                        )
                    }
                }
            }

            if let pathAndTrackRatio = characteristics.pathAndTrackRatio {
                factRow(
                    title: "Paths and tracks",
                    value: percentLabel(pathAndTrackRatio),
                    symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
                )
            }

            if let majorRoadRatio = characteristics.majorRoadRatio {
                factRow(
                    title: "Major roads",
                    value: percentLabel(majorRoadRatio),
                    symbol: "road.lanes"
                )
            }

            if let maximumHikeRating = characteristics.maximumHikeRating,
               maximumHikeRating >= 2
            {
                let distanceKm = characteristics.mountainHikingDistanceMeters / 1_000
                factRow(
                    title: "Mountain-hiking classified sections",
                    value: "\(distanceKm.formatted(.number.precision(.fractionLength(1)))) km · rating up to \(maximumHikeRating)",
                    symbol: "mountain.2.fill"
                )
            }

            Text(coverageSummary)
                .font(.caption)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .trailCard()
    }

    private var surfaceBar: some View {
        GeometryReader { proxy in
            let pavedWidth = proxy.size.width * (characteristics.pavedRatio ?? 0)
            let unpavedWidth = proxy.size.width * (characteristics.unpavedRatio ?? 0)
            let unknownWidth = max(0, proxy.size.width - pavedWidth - unpavedWidth)

            HStack(spacing: 0) {
                Rectangle()
                    .fill(theme.forest)
                    .frame(width: unpavedWidth)
                Rectangle()
                    .fill(theme.moss)
                    .frame(width: pavedWidth)
                Rectangle()
                    .fill(theme.secondaryText.opacity(0.25))
                    .frame(width: unknownWidth)
            }
            .clipShape(Capsule())
        }
        .frame(height: 10)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Surface: \(percentLabel(characteristics.unpavedRatio ?? 0)) unpaved, \(percentLabel(characteristics.pavedRatio ?? 0)) paved"
        )
    }

    private func legendItem(label: String, value: String, color: Color) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 1) {
                Text(value)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(theme.graphite)
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(theme.secondaryText)
            }
        }
    }

    private func factRow(title: String, value: String, symbol: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.forest)
                .frame(width: 28, height: 28)
                .background(theme.mossSoft.opacity(0.62), in: Circle())
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.graphite)
            Spacer(minLength: 8)
            Text(value)
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.secondaryText)
                .multilineTextAlignment(.trailing)
        }
    }

    private var coverageSummary: String {
        var values: [String] = []
        if characteristics.surfaceCoverageMeters > 0 {
            values.append("surface \(percentLabel(characteristics.surfaceCoverageRatio))")
        }
        if characteristics.roadClassCoverageMeters > 0 {
            values.append("road class \(percentLabel(characteristics.roadClassCoverageRatio))")
        }
        if characteristics.hikeRatingCoverageMeters > 0 {
            values.append("hike rating \(percentLabel(characteristics.hikeRatingCoverageRatio))")
        }
        return "Mapped-data coverage: \(values.joined(separator: ", ")). Unknown sections are not treated as paved or unpaved."
    }

    private func percentLabel(_ ratio: Double) -> String {
        "\(Int((ratio * 100).rounded()))%"
    }
}

struct RouteStatsRow: View {
    let route: TrailRoute

    var body: some View {
        HStack(spacing: 8) {
            StatPill(value: route.distanceLabel, label: "Distance", symbol: "point.bottomleft.forward.to.point.topright.scurvepath")
            StatPill(value: route.elevationLabel, label: "Elevation", symbol: "mountain.2.fill")
            StatPill(value: route.durationLabel, label: "Duration", symbol: "clock.fill")
            StatPill(value: route.routeType.rawValue, label: "Type", symbol: "arrow.trianglehead.2.clockwise.rotate.90")
        }
        .trailCard()
    }
}
