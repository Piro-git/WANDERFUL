import MapKit
import SwiftUI

struct RouteComparisonAccessibilitySummary: Equatable {
    let label: String
    let hint = "Opens this route’s details."

    init(
        route: TrailRoute,
        comparisonLabel: String?,
        researchPresentation: ResearchRoutePresentation? = nil
    ) {
        var parts = [route.title]
        if let comparison = RouteAlternativeQuality.displayLabel(
            candidate: comparisonLabel,
            for: route
        ) {
            parts.append("Comparison: \(comparison)")
        }
        parts.append(
            "\(route.activity.rawValue), \(route.difficulty.rawValue) physical effort estimate"
        )
        parts.append(
            "\(route.distanceLabel) distance, \(route.elevationLabel) climb, \(route.durationLabel) time"
        )
        parts.append(
            Self.importantEvidence(
                for: route,
                researchPresentation: researchPresentation
            )
        )
        label = parts.joined(separator: ". ")
    }

    private static func importantEvidence(
        for route: TrailRoute,
        researchPresentation: ResearchRoutePresentation?
    ) -> String {
        if let limitation = researchPresentation?.limitations.first {
            return "Important limitation: \(limitation.title)"
        }
        if let fact = researchPresentation?.cardFacts.first {
            return "Verified evidence: \(fact.title)"
        }

        let quality = HikingRouteQualityEngine().presentation(for: route)
        if let limitation = quality.limitations.first {
            return "Important limitation: \(limitation.title)"
        }
        if let evidence = quality.verifiedCharacteristics.first {
            return "Verified evidence: \(evidence.title)"
        }
        if let fit = quality.primaryFit {
            return "Measured fit: \(fit.title)"
        }
        return "Important limitation: No additional mapped path evidence is available"
    }
}

