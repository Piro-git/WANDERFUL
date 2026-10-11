# Frühe Zugangsprüfung und aktuelle lokale Hinweise

> Source-only publication: referenced UI screenshots are retained locally by the integration owner; no screenshot PNG bytes are included or retrievable from this branch. Textual test results are retained; visual acceptance is not independently reproducible from this PR alone.

Basis: `03a430f17cbee03cc4017fee7c5e2022604c6027`. Isolierter Branch `codex/access-local-advisories`; keine Änderungen im ursprünglichen Reparatur-Checkout, kein Deployment und kein Zugriff auf das physische iPhone.

## Verhalten und belastbare Grenzen

Vorher: Ein OSM-Punkt oder Flächenmittelpunkt wurde an GraphHopper gegeben. Erst die gemessene Route zeigte einen verfehlten Stopp; das Modell konnte denselben Stopp mit anderen Begleitstopps erneut versuchen.

Jetzt: Eine gebündelte Overpass-Abfrage liest die registrierten OSM-Identitäten, zugehörige Knoten, angrenzende Wege und direkte topologische Anschlüsse. Gemeinsame positive OSM-Knoten-IDs und explizite Aktivitäts-/Zugangsangaben bilden den Beleg. Ein naher Weg, eine Straßenklasse, fehlende Sperrmeldungen oder ein Flächenmittelpunkt begründen keinen Zugang. Bedingte Rechte, unbekannte Barrieren, unvollständige Antworten und fehlende Verbindungen bleiben unklar. Explizite Ausschlüsse und tatsächlich verfehlte Stopps werden nur innerhalb derselben Anfrage gemerkt.

`documented` bezeichnet örtlich belegte Kartentopologie und Zugangsangaben, nicht eine gegenwärtige Vor-Ort-Freigabe oder eine bereits nachgewiesene Verbindung zum Start. Die echte GraphHopper-Prüfung bleibt erforderlich. Fehlende explizite Rechte führen häufig zu `unknown`; es gibt keine behauptete flächendeckende Erreichbarkeitsprüfung.

Beispiel aus synthetischen Tests: Ein Seezentrum liegt mehr als 300 m von einem explizit als Eingang markierten Knoten auf seinem geschlossenen OSM-Rand entfernt. Nur dieser belegte Eingang wird als separates Routingziel verwendet. Der POI behält seine ursprüngliche Position. Die App sagt, dass sie zum Eingang führt und die verbleibende Gehstrecke unbekannt ist. Die Luftlinie zum Zentrum ist keine Gehstrecke; der POI wird nicht als besucht bestätigt. Ein ebenso naher, aber nicht über gemeinsame Knoten angeschlossener Weg bleibt unklar.

Die unveränderte 100-m-Prüfung gilt für das explizite Ziel, ebenso Reihenfolge, Routingprovenienz, Entfernungs-/Nutzergrenzen und maximal drei Zwischenstopps. Kein geometrisches Verschieben auf den nächsten Weg.

## Additive Verträge

Schema 3 bleibt rückwärtskompatibel. Native Clients begrenzen die finale Stoppliste nun entsprechend dem bestehenden Providerlimit auf drei. Bei neuen Antworten müssen Hinweis-Termin und Anfrage-Termin übereinstimmen; abgelaufene oder künftig datierte Prüfungen werden zurückgewiesen. Gespeicherte Hinweise dürfen weiterhin ablaufen und werden dann sichtbar als erneut zu prüfen markiert.

| Feld | Inhalt/Invariante |
| --- | --- |
| `request.plannedStartAt` | Optionaler ISO-8601-Zeitpunkt mit Zeitzone. `RoutePlanningRequest.plannedStartAt` transportiert einen bereits bekannten Termin. Ohne Termin wird ausschließlich der aktuelle Prüfzeitpunkt bewertet; es wurde kein neues Datumseingabe-UI und keine freie Datumsinterpretation eingebaut. |
| `place.access` | Version 1; `placeId`, `state` (`documented`, `unknown`, `excluded`), Grund, Prüfzeitpunkt und eigene OSM-Evidenzreferenzen. Unklar/ausgeschlossen hat kein positives Ziel. |
| `access.evidence[]` | OSM-ID/URL, Version, Bearbeitungs-, Snapshot- und Abrufzeit, explizite Rechte und begrenzte Knoten-ID-Liste. Keine Web-Prosa. |
| `access.target` | Separates `poi`-/`entrance`-Ziel mit OSM-ID, Koordinate und belegter Beziehung. Eingang nur auf einem geschlossenen POI-Way-Rand. Luftlinienabstand separat; `remainingWalkMeters:null`, `poiVisitConfirmed:false`. |
| `route.stopVisits[]` | Nach echter Routengeometrie: explizites Ziel erreicht; daraus folgt kein tatsächlicher POI-Besuch. |
| `route.localConditions` | Version 1; Prüfzeit, Ablauf, Termin, Umfang, begrenzte Quellenabdeckung, Hinweise und blockierende Hinweis-IDs. Getrennt von POI-/Zugangsevidenz. |
| `localConditions.notices[]` | Stabile Ereignis-/Quellenreferenzen, Publikation, Ereigniszeitraum, Gültigkeit und Abruf getrennt; Status, räumliche Zuordnung, Handlung und Herkunft. |

