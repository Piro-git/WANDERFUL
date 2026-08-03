import Foundation

#if canImport(SuperwallKit)
import SuperwallKit
#endif

enum SuperwallConfiguration {
    static let apiKeyInfoDictionaryKey = "SUPERWALL_API_KEY"
    static let onboardingPlacement = "onboarding_start"
    static let onboardingCompletionCallback = "wanderful_onboarding_complete"

    static func publicAPIKey(bundle: Bundle = .main) -> String? {
        normalizedPublicAPIKey(
            bundle.object(forInfoDictionaryKey: apiKeyInfoDictionaryKey)
        )
    }

    static func normalizedPublicAPIKey(_ rawValue: Any?) -> String? {
        guard let rawValue = rawValue as? String else { return nil }
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty,
              value.hasPrefix("pk_"),
              value.count > 3,
              !value.contains("$("),
              value != "pk_your_public_key"
        else {
            return nil
        }
        return value
    }

    static func isAutomation(arguments: [String] = ProcessInfo.processInfo.arguments) -> Bool {
#if DEBUG
        arguments.contains("--trailmind-ui-testing") ||
            arguments.contains("--trailmind-staging-proof")
#else
        false
#endif
    }
}

enum SuperwallOnboardingPreferenceMapper {
    static let requiredAttributeKeys = [
        "onboarding_activity",
        "onboarding_distance_km",
        "onboarding_effort",
        "onboarding_interest_views",
        "onboarding_interest_forest",
        "onboarding_interest_quiet_paths",
        "onboarding_interest_waterfalls"
    ]

    static func hasCompletePayload(_ attributes: [String: Any]) -> Bool {
        guard let activity = string(attributes["onboarding_activity"])?.lowercased(),
              ["hiking", "trail_running", "trail running", "trail-running", "biking", "cycling"]
                .contains(activity),
              let distance = number(attributes["onboarding_distance_km"]),
              distance > 0,
              let effort = string(attributes["onboarding_effort"])?.lowercased(),
              ["easy", "easygoing", "moderate", "balanced", "challenging", "push_me", "push me"]
                .contains(effort)
        else {
            return false
        }

        return requiredAttributeKeys
            .filter { $0.hasPrefix("onboarding_interest_") }
            .allSatisfy { bool(attributes[$0]) != nil }
    }

    static func merging(
        attributes: [String: Any],
        into current: UserPreferences
    ) -> UserPreferences {
        var preferences = current

        if let activity = string(attributes["onboarding_activity"]) {
            switch activity.lowercased() {
            case "hiking": preferences.preferredActivity = .hiking
            case "trail_running", "trail running", "trail-running":
                preferences.preferredActivity = .trailRunning
            case "biking", "cycling": preferences.preferredActivity = .biking
            default: break
            }
        }

        if let distance = number(attributes["onboarding_distance_km"]), distance > 0 {
            preferences.preferredDistanceKilometers = distance
        }

        if let effort = string(attributes["onboarding_effort"]) {
            switch effort.lowercased() {
            case "easy", "easygoing": preferences.fitnessLevel = .easy
            case "moderate", "balanced": preferences.fitnessLevel = .moderate
            case "challenging", "push_me", "push me":
                preferences.fitnessLevel = .challenging
            default: break
            }
            preferences.avoidsSteepClimbs = preferences.fitnessLevel == .easy
        }

        let interestMappings = [
            "onboarding_interest_views": "Views",
            "onboarding_interest_forest": "Forest",
            "onboarding_interest_quiet_paths": "Quiet paths",
            "onboarding_interest_waterfalls": "Waterfalls"
        ]
        let hasInterestAttribute = interestMappings.keys.contains { attributes[$0] != nil }
        if hasInterestAttribute {
            preferences.interests = Set(
                interestMappings.compactMap { key, title in
                    bool(attributes[key]) == true ? title : nil
                }
            )
        }

        return preferences
    }

