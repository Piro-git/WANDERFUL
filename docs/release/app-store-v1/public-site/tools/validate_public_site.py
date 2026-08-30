#!/usr/bin/env python3
"""Validate and render Wanderful's dependency-free public legal/support site."""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


SITE_ROOT = Path(__file__).resolve().parents[1]
PAGE_SLUGS = ("privacy", "support", "privacy-choices", "terms")
TOKEN_RE = re.compile(r"\{\{([A-Z][A-Z0-9_]*)\}\}")
DRAFT_BLOCK_RE = re.compile(
    r"\s*<!-- DRAFT_ONLY_START -->.*?<!-- DRAFT_ONLY_END -->\s*",
    flags=re.DOTALL,
)
PLACEHOLDER_MARKERS = (
    "OWNER_INPUT_REQUIRED",
    "EXAMPLE.INVALID",
    "YYYY-MM-DD",
    "TODO",
    "TBD",
    "UNKNOWN",
)
FORBIDDEN_TAGS = {
    "applet",
    "audio",
    "embed",
    "form",
    "iframe",
    "object",
    "script",
    "video",
}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
FORBIDDEN_PRIVACY_PATTERNS = (
    "document.cookie",
    "localstorage",
    "sessionstorage",
    "indexeddb",
    "xmlhttprequest",
    "sendbeacon",
    "fetch(",
    "googletagmanager",
    "google-analytics",
    "plausible.io",
    "segment.com",
    "mixpanel",
    "facebook.com/tr",
)
REQUIRED_CONFIG_KEYS = {
    "PUBLISHABLE",
    "CANONICAL_ORIGIN",
    "ROBOTS_DIRECTIVE",
    "EFFECTIVE_DATE",
    "LAST_LEGAL_REVIEW_DATE",
    "CONTROLLER_LEGAL_NAME",
    "CONTROLLER_LEGAL_FORM",
    "POSTAL_ADDRESS",
    "COUNTRY",
    "PRIVACY_EMAIL",
    "SUPPORT_EMAIL",
    "SUPPORT_PHONE_OR_UNAVAILABLE",
    "REGISTER_DETAILS_OR_NOT_APPLICABLE",
    "VAT_ID_OR_NOT_APPLICABLE",
    "DSA_TRADER_STATUS",
    "SUPERVISORY_AUTHORITY_NAME",
    "SUPERVISORY_AUTHORITY_URL",
    "ROUTING_REQUEST_TRANSIENT_PERIOD",
    "SECURITY_LOG_FIELDS",
    "SECURITY_LOG_RETENTION",
    "SITE_HOST_NAME",
    "SITE_ACCESS_LOG_RETENTION",
    "SUPPORT_MESSAGE_RETENTION",
    "BACKEND_HOSTING_DETAILS",
    "GRAPHHOPPER_DETAILS",
    "EVIDENCE_PROVIDER_DETAILS",
    "INTERNATIONAL_TRANSFER_DETAILS",
    "ROUTING_LEGAL_BASIS",
    "SECURITY_LEGAL_BASIS",
    "SUPPORT_LEGAL_BASIS",
    "MINIMUM_AGE",
    "CHILDREN_POLICY",
    "EULA_CHOICE",
    "GOVERNING_LAW",
    "LIABILITY_REVIEWED_TEXT",
}


class SiteValidationError(RuntimeError):
    """Raised when the static site is not safe to publish."""


