import { Hono } from "hono";
import { verifyWebhookSignature } from "../middleware/webhookSignature.js";
import { handleWebhook } from "../services/github/webhookHandler.js";

export const webhookRoutes = new Hono<{ Variables: { rawBody: string } }>();

// Signature validation (middleware/webhookSignature.ts) -> dispatch
// (services/github/webhookHandler.ts) -> incremental index jobs (Phase 4).
webhookRoutes.post("/", verifyWebhookSignature, async (c) => {
  const event = c.req.header("x-github-event");
  if (!event) {
    return c.json({ error: "Missing X-GitHub-Event header" }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(c.get("rawBody"));
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const result = await handleWebhook(event, payload);
  console.log(`[webhook] ${event} (delivery ${c.req.header("x-github-delivery") ?? "-"}): ${result.message}`);
  return c.json({ ok: result.handled, message: result.message });
});
