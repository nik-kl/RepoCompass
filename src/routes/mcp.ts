import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { createRepoServer } from "../mcp/tools.js";

export const mcpRoutes = new Hono();

mcpRoutes.all("/", async (c) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return c.json({ error: "Missing GitHub token. Send the header: Authorization: Bearer <token>" }, 401);
  }

  // Stateless: fresh server + transport per request, so tokens never mix between users.
  const server = createRepoServer(token);
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(c);
});
