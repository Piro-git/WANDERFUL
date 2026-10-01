# Recherche und endgültige Routenstopps

Ausgangsbasis: `03a430f17cbee03cc4017fee7c5e2022604c6027`. Der Patch betrifft ausschließlich Evidenzzuordnung, deren Darstellung und Tests. Keine zusätzlichen Modell-/Provideraufrufe, keine Änderung an Routenqualität, Geometrieprüfung, Erreichbarkeitsgrenzen oder Budgets.

## Vorher / nachher (synthetischer Regressionstest)

Die erste Auswahl enthält OSM-Knoten 1. Der Router verwirft sie wegen eines nicht ausreichend erreichten Stopps. Die zweite Auswahl verwendet den zuvor gelesenen Knoten 3. Der unveränderte Recherchetext zitiert weiterhin Knoten 1.

Vorher erschien die ursprüngliche Recherche direkt neben der endgültigen Stoppliste, ohne Auswahlstatus. Jetzt zeigt die App Knoten 3 unter „Stops on this route“ mit „No web passage reliably linked to this stop“. Knoten 1 steht im getrennten Recherchebereich ausdrücklich unter „Not on this route“. Die Textpassage bleibt Knoten 1 zugeordnet; sie wandert niemals auf Knoten 3. Die damalige reale Paternosterklippe-/Halberstädter-Berg-Recherche wurde nicht archiviert und wird hier nicht rekonstruiert.

## Rückwärtskompatible Erweiterung

Der äußere Request-/Responsevertrag bleibt bei Version 3. `route.webResearch.routeEvidence` ist optional:

```json
{
  "schemaVersion": 1,
  "routeId": "measured-2",
  "places": [
    {"placeId":"osm:node:3","name":"Later stop","sourceURL":"https://www.openstreetmap.org/node/3","selection":"selected"},
    {"placeId":"osm:node:1","name":"Earlier stop","sourceURL":"https://www.openstreetmap.org/node/1","selection":"excluded"}
  ],
  "claims": [
    {"id":"b0-c0","blockIndex":0,"citationIndex":0,"placeId":"osm:node:1","relationship":"source_identity"}
  ]
}
```

`claims` referenziert attributierte Passagen des **generierten Originaltexts**, keine wörtlichen Webseitenzitate und keine bestätigten Routeneigenschaften. Die referenzierte Citation besitzt URL, Titel und den exakten UTF-16-Bereich. Es wird kein zweiter Text und keine gekürzte/paraphrasierte Aussage erzeugt.

Invarianten:

- `finish_plan` ruft `reconcileRouteEvidence(web, {routeId, selectedPlaces, inspectedPlaces})` erst nach endgültiger Routenwahl auf. `selectedPlaces` sind die unveränderten Records der akzeptierten Messung; `inspectedPlaces` stammen ausschließlich aus dem request-lokalen Register tatsächlich gelesener IDs. Höchstens drei ausgewählte bzw. zehn gelesene Orte.
- Auswahlreihenfolge und IDs entsprechen exakt der gewählten Route. Die übrigen gelesenen Orte erhalten `excluded`. Das heißt „nicht auf der endgültigen Route“, nicht zwangsläufig „zuvor im Web erwähnt“.
- Jede Citation erhält genau eine stabile, response-lokale Referenz `bN-cM`. Kein Lookup über Namen, Kategorien, Titel, URL-Slugs, Suchtreffer, Domains oder Modellvorschläge.
- `source_identity` entsteht ausschließlich bei bytegenau gleichem kanonischem OSM-Record-Link als Citation-URL und erfolgreicher URL-context-Lektüre genau dieser URL. Selbst dies ist nur die Attribution einer Passage an diesen Datensatz, **kein semantischer Beweis**, dass jeder Satz den Stopp beschreibt oder aktuell stimmt.
- Jede andere Citation ist `relationship: "unconfirmed", placeId: null`. Ähnliche Namen, Mehrdeutigkeit, fremde IDs, allgemeine Tourismus-/Parkseiten, Suchtreffer ohne gelesene Seite, Query-/Redirectvarianten und widersprüchliche Aussagen liefern keine Ortsbestätigung.
- Der Backend-Abgleich prüft Registermitgliedschaft, stabile IDs, Quellenlinks, Eindeutigkeit und Citation-Grenzen. `validateRouteEvidence` vergleicht externe/gespeiste Zuordnungen mit der kanonischen Neuberechnung; manipulierte oder erfundene Referenzen werden verworfen.
- iOS prüft Versions-/Routenbindung, genau dieselben finalen IDs in derselben Reihenfolge, Namen/OSM-Links, alle Citation-Indizes und die deterministisch erneut abgeleitete Beziehung. Fehlende Zuordnung bleibt für ältere Server zulässig; eine vorhandene ungültige Zuordnung führt zu `invalidResponse`.
- OSM belegt Identität/Position aus einem Datenstand; GraphHopper berechnet Weggeometrie in geprüfter Nähe der Stopps. Beides bestätigt keine aktuellen Bedingungen, Aussicht, Wasser, Sicherheit oder realen Zugang.

