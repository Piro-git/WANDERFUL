#!/bin/bash
# Compile the production parser and focused XCTest file only. No Xcode/simulator or provider calls.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
probe_dir="$(mktemp -d /private/tmp/research-constraints.XXXXXX)"
trap 'rm -rf "$probe_dir"' EXIT
export CLANG_MODULE_CACHE_PATH="$probe_dir/clang-cache"
export SWIFT_MODULECACHE_PATH="$probe_dir/swift-cache"
swiftc -swift-version 5 -enable-testing -emit-library -emit-module -module-name TrailMind \
  -module-cache-path "$probe_dir/swift-cache" \
  "$repo_root/TrailMind/Services/ResearchPromptConstraints.swift" \
  -emit-module-path "$probe_dir/TrailMind.swiftmodule" -o "$probe_dir/libTrailMind.dylib"
cat > "$probe_dir/main.swift" <<'SWIFT'
import XCTest
import Darwin
let suite = XCTestSuite(forTestCaseClass: ResearchPromptConstraintsTests.self)
suite.run()
guard let result = suite.testRun else { exit(2) }
print("Parser XCTest cases: \(result.executionCount), failures: \(result.totalFailureCount)")
exit(result.hasSucceeded && result.executionCount > 0 ? 0 : 1)
SWIFT
xctest_frameworks="$(xcode-select -p)/Platforms/MacOSX.platform/Developer/Library/Frameworks"
xctest_swift="$(xcode-select -p)/Platforms/MacOSX.platform/Developer/usr/lib"
xctest_shared="$(xcode-select -p)/../SharedFrameworks"
swiftc -Xlinker -rpath -Xlinker "$xctest_shared" -I "$xctest_swift" -L "$xctest_swift" -Xlinker -rpath -Xlinker "$xctest_swift" -F "$xctest_frameworks" -Xlinker -rpath -Xlinker "$xctest_frameworks" -swift-version 5 -module-cache-path "$probe_dir/swift-cache" \
  -I "$probe_dir" -L "$probe_dir" -lTrailMind -Xlinker -rpath -Xlinker "$probe_dir" \
  "$repo_root/TrailMindTests/ResearchPromptConstraintsTests.swift" "$probe_dir/main.swift" -o "$probe_dir/tests"
"$probe_dir/tests"
