"""Synthetic guard regressions: missing/skipped cases must never produce green CI."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("verifier", Path(__file__).with_name("verify-ui-localization-results.py"))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class ResultVerifierTests(unittest.TestCase):
    def setUp(self):
        self.summary = {"passedTests": 150, "failedTests": 0, "skippedTests": 0, "expectedFailures": 0}
        self.cases = [{"nodeType": "Test Case", "nodeIdentifier": name, "result": "Passed"}
                      for name in verifier.REQUIRED]
        self.tree = {"testNodes": [{"nodeType": "Test Suite", "result": "Passed", "children": self.cases}]}

    def testStructuredPassedCasesDoNotNeedConsoleLogs(self):
        self.assertEqual(verifier.verify(self.summary, self.tree), (150, 0, 0))

    def testMissingRequiredCaseFails(self):
        self.cases.pop()
        with self.assertRaises(ValueError): verifier.verify(self.summary, self.tree)

    def testSameMethodInDifferentSuiteDoesNotSatisfyRequirement(self):
        self.cases[0]["nodeIdentifier"] = self.cases[0]["nodeIdentifier"].replace("RouteLocalizedCopyTests/", "UnrelatedTests/")
        with self.assertRaises(ValueError): verifier.verify(self.summary, self.tree)

    def testNonpassingRequiredResultCannotUsePassingSuiteResult(self):
        for result in ("Failed", "Skipped", "Expected Failure", "unknown", None):
            with self.subTest(result=result):
                tree = copy.deepcopy(self.tree)
                tree["testNodes"][0]["children"][0]["result"] = result
                with self.assertRaises(ValueError): verifier.verify(self.summary, tree)

    def testAggregateFailureSkipExpectedFailureAndEmptyExecutionFail(self):
        for key, value in (("failedTests", 1), ("skippedTests", 1), ("expectedFailures", 1), ("passedTests", 0)):
            with self.subTest(key=key):
                summary = {**self.summary, key: value}
                with self.assertRaises(ValueError): verifier.verify(summary, self.tree)

    def testDuplicateRequiredIdentityFails(self):
        self.cases.append(copy.deepcopy(self.cases[0]))
        with self.assertRaises(ValueError): verifier.verify(self.summary, self.tree)

    def testMalformedTreeFails(self):
        with self.assertRaises(ValueError): verifier.verify(self.summary, {})


if __name__ == "__main__":
    unittest.main()
