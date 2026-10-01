# Deploy static legal site V1

Status: **owner-operated procedure; no deployment, domain registration, DNS change, or external mutation was performed**

## Recommended host

Cloudflare Pages is the best-fit free static-hosting candidate for this small dependency-free package as of 2026-08-30. Its current Free plan supports static projects and custom domains, it applies the package's `_headers` file to static responses, and a dedicated subdomain can use a CNAME without moving an existing apex domain. Review current limits, terms, data-processing terms, log retention, region/transfer posture, and account security before selection. The primary sources are linked in `LEGAL_AND_PLATFORM_SOURCE_NOTE_V1.md`.

Use a dedicated canonical origin such as `https://legal.<owner-domain>` or a clearly app-specific owned domain. Do not publish on a temporary preview hostname as the canonical App Store URL.

## 1. Complete the fail-closed inputs

1. Work through `OWNER_LEGAL_INPUTS_V1.md` with the legal, privacy, backend, and support owners.
2. Copy `public-site/config/owner-inputs.placeholder.json` to a protected location outside git.
3. Replace every placeholder with an approved public fact. Set `PUBLISHABLE` to `true` and `ROBOTS_DIRECTIVE` to `index, follow` only after final legal approval.
4. Do not add API keys, host tokens, provider secrets, tax records, contracts, or identity documents.

The validator intentionally rejects the checked-in example.

## 2. Render locally

From the repository root:

```sh
python3 docs/release/app-store-v1/public-site/tools/validate_public_site.py
python3 -m unittest docs/release/app-store-v1/public-site/tools/test_validate_public_site.py
python3 docs/release/app-store-v1/public-site/tools/validate_public_site.py \
  --config /absolute/private/path/owner-inputs.production.json \
  --render /absolute/empty/path/wanderful-public-site
```

The rendered directory is the only deployment input. It excludes the owner configuration, tools, and source README. The source package stays noindex/draft-only; the validated render has no unresolved owner tokens or draft banner.

## 3. Pre-deployment review

- Review every rendered page against the exact engine-enabled or engine-disabled submitted build. Do not publish the engine-enabled wording if the final architecture differs.
- Serve the render locally and check all four pages at 320 px and 430 px mobile widths and at desktop width. Test keyboard focus, skip links, headings/landmarks, 200% zoom, and reduced-motion/high-contrast behavior where available.
- Run an HTML syntax checker and verify every local link. Confirm the browser network log contains only the four local HTML pages and local stylesheet.
- Confirm contacts are monitored and that no site feature adds scripts, forms, analytics, remote fonts/assets, cookies, browser storage, or embeds.
- Record a content hash or archived copy in the authorized legal/release system without storing private support messages in git.

## 4. Owner-authorized Cloudflare Pages setup

These steps mutate external systems and require separate explicit authority:

1. Create or select the owner-controlled Cloudflare account with MFA and least-privilege administrator access.
2. Create a Pages project using a direct static upload of the validated rendered directory, or a dedicated publication repository containing only that render. Do not connect this full application repository unless the owner deliberately accepts that exposure and access model.
3. Do not enable Pages Functions, analytics, access gates on the production URL, web forms, or third-party scripts. Confirm `_headers` is applied to production responses.
4. Add the owner-approved custom domain. For a subdomain at an external DNS provider, associate it in Pages first and then create the documented CNAME. Verify certificate issuance and redirects.
5. Redirect or block the `pages.dev` production alias so the custom domain is canonical, while keeping preview deployments noindex/private under the owner's policy.

## 5. Production acceptance

From a clean device/network without owner authentication:

- all URLs return successful HTTPS pages with a trusted certificate and no redirect to a preview, login, parking, or unrelated page;
- security headers include the intended CSP, Permissions Policy, Referrer Policy, nosniff, frame protection, and HSTS;
- browser storage remains empty and the network log has no analytics, tracking, remote fonts/assets, forms, scripts, or mixed content;
- Privacy, Support, Your choices, and Terms cross-links all work;
- the support and privacy email links open the correct monitored addresses;
- content remains readable and operable at small/large mobile widths, 200% zoom, keyboard-only navigation, and a screen reader;
- the policy matches the final production provider, retention, legal-basis, and App Privacy evidence.

## 6. Exact App Store and app URLs

For canonical origin `https://OWNER-APPROVED-ORIGIN`, enter:

- Privacy Policy URL: `https://OWNER-APPROVED-ORIGIN/privacy/`
- Support URL: `https://OWNER-APPROVED-ORIGIN/support/`
- User Privacy Choices URL (optional but recommended): `https://OWNER-APPROVED-ORIGIN/privacy-choices/`

The terms page is public at `https://OWNER-APPROVED-ORIGIN/terms/`, but App Store Connect uses Apple's Standard EULA by default unless the owner deliberately supplies a custom EULA in App Store Connect. Hosting this terms page does not itself configure a custom App Store EULA.

Only after production acceptance should a separately authorized release change configure the iOS values `WANDERFUL_PRIVACY_POLICY_URL` and `WANDERFUL_SUPPORT_URL` and update App Store Connect. Those actions are outside this package.

## 7. Rollback and change control

- Keep the last legally approved render and its hash in the owner's release evidence system.
- If a publication is wrong, restore the last approved static deployment immediately, preserve an incident record, and notify the legal/privacy owner.
- Any change to app data flow, provider, retention, account/sync state, payment/analytics SDK, site script/form/storage, legal entity, or contact triggers a new content, App Privacy, validator, browser, and legal review before deployment.
