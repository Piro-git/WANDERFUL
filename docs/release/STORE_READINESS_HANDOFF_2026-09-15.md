# Store-readiness handoff

Owner: `store-readiness`
Persistent clone: `/Users/REDACTED/Library/Application Support/Wanderful-Recovery/release-wave-20260915/store-readiness`
Branch: `codex/store-readiness-20260915`
Base: `3aae5e19ec83b43196295e2dc3e98085e64046f0`

## Delivered documents

- `LAUNCH_READINESS_2026-09-15.md`: evidence-backed GO/NO-GO and owner gates.
- `STORE_COPY_2026-09-15.md`: German/English copy and conditional App Review notes.
- `APP_PRIVACY_INVENTORY_2026-09-15.md`: processor/data inventory, including Gemini, GraphHopper, Commons, accounts, and commerce as conditional paths.
- `TESTFLIGHT_ACCEPTANCE_2026-09-15.md`: real acceptance and genuine screenshot plan.

## Integration interface

Do not treat this documentation commit as feature integration or as an approval to submit. Before selecting metadata or App Privacy answers, the integrator must send the final candidate commit/build, archive privacy report, entitlement inspection, production host/processor retention inventory, and evidence for every enabled optional feature.

## Known blockers sent to integration

Existing older release drafts say live location/navigation are absent, but the base has Route Guidance with precise location and background updates. They are stale and must not be reused without reconciliation.

The account implementation is default-disabled; its durable PostgreSQL adapter
and migration use 30-day opaque-session expiry. The no-session deletion
false-success path is corrected in source and has a focused test, but there is
no generic account-data retention/pruning job, deployed enabled endpoint, or
end-to-end acceptance. The StoreKit weekly/annual local fixture is integrated;
its static contract result is recorded as one pass and one runtime skip. Keep
account/privacy and commerce review blocked until the respective backend/device
and App Store Connect/Sandbox evidence exists.

## Owner launch-input form

Complete this once with final facts; leave an optional feature as **disabled**
rather than inventing a value. Do not place credentials, tokens, reviewer
passwords, or personal route data in this repository.

```text
LEGAL + PUBLIC URLs
Controller/trader legal name and country:
Legal address and support contact:
Rights holder + copyright year:
Required register/VAT facts (or “not applicable”):
Privacy URL | Support URL | Terms/EULA choice:
Retention/deletion and international-transfer basis:

LIVE BACKEND + PROCESSORS
Approved production HTTPS origin:
Enabled processors/providers and regions:
Per-provider payload, logging/cache/backup retention, deletion:
Live-route evidence reference (non-personal):

APPLE + STORE RECORD
Developer Program team and App Store Connect role:
Accepted agreements / final App ID / app-record status:
Final app name | SKU | primary locale | storefronts | category | age rating:
Copyright | export-compliance answer | content-rights confirmation:
Review contact and backend availability window:

OPTIONAL COMMERCE (write “disabled” when not launching it)
Launch state: disabled / enabled
If enabled: subscription-group and production IDs, benefits, prices/trials,
Privacy + Terms URLs, Sandbox lifecycle evidence reference:
```

No Apple sign-in, purchase, upload, agreement acceptance, or submission is
authorized by this handoff.
