# TrailMind App Store screenshot plan

Status: capture plan only; no approved release screenshots exist
Evidence date: 2026-07-17

## Format and device scope

TrailMind's beta target is iPhone only and portrait only. Capture the highest-resolution required iPhone portrait set supported by the final App Store Connect record. Apple's current specifications permit one to ten screenshots and list accepted 6.9-inch portrait sizes, including `1260 × 2736`, `1290 × 2796`, and `1320 × 2868` depending on device.

Authoritative references:

- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots)

Do not prepare iPad or landscape screenshots for this beta. Use `.png`, `.jpg`, or `.jpeg` with no alpha, following the current App Store Connect requirements at upload time.

## Capture prerequisites

- Exact signed Release/TestFlight candidate identified by commit and build.
- Production backend and App Attest working on the capture iPhone.
- Protected live baselines passed.
- Every shown route is a real, verified provider result.
- Public, non-sensitive example place names are approved.
- Light appearance selected, matching the declared beta surface.
- No permission alert, debug overlay, test fixture, developer endpoint, token, personal notification, or private location is visible.
- Metadata copy is frozen and traceable.

## Recommended sequence

| Order | Screen | What to show | Caption draft | Truth gate |
|---:|---|---|---|---|
| 1 | Home | Calm Plan home with real example prompts and the text/voice entry choices | `Describe the route you want` | No fake recent or unsupported promise |
| 2 | Composer | A public same-day route prompt with start, activity, and distance/time | `Plan naturally in your own words` | Prompt supported by the Release local parser |
| 3 | Suggestions | Two or three verified loop alternatives with route-shape thumbnails and measured deltas | `Compare real mapped options` | Exact live route-quality evidence and no invented labels |
| 4 | Route detail map | Route geometry, public start/end, distance, duration, and elevation | `Review the route before you go` | Provenance verified; no location/safety guarantee |
| 5 | Planning context | Requested preferences separated from verified mapped characteristics and safety note | `Preferences stay separate from facts` | Every “verified” chip backed by route response data |
| 6 | Saved | A real saved verified route and deletion affordance | `Keep verified plans on your iPhone` | Persistence/relaunch/backup-exclusion proof complete |
| 7 | GPX/About | Prefer About with provider credits and planning boundary; use GPX only if handoff is visually clear | `Share GPX when you're ready` or `Know what TrailMind does` | Third-party GPX import proof for GPX caption |

Use five or six strongest screens if the seventh adds clutter. The opening three must communicate the actual critical path: describe → compare → review.

## Overlay rules

- Overlays may describe implemented behavior but must not alter route facts in the captured UI.
- Do not cover MapKit/attribution, safety disclosures, or important controls.
- Do not use “AI,” “navigation,” “safe,” “scenic,” “near you,” “offline,” or “live conditions.”
- Do not imply all requests return three options.
- Do not add unverified elevation, distance, place, feature, or match-score text.
- Preserve an honest iPhone frame/status presentation and avoid competitor trade dress.

## Capture record

Create one record per asset:

| Field | Value |
|---|---|
| Screenshot filename | **[UNRESOLVED]** |
| App version/build | **[UNRESOLVED]** |
| Git commit | **[UNRESOLVED]** |
| iPhone/OS | **[UNRESOLVED]** |
| Prompt | **[UNRESOLVED]** |
| Route ID/provider evidence | **[UNRESOLVED]** |
| Capture date/operator | **[UNRESOLVED]** |
| Overlay copy | **[UNRESOLVED]** |
| Privacy review | **[UNRESOLVED]** |
| Product/legal approval | **[UNRESOLVED]** |

## Localization

The development region is English, but current geocoding failures and routing instructions can be German and unqualified searches are Germany-biased. Do not capture a general English-market set until that behavior is resolved, or a Germany-first mixed-language beta is explicitly approved and represented truthfully. Do not upload German-localized screenshots merely because the parser recognizes German prompts. Add localized sets only after the full UI, metadata, permissions, safety copy, and support/privacy pages are localized and reviewed.

## Rejection criteria

Reject and recapture any asset that contains:

- mock/demo/unverified route content presented as real;
- a Debug-only surface;
- unsupported controls or claims;
- exact personal/home coordinates or personal saved-route history;
- an unreadable safety boundary or provider attribution;
- clipping, inaccessible text, loading/error state, or stale backend data;
- a build other than the selected candidate.
