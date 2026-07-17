import SwiftUI

struct OnboardingView: View {
    struct Page {
        let eyebrow: String
        let title: String
        let body: String
        let symbol: String
    }

    @Environment(TrailTheme.self) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var isComplete: Bool
    @State private var selectedPage = 0

    static let pages = [
        Page(
            eyebrow: "PLAN NATURALLY",
            title: "Say what kind of day you need.",
            body: "Describe a same-day hike, trail run or bike route with a start, destination, distance or time.",
            symbol: "waveform"
        ),
        Page(
            eyebrow: "REAL ROUTE OPTIONS",
            title: "Compare mapped routes.",
            body: "TrailMind calculates route geometry and shows measured distance, duration and elevation for each option.",
            symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
        ),
        Page(
            eyebrow: "REVIEW BEFORE YOU GO",
            title: "Plan with current local information.",
            body: "TrailMind is a planning aid, not live navigation. Check weather, trail conditions, local rules and water availability.",
            symbol: "shield.lefthalf.filled.badge.checkmark"
        )
    ]

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.forest, Color(red: 0.05, green: 0.29, blue: 0.21)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ContourLines()
                .stroke(.white.opacity(0.08), lineWidth: 1)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    TrailMindMark()
                    Spacer()
                    Text("\(selectedPage + 1) / \(Self.pages.count)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.66))
                }
                .padding(.horizontal, 24)
                .padding(.top, 12)

                TabView(selection: $selectedPage) {
                    ForEach(Self.pages.indices, id: \.self) { index in
                        OnboardingPageView(page: Self.pages[index])
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                Button {
                    if selectedPage < Self.pages.count - 1 {
                        withAnimation(reduceMotion ? nil : .snappy) { selectedPage += 1 }
                    } else {
                        isComplete = true
                    }
                } label: {
                    HStack {
                        Text(selectedPage == Self.pages.count - 1 ? "Start planning" : "Continue")
                        Spacer()
                        Image(systemName: "arrow.right")
                    }
                    .font(.headline)
                    .foregroundStyle(theme.forest)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .frame(minHeight: 58)
                    .background(theme.warmWhite, in: Capsule())
                }
                .buttonStyle(.plain)
                .padding(24)
                .accessibilityIdentifier("onboarding.continue")
            }
        }
    }
}

private struct OnboardingPageView: View {
    @Environment(TrailTheme.self) private var theme
    let page: OnboardingView.Page

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Spacer(minLength: 20)

                    ZStack {
                        Circle()
                            .fill(theme.moss.opacity(0.24))
                            .frame(width: 180, height: 180)
                        Circle()
                            .stroke(.white.opacity(0.16), lineWidth: 1)
                            .frame(width: 142, height: 142)
                        Image(systemName: page.symbol)
                            .font(.system(size: 58, weight: .medium))
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(theme.sand)
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityHidden(true)

                    Spacer(minLength: 20)

                    Text(page.eyebrow)
                        .font(.caption.weight(.bold))
                        .tracking(1.5)
                        .foregroundStyle(theme.mossSoft)

                    Text(page.title)
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(page.body)
                        .font(.title3)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineSpacing(5)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.bottom, 14)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollIndicators(.hidden)
        }
    }
}

struct TrailMindMark: View {
    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                .font(.headline)
            Text("TrailMind")
                .font(.headline.weight(.bold))
        }
        .foregroundStyle(.white)
    }
}
