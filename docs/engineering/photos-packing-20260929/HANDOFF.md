# Fotos & Packliste — Handoff 2026-09-29

Checkout: `/private/tmp/wanderful-photos-packing-20260929`
Branch: `codex/photos-packing-ui-20260929`, Basis `83a99c0`. Kein Push, Deployment, Secretzugriff, iPhone-Install oder Wetterdatei geändert.

## Übernahme

Vier fachliche Commits in dieser Reihenfolge übernehmen:

1. `cb3eb30` — Orts-/Dateiidentität: lokaler Resolver prüft Wikidata-ID, eindeutiges nicht veraltetes P18, Erdkoordinate innerhalb 250 m, MIME, vollständige Attribution und identische Commons-/Thumbnail-Datei. Cache berücksichtigt Koordinaten. App-/Backend-Dateiabgleich angeglichen.
2. `f9a1568` — **Live gefundener Defekt:** Commons liefert unterstützte Lizenz-URLs auch ohne abschließenden Slash. App und Backend normalisieren diese Variante, ohne die Lizenz-Whitelist zu erweitern. Datierten öffentlichen Metadatenbeleg mit übernehmen.
3. `4a61cff` — DE/EN-Packliste inkl. Katalog, Gründe, Extras, Camping/Hütte, Fortschritt, Fehlermeldungen und VoiceOver. Persistierte IDs, Enum-Werte, eigene Texte und Häkchen bleiben unverändert. Sprachwechsel übersetzt nur die Anzeige. Zusätzliche Legacy-/Sprachtests und Simulator-Testansicht.
4. `a680335` — Eine kompakte Galerie statt doppelter Bilder in Stoppliste; gleiche Quelldatei wird nur einmal dargestellt. Vollständige, nicht abgeschnittene Urheberangabe und Lizenz in eigener Quellenansicht; 44pt-Aktionen. Ehrlicher Lade-/Fehler-/Leerzustand. Gespeicherte Fotos werden vor Darstellung erneut validiert. Technische Stop-Informationen hinter Details. Aktualisierte UI-Tests.

`2995fe1` wurde gelesen, nicht pauschal übernommen: dessen Dateiquellen-Abgleich ist in `cb3eb30` enthalten; die nicht abgeschnittene Attribution und ehrliche Überschrift sind im Galerie-Umbau berücksichtigt. Übrige Privacy-/Release-Gates dieses fremden Commits bleiben Sache des Integrators. Bei späterem Cherry-pick sind Konflikte in Resolver/Galerie/ResolverTests semantisch aufzulösen.

## Belege und Grenzen

- **183/183 Backend-Tests grün**: `node --test backend/test/dynamicResearch*.test.js`. Native-Flow-Tests benötigen Loopback-Freigabe; anfängliches fehlendes `pg` mit gepinnten Abhängigkeiten (`npm ci --ignore-scripts`) behoben. Finale Ausgabe: `/private/tmp/wanderful-photos-packing-backend-final.log`.
- Erster iOS-Simulator-Build erfolgreich; anschließend **26/26** Resolver-/DynamicResearch-Tests erfolgreich.
- Erweiterter iOS-Lauf mit 79 Fällen prüfte auch SavedRouteStore. Der neue Sprachtest deckte einen echten Bundle-Lokalisierungsfehler auf. Nach Korrektur **alle 9 HikePreparationTests grün**, einschließlich DE/EN-Katalog und alter v1-Liste ohne Enrichment (Hütte, gepackt, ausgeschlossen, eigener Gegenstand).
- Zwei ältere UI-Tests liefen zunächst fehl: implizite Gerätesprache Deutsch statt Englisch und Accessibility-ID-Vererbung im DisclosureGroup. Tests setzen jetzt explizit die App-Sprache; Identifier liegt am Disclosure-Label. Diese Korrekturen sind **noch nicht erfolgreich nachgetestet**.
- Letzter Test-Build mit allen finalen Swift-/UI-Teständerungen: **TEST BUILD SUCCEEDED** im Log `test_sim_2026-09-29T13-28-36-016Z_pid81469_53230151.log` unter `~/Library/Developer/XcodeBuildMCP/workspaces/EasyWander-984081efadb6/logs/`. Ausführung danach durch heruntergefahrenen gemeinsamen Simulator und `ENOSPC` blockiert. Auf Koordinator-Anweisung kein Boot oder weiterer UI-Retry. Eigene temporäre DerivedData (1,4 GB) entfernt, um Platz freizugeben. **Kein finaler grüner XCTest-Gesamtlauf behauptet.**
- `live-metadata.json`: echter öffentlicher Resolver-Durchlauf für Zugspitze (CC BY-SA 4.0) und Fuji (CC BY-SA 3.0), vollständige Attribution/Dateiidentität. Everest-Foto (CC BY-SA 2.0) bleibt bewusst ausgeschlossen. Keine Bilder heruntergeladen oder gerendert. Koordinaten stammen hier aus Wikidata, nicht aus einer live geplanten OSM-Route: **kein End-to-End-Live-Routenbeweis**.
- Zwei zusätzliche Resolver-/App-Vertragsfälle (datiertes Live-Metadatenformat, falsche gespeicherte Attribution; falsche Entity/mehrdeutiges oder veraltetes P18) sind kompiliert, im letzten blockierten Lauf **nicht als bestanden belegt**.

