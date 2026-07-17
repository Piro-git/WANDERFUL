import Foundation

struct TrailMindAboutItem: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let detail: String
    let symbol: String
}

struct TrailMindAboutCredit: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let detail: String
    let symbol: String
    let destination: URL
}

enum TrailMindPermissionCopy {
    static let microphone =
        "TrailMind uses the microphone to turn your spoken route request into text."
    static let appleSpeechServerDisclosure =
        "Apple Speech can send captured audio to Apple's servers for processing."
    static let speechRecognition =
        appleSpeechServerDisclosure + " TrailMind does not retain raw audio or send it to its own backend."
}

enum TrailMindAboutAccessibilityID {
    static let header = "about.header"
    static let currentCapabilitiesSection = "about.section.currentCapabilities"
    static let dataFlowSection = "about.section.dataFlow"
    static let planningBoundarySection = "about.section.planningBoundary"
    static let creditsSection = "about.section.credits"
}

enum TrailMindAboutContent {
    static let releasePromptParsingDetail =
        "Release builds parse your full typed route request on this device. They do not send the full prompt to a remote AI provider."

    #if DEBUG
    static let currentPromptParsingDetail =
        releasePromptParsingDetail + " This developer build can use a separately configured remote parser for evaluation."
    #else
    static let currentPromptParsingDetail = releasePromptParsingDetail
    #endif

    static let currentCapabilityItems = [
        TrailMindAboutItem(
            id: "about.capability.naturalLanguagePlanning",
            title: "Natural-language planning",
            detail: "Describe a same-day hike, trail run or bike route with a start, destination, distance or time.",
            symbol: "text.bubble.fill"
        ),
        TrailMindAboutItem(
            id: "about.capability.mappedResults",
            title: "Mapped route results",
            detail: "Route geometry, distance, duration and elevation come from the routing response.",
            symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
        ),
        TrailMindAboutItem(
            id: "about.capability.localSavedPlans",
            title: "Local saved plans",
            detail: "New saves accept only verified routed results. Recovered legacy records remain labeled unverified.",
            symbol: "bookmark.fill"
        )
    ]

    static let dataFlowItems = [
        TrailMindAboutItem(
            id: "about.data.promptParsing",
            title: "Your route request",
            detail: currentPromptParsingDetail,
            symbol: "text.bubble.fill"
        ),
        TrailMindAboutItem(
            id: "about.data.deviceLocation",
            title: "Device location",
            detail: "TrailMind does not currently access your device's location. Enter a place name when choosing a route start.",
            symbol: "location.slash.fill"
        ),
        TrailMindAboutItem(
            id: "about.data.routing",
            title: "Geocoding and routing",
            detail: "Apple geocoding resolves the place names you enter. TrailMind then sends route coordinates and routing constraints to its backend, which asks GraphHopper to calculate the route.",
            symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
        ),
        TrailMindAboutItem(
            id: "about.data.savedRoutes",
            title: "Saved routes",
            detail: "New saves accept only verified routed results and are stored as protected files on this device. Recovered legacy records remain labeled unverified. In Saved, use the trash button to delete all saved routes.",
            symbol: "internaldrive.fill"
        ),
        TrailMindAboutItem(
            id: "about.data.gpx",
            title: "Temporary GPX files",
            detail: "Export creates a protected temporary GPX file containing route coordinates. The app or person you select in the share sheet receives those coordinates. TrailMind runs cleanup after sharing and recovers abandoned TrailMind export files on a later launch.",
            symbol: "doc.badge.arrow.up.fill"
        ),
        TrailMindAboutItem(
            id: "about.data.voice",
            title: "Optional voice input",
            detail: TrailMindPermissionCopy.appleSpeechServerDisclosure + " TrailMind does not retain raw audio or send it to its own backend; you can review the transcript before planning.",
            symbol: "waveform.and.mic"
        ),
        TrailMindAboutItem(
            id: "about.data.appAttest",
            title: "Request protection",
            detail: "Apple App Attest helps protect backend requests. Its key identifier is stored in the device Keychain and is not a TrailMind account.",
            symbol: "checkmark.shield.fill"
        )
    ]

    static let dataFlowFooter =
        "TrailMind currently has no user accounts, cloud sync, advertising or analytics."

    static let planningBoundaryItems = [
        TrailMindAboutItem(
            id: "about.boundary.review",
            title: "Review before starting",
            detail: "TrailMind is a planning aid, not live navigation. Check weather, trail conditions, closures, local rules and water availability.",
            symbol: "checklist"
        ),
        TrailMindAboutItem(
            id: "about.boundary.preferences",
            title: "Preferences are requests",
            detail: "Requested features are shown separately unless mapped route data verifies them.",
            symbol: "slider.horizontal.3"
        )
    ]

    static let mapDisplayItem = TrailMindAboutItem(
        id: "about.credit.appleMapKit",
        title: "Map display",
        detail: "Interactive route maps are displayed with Apple MapKit.",
        symbol: "map.fill"
    )

    static let credits = [
        TrailMindAboutCredit(
            id: "about.credit.graphHopper",
            title: "Powered by GraphHopper API",
            detail: "GraphHopper calculates route geometry and route statistics. Its official attribution page also lists routing and elevation data sources.",
            symbol: "point.bottomleft.forward.to.point.topright.scurvepath",
            destination: URL(string: "https://www.graphhopper.com/attribution/")!
        ),
        TrailMindAboutCredit(
            id: "about.credit.openStreetMap",
            title: "Map data © OpenStreetMap contributors",
            detail: "OpenStreetMap data is available under the Open Data Commons Open Database License (ODbL).",
            symbol: "globe.europe.africa.fill",
            destination: URL(string: "https://www.openstreetmap.org/copyright")!
        ),
        TrailMindAboutCredit(
            id: "about.credit.mapterhorn",
            title: "Elevation data by Mapterhorn",
            detail: "GraphHopper's official data-source page provides the elevation attribution details.",
            symbol: "mountain.2.fill",
            destination: URL(string: "https://www.graphhopper.com/attribution/")!
        )
    ]
}
