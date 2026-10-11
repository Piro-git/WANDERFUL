import SwiftUI

/// Route adapter stays outside the planning models and engine.
private extension TrailRoute {
    var preparationInput: PreparationInput {
        .init(routeID: id, isHiking: activity == .hiking, distanceKM: distanceKilometers, durationHours: durationHours)
    }
}

struct HikePreparationCard: View {
    let route: TrailRoute
    @Environment(TrailTheme.self) private var theme
    @Environment(\.locale) private var locale
    @State private var selected: TrailRoute?
    @State private var progress: (packed: Int, total: Int)?
    @State private var loadFailed = false
    var body: some View {
        Button { selected = route } label: {
            HStack(spacing: 16) {
                Image(systemName: "backpack.fill").font(.title).foregroundStyle(theme.forest)
                VStack(alignment: .leading, spacing: 5) {
                    Text(LocalizedStringKey(route.activity == .hiking ? "Prepare for this hike" : "Prepare for this trip")).font(.headline)
                    Group {
                        if loadFailed { Text("Open to review your saved list.") }
                        else if let progress, progress.total > 0 { Text("\(progress.packed) of \(progress.total) packed") }
                        else { Text("Your list & departure checks") }
                    }.font(.subheadline).foregroundStyle(theme.secondaryText)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").accessibilityHidden(true)
            }
            .padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.mossSoft, in: RoundedRectangle(cornerRadius: 24))
        }
        .buttonStyle(.plain)
        .sheet(item: $selected, onDismiss: refresh) { selectedRoute in
            HikePreparationView(route: selectedRoute)
        }
        .task(id: route) { refresh() }
        .accessibilityIdentifier("route.preparation")
    }
    private func refresh() {
        guard let state = try? PreparationStore().load(route.preparationInput) else {
            loadFailed = true
            return
        }
        let items = PreparationCatalogue.items(for: route.preparationInput, stay: state.stay) + (state.enrichment?.items ?? []) + state.customItems
        loadFailed = false
        progress = state.progress(items: items)
    }
}

struct HikePreparationView: View {
    let route: TrailRoute
    @Environment(TrailTheme.self) private var theme
    @Environment(\.locale) private var locale
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var state: PreparationState
    @State private var loaded = false
    @State private var enriching = false
    @State private var enrichmentMessage: String?
    @State private var blocked = false
    @State private var error: String?
    @State private var editor: PreparationItem?
    @State private var draft = ""
    private let store = PreparationStore()

