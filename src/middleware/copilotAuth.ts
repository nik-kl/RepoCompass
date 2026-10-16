import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import { env } from "../config.js";

const jwks = createRemoteJWKSet(new URL(env.COPILOT_JWKS_URL));

let skipWarningLogged = false;

/**
 * Verifies the `Authorization: Bearer <JWT>` that the Copilot extension
 * runtime attaches to every chat request (Phase 3 – middleware/copilotAuth.ts).
 * JWKS is fetched lazily on first use and cached by `jose`.
 *
 * COPILOT_AUTH_SKIP=true bypasses verification for local demos only; it is
 * hard-disabled when NODE_ENV=production.
 */
export const copilotAuth: MiddlewareHandler = async (c, next) => {
  if (env.COPILOT_AUTH_SKIP) {
    if (env.NODE_ENV === "production") {
      return c.json({ error: "COPILOT_AUTH_SKIP is not allowed in production" }, 500);
    }
    if (!skipWarningLogged) {
      skipWarningLogged = true;
      console.warn("[auth] COPILOT_AUTH_SKIP=true — authentication BYPASSED (development only)");
    }
    return next();
  }

  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    return c.json({ error: "Missing bearer token" }, 401);
  }

  try {
    await jwtVerify(token, jwks, {
      ...(env.COPILOT_TOKEN_ISSUER ? { issuer: env.COPILOT_TOKEN_ISSUER } : {}),
      ...(env.COPILOT_TOKEN_AUDIENCE ? { audience: env.COPILOT_TOKEN_AUDIENCE } : {}),
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? (error as Error).message;
    console.warn(`[auth] rejected Copilot token: ${code}`);
    return c.json({ error: "Invalid token" }, 401);
  }

  await next();
};
