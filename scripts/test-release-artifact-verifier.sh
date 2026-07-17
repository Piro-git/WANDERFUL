#!/usr/bin/env zsh
set -euo pipefail
unsetopt BG_NICE

# The verifier intentionally uses normal platform tools. This script presents
# deterministic stand-ins only for Mach-O, signing, provisioning, and dSYM
# inspection so its fixtures need no credentials, network, or paid account.

stub_is_archive_path() {
  local argument
  for argument in "$@"; do
    [[ "$argument" == *'.xcarchive/'* ]] && return 0
  done
  return 1
}

stub_file() {
  if [[ "${TRAILMIND_RELEASE_STUB_SCENARIO:-pass}" == "non_macho" ]]; then
    print -r -- 'ASCII text'
  else
    print -r -- 'Mach-O 64-bit executable arm64'
  fi
}

stub_lipo() {
  if [[ "${TRAILMIND_RELEASE_STUB_SCENARIO:-pass}" == "bad_architecture" ]]; then
    print -r -- 'i386'
  else
    print -r -- 'arm64'
  fi
}

stub_otool() {
  local executable_path="${@: -1}"
  print -r -- "${executable_path}:"
  print -r -- $'\t/System/Library/Frameworks/Foundation.framework/Foundation (compatibility version 300.0.0, current version 1.0.0)'
  if [[ "${TRAILMIND_RELEASE_STUB_SCENARIO:-pass}" == "test_linkage" ]]; then
    print -r -- $'\t/System/Library/Frameworks/XCTest.framework/XCTest (compatibility version 1.0.0, current version 1.0.0)'
  fi
}

stub_codesign() {
  local joined=" $* "
  local archive=false
  stub_is_archive_path "$@" && archive=true

  if [[ "$joined" == *' --verify '* ]]; then
    [[ "${TRAILMIND_RELEASE_STUB_SCENARIO:-pass}" != "invalid_signature" ]]
    return $?
  fi

  if [[ "$joined" == *' --extract-certificates '* ]]; then
    local argument_index certificate_prefix=""
    for (( argument_index = 1; argument_index <= $#; argument_index++ )); do
      if [[ "${argv[argument_index]}" == "--extract-certificates" ]]; then
        certificate_prefix="${argv[argument_index + 1]:-}"
        break
      fi
    done
    [[ -n "$certificate_prefix" ]] || return 65
    if [[ "${TRAILMIND_RELEASE_STUB_SCENARIO:-pass}" == "mismatched_certificate" ]]; then
      print -rn -- 'DIFFERENT DETERMINISTIC CERTIFICATE' > "${certificate_prefix}0"
    else
      print -rn -- 'DETERMINISTIC SIGNER CERTIFICATE' > "${certificate_prefix}0"
    fi
    return 0
  fi

  if [[ "$joined" == *' --entitlements '* ]]; then
    if [[ "$archive" == true ]]; then
      /bin/cat "${TRAILMIND_RELEASE_STUB_ARCHIVE_ENTITLEMENTS:?}"
    else
      /bin/cat "${TRAILMIND_RELEASE_STUB_SIMULATOR_ENTITLEMENTS:?}"
    fi
    return 0
  fi

  if [[ "$joined" == *' -dv '* ]]; then
    print -u2 -r -- 'Identifier=com.trailmind.app'
    if [[ "$archive" == true ]]; then
      if [[ "${TRAILMIND_RELEASE_STUB_SCENARIO:-pass}" == "development_identity" ]]; then
        print -u2 -r -- 'Authority=Apple Development: Deterministic Fixture'
      else
        print -u2 -r -- 'Authority=Apple Distribution: Deterministic Fixture'
      fi
      print -u2 -r -- 'TeamIdentifier=TEAMTEST123'
      print -u2 -r -- 'Signature size=4782'
    else
      print -u2 -r -- 'Signature=adhoc'
      print -u2 -r -- 'TeamIdentifier=not set'
    fi
    return 0
  fi

  return 64
}

stub_dwarfdump() {
  local input_path="${@: -1}"
  local uuid='11111111-2222-3333-4444-555555555555'
  if [[ "${TRAILMIND_RELEASE_STUB_SCENARIO:-pass}" == "uuid_mismatch" &&
        "$input_path" == *'.dSYM/'* ]]; then
    uuid='AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
  fi
  print -r -- "UUID: ${uuid} (arm64) ${input_path}"
}

stub_security() {
  [[ "${TRAILMIND_RELEASE_STUB_SCENARIO:-pass}" != "profile_decode_failure" ]] || return 1
  /bin/cat "${TRAILMIND_RELEASE_STUB_PROFILE:?}"
}

case "${0:t}" in
  file)
    stub_file "$@"
    exit $?
    ;;
  lipo)
    stub_lipo "$@"
    exit $?
    ;;
  otool)
    stub_otool "$@"
    exit $?
    ;;
  codesign)
    stub_codesign "$@"
    exit $?
    ;;
  dwarfdump)
    stub_dwarfdump "$@"
    exit $?
    ;;
  security)
    stub_security "$@"
    exit $?
    ;;
