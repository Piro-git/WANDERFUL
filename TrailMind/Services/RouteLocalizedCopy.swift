import Foundation

/// Ephemeral presentation: switching interface language never rewrites route data.
struct RouteLocalizedCopy {
    let route: TrailRoute
    let language: AppLanguage
    private var german: Bool { language == .german }
    func text(_ english: String, _ german: String) -> String { self.german ? german : english }

    func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(value.rounded() == value ? 0 : 1)).locale(language.locale))
    }
    func distance(_ value: Double) -> String { number(value) + " km" }
    var distance: String { distance(route.distanceKilometers) }
    var climb: String { route.elevationGainMeters.formatted(.number.locale(language.locale)) + " m" }
    var duration: String {
        if route.durationHours >= 12, !route.days.isEmpty {
            return "\(route.days.count) " + text("days", "Tage")
        }
        return time(minutes: route.durationMinutes)
    }
    private func time(minutes: Int) -> String {
        let hours = minutes / 60, remainder = minutes % 60
        return "\(hours) " + text("hr", "Std.") + (remainder == 0 ? "" : " \(remainder) min")
    }
    var activity: String {
        switch route.activity {
        case .hiking: text("Hiking", "Wandern")
        case .biking: text("Biking", "Radfahren")
        case .trailRunning: text("Trail running", "Trailrunning")
        }
    }
    var routeType: String {
        switch route.routeType {
        case .loop: text("Loop", "Rundtour")
        case .pointToPoint: text("Point to point", "Streckentour")
        case .multiDay: text("Multi-day", "Mehrtägige Tour")
        }
    }
    var difficulty: String {
        Self.difficulty(route.difficulty, language: language)
    }
    static func difficulty(_ difficulty: RouteDifficulty, language: AppLanguage) -> String {
        guard language == .german else { return difficulty.rawValue }
        switch difficulty {
        case .easy: return "Leicht"
        case .moderate: return "Mittel"
        case .challenging: return "Anspruchsvoll"
        }
    }
    var title: String {
        // Only results carrying validated generated-planning status get a local title.
        // Legacy, imported and user-owned names have no marker and stay verbatim.
        guard route.dynamicRouteOutcome != nil else { return route.title }
        let location = route.location.trimmingCharacters(in: .whitespacesAndNewlines)
        return [activity, routeType, location, distance].filter { !$0.isEmpty }.joined(separator: " · ")
    }
    var summary: String {
        guard let outcome = route.dynamicRouteOutcome else { return route.summary }
        let result = text("Route calculated: \(distance).", "Route berechnet: \(distance).")
        return outcome.isPartial
            ? text("Partial match — some preferences remain unresolved. ", "Teilweise passend – einige Wünsche bleiben offen. ") + result
            : result
    }
    var outcomeDetails: [String] {
        guard let outcome = route.dynamicRouteOutcome else { return [] }
        var details: [String] = []
        if outcome.hasUnresolvedWishes {
            details.append(text("Review the route against your original request; not all preferences are confirmed.",
                                "Vergleiche die Route mit deinem ursprünglichen Wunsch; nicht alle Vorlieben sind bestätigt."))
        }
        details.append(text("Current access, safety and drinking water availability are not verified. Check weather, local rules and trail conditions before starting.",
                            "Aktuelle Zugänglichkeit, Sicherheit und Trinkwasserverfügbarkeit sind nicht bestätigt. Prüfe vor dem Start Wetter, örtliche Regeln und Wegbedingungen."))
        return details
    }
    var outcomeExplanation: String { ([summary] + outcomeDetails).joined(separator: "\n") }

    func comparison(_ value: String) -> String {
        guard german else { return value }
        var deltas: [String] = []
        if let target = route.planningMetadata?.targetDistanceKm, target > 0 {
            let difference = route.distanceKilometers - target
            deltas.append(abs(difference) < 0.05 ? "Wunschstrecke erreicht" : "\(distance(abs(difference))) \(difference < 0 ? "unter" : "über") der Wunschstrecke")
        }
        if let target = route.planningMetadata?.targetDurationMinutes, target > 0 {
            let difference = route.durationMinutes - target
            deltas.append(difference == 0 ? "Wunschdauer erreicht" : "\(abs(difference)) min \(difference < 0 ? "unter" : "über") der Wunschdauer")
        }
        if !deltas.isEmpty { return deltas.joined(separator: " • ") }
        switch value {
        case "Lowest climb": return "Geringster Aufstieg"
        case "Only distinct route": return "Einzige eigenständige Route"
        default: return "Aufstieg: \(climb)"
        }
    }
    func role(_ role: RouteQualityExplanationRole) -> String {
        switch role {
        case .primaryFit: text("Request fit", "Passung zum Wunsch")
        case .verifiedCharacteristic: text("Mapped evidence", "Kartierte Merkmale")
        case .estimate: text("Estimate", "Schätzung")
        case .limitation: text("Data limitation", "Datengrenze")
        }
    }

    struct Evidence {
        let title: String
        let detail: String?
        let accessibilityLabel: String
    }
    func evidence(_ item: RouteQualityPresentationItem) -> Evidence {
        guard german else {
            return Evidence(title: item.title, detail: item.detail, accessibilityLabel: item.accessibilityLabel)
        }
        let data = RouteEvidenceSnapshot.presentationSnapshot(route: route, policy: .v1)
        func percent(_ ratio: Double?) -> String {
            guard let ratio, ratio.isFinite else { return "unbekannt" }
            return "\(Int((ratio * 100).rounded())) %"
        }
        let title: String, detail: String
        switch item.code {
        case .distanceFit:
            if let target = route.planningMetadata?.targetDistanceKm {
                let difference = route.distanceKilometers - target
                title = abs(difference) < 0.05 ? "Entspricht deiner Wunschstrecke" : "\(distance(abs(difference))) \(difference < 0 ? "unter" : "über") deiner Wunschstrecke"
                detail = "Berechnet: \(distance). Gewünscht: \(distance(target))."
            } else { title = "Berechnete Strecke: \(distance)"; detail = "Keine Wunschstrecke hinterlegt." }
        case .durationFit:
            if let target = route.planningMetadata?.targetDurationMinutes {
                let difference = route.durationMinutes - target
                title = difference == 0 ? "Entspricht deiner Wunschdauer" : "\(abs(difference)) min \(difference < 0 ? "unter" : "über") deiner Wunschdauer"
                detail = "Berechnet: \(duration). Gewünscht: \(time(minutes: target))."
            } else { title = "Berechnete Dauer: \(duration)"; detail = "Keine Wunschdauer hinterlegt." }
        case .physicalEffortEstimate:
            title = "Geschätzte Anstrengung: \(difficulty)"
            detail = "Aus \(distance) und \(climb) Aufstieg abgeleitet. Die technische Wegschwierigkeit wird getrennt bewertet."
        case .pathsAndTracks:
            title = "\(percent(data.pathAndTrackRatio.value)) Wege und Pfade"
            detail = "Wegklassendaten decken \(percent(data.pathAndTrackRatio.coverageRatio)) der Route ab."
        case .majorRoadExposure:
            title = "\(percent(data.majorRoadRatio.value)) Hauptstraßenanteil"
            detail = "Wegklassendaten decken \(percent(data.majorRoadRatio.coverageRatio)) der Route ab."
        case .lowRepeatedPath:
            title = "\(percent(data.geometry.value?.selfOverlapRatio)) wiederholter Weg"
            detail = "Aus der berechneten Rundtour ermittelt."
        case .technicalSections:
            title = "Enthält kartierte Bergwanderabschnitte"
            let section = data.technicalDifficulty.value.map { distance($0.demandingSectionDistanceMeters / 1_000) } ?? "Unbekannte Länge"
            detail = "\(section) liegt über der einfachen Wanderklassifizierung. Schwierigkeitsdaten decken \(percent(data.technicalDifficulty.coverageRatio)) der Route ab."
        case .technicalDifficultyUnavailable:
            title = "Technische Wegschwierigkeit unbekannt"
            detail = "Fehlende Schwierigkeitsdaten belegen nicht, dass die Route technisch leicht ist."
        case .technicalDifficultyCoverageLimited:
            title = "Schwierigkeitsdaten decken nur \(percent(data.technicalDifficulty.coverageRatio)) ab"
            detail = "Nicht erfasste Abschnitte bleiben unbekannt."
        case .surfaceEvidenceUnavailable:
            title = "Untergrund unbekannt"
            detail = "Fehlende Untergrunddaten belegen keine leichte Begehbarkeit."
        case .surfaceCoverageLimited:
            title = "Untergrunddaten decken nur \(percent(data.surfaceSuitability.coverageRatio)) ab"
            detail = "Unbekannte Abschnitte gelten weder als befestigt noch als unbefestigt."
        case .roadClassEvidenceUnavailable:
            title = "Wegklassen unbekannt"
            detail = "Ohne aktuelle Wegklassendaten ist ein geringer Hauptstraßenanteil nicht bestätigt."
        case .roadClassCoverageLimited:
            title = "Wegklassendaten decken nur \(percent(data.majorRoadRatio.coverageRatio)) ab"
            detail = "Ein geringer gemessener Anteil bestätigt keinen geringen Straßenanteil auf der gesamten Route."
        case .requestedPreferencesUnverified:
            title = "Gewünschte Merkmale sind noch nicht bestätigt"
            detail = "Für die Vorlieben aus deiner Anfrage fehlen Belege entlang der Route."
        case .mappedEvidenceUnavailable:
            title = "Kartierte Routenmerkmale unbekannt"
            detail = "Strecke, Dauer und Aufstieg sind berechnet; Untergrund, Wegklassen und technische Schwierigkeit bleiben unbekannt."
        }
        return Evidence(title: title, detail: detail, accessibilityLabel: [role(item.role), title, detail].joined(separator: ". "))
    }
}