    init(route: TrailRoute) {
        self.route = route
        _state = State(initialValue: PreparationState(routeID: route.id))
    }
    private var items: [PreparationItem] { PreparationCatalogue.items(for: route.preparationInput, stay: state.stay) + (state.enrichment?.items ?? []) + state.customItems }
    private var progress: (packed: Int, total: Int) { state.progress(items: items) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(route.title).font(.title2.bold())
                        Text("\(route.distanceKilometers.formatted(.number.precision(.fractionLength(1)).locale(locale))) km · \(route.durationHours.formatted(.number.precision(.fractionLength(1)).locale(locale))) hr")
                            .font(.subheadline).foregroundStyle(theme.secondaryText)
                        Text(LocalizedStringKey(progress.total > 0 && progress.packed == progress.total ? "Packing list complete" : "One thing at a time."))
                            .font(.headline).foregroundStyle(theme.forest)
                        Text("\(progress.packed) of \(progress.total) packed").font(.subheadline.monospacedDigit())
                        ProgressView(value: Double(progress.packed), total: Double(max(1, progress.total)))
                            .tint(theme.forest).accessibilityLabel("Packing progress")
                            .accessibilityValue("\(progress.packed) of \(progress.total) packed")
                    }.padding(.vertical, 8)
                }.listRowBackground(theme.mossSoft)
                if let error {
                    Section { Text(LocalizedStringKey(error)).foregroundStyle(theme.warning) }
                }
                if route.activity == .hiking {
                    Section {
                        Picker("Trip style", selection: $state.stay) {
                            ForEach(PreparationStay.allCases) { Text(LocalizedStringKey($0.rawValue)).tag($0) }
                        }
                        .accessibilityIdentifier("preparation.stay")
                        .onChange(of: state.stay) { _, _ in
                            state = PreparationCatalogue.reconcile(state, input: route.preparationInput)
                            persist()
                        }
                        if route.days.count > 1 && state.stay == .day {
                            Text("This route has multiple days. Choose an overnight style if you plan to stay out.").font(.footnote)
                        }
                    } header: { Text("Your plan") } footer: { Text("Day hike is the starting list. Change this to match your plans.") }
                } else {
                    Section { Text("Add the equipment you need for your activity. The suggested list is designed for hiking.") }
                }
                if route.activity == .hiking && route.isVerifiedRoutedResult { personalization }
                if state.revisionNotice {
                    Section {
                        Label("Your plan added items. Take a fresh look below.", systemImage: "plus.circle")
                        Button("Got it") { state.revisionNotice = false; persist() }
                    }
                }
                ForEach(PreparationGroup.allCases, id: \.self) { group in
                    let grouped = items.filter { $0.group == group && state.status($0.id) != .excluded }
                    if !grouped.isEmpty {
                        Section(LocalizedStringKey(group.rawValue)) {
                            ForEach(grouped) { item in
                                PreparationRow(item: item, packed: state.status(item.id) == .packed,
                                    toggle: { toggle(item) }, exclude: { state.statuses[item.id] = .excluded; persist() },
                                    edit: item.id.hasPrefix("custom.") ? { editor = item; draft = item.label } : nil)
                            }
                        }
                    }
                }
                Section {
                    Button { draft = ""; editor = .init(id: "new", label: "", reason: "", group: .personal, source: nil) } label: {
                        Label("Add your own item", systemImage: "plus.circle.fill").frame(minHeight: 44)
                    }
                    let excluded = items.filter { state.status($0.id) == .excluded }
                    if !excluded.isEmpty {
                        DisclosureGroup("Not needed · \(excluded.count)") {
                            ForEach(excluded) { item in
                                Button("Restore \(item.localizedLabel(locale: locale))") { state.statuses[item.id] = .unpacked; persist() }.frame(minHeight: 44)
                            }
                        }
                    }
                } footer: { Text("Not needed items are left out of packing progress. Restore them whenever plans change.") }
                beforeYouGo
                Section("About this list") {
                    Text("General guidance with your trip choices. Conditions, water, access and overnight availability have not been checked here. Review checks again before every departure.").font(.footnote)
                    ForEach(PreparationSource.allCases, id: \.self) { source in Link(LocalizedStringKey(source.title), destination: source.url) }
                }
            }
            .disabled(!loaded || blocked)
            .scrollContentBackground(.hidden).background(theme.warmWhite)
            .tint(theme.forest)
            .navigationTitle("Pack & prepare").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task {
                do { state = try store.load(route.preparationInput) }
                catch { blocked = true; self.error = "Your saved list could not be read. It has been kept unchanged. Close and try again after updating the app." }
                loaded = true
            }
            .alert(LocalizedStringKey(editor?.id == "new" ? "Add an item" : "Edit item"), isPresented: Binding(get: { editor != nil }, set: { if !$0 { editor = nil } })) {
                TextField("Item name", text: $draft)
                Button("Save") { saveItem() }.disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let editor, editor.id != "new" {
                    Button("Delete", role: .destructive) {
                        state.customItems.removeAll { $0.id == editor.id }; state.statuses.removeValue(forKey: editor.id); persist(); self.editor = nil
                    }
                }
                Button("Cancel", role: .cancel) { editor = nil }
            }
        }
    }
    private var personalization: some View {
        Section {
            Text("Optional suggestions use only your selected trip style and mapped distance and duration.")
                .font(.subheadline)
            Button(LocalizedStringKey(enriching ? "Getting suggestions…" : "Suggest extras with AI"), systemImage: "sparkles") {
                enriching = true
                enrichmentMessage = nil
                Task {
                    defer { enriching = false }
                    do {
                        state.enrichment = try await PreparationPersonalizationClient().suggestions(input: route.preparationInput, stay: state.stay)
                        state = PreparationCatalogue.reconcile(state, input: route.preparationInput)
                        persist()
                        enrichmentMessage = "Review the optional additions before packing."
                    } catch {
                        enrichmentMessage = "AI suggestions are unavailable. Your packing list is unchanged."
                    }
                }
            }
            .disabled(enriching)
            if let enrichmentMessage { Text(LocalizedStringKey(enrichmentMessage)).font(.footnote).foregroundStyle(theme.secondaryText) }
        } header: { Text("A little more personal") }
        footer: { Text("No weather, water, access, campsite or safety claim is generated. Departure date and personal needs are not shared.") }
    }

    private var beforeYouGo: some View {
        Section {
            if let enrichment = state.enrichment, !enrichment.checks.isEmpty {
                ForEach(enrichment.checks, id: \.self) { check in
                    Label(LocalizedStringKey(check.text), systemImage: "sparkles")
                }
            }
            Label("Check the latest forecast", systemImage: "cloud.sun")
            Label("Check local rules & trail conditions", systemImage: "signpost.right")
            Label("Confirm water availability & your supply", systemImage: "drop")
            Label("Share your route & expected return", systemImage: "person.2")
            if state.stay != .day {
                Label(LocalizedStringKey(state.stay == .camping ? "Confirm camping permission & food storage rules" : "Confirm hut booking, meals & bedding"), systemImage: "moon")
            }
        } header: { Text("Before you go") } footer: { Text("General checks · separate from your packing list. Mapped route statistics above do not confirm current conditions.") }
    }
    private func toggle(_ item: PreparationItem) {
        withAnimation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 0.8)) {
            state.statuses[item.id] = state.status(item.id) == .packed ? .unpacked : .packed
        }
        persist()
    }
    private func persist() {
        guard loaded, !blocked else { return }
        do { try store.save(state); error = nil }
        catch { self.error = "Changes could not be saved. Please try again." }
    }
    private func saveItem() {
        guard let editor else { return }
        if editor.id == "new" { state.add(draft) }
        else if let index = state.customItems.firstIndex(where: { $0.id == editor.id }) {
            state.customItems[index].label = String(draft.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
        }
        persist(); self.editor = nil
    }
}