struct RouteCard: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let route: TrailRoute
    let comparisonLabel: String?
    let qualityExplanations: [RouteQualityExplanation]
    let researchPresentation: ResearchRoutePresentation?
    private let qualityPresentation: RouteQualityExplanationSet

    init(
        route: TrailRoute,
        comparisonLabel: String? = nil,
        qualityExplanations: [RouteQualityExplanation] = [],
        researchPresentation: ResearchRoutePresentation? = nil
    ) {
        self.route = route
        self.comparisonLabel = comparisonLabel
        self.qualityExplanations = qualityExplanations
        self.researchPresentation = researchPresentation
        qualityPresentation = HikingRouteQualityEngine().presentation(for: route)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ZStack(alignment: .topLeading) {
                RouteThumbnailView(route: route)
                    .frame(height: 154)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .accessibilityHidden(true)

                if !usesExpandedLayout, badgeLabel != nil {
                    comparisonBadge
                        .padding(12)
                }
            }

            if usesExpandedLayout, badgeLabel != nil {
                comparisonBadge
            }

            VStack(alignment: .leading, spacing: 8) {
                locationAndEffort

                Text(route.title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(theme.graphite)
                    .fixedSize(horizontal: false, vertical: true)

                Text(route.summary)
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
                    .lineLimit(usesExpandedLayout ? nil : 2)
                    .fixedSize(horizontal: false, vertical: true)

                #if DEBUG
                if let intentDebugMetadata = route.intentDebugMetadata {
                    IntentSourceDebugBadge(metadata: intentDebugMetadata)
                }
                #endif
            }

            if let researchPresentation {
                ResearchRouteCardSummaryView(
                    presentation: researchPresentation
                )
            }

            routeStats

            if !cardEvidenceItems.isEmpty {
                RouteCardEvidenceRow(items: cardEvidenceItems)
            }
        }
        .trailCard()
    }

    @ViewBuilder
    private var comparisonBadge: some View {
        if let badgeLabel {
            Label(badgeLabel, systemImage: badgeSymbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.forest)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 11)
                .padding(.vertical, 8)
                .background(
                    theme.surface.opacity(0.94),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Route comparison: \(badgeLabel)")
        }
    }

    @ViewBuilder
    private var locationAndEffort: some View {
        if usesExpandedLayout {
            VStack(alignment: .leading, spacing: 9) {
                locationText
                effortEstimate(alignment: .leading)
            }
        } else {
            HStack(alignment: .top, spacing: 12) {
                locationText
                Spacer(minLength: 8)
                effortEstimate(alignment: .trailing)
            }
        }
    }

    @ViewBuilder
    private var locationText: some View {
        if let locationLabel {
            Text(locationLabel.uppercased())
                .font(.caption.weight(.bold))
                .tracking(0.8)
                .foregroundStyle(theme.moss)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func effortEstimate(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text("ESTIMATED EFFORT")
                .font(.caption2.weight(.semibold))
                .tracking(0.45)
                .foregroundStyle(theme.secondaryText)
            DifficultyBadge(difficulty: route.difficulty)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Physical effort estimate: \(route.difficulty.rawValue)")
    }

    @ViewBuilder
    private var routeStats: some View {
        if usesExpandedLayout {
            VStack(alignment: .leading, spacing: 12) {
                cardStat(route.distanceLabel, label: "Distance", expanded: true)
                Divider()
                cardStat(route.elevationLabel, label: "Climb", expanded: true)
                Divider()
                cardStat(route.durationLabel, label: "Time", expanded: true)
            }
        } else {
            HStack(spacing: 0) {
                cardStat(route.distanceLabel, label: "Distance", expanded: false)
                Divider().frame(height: 32)
                cardStat(route.elevationLabel, label: "Climb", expanded: false)
                Divider().frame(height: 32)
                cardStat(route.durationLabel, label: "Time", expanded: false)
            }
        }
    }

    private func cardStat(_ value: String, label: String, expanded: Bool) -> some View {
        Group {
            if expanded {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.secondaryText)
                    Spacer(minLength: 8)
                    Text(value)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(theme.graphite)
                        .multilineTextAlignment(.trailing)
                }
            } else {
                VStack(alignment: .leading, spacing: 3) {
                    Text(value)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(theme.graphite)
                    Text(label)
                        .font(.caption2)
                        .foregroundStyle(theme.secondaryText)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(value)")
    }

    private var usesExpandedLayout: Bool {
        RouteCardLayoutPolicy.usesExpandedLayout(for: dynamicTypeSize)
    }

    private var badgeLabel: String? {
        RouteAlternativeQuality.displayLabel(candidate: comparisonLabel, for: route)
    }

    private var cardEvidenceItems: [RouteQualityPresentationItem] {
        let candidates = qualityPresentation.verifiedCharacteristics
            + qualityPresentation.limitations
        return Array(
            candidates.prefix(HikingRouteQualityPolicy.v1.maximumCardExplanationCount)
        )
    }

    private var locationLabel: String? {
        let value = route.location.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private var badgeSymbol: String {
        route.routeType == .loop
            ? "arrow.trianglehead.2.clockwise.rotate.90"
            : "point.bottomleft.forward.to.point.topright.scurvepath"
    }
}

enum RouteCardLayoutPolicy {
    static func usesExpandedLayout(for size: DynamicTypeSize) -> Bool {
        size.isAccessibilitySize
    }
}

private struct RouteCardEvidenceRow: View {
    @Environment(TrailTheme.self) private var theme
    let items: [RouteQualityPresentationItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("Route evidence")
                .font(.footnote.weight(.bold))
                .foregroundStyle(theme.graphite)
                .accessibilityAddTraits(.isHeader)

            VStack(alignment: .leading, spacing: 8) {
                ForEach(items) { item in
                    evidenceItem(item)
                }
            }
        }
        .padding(12)
        .background(theme.warmWhite.opacity(0.72), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func evidenceItem(_ item: RouteQualityPresentationItem) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: item.symbol)
                .font(.footnote.weight(.bold))
                .foregroundStyle(itemColor(item.role))
                .frame(width: 22, height: 22)
                .accessibilityHidden(true)

            Text(item.title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(theme.graphite)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(
            itemBackground(item.role),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(item.accessibilityLabel)
        .accessibilityIdentifier("route.cardEvidence.\(item.code.rawValue)")
    }

    private func itemColor(_ role: RouteQualityExplanationRole) -> Color {
        role == .limitation ? theme.warning : theme.forest
    }

    private func itemBackground(_ role: RouteQualityExplanationRole) -> Color {
        role == .limitation
            ? theme.sand.opacity(0.68)
            : theme.mossSoft.opacity(0.48)
    }
}

#if DEBUG
private struct IntentSourceDebugBadge: View {
    @Environment(TrailTheme.self) private var theme
    let metadata: RouteIntentDebugMetadata

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: metadata.localFallbackUsed ? "arrow.uturn.backward.circle.fill" : "sparkles")
                .font(.caption2.weight(.bold))
            Text(IntentDebugFormatter.parserSourceLabel(metadata.intent.parserSource))
                .font(.caption2.weight(.bold))
            Text(metadata.localFallbackUsed ? "fallback" : "primary")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(theme.secondaryText)
        }
        .foregroundStyle(theme.forest)
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(theme.mossSoft.opacity(0.5), in: Capsule())
        .accessibilityLabel("Intent parser source \(IntentDebugFormatter.parserSourceLabel(metadata.intent.parserSource))")
    }
}
#endif

struct RouteThumbnailView: View {
    @Environment(TrailTheme.self) private var theme
    let route: TrailRoute

    var body: some View {
        let geometry = RouteThumbnailService.shared.geometry(for: route)

        ZStack {
            thumbnailBackground

            ContourLines()
                .stroke(theme.forest.opacity(0.075), lineWidth: 1)

            if geometry.hasRenderableRoute {
                GeometryReader { proxy in
                    ZStack {
                        thumbnailPath(points: geometry.normalizedPoints, in: proxy.size)
                            .stroke(
                                theme.forest.opacity(0.16),
                                style: StrokeStyle(lineWidth: 9, lineCap: .round, lineJoin: .round)
                            )
                            .blur(radius: 0.5)

                        thumbnailPath(points: geometry.normalizedPoints, in: proxy.size)
                            .stroke(
                                theme.forest,
                                style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round)
                            )

                        markers(points: geometry.normalizedPoints, isLoop: geometry.isLoop, in: proxy.size)
                    }
                    .padding(18)
                }
            } else {
                RouteThumbnailPlaceholder()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(route.routeType == .loop ? "Loop route preview" : "Point-to-point route preview")
        .accessibilityValue("\(route.distanceLabel), \(route.durationLabel), \(route.elevationLabel) climb")
    }

    private var thumbnailBackground: some View {
        LinearGradient(
            colors: [
                theme.sand.opacity(0.78),
                theme.mossSoft.opacity(0.58),
                theme.warmWhite.opacity(0.85)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private func thumbnailPath(points: [NormalizedRoutePoint], in size: CGSize) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first.cgPoint(in: size))
        for point in points.dropFirst() {
            path.addLine(to: point.cgPoint(in: size))
        }
        return path
    }

    @ViewBuilder
    private func markers(points: [NormalizedRoutePoint], isLoop: Bool, in size: CGSize) -> some View {
        if let start = points.first {
            let startPoint = start.cgPoint(in: size)
            ZStack {
                Circle()
                    .fill(theme.sand)
                    .stroke(theme.forest, lineWidth: 3)
                    .frame(width: isLoop ? 18 : 14, height: isLoop ? 18 : 14)
                if isLoop {
                    Image(systemName: "arrow.trianglehead.2.clockwise.rotate.90")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(theme.forest)
                }
            }
            .position(startPoint)
        }

        if !isLoop, let end = points.last {
            Circle()
                .fill(theme.brandFill)
                .frame(width: 14, height: 14)
                .overlay {
                    Circle()
                        .stroke(theme.onBrandPrimary.opacity(0.85), lineWidth: 2)
                }
                .position(end.cgPoint(in: size))
        }
    }
}

private struct RouteThumbnailPlaceholder: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            Path { path in
                path.move(to: CGPoint(x: size.width * 0.14, y: size.height * 0.68))
                path.addCurve(
                    to: CGPoint(x: size.width * 0.86, y: size.height * 0.36),
                    control1: CGPoint(x: size.width * 0.34, y: size.height * 0.22),
                    control2: CGPoint(x: size.width * 0.58, y: size.height * 0.86)
                )
            }
            .stroke(theme.forest.opacity(0.7), style: StrokeStyle(lineWidth: 5, lineCap: .round))
        }
        .padding(18)
        .overlay {
            Label("Preview pending", systemImage: "map")
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.forest.opacity(0.8))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(theme.surface.opacity(0.78), in: Capsule())
        }
    }
}

