import SwiftUI

struct HikingProfileSummaryView: View {
    @Environment(TrailTheme.self) private var theme
    let profile: HikingPreferenceProfileV1

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Your Trail Profile", systemImage: "figure.hiking")
                .font(.headline)
                .foregroundStyle(theme.graphite)

            summaryRow("Activity", value: profile.defaultActivity?.displayName)
            summaryRow("Comfortable day", value: profile.comfortableOuting?.displayName)
            summaryRow("Route shape", value: profile.preferredRouteShape?.displayName)
            summaryRow(
                "Show me more of",
                value: Self.collectionSummary(profile.requestedExperiences?.map(\.displayName))
            )
            summaryRow(
                "Prefer to avoid",
                value: Self.collectionSummary(profile.softAvoidances?.map(\.displayName))
            )

            Divider()

            Text("These are defaults, not rules. A route request you make now always wins.")
                .font(.caption)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 6)
        .accessibilityIdentifier("profile.trailProfile.summary")
    }

    private func summaryRow(_ title: String, value: String?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .font(.subheadline)
                .foregroundStyle(theme.secondaryText)
            Spacer(minLength: 12)
            Text(value ?? "Not set yet")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(theme.graphite)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(value ?? "not set yet")")
    }

    private static func collectionSummary(_ values: [String]?) -> String? {
        guard let values else { return nil }
        return values.isEmpty ? "None selected" : values.joined(separator: ", ")
    }
}

struct HikingProfileEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(TrailTheme.self) private var theme
    @State private var draft: HikingPreferenceProfileV1
    @State private var isSaving = false
    @State private var validationMessage: String?
    let onSave: (HikingPreferenceProfileV1) async -> Bool

    init(
        profile: HikingPreferenceProfileV1,
        onSave: @escaping (HikingPreferenceProfileV1) async -> Bool
    ) {
        _draft = State(initialValue: profile)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    optionalActivityPicker
                    comfortChoices
                    optionalRouteShapePicker
                } header: {
                    Text("Your usual day")
                } footer: {
                    Text("Choose only what feels useful. “I don’t know yet” stays unknown.")
                }

                collectionSection(
                    title: "Show me more of",
                    isKnown: draft.requestedExperiences != nil,
                    unknownAction: { draft.requestedExperiences = nil },
                    chooseAction: { draft.requestedExperiences = draft.requestedExperiences ?? [] }
                ) {
                    ForEach(HikingRequestedExperienceV1.allCases, id: \.self) { experience in
                        Toggle(experience.displayName, isOn: experienceBinding(experience))
                    }
                }

                collectionSection(
                    title: "Prefer to avoid",
                    isKnown: draft.softAvoidances != nil,
                    unknownAction: { draft.softAvoidances = nil },
                    chooseAction: { draft.softAvoidances = draft.softAvoidances ?? [] }
                ) {
                    ForEach(HikingSoftAvoidanceV1.allCases, id: \.self) { avoidance in
                        Toggle(avoidance.displayName, isOn: avoidanceBinding(avoidance))
                    }
                }

                Section {
                    Text("Preferences remain requests until route evidence verifies them. They never guarantee scenery, access, conditions, difficulty, or safety.")
                        .font(.footnote)
                        .foregroundStyle(theme.secondaryText)
                } header: {
                    Text("Good to know")
                }

                if let validationMessage {
                    Section {
                        Label(validationMessage, systemImage: "exclamationmark.circle")
                            .foregroundStyle(.red)
                            .accessibilityIdentifier("profile.editor.error")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(TrailBackground())
            .navigationTitle("Edit Trail Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                    }
                    .disabled(isSaving)
                    .accessibilityIdentifier("profile.editor.save")
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
    }

    private var optionalActivityPicker: some View {
        Picker("Activity", selection: $draft.defaultActivity) {
            Text("I don’t know yet").tag(nil as HikingProfileActivityV1?)
            ForEach(HikingProfileActivityV1.allCases, id: \.self) { activity in
                Text(activity.displayName).tag(Optional(activity))
            }
        }
        .accessibilityIdentifier("profile.editor.activity")
    }

    private var comfortChoices: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Comfortable day")
                .font(.subheadline)

            if let current = draft.comfortableOuting,
               !ComfortPreset.allCases.contains(where: { $0.value == current }) {
                selectionButton(
                    title: current.displayName,
                    subtitle: "Current custom range",
                    isSelected: true
                ) {}
            }

            ForEach(ComfortPreset.allCases) { preset in
                selectionButton(
                    title: preset.title,
                    subtitle: preset.subtitle,
                    isSelected: draft.comfortableOuting == preset.value
                ) {
                    draft.comfortableOuting = preset.value
                }
            }

            selectionButton(
                title: "I don’t know yet",
                subtitle: "Leave distance and time open",
                isSelected: draft.comfortableOuting == nil
            ) {
                draft.comfortableOuting = nil
            }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("profile.editor.comfort")
    }

    private var optionalRouteShapePicker: some View {
        Picker("Route shape", selection: $draft.preferredRouteShape) {
            Text("I don’t know yet").tag(nil as HikingPreferredRouteShapeV1?)
            ForEach(HikingPreferredRouteShapeV1.allCases, id: \.self) { shape in
                Text(shape.displayName).tag(Optional(shape))
            }
        }
        .accessibilityIdentifier("profile.editor.routeShape")
    }

    @ViewBuilder
    private func collectionSection<Content: View>(
        title: String,
        isKnown: Bool,
        unknownAction: @escaping () -> Void,
        chooseAction: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) -> some View {
        Section {
            Picker(
                "Answer",
                selection: Binding(
                    get: { isKnown },
                    set: { $0 ? chooseAction() : unknownAction() }
                )
            ) {
                Text("I don’t know yet").tag(false)
                Text("Choose preferences").tag(true)
            }
            .pickerStyle(.segmented)

            if isKnown {
                content()
            }
        } header: {
            Text(title)
        }
    }

    private func selectionButton(
        title: String,
        subtitle: String,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(theme.secondaryText)
                }
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? theme.forest : theme.secondaryText)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func experienceBinding(_ experience: HikingRequestedExperienceV1) -> Binding<Bool> {
        Binding(
            get: { draft.requestedExperiences?.contains(experience) == true },
            set: { isSelected in
                var values = draft.requestedExperiences ?? []
                values.removeAll { $0 == experience }
                if isSelected { values.append(experience) }
                draft.requestedExperiences = values
            }
        )
    }

    private func avoidanceBinding(_ avoidance: HikingSoftAvoidanceV1) -> Binding<Bool> {
        Binding(
            get: { draft.softAvoidances?.contains(avoidance) == true },
            set: { isSelected in
                var values = draft.softAvoidances ?? []
                values.removeAll { $0 == avoidance }
                if isSelected { values.append(avoidance) }
                draft.softAvoidances = values
            }
        )
    }

    private func save() {
        do {
            try HikingPreferenceProfileValidatorV1.validate(draft)
        } catch {
            validationMessage = "One or more choices are outside the supported range."
            return
        }

        isSaving = true
        validationMessage = nil
        Task {
            let didSave = await onSave(draft)
            isSaving = false
            if didSave {
                dismiss()
            } else {
                validationMessage = "Your changes could not be saved. Please try again."
            }
        }
    }
}

