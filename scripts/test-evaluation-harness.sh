#!/usr/bin/env zsh
set -euo pipefail
unsetopt BG_NICE

stub_machine_summary() {
  local evaluation="$1"
  local total_count="$2"
  local passed_count="$3"
  local failed_count="$4"
  local skipped_count="$5"
  local provider_proof="$6"

  jq -cn \
    --arg evaluation "$evaluation" \
    --argjson total_count "$total_count" \
    --argjson passed_count "$passed_count" \
    --argjson failed_count "$failed_count" \
    --argjson skipped_count "$skipped_count" \
    --argjson provider_proof "$provider_proof" \
    '{
      schema_version: 1,
      evaluation: $evaluation,
      total_count: $total_count,
      passed_count: $passed_count,
      failed_count: $failed_count,
      skipped_count: $skipped_count,
      provider_proof: $provider_proof
    }'
}

stub_xcodebuild() {
  local scenario="${TRAILMIND_EVAL_STUB_SCENARIO:-pass}"
  local result_bundle=""
  local destination=""
  local selected_path=""
  local argument

  if [[ "$scenario" == "timeout" ]]; then
    sleep 5
    return 0
  fi

  while (( $# > 0 )); do
    argument="$1"
    case "$argument" in
      -resultBundlePath)
        shift
        result_bundle="$1"
        ;;
      -destination)
        shift
        destination="$1"
        ;;
      -only-testing:TrailMindTests/*)
        selected_path="${argument#-only-testing:TrailMindTests/}"
        ;;
    esac
    shift
  done

  if [[ "${TRAILMIND_EVAL_STUB_REQUIRE_DISCOVERED_DESTINATION:-0}" == "1" &&
        "$destination" != "platform=iOS Simulator,id=SIM-BOOTED-STUB" ]]; then
    return 67
  fi

  [[ -n "$result_bundle" && -n "$selected_path" ]] || return 68

  local test_class="${selected_path%%/*}"
  local test_method="${selected_path#*/}"
  local selected_identifier="${test_class}/${test_method}()"
  local evaluation
  local total_count
  local passed_count
  local failed_count
  local skipped_count
  local provider_proof
  local test_result="Passed"

  case "$test_class" in
    IntentEvaluationTests)
      evaluation="intent"
      total_count=40
      ;;
    RouteQualityEvaluationTests)
      evaluation="route-quality"
      total_count=20
      ;;
    *)
      return 69
      ;;
  esac

  passed_count="$total_count"
  failed_count=0
  skipped_count=0
  provider_proof=true

  if [[ "$test_method" == "testEvaluationHarnessControl" ]]; then
    total_count=1
    provider_proof=false
    case "${TEST_RUNNER_TRAILMIND_EVAL_HARNESS_MODE:-}" in
      pass)
        passed_count=1
        failed_count=0
        skipped_count=0
        test_result="Passed"
        ;;
      skip)
        passed_count=0
        failed_count=0
        skipped_count=1
        test_result="Skipped"
        ;;
      fail)
        passed_count=0
        failed_count=1
        skipped_count=0
        test_result="Failed"
        ;;
      *)
        return 70
        ;;
    esac
  fi

  case "$scenario" in
    force_fail)
      test_result="Failed"
      passed_count=0
      failed_count="$total_count"
      skipped_count=0
      ;;
    force_skip)
      test_result="Skipped"
      passed_count=0
      failed_count=0
      skipped_count="$total_count"
      ;;
  esac

  if [[ "$scenario" != "missing_result_bundle" ]]; then
    mkdir -p "$result_bundle"
    jq -n \
      --arg selected_identifier "$selected_identifier" \
      --arg test_result "$test_result" \
      '{selected_identifier: $selected_identifier, test_result: $test_result}' \
      > "${result_bundle}/stub-metadata.json"
  fi

  local marker_payload
  marker_payload="$(stub_machine_summary \
    "$evaluation" "$total_count" "$passed_count" "$failed_count" \
    "$skipped_count" "$provider_proof")"

  case "$scenario" in
    missing_marker)
      ;;
    malformed_marker)
      print -r -- 'TRAILMIND_EVAL_MACHINE_SUMMARY:{malformed'
      ;;
    duplicate_marker)
      print -r -- "TRAILMIND_EVAL_MACHINE_SUMMARY:${marker_payload}"
      print -r -- "TRAILMIND_EVAL_MACHINE_SUMMARY:${marker_payload}"
      ;;
    inconsistent_marker)
      marker_payload="$(stub_machine_summary \
        "$evaluation" "$total_count" "$total_count" 1 0 "$provider_proof")"
      print -r -- "TRAILMIND_EVAL_MACHINE_SUMMARY:${marker_payload}"
      ;;
    extra_field_marker)
      marker_payload="$(print -r -- "$marker_payload" | jq -c '. + {private_prompt: "must-not-be-accepted"}')"
      print -r -- "TRAILMIND_EVAL_MACHINE_SUMMARY:${marker_payload}"
      ;;
    wrong_count)
      marker_payload="$(stub_machine_summary \
        "$evaluation" "$((total_count - 1))" "$((total_count - 1))" 0 0 "$provider_proof")"
      print -r -- "TRAILMIND_EVAL_MACHINE_SUMMARY:${marker_payload}"
      ;;
    wrong_evaluation)
      marker_payload="$(stub_machine_summary \
        "wrong-evaluation" "$total_count" "$passed_count" "$failed_count" \
        "$skipped_count" "$provider_proof")"
      print -r -- "TRAILMIND_EVAL_MACHINE_SUMMARY:${marker_payload}"
      ;;
    proof_false)
      marker_payload="$(stub_machine_summary \
        "$evaluation" "$total_count" "$passed_count" "$failed_count" \
        "$skipped_count" false)"
      print -r -- "TRAILMIND_EVAL_MACHINE_SUMMARY:${marker_payload}"
      ;;
    sensitive_failure)
      print -r -- "${TRAILMIND_EVAL_SENSITIVE_MARKER:-private-sensitive-output}"
      print -r -- "TRAILMIND_EVAL_MACHINE_SUMMARY:${marker_payload}"
      ;;
    *)
      print -r -- "TRAILMIND_EVAL_MACHINE_SUMMARY:${marker_payload}"
      ;;
  esac

  case "$scenario" in
    xcode_nonzero_after_pass)
      return 65
      ;;
  esac
  [[ "$test_result" == "Failed" || "$test_result" == "Expected Failure" ]] && return 65
  return 0
}

