import SwiftUI

struct ProfilePreferencesView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(AppModel.self) private var appModel

    private let interests = ["Waterfalls", "Views", "Forest", "Lakes", "Quiet trails"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    profileHeader
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                Section("Your movement") {
                    Picker(
                        "Preferred activity",
                        selection: preferenceBinding(\.preferredActivity)
                    ) {
                        ForEach(ActivityType.allCases) { activity in
                            Label(activity.rawValue, systemImage: activity.symbol)
                                .tag(activity)
                        }
                    }

                    Picker(
                        "Comfortable effort",
                        selection: preferenceBinding(\.fitnessLevel)
                    ) {
                        ForEach(RouteDifficulty.allCases, id: \.self) { level in
                            Text(level.rawValue).tag(level)
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("Typical distance")
                            Spacer()
                            Text("\(Int(appModel.preferences.preferredDistanceKilometers)) km")
                                .foregroundStyle(theme.secondaryText)
                        }
                        Slider(
                            value: preferenceBinding(\.preferredDistanceKilometers),
                            in: 5...50,
                            step: 1
                        )
                    }
                }

                Section("Route character") {
                    Toggle("Avoid steep climbs", isOn: preferenceBinding(\.avoidsSteepClimbs))
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Things worth detouring for")
                        FlowLayout(spacing: 8) {
                            ForEach(interests, id: \.self) { interest in
                                InterestChip(
                                    title: interest,
                                    isSelected: appModel.preferences.interests.contains(interest)
                                ) {
                                    toggleInterest(interest)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    Toggle("Extra safety context", isOn: preferenceBinding(\.cautiousSafetyMode))
                    Toggle("Prefer offline-ready routes", isOn: preferenceBinding(\.prefersOfflineMaps))
                    Toggle("Tactile feedback", isOn: preferenceBinding(\.hapticsEnabled))
                } header: {
                    Text("Preparedness")
                } footer: {
                    Text("TrailMind suggestions are AI-assisted. Always review current weather, trail conditions, local rules and water availability.")
                }

                Section("Coming next") {
                    Label("Offline maps", systemImage: "square.3.layers.3d")
                    Label("Weather layers", systemImage: "cloud.sun.fill")
                    Label("Connected navigation", systemImage: "location.north.line.fill")
                }
                .foregroundStyle(theme.secondaryText)
            }
            .scrollContentBackground(.hidden)
            .background(TrailBackground())
            .tint(theme.forestBright)
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var profileHeader: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [theme.moss, theme.forestBright],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Image(systemName: "figure.hiking")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 62, height: 62)

            VStack(alignment: .leading, spacing: 4) {
                Text("Your trail profile")
                    .font(.trailSection)
                Text("Tune the default. Every prompt can still surprise you.")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
            }
        }
        .padding(.vertical, 14)
    }

    private func preferenceBinding<Value>(_ keyPath: WritableKeyPath<UserPreferences, Value>) -> Binding<Value> {
        Binding(
            get: { appModel.preferences[keyPath: keyPath] },
            set: { appModel.preferences[keyPath: keyPath] = $0 }
        )
    }

    private func toggleInterest(_ interest: String) {
        if appModel.preferences.interests.contains(interest) {
            appModel.preferences.interests.remove(interest)
        } else {
            appModel.preferences.interests.insert(interest)
        }
    }
}

private struct InterestChip: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if isSelected {
                    Image(systemName: "checkmark")
                }
                Text(title)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(isSelected ? .white : theme.forest)
            .padding(.horizontal, 11)
            .padding(.vertical, 8)
            .background(isSelected ? theme.forest : theme.mossSoft.opacity(0.55), in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat

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
                y += rowHeight + spacing
                rowHeight = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), points)
    }
}