private struct PreparationRow: View {
    let item: PreparationItem
    let packed: Bool
    let toggle: () -> Void
    let exclude: () -> Void
    let edit: (() -> Void)?
    @Environment(TrailTheme.self) private var theme
    @Environment(\.locale) private var locale
    @State private var showReason = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Button(action: toggle) {
                    HStack(spacing: 12) {
                        Image(systemName: packed ? "checkmark.circle.fill" : "circle").font(.title2).foregroundStyle(theme.forest)
                        Text(item.localizedLabel(locale: locale)).strikethrough(packed).foregroundStyle(packed ? theme.secondaryText : theme.graphite)
                        Spacer(minLength: 0)
                    }.frame(minHeight: 48).contentShape(Rectangle())
                }.buttonStyle(.plain)
                .accessibilityLabel(item.localizedLabel(locale: locale)).accessibilityValue(Text(LocalizedStringKey(packed ? "Packed" : "Not packed")))
                .accessibilityIdentifier("preparation.item." + item.id)
                .accessibilityHint(Text(LocalizedStringKey(packed ? "Double tap to unpack" : "Double tap to pack")))
                Button { showReason.toggle() } label: { Image(systemName: "info.circle").frame(width: 44, height: 44) }
                    .buttonStyle(.plain).accessibilityLabel(Text("Reason for \(item.localizedLabel(locale: locale))"))
                Menu {
                    Button("Not needed", action: exclude)
                    if let edit { Button("Edit item", action: edit) }
                } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }
                    .accessibilityLabel(Text("Options for \(item.localizedLabel(locale: locale))"))
            }
            if showReason {
                Text(LocalizedStringKey(item.reason)).font(.footnote).foregroundStyle(theme.secondaryText)
                if let source = item.source { Link(LocalizedStringKey(source.title), destination: source.url).font(.caption).frame(minHeight: 44) }
            }
        }
    }
}

#if DEBUG
#Preview("Day hike · preparation") {
    HikePreparationView(route: MockRoutes.luneburgLoop).environment(TrailTheme())
        .environment(AppLanguageController())
}
#Preview("Multiple days · large text") {
    HikePreparationView(route: MockRoutes.harzWeekend).environment(TrailTheme())
        .environment(AppLanguageController())
        .environment(\.dynamicTypeSize, .accessibility3)

}
#endif
