import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/healthz", (c) =>
  c.json({
    status: "ok",
    service: "repocompass",
    uptimeSec: Math.round(process.uptime()),
  }),
);
