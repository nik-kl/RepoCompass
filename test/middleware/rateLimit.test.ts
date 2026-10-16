import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "../../src/middleware/rateLimit.js";

function buildApp(options: Parameters<typeof rateLimit>[0]): Hono {
  const app = new Hono();
  app.post("/", rateLimit(options), (c) => c.json({ ok: true }));
  return app;
}

const request = (headers: Record<string, string> = {}) =>
  new Request("http://test/", { method: "POST", headers, body: "{}" });

describe("rateLimit", () => {
  it("allows requests under the limit and rejects beyond it with 429", async () => {
    const app = buildApp({ max: 2, windowMs: 10_000 });
    const headers = { authorization: "Bearer same-key" };

    expect((await app.fetch(request(headers))).status).toBe(200);
    expect((await app.fetch(request(headers))).status).toBe(200);
    const rejected = await app.fetch(request(headers));
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBeTruthy();
    expect(await rejected.json()).toEqual({ error: "Rate limit exceeded" });
  });

  it("keys buckets independently", async () => {
    const app = buildApp({ max: 1, windowMs: 10_000 });
    expect((await app.fetch(request({ authorization: "Bearer a" }))).status).toBe(200);
    expect((await app.fetch(request({ authorization: "Bearer b" }))).status).toBe(200);
    expect((await app.fetch(request({ authorization: "Bearer a" }))).status).toBe(429);
  });

  it("resets after the window elapses", async () => {
    const app = buildApp({ max: 1, windowMs: 120 });
    const headers = { authorization: "Bearer window-key" };
    expect((await app.fetch(request(headers))).status).toBe(200);
    expect((await app.fetch(request(headers))).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await app.fetch(request(headers))).status).toBe(200);
  });
});
