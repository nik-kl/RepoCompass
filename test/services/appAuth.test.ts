import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GitHubAppAuth } from "../../src/services/github/appAuth.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function decodeJwt(jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [header, payload] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")),
  };
}

describe("GitHubAppAuth", () => {
  it("issues an RS256 app JWT valid for ~10 minutes", async () => {
    const auth = new GitHubAppAuth(privateKey);
    const jwt = await auth.getAppJwt();

    const { header, payload } = decodeJwt(jwt);
    expect(header.alg).toBe("RS256");
    expect(payload.iss).toBe(1); // GITHUB_APP_ID from vitest env
    expect(payload.exp! as number - (payload.iat! as number)).toBe(600);
  });

  it("returns the cached JWT until it expires", async () => {
    const auth = new GitHubAppAuth(privateKey);
    expect(await auth.getAppJwt()).toBe(await auth.getAppJwt());
  });

  it("invalidateInstallation is safe for unknown installations", () => {
    const auth = new GitHubAppAuth(privateKey);
    expect(() => auth.invalidateInstallation(999)).not.toThrow();
  });
});