## Integrator-Abnahme — weiterhin offen

Auf einem exklusiv verfügbaren Simulator die Klassen `HikePreparationTests`, `WikimediaCommonsPhotoResolverTests`, `DynamicResearchPlanningClientTests`, `SavedRouteStoreTests` und `DynamicEvidenceUITests` erneut ausführen. Die öffentliche JSON-Datei muss für den datierten Vertragstest im Checkout enthalten bleiben.

**Gerenderte Galerie und Packliste sowie dauerhafte Persistenz auf dem aktuellen iPhone sind ausdrücklich Integrator-Abnahme**, kein erledigtes Gate dieses Tasks:

- Echte live berechnete Route mit nachweislich zugeordnetem Commons-Foto; zweite Region; Foto nur einmal, richtiger Stopp, Quelle/Urheber/Lizenz komplett lesbar. Titel und Foto sind kein Versprechen über heutige Aussicht oder Bedingungen.
- Kein P18/Commons-Tag, ID-/Dateimismatch, fehlende/falsche Lizenz: ehrlicher Leerzustand. Offline, HTTP-/Bildfehler: Route bleibt bedienbar, kein fremdes Ersatzfoto. Alte gespeicherte Route mit und ohne Foto öffnen.
- DE und EN: Packlistenkarte, Fortschritt, Tagestour → Zelt → Hütte → Tagestour; Häkchen/„nicht benötigt“/Wiederherstellen, eigenes Element hinzufügen/ändern/löschen. App beenden/neustarten und Sprache wechseln; Zustand pro Route muss erhalten bleiben. Gleiche Bedingungen auf dem aktuellen iPhone prüfen.
- Standardtext und größte Dynamic-Type-Stufen, VoiceOver-Reihenfolge/Zustände, Reduced Motion, schmale Breite. Besonders Fotoquellen-Sheet mit langer Attribution und Packzeilen mit langen deutschen Begriffen prüfen.
- Neue synthetische Simulator-Packlistenansicht: bestehende Testargumente plus `--trailmind-ui-preparation`; nur `DEBUG && simulator`, kein Produktions-Debugschalter. Der neue UI-Test prüft DE/EN, Camping-Auswahl und Wasser-Häkchen; dessen finaler Lauf ist offen.

Risiken: Lizenz-Whitelist bewusst konservativ; einige echte Bilder fehlen weiterhin. Foto-Thumbnails werden nicht dauerhaft für Offline-Nutzung gespeichert. Beschädigte/neue Packlisten-Versionen bleiben geschützt und blockieren Bearbeitung statt still überschrieben zu werden. Keine iPhone-Persistenz-, VoiceOver- oder finale Screenshot-Abnahme erfolgt. Lokalisierung umfasst die betroffenen Screens, nicht externen Recherchetext oder benutzereigene Titel.
