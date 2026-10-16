import { Octokit } from "@octokit/rest";
import { getGitHubAppAuth } from "./appAuth.js";

/** Creates an Octokit client authenticated with a cached installation token. */
export async function createInstallationOctokit(installationId: number): Promise<Octokit> {
  return new Octokit({
    auth: await getGitHubAppAuth().getInstallationToken(installationId),
    userAgent: "RepoCompass",
  });
}

export interface RepoFile {
  path: string;
  sha: string;
  size: number;
}

/** Fetches the full git tree of a repository (used by the AST index pipeline). */
export async function fetchRepositoryTree(
  installationId: number,
  owner: string,
  repo: string,
): Promise<RepoFile[]> {
  const octokit = await createInstallationOctokit(installationId);
  const { data } = await octokit.git.getTree({ owner, repo, tree_sha: "HEAD", recursive: "true" });
  return (data.tree ?? [])
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
    .map((entry) => ({
      path: entry.path as string,
      sha: entry.sha as string,
      size: entry.size ?? 0,
    }));
}

/** Fetches and decodes a single UTF-8 file; returns null for dirs/missing files. */
export async function fetchFileContent(
  installationId: number,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  const octokit = await createInstallationOctokit(installationId);
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ...(ref ? { ref } : {}),
  });
  if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
    return null;
  }
  return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
}
