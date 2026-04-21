import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { AppConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { encryptJson, hashPassword } from "./crypto.js";

function makeConfig(dataDir: string): AppConfig {
  return {
    appName: "Test",
    appBaseUrl: "http://127.0.0.1:8787",
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
    appDomain: "http://127.0.0.1:8787",
    widgetResourceDomain: "http://127.0.0.1:8787",
    cloudflareTunnelName: "test",
    cloudflareHostname: "test.example.com"
  };
}

const cleanupDirs: string[] = [];
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function getTextResponse(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("report downloads", () => {
  it("returns the native Flexi error instead of generating a fallback assets/liabilities PDF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-app-http-"));
    cleanupDirs.push(dir);
    const config = makeConfig(dir);
    const { app, db } = createHttpApp(config);
    const server = app.listen(0);

    try {
      const user = db.createUser("owner@example.com", hashPassword("super-secret-password"), "Owner");
      const org = db.createOrganizationWithOwner("Owner Org", "owner-org", user.id);
      const encrypted = encryptJson(config, { username: "user", password: "pass" });
      const connection = db.createConnection({
        organizationId: org.id,
        alias: "Abra-Albac",
        baseUrl: "https://demo.flexibee.eu",
        defaultFormat: "json",
        mode: "prod",
        keyVersion: encrypted.keyVersion,
        encryptedSecret: JSON.stringify(encrypted)
      });

      const grant = db.createReportDownloadGrant({
        token: "test-token",
        organization_id: org.id,
        user_id: user.id,
        connection_id: connection.id,
        report_key: "export_assets_liabilities_pdf",
        company_slug: "subrt_cz_s_r_o_",
        report_path: "/c/subrt_cz_s_r_o_/rozvaha-po-uctech.pdf",
        query_json: JSON.stringify({ "report-name": "rozvahaPoUctechObraty", ucetniObdobi: "2026" }),
        filename: "soupis-aktiv-a-pasiv-subrt_cz_s_r_o_-2026.pdf",
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      let requestedJsonFallback = false;
      global.fetch = (async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.includes("/rozvaha-po-uctech.json")) {
          requestedJsonFallback = true;
          return new Response(
            JSON.stringify({
              winstrom: {
                "rozvaha-po-uctech": [{ ucet: "021", nazevUctu: "Buildings", zustatekMD: "100", zustatekDal: "0" }]
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.includes("/rozvaha-po-uctech.pdf")) {
          return new Response("Neexistuje žádný report.", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" }
          });
        }
        return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      }) as typeof fetch;

      const port = (server.address() as AddressInfo).port;
      const response = await getTextResponse(`http://127.0.0.1:${port}/downloads/reports/${grant.token}`);

      expect(response.status).toBe(404);
      expect(response.body).toContain("Neexistuje žádný report.");
      expect(requestedJsonFallback).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
