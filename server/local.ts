import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { ensureServerComposition } from "./composition.js";
import { handleApiRequest } from "./http/router.js";

const port = Number.parseInt(process.env.BUILDY_API_PORT || "8787", 10);
const host = process.env.BUILDY_API_HOST || "127.0.0.1";

ensureServerComposition();

function getBody(request: IncomingMessage): BodyInit | undefined {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  return Readable.toWeb(request) as ReadableStream<Uint8Array>;
}

async function toWebRequest(request: IncomingMessage): Promise<Request> {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const authority = request.headers.host || `${host}:${port}`;
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }

  const body = getBody(request);

  return new Request(`${protocol}://${authority}${request.url || "/"}`, {
    method: request.method,
    headers,
    body,
    ...(body ? { duplex: "half" } : {}),
  } as RequestInit & { duplex?: "half" });
}

async function sendWebResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => target.setHeader(key, value));

  if (!response.body) {
    target.end();
    return;
  }

  target.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (request, response) => {
  try {
    await sendWebResponse(await handleApiRequest(await toWebRequest(request)), response);
  } catch (error) {
    console.error("Local API adapter failed", error);
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Lokale API-fout." } }));
  }
});

server.listen(port, host, () => {
  console.info(`Buildy API luistert op http://${host}:${port}`);
});
