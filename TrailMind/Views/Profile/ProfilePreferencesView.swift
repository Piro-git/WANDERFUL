import SwiftUI

struct ProfilePreferencesView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(AppModel.self) private var appModel
    @State private var isEditingTrailProfile = false
    @State private var isConfirmingReset = false
    @State private var isConfirmingDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    profileHeader
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }

                Section {
                    if let profile = appModel.hikingProfile {
                        HikingProfileSummaryView(profile: profile)

                        Button("Edit Trail Profile", systemImage: "slider.horizontal.3") {
                            isEditingTrailProfile = true
                        }
                        .accessibilityIdentifier("profile.trailProfile.edit")

                        Button("Reset answers", systemImage: "arrow.counterclockwise") {
                            isConfirmingReset = true
                        }
                        .accessibilityIdentifier("profile.trailProfile.reset")

                        Button("Delete Trail Profile", systemImage: "trash", role: .destructive) {
                            isConfirmingDelete = true
                        }
                        .accessibilityIdentifier("profile.trailProfile.delete")
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("No Trail Profile saved")
                                .font(.headline)
                                .foregroundStyle(theme.graphite)
                            Text("Add only the defaults that make planning easier. You can leave every answer unknown.")
                                .font(.subheadline)
                                .foregroundStyle(theme.secondaryText)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 4)

                        Button("Create Trail Profile", systemImage: "plus.circle.fill") {
                            isEditingTrailProfile = true
                        }
                        .accessibilityIdentifier("profile.trailProfile.create")
                    }

                    if let message = appModel.hikingProfileStatusMessage {
                        Label(message, systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(theme.secondaryText)
                            .accessibilityIdentifier("profile.trailProfile.status")
                    }

                    if appModel.hikingProfileRecoveryRequired {
                        Button("Discard unreadable local record", systemImage: "trash") {
                            Task { await appModel.discardUnreadableHikingProfileData() }
                        }
                        .accessibilityIdentifier("profile.trailProfile.recover")
                    }
                } header: {
                    sectionHeader(
                        "Planning defaults",
                        accessibilityIdentifier: "profile.trailProfile.section"
                    )
                } footer: {
                    Text("Saved only on this iPhone. Remote sync is not active in V1.")
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
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $isEditingTrailProfile) {
                HikingProfileEditorView(
                    profile: appModel.hikingProfile ?? HikingPreferenceProfileV1()
                ) { profile in
                    await appModel.saveHikingProfileEdit(profile)
                }
            }
            .alert("Reset your answers?", isPresented: $isConfirmingReset) {
                Button("Cancel", role: .cancel) {}
                Button("Reset", role: .destructive) {
                    Task { await appModel.resetHikingProfile() }
                }
            } message: {
                Text("Your Trail Profile will stay available, but every planning preference will return to “Not set yet.”")
            }
            .alert("Delete your Trail Profile?", isPresented: $isConfirmingDelete) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    Task { await appModel.deleteHikingProfile() }
                }
            } message: {
                Text("This removes the local profile and its resumable draft from this iPhone. Remote sync is not active in V1. Your saved routes are not affected.")
            }
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
