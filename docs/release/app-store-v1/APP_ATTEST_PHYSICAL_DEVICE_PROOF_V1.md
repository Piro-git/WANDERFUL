# App Attest Physical-Device Proof V1

Status: **NOT RUN — real iPhone and distributed build required**
Blocker: `ASV1-010`

The Release entitlement source selects App Attest `production`. This is necessary but not proof that attestation and assertion validation work. Simulator, unsigned Simulator build, source inspection and a development-environment key are invalid substitutes.

Apple states that distributed apps use the production App Attest environment. Server validation must verify the attestation and subsequent assertions for the expected app identity and payload. Sources retrieved 2026-08-23: [App Attest environment entitlement](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.developer.devicecheck.appattest-environment), [Validating apps that connect to your server](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server).

## Preconditions

- Explicit App ID `com.trailmind.app` has App Attest enabled for the approved team.
- A signed TestFlight/App Store-distributed Release build has the production entitlement after signing.
- Exact team identifier, bundle identifier, build number and backend relying-party configuration are approved.
- Backend test window is authorized and can distinguish the proof requests without exposing raw tokens or personal data.
- Retention/redaction for attestation key IDs, IPs, errors and request metadata is documented.
- A real supported iPhone running the selected iOS version is available; it is not jailbroken or managed in a way that invalidates the intended test.

## Bounded proof protocol

1. Record build commit, version/build, archive hash, iPhone model, iOS version, install channel, UTC time and operator. Do not record device serial/UDID in this repository.
2. Inspect the installed signed app's effective entitlement: App Attest environment must be `production` and application identifier must match the approved team plus `com.trailmind.app`.
3. Fresh-install the TestFlight build. Start the one authorized route-planning request designed for this proof.
4. Confirm the app creates/uses an App Attest key and sends an attestation object with a one-time server challenge. Do not print the attestation, key material or challenge.
5. Confirm the server verifies Apple's certificate chain, authenticator data, expected relying-party/app identifier hash, production AAGUID/receipt expectations, challenge hash and credential/key identifier before accepting the key.
6. Submit a protected request with an assertion over the exact canonical request payload/challenge. Confirm signature, client-data hash and monotonic counter validation before route handling.
7. Replay the same assertion. Expected result: reject before provider/business processing; provider call count remains zero for the replay.
8. Tamper one protected payload field while reusing the assertion. Expected result: reject before provider/business processing.
9. Send a request without required attestation/assertion. Expected result: fail closed with a bounded user-facing retry/error state and no provider processing.
10. Create a fresh valid assertion. Expected result: one accepted request, then verify the app's response/error handling without claiming route success unless separately authorized.

## Server evidence required

The proof owner supplies a redacted, independently reviewable receipt containing:

- environment and distributed channel;
- expected team/bundle/relying-party identity match;
- attestation validation result and validation category/receipt checks applicable to TestFlight/App Store distribution;
- assertion signature/hash/counter results;
- replay, tamper and missing-proof rejections;
- proof that rejected cases caused zero provider/database mutation;
- accepted-case correlation ID, response class and bounded provider-call accounting;
- server version/commit, configuration fingerprint that contains no secret, timestamps and reviewer sign-off.

Apple's validation guidance includes app identity, AAGUID/receipt, credential ID and assertion counter checks. Exact production policy must follow the current Apple documentation and the backend threat model, not this summary alone.

## Acceptance criteria

Pass only when every negative case fails closed before protected processing, a fresh valid assertion succeeds as designed, effective signed entitlements match, evidence is redacted, and a second reviewer validates the receipt. A source `production` string or successful Simulator request is **not** a pass.

## Failure handling

On failure, keep public release NO-GO; preserve redacted evidence; do not downgrade enforcement, reuse development credentials, switch environments, disclose attestation objects, or enable a bypass for review. Assign the fault to signing/App ID, client canonicalization, server validation or deployment configuration with a new bounded proof after correction.
