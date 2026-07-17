import MapKit
import SwiftUI

struct RouteCard: View {
    @Environment(TrailTheme.self) private var theme
    let route: TrailRoute
    let comparisonLabel: String?
    let qualityExplanations: [RouteQualityExplanation]

    init(
        route: TrailRoute,
        comparisonLabel: String? = nil,
        qualityExplanations: [RouteQualityExplanation] = []
    ) {
        self.route = route
        self.comparisonLabel = comparisonLabel
        self.qualityExplanations = qualityExplanations
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ZStack(alignment: .topLeading) {
                RouteThumbnailView(route: route)
                    .frame(height: 154)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

                if let badgeLabel {
                    Label(badgeLabel, systemImage: badgeSymbol)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(theme.forest)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 8)
                        .background(.white.opacity(0.88), in: Capsule())
                        .padding(12)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(route.location.uppercased())
                        .font(.caption.weight(.bold))
                        .tracking(0.8)
                        .foregroundStyle(theme.moss)
                    Spacer()
                    DifficultyBadge(difficulty: route.difficulty)
                }

                Text(route.title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(theme.graphite)

                Text(route.summary)
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                #if DEBUG
                if let intentDebugMetadata = route.intentDebugMetadata {
                    IntentSourceDebugBadge(metadata: intentDebugMetadata)
                }
                #endif
            }

            HStack(spacing: 0) {
                cardStat(route.distanceLabel, label: "Distance")
                Divider().frame(height: 32)
                cardStat(route.elevationLabel, label: "Climb")
                Divider().frame(height: 32)
                cardStat(route.durationLabel, label: "Time")
            }

            if let facts = route.verifiedCharacteristics?.cardFacts, !facts.isEmpty {
                VerifiedRouteFactRow(facts: facts)
            }

            if !qualityExplanations.isEmpty {
                RouteQualityChipRow(explanations: qualityExplanations)
            }

            HStack(spacing: 8) {
                ForEach(route.highlights.prefix(3)) { highlight in
                    Image(systemName: highlight.symbol)
                        .font(.caption)
                    Text(highlight.title)
                        .font(.caption.weight(.medium))
                        .lineLimit(1)
                    if highlight.id != route.highlights.prefix(3).last?.id {
                        Circle().frame(width: 3, height: 3)
                    }
                }
            }
            .foregroundStyle(theme.secondaryText)
        }
        .trailCard()
    }

    private func cardStat(_ value: String, label: String) -> some View {
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

    private var badgeLabel: String? {
        RouteAlternativeQuality.displayLabel(candidate: comparisonLabel, for: route)
    }

    private var badgeSymbol: String {
        route.routeType == .loop
            ? "arrow.trianglehead.2.clockwise.rotate.90"
            : "point.bottomleft.forward.to.point.topright.scurvepath"
    }
}

private struct VerifiedRouteFactRow: View {
    @Environment(TrailTheme.self) private var theme
    let facts: [RouteQualityExplanation]

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("Mapped route facts")
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.graphite)

            FlowLayout(spacing: 8, rowSpacing: 8) {
                ForEach(facts.prefix(2)) { fact in
                    Label(fact.title, systemImage: fact.symbol)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.forest)
                        .lineLimit(1)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 6)
                        .background(theme.sand.opacity(0.7), in: Capsule())
                }
            }
        }
        .padding(12)
        .background(theme.warmWhite.opacity(0.72), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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

struct RouteQualityChipRow: View {
    @Environment(TrailTheme.self) private var theme
    let explanations: [RouteQualityExplanation]

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("Why this route fits")
                .font(.caption.weight(.bold))
                .foregroundStyle(theme.graphite)

            FlowLayout(spacing: 8, rowSpacing: 8) {
                ForEach(explanations) { explanation in
                    Label(explanation.title, systemImage: explanation.symbol)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.forest)
                        .lineLimit(1)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 6)
                        .background(theme.mossSoft.opacity(0.52), in: Capsule())
                }
            }
        }
        .padding(12)
        .background(theme.warmWhite.opacity(0.72), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct RouteQualityExplanationList: View {
    @Environment(TrailTheme.self) private var theme
    let explanations: [RouteQualityExplanation]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Why this route fits")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(theme.graphite)

            ForEach(explanations) { explanation in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: explanation.symbol)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(theme.forest)
                        .frame(width: 24, height: 24)
                        .background(theme.mossSoft.opacity(0.62), in: Circle())

                    VStack(alignment: .leading, spacing: 2) {
                        Text(explanation.title)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(theme.graphite)
                        if let detail = explanation.detail {
                            Text(detail)
                                .font(.caption)
                                .foregroundStyle(theme.secondaryText)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(theme.warmWhite.opacity(0.72), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat
    var rowSpacing: CGFloat

    init(spacing: CGFloat, rowSpacing: CGFloat? = nil) {
        self.spacing = spacing
        self.rowSpacing = rowSpacing ?? spacing
    }

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let result = layout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let result = layout(proposal: proposal, subviews: subviews)
        for (index, point) in result.points.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y),
                proposal: .unspecified
            )
        }
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        let maxWidth = proposal.width ?? 300
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var points: [CGPoint] = []

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + rowSpacing
                rowHeight = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), points)
    }
}

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
        .accessibilityLabel("Route preview")
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
                .fill(theme.forest)
                .frame(width: 14, height: 14)
                .overlay {
                    Circle()
                        .stroke(.white.opacity(0.85), lineWidth: 2)
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
                .background(.white.opacity(0.62), in: Capsule())
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

    private var coordinates: [CLLocationCoordinate2D] {
        route.path.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
    }

    @ViewBuilder
    var body: some View {
        if coordinates.count >= 2 {
            Map(
                initialPosition: .region(DefaultMapService().getMapPreview(route: route)),
                interactionModes: [.pan, .zoom]
            ) {
                MapPolyline(coordinates: coordinates)
                    .stroke(theme.forest, style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .round))

                if let start = coordinates.first {
                    Marker("Start", systemImage: "figure.hiking", coordinate: start)
                        .tint(theme.forest)
                }

                if let end = coordinates.last {
                    Marker("Finish", systemImage: "flag.checkered", coordinate: end)
                        .tint(theme.warning)
                }

                ForEach(route.waypoints.filter { $0.kind == .viewpoint || $0.kind == .stay }) { waypoint in
                    Annotation(waypoint.name, coordinate: coordinate(for: waypoint), anchor: .bottom) {
                        Image(systemName: waypoint.kind.symbol)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(8)
                            .background(theme.forestBright, in: Circle())
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
                                .fill(waypoint.kind == .start || waypoint.kind == .finish ? theme.forest : theme.mossSoft)
                                .frame(width: 34, height: 34)
                            Image(systemName: waypoint.kind.symbol)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(waypoint.kind == .start || waypoint.kind == .finish ? .white : theme.forest)
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