stub_xcrun() {
  local scenario="${TRAILMIND_EVAL_STUB_SCENARIO:-pass}"

  if [[ "${1:-}" == "simctl" ]]; then
    jq -n '{
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
          {
            name: "iPhone Stub Shutdown",
            udid: "SIM-SHUTDOWN-STUB",
            state: "Shutdown",
            isAvailable: true
          },
          {
            name: "iPhone Stub Booted",
            udid: "SIM-BOOTED-STUB",
            state: "Booted",
            isAvailable: true
          }
        ]
      }
    }'
    return 0
  fi

  [[ "${1:-}" == "xcresulttool" ]] || return 71
  [[ "$scenario" != "xcresult_command_failure" ]] || return 1

  local result_bundle=""
  while (( $# > 0 )); do
    if [[ "$1" == "--path" ]]; then
      shift
      result_bundle="$1"
    fi
    shift
  done
  [[ -n "$result_bundle" ]] || return 72

  if [[ "$scenario" == "malformed_xcresult" ]]; then
    print -r -- '{malformed'
    return 0
  fi

  local selected_identifier
  local test_result
  selected_identifier="$(jq -r '.selected_identifier' "${result_bundle}/stub-metadata.json")"
  test_result="$(jq -r '.test_result' "${result_bundle}/stub-metadata.json")"

  if [[ "$scenario" == "missing_selected_test" ]]; then
    print -r -- '{"testNodes":[]}'
    return 0
  fi

  if [[ "$scenario" == "duplicate_selected_test" ]]; then
    jq -n \
      --arg selected_identifier "$selected_identifier" \
      --arg test_result "$test_result" \
      '{testNodes: [
        {nodeType: "Test Case", nodeIdentifier: $selected_identifier, result: $test_result},
        {nodeType: "Test Case", nodeIdentifier: $selected_identifier, result: $test_result}
      ]}'
    return 0
  fi

  jq -n \
    --arg selected_identifier "$selected_identifier" \
    --arg test_result "$test_result" \
    '{testNodes: [{
      nodeType: "Test Suite",
      children: [{
        nodeType: "Test Case",
        nodeIdentifier: $selected_identifier,
        result: $test_result
      }]
    }]}'
}

