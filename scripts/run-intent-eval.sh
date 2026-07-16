#!/usr/bin/env zsh
set -euo pipefail

# Live provider usage is intentionally double-gated. Before running, a human
# must confirm credential containment and available provider quota/cost, then
# set TRAILMIND_EVAL_CREDENTIALS_CONTAINED=1 and
# TRAILMIND_EVAL_PROVIDER_USAGE_AUTHORIZED=1. With neither flag, this command
# writes a not_run report and exits nonzero.

cd "$(dirname "$0")/.."
source scripts/evaluation-harness.sh

run_trailmind_evaluation \
  "intent" \
  "IntentEvaluationTests" \
  "testLiveRemoteAIIntentEvalWhenEnabled" \
  "TRAILMIND_RUN_REMOTE_INTENT_EVAL" \
  40
