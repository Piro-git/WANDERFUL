# Private owner phone testing (not App Attest proof)

This is an isolated development path for the owner's free-signing iPhone. It does
not replace App Attest or enable staging/production. Ordinary builds do not
contain this client. Production startup does not import these operator scripts.

## Current scope

The initial phone path reuses the existing remote `/api/parse-intent` client,
local validated intent/location clarification, `/api/route`, GraphHopper decoder,
and route-quality selector. This enables real LLM intent parsing plus real routing,
not the newer combined `/api/llm-plan-route` phone UI or database-backed research.
The combined endpoint is not exposed by the private operator server. Requested highlights and
conditions remain unverified unless existing evidence actually establishes them.

## Required operator inputs

- Owner-approved GraphHopper and Google/Gemini keys.
- A regular user-owned mode-0600 dotenv file with `AI_PROVIDER=google`,
  `GRAPHHOPPER_API_KEY`, and `GOOGLE_API_KEY`. The private launcher pins
  `GOOGLE_MODEL=gemini-3.8-flash` without fallback. Never paste values into
  chat, shell arguments, source, logs or receipts. Other environment settings are
  not inherited from this file.
- An explicitly approved HTTPS tunnel terminating at `127.0.0.1:48173` on the Mac.
  TLS certificate verification stays enabled on the phone. Do not expose the
  ordinary insecure local development server. The tunnel operator transports
  prompts and route requests; choose/approve it before activation.
- An owner-only mode-0700 temporary directory for `OwnerPhoneTest.json`.

Start only with explicit live-test approval:

```sh
OWNER_PHONE_TEST_ENABLED=true node backend/scripts/start-owner-phone-test.js \
  /absolute/protected/provider.env https://approved-test-host.example/ \
  /absolute/private-session/OwnerPhoneTest.json
```

The server binds **loopback only**. Startup makes no provider calls. It generates
a new random 256-bit owner session token, valid for at most two hours, with 60
weighted request units, at most 30 admitted requests, and one active request.
Replays and exhausted/expired sessions fail. A durable provider ledger in the
same private directory limits the entire shared backend/phone test to **5 Gemini
generations and 10 GraphHopper attempts**, including failed requests and retries.
Reservations are flushed before network access. Restart does not reset counts.
Never change directories or delete the ledger to renew the allowance. An exclusive
lock prevents a second backend process; after a crash, verify the old process is
dead before removing only the stale lock. Access/billing denial stops both
providers immediately; a second rate limit stops further calls. Google requests
use `store=false`, and only the two fixed provider endpoints are permitted.
Coordinate one network-driving task at a time and reserve most calls for the phone.
The JSON contains only test URL, bounded owner token and expiry—never provider keys.

## Phone build and installation

Use the local Debug identity `com.example.owner.wanderful.local` and add
`-D WANDERFUL_OWNER_PHONE_TEST` to **inherited OTHER_SWIFT_FLAGS**. Do not override
Swift package compilation conditions. The client loads `OwnerPhoneTest.json` only
for this explicit local build. Copy it privately into the app before final code
signing, then install the signed app through Xcode/device tooling. Never commit the
file, publish it as a build artifact, or use the owner build for distribution.
The explicit owner-test build uses serial loop admission (maximum concurrency1);
ordinary builds retain their existing concurrency. No production settings or
tracked feature defaults need changing.

The existing installed app is not updated by these source changes. Installation,
TLS reachability, real LLM/GraphHopper success, voice and guidance need actual
device verification. Synthetic tests or compilation do not prove these outcomes.

## End the test

Stop the owner server (which revokes admission) and the tunnel. Remove the private
session file when no longer needed; the bundled token expires regardless. Keep
provider keys only in the owner-approved secure location. Rebuild the ordinary
app without the compilation flag/resource for normal testing. This mode does not
establish paid-developer capabilities, TestFlight or App Store readiness.

## Temporary HTTPS transport

Cloudflare Quick Tunnel is a free, temporary development tunnel and needs no
account. Use the official cloudflared executable with `tunnel --no-autoupdate
--url http://127.0.0.1:48173`; keep its log level at info, never debug.
The random public URL is not authentication: every allowed request still needs
the bounded owner token before parsing. Confirm wrong tokens, unsupported paths,
and valid synthetic requests over HTTPS. Keep the Mac awake and the server/tunnel
running only during the agreed test window; stop both afterward.

