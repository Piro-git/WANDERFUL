#!/usr/bin/env zsh
set -euo pipefail

cd "$(dirname "$0")/.."

SIMULATOR_NAME="${TRAILMIND_EVAL_SIMULATOR_NAME:-iPhone 17}"

TRAILMIND_RUN_ROUTE_QUALITY_EVAL=1 xcodebuild test \
  -project TrailMind.xcodeproj \
  -scheme TrailMind \
  -configuration Debug \
  -destination "platform=iOS Simulator,name=${SIMULATOR_NAME}" \
  -only-testing:TrailMindTests/RouteQualityEvaluationTests/testLiveRouteQualityEvalWhenEnabled
