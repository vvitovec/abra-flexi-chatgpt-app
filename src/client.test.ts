import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditStore } from "./audit.js";
import { FlexiClient } from "./client.js";
import type { ResolvedProfile } from "./types.js";

describe("FlexiClient", () => {
  let server: ReturnType<typeof createServer>;
  let port = 0;
  let profile: ResolvedProfile;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url?.includes("dryRun=true")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ winstrom: { success: "false", errors: { error: "Dry run failed" } } }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ winstrom: { success: "true", message: "OK", evidence: ["adresar"] } }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });

    profile = {
      name: "test",
      baseUrl: `http://127.0.0.1:${port}`,
      company: "demo",
      mode: "test",
      writes: "confirm",
      defaultFormat: "json",
      usernameEnv: "FLEXI_TEST_USERNAME",
      passwordEnv: "FLEXI_TEST_PASSWORD",
      username: "user",
      password: "pass"
    };
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("builds evidence and company paths correctly", () => {
    const client = new FlexiClient(new AuditStore(mkdtempSync(join(tmpdir(), "flexi-logs-"))));
    expect(client.buildServerPath("json")).toBe("/c.json");
    expect(client.buildCompanyPath(profile, undefined, "evidence-list")).toBe("/c/demo/evidence-list");
    expect(client.buildEvidencePath(profile, undefined, "adresar", "json")).toBe("/c/demo/adresar.json");
    expect(client.buildEvidencePath(profile, "custom", "adresar", "xml", "code:ABC")).toBe("/c/custom/adresar/code:ABC.xml");
  });

  it("performs requests and normalizes successful responses", async () => {
    const client = new FlexiClient(new AuditStore(mkdtempSync(join(tmpdir(), "flexi-logs-"))));
    const response = await client.request({
      operation: "list_evidence",
      profile,
      method: "GET",
      path: client.buildCompanyPath(profile, undefined, "evidence-list"),
      format: "json"
    });

    expect(response.ok).toBe(true);
    expect(response.messages).toContain("OK");
    expect(response.request_id).toBeTruthy();
  });

  it("captures business errors from dry-run responses", async () => {
    const client = new FlexiClient(new AuditStore(mkdtempSync(join(tmpdir(), "flexi-logs-"))));
    const response = await client.request({
      operation: "validate_import",
      profile,
      method: "POST",
      path: client.buildEvidencePath(profile, undefined, "adresar", "json"),
      format: "json",
      query: { dryRun: true },
      body: "{\"foo\":\"bar\"}"
    });

    expect(response.ok).toBe(false);
    expect(response.errors).toContain("Dry run failed");
  });

  it("adds auth=http to non-GET requests", async () => {
    let seenUrl = "";

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    server = createServer((req, res) => {
      seenUrl = req.url ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ winstrom: { success: "true", message: "OK" } }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as { port: number }).port;
        profile = {
          ...profile,
          baseUrl: `http://127.0.0.1:${port}`
        };
        resolve();
      });
    });

    const client = new FlexiClient(new AuditStore(mkdtempSync(join(tmpdir(), "flexi-logs-"))));
    await client.request({
      operation: "validate_import",
      profile,
      method: "POST",
      path: client.buildEvidencePath(profile, undefined, "adresar", "json"),
      format: "json",
      query: { "dry-run": true },
      body: "{\"foo\":\"bar\"}"
    });

    expect(seenUrl).toContain("dry-run=true");
    expect(seenUrl).toContain("auth=http");
  });
});