stub_mktemp() {
  if [[ "${TRAILMIND_EVAL_STUB_SCENARIO:-}" == "mktemp_failure" ]]; then
    return 1
  fi
  "${TRAILMIND_EVAL_REAL_MKTEMP:?}" "$@"
}

stub_jq() {
  if [[ "${TRAILMIND_EVAL_STUB_SCENARIO:-}" == "initial_report_pause" &&
        ! -e "${TRAILMIND_EVAL_STUB_INITIAL_PAUSE_STATE:?}" ]]; then
    print -r -- "paused" > "$TRAILMIND_EVAL_STUB_INITIAL_PAUSE_STATE"
    while [[ ! -e "${TRAILMIND_EVAL_STUB_INITIAL_INTERRUPT:?}" ]]; do
      sleep 0.01
    done
    kill -TERM "$PPID"
    return 143
  fi
  "${TRAILMIND_EVAL_REAL_JQ:?}" "$@"
}

case "${0:t}" in
  xcodebuild)
    stub_xcodebuild "$@"
    exit $?
    ;;
  xcrun)
    stub_xcrun "$@"
    exit $?
    ;;
  mktemp)
    stub_mktemp "$@"
    exit $?
    ;;
  jq)
    stub_jq "$@"
    exit $?
    ;;
esac

cd "$(dirname "$0")/.."
source scripts/evaluation-harness.sh

real_mktemp="$(command -v mktemp)"
real_jq="$(command -v jq)"
work_directory="$("$real_mktemp" -d /private/tmp/trailmind-evaluation-harness-tests.XXXXXX)"
trap 'rm -rf "$work_directory"' EXIT INT TERM

script_path="${PWD}/scripts/test-evaluation-harness.sh"
stub_bin="${work_directory}/stub-bin"
mkdir -p "$stub_bin"
ln -s "$script_path" "${stub_bin}/xcodebuild"
ln -s "$script_path" "${stub_bin}/xcrun"
ln -s "$script_path" "${stub_bin}/mktemp"
ln -s "$script_path" "${stub_bin}/jq"
export TRAILMIND_EVAL_REAL_MKTEMP="$real_mktemp"
export TRAILMIND_EVAL_REAL_JQ="$real_jq"
export PATH="${stub_bin}:${PATH}"

selected_identifier="IntentEvaluationTests/testEvaluationHarnessControl()"
command_counter=0
LAST_COMMAND_OUTPUT=""

fail_check() {
  print -u2 -r -- "$1"
  exit 1
}

expect_status() {
  local expected_status="$1"
  shift
  command_counter=$((command_counter + 1))
  LAST_COMMAND_OUTPUT="${work_directory}/command-${command_counter}.log"
  set +e
  "$@" > "$LAST_COMMAND_OUTPUT" 2>&1
  local actual_status=$?
  set -e
  [[ "$actual_status" == "$expected_status" ]] || {
    print -u2 -r -- "Expected status ${expected_status}, got ${actual_status}."
    print -u2 -r -- "Command output follows:"
    sed -n '1,120p' "$LAST_COMMAND_OUTPUT" >&2
    exit 1
  }
}

assert_report() {
  local report_path="$1"
  local expression="$2"
  jq -e "$expression" "$report_path" >/dev/null || \
    fail_check "Report assertion failed for ${report_path}."
}

seed_passed_report() {
  local output_path="$1"
  local run_id="$2"
  write_evaluation_report "$output_path" "intent" "live_provider" \
    "TrailMindTests/IntentEvaluationTests" "testLiveRemoteAIIntentEvalWhenEnabled" \
    true 40 40 40 0 0 "passed" 60 "fixture_baseline_executed_and_passed" true \
    "Passed" 1 1 0 0 "$run_id" 1
}

make_result() {
  local output_path="$1"
  local result="$2"
  jq -n \
    --arg identifier "$selected_identifier" \
    --arg result "$result" \
    '{testNodes: [{
      nodeType: "Test Suite",
      name: "IntentEvaluationTests",
      children: [{
        nodeType: "Test Case",
        name: "testEvaluationHarnessControl()",
        nodeIdentifier: $identifier,
        result: $result
      }]
    }]}' > "$output_path"
}

