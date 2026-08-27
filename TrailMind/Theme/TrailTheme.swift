import SwiftUI
import UIKit

@Observable
final class TrailTheme {
    // Text, icon, and line colors adapt independently from filled brand
    // surfaces. Keeping those roles separate prevents a dark-mode accent from
    // becoming an illegible button or hero background.
    let forest = TrailTheme.adaptive(
        light: UIColor(red: 0.07, green: 0.22, blue: 0.16, alpha: 1),
        dark: UIColor(red: 0.57, green: 0.82, blue: 0.68, alpha: 1),
        increasedContrastLight: UIColor(red: 0.02, green: 0.12, blue: 0.08, alpha: 1),
        increasedContrastDark: UIColor(red: 0.72, green: 0.95, blue: 0.80, alpha: 1)
    )
    let forestBright = TrailTheme.adaptive(
        light: UIColor(red: 0.10, green: 0.34, blue: 0.23, alpha: 1),
        dark: UIColor(red: 0.63, green: 0.86, blue: 0.72, alpha: 1),
        increasedContrastLight: UIColor(red: 0.04, green: 0.20, blue: 0.12, alpha: 1),
        increasedContrastDark: UIColor(red: 0.74, green: 0.97, blue: 0.83, alpha: 1)
    )
    let moss = TrailTheme.adaptive(
        light: UIColor(red: 0.31, green: 0.43, blue: 0.22, alpha: 1),
        dark: UIColor(red: 0.70, green: 0.82, blue: 0.56, alpha: 1),
        increasedContrastLight: UIColor(red: 0.20, green: 0.31, blue: 0.12, alpha: 1),
        increasedContrastDark: UIColor(red: 0.82, green: 0.93, blue: 0.68, alpha: 1)
    )
    let mossSoft = TrailTheme.adaptive(
        light: UIColor(red: 0.82, green: 0.87, blue: 0.72, alpha: 1),
        dark: UIColor(red: 0.16, green: 0.23, blue: 0.17, alpha: 1),
        increasedContrastLight: UIColor(red: 0.78, green: 0.84, blue: 0.66, alpha: 1),
        increasedContrastDark: UIColor(red: 0.20, green: 0.29, blue: 0.21, alpha: 1)
    )
    let sand = TrailTheme.adaptive(
        light: UIColor(red: 0.93, green: 0.89, blue: 0.79, alpha: 1),
        dark: UIColor(red: 0.25, green: 0.22, blue: 0.16, alpha: 1),
        increasedContrastLight: UIColor(red: 0.88, green: 0.80, blue: 0.64, alpha: 1),
        increasedContrastDark: UIColor(red: 0.32, green: 0.27, blue: 0.18, alpha: 1)
    )
    let warmWhite = TrailTheme.adaptive(
        light: UIColor(red: 0.97, green: 0.96, blue: 0.93, alpha: 1),
        dark: UIColor(red: 0.055, green: 0.075, blue: 0.061, alpha: 1),
        increasedContrastLight: UIColor(red: 0.99, green: 0.98, blue: 0.96, alpha: 1),
        increasedContrastDark: UIColor(red: 0.035, green: 0.045, blue: 0.038, alpha: 1)
    )
    let surface = TrailTheme.adaptive(
        light: .white,
        dark: UIColor(red: 0.10, green: 0.13, blue: 0.11, alpha: 1),
        increasedContrastLight: .white,
        increasedContrastDark: UIColor(red: 0.08, green: 0.10, blue: 0.085, alpha: 1)
    )
    let graphite = TrailTheme.adaptive(
        light: UIColor(red: 0.13, green: 0.15, blue: 0.14, alpha: 1),
        dark: UIColor(red: 0.94, green: 0.96, blue: 0.94, alpha: 1),
        increasedContrastLight: UIColor(red: 0.04, green: 0.05, blue: 0.045, alpha: 1),
        increasedContrastDark: .white
    )
    let secondaryText = TrailTheme.adaptive(
        light: UIColor(red: 0.36, green: 0.39, blue: 0.37, alpha: 1),
        dark: UIColor(red: 0.74, green: 0.78, blue: 0.75, alpha: 1),
        increasedContrastLight: UIColor(red: 0.25, green: 0.28, blue: 0.26, alpha: 1),
        increasedContrastDark: UIColor(red: 0.84, green: 0.88, blue: 0.85, alpha: 1)
    )
    let warning = TrailTheme.adaptive(
        light: UIColor(red: 0.63, green: 0.29, blue: 0.08, alpha: 1),
        dark: UIColor(red: 0.96, green: 0.67, blue: 0.38, alpha: 1),
        increasedContrastLight: UIColor(red: 0.50, green: 0.18, blue: 0.02, alpha: 1),
        increasedContrastDark: UIColor(red: 1.00, green: 0.78, blue: 0.50, alpha: 1)
    )