esac

cd "${0:A:h}/.."

readonly VERIFIER="${PWD}/scripts/verify-release-artifact.sh"
readonly CONTRACT="${PWD}/scripts/release-contract.json"
readonly REAL_PATH="${PATH}"

work_directory="$(mktemp -d /private/tmp/trailmind-release-verifier-tests.XXXXXX)"
trap 'rm -rf -- "$work_directory"' EXIT INT TERM

stub_bin="${work_directory}/stub-bin"
mkdir -p -- "$stub_bin"
for stub_name in file lipo otool codesign dwarfdump security; do
  ln -s "${PWD}/scripts/test-release-artifact-verifier.sh" "${stub_bin}/${stub_name}"
done

simulator_entitlements="${work_directory}/simulator-entitlements.plist"
archive_entitlements="${work_directory}/archive-entitlements.plist"
development_entitlements="${work_directory}/development-entitlements.plist"
legacy_prefix_entitlements="${work_directory}/legacy-prefix-entitlements.plist"
decoded_profile="${work_directory}/decoded-profile.plist"
adhoc_profile="${work_directory}/adhoc-profile.plist"
enterprise_profile="${work_directory}/enterprise-profile.plist"
missing_beta_profile="${work_directory}/missing-beta-profile.plist"
legacy_prefix_profile="${work_directory}/legacy-prefix-profile.plist"

jq -n '{}' > "$simulator_entitlements"
plutil -convert xml1 "$simulator_entitlements"

jq -n '{
  "application-identifier": "TEAMTEST123.com.trailmind.app",
  "com.apple.developer.team-identifier": "TEAMTEST123",
  "com.apple.developer.devicecheck.appattest-environment": "production",
  "get-task-allow": false
}' > "$archive_entitlements"
plutil -convert xml1 "$archive_entitlements"

jq -n '{
  "application-identifier": "TEAMTEST123.com.trailmind.app",
  "com.apple.developer.team-identifier": "TEAMTEST123",
  "com.apple.developer.devicecheck.appattest-environment": "development",
  "get-task-allow": false
}' > "$development_entitlements"
plutil -convert xml1 "$development_entitlements"

jq -n '{
  "application-identifier": "LEGACYPREFIX.com.trailmind.app",
  "com.apple.developer.team-identifier": "TEAMTEST123",
  "com.apple.developer.devicecheck.appattest-environment": "production",
  "get-task-allow": false
}' > "$legacy_prefix_entitlements"
plutil -convert xml1 "$legacy_prefix_entitlements"

jq -n '{
  TeamIdentifier: ["TEAMTEST123"],
  ApplicationIdentifierPrefix: ["TEAMTEST123"],
  ExpirationDate: "temporary-string",
  Entitlements: {
    "application-identifier": "TEAMTEST123.com.trailmind.app",
    "com.apple.developer.team-identifier": "TEAMTEST123",
    "com.apple.developer.devicecheck.appattest-environment": "production",
    "get-task-allow": false,
    "beta-reports-active": true
  }
}' > "$decoded_profile"
plutil -convert xml1 "$decoded_profile"
/usr/libexec/PlistBuddy -c 'Delete :ExpirationDate' "$decoded_profile"
/usr/libexec/PlistBuddy -c 'Add :ExpirationDate date Fri Jul 17 12:00:00 GMT 2037' "$decoded_profile"
signer_certificate_data="$(print -rn -- 'DETERMINISTIC SIGNER CERTIFICATE' | base64)"
plutil -insert DeveloperCertificates -array "$decoded_profile"
plutil -insert DeveloperCertificates.0 -data "$signer_certificate_data" "$decoded_profile"

