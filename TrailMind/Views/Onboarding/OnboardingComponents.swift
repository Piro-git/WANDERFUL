import SwiftUI

struct OnboardingPageContainer<Content: View>: View {
    @Environment(TrailTheme.self) private var theme
    let page: OnboardingView.Page
    let title: String
    private let bodyText: String
    private let content: Content
    @AccessibilityFocusState private var isHeadingFocused: Bool

    init(
        page: OnboardingView.Page,
        title: String,
        body: String,
        @ViewBuilder content: () -> Content
    ) {
        self.page = page
        self.title = title
        bodyText = body
        self.content = content()
    }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Spacer(minLength: 12)

                    VStack(alignment: .leading, spacing: 10) {
                        Text(page.eyebrow)
                            .font(.caption.weight(.bold))
                            .tracking(1.5)
                            .foregroundStyle(theme.onBrandSecondary)

                        Text(title)
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                            .tracking(-0.7)
                            .foregroundStyle(theme.onBrandPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityFocused($isHeadingFocused)

                        Text(bodyText)
                            .font(.body)
                            .foregroundStyle(theme.onBrandSecondary)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    content

                    Spacer(minLength: 18)
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .topLeading)
                .padding(.horizontal, 22)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollIndicators(.hidden)
        }
        .accessibilityIdentifier("onboarding.page.\(page.step.rawValue)")
        .task(id: page.step) {
            await Task.yield()
            isHeadingFocused = true
        }
    }
}

struct OnboardingProgressRoute: View {
    @Environment(TrailTheme.self) private var theme
    let stepCount: Int
    let currentIndex: Int
    let progress: Double

    var body: some View {
        GeometryReader { proxy in
            let normalized = max(
                0,
                min(1, (progress * Double(stepCount) - 1) / Double(max(stepCount - 1, 1)))
            )

            ZStack {
                Capsule()
                    .fill(theme.onBrandSecondary.opacity(0.55))
                    .frame(height: 4)

                HStack(spacing: 0) {
                    Capsule()
                        .fill(theme.onBrandProgress)
                        .frame(width: proxy.size.width * normalized, height: 4)
                    Spacer(minLength: 0)
                }

                HStack(spacing: 0) {
                    ForEach(0..<stepCount, id: \.self) { index in
                        ZStack {
                            Circle()
                                .fill(
                                    index <= currentIndex
                                        ? theme.onBrandProgress
                                        : theme.onBrandSecondary.opacity(0.55)
                                )
                                .frame(
                                    width: index == currentIndex ? 18 : 14,
                                    height: index == currentIndex ? 18 : 14
                                )
                                .overlay {
                                    Circle()
                                        .stroke(
                                            index == currentIndex
                                                ? theme.onBrandPrimary
                                                : theme.onBrandSecondary.opacity(0.55),
                                            lineWidth: index == currentIndex ? 3 : 2
                                        )
                                }

                            if index < currentIndex {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 7, weight: .black))
                                    .foregroundStyle(theme.onBrandProgressGlyph)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .frame(maxHeight: .infinity)
        }
    }
}

struct OnboardingJourneyIllustration: View {
    let assetName: String
    let accessibilityLabel: String
    var height: CGFloat = 112

    var body: some View {
        GeometryReader { proxy in
            Image(assetName)
                .resizable()
                .scaledToFill()
                .frame(width: proxy.size.width, height: height)
                .clipped()
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(.isImage)
    }
}

struct OnboardingWelcomePage: View {
    @Environment(TrailTheme.self) private var theme
    let page: OnboardingView.Page
    @AccessibilityFocusState private var isHeadingFocused: Bool

    var body: some View {
        GeometryReader { proxy in
            let heroHeight = min(280, max(190, proxy.size.height * 0.46))

            ScrollView {
                VStack(spacing: 18) {
                    Spacer(minLength: 4)

                    OnboardingJourneyIllustration(
                        assetName: page.step.illustrationAssetName,
                        accessibilityLabel: page.step.illustrationAccessibilityLabel,
                        height: heroHeight
                    )

                    VStack(spacing: 10) {
                        Text(page.eyebrow)
                            .font(.caption.weight(.bold))
                            .tracking(1.5)
                            .foregroundStyle(theme.onBrandSecondary)

                        Text(page.title)
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                            .tracking(-0.7)
                            .foregroundStyle(theme.onBrandPrimary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityFocused($isHeadingFocused)

                        Text(page.body)
                            .font(.body)
                            .foregroundStyle(theme.onBrandSecondary)
                            .multilineTextAlignment(.center)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: 340)

                    Spacer(minLength: 12)
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                .padding(.horizontal, 22)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollIndicators(.hidden)
        }
        .accessibilityIdentifier("onboarding.page.\(page.step.rawValue)")
        .task(id: page.step) {
            await Task.yield()
            isHeadingFocused = true
        }
    }
}

struct OnboardingChoicePanel<Content: View>: View {
    @Environment(TrailTheme.self) private var theme
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 2) {
            content
        }
        .padding(8)
        .background(theme.warmWhite, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: .black.opacity(0.10), radius: 22, y: 10)
    }
}

struct OnboardingChoiceRow: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    let subtitle: String
    let symbol: String
    let isSelected: Bool
    let accessibilityID: String
    var accessibilityHint: String = ""
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.body.weight(.semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(theme.forest)
                    .frame(width: 42, height: 42)
                    .background(
                        isSelected ? theme.warmWhite.opacity(0.88) : theme.mossSoft.opacity(0.32),
                        in: Circle()
                    )

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(theme.graphite)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(theme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(isSelected ? theme.forestBright : theme.secondaryText.opacity(0.38))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .background(
                isSelected ? theme.mossSoft.opacity(0.62) : Color.clear,
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
            )
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title). \(subtitle)")
        .accessibilityValue(isSelected ? "Selected" : "Not selected")
        .accessibilityHint(accessibilityHint)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(accessibilityID)
    }
}

struct OnboardingExperienceCard: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    let symbol: String
    let isSelected: Bool
    let isEnabled: Bool
    let accessibilityID: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: symbol)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(theme.forest)
                    Spacer(minLength: 6)
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "plus.circle")
                        .font(.headline)
                        .foregroundStyle(isSelected ? theme.forestBright : theme.secondaryText.opacity(0.42))
                }