class PageInspector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.declarations: list[str] = []
        self.tags: list[str] = []
        self.links: list[tuple[str, str]] = []
        self.ids: list[str] = []
        self.headings: list[int] = []
        self.counts: dict[str, int] = {}
        self.metadata: dict[str, str] = {}
        self.canonical: str | None = None
        self.lang: str | None = None
        self.title_text: list[str] = []
        self.style_attributes = 0
        self._in_title = False
        self.open_tags: list[str] = []
        self.structure_errors: list[str] = []

    def handle_decl(self, decl: str) -> None:
        self.declarations.append(decl.lower())

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._handle_tag(tag, attrs, self_closing=False)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._handle_tag(tag, attrs, self_closing=True)

    def _handle_tag(self, tag: str, attrs: list[tuple[str, str | None]], *, self_closing: bool) -> None:
        tag = tag.lower()
        attr = {name.lower(): (value or "") for name, value in attrs}
        self.tags.append(tag)
        self.counts[tag] = self.counts.get(tag, 0) + 1
        if tag not in VOID_TAGS and not self_closing:
            self.open_tags.append(tag)
        if tag == "html":
            self.lang = attr.get("lang")
        if tag == "title":
            self._in_title = True
        if "id" in attr:
            self.ids.append(attr["id"])
        if "style" in attr:
            self.style_attributes += 1
        if tag in {f"h{level}" for level in range(1, 7)}:
            self.headings.append(int(tag[1]))
        if tag == "a" and "href" in attr:
            self.links.append(("anchor", attr["href"]))
        if tag == "link" and "href" in attr:
            relationship = attr.get("rel", "").lower()
            self.links.append((f"link:{relationship}", attr["href"]))
            if "canonical" in relationship.split():
                self.canonical = attr["href"]
        if tag == "meta":
            key = attr.get("name", "").lower()
            if key:
                self.metadata[key] = attr.get("content", "")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
        if tag in VOID_TAGS:
            self.structure_errors.append(f"void element </{tag}> must not have an end tag")
        elif not self.open_tags:
            self.structure_errors.append(f"unexpected closing tag </{tag}>")
        elif self.open_tags[-1] != tag:
            self.structure_errors.append(f"closing tag </{tag}> does not match open <{self.open_tags[-1]}>")
        else:
            self.open_tags.pop()

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title_text.append(data)


def fail(errors: list[str]) -> None:
    if errors:
        raise SiteValidationError("\n".join(f"- {error}" for error in errors))


def required_paths(root: Path, *, release: bool) -> list[Path]:
    paths = [root / slug / "index.html" for slug in PAGE_SLUGS]
    paths.extend((root / "assets" / "site.css", root / "assets" / "favicon.svg", root / "_headers", root / "robots.txt"))
    if not release:
        paths.extend(
            (
                root / "README.md",
                root / "config" / "owner-inputs.placeholder.json",
                root / "tools" / "validate_public_site.py",
                root / "tools" / "test_validate_public_site.py",
            )
        )
    return paths


def resolve_local_link(page: Path, root: Path, href: str) -> Path | None:
    if not href or href.startswith("#") or "{{" in href:
        return None
    parsed = urlparse(href)
    if parsed.scheme or parsed.netloc:
        return None
    target = (page.parent / parsed.path).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        raise SiteValidationError(f"{page.relative_to(root)}: local link escapes site root: {href}")
    if parsed.path.endswith("/") or target.is_dir():
        target = target / "index.html"
    return target