## Bewusste Grenze

Eine allgemeine Webseite mit einem gleichnamigen Ort ist kein verlässlicher Identitätsbeleg. Die derzeitigen Daten enthalten keinen unabhängigen, ausreichend belastbaren Entity-Link von solchen Seiten zum OSM-Record. Deshalb werden die meisten Tourismus-/Parkpassagen weiterhin **nicht** einzelnen Stopps zugerechnet. Ein zusätzlicher Modellaufruf würde diese fehlende Identitätsgrundlage nicht ersetzen. Eine spätere Erweiterung braucht einen eigenständig verifizierbaren Identitätsvertrag und eigene Negativtests. Version 1 verspricht keine vollständige semantische Evidenzabdeckung.

## Darstellung und Datenhaltung

Die endgültigen Stopps erscheinen zuerst, jeweils mit OSM-Link und einem kurzen Webstatus. Die gemeinsame SwiftUI-Komponente `DynamicRouteEvidenceView` wird sowohl in `RouteDetailView` als auch im Simulator-UI-Test verwendet. Der Originaltext ist unter „Research and alternatives“ als Recherche **vor** Routenwahl gekennzeichnet. Nicht ausgewählte gelesene Orte werden separat vor dem Providertext genannt. Der vollständige Providertext, Links und die vollständigen unveränderten Suchvorschläge bleiben zusammen. Zusätzliche Quellenpassagen werden separat nach diesem Block angeboten; dies erhält auch überlappende Zitate, die ein einzelner Inline-Link nicht abbilden kann.

Das gesamte `DynamicWebResearch` einschließlich der Zuordnung bleibt transient und ist nur für diese Antwort und diesen Nutzer bestimmt. Keine neuen Logs, Caches oder Persistenzfelder. `PersistedRoute` speichert weiterhin ausschließlich die bisherigen OSM-Stoppdaten. Laden stellt die Webrecherche nicht wieder her und zeigt dies an. Eine 24-Stunden-Anzeigegrenze mit fünf Minuten Uhrtoleranz ist eine lokale Verfügbarkeitsgrenze, keine Aussage zur Aktualität der Quelle. Abgelaufene Recherche wird bei Antwortverarbeitung entfernt; die Ansicht prüft außerdem minütlich die Verfügbarkeit. OSM-Datenstände bleiben sichtbar.

## Integration mit Planungsoptimierung

Die einzige funktionale Einfügestelle in `planner.js` ist der finale Abgleich unmittelbar vor der Response. Zusätzlich validiert der Planer das Recherche-Envelope an der bestehenden Eingangsgrenze. Kein neuer Toolname, keine neue Modellrunde, keine Veränderung der Auswahl-/Revisionsstrategie. Bei Zusammenführung müssen das request-lokale Register der gelesenen Orte und die unveränderten Records der gewählten Messung weiter verfügbar sein. `composition.js` und die Providerkomposition benötigen keine Änderung.

## Offizielle Dokumentation geprüft am 9. September 2026

- [Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search): Annotationen verbinden Textsegmente mit Quellen; Search Suggestions gehören zur Antwort.
- [Interactions API](https://ai.google.dev/api/interactions-api-v1): Provider-Indizes sind Bytepositionen. Die bestehende UTF-8-zu-UTF-16-Konvertierung bleibt erhalten; Backend und Swift prüfen Unicode-Skalargrenzen einschließlich Emoji und kombinierender Zeichen.
- [Gemini API Terms, Grounding with Google Search](https://ai.google.dev/gemini-api/terms#grounding-with-google-search): gemeinsamer unveränderter Providerblock, Suchvorschläge, Anzeige für den anfragenden Nutzer und Einschränkungen der Speicherung. Keine neue Ablage oder Weiterverwendung der Inhalte.

Das ist eine technische Umsetzungsnotiz, kein neuer Live- oder Compliance-Nachweis.
