import MapKit
import SwiftUI
import UIKit

struct RouteGuidanceView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var colorSchemeContrast
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var model: RouteGuidanceModel
    @State private var cameraPosition: MapCameraPosition
    @State private var showEndConfirmation = false

    init(route: TrailRoute, dependencies: RouteGuidanceDependencies) {
        _model = State(
            initialValue: RouteGuidanceModel(
                route: route,
                dependencies: dependencies
            )
        )
        let geometry = RouteThumbnailService.shared.geometry(for: route)
        _cameraPosition = State(
            initialValue: .region(DefaultMapService.region(for: geometry.bounds))
        )
    }

    var body: some View {
        ZStack {
            guidanceMap
                .ignoresSafeArea()

            VStack(spacing: 0) {
                topStatusBar
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            guidanceCard
        }
        .background(theme.sand)
        .task {
            await model.start()
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .background {
                model.appDidEnterBackground()
            }
        }
        .onChange(of: model.latestLocation?.coordinate) { _, coordinate in
            guard let coordinate else { return }
            recenter(on: coordinate)
        }
        .onDisappear {
            model.shutdown()
        }
        .alert("End Route Guidance?", isPresented: $showEndConfirmation) {
            Button("Keep Guiding", role: .cancel) {}
            Button("End Route", role: .destructive) {
                model.end()
            }
            .accessibilityIdentifier("guidance.end.confirm")
        } message: {
            Text("Your current guidance session will stop. Wanderful does not save a location track.")
        }
    }

    private var guidanceMap: some View {
        Map(
            position: $cameraPosition,
            interactionModes: [.pan, .zoom, .rotate]
        ) {
            MapPolyline(coordinates: routeCoordinates)
                .stroke(
                    theme.forest,
                    style: StrokeStyle(
                        lineWidth: colorSchemeContrast == .increased ? 8 : 6,
                        lineCap: .round,
                        lineJoin: .round
                    )
                )

            if let start = routeCoordinates.first {
                Marker("Start", systemImage: "figure.hiking", coordinate: start)
                    .tint(theme.brandFill)
            }
            if let finish = routeCoordinates.last {
                Marker("Finish", systemImage: "flag.checkered", coordinate: finish)
                    .tint(theme.warning)
            }

            if let location = model.latestLocation {
                let coordinate = mapCoordinate(location.coordinate)
                MapCircle(
                    center: coordinate,
                    radius: max(location.horizontalAccuracyMeters, 8)
                )
                .foregroundStyle(Color.blue.opacity(0.14))
                .stroke(Color.blue.opacity(0.46), lineWidth: 1)

                Annotation("Your position", coordinate: coordinate) {
                    ZStack {
                        Circle()
                            .fill(.white)
                            .frame(width: 25, height: 25)
                            .shadow(color: .black.opacity(0.2), radius: 4, y: 2)
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 15, height: 15)
                    }
                    .accessibilityHidden(true)
                }
            }
        }
        .mapStyle(
            .standard(
                elevation: .realistic,
                emphasis: .muted,
                pointsOfInterest: .excludingAll
            )
        )
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Route Guidance map")
        .accessibilityValue(model.mapAccessibilitySummary)
        .accessibilityHint("Use the guidance summary and controls below as an accessible alternative to the map.")
        .accessibilityIdentifier("guidance.mapSummary")
    }

    private var topStatusBar: some View {
        HStack(spacing: 10) {
            Label("Route Guidance", systemImage: "location.north.circle.fill")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(theme.graphite)
                .accessibilityIdentifier("guidance.screen")

            Spacer(minLength: 8)

            Label(statusLabel, systemImage: statusSymbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(statusColor)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(.regularMaterial, in: Capsule())
                .accessibilityIdentifier("guidance.status")
        }
        .padding(12)
        .background(.regularMaterial, in: Capsule())
        .shadow(color: .black.opacity(0.12), radius: 12, y: 5)
    }

    @ViewBuilder
    private var guidanceCard: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                ScrollView {
                    guidanceCardContent
                }
                .scrollIndicators(.hidden)
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: 560)
            } else {
                guidanceCardContent
            }
        }
        .background(
            theme.surface.opacity(colorSchemeContrast == .increased ? 1 : 0.97),
            in: UnevenRoundedRectangle(
                topLeadingRadius: 28,
                topTrailingRadius: 28
            )
        )
        .overlay(alignment: .top) {
            Capsule()
                .fill(theme.secondaryText.opacity(0.25))
                .frame(width: 38, height: 5)
                .padding(.top, 8)
                .accessibilityHidden(true)
        }
        .shadow(color: .black.opacity(0.16), radius: 22, y: -5)
    }

    private var guidanceCardContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            switch model.phase {
            case .starting:
                startingContent
            case .guiding, .paused:
                activeContent
            case .completed:
                terminalContent(
                    title: "Route complete",
                    message: "You’ve reached the mapped finish. Check your surroundings and local signs before moving on.",
                    symbol: "checkmark.circle.fill",
                    color: theme.forest
                )
            case .ended:
                terminalContent(
                    title: "Route Guidance ended",
                    message: "Location updates have stopped and no track was saved.",
                    symbol: "stop.circle.fill",
                    color: theme.secondaryText
                )
            case let .blocked(reason):
                blockedContent(reason)
            case let .failed(message):
                failedContent(message)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var startingContent: some View {
        HStack(alignment: .top, spacing: 14) {
            ProgressView()
                .controlSize(.large)
                .tint(theme.forest)
            VStack(alignment: .leading, spacing: 6) {
                Text("Starting Route Guidance")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(theme.graphite)
                Text("Waiting for When In Use permission and a precise foreground location.")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("guidance.starting")
    }

    private var activeContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            if shouldConstrainActiveDetails {
                ScrollView {
                    activeDetails
                }
                .scrollIndicators(.hidden)
                .scrollBounceBehavior(.basedOnSize)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxHeight: 370)
            } else {
                activeDetails
            }

            safetyLine
            activeControls
        }
    }

    private var activeDetails: some View {
        VStack(alignment: .leading, spacing: 16) {
            if case .paused(.appBackgrounded) = model.phase {
                infoBanner(
                    title: "Guidance paused",
                    message: "Wanderful stopped location updates when the app left the foreground. Resume when you’re ready.",
                    symbol: "pause.circle.fill",
                    color: theme.moss
                )
            }

            if let snapshot = model.snapshot,
               case let .offRoute(distanceMeters) = snapshot.adherence
            {
                offRouteWarning(distanceMeters: distanceMeters)
            }

            if model.isLocationDelayed {
                infoBanner(
                    title: "Location signal delayed",
                    message: "Progress is waiting for a fresh reading. Check the mapped line, trail signs, and your surroundings.",
                    symbol: "location.slash.fill",
                    color: theme.warning
                )
            }

            nextInstruction
            metrics
        }
    }

    private var shouldConstrainActiveDetails: Bool {
        guard !dynamicTypeSize.isAccessibilitySize else { return false }
        if case .paused(.appBackgrounded) = model.phase { return true }
        if case .offRoute = model.snapshot?.adherence { return true }
        return model.isLocationDelayed
    }

    private var nextInstruction: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("WHAT’S NEXT")
                .font(.caption.weight(.bold))
                .tracking(0.8)
                .foregroundStyle(theme.moss)

            if let instruction = model.snapshot?.nextInstruction {
                Text(instruction.text)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(theme.graphite)
                    .fixedSize(horizontal: false, vertical: true)
                if let streetName = instruction.streetName {
                    Text(streetName)
                        .font(.subheadline)
                        .foregroundStyle(theme.secondaryText)
                }
                if let distance = model.nextInstructionDistanceLabel {
                    Label(distance, systemImage: "signpost.right.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(theme.forest)
                }
            } else if model.snapshot == nil {
                Text("Finding your position")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(theme.graphite)
                Text("Stay in the foreground while Wanderful gets a precise reading.")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
            } else {
                Text("Follow the mapped route")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(theme.graphite)
                Text("No mapped routing instruction is available here. Check the map and local signs.")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("guidance.nextInstruction")
    }

    @ViewBuilder
    private var metrics: some View {
        let content = Group {
            metric(value: model.remainingDistanceLabel, label: "Remaining")
            metric(value: model.remainingTimeLabel, label: "Est. time")
            metric(value: model.progressLabel, label: "Progress")
        }
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 10) { content }
        } else {
            HStack(spacing: 10) { content }
        }
    }

    private func metric(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(.headline.weight(.bold))
                .foregroundStyle(theme.graphite)
                .fixedSize(horizontal: false, vertical: true)
            Text(label)
                .font(.caption)
                .foregroundStyle(theme.secondaryText)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            theme.warmWhite.opacity(0.82),
            in: RoundedRectangle(cornerRadius: 15, style: .continuous)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(value)")
    }

    private var safetyLine: some View {
        Label(
            "Guidance aid only. Conditions can change—check signs, weather, trail conditions, and local rules.",
            systemImage: "exclamationmark.shield.fill"
        )
        .font(.footnote)
        .foregroundStyle(theme.secondaryText)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("guidance.safety")
    }

    @ViewBuilder
    private var activeControls: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(spacing: 10) {
                primaryGuidanceControl
                recenterControl
                endControl
            }
        } else {
            HStack(spacing: 10) {
                primaryGuidanceControl
                recenterControl
                endControl
            }
        }
    }

    private var primaryGuidanceControl: some View {
        Button {
            if model.phase == .guiding {
                model.pause()
            } else {
                model.resume()
            }
        } label: {
            Label(
                model.phase == .guiding ? "Pause" : "Resume",
                systemImage: model.phase == .guiding
                    ? "pause.fill"
                    : "play.fill"
            )
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(GuidancePrimaryButtonStyle(theme: theme))
        .accessibilityIdentifier(
            model.phase == .guiding ? "guidance.pause" : "guidance.resume"
        )
    }

    private var recenterControl: some View {
        Button {
            guard let coordinate = model.latestLocation?.coordinate else { return }
            recenter(on: coordinate)
        } label: {
            Label("Center", systemImage: "location.fill")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(GuidanceSecondaryButtonStyle(theme: theme))
        .disabled(model.latestLocation == nil)
        .accessibilityLabel("Recenter map on your position")
        .accessibilityIdentifier("guidance.recenter")
    }

    private var endControl: some View {
        Button(role: .destructive) {
            showEndConfirmation = true
        } label: {
            Label("End", systemImage: "stop.fill")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(GuidanceSecondaryButtonStyle(theme: theme))
        .accessibilityLabel("End Route Guidance")
        .accessibilityIdentifier("guidance.end")
    }

    private func offRouteWarning(distanceMeters: Double) -> some View {
        infoBanner(
            title: "You may be off route",
            message: "Your last reliable position is about \(RouteGuidanceModel.conservativeDistanceLabel(meters: distanceMeters)) from the mapped line. Progress is paused; check the map, local signs, and your surroundings.",
            symbol: "exclamationmark.triangle.fill",
            color: theme.warning,
            identifier: "guidance.offRouteWarning"
        )
    }

    private func blockedContent(_ reason: RouteGuidanceBlockReason) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(blockedTitle(reason), systemImage: blockedSymbol(reason))
                .font(.title3.weight(.bold))
                .foregroundStyle(theme.graphite)
                .accessibilityIdentifier("guidance.blocked")
            Text(blockedMessage(reason))
                .font(.subheadline)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            safetyLine
            if settingsCanHelp(reason) {
                Button("Open Settings") {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else {
                        return
                    }
                    openURL(url)
                }
                .buttonStyle(GuidancePrimaryButtonStyle(theme: theme))
                .accessibilityIdentifier("guidance.openSettings")
            }
            Button("Done") { dismiss() }
                .buttonStyle(GuidanceSecondaryButtonStyle(theme: theme))
                .accessibilityIdentifier("guidance.done")
        }
    }

    private func failedContent(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Location unavailable", systemImage: "location.slash.fill")
                .font(.title3.weight(.bold))
                .foregroundStyle(theme.graphite)
                .accessibilityIdentifier("guidance.failed")
            Text(message)
                .font(.subheadline)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button("Try Again") {
                    Task { await model.retry() }
                }
                .buttonStyle(GuidancePrimaryButtonStyle(theme: theme))
                .accessibilityIdentifier("guidance.retry")
                Button("Done") { dismiss() }
                    .buttonStyle(GuidanceSecondaryButtonStyle(theme: theme))
                    .accessibilityIdentifier("guidance.done")
            }
        }
    }

    private func terminalContent(
        title: String,
        message: String,
        symbol: String,
        color: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: symbol)
                .font(.title2.weight(.bold))
                .foregroundStyle(color)
                .accessibilityIdentifier(
                    model.phase == .completed
                        ? "guidance.completion"
                        : "guidance.ended"
                )
            Text(message)
                .font(.subheadline)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            safetyLine
            Button("Done") { dismiss() }
                .buttonStyle(GuidancePrimaryButtonStyle(theme: theme))
                .accessibilityIdentifier("guidance.done")
        }
    }

    private func infoBanner(
        title: String,
        message: String,
        symbol: String,
        color: Color,
        identifier: String? = nil
    ) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: symbol)
                .foregroundStyle(color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(theme.graphite)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            color.opacity(colorSchemeContrast == .increased ? 0.2 : 0.12),
            in: RoundedRectangle(cornerRadius: 15, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier ?? "guidance.info")
    }

    private var statusLabel: String {
        switch model.phase {
        case .starting:
            "Locating"
        case .guiding:
            if case .offRoute = model.snapshot?.adherence {
                "Check route"
            } else {
                "On route"
            }
        case .paused:
            "Paused"
        case .completed:
            "Complete"
        case .ended:
            "Ended"
        case .blocked, .failed:
            "Needs attention"
        }
    }

    private var statusSymbol: String {
        switch model.phase {
        case .guiding where model.snapshot?.adherence == .onRoute:
            "checkmark.circle.fill"
        case .guiding:
            "exclamationmark.triangle.fill"
        case .paused:
            "pause.circle.fill"
        case .completed:
            "checkmark.circle.fill"
        case .ended:
            "stop.circle.fill"
        case .starting:
            "location.fill"
        case .blocked, .failed:
            "exclamationmark.circle.fill"
        }
    }

    private var statusColor: Color {
        switch model.phase {
        case .guiding where model.snapshot?.adherence == .onRoute, .completed:
            theme.forest
        case .guiding, .blocked, .failed:
            theme.warning
        case .starting, .paused:
            theme.moss
        case .ended:
            theme.secondaryText
        }
    }

    private func blockedTitle(_ reason: RouteGuidanceBlockReason) -> String {
        switch reason {
        case .routeUnavailable:
            "Route Guidance unavailable"
        case .permissionDenied:
            "Location permission is off"
        case .permissionRestricted:
            "Location access is restricted"
        case .preciseLocationRequired:
            "Precise Location is off"
        case .locationServicesDisabled:
            "Location Services are off"
        }
    }

    private func blockedMessage(_ reason: RouteGuidanceBlockReason) -> String {
        switch reason {
        case .routeUnavailable:
            "This route is not an intact, verified routing result with usable geometry, so Wanderful won’t start guidance."
        case .permissionDenied:
            "Allow location access While Using the App to show your position and progress. Wanderful does not store or transmit a location track."
        case .permissionRestricted:
            "A device or account restriction prevents foreground location access. Route planning remains available without it."
        case .preciseLocationRequired:
            "Route Guidance needs Precise Location to compare your position with the mapped line. Location is used only in the foreground and is not saved."
        case .locationServicesDisabled:
            "Turn on Location Services to use Route Guidance. Route planning remains available without location access."
        }
    }

    private func blockedSymbol(_ reason: RouteGuidanceBlockReason) -> String {
        reason == .routeUnavailable
            ? "exclamationmark.shield.fill"
            : "location.slash.fill"
    }

    private func settingsCanHelp(_ reason: RouteGuidanceBlockReason) -> Bool {
        switch reason {
        case .permissionDenied, .preciseLocationRequired,
             .locationServicesDisabled:
            true
        case .routeUnavailable, .permissionRestricted:
            false
        }
    }

    private var routeCoordinates: [CLLocationCoordinate2D] {
        RouteThumbnailService.shared.geometry(for: model.route).mapPoints.map {
            mapCoordinate($0)
        }
    }

    private func mapCoordinate(_ coordinate: Coordinate) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(
            latitude: coordinate.latitude,
            longitude: coordinate.longitude
        )
    }

    private func recenter(on coordinate: Coordinate) {
        let latitudeSpan = 0.012
        let position = MapCameraPosition.region(
            MKCoordinateRegion(
                center: CLLocationCoordinate2D(
                    latitude: coordinate.latitude - latitudeSpan * 0.28,
                    longitude: coordinate.longitude
                ),
                span: MKCoordinateSpan(
                    latitudeDelta: latitudeSpan,
                    longitudeDelta: latitudeSpan
                )
            )
        )
        if reduceMotion {
            cameraPosition = position
        } else {
            withAnimation(.easeInOut(duration: 0.25)) {
                cameraPosition = position
            }
        }
    }
}

private struct GuidancePrimaryButtonStyle: ButtonStyle {
    let theme: TrailTheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(theme.onBrandPrimary)
            .padding(.horizontal, 14)
            .frame(minHeight: 52)
            .background(
                theme.brandFill.opacity(configuration.isPressed ? 0.82 : 1),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .contentShape(Rectangle())
    }
}

private struct GuidanceSecondaryButtonStyle: ButtonStyle {
    let theme: TrailTheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(theme.forest)
            .padding(.horizontal, 12)
            .frame(minHeight: 52)
            .background(
                theme.mossSoft.opacity(configuration.isPressed ? 0.5 : 0.72),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .contentShape(Rectangle())
    }
}
