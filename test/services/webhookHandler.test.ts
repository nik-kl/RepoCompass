import { describe, expect, it } from "vitest";
import { handleWebhook } from "../../src/services/github/webhookHandler.js";

describe("handleWebhook", () => {
  it("answers ping events", async () => {
    expect(await handleWebhook("ping", { zen: "hi" })).toEqual({
      handled: true,
      message: "pong",
    });
  });

  it("collects changed files from push payloads", async () => {
    const result = await handleWebhook("push", {
      installation: { id: 7 },
      repository: { full_name: "acme/widgets" },
      commits: [
        { added: ["src/a.ts"], modified: [], removed: [] },
        { added: [], modified: ["src/b.ts"], removed: ["src/old.ts"] },
      ],
    });
    expect(result).toEqual({ handled: true, message: "push:acme/widgets files=3" });
  });

  it("flags push payloads missing repository context", async () => {
    const result = await handleWebhook("push", {});
    expect(result.handled).toBe(false);
  });

  it("returns unhandled for unknown events", async () => {
    const result = await handleWebhook("issues", { action: "opened" });
    expect(result).toEqual({ handled: false, message: "unhandled event: issues" });
  });
});
