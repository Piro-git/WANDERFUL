# App Attest physical-device verification

Simulator tests use injected fakes only and do not demonstrate real App Attest verification.

Run these checks after the Apple App ID capability, App ID prefix, production backend URL, allowed validation categories, allowed build versions, and durable repository are configured:

- Development-signed physical device: fresh install, registration, one session, and three concurrent loop variants.
- Relaunch: Keychain key ID is reused; route-session token is not reused across launch.
- Reinstall/key recovery: stale or unavailable key produces a new registration without unrestricted fallback.
- Network interruption during challenge, attestation, assertion, and route calls.
- Device/server clock differences around challenge and two-minute session expiry.
- Background and foreground during session creation and concurrent routing.
- Server-invalidated, expired, and exhausted route sessions refresh once with a new request ID.
- Unsupported-device policy returns the safe user message and never enables unauthenticated production routing.
- TestFlight build validates with the production App Attest environment and configured TestFlight category.
- App Store-signed build validates with the production environment and configured App Store category.
- Release archive inspection confirms there is no GraphHopper key or key-bearing GraphHopper URL.

Record device model, OS version, signing channel, bundle version, backend environment, and pass/fail result without recording key IDs, challenges, assertions, tokens, coordinates, or route bodies.
