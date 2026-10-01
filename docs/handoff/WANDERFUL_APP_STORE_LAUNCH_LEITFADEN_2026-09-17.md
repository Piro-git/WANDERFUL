> Historical archive, reviewed 2026-10-01. This dated document is not current authorization, operational status, or release approval. Private device, signing and credential-storage identifiers have been omitted where present. See Draft PR #1 for the current candidate.

# Wanderful: vollständiger Weg zum App-Store-Launch

Stand: 17. September 2026. Arbeitsdokument für den Betreiber und die Engineering-Agents.

Dieses Dokument beschreibt die noch erforderliche Arbeit, nicht eine bereits erteilte Launchfreigabe. Es veröffentlicht nichts. Neue Erkenntnisse müssen mit Datum, Commit und Beleg eingetragen werden. Ein bestandener Build beweist keine funktionierende Anmeldung, keinen Kauf und keine erfolgreiche Route auf dem iPhone.

## 1. Ziel und verbindliche Reihenfolge

Wanderful soll aus einer frei formulierten Wanderidee einen nachvollziehbaren Plan erstellen: Die KI recherchiert reale Orte und Highlights; GraphHopper berechnet begehbare Routengeometrie und Messwerte; die App zeigt Karte, passende echte Highlight-Fotos, Packliste und Hinweise. Deutsch und Englisch gehören zum geplanten Umfang. Der Nutzer möchte Apple-Login und Abos ebenfalls fertigstellen.

Die App soll verschiedene Regionen unterstützen. Harz-Beispiele sind Testfälle, keine Produktbegrenzung. Eine weltweite Suchmöglichkeit ist jedoch keine Garantie, dass überall geeignete Wege, recherchierbare Highlights oder Fotos verfügbar sind.

Die Reihenfolge lautet:

1. Einen gemeinsamen Kandidaten integrieren und lokal testen.
2. Genau dessen Backend auf Vercel bereitstellen und echte Routen prüfen.
3. Den vollständigen Ablauf auf einem echten iPhone abnehmen.
4. Apple-Login und Abos technisch konfigurieren, aktivieren und real testen.
5. Den dadurch entstandenen endgültigen Kandidaten erneut prüfen, archivieren und über TestFlight testen.
6. Finale Store-Inhalte und Datenschutzangaben mit diesem Build abgleichen.
7. Nach ausdrücklicher Einreichungsfreigabe an Apple senden; nach Genehmigung kontrolliert veröffentlichen.

Vorbereitende Arbeiten wie Betreiberangaben und Apple-Zugang können parallel erfolgen. Screenshots des endgültigen Produkts und endgültige Freigaben kommen erst nach der funktionalen Abnahme. Änderungen an Login oder Käufen nach dem ersten iPhone-Test verlangen eine erneute Prüfung der betroffenen Abläufe.

## 2. Momentaufnahme: Was ist bereits vorhanden?

Die geprüfte gemeinsame Quelle liegt hier:

`/Users/piroscheibe/Library/Application Support/Wanderful-Recovery/release-wave-20260915/integration`

Beim Erstellen dieses Dokuments war HEAD `99b7a0a` und der Arbeitsbaum sauber. Der zuvor gemeldete Kandidat `02947be` hatte laut Integrator bestandene Backend-Tests und einen erfolgreichen Simulator-Build. Diese Aussage darf nicht ungeprüft auf spätere Änderungen oder auf alle Laufzeittests übertragen werden.

| Bereich | Vorhanden | Noch nicht als fertig belegt |
|---|---|---|
| KI-Routen | Backend, Recherche-/Routingvertrag und Regressionen | Aktuelles dauerhaftes Deployment und vollständige reale Prüfung |
| Wikimedia | Wikidata-P18 sowie direkte OSM-Commons-Dateiverknüpfung, Ortsprüfung, Attribution | Vollständige Anzeige an echten Routen im endgültigen iPhone-Build |
| Packliste | Lokale Checkboxen, Zustandsabgleich, optionale KI-Ergänzungen | Geräteprüfung einschließlich Neustart und Fehlerfällen |
| DE/EN | Übersetzungen und Sprachwahl | Vollständige visuelle Abnahme |
| Account | Apple-Login-/Session-/Löschlogik und Konfiguration | Apple-Entitlements, Provisioning, aktivierter Server und echte Abnahme |
| Käufe | StoreKit-Grundlage, Wochen-/Jahreskonfiguration, Testkorrekturen | Produktverfügbarkeit und vollständiger Kauflebenszyklus |
| Store | Texte, Datenschutzinventar, Checklisten | Endgültige Betreiberangaben, Upload, Screenshots und Review |
| GitHub | Repositoryzugang per Connector bekannt | Exakte aktuelle lokale Git-Historie erfolgreich gesichert |

Die Vercel-Übergabe meldet eine service-seitige Ablehnung eines Uploads wegen verlangter spezifischer Bestätigung. Der genaue ursprüngliche Ablehnungsbeleg ist noch zu prüfen. Daraus folgt weder, dass Vercel grundsätzlich unzugänglich ist, noch dass ein Deployment bereits stattgefunden hat.

