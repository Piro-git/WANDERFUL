import Foundation
import Observation

/// The language used by Wanderful's interface. It intentionally does not affect
/// route prompts, place names, or content returned by external providers.
enum AppLanguage: String, CaseIterable, Identifiable, Sendable {
    case german = "de"
    case english = "en"

    var id: String { rawValue }

    var locale: Locale {
        Locale(identifier: rawValue)
    }

    var displayName: String {
        switch self {
        case .german: "Deutsch"
        case .english: "English"
        }
    }

    static var systemDefault: AppLanguage {
        let identifier = Locale.autoupdatingCurrent.language.languageCode?.identifier
            ?? Locale.autoupdatingCurrent.identifier
        return identifier.lowercased().hasPrefix("de") ? .german : .english
    }
}

@Observable
final class AppLanguageController {
    static let storageKey = "wanderful.interfaceLanguage"
    static let didChooseLanguageStorageKey = "wanderful.didChooseInterfaceLanguage"

    private let defaults: UserDefaults
    private(set) var language: AppLanguage

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.language = AppLanguage(rawValue: defaults.string(forKey: Self.storageKey) ?? "")
            ?? .systemDefault
    }

    var hasChosenLanguage: Bool {
        defaults.bool(forKey: Self.didChooseLanguageStorageKey)
    }

    func select(_ language: AppLanguage) {
        self.language = language
        defaults.set(language.rawValue, forKey: Self.storageKey)
        defaults.set(true, forKey: Self.didChooseLanguageStorageKey)
    }
}
