import SwiftUI

struct OnboardingView: View {
    enum Step: String, CaseIterable, Identifiable, Codable, Sendable {
        case welcome
        case activity
        case distance
        case routeShape = "route-shape"
        case effort
        case interests
        case trust
        case ready

        var id: Self { self }

        var illustrationAssetName: String {
            switch self {
            case .welcome: "OnboardingDreamOutcome"
            case .activity: "OnboardingActivityJourney"
            case .distance: "OnboardingComfortJourney"
            case .routeShape: "OnboardingRouteShapeJourney"
            case .effort: "OnboardingAvoidancesJourney"
            case .interests: "OnboardingExperiencesJourney"
            case .trust: "OnboardingTrustJourney"
            case .ready: "OnboardingProfileJourney"
            }
        }

        var illustrationAccessibilityLabel: String {
            switch self {
            case .welcome:
                "A planned mountain route travels from a forest trailhead, past a lake, to a viewpoint."
            case .activity:
                "A hiker, trail runner, and cyclist choose three paths into the mountains."
            case .distance:
                "A forest route grows from a nearby trailhead toward a lake and distant ridge."
            case .routeShape:
                "One route loops around a lake while another travels to a mountain shelter."
            case .effort:
                "A woodland route leans away from a steep climb, long road, and repeated switchbacks."
            case .interests:
                "A quiet forest opens onto a waterfall, alpine lake, viewpoint, hut, and peaks."
            case .trust:
                "A mapped route and compass overlook mountains with changing sun and rain."
            case .ready:
                "A hiker reviews a complete route through forest, lake, and mountain viewpoints."
            }
        }
    }

    struct Page: Identifiable, Sendable {
        let step: Step
        let eyebrow: String
        let title: String
        let body: String

        var id: Step { step }
    }

    struct Draft: Codable, Equatable, Sendable {
        enum ComfortUnit: String, Codable, CaseIterable, Identifiable, Sendable {
            case kilometers
            case hours

            var id: Self { self }

            var title: String {
                switch self {
                case .kilometers: "Distance"
                case .hours: "Time"
                }
            }
        }

        struct ComfortRange: Codable, Equatable, Hashable, Sendable {
            let minimum: Double
            let maximum: Double
            let unit: ComfortUnit

            var label: String {
                switch unit {
                case .kilometers:
                    "\(Int(minimum))–\(Int(maximum)) km"
                case .hours:
                    "\(Int(minimum))–\(Int(maximum)) hours"
                }
            }

            var midpointKilometers: Double? {
                guard unit == .kilometers else { return nil }
                return (minimum + maximum) / 2
            }
        }

        enum RouteShapePreference: String, Codable, CaseIterable, Identifiable, Sendable {
            case loop
            case pointToPoint = "point-to-point"

            var id: Self { self }

            var title: String {
                switch self {
                case .loop: "Loop route"
                case .pointToPoint: "Point to point"
                }
            }

            var subtitle: String {
                switch self {
                case .loop: "Finish where you started, when available paths allow"
                case .pointToPoint: "Travel from one place to another"
                }
            }

            var symbol: String {
                switch self {
                case .loop: "arrow.triangle.2.circlepath"
                case .pointToPoint: "point.bottomleft.forward.to.point.topright.scurvepath"
                }
            }
        }

        enum SoftAvoidance: String, Codable, CaseIterable, Identifiable, Sendable {
            case steepClimbs = "steep-climbs"
            case longRoadSections = "long-road-sections"
            case repeatedSections = "repeated-sections"

            var id: Self { self }

            var title: String {
                switch self {
                case .steepClimbs: "Steep climbs"
                case .longRoadSections: "Long road sections"
                case .repeatedSections: "Repeated sections"
                }
            }

            var subtitle: String {
                switch self {
                case .steepClimbs: "Prefer gentler elevation when possible"
                case .longRoadSections: "Lean toward paths and trails"
                case .repeatedSections: "Reduce backtracking on loop routes"
                }
            }

