import { readFileSync } from "node:fs";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    GITHUB_APP_ID: z.coerce.number().int().positive(),
    GITHUB_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_PRIVATE_KEY_PATH: z.string().min(1).optional(),
    GITHUB_WEBHOOK_SECRET: z.string().min(8),

    // Copilot token verification: the JWKS signature is the security boundary;
    // issuer is only checked when explicitly configured (GitHub's claim format
    // differs between Copilot surfaces).
    COPILOT_TOKEN_ISSUER: z.string().url().optional(),
    COPILOT_TOKEN_AUDIENCE: z.string().optional(),
    COPILOT_JWKS_URL: z.string().url().default("https://api.github.com/_private/jwks"),

    VECTOR_STORE: z.enum(["memory", "chroma"]).default("memory"),
    CHROMA_URL: z.string().url().default("http://localhost:8000"),
    EMBEDDING_PROVIDER: z.enum(["openai", "local"]).default("local"),
    EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

    // --- Phase 5: Copilot LLM + RAG pipeline ---
    // Base URL must be https (or localhost) so bearer tokens can't be
    // silently forwarded over plaintext.
    COPILOT_LLM_BASE_URL: z
      .string()
      .url()
      .default("https://api.githubcopilot.com")
      .refine(
        (url) =>
          url.startsWith("https://") ||
          url.startsWith("http://localhost") ||
          url.startsWith("http://127.0.0.1"),
        "COPILOT_LLM_BASE_URL must be https (or localhost for development)",
      ),
    COPILOT_MODEL: z.string().default("gpt-4o"),
    /** "copilot" (default) or "mock" (offline demo answers). */
    LLM_PROVIDER: z.enum(["copilot", "mock"]).default("copilot"),
    /** Development-only auth bypass; ignored when NODE_ENV=production. */
    COPILOT_AUTH_SKIP: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    REPO_NAME: z.string().default("this repository"),
    RAG_TOP_K: z.coerce.number().int().positive().default(6),
    MERMAID_REPAIR: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
  })
  .refine((env) => Boolean(env.GITHUB_PRIVATE_KEY ?? env.GITHUB_PRIVATE_KEY_PATH), {
    message: "Set either GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH",
    path: ["GITHUB_PRIVATE_KEY"],
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      console.error(`[config] ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

/** Resolves the GitHub App private key, normalizing `\n` escapes in inline PEMs. */
export function resolvePrivateKey(): string {
  if (env.GITHUB_PRIVATE_KEY) {
    return env.GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n").trim();
  }
  if (env.GITHUB_PRIVATE_KEY_PATH) {
    return readFileSync(env.GITHUB_PRIVATE_KEY_PATH, "utf8").replace(/\\n/g, "\n").trim();
  }
  throw new Error("No GitHub App private key configured");
}
