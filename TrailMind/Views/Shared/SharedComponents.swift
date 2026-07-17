import SwiftUI

struct PrimaryButton: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    var symbol: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let symbol {
                    Image(systemName: symbol)
                }
                Text(title)
            }
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .frame(minHeight: 56)
            .background(theme.forest, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

struct SecondaryButton: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    var symbol: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                if let symbol {
                    Image(systemName: symbol)
                }
                Text(title)
            }
            .font(.headline)
            .foregroundStyle(theme.forest)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .frame(minHeight: 54)
            .background(theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(theme.forest.opacity(0.12), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }
}

struct SectionHeader: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.trailSection)
                .foregroundStyle(theme.graphite)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(theme.secondaryText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct StatPill: View {
    @Environment(TrailTheme.self) private var theme
    let value: String
    let label: String
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(theme.moss)
            Text(value)
                .font(.headline)
                .foregroundStyle(theme.graphite)
            Text(label)
                .font(.caption)
                .foregroundStyle(theme.secondaryText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct DifficultyBadge: View {
    @Environment(TrailTheme.self) private var theme
    let difficulty: RouteDifficulty

    var body: some View {
        Label(difficulty.rawValue, systemImage: difficulty.symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(theme.forest)
            .padding(.horizontal, 11)
            .padding(.vertical, 7)
            .background(theme.mossSoft.opacity(0.72), in: Capsule())
    }
}

struct EmptyStateView: View {
    @Environment(TrailTheme.self) private var theme
    let title: String
    let message: String
    let symbol: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: symbol)
                .font(.system(size: 38))
                .foregroundStyle(theme.moss)
            Text(title)
                .font(.trailSection)
            Text(message)
                .multilineTextAlignment(.center)
                .foregroundStyle(theme.secondaryText)
        }
        .padding(32)
        .frame(maxWidth: .infinity)
        .trailCard()
    }
}
