# Wanderful integration checkpoint — 5 September 2026

This checkpoint combines the completed local development lanes onto the GitHub
main baseline `adea2c08540e87f0acd7eebb976c72eab8eb76c3`.

## Included work

- Foreground route guidance and timestamp/permission recovery corrections
  (source `26523892f5ec2269658d3a00c9b58e9aacfac1f5`).
- StoreKit premium foundation and verified transaction/entitlement corrections
  (source `c2a7f86087f8418cd0767b0f8324c3c8350f3bfc`).
- Physical-device voice crash corrections (source `ea8702f4`, recovered source
  tree `400d28a1b2ef9a692d675d433086fbb97dc89287`).
- Minimal LLM planning endpoint and adapters from the completed integration lane.
- Additional dormant LLM route-assessment module (source `4ae96cb0`), corrected
  during integration so fallback results pass the primary route validation.
  Invalid model output cannot invoke an unvalidated fallback.
- Dormant managed Supabase bootstrap and migration 011 hardening. No database
  has been changed by this integration.
- Phone reliability evaluation (source `20856cf`, recovered source tree
  `040e14069bf86f91ea0b745754af0bd836bfb499`).
- App Store/legal drafts and reconciled release artifact verifier.

The superseded larger phone-staging implementation is preserved separately in
the recovery checkpoint. Its older LLM adapters must not replace the newer
minimal endpoint without a deliberate integration review.

## Integration review

Resolved overlapping guidance and premium UI compositions, including exhaustive
test-scenario handling. Historical Apple V1 validator tests now load their sealed
historical inputs rather than treating changing release drafts as sealed proof.
This does not establish current App Store readiness.

Verification at this checkpoint: combined backend suite 1,198 passed, zero
failures; offline outdoor quality corpus 101 passed; release-verifier self-tests
49 command cases plus stale-report recovery passed; integrated Debug build passed.
The integrated Release build and its artifact verifier also passed.

Prior agent evidence includes 739 navigation unit tests and seven guidance UI
tests. Three StoreKitTest integration cases skipped because the simulator lacked
the necessary entitlement. Those cases still need device/StoreKit validation.
No fresh simulator test execution is claimed by this checkpoint.

## Runtime status and another computer

This is a source checkpoint, not deployment or feature activation. Production
provider, research, database-sync and monetization flags remain disabled.
Foreground guidance is not background/offline turn-by-turn navigation.

On Windows, clone the repository and use the backend's locked Node dependencies
(`npm ci` in `backend`) for backend development. iOS builds, Simulator, signing,
and installation still require macOS and Xcode. Local keys, signing material,
`Configuration/Local.xcconfig`, dependencies and build outputs are not included.

Two raw managed-database bootstrap receipts containing internal account/security
metadata are retained in the original local task only and excluded from this
public source checkpoint. They are not application code or runtime dependencies.
