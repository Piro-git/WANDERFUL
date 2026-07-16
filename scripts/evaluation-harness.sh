#!/usr/bin/env zsh

# Shared implementation for TrailMind's opt-in provider evaluations.
# This file is sourced by the two public runner scripts and the deterministic
# shell harness. It deliberately emits only allow-listed metadata.

set -u

readonly TRAILMIND_EVAL_SCHEMA_VERSION=2
readonly TRAILMIND_EVAL_MACHINE_MARKER="TRAILMIND_EVAL_MACHINE_SUMMARY:"

evaluation_report_path() {
  local evaluation_name="$1"
  print -r -- "${TRAILMIND_EVAL_REPORT_PATH:-/private/tmp/trailmind-evaluation/${evaluation_name}-summary.json}"
}

write_evaluation_report() {
  local report_path="$1"
  local evaluation_name="$2"
  local run_kind="$3"
  local selected_suite="$4"
  local selected_test="$5"
  local configured="$6"
  local fixture_total="$7"
  local executed_count="$8"
  local passed_count="$9"
  local failed_count="${10}"
  local skipped_count="${11}"
  local final_status="${12}"
  local elapsed_seconds="${13}"
  local reason="${14}"
  local provider_proof="${15}"
  local selected_test_result="${16}"
  local selected_executed_count="${17}"
  local selected_passed_count="${18}"
  local selected_failed_count="${19}"
  local selected_skipped_count="${20}"
  local run_id="${21}"
  local started_at="${22}"
  local report_directory
  local temporary_report

  report_directory="${report_path:h}"
  mkdir -p "$report_directory" || return 1
  temporary_report="${report_path}.tmp.$$.$RANDOM"

  if ! jq -n \
    --argjson schema_version "$TRAILMIND_EVAL_SCHEMA_VERSION" \
    --arg run_id "$run_id" \
    --argjson started_at "$started_at" \
    --arg evaluation "$evaluation_name" \
    --arg run_kind "$run_kind" \
    --arg selected_suite "$selected_suite" \
    --arg selected_test "$selected_test" \
    --argjson configured "$configured" \
    --argjson fixture_total "$fixture_total" \
    --argjson executed_count "$executed_count" \
    --argjson passed_count "$passed_count" \
    --argjson failed_count "$failed_count" \
    --argjson skipped_count "$skipped_count" \
    --arg final_status "$final_status" \
    --argjson elapsed_seconds "$elapsed_seconds" \
    --arg reason "$reason" \
    --argjson provider_proof "$provider_proof" \
    --arg selected_test_result "$selected_test_result" \
    --argjson selected_executed_count "$selected_executed_count" \
    --argjson selected_passed_count "$selected_passed_count" \
    --argjson selected_failed_count "$selected_failed_count" \
    --argjson selected_skipped_count "$selected_skipped_count" \
    '{
      schema_version: $schema_version,
      run_id: $run_id,
      started_at: $started_at,
      evaluation: $evaluation,
      run_kind: $run_kind,
      selected_suite: $selected_suite,
      selected_test: $selected_test,
      configured: $configured,
      configuration_status: (if $configured then "configured" else "unconfigured" end),
      fixture_total: $fixture_total,
      executed_count: $executed_count,
      passed_count: $passed_count,
      failed_count: $failed_count,
      skipped_count: $skipped_count,
      selected_test_result: $selected_test_result,
      selected_test_executed_count: $selected_executed_count,
      selected_test_passed_count: $selected_passed_count,
      selected_test_failed_count: $selected_failed_count,
      selected_test_skipped_count: $selected_skipped_count,
      final_status: $final_status,
      is_terminal: ($final_status != "in_progress"),
      elapsed_seconds: $elapsed_seconds,
      provider_proof: $provider_proof,
      reason: $reason
    }' > "$temporary_report"; then
    rm -f -- "$temporary_report"
    return 1
  fi

  if ! mv "$temporary_report" "$report_path"; then
    rm -f -- "$temporary_report"
    return 1
  fi
}

invalidate_evaluation_report() {
  local report_path="$1"
  rm -f -- "$report_path"
}

