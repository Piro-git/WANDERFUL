> Historical archive, reviewed 2026-10-01. This dated document is not current authorization, operational status, or release approval. Private device, signing and credential-storage identifiers have been omitted where present. See Draft PR #1 for the current candidate.

# Wanderful – konkrete Roadmap zur Launchreife

Stand: 24. September 2026. Dieses Dokument ist der Arbeitsplan ab dem aktuell geprüften Zustand. Es ersetzt keine Testbelege und erteilt keine App-Store-Freigabe. Der ausführliche [App-Store-Leitfaden](WANDERFUL_APP_STORE_LAUNCH_LEITFADEN_2026-09-17.md) enthält die einzelnen Portal- und Formularschritte.

## Ziel und gegenwärtiger Stand

Ein Nutzer beschreibt auf Deutsch oder Englisch frei eine Wanderung. Wanderful recherchiert echte passende Orte und Highlights, formt daraus eine sinnvolle Reihenfolge, lässt GraphHopper Routengeometrie und Messwerte aus verfügbaren Routingdaten berechnen und zeigt verständliche Routen mit Karte, passenden belegten Highlight-Fotos, soweit vorhanden, Ausrüstungsliste und Hinweisen. Das soll in verschiedenen Regionen funktionieren. Ein fehlender Weg, ein fehlendes Highlight oder ein fehlendes Foto muss ehrlich und verständlich erklärt werden.

Die gemeinsame Integrationsquelle liegt unter `/Users/piroscheibe/Library/Application Support/Wanderful-Recovery/release-wave-20260915/integration`, Branch `codex/integration-20260915`, letzter geprüfter HEAD `592f9d2`. Der Backend-Git-Tree ist `59770ad87001e66577e7cbf163cc9119cef0d2c1`. Der letzte iOS-Commit korrigiert den deutschen Home- und Planungsfluss sowie leere Wikimedia-Zustände. Ein fokussierter Simulator-Build und 15/15 einschlägige iOS-Tests sind bestanden. Frühere gezielte Tests für Fotoauflösung, Account-Gates, Packliste und Sprache bestanden 31/31. Die Backend-Suite wurde für den gepinnten Tree mit 1.511 bestandenen Tests, null Fehlern und einem bewachten Skip dokumentiert.

Diese lokalen Ergebnisse belegen noch keine Live-Route. Im bestätigten Vercel-Projekt `backend` ist weiterhin das alte Deployment `[historical deployment ID omitted]` das neueste. Der Connector konnte keinen Upload ausführen; die offizielle CLI `npx vercel` funktioniert, meldet aber `Logged out`. Der bisherige Produktionsalias leitete `/healthz` auf Vercel-SSO um. Auf einem echten iPhone ist der aktuelle Kandidat nicht abgenommen. StoreKit-Kauf/Restore und echter Apple-Login sind offen.

## Arbeitsregeln für alle Schritte

- **Ein Integrator besitzt den gemeinsamen Release-Branch und alle iOS-Builds/Installationen.** Backend-, QA- und Store-Arbeit erfolgt separat und wird anhand eines konkreten Commits übernommen. Niemand überschreibt den Checkout eines anderen Agents.
- Jeder Abschluss nennt Quell-Commit, Backend-Tree oder App-Buildnummer, Umgebung, Testfall, Ergebnis und Beleg. Simulator, Mock, lokaler Unit-Test und physischer Live-Test werden getrennt ausgewiesen.
- Keine API-Schlüssel, privaten Prompts, exakten Nutzerstandorte, Apple-Zugangsdaten oder Produktionsdaten in Git, Logs, Agent-Nachrichten oder Screenshots. Externe Tests nutzen öffentliche Beispielorte und ein kleines Kostenlimit.
- Routenstatistiken stammen aus GraphHopper. Recherche belegt das Highlight, aber GraphHopper garantiert keine aktuelle Wegfreigabe oder Sicherheit. Fotos werden nur mit geprüfter Ortszuordnung, Quelle, Autor und Lizenz angezeigt.
- Kein weiteres Feature beginnt vor den Launch-Gates, außer ein Test zeigt, dass es zur korrekten Funktion oder App-Store-Abnahme nötig ist. Nach jeder Korrektur werden die betroffenen Gates erneut geprüft.

## Schritt 1 – Vercel-Zugang und gepinntes Backend bereitstellen

**Zuständig:** Betreiber für einmalige Anmeldung, dann bestehender Backend-Agent. **Start:** jetzt. **Blockiert:** Schritte 2–4.