cp "$decoded_profile" "$adhoc_profile"
plutil -insert ProvisionedDevices -array "$adhoc_profile"
plutil -insert ProvisionedDevices.0 -string 'DETERMINISTIC-DEVICE-ID' "$adhoc_profile"

cp "$decoded_profile" "$enterprise_profile"
plutil -insert ProvisionsAllDevices -bool true "$enterprise_profile"

cp "$decoded_profile" "$missing_beta_profile"
plutil -remove 'Entitlements.beta-reports-active' "$missing_beta_profile"

cp "$decoded_profile" "$legacy_prefix_profile"
plutil -replace ApplicationIdentifierPrefix.0 -string 'LEGACYPREFIX' "$legacy_prefix_profile"
plutil -replace 'Entitlements.application-identifier' -string 'LEGACYPREFIX.com.trailmind.app' "$legacy_prefix_profile"

export TRAILMIND_RELEASE_STUB_SIMULATOR_ENTITLEMENTS="$simulator_entitlements"
export TRAILMIND_RELEASE_STUB_ARCHIVE_ENTITLEMENTS="$archive_entitlements"
export TRAILMIND_RELEASE_STUB_PROFILE="$decoded_profile"

make_info_plist() {
  local output_path="$1"
  local mode="$2"
  jq -n --slurpfile contract "$CONTRACT" --arg mode "$mode" '
    $contract[0] as $c |
    {
      CFBundleDevelopmentRegion: $c.product.development_region,
      CFBundleDisplayName: $c.product.display_name,
      CFBundleExecutable: "TrailMind",
      CFBundleIdentifier: $c.product.bundle_identifier,
      CFBundleInfoDictionaryVersion: "6.0",
      CFBundleName: $c.product.bundle_name,
      CFBundlePackageType: $c.product.package_type,
      CFBundleShortVersionString: $c.product.marketing_version,
      CFBundleVersion: $c.product.build_number,
      CFBundleSupportedPlatforms: $c.platforms[$mode].supported_platforms,
      DTPlatformName: $c.platforms[$mode].dt_platform_name,
      MinimumOSVersion: $c.product.minimum_os_version,
      UIDeviceFamily: $c.product.device_family,
      UISupportedInterfaceOrientations: $c.product.orientations,
      LSApplicationCategoryType: $c.product.app_category,
      CFBundleIcons: {
        CFBundlePrimaryIcon: {
          CFBundleIconFiles: ["AppIcon60x60"],
          CFBundleIconName: "AppIcon"
        }
      }
    }
    + $c.product.usage_descriptions
    + {($c.product.backend_info_key): $c.product.backend_url}
  ' > "$output_path"
  plutil -convert xml1 "$output_path"
}

make_privacy_manifest() {
  local output_path="$1"
  jq '.privacy_manifest.expected' "$CONTRACT" > "$output_path"
  plutil -convert xml1 "$output_path"
}

make_app_fixture() {
  local app_path="$1"
  local mode="$2"
  local dsym_path="$3"
  mkdir -p -- "$app_path/_CodeSignature"
  make_info_plist "$app_path/Info.plist" "$mode"
  make_privacy_manifest "$app_path/PrivacyInfo.xcprivacy"
  print -r -- 'SYNTHETIC TRAILMIND RELEASE EXECUTABLE' > "$app_path/TrailMind"
  chmod +x "$app_path/TrailMind"
  print -r -- 'ASSET CATALOG' > "$app_path/Assets.car"
  print -r -- 'ICON' > "$app_path/AppIcon60x60@2x.png"
  print -r -- 'APPL????' > "$app_path/PkgInfo"
  print -r -- 'SEALED RESOURCES' > "$app_path/_CodeSignature/CodeResources"
  mkdir -p -- "$dsym_path/Contents/Resources/DWARF"
  print -r -- 'SYNTHETIC DSYM' > "$dsym_path/Contents/Resources/DWARF/TrailMind"
}