write_empty_evaluation_report() {
  local report_path="$1"
  local evaluation_name="$2"
  local run_kind="$3"
  local selected_suite="$4"
  local selected_test="$5"
  local configured="$6"
  local final_status="$7"
  local elapsed_seconds="$8"
  local reason="$9"
  local run_id="${10}"
  local started_at="${11}"

  write_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
    "$selected_suite" "$selected_test" "$configured" \
    0 0 0 0 0 "$final_status" "$elapsed_seconds" "$reason" false \
    "not_run" 0 0 0 0 "$run_id" "$started_at"
}

# Sets EVALUATION_TEST_RESULT when exactly one matching XCTest case exists and
# its result is one of XCTest's known terminal states.
evaluation_result_from_json() {
  local tests_json="$1"
  local selected_identifier="$2"
  local matches
  local match_count
  local result

  EVALUATION_TEST_RESULT=""

  [[ -s "$tests_json" ]] || return 1
  jq -e . "$tests_json" >/dev/null 2>&1 || return 1

  matches="$(
    jq -c --arg selected_identifier "$selected_identifier" \
      '[.. | objects | select(
        .nodeType? == "Test Case" and
        .nodeIdentifier? == $selected_identifier
      )]' "$tests_json" 2>/dev/null
  )" || return 1

  match_count="$(jq -r 'length' <<< "$matches" 2>/dev/null)" || return 1
  [[ "$match_count" == "1" ]] || return 1

  result="$(jq -er '.[0].result | select(type == "string")' <<< "$matches" 2>/dev/null)" || return 1
  case "$result" in
    Passed|Failed|Skipped|'Expected Failure')
      EVALUATION_TEST_RESULT="$result"
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# Reads the single allow-listed machine marker emitted by the selected XCTest.
# No prompt, coordinate, fixture identifier, provider error, or raw response is
# accepted into these globals.
evaluation_fixture_summary_from_log() {
  local raw_log="$1"
  local expected_evaluation="$2"
  local marker_lines
  local marker_count
  local payload

  EVALUATION_FIXTURE_TOTAL=0
  EVALUATION_FIXTURE_PASSED=0
  EVALUATION_FIXTURE_FAILED=0
  EVALUATION_FIXTURE_SKIPPED=0
  EVALUATION_FIXTURE_PROVIDER_PROOF=false

  [[ -s "$raw_log" ]] || return 1
  marker_lines="$(grep -F "$TRAILMIND_EVAL_MACHINE_MARKER" "$raw_log" 2>/dev/null)" || return 1
  marker_count="$(print -r -- "$marker_lines" | grep -c -F "$TRAILMIND_EVAL_MACHINE_MARKER")" || return 1
  [[ "$marker_count" == "1" ]] || return 1

  payload="${marker_lines#*${TRAILMIND_EVAL_MACHINE_MARKER}}"
  print -r -- "$payload" | jq -e --arg expected_evaluation "$expected_evaluation" '
    keys == [
      "evaluation",
      "failed_count",
      "passed_count",
      "provider_proof",
      "schema_version",
      "skipped_count",
      "total_count"
    ] and
    .schema_version == 1 and
    .evaluation == $expected_evaluation and
    (.total_count | type == "number" and . >= 0 and floor == .) and
    (.passed_count | type == "number" and . >= 0 and floor == .) and
    (.failed_count | type == "number" and . >= 0 and floor == .) and
    (.skipped_count | type == "number" and . >= 0 and floor == .) and
    (.provider_proof | type == "boolean") and
    (.total_count == (.passed_count + .failed_count + .skipped_count))
  ' >/dev/null 2>&1 || return 1

  EVALUATION_FIXTURE_TOTAL="$(print -r -- "$payload" | jq -r '.total_count')" || return 1
  EVALUATION_FIXTURE_PASSED="$(print -r -- "$payload" | jq -r '.passed_count')" || return 1
  EVALUATION_FIXTURE_FAILED="$(print -r -- "$payload" | jq -r '.failed_count')" || return 1
  EVALUATION_FIXTURE_SKIPPED="$(print -r -- "$payload" | jq -r '.skipped_count')" || return 1
  EVALUATION_FIXTURE_PROVIDER_PROOF="$(print -r -- "$payload" | jq -r '.provider_proof')" || return 1
}

