import { createServer } from "node:http";
import { parseIntentEndpoint, IntentParseError } from "./parseIntent.js";

const PORT = Number(process.env.PORT || 3000);

export function createIntentServer(options = {}) {
  return createServer(async (request, response) => {
    try {
      const body = request.method === "POST" ? await readJsonBody(request) : {};
      const result = await handleIntentHttpRequest(
        {
          method: request.method,
          url: request.url,
          body
        },
        options
      );
      return sendJson(response, result.statusCode, result.payload);
    } catch (error) {
      const statusCode = error instanceof IntentParseError ? error.statusCode : 500;
      return sendJson(response, statusCode, {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
}

export async function handleIntentHttpRequest(request, options = {}) {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return { statusCode: 200, payload: { ok: true } };
    }

    if (request.method !== "POST" || request.url !== "/api/parse-intent") {
      return { statusCode: 404, payload: { error: "Not found" } };
    }

    const intent = await parseIntentEndpoint(request.body, options);
    return { statusCode: 200, payload: intent };
  } catch (error) {
    const statusCode = error instanceof IntentParseError ? error.statusCode : 500;
    return {
      statusCode,
      payload: {
        error: error instanceof Error ? error.message : "Unknown error"
      }
    };
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 16_384) {
        reject(new IntentParseError("Request body is too large.", 413));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new IntentParseError("Request body must be valid JSON.", 400));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createIntentServer().listen(PORT, () => {
    console.log(`TrailMind intent backend listening on http://localhost:${PORT}`);
  });
}
