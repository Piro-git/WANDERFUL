import SwiftUI

struct GeneratingRouteView: View {
    @Environment(TrailTheme.self) private var theme
    let planner: PlannerViewModel

    var body: some View {
        VStack(spacing: 30) {
            Spacer()

            ZStack {
                Circle()
                    .stroke(theme.mossSoft.opacity(0.5), lineWidth: 20)
                    .frame(width: 170, height: 170)

                Circle()
                    .trim(from: 0, to: CGFloat(planner.generationStep + 1) / CGFloat(planner.generationMessages.count))
                    .stroke(
                        AngularGradient(colors: [theme.moss, theme.forestBright, theme.moss], center: .center),
                        style: StrokeStyle(lineWidth: 20, lineCap: .round)
                    )
                    .frame(width: 170, height: 170)
                    .rotationEffect(.degrees(-90))
                    .animation(.smooth(duration: 0.6), value: planner.generationStep)

                Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath")
                    .font(.system(size: 46, weight: .medium))
                    .foregroundStyle(theme.forest)
                    .contentTransition(.symbolEffect(.replace))
            }

            VStack(spacing: 10) {
                Text(planner.generationMessages[planner.generationStep])
                    .font(.trailSection)
                    .contentTransition(.numericText())
                    .id(planner.generationStep)
                    .transition(.blurReplace)

                Text("“\(planner.prompt)”")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .padding(.horizontal, 30)
            }

            VStack(spacing: 12) {
                ForEach(planner.generationMessages.indices, id: \.self) { index in
                    HStack {
                        Image(systemName: index <= planner.generationStep ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(index <= planner.generationStep ? theme.moss : theme.secondaryText.opacity(0.3))
                        Text(planner.generationMessages[index])
                            .font(.subheadline)
                            .foregroundStyle(index <= planner.generationStep ? theme.graphite : theme.secondaryText.opacity(0.55))
                        Spacer()
                    }
                }
            }
            .trailCard()
            .padding(.horizontal, TrailSpacing.page)

            Spacer()
            Text(planner.generationFooter)
                .font(.caption)
                .foregroundStyle(theme.secondaryText)
                .padding(.bottom, 20)
        }
        .task {
            await planner.generate()
        }
    }
}

struct RouteSuggestionsView: View {
    @Environment(TrailTheme.self) private var theme
    let prompt: String
    let suggestions: [RouteSuggestion]
    let notice: String?
    let onStartOver: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TrailSpacing.section) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Three ways to go")
                        .font(.trailTitle)
                    Text("Built around “\(prompt)”")
                        .font(.body)
                        .foregroundStyle(theme.secondaryText)
                        .lineLimit(3)
                }

                if let notice {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "info.circle.fill")
                            .foregroundStyle(theme.moss)
                        Text(notice)
                            .font(.footnote)
                            .foregroundStyle(theme.graphite)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(14)
                    .background(theme.sand.opacity(0.62), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                }

                ForEach(suggestions) { suggestion in
                    NavigationLink(value: suggestion.route) {
                        RouteCard(route: suggestion.route, matchScore: suggestion.matchScore)
                    }
                    .buttonStyle(.plain)
                }

                Button(action: onStartOver) {
                    Label("Plan something different", systemImage: "arrow.counterclockwise")
                        .font(.headline)
                        .foregroundStyle(theme.forest)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.plain)

                Text("Always check local rules, weather, trail conditions and water availability before starting.")
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
            }
            .padding(TrailSpacing.page)
        }
        .navigationTitle("Your routes")
        .navigationBarTitleDisplayMode(.inline)
    }
}
