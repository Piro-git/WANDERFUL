# Release Gate Matrix V1

Baseline: `d61011098afa5f53ec4cc8ab1b3503ac1111e04a`
Assessment date: 2026-08-23
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

Exactly 14 of 50 applicable gates are proved: **28.0%**. A grouped row counts as one gate. No row is counted complete merely because a draft document or another lane's build report exists.

| Gate | Requirement | Classification | Current evidence or acceptance criterion | Blocker |
| --- | --- | --- | --- | --- |
| G-001 | Baseline, clean shared checkout and duplicate gate | proved | Isolated worktree and local `origin/main` are `d610110…`; GitHub branch API independently reported the same SHA; no earlier V1 package/history | — |
| G-002 | Shipping display name | proved | `Configuration/TrailMind-Info.plist`: `CFBundleDisplayName = Wanderful` | — |
| G-003 | Bundle ID and version/build source settings | proved | `project.pbxproj`: `com.trailmind.app`, `1.0`, `1` | — |
| G-004 | Platform source settings | proved | iPhone family `1`, minimum iOS `26.0`, portrait, Catalyst disabled | — |
| G-005 | Launch appearance is complete and release-polished | locally actionable | Inspect first rendered Release frame and built launch metadata in Stage B | ASV1-012 |
| G-006 | App icon source asset exists | proved | One universal 1024×1024 PNG declared in AppIcon asset catalog | — |
| G-007 | Compiled icon variants are opaque and accepted | locally actionable | Source PNG reports `hasAlpha: yes`; inspect built Assets.car/icon output before confirming a defect or correction | ASV1-014 |
| G-008 | Active Apple Developer Program team/legal entity | Apple-account | Owner supplies verified team/legal entity and current agreements | ASV1-006 |
| G-009 | Explicit App ID and App Attest capability | Apple-account | Developer portal identifier must exactly match `com.trailmind.app` with App Attest enabled | ASV1-006 |
| G-010 | Distribution certificate and App Store profile | Apple-account | Current Apple Distribution identity and App Store profile match team, ID and entitlement | ASV1-006 |
| G-011 | Debug/Release App Attest source mapping | proved | Debug entitlement `development`; Release entitlement `production`; project maps each configuration | — |
| G-012 | Production App Attest proof | physical-device | Complete `APP_ATTEST_PHYSICAL_DEVICE_PROOF_V1.md` on real iPhone/TestFlight build | ASV1-010 |
| G-013 | Production backend availability and release compatibility | blocked | Prove approved URL availability, retention, rate limiting, route contract and App Attest enforcement without relying on historical receipts | ASV1-011 |
| G-014 | Tracked iOS feature defaults | proved | Outdoor evidence, research-guided planning, routable-highlight access and Supabase onboarding sync are `false`; Superwall key and Supabase URL/key are empty | — |
| G-015 | Deployed backend/provider feature defaults | blocked | Deployment owner proves route availability and all research/evidence/provider defaults for the release environment | ASV1-011 |
| G-016 | First-party privacy manifest source | proved | Tracking false; linked Device ID for app functionality; approved reasons `C617.1` and `CA92.1` | — |
| G-017 | Embedded third-party privacy manifests/signatures | locally actionable | Inspect built app/frameworks and Xcode privacy report after onboarding/Package integration | ASV1-013 |
| G-018 | Final App Privacy questionnaire | blocked | iOS onboarding delta is reconciled; backend/App Attest retention, embedded SDK manifests and live policy remain unproved | ASV1-002 |
| G-019 | Public privacy policy and in-app link | public-URL/legal | Real HTTPS URL plus easily accessible in-app link; content meets Apple 5.1.1 | ASV1-004 |
| G-020 | Public support URL and contact | public-URL/legal | Real HTTPS page with working support contact and applicable legal address/contact details | ASV1-005 |
| G-021 | Marketing/accessibility URLs | public-URL/legal | Optional; if supplied, must be real, reachable and app-specific | ASV1-024 |
| G-022 | Microphone and Speech purpose strings in source | proved | Wanderful-specific microphone text and Apple server-processing disclosure in Info.plist/About copy | — |
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
| G-034 | Final App Review notes and reviewer path | blocked | Native local/no-account path is source-final; deterministic build/runtime path and backend conditions remain unproved | ASV1-022 |
| G-035 | Accessibility common-task proof and labels | locally actionable | VoiceOver, Voice Control, Larger Text, Reduce Motion and contrast checks across common tasks | ASV1-016 |
| G-036 | Crash-free deterministic critical path | blocked | First launch → onboarding → plan → compare → detail → save/export passes in Stage B | ASV1-012 |
| G-037 | Network/offline/error/retry behavior | blocked | Deterministic non-live failure, timeout, cancellation, no-route and offline states pass | ASV1-012 |
| G-038 | No mock/developer/fake voice behavior in Release | locally actionable | Scan built binary and runtime; source `FakeVoicePlanningService` remains a candidate, not a finding | ASV1-017 |
| G-039 | No overclaimed provider copy | locally actionable | Verify “Live trail geometry” and “trail-network data” against path-detail evidence and Release UI | ASV1-019 |
| G-040 | Release verifier matches shipping identity | locally actionable | Artifact-confirm current “TrailMind” versus “Wanderful” mismatch before any correction | ASV1-018 |
| G-041 | Built identity, flags, permissions and secret absence | blocked | Inspect compiled Info.plist, entitlements and binary in Stage B | ASV1-025 |
| G-042 | Focused and practical complete non-live test suites | blocked | Upstream onboarding report exists, but this lane could not rerun: final available storage was 10,476,192 KiB, 9,568 KiB below the mandated floor | ASV1-012 |
| G-043 | Debug and Release Simulator builds | blocked | Upstream integration builds passed, but this lane lacks independently inspected products because the storage stop gate closed | ASV1-012 |
| G-044 | Optional unsigned/local archive inspection | blocked | Only if safe/necessary after builds; never treat as distribution validation | ASV1-012 |
| G-045 | Signed distribution archive validation | Apple-account | Archive with App Store profile, inspect signing/privacy report and validate in Organizer | ASV1-020 |
| G-046 | TestFlight processing and tester proof | Apple-account | Upload/process build, export compliance, internal QA, then external beta review if used | ASV1-020 |
| G-047 | App Review submission and resolution | Apple-account | Complete required metadata/privacy/build/review declarations and submit with authority | ASV1-020 |
| G-048 | App Store Connect record, SKU and name availability | Apple-account | Owner creates/verifies record; no ID or name availability is inferred | ASV1-007 |
| G-049 | Geographic availability/coverage decision | public-URL/legal | Owner selects launch storefronts and confirms whether Navigation-category coverage-file rules apply | ASV1-008 |
| G-050 | Final evidence manifest on integrated source | proved | All listed tracked source blobs were rehashed at `d610110…`; built/runtime evidence remains explicitly separate | — |

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
- `TrailMind/Views/Onboarding/SuperwallOnboardingHost.swift`
- `TrailMind/Views/Profile/ProfilePreferencesView.swift`
- `TrailMind/Views/Profile/TrailMindAboutContent.swift`
- `scripts/release-contract.json`

Exact SHA-256 values are in `SOURCE_EVIDENCE_MANIFEST_V1.json`.