make_result "$work_directory/passed.json" "Passed"
evaluation_result_from_json "$work_directory/passed.json" "$selected_identifier"
[[ "$EVALUATION_TEST_RESULT" == "Passed" ]]

make_result "$work_directory/skipped.json" "Skipped"
evaluation_result_from_json "$work_directory/skipped.json" "$selected_identifier"
[[ "$EVALUATION_TEST_RESULT" == "Skipped" ]]

make_result "$work_directory/failed.json" "Failed"
evaluation_result_from_json "$work_directory/failed.json" "$selected_identifier"
[[ "$EVALUATION_TEST_RESULT" == "Failed" ]]

print -r -- '{"testNodes":[]}' > "$work_directory/missing.json"
if evaluation_result_from_json "$work_directory/missing.json" "$selected_identifier"; then
  fail_check "Missing selected test was accepted."
fi

print -r -- '{malformed' > "$work_directory/malformed.json"
if evaluation_result_from_json "$work_directory/malformed.json" "$selected_identifier"; then
  fail_check "Malformed result data was accepted."
fi

jq -s '{testNodes: [.[0].testNodes[0], .[0].testNodes[0]]}' \
  "$work_directory/passed.json" > "$work_directory/duplicate.json"
if evaluation_result_from_json "$work_directory/duplicate.json" "$selected_identifier"; then
  fail_check "Duplicate selected test records were accepted."
fi

valid_marker_payload="$(stub_machine_summary intent 40 40 0 0 true)"
print -r -- "${TRAILMIND_EVAL_MACHINE_MARKER}${valid_marker_payload}" \
  > "$work_directory/valid-marker.log"
evaluation_fixture_summary_from_log "$work_directory/valid-marker.log" intent
[[ "$EVALUATION_FIXTURE_TOTAL" == "40" ]]
[[ "$EVALUATION_FIXTURE_PASSED" == "40" ]]
[[ "$EVALUATION_FIXTURE_PROVIDER_PROOF" == "true" ]]

sensitive_marker="private-prompt-coordinate-provider-response"
report_path="$work_directory/redacted-report.json"
write_evaluation_report "$report_path" "intent" "deterministic_harness" \
  "TrailMindTests/IntentEvaluationTests" "testEvaluationHarnessControl" \
  true 1 1 1 0 0 "passed" 1 "fixture_baseline_executed_and_passed" false \
  "Passed" 1 1 0 0 "test-run" 1

if grep -F "$sensitive_marker" "$report_path" >/dev/null; then
  fail_check "Sensitive marker leaked into the machine report."
fi

assert_report "$report_path" '
  .schema_version == 2 and .run_id == "test-run" and .started_at == 1 and
  .configured == true and .is_terminal == true and
  .fixture_total == 1 and
  .executed_count == 1 and
  .passed_count == 1 and
  .failed_count == 0 and
  .skipped_count == 0 and
  .selected_test_result == "Passed" and
  .selected_test_passed_count == 1 and
  .final_status == "passed" and
  .provider_proof == false
'

intent_not_run="$work_directory/intent-not-run.json"
expect_status 2 env \
  -u TRAILMIND_EVAL_CREDENTIALS_CONTAINED \
  -u TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_REPORT_PATH="$intent_not_run" \
  scripts/run-intent-eval.sh
assert_report "$intent_not_run" '
  .schema_version == 2 and (.run_id | length) > 0 and
  (.started_at | type) == "number" and .is_terminal == true and
  .configured == false and .fixture_total == 0 and
  .final_status == "not_run" and .provider_proof == false
'

route_not_run="$work_directory/route-not-run.json"
expect_status 2 env \
  -u TRAILMIND_EVAL_CREDENTIALS_CONTAINED \
  -u TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_REPORT_PATH="$route_not_run" \
  scripts/run-route-quality-eval.sh
assert_report "$route_not_run" '.final_status == "not_run" and .provider_proof == false'