def validate_page(page: Path, root: Path, *, release: bool, origin: str | None) -> list[str]:
    errors: list[str] = []
    source = page.read_text(encoding="utf-8")
    inspector = PageInspector()
    try:
        inspector.feed(source)
        inspector.close()
    except Exception as exc:  # HTMLParser exposes malformed constructs as parser errors.
        return [f"{page.relative_to(root)}: HTML parse failed: {exc}"]

    label = str(page.relative_to(root))
    for structure_error in inspector.structure_errors:
        errors.append(f"{label}: {structure_error}")
    if inspector.open_tags:
        errors.append(f"{label}: unclosed tags: {', '.join(inspector.open_tags)}")
    if not inspector.declarations or inspector.declarations[0] != "doctype html":
        errors.append(f"{label}: missing <!doctype html>")
    if inspector.lang != "en":
        errors.append(f"{label}: html lang must be en")
    for tag in ("header", "main", "footer", "h1"):
        if inspector.counts.get(tag, 0) != 1:
            errors.append(f"{label}: expected exactly one {tag}")
    if not "".join(inspector.title_text).strip():
        errors.append(f"{label}: title must not be empty")
    if "viewport" not in inspector.metadata:
        errors.append(f"{label}: missing viewport metadata")
    if not inspector.metadata.get("description", "").strip():
        errors.append(f"{label}: missing description metadata")
    if inspector.metadata.get("robots") is None:
        errors.append(f"{label}: missing robots metadata")
    if inspector.canonical is None:
        errors.append(f"{label}: missing canonical link")
    if "main-content" not in inspector.ids:
        errors.append(f"{label}: missing main-content skip-link target")
    if ("anchor", "#main-content") not in inspector.links:
        errors.append(f"{label}: missing skip link")
    if len(inspector.ids) != len(set(inspector.ids)):
        errors.append(f"{label}: duplicate id")
    if inspector.style_attributes:
        errors.append(f"{label}: inline style attributes are forbidden")
    for previous, current in zip(inspector.headings, inspector.headings[1:]):
        if current > previous + 1:
            errors.append(f"{label}: heading level jumps from h{previous} to h{current}")
    forbidden = FORBIDDEN_TAGS.intersection(inspector.tags)
    if forbidden:
        errors.append(f"{label}: forbidden active/embed tags: {', '.join(sorted(forbidden))}")

    stylesheet_count = 0
    for kind, href in inspector.links:
        parsed = urlparse(href)
        if kind == "link:stylesheet":
            stylesheet_count += 1
            if parsed.scheme or parsed.netloc:
                errors.append(f"{label}: remote stylesheet is forbidden: {href}")
        if kind.startswith("link:") and "canonical" not in kind and "stylesheet" not in kind and "icon" not in kind:
            errors.append(f"{label}: unexpected link relationship: {kind}")
        if kind == "anchor" and parsed.scheme not in {"", "https", "mailto"}:
            errors.append(f"{label}: unsupported anchor scheme: {href}")
        try:
            target = resolve_local_link(page, root, href)
        except SiteValidationError as exc:
            errors.append(str(exc))
            continue
        if target is not None and not target.is_file():
            errors.append(f"{label}: broken local link {href}")
    if stylesheet_count != 1:
        errors.append(f"{label}: expected exactly one local stylesheet")

    lowered = source.lower()
    for attr in ("src=", "srcset=", "poster=", "action="):
        if attr in lowered:
            errors.append(f"{label}: resource/form attribute is forbidden: {attr[:-1]}")
    for pattern in FORBIDDEN_PRIVACY_PATTERNS:
        if pattern in lowered:
            errors.append(f"{label}: privacy invariant forbids {pattern}")

    if release:
        if TOKEN_RE.search(source):
            errors.append(f"{label}: unresolved owner token")
        if "DRAFT_ONLY_" in source or "draft-banner" in source or "do not publish" in lowered:
            errors.append(f"{label}: draft marker remains in release render")
        if inspector.metadata.get("robots", "").lower() != "index, follow":
            errors.append(f"{label}: release robots metadata must be index, follow")
        expected = f"{origin}/{page.parent.name}/"
        if inspector.canonical != expected:
            errors.append(f"{label}: canonical must be {expected}")
    else:
        if "DRAFT_ONLY_START" not in source or "draft-banner" not in source:
            errors.append(f"{label}: source must display a draft-only banner")
        if inspector.metadata.get("robots") != "{{ROBOTS_DIRECTIVE}}":
            errors.append(f"{label}: source robots metadata must be configuration-bound")
    return errors


def _hex_rgb(value: str) -> tuple[float, float, float]:
    return tuple(int(value[index : index + 2], 16) / 255 for index in (1, 3, 5))  # type: ignore[return-value]