References: [Gemini3.8](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[Interactions](https://ai.google.dev/gemini-api/docs/interactions-overview), and
[Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

## Verified private smoke outcome (2026-09-06)

The HTTPS test returned401 for a wrong token,404 for the combined endpoint,
200 for Gemini3.8 intent parsing,409 for replay, and200 for GraphHopper routing.
The synthetic Ilsenburg–Schierke route contained498 geometry points and a real
provider distance of14,398.712m. The first Gemini attempt failed with a sanitized
transport error; one instrumented reproduction succeeded. Total upstream usage
at phone handoff was2 Gemini attempts and1 GraphHopper call, leaving3 and9.
This proves the backend smoke path, not physical-phone UI acceptance. The private
window ends2026-09-06 at12:43UTC; phone results are tracked by the separate iOS task.

The launcher accepts an optional public `OWNER_PHONE_TEST_EXPIRES_AT_MS` deadline
to keep diagnostic restarts inside the agreed window. It cannot exceed two hours.
The credential remains private; safe provider outcome status/code is retained in
the ledger without prompts, coordinates, keys, or response bodies.

## Native research extension readiness (offline preparation)

The optional private server factory accepts `/api/llm-plan-route` only when
`OWNER_PHONE_RESEARCH_TEST_ENABLED=true`, all existing LLM/research/routable-access
provider gates are true, and the existing research repository capability is
injected. This route accepts schema2 only. Schema1 and GraphHopper geocoding remain
unexposed in this owner flow. The outer owner-token verification occurs before
JSON parsing; the integrated engine retains weighted authorization/replay checks.
The client uses Apple location clarification before supplying the full intent and
planningContext contract from the engine change. The factory extension must be
integrated with engine22facaa and its follow-up; this backend branch does not
independently contain that engine implementation.

All internal itinerary-model and routing requests must receive the same
`fetchImpl` from `createOwnerProviderBudget`. The budget now supports smaller
immutable persisted ceilings, e.g. `limits: { google: 2, graphhopper: 2 }` for a
future native acceptance. Its tests cover an initial parse, an itinerary generation,
two concurrent internal routing attempts, exhausted retries and restart attempts
to raise limits. Existing ledgers without explicit ceilings retain the historical
5/10 ceiling. No prior ledger was modified or reset by this preparation.

The command-line launcher now composes the research runtime from a separate private
configuration file. It reads only scoped staging connection settings first, creates
two bounded pools, and runs the existing research executor and V2 candidate planner
before loading provider keys or generating a token. Empty, stale, unsupported,
missing-access, or selector-incompatible candidates stop startup and close pools.

Concrete prerequisites: coordinator's fresh read-only staging query found regions[],
imports0, active entities0 and active projections0; schema and five bounded runtime
functions exist. Real projected Harz highlights and mapped access must be populated
through the existing reviewed pipeline. No fixture can substitute for them.

Existing scoped connection mechanism: `researchDatabaseConfiguration` supplies
bounded pool/query/connection timeouts; distinct research and cancellation pools
feed `PostgresOutdoorResearchRepository`. Its default public-schema queries use
five `trailmind_runtime_outdoor_research_*_v1` functions. Supply only staging-scoped
`OUTDOOR_RESEARCH_DATABASE_URL` and `OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL`
through a separate owner-owned0700 directory/0600 regular environment file read
inside the eventual private runtime. Verify TLS and the actual bounded roles before
use; never retrieve production environment values or place URLs in arguments/logs.
Do not invoke the whole production service lifecycle: it also creates App Attest
pools that this isolated owner path does not need.

Fresh-session proposal after actual data/connection readiness and signed phone
coordination: one native planning submission,30-minute window,2 total Gemini
attempts (parse + selection) and2 total GraphHopper attempts, no automatic retries,
no legacy multi-seed fallback. Use a separately approved new session ledger with
those persisted ceilings; preserve the exhausted historical ledger unchanged.
No session, token, provider request, database connection, migration or import was
created during this offline preparation. A current snapshot/coverage check runs through the existing bounded repository
before provider-key loading and token issuance.

## Runnable native research command

Run from the integrated checkout containing engine3dac767 and the private backend
changes. Arguments contain only placeholder paths/public URL; no secret values:

```sh
OWNER_PHONE_TEST_ENABLED=true OWNER_PHONE_RESEARCH_TEST_ENABLED=true \
node backend/scripts/start-owner-phone-test.js \
  /absolute/private/provider.env https://approved-test.example/ \
  /absolute/private/fresh-session/OwnerPhoneTest.json 48173 \
  /absolute/private/research.env
```

The research env permits exactly `OUTDOOR_RESEARCH_DATABASE_URL`,
`OUTDOOR_RESEARCH_CANCELLATION_DATABASE_URL`, and optional
`OUTDOOR_RESEARCH_CA_FILE` (path to the staging CA certificate). Each file is a
regular owner-owned0600 file in a real owner-owned0700 directory. Provider values
remain in the separate provider env. The loader rejects symlinks, unexpected keys,
non-staging targets, identical users and privileged default login names. URLs must
be direct connections to the verified staging host on5432/postgres, with no query
settings except optional sslmode=verify-full. Direct sessions preserve the backend
PID used by the existing cancellation mechanism; this launcher does not accept
transaction poolers. TLS verification is always enabled; CA override is read from
the protected CA file, never from a URL option.

Both pools have maximum1 connection, bounded connect/statement/query/idle timeouts,
and are distinct. Runtime login metadata must show no superuser, BYPASSRLS,
CREATEDB or CREATEROLE. Cancellation uses the existing scoped function
trailmind_control.cancel_active_outdoor_research_backend_integer(integer); the
control login needs EXECUTE on that function, not research-role membership. No role/grant changes
are made by startup. The repository is injected with runtimeSchema=trailmind_app.

Readiness uses the real15km Ilsenburg/viewpoint intent, current clock, existing
consistent read-only snapshot executor, source/freshness checks, mapped access
resolver and V2 proposal validator. It requires sourced highlight/access records
and at least one ready/partial proposal compatible with the selector's1–3-stop
limit and evidence/reason fields. This establishes data availability, not route
quality or access guarantees; real routing remains separately bounded.

The native session defaults to30minutes and persistent2Gemini/2GraphHopper ceilings.
An explicit earlier OWNER_PHONE_TEST_EXPIRES_AT_MS deadline is supported. Failure
before or after binding closes owned pools/server and releases the exclusive budget
lock. Successful shutdown revokes admission and closes all owned resources.
Validation used synthetic files/injected pools, including the real executor's empty
snapshot path; no current scoped credentials, live data or provider calls were used.

## Explicit task-owned Unix-socket pilot mode

The same private research-config argument can select the exact isolated local
pilot reserved by the engine task. Its file contains only:

```dotenv
OWNER_RESEARCH_TRANSPORT=owner-local-unix
OWNER_RESEARCH_LOCAL_SOCKET=/private/tmp/wf-ilsenburg-local-iSXL9g/socket
```

This path is pinned in code, not a general local/hostname override. Root and socket
directory must be real owner-owned0700 directories; the socket must be owned by
the same UID. Database wanderful_local_pilot, port55439 and the distinct roles
outdoor_research_runtime_role/outdoor_research_cancellation_control_role are fixed.
The bootstrap uses peer authentication; this runtime supplies no password and does
not fall back to environment/password files. SSL is off only for this Unix socket;
staging remains exact-host/verified-TLS and rejects local URL overrides.

After connecting, each local pool checks the exact database/socket directory and
empty listen_addresses and inet_server_addr() IS NULL. The directory/socket
binding is checked again without reading privileged unix_socket_directories. Existing
role flags, scoped cancellation function permission, max1 pools, query deadlines, trailmind_app
schema, real source/place/access readiness and persistent2/2 provider limits are
unchanged. Failure closes both pools before provider keys/token issuance. The
engine task alone owns bootstrap/import; this change neither creates nor starts a
database. If that exact pilot path is retired, this mode fails closed.

The private runtime cancellation option requires the corresponding repository
allowlist change from the engine task; integrate both before activation. The
legacy direct pg_cancel_backend default remains for other callers. No broad role
membership or pg_read_all_settings grant is needed for the private runtime.