1. Betreiber führt auf dem Mac `npx vercel login` aus und schließt die Browser-Anmeldung für das bereits bestätigte Team ab. Keine Tokens in den Chat kopieren.
2. Backend-Agent prüft mit `npx vercel whoami` die Identität. Er bestätigt Team `[Vercel team ID omitted]` und Projekt `backend` (`[Vercel project ID omitted]`) über die Vercel-Kontodaten. Fehlt Zugriff, wird genau dieser Berechtigungsfehler dokumentiert.
3. Der Agent erstellt ein isoliertes Deployment-Verzeichnis aus dem gepinnten Backend-Tree. Vor dem Upload vergleicht er dessen Tree mit `59770ad87001e66577e7cbf163cc9119cef0d2c1` und prüft Projektbindung, Quellpfad, Zielumgebung, Alias und `git status`. Keine App-Dateien, lokalen Konfigurationen oder Secrets mit hochladen.
4. Er kontrolliert die **Existenz** der notwendigen Produktionskonfiguration: Gemini/Recherche, GraphHopper, dauerhafte App-Attest-Datenbank, Migrationsstand, Limits und HTTPS-Origin. Werte bleiben verborgen. Fehlende Konfiguration wird vor kostenpflichtigen Live-Tests behoben.
5. Er deployed den geprüften Tree im bestehenden Projekt, sichert Deployment-ID, URL, Zeit und Quell-Tree und prüft Buildstatus. Er kontrolliert `/healthz` und `/readyz` am tatsächlich für die App vorgesehenen Host. Falls Vercel-SSO die App abfängt, muss die Projekt-Zugriffsregel für die mobile API korrekt eingerichtet werden, während App Attest, API-Authentifizierung und Kostenlimits wirksam bleiben.

**Gate 1:** Neues Deployment mit belegtem Backend-Tree; vom iPhone erreichbarer HTTPS-Host; `/healthz` und `/readyz` liefern die erwarteten Antworten; geschützte Endpunkte bleiben geschützt. Ein Vercel-Status `READY` allein besteht dieses Gate nicht.

## Schritt 2 – Echte KI-Routen und Fotos gegen das Live-Backend prüfen

**Zuständig:** Backend-Agent; Integrator prüft die Antwortverträge. **Voraussetzung:** Gate 1.

1. Kleine, gedeckelte Live-Matrix mit frei formulierten Anfragen: deutsche Rundwanderung im Harz, englische Rundwanderung außerhalb Deutschlands, Punkt-zu-Punkt-Strecke und eine eigene neue Formulierung. Beispiele dürfen keine versteckte Whitelist sein.
2. Für jeden Erfolg nachweisen, dass Gemini den Wunsch bearbeitet und reale Orte recherchiert hat; die Highlight-Identitäten und Quellen festhalten; GraphHopper-Geometrie, Distanz, Dauer und Höhenwerte sowie Start/Ende/Loop-Schluss plausibilisieren. Keine lokale Parser- oder Fixture-Antwort als Live-KI-Erfolg zählen.
3. Mindestens ein positives Wikimedia-Beispiel mit passendem Wikidata-P18- oder eindeutigem OSM-Commons-Dateiverweis und vollständiger Attribution prüfen. Außerdem einen Ort ohne geeignetes Foto testen. Gleichnamige Orte dürfen nicht vertauscht werden.
4. Wenige gezielte Negativfälle: unbekannter Ort, kein geeigneter Weg oder kein belegtes Highlight, Providerfehler/Kontingent. Erwartung: verständlicher Fehler ohne erfundene Route, Fotografie oder Sicherheitszusage. Abbruch und erneuter Versuch dürfen keine doppelte oder verspätete falsche Anzeige erzeugen.
5. Verbrauch, Anzahl und Ergebnis der echten Gemini-/GraphHopper-Anfragen dokumentieren. Bei Providerfehlern zuerst Ursache bestimmen und nur die betroffene Probe wiederholen.

**Gate 2:** Mindestens Loop und Punkt-zu-Punkt aus freien Formulierungen liefern belegte Orte und reale GraphHopper-Routen; eine zweite Region besteht; Bild- und Kein-Bild-Fall sind korrekt; Fehlerfälle sind ehrlich. Falls die Route qualitativ nicht zum Wunsch passt, gezielt Rechercheauswahl oder Wegpunktbildung korrigieren und dieselben Fälle erneut prüfen.

## Schritt 3 – Aktuellen Build auf dem eigenen iPhone abnehmen

**Zuständig:** Integrator mit Betreiber. **Voraussetzung:** Gates 1–2 und abgestimmte Backend-URL.

