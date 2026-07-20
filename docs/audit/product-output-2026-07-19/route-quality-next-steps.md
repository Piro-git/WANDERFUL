# TrailMind route-output audit — 2026-07-19

## Audit scope

- Surface: route-comparison output after a free-form German hiking request.
- User goal: receive an easy, attractive group hike in the Alps.
- Evidence: `01-route-results-alpen.png`.

## Step 1 — Route results

Health: **routing works, geographic intent is incorrect**.

### Strengths

- The app returns three real routed alternatives rather than fabricated geometry.
- It distinguishes requested preferences from verified route facts.
- Distance-to-target and route provenance are visible.

### Highest-impact risks

1. “in den Alpen” was resolved to Alpen, North Rhine-Westphalia. The card itself proves the mismatch through the `ALPEN` label and “around Alpen” title.
2. A broad region is treated as a routable start point instead of prompting for a specific Alpine area or offering candidate regions.
3. “Views” and “quiet route” remain requested-only because no verified POI or trail-quality layer shapes or scores the route.
4. The flexible-mode fallback produces valid geometry, but route quality is currently driven mainly by distance and elevation—not official hiking networks, trail difficulty, surface, road exposure, or verified highlights.

## Recommended product sequence

1. Geographic intent resolution and clarification.
2. OSM-backed trail/POI index for one launch region.
3. POI-aware waypoint generation and route scoring.
4. Route explanations based only on verified evidence.
5. Opt-in feedback/popularity signals after the core quality model is measurable.

## Evidence limits

- One screenshot confirms the incorrect place resolution and current copy, but not the complete interaction flow, VoiceOver behavior, or every generated route's trail composition.
- Route safety, legality, trail condition, and scenic quality cannot be verified from the screenshot alone.