def _relative_luminance(value: str) -> float:
    channels = []
    for component in _hex_rgb(value):
        channels.append(component / 12.92 if component <= 0.04045 else ((component + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def _contrast(first: str, second: str) -> float:
    one, two = _relative_luminance(first), _relative_luminance(second)
    lighter, darker = max(one, two), min(one, two)
    return (lighter + 0.05) / (darker + 0.05)


def validate_css(css_path: Path, root: Path) -> list[str]:
    errors: list[str] = []
    css = css_path.read_text(encoding="utf-8")
    lowered = css.lower()
    for required in (":focus-visible", "prefers-reduced-motion", "forced-colors", "@media print", "@media (max-width"):
        if required not in lowered:
            errors.append(f"assets/site.css: missing accessibility/responsive rule {required}")
    for forbidden in ("@import", "@font-face", "url(http:", "url(https:", "javascript:"):
        if forbidden in lowered:
            errors.append(f"assets/site.css: forbidden external/active CSS construct {forbidden}")
    variables = {
        name: value.lower()
        for name, value in re.findall(r"--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;", css)
    }
    pairs = (
        ("ink", "page"),
        ("muted", "surface"),
        ("accent", "surface"),
        ("warning-ink", "warning-bg"),
    )
    for foreground, background in pairs:
        if foreground not in variables or background not in variables:
            errors.append(f"assets/site.css: missing color variable for {foreground}/{background}")
            continue
        ratio = _contrast(variables[foreground], variables[background])
        if ratio < 4.5:
            errors.append(f"assets/site.css: {foreground}/{background} contrast {ratio:.2f} is below 4.5")
    return errors


def validate_headers(root: Path) -> list[str]:
    content = (root / "_headers").read_text(encoding="utf-8").lower()
    errors: list[str] = []
    for required in (
        "content-security-policy:",
        "script-src 'none'",
        "connect-src 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "permissions-policy:",
        "referrer-policy:",
        "x-content-type-options: nosniff",
        "strict-transport-security:",
    ):
        if required not in content:
            errors.append(f"_headers: missing {required}")
    return errors


def validate_site(root: Path = SITE_ROOT, *, release: bool = False, origin: str | None = None) -> None:
    root = root.resolve()
    errors: list[str] = []
    for path in required_paths(root, release=release):
        if not path.is_file():
            errors.append(f"missing required file: {path.relative_to(root)}")
    if errors:
        fail(errors)
    for slug in PAGE_SLUGS:
        errors.extend(validate_page(root / slug / "index.html", root, release=release, origin=origin))
    if not release:
        template_tokens: set[str] = set()
        for slug in PAGE_SLUGS:
            template_tokens.update(TOKEN_RE.findall((root / slug / "index.html").read_text(encoding="utf-8")))
        expected_tokens = REQUIRED_CONFIG_KEYS - {"PUBLISHABLE"}
        missing_tokens = sorted(expected_tokens - template_tokens)
        unknown_tokens = sorted(template_tokens - expected_tokens)
        if missing_tokens:
            errors.append(f"owner configuration fields are not represented in templates: {', '.join(missing_tokens)}")
        if unknown_tokens:
            errors.append(f"templates contain unknown owner fields: {', '.join(unknown_tokens)}")
    errors.extend(validate_css(root / "assets" / "site.css", root))
    errors.extend(validate_headers(root))

    published_paths = [root / slug / "index.html" for slug in PAGE_SLUGS]
    published_paths.extend((root / "assets" / "site.css", root / "assets" / "favicon.svg", root / "_headers", root / "robots.txt"))
    combined = "\n".join(path.read_text(encoding="utf-8").lower() for path in published_paths)
    for pattern in FORBIDDEN_PRIVACY_PATTERNS:
        if pattern in combined:
            errors.append(f"site privacy invariant forbids {pattern}")
    robots = (root / "robots.txt").read_text(encoding="utf-8").lower()
    if release:
        if "allow: /" not in robots or "disallow: /" in robots:
            errors.append("robots.txt: release render must allow crawling")
        leaked = [path for path in (root / "config", root / "tools", root / "README.md") if path.exists()]
        if leaked:
            errors.append("release render contains build-only files")
    elif "disallow: /" not in robots:
        errors.append("robots.txt: source package must fail closed with Disallow: /")
    fail(errors)


def load_release_config(path: Path) -> dict[str, object]:
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SiteValidationError(f"configuration could not be read: {exc}") from exc
    if not isinstance(config, dict):
        raise SiteValidationError("configuration root must be an object")
    errors: list[str] = []
    missing = sorted(REQUIRED_CONFIG_KEYS.difference(config))
    if missing:
        errors.append(f"configuration missing keys: {', '.join(missing)}")
    if config.get("PUBLISHABLE") is not True:
        errors.append("PUBLISHABLE must be exactly true after owner and legal approval")
    for key in sorted(REQUIRED_CONFIG_KEYS - {"PUBLISHABLE"}):
        value = config.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{key} must be a non-empty string")
            continue
        upper = value.upper()
        if any(marker in upper for marker in PLACEHOLDER_MARKERS) or "{{" in value or "}}" in value:
            errors.append(f"{key} still contains a placeholder")
    if config.get("ROBOTS_DIRECTIVE") != "index, follow":
        errors.append("ROBOTS_DIRECTIVE must be exactly 'index, follow' for a release render")

    origin = str(config.get("CANONICAL_ORIGIN", ""))
    parsed_origin = urlparse(origin)
    try:
        origin_port = parsed_origin.port
    except ValueError:
        origin_port = -1
    if (
        parsed_origin.scheme != "https"
        or not parsed_origin.hostname
        or parsed_origin.username
        or parsed_origin.password
        or origin_port
        or parsed_origin.path not in {"", "/"}
        or parsed_origin.query
        or parsed_origin.fragment
        or origin.endswith("/")
        or parsed_origin.hostname in {"localhost", "127.0.0.1", "::1"}
    ):
        errors.append("CANONICAL_ORIGIN must be a public canonical HTTPS origin without credentials, port, path, query, fragment, or trailing slash")
    for key in ("PRIVACY_EMAIL", "SUPPORT_EMAIL"):
        value = str(config.get(key, ""))
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            errors.append(f"{key} must be a valid monitored email address")
    authority = urlparse(str(config.get("SUPERVISORY_AUTHORITY_URL", "")))
    if authority.scheme != "https" or not authority.hostname or authority.username or authority.password:
        errors.append("SUPERVISORY_AUTHORITY_URL must be a public HTTPS URL")
    for key in ("EFFECTIVE_DATE", "LAST_LEGAL_REVIEW_DATE"):
        value = str(config.get(key, ""))
        try:
            parsed_date = date.fromisoformat(value)
            if parsed_date > date.today():
                errors.append(f"{key} must not be in the future")
        except ValueError:
            errors.append(f"{key} must use ISO YYYY-MM-DD format")
    for key, minimum in (
        ("CHILDREN_POLICY", 30),
        ("GOVERNING_LAW", 30),
        ("LIABILITY_REVIEWED_TEXT", 60),
        ("INTERNATIONAL_TRANSFER_DETAILS", 30),
    ):
        if len(str(config.get(key, "")).strip()) < minimum:
            errors.append(f"{key} is too short for an approved publication statement")
    fail(errors)
    return config


def render_release(config_path: Path, output: Path, root: Path = SITE_ROOT) -> Path:
    root = root.resolve()
    output = output.resolve()
    config = load_release_config(config_path.resolve())
    try:
        output.relative_to(root)
        raise SiteValidationError("release output must be outside the checked-in source package")
    except ValueError:
        pass
    if output.exists() and any(output.iterdir()):
        raise SiteValidationError("release output directory must not already contain files")
    output.mkdir(parents=True, exist_ok=True)
    replacements = {key: html.escape(str(value), quote=True) for key, value in config.items() if isinstance(value, str)}

    for slug in PAGE_SLUGS:
        source = (root / slug / "index.html").read_text(encoding="utf-8")
        rendered = DRAFT_BLOCK_RE.sub("\n", source)
        rendered = TOKEN_RE.sub(lambda match: replacements.get(match.group(1), match.group(0)), rendered)
        destination = output / slug / "index.html"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(rendered, encoding="utf-8")
    (output / "assets").mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / "assets" / "site.css", output / "assets" / "site.css")
    shutil.copy2(root / "assets" / "favicon.svg", output / "assets" / "favicon.svg")
    shutil.copy2(root / "_headers", output / "_headers")
    (output / "robots.txt").write_text("User-agent: *\nAllow: /\n", encoding="utf-8")
    validate_site(output, release=True, origin=str(config["CANONICAL_ORIGIN"]))
    return output


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="Owner-approved release JSON")
    parser.add_argument("--render", type=Path, help="Empty output directory for validated static files")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        validate_site(SITE_ROOT)
        if bool(args.config) != bool(args.render):
            raise SiteValidationError("--config and --render must be supplied together")
        if args.config and args.render:
            rendered = render_release(args.config, args.render)
            print(f"Validated release render: {rendered}")
        else:
            print(f"Validated fail-closed source package: {SITE_ROOT}")
        return 0
    except SiteValidationError as exc:
        print(f"Public-site validation failed:\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