struct MiniRouteGlyph: View {
    @Environment(TrailTheme.self) private var theme
    let route: TrailRoute

    var body: some View {
        RouteThumbnailView(route: route)
    }
}

struct MapPreviewView: View {
    @Environment(TrailTheme.self) private var theme
    let route: TrailRoute

    @ViewBuilder
    var body: some View {
        let displayGeometry = RouteThumbnailService.shared.geometry(for: route)
        let coordinates = displayGeometry.mapPoints.map {
            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
        }

        if coordinates.count >= 2 {
            Map(
                initialPosition: .region(DefaultMapService.region(for: displayGeometry.bounds)),
                interactionModes: [.pan, .zoom]
            ) {
                MapPolyline(coordinates: coordinates)
                    .stroke(theme.forest, style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .round))

                if let start = coordinates.first {
                    Marker("Start", systemImage: "figure.hiking", coordinate: start)
                        .tint(theme.brandFill)
                }

                if let end = coordinates.last {
                    Marker("Finish", systemImage: "flag.checkered", coordinate: end)
                        .tint(theme.warning)
                }

                ForEach(route.waypoints.filter { $0.kind == .viewpoint || $0.kind == .stay }) { waypoint in
                    Annotation(waypoint.name, coordinate: coordinate(for: waypoint), anchor: .bottom) {
                        Image(systemName: waypoint.kind.symbol)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(theme.onBrandPrimary)
                            .padding(8)
                            .background(theme.brandFillBright, in: Circle())
                            .shadow(radius: 5, y: 3)
                    }
                }
            }
            .mapStyle(.standard(elevation: .realistic, emphasis: .muted, pointsOfInterest: .excludingAll))
            .overlay(alignment: .topTrailing) {
                Text("PREVIEW")
                    .font(.caption2.weight(.bold))
                    .tracking(1)
                    .foregroundStyle(theme.forest)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(.regularMaterial, in: Capsule())
                    .padding(14)
            }
        } else {
            ZStack {
                LinearGradient(
                    colors: [theme.sand.opacity(0.76), theme.mossSoft.opacity(0.58)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                ContourLines()
                    .stroke(theme.forest.opacity(0.1), lineWidth: 1)
                Label("Route preview unavailable", systemImage: "map")
                    .font(.headline)
                    .foregroundStyle(theme.forest)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .background(.regularMaterial, in: Capsule())
            }
        }
    }

    private func coordinate(for waypoint: Waypoint) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: waypoint.coordinate.latitude, longitude: waypoint.coordinate.longitude)
    }
}

