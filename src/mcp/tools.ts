import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

const IGNORE =
  /(^|\/)(node_modules|dist|build|\.git)\/|(package-lock\.json|\.lock|\.min\.js|\.(png|jpe?g|gif|svg|ico|woff2?|ttf|pdf|zip))$/i;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ ...text(t), isError: true });

async function listFiles(octokit: Octokit, owner: string, repo: string, ref?: string) {
  const branch = ref ?? (await octokit.rest.repos.get({ owner, repo })).data.default_branch;
  const { data } = await octokit.rest.git.getTree({ owner, repo, tree_sha: branch, recursive: "true" });
  const files = data.tree
    .filter((n) => n.type === "blob" && n.path && !IGNORE.test(n.path))
    .map((n) => ({ path: n.path!, size: n.size ?? 0 }));
  return { files, truncated: data.truncated };
}

export function createRepoServer(githubToken: string): McpServer {
  const octokit = new Octokit({ auth: githubToken, userAgent: "RepoCompass" });
  const server = new McpServer({ name: "repocompass", version: "0.2.0" });

  const repoArgs = {
    owner: z.string().describe("GitHub owner or org"),
    repo: z.string().describe("Repository name"),
    ref: z.string().optional().describe("Branch, tag or SHA (default: default branch)"),
  };

  server.registerTool(
    "repo_map",
    { description: "List the file tree of a GitHub repository to understand its structure.", inputSchema: repoArgs },
    async ({ owner, repo, ref }) => {
      try {
        const { files, truncated } = await listFiles(octokit, owner, repo, ref);
        const shown = files.slice(0, 500).map((f) => `- ${f.path}`).join("\n");
        const note = truncated || files.length > 500 ? "\n\n(list truncated)" : "";
        return text(shown + note);
      } catch (e) {
        return fail(`Could not read ${owner}/${repo}: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "find_files",
    {
      description: "Find the most relevant files in a repo for a topic or keywords (matches paths).",
      inputSchema: { ...repoArgs, query: z.string().describe("Keywords, e.g. 'auth middleware'") },
    },
    async ({ owner, repo, ref, query }) => {
      try {
        const { files } = await listFiles(octokit, owner, repo, ref);
        const kws = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
        const scored = files
          .map((f) => {
            const p = f.path.toLowerCase();
            let score = 0;
            if (/^(readme\.md|package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/.test(p)) score += 10;
            if (/^(src\/)?(index|main|app|server|config)\.[a-z]+$/.test(p)) score += 8;
            if (/route|controller|service/.test(p)) score += 3;
            for (const k of kws) if (p.includes(k)) score += 15;
            return { path: f.path, score };
          })
          .filter((f) => f.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 15);
        return text(scored.length ? scored.map((f) => `- ${f.path}`).join("\n") : "No matching files.");
      } catch (e) {
        return fail(`Search failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "read_file",
    {
      description: "Read a file from a GitHub repository (max 400 lines per call).",
      inputSchema: {
        ...repoArgs,
        path: z.string(),
        startLine: z.number().int().positive().optional(),
      },
    },
    async ({ owner, repo, ref, path, startLine }) => {
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ...(ref ? { ref } : {}) });
        if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
          return fail(`${path} is not a file.`);
        }
        const lines = Buffer.from(data.content, "base64").toString("utf8").split("\n");
        const start = (startLine ?? 1) - 1;
        const slice = lines.slice(start, start + 400);
        const more = start + 400 < lines.length ? `\n\n(file continues at line ${start + 401})` : "";
        return text(slice.join("\n") + more);
      } catch (e) {
        return fail(`Could not read ${path}: ${(e as Error).message}`);
      }
    },
  );

  return server;
}