1. Integrator pinnt den finalen iOS-Commit und setzt ausschließlich den geprüften HTTPS-Origin im geeigneten Build-Config-Weg. Keine Provider-Schlüssel in der App. Signing, Bundle-ID und tatsächliche Entitlements im signierten Build prüfen.
2. Betreiber entsperrt das iPhone, verbindet es per USB und bestätigt „Diesem Computer vertrauen“. Integrator erkennt das Gerät eindeutig und installiert datenerhaltend. Wenn nur ein anderes Gerät sichtbar ist, keine Installation auf Verdacht.
3. Auf dem iPhone nacheinander testen: freie deutsche und englische Anfrage, Loop und Punkt-zu-Punkt, Route vergleichen, Karte und Werte öffnen, belegte Highlight-Fotos und Attribution ansehen, fehlendes Foto verstehen, Packliste abhaken, App beenden und neu starten, Sprache wechseln, Route erneut öffnen.
4. Dazu Ladezustand, Fehler, Abbruch, Wiederholen, schlechtes Netz und größere Schrift prüfen. Wetter, Wasser, Camping und Wegsicherheit dürfen nicht als garantiert erscheinen. Ein genauer Soll-Ist-Distanzvergleich ist wichtiger als künstlich erzwungene Exaktheit.
5. Fehler mit Buildnummer und reproduzierbaren Schritten aufnehmen, klein korrigieren und genau die betroffenen Abläufe erneut auf dem Gerät prüfen.

**Gate 3:** Der Betreiber kann auf dem eigenen iPhone aus einer neuen Formulierung eine echte nutzbare Route planen und versteht Karte, Highlights, Bilder, Grenzen der Daten und Packliste. Ein Simulator-Screenshot ersetzt diese Abnahme nicht.

## Schritt 4 – Apple-Login und Käufe releasefähig entscheiden und abnehmen

**Zuständig:** Betreiber für Apple-Portalentscheidungen; Integrator/Account- und QA-Owner für technische Prüfung. **Voraussetzung:** stabiler Gerätebuild und Backend.

**Apple-Login:** Bestehenden App-Identifier und App-Store-Eintrag prüfen, Sign in with Apple aktivieren, Provisioning und signierte Entitlements kontrollieren. Backend-Tokenprüfung, Session, Abmelden, erneute Anmeldung, „E-Mail verbergen“, Abbruch und Kontolöschung auf echtem Gerät testen. Die Account-Oberfläche wird erst bei vollständig gültiger Konfiguration aktiviert. Wenn Accounts angeboten werden, müssen Löschweg und Datenschutzhinweise stimmen.

**Abos:** Zuerst entscheiden, welche heute funktionierenden Vorteile Premium wirklich bietet. In App Store Connect vorhandene Produkte, Laufzeiten, Preise, Einführungsangebote, Vereinbarungen sowie Bank-/Steuerstatus prüfen. Danach Produkt-IDs und Preisangaben gegen den Build abgleichen und im StoreKit-Sandbox/TestFlight-Kontext Kauf, Abbruch, ausstehende Transaktion, Fehler, Wiederherstellung, Ablauf und Widerruf prüfen. Der vorhandene Fixture-Test mit übersprungenem Runtime-Katalog ist kein Kaufbeleg. Wenn Produkte nicht fertig sind, die Paywall fail-closed lassen und keine Abo-Vorteile vermarkten.

**Gate 4:** Jede beim Launch sichtbare Account- und Kaufhandlung funktioniert im signierten Build und hat dokumentierte Fehlerpfade. Eine nachträgliche Änderung an Auth oder Premium löst gezielte Wiederholungen von Gate 3 aus.

## Schritt 5 – Releasequalität, Datenschutz und App-Store-Material

**Zuständig:** Integrator, Store-Owner und Betreiber. **Voraussetzung:** Gates 1–4 oder eine ausdrücklich getroffene Entscheidung, eine unvollständige optionale Funktion im Build auszublenden.

1. Endgültigen Commit und Buildnummer festlegen. Release-Konfiguration und Archiv mit korrektem Signing erstellen. Relevante Tests aus diesem Kandidaten ausführen; frühere Ergebnisbundles nur als Verlauf nutzen.
2. Prüfen: Start/Absturz, Navigation, keine Debug-Buttons/Platzhalter, Accessibility-Grundfunktionen, Textabschneidung auf kleinen iPhones, größere Schrift, VoiceOver-Kernelemente, reduzierte Bewegung, verständliche DE/EN-Texte auch außerhalb des Home-Screens.
3. Datenschutzinventar an reale Datenflüsse anpassen: Prompts und Orte, Gemini/Recherche, GraphHopper, Wikimedia, Hosting/Datenbank, Apple-Account und gegebenenfalls Käufe. Datenschutz- und Supportseiten öffentlich erreichbar machen; Kontolöschinformationen und App-Privacy-Angaben gegen das tatsächliche Verhalten abgleichen.
4. GraphHopper-/Karten-/Wikimedia-Attribution und Bildlizenzen prüfen. Keine unbelegten Aussagen über „sichere Wege“, garantierte Wasserfälle, legalen Zeltplatz, Offline-Navigation oder Fotos an jedem Stopp in App oder Marketing.
5. App-Store-Eintrag, Altersfreigabe, Kategorien, Screenshots in DE/EN, Beschreibung, Support-/Datenschutz-URLs und Review-Hinweise ausschließlich aus dem endgültigen Build erstellen. Zugang und Testhinweise für Apple Review bereitstellen, falls Anmeldung nötig ist.

