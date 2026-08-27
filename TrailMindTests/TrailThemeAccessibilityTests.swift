import SwiftUI
import UIKit
import XCTest
@testable import TrailMind

@MainActor
final class TrailThemeAccessibilityTests: XCTestCase {
    func testCoreTextRolesMeetNormalTextContrastInEverySupportedAppearance() throws {
        let theme = TrailTheme()
        let roles: [(String, Color)] = [
            ("primary", theme.graphite),
            ("secondary", theme.secondaryText),
            ("accent", theme.forest),
            ("moss", theme.moss),
            ("warning", theme.warning)
        ]

        for appearance in appearanceTraits {
            for background in [theme.warmWhite, theme.surface] {
                for (name, foreground) in roles {
                    XCTAssertGreaterThanOrEqual(
                        try contrastRatio(
                            foreground: foreground,
                            background: background,
                            traits: appearance.traits
                        ),
                        4.5,
                        "\(name) does not meet normal-text contrast in \(appearance.name)."
                    )
                }
            }
        }
    }

    func testActualOnBrandTextAndIndicatorPairsMeetContrastInEveryAppearance() throws {
        let theme = TrailTheme()
        let textRoles = [
            ("primary", theme.onBrandPrimary),
            ("secondary", theme.onBrandSecondary)
        ]
        let indicatorRoles = [
            ("accent", theme.onBrandAccent),
            ("progress", theme.onBrandProgress),
            ("progress track", theme.onBrandSecondary.opacity(0.55))
        ]

        for appearance in appearanceTraits {
            for background in [theme.brandFill, theme.brandFillBright] {
                for (name, foreground) in textRoles {
                    XCTAssertGreaterThanOrEqual(
                        try contrastRatio(
                            foreground: foreground,
                            background: background,
                            traits: appearance.traits
                        ),
                        4.5,
                        "On-brand \(name) text regressed in \(appearance.name)."
                    )
                }
                for (name, foreground) in indicatorRoles {
                    XCTAssertGreaterThanOrEqual(
                        try contrastRatio(
                            foreground: foreground,
                            background: background,
                            traits: appearance.traits
                        ),
                        3,
                        "On-brand \(name) indicator regressed in \(appearance.name)."
                    )
                }
            }

            XCTAssertGreaterThanOrEqual(
                try contrastRatio(
                    foreground: theme.onBrandAccentForeground,
                    background: theme.onBrandAccent,
                    traits: appearance.traits
                ),
                4.5,
                "Accent control content regressed in \(appearance.name)."
            )
            XCTAssertGreaterThanOrEqual(
                try contrastRatio(
                    foreground: theme.onBrandProgressGlyph,
                    background: theme.onBrandProgress,
                    traits: appearance.traits
                ),
                4.5,
                "Completed-progress glyph regressed in \(appearance.name)."
            )
        }
    }

    func testTextOnActualTintedCardSurfacesMeetsNormalTextContrast() throws {
        let theme = TrailTheme()
        let pairs: [(String, Color, Color, Color)] = [
            (
                "secondary text on selected moss card",
                theme.secondaryText,
                theme.mossSoft.opacity(0.76),
                theme.warmWhite
            ),
            (
                "secondary text on sand notice",
                theme.secondaryText,
                theme.sand.opacity(0.68),
                theme.warmWhite
            )
        ]

        for appearance in appearanceTraits {
            for (name, foreground, background, baseBackground) in pairs {
                XCTAssertGreaterThanOrEqual(
                    try contrastRatio(
                        foreground: foreground,
                        background: background,
                        baseBackground: baseBackground,
                        traits: appearance.traits
                    ),
                    4.5,
                    "\(name) regressed in \(appearance.name)."
                )
            }
        }
    }

    func testPlanningProgressRingMeetsNonTextContrast() throws {
        let theme = TrailTheme()
        let ringRoles = [
            ("track", theme.moss.opacity(0.72)),
            ("moss progress", theme.moss),
            ("forest progress", theme.forestBright)
        ]

        for appearance in appearanceTraits {
            for (name, foreground) in ringRoles {
                XCTAssertGreaterThanOrEqual(
                    try contrastRatio(
                        foreground: foreground,
                        background: theme.warmWhite,
                        traits: appearance.traits
                    ),
                    3,
                    "Planning \(name) regressed in \(appearance.name)."
                )
            }
        }
    }

