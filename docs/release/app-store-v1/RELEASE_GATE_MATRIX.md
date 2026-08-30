# Release gate matrix V1

Assessment date: 2026-08-30

Audited base: `adea2c08540e87f0acd7eebb976c72eab8eb76c3`

Current TestFlight decision: **NO-GO**

Current public App Store decision: **NO-GO**

| Gate | Evidence | State | Required next action |
| --- | --- | --- | --- |
| Shipping identity | Wanderful, `com.trailmind.app`, `1.0 (1)`, iPhone, iOS 26.0, portrait | Passed | Confirm build number is unused |
| App icon | Universal 1024×1024 source, no alpha; Release artifact contract passed | Passed | Capture final screenshots from signed build |
| Release feature flags | All nine protected flags are exactly `false` | Passed | Keep unchanged for V1 |
| Service configuration | Backend, Supabase, and Superwall values are empty | Correct fail-closed state, but routing blocked | Configure only the owner-approved production routing gateway |
| Core point-to-point/loop implementation | Deterministic unit/UI coverage passed | Passed locally | Verify exact Release against production routing |
| Release copy/trust | Developer guidance and “live/real route” overclaims removed; regressions added | Passed | Keep claim ledger aligned |
| Permissions | Only Microphone and Speech usage strings; no Location permission | Passed | Physical-test voice if marketed |
| App Attest source | Release entitlement is `production`; manifest declares Device ID | Passed at source/archive level | Match capability/profile during signing |
| Research/evidence | Research, evidence, routable highlight, and remote intent flags off | Passed / intentionally unavailable | Not a V1 blocker |
| Supabase | Profile sync off; no-op production path; no account | Passed / intentionally unavailable | Not a V1 blocker |
| Superwall | Flag off, key empty, native onboarding; SDK manifest remains embedded | Passed functionally; privacy owner review open | Reconcile Purchase History declaration |
| Privacy manifests | First-party, Superwall, and swift-crypto manifests embedded and valid | Passed | Review Xcode privacy report for signed archive |
| Native privacy/help | Complete native destinations; external URL slots fail closed | Passed | Publish/configure public URLs before App Review |
| Attribution | GraphHopper, OSM/ODbL, and Mapterhorn boundaries present | Passed | Recheck exact signed build |
| Unit tests | 710/710 deterministic tests passed | Passed | Rerun after routing/signing configuration change |
| Critical UI tests | 9/9 selected flows passed | Passed | Rerun on final Release build |
| Debug Simulator build | Built successfully | Passed | None |
| Release Simulator build/launch | Built and launched on iPhone 17 Pro iOS 26.5 | Passed | None |
| Manual Release QA | Home/Profile/privacy/help/safe routing error visually reviewed | Passed for current fail-closed configuration | Repeat successful route path after endpoint configuration |
| Release artifact verifier | 43/43 artifact checks; 46 self-test cases plus stale recovery | Passed | Run signed-archive mode on final archive |
| Unsigned generic-iOS archive | arm64 app, dSYM, privacy manifests, and store bundle validation passed | Passed diagnostic | Does not substitute for distribution signing |
| Apple team/signing | `DEVELOPMENT_TEAM` is empty; no private signing inspection authorized | Blocked | Owner selects team/profile and creates signed archive |
| Production core routing | Current Release intentionally cannot route | Blocked | Owner configures and verifies GraphHopper gateway |
| Physical iPhone | No device available through configured workflow | Follow-up | Smoke-test signed build if available; not a standalone App Attest blocker |
| Public privacy/support URLs | Release values empty | App Store blocker | Publish and configure canonical HTTPS pages |
| App Privacy | Conservative draft prepared | App Store blocker | Owner/legal finalize against production retention and embedded manifests |
| App Store Connect/legal | Record, SKU, legal entity, rights, rating, export, storefronts unknown | App Store blocker | Owner supplies decisions |
| Screenshots | Capture plan exists; final signed-build assets not captured | App Store blocker | Capture truthful final screenshots |
| Upload/submission authority | Not granted | Blocked by scope | Owner explicitly authorizes each action |

## Readiness summary

The repository’s iOS code, configuration contract, deterministic tests, Release simulator artifact, and unsigned device archive are in good local condition. TestFlight remains blocked only by the missing functional production routing configuration, distribution signing inputs, and explicit upload authority. Public App Review has the additional owner/legal/privacy/public-asset gates listed above.

Research/evidence rollout, Supabase staging, and physical App Attest proof are not counted as V1 blockers in this matrix.
