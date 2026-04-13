import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashPassword } from "./crypto.js";
import { AppDatabase } from "./db.js";
import type { AppConfig } from "./config.js";

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

describe("app database", () => {
  it("creates users, organizations, sessions, and connections", () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-app-db-"));
    cleanupDirs.push(dir);
    const db = new AppDatabase(makeConfig(dir));
    const user = db.createUser("owner@example.com", hashPassword("super-secret-password"), "Owner");
    const org = db.createOrganizationWithOwner("Owner Org", "owner-org", user.id);
    const session = db.createSession(user.id, org.id);

    expect(db.findUserByEmail(user.email)?.id).toBe(user.id);
    expect(db.getSession(session.id)?.active_org_id).toBe(org.id);

    const connection = db.createConnection({
      organizationId: org.id,
      alias: "client-a",
      baseUrl: "https://client-a.flexibee.eu",
      companySlug: "client_a",
      defaultFormat: "json",
      mode: "prod",
      keyVersion: "v1",
      encryptedSecret: JSON.stringify({ keyVersion: "v1", ciphertext: "a", iv: "b", tag: "c" })
    });

    expect(db.getConnectionByAlias(org.id, "client-a")?.id).toBe(connection.id);
    expect(db.listConnections(org.id)).toHaveLength(1);
  });
});