    func testRouteCardUsesExpandedLayoutOnlyForAccessibilitySizes() {
        XCTAssertFalse(RouteCardLayoutPolicy.usesExpandedLayout(for: .large))
        XCTAssertFalse(RouteCardLayoutPolicy.usesExpandedLayout(for: .xxxLarge))
        XCTAssertTrue(RouteCardLayoutPolicy.usesExpandedLayout(for: .accessibility1))
        XCTAssertTrue(RouteCardLayoutPolicy.usesExpandedLayout(for: .accessibility5))
    }

    func testSuggestionsHeaderRemovesLineLimitAtAccessibilitySizes() {
        XCTAssertEqual(
            RouteSuggestionsHeaderLayoutPolicy.lineLimit(for: .large),
            3
        )
        XCTAssertEqual(
            RouteSuggestionsHeaderLayoutPolicy.lineLimit(for: .xxxLarge),
            3
        )
        XCTAssertNil(
            RouteSuggestionsHeaderLayoutPolicy.lineLimit(for: .accessibility1)
        )
        XCTAssertNil(
            RouteSuggestionsHeaderLayoutPolicy.lineLimit(for: .accessibility5)
        )
    }

    private func contrastRatio(
        foreground: Color,
        background: Color,
        baseBackground: Color? = nil,
        traits: UITraitCollection
    ) throws -> Double {
        let resolvedForeground = try components(
            UIColor(foreground).resolvedColor(with: traits)
        )
        let resolvedBackground = try components(
            UIColor(background).resolvedColor(with: traits)
        )
        let opaqueBackground: RGBA
        if let baseBackground {
            let resolvedBase = try components(
                UIColor(baseBackground).resolvedColor(with: traits)
            )
            XCTAssertEqual(resolvedBase.alpha, 1, accuracy: 0.001)
            opaqueBackground = composite(resolvedBackground, over: resolvedBase)
        } else {
            XCTAssertEqual(resolvedBackground.alpha, 1, accuracy: 0.001)
            opaqueBackground = resolvedBackground
        }
        let opaqueForeground = composite(resolvedForeground, over: opaqueBackground)
        let foregroundLuminance = luminance(opaqueForeground)
        let backgroundLuminance = luminance(opaqueBackground)
        return (max(foregroundLuminance, backgroundLuminance) + 0.05)
            / (min(foregroundLuminance, backgroundLuminance) + 0.05)
    }

    private var appearanceTraits: [(name: String, traits: UITraitCollection)] {
        [
            ("Light", traits(style: .light, contrast: .normal)),
            ("Dark", traits(style: .dark, contrast: .normal)),
            ("Light Increased Contrast", traits(style: .light, contrast: .high)),
            ("Dark Increased Contrast", traits(style: .dark, contrast: .high))
        ]
    }

    private func traits(
        style: UIUserInterfaceStyle,
        contrast: UIAccessibilityContrast
    ) -> UITraitCollection {
        UITraitCollection(mutations: { traits in
            traits.userInterfaceStyle = style
            traits.accessibilityContrast = contrast
        })
    }

    private struct RGBA {
        let red: CGFloat
        let green: CGFloat
        let blue: CGFloat
        let alpha: CGFloat
    }

    private func components(_ color: UIColor) throws -> RGBA {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        XCTAssertTrue(
            color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        )
        return RGBA(red: red, green: green, blue: blue, alpha: alpha)
    }

    private func composite(_ foreground: RGBA, over background: RGBA) -> RGBA {
        RGBA(
            red: foreground.red * foreground.alpha + background.red * (1 - foreground.alpha),
            green: foreground.green * foreground.alpha + background.green * (1 - foreground.alpha),
            blue: foreground.blue * foreground.alpha + background.blue * (1 - foreground.alpha),
            alpha: 1
        )
    }

    private func luminance(_ color: RGBA) -> Double {
        let components = [color.red, color.green, color.blue].map { component in
            component <= 0.04045
                ? component / 12.92
                : pow((component + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * components[0]
            + 0.7152 * components[1]
            + 0.0722 * components[2]
    }
}
