# Second diagnostic attempt — completed, distance-limit rejection established

The second session and tunnel were explicitly stopped after the result; no route-server or tunnel-metrics listener remained by 15:49:26 CEST, before the 15:50:45 session deadline. Final durable counters: Google 1/1, GraphHopper 0/2, no rate-limit events. No third session or retry was started.

At 15:44:11 CEST, Google and authenticated parse-intent returned HTTP 200. At 15:44:20 CEST, authenticated /api/route returned HTTP 400, code invalid_request, validationReason distance_limit. Thus the submitted points cumulatively exceeded the backend's 200 km straight-line limit. The owner's screenshot shows the exact approved Berlin prompt and the generic failure. Neither the actual points nor the raw intent/body were extracted; which endpoint or location-resolution stage was wrong remains unknown. No real route or Start succeeded.

Local repair now prevents point-to-point destination auto-acceptance beyond that same limit, requests location clarification, and checks manually selected endpoints before routing. The planner gives a specific correction message instead of sending an unsupported pair. Backend limits are unchanged and loop behavior is untouched. Build and 54 targeted location/geocoder/planner tests passed, including a manually selected far endpoint never reaching the router and a nearby Berlin selection reaching it with the full query context. This is a verified guard/recovery repair, not proof that automatic Berlin route generation is restored.

The new repair has NOT been installed on the physical iPhone. Its last verified install remains compiled source 826bfc7 with the second, now-ended session resource (installed/started at 15:41 CEST). See DISTANCE_LIMIT_REPAIR.md for source-path analysis, tests and remaining uncertainty.

## Historical second-session installation

Update at 15:41 CEST: the owner directly approved embedding the temporary session token and freed disk space (1.7 GiB observed). The fresh resource copy succeeded; re-signing with the same Apple Development identity succeeded; full signature verification with access to the system trust store succeeded. Data-preserving installation completed (database sequence 5584) and the app launched at 15:41:28 CEST. The compiled production iOS source remains 826bfc7, with this second session resource; backend diagnostics are a5e4e7c. The owner has now been asked to send the single approved Berlin prompt, respecting online consent, and report the result without retrying. Same original second-session expiry: 15:50:45.029 CEST. Before the request, counters were Google 0, GraphHopper 0. No timer or budget was reset.

## Earlier installation blockers (resolved)

Current status supersedes the historical preflight below. Device reconnected and app access succeeded at 15:20 CEST.

- Session 2 started at 2026-09-14 13:20:45.029 UTC / 15:20:45.029 CEST. Expires at 13:50:45.029 UTC / 15:50:45.029 CEST. No renewal/reset.
- Second tunnel operator directory created at 13:20:19.299 UTC; wrapper enforces a 40-minute maximum. Assigned origin pinned to https://educated-favourites-collar-nomination.trycloudflare.com/.
- Durable counters remain Google 0/1 and GraphHopper 0/2. Unauthenticated HTTPS route request returned 401.
- The first resource-copy and signing commands encountered disk exhaustion. A subsequent command in the same compound shell call nevertheless reported app installation success; this does NOT prove installation of the fresh session. No second prompt has been requested yet. The retry will use separate checked operations.
- Cleared only this task's regenerable module/index/Swift and package caches; preserved compiled app products and test receipts. Mac free space remains volatile and repeatedly falls near zero, including a failed attempt to save this report.
- Automatic approval review rejected the explicit fresh-session resource copy because it could not verify permission to embed the credential in the app. No workaround was performed. A narrow direct confirmation for embedding ONLY this expiring session token was requested; provider keys remain server-only. Existing read-thread results contain no messages, and the bounded local approval lookup supplied no usable direct approval evidence.
- Await the specific embedding confirmation while retaining this SAME session and its expiry/counters. If approval/device/storage readiness arrives too late, stop without creating a third attempt. No new live typed error or successful route/Start evidence exists.

## Historical preflight at 13:19 UTC / 15:19 CEST

**Not started. The actual blocker is the unavailable physical iPhone, not missing approval.** The second bounded authorization remains valid and has not been consumed or duplicated.

| Item | Status |
| --- | --- |
| Session 2 start / expiry / shutdown | None: no session was created or started. |
| Tunnel 2 start / expiry / shutdown | None: no tunnel was created or started. |
| Google attempts for attempt 2 | 0 of at most 1; no provider traffic initiated. |
| GraphHopper attempts for attempt 2 | 0 of at most 2; no provider traffic initiated. |
| Second-attempt artifacts | Both /private/tmp/wanderful-phone-session-20260914-second and /private/tmp/wanderful-phone-tunnel-20260914-second are absent. |
| Route server | No listener on 127.0.0.1:48173. |
| Second app install | Not performed; no fresh session exists to embed. |
| Last confirmed physical install | First-attempt same-ID update, source 826bfc7, launched at 13:46 CEST on 2026-09-14. Current installation cannot be rechecked while the phone is unavailable. |
| Second live typed error/category | None yet; original live HTTP 400 cause remains unknown. |

Latest device check: `devicectl device info apps` for the known Owner iPhone UUID REDACTED-DEVICE-ID returns CoreDevice error 1011, unable to locate the device. The preceding discovery listed the same paired device as unavailable. The owner has already been asked to reconnect by cable and unlock it; no additional approval or key/credit question is required.

Preparation completed: existing valid Apple Development signing identity located; existing compiled iPhone product has the approved bundle ID and team; approximately 1.7 GiB free at preparation time. No production iOS code changed, so only a new expiring session resource and re-signing are needed once device readiness is confirmed. Backend a5e4e7c includes safe HTTP-parser/route-validation diagnostics; 45 targeted tests pass. Earlier Swift→HTTP→mock provider→Swift decoding passed; the original adapter separately accepted the Swift-encoded synthetic standard and alternative requests. These offline results do not establish the original phone failure's cause.

Next authorized action: recheck device connectivity; once reachable, start the single second tunnel/session, embed its fresh credential, re-sign and data-preservingly update the same app ID, then request the one approved Berlin input on the phone. Preserve the second-attempt limits and stop at completion/deadline. Do not start clocks while device access is blocked.
