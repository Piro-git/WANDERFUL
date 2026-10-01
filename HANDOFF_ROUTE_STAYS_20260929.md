# Unterwegs übernachten — Handoff, 29.09.2026

> Source-only publication: referenced UI screenshots are retained locally by the integration owner; no screenshot PNG bytes are included or retrievable from this branch. Textual test results are retained; visual acceptance is not independently reproducible from this PR alone.

## Checkout und Übernahme

- Ausschließlich `/private/tmp/wanderful-stays-20260929`, Branch `codex/route-stays-20260929`, Basis `83a99c0d9f4dc6e457437eca2a29f306d3b8233a`.
- Backend-Commit: `b789692` (enthält gemeinsame synthetische Swift-/JS-Fixture).
- Review-Fix: `5c6d27c` (Suchanker nach kumulierter Weglänge).
- Native Implementierung: `09f7430` (DE/EN-Karten, Quellen/Alter, Validierung, Persistenz, Tests).
- Kein Push, Deployment, Production-Setting, Secretzugriff oder physisches iPhone. Der Integrator baut/installiert den finalen Kandidaten.

## Vorhandenes wiederverwendet

Der ältere `outdoorResearch`-Vertrag kennt Übernachtungskategorien, aber dessen OSM-Projektion hat begrenzte regionale Datenbestände und erzeugt bisher primär Hüttenkandidaten. Die aktive `dynamicResearch`-Planung hat bereits eine ortsunabhängige, begrenzte OSM-Suche, echte GraphHopper-Geometrie und geprüfte Quellenidentitäten. Diese Pipeline wird erweitert; kein zusätzlicher Anbieter, Import, Datenbankvertrag oder Research-Endpoint.

## Verhalten und Datenvertrag

- Bei expliziten DE/EN-Übernachtungs-/Mehrtagestour-Prompts folgt nach akzeptierter GraphHopper-Geometrie eine optionale OSM-Suche. Gewöhnliche Tageswanderungen bleiben unverändert. Keine automatische Etappenaufteilung, Buchung oder zusätzliche Routen-Wegpunkte.
- Die Suche nutzt maximal **einen noch verfügbaren Slot** des bestehenden Suchbudgets, maximal 2,5 Sekunden und einen 20-km-Suchkreis um den Punkt bei 50 % der kumulierten Geometrielänge (sphärisch auf dem betreffenden Segment interpoliert, unabhängig von Vertexdichte). Höchstens 20 Datensätze pro Kategorie. Keine vollständige Korridorabdeckung, insbesondere bei langen Touren. Die UI kennzeichnet die Auswahl als unvollständig.
- Kategorien: `alpine_hut`, `wilderness_hut`, `campsite`, `emergency_shelter` (letztere nur OSM `amenity=shelter` + `shelter_type=basic_hut`, separat von geplanten Übernachtungsplätzen). Bestehendes `hut` für reguläre Research-Stopps bleibt unverändert.
- Camping: `tourism=camp_site`; informelle/impromptu Plätze und `tents=no` ausgeschlossen. Explizit `access=no/private`, disused/abandoned ebenfalls ausgeschlossen. **Kein OSM-Tag beweist amtlichen Status oder Erlaubnis.** UI: „Als Zeltplatz kartiert · offizieller Status unbestätigt“. Keine rechtlich verifizierten Campingplätze behauptet.
- Maximal 12 Kandidaten innerhalb 2 km zum **gesamten akzeptierten Pfad**, sphärische Projektion auf endliche Segmente. Kein Abstand nur zum Start oder nächsten Stützpunkt. Kein errechneter Fußweg, Abstecher oder Gehzeit. Flächenzentren sind als solche benannt; kein Eingang behauptet.
- Exakte OSM-IDs dedupliziert; gleicher normalisierter Name/Kategorie innerhalb 50 m ebenfalls. Unbenannte Orte bleiben getrennte IDs und heißen in der UI „Name nicht erfasst“.
- Quellen: kanonischer OSM-Link mit Objektversion, Bearbeitungsdatum, Snapshot und Abrufzeit. Optionale Website/Betreiber stammen ausschließlich aus OSM, sind sichtbar ungeprüft und werden nicht serverseitig aufgerufen. Keine Betreiberquelle wird erfunden.
- Optionales `route.routeStays` in bestehender Schema-3-Antwort: Zustand `available/empty/unavailable`, `coverage=partial`, Quellenkandidaten und Geometrie-Digest (SHA-256, Koordinaten auf 1e-6 Grad quantisiert). Swift prüft Digest, Quellen, Alter und geometrischen Abstand selbst. Fehlerhafte Zusatzdaten werden „unavailable“; die valide Route bleibt erhalten.
- Verfügbare Daten können offline gespeichert werden; sie behalten ihr ursprüngliches Alter. Nach sieben Tagen erscheint ein Hinweis. Alte Saved-Routen ohne Zusatzfeld bleiben lesbar. Keine Hintergrund-Recherche, Offline-Suche oder Aktualitätsgarantie.