    private static func string(_ value: Any?) -> String? {
        (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func number(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? NSNumber { return value.doubleValue }
        if let value = string(value) { return Double(value) }
        return nil
    }

    private static func bool(_ value: Any?) -> Bool? {
        if let value = value as? Bool { return value }
        if let value = value as? NSNumber { return value.boolValue }
        if let value = string(value) {
            switch value.lowercased() {
            case "true", "yes", "1": return true
            case "false", "no", "0": return false
            default: return nil
            }
        }
        return nil
    }
}

struct SuperwallOnboardingSessionState {
    private(set) var attributes: [String: Any] = [:]
    private(set) var receivedCompletionCallback = false

    mutating func reset() {
        attributes = [:]
        receivedCompletionCallback = false
    }

    mutating func recordAttributes(_ newAttributes: [String: Any]) {
        attributes.merge(newAttributes) { _, new in new }
    }

    mutating func recordCustomCallback(named name: String) {
        if name == SuperwallConfiguration.onboardingCompletionCallback {
            receivedCompletionCallback = true
        }
    }

    var canComplete: Bool {
        receivedCompletionCallback &&
            SuperwallOnboardingPreferenceMapper.hasCompletePayload(attributes)
    }
}

@MainActor
final class SuperwallOnboardingClient: NSObject {
    typealias PreferencesHandler = @MainActor ([String: Any]) -> Void

    let isConfigured: Bool
    private var preferencesHandler: PreferencesHandler?
    private var onboardingSession = SuperwallOnboardingSessionState()
    private var hasFinishedCurrentPresentation = false

    #if canImport(SuperwallKit)
    private var activePresentationHandler: PaywallPresentationHandler?
    #endif

    override init() {
        let apiKey = SuperwallConfiguration.publicAPIKey()
        let shouldConfigure = apiKey != nil && !SuperwallConfiguration.isAutomation()

        #if canImport(SuperwallKit)
        isConfigured = shouldConfigure
        #else
        isConfigured = false
        #endif

        super.init()

        #if canImport(SuperwallKit)
        if shouldConfigure, let apiKey {
            Superwall.configure(apiKey: apiKey)
            Superwall.shared.delegate = self
        }
        #endif
    }

    init(apiKey: String?, isAutomation: Bool) {
        let shouldConfigure = apiKey != nil && !isAutomation

        #if canImport(SuperwallKit)
        isConfigured = shouldConfigure
        #else
        isConfigured = false
        #endif

        super.init()

        #if canImport(SuperwallKit)
        if shouldConfigure, let apiKey {
            Superwall.configure(apiKey: apiKey)
            Superwall.shared.delegate = self
        }
        #endif
    }

    func setPreferencesHandler(_ handler: @escaping PreferencesHandler) {
        preferencesHandler = handler
    }

    func presentOnboarding(
        onPresent: @escaping @MainActor () -> Void,
        onComplete: @escaping @MainActor () -> Void,
        onFallback: @escaping @MainActor () -> Void
    ) {
        guard isConfigured else {
            onFallback()
            return
        }

        #if canImport(SuperwallKit)
        onboardingSession.reset()
        hasFinishedCurrentPresentation = false
        let handler = PaywallPresentationHandler()
        activePresentationHandler = handler

        handler.onPresent { _ in
            Task { @MainActor in onPresent() }
        }
        handler.onDismiss { [weak self] _, _ in
            Task { @MainActor in
                guard let self else { return }
                if self.onboardingSession.canComplete {
                    self.finishCurrentPresentation(onComplete)
                } else {
                    self.finishCurrentPresentation(onFallback)
                }
            }
        }
        handler.onSkip { [weak self] _ in
            Task { @MainActor in
                self?.finishCurrentPresentation(onFallback)
            }
        }
        handler.onError { [weak self] _ in
            Task { @MainActor in
                self?.finishCurrentPresentation(onFallback)
            }
        }
        handler.onCustomCallback { [weak self] callback in
            await MainActor.run {
                self?.onboardingSession.recordCustomCallback(named: callback.name)
            }
            return .success(data: ["accepted": true])
        }

        Superwall.shared.register(
            placement: SuperwallConfiguration.onboardingPlacement,
            handler: handler
        )
        #else
        onFallback()
        #endif
    }

    private func finishCurrentPresentation(_ action: @escaping @MainActor () -> Void) {
        guard !hasFinishedCurrentPresentation else { return }
        hasFinishedCurrentPresentation = true
        #if canImport(SuperwallKit)
        activePresentationHandler = nil
        #endif
        action()
    }
}

#if canImport(SuperwallKit)
extension SuperwallOnboardingClient: SuperwallDelegate {
    func userAttributesDidChange(newAttributes: [String: Any]) {
        onboardingSession.recordAttributes(newAttributes)
        preferencesHandler?(onboardingSession.attributes)
    }
}
#endif
