import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { app } from "../../src/index.js";

const WEBHOOK_SECRET = "test-webhook-secret";

function signature(body: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
}

describe("GET /healthz", () => {
  it("returns 200 with service status", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", service: "repocompass" });
  });
});

describe("POST / (smee ingress dispatch)", () => {
  it("routes GitHub events (X-GitHub-Event) to the webhook pipeline", async () => {
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json", "x-github-event": "ping" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/signature/);
  });

  it("routes bearer requests (Copilot chat) to the chat pipeline", async () => {
    const res = await app.request("/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-a-real-jwt",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/token/i);
  });
});

describe("POST /v1/chat", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await app.request("/v1/chat", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Missing bearer token" });
  });

  it("rejects malformed tokens before any network call", async () => {
    const res = await app.request("/v1/chat", {
      method: "POST",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid token" });
  });
});

describe("POST /webhooks", () => {
  const body = JSON.stringify({ zen: "Design for failure.", hook_id: 1 });

  it("rejects requests with an invalid signature", async () => {
    const res = await app.request("/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
        "x-github-event": "ping",
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed ping event", async () => {
    const res = await app.request("/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature(body),
        "x-github-event": "ping",
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "pong" });
  });

  it("rejects signed requests missing X-GitHub-Event", async () => {
    const res = await app.request("/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature(body),
      },
      body,
    });
    expect(res.status).toBe(400);
  });
});
