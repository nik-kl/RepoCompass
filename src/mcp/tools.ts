import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

const IGNORE =
  /(^|\/)(node_modules|dist|build|\.git)\/|(package-lock\.json|\.lock|\.min\.js|\.(png|jpe?g|gif|svg|ico|woff2?|ttf|pdf|zip))$/i;

const MAX_FILE_BYTES = 900_000; // GitHub's contents API returns no content above ~1 MB
const MAX_LINES = 400;
const MAX_LISTED = 500;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ ...text(t), isError: true });

/** Maps GitHub errors to short messages so raw upstream details are never forwarded. */
function describeError(e: unknown, what: string): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) return "GitHub rejected the token (invalid or expired). Create a new one.";
  if (status === 403) return `GitHub denied access to ${what} (missing permission or rate limit reached).`;
  if (status === 404) return `${what} not found, or the token has no access to it.`;
  return `Could not read ${what} (GitHub error${status ? ` ${status}` : ""}).`;
}

async function listFiles(octokit: Octokit, owner: string, repo: string, ref?: string) {
  const branch = ref ?? (await octokit.rest.repos.get({ owner, repo })).data.default_branch;
  const { data } = await octokit.rest.git.getTree({ owner, repo, tree_sha: branch, recursive: "true" });
  const files = data.tree
    .filter((n) => n.type === "blob" && n.path && !IGNORE.test(n.path))
    .map((n) => ({ path: n.path!, size: n.size ?? 0 }));
  return { files, truncated: Boolean(data.truncated) };
}

export function createRepoServer(githubToken: string): McpServer {
  const octokit = new Octokit({ auth: githubToken, userAgent: "RepoCompass" });
  const server = new McpServer({ name: "repocompass", version: "0.3.0" });

  const repoArgs = {
    owner: z.string().describe("GitHub owner or org"),
    repo: z.string().describe("Repository name"),
    ref: z.string().optional().describe("Branch, tag or SHA (default: default branch)"),
  };

  server.registerTool(
    "repo_map",
    {
      description:
        "List the files of a GitHub repository. Without 'path' it returns the whole tree (up to 500 files). " +
        "With 'path' it lists one folder (one level), which is the way to explore very large repositories.",
      inputSchema: {
        ...repoArgs,
        path: z.string().optional().describe("Optional folder to list, e.g. 'src/routes'"),
      },
    },
    async ({ owner, repo, ref, path }) => {
      const what = `${owner}/${repo}`;
      try {
        if (path) {
          const clean = path.replace(/^\/+|\/+$/g, "");
          const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: clean,
            ...(ref ? { ref } : {}),
          });
          if (!Array.isArray(data)) return fail(`${clean} is a file, not a folder. Use read_file.`);
          const lines = data
            .filter((e) => !IGNORE.test(e.type === "dir" ? `${e.path}/` : e.path))
            .map((e) => (e.type === "dir" ? `- ${e.path}/` : `- ${e.path}`));
          return text(
            lines.length
              ? `Contents of ${clean}/ (one level; call again with a subfolder to go deeper):\n${lines.join("\n")}`
              : "(empty folder)",
          );
        }

        const { files, truncated } = await listFiles(octokit, owner, repo, ref);
        const shown = files.slice(0, MAX_LISTED).map((f) => `- ${f.path}`).join("\n");
        const note =
          truncated || files.length > MAX_LISTED
            ? "\n\n(list truncated; use the 'path' argument to explore folders)"
            : "";
        return text(shown + note);
      } catch (e) {
        return fail(describeError(e, path ? `${what}/${path}` : what));
      }
    },
  );

  server.registerTool(
    "find_files",
    {
      description: "Find the most relevant files in a repo for a topic or keywords (matches file paths, not contents).",
      inputSchema: { ...repoArgs, query: z.string().describe("Keywords, e.g. 'auth middleware'") },
    },
    async ({ owner, repo, ref, query }) => {
      try {
        const { files, truncated } = await listFiles(octokit, owner, repo, ref);
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
        const note = truncated ? "\n\n(repository tree was truncated by GitHub; results may be incomplete)" : "";
        return text((scored.length ? scored.map((f) => `- ${f.path}`).join("\n") : "No matching files.") + note);
      } catch (e) {
        return fail(describeError(e, `${owner}/${repo}`));
      }
    },
  );

  server.registerTool(
    "read_file",
    {
      description: `Read a file from a GitHub repository (max ${MAX_LINES} lines per call; use startLine to continue).`,
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
        if (data.size > MAX_FILE_BYTES || !data.content) {
          return fail(`${path} is too large to read via the GitHub API (${data.size} bytes).`);
        }
        const lines = Buffer.from(data.content, "base64").toString("utf8").split("\n");
        const start = (startLine ?? 1) - 1;
        const slice = lines.slice(start, start + MAX_LINES);
        const more =
          start + MAX_LINES < lines.length ? `\n\n(file continues at line ${start + MAX_LINES + 1})` : "";
        return text(slice.join("\n") + more);
      } catch (e) {
        return fail(describeError(e, `${owner}/${repo}/${path}`));
      }
    },
  );

  server.registerPrompt(
    "onboarding_guide",
    {
      description: "Create an onboarding guide with a Mermaid architecture diagram for a GitHub repository",
      argsSchema: {
        owner: z.string().describe("GitHub owner or org"),
        repo: z.string().describe("Repository name"),
      },
    },
    ({ owner, repo }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Create an onboarding guide for the GitHub repository ${owner}/${repo}.`,
              "",
              "Process: call repo_map first. For large repositories, explore folders with its 'path' argument. " +
                "Then use find_files and read_file on the entry points, configuration and key modules. " +
                "Base every statement on code you actually read; say so when something is unclear.",
              "",
              "Write these sections: Purpose, Tech stack, Architecture overview, Key files and folders, " +
                "Data and request flow, How to run it locally, Where to start contributing.",
              "",
              "Include one Mermaid diagram (flowchart TD) of the architecture. Mermaid rules: " +
                "node IDs alphanumeric only (e.g. apiRoutes), node labels in quotes like apiRoutes[\"API routes\"], " +
                'edge labels in quotes like A -->|"calls"| B, at most 15 nodes, no other prose inside the code block.',
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