resolve_evaluation_destination() {
  if [[ -n "${TRAILMIND_EVAL_DESTINATION:-}" ]]; then
    print -r -- "$TRAILMIND_EVAL_DESTINATION"
    return 0
  fi

  if [[ -n "${TRAILMIND_EVAL_SIMULATOR_ID:-}" ]]; then
    print -r -- "platform=iOS Simulator,id=${TRAILMIND_EVAL_SIMULATOR_ID}"
    return 0
  fi

  if [[ -n "${TRAILMIND_EVAL_SIMULATOR_NAME:-}" ]]; then
    print -r -- "platform=iOS Simulator,name=${TRAILMIND_EVAL_SIMULATOR_NAME},OS=latest"
    return 0
  fi

  local simulator_id
  simulator_id="$(
    xcrun simctl list devices available -j 2>/dev/null | jq -r '
      [.devices | to_entries[] | .value[]
        | select((.name | startswith("iPhone")) and (.isAvailable != false))]
      | sort_by(if .state == "Booted" then 0 else 1 end)
      | .[0].udid // empty
    ' 2>/dev/null
  )" || return 1

  [[ -n "$simulator_id" ]] || return 1
  print -r -- "platform=iOS Simulator,id=${simulator_id}"
}

print_evaluation_summary() {
  local heading="$1"
  local selected_suite="$2"
  local selected_test="$3"
  local configured="$4"
  local fixture_total="$5"
  local executed_count="$6"
  local passed_count="$7"
  local failed_count="$8"
  local skipped_count="$9"
  local selected_test_result="${10}"
  local final_status="${11}"
  local elapsed_seconds="${12}"
  local provider_proof="${13}"
  local report_path="${14}"

  print -r -- ""
  print -r -- "=== ${heading} ==="
  print -r -- "Selected: ${selected_suite}/${selected_test}"
  print -r -- "Configured: ${configured}"
  print -r -- "Fixtures total/executed/passed/failed/skipped: ${fixture_total}/${executed_count}/${passed_count}/${failed_count}/${skipped_count}"
  print -r -- "Selected XCTest result: ${selected_test_result}"
  print -r -- "Provider proof: ${provider_proof}"
  print -r -- "Final status: ${final_status}"
  print -r -- "Elapsed: ${elapsed_seconds}s"
  print -r -- "Machine summary: ${report_path}"
}

print_empty_evaluation_summary() {
  local heading="$1"
  local selected_suite="$2"
  local selected_test="$3"
  local configured="$4"
  local final_status="$5"
  local elapsed_seconds="$6"
  local report_path="$7"

  print_evaluation_summary "$heading" "$selected_suite" "$selected_test" \
    "$configured" 0 0 0 0 0 "not_run" "$final_status" \
    "$elapsed_seconds" false "$report_path"
}