            var symbol: String {
                switch self {
                case .steepClimbs: "mountain.2"
                case .longRoadSections: "road.lanes.curved.left"
                case .repeatedSections: "arrow.uturn.backward"
                }
            }
        }

        enum RequestedExperience: String, Codable, CaseIterable, Identifiable, Sendable {
            case viewpoints
            case forest
            case quietNature = "quiet-nature"
            case waterfalls
            case peaks
            case lakes
            case huts
            case landmarks

            var id: Self { self }

            var title: String {
                switch self {
                case .viewpoints: "Views"
                case .forest: "Forest"
                case .quietNature: "Quiet nature"
                case .waterfalls: "Waterfalls"
                case .peaks: "Peaks"
                case .lakes: "Lakes"
                case .huts: "Huts"
                case .landmarks: "Landmarks"
                }
            }

            var summaryTitle: String {
                switch self {
                case .viewpoints: "viewpoints"
                case .forest: "forest"
                case .quietNature: "quiet nature"
                case .waterfalls: "waterfalls"
                case .peaks: "peaks"
                case .lakes: "lakes"
                case .huts: "huts"
                case .landmarks: "landmarks"
                }
            }

            var subtitle: String {
                switch self {
                case .viewpoints: "Request viewpoints"
                case .forest: "Request forest surroundings"
                case .quietNature: "Request quieter-feeling options"
                case .waterfalls: "Request waterfall stops"
                case .peaks: "Request a peak or summit"
                case .lakes: "Request lakeside sections"
                case .huts: "Request huts along the way"
                case .landmarks: "Request notable trail landmarks"
                }
            }

            var symbol: String {
                switch self {
                case .viewpoints: "mountain.2.fill"
                case .forest: "tree.fill"
                case .quietNature: "leaf.fill"
                case .waterfalls: "water.waves"
                case .peaks: "flag.fill"
                case .lakes: "drop.fill"
                case .huts: "house.lodge.fill"
                case .landmarks: "binoculars.fill"
                }
            }
        }

        var activity: ActivityType?
        var comfortRange: ComfortRange?
        var distanceKilometers: Double?
        var effort: RouteDifficulty?
        var routeShape: RouteShapePreference?
        var softAvoidances: Set<SoftAvoidance>?
        var requestedExperiences: Set<RequestedExperience>?

        init(
            activity: ActivityType? = nil,
            comfortRange: ComfortRange? = nil,
            distanceKilometers: Double? = nil,
            effort: RouteDifficulty? = nil,
            routeShape: RouteShapePreference? = nil,
            softAvoidances: Set<SoftAvoidance>? = nil,
            requestedExperiences: Set<RequestedExperience>? = nil
        ) {
            self.activity = activity
            self.comfortRange = comfortRange
            self.distanceKilometers = distanceKilometers
            self.effort = effort
            self.routeShape = routeShape
            self.softAvoidances = softAvoidances
            self.requestedExperiences = requestedExperiences
        }

        var legacyInterests: Set<String> {
            Set((requestedExperiences ?? []).map(\.title))
        }

        var interests: Set<String> { legacyInterests }
        var activityLabel: String { activity?.rawValue ?? "Not set" }
        var comfortLabel: String { comfortRange?.label ?? "Not set" }
        var routeShapeLabel: String { routeShape?.title ?? "Not set" }

        var softAvoidancesLabel: String {
            guard let softAvoidances else { return "Not set" }
            guard !softAvoidances.isEmpty else { return "None selected" }
            return Self.formattedList(softAvoidances.sorted { $0.rawValue < $1.rawValue }.map(\.title))
        }

        var requestedExperiencesLabel: String {
            guard let requestedExperiences else { return "Not set" }
            guard !requestedExperiences.isEmpty else { return "None selected" }
            return Self.formattedList(requestedExperiences.sorted { $0.rawValue < $1.rawValue }.map(\.title))
        }

