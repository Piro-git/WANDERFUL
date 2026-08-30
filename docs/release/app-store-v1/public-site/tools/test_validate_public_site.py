#!/usr/bin/env python3
"""Regression tests for Wanderful public-site fail-closed rendering."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("validate_public_site.py")
SPEC = importlib.util.spec_from_file_location("wanderful_public_site_validator", MODULE_PATH)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


class PublicSiteValidatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="wanderful-public-site-")
        self.addCleanup(self.temporary.cleanup)
        self.temp_root = Path(self.temporary.name)

    def valid_config(self) -> dict[str, object]:
        placeholder = json.loads(
            (validator.SITE_ROOT / "config" / "owner-inputs.placeholder.json").read_text(encoding="utf-8")
        )
        approved = {
            key: f"Reviewed publication statement for {key.lower().replace('_', ' ')}."
            for key in validator.REQUIRED_CONFIG_KEYS
            if key not in {"PUBLISHABLE", "CANONICAL_ORIGIN", "ROBOTS_DIRECTIVE", "EFFECTIVE_DATE", "LAST_LEGAL_REVIEW_DATE"}
        }
        placeholder.update(approved)
        placeholder.update(
            {
                "PUBLISHABLE": True,
                "CANONICAL_ORIGIN": "https://wanderful.test.example",
                "ROBOTS_DIRECTIVE": "index, follow",
                "EFFECTIVE_DATE": date.today().isoformat(),
                "LAST_LEGAL_REVIEW_DATE": date.today().isoformat(),
                "PRIVACY_EMAIL": "privacy@wanderful.test.example",
                "SUPPORT_EMAIL": "support@wanderful.test.example",
                "SUPERVISORY_AUTHORITY_URL": "https://authority.test.example/privacy",
                "LIABILITY_REVIEWED_TEXT": "Liability remains governed by mandatory law and the legally reviewed allocation applicable to this service.",
                "GOVERNING_LAW": "The legally reviewed governing-law and venue statement applies subject to mandatory consumer protections.",
                "CHILDREN_POLICY": "The reviewed children policy and any required guardian controls apply to the launch territory.",
                "INTERNATIONAL_TRANSFER_DETAILS": "Reviewed provider locations and transfer safeguards are documented for every enabled service.",
            }
        )
        return placeholder

    def write_config(self, payload: dict[str, object], name: str = "owner.json") -> Path:
        path = self.temp_root / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def render(self) -> Path:
        config = self.write_config(self.valid_config())
        output = self.temp_root / "rendered"
        validator.render_release(config, output)
        return output

    def test_source_package_is_valid_and_fail_closed(self) -> None:
        validator.validate_site(validator.SITE_ROOT)

    def test_placeholder_configuration_is_rejected(self) -> None:
        placeholder = validator.SITE_ROOT / "config" / "owner-inputs.placeholder.json"
        with self.assertRaisesRegex(validator.SiteValidationError, "PUBLISHABLE"):
            validator.load_release_config(placeholder)

    def test_complete_configuration_renders_publishable_static_site(self) -> None:
        output = self.render()
        validator.validate_site(output, release=True, origin="https://wanderful.test.example")
        privacy = (output / "privacy" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("{{", privacy)
        self.assertNotIn("draft-banner", privacy)
        self.assertFalse((output / "config").exists())
        self.assertFalse((output / "tools").exists())

    def test_remote_script_is_rejected(self) -> None:
        output = self.render()
        support = output / "support" / "index.html"
        support.write_text(
            support.read_text(encoding="utf-8").replace("</body>", '<script src="https://tracker.example/app.js"></script></body>'),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(validator.SiteValidationError, "forbidden"):
            validator.validate_site(output, release=True, origin="https://wanderful.test.example")

    def test_owner_values_are_html_escaped(self) -> None:
        payload = self.valid_config()
        payload["CONTROLLER_LEGAL_NAME"] = '<script data-owner="unsafe">alert(1)</script>'
        config = self.write_config(payload)
        output = self.temp_root / "escaped"
        validator.render_release(config, output)
        privacy = (output / "privacy" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("<script data-owner", privacy)
        self.assertIn("&lt;script data-owner=&quot;unsafe&quot;&gt;", privacy)

    def test_broken_internal_link_is_rejected(self) -> None:
        output = self.render()
        terms = output / "terms" / "index.html"
        terms.write_text(
            terms.read_text(encoding="utf-8").replace("../support/", "../missing/", 1),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(validator.SiteValidationError, "broken local link"):
            validator.validate_site(output, release=True, origin="https://wanderful.test.example")

    def test_release_render_refuses_non_empty_output(self) -> None:
        config = self.write_config(self.valid_config())
        output = self.temp_root / "not-empty"
        output.mkdir()
        (output / "keep.txt").write_text("preserve", encoding="utf-8")
        with self.assertRaisesRegex(validator.SiteValidationError, "must not already contain files"):
            validator.render_release(config, output)


if __name__ == "__main__":
    unittest.main()