Gespeicherte Routen behalten die kurzen strukturierten Hinweise und ihre ursprünglichen Zeitstempel. Die native Anzeige markiert sie nach Ablauf als erneut zu prüfen; sie holt beim Wiederöffnen nicht heimlich neue Daten. Eine neue Routenplanung startet eine neue Prüfung. Metadatenkopien derselben Route erhalten die Evidenz. Google-Recherchetext bleibt wie bisher transient und wird nicht in gespeicherte Routen übernommen.

## Quellen und Aktualität

Die Registrierung ist geografisch, nicht über Ortsnamen gesteuert. Aktuell implementiert:

- **DWD WFS `dwd:Warnungen_Gemeinden`**: begrenzte Bounding-Box, öffentliche tatsächliche Warnungen, strukturierte Publikations-/Gültigkeitsfelder und Warngebietsgeometrie. Ein Wetterwarngebiet ist keine amtliche Wegesperre.
- **Nationalpark Harz, öffentlich verlinkter ArcGIS-Sperrlayer**: nur strukturierte IDs, Wegname, Status und Geometrie. Keine vollständigen Bemerkungs-/Webtexte werden übernommen. Der geprüfte Layer liefert keine strukturierten Publikations-/Gültigkeitsdaten; seine Hinweise können deshalb keine automatische Routensperre begründen.
- **Andere lokale Quellen/Regionen** bleiben ausdrücklich als nicht geprüft sichtbar. Es gibt keinen allgemeinen Newsfeed, kein unbeschränktes Crawling und keine behauptete Vollständigkeit für Deutschland oder andere Länder. Weitere Betreiber-/Warnadapter benötigen eine eigene Prüfung von Format, räumlicher Abdeckung und Nutzungsbedingungen.

Quellen-/Webinhalte gelangen weder in ausführbaren Code noch in Modell-Anweisungen. Nur feste registrierte Endpunkte werden abgerufen. Verwendet werden Gebietsgrenzen, keine Profile, Rohprompts oder GPS-Historien.

Gleichartige Meldungen einer Quelle werden über ihre Ereignis-ID zusammengeführt; zusammengehörige Warnpolygone bleiben erhalten. Neuere Publikationen können ältere Versionen/Revokationen ersetzen. Gleichzeitige widersprüchliche Versionen sowie widersprüchliche Quellen mit gleicher belegter Ereignis-ID bleiben unklar. Es gibt keine erfundene semantische Ereignisgleichheit aus ähnlich klingenden Überschriften. Eine neue Abrufzeit verjüngt keine alte Meldung. Leere/fehlgeschlagene Folgeabrufe löschen frühere Hinweise innerhalb der Anfrage nicht.

Nur ein frischer, zeitlich gültiger offizieller Einschränkungsdatensatz mit expliziter Einschränkungsfläche und nachgewiesener Überschneidung der echten Route kann eine Revision auslösen. Liniennähe oder bloßes Kreuzen einer Linie kann auch eine Brücke bedeuten und begründet keine solche Entscheidung. Polygonlöcher, außerhalb liegende Meldungen und Rechenlimits werden berücksichtigt; unklare Zuordnung bleibt unklar. Vor Rückgabe wird erneut zeitlich bewertet.

## Aufwand und Messung

Die bestehenden Grenzen von 150 Sekunden, 16 Modellaufrufen, fünf Routen und 20 Werkzeug-/Hintergrundreservierungen werden nicht erhöht. Zusätzliche Quellenaufrufe werden vor IO reserviert und zählen in die bestehende Werkzeuggrenze.

