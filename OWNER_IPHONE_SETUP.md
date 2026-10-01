# Personal iPhone build setup

This is an opt-in development path, not an App Store authentication replacement.
The already installed, owner-accepted Berlin build remains unchanged. No permanent
server or real device key has been enrolled by preparing these files.

## Activation after hosting is verified

1. Complete the isolated server setup in `backend/docs/owner-access.md` and
   `FREE_OWNER_HOSTING.md`. Verify the permanent HTTPS origin and runtime database
   admission before using the phone. Keep provider limits explicit.
2. Build the existing local app identity with Debug and the additive Swift flag
   `OTHER_SWIFT_FLAGS='$(inherited) -D WANDERFUL_PRIVATE_OWNER'`. Set the non-secret
   build setting `WANDERFUL_OWNER_ACCESS_ORIGIN=https://YOUR-STABLE-HOST` with no
   path or trailing slash. Do not combine it with `WANDERFUL_OWNER_PHONE_TEST`.
   Existing `TRAILMIND_APP_ENVIRONMENT=local` and a supported local bundle ID are
   required. Preserve the Personal Team signing configuration and app data.
3. On the initial device launch, pass `--wanderful-export-owner-public-key`.
   This creates a device-only Keychain P-256 key and writes only its public
   `keyId` and base64 SPKI DER to `Library/Application Support/OwnerPublicKey.json`
   in the app container. Transfer that public file using the connected-device
   tooling. A failed export must not be treated as successful enrollment.
4. An operator validates and allowlists that public key for a stable owner ID
   using the separate database operator process. There is no public enrollment
   endpoint. Never transfer the private Keychain value or provider keys into the
   app. Launch normally after enrollment; routine sessions renew automatically.
5. Verify a bounded Berlin route over cellular with the Mac server/tunnel stopped,
   session renewal, a cold wake, and revoked-key denial. Record the public origin,
   source revision, explicit allowance and result before calling this operational.

Missing or invalid private configuration fails closed. Private builds disable
research/evidence/highlight requests and direct-provider/loopback bypasses.
Ordinary builds retain App Attest and their original routing configuration.

Free hosting can sleep: the private authorization transport permits a bounded
75-second request / 90-second resource window; planning has matching outer limits.
Cancellation remains available. This does not promise always-on availability.

Apple Personal Team provisioning expires after seven days. Rebuild/reinstall is
still required; hosted authentication cannot remove Apple's signing restriction.
[Apple account overview](https://developer.apple.com/help/account/basics/about-your-developer-account).

Do not delete the app to renew signing. Device-only keys do not sync to another
phone; a replacement or missing key requires new operator approval and revocation
of the old key. The persistent key has no embedded permanent route bearer.