# invocation_kind is deliberately not supplied by the public scripts. The
# internal_harness path exists solely for deterministic tests of this function;
# a public live command rejects harness mode and can return zero only with real
# provider proof.
run_trailmind_evaluation() (
  local evaluation_name="$1"
  local live_test_class="$2"
  local live_test_method="$3"
  local live_enable_variable="$4"
  local expected_live_fixture_count="$5"
  local invocation_kind="${6:-public_live}"

  local report_path
  local harness_mode="${TRAILMIND_EVAL_HARNESS_MODE:-}"
  local run_kind="live_provider"
  local selected_test_method="$live_test_method"
  local heading="Configured live provider proof"
  local configured=false
  local provider_proof=false
  local fixture_marker_valid=false
  local expected_fixture_count="$expected_live_fixture_count"
  local fixture_total=0
  local executed_count=0
  local passed_count=0
  local failed_count=0
  local skipped_count=0
  local selected_test_result="not_run"
  local selected_executed_count=0
  local selected_passed_count=0
  local selected_failed_count=0
  local selected_skipped_count=0
  local destination
  local selected_suite
  local selected_identifier
  local only_testing
  local work_directory
  local result_bundle
  local tests_json
  local raw_log
  local run_id
  local started_at
  local execution_started_at
  local finished_at
  local elapsed_seconds=0
  local timeout_seconds="${TRAILMIND_EVAL_TIMEOUT_SECONDS:-3600}"
  local test_timeout_seconds="${TRAILMIND_EVAL_TEST_TIMEOUT_SECONDS:-2400}"
  local xcode_status=1
  local final_status="infrastructure_failed"
  local reason="evaluation_did_not_start"
  local -a test_runner_settings

  report_path="$(evaluation_report_path "$evaluation_name")"
  work_directory=""
  trap 'invalidate_evaluation_report "$report_path" >/dev/null 2>&1 || true; exit 130' INT
  trap 'invalidate_evaluation_report "$report_path" >/dev/null 2>&1 || true; exit 143' TERM
  trap 'if [[ -n "${work_directory:-}" ]]; then rm -rf -- "$work_directory"; fi' EXIT

  if ! invalidate_evaluation_report "$report_path"; then
    print -u2 -r -- "The prior machine summary could not be invalidated; evaluation was not started."
    return 1
  fi

  started_at="$(date +%s 2>/dev/null)" || started_at=0
  run_id="${evaluation_name}-${started_at}-$$-${RANDOM}"
  selected_suite="TrailMindTests/${live_test_class}"

  if ! command -v jq >/dev/null 2>&1; then
    if invalidate_evaluation_report "$report_path"; then
      print -u2 -r -- "Machine summary unavailable: required reporting tool is missing; prior proof was invalidated."
    else
      print -u2 -r -- "Machine summary unavailable and the prior report could not be invalidated."
    fi
    return 1
  fi

  if ! write_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
      "$selected_suite" "$selected_test_method" false \
      0 0 0 0 0 "in_progress" 0 "evaluation_started" false \
      "not_run" 0 0 0 0 "$run_id" "$started_at"; then
    if invalidate_evaluation_report "$report_path"; then
      print -u2 -r -- "Machine summary could not be initialized; prior proof was invalidated."
    else
      print -u2 -r -- "Machine summary could not be initialized or invalidate the prior report."
    fi
    return 1
  fi

  if [[ "$expected_live_fixture_count" != <1-> ]]; then
    final_status="invalid_configuration"
    reason="fixture_count_must_be_positive_integer"
    write_empty_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
      "$selected_suite" "$selected_test_method" false "$final_status" 0 "$reason" \
      "$run_id" "$started_at"
    print_empty_evaluation_summary "Invalid evaluation configuration" "$selected_suite" \
      "$selected_test_method" false "$final_status" 0 "$report_path"
    return 2
  fi

  case "$invocation_kind" in
    public_live)
      if [[ -n "$harness_mode" ]]; then
        final_status="invalid_configuration"
        reason="harness_mode_forbidden_for_public_runner"
        write_empty_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
          "$selected_suite" "$selected_test_method" false "$final_status" 0 "$reason" \
          "$run_id" "$started_at"
        print_empty_evaluation_summary "Blocked public live evaluation" "$selected_suite" \
          "$selected_test_method" false "$final_status" 0 "$report_path"
        return 2
      fi

      if [[ "${TRAILMIND_EVAL_CREDENTIALS_CONTAINED:-0}" == "1" &&
            "${TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED:-0}" == "1" ]]; then
        configured=true
        test_runner_settings+=(
          "TEST_RUNNER_TRAILMIND_EVAL_CREDENTIALS_CONTAINED=1"
          "TEST_RUNNER_TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED=1"
          "TEST_RUNNER_${live_enable_variable}=1"
        )
      else
        heading="Blocked/not-run live evaluation"
        final_status="not_run"
        reason="credential_containment_and_provider_authorization_required"
        print -r -- "Live evaluation blocked: credential containment, provider quota/cost, and provider usage authorization must be confirmed first."
        write_empty_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
          "$selected_suite" "$selected_test_method" false "$final_status" 0 "$reason" \
          "$run_id" "$started_at"
        print_empty_evaluation_summary "$heading" "$selected_suite" "$selected_test_method" \
          false "$final_status" 0 "$report_path"
        return 2
      fi
      ;;
    internal_harness)
      run_kind="deterministic_harness"
      heading="Deterministic harness verification"
      configured=true
      selected_test_method="testEvaluationHarnessControl"
      expected_fixture_count=1
      case "$harness_mode" in
        pass|skip|fail)
          test_runner_settings+=("TEST_RUNNER_TRAILMIND_EVAL_HARNESS_MODE=${harness_mode}")
          ;;
        *)
          final_status="invalid_configuration"
          reason="invalid_harness_mode"
          write_empty_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
            "$selected_suite" "$selected_test_method" true "$final_status" 0 "$reason" \
            "$run_id" "$started_at"
          print_empty_evaluation_summary "$heading" "$selected_suite" "$selected_test_method" \
            true "$final_status" 0 "$report_path"
          return 2
          ;;
      esac
      ;;
    *)
      final_status="invalid_configuration"
      reason="invalid_invocation_kind"
      write_empty_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
        "$selected_suite" "$selected_test_method" false "$final_status" 0 "$reason" \
        "$run_id" "$started_at"
      print_empty_evaluation_summary "Invalid evaluation configuration" "$selected_suite" \
        "$selected_test_method" false "$final_status" 0 "$report_path"
      return 2
      ;;
  esac

  selected_identifier="${live_test_class}/${selected_test_method}()"
  only_testing="TrailMindTests/${live_test_class}/${selected_test_method}"

  if ! command -v xcodebuild >/dev/null 2>&1 ||
     ! command -v xcrun >/dev/null 2>&1 ||
     ! command -v perl >/dev/null 2>&1; then
    reason="required_tool_unavailable"
    write_empty_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
      "$selected_suite" "$selected_test_method" "$configured" "$final_status" 0 "$reason" \
      "$run_id" "$started_at"
    print_empty_evaluation_summary "$heading" "$selected_suite" "$selected_test_method" \
      "$configured" "$final_status" 0 "$report_path"
    return 1
  fi

  if [[ "$timeout_seconds" != <1-> || "$test_timeout_seconds" != <1-> ]]; then
    final_status="invalid_configuration"
    reason="timeout_must_be_positive_integer"
    write_empty_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
      "$selected_suite" "$selected_test_method" "$configured" "$final_status" 0 "$reason" \
      "$run_id" "$started_at"
    print_empty_evaluation_summary "$heading" "$selected_suite" "$selected_test_method" \
      "$configured" "$final_status" 0 "$report_path"
    return 2
  fi

  destination="$(resolve_evaluation_destination)" || {
    reason="simulator_destination_unavailable"
    write_empty_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
      "$selected_suite" "$selected_test_method" "$configured" "$final_status" 0 "$reason" \
      "$run_id" "$started_at"
    print_empty_evaluation_summary "$heading" "$selected_suite" "$selected_test_method" \
      "$configured" "$final_status" 0 "$report_path"
    return 1
  }

  if ! work_directory="$(mktemp -d "/private/tmp/trailmind-${evaluation_name}.XXXXXX")"; then
    reason="work_directory_unavailable"
    write_empty_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
      "$selected_suite" "$selected_test_method" "$configured" "$final_status" 0 "$reason" \
      "$run_id" "$started_at"
    print_empty_evaluation_summary "$heading" "$selected_suite" "$selected_test_method" \
      "$configured" "$final_status" 0 "$report_path"
    return 1
  fi
  result_bundle="${work_directory}/result.xcresult"
  tests_json="${work_directory}/tests.json"
  raw_log="${work_directory}/xcodebuild.log"

  execution_started_at="$(date +%s)"
  set +e
  perl -e 'alarm shift; exec @ARGV' "$timeout_seconds" \
    env "${test_runner_settings[@]}" \
    xcodebuild test \
      -project TrailMind.xcodeproj \
      -scheme TrailMind \
      -configuration Debug \
      -destination "$destination" \
      -destination-timeout 30 \
      -parallel-testing-enabled NO \
      -test-timeouts-enabled YES \
      -default-test-execution-time-allowance "$test_timeout_seconds" \
      -maximum-test-execution-time-allowance "$test_timeout_seconds" \
      -resultBundlePath "$result_bundle" \
      "-only-testing:${only_testing}" \
      > "$raw_log" 2>&1
  xcode_status=$?
  set -e
  finished_at="$(date +%s)"
  elapsed_seconds=$((finished_at - execution_started_at))

  if [[ "$xcode_status" == "142" ]]; then
    final_status="timed_out"
    reason="xcodebuild_timeout"
  elif [[ ! -d "$result_bundle" ]]; then
    reason="missing_result_bundle"
  elif ! xcrun xcresulttool get test-results tests \
      --path "$result_bundle" --compact > "$tests_json" 2>/dev/null; then
    reason="missing_or_malformed_result_data"
  elif ! evaluation_result_from_json "$tests_json" "$selected_identifier"; then
    reason="selected_test_missing_or_malformed"
  else
    selected_test_result="$EVALUATION_TEST_RESULT"
    if evaluation_fixture_summary_from_log "$raw_log" "$evaluation_name"; then
      fixture_marker_valid=true
      fixture_total="$EVALUATION_FIXTURE_TOTAL"
      passed_count="$EVALUATION_FIXTURE_PASSED"
      failed_count="$EVALUATION_FIXTURE_FAILED"
      skipped_count="$EVALUATION_FIXTURE_SKIPPED"
      executed_count=$((passed_count + failed_count))
      if [[ "$run_kind" == "live_provider" ]]; then
        provider_proof="$EVALUATION_FIXTURE_PROVIDER_PROOF"
      fi
    fi

    case "$EVALUATION_TEST_RESULT" in
      Passed)
        selected_executed_count=1
        selected_passed_count=1
        if [[ "$xcode_status" != "0" ]]; then
          final_status="infrastructure_failed"
          reason="xcodebuild_failed_after_test_passed"
        elif [[ "$fixture_marker_valid" != "true" ]]; then
          final_status="infrastructure_failed"
          reason="missing_or_malformed_fixture_summary"
        elif [[ "$fixture_total" != "$expected_fixture_count" ]]; then
          final_status="failed"
          reason="fixture_count_mismatch"
        elif [[ "$passed_count" != "$expected_fixture_count" ||
                "$failed_count" != "0" || "$skipped_count" != "0" ]]; then
          final_status="failed"
          reason="fixture_baseline_failed"
        elif [[ "$run_kind" == "live_provider" &&
                "$EVALUATION_FIXTURE_PROVIDER_PROOF" != "true" ]]; then
          final_status="failed"
          reason="provider_proof_missing"
        elif [[ "$run_kind" == "deterministic_harness" &&
                "$EVALUATION_FIXTURE_PROVIDER_PROOF" != "false" ]]; then
          final_status="failed"
          reason="deterministic_harness_claimed_provider_proof"
        else
          final_status="passed"
          reason="fixture_baseline_executed_and_passed"
        fi
        ;;
      Failed|'Expected Failure')
        selected_executed_count=1
        selected_failed_count=1
        final_status="failed"
        reason="selected_test_failed"
        ;;
      Skipped)
        selected_skipped_count=1
        final_status="skipped"
        reason="selected_test_skipped"
        ;;
    esac
  fi

  write_evaluation_report "$report_path" "$evaluation_name" "$run_kind" \
    "$selected_suite" "$selected_test_method" "$configured" \
    "$fixture_total" "$executed_count" "$passed_count" "$failed_count" "$skipped_count" \
    "$final_status" "$elapsed_seconds" "$reason" "$provider_proof" \
    "$selected_test_result" "$selected_executed_count" "$selected_passed_count" \
    "$selected_failed_count" "$selected_skipped_count" "$run_id" "$started_at"
  print_evaluation_summary "$heading" "$selected_suite" "$selected_test_method" \
    "$configured" "$fixture_total" "$executed_count" "$passed_count" "$failed_count" \
    "$skipped_count" "$selected_test_result" "$final_status" "$elapsed_seconds" \
    "$provider_proof" "$report_path"

  if [[ "$invocation_kind" == "internal_harness" ]]; then
    [[ "$final_status" == "passed" ]]
  else
    [[ "$final_status" == "passed" && "$provider_proof" == "true" ]]
  fi
)