    let brandFill = TrailTheme.adaptive(
        light: UIColor(red: 0.07, green: 0.22, blue: 0.16, alpha: 1),
        dark: UIColor(red: 0.035, green: 0.15, blue: 0.10, alpha: 1),
        increasedContrastLight: UIColor(red: 0.035, green: 0.15, blue: 0.10, alpha: 1),
        increasedContrastDark: UIColor(red: 0.015, green: 0.09, blue: 0.055, alpha: 1)
    )
    let brandFillBright = TrailTheme.adaptive(
        light: UIColor(red: 0.10, green: 0.34, blue: 0.23, alpha: 1),
        dark: UIColor(red: 0.07, green: 0.27, blue: 0.18, alpha: 1),
        increasedContrastLight: UIColor(red: 0.055, green: 0.24, blue: 0.15, alpha: 1),
        increasedContrastDark: UIColor(red: 0.035, green: 0.18, blue: 0.11, alpha: 1)
    )
    let onBrandPrimary = TrailTheme.adaptive(
        light: .white,
        dark: .white,
        increasedContrastLight: .white,
        increasedContrastDark: .white
    )
    let onBrandSecondary = TrailTheme.adaptive(
        light: UIColor(red: 0.82, green: 0.88, blue: 0.84, alpha: 1),
        dark: UIColor(red: 0.82, green: 0.88, blue: 0.84, alpha: 1),
        increasedContrastLight: UIColor(red: 0.92, green: 0.96, blue: 0.93, alpha: 1),
        increasedContrastDark: UIColor(red: 0.92, green: 0.96, blue: 0.93, alpha: 1)
    )
    let onBrandAccent = TrailTheme.adaptive(
        light: UIColor(red: 0.93, green: 0.89, blue: 0.79, alpha: 1),
        dark: UIColor(red: 0.93, green: 0.89, blue: 0.79, alpha: 1),
        increasedContrastLight: UIColor(red: 0.98, green: 0.93, blue: 0.82, alpha: 1),
        increasedContrastDark: UIColor(red: 0.98, green: 0.93, blue: 0.82, alpha: 1)
    )
    let onBrandProgress = TrailTheme.adaptive(
        light: UIColor(red: 0.74, green: 0.86, blue: 0.63, alpha: 1),
        dark: UIColor(red: 0.74, green: 0.86, blue: 0.63, alpha: 1),
        increasedContrastLight: UIColor(red: 0.83, green: 0.96, blue: 0.72, alpha: 1),
        increasedContrastDark: UIColor(red: 0.83, green: 0.96, blue: 0.72, alpha: 1)
    )
    let onBrandAccentForeground = TrailTheme.adaptive(
        light: UIColor(red: 0.035, green: 0.15, blue: 0.10, alpha: 1),
        dark: UIColor(red: 0.035, green: 0.15, blue: 0.10, alpha: 1),
        increasedContrastLight: UIColor(red: 0.01, green: 0.08, blue: 0.04, alpha: 1),
        increasedContrastDark: UIColor(red: 0.01, green: 0.08, blue: 0.04, alpha: 1)
    )
    let onBrandProgressGlyph = TrailTheme.adaptive(
        light: UIColor(red: 0.035, green: 0.15, blue: 0.10, alpha: 1),
        dark: UIColor(red: 0.035, green: 0.15, blue: 0.10, alpha: 1),
        increasedContrastLight: UIColor(red: 0.01, green: 0.08, blue: 0.04, alpha: 1),
        increasedContrastDark: UIColor(red: 0.01, green: 0.08, blue: 0.04, alpha: 1)
    )
    let separator = TrailTheme.adaptive(
        light: UIColor(red: 0.07, green: 0.22, blue: 0.16, alpha: 0.10),
        dark: UIColor(white: 1, alpha: 0.14),
        increasedContrastLight: UIColor(red: 0.07, green: 0.22, blue: 0.16, alpha: 0.20),
        increasedContrastDark: UIColor(white: 1, alpha: 0.24)
    )
    let cardShadow = TrailTheme.adaptive(
        light: UIColor(red: 0.07, green: 0.22, blue: 0.16, alpha: 0.07),
        dark: UIColor(white: 0, alpha: 0.32),
        increasedContrastLight: UIColor(red: 0.07, green: 0.22, blue: 0.16, alpha: 0.12),
        increasedContrastDark: UIColor(white: 0, alpha: 0.42)
    )

    private nonisolated static func adaptive(
        light: UIColor,
        dark: UIColor,
        increasedContrastLight: UIColor,
        increasedContrastDark: UIColor
    ) -> Color {
        Color(
            uiColor: UIColor { traits in
                switch (traits.userInterfaceStyle, traits.accessibilityContrast) {
                case (.dark, .high): increasedContrastDark
                case (.dark, _): dark
                case (_, .high): increasedContrastLight
                default: light
                }
            }
        )
    }
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
            .shadow(color: theme.cardShadow, radius: 20, y: 8)
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
