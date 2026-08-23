import CoreLocation
import Foundation
import Observation

@Observable
final class AppModel {
    let savedRoutes: SavedRoutesModel
    private let preferencesStore: UserPreferencesStore?
    private let hikingProfileStore: (any HikingPreferenceProfileStoreV1)?
    private var hasStartedHikingProfileLoad = false
    var preferences: UserPreferences
    var hikingProfile: HikingPreferenceProfileV1?
    var hikingOnboardingDraft: HikingOnboardingDraftV1?
    var isHikingProfileStateLoaded: Bool
    var hikingProfileStatusMessage: String?
    var hikingProfileRecoveryRequired = false

    init(
        savedRoutes: SavedRoutesModel = SavedRoutesModel(),
        preferences: UserPreferences = UserPreferences(),
        preferencesStore: UserPreferencesStore? = nil,
        hikingProfileStore: (any HikingPreferenceProfileStoreV1)? = nil,
        hikingProfileSyncClient _: any HikingPreferenceProfileSyncingV1 =
            NoOpHikingPreferenceProfileSyncClientV1()
    ) {
        self.savedRoutes = savedRoutes
        self.preferences = preferences
        self.preferencesStore = preferencesStore
        self.hikingProfileStore = hikingProfileStore
        hikingProfile = nil
        hikingOnboardingDraft = nil
        isHikingProfileStateLoaded = hikingProfileStore == nil
    }

    func updatePreferences(_ preferences: UserPreferences) {
        self.preferences = preferences
        preferencesStore?.save(preferences)
    }

    func loadHikingProfileStateIfNeeded() async {
        guard !hasStartedHikingProfileLoad else { return }
        hasStartedHikingProfileLoad = true
        guard let hikingProfileStore else {
            isHikingProfileStateLoaded = true
            return
        }

        do {
            async let storedProfile = hikingProfileStore.loadProfile()
            async let storedDraft = hikingProfileStore.loadDraft()
            hikingProfile = try await storedProfile
            hikingOnboardingDraft = try await storedDraft
            hikingProfileStatusMessage = nil
            hikingProfileRecoveryRequired = false
        } catch {
            // Corrupt or future-version local data must fail closed instead of
            // being replaced with guessed preferences.
            hikingProfile = nil
            hikingOnboardingDraft = nil
            hikingProfileStatusMessage =
                "Your Trail Profile could not be loaded. Discard the unreadable local record to start again."
            hikingProfileRecoveryRequired = true
        }
        isHikingProfileStateLoaded = true
    }

    func saveHikingOnboardingProgress(_ draft: HikingOnboardingDraftV1) async {
        guard let hikingProfileStore else {
            hikingOnboardingDraft = draft
            return
        }
        do {
            hikingOnboardingDraft = try await hikingProfileStore.saveDraft(draft, at: Date())
            hikingProfileStatusMessage = nil
        } catch {
            hikingProfileStatusMessage =
                "Progress could not be saved on this iPhone. You can still continue."
        }
    }

    @discardableResult
    func completeHikingOnboarding(_ draft: HikingOnboardingDraftV1) async -> Bool {
        guard let hikingProfileStore else {
            hikingProfile = draft.profile
            return true
        }

        do {
            let saved = try await hikingProfileStore.saveProfile(draft.profile, at: Date())
            await hikingProfileStore.deleteDraft()
            hikingProfile = saved
            hikingOnboardingDraft = nil
            hikingProfileStatusMessage = nil
            hikingProfileRecoveryRequired = false
            return true
        } catch {
            hikingProfileStatusMessage =
                "Your Trail Profile could not be saved. Review your choices and try again."
            return false
        }
    }

    @discardableResult
    func saveHikingProfileEdit(_ profile: HikingPreferenceProfileV1) async -> Bool {
        guard let hikingProfileStore else {
            hikingProfile = profile
            return true
        }
        do {
            let saved = try await hikingProfileStore.saveProfile(profile, at: Date())
            hikingProfile = saved
            hikingProfileStatusMessage = nil
            hikingProfileRecoveryRequired = false
            return true
        } catch {
            hikingProfileStatusMessage =
                "Those changes could not be saved. Nothing in your profile was replaced."
            return false
        }
    }

