# StoreKit test-service isolation

This diagnostic is **not** part of TrailMind's build or release scheme. It generates a tiny hosted XCTest app with no packages, app services, feature flags, account APIs, backend, or purchase/sync calls. It has a separate test-only bundle identifier.

It checks:

1. Both StoreKit files exist and parse from the app bundle.
2. A single consumable fixture works using `SKTestSession(contentsOf:)`.
3. The same fixture works using `configurationFileNamed:`.
4. The existing Wanderful subscription fixture works using an explicit URL.

Each runtime check writes/reads `disableDialogs` before querying products. A failed readback identifies a test-service problem before product logic. Queries can fall through to Apple's sandbox catalog when local StoreKit configuration fails; they do not purchase anything. The tests stay red when the service is unavailable.

From the repository root, choose unused output paths:

```sh
python3 diagnostics/storekit-isolation/generate.py /private/tmp/wanderful-storekit-probe-new
xcodebuild -project /private/tmp/wanderful-storekit-probe-new/Probe.xcodeproj \
  -scheme Probe -configuration Debug \
  -destination 'platform=iOS Simulator,id=YOUR_BOOTED_SIMULATOR_ID' \
  -derivedDataPath /private/tmp/wanderful-storekit-probe-new-derived \
  -parallel-testing-enabled NO \
  -resultBundlePath /private/tmp/wanderful-storekit-probe-new.xcresult \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES test
```

`generate.py` refuses to overwrite an existing directory. It copies the repository's existing Wanderful fixture into the host app, uses an absolute scheme configuration reference, and generates an ordinary Xcode project without provisioning profiles or special entitlements. Run on an Apple silicon simulator; choose the appropriate architecture on other hosts. No downloads or portal setup are needed by the generator.

Observed 2026-09-29: Xcode 26.5 (17F42), iOS 26.5 (23F77): resource control passes; all three service/catalog tests fail. Details and limits: `docs/release/storekit-isolation-20260929/README.md`.