## UI und Nachweise

`RouteStaysView`: ruhige abgerundete Karte, DE/EN, native DisclosureGroups, Dynamic Type, zugängliche Beschriftungen. Kandidaten, Quellen und Apple-Maps-Pin sind optional aufklappbar. Not-/Schutzunterkünfte separat; keine Erlaubnis-, Wasser-, Öffnungs-, Buchungs- oder Zugangsversprechen. Vorher beim Betreiber prüfen.

Synthetische Fixtures liegen unter `TrailMindTests/Fixtures/route-stays-offline.json`. Simulator-Prüfpfad ausschließlich in bestehender `#if DEBUG && targetEnvironment(simulator)`-Testansicht, über `--trailmind-ui-testing --trailmind-ui-scenario core --trailmind-ui-evidence --trailmind-ui-stays`. Keine privaten Nutzerorte.

Backend validiert: Alpen, Schottland, Japan, Neuseeland; off-route/zu weit entfernte POIs; dünne Geometrie, stark ungleichmäßige Vertexdichte und Datumsgrenze; Dubletten/unbekannte Namen; fehlende bzw. unzulässige Website; alte Quelldaten; Fehler, Offline, ignorierte Abbruchsignale; geänderte Geometrie; Tageswanderung; erschöpftes Budget. Das ist **synthetische Vertragsevidenz, kein Live-Abdeckungsnachweis**.

- 224 Backend-Regressionstests bestanden (`dynamicResearch*.test.js`, `routeStays.test.js`, bestehende Outdoor-Vertrags-/Executor-/OSM-Policy-Tests).
- `npm --prefix backend run build`: 376 JS-Dateien ohne Fehler.
- Simulator-Build erfolgreich (`/private/tmp/stays-build.log`).
- 63 native XCTest-Tests bestanden (5 RouteStays, 13 Transport, 45 SavedRouteStore); dazu 3 UI-Tests. Abschließender UI-Lauf nach visueller Korrektur ebenfalls 3/3 grün.
- Testberichte: `/private/tmp/stays-tests-serial-20260929.xcresult` und `/private/tmp/stays-ui-final-20260929.xcresult`. Kompakte Ergebnisdateien und vier synthetische Screenshots unter `docs/verification/route-stays-20260929/` committed. Screenshots visuell geprüft: Quellen/Karte vollständig sichtbar, DE-Großschrift scrollbar, ehrliche Leer-/Fehlerzustände.
- Ein früher Testbericht scheiterte bei knappem Speicherplatz. Nur eigene fehlgeschlagene Reports/Intel-Zwischendateien bereinigt; danach vollständig erfolgreiche serielle Läufe.

## Vor iPhone-Integration durch den Integrator prüfen

1. Die drei oben genannten Commits plus abschließenden Handoff übernehmen; dann Gesamtbuild mit den anderen Release-Änderungen.
2. Backend und App müssen gemeinsam diesen Zusatzvertrag enthalten. Ein alter Server liefert das optionale Feld nicht. Kein Deployment wurde hier durchgeführt.
3. Autorisierter Live-Check an öffentlichen, nicht privaten Beispielorten mehrerer Regionen: OSM-Abdeckung, 2,5-s-Latenz und verbleibendes Suchbudget messen. Bei zwei bereits verbrauchten Suchslots bewusst „nicht geprüft“. Grenzwerte nicht ungeprüft erhöhen.
4. Für tatsächlich **offiziell verifizierte** Zeltplätze/Übernachtungserlaubnis ist eine passende aktuelle Betreiber-/Behördenquelle weiterhin ein externer Evidenzschritt. Die vorliegende Version behauptet dies ausdrücklich nicht und bietet keine Buchung.
5. Echte Routenänderung, Speichern/Offline-Wiederöffnen, fehlendes Netz, alte Daten, DE/EN und VoiceOver auf dem finalen iPhone-Kandidaten prüfen. Simulator-Tests ersetzen keine physische VoiceOver-Abnahme.
6. Lange Mehrtagestouren: unvollständige Suche und fehlende automatische Etappen-/Abstecherberechnung bewusst prüfen. Die Karte hilft bei der Vorbereitung; sie ist kein fertiger Hüttenreiseplan.

OSM-Semantik geprüft anhand der offiziellen Community-Dokumentation:
- https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dcamp_site
- https://wiki.openstreetmap.org/wiki/Tag:tourism%3Dwilderness_hut
- https://wiki.openstreetmap.org/wiki/Tag:shelter_type%3Dbasic_hut

## Kommunikation

Die direkte Statusnachricht an den Herkunfts-/Koordinator-Task wurde von der automatischen Freigabeprüfung als nicht bestätigte Weitergabe an einen anderen Task abgelehnt. Kein Umgehungsversuch. Dieser lokale Handoff ist der Übergabeweg. Bei der ersten sichtbaren Task-Inventur war kein konkurrierender Übernachtungs-Task erkennbar.
