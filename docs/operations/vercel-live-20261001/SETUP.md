# Vercel-Einrichtung für zwei Live-Abnahme-Prompts

Ziel: bestehendes Projekt **backend**, Environment ausschließlich **Production**, Origin **https://backend-zeta-amber-69.vercel.app**. Im Vercel-Dashboard unter Project → Settings → Environment Variables eintragen. Kein neues Projekt anlegen. Diese vorbereitete Konfiguration setzt den begleitenden CA-/Budget-Patch voraus; er ist noch nicht deployed.

## 1. Drei Secrets direkt in Vercel hinterlegen

| Name | Inhalt / Quelle |
| --- | --- |
| `GOOGLE_API_KEY` | Freigegebener Gemini-Schlüssel mit passender Provider-Quota |
| `GRAPHHOPPER_API_KEY` | Freigegebener GraphHopper-Schlüssel |
| `APP_ATTEST_DATABASE_URL` | PostgreSQL-Verbindung mit dem Passwort der vorhandenen Rolle `app_security_runtime_role` im Projekt **TrailMind Outdoor Staging V1** (`mbvzwsrtqcrwhvykugcd`); kein `postgres`, `service_role`, Owner oder Admin |

DSN-Form für den im Supabase-Connect-Dialog angebotenen **Session Pooler auf Port 5432**:

```text
postgresql://app_security_runtime_role.mbvzwsrtqcrwhvykugcd:<URL-ENCODED-RUNTIME-PASSWORD>@<EXACT-SESSION-POOLER-HOST>:5432/postgres?sslmode=verify-full&sslrootcert=/tmp/wanderful-app-attest-ca.pem
```

Host aus dem ausgewählten Projekt übernehmen, nicht aus der Region raten. Passwort URL-kodieren, ausschließlich im Vercel-Wert. Keine Transaction-Pooler-Verbindung auf 6543. Eine erreichbare direkte Verbindung ist alternativ `app_security_runtime_role@db.mbvzwsrtqcrwhvykugcd.supabase.co:5432`, mit demselben Passwort-/TLS-Vertrag. Allgemeine Supabase-Integration-Variablen werden nicht als Ersatz übernommen. Keine vorhandenen Rollen/Grants ändern, um Admission zu umgehen.

## 2. Öffentliche Datenbank-CA bereitstellen