                Text(title)
                    .font(.headline)
                    .foregroundStyle(theme.graphite)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
            .background(
                isSelected ? theme.mossSoft.opacity(0.76) : theme.warmWhite,
                in: RoundedRectangle(cornerRadius: 22, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(isSelected ? theme.mossSoft : .white.opacity(0.16), lineWidth: isSelected ? 2 : 1)
            }
            .opacity(isEnabled ? 1 : 0.42)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(title)
        .accessibilityValue(isSelected ? "Requested" : "Not requested")
        .accessibilityHint("Requested preference; Wanderful confirms it only when route data can.")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(accessibilityID)
    }
}

struct OnboardingUnitPicker: View {
    @Environment(TrailTheme.self) private var theme
    @Binding var selection: OnboardingView.Draft.ComfortUnit
    let onChange: (OnboardingView.Draft.ComfortUnit) -> Void

    var body: some View {
        HStack(spacing: 8) {
            ForEach(OnboardingView.Draft.ComfortUnit.allCases) { unit in
                Button {
                    selection = unit
                    onChange(unit)
                } label: {
                    Text(unit.title)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(
                            selection == unit
                                ? theme.forest
                                : theme.onBrandSecondary
                        )
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(
                            selection == unit ? theme.warmWhite : Color.clear,
                            in: Capsule()
                        )
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == unit ? .isSelected : [])
                .accessibilityIdentifier("onboarding.comfort-unit.\(unit.rawValue)")
            }
        }
        .padding(4)
        .background(.black.opacity(0.14), in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Comfort measured by")
    }
}

struct OnboardingUnknownNote: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        Label {
            Text("Not knowing is an answer. You can change this later.")
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "leaf")
                .foregroundStyle(theme.onBrandAccent)
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(theme.onBrandSecondary)
        .padding(.horizontal, 8)
    }
}

struct OnboardingSoFarCard: View {
    @Environment(TrailTheme.self) private var theme
    let summary: String

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: "sparkles")
                .font(.headline.weight(.semibold))
                .foregroundStyle(theme.onBrandPrimary)
                .frame(width: 44, height: 44)
                .background(
                    theme.onBrandAccent.opacity(0.18),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
                .accessibilityHidden(true)

            Text(summary)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(theme.onBrandSecondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.black.opacity(0.16), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityLabel(summary)
        .accessibilityIdentifier("onboarding.so-far")
    }
}