    @discardableResult
    func resetHikingProfile() async -> Bool {
        if hikingProfileRecoveryRequired {
            await discardUnreadableHikingProfileData()
            return true
        }
        guard let current = hikingProfile else { return true }
        let emptyProfile = HikingPreferenceProfileV1(metadata: current.metadata)
        let didReset = await saveHikingProfileEdit(emptyProfile)
        if didReset {
            clearLegacyHikingCompatibilityPreferences()
        }
        return didReset
    }

    func deleteHikingProfile() async {
        if let hikingProfileStore {
            await hikingProfileStore.resetAll()
        }
        hikingProfile = nil
        hikingOnboardingDraft = nil
        hikingProfileStatusMessage = nil
        hikingProfileRecoveryRequired = false
        clearLegacyHikingCompatibilityPreferences()
    }

    func discardUnreadableHikingProfileData() async {
        if let hikingProfileStore {
            await hikingProfileStore.resetAll()
        }
        hikingProfile = nil
        hikingOnboardingDraft = nil
        hikingProfileStatusMessage = nil
        hikingProfileRecoveryRequired = false
        isHikingProfileStateLoaded = true
        clearLegacyHikingCompatibilityPreferences()
    }

    private func clearLegacyHikingCompatibilityPreferences() {
        var compatible = preferences
        compatible.preferredActivity = .hiking
        compatible.fitnessLevel = .moderate
        compatible.preferredDistanceKilometers = 15
        compatible.avoidsSteepClimbs = false
        compatible.interests = []
        updatePreferences(compatible)
    }
}

struct UserPreferencesStore {
    static let defaultKey = "trailmind.user-preferences.v1"

    private let defaults: UserDefaults
    private let key: String

    init(
        defaults: UserDefaults = .standard,
        key: String = UserPreferencesStore.defaultKey
    ) {
        self.defaults = defaults
        self.key = key
    }

    func load() -> UserPreferences {
        guard let data = defaults.data(forKey: key),
              let preferences = try? JSONDecoder().decode(UserPreferences.self, from: data)
        else {
            return UserPreferences()
        }
        return preferences
    }

    func save(_ preferences: UserPreferences) {
        guard let data = try? JSONEncoder().encode(preferences) else { return }
        defaults.set(data, forKey: key)
    }
}

#if DEBUG
@Observable
final class RouteEditViewModel {
    enum MessageKind {
        case user
        case copilot
    }

    struct Message: Identifiable {
        let id = UUID()
        let kind: MessageKind
        let text: String
    }

    private let plannerService: any AIPlannerService
    var route: TrailRoute
    var draft = ""
    var messages: [Message] = [
        Message(kind: .copilot, text: "I’m holding the route’s scenery, timing and safety notes together. What would you like to change?")
    ]
    var isWorking = false

    init(route: TrailRoute, plannerService: any AIPlannerService = MockAIPlannerService()) {
        self.route = route
        self.plannerService = plannerService
    }

    func send(_ instruction: String) async {
        let cleanInstruction = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanInstruction.isEmpty, !isWorking else { return }

        messages.append(Message(kind: .user, text: cleanInstruction))
        draft = ""
        isWorking = true

        do {
            try await Task.sleep(for: .milliseconds(650))
            route = try await plannerService.editRoute(route: route, instruction: cleanInstruction)
            messages.append(
                Message(
                    kind: .copilot,
                    text: "Done. I trimmed the demanding section and kept the strongest viewpoints. The revised route is \(route.distanceLabel) with \(route.elevationLabel) of climbing."
                )
            )
        } catch {
            messages.append(Message(kind: .copilot, text: "I couldn’t make that change yet. Try describing the outcome in a different way."))
        }
        isWorking = false
    }
}
#endif
