import { createServer, request as httpRequest } from "node:http";
import { timingSafeEqual } from "node:crypto";

const expectedToken = process.env.SARVAM_WEBHOOK_TOKEN?.trim();
if (!expectedToken) throw new Error("SARVAM_WEBHOOK_TOKEN is required.");
const targetPort = Number(process.env.SARVAM_RELAY_TARGET_PORT ?? 4000);
if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
  throw new Error("SARVAM_RELAY_TARGET_PORT must be a valid port.");
}
const relayPort = Number(process.env.SARVAM_RELAY_PORT ?? 4040);
if (!Number.isInteger(relayPort) || relayPort < 1 || relayPort > 65535) {
  throw new Error("SARVAM_RELAY_PORT must be a valid port.");
}

const matches = (received) => {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expectedToken);
  return left.length === right.length && timingSafeEqual(left, right);
};

const server = createServer((incoming, outgoing) => {
  const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
  const webhookRequest = incoming.method === "POST" &&
    url.pathname === "/api/webhooks/sarvam/outbound" &&
    matches(url.searchParams.get("token"));
  // This narrow unauthenticated endpoint lets the server verify that a quick
  // tunnel still resolves to this AgentFront instance before it dials anyone.
  const healthRequest = incoming.method === "GET" && url.pathname === "/api/health" && !url.search;
  if (!webhookRequest && !healthRequest) {
    outgoing.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    outgoing.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const proxy = httpRequest({
    host: "127.0.0.1",
    port: targetPort,
    method: healthRequest ? "GET" : "POST",
    path: healthRequest ? "/api/health" : `${url.pathname}${url.search}`,
    headers: { ...incoming.headers, host: `127.0.0.1:${targetPort}` },
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  proxy.setTimeout(30_000, () => proxy.destroy(new Error("AgentFront API timeout")));
  proxy.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    outgoing.end(JSON.stringify({ error: "AgentFront API unavailable" }));
  });
  incoming.pipe(proxy);
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;

server.listen(relayPort, "127.0.0.1", () => {
  console.log(`Restricted Sarvam webhook relay listening on http://127.0.0.1:${relayPort}`);
});
