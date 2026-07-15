import CoreLocation
import Foundation
import Observation

@Observable
final class AppModel {
    let savedRoutes: SavedRoutesModel
    var preferences = UserPreferences()

    init(savedRoutes: SavedRoutesModel = SavedRoutesModel()) {
        self.savedRoutes = savedRoutes
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
