#!/bin/bash
set -euo pipefail

# Standard hosted runner only; no signing, live service configuration or downloads.
: "${RUNNER_TEMP:?This script is intended for the isolated hosted runner}"
: "${GITHUB_STEP_SUMMARY:?GitHub summary path required}"
test -d "${DEVELOPER_DIR:?Select Xcode 26.5 explicitly}"
sdk_version="$(xcrun --sdk iphonesimulator --show-sdk-version)"
[[ "$sdk_version" == "26.5" ]] || { echo 'Required iOS Simulator SDK 26.5 unavailable'; exit 1; }
[[ ! -e Configuration/Local.xcconfig ]] || { echo 'Local configuration must not exist in this fixture job'; exit 1; }
python3 - <<'PY'
import json
from pathlib import Path
assert json.loads(Path('Configuration/ResearchDeployment.json').read_text()) == {'staging': None, 'production': None}, 'Fixture job requires disabled remote deployment identities'
PY
xcrun simctl list --json devices available > "$RUNNER_TEMP/ui-localization-devices.json"
simulator_id="$(python3 - "$RUNNER_TEMP/ui-localization-devices.json" <<'PY'
import json, sys
candidates = json.load(open(sys.argv[1]))['devices'].get('com.apple.CoreSimulator.SimRuntime.iOS-26-5', [])
devices = [d for d in candidates if d.get('isAvailable') and d['name'] == 'iPhone 17 Pro']
if len(devices) != 1:
    raise SystemExit('Required available iPhone 17 Pro / iOS 26.5 runtime not found; no fallback or green skip')
print(devices[0]['udid'])
PY
)"
result_path="$RUNNER_TEMP/ui-localization.xcresult"
log_path="$RUNNER_TEMP/ui-localization.log"
xcodebuild -version
printf 'Source SHA: %s\nSimulator SDK: %s\n' "$(git rev-parse HEAD)" "$sdk_version" >> "$GITHUB_STEP_SUMMARY"
set +e
xcodebuild test -quiet -onlyUsePackageVersionsFromResolvedFile \
  -project TrailMind.xcodeproj -scheme TrailMind -configuration Debug \
  -destination "platform=iOS Simulator,id=$simulator_id" \
  -derivedDataPath "$RUNNER_TEMP/ui-localization-derived" \
  -resultBundlePath "$result_path" \
  -parallel-testing-enabled NO -maximum-concurrent-test-simulator-destinations 1 \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= DEVELOPMENT_TEAM= \
  -only-testing:TrailMindTests/RouteLocalizedCopyTests \
  -only-testing:TrailMindTests/HikingRouteQualityEngineTests \
  -only-testing:TrailMindTests/RouteComparisonAccessibilityTests \
  -only-testing:TrailMindTests/DynamicResearchPlanningClientTests \
  -only-testing:TrailMindTests/RouteStopGeometryTests \
  -only-testing:TrailMindTests/RouteCardStopPhotoTests \
  -only-testing:TrailMindTests/WikimediaCommonsPhotoResolverTests \
  -only-testing:TrailMindTests/HikePreparationTests \
  -only-testing:TrailMindTests/RouteStaysTests \
  -only-testing:TrailMindTests/RouteWeatherTests \
  -only-testing:TrailMindTests/AppEnvironmentTests \
  -only-testing:TrailMindTests/DurableResearchTransportTests \
  -only-testing:TrailMindUITests/RouteCardPhotoUITests \
  -only-testing:TrailMindUITests/DynamicEvidenceUITests \
  -only-testing:TrailMindUITests/RouteStaysUITests > "$log_path" 2>&1
build_status=$?
set -e
if [[ "$build_status" != 0 ]]; then
  echo "Simulator build/tests failed (exit $build_status)." >> "$GITHUB_STEP_SUMMARY"
  # Only source/compiler/test diagnostics; never dump environments or artifacts.
  grep -E 'error:| failed |Test Case.*failed|BUILD FAILED|TEST FAILED' "$log_path" | tail -n 60 || true
  exit "$build_status"
fi
xcrun xcresulttool get test-results summary --path "$result_path" > "$RUNNER_TEMP/ui-localization-summary.json"
python3 - "$RUNNER_TEMP/ui-localization-summary.json" "$log_path" "$GITHUB_STEP_SUMMARY" <<'PY'
import json, sys
summary = json.load(open(sys.argv[1]))
passed, failed, skipped = (summary.get(k, 0) for k in ('passedTests', 'failedTests', 'skippedTests'))
assert passed >= 110 and failed == 0 and skipped == 0, 'Incomplete or failing simulator acceptance'
log = open(sys.argv[2]).read()
for test in ('testLanguageChangesPresentationWithoutRewritingTheRoute',
             'testExistingNamesRemainVerbatimWithoutFreshGeneratedOutcome',
             'testGermanComparisonKeepsFactsAndUnknownTechnicalDifficulty',
             'testEvidenceUsesTypedCodeRatherThanTranslatingUntrustedCopy',
             'testLocalizedEvidenceRetainsMeasuredPercentagesAndCoverageLimits',
             'testRouteCopyAndStatisticsUseSelectedLanguage'):
    assert any(test in line and 'passed' in line for line in log.splitlines()), f'Required regression did not pass: {test}'
with open(sys.argv[3], 'a') as output:
    output.write(f'Tests: {passed} passed; {failed} failed; {skipped} skipped.\n')
print(f'Tests: {passed} passed; {failed} failed; {skipped} skipped.')
PY
