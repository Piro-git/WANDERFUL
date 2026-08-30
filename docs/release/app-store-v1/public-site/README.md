# Wanderful public legal/support site

This directory is a static, dependency-free package for Wanderful's public privacy, support, privacy-choices, and terms pages. It performs no deployment and contains no production identity, domain, contact, or retention assumptions.

## Fail-closed publication model

- The checked-in HTML shows a **draft — do not publish** banner and asks search engines not to index it.
- `config/owner-inputs.placeholder.json` is intentionally incomplete and must fail release validation.
- A release render requires a separate owner-completed JSON file, `PUBLISHABLE: true`, a canonical HTTPS origin, real monitored contacts, proved processor/retention facts, and legal approval.
- The renderer removes the draft banner, changes robots metadata to `index, follow`, writes canonical URLs, and rejects any unresolved token or placeholder.
- Rendered output contains only the four page directories, `assets/site.css`, `_headers`, and `robots.txt`. Configuration and build tools are not published.

Do not commit the completed owner configuration if it contains personal or non-public operator details. The two conventional local names are gitignored.

## Local validation

From the repository root:

```sh
python3 docs/release/app-store-v1/public-site/tools/validate_public_site.py
python3 -m unittest docs/release/app-store-v1/public-site/tools/test_validate_public_site.py
```

The first command validates the source templates, privacy invariants, internal links, semantic structure, contrast tokens, and responsive/accessibility CSS. The unit suite proves that the placeholder configuration fails closed and that a complete synthetic configuration can render only into a temporary directory.

## Owner-approved release render

After completing and legally approving a configuration outside git:

```sh
python3 docs/release/app-store-v1/public-site/tools/validate_public_site.py \
  --config /absolute/path/to/owner-inputs.production.json \
  --render /absolute/path/to/wanderful-public-site
```

The output directory must not already contain files. Review the rendered copy, rerun browser accessibility/responsive QA, and deploy only through the separate owner-authorized procedure in `../DEPLOY_STATIC_LEGAL_SITE_V1.md`.

## Privacy posture of the site itself

The generated pages use no JavaScript, forms, cookies, browser storage, analytics, tracking pixels, embeds, or remote fonts. A static host can still receive ordinary request metadata such as IP address and user agent; the final policy therefore requires the owner to identify the host and its access-log retention. If any later host feature, analytics product, contact form, remote asset, or consent-dependent storage is added, stop and repeat the privacy/legal review before deployment.