## 3. Zuständigkeiten und Arbeitsregeln

- **Betreiber:** Rechtsträger, Apple-Mitgliedschaft, Verträge, geschäftliche Angaben, Preise und finale Veröffentlichung entscheiden.
- **Integrator:** Gemeinsamen Code übernehmen, Builds und Simulator-/Gerätetests durchführen, Kandidaten auswählen.
- **Backend-Engineer:** Hosting, Providerkonfiguration, Datenbank, Live-Routing und Betriebsbereitschaft nachweisen.
- **QA-/Feature-Engineer:** Konkrete Fehler auf isoliertem Branch korrigieren und gezielte Regressionen liefern.
- **Store-Verantwortlicher:** Metadaten, Datenschutzinventar, Screenshots und Einreichungsunterlagen auf den tatsächlichen Kandidaten abstimmen.

Nur der Integrator verändert den gemeinsamen Release-Clone. Große Xcode-Builds laufen einzeln. Andere Agents liefern kleine Commits mit exaktem Quellpfad. Keine Änderungen aus dem alten Hauptcheckout ungeprüft übernehmen. Keine Secrets in Git, Dokumenten, Screenshots oder Nachrichten speichern.

Jeder erledigte Punkt braucht: Datum, Verantwortlichen, Kandidaten-SHA beziehungsweise Buildnummer, Prüfung und Beleg. „Agent fertig“, „kompiliert“ und „Test übersprungen“ sind keine Funktionsabnahme.

## 4. Phase A – Gemeinsamen Code fertigstellen

**Owner: Integrator. Voraussetzung: Zugriff auf die vorhandenen isolierten Clones.**

1. [ ] Aktuellen Branch, HEAD, Arbeitsbaum und freien Speicher prüfen.
2. [ ] Alle Feature-Übergaben gegen die tatsächlich enthaltenen Änderungen vergleichen; nicht nur Commitnummern vergleichen, da Cherry-Picks neue Nummern erzeugen.
3. [ ] Prüfen, dass Wikimedia-Fallback und Ortsvalidierung, Account-Konfiguration, StoreKit-Testkorrekturen und Vercel-Bereitschaftsprüfung enthalten sind.
4. [ ] Dokumentationsstände zusammenführen, ohne falsche frühere Behauptungen über nicht vorhandene Features weiterzuführen.
5. [ ] Abhängigkeiten aus den vorhandenen Lockfiles reproduzierbar herstellen; einen fehlenden lokalen Dependency-Ordner nicht als Produktfehler behandeln.
6. [ ] Backend-Testlauf ausführen; Fehler einzeln untersuchen, korrigieren und betroffene Regressionen erneut prüfen.
7. [ ] Native Unit- und UI-Tests auf einem tatsächlich gestarteten Simulator ausführen. Falls kein Gerät angelegt ist, mit vorhandener kompatibler Runtime eines anlegen. Bei Fehlern den konkreten CoreSimulator-/Runtimefehler erfassen.
8. [ ] StoreKit-Katalogtest getrennt vom Kauf-UI-Test prüfen. Leere Produktantworten nicht durch Entfernen wichtiger Assertions kaschieren.
9. [ ] Release-nahe Konfiguration bauen. Debug-Erfolg allein reicht nicht.
10. [ ] Relevante Warnungen, ungültige Ressourcen, Platzhalter und Entwickleroberflächen prüfen.
11. [ ] Nach Änderungen erneut gezielt testen; vor Übergabe einen konsistenten vollständigen relevanten Testlauf dokumentieren.
12. [ ] Kandidaten-SHA mit Prüfbericht festhalten. Keine weiteren unkoordinierten Änderungen an diesem Kandidaten.

**Abschluss:** Ein sauberer gemeinsamer Kandidat, erfolgreiche relevante Tests und eine getrennte Liste echter externer Blocker. Ein übersprungener notwendiger Test bleibt offen.

## 5. Phase B – Vercel und Provider live schalten

**Owner: Backend-Engineer. Voraussetzung für den eigentlichen Release: geprüfter Kandidat aus Phase A.**

### B1. Richtige Quelle und richtiges Projekt

1. [ ] Vercel-Team und Backend-Projekt anhand bestehender Zuordnung prüfen. Andere Projekte des Betreibers nicht verändern.
2. [ ] Exakten Backend-Quellstand aus dem Integrationskandidaten verwenden. Ein älterer erfolgreicher Vercel-Build ist kein Beleg für diesen Stand.
3. [ ] Vor dem Upload Projekt, Quellpfad, SHA, Zielumgebung und betroffene öffentliche Adresse festhalten.
4. [ ] Tatsächliche Connector-Fähigkeit prüfen: Führt er einen Upload aus oder liefert er nur Anweisungen?
5. [ ] Bei einer echten Freigabeablehnung deren genauen Wortlaut sichern. Keine Umgehung über einen anderen Uploader. Eine gegebenenfalls nötige Bestätigung betrifft die konkrete vorbereitete Aktion.

