// src/services/github/repoContext.ts
import { Octokit } from "@octokit/rest";
import { getGitHubAppAuth } from "./appAuth.js";
import { createInstallationOctokit, fetchFileContent, fetchRepositoryTree } from "./octokitClient.js";
import type { ContextChunk } from "../../prompts/systemPrompt.js";

export interface RepoTarget {
  owner: string;
  repo: string;
}

/**
 * Extracts owner/repo from Copilot's `copilot_references` payload
 * or from an explicit `owner/repo` mention in the user's message.
 */
export function detectRepository(messages: Array<{ content: unknown; copilot_references?: unknown }>, fallbackRepo?: string): RepoTarget | null {
  // 1. Check Copilot's automatic context references (most common on github.com & VS Code)
  for (let i = messages.length - 1; i >= 0; i--) {
    const refs = messages[i]?.copilot_references;
    if (Array.isArray(refs)) {
      for (const ref of refs) {
        const r = ref as { type?: string; data?: { name?: string; ownerLogin?: string; full_name?: string }; id?: string };
        if (r?.data?.ownerLogin && r?.data?.name) {
          return { owner: r.data.ownerLogin, repo: r.data.name };
        }
        const fullName = r?.data?.full_name ?? r?.id ?? "";
        const match = fullName.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
        if (match) return { owner: match[1]!, repo: match[2]! };
      }
    }
  }

  // 2. Check if the user typed "owner/repo" in their message
  const lastMsg = messages[messages.length - 1];
  const text = typeof lastMsg?.content === "string" ? lastMsg.content : "";
  const inlineMatch = text.match(/\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/);
  if (inlineMatch && !inlineMatch[0].startsWith("http")) {
    return { owner: inlineMatch[1]!, repo: inlineMatch[2]! };
  }

  // 3. Fallback to env REPO_NAME if formatted as owner/repo
  if (fallbackRepo && fallbackRepo.includes("/")) {
    const [owner, repo] = fallbackRepo.split("/");
    if (owner && repo) return { owner, repo };
  }
  return null;
}

/** Finds the GitHub App installation ID for a specific repository. */
async function getRepoInstallationId(owner: string, repo: string): Promise<number> {
  const appJwt = await getGitHubAppAuth().getAppJwt();
  const appOctokit = new Octokit({ auth: appJwt, userAgent: "RepoCompass" });
  const { data } = await appOctokit.apps.getRepoInstallation({ owner, repo });
  return data.id;
}

const IGNORE_PATTERNS = /(\bnode_modules\/|\bdist\/|\bbuild\/|\.lock$\vert{}\bpackage-lock\.json$|\.min\.js$\vert{}\.png$|\.jpg$\vert{}\.svg$|\.woff|\.ttf)/i;

/**
 * Fetches the repository file tree (repoMap) and the top K most relevant files
 * for the user's query on-the-fly via GitHub REST API.
 */
export async function gatherRepoContext(
  target: RepoTarget,
  query: string,
  maxFiles = 6,
): Promise<{ repoMap: string; chunks: ContextChunk[] }> {
  const installationId = await getRepoInstallationId(target.owner, target.repo);
  const tree = await fetchRepositoryTree(installationId, target.owner, target.repo);

  const cleanFiles = tree.filter((f) => !IGNORE_PATTERNS.test(f.path) && f.size < 100_000);
  const repoMap = cleanFiles
    .slice(0, 250)
    .map((f) => `- ${f.path}`)
    .join("\n");

  // Score files by query keywords + architectural importance (README, package.json, entrypoints)
  const keywords = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

  const scored = cleanFiles.map((file) => {
    const lower = file.path.toLowerCase();
    let score = 0;
    if (lower === "readme.md" || lower === "package.json" || lower === "pyproject.toml" || lower === "cargo.toml") score += 10;
    if (/^(src\/)?(index|main|app|server|config)\.[a-z]+$/i.test(file.path)) score += 8;
    if (lower.includes("route") || lower.includes("controller") || lower.includes("service")) score += 3;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 15;
    }
    return { file, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, maxFiles).map((s) => s.file);

  const octokit = await createInstallationOctokit(installationId);
  const chunks: ContextChunk[] = [];

  await Promise.all(
    selected.map(async (f) => {
      const content = await fetchFileContent(installationId, target.owner, target.repo, f.path).catch(() => null);
      if (!content) return;
      const lines = content.split("\n");
      const trimmed = lines.slice(0, 200).join("\n"); // Cap per-file lines to keep prompt fast
      chunks.push({
        filePath: f.path,
        symbolName: null,
        parentSymbol: null,
        startLine: 1,
        endLine: Math.min(lines.length, 200),
        content: trimmed,
      });
    }),
  );

  return { repoMap, chunks };
}