private struct ComfortPreset: Identifiable, CaseIterable {
    let id: String
    let title: String
    let subtitle: String
    let value: HikingComfortableOutingV1

    static let allCases = [
        Self(
            id: "short-distance",
            title: "5–10 km",
            subtitle: "A shorter outing",
            value: .distanceKilometers(minimum: 5, maximum: 10)
        ),
        Self(
            id: "day-distance",
            title: "10–15 km",
            subtitle: "A balanced day hike",
            value: .distanceKilometers(minimum: 10, maximum: 15)
        ),
        Self(
            id: "long-distance",
            title: "15–25 km",
            subtitle: "A longer day outside",
            value: .distanceKilometers(minimum: 15, maximum: 25)
        ),
        Self(
            id: "short-duration",
            title: "1–2 hours",
            subtitle: "Plan by time",
            value: .durationMinutes(minimum: 60, maximum: 120)
        ),
        Self(
            id: "half-day-duration",
            title: "2–4 hours",
            subtitle: "A relaxed half day",
            value: .durationMinutes(minimum: 120, maximum: 240)
        ),
        Self(
            id: "full-day-duration",
            title: "4–7 hours",
            subtitle: "A fuller day outside",
            value: .durationMinutes(minimum: 240, maximum: 420)
        )
    ]
}

private extension HikingProfileActivityV1 {
    var displayName: String {
        switch self {
        case .hiking: "Hiking"
        case .trailRunning: "Trail running"
        case .biking: "Biking"
        }
    }
}

private extension HikingComfortableOutingV1 {
    var displayName: String {
        switch self {
        case let .distanceKilometers(minimum, maximum):
            "\(Self.number(minimum))–\(Self.number(maximum)) km"
        case let .durationMinutes(minimum, maximum):
            "\(Self.duration(minimum))–\(Self.duration(maximum))"
        }
    }

    static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(value.rounded() == value ? 0 : 1)))
    }

    static func duration(_ minutes: Int) -> String {
        if minutes % 60 == 0 { return "\(minutes / 60) hr" }
        return "\(minutes) min"
    }
}

private extension HikingPreferredRouteShapeV1 {
    var displayName: String {
        switch self {
        case .loop: "Loop"
        case .pointToPoint: "Point to point"
        }
    }
}

private extension HikingRequestedExperienceV1 {
    var displayName: String {
        switch self {
        case .viewpoints: "Viewpoints"
        case .forest: "Forests"
        case .quietNature: "Quiet nature"
        case .waterfalls: "Waterfalls"
        case .lakes: "Lakes"
        case .peaks: "Peaks"
        case .huts: "Huts"
        case .landmarks: "Culture & landmarks"
        }
    }
}

private extension HikingSoftAvoidanceV1 {
    var displayName: String {
        switch self {
        case .steepClimbs: "Steep climbs"
        case .majorRoads: "Major-road walking"
        case .repeatedSections: "Repeated sections"
        }
    }
}