single_gate_a="$work_directory/single-gate-a.json"
expect_status 2 env \
  -u TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_CREDENTIALS_CONTAINED=1 \
  TRAILMIND_EVAL_REPORT_PATH="$single_gate_a" \
  scripts/run-intent-eval.sh
assert_report "$single_gate_a" '.final_status == "not_run"'

single_gate_b="$work_directory/single-gate-b.json"
expect_status 2 env \
  -u TRAILMIND_EVAL_CREDENTIALS_CONTAINED \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED=1 \
  TRAILMIND_EVAL_REPORT_PATH="$single_gate_b" \
  scripts/run-route-quality-eval.sh
assert_report "$single_gate_b" '.final_status == "not_run"'

public_harness="$work_directory/public-harness.json"
expect_status 2 env \
  TRAILMIND_EVAL_HARNESS_MODE=pass \
  TRAILMIND_EVAL_REPORT_PATH="$public_harness" \
  scripts/run-intent-eval.sh
assert_report "$public_harness" '
  .final_status == "invalid_configuration" and
  .reason == "harness_mode_forbidden_for_public_runner" and
  .provider_proof == false
'

stale_initial_report="$work_directory/stale-initial-render.json"
initial_pause_state="$work_directory/initial-render-paused"
initial_interrupt="$work_directory/interrupt-initial-render"
initial_output="$work_directory/initial-render-interruption.log"
seed_passed_report "$stale_initial_report" "stale-passed-initial-render"
env \
  -u TRAILMIND_EVAL_CREDENTIALS_CONTAINED \
  -u TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_STUB_SCENARIO=initial_report_pause \
  TRAILMIND_EVAL_STUB_INITIAL_PAUSE_STATE="$initial_pause_state" \
  TRAILMIND_EVAL_STUB_INITIAL_INTERRUPT="$initial_interrupt" \
  TRAILMIND_EVAL_REPORT_PATH="$stale_initial_report" \
  scripts/run-intent-eval.sh > "$initial_output" 2>&1 &
initial_pid=$!

for _ in {1..200}; do
  [[ -e "$initial_pause_state" ]] && break
  sleep 0.01
done
[[ -e "$initial_pause_state" ]] || {
  kill -TERM "$initial_pid" >/dev/null 2>&1 || true
  wait "$initial_pid" >/dev/null 2>&1 || true
  fail_check "The initial report render did not reach the deterministic pause."
}
[[ ! -e "$stale_initial_report" ]] || {
  touch "$initial_interrupt"
  wait "$initial_pid" >/dev/null 2>&1 || true
  fail_check "A stale passed report survived until the initial report render."
}

touch "$initial_interrupt"
set +e
wait "$initial_pid"
initial_status=$?
set -e
[[ "$initial_status" == "143" ]] || {
  print -u2 -r -- "Expected interrupted initial render status 143, got ${initial_status}."
  sed -n '1,120p' "$initial_output" >&2
  exit 1
}
[[ ! -e "$stale_initial_report" ]] || \
  fail_check "A stale passed report reappeared after the interrupted initial render."

stale_mktemp_report="$work_directory/stale-mktemp.json"
seed_passed_report "$stale_mktemp_report" "stale-passed-mktemp"
expect_status 1 env \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_CREDENTIALS_CONTAINED=1 \
  TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED=1 \
  TRAILMIND_EVAL_STUB_SCENARIO=mktemp_failure \
  TRAILMIND_EVAL_REPORT_PATH="$stale_mktemp_report" \
  scripts/run-intent-eval.sh
assert_report "$stale_mktemp_report" '
  .schema_version == 2 and .run_id != "stale-passed-mktemp" and
  .started_at > 1 and .is_terminal == true and
  .final_status == "infrastructure_failed" and
  .reason == "work_directory_unavailable" and
  .provider_proof == false
'

no_jq_bin="$work_directory/no-jq-bin"
mkdir -p "$no_jq_bin"
for required_command in zsh dirname date rm; do
  required_path="$(command -v "$required_command")"
  ln -s "$required_path" "${no_jq_bin}/${required_command}"
done
stale_no_jq_report="$work_directory/stale-no-jq.json"
seed_passed_report "$stale_no_jq_report" "stale-passed-no-jq"
expect_status 1 env \
  PATH="$no_jq_bin" \
  TRAILMIND_EVAL_REPORT_PATH="$stale_no_jq_report" \
  scripts/run-intent-eval.sh
