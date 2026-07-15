import SwiftUI

struct ProfilePreferencesView: View {
    @Environment(TrailTheme.self) private var theme

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    profileHeader
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                Section("TrailMind today") {
                    informationRow(
                        title: "Natural-language planning",
                        detail: "Describe a same-day hike, trail run or bike route with a start, destination, distance or time.",
                        symbol: "text.bubble.fill"
                    )
                    informationRow(
                        title: "Mapped route results",
                        detail: "Route geometry, distance, duration and elevation come from the routing response.",
                        symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
                    )
                    informationRow(
                        title: "Local saved plans",
                        detail: "Routes appear in Saved only after you choose to save a verified result on this device.",
                        symbol: "bookmark.fill"
                    )
                }

                Section("Planning boundary") {
                    informationRow(
                        title: "Review before starting",
                        detail: "TrailMind is a planning aid, not live navigation. Check weather, trail conditions, closures, local rules and water availability.",
                        symbol: "checklist"
                    )
                    informationRow(
                        title: "Preferences are requests",
                        detail: "Requested features are shown separately unless mapped route data verifies them.",
                        symbol: "slider.horizontal.3"
                    )
                }
            }
            .scrollContentBackground(.hidden)
            .background(TrailBackground())
            .tint(theme.forestBright)
            .navigationTitle("About")
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
                Text("TrailMind")
                    .font(.trailSection)
                Text("A focused planner for real outdoor routes.")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
            }
        }
        .padding(.vertical, 14)
    }

    private func informationRow(
        title: String,
        detail: String,
        symbol: String
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(theme.forest)
                .frame(width: 30, height: 30)
                .background(theme.mossSoft.opacity(0.58), in: Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(theme.graphite)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
    }
}
