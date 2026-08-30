# App Review notes V1

Status: **draft; use only after production routing works in the exact submitted build**

Reviewer credentials: **Not required. Wanderful V1 has no account or sign-in.**

## Draft review notes

Wanderful is an iPhone route-planning app for hiking, trail running, and biking. It is a planning aid, not live or turn-by-turn navigation.

Suggested review path:

1. Launch Wanderful on an iPhone running iOS 26 or later.
2. Complete or skip through native onboarding. Optional planning defaults are stored only on the iPhone and can be edited, reset, or deleted from Profile.
3. Open Plan, choose Type instead, and enter `Ilsenburg to Schierke`.
4. Build the route, compare mapped options and routing-response statistics, then open route detail.
5. Save the routed result, open Saved, and use Export GPX to present the system share sheet. A share destination does not need to be selected.
6. Open Profile → Privacy & data and Profile → Help & safety to review data and outdoor-planning boundaries.

Replace the deterministic request before submission if final production routing no longer supports it. Never submit a build whose core request ends in the current safe “couldn’t finish” state.

## Provider and feature boundaries

- The full typed prompt is parsed locally; V1 has no remote AI chat or route editing.
- Apple geocoding resolves typed place names.
- Resolved coordinates and selected constraints go through Wanderful’s production routing gateway to GraphHopper.
- Map display uses Apple MapKit. In-app attribution credits GraphHopper, OpenStreetMap/ODbL, and Mapterhorn where applicable.
- Research-guided planning, outdoor evidence, routable highlights, remote intent, Supabase sync, and Superwall presentation are disabled.
- Trail Profile and saved routes remain local. No account is created.
- V1 contains no purchase, paywall, or subscription surface.

## Safety boundary

Wanderful does not guarantee that a route is safe, legal, open, passable, scenic, or supplied with water. Route statistics are routing-response estimates. Requested preferences remain preferences unless verified by mapped evidence. Users should review routes and check current weather, access restrictions, trail conditions, closures, local rules, and water availability before starting.

V1 does not offer live navigation, offline maps, live weather/closure/water intelligence, location tracking, remote AI planning, accounts/cloud sync, or purchases.

## Permissions

- V1 does not request device Location permission. Users enter a place name.
- Microphone and Speech Recognition are requested only if the user chooses optional voice transcription.
- Apple Speech may process captured audio. Wanderful does not retain raw audio or send it to its backend.
- Denial leaves typed planning available.

Omit voice from review notes and screenshots unless the final signed build receives a physical-iPhone permission smoke test.

## Final owner insertions

Before using these notes, add:

- selected version/build;
- production service region or maintenance limitation, if any;
- working support contact and privacy-policy URL;
- any required export-compliance note;
- any information Apple specifically requests for the Navigation category.

Do not include production keys, private credentials, internal receipts, or unsupported claims.
