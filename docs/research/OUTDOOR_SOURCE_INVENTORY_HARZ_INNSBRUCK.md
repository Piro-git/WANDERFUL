# Harz and Innsbruck Outdoor Source and Licensing Inventory

Status: implementation-planning package

Research retrieval date: **2026-07-22**

Companion manifest: [`outdoor-source-inventory-harz-innsbruck-v1.json`](./outdoor-source-inventory-harz-innsbruck-v1.json)

> This is a technical source-selection and compliance inventory, not legal advice. `approved_candidate` and `pilot_candidate` mean suitable to advance through implementation and release review; they are not final legal approval. Missing or ambiguous terms are treated as no permission.

## Executive recommendation

Use a deliberately small open-data core now, then add authority-backed routes and live conditions only through explicit licenses or partnerships.

The implementation-ready core is:

1. **OSM data acquired as bulk regional extracts, not public runtime APIs.** Use [OpenStreetMap under ODbL](https://www.openstreetmap.org/copyright), delivered by [Geofabrik regional extracts](https://download.geofabrik.de/technical.html), in the existing fail-closed PostGIS evidence model. Preserve element identity/version, source timestamps, import batch and ODbL attribution/share-alike review.
2. **Official terrain by region.** Use the three state models for Harz—[LGLN DGM1](https://www.lgln.niedersachsen.de/startseite/wir_uber_uns/hilfe_support/lgln_lexikon/d/dgm-189696.html), [LVermGeo Sachsen-Anhalt DGM1](https://www.geodatenportal.sachsen-anhalt.de/gfds/de/gdp-open-data.html), and [TLBG Thüringen DGM](https://advmis.geodatenzentrum.de/trefferanzeige?docuuid=14418d25-fcd7-4a3f-99a9-e3059a2772af)—and [Land Tirol DGM](https://www.data.gv.at/datasets/0454f5f3-1d8c-464e-847d-541901eb021a) for Innsbruck. These support elevation/terrain only, never path access or safety.
3. **Tyrol official transport/access corroboration.** Pilot the [GIP Austria OGD graph](https://www.gip.gv.at/en/) under its documented [CC BY 4.0 attribution](https://www.gip.gv.at/assets/downloads/2509_dokumentation_gipat_ogd.pdf). Map only documented pedestrian access/restriction semantics and keep ambiguity fail-closed.
4. **Official route and closure sources remain link-only until licensed.** The most authoritative pages are operationally valuable, but publication on a website is not permission to copy. This includes Nationalpark Harz routes and closures, Harzklub/HTV, Innsbruck/Seefeld/Stubai tourism data, and Alpine Club hut data.
5. **Make DIGIWAY the first legal review.** Its 2026 [official harmonized trail dataset](https://www.europaregion.info/en/euregio/projekte/nachhaltigkeit/digiway-geodata-for-safety-in-the-mountains/software-for-harmonising-official-trail-data/) is the best technical fit for Innsbruck: daily ETL, source traceability, FC1 paths and FC2 official routes, GeoPackage/GeoJSON/WFS/vector tiles. However, the published package does not expose a sufficiently explicit unified license/attribution manifest. Open access is not a commercial license.

The inventory contains **30 source records**: **11 accepted candidates** (`approved_candidate` or `pilot_candidate`), 11 partnership-required, 5 legal-review-required and 3 rejected. No source is accepted for scenic-quality claims, drinking-water availability, current waterfall flow, or general “safe route” claims.

### Regional top choices

| Region | First choices | Why | Boundary |
|---|---|---|---|
| Harz | OSM via Geofabrik; LGLN/LVermGeo ST/TLBG terrain; Nationalpark Harz live pages as outbound checks | Strong open geometry/terrain foundation plus competent park authority for stated rules/closures | Harz spans three states; state rasters must be mosaicked without losing provenance. Park sources cover only the Nationalpark. |
| Innsbruck/Nordkette/Stubai | OSM via Geofabrik Austria; Land Tirol DGM; GIP OGD; DIGIWAY after license review | Official terrain and public-authority graph are open; DIGIWAY is purpose-built for official alpine routes | GIP access fields require completeness validation. DIGIWAY cannot be ingested until package/upstream licenses are explicit. |
| Cross-region enrichment | Wikidata identifiers/names; Wikimedia Commons per-asset media; Copernicus DEM fallback | Stable crosswalks and controlled enrichment without pretending to be operational authority | Commons is license-per-file. Copernicus is a DSM fallback, not the preferred terrain source. |

## Scope and method

### Pilot bounds

- `harz-v1`: **10.30–11.35° E, 51.45–51.98° N**, covering the relevant parts of Lower Saxony, Saxony-Anhalt and Thuringia.
- `innsbruck-alps-v1`: **10.95–11.65° E, 47.00–47.45° N**, covering the bounded Innsbruck/Nordkette/Stubai pilot.

These are the existing outdoor-evidence contract bounds. Every regional dataset must be clipped to them, while retaining source-region and source-record provenance.

### Research standard

The review prioritized current primary/official pages, dataset catalogs, licenses, terms, technical documentation and operational notices. Search snippets, blogs, aggregators and community anecdotes were not used as licensing authority. Every candidate was assessed for:

- provider and exact source/documentation/terms URLs;
- geographic and feature coverage;
- access path, formats, identifiers, geometry and timestamps;
- update cadence and attribution;
- commercial use and permission to store raw data, normalized facts and derived features;
- authentication, rates, pricing, privacy and operational risk;
- the exact claims the source can and cannot support;
- disposition, implementation tier, refresh mode and adapter order.

The JSON manifest is the normalized planning artifact and contains the complete field set for all 30 records. It is **not runtime configuration** and must not be promoted into production without implementation and legal review.

### Decision semantics

| Disposition | Meaning |
|---|---|
| `approved_candidate` | Clear enough license and operational fit to implement behind the normal security, attribution, quality and release gates. |
| `pilot_candidate` | Plausibly usable with explicit constraints that should be validated in a bounded pilot before production. |
| `partnership_required` | Valuable, but commercial storage/reuse requires a written provider/content-owner agreement. |
| `legal_review_required` | Material terms, legal interpretation or license-chain questions must be resolved before ingestion. |
| `research_needed` | Evidence is currently too incomplete even to select a legal/partnership path. No records remain here in this v1 inventory. |
| `reject` | Commercially, operationally, privacy-wise or contractually unsuitable for the proposed evidence use. |

### Integration modes

- **Static/precomputed:** terrain, controlled crosswalks and reviewed media. Build offline; never call upstream per route request.
- **Scheduled refresh:** OSM/GIP/transit and, once licensed, official catalogs. Version every import and keep a last-known-good snapshot.
- **Live time-sensitive check:** closures, hut opening and recent-condition notices. Check near route display/start; absence never means “open.”
- **Link-only:** public authoritative pages without data reuse permission. Deep-link with source scope; do not scrape or normalize.
- **Rejected:** no adapter, no scrape, no training/evidence use.

## Claim-authority matrix

This matrix governs user-facing facts. A higher-authority negative closure/restriction overrides a lower-authority positive or missing record. “Supported” means the source may support the narrowly worded claim with provenance and freshness; it never upgrades the source into a safety guarantee.

| Claim | Minimum authority and preferred sources | Allowed wording / fail-closed rule |
|---|---|---|
| POI existence | Mapped or first-party record: OSM, Wikidata, then operator/authority | “Mapped/recorded at …” with source/time. Does not mean open, accessible, safe or legal. |
| Terrain/elevation | Official terrain model: state DGM or Land Tirol DGM; Copernicus only as labeled fallback | Retain model type, resolution, datum, version and uncertainty. A raster does not prove a path. |
| Official route membership | Named route owner/competent authority: Nationalpark, Harzklub under agreement, DIGIWAY, DMO under agreement | OSM relation alone stays “mapped route relation,” never “official.” |
| Legal public access | Competent authority or validated official access graph: Nationalpark Wegeplan, GIP documented permission fields | Missing/ambiguous access is unknown and blocks positive access claims. Current orders and field signage override. |
| Temporary closure | Current authority/trail-manager notice: Nationalpark, Tirol forestry, Seefeld, HTV | Require scope/activity, `valid_from`, `valid_until` if stated, `observed_at` and source. Absence never means open. |
| Trail difficulty | Official classification with system/publisher; OSM mapped tag only as lower-confidence evidence | Preserve the regional scale. Never collapse blue/red/black, SAC and local systems without an explicit mapping and uncertainty. |
| Trail visibility | Maintainer signage record or mapped tag: Harzklub, DIGIWAY, OSM | Planning evidence only, with observation freshness. Never a visibility guarantee. |
| Hut existence | Operator network or corroborated map record: Alpine Clubs, Stubai, OSM/Wikidata | Existence does not mean staffed, open, reservable, safe, reachable or supplied with water. |
| Current hut opening | Operator or authorized current-status publisher: Stubai/individual operator, Alpine Clubs under agreement | Require `observed_at` and a short expiry; show source and instruct users to contact/check the operator. |
| Overnight permission | Current operator terms plus applicable authority/law | A hut/open campsite record does not prove bed availability or permission tonight. |
| Campsite legality | Competent authority or current municipal authorization | OSM/tourism directories are candidate discovery only. Never label “legal/approved” without an authorization record. |
| Drinking-water availability | Current operator or water authority | **No inventoried source meets the bar.** Show unknown; advise carrying/treating water. A spring/tap/hut mapping is not potability or current-flow proof. |
| Waterfall existence | Mapped or official record: OSM/Wikidata | May say “mapped waterfall”; not current flow, access or viewing quality. |
| Current waterfall flow | Recent hydrological sensor or competent operator observation | **No inventoried source meets the bar.** Never infer from existence, season, forecast rainfall or photographs. |
| Viewpoint existence | Mapped or official record: OSM/Wikidata | “Mapped viewpoint” only. Does not promise visibility, scenery, access or openness. |
| Scenic quality | Transparent nonfactual preference model or user request | **No source verifies this as fact.** Keep “views/scenic” as a requested preference, not a route claim. |
| Recent trail condition | Timestamped authority/trail-manager notice | Repeat only the specific stated condition and scope. Never generalize to “the route is safe/good.” |
| Scheduled public transport | Official timetable feed: DELFI; VVT after license review | Show feed/service validity and distinguish timetable from live operation. |
| Licensed media | Asset-level license and attribution bundle: Wikimedia Commons pilot | Author, title, source, license/version, derivative status and non-copyright review per file. |

No inventoried source is sufficient to say “this route is safe.” TrailMind must continue to say: **AI-assisted route. Review before starting. Check weather, local rules, trail conditions and water availability. Outdoor conditions can change quickly.**

## Harz inventory

The Harz pilot crosses three states, so a one-state terrain or route source is structurally incomplete. The recommended build is a single provenance-preserving regional evidence graph assembled from multiple authorities.

| Key | Source and primary terms | Data/access | Permission and authority | Mode | Disposition / tier |
|---|---|---|---|---|---|
| `lgln_dgm1_niedersachsen` | [LGLN DGM1](https://ni-lgln-opengeodata.hub.arcgis.com/apps/lgln-opengeodata::digitales-gel%C3%A4ndemodell-dgm1/about); [CC BY 4.0 terms and exact attribution](https://www.lgln.niedersachsen.de/startseite/wir_uber_uns_amp_organisation/logo/allgemeine-geschafts-und-nutzungsbedingungen-agnb-97401.html) | COG/STAC/WCS/WMS, 1 m terrain | Commercial storage/derivation allowed with `© GeoBasis-DE/LGLN [download year]` and `Daten geändert` when modified. Elevation only. | Static | `approved_candidate` / MVP now |
| `lvermgeo_st_dgm1` | [Sachsen-Anhalt Open Data/DGM1](https://www.geodatenportal.sachsen-anhalt.de/gfds/de/gdp-open-data.html); [terms](https://www.geodatenportal.sachsen-anhalt.de/gfds/de/datei/anzeigen/id/3567%2C501/nutzungsbedingungenv5.0_b.pdf) | GeoTIFF, ATOM, WCS/WMS | `dl-de/by-2-0`, provider `© GeoBasis-DE / LVermGeo ST`; commercial derivatives permitted with attribution/change notice. Elevation only. | Static | `approved_candidate` / MVP now |
| `tlbg_thueringen_dgm` | [TLBG DGM catalog](https://tlbg-onlineshop.thueringen.de/onlineshop/uebersichten/digitale-gelaendemodelle-dgm); [official metadata/license](https://advmis.geodatenzentrum.de/trefferanzeige?docuuid=14418d25-fcd7-4a3f-99a9-e3059a2772af) | DGM2/DGM5 ASCII/download/WMS | `dl-de/by-2-0`; cite the data-holding office/GDI-Th and retrieval year. Elevation only. | Static | `approved_candidate` / MVP now |
| `nationalpark_harz_official_routes_rules` | [Nationalpark legal basis and Wegeplan](https://www.nationalpark-harz.de/de/der-nationalpark-harz/wir-ueber-uns/rechtliche-grundlagen.php/); [imprint](https://www.nationalpark-harz.de/de/kontakt-service/impressum.php) | HTML, plan PDF, interactive map | Competent park authority for its official network, permitted uses and Wegegebot. No reusable machine-data license located. | Link-only | `legal_review_required` / pilot next |
| `nationalpark_harz_current_closures` | [Current closures/impairments](https://www.nationalpark-harz.de/de/startseite/Wegesperrungen_Aktuell/?js=false&settings=show); [July 2026 Harz App/interface announcement](https://www.nationalpark-harz.de/de/aktuelles/2026/2026_07_10_Update%20Harz%20App/) | HTML/ArcGIS-backed presentation | Strong authority for explicitly listed park closures. No reusable feed/license yet; absence does not prove open. | Live link | `legal_review_required` / pilot next |
| `harzklub_trail_network` | [Maintained network/signage](https://harzklub.de/wandern/wegenetz-beschilderung/); [imprint copyright terms](https://harzklub.de/impressum/) | Public pages plus internal optimization/sign database | Maintainer authority for marked/maintained network, but the imprint limits copying to private non-commercial use. Written partnership required. | Link-only | `partnership_required` / pilot next |
| `harzinfo_routes_and_conditions` | [HTV route/condition notices](https://www.harzinfo.de/erlebnisse/wandern/harzer-hexen-stieg/aktuelle-hinweise); [imprint/Outdooractive disclosure](https://www.harzinfo.de/impressum) | HTML, route portal/GPX, potential Outdooractive API | Official DMO for its published content, but rights are mixed across HTV, Outdooractive and contributors. “Known notices” are not complete closure coverage. | Link-only/live link | `partnership_required` / pilot next |
| `harzinfo_camping_directory` | [HTV camping directory](https://www.harzinfo.de/planen-uebernachten/unterkuenfte/camping-wohnmobilstellplaetze-im-harz); [imprint](https://www.harzinfo.de/impressum) | HTML/PDF directory | Supports “advertised/listed place” only. Per-image licenses do not license the dataset, and listing does not prove legal authorization or current availability. | Link-only | `partnership_required` / future |
| `delfi_gtfs_germany` | [DELFI](https://www.delfi.de/); [official GovData metadata](https://data.gov.de/suche/daten/delfi-timetable-gtfs) | GTFS/NeTEx bulk, stops/calendars/trips/shapes | Published under CC BY; suitable for scheduled trailhead reachability, not live operation or last-mile legal access. | Scheduled | `approved_candidate` / pilot next |

### Harz implementation notes

- Union the Niedersachsen, Sachsen-Anhalt and Thüringen OSM extracts, clip once to `harz-v1`, then deduplicate by `(osm_type, osm_id, version)`.
- Build three separately versioned terrain inputs and a derived regional mosaic. Keep the source raster ID for every sampled/aggregated elevation value; do not erase seams by losing provenance.
- Do not use the Harzklub site's conflicting network totals as data. The current pages and a 2026 annual report expose different totals; that is a concrete reason to require a versioned partner feed rather than copying prose.
- Nationalpark Harz is a competent authority only within its park. Its Wegeplan can support official permitted-use statements for the stated network, while the live page can support only explicitly published closures/conditions.
- The Nationalpark’s [10 July 2026 Harz App announcement](https://www.nationalpark-harz.de/de/aktuelles/2026/2026_07_10_Update%20Harz%20App/) identifies a promising partnership path: standardized protection rules already flow through Digitize the Planet/Outdooractive, and an automated closure interface is planned. Request this feed directly rather than reverse-engineering the public site.

## Innsbruck, Nordkette and Stubai inventory

| Key | Source and primary terms | Data/access | Permission and authority | Mode | Disposition / tier |
|---|---|---|---|---|---|
| `land_tirol_dgm` | [Land Tirol DGM dataset](https://www.data.gv.at/datasets/0454f5f3-1d8c-464e-847d-541901eb021a); [Land Tirol terms](https://www.tirol.gv.at/data/nutzungsbedingungen/) | GeoTIFF 5/10 m; high-resolution sheet products; services | CC BY 4.0, required `Datenquelle: Land Tirol - data.tirol.gv.at`; additional terms include notifying Land Tirol where the app/service can be found. Elevation only. | Static | `approved_candidate` / MVP now |
| `gip_at_ogd` | [GIP OGD](https://www.gip.gv.at/en/); [dataset documentation/license](https://www.gip.gv.at/assets/downloads/2509_dokumentation_gipat_ogd.pdf) | Austria GeoPackage/INTREST graph, roughly two-month releases | CC BY 4.0 with `Datenquelle: gip.gv.at`. Public-authority transport graph; validate pedestrian access semantics/completeness before legal-access use. | Scheduled | `approved_candidate` / MVP now |
| `digiway_official_trail_data` | [DIGIWAY official data page/endpoints](https://www.europaregion.info/en/euregio/projekte/nachhaltigkeit/digiway-geodata-for-safety-in-the-mountains/software-for-harmonising-official-trail-data/); [2026 manual](https://www.europaregion.info/fileadmin/downloads/2_Projekte_Files/Nachhaltigkeit/digiway/downloads/Software_MovingLayers/DIGIWAY_Software_Datasets_G1_UserManual_FINAL.pdf) | Daily FC1/FC2; GeoPackage, GeoJSON, WFS, vector tiles | Highest-value technical route source, explicitly produced from published OGD, but no sufficiently explicit package/upstream license manifest found. Resolve before ingestion. | Scheduled after approval | `legal_review_required` / pilot next |
| `tirol_forestry_closures` | [Land Tirol closure guidance](https://www.tirol.gv.at/meldungen/meldung/forstliche-wegsperren-richtig-wichtig-und-unbedingt-zu-beruecksichtigen/); [Bergwelt Tirol](https://www.bergwelt-miteinander.at/sommer/absperrungen.html) | Warden/DMO workflow visible in official routing apps; no public feed documented | Strong for entered forestry closures, but coverage is cycling-oriented and no hiking completeness, reuse license, schema or SLA is published. | Live link | `partnership_required` / pilot next |
| `tirol_camping_law` | [Current RIS consolidation](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrT&Gesetzesnummer=20000099); [official municipal guidance](https://www.tirol.gv.at/fileadmin/themen/tirol-europa/gemeinden/downloads/Merkblatt/MB04-2022.pdf) | Official law/HTML/PDF; no statewide authorization geometry | Supports the general legal rule and exception framework after counsel review. It does not identify every authorized campsite or municipal exception. | Static legal rule | `legal_review_required` / future |
| `innsbruck_tourism_routes` | [Innsbruck official route catalog](https://www.innsbruck.info/en/hiking/d/hiking-trails.html?s=1); [classification](https://www.innsbruck.info/en/hiking/service/classifications-of-hiking-routes.html); [imprint](https://www.innsbruck.info/en/imprint) | Route pages, GPX, stats, difficulty, map | Official tourism publication, but imprint states copyright protection/all rights reserved. GPX download is not commercial storage permission. | Link-only | `partnership_required` / pilot next |
| `seefeld_official_routes` | [Seefeld official hiking catalog](https://www.seefeld.com/de/wandern.html); [imprint](https://www.seefeld.com/de/impressum.html) | Route pages/map/GPX | Copyright-protected DMO content without a reusable feed license. Territory only partly overlaps the pilot. | Link-only | `partnership_required` / future |
| `seefeld_current_closures` | [Current Seefeld closures](https://www.seefeld.com/de/wegsperren.html); [imprint](https://www.seefeld.com/de/impressum.html) | Current HTML notices with route numbers, affected tours, detours and dates | Operationally valuable. As of research, the page included July 2026 closures, but no feed/license/completeness guarantee. Do not scrape. | Live link | `partnership_required` / future |
| `stubai_routes_and_hut_status` | [Stubai route/GPX example](https://www.stubai.at/en/interactive-map/tour/stubaier-hoehenweg/); [timestamped hut status PDF](https://www.stubai.at/fileadmin/pdf/hut_export.pdf); [limited press-portal terms](https://www.stubai.at/fileadmin/userdaten/presse/Terms-of-use-Presseportal-TVB-Stubai-Tirol-2022_EN.pdf) | HTML/GPX and generated PDF | Public status is timely but expressly without warranty; located terms are purpose-limited and do not license commercial route/hut data. “Open now” requires operator confirmation and short expiry. | Link-only/live link | `partnership_required` / future |
| `alpenverein_hut_directory` | [Alpine Clubs hut directory](https://www.alpenverein.at/portal/huetten-wege/index.php); [explicit data copyright disclaimer](https://www.alpenverein.at/huetten/haftungsausschluss.php) | Public web directory/map | Strong operator-network provenance for huts, but the disclaimer requires express written permission for data use. Opening does not prove beds, water or access. | Link-only | `partnership_required` / future |
| `vvt_gtfs_platform` | [Austria national access-point GTFS metadata](https://www.mobilitaetsdaten.gv.at/daten/soll-fahrplandaten-gtfs); [VVT provider page](https://mobilitaetsdaten.gv.at/node/307); [license agreement](https://mobilitaetsdaten.gv.at/sites/default/files/metadataset/contract_examples/Lizenzvereinbarung_DBP_v1.1_0.pdf) | Registered GTFS/NeTEx download/API; change-driven updates | Official schedule feed, but governed by a separate agreement with validity, deletion/commercial-use obligations and penalties—not a simple unconditional open license. | Scheduled after review | `legal_review_required` / pilot next |

### Innsbruck implementation notes

- Use the **5 m Land Tirol DGM** for the bounded pilot, recording native CRS, vertical reference, distribution URL, version/date and checksum before transformation.
- Treat GIP as corroboration, not automatic legal truth. Only map fields whose pedestrian semantics and territorial completeness are documented. Unknown still blocks the legal-access claim.
- DIGIWAY’s FC2 route membership and difficulty are more authoritative than OSM when the package identifies the responsible regional source. FC1/FC2 still do not prove current openness unless an effective closure/access record is present.
- Keep tourism route classification in its original system. Innsbruck’s own [classification page](https://www.innsbruck.info/en/hiking/service/classifications-of-hiking-routes.html) explicitly says length and typical alpine hazards are not part of the difficulty class, so difficulty must not be rendered as safety.
- The Stubai hut PDF is an excellent example of a **time-sensitive source that is not yet an ingestible source**: it provides a generation timestamp and reported status but disclaims accuracy/completeness and has no commercial data license. Link to it and the operator; do not cache “open now” indefinitely.

## Cross-region foundational and enrichment sources

| Key | Source and primary terms | Data/access | Permission and claim boundary | Mode | Disposition / tier |
|---|---|---|---|---|---|
| `osm_foundational_data` | [OSM copyright/license](https://www.openstreetmap.org/copyright); [OSMF legal FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ); [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | Bulk PBF/diffs/self-hosted PostGIS | Commercial use permitted with attribution and ODbL obligations. Supports mapped evidence only; missing access is unknown. | Scheduled | `approved_candidate` / MVP now |
| `geofabrik_regional_extracts` | [Geofabrik downloads](https://download.geofabrik.de/); [technical details](https://download.geofabrik.de/technical.html) | Daily regional PBFs/state files/checksums | Production acquisition channel for OSM. The claim authority remains OSM; preserve extract time/checksum. | Scheduled | `approved_candidate` / MVP now |
| `wikidata_entities` | [Data access](https://www.wikidata.org/wiki/Wikidata:Data_access); [database downloads](https://www.wikidata.org/wiki/Wikidata:Database_download); [CC0 licensing](https://www.wikidata.org/wiki/Wikidata:Licensing) | Dumps, entity API, bounded SPARQL | Good for QIDs, multilingual names, coordinates and official-site crosswalks. Not official/current/legal evidence. | Scheduled | `approved_candidate` / pilot next |
| `wikimedia_commons_media` | [Reuse guide](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/en); [license guide](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/licenses); [API limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits) | MediaWiki API and files | Each file has its own license/attribution and possible non-copyright rights. Build an allowlist; do not treat imagery as condition/scenic proof. | Static per asset | `pilot_candidate` / future |
| `copernicus_dem_glo30` | [Collection](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM); [API/data docs](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM.html); [GLO-30 license](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf) | GeoTIFF/DTED, S3/OData/Process API | Free full/open license with exact notices; registered CCM access. It is a 30 m **surface** model and only a fallback/QA source. | Static | `pilot_candidate` / future |
| `outdooractive_partner_api` | [Data API](https://developers.outdooractive.com/API-Reference/Data-API.html); [business/content licensing model](https://business.outdooractive.com/your-own-business-account); [consumer terms](https://www.outdooractive.com/en/terms-and-conditions.html) | Authenticated JSON/XML project API and synchronization | Credible contractual route to HTV/DMO content, but rights vary by content owner/license. Consumer content is not commercially reusable by default. | Scheduled after contract | `partnership_required` / pilot next |
| `komoot_partner_content` | [Partner resources](https://support.komoot.com/hc/en-us/sections/10328781716122-Tools-Resources-for-Partners); [partner FAQ](https://komoot.business/en/FAQ); [terms](https://www.komoot.com/terms-of-service) | Partner API/embed only | Consider only under a written agreement for named first-party content. No scraping or use of consumer/community highlights as evidence. | Link/contract only | `partnership_required` / future |

### Copernicus July 2026 access change

[Copernicus announced on 17 July 2026](https://dataspace.copernicus.eu/news/2026-7-17-copernicus-dem-30m-view-service-license-acceptance) that from **28 July 2026** the GLO-30 view service requires the authorized CCM user category/registration and license acceptance. This does not negate the GLO-30 free license, but it changes operational access. Any adapter plan must include a production service account, accepted license, credential rotation and a no-runtime-dependency bulk ingestion path.

## Rejected or commercially/operationally unsuitable sources

| Key | Source | Decision | Evidence |
|---|---|---|---|
| `osm_public_operational_services` | Public OSM editing API, Nominatim, standard tiles and public Overpass instances | **Reject as production acquisition/runtime infrastructure.** Use bulk OSM and self-hosted or contracted services instead. | [Editing API is not for read-only projects](https://operations.osmfoundation.org/policies/api/); [Nominatim forbids systematic POI extraction and caps ordinary use](https://operations.osmfoundation.org/policies/nominatim/); [standard tiles prohibit bulk/offline download and have no SLA](https://operations.osmfoundation.org/policies/tiles/). |
| `alltrails_consumer_platform` | AllTrails routes, reviews, maps and photos | **Reject.** Terms grant personal non-commercial use, prohibit scraping/mining and require written permission for commercial exploitation. Mixed user/licensor rights and no official claim authority. | [AllTrails Terms of Service](https://www.alltrails.com/terms). |
| `strava_api_and_heatmap` | Strava API/activity/heatmap signals | **Reject.** The June 2026 API terms prohibit competing/replicating applications and limit user-specific data display. Activity geometry is sensitive and popularity cannot prove legal access or safety. | [Strava API Agreement](https://www.strava.com/legal/api) and [API Policy](https://www.strava.com/legal/api_policy). |

Consumer pages, reviews, social posts, photographs and public heatmaps also fail the authority test even when a fact appears plausible. They must not be used to claim legal access, current closure/open status, drinking water, campsite legality, trail safety or recent conditions.

## Recommended MVP stack and tiering

### Tier 1 — MVP now

Implement only sources with a clear license and direct value to route evidence:

| Order | Adapter | Region | Job | Refresh/acceptance gate |
|---:|---|---|---|---|
| 1 | `osm_foundational_data` | Both | Normalize paths, route relations and mapped POIs into fail-closed evidence | Input no older than 14 days; record OSM version/timestamp/import batch; reject missing/ambiguous access for positive claims. |
| 2 | `geofabrik_regional_extracts` | Both | Acquire OSM bulk data | Verify checksum/extract timestamp. Union and dedupe the three Harz states; clip Austria for Innsbruck. |
| 3 | `lgln_dgm1_niedersachsen` | Harz | Official terrain/elevation | Verify CRS/vertical datum/no-data; attribution bundle; static checksum. |
| 4 | `lvermgeo_st_dgm1` | Harz | Official terrain/elevation | Same normalization; retain state/source cell lineage. |
| 5 | `tlbg_thueringen_dgm` | Harz | Official terrain/elevation | Select one current product/resolution and document it before import. |
| 6 | `land_tirol_dgm` | Innsbruck | Official terrain/elevation | Use 5 m pilot product; implement exact attribution and provider-notification obligation. |
| 7 | `gip_at_ogd` | Innsbruck | Public-authority network/access corroboration | Validate pedestrian semantics/completeness on a sample; import every two months; never infer from missing fields. |

MVP UI should expose source-aware facts only: actual route geometry/stats from the routing engine; mapped features as mapped; terrain-derived elevation with source; and a prominent official-condition checklist. The MVP should not ingest public closure pages without permission.

### Tier 2 — Pilot next

- `digiway_official_trail_data` after a documented license-chain review.
- Nationalpark Harz route/rule and closure feeds after written permission or the announced automated interface.
- HTV/Outdooractive authoritative content project under a record-level license/authority allowlist.
- DELFI scheduled trailhead transit.
- VVT GTFS only after counsel approves the current agreement and data-expiry/deletion implementation.
- Wikidata QID/name/official-site crosswalks.

### Tier 3 — Future enrichment

- Partnered Innsbruck/Seefeld/Stubai route and condition feeds.
- Partnered Alpine Clubs hut directory and operator status.
- Legally verified campsite registry/municipal exceptions.
- Wikimedia Commons allowlisted media.
- Copernicus DEM fallback and QA.
- Komoot only if a narrow partnership supplies unique, first-party content with storage rights; never as a foundational dependency.

## Partnership and legal-review queue

### Priority 1: DIGIWAY license chain

Ask Euregio/Land Tirol for:

1. the exact license governing the harmonized GeoPackage/GeoJSON/WFS/vector-tile products;
2. a source-by-source license and attribution manifest for Tyrol FC1/FC2 records;
3. confirmation of commercial server-side storage, normalization, clipping and derived route features;
4. persistent feature/source IDs, deletion semantics and source update timestamps;
5. documented pedestrian access/closure semantics, coverage and completeness;
6. service/download SLA or recommended bulk-refresh behavior.

Do not infer permission from “OGD,” a public endpoint or intended use by outdoor apps.

### Priority 2: Nationalpark Harz / HTV / Outdooractive

The July 2026 Harz App work suggests a practical combined route:

- license the curated official Nationalpark tours and standardized protected-area rules;
- obtain the planned closure interface directly, with effective times and stable segment IDs;
- scope an Outdooractive project to named first-party publishers only;
- exclude community routes, comments, profiles and unlicensed media;
- require content-level authority, ownership, license, updated/deleted timestamps and permitted cache duration;
- define attribution and source-link UI.

### Priority 3: Regional operational sources

- **Harzklub:** route/segment codes, geometry, signage/maintenance timestamps, trail-manager scope, defect/closure events, commercial rights.
- **Innsbruck/Seefeld/Stubai tourism associations:** stable route IDs, geometry rights, original difficulty system, publisher, change/delete feed and closure/status channel.
- **Alpine Clubs/hut operators:** stable hut IDs, operator-verified season/current status, observed time/expiry, booking/contact link, permitted fields and privacy retention.
- **Tirol forestry closure network:** GIP/DIGIWAY segment keys, hiking/MTB scope, valid times, expiry, completeness, latency and SLA.
- **HTV/camping and Tyrol authorities:** separate tourism advertising from current competent authorization.

### Mandatory counsel review

- ODbL public-distribution boundary for TrailMind’s normalized evidence database and derived outputs.
- DIGIWAY harmonized/upstream license chain.
- VVT data platform agreement, especially commercial use, validity, deletion and contractual penalties.
- Tirol Camping Act user-facing interpretation and any campsite/municipal authorization representation.
- Nationalpark Harz plan/map/closure reuse until explicit feed permission exists.

## Freshness and provenance policy

### Universal record contract

Every normalized record should carry at least:

```text
source_key
source_record_id
source_authority
source_url
source_license_or_contract_id
source_version
source_updated_at
observed_at
valid_from
valid_until
ingested_at
import_batch_id
geometry_source_id
claim_scope
confidence_or_authority_class
attribution_bundle_id
raw_asset_checksum (when bulk/static)
```

Unknown values remain `null` and must never be backfilled from assumptions. Raw-content retention must be disabled unless the record’s source permission explicitly permits it.

### Source-specific cadence

| Source class | Target cadence | Stale behavior |
|---|---|---|
| OSM/Geofabrik | Daily preferred; **14-day maximum evidence age** per existing regional contract | Quarantine new import; continue last-known-good within policy; show no freshness-dependent positive claim when threshold is exceeded. |
| GIP | Check release every two weeks; expect roughly two-month releases | Retain last version, flag release age; never call it live. |
| Official state/Tyrol terrain | Quarterly catalog check; rebuild only on changed asset/version | Terrain remains usable with displayed/versioned provenance unless withdrawn; no condition claim. |
| DIGIWAY if licensed | Daily package check with conditional request/checksum | Keep last-known-good briefly; alert on failed/stale pipeline; do not claim current closure unless closure semantics exist. |
| DELFI | At least weekly and before calendar boundary | Disable journeys outside feed validity; label as schedule, not live service. |
| VVT if approved | On change/daily, matching agreement and validity | Purge/expire exactly as contract requires; disable stale schedule results. |
| Closure/condition feed | At display and pre-start, plus event/webhook/polling agreed with provider | If unavailable/stale, show “status unknown—check official source”; never “open.” |
| Hut current opening | Near-real-time/operator check; short provider-agreed TTL | Expire to unknown; link/call operator. |
| Legal rules | Weekly version monitor plus release review | Block affected legal claims until reviewed. |
| Media | Validate at ingestion; periodic license/takedown audit | Unpublish on license ambiguity/takedown; retain audit record. |

### Precedence and conflict handling

1. A current competent-authority restriction/closure overrides route, map, tourism and community evidence.
2. A current trail manager/operator status overrides a stale catalog record within its narrow scope.
3. An official plan/route owner overrides OSM for official membership, but not necessarily for current openness.
4. OSM may establish mapped evidence only.
5. Tourism/operator pages may establish their own published offering/status only when licensed and timestamped.
6. Missing, contradictory or expired evidence resolves to **unknown**, not the more convenient answer.

Every conflict should be logged with both source records, timestamps, geometry overlap and the resolution rule applied. Do not delete the losing evidence record; keep it for audit and future correction.

## Adapter implementation order

The manifest’s `adapter_order` is intentionally conservative:

1. OSM normalization contract and ODbL attribution/provenance.
2. Geofabrik bulk acquisition and region clipping/deduplication.
3. LGLN DGM1.
4. Sachsen-Anhalt DGM1.
5. Thüringen DGM.
6. Land Tirol DGM.
7. GIP OGD.
8. Reserve integration/evidence-resolution QA before adding enrichment.
9. DELFI GTFS.
10. Wikidata crosswalks.
11. Wikimedia Commons allowlist.
12. Copernicus fallback/QA.

Partnership/legal-review sources deliberately have `adapter_order: null`. An engineering slot is assigned only after the permission and authority contract is complete.

### Adapter acceptance checklist

Before any adapter ships:

- exact license/contract and source URL are captured;
- commercial storage, raw retention, normalized facts and derived-feature rights are separately resolved;
- source IDs, version/update/delete semantics and geometry lineage are tested;
- attribution renders in the intended iOS surfaces and export/share contexts;
- negative/unknown/missing fields fail closed;
- stale/unavailable upstream behavior is deterministic and user-safe;
- fixtures contain no credentials or personal data;
- a sample of source records is manually reconciled to the official publisher;
- the adapter cannot promote source authority beyond the claim matrix;
- kill switch and last-known-good rollback are documented.

## Known gaps

These are product-data gaps, not permission to infer:

1. **No authoritative, reusable Harz-wide live closure feed.** Nationalpark covers its own territory; HTV/Harzklub/forestry and municipal notices remain fragmented.
2. **No validated Innsbruck hiking-closure feed with license, completeness and SLA.** Tyrol’s forestry workflow is promising but cycling-oriented and not openly specified.
3. **No machine-readable current hut opening/bed-availability feed with commercial rights.** Stubai’s PDF and Alpine Clubs directory are link/partnership sources.
4. **No authoritative current drinking-water availability/potability source.** OSM `drinking_water` and operator listings cannot support a current guarantee.
5. **No current waterfall-flow source.** Existence is not flow.
6. **No verified scenic-quality source.** Viewpoints/photos do not justify “scenic route.”
7. **No complete machine-readable campsite authorization registry.** Tourism directories show advertised places, not legal authorization; municipal Tyrol exceptions are fragmented.
8. **Harz official-route ownership is fragmented.** Nationalpark, Harzklub, HTV, municipalities and route projects need per-segment authority.
9. **GIP pedestrian access completeness is unvalidated for recreational paths.** It may corroborate documented access, not automatically resolve every alpine path.
10. **DIGIWAY package licensing is insufficiently explicit.** This is the largest near-term opportunity and the largest licensing gap.
11. **Static transit is not live service.** DELFI/VVT still require disruption/real-time sources for “running now.”
12. **No verified recent trail-condition source for every pilot segment.** Only specific authority notices may be shown.

## Material operational and claim risks

| Risk | Consequence | Required control |
|---|---|---|
| Website visibility mistaken for reuse permission | Copyright/database/contract breach | Link-only until explicit data license or written agreement. |
| OSM/community evidence overstated | False legal/safety/current claims | “Mapped” wording, authority class, fail-closed access and claim matrix. |
| Closure absence interpreted as open | User routed into an unknown/closed segment | Three-state status (`closed`, `not_closed`, `unknown`) only where authority supports it; absence is `unknown`. |
| Stale “open now” hut/route notice | Failed trip or safety exposure | `observed_at`, short TTL, operator link and expiry to unknown. |
| Terrain model mixed silently | Incorrect ascent/slope | Source-specific raster lineage, model type/resolution/datum and QA thresholds. |
| Difficulty collapsed across systems | Misleading challenge/safety signal | Preserve source scale/system; explicit mappings only. |
| DMO “official” treated as legal authority | Overclaiming access/camping/status | Record publisher role and claim scope; require competent authority for legal claims. |
| Photos/reviews used as quality/condition truth | Subjective or stale route claims | Media only after license review; never scenic/condition authority. |
| Public APIs used as free infrastructure | Blocking, instability, policy breach | Bulk download/self-host/contracted service; no public runtime dependency. |
| Mixed personal/operator data ingested | GDPR/privacy risk | Field allowlist, no reporter/community profiles, purpose limitation, retention rules. |
| License/attribution lost in derivation | Release noncompliance | Immutable attribution bundle and source lineage through every derived feature/export. |
| Contract expiry/deletion ignored | Breach and stale data | Validity-aware storage, tombstones, cache purge and auditable deletion pipeline. |

## Next steps

1. Approve the Tier 1 source architecture and the claim-authority matrix as the implementation contract.
2. Obtain ODbL counsel guidance for the intended database/Produced Work boundary and finalize the OSM attribution surface.
3. Prototype the four terrain adapters (three Harz regional adapters plus Land Tirol) against a small tile set; document CRS, vertical datum, no-data and seam behavior before full ingestion.
4. Run a GIP Tyrol spike against a stratified Innsbruck/Nordkette/Stubai path sample to measure pedestrian coverage, permission-field semantics and disagreement with OSM.
5. Send the DIGIWAY license/schema/completeness questions listed above to Euregio/Land Tirol; do not download into production storage until answered.
6. Open a combined Nationalpark Harz/HTV/Outdooractive data-partnership discussion focused on first-party official routes, Digitize the Planet rules and the planned closure interface.
7. Define a generic `SourceEvidence`/`ClaimAuthority` adapter contract with validity, provenance, attribution and tombstone behavior before implementing any partner source.
8. Add link-only official-condition panels for the pilot regions without scraping content: Nationalpark Harz, Seefeld/Tyrol and Stubai/operator pages as applicable.
9. Implement scheduled transit only after core route evidence is stable; DELFI first, VVT only after agreement review.
10. Re-run this licensing inventory before production launch and whenever a provider changes terms, API access or ownership.

## Source-count reconciliation

| Disposition | Count | Records |
|---|---:|---|
| `approved_candidate` | 9 | OSM; Geofabrik; LGLN DGM1; Sachsen-Anhalt DGM1; Thüringen DGM; DELFI; Land Tirol DGM; GIP; Wikidata |
| `pilot_candidate` | 2 | Wikimedia Commons; Copernicus DEM GLO-30 |
| `partnership_required` | 11 | Harzklub; HTV routes/notices; HTV camping; Tirol forestry closures; Innsbruck routes; Seefeld routes; Seefeld closures; Stubai routes/huts; Alpine Clubs huts; Komoot partner content; Outdooractive API |
| `legal_review_required` | 5 | Nationalpark Harz routes/rules; Nationalpark closures; DIGIWAY; Tirol Camping Act; VVT GTFS |
| `research_needed` | 0 | — |
| `reject` | 3 | Public OSM operational services; AllTrails; Strava |
| **Total** | **30** | **11 accepted candidates** |

The JSON manifest is the canonical record-level detail for implementation planning. If this Markdown summary and the JSON ever disagree, stop and reconcile them before using either for source selection.