struct ElevationProfileView: View {
    @Environment(TrailTheme.self) private var theme
    let route: TrailRoute

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                SectionHeader(title: "Elevation")
                Spacer()
                Text("+\(route.elevationLabel)")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(theme.forest)
            }

            ChartShape(values: route.elevationProfile)
                .fill(
                    LinearGradient(
                        colors: [theme.moss.opacity(0.58), theme.moss.opacity(0.05)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .overlay {
                    ChartLine(values: route.elevationProfile)
                        .stroke(theme.forestBright, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                }
                .frame(height: 120)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Elevation profile")
                .accessibilityValue(elevationAccessibilityValue)

            HStack {
                Text("Start")
                Spacer()
                Text(route.distanceLabel)
            }
            .font(.caption)
            .foregroundStyle(theme.secondaryText)
        }
        .trailCard()
    }

    private var elevationAccessibilityValue: String {
        guard
            let minimum = route.elevationProfile.min(),
            let maximum = route.elevationProfile.max()
        else {
            return "No elevation samples available"
        }
        return "\(Int(minimum.rounded()).formatted()) to \(Int(maximum.rounded()).formatted()) meters over \(route.distanceLabel); total climb \(route.elevationLabel)"
    }
}

private struct ChartShape: Shape {
    let values: [Double]

    func path(in rect: CGRect) -> Path {
        let line = ChartLine(values: values).path(in: rect)
        var path = line
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

private struct ChartLine: Shape {
    let values: [Double]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard values.count > 1, let minimum = values.min(), let maximum = values.max() else { return path }
        let range = max(maximum - minimum, 1)

        for (index, value) in values.enumerated() {
            let point = CGPoint(
                x: rect.minX + CGFloat(index) / CGFloat(values.count - 1) * rect.width,
                y: rect.maxY - CGFloat((value - minimum) / range) * rect.height
            )
            index == 0 ? path.move(to: point) : path.addLine(to: point)
        }
        return path
    }
}

struct WaypointTimelineView: View {
    @Environment(TrailTheme.self) private var theme
    let waypoints: [Waypoint]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(waypoints.enumerated()), id: \.element.id) { index, waypoint in
                HStack(alignment: .top, spacing: 15) {
                    VStack(spacing: 0) {
                        ZStack {
                            Circle()
                                .fill(waypoint.kind == .start || waypoint.kind == .finish ? theme.brandFill : theme.mossSoft)
                                .frame(width: 34, height: 34)
                            Image(systemName: waypoint.kind.symbol)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(
                                    waypoint.kind == .start || waypoint.kind == .finish
                                        ? theme.onBrandPrimary
                                        : theme.forest
                                )
                        }
                        if index < waypoints.count - 1 {
                            Rectangle()
                                .fill(theme.mossSoft)
                                .frame(width: 2, height: 46)
                        }
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(waypoint.name)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(waypoint.distanceKilometers.formatted(.number.precision(.fractionLength(waypoint.distanceKilometers.rounded() == waypoint.distanceKilometers ? 0 : 1))) + " km")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(theme.secondaryText)
                        }
                        Text(waypoint.detail)
                            .font(.caption)
                            .foregroundStyle(theme.secondaryText)
                    }
                    .padding(.top, 4)
                }
            }
        }
        .trailCard()
    }
}

struct SafetyNoteCard: View {
    @Environment(TrailTheme.self) private var theme
    let note: SafetyNote

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: note.severity == .caution ? "exclamationmark.triangle.fill" : "checkmark.shield.fill")
                .foregroundStyle(note.severity == .caution ? theme.warning : theme.moss)
            VStack(alignment: .leading, spacing: 5) {
                Text(note.title)
                    .font(.subheadline.weight(.bold))
                Text(note.message)
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            (note.severity == .caution ? theme.sand : theme.mossSoft).opacity(0.48),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
    }
}
