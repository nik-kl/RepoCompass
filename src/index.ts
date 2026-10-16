
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { env } from "./config.js";
import { chatRoutes } from "./routes/chat.js";
import { healthRoutes } from "./routes/health.js";
import { webhookRoutes } from "./routes/webhooks.js";

export const app = new Hono();

app.route("/", healthRoutes);
app.route("/v1", chatRoutes);
app.route("/webhooks", webhookRoutes);

// Smee discards the original request path when forwarding, so a single
// channel serves both GitHub webhooks and Copilot chat requests. Dispatch
// here at the ingress root by header: GitHub events carry X-GitHub-Event,
// Copilot chat requests carry an Authorization bearer token.
app.post("/", async (c) => {
  const path = c.req.header("x-github-event") ? "/webhooks" : "/v1/chat";
  const request = new Request(`http://internal${path}`, {
    method: c.req.method,
    headers: Object.fromEntries(c.req.raw.headers),
    body: c.req.raw.body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return app.fetch(request);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  console.error("[repocompass] unhandled error:", error);
  return c.json({ error: "Internal server error" }, 500);
});

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`RepoCompass listening on http://localhost:${info.port}`);
  });
}

// Add this single line at the very bottom of src/index.ts:
export default app;
