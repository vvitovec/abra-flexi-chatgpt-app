import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import { encryptJson, hashPassword } from "./crypto.js";
import { AppDatabase } from "./db.js";
import { createPublicFlexiMcpServer } from "./flexi-mcp-server.js";

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

describe("public flexi MCP server", () => {
  it("maps fuzzy company input to one accessible company for PDF export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-app-mcp-"));
    cleanupDirs.push(dir);
    const config = makeConfig(dir);
    const db = new AppDatabase(config);
    const user = db.createUser("owner@example.com", hashPassword("super-secret-password"), "Owner");
    const org = db.createOrganizationWithOwner("Owner Org", "owner-org", user.id);
    const encrypted = encryptJson(config, { username: "user", password: "pass" });
    db.createConnection({
      organizationId: org.id,
      alias: "Abra-Albac",
      baseUrl: "https://demo.flexibee.eu",
      defaultFormat: "json",
      mode: "prod",
      keyVersion: encrypted.keyVersion,
      encryptedSecret: JSON.stringify(encrypted)
    });

    global.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/c.json")) {
        return new Response(
          JSON.stringify({
            companies: {
              company: [
                {
                  dbNazev: "subrt_cz_s_r_o_",
                  nazev: "ŠUBRT cz s.r.o."
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/rozvaha-po-uctech.pdf")) {
        return new Response(Buffer.from("%PDF-assets"), {
          status: 200,
          headers: { "content-type": "application/pdf" }
        });
      }
      if (url.includes("/sestava.pdf")) {
        return new Response(Buffer.from("%PDF-balance"), {
          status: 200,
          headers: { "content-type": "application/pdf" }
        });
      }
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;

    const server = createPublicFlexiMcpServer(db, config) as any;
    const result = await server._registeredTools.export_assets_liabilities_pdf.handler(
      {
        connection_alias: "Abra-Albac",
        company_slug: "subrt-cz",
        year: "2026"
      },
      {
        authInfo: {
          clientId: "test-client",
          scopes: ["mcp:read"],
          token: "test-token",
          extra: { userId: user.id, organizationId: org.id }
        }
      }
    );

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.report_variant).toBe("assets_liabilities_accounts");
    expect(result.structuredContent.company_slug).toBe("subrt_cz_s_r_o_");
    expect(result.structuredContent.source_system).toBe("ABRA Flexi");
    expect(result.structuredContent.export_origin).toBe("native_flexi_pdf");
    expect(result.structuredContent.download_url).toContain("/downloads/reports/");
    expect(result.content[0].text).toContain("Official ABRA Flexi PDF report is ready.");
    expect(result.content[0].text).toContain("Download URL: http://localhost:8787/downloads/reports/");
    const assetsToken = new URL(result.structuredContent.download_url).pathname.split("/").pop();
    const assetsGrant = assetsToken ? db.getReportDownloadGrant(assetsToken) : null;
    expect(assetsGrant?.report_key).toBe("export_assets_liabilities_pdf");
    expect(assetsGrant?.report_path).toBe("/c/subrt_cz_s_r_o_/rozvaha-po-uctech.pdf");
    expect(assetsGrant?.query_json).toContain("\"report-name\":\"rozvahaPoUctechObraty\"");

    const balanceResult = await server._registeredTools.export_balance_sheet_pdf.handler(
      {
        connection_alias: "Abra-Albac",
        company_slug: "subrt-cz",
        year: "2026"
      },
      {
        authInfo: {
          clientId: "test-client",
          scopes: ["mcp:read"],
          token: "test-token",
          extra: { userId: user.id, organizationId: org.id }
        }
      }
    );

    expect(balanceResult.structuredContent.ok).toBe(true);
    expect(balanceResult.structuredContent.download_url).toContain("/downloads/reports/");
    expect(balanceResult.content[0].text).toContain("Download URL: http://localhost:8787/downloads/reports/");
    const balanceToken = new URL(balanceResult.structuredContent.download_url).pathname.split("/").pop();
    const balanceGrant = balanceToken ? db.getReportDownloadGrant(balanceToken) : null;
    expect(balanceGrant?.report_key).toBe("export_balance_sheet_pdf");
    expect(balanceGrant?.report_path).toBe("/c/subrt_cz_s_r_o_/sestava.pdf");
    expect(balanceGrant?.query_json).toContain("\"report-name\":\"rozvaha$$SUM\"");
  });

  it("generates assets and liabilities PDF from report data when the native Flexi PDF is unavailable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-app-mcp-"));
    cleanupDirs.push(dir);
    const config = makeConfig(dir);
    const db = new AppDatabase(config);
    const user = db.createUser("owner@example.com", hashPassword("super-secret-password"), "Owner");
    const org = db.createOrganizationWithOwner("Owner Org", "owner-org", user.id);
    const encrypted = encryptJson(config, { username: "user", password: "pass" });
    db.createConnection({
      organizationId: org.id,
      alias: "Abra-Albac",
      baseUrl: "https://demo.flexibee.eu",
      defaultFormat: "json",
      mode: "prod",
      keyVersion: encrypted.keyVersion,
      encryptedSecret: JSON.stringify(encrypted)
    });

    const fetchCalls: string[] = [];
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      fetchCalls.push(url);
      if (url.includes("/c.json")) {
        return new Response(
          JSON.stringify({
            companies: {
              company: [
                {
                  dbNazev: "subrt_cz_s_r_o_",
                  nazev: "ŠUBRT cz s.r.o."
                }
              ]
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
      if (url.includes("/rozvaha-po-uctech.json")) {
        return new Response(
          JSON.stringify({
            winstrom: {
              success: "true",
              "rozvaha-po-uctech": [
                {
                  ucet: "code:021001",
                  nazevUctu: "Stavby",
                  zustatekMD: "100.00",
                  zustatekDal: "0.00"
                },
                {
                  ucet: "code:321001",
                  nazevUctu: "Zavazky z obchodnich vztahu",
                  zustatekMD: "0.00",
                  zustatekDal: "80.00"
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;

    const server = createPublicFlexiMcpServer(db, config) as any;

    const result = await server._registeredTools.export_assets_liabilities_pdf.handler(
      {
        connection_alias: "Abra-Albac",
        company_slug: "subrt_cz_s_r_o_",
        year: "2026"
      },
      {
        authInfo: {
          clientId: "test-client",
          scopes: ["mcp:read"],
          token: "test-token",
          extra: { userId: user.id, organizationId: org.id }
        }
      }
    );

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.export_origin).toBe("generated_from_flexi_records");
    expect(result.content[0].text).toContain("Soupis aktiv a pasiv PDF was generated from ABRA Flexi report data.");
    const token = new URL(result.structuredContent.download_url).pathname.split("/").pop();
    const grant = token ? db.getReportDownloadGrant(token) : null;
    expect(grant?.report_key).toBe("export_assets_liabilities_pdf_generated");
    expect(grant?.filename).toBe("soupis-aktiv-a-pasiv-subrt_cz_s_r_o_-2026.pdf");
    const jsonCall = fetchCalls.find((call) => call.includes("/rozvaha-po-uctech.json"));
    expect(jsonCall).toContain("detail=custom%3Aucet%2CnazevUctu%2CzustatekMD%2CzustatekDal");
    expect(jsonCall).toContain("limit=5000");
  });

  it("maps company_name to company_slug for employee list queries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-app-mcp-"));
    cleanupDirs.push(dir);
    const config = makeConfig(dir);
    const db = new AppDatabase(config);
    const user = db.createUser("owner@example.com", hashPassword("super-secret-password"), "Owner");
    const org = db.createOrganizationWithOwner("Owner Org", "owner-org", user.id);
    const encrypted = encryptJson(config, { username: "user", password: "pass" });
    db.createConnection({
      organizationId: org.id,
      alias: "Abra-Albac",
      baseUrl: "https://demo.flexibee.eu",
      defaultFormat: "json",
      mode: "prod",
      keyVersion: encrypted.keyVersion,
      encryptedSecret: JSON.stringify(encrypted)
    });

    global.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/c.json")) {
        return new Response(
          JSON.stringify({
            companies: {
              company: [
                {
                  dbNazev: "albac_s_r_o_",
                  nazev: "Albac s.r.o."
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/c/albac_s_r_o_/prehled-zamestnancu/query.json")) {
        return new Response(
          JSON.stringify({
            winstrom: {
              success: "true",
              "prehled-zamestnancu": [
                {
                  id: "10",
                  osbCis: "3",
                  jmeno: "Monika Pajdlová",
                  funkce: "Účetní",
                  zacatek: "2024-01-01",
                  konecPomeru: null,
                  uvazHodTydne: "40",
                  "pracPom@showAs": "Hlavní pracovní poměr",
                  "typPracPom@showAs": "HPP"
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;

    const server = createPublicFlexiMcpServer(db, config) as any;
    const result = await server._registeredTools.list_employees.handler(
      {
        connection_alias: "Abra-Albac",
        company_name: "Albac s.r.o."
      },
      {
        authInfo: {
          clientId: "test-client",
          scopes: ["mcp:read"],
          token: "test-token",
          extra: { userId: user.id, organizationId: org.id }
        }
      }
    );

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.company_slug).toBe("albac_s_r_o_");
    expect(result.structuredContent.returned).toBe(1);
    expect(result.structuredContent.employees).toEqual([
      expect.objectContaining({
        personal_number: "3",
        name: "Monika Pajdlová",
        role: "Účetní",
        active: true
      })
    ]);
  });

  it("maps company_name to company_slug for VAT summary workflows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-app-mcp-"));
    cleanupDirs.push(dir);
    const config = makeConfig(dir);
    const db = new AppDatabase(config);
    const user = db.createUser("owner@example.com", hashPassword("super-secret-password"), "Owner");
    const org = db.createOrganizationWithOwner("Owner Org", "owner-org", user.id);
    const encrypted = encryptJson(config, { username: "user", password: "pass" });
    db.createConnection({
      organizationId: org.id,
      alias: "Abra-Albac",
      baseUrl: "https://demo.flexibee.eu",
      defaultFormat: "json",
      mode: "prod",
      keyVersion: encrypted.keyVersion,
      encryptedSecret: JSON.stringify(encrypted)
    });

    global.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/c.json")) {
        return new Response(
          JSON.stringify({
            companies: {
              company: [
                {
                  dbNazev: "albac_s_r_o_",
                  nazev: "Albac s.r.o."
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/c/albac_s_r_o_/faktura-vydana/query.json")) {
        return new Response(
          JSON.stringify({
            winstrom: {
              success: "true",
              "faktura-vydana": [
                {
                  id: "1",
                  kod: "FV-1",
                  datVyst: "2025-01-10",
                  sumZklCelkem: "100.00",
                  sumDphCelkem: "21.00",
                  sumCelkem: "121.00"
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.includes("/c/albac_s_r_o_/faktura-prijata/query.json")) {
        return new Response(
          JSON.stringify({
            winstrom: {
              success: "true",
              "faktura-prijata": [
                {
                  id: "2",
                  kod: "FP-1",
                  datVyst: "2025-01-12",
                  sumZklCelkem: "50.00",
                  sumDphCelkem: "10.50",
                  sumCelkem: "60.50"
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;

    const server = createPublicFlexiMcpServer(db, config) as any;
    const result = await server._registeredTools.get_vat_summary.handler(
      {
        connection_alias: "Abra-Albac",
        company_name: "Albac s.r.o.",
        date_to: "2025-01-31"
      },
      {
        authInfo: {
          clientId: "test-client",
          scopes: ["mcp:read"],
          token: "test-token",
          extra: { userId: user.id, organizationId: org.id }
        }
      }
    );

    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.period_start).toBe("2025-01-01");
    expect(result.structuredContent.period_end).toBe("2025-01-31");
    expect(result.content[0].text).toContain("Loaded VAT summary");
  });
});
