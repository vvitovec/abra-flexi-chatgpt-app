import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, hashPassword, verifyPassword } from "./crypto.js";
import type { AppConfig } from "./config.js";

const config: AppConfig = {
  appName: "Test",
  appBaseUrl: "http://localhost:8787",
  appPort: 8787,
  appDataDir: "/tmp",
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

describe("app crypto", () => {
  it("hashes and verifies passwords", () => {
    const hash = hashPassword("super-secret-password");
    expect(verifyPassword("super-secret-password", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("encrypts and decrypts JSON payloads", () => {
    const encrypted = encryptJson(config, { username: "api-user", password: "secret" });
    const decrypted = decryptJson<{ username: string; password: string }>(config, encrypted);
    expect(decrypted).toEqual({ username: "api-user", password: "secret" });
  });
});
