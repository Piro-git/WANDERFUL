import SwiftUI

struct AppLanguageSelectionView: View {
    @Environment(TrailTheme.self) private var theme
    @Environment(AppLanguageController.self) private var languageController
    @State private var selectedLanguage: AppLanguage

    init(initialLanguage: AppLanguage = .systemDefault) {
        _selectedLanguage = State(initialValue: initialLanguage)
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 48)

            Image(systemName: "figure.hiking")
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(theme.forestBright)
                .accessibilityHidden(true)

            Text("Choose your language")
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(theme.graphite)
                .padding(.top, 24)

            Text("You can change this any time in Profile.")
                .font(.subheadline)
                .foregroundStyle(theme.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.top, 14)

            VStack(spacing: 12) {
                languageButton(.german, subtitle: "Die App auf Deutsch nutzen")
                languageButton(.english, subtitle: "Use the app in English")
            }
            .padding(.top, 36)

            Spacer()

            Button {
                languageController.select(selectedLanguage)
            } label: {
                Text("Continue")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(LanguagePrimaryButtonStyle(theme: theme))
            .accessibilityIdentifier("languageSelection.continue")
            .padding(.bottom, 28)
        }
        .padding(.horizontal, 24)
        .background(TrailBackground())
        .onAppear {
            selectedLanguage = languageController.language
        }
    }

    private func languageButton(_ language: AppLanguage, subtitle: LocalizedStringKey) -> some View {
        Button {
            selectedLanguage = language
        } label: {
            HStack(spacing: 14) {
                Image(systemName: selectedLanguage == language ? "largecircle.fill.circle" : "circle")
                    .font(.title2)
                    .foregroundStyle(selectedLanguage == language ? theme.forestBright : theme.secondaryText)
                VStack(alignment: .leading, spacing: 3) {
                    Text(language.displayName)
                        .font(.headline)
                        .foregroundStyle(theme.graphite)
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(theme.secondaryText)
                }
                Spacer()
            }
            .padding(18)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(selectedLanguage == language ? theme.forestBright : .clear, lineWidth: 2)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("languageSelection.\(language.rawValue)")
        .accessibilityAddTraits(selectedLanguage == language ? .isSelected : [])
    }
}

private struct LanguagePrimaryButtonStyle: ButtonStyle {
    let theme: TrailTheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(theme.onBrandPrimary)
            .padding(.vertical, 16)
            .background(theme.forestBright, in: Capsule())
            .opacity(configuration.isPressed ? 0.72 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}
