# Verifikation: Zugang und lokale Hinweise

> Source-only publication: referenced UI screenshots are retained locally by the integration owner; no screenshot PNG bytes are included or retrievable from this branch. Textual test results are retained; visual acceptance is not independently reproducible from this PR alone.

Stand: 9. September 2026. Basis `03a430f17cbee03cc4017fee7c5e2022604c6027`, Branch `codex/access-local-advisories` im unabhängigen Checkout `~/Library/Application Support/Wanderful-Recovery/codex/access-local-advisories`.

## Backend

Ausführung aus `backend/` mit vorhandenen Abhängigkeiten:

```sh
node --test --test-concurrency=1 test/*.test.js
```

Die Testauswahl umfasst die eigentlichen Testdateien. Ein unbeschränktes `node --test` entdeckt zusätzlich `scripts/start-owner-phone-test.js`, das ohne gesonderte Owner-Autorisierung erwartungsgemäß abbricht; dieser Startskript wurde nicht freigeschaltet. Zwei ältere Tests verwendeten URL.pathname als Dateipfad und scheiterten im neuen Checkout an `Application Support`; sie verwenden jetzt Node `fileURLToPath`. Kein Produktionsverhalten wurde dafür geändert.

Abschließender vollständiger Lauf nach dem OSM-Typidentitäts-Fix: **1.366 Tests erfolgreich, 0 fehlgeschlagen**, 58,8 Sekunden. Log: `/private/tmp/wanderful-backend-final-verified.log`. Der vorherige vollständige Lauf mit 1.365 Tests und die anschließenden 19 gezielten Zugangs-/Routingtests waren ebenfalls erfolgreich.

Die optionalen echten PostgreSQL/PostGIS-, Supabase-Owner- und Volumen-/Performance-Suites sind ohne ihre gesonderten Fixtures auf Suite-Ebene übersprungen; die Node-Zusammenfassung kann dabei `skipped 0` für einzelne Tests ausweisen. Diese Umgebungen wurden nicht als verifiziert gewertet.

Abgedeckte neue Fälle:

- isolierter POI, geometrisch naher aber topologisch fremder Weg, explizite Rechte, aktivitätsspezifische Verbote, bedingte Rechte und Barrieren;
- belegter Eingang am geschlossenen POI-Rand, fremder Randknoten, getrennte Node-/Way-Identität trotz gleicher Nummer, keine Besuchsbehauptung und keine erfundene Restgehstrecke;
- unvollständige/stale/vergiftete OSM-Daten, Grenzen, 429 ohne Retry und Abbruch;
- räumlich unpassende Meldung, Polygonlöcher, Linien-/Brückenkonflikt, zusammengehörige Warngebiete und Rechenlimit;
- Publikation versus Abruf, Gültigkeit versus Wandertermin, veraltete/abgelaufene/widerrufene/widersprüchliche Meldungen, keine Löschung nach fehlgeschlagenem Folgeabruf;
- frühes Aussortieren ohne Routingaufruf, wiederholter fehlgeschlagener Kandidat mit anderem Begleitstopp, kein Zusatz-LLM-Aufruf und alle ursprünglichen harten Routinggrenzen.

Offline-Effizienzbeleg: **ein vermiedener Routenaufruf** beim wiederholten verfehlten Stopp (`avoidedRouteCalls = 1`). Daraus wird keine Live-Latenz oder Erfolgsquote abgeleitet.

## Native Build und Tests

XcodeBuildMCP, Scheme `TrailMind`, Debug, iPhone 17 Pro Simulator mit iOS 26.5. Vorhandene Swift-Pakete wurden aus `~/Library/Application Support/Wanderful-Recovery/SourcePackages` verwendet; automatische Paketauflösung/Updates und Code Signing waren deaktiviert.

- `build_sim`: **erfolgreich**. Der erste Werkzeugaufruf lief in sein 300-Sekunden-Limit; der nachfolgende inkrementelle Build bestätigte den erfolgreichen Abschluss.
- `RoutePlanningEvidenceTests`, `DynamicResearchPlanningClientTests`, `DynamicWebResearchTests`, `SavedRouteStoreTests`: **56 erfolgreich, 0 fehlgeschlagen**.
- Nach Ergänzung der Eingangs-/Terminvertragsfälle und Korrektur des Screenshot-Testfensters: die beiden betroffenen Suites erneut, **11 erfolgreich, 0 fehlgeschlagen**. Insgesamt 58 unterschiedliche ausgewählte native Tests; kein vollständiger Lauf aller nativen Tests behauptet.
- Letzter Test-Build meldete eine bereits bestehende `WKNavigationDelegate`-Warnung in `DynamicWebResearchView.swift:70`. Die neue UIWindow-Deprecation wurde im Testaufbau durch UIWindowScene beseitigt.
- `git diff --check`: sauber.

Ergebnis-Bundles:

- `/private/tmp/wanderful-access-native-tests.xcresult`
- `/private/tmp/wanderful-access-native-final.xcresult`

Build-/Testlogs:

- `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-fa381258e1ba/logs/build_sim_2026-09-09T06-46-02-955Z_pid1789_546ca045.log`
- `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-fa381258e1ba/logs/test_sim_2026-09-09T06-56-52-042Z_pid1789_d607a26f.log`

## Tatsächlich betrachtete native Darstellung

Der erste Screenshot-Test erzeugte schwarze Bilder, obwohl die Tests bestanden. Diese Bilder wurden **nicht** als visuelle Bestätigung gewertet. Das Fenster ist nun an die echte Simulator-UIWindowScene gebunden; der Test prüft erfolgreiches Zeichnen und verwirft leere Bilder. Die unten gespeicherten, erneut erzeugten Anhänge wurden anschließend visuell betrachtet.

Die Offline-Fixture zeigt eine Meldung mit unbestätigter Gültigkeit, einen Quellenlink, unvollständige Abdeckung und den echten Prüfzeitstempel. Bei Standardschrift sind Inhalt und Quellen-Disclosure sichtbar. Bei `accessibility3` bricht der Inhalt in mehrere Zeilen um und setzt sich im vertikalen Scrollbereich fort; der Screenshot dokumentiert dessen oberen Ausschnitt. Keine Live-Meldung und keine vollständige Interaktions-/VoiceOver-Abnahme behauptet.

Local-only screenshot (not published): Native Hinweiskarte bei Standardschrift

Local-only screenshot (not published): Native Hinweiskarte bei accessibility3, oberer Scrollausschnitt

## Nicht durchgeführt / Integration

Kein Deployment, kein physisches iPhone, keine bezahlten Gemini-/GraphHopper-Liveaufrufe, keine Schlüssel-/Secretdateien. Die kostenlose Formatprüfung und ihre begrenzten Ergebnisse stehen im [Implementierungsbericht](access-local-conditions.md). Der alte Owner-Netzwerk-Wrapper kennt die neuen Hinweis-Endpunkte noch nicht; unter dieser Allowlist bleiben sie sichtbar unavailable. Freigabe der begrenzten Adapter in der zukünftigen Runtime sowie Zusammenführung mit dem separat bearbeiteten Effizienzpatch sind Integrationsarbeit und nicht als ausgeliefert behauptet.
