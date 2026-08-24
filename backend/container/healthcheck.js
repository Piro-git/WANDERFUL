import { request } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RESPONSE_LIMIT_BYTES = 128;
const REQUEST_TIMEOUT_MS = 1_000;

export async function checkBoundedLiveness(options = {}) {
  const port = boundedPort(options.port ?? process.env.PORT);
  const requestImpl = options.requestImpl ?? request;
  return await new Promise((resolveCheck) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolveCheck(value === true);
    };
    const client = requestImpl({
      host: "127.0.0.1",
      port,
      path: "/health/live",
      method: "GET",
      headers: { Accept: "application/json", Connection: "close" }
    }, (response) => {
      let bytes = 0;
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk, "utf8");
        if (bytes > RESPONSE_LIMIT_BYTES) {
          response.destroy();
          finish(false);
          return;
        }
        body += chunk;
      });
      response.on("end", () => {
        finish(
          response.statusCode === 200 &&
          body === '{"status":"live"}'
        );
      });
      response.on("error", () => finish(false));
    });
    client.setTimeout(REQUEST_TIMEOUT_MS, () => {
      client.destroy();
      finish(false);
    });
    client.on("error", () => finish(false));
    client.end();
  });
}

function boundedPort(value) {
  const port = Number(value ?? 3_000);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : 3_000;
}

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  checkBoundedLiveness().then(
    (live) => { process.exitCode = live ? 0 : 1; },
    () => { process.exitCode = 1; }
  );
}
