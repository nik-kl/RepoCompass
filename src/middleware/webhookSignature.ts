import { createHmac, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { env } from "../config.js";

export type WebhookVariables = { rawBody: string };

function isValidSignature(rawBody: string, header: string): boolean {
  // Always compute the HMAC first so malformed headers take the same amount
  // of cryptographic work as well-formed ones (constant-work core).
  const expected = createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(rawBody).digest("hex");

  const separator = header.indexOf("=");
  if (separator === -1 || header.slice(0, separator) !== "sha256") return false;
  const provided = Buffer.from(header.slice(separator + 1), "hex");
  const correct = Buffer.from(expected, "hex");
  return provided.length === correct.length && provided.length > 0 && timingSafeEqual(provided, correct);
}

/**
 * Validates `X-Hub-Signature-256` over the raw body and stashes it as
 * `rawBody` so handlers can parse JSON without re-reading the consumed stream.
 */
export const verifyWebhookSignature: MiddlewareHandler<{ Variables: WebhookVariables }> = async (
  c,
  next,
) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");

  if (!signature || !isValidSignature(rawBody, signature)) {
    console.warn("[webhook] rejected: missing or invalid X-Hub-Signature-256");
    return c.json({ error: "Invalid webhook signature" }, 401);
  }

  c.set("rawBody", rawBody);
  await next();
};
