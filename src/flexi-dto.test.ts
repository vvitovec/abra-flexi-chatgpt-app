import { describe, expect, it } from "vitest";
import {
  aggregateDocumentOverview,
  extractWriteRecord,
  extractWriteStats,
  mapPartnerBalanceSummary,
  mapDocumentDetail,
  mapDocumentSearchResults,
  mapOverdueReportResults,
  mapPartnerSearchResults,
  mapProductSearchResults,
  mapReferenceValueResults,
  mapRecordDetail,
  mapSearchResults
} from "./flexi-dto.js";

describe("flexi dto mapping", () => {
  it("returns short summaries for search results and computes has_more", () => {
    const result = mapSearchResults(
      {
        winstrom: {
          "pracovni-pomer": [
            { id: "1", kod: "1-STANDARD", nazev: "Standardní pracovní poměr", lastUpdate: "2026-04-09T08:34:30.932+02:00" },
            { id: "2", kod: "2-DPP", nazev: "Dohoda o provedení práce", lastUpdate: "2026-04-10T09:00:00.000+02:00" },
            { id: "3", kod: "3-DPČ", nazev: "Dohoda o pracovní činnosti", lastUpdate: "2026-04-11T09:00:00.000+02:00" }
          ]
        }
      },
      "pracovni-pomer",
      2,
      0
    );

    expect(result.returned).toBe(2);
    expect(result.has_more).toBe(true);
    expect(result.records[0]).toEqual({
      id: "1",
      code: "1-STANDARD",
      name: "Standardní pracovní poměr",
      display_name: "1-STANDARD: Standardní pracovní poměr",
      last_updated: "2026-04-09T08:34:30.932+02:00"
    });
  });

  it("keeps detail lean by default and includes extra sections only when requested", () => {
    const payload = {
      winstrom: {
        osoba: [
          {
            id: "1",
            kod: "EMP-001",
            prijmeni: "Novák",
            jmeno: "Jan",
            lastUpdate: "2026-04-11T10:00:00.000+02:00",
            pohlaviK: "pohlavi.muz",
            "pohlaviK@showAs": "Muž",
            osoba: "1",
            "osoba@showAs": "1: Jan Novák",
            nepritomnosti: {
              nepritomnost: [{ id: "10" }]
            }
          }
        ]
      }
    };

    const compactDetail = mapRecordDetail(payload, "osoba", {
      include_relations: false,
      include_collections: false
    });
    const fullDetail = mapRecordDetail(payload, "osoba", {
      include_relations: true,
      include_collections: true
    });

    expect(compactDetail).toMatchObject({
      id: "1",
      code: "EMP-001",
      display_name: "EMP-001: Novák Jan",
      fields: {
        first_name: "Jan",
        last_name: "Novák"
      }
    });
    expect(compactDetail).not.toHaveProperty("relations");
    expect(compactDetail).not.toHaveProperty("collections");

    expect(fullDetail).toMatchObject({
      relations: {
        person_name: "1: Jan Novák",
        pohlavi_k: "Muž"
      },
      collections: {
        nepritomnost: [{ id: "10" }]
      }
    });
  });

  it("extracts short write confirmation data instead of the full entity", () => {
    const payload = {
      winstrom: {
        stats: {
          created: "0",
          updated: "1",
          deleted: "0",
          skipped: "0",
          failed: "0"
        },
        results: [
          {
            content: {
              adresar: [
                {
                  id: "42",
                  kod: "TEST-001",
                  nazev: "Test s.r.o.",
                  lastUpdate: "2026-04-11T11:00:00.000+02:00"
                }
              ]
            }
          }
        ]
      }
    };

    expect(extractWriteStats(payload)).toEqual({
      created: 0,
      updated: 1,
      deleted: 0,
      skipped: 0,
      failed: 0
    });
    expect(extractWriteRecord(payload, "adresar")).toEqual({
      id: "42",
      code: "TEST-001",
      name: "Test s.r.o.",
      display_name: "TEST-001: Test s.r.o.",
      last_updated: "2026-04-11T11:00:00.000+02:00"
    });
  });

  it("maps accountant summaries without returning full raw entities", () => {
    const partnerResult = mapPartnerSearchResults(
      {
        winstrom: {
          adresar: [
            {
              id: "10",
              kod: "PART-001",
              nazev: "Acme s.r.o.",
              ic: "12345678",
              dic: "CZ12345678",
              mesto: "Praha",
              stat: { kod: "CZ" },
              lastUpdate: "2026-04-13T09:00:00.000+02:00"
            }
          ]
        }
      },
      "adresar",
      10,
      0,
      "customer"
    );

    const productResult = mapProductSearchResults(
      {
        winstrom: {
          cenik: [
            {
              id: "20",
              kod: "ITEM-001",
              nazev: "Kabel",
              mj1: "ks",
              cenaZakl: "150.00",
              typSzbDphK: "typSzbDph.dphZakl",
              "typSzbDphK@showAs": "21 %",
              lastUpdate: "2026-04-13T09:10:00.000+02:00"
            }
          ]
        }
      },
      "cenik",
      10,
      0
    );

    expect(partnerResult.records[0]).toEqual({
      id: "10",
      code: "PART-001",
      name: "Acme s.r.o.",
      company_id: "12345678",
      vat_id: "CZ12345678",
      city: "Praha",
      country: "CZ",
      last_updated: "2026-04-13T09:00:00.000+02:00",
      role: "customer"
    });
    expect(productResult.records[0]).toEqual({
      id: "20",
      code: "ITEM-001",
      name: "Kabel",
      unit: "ks",
      price: "150.00",
      vat_rate: "21 %",
      last_updated: "2026-04-13T09:10:00.000+02:00"
    });
  });

  it("keeps document detail lean unless include flags are enabled", () => {
    const payload = {
      winstrom: {
        "faktura-vydana": [
          {
            id: "77",
            kod: "FV-2026-0077",
            nazev: "Faktura",
            nazFirmy: "Acme s.r.o.",
            datVyst: "2026-04-13",
            datSplat: "2026-04-20",
            datZdan: "2026-04-13",
            sumCelkem: "1210.00",
            zbyvaUhradit: "1210.00",
            stavUhrK: "stavUhr.neuhrazeno",
            "stavUhrK@showAs": "Neuhrazeno",
            stavUzivK: "stavDokl.otevreny",
            "stavUzivK@showAs": "Otevřený",
            mena: { kod: "CZK" },
            poznam: "Poznámka",
            stredisko: "code:CENTER-1",
            "stredisko@showAs": "CENTER-1",
            polozkyFaktury: {
              "faktura-vydana-polozka": [
                {
                  id: "1",
                  text: "Kabel",
                  mnozMj: "2",
                  cenaMj: "500",
                  sumCelkem: "1000",
                  cenik: "code:ITEM-001",
                  "cenik@showAs": "ITEM-001: Kabel"
                }
              ]
            },
            uhrady: {
              uhrada: [{ id: "9", castka: "0", datPlatby: "2026-04-14" }]
            }
          }
        ]
      }
    };

    const compact = mapDocumentDetail(payload, "faktura-vydana", "sales_invoice", {
      include_items: false,
      include_payments: false,
      include_accounting: false,
      include_links: false,
      item_collection_key: "polozkyFaktury",
      item_evidence: "faktura-vydana-polozka"
    });
    const full = mapDocumentDetail(payload, "faktura-vydana", "sales_invoice", {
      include_items: true,
      include_payments: true,
      include_accounting: true,
      include_links: true,
      item_collection_key: "polozkyFaktury",
      item_evidence: "faktura-vydana-polozka"
    });

    expect(compact).toMatchObject({
      id: "77",
      code: "FV-2026-0077",
      fields: {
        note: "Poznámka"
      }
    });
    expect(compact).not.toHaveProperty("items");
    expect(compact).not.toHaveProperty("payments");
    expect(compact).not.toHaveProperty("accounting");

    expect(full).toMatchObject({
      items: [
        {
          id: "1",
          text: "Kabel",
          product: "ITEM-001: Kabel",
          quantity: "2",
          unit_price: "500",
          total_amount: "1000"
        }
      ],
      payments: [
        {
          id: "9",
          amount: "0",
          date: "2026-04-14"
        }
      ],
      accounting: {
        center: "CENTER-1",
        tax_date: "2026-04-13"
      }
    });
  });

  it("aggregates accounting overview and reference lookup summaries", () => {
    const documents = mapDocumentSearchResults(
      {
        winstrom: {
          pohledavka: [
            {
              id: "1",
              kod: "POH-1",
              nazFirmy: "Acme",
              datVyst: "2026-04-01",
              datSplat: "2026-04-10",
              sumCelkem: "100.00",
              zbyvaUhradit: "80.00"
            },
            {
              id: "2",
              kod: "POH-2",
              nazFirmy: "Beta",
              datVyst: "2026-04-02",
              datSplat: "2026-04-11",
              sumCelkem: "50.00",
              zbyvaUhradit: "50.00"
            }
          ]
        }
      },
      "pohledavka",
      "receivable",
      10,
      0
    ).records;

    const lookups = mapReferenceValueResults(
      {
        winstrom: {
          "forma-uhrady": [
            { id: "5", kod: "BANK", nazev: "Bank transfer", lastUpdate: "2026-04-13T10:00:00.000+02:00" }
          ]
        }
      },
      "forma-uhrady",
      10,
      0
    );

    expect(aggregateDocumentOverview(documents)).toEqual({
      count: 2,
      total_amount: "150.00",
      remaining_amount: "130.00"
    });
    expect(lookups.records[0]).toEqual({
      id: "5",
      code: "BANK",
      name: "Bank transfer",
      value: "Bank transfer",
      last_updated: "2026-04-13T10:00:00.000+02:00"
    });
  });

  it("maps overdue report rows into compact summaries and drops empty fields", () => {
    const result = mapOverdueReportResults(
      [
        {
          kod: "POH-001",
          nazFirmy: "Acme s.r.o.",
          modul: "PHL",
          datSplat: "2026-04-10",
          zbyvaUhradit: "100.00",
          poSplatnosti: "3",
          mena: "code:CZK",
          varSym: "2026001",
          "stavUzivK@showAs": "Po splatnosti"
        }
      ],
      10,
      0,
      {
        partner_name_fields: ["nazFirmy", "firma@showAs", "firma"],
        document_code_fields: ["kod", "doklad"],
        document_kind_fields: ["modul"],
        due_date_fields: ["datSplat"],
        remaining_amount_fields: ["zbyvaUhradit", "castka"],
        overdue_days_fields: ["poSplatnosti"],
        variable_symbol_fields: ["varSym"],
        currency_fields: ["mena"],
        status_fields: ["stavUzivK@showAs", "stav"]
      }
    );

    expect(result.records).toEqual([
      {
        document_code: "POH-001",
        document_kind: "receivable",
        partner_name: "Acme s.r.o.",
        due_date: "2026-04-10",
        overdue_days: "3",
        remaining_amount: "100.00",
        currency: "code:CZK",
        variable_symbol: "2026001",
        status: "Po splatnosti"
      }
    ]);
  });

  it("maps saldo rows into compact partner balance summaries", () => {
    const result = mapPartnerBalanceSummary(
      [
        {
          firma: "code:PART-001",
          "firma@showAs": "PART-001: Acme s.r.o.",
          saldoMd: "120.00",
          saldoDal: "20.00",
          saldo: "100.00",
          mena: "code:CZK",
          datum: "2026-04-13",
          pocetPolozek: "2"
        }
      ],
      {
        partner_id: "code:PART-001",
        date: "2026-04-13",
        partner_id_fields: ["firma"],
        partner_name_fields: ["firma@showAs"],
        date_fields: ["datum"],
        receivable_balance_fields: ["saldoMd"],
        payable_balance_fields: ["saldoDal"],
        net_balance_fields: ["saldo"],
        currency_fields: ["mena"],
        open_items_count_fields: ["pocetPolozek"]
      }
    );

    expect(result).toEqual({
      partner_id: "code:PART-001",
      partner_name: "PART-001: Acme s.r.o.",
      date: "2026-04-13",
      receivable_balance: "120.00",
      payable_balance: "20.00",
      net_balance: "100.00",
      currency: "code:CZK",
      open_items_count: "2"
    });
  });
});