- Zugang: typischerweise ein gebündelter Aufruf nach einem Entdeckungs-/Auflösungsschritt; maximal drei pro Anfrage, höchstens 80 Orte, 6.000 Elemente, 256 KiB und acht Sekunden pro Aufruf.
- Lokale Hinweise: maximal zwei geografisch passende Quellen parallel je Prüfung und vier Abrufe insgesamt; sechs Sekunden, 256 KiB und weniger als 40 Features pro Quelle. Ein gesättigtes Ergebnis ist unvollständig, kein Freigabesignal. Weitere Korridorabfrage nur außerhalb des bereits abgefragten Gebiets; vorhandene Daten werden ansonsten lokal abgeglichen.
- Alter: standardmäßig höchstens sechs Stunden seit Veröffentlichung **und** Abruf für eine aktive Entscheidung; konfigurierbarer `maxAgeMs`-Parameter mit harter Obergrenze. Native Information läuft nach einer Stunde aus. Ereignisgültigkeit und Wandertermin gelten zusätzlich.
- Kein zusätzlicher LLM-Aufruf für diese Prüfungen. Keine Retries nach 429; eine ausgefallene Quelle wird für die Anfrage nicht nochmals versucht.

Reproduzierbarer Offlinevergleich: Der gleiche fehlgeschlagene Stopp wird ein zweites Mal mit geändertem Begleitstopp vorgeschlagen. Vorher wären drei Routenaufrufe erforderlich, jetzt zwei; `avoidedRouteCalls = 1`. Ein weiterer Test verwirft einen explizit ausgeschlossenen Kandidaten vor dem ersten Provideraufruf. Ein Quellenbatch ersetzt keine echten Routingdaten. Diese Werte sind keine Live-Latenz- oder Erfolgsquotenmessung; der frühere physische 12,089-km-Test wurde nicht wiederholt.

Kostenlose read-only Formatprüfung am 2026-09-08 um 22:59:43 UTC: zwei Gebietsabfragen ohne Nutzerdaten. DWD wurde erfolgreich validiert. Der Harz-Layer lieferte die feste Grenze von 40 Features und wurde ausdrücklich als unvollständig verworfen. Eine gezielte nachfolgende Formatanalyse bestätigte HTTP 200 und die Sättigung, keinen 429-Retry. Keine GraphHopper-/Gemini-Liveaufrufe und kein Deployment.

## Integrationspunkte

`composition.js` liefert `access` und `conditions`; `planner.js` hält Reservierungen, Anfrage-Merkliste und Snapshots; `routing.js` übernimmt ausschließlich quellengestützte separate Ziele und behält die tatsächliche Geometrieprüfung.

Der separat geprüfte Effizienzpatch entfernt `read_place`/`finish_plan`: Dort Zugangsdaten vor Ausgabe der Discovery-/Resolution-Ergebnisse ergänzen; die finalen lokalen Prüfungen unmittelbar vor Rückgabe der akzeptierten `route_itinerary`-Antwort einhängen und nach optionalem Enrichment erneut zeitlich bewerten. Keine Validierung an entfernten Hooks verlieren. Dieser Branch wurde bewusst nicht automatisch mit dem fremden Patch vermischt.

Der Dauerbackend-Task besitzt Factory/HTTP/Auth/Betrieb. Änderungen hier an `DynamicResearchPlanningClient.swift` betreffen DTO, Eingangs-/Hinweisvalidierung und Termintransport. Die alte Owner-Provider-Allowlist enthält die neuen kostenlosen Endpunkte nicht; mit diesem alten Wrapper werden sie sichtbar als unavailable behandelt. Neue Runtime-Konfiguration muss sie begrenzt freigeben, ohne bezahlte Budgets zu erhöhen oder alte Owner-Leases wiederzuverwenden.

## Geprüfte Dokumentation

- Overpass-Abfragesprache: https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
- Ressourcenregeln öffentlicher Instanzen: https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
- DWD-Geodienste: https://www.dwd.de/DE/leistungen/geodienste/help/nutzung_geodienste.html
- DWD-Warnschema: `https://maps.dwd.de/geoserver/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=dwd:Warnungen_Gemeinden&outputFormat=application/json`
- Offizieller Ursprung der Harzer Karte: https://www.nationalpark-harz.de/de/startseite/Wegesperrungen_Aktuell/
- ArcGIS Query-Vertrag: https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/

Die Harzer öffentliche Layer-Metadaten enthielten keine Lizenz-/Attributionsangaben. Deshalb werden keine freien Originaltexte oder Rohkartendaten gespeichert; kurze strukturierte Fakten tragen den Link zum offiziellen Ursprung. Eine umfangreiche Weiterverwendung/Caching dieses Layers ist nicht beauftragt oder als erlaubt behauptet.

## Verifikation

Der abschließende Test-/Build-Nachweis wird in `access-local-conditions-validation.md` dokumentiert. Offline-Fälle und native Darstellung sind von echten Provider- oder Vor-Ort-Nachweisen getrennt.