**Gate 5:** Ein reproduzierbares signiertes Archiv mit vollständiger Build-/Testmatrix; jede Store-Aussage stimmt mit dem sichtbaren Produkt und den Datenschutzangaben überein.

## Schritt 6 – TestFlight, Entscheidung und kontrollierter Launch

**Zuständig:** Integrator und Betreiber. **Voraussetzung:** Gate 5.

1. Archiv in den bestehenden App-Store-Connect-Eintrag laden; Processing, Signatur und Compliance-Formulare prüfen. Keine doppelte App anlegen.
2. Interne TestFlight-Abnahme des exakt hochgeladenen Builds: mindestens Betreibergerät und ein weiteres geeignetes Gerät oder Tester. Kernfluss, echte Routen, Fotos/Leerzustände, Sprache, Packliste, Login/Käufe sofern aktiviert und schwaches Netz prüfen.
3. Kritische Fehler beheben und einen neuen Build mit neuer Nummer erneut abnehmen. Vorherige TestFlight-Nachweise gelten nicht automatisch für den neuen Build.
4. Go/No-Go gemeinsam gegen die Gates entscheiden. Ein offenes Gate wird entweder behoben oder die betroffene optionale Funktion wird sichtbar und technisch sauber aus dem Releaseumfang entfernt und erneut geprüft. Der Kern „freie Anfrage → echte Route“ ist nicht optional.
5. Erst mit ausdrücklicher finaler Einreichungsfreigabe an Apple Review senden. Nach Freigabe Veröffentlichung, Backend-Health, Fehlerraten und API-Kosten beobachten; einen getesteten Rollbackweg für App- und Backendfehler bereithalten.

## Was der Betreiber konkret tun muss

**Jetzt:** `npx vercel login` auf dem Mac ausführen und die Browser-Anmeldung im richtigen Vercel-Team abschließen; dann dem Backend-Agenten oder Koordinator „eingeloggt“ melden. Keine Zugangsdaten senden.

**Für Gate 3:** iPhone entsperrt per USB verbinden, „Diesem Computer vertrauen“ bestätigen und eine echte neue Route selbst ausprobieren.

**Für Gates 4–6:** Zugang und Berechtigung für Apple Developer/App Store Connect sicherstellen; tatsächliche App-Identität, Rechtsträger, Supportkontakt, Datenschutz-URL, Premium-Leistung und Preisentscheidung festlegen; abschließenden TestFlight-Build beurteilen und die Einreichung ausdrücklich freigeben.

## Fortschrittsanzeige

| Gate | Heute | Nächster nachweisbarer Abschluss |
| --- | --- | --- |
| 1 Backend live | Blockiert an CLI-Login; alter Vercel-Stand | Neue Deployment-ID, Health/Readiness und mobiler HTTPS-Zugang |
| 2 Echte Routen und Fotos | Offen | Begrenzte Live-Matrix mit echter Gemini-Recherche und GraphHopper-Werten |
| 3 Eigenes iPhone | Offen | Signierter aktueller Build und protokollierter vollständiger Nutzerablauf |
| 4 Login/Käufe | Grundlagen vorhanden, Runtime offen | Gerätetest und Sandbox-Belege für alles Sichtbare |
| 5 Store-Paket | Checklisten vorhanden | Endgültiges Archiv, Privacy, Metadaten und Screenshots |
| 6 TestFlight/Review | Offen | Abgenommener TestFlight-Build, dann ausdrückliche Einreichungsfreigabe |

Die engste Stelle ist jetzt Gate 1. Sobald der Login erledigt ist, sollte der bestehende Backend-Agent wieder eingesetzt werden. Der Integrator übernimmt danach den exakt geprüften Backend-Origin und verantwortet den iPhone-Build. Neue parallele Aufgaben helfen erst, wenn ein konkreter Fehler einen eigenen isolierten Fix braucht.
