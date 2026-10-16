import { createAppAuth } from "@octokit/auth-app";
import { env, resolvePrivateKey } from "../../config.js";

/** GitHub App JWTs are valid for at most 10 minutes; refresh after 9. */
const APP_JWT_TTL_MS = 9 * 60 * 1000;
/** Installation tokens are valid for ~1 hour; treat 55 minutes as the ceiling. */
const INSTALLATION_TOKEN_TTL_MS = 55 * 60 * 1000;
/** Refresh cached installation tokens this long before they expire. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * GitHub App authentication (Phase 3 – services/github/appAuth.ts).
 *
 * - App JWT: authenticates the App itself (app-level API calls, token minting).
 * - Installation token: grants access to the repositories installed on an
 *   installation; cached per installation id and refreshed ahead of expiry so
 *   webhook/query paths never block on token minting.
 */
export class GitHubAppAuth {
  private readonly appAuth: ReturnType<typeof createAppAuth>;
  private appJwt?: CachedToken;
  private readonly installationTokens = new Map<number, CachedToken>();

  constructor(privateKey: string = resolvePrivateKey()) {
    this.appAuth = createAppAuth({
      appId: env.GITHUB_APP_ID,
      privateKey,
    });
  }

  /** Returns a cached or freshly minted GitHub App JWT (RS256). */
  async getAppJwt(): Promise<string> {
    if (this.appJwt && Date.now() < this.appJwt.expiresAt) {
      return this.appJwt.token;
    }
    const { token } = (await this.appAuth({ type: "app" })) as { token: string };
    this.appJwt = { token, expiresAt: Date.now() + APP_JWT_TTL_MS };
    return token;
  }

  /** Returns an installation access token, cached per installation id. */
  async getInstallationToken(installationId: number): Promise<string> {
    const cached = this.installationTokens.get(installationId);
    if (cached) {
      if (Date.now() < cached.expiresAt - REFRESH_MARGIN_MS) {
        return cached.token;
      }
      // Evict before re-minting so no expired token lingers in the cache.
      this.installationTokens.delete(installationId);
    }

    const auth = (await this.appAuth({
      type: "installation",
      installationId,
    })) as { token: string; expiresAt?: string };

    const expiresAt = auth.expiresAt
      ? Date.parse(auth.expiresAt)
      : Date.now() + INSTALLATION_TOKEN_TTL_MS;

    this.installationTokens.set(installationId, { token: auth.token, expiresAt });
    return auth.token;
  }

  /** Drops a cached token, e.g. after an installation is suspended or deleted. */
  invalidateInstallation(installationId: number): void {
    this.installationTokens.delete(installationId);
  }
}

let singleton: GitHubAppAuth | undefined;

/**
 * Lazy app-wide singleton – constructed on first use so importing this module
 * never parses keys or reads env (keeps tests and tooling side-effect free).
 */
export function getGitHubAppAuth(): GitHubAppAuth {
  singleton ??= new GitHubAppAuth();
  return singleton;
}