struct OnboardingTrustCard: View {
    @Environment(TrailTheme.self) private var theme

    private let items = [
        ("map.fill", "AI-assisted route. Review the mapped route before starting."),
        ("cloud.sun.fill", "Check weather, local rules, trail conditions and water availability."),
        ("exclamationmark.triangle.fill", "Outdoor conditions can change quickly.")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ZStack {
                Circle()
                    .fill(theme.mossSoft.opacity(0.55))
                    .frame(width: 92, height: 92)
                Image(systemName: "shield.lefthalf.filled.badge.checkmark")
                    .font(.system(size: 40, weight: .semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(theme.forest)
            }
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)

            ForEach(items, id: \.1) { item in
                HStack(alignment: .top, spacing: 13) {
                    Image(systemName: item.0)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(theme.forestBright)
                        .frame(width: 24)
                        .accessibilityHidden(true)
                    Text(item.1)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(theme.graphite)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }

            Divider().overlay(theme.forest.opacity(0.10))

            Text("Requested features are preferences, not verified guarantees.")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .background(theme.warmWhite, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: .black.opacity(0.10), radius: 22, y: 10)
    }
}

struct OnboardingProfileRecap: View {
    @Environment(TrailTheme.self) private var theme
    let draft: OnboardingView.Draft
    let onEdit: (OnboardingView.Step) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 13) {
                Image(systemName: draft.activity?.symbol ?? "figure.hiking")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(theme.forest)
                    .frame(width: 54, height: 54)
                    .background(theme.mossSoft.opacity(0.70), in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text("YOUR TRAIL PROFILE")
                        .font(.caption2.weight(.bold))
                        .tracking(1.1)
                        .foregroundStyle(theme.secondaryText)
                    Text(profileTitle)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(theme.graphite)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(spacing: 0) {
                OnboardingProfileRow(
                    title: "Usual activity",
                    value: draft.activityLabel,
                    symbol: "figure.hiking",
                    action: { onEdit(.activity) }
                )
                Divider().padding(.leading, 48)
                OnboardingProfileRow(
                    title: "Comfortable outing",
                    value: draft.comfortLabel,
                    symbol: "ruler",
                    action: { onEdit(.distance) }
                )
                Divider().padding(.leading, 48)
                OnboardingProfileRow(
                    title: "Usual route shape",
                    value: draft.routeShapeLabel,
                    symbol: "arrow.triangle.2.circlepath",
                    action: { onEdit(.routeShape) }
                )
                Divider().padding(.leading, 48)
                OnboardingProfileRow(
                    title: "Lean away from",
                    value: draft.softAvoidancesLabel,
                    symbol: "arrow.down.right",
                    action: { onEdit(.effort) }
                )
                Divider().padding(.leading, 48)
                OnboardingProfileRow(
                    title: "Requested experiences",
                    value: draft.requestedExperiencesLabel,
                    symbol: "sparkles",
                    action: { onEdit(.interests) }
                )
            }
            .background(theme.mossSoft.opacity(0.22), in: RoundedRectangle(cornerRadius: 22, style: .continuous))

            Label("Saves locally first. No account needed.", systemImage: "iphone.gen3")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(theme.forest)

            Text("Your next route request always wins. Wanderful uses these defaults only when your request leaves a gap.")
                .font(.footnote)
                .foregroundStyle(theme.secondaryText)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .background(theme.warmWhite, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 24, y: 12)
    }

    private var profileTitle: String {
        if let activity = draft.activity {
            return "A flexible \(activity.rawValue.lowercased()) starting point"
        }
        return "Open by default, ready for your request"
    }
}

private struct OnboardingProfileRow: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    let value: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.forestBright)
                    .frame(width: 36, height: 36)
                    .background(theme.warmWhite.opacity(0.78), in: Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.secondaryText)
                    Text(value)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(theme.graphite)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(theme.secondaryText.opacity(0.58))
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Edit \(title). Current value: \(value)")
    }
}

struct TrailMindMark: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                .font(.headline)
            Text("Wanderful")
                .font(.headline.weight(.bold))
        }
        .foregroundStyle(theme.onBrandPrimary)
        .accessibilityElement(children: .combine)
    }
}
