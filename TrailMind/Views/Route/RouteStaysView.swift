import SwiftUI

struct RouteStaysView: View {
    let evidence: RouteStays?
    @Environment(\.locale) private var locale
    private var german: Bool { locale.language.languageCode?.identifier == "de" }
    private func copy(_ de: String, _ en: String) -> String { german ? de : en }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(copy("Unterwegs übernachten", "Stay along the way"), systemImage: "bed.double")
                .font(.title3.weight(.semibold))
            if let evidence, evidence.state == .available {
                Text(copy("Kartierte Orte nahe der Route. Vorher beim Betreiber prüfen.",
                          "Mapped places near the route. Check with the operator before going."))
                    .font(.subheadline).foregroundStyle(.secondary)
                if evidence.isStale() {
                    Label(copy("Älterer Datenstand – Angaben erneut prüfen.", "Older data — check the details again."), systemImage: "clock")
                        .font(.caption).foregroundStyle(.secondary)
                }
                DisclosureGroup(copy("Orte ansehen (\(evidence.candidates.count))", "View places (\(evidence.candidates.count))")) {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(evidence.candidates.filter { $0.category != .emergencyShelter }) { candidate in
                            candidateCard(candidate)
                        }
                        if evidence.candidates.contains(where: { $0.category == .emergencyShelter }) {
                            Text(copy("Schutz-/Notunterkünfte · keine geplanten Übernachtungsplätze",
                                      "Shelters · not planned overnight accommodation"))
                                .font(.headline).padding(.top, 8)
                            ForEach(evidence.candidates.filter { $0.category == .emergencyShelter }) { candidate in
                                candidateCard(candidate)
                            }
                        }
                        Text(copy("Nur ausgewählte Suchbereiche, keine vollständige Liste. © OpenStreetMap contributors · ODbL 1.0",
                                  "Selected search areas only, not a complete list. © OpenStreetMap contributors · ODbL 1.0"))
                            .font(.caption2).foregroundStyle(.secondary)
                    }.padding(.top, 12)
                }
            } else {
                Text(evidence?.state == .empty
                     ? copy("In den geprüften Suchbereichen sind keine passenden Orte nahe der Route belegt. Andere Unterkünfte können existieren.",
                            "No matching places near the route were found in the checked areas. Other accommodation may exist.")
                     : copy("Übernachtungsorte konnten für diese Route nicht geprüft werden. Plane erst nach Prüfung beim Betreiber.",
                            "Places to stay could not be checked for this route. Verify with the operator before planning a stay."))
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22))
        .accessibilityIdentifier("route.stays")
    }

    private func candidateCard(_ candidate: RouteStays.Candidate) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Label(candidate.nameKnown ? candidate.name : copy("Name nicht erfasst", "Name not recorded"), systemImage: symbol(candidate.category))
                .font(.headline).fixedSize(horizontal: false, vertical: true)
            Text(kind(candidate.category)).font(.caption).foregroundStyle(.secondary)
            Text(copy("Etwa \(candidate.straightLineDistanceToPathMeters) m Luftlinie zum gemappten Pfad",
                      "About \(candidate.straightLineDistanceToPathMeters) m in a straight line from the mapped path"))
                .font(.subheadline)
            Text(copy("Kein berechneter Abstecher. Gehstrecke und Zugang sind unbekannt.",
                      "No detour has been routed. Walking distance and access are unknown."))
                .font(.caption).foregroundStyle(.secondary)
            DisclosureGroup(copy("Details und Quellen", "Details and sources")) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(copy("OSM-Angaben bestätigen weder Übernachtungserlaubnis, Öffnung, Buchbarkeit, Wasser noch Zugang. Vorher beim Betreiber prüfen.",
                              "OSM details do not confirm overnight permission, opening, availability, water or access. Check with the operator before going."))
                    if let operatorName = candidate.operator {
                        Text(copy("Betreiber laut OSM: \(operatorName)", "Operator listed in OSM: \(operatorName)"))
                    }
                    if let website = candidate.website {
                        Link(copy("Website laut OSM · ungeprüft", "Website listed in OSM · unchecked"), destination: website)
                            .foregroundStyle(Color.accentColor)
                    } else {
                        Text(copy("Keine Betreiber-Website belegt.", "No operator website recorded."))
                    }
                    Link(copy("OSM-Quelle · \(candidate.id)", "OSM source · \(candidate.id)"), destination: candidate.source.url)
                        .foregroundStyle(Color.accentColor)
                    Text(copy("Datenstand: \(date(candidate.source.snapshotAt)) · Objekt bearbeitet: \(date(candidate.source.updatedAt))",
                              "Snapshot: \(date(candidate.source.snapshotAt)) · Object edited: \(date(candidate.source.updatedAt))"))
                    Text(copy("Abgerufen: \(date(candidate.source.retrievedAt))", "Retrieved: \(date(candidate.source.retrievedAt))"))
                    Text(candidate.coordinateKind == "mapped_center"
                         ? copy("Kartierter Flächenmittelpunkt, kein bestätigter Eingang.", "Mapped area centre, not a confirmed entrance.")
                         : copy("Kartierter Punkt, kein bestätigter Eingang.", "Mapped point, not a confirmed entrance."))
                    if let url = mapURL(candidate) {
                        Link(copy("Ort auf Karte ansehen", "View place on map"), destination: url)
                            .foregroundStyle(Color.accentColor)
                            .accessibilityLabel(copy("\(candidate.name) auf Karte ansehen", "View \(candidate.name) on map"))
                    }
                }.font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true).padding(.top, 8)
            }.font(.subheadline)
        }
        .padding(14)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("route.stays.\(candidate.id)")
    }

    private func date(_ raw: String) -> String {
        PlanningEvidenceDate.parse(raw)?.formatted(.dateTime.year().month().day().locale(locale)) ?? copy("Unbekannt", "Unknown")
    }
    private func symbol(_ kind: RouteStays.Kind) -> String {
        switch kind {
        case .hut, .wildernessHut: "house"
        case .campsite: "tent"
        case .emergencyShelter: "cross.case"
        }
    }
    private func kind(_ kind: RouteStays.Kind) -> String {
        switch kind {
        case .hut: copy("Als Berghütte kartiert", "Mapped as an alpine hut")
        case .wildernessHut: copy("Als unbewirtschaftete Hütte kartiert", "Mapped as a wilderness hut")
        case .campsite: copy("Als Zeltplatz kartiert · offizieller Status unbestätigt", "Mapped campsite · official status unconfirmed")
        case .emergencyShelter: copy("Als einfache Schutzhütte kartiert", "Mapped as a basic shelter")
        }
    }
    private func mapURL(_ candidate: RouteStays.Candidate) -> URL? {
        var components = URLComponents(string: "https://maps.apple.com/")
        components?.queryItems = [URLQueryItem(name: "ll", value: "\(candidate.coordinate.latitude),\(candidate.coordinate.longitude)"),
                                  URLQueryItem(name: "q", value: candidate.name)]
        return components?.url
    }
}
