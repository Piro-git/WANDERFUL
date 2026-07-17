# TrailMind release configuration

Status: closed-beta configuration decision with external gates
Evidence date: 2026-07-17

## Declared beta surface

| Setting | Current repository value | Beta decision |
|---|---|---|
| Product | TrailMind | Use this name unless App Store name ownership changes |
| Bundle identifier | `com.trailmind.app` | Must match the explicit App ID and App Store Connect record |
| Marketing version | `1.0` | Owner must confirm first external version |
| Build number | `1` | Increment for every uploaded build |
| Minimum OS | iOS 26.0 | iOS 26 support only for this beta |
| Device family | iPhone (`TARGETED_DEVICE_FAMILY = 1`) | iPhone only; iPad is not declared |
| Orientation | Portrait only | No iPad or landscape claims/assets |
| Appearance | Forced light appearance | Closed beta is light-only; dark appearance remains a public-release decision/gate |
| Language/region | English interface, deterministic English errors, routing instructions requested with locale `en`, and Germany-biased unqualified geocoding | Germany-first English-interface closed beta; German and English route prompts are accepted, but the interface is not German-localized |
| Category | Navigation | Must be confirmed in App Store Connect against the planning-aid scope |
| Release intent parser | Local rule-based parser selected by the Release factory | Remote providers and their client endpoint are Debug-only and excluded from Release compilation; metadata must not claim remote AI |
| Routing path | TrailMind backend → GraphHopper | Provider credential remains backend-only |
| Device location | Not used | No location purpose key; people enter place names |
| Voice | Optional Apple Speech | Requires microphone and Speech purpose strings and signed-device QA |
| Saved routes | Local protected files, excluded from backup | No account or cloud-sync claim |
| GPX | Verified routes only, protected temporary export | No navigation/import claim |

## Build settings that matter

- App target configurations use `Configuration/Shared.xcconfig`.
- Release maps `INTENT_BACKEND_BASE_URL` to `PRODUCTION_BACKEND_BASE_URL`.
- `DEVELOPMENT_TEAM` is empty in the repository.
- Code signing style is Automatic, but no team/provisioning proof exists.
- Debug uses `TrailMindDebug.entitlements` with App Attest `development`.
- Release uses `TrailMindRelease.entitlements` with App Attest `production`.
- The project supports `iphoneos` and `iphonesimulator`; Mac Catalyst is disabled.
- Swift 6 strict concurrency and main-actor default isolation are enabled.
- The app includes `PrivacyInfo.xcprivacy` through the synchronized target folder.

## Info.plist contract

The shared Info plist currently declares:

- microphone purpose: voice-to-text route requests;
- Speech purpose: Apple may process audio; TrailMind does not retain raw audio or send it to its backend;
- portrait-only iPhone orientation;
- indirect input support;
- no location usage string;
- no local-networking exception;
- backend base URL injected from the build configuration.

Permission copy must remain identical to the in-app About disclosure and focused tests.

## Release-only behavior

- `IntentParsingProviderFactory.makeDefaultProvider()` returns `LocalIntentParsingProvider` outside Debug.
- Remote-intent providers, their request/response types, and the `/api/parse-intent` client path are enclosed by Debug compilation guards. Release binary verification must reject their symbols or endpoint marker.
- Deterministic mocks, debug edit surfaces, debug parser selection, and UI-test composition are compile-gated.
- The default `GraphHopperClient` uses `BackendRouteGateway`; it does not load a GraphHopper key into the shipping app.
- Release backend authorization uses App Attest route sessions. The insecure loopback authorizer is development-only.

## Environment gates

The deployed backend must have all required production values, including:

- production PostgreSQL connection and applied migration;
- backend-only GraphHopper credential;
- App Attest App ID prefix, bundle ID, environment, allowed validation category, and allowed bundle versions;
- provider-enable flags and bounded request/rate/concurrency values;
- production `NODE_ENV`;
- HTTPS endpoint matching the exact Release build.

Remote AI provider variables are not required because remote parsing does not compile into Release. They must not be marketed as a shipping capability.

## Unresolved configuration decisions

- Apple Developer Team ID and ownership.
- Explicit App ID and App Attest capability configuration.
- App Store Connect SKU, primary locale, age rating, content rights, copyright, and category.
- Production backend ownership, custom domain, monitoring, and incident contact.
- Credential-containment/rotation evidence.
- Signed-device and TestFlight App Attest behavior.
- Public support and privacy URLs.
- Final light-only disposition for public release.
- Final supported iPhone hardware matrix.
- Owner approval of the Germany-first English-interface beta territory, primary locale, and reviewer path; a fully German-localized interface is not present.

## Preflight invariants

Do not upload a candidate unless all are true:

1. The candidate is built from a clean, identified commit.
2. The final Release endpoint is HTTPS and responds fail-closed when dependencies are absent.
3. No provider credential or local configuration file exists in the app/archive.
4. Release contains no test bundle, fixture route, debug mock, remote-intent provider symbol, or `/api/parse-intent` marker; its parser is local and observed traffic contains no remote-intent request.
5. The built Info plist declares iPhone only and portrait only.
6. Release has the production App Attest entitlement and correct application identifier.
7. `PrivacyInfo.xcprivacy` is bundled and matches the reviewed decision.
8. App Review metadata claims only the surface above.

See [ARCHIVE_VERIFICATION.md](ARCHIVE_VERIFICATION.md) for the required evidence record.
