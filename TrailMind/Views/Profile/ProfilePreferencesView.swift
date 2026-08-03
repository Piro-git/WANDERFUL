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

                Section {
                    ForEach(TrailMindAboutContent.currentCapabilityItems) { item in
                        informationRow(item)
                    }
                } header: {
                    sectionHeader(
                        "Wanderful today",
                        accessibilityIdentifier: TrailMindAboutAccessibilityID.currentCapabilitiesSection
                    )
                }

                Section {
                    ForEach(TrailMindAboutContent.dataFlowItems) { item in
                        informationRow(item)
                    }
                } header: {
                    sectionHeader(
                        "Data & privacy",
                        accessibilityIdentifier: TrailMindAboutAccessibilityID.dataFlowSection
                    )
                } footer: {
                    Text(TrailMindAboutContent.dataFlowFooter)
                        .accessibilityIdentifier("about.data.footer")
                }

                Section {
                    ForEach(TrailMindAboutContent.planningBoundaryItems) { item in
                        informationRow(item)
                    }
                } header: {
                    sectionHeader(
                        "Planning boundary",
                        accessibilityIdentifier: TrailMindAboutAccessibilityID.planningBoundarySection
                    )
                }

                Section {
                    informationRow(TrailMindAboutContent.mapDisplayItem)
                    ForEach(TrailMindAboutContent.credits) { credit in
                        creditRow(credit)
                    }
                } header: {
                    sectionHeader(
                        "Providers & map data",
                        accessibilityIdentifier: TrailMindAboutAccessibilityID.creditsSection
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
                Text("Wanderful")
                    .font(.trailSection)
                Text("A focused planner for real outdoor routes.")
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
            }
        }
        .padding(.vertical, 14)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Wanderful. A focused planner for real outdoor routes.")
        .accessibilityIdentifier(TrailMindAboutAccessibilityID.header)
    }

    private func sectionHeader(
        _ title: String,
        accessibilityIdentifier: String
    ) -> some View {
        Text(title)
            .accessibilityIdentifier(accessibilityIdentifier)
    }

    private func informationRow(_ item: TrailMindAboutItem) -> some View {
        rowContent(
            title: item.title,
            detail: item.detail,
            symbol: item.symbol
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.title). \(item.detail)")
        .accessibilityIdentifier(item.id)
    }

    private func creditRow(_ credit: TrailMindAboutCredit) -> some View {
        Link(destination: credit.destination) {
            rowContent(
                title: credit.title,
                detail: credit.detail,
                symbol: credit.symbol,
                trailingSymbol: "arrow.up.right.square"
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(credit.title). \(credit.detail)")
        .accessibilityHint("Opens the provider's official attribution and licence information.")
        .accessibilityIdentifier(credit.id)
    }

    private func rowContent(
        title: String,
        detail: String,
        symbol: String,
        trailingSymbol: String? = nil
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

            Spacer(minLength: 8)

            if let trailingSymbol {
                Image(systemName: trailingSymbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.forest)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 4)
    }
}
