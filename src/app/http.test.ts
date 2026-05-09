import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { IncomingHttpHeaders } from "node:http";
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

function getTextResponse(
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{ status: number; body: string; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, {
      method: options?.method ?? "GET",
      headers: options?.headers
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: res.headers
        });
      });
    });
    req.on("error", reject);
    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe("report downloads", () => {
  it("serves locally generated assets/liabilities PDFs without fetching Flexi again", async () => {
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
      const generatedPath = join(dir, "generated-report.pdf");
      writeFileSync(generatedPath, Buffer.from("%PDF-generated"));

      const grant = db.createReportDownloadGrant({
        token: "test-token",
        organization_id: org.id,
        user_id: user.id,
        connection_id: connection.id,
        report_key: "export_assets_liabilities_pdf_generated",
        company_slug: "subrt_cz_s_r_o_",
        report_path: generatedPath,
        query_json: JSON.stringify({}),
        filename: "soupis-aktiv-a-pasiv-subrt_cz_s_r_o_-2026.pdf",
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      let flexiFetchCalled = false;
      global.fetch = (async (input: RequestInfo | URL) => {
        flexiFetchCalled = true;
        return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      }) as typeof fetch;

      const port = (server.address() as AddressInfo).port;
      const response = await getTextResponse(`http://127.0.0.1:${port}/downloads/reports/${grant.token}`);

      expect(response.status).toBe(200);
      expect(response.body).toContain("%PDF-generated");
      expect(flexiFetchCalled).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("auth routes", () => {
  it("uses /register for browser signup with Flexi onboarding without breaking OAuth client registration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-app-http-auth-"));
    cleanupDirs.push(dir);
    const config = makeConfig(dir);
    const { app, db } = createHttpApp(config);
    const server = app.listen(0);

    try {
      const port = (server.address() as AddressInfo).port;

      global.fetch = (async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url === "https://demo.flexibee.eu/c.json") {
          return new Response(JSON.stringify({
            companies: {
              company: [
                { dbNazev: "demo_company", nazev: "Demo Company", show: true }
              ]
            }
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      }) as typeof fetch;

      const loginPage = await getTextResponse(`http://127.0.0.1:${port}/login`);
      expect(loginPage.body).not.toContain('name="display_name"');
      expect(loginPage.body).not.toContain('name="organization_slug"');
      expect(loginPage.body).toContain('name="base_url"');
      expect(loginPage.body).toContain('name="flexi_password"');

      const signup = await getTextResponse(`http://127.0.0.1:${port}/register`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: "email=alice%40example.com&password=VeryStrongPass123&organization_name=Alice+Org&base_url=https%3A%2F%2Fdemo.flexibee.eu&company_slug=&username=rest-user&flexi_password=rest-secret&next=%2F"
      });

      expect(signup.status).toBe(302);
      expect(signup.headers.location).toBe("/");
      const user = db.findUserByEmail("alice@example.com");
      const org = db.getOrganizationBySlug("alice-org");
      expect(user?.display_name).toBe("alice@example.com");
      expect(org?.name).toBe("Alice Org");
      expect(org ? db.listConnections(org.id) : []).toHaveLength(1);
      expect(org ? db.listConnections(org.id)[0]?.alias : undefined).toBe("default");

      const dcr = await getTextResponse(`http://127.0.0.1:${port}/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          redirect_uris: ["https://chatgpt.com/connector/oauth/example"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          client_name: "ChatGPT"
        })
      });

      expect(dcr.status).toBe(201);
      expect(dcr.body).toContain("\"client_id\"");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe("public pages", () => {
  it("does not expose the removed reviewer demo page or links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-app-http-public-"));
    cleanupDirs.push(dir);
    const config = makeConfig(dir);
    const { app } = createHttpApp(config);
    const server = app.listen(0);

    try {
      const port = (server.address() as AddressInfo).port;
      const home = await getTextResponse(`http://127.0.0.1:${port}/`);
      const docs = await getTextResponse(`http://127.0.0.1:${port}/docs`);
      const reviewDemo = await getTextResponse(`http://127.0.0.1:${port}/review/demo`);

      expect(home.status).toBe(200);
      expect(home.body).not.toContain("Účetní workflow");
      expect(home.body).not.toContain("Reviewer demo");
      expect(home.body).not.toContain("/review/demo");
      expect(home.body).not.toContain("class=\"badge\"");
      expect(home.body).not.toContain("class=\"eyebrow\"");
      expect(docs.status).toBe(200);
      expect(docs.body).not.toContain("Reviewer demo");
      expect(docs.body).not.toContain("/review/demo");
      expect(docs.body).not.toContain("class=\"badge\"");
      expect(docs.body).not.toContain("class=\"eyebrow\"");
      expect(reviewDemo.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