        private static func formattedList(_ values: [String]) -> String {
            switch values.count {
            case 0: return ""
            case 1: return values[0]
            case 2: return "\(values[0]) and \(values[1])"
            default:
                return values.dropLast().joined(separator: ", ") + ", and " + (values.last ?? "")
            }
        }
    }

    @Environment(TrailTheme.self) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding private var isComplete: Bool
    @State private var selectedPage: Int
    @State private var direction = 1
    @State private var draft: Draft
    @State private var comfortUnit: Draft.ComfortUnit

    private let onProgress: ((Draft, Step) -> Void)?
    private let onCompleteDraft: ((Draft) -> Void)?

    static let pages = [
        Page(
            step: .welcome,
            eyebrow: "FROM IDEA TO TRAIL",
            title: "Your perfect day, mapped.",
            body: "Describe the adventure. Wanderful builds a real route with distance, time and elevation."
        ),
        Page(
            step: .activity,
            eyebrow: "BUILD YOUR PERFECT DAY OUTSIDE",
            title: "How do you want to move outside?",
            body: "Choose a usual activity—or tap “I don’t know yet.” What you ask for later always wins."
        ),
        Page(
            step: .distance,
            eyebrow: "BUILD YOUR PERFECT DAY OUTSIDE",
            title: "What feels like a comfortable day?",
            body: "A broad distance or time range is enough. You can change it for every route."
        ),
        Page(
            step: .routeShape,
            eyebrow: "BUILD YOUR PERFECT DAY OUTSIDE",
            title: "How should the route come together?",
            body: "Choose a usual starting shape—or let each route request decide."
        ),
        Page(
            step: .effort,
            eyebrow: "BUILD YOUR PERFECT DAY OUTSIDE",
            title: "Your day outside is taking shape.",
            body: "Anything Wanderful should usually lean away from? These are preferences, not guarantees."
        ),
        Page(
            step: .interests,
            eyebrow: "BUILD YOUR PERFECT DAY OUTSIDE",
            title: "What makes a day outside feel worth it?",
            body: "Choose up to three requested preferences. Wanderful only confirms them when route data can."
        ),
        Page(
            step: .trust,
            eyebrow: "PLAN WITH CLEAR LIMITS",
            title: "Real routes. Honest guidance.",
            body: "Wanderful calculates geometry and measured stats, but it is a planning aid—not live navigation."
        ),
        Page(
            step: .ready,
            eyebrow: "YOUR TRAIL PROFILE",
            title: "Meet the starting point for your adventures.",
            body: "These optional defaults fill gaps—not override what you ask for. Tap any row to change it."
        )
    ]

    init(
        isComplete: Binding<Bool>,
        initialDraft: Draft = Draft(),
        initialStep: Step = .welcome,
        onProgress: ((Draft, Step) -> Void)? = nil,
        onCompleteDraft: ((Draft) -> Void)? = nil
    ) {
        _isComplete = isComplete
        _draft = State(initialValue: initialDraft)
        _comfortUnit = State(initialValue: initialDraft.comfortRange?.unit ?? .kilometers)
        _selectedPage = State(initialValue: Self.pages.firstIndex { $0.step == initialStep } ?? 0)
        self.onProgress = onProgress
        self.onCompleteDraft = onCompleteDraft
    }

    private var currentPage: Page { Self.pages[selectedPage] }
    private var progress: Double { Double(selectedPage + 1) / Double(Self.pages.count) }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.forest, Color(red: 0.01, green: 0.27, blue: 0.21)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ContourLines()
                .stroke(.white.opacity(0.065), lineWidth: 1)
                .ignoresSafeArea()
                .accessibilityHidden(true)