simulator_app="${work_directory}/TrailMind.app"
simulator_dsym="${simulator_app}.dSYM"
make_app_fixture "$simulator_app" "simulator-app" "$simulator_dsym"

archive_path="${work_directory}/TrailMind.xcarchive"
archive_app="${archive_path}/Products/Applications/TrailMind.app"
archive_dsym="${archive_path}/dSYMs/TrailMind.app.dSYM"
make_app_fixture "$archive_app" "distribution-signed-archive" "$archive_dsym"
print -r -- 'SYNTHETIC PROFILE' > "$archive_app/embedded.mobileprovision"
mkdir -p -- "$archive_path"
jq -n --slurpfile contract "$CONTRACT" '
  $contract[0] as $c | {
    ArchiveVersion: 2,
    Name: "TrailMind",
    SchemeName: "TrailMind",
    ApplicationProperties: {
      ApplicationPath: $c.platforms["distribution-signed-archive"].application_path,
      CFBundleIdentifier: $c.product.bundle_identifier,
      CFBundleShortVersionString: $c.product.marketing_version,
      CFBundleVersion: $c.product.build_number
    }
  }
' > "$archive_path/Info.plist"
plutil -convert xml1 "$archive_path/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CreationDate date Fri Jul 17 12:00:00 GMT 2037' "$archive_path/Info.plist"

command_counter=0
LAST_OUTPUT=""
LAST_REPORT=""

fail_test() {
  print -u2 -r -- "$1"
  exit 1
}

expect_status() {
  local expected_status="$1"
  shift
  command_counter=$((command_counter + 1))
  LAST_OUTPUT="${work_directory}/command-${command_counter}.log"
  LAST_REPORT="${work_directory}/command-${command_counter}.json"
  set +e
  env \
    PATH="${stub_bin}:${REAL_PATH}" \
    TRAILMIND_RELEASE_REPORT_PATH="$LAST_REPORT" \
    "$@" > "$LAST_OUTPUT" 2>&1
  local actual_status=$?
  set -e
  [[ "$actual_status" == "$expected_status" ]] || {
    print -u2 -r -- "Expected status ${expected_status}, got ${actual_status}."
    sed -n '1,160p' "$LAST_OUTPUT" >&2
    [[ -f "$LAST_REPORT" ]] && plutil -p "$LAST_REPORT" >&2 || true
    exit 1
  }
}

assert_report() {
  local expression="$1"
  jq -e "$expression" "$LAST_REPORT" >/dev/null || fail_test "Machine report assertion failed."
}

clone_simulator_fixture() {
  local name="$1"
  local cloned_app="${work_directory}/${name}.app"
  cp -R "$simulator_app" "$cloned_app"
  cp -R "$simulator_dsym" "${cloned_app}.dSYM"
  print -r -- "$cloned_app"
}

expect_status 0 "$VERIFIER" simulator-app "$simulator_app"
assert_report '
  .schema_version == 1 and
  .verifier == "trailmind-release-artifact" and
  .mode == "simulator-app" and
  .artifact_kind == "app" and
  .failed_check_count == 0 and
  .final_status == "passed" and
  .is_terminal == true and
  (.binary_sha256 | test("^[0-9a-f]{64}$"))
'

expect_status 0 "$VERIFIER" distribution-signed-archive "$archive_path"
assert_report '
  .mode == "distribution-signed-archive" and
  .artifact_kind == "xcarchive" and
  .failed_check_count == 0 and
  .final_status == "passed" and
  (.passed_check_ids | index("provisioning_profile_contract") != null)
'

expect_status 0 env \
  TRAILMIND_RELEASE_STUB_ARCHIVE_ENTITLEMENTS="$legacy_prefix_entitlements" \
  TRAILMIND_RELEASE_STUB_PROFILE="$legacy_prefix_profile" \
  "$VERIFIER" distribution-signed-archive "$archive_path"
assert_report '.final_status == "passed" and .failed_check_count == 0'

