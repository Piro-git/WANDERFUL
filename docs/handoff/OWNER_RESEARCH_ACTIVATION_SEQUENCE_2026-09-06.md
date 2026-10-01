# Owner research activation sequence — prepared, not executed

Readiness observation at 16:25 Berlin: Owner remains connected; passcodeRequired
is true. Installed source remains5073b4c (local checklist, no token). Integration
sourcec969dd7 includes dormant owner research wiring5bcc0a2. Cached device app
has no OwnerPhoneTest.json. Approximately630MiB free; no build attempted here.

## Deadlines

Native schema2 /api/llm-plan-route delegates to outdoorAdventureEndpoint and the
V2 orchestrator. OUTDOOR_RESEARCH_PLANNING_TOTAL_TIMEOUT_MS defaults25000 and
can otherwise be configured up to45000. Keep it at25000 or less for this phone
session. Native client request timeout is30s; PlannerViewModel wraps research
with45s. Five seconds nominal HTTP overhead margin is not a network guarantee.
The native setting is distinct from legacy LLM_FIRST_PLANNING_TOTAL_TIMEOUT_MS.
The selector4s, research7.5s, and GH-attempt8s defaults remain constrained by the
shared25s total; worst-case work may time out before a second route completes.
Initial intent parse22s and Apple geocoding15s are separate client stages.

## One final activation sequence

1. Coordinator/backend signs off actual reviewed pilot place/source/access data,
   native schema2 runtime, exact <=25s server deadline, fresh aggregate budget
   (proposed at most2Gemini/2GH), public HTTPS endpoint, expiry and shutdown owner.
   No live provider request is implied by this document.
2. Recheck available space and absence of another build. Reuse retained cache,
   arm64 and existing teamREDACTED-TEAM-ID / bundlecom.example.owner.wanderful.local.
   Keep DEBUG and inherited OTHER_SWIFT_FLAGS; append only existing
   -D WANDERFUL_OWNER_PHONE_TEST. Supply command-line
   RESEARCH_GUIDED_PLANNING_ENABLED=true and
   ROUTABLE_HIGHLIGHT_ACCESS_ENABLED=true. Do not alter production configuration,
   other capability flags, or Swift package compilation conditions.
3. Compile/sign first WITHOUT a credential. A failed build must not consume the
   token window. Verify final Info.plist local identity and exact two true flags.
   Owner research still fails closed until a valid private resource is present.
4. Only after successful build and session authorization, obtain the backend's
   fresh OwnerPhoneTest.json PATH, public URL, expiry and remaining counts.
   Validate strict three keys, exact approved URL, HTTPS and bounded unexpired
   token shape in memory, without outputting token or reading provider env files.
   Copy that resource directly into the finished app bundle, then re-sign with
   the existing identity preserving identifier/entitlements/requirements and
   verify the final signature. Scan resources without printing matched values.
5. Do not run another build between resource injection and installation. No
   project build phase owns this private JSON; a later build may leave it stale
   or replace/remove it. Always revalidate/reinject and re-sign after any rebuild.
6. Unlock phone when needed; install as an update (no uninstall/data erasure).
   Ensure the prior app process has exited and launch a fresh process. The app
   snapshot and factory instances are initialized at startup; do not expect a
   running old process to adopt new flags/resource. The signed bundled resource
   survives ordinary relaunch but still expires; authorizer checks expiry on
   every request and does not renew it.
7. Confirm no competing provider actor. Submit exactly one agreed synthetic
   prompt; record sourced stops, measured geometry/stats and preference/distance
   explanation. No automatic retries, microphone or actual location action.
   Coordinate counters after outcome and stop immediately on auth/rate/billing
   failure. Notify backend to revoke and shut down, or use its fixed deadline.

Neither current source readiness nor successful mocked tests prove data readiness
or a working live researched route. No activation action was executed here.
