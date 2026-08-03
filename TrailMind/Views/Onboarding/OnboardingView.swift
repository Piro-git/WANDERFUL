import SwiftUI

struct OnboardingView: View {
    enum Step: String, CaseIterable, Identifiable {
        case welcome
        case activity
        case distance
        case effort
        case interests
        case trust
        case ready

        var id: Self { self }
    }

    struct Page {
        let step: Step
        let eyebrow: String
        let title: String
        let body: String
    }

    struct Draft: Equatable {
        var activity: ActivityType?
        var distanceKilometers: Double?
        var effort: RouteDifficulty?
        var interests: Set<String> = []
    }

    @Environment(TrailTheme.self) private var theme
    @Environment(AppModel.self) private var appModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var isComplete: Bool
    @State private var selectedPage = 0
    @State private var direction = 1
    @State private var draft = Draft()

    static let pages = [
        Page(
            step: .welcome,
            eyebrow: "YOUR ROUTE COPILOT",
            title: "Your next adventure, built around you.",
            body: "Tell Wanderful what kind of route you want. It turns your request into mapped route options you can compare."
        ),
        Page(
            step: .activity,
            eyebrow: "MAKE IT YOURS",
            title: "How do you like to move?",
            body: "We’ll shape your starting ideas around this preference."
        ),
        Page(
            step: .distance,
            eyebrow: "YOUR RHYTHM",
            title: "What feels like a good day out?",
            body: "Choose a starting distance. You can change it for every plan."
        ),
        Page(
            step: .effort,
            eyebrow: "YOUR PACE",
            title: "How much challenge do you enjoy?",
            body: "This is a planning preference—not a guarantee about trail conditions."
        ),
        Page(
            step: .interests,
            eyebrow: "YOUR PERFECT DAY",
            title: "What should your request prioritize?",
            body: "Choose one to three. These stay requested preferences until route data verifies them."
        ),
        Page(
            step: .trust,
            eyebrow: "PLAN WITH CONFIDENCE",
            title: "Real routes. Clear limits.",
            body: "Wanderful calculates geometry and measured stats, but it is a planning aid—not live navigation."
        ),
        Page(
            step: .ready,
            eyebrow: "READY FOR THE TRAIL",
            title: "Your route planner is ready.",
            body: "Wanderful will use these preferences to make your first request easier to start."
        )
    ]

    private static let interestOptions = [
        OnboardingInterest(title: "Views", symbol: "mountain.2.fill"),
        OnboardingInterest(title: "Forest", symbol: "tree.fill"),
        OnboardingInterest(title: "Quiet paths", symbol: "leaf.fill"),
        OnboardingInterest(title: "Waterfalls", symbol: "water.waves")
    ]

    private var currentPage: Page { Self.pages[selectedPage] }
    private var progress: Double { Double(selectedPage + 1) / Double(Self.pages.count) }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.forest, Color(red: 0.04, green: 0.30, blue: 0.21)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ContourLines()
                .stroke(.white.opacity(0.075), lineWidth: 1)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                header

                ZStack {
                    OnboardingPageContainer(page: currentPage) {
                        stepContent
                    }
                    .id(currentPage.step)
                    .transition(pageTransition)
                }
                .animation(reduceMotion ? nil : .snappy, value: selectedPage)