[[ ! -e "$stale_no_jq_report" ]] || \
  fail_check "A stale passed report survived a jq-unavailable invocation."

intent_live_pass="$work_directory/intent-live-pass.json"
expect_status 0 env \
  -u TRAILMIND_EVAL_DESTINATION \
  -u TRAILMIND_EVAL_SIMULATOR_ID \
  -u TRAILMIND_EVAL_SIMULATOR_NAME \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_CREDENTIALS_CONTAINED=1 \
  TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED=1 \
  TRAILMIND_EVAL_STUB_SCENARIO=pass \
  TRAILMIND_EVAL_STUB_REQUIRE_DISCOVERED_DESTINATION=1 \
  TRAILMIND_EVAL_REPORT_PATH="$intent_live_pass" \
  scripts/run-intent-eval.sh
assert_report "$intent_live_pass" '
  .run_kind == "live_provider" and .fixture_total == 40 and
  .executed_count == 40 and .passed_count == 40 and
  .failed_count == 0 and .skipped_count == 0 and
  .selected_test_result == "Passed" and
  .selected_test_passed_count == 1 and
  .final_status == "passed" and .provider_proof == true
'

route_live_pass="$work_directory/route-live-pass.json"
expect_status 0 env \
  -u TRAILMIND_EVAL_DESTINATION \
  -u TRAILMIND_EVAL_SIMULATOR_ID \
  -u TRAILMIND_EVAL_SIMULATOR_NAME \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_CREDENTIALS_CONTAINED=1 \
  TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED=1 \
  TRAILMIND_EVAL_STUB_SCENARIO=pass \
  TRAILMIND_EVAL_STUB_REQUIRE_DISCOVERED_DESTINATION=1 \
  TRAILMIND_EVAL_REPORT_PATH="$route_live_pass" \
  scripts/run-route-quality-eval.sh
assert_report "$route_live_pass" '
  .fixture_total == 20 and .executed_count == 20 and
  .passed_count == 20 and .failed_count == 0 and
  .final_status == "passed" and .provider_proof == true
'

internal_command='source scripts/evaluation-harness.sh; run_trailmind_evaluation intent IntentEvaluationTests testLiveRemoteAIIntentEvalWhenEnabled TRAILMIND_RUN_REMOTE_INTENT_EVAL 40 internal_harness'

controlled_pass="$work_directory/controlled-pass.json"
expect_status 0 env \
  TRAILMIND_EVAL_HARNESS_MODE=pass \
  TRAILMIND_EVAL_STUB_SCENARIO=pass \
  TRAILMIND_EVAL_REPORT_PATH="$controlled_pass" \
  zsh -c "$internal_command"
assert_report "$controlled_pass" '
  .run_kind == "deterministic_harness" and .fixture_total == 1 and
  .passed_count == 1 and .selected_test_result == "Passed" and
  .final_status == "passed" and .provider_proof == false
'

controlled_skip="$work_directory/controlled-skip.json"
expect_status 1 env \
  TRAILMIND_EVAL_HARNESS_MODE=skip \
  TRAILMIND_EVAL_STUB_SCENARIO=pass \
  TRAILMIND_EVAL_REPORT_PATH="$controlled_skip" \
  zsh -c "$internal_command"
assert_report "$controlled_skip" '
  .fixture_total == 1 and .skipped_count == 1 and
  .selected_test_result == "Skipped" and
  .selected_test_skipped_count == 1 and .final_status == "skipped"
'

controlled_fail="$work_directory/controlled-fail.json"
expect_status 1 env \
  TRAILMIND_EVAL_HARNESS_MODE=fail \
  TRAILMIND_EVAL_STUB_SCENARIO=pass \
  TRAILMIND_EVAL_REPORT_PATH="$controlled_fail" \
  zsh -c "$internal_command"
assert_report "$controlled_fail" '
  .fixture_total == 1 and .failed_count == 1 and
  .selected_test_result == "Failed" and
  .selected_test_failed_count == 1 and .final_status == "failed"
'