expect_status 1 env TRAILMIND_RELEASE_STUB_PROFILE="$adhoc_profile" \
  "$VERIFIER" distribution-signed-archive "$archive_path"
assert_report '.final_status == "failed" and (.failed_check_ids | index("provisioning_profile_contract") != null)'

expect_status 1 env TRAILMIND_RELEASE_STUB_PROFILE="$enterprise_profile" \
  "$VERIFIER" distribution-signed-archive "$archive_path"
assert_report '.final_status == "failed" and (.failed_check_ids | index("provisioning_profile_contract") != null)'

expect_status 1 env TRAILMIND_RELEASE_STUB_PROFILE="$missing_beta_profile" \
  "$VERIFIER" distribution-signed-archive "$archive_path"
assert_report '.final_status == "failed" and (.failed_check_ids | index("provisioning_profile_contract") != null)'

expect_status 1 env TRAILMIND_RELEASE_STUB_SCENARIO=mismatched_certificate \
  "$VERIFIER" distribution-signed-archive "$archive_path"
assert_report '.final_status == "failed" and (.failed_check_ids | index("provisioning_profile_contract") != null)'

wrong_family_app="$(clone_simulator_fixture wrong-family)"
/usr/libexec/PlistBuddy -c 'Add :UIDeviceFamily:1 integer 2' "$wrong_family_app/Info.plist"
expect_status 1 "$VERIFIER" simulator-app "$wrong_family_app"
assert_report '.final_status == "failed" and (.failed_check_ids | index("device_family_contract") != null)'

wrong_backend_app="$(clone_simulator_fixture wrong-backend)"
/usr/libexec/PlistBuddy -c 'Set :INTENT_BACKEND_BASE_URL http://127.0.0.1:3000' "$wrong_backend_app/Info.plist"
expect_status 1 "$VERIFIER" simulator-app "$wrong_backend_app"
assert_report '.final_status == "failed" and (.failed_check_ids | index("backend_contract") != null)'

extra_permission_app="$(clone_simulator_fixture extra-permission)"
/usr/libexec/PlistBuddy -c 'Add :NSLocationWhenInUseUsageDescription string Unexpected' "$extra_permission_app/Info.plist"
expect_status 1 "$VERIFIER" simulator-app "$extra_permission_app"
assert_report '
  .final_status == "failed" and
  (.failed_check_ids | index("permission_contract") != null) and
  (.failed_check_ids | index("forbidden_info_keys") != null)
'

background_mode_app="$(clone_simulator_fixture background-mode)"
plutil -insert UIBackgroundModes -array "$background_mode_app/Info.plist"
plutil -insert UIBackgroundModes.0 -string location "$background_mode_app/Info.plist"
expect_status 1 "$VERIFIER" simulator-app "$background_mode_app"
assert_report '.final_status == "failed" and (.failed_check_ids | index("forbidden_info_keys") != null)'

missing_privacy_app="$(clone_simulator_fixture missing-privacy)"
rm -f -- "$missing_privacy_app/PrivacyInfo.xcprivacy"
expect_status 1 "$VERIFIER" simulator-app "$missing_privacy_app"
assert_report '.final_status == "failed" and (.failed_check_ids | index("privacy_manifest_presence") != null)'

debug_marker_app="$(clone_simulator_fixture debug-marker)"
print -r -- '--trailmind-ui-testing' >> "$debug_marker_app/TrailMind"
expect_status 1 "$VERIFIER" simulator-app "$debug_marker_app"
assert_report '.final_status == "failed" and (.failed_check_ids | index("release_composition_markers") != null)'

expect_status 1 env TRAILMIND_RELEASE_STUB_SCENARIO=invalid_signature \
  "$VERIFIER" simulator-app "$simulator_app"
assert_report '
  .final_status == "failed" and
  (.failed_check_ids | index("code_signature_integrity") != null) and
  (.failed_check_ids | index("final_signature_recheck") != null)
'

expect_status 1 env TRAILMIND_RELEASE_STUB_SCENARIO=uuid_mismatch \
  "$VERIFIER" simulator-app "$simulator_app"
assert_report '.final_status == "failed" and (.failed_check_ids | index("dsym_contract") != null)'