            VStack(spacing: 0) {
                header

                ZStack {
                    Group {
                        if currentPage.step == .welcome {
                            OnboardingWelcomePage(page: currentPage)
                        } else {
                            OnboardingPageContainer(
                                page: currentPage,
                                title: displayedTitle,
                                body: currentPage.body
                            ) {
                                stepContent
                            }
                        }
                    }
                    .id(currentPage.step)
                    .transition(pageTransition)
                }
                .animation(reduceMotion ? nil : .snappy, value: selectedPage)

                primaryAction
            }
        }
    }

    @ViewBuilder
    private var header: some View {
        if selectedPage == 0 {
            HStack {
                TrailMindMark()
                Spacer(minLength: 12)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 22)
            .padding(.top, 8)
            .padding(.bottom, 2)
        } else {
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    Button(action: moveBack) {
                        Image(systemName: "chevron.left")
                            .font(.headline.weight(.bold))
                            .frame(width: 48, height: 48)
                            .background(.white.opacity(0.12), in: Circle())
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Previous step")
                    .accessibilityIdentifier("onboarding.back")

                    Spacer(minLength: 12)

                    Text("\(selectedPage + 1) of \(Self.pages.count)")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white.opacity(0.76))
                        .contentTransition(.numericText())
                }
                .foregroundStyle(.white)

                OnboardingProgressRoute(
                    stepCount: Self.pages.count,
                    currentIndex: selectedPage,
                    progress: progress
                )
                .frame(height: 28)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Onboarding progress")
                .accessibilityValue("Step \(selectedPage + 1) of \(Self.pages.count)")
            }
            .padding(.horizontal, 22)
            .padding(.top, 8)
            .padding(.bottom, 2)
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch currentPage.step {
        case .welcome:
            EmptyView()

        case .activity:
            questionStack {
                OnboardingChoicePanel {
                    ForEach(ActivityType.allCases) { activity in
                        OnboardingChoiceRow(
                            title: activity.rawValue,
                            subtitle: activitySubtitle(activity),
                            symbol: activity.symbol,
                            isSelected: draft.activity == activity,
                            accessibilityID: "onboarding.activity.\(activityID(activity))"
                        ) {
                            selectActivity(activity)
                        }
                    }

                    unknownChoice(
                        isSelected: draft.activity == nil,
                        accessibilityID: "onboarding.activity.unknown"
                    ) {
                        selectActivity(nil)
                    }
                }
            }

        case .distance:
            questionStack {
                OnboardingUnitPicker(selection: $comfortUnit) { newUnit in
                    guard newUnit != draft.comfortRange?.unit else { return }
                    updateDraft {
                        $0.comfortRange = nil
                        $0.distanceKilometers = nil
                    }
                }

                OnboardingChoicePanel {
                    ForEach(comfortRanges, id: \.self) { range in
                        OnboardingChoiceRow(
                            title: range.label,
                            subtitle: comfortSubtitle(range),
                            symbol: range.unit == .kilometers ? "ruler.fill" : "clock.fill",
                            isSelected: draft.comfortRange == range,
                            accessibilityID: comfortAccessibilityID(range)
                        ) {
                            updateDraft {
                                $0.comfortRange = range
                                $0.distanceKilometers = range.midpointKilometers
                            }
                        }
                    }

                    unknownChoice(
                        isSelected: draft.comfortRange == nil,
                        accessibilityID: "onboarding.distance.unknown"
                    ) {
                        updateDraft {
                            $0.comfortRange = nil
                            $0.distanceKilometers = nil
                        }
                    }
                }
            }

        case .routeShape:
            questionStack {
                OnboardingChoicePanel {
                    ForEach(Draft.RouteShapePreference.allCases) { routeShape in
                        OnboardingChoiceRow(
                            title: routeShape.title,
                            subtitle: routeShape.subtitle,
                            symbol: routeShape.symbol,
                            isSelected: draft.routeShape == routeShape,
                            accessibilityID: "onboarding.route-shape.\(routeShape.rawValue)"
                        ) {
                            updateDraft { $0.routeShape = routeShape }
                        }
                    }

                    unknownChoice(
                        isSelected: draft.routeShape == nil,
                        accessibilityID: "onboarding.route-shape.unknown"
                    ) {
                        updateDraft { $0.routeShape = nil }
                    }
                }
            }

        case .effort:
            questionStack {
                OnboardingChoicePanel {
                    ForEach(Draft.SoftAvoidance.allCases) { avoidance in
                        OnboardingChoiceRow(
                            title: avoidance.title,
                            subtitle: avoidance.subtitle,
                            symbol: avoidance.symbol,
                            isSelected: draft.softAvoidances?.contains(avoidance) == true,
                            accessibilityID: "onboarding.avoidance.\(avoidance.rawValue)"
                        ) {
                            toggleAvoidance(avoidance)
                        }
                    }

                    OnboardingChoiceRow(
                        title: "None of these",
                        subtitle: "Keep this category explicitly empty",
                        symbol: "checkmark.circle",
                        isSelected: draft.softAvoidances == [],
                        accessibilityID: "onboarding.avoidance.none"
                    ) {
                        updateDraft { $0.softAvoidances = [] }
                    }

                    unknownChoice(
                        isSelected: draft.softAvoidances == nil,
                        accessibilityID: "onboarding.avoidance.unknown"
                    ) {
                        updateDraft { $0.softAvoidances = nil }
                    }
                }
            }

        case .interests:
            VStack(alignment: .leading, spacing: 16) {
                currentStepIllustration

                OnboardingChoicePanel {
                    OnboardingChoiceRow(
                        title: "No special requests",
                        subtitle: "Keep this category explicitly empty",
                        symbol: "checkmark.circle",
                        isSelected: draft.requestedExperiences == [],
                        accessibilityID: "onboarding.interest.none"
                    ) {
                        updateDraft { $0.requestedExperiences = [] }
                    }

                    unknownChoice(
                        isSelected: draft.requestedExperiences == nil,
                        accessibilityID: "onboarding.interest.unknown"
                    ) {
                        updateDraft { $0.requestedExperiences = nil }
                    }
                }

                Text("OR REQUEST UP TO THREE")
                    .font(.caption2.weight(.bold))
                    .tracking(1.1)
                    .foregroundStyle(.white.opacity(0.68))

                LazyVGrid(
                    columns: experienceColumns,
                    spacing: 10
                ) {
                    ForEach(Draft.RequestedExperience.allCases) { experience in
                        let selections = draft.requestedExperiences ?? []
                        OnboardingExperienceCard(
                            title: experience.title,
                            symbol: experience.symbol,
                            isSelected: selections.contains(experience),
                            isEnabled: selections.count < 3 || selections.contains(experience),
                            accessibilityID: "onboarding.interest.\(interestID(experience))"
                        ) {
                            toggleExperience(experience)
                        }
                    }
                }

                Text("\(draft.requestedExperiences?.count ?? 0) of 3 requested")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.72))
                    .contentTransition(.numericText())

                OnboardingUnknownNote()
                OnboardingSoFarCard(summary: soFarSummary)
            }

        case .trust:
            VStack(alignment: .leading, spacing: 16) {
                currentStepIllustration
                OnboardingTrustCard()
                OnboardingSoFarCard(summary: soFarSummary)
            }

        case .ready:
            VStack(alignment: .leading, spacing: 16) {
                currentStepIllustration
                OnboardingProfileRecap(draft: draft, onEdit: edit)
            }
        }
    }

    private var currentStepIllustration: some View {
        OnboardingJourneyIllustration(
            assetName: currentPage.step.illustrationAssetName,
            accessibilityLabel: currentPage.step.illustrationAccessibilityLabel
        )
    }

    private func questionStack<Content: View>(
        @ViewBuilder choices: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            currentStepIllustration
            choices()
            OnboardingUnknownNote()
            OnboardingSoFarCard(summary: soFarSummary)
        }
    }

    private var primaryAction: some View {
        Button(action: moveForward) {
            HStack(spacing: 12) {
                Text(primaryActionTitle)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 12)
                Image(systemName: currentPage.step == .ready ? "sparkles" : "arrow.right")
                    .accessibilityHidden(true)
            }
            .font(.headline)
            .foregroundStyle(theme.forest)
            .padding(.horizontal, 22)
            .frame(maxWidth: .infinity, minHeight: 62)
            .background(theme.warmWhite, in: Capsule())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 22)
        .padding(.top, 10)
        .padding(.bottom, 14)
        .accessibilityHint(primaryActionHint)
        .accessibilityIdentifier("onboarding.continue")
    }

    private var primaryActionTitle: String {
        switch currentPage.step {
        case .welcome: "Make it mine"
        case .trust: "Build my Trail Profile"
        case .ready: "Plan my first route"
        default: "Continue building my day"
        }
    }

    private var primaryActionHint: String {
        switch currentPage.step {
        case .welcome: "Starts optional personalization."
        case .trust: "Shows the Trail Profile recap."
        case .ready: "Saves these optional defaults locally and opens route planning."
        default: "Continues with the current choice. I don’t know yet is a complete answer."
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

    private var displayedTitle: String {
        switch currentPage.step {
        case .distance:
            switch draft.activity {
            case .hiking: "What feels like a comfortable hiking day?"
            case .trailRunning: "What feels like a comfortable trail-running day?"
            case .biking: "What feels like a comfortable ride?"
            case nil: currentPage.title
            }
        case .effort:
            switch draft.activity {
            case .hiking: "Your hiking day is taking shape."
            case .trailRunning: "Your trail-running day is taking shape."
            case .biking: "Your riding day is taking shape."
            case nil: currentPage.title
            }
        default:
            currentPage.title
        }
    }

    static func distanceOptions(for activity: ActivityType?) -> [Double] {
        switch activity {
        case .hiking: [5, 10, 15, 20]
        case .trailRunning: [5, 8, 12, 18]
        case .biking: [15, 25, 40, 60]
        case nil: [5, 10, 15, 25]
        }
    }

    static func comfortDistanceRanges(for activity: ActivityType?) -> [Draft.ComfortRange] {
        let values: [(Double, Double)]
        switch activity {
        case .hiking: values = [(5, 10), (10, 15), (15, 25)]
        case .trailRunning: values = [(5, 10), (10, 20), (20, 35)]
        case .biking: values = [(10, 25), (25, 50), (50, 100)]
        case nil: values = [(5, 10), (10, 20), (20, 40)]
        }
        return values.map { Draft.ComfortRange(minimum: $0.0, maximum: $0.1, unit: .kilometers) }
    }

    static let comfortDurationRanges = [
        Draft.ComfortRange(minimum: 1, maximum: 2, unit: .hours),
        Draft.ComfortRange(minimum: 2, maximum: 4, unit: .hours),
        Draft.ComfortRange(minimum: 4, maximum: 6, unit: .hours)
    ]

    private var comfortRanges: [Draft.ComfortRange] {
        switch comfortUnit {
        case .kilometers: Self.comfortDistanceRanges(for: draft.activity)
        case .hours: Self.comfortDurationRanges
        }
    }

    private var experienceColumns: [GridItem] {
        if dynamicTypeSize.isAccessibilitySize {
            return [GridItem(.flexible())]
        }
        return [GridItem(.flexible()), GridItem(.flexible())]
    }

    private var soFarSummary: String {
        var fragments: [String] = []

        if let activity = draft.activity {
            fragments.append(activity.rawValue.lowercased())
        }
        if let comfortRange = draft.comfortRange {
            fragments.append("around \(comfortRange.label)")
        }
        if let routeShape = draft.routeShape {
            fragments.append(routeShape == .loop ? "usually a loop" : "usually point to point")
        }
        if let experiences = draft.requestedExperiences, !experiences.isEmpty {
            let names = experiences.sorted { $0.rawValue < $1.rawValue }.map(\.summaryTitle)
            fragments.append("\(formattedList(names)) requested")
        }
        if let avoidances = draft.softAvoidances, !avoidances.isEmpty {
            let names = avoidances.sorted { $0.rawValue < $1.rawValue }.map { $0.title.lowercased() }
            fragments.append("leaning away from \(formattedList(names)) when possible")
        }

        guard !fragments.isEmpty else {
            return "So far: no defaults added. Your route request will lead."
        }
        return "So far: \(fragments.joined(separator: ", "))."
    }

    private func formattedList(_ values: [String]) -> String {
        switch values.count {
        case 0: return ""
        case 1: return values[0]
        case 2: return "\(values[0]) and \(values[1])"
        default:
            return values.dropLast().joined(separator: ", ") + ", and " + (values.last ?? "")
        }
    }

    private func moveForward() {
        guard selectedPage < Self.pages.count - 1 else {
            commitPreferences()
            return
        }
        direction = 1
        let nextIndex = selectedPage + 1
        withAnimation(reduceMotion ? nil : .snappy) {
            selectedPage = nextIndex
        }
        onProgress?(draft, Self.pages[nextIndex].step)
    }

    private func moveBack() {
        guard selectedPage > 0 else { return }
        direction = -1
        let previousIndex = selectedPage - 1
        withAnimation(reduceMotion ? nil : .snappy) {
            selectedPage = previousIndex
        }
        onProgress?(draft, Self.pages[previousIndex].step)
    }

    private func edit(_ step: Step) {
        guard let targetIndex = Self.pages.firstIndex(where: { $0.step == step }) else { return }
        direction = targetIndex < selectedPage ? -1 : 1
        withAnimation(reduceMotion ? nil : .snappy) {
            selectedPage = targetIndex
        }
        onProgress?(draft, step)
    }

    private func updateDraft(_ mutation: (inout Draft) -> Void) {
        mutation(&draft)
        onProgress?(draft, currentPage.step)
    }

    private func selectActivity(_ activity: ActivityType?) {
        updateDraft {
            if $0.activity != activity, $0.comfortRange?.unit == .kilometers {
                $0.comfortRange = nil
                $0.distanceKilometers = nil
            }
            $0.activity = activity
        }
    }

    private func toggleAvoidance(_ avoidance: Draft.SoftAvoidance) {
        updateDraft {
            var selections = $0.softAvoidances ?? []
            if selections.contains(avoidance) {
                selections.remove(avoidance)
            } else {
                selections.insert(avoidance)
            }
            $0.softAvoidances = selections
        }
    }

    private func toggleExperience(_ experience: Draft.RequestedExperience) {
        updateDraft {
            var selections = $0.requestedExperiences ?? []
            if selections.contains(experience) {
                selections.remove(experience)
            } else if selections.count < 3 {
                selections.insert(experience)
            }
            $0.requestedExperiences = selections
        }
    }

    private func commitPreferences() {
        onCompleteDraft?(draft)
        if onCompleteDraft == nil {
            isComplete = true
        }
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

    private func interestID(_ experience: Draft.RequestedExperience) -> String {
        experience == .viewpoints ? "views" : experience.rawValue
    }

    private func comfortSubtitle(_ range: Draft.ComfortRange) -> String {
        switch range.unit {
        case .kilometers:
            switch range.maximum {
            case ...10: "A shorter outing with room to explore"
            case ...25: "A steady day with time to look around"
            default: "A longer day when the route and conditions fit"
            }
        case .hours:
            switch range.maximum {
            case ...2: "A compact outing"
            case ...4: "A half-day adventure"
            default: "A fuller day outside"
            }
        }
    }

    private func comfortAccessibilityID(_ range: Draft.ComfortRange) -> String {
        switch range.unit {
        case .kilometers: "onboarding.distance.\(Int(range.maximum))"
        case .hours: "onboarding.duration.\(Int(range.maximum))"
        }
    }

    private func unknownChoice(
        isSelected: Bool,
        accessibilityID: String,
        action: @escaping () -> Void
    ) -> some View {
        OnboardingChoiceRow(
            title: "I don’t know yet",
            subtitle: "Add no default—use only what I ask for",
            symbol: "questionmark",
            isSelected: isSelected,
            accessibilityID: accessibilityID,
            accessibilityHint: "Stores no preference. You can change this later.",
            action: action
        )
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
