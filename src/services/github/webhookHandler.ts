import { getGitHubAppAuth } from "./appAuth.js";

export interface WebhookResult {
  handled: boolean;
  message: string;
}

interface PushPayload {
  action?: string;
  installation?: { id: number };
  repository?: { full_name?: string };
  commits?: Array<{ added: string[]; modified: string[]; removed: string[] }>;
}

async function onInstallation(payload: PushPayload): Promise<WebhookResult> {
  const action = payload.action ?? "unknown";
  if (payload.installation && (action === "deleted" || action === "suspend")) {
    getGitHubAppAuth().invalidateInstallation(payload.installation.id);
  }
  // TODO: persist installation ↔ repository mappings once the index store exists.
  return { handled: true, message: `installation:${action}` };
}

async function onPush(payload: PushPayload): Promise<WebhookResult> {
  const repoFullName = payload.repository?.full_name;
  const installationId = payload.installation?.id;
  if (!repoFullName || !installationId) {
    return { handled: false, message: "push payload missing repository or installation" };
  }

  const changedFiles = new Set<string>();
  for (const commit of payload.commits ?? []) {
    for (const file of [...commit.added, ...commit.modified, ...commit.removed]) {
      changedFiles.add(file);
    }
  }

  // TODO (Phase 4): enqueue an incremental index job that re-parses only
  // `changedFiles` and refreshes their vectors (see astCache design).
  return { handled: true, message: `push:${repoFullName} files=${changedFiles.size}` };
}

/** Dispatches a signature-verified GitHub webhook event to its handler. */
export async function handleWebhook(event: string, payload: unknown): Promise<WebhookResult> {
  const body = (payload ?? {}) as PushPayload;
  switch (event) {
    case "ping":
      return { handled: true, message: "pong" };
    case "installation":
    case "installation_repositories":
      return onInstallation(body);
    case "push":
      return onPush(body);
    default:
      return { handled: false, message: `unhandled event: ${event}` };
  }
}
