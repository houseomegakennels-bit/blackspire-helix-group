import "server-only";

import https from "node:https";
import type { ClientRequest } from "node:http";

// Fixed trusted server endpoints only. Dedicated agent avoids ambient proxy
// routing; TLS certificate and hostname verification remain enabled. Neither
// redirects nor retries can move/replay workload credentials or Buyer writes.
export function postBuyerWriterJson(
  url: URL,
  credentialHeader: "x-buyer-issuer-key" | "x-buyer-ingress-key",
  credential: string,
  payload: unknown,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const unavailable = () => new Error("Buyer writer transport unavailable.");
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search
    || !["x-buyer-issuer-key", "x-buyer-ingress-key"].includes(credentialHeader)
    || !/^[A-Za-z0-9_-]{43}$/.test(credential) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 100000) {
    return Promise.reject(unavailable());
  }
  let bytes: Buffer;
  try { bytes = Buffer.from(JSON.stringify(payload)); } catch { return Promise.reject(unavailable()); }
  if (bytes.length > 9 * 1024 * 1024) return Promise.reject(unavailable());
  const agent = new https.Agent({ keepAlive: false, maxSockets: 1, rejectUnauthorized: true });
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: ClientRequest | undefined;
    const finish = (value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      agent.destroy();
      if (value && performance.now() < deadline) resolve(value); else reject(unavailable());
    };
    const timer = setTimeout(() => { finish(); request?.destroy(); }, timeoutMs);
    try {
    request = https.request(url, {
      method: "POST", agent, rejectUnauthorized: true,
      headers: { "content-type": "application/json", "accept": "application/json", "accept-encoding": "identity",
        "content-length": bytes.length, [credentialHeader]: credential },
    }, response => {
      if (response.statusCode !== 200 || response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        response.destroy(); finish(); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8192) { response.destroy(); finish(); } else chunks.push(chunk);
      });
      response.once("error", () => finish());
      response.once("aborted", () => finish());
      response.once("end", () => {
        try {
          const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
          if (!value || typeof value !== "object" || Array.isArray(value)) { finish(); return; }
          finish(value);
        } catch { finish(); }
      });
    });
    request.once("error", () => finish());
    request.end(bytes);
    } catch { finish(); request?.destroy(); }
  });
}
