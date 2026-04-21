import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import { FlexiAppOAuthProvider } from "./oauth.js";

function makeConfig(dataDir: string): AppConfig {
  return {
    appName: "Test",
    appBaseUrl: "http://localhost:8787",
    appPort: 8787,
    appDataDir: dataDir,
    appCookieName: "test",
    appCookieSecure: false,
    appCookieTtlSeconds: 3600,
    oauthCodeTtlSeconds: 600,
    oauthAccessTokenTtlSeconds: 3600,
    oauthRefreshTokenTtlSeconds: 86400,
    writeConfirmationTtlSeconds: 600,
    encryptionKeys: [{ version: "v1", key: "01234567890123456789012345678901" }],
    reviewerEmail: "reviewer@example.com",
    reviewerPassword: "ChangeMeReview123!",
    reviewerName: "Reviewer",
    supportEmail: "support@example.com",
    appDomain: "http://localhost:8787",
    widgetResourceDomain: "http://localhost:8787",
    cloudflareTunnelName: "test",
    cloudflareHostname: "test.example.com"
  };
}

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("FlexiAppOAuthProvider", () => {
  it("registers public DCR clients without a client secret", () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-app-oauth-"));
    cleanupDirs.push(dir);
    const config = makeConfig(dir);
    const db = new AppDatabase(config);
    const provider = new FlexiAppOAuthProvider(db, config);

    const registered = provider.clientsStore.registerClient({
      redirect_uris: ["https://chatgpt.com/connector/oauth/example"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "ChatGPT",
      token_endpoint_auth_method: "none"
    });

    expect(registered.client_secret).toBeUndefined();
    expect(db.getClient(registered.client_id)?.client_secret).toBeUndefined();
  });
});
