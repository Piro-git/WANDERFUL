# Release Gate Matrix V1

Baseline: `009c5aa52f7feb386335c7aeb0c2f1e85ec7a7fd`
Assessment date: 2026-08-26
Public-release decision: **NO-GO**

## Classification vocabulary

- **proved** — the narrowly stated gate has current, exact evidence.
- **locally actionable** — can be completed locally after the Stage B coordination gate.
- **onboarding-dependent** — cannot be finalized before the active onboarding integration report/commit.
- **physical-device** — requires a real iPhone; Simulator proof is invalid.
- **Apple-account** — requires paid-team, signing, TestFlight or App Store Connect authority.
- **public-URL/legal** — requires a real public asset, legal declaration or owner decision.
- **blocked** — evidence cannot be obtained in the present stage or authority boundary.

## Completion

Exactly 24 of 50 applicable gates are proved: **48.0%**. A grouped row counts as one gate. Simulator or generic-device-build evidence does not complete an archive, physical-device, signed-distribution or external gate.

| Gate | Requirement | Classification | Current evidence or acceptance criterion | Blocker |
| --- | --- | --- | --- | --- |
| G-001 | Baseline, clean shared checkout and duplicate gate | proved | Reviewed integrated verifier source is exact reachable commit `009c5aa52f7feb386335c7aeb0c2f1e85ec7a7fd`; shared checkout was preserved | — |
| G-002 | Shipping display name | proved | `Configuration/TrailMind-Info.plist`: `CFBundleDisplayName = Wanderful` | — |
| G-003 | Bundle ID and version/build source settings | proved | `project.pbxproj`: `com.trailmind.app`, `1.0`, `1` | — |
| G-004 | Platform source settings | proved | iPhone family `1`, minimum iOS `26.0`, portrait, Catalyst disabled | — |
| G-005 | Launch appearance is complete and release-polished | locally actionable | Manual Dark Mode inspection proved `.preferredColorScheme(.light)` forces a light app; UI-wide dark appearance is not release-proved | ASV1-027 |
| G-006 | App icon source asset exists | proved | One universal 1024×1024 PNG declared in AppIcon asset catalog | — |
| G-007 | Compiled icon variants are opaque and accepted | proved | Source is 1024×1024 RGB/no alpha; rebuilt Release has phone icon variants with uniform alpha 255 and compiled AppIcon `Opaque=true`; verifier passes | — |
| G-008 | Active Apple Developer Program team/legal entity | Apple-account | Owner supplies verified team/legal entity and current agreements | ASV1-006 |
| G-009 | Explicit App IDs and App Attest capability | Apple-account | Developer portal identifiers must exactly match `com.trailmind.app.staging` and `com.trailmind.app`, both with App Attest enabled | ASV1-006 |
| G-010 | Distribution certificate and App Store profile | Apple-account | Current Apple Distribution identity and App Store profile match team, ID and entitlement | ASV1-006 |
| G-011 | Debug/Staging/Release App Attest source mapping | proved | Debug entitlement is `development`; Staging and Release entitlements are `production`; processed environment identity agrees | — |
| G-012 | Production App Attest proof | physical-device | Complete `APP_ATTEST_PHYSICAL_DEVICE_PROOF_V1.md` on real iPhone/TestFlight build | ASV1-010 |
| G-013 | Production backend availability and release compatibility | blocked | Prove approved URL availability, retention, rate limiting, route contract and App Attest enforcement without relying on historical receipts | ASV1-011 |
| G-014 | Tracked iOS feature defaults | proved | All nine protected feature flags are exactly `false` in Debug/Staging/Release; backend, Supabase and Superwall values are empty | — |
| G-015 | Deployed backend/provider feature defaults | blocked | Deployment owner proves route availability and all research/evidence/provider defaults for the release environment | ASV1-011 |
| G-016 | First-party privacy manifest source | proved | Tracking false; linked Device ID for app functionality; approved reasons `C617.1` and `CA92.1` | — |
| G-017 | Embedded third-party privacy manifests/signatures | proved | Rebuilt Debug/Release contain valid first-party, Superwall and swift-crypto manifests; no dynamic Frameworks are embedded; deep signature verification passes | — |
| G-018 | Final App Privacy questionnaire | blocked | iOS onboarding and selected-Release SDK manifests are reconciled; backend/App Attest retention, owner SDK scope and live policy remain unproved | ASV1-002 |
| G-019 | Public privacy policy and in-app link | public-URL/legal | Real HTTPS URL plus easily accessible in-app link; content meets Apple 5.1.1 | ASV1-004 |
| G-020 | Public support URL and contact | public-URL/legal | Real HTTPS page with working support contact and applicable legal address/contact details | ASV1-005 |
| G-021 | Marketing/accessibility URLs | public-URL/legal | Optional; if supplied, must be real, reachable and app-specific | ASV1-024 |
| G-022 | Microphone and Speech purpose strings in source | proved | Wanderful-specific text agrees across source and final Debug/Release Info.plist products | — |
| G-023 | Location-permission boundary in source | proved | No location usage key; About states no device-location access and manual place entry | — |
| G-024 | Encryption/export-compliance answer | public-URL/legal | Owner/legal classifies encryption and records App Store Connect answer before adding any plist declaration | ASV1-009 |
| G-025 | Account creation/deletion applicability | proved | Production composition uses local profile storage and an unconditional no-op sync factory; no account/Auth/session is created in V1; profile delete is local | — |
| G-026 | Superwall/purchase/subscription state | locally actionable | Native onboarding does not construct/present Superwall and tracked key is empty; linked SDK/built Release and owner exclusion still require proof | ASV1-003 |
| G-027 | Map/routing/elevation attribution source | proved | About includes MapKit, GraphHopper, OSM/ODbL and Mapterhorn credits with official links | — |
| G-028 | Safety/planning-aid wording source | proved | About states planning aid, not live navigation; conditions/rules/water must be checked | — |
| G-029 | Third-party content and asset rights | public-URL/legal | Owner records rights for code, icon/art, map/routing/elevation data and any onboarding assets | ASV1-023 |
| G-030 | Age-rating questionnaire | public-URL/legal | Owner completes current App Store Connect questionnaire; Unrated cannot ship | ASV1-008 |
| G-031 | Primary/secondary category decision | public-URL/legal | Owner approves truthful categories; primary should align with project category | ASV1-008 |
| G-032 | Metadata final approval | locally actionable | Stage A draft passes limits; Stage B/owner validates Release-reachable wording | ASV1-026 |
| G-033 | Required screenshots | locally actionable | Capture real deterministic Release-representative scenes in accepted sizes; 1–10, no alpha | ASV1-015 |
| G-034 | Final App Review notes and reviewer path | blocked | Native local/no-account and deterministic build/runtime paths are proved; selected production-backend conditions remain unproved | ASV1-022 |
| G-035 | Accessibility common-task proof and labels | locally actionable | Labels/headings and Reduce Motion flow are proved; runtime VoiceOver focus remains unproved, forced light is verified, and accessibility XXXL route cards visibly break | ASV1-016, ASV1-027, ASV1-028 |
| G-036 | Crash-free deterministic critical path | proved | 18/18 deterministic UI tests plus manual onboarding → Home → compare → detail → save/reopen → GPX handoff completed without crash | — |
| G-037 | Network/offline/error/retry behavior | proved | Focused/unit/UI coverage and manual fail-once/no-routes seams prove safe bounded error, retry and empty-result surfaces without live traffic | — |
| G-038 | No mock/developer/fake voice behavior in Release | proved | Fake service and preview are DEBUG-gated; release-surface regression passes and rebuilt Release contains no `FakeVoicePlanningService` string | — |
| G-039 | No overclaimed provider copy | proved | Reachable copy uses “Mapped route geometry”/“mapped routing data”/“routed geometry”; focused tests pass and rebuilt Release contains none of the old claims | — |
| G-040 | Release verifier matches shipping identity | proved | Verifier schema V2 enforces Wanderful production identity, nine false flags, empty services, attribution, privacy, mocks/claims and signing evidence; 38 adversarial cases plus stale recovery and 41/41 built-Release checks pass | — |
| G-041 | Built identity, flags, permissions and secret absence | proved | Debug/Staging/Release processed Info products prove exact lane identities, all nine false flags, empty services, expected purpose strings, valid signatures/manifests and no prohibited first-party release marker | — |
| G-042 | Focused and practical complete non-live test suites | proved | Historical Stage B: focused 395/395, unit 672/672, UI 18/18; current Stage C complete unit/UI bundle compilation passes. Stage C did not execute tests without a booted Simulator | — |
| G-043 | Debug, Staging and Release Simulator builds | proved | All three generic Simulator configurations passed on the current baseline using one bounded DerivedData path | — |
| G-044 | Archive-specific local artifact inspection | blocked | Not run: no `.xcarchive` exists. The passed generic iPhoneOS Release build is recorded separately as a non-archive diagnostic | ASV1-020 |
| G-045 | Signed distribution archive validation | Apple-account | Archive with App Store profile, inspect signing/privacy report and validate in Organizer | ASV1-020 |
| G-046 | TestFlight processing and tester proof | Apple-account | Upload/process build, export compliance, internal QA, then external beta review if used | ASV1-020 |
| G-047 | App Review submission and resolution | Apple-account | Complete required metadata/privacy/build/review declarations and submit with authority | ASV1-020 |
| G-048 | App Store Connect record, SKU and name availability | Apple-account | Owner creates/verifies record; no ID or name availability is inferred | ASV1-007 |
| G-049 | Geographic availability/coverage decision | public-URL/legal | Owner selects launch storefronts and confirms whether Navigation-category coverage-file rules apply | ASV1-008 |
| G-050 | Final evidence manifest on integrated source | proved | Listed tracked source blobs were rehashed at exact reachable commit `009c5aa52f7feb386335c7aeb0c2f1e85ec7a7fd`; Stage B executed evidence and current Stage C build/artifact evidence are explicitly separated | — |