timeout_report="$work_directory/timeout.json"
expect_status 1 env \
  TRAILMIND_EVAL_HARNESS_MODE=pass \
  TRAILMIND_EVAL_STUB_SCENARIO=timeout \
  TRAILMIND_EVAL_TIMEOUT_SECONDS=1 \
  TRAILMIND_EVAL_REPORT_PATH="$timeout_report" \
  zsh -c "$internal_command"
assert_report "$timeout_report" '.final_status == "timed_out" and .reason == "xcodebuild_timeout"'

for scenario in \
  missing_result_bundle \
  xcresult_command_failure \
  malformed_xcresult \
  missing_selected_test \
  duplicate_selected_test \
  missing_marker \
  malformed_marker \
  duplicate_marker \
  inconsistent_marker \
  extra_field_marker \
  wrong_evaluation
do
  scenario_report="$work_directory/${scenario}.json"
  expect_status 1 env \
    TRAILMIND_EVAL_HARNESS_MODE=pass \
    TRAILMIND_EVAL_STUB_SCENARIO="$scenario" \
    TRAILMIND_EVAL_REPORT_PATH="$scenario_report" \
    zsh -c "$internal_command"
  assert_report "$scenario_report" '.final_status != "passed" and .provider_proof == false'
done

wrong_count_report="$work_directory/wrong-count.json"
expect_status 1 env \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_CREDENTIALS_CONTAINED=1 \
  TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED=1 \
  TRAILMIND_EVAL_STUB_SCENARIO=wrong_count \
  TRAILMIND_EVAL_REPORT_PATH="$wrong_count_report" \
  scripts/run-intent-eval.sh
assert_report "$wrong_count_report" '
  .fixture_total == 39 and .final_status == "failed" and
  .reason == "fixture_count_mismatch" and .provider_proof == true
'

proof_false_report="$work_directory/proof-false.json"
expect_status 1 env \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_CREDENTIALS_CONTAINED=1 \
  TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED=1 \
  TRAILMIND_EVAL_STUB_SCENARIO=proof_false \
  TRAILMIND_EVAL_REPORT_PATH="$proof_false_report" \
  scripts/run-route-quality-eval.sh
assert_report "$proof_false_report" '
  .fixture_total == 20 and .passed_count == 20 and
  .final_status == "failed" and .reason == "provider_proof_missing" and
  .provider_proof == false
'

live_failure_report="$work_directory/live-failure.json"
expect_status 1 env \
  -u TRAILMIND_EVAL_HARNESS_MODE \
  TRAILMIND_EVAL_CREDENTIALS_CONTAINED=1 \
  TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED=1 \
  TRAILMIND_EVAL_STUB_SCENARIO=force_fail \
  TRAILMIND_EVAL_REPORT_PATH="$live_failure_report" \
  scripts/run-intent-eval.sh
assert_report "$live_failure_report" '
  .fixture_total == 40 and .executed_count == 40 and
  .passed_count == 0 and .failed_count == 40 and
  .selected_test_result == "Failed" and .final_status == "failed" and
  .provider_proof == true
'

xcode_nonzero_report="$work_directory/xcode-nonzero.json"
expect_status 1 env \
  TRAILMIND_EVAL_HARNESS_MODE=pass \
  TRAILMIND_EVAL_STUB_SCENARIO=xcode_nonzero_after_pass \
  TRAILMIND_EVAL_REPORT_PATH="$xcode_nonzero_report" \
  zsh -c "$internal_command"
assert_report "$xcode_nonzero_report" '
  .selected_test_result == "Passed" and
  .final_status == "infrastructure_failed" and
  .reason == "xcodebuild_failed_after_test_passed"
'

redaction_report="$work_directory/redaction-failure.json"
expect_status 1 env \
  TRAILMIND_EVAL_HARNESS_MODE=fail \
  TRAILMIND_EVAL_STUB_SCENARIO=sensitive_failure \
  TRAILMIND_EVAL_SENSITIVE_MARKER="$sensitive_marker" \
  TRAILMIND_EVAL_REPORT_PATH="$redaction_report" \
  zsh -c "$internal_command"
if grep -F "$sensitive_marker" "$redaction_report" "$LAST_COMMAND_OUTPUT" >/dev/null; then
  fail_check "Sensitive raw output escaped the temporary harness log."
fi

print -r -- "Evaluation harness end-to-end checks passed."
