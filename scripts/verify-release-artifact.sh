#!/usr/bin/env zsh

# Fail-closed verification for TrailMind Release artifacts.
#
# This command deliberately has two non-interchangeable modes:
#   simulator-app      verifies a Release simulator .app without claiming
#                      device signing or App Store readiness.
#   distribution-signed-archive
#                      verifies a device .xcarchive that is already signed with
#                      Apple Distribution and an App Store distribution profile.
#                      This is deliberately not a verifier for the standard raw
#                      automatic-signing archive that Xcode re-signs on export.
#
# Output is restricted to stable check identifiers. Tool output, binary strings,
# provisioning data, entitlement values, and possible credential matches are
# never echoed or copied into the machine report.

set -u
setopt PIPE_FAIL
umask 077
export LC_ALL=C

readonly RELEASE_VERIFIER_SCHEMA_VERSION=1
readonly RELEASE_VERIFIER_NAME="trailmind-release-artifact"
readonly RELEASE_VERIFIER_SCRIPT_DIR="${0:A:h}"
readonly RELEASE_VERIFIER_CONTRACT="${RELEASE_VERIFIER_SCRIPT_DIR}/release-contract.json"

typeset -ga RELEASE_PASSED_CHECKS=()
typeset -ga RELEASE_FAILED_CHECKS=()
typeset -g RELEASE_MODE="invalid"
typeset -g RELEASE_ARTIFACT_KIND="unknown"
typeset -g RELEASE_BINARY_SHA256=""
typeset -g RELEASE_REPORT_STATE="unavailable"

record_pass() {
  RELEASE_PASSED_CHECKS+=("$1")
}

record_failure() {
  RELEASE_FAILED_CHECKS+=("$1")
}

has_failure() {
  local check_id="$1"
  local existing
  for existing in "${RELEASE_FAILED_CHECKS[@]:-}"; do
    [[ "$existing" == "$check_id" ]] && return 0
  done
  return 1
}

record_once_failure() {
  has_failure "$1" || record_failure "$1"
}

json_array_from_arguments() {
  if (( $# == 0 )); then
    print -r -- '[]'
    return 0
  fi
  printf '%s\n' "$@" | jq -Rsc 'split("\n") | map(select(length > 0))'
}

write_release_report() {
  local report_path="$1"
  local final_status="$2"
  local reason="$3"
  local report_directory="${report_path:h}"
  local temporary_report="${report_path}.tmp.$$.$RANDOM"
  local passed_json failed_json

  mkdir -p -- "$report_directory" 2>/dev/null || return 1
  passed_json="$(json_array_from_arguments "${RELEASE_PASSED_CHECKS[@]:-}")" || return 1
  failed_json="$(json_array_from_arguments "${RELEASE_FAILED_CHECKS[@]:-}")" || return 1

  jq -n \
    --argjson schema_version "$RELEASE_VERIFIER_SCHEMA_VERSION" \
    --arg verifier "$RELEASE_VERIFIER_NAME" \
    --arg mode "$RELEASE_MODE" \
    --arg artifact_kind "$RELEASE_ARTIFACT_KIND" \
    --arg final_status "$final_status" \
    --arg reason "$reason" \
    --arg binary_sha256 "$RELEASE_BINARY_SHA256" \
    --argjson passed_check_ids "$passed_json" \
    --argjson failed_check_ids "$failed_json" \
    '{
      schema_version: $schema_version,
      verifier: $verifier,
      mode: $mode,
      artifact_kind: $artifact_kind,
      passed_check_count: ($passed_check_ids | length),
      failed_check_count: ($failed_check_ids | length),
      total_check_count: (($passed_check_ids | length) + ($failed_check_ids | length)),
      passed_check_ids: $passed_check_ids,
      failed_check_ids: $failed_check_ids,
      binary_sha256: $binary_sha256,
      final_status: $final_status,
      is_terminal: true,
      reason: $reason
    }' > "$temporary_report" 2>/dev/null || {
      rm -f -- "$temporary_report" 2>/dev/null
      return 1
    }

  mv -f -- "$temporary_report" "$report_path" 2>/dev/null || {
    rm -f -- "$temporary_report" 2>/dev/null
    return 1
  }
}