## Primary evidence paths

- `Configuration/Shared.xcconfig`
- `Configuration/TrailMind-Info.plist`
- `TrailMind/TrailMindDebug.entitlements`
- `TrailMind/TrailMindRelease.entitlements`
- `TrailMind/PrivacyInfo.xcprivacy`
- `TrailMind.xcodeproj/project.pbxproj`
- `TrailMind.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`
- `TrailMind/App/TrailMindApp.swift`
- `TrailMind/Services/IntentParsingFoundation.swift`
- `TrailMind/Services/SuperwallOnboardingClient.swift`
- `TrailMind/Models/HikingPreferenceProfile.swift`
- `TrailMind/Services/HikingPreferenceProfileStore.swift`
- `TrailMind/Services/HikingPreferenceProfileSync.swift`
- `TrailMind/Services/HikingPreferenceProfileResolver.swift`
- `TrailMind/Services/RouteThumbnailService.swift`
- `TrailMind/Views/Route/RouteComponents.swift`
- `TrailMindTests/RouteThumbnailServiceTests.swift`
- `TrailMind/Views/Onboarding/SuperwallOnboardingHost.swift`
- `TrailMind/Views/Profile/ProfilePreferencesView.swift`
- `TrailMind/Views/Profile/TrailMindAboutContent.swift`
- `scripts/release-contract.json`
- `scripts/test-release-artifact-verifier.sh`

Exact SHA-256 values are in `SOURCE_EVIDENCE_MANIFEST_V1.json`.
