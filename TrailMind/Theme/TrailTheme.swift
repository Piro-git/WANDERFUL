import SwiftUI

@Observable
final class TrailTheme {
    let forest = Color(red: 0.07, green: 0.22, blue: 0.16)
    let forestBright = Color(red: 0.10, green: 0.34, blue: 0.23)
    let moss = Color(red: 0.42, green: 0.55, blue: 0.32)
    let mossSoft = Color(red: 0.82, green: 0.87, blue: 0.72)
    let sand = Color(red: 0.93, green: 0.89, blue: 0.79)
    let warmWhite = Color(red: 0.97, green: 0.96, blue: 0.93)
    let surface = Color.white
    let graphite = Color(red: 0.13, green: 0.15, blue: 0.14)
    let secondaryText = Color(red: 0.36, green: 0.39, blue: 0.37)
    let warning = Color(red: 0.74, green: 0.40, blue: 0.13)
}

enum TrailSpacing {
    static let page: CGFloat = 20
    static let section: CGFloat = 28
    static let card: CGFloat = 18
    static let radius: CGFloat = 26
    static let compactRadius: CGFloat = 18
}

extension Font {
    static let trailHero = Font.system(.largeTitle, design: .rounded, weight: .bold)
    static let trailTitle = Font.system(.title, design: .rounded, weight: .bold)
    static let trailSection = Font.system(.title3, design: .rounded, weight: .bold)
}

struct TrailCardModifier: ViewModifier {
    @Environment(TrailTheme.self) private var theme

    func body(content: Content) -> some View {
        content
            .padding(TrailSpacing.card)
            .background(theme.surface, in: RoundedRectangle(cornerRadius: TrailSpacing.radius, style: .continuous))
            .shadow(color: theme.forest.opacity(0.07), radius: 20, y: 8)
    }
}

extension View {
    func trailCard() -> some View {
        modifier(TrailCardModifier())
    }

    @ViewBuilder
    func trailGlass(cornerRadius: CGFloat = 24, interactive: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            if interactive {
                self.glassEffect(.regular.interactive(), in: .rect(cornerRadius: cornerRadius))
            } else {
                self.glassEffect(.regular, in: .rect(cornerRadius: cornerRadius))
            }
        } else {
            self.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
    }
}

struct ContourLines: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        for index in 0..<7 {
            let y = rect.minY + CGFloat(index) * rect.height / 6
            path.move(to: CGPoint(x: rect.minX - 30, y: y))
            for step in 0...24 {
                let x = rect.minX + CGFloat(step) * (rect.width + 60) / 24 - 30
                let wave = sin(CGFloat(step) * 0.58 + CGFloat(index) * 0.85) * (10 + CGFloat(index % 3) * 4)
                path.addLine(to: CGPoint(x: x, y: y + wave))
            }
        }
        return path
    }
}

struct TrailBackground: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        theme.warmWhite
            .overlay(alignment: .topTrailing) {
                Circle()
                    .fill(theme.mossSoft.opacity(0.34))
                    .frame(width: 320, height: 320)
                    .blur(radius: 80)
                    .offset(x: 120, y: -110)
            }
            .ignoresSafeArea()
    }
}