print_release_summary() {
  local final_status="$1"
  local failed_id

  print -r -- "TrailMind release verification"
  print -r -- "Mode: ${RELEASE_MODE}"
  print -r -- "Passed checks: ${#RELEASE_PASSED_CHECKS[@]}"
  print -r -- "Failed checks: ${#RELEASE_FAILED_CHECKS[@]}"
  if (( ${#RELEASE_FAILED_CHECKS[@]} > 0 )); then
    print -r -- "Failed check IDs:"
    for failed_id in "${RELEASE_FAILED_CHECKS[@]}"; do
      print -r -- "- ${failed_id}"
    done
  fi
  print -r -- "Final status: ${final_status}"
  print -r -- "Machine report: ${RELEASE_REPORT_STATE}"
}

required_commands_available() {
  local command_name
  for command_name in \
    jq plutil file strings grep find lipo otool codesign dwarfdump shasum base64 \
    mktemp date security awk sort sed wc tr mkdir mv rm; do
    command -v "$command_name" >/dev/null 2>&1 || return 1
  done
}

contract_is_valid() {
  [[ -f "$RELEASE_VERIFIER_CONTRACT" && ! -L "$RELEASE_VERIFIER_CONTRACT" ]] || return 1
  jq -e '
    .schema_version == 1 and
    (.product.bundle_identifier | type == "string" and length > 0) and
    (.product.bundle_name | type == "string" and length > 0) and
    (.product.display_name | type == "string" and length > 0) and
    (.product.package_type | type == "string" and length > 0) and
    (.product.marketing_version | type == "string" and length > 0) and
    (.product.build_number | type == "string" and length > 0) and
    (.product.minimum_os_version | type == "string" and length > 0) and
    (.product.development_region | type == "string" and length > 0) and
    (.product.device_family | type == "array" and length > 0) and
    (.product.orientations | type == "array" and length > 0) and
    (.product.backend_url | type == "string" and startswith("https://")) and
    (.product.usage_descriptions | type == "object" and length > 0) and
    (.platforms["simulator-app"].allowed_architectures | type == "array" and length > 0) and
    (.platforms["distribution-signed-archive"].allowed_architectures | type == "array" and length > 0) and
    (.platforms["distribution-signed-archive"].requires_beta_reports_active == true) and
    (.privacy_manifest.filename == "PrivacyInfo.xcprivacy") and
    (.privacy_manifest.expected | type == "object") and
    (.forbidden_info_keys | type == "array") and
    (.forbidden_binary_markers | type == "array")
  ' "$RELEASE_VERIFIER_CONTRACT" >/dev/null 2>&1
}

plist_json() {
  plutil -convert json -o - "$1" 2>/dev/null
}

json_matches_string() {
  local json="$1"
  local expression="$2"
  local expected="$3"
  print -r -- "$json" | jq -e --arg expected "$expected" "$expression == \$expected" >/dev/null 2>&1
}

json_matches_contract_array() {
  local json="$1"
  local expression="$2"
  local contract_expression="$3"
  local actual expected

  actual="$(print -r -- "$json" | jq -cS "$expression" 2>/dev/null)" || return 1
  expected="$(jq -cS "$contract_expression" "$RELEASE_VERIFIER_CONTRACT" 2>/dev/null)" || return 1
  [[ "$actual" == "$expected" ]]
}

validate_info_contract() {
  local info_json="$1"
  local mode="$2"
  local expected
  local actual_usage expected_usage forbidden_keys

  expected="$(jq -r '.product.bundle_identifier' "$RELEASE_VERIFIER_CONTRACT")"
  json_matches_string "$info_json" '.CFBundleIdentifier' "$expected" &&
    expected="$(jq -r '.product.bundle_name' "$RELEASE_VERIFIER_CONTRACT")" &&
    json_matches_string "$info_json" '.CFBundleName' "$expected" &&
    expected="$(jq -r '.product.display_name' "$RELEASE_VERIFIER_CONTRACT")" &&
    json_matches_string "$info_json" '.CFBundleDisplayName' "$expected" &&
    expected="$(jq -r '.product.package_type' "$RELEASE_VERIFIER_CONTRACT")" &&
    json_matches_string "$info_json" '.CFBundlePackageType' "$expected"
  if (( $? == 0 )); then record_pass "bundle_identity"; else record_failure "bundle_identity"; fi

  expected="$(jq -r '.product.marketing_version' "$RELEASE_VERIFIER_CONTRACT")"
  if json_matches_string "$info_json" '.CFBundleShortVersionString' "$expected" &&
     expected="$(jq -r '.product.build_number' "$RELEASE_VERIFIER_CONTRACT")" &&
     json_matches_string "$info_json" '.CFBundleVersion' "$expected"; then
    record_pass "version_contract"
  else
    record_failure "version_contract"
  fi

  expected="$(jq -r '.product.minimum_os_version' "$RELEASE_VERIFIER_CONTRACT")"
  if json_matches_string "$info_json" '.MinimumOSVersion' "$expected"; then
    record_pass "minimum_os_contract"
  else
    record_failure "minimum_os_contract"
  fi

  expected="$(jq -r '.product.development_region' "$RELEASE_VERIFIER_CONTRACT")"
  if json_matches_string "$info_json" '.CFBundleDevelopmentRegion' "$expected"; then
    record_pass "development_region_contract"
  else
    record_failure "development_region_contract"
  fi

  if json_matches_contract_array "$info_json" '.UIDeviceFamily' '.product.device_family'; then
    record_pass "device_family_contract"
  else
    record_failure "device_family_contract"
  fi

  if json_matches_contract_array "$info_json" '.UISupportedInterfaceOrientations' '.product.orientations' &&
     print -r -- "$info_json" | jq -e 'has("UISupportedInterfaceOrientations~ipad") | not' >/dev/null 2>&1; then
    record_pass "orientation_contract"
  else
    record_failure "orientation_contract"
  fi

  expected="$(jq -r '.product.app_category' "$RELEASE_VERIFIER_CONTRACT")"
  if json_matches_string "$info_json" '.LSApplicationCategoryType' "$expected"; then
    record_pass "category_contract"
  else
    record_failure "category_contract"
  fi

  expected="$(jq -r --arg mode "$mode" '.platforms[$mode].dt_platform_name' "$RELEASE_VERIFIER_CONTRACT")"
  if json_matches_string "$info_json" '.DTPlatformName' "$expected" &&
     json_matches_contract_array "$info_json" '.CFBundleSupportedPlatforms' ".platforms[\"${mode}\"].supported_platforms"; then
    record_pass "platform_contract"
  else
    record_failure "platform_contract"
  fi

  expected="$(jq -r '.product.backend_url' "$RELEASE_VERIFIER_CONTRACT")"
  local backend_key
  backend_key="$(jq -r '.product.backend_info_key' "$RELEASE_VERIFIER_CONTRACT")"
  if print -r -- "$info_json" | jq -e \
      --arg key "$backend_key" --arg expected "$expected" \
      '.[$key] == $expected and
       ($expected | startswith("https://")) and
       ($expected | contains("@") | not) and
       ($expected | contains("?") | not) and
       ($expected | contains("#") | not)' >/dev/null 2>&1; then
    record_pass "backend_contract"
  else
    record_failure "backend_contract"
  fi

  actual_usage="$(print -r -- "$info_json" | jq -cS \
    'with_entries(select(.key | test("^NS.*UsageDescription$")))' 2>/dev/null)" || actual_usage="invalid"
  expected_usage="$(jq -cS '.product.usage_descriptions' "$RELEASE_VERIFIER_CONTRACT" 2>/dev/null)" || expected_usage="invalid"
  if [[ "$actual_usage" == "$expected_usage" ]]; then
    record_pass "permission_contract"
  else
    record_failure "permission_contract"
  fi

  forbidden_keys="$(jq -c '.forbidden_info_keys' "$RELEASE_VERIFIER_CONTRACT" 2>/dev/null)" || forbidden_keys='[]'
  if print -r -- "$info_json" | jq -e --argjson forbidden "$forbidden_keys" \
      '. as $info | all($forbidden[]; . as $key | ($info | has($key) | not))' >/dev/null 2>&1; then
    record_pass "forbidden_info_keys"
  else
    record_failure "forbidden_info_keys"
  fi

  if print -r -- "$info_json" | jq -e \
      '.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName == "AppIcon"' >/dev/null 2>&1; then
    record_pass "icon_declaration"
  else
    record_failure "icon_declaration"
  fi
}

validate_privacy_manifest() {
  local app_path="$1"
  local manifest_name manifest_path manifest_count manifest_json actual expected

  manifest_name="$(jq -r '.privacy_manifest.filename' "$RELEASE_VERIFIER_CONTRACT")"
  manifest_path="${app_path}/${manifest_name}"
  manifest_count="$(find "$app_path" -maxdepth 1 -type f -name "$manifest_name" -print 2>/dev/null | wc -l | tr -d '[:space:]')"
  if [[ "$manifest_count" == "1" && -f "$manifest_path" && ! -L "$manifest_path" ]]; then
    record_pass "privacy_manifest_presence"
  else
    record_failure "privacy_manifest_presence"
    return 0
  fi

  manifest_json="$(plist_json "$manifest_path")" || {
    record_failure "privacy_manifest_contract"
    return 0
  }
  actual="$(print -r -- "$manifest_json" | jq -cS '.' 2>/dev/null)" || actual="invalid"
  expected="$(jq -cS '.privacy_manifest.expected' "$RELEASE_VERIFIER_CONTRACT" 2>/dev/null)" || expected="invalid"
  if [[ "$actual" == "$expected" ]]; then
    record_pass "privacy_manifest_contract"
  else
    record_failure "privacy_manifest_contract"
  fi
}

validate_bundle_contents() {
  local app_path="$1"
  local executable_name="$2"
  local icon_count

  icon_count="$(find "$app_path" -maxdepth 1 -type f -name 'AppIcon*.png' -size +0c -print 2>/dev/null | wc -l | tr -d '[:space:]')"
  if [[ -s "$app_path/Info.plist" && -s "$app_path/Assets.car" &&
        -s "$app_path/PkgInfo" &&
        "$icon_count" == <1-> && "$icon_count" -ge 1 ]]; then
    record_pass "required_bundle_content"
  else
    record_failure "required_bundle_content"
  fi

  if find "$app_path" -mindepth 1 \
      \( -name '*.xctest' -o -name 'XCTest.framework' -o -name 'XCUIAutomation.framework' \
         -o -name '*.swift' -o -name '*.xcconfig' -o -name '.env' -o -name '.env.*' \
         -o -name '*.p12' -o -name '*.pem' -o -name '*.key' -o -name '*.cer' \
         -o -name 'Local.xcconfig' -o -name 'node_modules' -o -name '.git' \
         -o -path '*/Fixtures/*' -o -name '*Tests.xctest' \) \
      -print -quit 2>/dev/null | grep -q .; then
    record_failure "forbidden_bundle_content"
  else
    record_pass "forbidden_bundle_content"
  fi

  if find "$app_path" -mindepth 1 \
      \( -name '*.app' -o -name '*.appex' -o -name '*.framework' -o -name '*.dylib' \) \
      -print -quit 2>/dev/null | grep -q .; then
    record_failure "unexpected_embedded_code"
  else
    record_pass "unexpected_embedded_code"
  fi

  if find "$app_path" -type l -print -quit 2>/dev/null | grep -q .; then
    record_failure "bundle_symlinks"
  else
    record_pass "bundle_symlinks"
  fi
}

validate_binary() {
  local app_path="$1"
  local executable_name="$2"
  local mode="$3"
  local executable_path="${app_path}/${executable_name}"
  local file_description architectures allowed_architectures architecture
  local linked_libraries binary_strings marker markers_valid=true

  if [[ -f "$executable_path" && ! -L "$executable_path" && -x "$executable_path" && -s "$executable_path" ]]; then
    file_description="$(file -b "$executable_path" 2>/dev/null)" || file_description=""
    if [[ "$file_description" == *"Mach-O"* ]]; then
      record_pass "executable_contract"
    else
      record_failure "executable_contract"
    fi
  else
    record_failure "executable_contract"
    return 0
  fi

  RELEASE_BINARY_SHA256="$(shasum -a 256 "$executable_path" 2>/dev/null | awk '{print $1}')" || RELEASE_BINARY_SHA256=""
  if (( ${#RELEASE_BINARY_SHA256} != 64 )) || [[ "$RELEASE_BINARY_SHA256" == *[^0-9a-f]* ]]; then
    RELEASE_BINARY_SHA256=""
  fi

  architectures="$(lipo -archs "$executable_path" 2>/dev/null)" || architectures=""
  allowed_architectures="$(jq -r --arg mode "$mode" '.platforms[$mode].allowed_architectures[]' "$RELEASE_VERIFIER_CONTRACT" 2>/dev/null)" || allowed_architectures=""
  if [[ -n "$architectures" ]]; then
    local architecture_valid=true
    for architecture in ${(z)architectures}; do
      if ! print -r -- "$allowed_architectures" | grep -Fxq -- "$architecture"; then
        architecture_valid=false
      fi
    done
    if [[ "$architecture_valid" == true ]]; then
      record_pass "architecture_contract"
    else
      record_failure "architecture_contract"
    fi
  else
    record_failure "architecture_contract"
  fi

  linked_libraries="$(otool -L "$executable_path" 2>/dev/null)" || linked_libraries=""
  if [[ -n "$linked_libraries" ]] &&
     ! print -r -- "$linked_libraries" | grep -Eq \
       'XCTest|XCUIAutomation|libclang_rt\.(asan|tsan|ubsan)|Injection|FBSimulatorControl|@rpath|@loader_path'; then
    record_pass "linked_library_contract"
  else
    record_failure "linked_library_contract"
  fi

  binary_strings="$(strings -a "$executable_path" 2>/dev/null)" || binary_strings=""
  while IFS= read -r marker; do
    [[ -z "$marker" ]] && continue
    if print -r -- "$binary_strings" | grep -Fq -- "$marker"; then
      markers_valid=false
      break
    fi
  done < <(jq -r '.forbidden_binary_markers[]' "$RELEASE_VERIFIER_CONTRACT" 2>/dev/null)
  if [[ "$markers_valid" == true ]]; then
    record_pass "release_composition_markers"
  else
    record_failure "release_composition_markers"
  fi

  if print -r -- "$binary_strings" | grep -Eq -- \
      '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|sk-(proj-)?[0-9A-Za-z_-]{24,}|ghp_[0-9A-Za-z]{30,}'; then
    record_failure "credential_pattern_scan"
  else
    record_pass "credential_pattern_scan"
  fi
}

entitlements_json_for_app() {
  local app_path="$1"
  local temporary_plist="$2"

  codesign -d --entitlements :- "$app_path" > "$temporary_plist" 2>/dev/null || return 1
  plist_json "$temporary_plist"
}

validate_code_signature() {
  local app_path="$1"
  local mode="$2"
  local temporary_directory="$3"
  local entitlements_plist="${temporary_directory}/code-entitlements.plist"
  local entitlements_json signature_details expected_identifier expected_environment code_team

  if codesign --verify --deep --strict "$app_path" >/dev/null 2>&1; then
    record_pass "code_signature_integrity"
  else
    record_failure "code_signature_integrity"
  fi

  signature_details="$(codesign -dv --verbose=4 "$app_path" 2>&1)" || signature_details=""
  expected_identifier="$(jq -r '.product.bundle_identifier' "$RELEASE_VERIFIER_CONTRACT")"
  if ! print -r -- "$signature_details" | grep -Fxq -- "Identifier=${expected_identifier}"; then
    record_failure "signing_identity_contract"
  elif [[ "$mode" == "simulator-app" ]]; then
    record_pass "signing_identity_contract"
  elif print -r -- "$signature_details" | grep -Fq 'Signature=adhoc' ||
       print -r -- "$signature_details" | grep -Fq 'TeamIdentifier=not set' ||
       ! print -r -- "$signature_details" | grep -Fq 'Authority=Apple Distribution'; then
    record_failure "signing_identity_contract"
  else
    record_pass "signing_identity_contract"
  fi

  entitlements_json="$(entitlements_json_for_app "$app_path" "$entitlements_plist")" || {
    record_failure "entitlement_contract"
    return 0
  }
  if [[ "$mode" == "simulator-app" ]]; then
    if print -r -- "$entitlements_json" | jq -e \
        '(."get-task-allow" != true) and
         (."com.apple.developer.devicecheck.appattest-environment" != "development")' >/dev/null 2>&1; then
      record_pass "entitlement_contract"
    else
      record_failure "entitlement_contract"
    fi
    return 0
  fi

  expected_environment="$(jq -r '.platforms["distribution-signed-archive"].app_attest_environment' "$RELEASE_VERIFIER_CONTRACT")"
  code_team="$(print -r -- "$signature_details" | sed -n 's/^TeamIdentifier=//p' | sed -n '1p')"
  if [[ -n "$code_team" ]] && print -r -- "$entitlements_json" | jq -e \
      --arg environment "$expected_environment" \
      --arg team "$code_team" \
      --arg identifier "$expected_identifier" \
      '(."get-task-allow" != true) and
       (."com.apple.developer.devicecheck.appattest-environment" == $environment) and
       (."com.apple.developer.team-identifier" == $team) and
       (."application-identifier" as $applicationIdentifier |
        ($applicationIdentifier | type == "string") and
        ($applicationIdentifier | endswith("." + $identifier)) and
        ($applicationIdentifier != ("." + $identifier)))' >/dev/null 2>&1; then
    record_pass "entitlement_contract"
  else
    record_failure "entitlement_contract"
  fi
}

normalized_dsym_uuids() {
  dwarfdump --uuid "$1" 2>/dev/null | awk '/^UUID:/ { print $1, $2, $3 }' | sort
}

validate_dsym() {
  local executable_path="$1"
  local dsym_path="$2"
  local executable_name="$3"
  local dsym_binary="${dsym_path}/Contents/Resources/DWARF/${executable_name}"
  local binary_uuids dsym_uuids

  if [[ ! -d "$dsym_path" || -L "$dsym_path" || ! -s "$dsym_binary" ]]; then
    record_failure "dsym_contract"
    return 0
  fi
  binary_uuids="$(normalized_dsym_uuids "$executable_path")" || binary_uuids=""
  dsym_uuids="$(normalized_dsym_uuids "$dsym_binary")" || dsym_uuids=""
  if [[ -n "$binary_uuids" && "$binary_uuids" == "$dsym_uuids" ]]; then
    record_pass "dsym_contract"
  else
    record_failure "dsym_contract"
  fi
}

profile_expiration_is_future() {
  local profile_plist="$1"
  local expiration expiration_epoch current_epoch

  expiration="$(plutil -extract ExpirationDate raw -o - "$profile_plist" 2>/dev/null)" || return 1
  expiration_epoch="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$expiration" '+%s' 2>/dev/null)" ||
    expiration_epoch="$(date -j -u -f '%Y-%m-%d %H:%M:%S %z' "$expiration" '+%s' 2>/dev/null)" || return 1
  current_epoch="$(date '+%s' 2>/dev/null)" || return 1
  [[ "$expiration_epoch" == <1-> && "$current_epoch" == <1-> && "$expiration_epoch" -gt "$current_epoch" ]]
}

signing_certificate_matches_profile() {
  local app_path="$1"
  local profile_plist="$2"
  local temporary_directory="$3"
  local signer_prefix="${temporary_directory}/signer-certificate-"
  local signer_certificate="${signer_prefix}0"
  local profile_certificate="${temporary_directory}/profile-certificate.der"
  local signer_hash profile_hash certificate_data
  local certificate_count certificate_index

  codesign -d --extract-certificates "$signer_prefix" "$app_path" >/dev/null 2>&1 || return 1
  [[ -s "$signer_certificate" ]] || return 1
  signer_hash="$(shasum -a 256 "$signer_certificate" 2>/dev/null | awk '{print $1}')" || return 1
  certificate_count="$(plutil -extract DeveloperCertificates raw -o - "$profile_plist" 2>/dev/null)" || return 1
  [[ "$certificate_count" == <1-> && "$certificate_count" -gt 0 ]] || return 1

  for (( certificate_index = 0; certificate_index < certificate_count; certificate_index++ )); do
    certificate_data="$(plutil -extract "DeveloperCertificates.${certificate_index}" raw -o - "$profile_plist" 2>/dev/null)" || return 1
    if ! print -rn -- "$certificate_data" | base64 -D > "$profile_certificate" 2>/dev/null; then
      return 1
    fi
    profile_hash="$(shasum -a 256 "$profile_certificate" 2>/dev/null | awk '{print $1}')" || return 1
    [[ "$profile_hash" == "$signer_hash" ]] && return 0
  done
  return 1
}

validate_provisioning_profile() {
  local app_path="$1"
  local temporary_directory="$2"
  local profile_path="${app_path}/embedded.mobileprovision"
  local decoded_profile="${temporary_directory}/embedded-profile.plist"
  local code_entitlements_plist="${temporary_directory}/profile-code-entitlements.plist"
  local signature_details code_team expected_identifier expected_environment
  local profile_teams profile_prefixes profile_prefix profile_app_identifier profile_team_identifier
  local profile_app_attest profile_get_task_allow
  local profile_beta_reports_active required_beta_reports_active
  local code_entitlements_json code_app_identifier identifier_suffix
  local profile_has_provisioned_devices=false
  local profile_has_provisions_all_devices=false

  if [[ ! -s "$profile_path" || -L "$profile_path" ]]; then
    record_failure "provisioning_profile_contract"
    return 0
  fi
  if ! security cms -D -i "$profile_path" > "$decoded_profile" 2>/dev/null; then
    record_failure "provisioning_profile_contract"
    return 0
  fi
  profile_teams="$(plutil -extract TeamIdentifier json -o - "$decoded_profile" 2>/dev/null)" || {
    record_failure "provisioning_profile_contract"
    return 0
  }
  profile_prefixes="$(plutil -extract ApplicationIdentifierPrefix json -o - "$decoded_profile" 2>/dev/null)" || profile_prefixes='[]'
  profile_app_identifier="$(plutil -extract 'Entitlements.application-identifier' raw -o - "$decoded_profile" 2>/dev/null)" || profile_app_identifier=""
  profile_team_identifier="$(plutil -extract 'Entitlements.com\.apple\.developer\.team-identifier' raw -o - "$decoded_profile" 2>/dev/null)" || profile_team_identifier=""
  profile_app_attest="$(plutil -extract 'Entitlements.com\.apple\.developer\.devicecheck\.appattest-environment' raw -o - "$decoded_profile" 2>/dev/null)" || profile_app_attest=""
  profile_get_task_allow="$(plutil -extract 'Entitlements.get-task-allow' raw -o - "$decoded_profile" 2>/dev/null)" || profile_get_task_allow="missing"
  profile_beta_reports_active="$(plutil -extract 'Entitlements.beta-reports-active' raw -o - "$decoded_profile" 2>/dev/null)" || profile_beta_reports_active="missing"
  if plutil -extract ProvisionedDevices json -o - "$decoded_profile" >/dev/null 2>&1; then
    profile_has_provisioned_devices=true
  fi
  if plutil -extract ProvisionsAllDevices raw -o - "$decoded_profile" >/dev/null 2>&1; then
    profile_has_provisions_all_devices=true
  fi
  code_entitlements_json="$(entitlements_json_for_app "$app_path" "$code_entitlements_plist")" || code_entitlements_json='{}'
  code_app_identifier="$(print -r -- "$code_entitlements_json" | jq -r '."application-identifier" // empty' 2>/dev/null)" || code_app_identifier=""
  signature_details="$(codesign -dv --verbose=4 "$app_path" 2>&1)" || signature_details=""
  code_team="$(print -r -- "$signature_details" | sed -n 's/^TeamIdentifier=//p' | sed -n '1p')"
  expected_identifier="$(jq -r '.product.bundle_identifier' "$RELEASE_VERIFIER_CONTRACT")"
  expected_environment="$(jq -r '.platforms["distribution-signed-archive"].app_attest_environment' "$RELEASE_VERIFIER_CONTRACT")"
  required_beta_reports_active="$(jq -r '.platforms["distribution-signed-archive"].requires_beta_reports_active' "$RELEASE_VERIFIER_CONTRACT")"
  identifier_suffix=".${expected_identifier}"
  if [[ "$profile_app_identifier" == *"$identifier_suffix" ]]; then
    profile_prefix="${profile_app_identifier%$identifier_suffix}"
  else
    profile_prefix=""
  fi

  if [[ -n "$code_team" ]] && profile_expiration_is_future "$decoded_profile" &&
     signing_certificate_matches_profile "$app_path" "$decoded_profile" "$temporary_directory" &&
     print -r -- "$profile_teams" | jq -e --arg team "$code_team" \
       'type == "array" and index($team) != null' >/dev/null 2>&1 &&
     print -r -- "$profile_prefixes" | jq -e --arg prefix "$profile_prefix" \
       'type == "array" and index($prefix) != null' >/dev/null 2>&1 &&
     [[ "$profile_team_identifier" == "$code_team" &&
        -n "$profile_prefix" &&
        "$profile_app_identifier" == "$code_app_identifier" &&
        "$profile_app_attest" == "$expected_environment" &&
        "$profile_get_task_allow" == "false" &&
        "$required_beta_reports_active" == "true" &&
        "$profile_beta_reports_active" == "true" &&
        "$profile_has_provisioned_devices" == "false" &&
        "$profile_has_provisions_all_devices" == "false" ]]; then
    record_pass "provisioning_profile_contract"
  else
    record_failure "provisioning_profile_contract"
  fi
}

validate_archive_metadata() {
  local archive_info="$1"
  local expected_application_path expected_identifier expected_version expected_build
  local archive_version archive_name scheme_name application_path
  local bundle_identifier marketing_version build_number

  expected_application_path="$(jq -r '.platforms["distribution-signed-archive"].application_path' "$RELEASE_VERIFIER_CONTRACT")"
  expected_identifier="$(jq -r '.product.bundle_identifier' "$RELEASE_VERIFIER_CONTRACT")"
  expected_version="$(jq -r '.product.marketing_version' "$RELEASE_VERIFIER_CONTRACT")"
  expected_build="$(jq -r '.product.build_number' "$RELEASE_VERIFIER_CONTRACT")"

  archive_version="$(plutil -extract ArchiveVersion raw -o - "$archive_info" 2>/dev/null)" || archive_version=""
  archive_name="$(plutil -extract Name raw -o - "$archive_info" 2>/dev/null)" || archive_name=""
  scheme_name="$(plutil -extract SchemeName raw -o - "$archive_info" 2>/dev/null)" || scheme_name=""
  application_path="$(plutil -extract ApplicationProperties.ApplicationPath raw -o - "$archive_info" 2>/dev/null)" || application_path=""
  bundle_identifier="$(plutil -extract ApplicationProperties.CFBundleIdentifier raw -o - "$archive_info" 2>/dev/null)" || bundle_identifier=""
  marketing_version="$(plutil -extract ApplicationProperties.CFBundleShortVersionString raw -o - "$archive_info" 2>/dev/null)" || marketing_version=""
  build_number="$(plutil -extract ApplicationProperties.CFBundleVersion raw -o - "$archive_info" 2>/dev/null)" || build_number=""

  if [[ "$archive_version" == "2" &&
        "$archive_name" == "TrailMind" &&
        "$scheme_name" == "TrailMind" &&
        "$application_path" == "$expected_application_path" &&
        "$bundle_identifier" == "$expected_identifier" &&
        "$marketing_version" == "$expected_version" &&
        "$build_number" == "$expected_build" ]]; then
    record_pass "archive_metadata_contract"
  else
    record_failure "archive_metadata_contract"
  fi
}

verify_release_artifact() {
  local mode="$1"
  local artifact_input="$2"
  local temporary_directory="$3"
  local artifact_path app_path archive_info expected_application_path
  local info_path info_json executable_name executable_path dsym_path

  if [[ "$mode" != "simulator-app" && "$mode" != "distribution-signed-archive" ]]; then
    record_failure "invocation_contract"
    return 0
  fi
  record_pass "invocation_contract"

  if [[ ! -e "$artifact_input" || -L "$artifact_input" ]]; then
    record_failure "artifact_path_contract"
    return 0
  fi
  artifact_path="${artifact_input:A}"
  record_pass "artifact_path_contract"

  if [[ "$mode" == "simulator-app" ]]; then
    RELEASE_ARTIFACT_KIND="app"
    if [[ ! -d "$artifact_path" || "${artifact_path:t:e}" != "app" ]]; then
      record_failure "artifact_type_contract"
      return 0
    fi
    app_path="$artifact_path"
    dsym_path="${artifact_path}.dSYM"
    record_pass "artifact_type_contract"
  else
    RELEASE_ARTIFACT_KIND="xcarchive"
    if [[ ! -d "$artifact_path" || "${artifact_path:t:e}" != "xcarchive" ]]; then
      record_failure "artifact_type_contract"
      return 0
    fi
    record_pass "artifact_type_contract"
    archive_info="${artifact_path}/Info.plist"
    if [[ ! -f "$archive_info" || -L "$archive_info" ]] ||
       ! plutil -lint "$archive_info" >/dev/null 2>&1; then
      record_failure "archive_metadata_contract"
      return 0
    fi
    validate_archive_metadata "$archive_info"
    expected_application_path="$(jq -r '.platforms["distribution-signed-archive"].application_path' "$RELEASE_VERIFIER_CONTRACT")"
    if [[ "$expected_application_path" == /* || "$expected_application_path" == *'..'* ||
          "$expected_application_path" != Applications/*.app ]]; then
      record_failure "archive_app_resolution"
      return 0
    fi
    app_path="${artifact_path}/Products/${expected_application_path}"
    if [[ ! -d "$app_path" || -L "$app_path" ||
          "${app_path:A}" != "${artifact_path:A}/Products/${expected_application_path}" ]]; then
      record_failure "archive_app_resolution"
      return 0
    fi
    record_pass "archive_app_resolution"
    dsym_path="${artifact_path}/dSYMs/TrailMind.app.dSYM"
  fi

  info_path="${app_path}/Info.plist"
  info_json="$(plist_json "$info_path")" || {
    record_failure "info_plist_contract"
    return 0
  }
  if print -r -- "$info_json" | jq -e 'type == "object"' >/dev/null 2>&1; then
    record_pass "info_plist_contract"
  else
    record_failure "info_plist_contract"
    return 0
  fi

  validate_info_contract "$info_json" "$mode"
  validate_privacy_manifest "$app_path"

  executable_name="$(print -r -- "$info_json" | jq -r '.CFBundleExecutable // empty' 2>/dev/null)"
  if [[ -z "$executable_name" || "$executable_name" == */* || "$executable_name" != "TrailMind" ]]; then
    record_failure "executable_name_contract"
    return 0
  fi
  record_pass "executable_name_contract"

  validate_bundle_contents "$app_path" "$executable_name"
  validate_binary "$app_path" "$executable_name" "$mode"
  executable_path="${app_path}/${executable_name}"
  validate_code_signature "$app_path" "$mode" "$temporary_directory"
  validate_dsym "$executable_path" "$dsym_path" "$executable_name"

  if [[ "$mode" == "distribution-signed-archive" ]]; then
    validate_provisioning_profile "$app_path" "$temporary_directory"
  fi

  # Detect time-of-check mutation or late signature breakage.
  if codesign --verify --deep --strict "$app_path" >/dev/null 2>&1; then
    record_pass "final_signature_recheck"
  else
    record_failure "final_signature_recheck"
  fi
}

main() {
  local requested_mode="${1:-invalid}"
  local artifact_input="${2:-}"
  local report_path
  local temporary_directory=""
  local final_status reason

  case "$requested_mode" in
    simulator-app|distribution-signed-archive)
      RELEASE_MODE="$requested_mode"
      ;;
    *)
      RELEASE_MODE="invalid"
      ;;
  esac
  report_path="${TRAILMIND_RELEASE_REPORT_PATH:-/private/tmp/trailmind-release-verification/${RELEASE_MODE}-summary.json}"
  rm -f -- "$report_path" 2>/dev/null

  trap '[[ -n "${temporary_directory:-}" ]] && rm -rf -- "$temporary_directory" 2>/dev/null; rm -f -- "$report_path" 2>/dev/null; exit 130' INT
  trap '[[ -n "${temporary_directory:-}" ]] && rm -rf -- "$temporary_directory" 2>/dev/null; rm -f -- "$report_path" 2>/dev/null; exit 143' TERM

  if ! required_commands_available; then
    record_failure "required_tools"
    print_release_summary "infrastructure_failed"
    return 1
  fi
  record_pass "required_tools"

  if ! contract_is_valid; then
    record_failure "release_contract"
    final_status="infrastructure_failed"
    reason="release_contract"
    if write_release_report "$report_path" "$final_status" "$reason" >/dev/null 2>&1; then
      RELEASE_REPORT_STATE="written"
    fi
    print_release_summary "$final_status"
    return 1
  fi
  record_pass "release_contract"

  if (( $# != 2 )); then
    record_failure "invocation_contract"
  else
    temporary_directory="$(mktemp -d /private/tmp/trailmind-release-verifier.XXXXXX 2>/dev/null)" || temporary_directory=""
    if [[ -z "$temporary_directory" ]]; then
      record_failure "temporary_workspace"
    else
      record_pass "temporary_workspace"
      verify_release_artifact "$requested_mode" "$artifact_input" "$temporary_directory"
    fi
  fi

  if (( ${#RELEASE_FAILED_CHECKS[@]} == 0 )); then
    final_status="passed"
    reason="artifact_verified"
  else
    final_status="failed"
    reason="${RELEASE_FAILED_CHECKS[1]}"
  fi

  if write_release_report "$report_path" "$final_status" "$reason"; then
    RELEASE_REPORT_STATE="written"
  else
    record_once_failure "machine_report"
    final_status="infrastructure_failed"
    RELEASE_REPORT_STATE="unavailable"
  fi
  print_release_summary "$final_status"
  [[ -n "$temporary_directory" ]] && rm -rf -- "$temporary_directory" 2>/dev/null
  temporary_directory=""
  [[ "$final_status" == "passed" ]]
}

main "$@"