                primaryAction
            }
        }
    }

    private var header: some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                if selectedPage > 0 {
                    Button(action: moveBack) {
                        Image(systemName: "chevron.left")
                            .font(.headline.weight(.bold))
                            .frame(width: 42, height: 42)
                            .background(.white.opacity(0.10), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Previous step")
                    .accessibilityIdentifier("onboarding.back")
                } else {
                    TrailMindMark()
                }

                Spacer()

                Text("\(selectedPage + 1) of \(Self.pages.count)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white.opacity(0.68))
                    .contentTransition(.numericText())
            }
            .foregroundStyle(.white)

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.12))
                    Capsule()
                        .fill(theme.mossSoft)
                        .frame(width: proxy.size.width * progress)
                }
            }
            .frame(height: 5)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Onboarding progress")
            .accessibilityValue("Step \(selectedPage + 1) of \(Self.pages.count)")
        }
        .padding(.horizontal, 22)
        .padding(.top, 10)
    }

    @ViewBuilder
    private var stepContent: some View {
        switch currentPage.step {
        case .welcome:
            OnboardingRoutePreview()

        case .activity:
            VStack(spacing: 12) {
                ForEach(ActivityType.allCases) { activity in
                    OnboardingChoiceCard(
                        title: activity.rawValue,
                        subtitle: activitySubtitle(activity),
                        symbol: activity.symbol,
                        isSelected: draft.activity == activity,
                        accessibilityID: "onboarding.activity.\(activityID(activity))"
                    ) {
                        if draft.activity != activity {
                            draft.distanceKilometers = nil
                        }
                        draft.activity = activity
                    }
                }
            }

        case .distance:
            LazyVGrid(
                columns: [GridItem(.flexible()), GridItem(.flexible())],
                spacing: 12
            ) {
                ForEach(Self.distanceOptions(for: draft.activity), id: \.self) { distance in
                    OnboardingDistanceCard(
                        distanceKilometers: distance,
                        isSelected: draft.distanceKilometers == distance,
                        accessibilityID: "onboarding.distance.\(Int(distance))"
                    ) {
                        draft.distanceKilometers = distance
                    }
                }
            }

        case .effort:
            VStack(spacing: 12) {
                OnboardingChoiceCard(
                    title: "Easygoing",
                    subtitle: "Prefer gentler distance and climbing requests.",
                    symbol: RouteDifficulty.easy.symbol,
                    isSelected: draft.effort == .easy,
                    accessibilityID: "onboarding.effort.easy"
                ) {
                    draft.effort = .easy
                }

                OnboardingChoiceCard(
                    title: "Balanced",
                    subtitle: "A comfortable mix of distance and challenge.",
                    symbol: RouteDifficulty.moderate.symbol,
                    isSelected: draft.effort == .moderate,
                    accessibilityID: "onboarding.effort.moderate"
                ) {
                    draft.effort = .moderate
                }

                OnboardingChoiceCard(
                    title: "Push me",
                    subtitle: "Start from more ambitious route requests.",
                    symbol: RouteDifficulty.challenging.symbol,
                    isSelected: draft.effort == .challenging,
                    accessibilityID: "onboarding.effort.challenging"
                ) {
                    draft.effort = .challenging
                }
            }

        case .interests:
            VStack(alignment: .leading, spacing: 14) {
                LazyVGrid(
                    columns: [GridItem(.flexible()), GridItem(.flexible())],
                    spacing: 12
                ) {
                    ForEach(Self.interestOptions) { interest in
                        OnboardingInterestCard(
                            interest: interest,
                            isSelected: draft.interests.contains(interest.title),
                            isEnabled: draft.interests.count < 3 || draft.interests.contains(interest.title),
                            accessibilityID: "onboarding.interest.\(interest.id)"
                        ) {
                            toggleInterest(interest.title)
                        }
                    }
                }

                Text("\(draft.interests.count) of 3 selected")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.62))
                    .contentTransition(.numericText())
            }

        case .trust:
            OnboardingTrustCard()

        case .ready:
            OnboardingPlanRequestCard(draft: draft)
        }
    }

    private var primaryAction: some View {
        Button(action: moveForward) {
            HStack(spacing: 12) {
                Text(primaryActionTitle)
                Spacer()
                Image(systemName: selectedPage == Self.pages.count - 1 ? "sparkles" : "arrow.right")
            }
            .font(.headline)
            .foregroundStyle(theme.forest)
            .padding(.horizontal, 20)
            .frame(minHeight: 58)
            .background(theme.warmWhite, in: Capsule())
            .opacity(canContinue ? 1 : 0.48)
        }
        .buttonStyle(.plain)
        .disabled(!canContinue)
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
        .accessibilityIdentifier("onboarding.continue")
    }

    private var primaryActionTitle: String {
        switch currentPage.step {
        case .welcome: "Personalize my routes"
        case .trust: "I understand"
        case .ready: "Start planning"
        default: "Continue"
        }
    }

    private var canContinue: Bool {
        switch currentPage.step {
        case .activity:
            draft.activity != nil
        case .distance:
            draft.distanceKilometers != nil
        case .effort:
            draft.effort != nil
        case .interests:
            !draft.interests.isEmpty
        default:
            true
        }
    }

    private var pageTransition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        let xOffset: CGFloat = direction > 0 ? 28 : -28
        return .asymmetric(
            insertion: .opacity.combined(with: .offset(x: xOffset)),
            removal: .opacity.combined(with: .offset(x: -xOffset))
        )
    }

    static func distanceOptions(for activity: ActivityType?) -> [Double] {
        switch activity {
        case .hiking: [5, 10, 15, 20]
        case .trailRunning: [5, 8, 12, 18]
        case .biking: [15, 25, 40, 60]
        case nil: [5, 10, 15, 25]
        }
    }

    private func moveForward() {
        guard canContinue else { return }
        guard selectedPage < Self.pages.count - 1 else {
            commitPreferences()
            return
        }
        direction = 1
        withAnimation(reduceMotion ? nil : .snappy) {
            selectedPage += 1
        }
    }

    private func moveBack() {
        guard selectedPage > 0 else { return }
        direction = -1
        withAnimation(reduceMotion ? nil : .snappy) {
            selectedPage -= 1
        }
    }

    private func toggleInterest(_ interest: String) {
        if draft.interests.contains(interest) {
            draft.interests.remove(interest)
        } else if draft.interests.count < 3 {
            draft.interests.insert(interest)
        }
    }

    private func commitPreferences() {
        let preferences = UserPreferences(
            preferredActivity: draft.activity ?? .hiking,
            fitnessLevel: draft.effort ?? .moderate,
            preferredDistanceKilometers: draft.distanceKilometers ?? 15,
            avoidsSteepClimbs: draft.effort == .easy,
            interests: draft.interests,
            cautiousSafetyMode: true,
            prefersOfflineMaps: appModel.preferences.prefersOfflineMaps,
            hapticsEnabled: appModel.preferences.hapticsEnabled
        )
        appModel.updatePreferences(preferences)
        isComplete = true
    }

    private func activitySubtitle(_ activity: ActivityType) -> String {
        switch activity {
        case .hiking: "Walks, day hikes and mountain routes"
        case .trailRunning: "Faster routes shaped for time or distance"
        case .biking: "Longer rides using the biking profile"
        }
    }

    private func activityID(_ activity: ActivityType) -> String {
        switch activity {
        case .hiking: "hiking"
        case .trailRunning: "trail-running"
        case .biking: "biking"
        }
    }
}

