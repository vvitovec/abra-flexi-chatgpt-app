import { describe, expect, it } from "vitest";
import {
  buildCreateDocumentPayload,
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
});
