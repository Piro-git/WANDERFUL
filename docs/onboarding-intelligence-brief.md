# Onboarding Intelligence Brief — Hiking Intelligence V1

The current route request always wins. Profile values are optional defaults or requested preferences only; they never create safety, access, legality, difficulty, or scenic facts.

## Initial onboarding

| Question | User problem | Typed field | Role | Planning use today | Missing answer | Privacy |
| --- | --- | --- | --- | --- | --- | --- |
| “What sounds like you most days?” | Avoids repeatedly naming the activity | `defaultActivity` | Contextual default | Fills an omitted activity through the local planner adapter; also improves the example route | Remains `nil`; the engine keeps its existing fallback | Low |
| “What feels like a comfortable day?” | Gives a useful scale without asking for fitness or health data | `comfortableOuting` as a distance or duration range | Contextual default | Can fill an omitted distance/time; a range-to-single-target conversion emits a typed information-loss gap | Remains `nil`; existing parser/engine behavior applies | Low |
| “Which route shape do you usually enjoy?” | Reduces loop-versus-point-to-point setup | `preferredRouteShape` | Preference/default | Can fill an omitted route shape; point-to-point without a destination emits a typed gap | Remains `nil` | Low |
| “Anything you would rather avoid?” | Lets users express route-shaping discomfort in plain language | `softAvoidances` | Soft preference, never a safety guarantee | Maps steep climbs, major roads, and repeated sections to existing typed avoidances | `nil` means unknown; `[]` means explicitly none | Moderate because it can imply comfort, so copy stays non-medical |
| “Show me more of…” | Captures the desired character of a trip | `requestedExperiences` | Requested preference | Viewpoints, forest, and quiet nature map to existing requested-feature fields; unsupported values remain typed gaps | `nil` means unknown; `[]` means explicitly none | Low |
| “Here is your Trail Profile” | Makes stored defaults visible and correctable | the full versioned profile | Editable user control | Shows only selected values and identifies them as preferences/defaults | Unknown fields are called out as “Not set” and can be edited later | Low |

Every substantive choice screen has a full-width “I don’t know yet” action. Skipping removes that field from the draft rather than substituting a default. Collection screens also expose an explicit “None” choice, so an empty preference list is not confused with an unknown answer.

## Deferred progressive profiling

These questions are useful only when the current route or a later product capability makes them relevant:

- Terrain and technical comfort: ask when a route has verified surface/path/exposure evidence. Self-report must never be treated as a safety fact.
- Comfortable ascent: ask alongside an elevation-aware request, then retain a bounded range only if the planning contract can use it explicitly.
- Must-have versus nice-to-have: ask when the evidence/ranking layer can distinguish and explain the two without implying verification.
- Company and group context: ask for family, children, dog, or accessibility needs only in the relevant route session; avoid persisting sensitive inferences by default.
- Coarse planning region: optional profile edit or first-route prompt. Never require or store an exact home location.
- Typical use case and multi-day interest: ask after first-route value or when multi-day planning is actually available.
- Post-route feedback: ask whether the outing felt too short/long or too demanding after completion, not during first-run onboarding.

## Deterministic precedence

For each field independently:

1. Explicit current request
2. Compatible profile default
3. Existing engine fallback
4. Absent

An explicit “no preference” suppresses the stored preference. Unsupported or lossy mappings are returned as typed gaps; the adapter does not geocode, route, perform network work, or alter route-quality thresholds.

Explicitness is captured from the raw request before the local parser applies its hiking or loop-distance defaults. The adapted typed intent is shared by standard routing and the existing research-intent adapter; all tracked research/evidence feature flags remain disabled.

## Trust boundary

- Requested experiences stay requested until evidence verifies them.
- Avoidances are route-shaping preferences, not guarantees.
- No demographics, health data, precise home location, prompt history, or coordinates are collected.
- Onboarding completes locally without an account or network.
- The canonical profile is saved before completion. Legacy nonoptional route defaults are never populated from skipped profile fields; reset and deletion clear the old route-compatibility fields deterministically.
- Corrupt or future local records fail closed and expose an explicit discard-and-recreate path.
- Remote profile sync is non-activatable in V1. The app neither starts anonymous Auth nor sends profile upserts/deletions, so reset and deletion are local-only and cannot silently fail or resurrect a remote row.
- Native local onboarding is the only V1 first-run path. Superwall is neither configured nor presented by this flow before first product value.
- Analytics consent is separate from personalization; V1 sends no onboarding events by default.
