import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { mcpRoutes } from "./routes/mcp.js";

const app = new Hono();

app.get("/", (c) => c.json({ name: "RepoCompass MCP server", mcp: "/mcp" }));
app.get("/health", (c) => c.json({ ok: true }));
app.route("/mcp", mcpRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error("[repocompass]", err);
  return c.json({ error: "Internal server error" }, 500);
});

if (!process.env.VERCEL && process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port }, () => console.log(`http://localhost:${port}`));
}

export default app;
