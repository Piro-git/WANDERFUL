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
    static let locationWhenInUse =
        "Wanderful uses your precise location during active Route Guidance, including when the screen is locked or you use another app, to show your position and progress. Pause or end guidance to stop location updates."
    static let microphone =
        "Wanderful uses the microphone to turn your spoken route request into text."
    static let appleSpeechServerDisclosure =
        "Apple Speech can send captured audio to Apple's servers for processing."
    static let speechRecognition =
        appleSpeechServerDisclosure + " Wanderful does not retain raw audio or send it to its own backend."
}

enum TrailMindAboutAccessibilityID {
    static let header = "about.header"
    static let currentCapabilitiesSection = "about.section.currentCapabilities"
    static let dataFlowSection = "about.section.dataFlow"
    static let planningBoundarySection = "about.section.planningBoundary"
    static let creditsSection = "about.section.credits"
    static let privacyAndData = "about.destination.privacyAndData"
    static let helpAndSafety = "about.destination.helpAndSafety"
    static let privacyPolicy = "about.link.privacyPolicy"
    static let supportWebsite = "about.link.supportWebsite"
}

enum TrailMindAboutContent {
    static let releasePromptParsingDetail =
        "Online planning sends your route request, places, coordinates and relevant planning preferences to Wanderful's backend. When AI planning is enabled, Google Gemini helps interpret the request and research route context. GraphHopper calculates the route geometry."
    static let currentPromptParsingDetail = releasePromptParsingDetail
    static let onlinePlanningPermissionDetail =
        "Allow Wanderful to send this request, requested places or coordinates, and relevant Trail Profile preferences to its backend. AI planning uses Google Gemini; research services receive relevant searches and GraphHopper receives routing coordinates and constraints. This includes follow-up answers and retries for this request. Avoid including private information you do not want these services to receive."

    static let currentCapabilityItems = [
        TrailMindAboutItem(
            id: "about.capability.naturalLanguagePlanning",
            title: "Natural-language planning",
            detail: "Describe a hike, trail run or bike route with a start, destination, distance or time. Planning needs an internet connection and depends on available places, paths and provider data.",
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
        ),
        TrailMindAboutItem(
            id: "about.capability.routeGuidance",
            title: "Route Guidance",
            detail: "For an intact verified route, show your position, progress and mapped routing instructions. Active guidance can continue during screen lock and app changes; pause or end it to stop location updates.",
            symbol: "location.north.circle.fill"
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
            detail: "During active Route Guidance, Wanderful uses your precise location to show position and progress, including during screen lock and app changes. Pause or end guidance to stop updates. No location track is stored or sent by Wanderful. If the app is terminated, reopen it and resume guidance manually.",
            symbol: "location.fill"
        ),
        TrailMindAboutItem(
            id: "about.data.routing",
            title: "Geocoding and routing",
            detail: "Apple geocoding resolves the place names you enter. Wanderful then sends route coordinates and routing constraints to its backend, which asks GraphHopper to calculate the route.",
            symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
        ),
        TrailMindAboutItem(
            id: "about.data.photos",
            title: "Place photos",
            detail: "Opening route stops can send mapped place identifiers and photo file names to Wikidata and Wikimedia Commons. Images load from Wikimedia servers; these services receive your network address. Photos do not confirm current access or route conditions.",
            symbol: "photo"
        ),
        TrailMindAboutItem(
            id: "about.data.savedRoutes",
            title: "Saved routes",
            detail: "New saves accept only verified routed results and are stored as protected files on this device, excluded from device backups. Recovered legacy records remain labeled unverified. In Saved, use the trash button to delete all saved routes.",
            symbol: "internaldrive.fill"
        ),
        TrailMindAboutItem(
            id: "about.data.gpx",
            title: "Temporary GPX files",
            detail: "Export creates a protected temporary GPX file containing route coordinates. The app or person you select in the share sheet receives those coordinates. Wanderful runs cleanup after sharing and recovers abandoned export files on a later launch.",
            symbol: "doc.badge.arrow.up.fill"
        ),
        TrailMindAboutItem(
            id: "about.data.voice",
            title: "Optional voice input",
            detail: TrailMindPermissionCopy.appleSpeechServerDisclosure + " Wanderful does not retain raw audio or send it to its own backend; you can review the transcript before planning.",
            symbol: "waveform.and.mic"
        ),
        TrailMindAboutItem(
            id: "about.data.appAttest",
            title: "Request protection",
            detail: "Apple App Attest helps protect backend requests. Its key identifier is stored in the device Keychain. Wanderful's backend keeps an app-scoped installation record and stores a one-way hash of the request connection source for rate limiting. This is not a Wanderful account and is not used for tracking.",
            symbol: "checkmark.shield.fill"
        )
    ]

    static let dataFlowFooter =
        "Wanderful currently has no user accounts, cloud sync, advertising or analytics."

    static let planningBoundaryItems = [
        TrailMindAboutItem(
            id: "about.boundary.review",
            title: "Review before starting",
            detail: "Route Guidance is a planning aid, not a safety guarantee. Check signs, weather, trail conditions, closures, local rules and water availability. Saved route data does not download the Apple basemap; offline maps are not provided. AI planning and route recalculation are unavailable without an internet connection.",
            symbol: "checklist"
        ),
        TrailMindAboutItem(
            id: "about.boundary.preferences",
            title: "Preferences are requests",
            detail: "Requested features are shown separately unless mapped route data verifies them.",
            symbol: "slider.horizontal.3"
        )
    ]

    static let privacyControlItems = [
        TrailMindAboutItem(
            id: "about.privacyControl.routes",
            title: "Delete saved routes",
            detail: "Open Saved and use the trash button to delete all routes stored by Wanderful on this iPhone.",
            symbol: "trash.fill"
        ),
        TrailMindAboutItem(
            id: "about.privacyControl.profile",
            title: "Manage your Trail Profile",
            detail: "Return to Profile to edit, reset or delete the planning preferences stored on this iPhone.",
            symbol: "person.crop.circle.badge.checkmark"
        )
    ]

    static let helpItems = [
        TrailMindAboutItem(
            id: "about.help.ai",
            title: "AI-assisted planning",
            detail: "AI helps understand and research your request. It can be mistaken or incomplete. A routing service calculates the mapped path; review each result and any source dates before choosing it.",
            symbol: "sparkles"
        ),
        TrailMindAboutItem(
            id: "about.help.support",
            title: "Reporting a problem",
            detail: "Include the app version, iOS version, what you tried and the error shown. Remove private places and personal details from screenshots. Never send passwords or API keys. The support website below provides contact details when available.",
            symbol: "lifepreserver.fill"
        ),
        TrailMindAboutItem(
            id: "about.help.location",
            title: "Name a specific start",
            detail: "Use a town, trailhead or landmark. Wanderful asks you to clarify broad or ambiguous regions before routing.",
            symbol: "mappin.and.ellipse"
        ),
        TrailMindAboutItem(
            id: "about.help.retry",
            title: "If a route cannot finish",
            detail: "Check your connection and retry once. If planning still fails, edit the place or constraints. No result means no usable plan was returned; it does not prove that no path exists.",
            symbol: "arrow.clockwise"
        ),
        TrailMindAboutItem(
            id: "about.help.verify",
            title: "Understand your results",
            detail: "Compare route shape, distance, estimated time and elevation. Closest Match refers to the requested distance, not safety. Requested preferences and research findings are separate from routed facts; read their sources and limitations.",
            symbol: "checkmark.circle.fill"
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