### B2. Konfiguration vollständig herstellen

6. [ ] Dauerhafte HTTPS-Adresse und TLS prüfen; kein temporärer Entwicklungsserver als Launch-Backend.
7. [ ] Erforderliche Konfigurationsnamen mit dem aktuellen Code abgleichen. Secretwerte ausschließlich in dafür vorgesehenem Hosting-/Secret-Speicher hinterlegen.
8. [ ] Gemini-Modellzugang, Abrechnung, Quoten und Zugriff auf tatsächlich verwendete Recherchewerkzeuge prüfen. Ein eingezahltes Guthaben allein beweist keinen erfolgreichen Modellaufruf.
9. [ ] GraphHopper-Profil, Kontingent und erforderliche Routingfunktionen mit einem echten Aufruf prüfen.
10. [ ] Dauerhafte App-Attest-/Replay-/Kontingent-Datenbank konfigurieren, Rollenrechte begrenzen und erforderliche Migrationen kontrolliert anwenden.
11. [ ] Verbindungen, TLS, Zeitlimits und zulässige Parallelität von Hosting und Datenbank aufeinander abstimmen.
12. [ ] Entwicklungsumgehungen und In-Memory-Produktionsspeicher ausgeschaltet lassen.
13. [ ] Anfrage- und Kostengrenzen für Testbetrieb und Launch getrennt festlegen. Die bisherige Größenordnung von 1–10 Anfragen täglich ist kein automatisch passendes öffentliches Launchlimit.
14. [ ] Fehlermeldungen bei ausgeschöpftem Kontingent, Providerfehler und Zeitüberschreitung verständlich machen.

### B3. Deployment und reale Prüfung

15. [ ] Zulässigen Upload durchführen; Deployment-ID und zugehörigen SHA sichern.
16. [ ] `/healthz` und `/readyz` prüfen. Eine erfolgreiche statische Konfigurationsprüfung beweist noch keine funktionierenden Provider oder Datenbankverbindungen.
17. [ ] Eine echte Anfrage durch die gesamte Serverkette ausführen.
18. [ ] Prüfen, dass Recherche, Ortsauswahl und GraphHopper tatsächlich erreicht wurden; keine Parser-/Demoantwort als KI-Erfolg zählen.
19. [ ] Mehrere Regionen und eigene neue Formulierungen testen. Beispiele sind Prüffälle, keine Liste ausschließlich erlaubter Sätze.
20. [ ] Ergebnis mit Karten-/Ortsdaten plausibilisieren: Startpunkt, Zwischenstopps, Loop-Schluss, Distanz, Dauer und Höhenwerte.
21. [ ] Negativfälle testen: unklarer Ort, ungeeigneter Wunsch, keine passende Verbindung, Providerfehler, Kontingent und Abbruch.
22. [ ] Verbrauch und Laufzeit erfassen, ohne private Prompts und Koordinaten unnötig zu protokollieren.
23. [ ] Wiederherstellungsweg für eine fehlerhafte Bereitstellung festlegen. Datenbankänderungen dabei gesondert berücksichtigen.

**Abschluss:** Aktuelle Deployment-ID, erreichbarer Host und erfolgreiche reale Ende-zu-Ende-Prüfungen. Erst dann die App auf diesen Host konfigurieren.

## 6. Phase C – Routingqualität und Wikimedia abnehmen

**Owner: Integrator und QA, gemeinsam mit Backend.**

### C1. Routen

1. [ ] Frei formulierte deutsche und englische Wünsche testen.
2. [ ] Loop und Punkt-zu-Punkt prüfen, bestehende Routingflows erhalten.
3. [ ] Wünsche nach Aussicht, Wasserfall oder anderen Highlights auf tatsächlich gefundene Orte zurückführen.
4. [ ] Ausgewählte Highlights müssen zur Route passen. Eine weit entfernte Sehenswürdigkeit darf nicht als Zwischenstopp erscheinen.
5. [ ] Abweichung von Wunschdistanz klar anzeigen; keine erfundenen exakten Treffer erzwingen.
6. [ ] Wenn keine passende Route existiert, verständliche Erklärung und sinnvolle Bearbeitung des Wunsches ermöglichen.
7. [ ] Recherchequellen und gemessene Routingdaten getrennt verstehen: GraphHopper bestätigt weder aktuelle Wegfreigabe noch Wasserverfügbarkeit oder Sicherheit.
8. [ ] Ladezustand, Abbrechen, erneute Anfrage und verzögerte Antwort auf widerspruchsfreien Zustand prüfen.

### C2. Fotos pro Highlight

