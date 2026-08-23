# App Review Notes V1

Status: **source-final for integrated onboarding; selected-build/backend facts remain provisional**
Reviewer credentials: **not applicable; the integrated V1 source creates no account or sign-in**

## Draft notes for App Review

Wanderful is an iPhone route-planning app for hiking, trail running and biking. It is a planning aid, not live or turn-by-turn navigation.

Suggested review path after the final build is selected:

1. Launch Wanderful on an iPhone running iOS 26 or later.
2. Complete the native onboarding path. Answers are optional planning defaults stored only on the iPhone and can later be edited, reset or deleted from Profile.
3. Open Plan and enter a deterministic route request supplied in the final review notes.
4. Generate route options, compare mapped geometry and route statistics, then open one detail view.
5. Save the routed result, open Saved, and use Export GPX to present the system share sheet.
6. If voice is included in the selected build, test it only after granting Microphone and Speech Recognition permission. Voice must be omitted from these notes if Stage B/physical-device proof does not pass.

No demo account or bypass credential is required by the integrated V1 source. If the selected build later adds authentication, these notes must be replaced and the release owner must provide a durable review account and any special instructions in App Store Connect—not in this repository.

## Provider and processing boundaries

- The full natural-language prompt is parsed locally in Release; no remote AI chat or route editing is offered.
- User-entered place names are resolved using Apple geocoding.
- Route coordinates and selected routing constraints are sent to Wanderful's configured backend, which requests route calculation from GraphHopper.
- Map display uses Apple MapKit. Routing data is credited to GraphHopper/OpenStreetMap; elevation credits include Mapterhorn where applicable.
- Research-guided planning, outdoor-evidence lookup and routable-highlight access are disabled by tracked Release defaults. Do not describe those capabilities as available.
- The Trail Profile and onboarding draft stay on the device. Supabase onboarding sync is disabled and non-activatable in V1; no account is created.
- Superwall remains a linked SDK dependency, but V1 production onboarding does not construct or present its client and the tracked key is empty. No purchase or subscription surface is claimed.
- Production availability, App Attest enforcement and backend retention must be inserted here only after verified evidence. Blocker `ASV1-011`.

## Safety and limitations

Wanderful does not guarantee that a route is safe, legal, open, passable, scenic or supplied with water. Route statistics are routing-response estimates. Requested preferences are not verified facts unless supported by mapped evidence. Reviewers and users should review the route and check current weather, access restrictions, trail conditions, local rules and water availability before starting.

The V1 build does not offer:

- live/turn-by-turn navigation or location tracking;
- offline maps or offline route calculation;
- live weather, closures, water or trail-condition intelligence;
- guaranteed scenic quality, safety, legality or access;
- remote AI chat or natural-language route editing;
- a proved subscription or purchase offering;
- national/global evidence coverage.

## Permission behavior

- Wanderful does not request device Location permission on the audited baseline. Users enter a place name manually.
- Microphone and Speech Recognition are requested only when the user invokes voice transcription. Apple servers process speech recognition; Wanderful's current disclosures say it does not retain raw audio or send raw audio to its backend.
- Denial must leave typed planning available and must not trap the reviewer. Stage B verifies the exact behavior.

## Account, onboarding and monetization boundary

- First launch presents native onboarding after local profile state loads.
- The user may leave planning defaults unknown. Completion persists a local versioned Trail Profile and removes the resumable draft.
- Profile provides edit, reset and delete actions. Deletion covers the local Trail Profile/draft; no remote account or profile exists in V1.
- Supabase remote sync/Auth code is dormant and cannot be composed by V1 bundle configuration.
- No Superwall presentation, paywall, purchase, subscription or review credential is source-reachable in V1. Built-product inspection and the owner's explicit V1 monetization decision remain stop gates (`ASV1-003`, `ASV1-013`).

## Final review-note attachments/checks

- Provide a real support contact and privacy-policy URL.
- State the selected build number and deterministic request/expected state.
- Explain any backend maintenance window or region restriction truthfully.
- If Navigation remains the primary category, confirm whether Apple requests a geographic coverage file and provide it only from real coverage evidence.
- Never provide production keys, internal credentials, secrets, source receipts or unsupported claims.

Apple expects review access and clear explanations for non-obvious features and requires complete, accurate information. Source: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
