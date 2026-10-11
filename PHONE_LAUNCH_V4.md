# Launch V4 phone integration receipt

This clone starts at the supplied snapshot a80862136ee26152ce35cd50da5732049e8cd823, from the verified bundle (SHA256 3860847dc7d9b5f9826bf6b4baadda236e08b7efe5bc35d6de0be6bd9ca4e2e9). It is not the saved project's working tree. No push is authorized.

## Base verification, 2026-09-10

- Unsigned Debug build for generic iOS succeeded, with the existing WKNavigationDelegate warning in DynamicWebResearchView. This proves compilation only.
- A signed build stopped because no development team was configured. Xcode Apple Accounts visibly has no signed-in account; macOS reports zero valid code-signing identities.
- Device inspection confirmed Wanderful Local, com.example.owner.wanderful.local, version 1.0 (1), already installed on the paired iPhone. No app was removed or replaced.
- User login to the previous developer account is required. Keep the existing bundle identifier for the replacement, preserve the team identity, and use install without uninstall. Never overwrite app data merely to fix signing.

## Reproduction

Use TrailMind.xcodeproj, scheme TrailMind, Debug configuration. For the user's phone, set TRAILMIND_PRODUCT_BUNDLE_IDENTIFIER=com.example.owner.wanderful.local on the build command and supply the confirmed development team after login. Do not infer successful login from a tool opening Xcode. Recheck signing identities, build signing, device installation, and process launch separately.

The unsigned build uses CODE_SIGNING_ALLOWED=NO and cannot be installed as a valid signed iOS build. Build logs reside outside the repository in /private/tmp/wanderful-phone-v4-base-unsigned.log and /private/tmp/wanderful-phone-v4-base-build.log.

## Separate acceptance gates

1. Compilation and native tests.
2. Signed installation preserving the current app's data and successful physical process launch.
3. Explicitly configured/authorized remote AI test with backend authentication and bounded provider budget. The tracked base's disabled remote settings were not changed; app launch alone is not AI readiness.
4. Real-device route guidance with foreground permission, app switch, screen lock, pause/end and network loss. Simulator fixtures cannot prove outdoor reliability.
5. Verified offline preparation and truthful map/data availability. Cached online maps cannot be represented as guaranteed offline maps.

Do not read Configuration/Local.xcconfig or the private provider environment, inspect secrets in old app bundles, renew old owner leases, or issue paid provider calls without the current concrete authorization.

## Recovery and pending integration

The original temporary clone and build logs disappeared during this session; the cause is unknown. The observed build-success markers above are historical observations, not reproducible retained logs. Targeted test execution never returned a confirmed result. The durable bundle restored this clone at 90a4e28 under launch-v4/phone-clone-01a08b6a. Further logs and bundles are written directly to the persistent phone handoff.

The shared Info.plist now declares the location background mode and explains active guidance, screen lock, pause/end and no saved location track. UI planning tests now explicitly grant per-request online permission. These changes await the corresponding navigation/release patches and a fresh integrated build/test run; they are not standalone completion evidence.

## Integrated verification

Navigation and release patches are integrated, including exact location permission copy and per-request online permission. The example-place form gained a native keyboard Done action. Its UI test taps the actual trailing switch control instead of the midpoint of the form label.

Verified in targeted simulator runs: 83 navigation/route-store tests and 31 privacy/release tests (114 unique unit tests), plus four UI scenarios: missing-location clarification, onboarding skip, permission reset after closing, and point-to-point route actions. These passed across targeted runs; initial stale test expectations and UI harness failures were corrected, not reported as passes. Logs and xcresult files are retained under the assigned workspace with the .phone-v4 prefix and selected logs copied to the phone handoff.

This does not establish physical iPhone installation, GPS behavior under screen lock on the user's phone, offline basemap availability, or real AI/provider success. The integrated source retains the supplied base's remote-feature defaults; enabling and testing AI remains an explicit separate prerequisite.