private struct OnboardingPageContainer<Content: View>: View {
    let page: OnboardingView.Page
    @ViewBuilder let content: Content

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Spacer(minLength: 18)

                    VStack(alignment: .leading, spacing: 12) {
                        Text(page.eyebrow)
                            .font(.caption.weight(.bold))
                            .tracking(1.5)
                            .foregroundStyle(Color.white.opacity(0.64))

                        Text(page.title)
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                            .tracking(-0.7)
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)

                        Text(page.body)
                            .font(.body)
                            .foregroundStyle(.white.opacity(0.72))
                            .lineSpacing(4)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    content
                        .padding(.top, 4)

                    Spacer(minLength: 18)
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .topLeading)
                .padding(.horizontal, 22)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollIndicators(.hidden)
        }
        .accessibilityIdentifier("onboarding.page.\(page.step.rawValue)")
    }
}

private struct OnboardingRoutePreview: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("Describe your day", systemImage: "quote.bubble.fill")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(theme.graphite)
                Spacer()
                Image(systemName: "sparkles")
                    .foregroundStyle(theme.forestBright)
            }

            Text("“A relaxed loop with forest paths and a great view.”")
                .font(.title3.weight(.semibold))
                .foregroundStyle(theme.graphite)
                .fixedSize(horizontal: false, vertical: true)

            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(theme.mossSoft.opacity(0.34))
                ContourLines()
                    .stroke(theme.forest.opacity(0.10), lineWidth: 1)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                IllustrativeRouteLine()
                    .stroke(
                        theme.forestBright,
                        style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round)
                    )
                    .padding(22)
                Circle()
                    .fill(theme.sand)
                    .overlay { Circle().stroke(theme.forest, lineWidth: 3) }
                    .frame(width: 18, height: 18)
                    .offset(x: -83, y: 43)
            }
            .frame(height: 190)
            .accessibilityHidden(true)

            Label("Wanderful calculates mapped options and measured stats.", systemImage: "checkmark.seal.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(theme.forest)
        }
        .padding(18)
        .background(theme.warmWhite, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 24, y: 12)
    }
}

