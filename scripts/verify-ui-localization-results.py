"""Check actual xcresult test identities; stdout from xcodebuild is not evidence."""
import json
import sys
from pathlib import Path

REQUIRED = (
    "RouteLocalizedCopyTests/testLanguageChangesPresentationWithoutRewritingTheRoute()",
    "RouteLocalizedCopyTests/testExistingNamesRemainVerbatimWithoutFreshGeneratedOutcome()",
    "RouteLocalizedCopyTests/testGermanComparisonKeepsFactsAndUnknownTechnicalDifficulty()",
    "RouteLocalizedCopyTests/testEvidenceUsesTypedCodeRatherThanTranslatingUntrustedCopy()",
    "HikingRouteQualityEngineTests/testLocalizedEvidenceRetainsMeasuredPercentagesAndCoverageLimits()",
    "RouteCardPhotoUITests/testRouteCopyAndStatisticsUseSelectedLanguage()",
    "SavedRouteStoreTests/testGeneratedOutcomeSurvivesFileStoreRoundTripAndLanguageChange()",
    "SavedRouteStoreTests/testMissingOutcomeMetadataPreservesExistingNamesWithoutRewritingFile()",
    "SavedRouteStoreTests/testInvalidStoredOutcomeIsRejectedWithoutChangingTheRecord()",
)


def verify(summary, tree):
    counts = [summary.get(key) for key in ("passedTests", "failedTests", "skippedTests", "expectedFailures")]
    if not all(type(value) is int and value >= 0 for value in counts):
        raise ValueError("Missing or invalid test counts")
    passed, failed, skipped, expected = counts
    if passed < 110 or failed or skipped or expected:
        raise ValueError("Incomplete or failing simulator acceptance")
    cases = {}

    def walk(nodes):
        if not isinstance(nodes, list):
            raise ValueError("Invalid xcresult test tree")
        for node in nodes:
            if not isinstance(node, dict):
                raise ValueError("Invalid xcresult test node")
            if node.get("nodeType") == "Test Case":
                identifier = node.get("nodeIdentifier")
                if not isinstance(identifier, str) or identifier in cases:
                    raise ValueError("Missing or ambiguous test identity")
                cases[identifier] = node.get("result")
            walk(node.get("children", []))

    walk(tree.get("testNodes"))
    for identifier in REQUIRED:
        if cases.get(identifier) != "Passed":
            raise ValueError("Required regression did not pass: " + identifier)
    return passed, failed, skipped


def report(summary, tree, summary_path):
    """Bounded test diagnostics only; never dump a bundle, environment or media."""
    counts = "; ".join(f"{key}: {summary.get(key, 'missing')}" for key in
                       ("passedTests", "failedTests", "skippedTests", "expectedFailures"))
    print(counts, flush=True)
    with Path(summary_path).open("a") as output:
        output.write(counts + "\n")

    def bounded(value):
        return " ".join(str(value).split())[:1200]

    for failure in summary.get("testFailures", [])[:20]:
        if isinstance(failure, dict):
            print("Test failure: " + bounded(failure.get("testIdentifierString", failure.get("testName", "unknown")))
                  + " — " + bounded(failure.get("failureText", "No failure message")), flush=True)
    reported = 0

    def walk(nodes):
        nonlocal reported
        if not isinstance(nodes, list):
            return
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if node.get("nodeType") == "Test Case" and node.get("result") != "Passed" and reported < 20:
                print("Test result: " + bounded(node.get("nodeIdentifier", "unknown"))
                      + " — " + bounded(node.get("result", "unknown")), flush=True)
                reported += 1
            walk(node.get("children", []))
    walk(tree.get("testNodes"))


def main():
    summary = json.loads(Path(sys.argv[1]).read_text())
    tree = json.loads(Path(sys.argv[2]).read_text())
    report(summary, tree, sys.argv[3])
    verify(summary, tree)
    with Path(sys.argv[3]).open("a") as output:
        output.write(f"Required regressions: {len(REQUIRED)} passed.\n")
    print(f"Required regressions: {len(REQUIRED)} passed.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        raise SystemExit(str(error)) from error
