import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";

describe("server tool surface", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("registers the generic and accountant tool surface with safe defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-server-"));
    const configPath = join(dir, "flexi.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        defaultProfile: "test",
        logDirectory: join(dir, "logs"),
        confirmationTtlSeconds: 300,
        profiles: {
          test: {
            baseUrl: "https://demo.flexibee.eu",
            company: "demo",
            mode: "test",
            writes: "confirm",
            defaultFormat: "json",
            usernameEnv: "FLEXI_TEST_USERNAME",
            passwordEnv: "FLEXI_TEST_PASSWORD"
          }
        }
      }),
      "utf8"
    );

    process.env.FLEXI_TEST_USERNAME = "user";
    process.env.FLEXI_TEST_PASSWORD = "pass";

    const server = createServer(configPath) as any;
    const tools = server._registeredTools as Record<string, { inputSchema: { parse: (value: unknown) => any } }>;
    const searchArgs = tools.flexi_search_records.inputSchema.parse({
      evidence: "adresar",
      query: "test"
    });
    const documentSearchArgs = tools.search_documents.inputSchema.parse({
      kind: "sales_invoice",
      partner_id: "123"
    });
    const documentDetailArgs = tools.get_document_detail.inputSchema.parse({
      kind: "sales_invoice",
      id: "42"
    });
    const unpaidArgs = tools.search_unpaid_documents.inputSchema.parse({
      kind: "receivable"
    });
    const overdueArgs = tools.search_overdue_items.inputSchema.parse({});
    const balanceArgs = tools.get_partner_balance_summary.inputSchema.parse({
      partner_id: "code:PART-001"
    });

    expect(Object.keys(tools).sort()).toEqual([
      "create_document_draft",
      "flexi_check_connection",
      "flexi_describe_evidence",
      "flexi_execute_write",
      "flexi_explain_last_error",
      "flexi_get_record_detail",
      "flexi_get_record_summary",
      "flexi_list_evidence",
      "flexi_list_profiles",
      "flexi_prepare_write",
      "flexi_search_records",
      "flexi_validate_import",
      "get_accounting_overview",
      "get_document_detail",
      "get_document_summary",
      "get_partner_balance_summary",
      "get_partner_detail",
      "get_partner_summary",
      "get_product_summary",
      "post_document",
      "search_documents",
      "search_overdue_items",
      "search_partners",
      "search_products",
      "search_reference_values",
      "search_unpaid_documents",
      "update_document_header",
      "update_document_items",
      "validate_document"
    ]);
    expect(tools.flexi_get_properties).toBeUndefined();
    expect(tools.flexi_get_relations).toBeUndefined();
    expect(tools.flexi_get_record).toBeUndefined();
    expect(tools.flexi_list_companies).toBeUndefined();
    expect(searchArgs.limit).toBe(10);
    expect(searchArgs.offset).toBe(0);
    expect(documentSearchArgs.limit).toBe(10);
    expect(documentSearchArgs.offset).toBe(0);
    expect(documentDetailArgs.include_items).toBe(false);
    expect(documentDetailArgs.include_payments).toBe(false);
    expect(documentDetailArgs.include_accounting).toBe(false);
    expect(documentDetailArgs.include_links).toBe(false);
    expect(unpaidArgs.overdue_only).toBe(true);
    expect(overdueArgs.scope).toBe("all");
    expect(overdueArgs.limit).toBe(10);
    expect(overdueArgs.offset).toBe(0);
    expect(balanceArgs.partner_id).toBe("code:PART-001");
  });

  it("falls back from overdue report to unpaid document search when the report fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-server-"));
    const configPath = join(dir, "flexi.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        defaultProfile: "test",
        logDirectory: join(dir, "logs"),
        confirmationTtlSeconds: 300,
        profiles: {
          test: {
            baseUrl: "https://demo.flexibee.eu",
            company: "demo",
            mode: "test",
            writes: "confirm",
            defaultFormat: "json",
            usernameEnv: "FLEXI_TEST_USERNAME",
            passwordEnv: "FLEXI_TEST_PASSWORD"
          }
        }
      }),
      "utf8"
    );

    process.env.FLEXI_TEST_USERNAME = "user";
    process.env.FLEXI_TEST_PASSWORD = "pass";

    const responses = [
      new Response(JSON.stringify({ message: "report failed" }), { status: 500, headers: { "content-type": "application/json" } }),
      new Response(
        JSON.stringify({
          winstrom: {
            pohledavka: [
              {
                id: "1",
                kod: "POH-001",
                nazFirmy: "Acme s.r.o.",
                datSplat: "2026-04-10",
                zbyvaUhradit: "100.00",
                mena: "code:CZK",
                varSym: "2026001",
                "stavUhrK@showAs": "Neuhrazeno"
              }
            ]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ];

    global.fetch = (async () => {
      const next = responses.shift();
      if (!next) {
        throw new Error("Unexpected fetch call");
      }
      return next;
    }) as typeof fetch;

    const server = createServer(configPath) as any;
    const result = await server._registeredTools.search_overdue_items.handler(
      { scope: "receivables", limit: 10, offset: 0 },
      {}
    );

    expect(result.structuredContent.records).toEqual([
      {
        document_code: "POH-001",
        document_kind: "receivable",
        partner_name: "Acme s.r.o.",
        due_date: "2026-04-10",
        remaining_amount: "100.00",
        currency: "code:CZK",
        variable_symbol: "2026001",
        status: "Neuhrazeno"
      }
    ]);
  });

  it("falls back from saldo-k-datu to saldo for partner balance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-server-"));
    const configPath = join(dir, "flexi.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        defaultProfile: "test",
        logDirectory: join(dir, "logs"),
        confirmationTtlSeconds: 300,
        profiles: {
          test: {
            baseUrl: "https://demo.flexibee.eu",
            company: "demo",
            mode: "test",
            writes: "confirm",
            defaultFormat: "json",
            usernameEnv: "FLEXI_TEST_USERNAME",
            passwordEnv: "FLEXI_TEST_PASSWORD"
          }
        }
      }),
      "utf8"
    );

    process.env.FLEXI_TEST_USERNAME = "user";
    process.env.FLEXI_TEST_PASSWORD = "pass";

    const responses = [
      new Response(JSON.stringify({ message: "saldo at date failed" }), { status: 500, headers: { "content-type": "application/json" } }),
      new Response(
        JSON.stringify({
          winstrom: {
            saldo: [
              {
                firma: "code:PART-001",
                "firma@showAs": "PART-001: Acme s.r.o.",
                saldoMd: "120.00",
                saldoDal: "20.00",
                saldo: "100.00",
                mena: "code:CZK"
              }
            ]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ];

    global.fetch = (async () => {
      const next = responses.shift();
      if (!next) {
        throw new Error("Unexpected fetch call");
      }
      return next;
    }) as typeof fetch;

    const server = createServer(configPath) as any;
    const result = await server._registeredTools.get_partner_balance_summary.handler(
      { partner_id: "code:PART-001" },
      {}
    );

    expect(result.structuredContent.report_source).toBe("fallback");
    expect(result.structuredContent.record).toEqual({
      partner_id: "code:PART-001",
      partner_name: "PART-001: Acme s.r.o.",
      date: new Date().toISOString().slice(0, 10),
      receivable_balance: "120.00",
      payable_balance: "20.00",
      net_balance: "100.00",
      currency: "code:CZK"
    });
  });

  it("prefers overdue report data in accounting overview when available", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-server-"));
    const configPath = join(dir, "flexi.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        defaultProfile: "test",
        logDirectory: join(dir, "logs"),
        confirmationTtlSeconds: 300,
        profiles: {
          test: {
            baseUrl: "https://demo.flexibee.eu",
            company: "demo",
            mode: "test",
            writes: "confirm",
            defaultFormat: "json",
            usernameEnv: "FLEXI_TEST_USERNAME",
            passwordEnv: "FLEXI_TEST_PASSWORD"
          }
        }
      }),
      "utf8"
    );

    process.env.FLEXI_TEST_USERNAME = "user";
    process.env.FLEXI_TEST_PASSWORD = "pass";

    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          winstrom: {
            "neuhrazene-po-splatnosti": [
              {
                kod: "POH-001",
                nazFirmy: "Acme s.r.o.",
                modul: "PHL",
                datSplat: "2026-04-10",
                zbyvaUhradit: "100.00",
                mena: "code:CZK"
              },
              {
                kod: "ZAV-001",
                nazFirmy: "Beta s.r.o.",
                modul: "ZAV",
                datSplat: "2026-04-09",
                zbyvaUhradit: "50.00",
                mena: "code:CZK"
              }
            ]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    const server = createServer(configPath) as any;
    const result = await server._registeredTools.get_accounting_overview.handler({ include_overdue: true }, {});

    expect(result.structuredContent.report_source).toBe("primary");
    expect(result.structuredContent.receivables).toMatchObject({
      count: 1,
      total_amount: "100.00",
      remaining_amount: "100.00"
    });
    expect(result.structuredContent.payables).toMatchObject({
      count: 1,
      total_amount: "50.00",
      remaining_amount: "50.00"
    });
  });
});