private struct IllustrativeRouteLine: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY + rect.height * 0.72))
        path.addCurve(
            to: CGPoint(x: rect.minX + rect.width * 0.50, y: rect.minY + rect.height * 0.23),
            control1: CGPoint(x: rect.minX + rect.width * 0.18, y: rect.minY + rect.height * 0.18),
            control2: CGPoint(x: rect.minX + rect.width * 0.38, y: rect.minY + rect.height * 0.12)
        )
        path.addCurve(
            to: CGPoint(x: rect.minX + rect.width * 0.82, y: rect.minY + rect.height * 0.46),
            control1: CGPoint(x: rect.minX + rect.width * 0.72, y: rect.minY + rect.height * 0.31),
            control2: CGPoint(x: rect.minX + rect.width * 0.90, y: rect.minY + rect.height * 0.23)
        )
        path.addCurve(
            to: CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY + rect.height * 0.72),
            control1: CGPoint(x: rect.minX + rect.width * 0.84, y: rect.minY + rect.height * 0.88),
            control2: CGPoint(x: rect.minX + rect.width * 0.34, y: rect.minY + rect.height * 0.92)
        )
        return path
    }
}

private struct OnboardingChoiceCard: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    let subtitle: String
    let symbol: String
    let isSelected: Bool
    let accessibilityID: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 15) {
                Image(systemName: symbol)
                    .font(.title3.weight(.semibold))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(isSelected ? theme.forest : theme.forestBright)
                    .frame(width: 46, height: 46)
                    .background(
                        isSelected ? theme.mossSoft : theme.mossSoft.opacity(0.38),
                        in: RoundedRectangle(cornerRadius: 15, style: .continuous)
                    )

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(theme.graphite)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(theme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? theme.forestBright : theme.secondaryText.opacity(0.32))
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .background(theme.warmWhite, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(isSelected ? theme.mossSoft : .white.opacity(0.16), lineWidth: isSelected ? 3 : 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(accessibilityID)
    }
}

private struct OnboardingDistanceCard: View {
    @Environment(TrailTheme.self) private var theme
    let distanceKilometers: Double
    let isSelected: Bool
    let accessibilityID: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "ruler.fill")
                        .foregroundStyle(isSelected ? theme.forest : theme.forestBright)
                    Spacer()
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(isSelected ? theme.forestBright : theme.secondaryText.opacity(0.28))
                }

                Text("\(Int(distanceKilometers)) km")
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .foregroundStyle(theme.graphite)
                Text("Starting preference")
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 128, alignment: .leading)
            .background(theme.warmWhite, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(isSelected ? theme.mossSoft : .white.opacity(0.16), lineWidth: isSelected ? 3 : 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(Int(distanceKilometers)) kilometers")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(accessibilityID)
    }
}

private struct OnboardingInterest: Identifiable {
    let title: String
    let symbol: String

    var id: String {
        title.lowercased().replacingOccurrences(of: " ", with: "-")
    }
}

