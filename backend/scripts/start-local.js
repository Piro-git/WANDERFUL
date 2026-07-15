const port = localPort(process.env.PORT);
process.env.NODE_ENV = "development";
process.env.DATABASE_URL = "";
process.env.POSTGRES_URL = "";
process.env.APP_ATTEST_ALLOW_IN_MEMORY = "false";
process.env.ROUTE_ALLOW_INSECURE_LOCAL_ROUTING = "true";
process.env.INTENT_ALLOW_INSECURE_LOCAL_PARSING = "true";
process.env.ROUTE_PROVIDER_ENABLED = "true";
process.env.INTENT_PROVIDER_ENABLED = "true";

const { createIntentServer } = await import("../src/server.js");
const env = { ...process.env };

createIntentServer({ env }).listen(port, "127.0.0.1", () => {
  console.log(`TrailMind local backend listening on http://127.0.0.1:${port}`);
});

function localPort(value) {
  if (value === undefined || value === "") return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}