expect_status 1 env \
  TRAILMIND_RELEASE_STUB_ARCHIVE_ENTITLEMENTS="$development_entitlements" \
  "$VERIFIER" distribution-signed-archive "$archive_path"
assert_report '.final_status == "failed" and (.failed_check_ids | index("entitlement_contract") != null)'

expect_status 1 env TRAILMIND_RELEASE_STUB_SCENARIO=development_identity \
  "$VERIFIER" distribution-signed-archive "$archive_path"
assert_report '.final_status == "failed" and (.failed_check_ids | index("signing_identity_contract") != null)'

sensitive_marker='sk''-proj-THIS_IS_A_DETERMINISTIC_REDACTION_MARKER_1234567890'
sensitive_app="$(clone_simulator_fixture sensitive-marker)"
print -r -- "$sensitive_marker" >> "$sensitive_app/TrailMind"
expect_status 1 "$VERIFIER" simulator-app "$sensitive_app"
assert_report '.final_status == "failed" and (.failed_check_ids | index("credential_pattern_scan") != null)'
if grep -Fq -- "$sensitive_marker" "$LAST_OUTPUT" || grep -Fq -- "$sensitive_marker" "$LAST_REPORT"; then
  fail_test "Sensitive match leaked into verifier output or report."
fi

stale_report="${work_directory}/stale-report.json"
print -r -- '{"final_status":"passed","stale_sensitive_value":"must_disappear"}' > "$stale_report"
LAST_REPORT="$stale_report"
LAST_OUTPUT="${work_directory}/stale-report.log"
set +e
env PATH="${stub_bin}:${REAL_PATH}" TRAILMIND_RELEASE_REPORT_PATH="$stale_report" \
  "$VERIFIER" simulator-app "${work_directory}/missing.app" > "$LAST_OUTPUT" 2>&1
stale_status=$?
set -e
[[ "$stale_status" == "1" ]] || fail_test "Missing artifact did not fail closed."
jq -e '
  .verifier == "trailmind-release-artifact" and
  .final_status == "failed" and
  (.failed_check_ids | index("artifact_path_contract") != null) and
  (has("stale_sensitive_value") | not)
' "$stale_report" >/dev/null || fail_test "Stale passed report survived a failed invocation."

expect_status 1 "$VERIFIER" distribution-signed-archive "$simulator_app"
assert_report '.final_status == "failed" and (.failed_check_ids | index("artifact_type_contract") != null)'

expect_status 1 "$VERIFIER" app-store-archive "$archive_path"
assert_report '.mode == "invalid" and .final_status == "failed" and (.failed_check_ids | index("invocation_contract") != null)'

expect_status 1 "$VERIFIER" simulator-app
assert_report '.final_status == "failed" and (.failed_check_ids | index("invocation_contract") != null)'

invalid_mode_marker='invalid-mode-must-not-be-reflected-1234567890'
expect_status 1 "$VERIFIER" "$invalid_mode_marker" "$simulator_app"
assert_report '.mode == "invalid" and .final_status == "failed" and (.failed_check_ids | index("invocation_contract") != null)'
if grep -Fq -- "$invalid_mode_marker" "$LAST_OUTPUT" || grep -Fq -- "$invalid_mode_marker" "$LAST_REPORT"; then
  fail_test "Untrusted invocation data leaked into verifier output or report."
fi

unwritable_report_parent="${work_directory}/report-parent-is-a-file"
unwritable_output="${work_directory}/unwritable-report.log"
print -r -- 'not a directory' > "$unwritable_report_parent"
set +e
env PATH="${stub_bin}:${REAL_PATH}" \
  TRAILMIND_RELEASE_REPORT_PATH="${unwritable_report_parent}/summary.json" \
  "$VERIFIER" simulator-app "$simulator_app" > "$unwritable_output" 2>&1
unwritable_status=$?
set -e
[[ "$unwritable_status" == "1" ]] || fail_test "Machine-report failure did not fail closed."
grep -Fxq -- 'Machine report: unavailable' "$unwritable_output" ||
  fail_test "Unavailable machine report was announced as written."

print -r -- "Release artifact verifier self-tests passed (${command_counter} isolated command cases plus stale-report recovery)."