private struct OnboardingInterestCard: View {
    @Environment(TrailTheme.self) private var theme
    let interest: OnboardingInterest
    let isSelected: Bool
    let isEnabled: Bool
    let accessibilityID: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Image(systemName: interest.symbol)
                        .font(.title3)
                        .foregroundStyle(isSelected ? theme.forest : theme.forestBright)
                    Spacer()
                    Image(systemName: isSelected ? "checkmark.circle.fill" : "plus.circle")
                        .foregroundStyle(isSelected ? theme.forestBright : theme.secondaryText.opacity(0.42))
                }

                Text(interest.title)
                    .font(.headline)
                    .foregroundStyle(theme.graphite)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 112, alignment: .leading)
            .background(theme.warmWhite, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(isSelected ? theme.mossSoft : .white.opacity(0.16), lineWidth: isSelected ? 3 : 1)
            }
            .opacity(isEnabled ? 1 : 0.42)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityHint("Requested preference; not a verified route feature.")
        .accessibilityIdentifier(accessibilityID)
    }
}

private struct OnboardingTrustCard: View {
    @Environment(TrailTheme.self) private var theme

    private let items = [
        ("map.fill", "Review the mapped route before starting."),
        ("cloud.sun.fill", "Check weather, local rules, trail conditions and water availability."),
        ("exclamationmark.triangle.fill", "Outdoor conditions can change quickly.")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ZStack {
                Circle()
                    .fill(theme.mossSoft.opacity(0.55))
                    .frame(width: 94, height: 94)
                Image(systemName: "shield.lefthalf.filled.badge.checkmark")
                    .font(.system(size: 42, weight: .semibold))
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
                    Text(item.1)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(theme.graphite)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Text("Requested features are preferences, not verified guarantees.")
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.secondaryText)
                .padding(.top, 2)
        }
        .padding(20)
        .background(theme.warmWhite, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: .black.opacity(0.10), radius: 22, y: 10)
    }
}

private struct OnboardingPlanRequestCard: View {
    @Environment(TrailTheme.self) private var theme
    let draft: OnboardingView.Draft

    private var activity: ActivityType { draft.activity ?? .hiking }
    private var distance: Int { Int(draft.distanceKilometers ?? 15) }
    private var effort: RouteDifficulty { draft.effort ?? .moderate }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Image(systemName: activity.symbol)
                    .font(.title2)
                    .foregroundStyle(theme.forest)
                    .frame(width: 52, height: 52)
                    .background(theme.mossSoft.opacity(0.60), in: RoundedRectangle(cornerRadius: 17, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text("YOUR STARTING REQUEST")
                        .font(.caption2.weight(.bold))
                        .tracking(1.1)
                        .foregroundStyle(theme.secondaryText)
                    Text("\(distance) km · \(activity.rawValue)")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(theme.graphite)
                }
            }

            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 132), alignment: .leading)],
                alignment: .leading,
                spacing: 8
            ) {
                OnboardingRequestChip(text: "Requested: \(effort.rawValue)", symbol: effort.symbol)
                ForEach(draft.interests.sorted(), id: \.self) { interest in
                    OnboardingRequestChip(text: "Requested: \(interest)", symbol: "sparkles")
                }
            }

            Divider().overlay(theme.forest.opacity(0.10))

            Label(
                "Wanderful will calculate the actual route geometry, distance, duration and elevation.",
                systemImage: "checkmark.seal.fill"
            )
            .font(.footnote.weight(.semibold))
            .foregroundStyle(theme.forest)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .background(theme.warmWhite, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 24, y: 12)
    }
}

private struct OnboardingRequestChip: View {
    @Environment(TrailTheme.self) private var theme
    let text: String
    let symbol: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(theme.forest)
            .padding(.horizontal, 11)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.mossSoft.opacity(0.48), in: Capsule())
    }
}

struct TrailMindMark: View {
    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                .font(.headline)
            Text("Wanderful")
                .font(.headline.weight(.bold))
        }
        .foregroundStyle(.white)
    }
}

private struct OnboardingPreviewHost: View {
    @State private var isComplete = false

    var body: some View {
        OnboardingView(isComplete: $isComplete)
            .environment(TrailTheme())
            .environment(AppModel())
    }
}

#Preview("Onboarding") {
    OnboardingPreviewHost()
}