Im **ausgewählten Supabase-Projekt** unter Database Settings das Server-Root-Zertifikat herunterladen. Die Herkunft muss der authentifizierte Projektdialog sein. Es ist ein öffentlicher Vertrauensanker, kein privater Schlüssel. [Supabase beschreibt Download und verify-full hier](https://supabase.com/docs/guides/database/connecting-to-postgres).

| Name in Vercel Production | Inhalt |
| --- | --- |
| `APP_ATTEST_DATABASE_CA_PEM` | Vollständiges PEM-Root-Zertifikat einschließlich BEGIN/END und echten Zeilenumbrüchen, keine literalen `\n` |
| `APP_ATTEST_DATABASE_CA_SHA256` | SHA-256-Fingerprint des DER-Zertifikats: 64 Hexzeichen ohne Doppelpunkte, aus dem heruntergeladenen Original unabhängig berechnet |

Nur für die **öffentliche CA-Datei** lokal: `openssl x509 -in /ABSOLUTER/PFAD/ca.pem -noout -fingerprint -sha256`. Ausgabepräfix und Doppelpunkte für den Vercel-Wert entfernen. Weder Schlüssel noch DSNs an diesen Befehl übergeben.

Der vorbereitete Adapter prüft Format, CA-Eigenschaft, Gültigkeitszeitraum und Fingerprint, schreibt die CA bei Initialisierung atomar nach **`/tmp/wanderful-app-attest-ca.pem`** und lässt `pg` genau diese Datei über `sslrootcert` laden. Die Datei wird bei einem neuen Function-Prozess neu bereitgestellt. `sslmode=verify-full` und Hostnamenprüfung bleiben aktiv; keine private Datei muss committed werden. Kein `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized:false`, `PGOPTIONS` oder eigener Node-Startcode.

## 3. Nichtsecret-Konfiguration übernehmen

Die vollständigen 43 festen Namen/Werte stehen in **`nonsecret-production.env.example`** neben dieser Datei; die maschinenlesbare Quelle ist **`backend/config/vercel-pilot-v1.json`**. Dieser Block enthält keine Schlüssel. Nur in Production eintragen.

Die wesentlichen Werte:

- `NODE_ENV=production`, `TRAILMIND_RELEASE_STAGE=staging`, `TRAILMIND_RUNTIME_PROFILE=dynamic-research-v1`.
- `TRAILMIND_APPLICATION_SCHEMA=trailmind_app`; Runtime=`app_security_runtime_role`, Control=`pruner_role`, Operator=`migration_role`. Alle drei Rollennamen wurden am 1. Oktober lesend im Datenbankkatalog bestätigt. Nur die Runtime erhält einen Verbindungswert; keine Control-/Operator-Zugangsdaten in den Webdienst.
- `AI_PROVIDER=google`, **`GOOGLE_MODEL=gemini-3.8-flash`**. Genau dieses Modell verlangt der aktuelle Web-/Condition-Adapter; der frühere Default `gemini-3.5-flash` genügt hier nicht. Tatsächliche Provider-Verfügbarkeit ist erst im freigegebenen Live-Test belegt.
- Die fünf Flags `ROUTE_PROVIDER_ENABLED`, `INTENT_PROVIDER_ENABLED`, `LLM_FIRST_PLANNING_ENABLED`, `DYNAMIC_RESEARCH_ENABLED`, `DYNAMIC_WEB_RESEARCH_ENABLED` werden für diese Abnahme `true`.
- Tageslimit zwei Dynamic-Requests: Route-/Installationskosten jeweils 24, Intent-/Installationskosten jeweils 6, Fenster 86400 Sekunden und Parallelität 1. Route-Lease 180 Sekunden.
- `DYNAMIC_RESEARCH_MAX_GENERATIONS=7`, `DYNAMIC_RESEARCH_MAX_CURRENT_INFORMATION_GENERATIONS=2`: höchstens sieben reservierte Gemini-Generationen pro Dynamic-Request plus ein initialer Intent-Aufruf pro Prompt. Zwei vollständige Prompt-Versuche ergeben höchstens 16 Gemini-Aufrufe. Bestehendes Routinglimit: höchstens fünf GraphHopper-Aufrufe pro Dynamic-Request, damit zehn für zwei Requests (unter der autorisierten Gesamtkappe 32).
- Weather, Apple-Account, KI-Packlisten-Ergänzung, optionale Outdoor-Evidence/-Orchestration sowie sämtliche unsicheren lokalen Fallbacks bleiben exakt `false`. Käufe werden nicht aktiviert. **Keine Weather-Tabellen oder Grants migrieren.**

## 4. App-Attest-Identität mit dem signierten iPhone-Build abgleichen

| Name | Erforderlicher Wert |
| --- | --- |
| `APP_ATTEST_APP_ID_PREFIX` | Tatsächlicher App-ID-Prefix des signierten Builds, nicht raten; der Repository-Teamwert ist leer |
| `APP_ATTEST_BUNDLE_ID` | Exakte signierte Bundle-ID; die Staging-Konfiguration im Repository verwendet `com.trailmind.app.staging` |
| `APP_ATTEST_ENVIRONMENT` | Passende Entitlement-Umgebung; die Staging-Konfiguration verlangt `production` |
| `APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES` | Freigegebene Apple-Validierungskategorien für diesen Build; vorhandenen Wert mit Integrator abgleichen, nicht pauschal erweitern |
| `APP_ATTEST_ALLOWED_BUNDLE_VERSIONS` | Exakte erlaubte `CFBundleVersion`; Quellstand derzeit `1`, signierten Build prüfen |

Vier dieser Namen existieren bereits in Vercel. Ihre Werte wurden nicht ausgelesen. Die Identitätsprüfung erfordert den Integrator; syntaktisch vorhandene Werte beweisen keine gültige Geräteattestation.

## Danach

Nach Hinterlegung einmal „Production-Werte eingetragen“ melden. Der Backend-Owner prüft Namen/Runtime-Signale, integriert den vorbereiteten Patch und deployt ausschließlich das bestehende Projekt. Erst echte TLS-/DB-Admission und `/readyz` 200 erlauben die zwei freien Abnahme-Prompts. Kein Live-Aufruf zum bloßen Nachweis fehlender Keys; keine automatischen Wiederholungen desselben Fehlers. Jeder Intent-/Research-/Routing-Versuch zählt gegen die Gesamtkappe, einschließlich fehlgeschlagener Versuche.

Aktuell: die einmalige Production-Namensprüfung fand alle drei erforderlichen Secret-Namen noch fehlend. Live-Providerledger: **Gemini 0, GraphHopper 0**. Das bleibt **NO-GO**, bis Runtime-Admission, Auth/App Attest und die echte Route-/Quellen-/Foto-Kette belegt sind. Der unverändert bestehende Deploymentstand ist `016ef5b` / Backend `b1b0b37`; der vorbereitete lokale Code ist `0f92256f3ebd479d90a046f7c2341db8c9b8bc25` / Backend `633d0c58698c677920e8542c46ad7cf8fcaf986b` und ist noch nicht deployed. Lokale Testdetails und Übergabe: `HANDOFF.md` neben dieser Datei.
