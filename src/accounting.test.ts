import { describe, expect, it } from "vitest";
import {
  buildCreateDocumentPayload,
  buildAssetsLiabilitiesPdfRequest,
  buildBalanceSheetPdfRequest,
  buildDocumentItemsUpdatePayload,
  buildReportSelector,
  buildDocumentSearchFilter,
  buildPostDocumentPayload,
  documentKindRegistry,
  getDocumentKindConfig,
  getReportEvidenceConfig,
  getSaldoModules,
  toIsoDate
} from "./accounting.js";

describe("accounting helpers", () => {
  it("maps document kinds to accounting evidence", () => {
    expect(documentKindRegistry.sales_invoice.evidence).toBe("faktura-vydana");
    expect(documentKindRegistry.purchase_invoice.evidence).toBe("faktura-prijata");
    expect(documentKindRegistry.receivable.evidence).toBe("pohledavka");
    expect(documentKindRegistry.payable.evidence).toBe("zavazek");
  });

  it("builds compact document search filters from business inputs", () => {
    const filter = buildDocumentSearchFilter(getDocumentKindConfig("sales_invoice"), {
      query: "ACME",
      partner_id: "code:PART-001",
      status: "stavUhr.castecne",
      date_from: "2026-04-01",
      date_to: "2026-04-30",
      due_from: "2026-04-10",
      due_to: "2026-05-10",
      unpaid_only: true,
      overdue_only: true
    });

    expect(filter).toContain("kod like");
    expect(filter).toContain('firma eq "code:PART-001"');
    expect(filter).toContain('stavUhrK eq "stavUhr.castecne"');
    expect(filter).toContain('datVyst ge "2026-04-01"');
    expect(filter).toContain('datSplat le "2026-05-10"');
    expect(filter).toContain("zbyvaUhradit gt 0");
  });

  it("creates lean document draft payloads without requiring document_type_id", () => {
    const built = buildCreateDocumentPayload({
      kind: "sales_invoice",
      partner_id: "code:PART-001",
      issue_date: "2026-04-13",
      note: "Test invoice",
      items: [
        {
          product_code: "ITEM-001",
          quantity: 2,
          unit_price: 150
        }
      ]
    });

    expect(built.evidence).toBe("faktura-vydana");
    expect(JSON.parse(built.payload)).toEqual({
      winstrom: {
        "faktura-vydana": [
          {
            firma: "code:PART-001",
            datVyst: "2026-04-13",
            poznam: "Test invoice",
            polozkyFaktury: [
              {
                typPolozkyK: "typPolozky.obecny",
                mnozMj: 2,
                cenaMj: 150,
                cenik: "code:ITEM-001"
              }
            ]
          }
        ]
      }
    });
  });

  it("replaces all items when updating document items", () => {
    const built = buildDocumentItemsUpdatePayload("sales_invoice", "42", [
      {
        text: "Manual item",
        quantity: 1,
        unit_price: 99
      }
    ]);

    expect(JSON.parse(built.payload)).toEqual({
      winstrom: {
        "faktura-vydana": [
          {
            id: "42",
            polozkyFaktury: [
              {
                typPolozkyK: "typPolozky.obecny",
                mnozMj: 1,
                cenaMj: 99,
                text: "Manual item",
                nazev: "Manual item"
              }
            ],
            "polozkyFaktury@removeAll": "true"
          }
        ]
      }
    });
  });

  it("blocks posting for kinds that do not have a safe standard action", () => {
    expect(() => buildPostDocumentPayload("bank", "42")).toThrow("Posting is not supported");
    expect(() => buildPostDocumentPayload("cash", "42")).toThrow("Posting is not supported");
  });

  it("defines report evidence registry and report helpers", () => {
    expect(getReportEvidenceConfig("overdue_report").evidence).toBe("neuhrazene-po-splatnosti");
    expect(getReportEvidenceConfig("saldo_at_date_report").evidence).toBe("saldo-k-datu");
    expect(getSaldoModules("receivables")).toBe("FAV,PHL");
    expect(getSaldoModules("payables")).toBe("FAP,ZAV");
    expect(buildReportSelector("code:PART-001")).toBe("(firma='code:PART-001')");
    expect(toIsoDate("2026-04-13")).toBe("2026-04-13");
  });

  it("builds assets and liabilities PDF requests with repeated filter parameters", () => {
    const request = buildAssetsLiabilitiesPdfRequest("demo", {
      accounting_period: "2026",
      account_filter: "2,32",
      account_ids: ["code:211001", "code:112001"],
      center_ids: ["code:C"],
      activity_ids: ["code:1"],
      currency_codes: ["code:CZK"],
      group_by_center: true
    });

    expect(request.path).toBe("/c/demo/rozvaha-po-uctech.pdf");
    expect(request.report_name).toBe("rozvahaPoUctechObraty");
    expect(request.query).toMatchObject({
      "report-name": "rozvahaPoUctechObraty",
      ucetniObdobi: "2026",
      filtrUcty: "2,32",
      ucet: ["code:211001", "code:112001"],
      stredisko: ["code:C"],
      cinnost: ["code:1"],
      mena: ["code:CZK"],
      groupByStredisko: true
    });
    expect(request.filename).toContain("demo");
  });

  it("builds balance sheet PDF requests without account-level filters", () => {
    const request = buildBalanceSheetPdfRequest("demo", {
      accounting_period: "2026"
    });

    expect(request.path).toBe("/c/demo/sestava.pdf");
    expect(request.report_name).toBe("rozvaha$$SUM");
    expect(request.query).toMatchObject({
      "report-name": "rozvaha$$SUM",
      ucetniObdobi: "2026"
    });
    expect(request.filename).toContain("rozvaha-demo-2026");
    expect(request.report_variant).toBe("balance_sheet_summary");
  });
});
