# iOS Environment Separation V1

## Decision

Wanderful uses three explicit, exhaustive iOS environments: `local`, `staging`,
and `production`. The app environment is selected by an Xcode build
configuration and a compile-time Swift marker. A processed, signed Info.plist
value must exactly match that marker, bundle identifier, display name, and App
Attest expectation. Missing, duplicated, non-string, case-changed,
whitespace-padded, unknown, or mismatched identity values fail closed.

Each compiled lane also contains an immutable typed identity policy. Service
URL and public-key inputs are deliberately separate from that policy and cannot
replace its backend host or Supabase project reference. Only the active
compile-time branch is emitted into the signed application.

Service configuration is validated independently. An absent service is
unavailable; a malformed or cross-environment service is invalid. Both states
compose no-op/unavailable clients and perform no network work. A service error
does not make the app crash or fall back to another environment.

This follows Apple's model: schemes select build configurations, and xcconfig
files supply configuration-specific build settings. See [Customizing build
schemes](https://developer.apple.com/documentation/xcode/customizing-the-build-schemes-for-a-project)
and [Adding a build configuration
file](https://developer.apple.com/documentation/xcode/adding-a-build-configuration-file-to-your-project/).

## What Apple hosts and what Wanderful hosts

Apple hosts App Store Connect, TestFlight distribution, App Store distribution,
signing/provisioning services, and App Attest. Wanderful's infrastructure hosts
its backend API and, if enabled later, separate Supabase projects. Apple does not
choose the backend environment for an uploaded build.

TestFlight distributes the exact build uploaded to the App Store Connect app
record; it does not transform a Production build into Staging or select staging
settings. Apple's TestFlight documentation describes upload and distribution of
a build, not environment selection: [TestFlight
Overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview).

## Mapping

| Purpose | Scheme/configuration | Compiled value | Bundle identifier | App Attest | Backend policy | Supabase project policy |
| --- | --- | --- | --- | --- | --- | --- |
| Local development | `TrailMind` / `Debug` | `local` | `com.trailmind.app.local` | development | loopback only | unavailable |
| Staging / future TestFlight | `TrailMind Staging` / `Staging` | `staging` | `com.trailmind.app.staging` | production | unavailable | `mbvzwsrtqcrwhvykugcd` |
| App Store production | `TrailMind` / `Release` | `production` | `com.trailmind.app` | production | unavailable | `bejvhhjbgtvctpsnlwid` |

Local and staging use distinct bundle identifiers, so neither overwrites the
production app on a device. Apple defines a bundle ID as a unique app identity
and requires it to match App Store Connect: [CFBundleIdentifier](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleidentifier).

`Staging` is Release-optimized and shares `TrailMindRelease.entitlements`; a
third entitlements file is unnecessary. Apple states that TestFlight and App
Store distributions always use the App Attest production environment regardless
of the source entitlement: [App Attest
Environment](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.devicecheck.appattest-environment).

## Checked-in configuration graph

- `Development.xcconfig` includes `Shared.xcconfig`, then optionally includes
  ignored `Local.xcconfig`, then assigns protected local identity values.
- `Staging.xcconfig` includes only `Shared.xcconfig` and maps only
  `STAGING_*` service values.
- `Production.xcconfig` includes only `Shared.xcconfig` and maps only
  `PRODUCTION_*` service values.
- `Release` never includes or depends on `Local.xcconfig`.
- Backend hosts and Supabase project references are not xcconfig or Info.plist
  inputs. They are compiled lane policy in `AppEnvironment.swift`.
- All provider, research, evidence, remote-intent, Supabase sync, Superwall,
  insecure-loopback authorization, in-memory App Attest, and direct GraphHopper
  flags are `false` in tracked configuration.

The compiled Swift marker is the authoritative selector. The signed Info.plist
environment is a second invariant, not a runtime override. `UserDefaults`,
launch environment, prompts, onboarding attributes, remote payloads, URLs,
hostnames, debugger presence, and Simulator state are not environment inputs.
The process stores one immutable configuration result and diagnostics expose
only the environment name and capability booleans.

## Backend endpoint contract

Blank endpoint fields mean unavailable. No fallback URL exists. For Staging
and Production, a configured backend would require all of:

- canonical HTTPS with a lowercase DNS hostname;
- no user info, password, query, fragment, non-root path, or explicit port;
- an independently reviewed exact host compiled into that signed lane; and
- exact equality with that compiled host.

No reviewed canonical HTTPS backend host is present in committed evidence, so
both remote lanes compile backend policy as unavailable. Injecting any URL,
with or without an Info.plist or command-line "expected host," remains invalid
and performs no network work. Activating a backend later requires a reviewed
source-policy change; CI cannot redefine the allowlist.

Local accepts only root URLs on exact `127.0.0.1`, `localhost`, or `::1` HTTP
loopback hosts. Other HTTP, remote HTTPS, loopback aliases, credentials, query
authentication, fragments, and ambiguous hosts are rejected. The insecure local
placeholder authorizer remains separately disabled, so a loopback URL alone
cannot activate it.

## Supabase contract

Onboarding sync remains hard no-op in V1. Reserved configuration is nevertheless
validated for a future reviewed release:

- Local does not accept a hosted Supabase project.
- Staging and Production use separate 20-character project references compiled
  into their signed lane.
- Project URL and the compiled current-lane project reference must agree
  exactly. A URL/key/Info.plist/command-line input cannot redefine it.
- Only `sb_publishable_...` or a legacy JWT whose role is exactly `anon` is
  client-eligible.
- `sb_secret_...`, legacy `service_role`, secret-looking values, partial values,
  placeholders, and cross-environment project references are rejected.

Supabase documents publishable keys as suitable for mobile apps and secret or
service-role keys as privileged backend-only credentials that bypass RLS:
[Understanding API
keys](https://supabase.com/docs/guides/getting-started/api-keys). Supabase also
recommends separate staging and production environments/projects: [Managing
Environments](https://supabase.com/docs/guides/deployment/managing-environments).

The checked-in project references above are non-secret identities independently
confirmed by committed `origin/main` evidence in
`PHASE_1_FOUNDATION_PROOF.json` and
`PHASE_1_POSTGIS_ISOLATION_V2_LOCAL_PROOF.json`. No publishable key or database
credential was read to establish this policy.

No service-role key, secret key, database password, JWT secret, connection
string, provider secret, GraphHopper key, or private endpoint may be supplied to
an iOS build. A Supabase publishable key and Superwall public SDK key are public
client identifiers, not secrets, but must still be environment-scoped and never
printed by release automation.

## App Attest and backend authorization

App Attest keys are bound to the App ID, which includes the App ID prefix and
bundle identifier. Apple requires server validation of that identity and the
development/production AAGUID: [Validating apps that connect to your
server](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server).

Consequently, the future staging backend must allow the staging App ID and a
production App Attest AAGUID for TestFlight. The production backend must allow
only the production App ID and production AAGUID. Local device development uses
the local App ID and development environment. Attestation keys from one App
Attest environment do not work in the other. These server allowlists are owner
work and are not created or mutated by this change.

## Local developer setup without reading an existing local file

Automation must never open, print, hash, source, copy from, or inspect the
contents of `Configuration/Local.xcconfig`. Verify only its ignore rule:

```sh
git check-ignore Configuration/Local.xcconfig
```

No file is required for the safe default. For a one-command placeholder-only
loopback build, inject the non-secret local value directly instead of opening a
local file:

```sh
xcodebuild -project TrailMind.xcodeproj -scheme TrailMind -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO LOCAL_BACKEND_BASE_URL='http://127.0.0.1:3000' build
```

If a human developer wants a persistent placeholder file, first confirm no file
exists and copy the tracked example without overwriting anything:

```sh
test ! -e Configuration/Local.xcconfig && \
  cp -n Configuration/Local.xcconfig.example Configuration/Local.xcconfig
```

Only the human owner should edit that ignored file. It is Development-only, and
the checked-in Development xcconfig reassigns environment identity and all
controlled capability flags after the optional include.

## Future CI and release injection

CI should use protected, environment-scoped variables and pass only the matching
lane's public values at build time:

- Staging: `STAGING_BACKEND_BASE_URL`, `STAGING_SUPABASE_PROJECT_URL`,
  `STAGING_SUPABASE_PUBLISHABLE_KEY`, and optionally the public
  `STAGING_SUPERWALL_PUBLIC_SDK_KEY`.
- Production: corresponding `PRODUCTION_*` values.

These inputs provide URLs or public client values only. They cannot supply or
override the backend host or Supabase project identity used for admission. A
backend URL remains unusable until its exact host is independently reviewed and
compiled into the relevant signed lane.

Do not echo injected values. After every build, inspect the processed Info.plist
and entitlements, and reject mismatched environment, bundle, display name, App
Attest value, non-false flags, unexpected URLs, credentials, or staging identity
inside Release. Xcode command-line settings have highest precedence, so artifact
inspection is a required independent release gate: [Configuring build
settings](https://developer.apple.com/documentation/xcode/configuring-the-build-settings-of-a-target/).

## Promotion

1. Build and test Debug locally with all capabilities disabled and services
   unavailable, or with an explicit loopback-only backend.
2. Promote reviewed backend/database changes independently to a separate staging
   environment.
3. Inject staging public values, build/archive only `TrailMind Staging`, inspect
   the artifact, and later upload it only to the staging App Store Connect record.
4. Complete physical-device/TestFlight App Attest proof against the staging
   backend.
5. Promote the reviewed server/database release to production.
6. Inject production public values, build/archive only `TrailMind` Release,
   inspect it for absence of staging identity, and obtain explicit owner approval
   before any App Store Connect action.

TestFlight does not automatically mean staging. Uploading a `TrailMind` Release
archive to TestFlight would still produce a Production-configured app.

## Current limitations and owner decisions

Production and Staging are intentionally buildable with backend access
unavailable until reviewed hosts are compiled. Supabase onboarding sync, Superwall
presentation, remote intent, direct GraphHopper, evidence/research providers,
in-memory App Attest, and insecure fallbacks remain disabled. No live endpoint,
provider, deployment, or App Store record is configured here.

Before distribution, the Apple owner must:

- approve/register explicit App IDs for `com.trailmind.app.local` and
  `com.trailmind.app.staging` as needed;
- create the separate staging App Store Connect/TestFlight record and profiles;
- confirm the production App ID remains `com.trailmind.app`;
- enable App Attest capabilities without weakening entitlements and configure
  backend App ID/environment allowlists;
- approve a canonical HTTPS backend host for each lane before any source-policy
  change enables remote backend admission;
- decide team, signing certificates, provisioning, build numbers, and tester
  groups; and
- authorize every archive/upload/TestFlight/App Store mutation.

The Supabase owner must confirm continued ownership of the independently
reviewed staging and production projects, provide only publishable keys through
CI, validate RLS, and later authorize onboarding sync. None of those actions is
performed by this configuration-only V1.