9. [ ] Jedes ausgewählte Highlight in die Bildauflösung aufnehmen.
10. [ ] Wikidata-P18-Treffer mit dem tatsächlichen Highlight verknüpfen.
11. [ ] Ohne geeigneten P18-Treffer den vorhandenen direkten OSM-Commons-Dateiverweis prüfen.
12. [ ] OSM-Identität, kanonische Ortsquelle, Koordinaten und sichere Dateiangabe prüfen. Gleicher Name allein reicht nicht.
13. [ ] Für jede angezeigte Datei Autor, Quelle und unterstützte Lizenz übernehmen und lesbar anzeigen.
14. [ ] Quellen- und Lizenzlinks öffnen und kontrollieren.
15. [ ] Zwei gleichnamige Orte als Negativtest verwenden; keine Verwechslung zulassen.
16. [ ] Einen Ort ohne Bild testen. Kein erfundenes Ersatzbild und kein anderer Ort als angeblicher Treffer.
17. [ ] Mehrere Bilder parallel laden; ein Fehler darf die übrigen Highlights und die Route nicht blockieren.
18. [ ] Zeitlimit, Netzwerkfehler, Rate-Limit und Abbrechen prüfen.
19. [ ] Doppelte Anzeige desselben Bildes in Galerie und Detailabschnitt vermeiden, soweit sie keinen Nutzen hat.
20. [ ] Tatsächlich sichtbare Fotos an einer echten Route auf dem iPhone prüfen. Ein erfolgreicher Metadatenabruf allein reicht nicht.
21. [ ] Bildbereich auf Deutsch und Englisch lesen, kleine Displays und größere Schrift prüfen.

**Abschluss:** Mindestens ein echter positiver Highlight-Bildfall und ein absichtlicher Kein-Bild-Fall sichtbar abgenommen. Die Implementation bietet keine Garantie für ein Foto an jedem Ort; Marketing muss das berücksichtigen.

## 7. Phase D – Packliste, Hinweise und Sprache

**Owner: Integrator/QA.**

1. [ ] Packliste einer echten Route öffnen und nachvollziehbare Kategorien prüfen.
2. [ ] Mehrere Dinge abhaken, Ansicht schließen, wieder öffnen und Zustand vergleichen.
3. [ ] App vollständig beenden und neu starten; Häkchen müssen erhalten bleiben.
4. [ ] Zwischen zwei Routen wechseln; Listen dürfen sich nicht gegenseitig überschreiben.
5. [ ] Übernachtungs-/Tourauswahl ändern und zurückwechseln; bekannte Zustände dürfen nicht ungewollt verloren gehen.
6. [ ] KI-Ergänzungen explizit anfordern und prüfen, dass vorhandene Häkchen erhalten bleiben.
7. [ ] KI-Fehler oder deaktivierten Dienst simulieren: lokale Liste bleibt nutzbar.
8. [ ] Hinweise auf Wetter, Trinkwasser, Camping und Ausrüstung dürfen keine nicht belegten Garantien enthalten.
9. [ ] Deutsch/Englisch bei Erststart auswählen, App neu starten und Auswahl kontrollieren.
10. [ ] Sprache später wechseln; Buttons, Fehler, Account, Käufe, Bildangaben und Packliste prüfen.
11. [ ] Einheiten, Dezimalzahlen und vom Backend erzeugte Texte auf konsistente Sprache prüfen.
12. [ ] Bedienung mit VoiceOver, größerer Schrift und reduzierter Bewegung stichprobenartig prüfen; wichtige Elemente dürfen nicht abgeschnitten oder unbedienbar sein.

**Abschluss:** Schriftliche Prüfliste plus Screenshots; Persistenz ist nach Prozessneustart bestätigt.

## 8. Phase E – Apple-Zugang und App-Identität

**Owner: Betreiber mit Integrator. Diese Vorbereitung kann früh beginnen.**

1. [ ] Beim Apple Developer Portal und App Store Connect anmelden.
2. [ ] Aktive Developer-Program-Mitgliedschaft, Team und erforderliche Rolle prüfen. Eine fehlende Browsersitzung beweist keine fehlende Mitgliedschaft.
3. [ ] Offene Vereinbarungen lesen und durch die berechtigte Person annehmen.
4. [ ] Endgültigen App-Namen, Bundle-ID, SKU und primäre Sprache festlegen. Bestehende App-Einträge nicht doppelt anlegen.
5. [ ] App-Eintrag und Bundle-ID mit dem Xcode-Target abgleichen.
6. [ ] Tatsächlich unterstützte Gerätefamilien prüfen. Unbeabsichtigte zusätzliche Plattformverfügbarkeit kontrollieren.
7. [ ] Signing-Team, Zertifikate und Provisioning für den Verteilungsbuild prüfen.
8. [ ] Im späteren signierten Archiv tatsächliche Entitlements kontrollieren, nicht nur Projektdateien.

Apple beschreibt den Einreichungsprozess und die erforderlichen Rollen in der [Anleitung zum Einreichen](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app).

## 9. Phase F – Sign in with Apple vollständig einrichten

**Owner: Account-Engineer, Betreiber und Integrator.**

