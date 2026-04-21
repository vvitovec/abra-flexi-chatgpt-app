import { describe, expect, it } from "vitest";
import {
  buildCashflowSnapshot,
  buildCompanyTasks,
  buildVatSummary,
  detectPaymentMismatches,
  explainDocumentIssues,
  resolveEmployeeLookup,
  summarizeEmployees
} from "./accountant-workflows.js";

describe("accountant workflow helpers", () => {
  it("deduplicates employees with multiple contracts and keeps only active ones by default", () => {
    const employees = summarizeEmployees(
      [
        {
          id: "-1",
          osbCis: "5",
          jmeno: "Vítovec   Viktor",
          funkce: "pomocné práce",
          zacatek: "2022-11-01+01:00",
          konecPomeru: "",
          uvazHodTydne: "5.0",
          "pracPom@showAs": "2-DPP: Dohoda o provedení práce",
          "typPracPom@showAs": "2-DPP: Dohoda o provedení práce"
        },
        {
          id: "-2",
          osbCis: "5",
          jmeno: "Vítovec Viktor",
          funkce: "pomocné práce",
          zacatek: "2024-01-01+01:00",
          konecPomeru: "",
          uvazHodTydne: "10.0",
          "pracPom@showAs": "1-STANDARD: Standardní pracovní poměr",
          "typPracPom@showAs": "1-STANDARD: Standardní pracovní poměr"
        },
        {
          id: "-3",
          osbCis: "6",
          jmeno: "Jana Ostrá",
          funkce: "administrativa",
          zacatek: "2021-05-01+02:00",
          konecPomeru: "2023-01-31+01:00",
          uvazHodTydne: "32.0",
          "pracPom@showAs": "1-STANDARD: Standardní pracovní poměr",
          "typPracPom@showAs": "1-STANDARD: Standardní pracovní poměr"
        }
      ],
      { as_of: "2026-04-13", active_only: true, include_contracts: true }
    );

    expect(employees).toHaveLength(1);
    expect(employees[0]).toMatchObject({
      personal_number: "5",
      name: "Vítovec Viktor",
      active: true,
      contract_count: 2,
      active_contracts: 2,
      weekly_hours_total: "15.00"
    });
    expect(employees[0].employment_types).toEqual([
      "2-DPP: Dohoda o provedení práce",
      "1-STANDARD: Standardní pracovní poměr"
    ]);
  });

  it("resolves employee lookup and reports ambiguity when needed", () => {
    const employees = summarizeEmployees(
      [
        { id: "1", osbCis: "3", jmeno: "Monika Pajdlová", zacatek: "2019-07-01", konecPomeru: "" },
        { id: "2", osbCis: "13", jmeno: "Monika Nová", zacatek: "2025-01-01", konecPomeru: "" }
      ],
      { as_of: "2026-04-13", active_only: true }
    );

    expect(resolveEmployeeLookup(employees, { personal_number: "3" })).toMatchObject({
      status: "match",
      employee: { personal_number: "3", name: "Monika Pajdlová" }
    });
    expect(resolveEmployeeLookup(employees, { query: "monika" })).toMatchObject({
      status: "ambiguous"
    });
  });

  it("builds VAT summary and detects payment mismatches", () => {
    const vatSummary = buildVatSummary(
      [
        {
          sumZklCelkem: "1000.0",
          sumDphCelkem: "210.0",
          sumCelkem: "1210.0",
          zbyvaUhradit: "1210.0",
          datSplat: "2026-04-10",
          mena: { kod: "CZK" }
        }
      ],
      [
        {
          sumZklCelkem: "500.0",
          sumDphCelkem: "105.0",
          sumCelkem: "605.0",
          zbyvaUhradit: "0.0",
          datSplat: "2026-04-20",
          mena: { kod: "CZK" }
        }
      ],
      "2026-04-13"
    );

    expect(vatSummary).toMatchObject({
      outgoing: { vat_amount: "210.00", overdue_amount: "1210.00" },
      incoming: { vat_amount: "105.00" },
      net_vat_due: "105.00",
      currencies: ["CZK"]
    });

    const mismatches = detectPaymentMismatches(
      [
        {
          id: "77",
          kod: "FV-77",
          nazFirmy: "Acme s.r.o.",
          datSplat: "2026-04-05",
          datUhr: "2026-04-06",
          zbyvaUhradit: "500.0",
          varSym: "",
          "formaUhradyCis@showAs": "Bankovní převod",
          "stavUhrK@showAs": "Neuhrazeno",
          mena: { kod: "CZK" }
        }
      ],
      "sales_invoice",
      "2026-04-13"
    );

    expect(mismatches.map((item) => item.reason)).toEqual([
      "Doklad má datum úhrady, ale stále zbývá uhradit nenulová částka.",
      "Pro bezhotovostní úhradu chybí variabilní symbol.",
      "Doklad je po splatnosti a stále není plně uhrazený."
    ]);
  });

  it("builds cashflow snapshot, company tasks and document issue summary", () => {
    const snapshot = buildCashflowSnapshot(
      [
        { id: "1", kod: "POH-1", nazFirmy: "Acme", datSplat: "2026-04-10", zbyvaUhradit: "1000.0", mena: { kod: "CZK" } },
        { id: "2", kod: "POH-2", nazFirmy: "Beta", datSplat: "2026-04-16", zbyvaUhradit: "700.0", mena: { kod: "CZK" } }
      ],
      [
        { id: "3", kod: "ZAV-1", nazFirmy: "Gamma", datSplat: "2026-04-11", zbyvaUhradit: "500.0", mena: { kod: "CZK" } }
      ],
      "2026-04-13"
    );

    expect(snapshot).toMatchObject({
      overdue_receivables: { count: 1, amount: "1000.00" },
      overdue_payables: { count: 1, amount: "500.00" },
      due_next_7_days_receivables: { count: 1, amount: "700.00" }
    });

    const tasks = buildCompanyTasks({
      mismatches: [
        {
          kind: "sales_invoice",
          id: "1",
          code: "FV-1",
          reason: "Doklad má datum úhrady, ale stále zbývá uhradit nenulová částka.",
          severity: "high",
          remaining_amount: "1000.00",
          currency: "CZK"
        }
      ],
      overdueItems: [
        {
          kind: "receivable",
          id: "2",
          code: "POH-2",
          reason: "Doklad je po splatnosti a stále není plně uhrazený.",
          severity: "low",
          remaining_amount: "700.00",
          currency: "CZK"
        }
      ]
    });

    expect(tasks[0]).toMatchObject({
      category: "payment_exception",
      severity: "high",
      title: "Prověřit doklad FV-1"
    });

    const issues = explainDocumentIssues(
      {
        kod: "FV-1",
        datVyst: "2026-04-01",
        datSplat: "2026-04-05",
        datUhr: "2026-04-06",
        zbyvaUhradit: "100.0",
        varSym: "",
        "zamekK@showAs": "Otevřeno",
        zuctovano: "false"
      },
      "sales_invoice",
      "2026-04-13"
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      "missing_partner",
      "missing_variable_symbol",
      "paid_date_with_balance",
      "overdue_unpaid",
      "still_open",
      "not_accounted"
    ]);
  });
});
