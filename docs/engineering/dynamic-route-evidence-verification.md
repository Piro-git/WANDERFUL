# Prüfnachweis der Evidenzzuordnung

Basis: `03a430f17cbee03cc4017fee7c5e2022604c6027`.

Alle hier beschriebenen Providerantworten sind synthetische Offline-Fixtures. Es gab keine neue bezahlte Google-/GraphHopper-Anfrage, kein Deployment und keine Installation/Löschung auf dem physischen iPhone. Die damalige reale Webrecherche wurde nicht rekonstruiert.

## Ausgeführte Prüfungen

- 107 Backendtests bestanden: `node --test backend/test/dynamicResearch*.test.js backend/test/ownerPhone*.test.js`. Enthalten sind reale lokale HTTP-Endpunkte mit simulierten Providern, Routengeometrie-/Erreichbarkeits-/Budgetregressionen, Auswahlrevisionen, Quellenreferenzen, Unicode, Fehlerabbildung und die bisherige Owner-Testauthentifizierung.
- 54 native Fachtests bestanden: `DynamicWebResearchTests`, `DynamicResearchPlanningClientTests` und `SavedRouteStoreTests`, ausgeführt mit Xcode auf iPhone 17 Pro / iOS 26.5 Simulator. Referenzmanipulation, exakte finale Auswahl, Legacy-Envelope ohne Zuordnung, Ablauf und Speichern/Laden sind abgedeckt.
- 2 UI-Tests bestanden am 9. September 2026 um 09:08 Uhr (61,8 Sekunden): Auswahlrevision mit sichtbarem Ausschluss und erhaltenem Originaltext sowie fehlende/abgelaufene Recherche. Der finale Lauf endete mit `TEST EXECUTE SUCCEEDED`. Die neuen UI-Tests laufen gegen dieselbe produktive `DynamicRouteEvidenceView`, die `RouteDetailView` einsetzt. Ihr Einstieg und ihre synthetischen Daten sind ausschließlich in expliziten DEBUG-Simulator-Testläufen erreichbar.
- `git diff --check` ist sauber. `git apply --check` des exportierten Patches auf einer frischen Archivkopie von `03a430f` ist erfolgreich. Das Git-Bundle wurde mit `git bundle verify` geprüft.

Regulärer nativer Testbefehl:

```sh
xcodebuild -project TrailMind.xcodeproj -scheme TrailMind \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /private/tmp/route-evidence-complete \
  CODE_SIGNING_ALLOWED=NO -parallel-testing-enabled NO \
  -only-testing:TrailMindTests/DynamicWebResearchTests \
  -only-testing:TrailMindTests/DynamicResearchPlanningClientTests \
  -only-testing:TrailMindTests/SavedRouteStoreTests \
  -only-testing:TrailMindUITests/DynamicEvidenceUITests test
```

## Datenhaltung

`DynamicWebResearch` inklusive `routeEvidence` ist nur decodierbar und transient. Keine neuen Persistenzfelder, Logs oder Caches für reale Recherche. Die Speicherregression prüft ausdrücklich, dass Originaltext, Quellendomäne, Suchvorschläge und Zuordnungsdaten nicht in gespeicherte Routen gelangen. OSM-Stopps und bestehende Routengeometrie bleiben erhalten. Die Anzeige erklärt fehlende Recherche und entfernt abgelaufene Recherche aus der sichtbaren Antwort.

## Lokale Git-Sicherung und Integration

Der anfängliche Worktree war sauber. Der Import aus dem vorgegebenen Reparatur-Repository brachte den korrekten Basisstand in die Arbeitsdateien. Das gemeinsame Git-Verzeichnis unter Documents lieferte anschließend Pack-/Index-Lese-Timeouts; parallel war das Dateisystem zeitweise voll. Deshalb liegt ein eigenständiges lokales Git-Verzeichnis unter `.route-evidence.git` in diesem Workspace. Die originale `.git`-Verknüpfung wurde nicht ersetzt. Für diesen Patch gilt:

```sh
git --git-dir=.route-evidence.git status --short
git --git-dir=.route-evidence.git log -1 --oneline
```

Das kleine `.route-evidence-artifacts/route-evidence.bundle` enthält nur den Patch-Branch oberhalb des genannten Basiscommits. Es kann in einem gesunden Integrationscheckout geladen werden; anschließend lässt sich der Commit gezielt übernehmen. Die `.patch`-Datei ist die alternative, direkt lesbare Darstellung. Das gemeinsame Git-Repository und das ursprüngliche Reparatur-Checkout benötigen keine Reparatur durch diesen Patch.

Die Schnittstelle zum parallel geplanten Optimierungstask ist in `dynamic-route-evidence-v1.md` beschrieben. Der Task war über die Task-Liste nicht mit einer verifizierten endgültigen ID auffindbar; es wurden keine Änderungen in einem anderen Task vorgenommen.

## Grenzen

Die Zuordnung bestätigt keine aktuellen Bedingungen und löst keine widersprüchlichen Quellenaussagen semantisch auf. Allgemeine Park-/Tourismusseiten bleiben ohne unabhängigen Identitätsnachweis unzugeordnet, auch wenn ihr Text einen ähnlichen Namen nennt. Ein exakter gelesener OSM-Quellenlink belegt die Attribution an diesen Datensatz, nicht die Wahrheit oder Aktualität jedes Satzes. Es wurde kein zusätzlicher Modellaufruf eingeführt.

## UI-Testverlauf

Die frühen gemeinsamen Simulatorläufe zeigten fehlende/abgelaufene Evidenz korrekt. Beim Revisionsfall konnte XCTest den aufgeklappten Inhalt zunächst nicht zuverlässig abfragen. Während der Untersuchung wurde der umgebende `TimelineView` durch einen normalen `VStack` ersetzt; die minütliche Ablaufprüfung läuft jetzt in einer abbrechbaren View-Task. Diese UI-Korrektur wurde erneut erfolgreich gebaut. Der isolierte Screenshot zeigt die finale Stoppliste und den ausgeschlossenen Stop korrekt. Der verbleibende Testfehler betrifft die Accessibility-Abfrage: iOS meldet unterschiedliche Legacy-/Modern-Elementtypen und reicht die erwartete ID nicht durch. Der Test sucht deshalb den exakten sichtbaren Ausschlusstext über alle Elementtypen und prüft weiterhin Existenz und Sichtbarkeit.

Weitere Versuche scheiterten vor oder während des Teststarts an der Simulator-Infrastruktur (AX-Lade-Timeout, Busy-Preflight, beendete App beziehungsweise normale Home-Ansicht statt Testansicht). Diese Versuche sind ausdrücklich keine positiven UI-Nachweise. Für den abschließenden Lauf wurde ein eigener Simulator „Wanderful Evidence QA“ (iPhone 17 Pro / iOS 26.5) angelegt.

Der abschließende isolierte Lauf nach Korrektur der Accessibility-Abfrage ist vollständig bestanden: 2 Tests, 0 Fehler. Die XCTAttachment „Revised route — offline fixture“ wurde gesichert und visuell geprüft. Der eigene Simulator und temporäre Builddaten wurden nach Sicherung der kompakten Prüfnachweise entfernt.

Reproduktionsziel des finalen UI-Laufs: `platform=iOS Simulator,id=ECD14FC0-F934-4993-B62A-DD53FDA793F5`, ausschließlich `TrailMindUITests/DynamicEvidenceUITests`, `test-without-building` nach erfolgreichem `build-for-testing`. Für eine Wiederholung ist ein vorhandener oder neu angelegter iPhone-17-Pro-Simulator einzusetzen.