Apple-Login ist eine gewünschte Wanderful-Funktion. Er ist nicht pauschal für jede App verpflichtend; Apples Login-Regeln hängen unter anderem von vorhandenen Drittanbieter-Logins ab. Für diesen geplanten Funktionsumfang bleibt die echte Einrichtung ein offener Punkt. Maßgeblich sind die [App Review Guidelines, insbesondere 4.8 und 5.1](https://developer.apple.com/app-store/review/guidelines/).

1. [ ] Sign-in-with-Apple-Capability für die tatsächlich verwendete App-ID konfigurieren.
2. [ ] Passendes Entitlement in den relevanten Buildkonfigurationen hinzufügen und Provisioning erneuern.
3. [ ] Benötigte Apple-Client-Konfiguration serverseitig herstellen. Private Schlüssel nie in der App ausliefern.
4. [ ] Account-Datenbankmigration, Rollenrechte, Verschlüsselungs-/Sessionkonfiguration und Tokenaustausch prüfen.
5. [ ] Erst bei vollständiger Einrichtung Feature aktivieren. Zusätzliche Boolean-Flags ersetzen keinen Entitlement-Nachweis.
6. [ ] Erste Anmeldung mit echtem Apple-Konto testen, einschließlich „E-Mail verbergen“.
7. [ ] Erneute Anmeldung testen, wenn Apple Name/E-Mail nicht erneut liefert.
8. [ ] Abbrechen, Netzfehler, abgelaufene Sitzung und erneute Authentifizierung prüfen.
9. [ ] Abmelden und App-Neustart testen; keine fremde oder alte Sitzung anzeigen.
10. [ ] Kontolöschung in der App auffindbar machen und vollständig testen.
11. [ ] Widerruf/Löschung serverseitig korrekt ausführen; bei Fehler niemals Erfolg behaupten.
12. [ ] Lokale gespeicherte Routen/Packlisten und Cloud-Kontodaten ausdrücklich unterscheiden. Was nach Löschung lokal erhalten bleibt, transparent erklären und bei Bedarf separat löschbar machen.
13. [ ] Aufbewahrungsfristen, abgelaufene Sitzungen, Protokolle und Backups konkret behandeln; eine 30-Tage-Session ist kein vollständiges Löschkonzept.

Apple erläutert die Anforderungen bei Account-Erstellung in [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app). Dieser Schritt ist mehr als ein Abmeldebutton.

**Abschluss:** Anmeldung, erneute Anmeldung, Abmelden, Widerruf/Fehler und echte Löschung im signierten Gerätebuild belegt.

## 10. Phase G – Abos und Käufe

**Owner: Betreiber, QA und Integrator.**

Bisherige lokale Konfiguration: Wochenabo 3,99 € und Jahresabo 39,99 € mit vorgesehener siebentägiger Einführung für berechtigte Nutzer. Das ist keine Bestätigung, dass diese Produkte in App Store Connect existieren oder dass jede Person eine Probephase erhält.

1. [ ] Tatsächliche Premium-Leistungen festlegen; keine noch nicht funktionierenden Vorteile verkaufen.
2. [ ] Erforderliche Vereinbarungen sowie Bank-/Steuerangaben im Apple-Konto abschließen.
3. [ ] Subscription Group und eindeutige Produkt-IDs erstellen beziehungsweise vorhandene prüfen.
4. [ ] Laufzeit, Verfügbarkeit, Preise und Einführungsangebot korrekt konfigurieren.
5. [ ] Produkt-IDs mit dem ausgelieferten Build abgleichen.
6. [ ] Deutsche und englische Produkttexte sowie erforderliche Review-Inhalte vervollständigen.
7. [ ] Preise und Berechtigung im UI aus StoreKit verwenden; lokale Fixturewerte nicht als Livepreis ausgeben.
8. [ ] Kauf erfolgreich, abgebrochen, ausstehend und fehlgeschlagen testen.
9. [ ] Wiederherstellung, App-Neustart und erneute Installation mit Testkonto prüfen.
10. [ ] Verlängerung, Ablauf, Widerruf und gegebenenfalls Billing-Retry/Grace-Period in der Testumgebung prüfen.
11. [ ] Sicherstellen, dass Abmelden oder Apple-Login nicht versehentlich Premium gewährt oder entfernt.
12. [ ] Terms/Datenschutz, Laufzeit, Preis und Verlängerung verständlich darstellen.
13. [ ] Fehlende Produkte dürfen keine kaputte oder irreführende Paywall erzeugen.
14. [ ] TestFlight-/Sandbox-Nachweis getrennt vom lokalen StoreKit-Fixturetest festhalten.
15. [ ] Bei der ersten Einreichung prüfen, welche Aboprodukte gemeinsam mit der App-Version zur Review hinzugefügt werden müssen.

Offizieller Ablauf: [Offer auto-renewable subscriptions](https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions/).

**Abschluss:** Der tatsächlich konfigurierte Produktkatalog und die relevanten Kaufzustände sind im Release-nahen Build getestet.

## 11. Phase H – Datenschutz, Support und Betreiberangaben

**Owner: Betreiber und Store-Verantwortlicher; technische Fakten liefert Engineering.**

1. [ ] Rechtsträger, ladungsfähige Kontaktangaben, Supportadresse und Rechteinhaber festlegen.
2. [ ] Öffentlich erreichbare HTTPS-Seiten für Datenschutz und Support erstellen; Terms/EULA-Entscheidung festhalten.
3. [ ] Seiten ohne Login auf iPhone öffnen; Kontaktmöglichkeit tatsächlich prüfen.
4. [ ] Datenfluss pro aktiviertem Dienst dokumentieren: Gemini/Recherche, GraphHopper, Vercel, Datenbank, Apple und Wikimedia. Weitere SDKs nur aufnehmen, wenn tatsächlich verwendet.
5. [ ] Für jeden Dienst festhalten: welche Daten gehen hinaus, Zweck, Speicherung, Protokolle, Region, Löschung, Backups und Empfänger.
6. [ ] Auch direkte Bildabrufe berücksichtigen: Fotoanbieter erhalten Netzwerkrequests; keine pauschale Aussage „keine Datenübertragung“.
7. [ ] Datenschutzerklärung mit den echten Flüssen abstimmen. Offene rechtliche Einordnung gezielt fachlich klären, keine unbekannten Grundlagen erfinden.
8. [ ] App-Privacy-Fragebogen anhand dieses Inventars ausfüllen: Datentyp, Zweck, Personenbezug und Tracking je tatsächlichem Verhalten beurteilen.
9. [ ] Privacy Manifest, Required-Reason-APIs und eingebundene SDKs im Archiv prüfen.
10. [ ] Standort-/Hintergrundnutzung und deren Beschreibung mit dem tatsächlichen Guidance-Code abgleichen; alte Dokumente sagen hierzu teils etwas anderes.
11. [ ] Mikrofon-/Sprachberechtigungen nur für tatsächlich aktivierte Funktionen anfordern.
12. [ ] Tracking-Einwilligung nur dann als nötig behandeln, wenn das tatsächliche Verhalten darunter fällt; nicht vorsorglich einen unnötigen Dialog einbauen.
13. [ ] Für EU-Veröffentlichung den tatsächlichen Händlerstatus erklären und gegebenenfalls Kontaktinformationen verifizieren.

Quellen: [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/) und [EU-DSA-Händleranforderungen](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements). Die konkrete rechtliche Bewertung hängt vom Betreiber und tatsächlichen Betrieb ab.

**Abschluss:** Funktionierende öffentliche Seiten, ausgefülltes Dateninventar und konsistente Angaben in App, Archiv und App Store Connect.

## 12. Phase I – Endgültiger Gerätebuild und TestFlight

**Owner: Integrator; Betreiber stellt Gerät/Zugang bereit.**

1. [ ] Nach allen Aktivierungen endgültigen Kandidaten-SHA festlegen.
2. [ ] Versionsnummer und eindeutige Buildnummer setzen.
3. [ ] Aktuelle Apple-Upload-/SDK-Anforderungen unmittelbar vor dem Archivieren prüfen; alte Projektannahmen nicht übernehmen.
4. [ ] Release-Konfiguration auf Produktionshost, sichere Flags und fehlende eingebettete Provider-Secrets prüfen.
5. [ ] Signiertes Archiv bauen, validieren und Entitlements/Privacy-Bericht prüfen.
6. [ ] App-Icon, Anzeigename, Startbildschirm und unterstützte Geräte kontrollieren.
7. [ ] Build nach App Store Connect hochladen; Verarbeitung abwarten und Fehler beheben.
8. [ ] Export-Compliance-Fragen anhand der tatsächlich verwendeten Verschlüsselung beantworten, nicht raten.
9. [ ] Interne TestFlight-Gruppe und Testbeschreibung einrichten.
10. [ ] Genau den hochgeladenen Build über TestFlight auf dem iPhone installieren.
11. [ ] Frische Installation und Update über bestehenden Stand testen, ohne persönliche Daten unkontrolliert zu löschen.
12. [ ] Mobilfunk und WLAN, Netzwechsel, verweigerte Standortfreigabe, langsame Antwort und App-Neustart prüfen.
13. [ ] Vollständigen Kernablauf mit eigenen neuen Wünschen durchführen.
14. [ ] Falls externe Tester eingesetzt werden, den dafür erforderlichen Beta-Review-Prozess beachten.
15. [ ] Testfehler priorisieren, beheben und neuen Build hochladen. Jede geänderte relevante Funktion erneut prüfen.

TestFlight ist hier unser Abnahmeweg; es ersetzt nicht die eigentliche App-Store-Review. Offizielle Beschreibung: [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

**Abschluss:** Installierbarer, getesteter TestFlight-Build mit dokumentiertem SHA, Buildnummer, Gerät und Ergebnissen.

## 13. Phase J – Store-Seite und Review vorbereiten

**Owner: Store-Verantwortlicher und Betreiber.**

1. [ ] App-Name, Untertitel, Beschreibung, Keywords und Kategorie in DE/EN finalisieren.
2. [ ] Nur nachgewiesene Funktionen beschreiben. Keine Garantie für Fotos überall, sichere Wege, Live-Wetter oder Offlinekarten, wenn diese nicht entsprechend vorhanden sind.
3. [ ] Altersfreigabe-Fragebogen vollständig und wahrheitsgemäß beantworten.
4. [ ] Preis/Verfügbarkeit und Länder auswählen; geografische Vermarktung und technische Ortsabdeckung auseinanderhalten.
5. [ ] Rechte an Fotos, Icons und sonstigen Inhalten prüfen.
6. [ ] Echte Screenshots des endgültigen Builds erstellen: Einstieg, freie Planung, Route mit Karte/Highlights, echte Fotos, Packliste, gegebenenfalls Konto/Premium.
7. [ ] Personenbezogene Daten und Secrets aus Screenshots fernhalten; keine erfundenen App-Screens als Funktionsbeleg verwenden.
8. [ ] Aktuell geforderte Größen/Geräteklassen direkt in App Store Connect prüfen und passende Screenshots hochladen.
9. [ ] Review-Kontakt und klare Bedienungsanleitung hinterlegen.
10. [ ] Review-Zugang zu allen relevanten Funktionen ermöglichen. Bei Apple-only-Login keinen erfundenen Benutzernamen/Passwortzugang angeben; tatsächlich nutzbaren Weg erklären.
11. [ ] Erklären, wie eine Route erzeugt wird, wo Fotos und Packliste erscheinen und wie Käufe/Löschung erreichbar sind.
12. [ ] Backend und ausreichendes Kontingent während der Review verfügbar halten; keine heimlich abweichende Reviewer-App bauen.
13. [ ] Richtigen Build und erforderliche Kaufprodukte zur Einreichung auswählen.
14. [ ] Release-Verhalten festlegen; für den ersten Launch ist eine bewusst kontrollierte manuelle Veröffentlichung ein sinnvoller Arbeitsvorschlag.

Apple verlangt vollständige Review-Zugänglichkeit und erreichbare Backenddienste: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/). Screenshot-Ablauf: [Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots).

## 14. Phase K – Einreichen, Rückfragen bearbeiten und veröffentlichen

1. [ ] Alle Abschlusskriterien unten prüfen und Betreiberfreigabe für den konkreten Build einholen.
2. [ ] In App Store Connect die vorbereitete Version zur Review einreichen.
3. [ ] Review-Nachrichten verfolgen; weder Genehmigung noch festen Termin voraussetzen.
4. [ ] Bei Rückfragen das konkrete Problem beantworten und betroffene Funktion nachvollziehbar erklären.
5. [ ] Bei einem Produktfehler korrigieren, erneut testen, Buildnummer erhöhen und korrigierten Build einreichen.
6. [ ] Metadatenkorrekturen getrennt von Codeänderungen behandeln.
7. [ ] Nach Genehmigung die gewählte Veröffentlichung auslösen beziehungsweise kontrollieren.
8. [ ] Öffentliche Produktseite und Installation aus dem Store prüfen.
9. [ ] Einen kleinen realen Produktions-Smoke-Test ausführen: Planung, Bild, gespeicherte Packliste und aktivierte Kontofunktionen.
10. [ ] Fehlerraten, Providerkosten, Quoten und Supportanfragen beobachten; bestehende datensparsame Betriebsdaten nutzen.
11. [ ] Bei schwerem Problem angemessene Eindämmung und korrigiertes Release vorbereiten. Ein Backend-Rollback ersetzt keine Rücknahme eines installierten App-Builds.

Offizieller Ablauf: [Overview of submitting for review](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/overview-of-submitting-for-review).

## 15. Verbindliche Prüffallliste

| ID | Prüffall | Erwartetes Ergebnis |
|---|---|---|
| R01 | Neuer deutscher Loop-Wunsch | Echte recherchierte Orte und GraphHopper-Route |
| R02 | Neuer englischer Wunsch außerhalb Harz | Keine regionale Hardcodierung; nachvollziehbare Antwort |
| R03 | Punkt-zu-Punkt | Richtiger Start/Ziel und reale Geometrie |
| R04 | Nicht erfüllbarer Wunsch | Verständlicher Fehler, keine erfundene Route |
| R05 | Timeout/Abbruch/erneute Anfrage | Keine veralteten Ergebnisse oder Endlosschleifen |
| F01 | Highlight mit P18 | Passendes Bild mit Attribution |
| F02 | Highlight mit direktem OSM-Commons-File | Korrekter Fallback und Quellenbezug |
| F03 | Gleichnamige Orte | Keine falsche Bildzuordnung |
| F04 | Kein Bild/Netzfehler | Route nutzbar, kein irreführendes Ersatzbild |
| P01 | Packliste nach Prozessneustart | Häkchen unverändert |
| P02 | Wechsel zweier Routen | Getrennte Zustände |
| P03 | KI-Ergänzung schlägt fehl | Bestehende Liste bleibt erhalten |
| L01 | DE/EN und Neustart | Gewählte Sprache bleibt und UI ist verständlich |
| A01 | Apple-Anmeldung und erneute Anmeldung | Gültige Sitzung ohne fehlende Pflichtdaten |
| A02 | Löschung scheitert serverseitig | Keine falsche Erfolgsmeldung |
| A03 | Löschung erfolgreich | Konto/Sitzungen korrekt entfernt, lokale Datenregel klar |
| S01 | Kauf/Abbruch/Wiederherstellung | Korrekte Premiumzustände |
| S02 | Ablauf/Widerruf | Zugriff entspricht verifiziertem Kaufzustand |
| D01 | Release-Archiv/TestFlight | Gleicher Kandidat, richtige Konfiguration |
| D02 | Update bestehender Installation | Keine unbeabsichtigten Datenverluste |

Für jeden Fall notieren: Datum, Build, Gerät/OS, Eingabe ohne private Daten, Ergebnis, Screenshot/Log, Fehlernummer. Live-Tests mit Kosten begrenzen und im Voraus ein kleines Fallpaket wählen. Bei identischer externer Blockade erst Ursache ändern, dann erneut versuchen.

## 16. Was du persönlich noch liefern oder entscheiden musst

Das zentrale ausfüllbare Formular bleibt `docs/release/STORE_READINESS_HANDOFF_2026-09-15.md` im gemeinsamen Kandidaten; persönliche Angaben nicht mehrfach widersprüchlich pflegen.

1. [ ] Apple-Anmeldung und Nachweis des richtigen Teams/der Mitgliedschaft.
2. [ ] Rechtsträger, Adresse, Supportkontakt und endgültige öffentliche URLs.
3. [ ] Finale App-Identität und Vertriebsgebiete.
4. [ ] Bestätigung der tatsächlichen Premiumleistungen und Preise.
5. [ ] Gegebenenfalls konkret verlangte Deploymentbestätigung nach Vorlage des fertigen Kandidaten.
6. [ ] Gerät für die tatsächliche Installation/Abnahme erreichbar machen.
7. [ ] Nutzbaren lokalen GitHub-Pushzugang herstellen, falls die bisherige Zugangslücke fortbesteht; keine Tokens in den Chat senden.
8. [ ] Verträge/geschäftliche Erklärungen und endgültige Einreichung selbst freigeben.

Engineering muss vorher alles unabhängig Machbare erledigen und dir persönliche Schritte gebündelt vorlegen. Du sollst keine wiederholten pauschalen „Darf ich weiter?“ beantworten müssen.

## 17. Finale Freigabecheckliste

- [ ] Aktueller gemeinsamer Code ist sauber, reproduzierbar gebaut und gesichert.
- [ ] Kritische Regressionen sind bestanden; notwendige Skips bleiben nicht unbemerkt.
- [ ] Aktuelles Backend ist dauerhaft erreichbar und reale KI-Routen funktionieren.
- [ ] iPhone-Abnahme stammt vom tatsächlichen Release-/TestFlight-Kandidaten.
- [ ] Wikimedia-Zuordnung, Attribution und Kein-Bild-Verhalten sind bestätigt.
- [ ] Packlistenpersistenz und DE/EN sind bestätigt.
- [ ] Gewünschter Apple-Login und Kontolöschung funktionieren vollständig.
- [ ] Gewünschte Abos funktionieren einschließlich Wiederherstellung und Ablauf.
- [ ] Datenschutz, Berechtigungen, tatsächliche Datenflüsse und Store-Angaben stimmen überein.
- [ ] Support/Privacy/Terms erreichbar, Betreiber- und Apple-Angaben vollständig.
- [ ] Screenshots zeigen den echten endgültigen Funktionsumfang.
- [ ] Review hat Zugang und ausreichende Backendverfügbarkeit.
- [ ] Konkrete Betreiberfreigabe für Einreichung liegt vor.

Wenn ein gewünschtes Feature stattdessen verschoben werden soll, ist das eine ausdrückliche Produktentscheidung des Betreibers. Es gilt dann als verschoben, nicht als fertig getestet. Ohne diese Entscheidung bleibt es auf der offenen Liste.

## 18. Was wir jetzt nicht zusätzlich bauen müssen

Für diesen Launch keine neue Social-Plattform, Community-Fotos, neue KI-Architektur, weitere Kartenanbieter oder großes Redesign beginnen. Bestehende Navigation/Guidance muss entsprechend dem tatsächlich ausgelieferten Umfang geprüft werden; neue Navigationserweiterungen gehören nicht automatisch in diesen Auftrag. Der schnellste verantwortbare Weg ist, die vorhandenen Funktionen gemeinsam und live zuverlässig zu machen.

