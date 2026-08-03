import SwiftUI

#if DEBUG
struct RouteEditAIView: View {
    @Environment(TrailTheme.self) private var theme
    @FocusState private var isInputFocused: Bool
    @State private var model: RouteEditViewModel

    private let quickActions = [
        ("Make shorter", "arrow.down.right.and.arrow.up.left"),
        ("More scenic", "binoculars.fill"),
        ("Less elevation", "mountain.2.fill"),
        ("Add water stop", "drop.fill"),
        ("Split into 2 days", "calendar")
    ]

    init(route: TrailRoute) {
        _model = State(initialValue: RouteEditViewModel(route: route))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    CurrentRouteSummary(route: model.route)
                        .padding(.bottom, 6)

                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 9) {
                            ForEach(quickActions, id: \.0) { title, symbol in
                                QuickActionChip(title: title, symbol: symbol) {
                                    Task { await model.send(title) }
                                }
                            }
                        }
                    }
                    .contentMargins(.horizontal, TrailSpacing.page, for: .scrollContent)
                    .contentMargins(.horizontal, -TrailSpacing.page)

                    ForEach(model.messages) { message in
                        ChatBubble(message: message)
                            .id(message.id)
                    }

                    if model.isWorking {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Rebalancing your route…")
                                .font(.subheadline)
                                .foregroundStyle(theme.secondaryText)
                            Spacer()
                        }
                        .padding(.horizontal, 4)
                    }
                }
                .padding(TrailSpacing.page)
            }
            .background(TrailBackground())
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) {
                inputBar
            }
            .onChange(of: model.messages.count) {
                guard let last = model.messages.last else { return }
                withAnimation(.smooth) {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
        .navigationTitle("Route copilot")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField(
                "Ask for a route change",
                text: Binding(
                    get: { model.draft },
                    set: { model.draft = $0 }
                ),
                axis: .vertical
            )
            .lineLimit(1...4)
            .focused($isInputFocused)
            .submitLabel(.send)
            .onSubmit {
                Task { await model.send(model.draft) }
            }

            Button {
                Task { await model.send(model.draft) }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(theme.forest, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isWorking)
            .accessibilityIdentifier("copilot.send")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }
}

private struct CurrentRouteSummary: View {
    @Environment(TrailTheme.self) private var theme
    let route: TrailRoute

    var body: some View {
        HStack(spacing: 14) {
            MiniRouteGlyph(route: route)
                .frame(width: 88, height: 82)
                .background(theme.mossSoft.opacity(0.5), in: RoundedRectangle(cornerRadius: 18, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                Text("CURRENT ROUTE")
                    .font(.caption2.weight(.bold))
                    .tracking(1)
                    .foregroundStyle(theme.moss)
                Text(route.title)
                    .font(.headline)
                    .lineLimit(2)
                Text("\(route.distanceLabel) · +\(route.elevationLabel) · \(route.durationLabel)")
                    .font(.caption)
                    .foregroundStyle(theme.secondaryText)
            }
            Spacer()
        }
        .trailCard()
    }
}

struct ChatBubble: View {
    @Environment(TrailTheme.self) private var theme
    let message: RouteEditViewModel.Message

    var body: some View {
        HStack {
            if message.kind == .user {
                Spacer(minLength: 50)
            }

            VStack(alignment: .leading, spacing: 7) {
                if message.kind == .copilot {
                    Label("Wanderful", systemImage: "sparkles")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(theme.moss)
                }
                Text(message.text)
                    .font(.body)
                    .foregroundStyle(message.kind == .user ? .white : theme.graphite)
            }
            .padding(15)
            .background(
                message.kind == .user ? theme.forest : theme.surface,
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
            )
            .shadow(color: theme.forest.opacity(message.kind == .user ? 0 : 0.06), radius: 10, y: 5)

            if message.kind == .copilot {
                Spacer(minLength: 32)
            }
        }
    }
}

struct QuickActionChip: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(theme.forest)
                .padding(.horizontal, 12)
                .frame(height: 38)
                .background(theme.mossSoft.opacity(0.64), in: Capsule())
        }
        .buttonStyle(.plain)
    }
}
#endif
