# Apple account endpoint integration

`src/accounts/appleSignIn.js` is intentionally additive. The production integrator must provide a durable encrypted account repository and a durable session repository; do not use an in-memory implementation in production.

In `src/server.js`, compose `createAppleSignInEndpoint` with the production repositories, a server-generated Apple client secret, and token exchange. Add the three POST paths to `isKnownPostPath`, `bodyLimit`, and `handleIntentHttpRequest`, forwarding `headers`. Do not log identity tokens, authorization codes, refresh tokens, or email addresses.

The only account data this module deletes are Wanderful's account record, encrypted Apple refresh token, app-owned cloud account data, and all server sessions. Local saved routes and pack lists are never deleted by the server. The iOS client offers a separate, explicit local-data action.
