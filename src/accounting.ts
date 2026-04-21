export type PartnerRole = "customer" | "supplier" | "any";
export type DocumentKind =
  | "sales_invoice"
  | "purchase_invoice"
  | "receivable"
  | "payable"
  | "bank"
  | "cash"
  | "internal";
export type ReferenceValueKind =
  | "document_type"
  | "payment_method"
  | "bank_account"
  | "cash_register"
  | "center"
  | "project"
  | "activity"
  | "country"
  | "vat_code";
export type OverdueScope = "all" | "receivables" | "payables";
export type ReportEvidenceKind =
  | "overdue_report"
  | "overdue_report_paid"
  | "saldo_report"
  | "saldo_at_date_report";
export interface AssetsLiabilitiesPdfInput {
  report_name?: string;
  accounting_period?: string;
  account_filter?: string;
  account_ids?: string[];
  center_ids?: string[];
  activity_ids?: string[];
  currency_codes?: string[];
  group_by_center?: boolean;
  group_by_activity?: boolean;
}

export interface BalanceSheetPdfInput {
  report_name?: string;
  accounting_period?: string;
}

export interface DocumentItemInput {
  product_id?: string;
  product_code?: string;
  text?: string;
  quantity: number;
  unit_price?: number;
  vat_code?: string;
  vat_rate?: number;
}

export interface CreateDocumentDraftInput {
  kind: DocumentKind;
  partner_id: string;
  document_type_id?: string;
  issue_date?: string;
  due_date?: string;
  tax_date?: string;
  currency?: string;
  payment_method_id?: string;
  note?: string;
  items?: DocumentItemInput[];
}

export interface DocumentSearchInput {
  query?: string;
  partner_id?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  due_from?: string;
  due_to?: string;
  unpaid_only?: boolean;
  overdue_only?: boolean;
}

interface QueryPreset {
  fields: string[];
  includes?: string[];
  searchFields: string[];
}

export interface PdfReportRequest {
  path: string;
  query: Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;
  filename: string;
  report_name: string;
  report_variant: "assets_liabilities_accounts" | "balance_sheet_summary";
}

export interface DocumentKindConfig {
  kind: DocumentKind;
  evidence: string;
  itemEvidence: string;
  itemCollectionKey: string;
  summaryQuery: QueryPreset;
  partnerField: string;
  issueDateField?: string;
  dueDateField?: string;
  taxDateField?: string;
  totalField?: string;
  remainingField?: string;
  paymentStatusField?: string;
  documentStatusField?: string;
  variableSymbolField?: string;
  createAllowed: boolean;
  updateHeaderAllowed: boolean;
  updateItemsAllowed: boolean;
  postMode: "lock" | null;
  headerFieldMap: Record<string, string>;
}

export interface ReferenceValueConfig {
  kind: ReferenceValueKind;
  evidence: string;
  ttlMs: number;
  fields: string[];
  searchFields: string[];
}

export interface ReportEvidenceConfig {
  kind: ReportEvidenceKind;
  evidence: string;
  ttlMs: number;
  fetchLimit: number;
  fieldCandidates: {
    partner_name: string[];
    partner_id: string[];
    document_code: string[];
    document_kind: string[];
    due_date: string[];
    remaining_amount: string[];
    overdue_days: string[];
    variable_symbol: string[];
    currency: string[];
    status: string[];
    date: string[];
    receivable_balance: string[];
    payable_balance: string[];
    net_balance: string[];
    open_items_count: string[];
  };
}

export const documentKindRegistry: Record<DocumentKind, DocumentKindConfig> = {
  sales_invoice: {
    kind: "sales_invoice",
    evidence: "faktura-vydana",
    itemEvidence: "faktura-vydana-polozka",
    itemCollectionKey: "polozkyFaktury",
    summaryQuery: {
      fields: [
        "id",
        "kod",
        "nazev",
        "nazFirmy",
        "datVyst",
        "datSplat",
        "datSazbyDph",
        "sumCelkem",
        "zbyvaUhradit",
        "stavUhrK",
        "stavUzivK",
        "varSym",
        "lastUpdate",
        "mena(kod)"
      ],
      includes: ["mena"],
      searchFields: ["kod", "nazev", "nazFirmy", "varSym"]
    },
    partnerField: "firma",
    issueDateField: "datVyst",
    dueDateField: "datSplat",
    taxDateField: "datSazbyDph",
    totalField: "sumCelkem",
    remainingField: "zbyvaUhradit",
    paymentStatusField: "stavUhrK",
    documentStatusField: "stavUzivK",
    variableSymbolField: "varSym",
    createAllowed: true,
    updateHeaderAllowed: true,
    updateItemsAllowed: true,
    postMode: "lock",
    headerFieldMap: {
      partner_id: "firma",
      document_type_id: "typDokl",
      issue_date: "datVyst",
      due_date: "datSplat",
      tax_date: "datZdan",
      currency: "mena",
      payment_method_id: "formaUhradyCis",
      note: "poznam"
    }
  },
  purchase_invoice: {
    kind: "purchase_invoice",
    evidence: "faktura-prijata",
    itemEvidence: "faktura-prijata-polozka",
    itemCollectionKey: "polozkyFaktury",
    summaryQuery: {
      fields: [
        "id",
        "kod",
        "nazev",
        "nazFirmy",
        "datVyst",
        "datSplat",
        "datSazbyDph",
        "sumCelkem",
        "zbyvaUhradit",
        "stavUhrK",
        "stavUzivK",
        "varSym",
        "lastUpdate",
        "mena(kod)"
      ],
      includes: ["mena"],
      searchFields: ["kod", "nazev", "nazFirmy", "varSym"]
    },
    partnerField: "firma",
    issueDateField: "datVyst",
    dueDateField: "datSplat",
    taxDateField: "datSazbyDph",
    totalField: "sumCelkem",
    remainingField: "zbyvaUhradit",
    paymentStatusField: "stavUhrK",
    documentStatusField: "stavUzivK",
    variableSymbolField: "varSym",
    createAllowed: true,
    updateHeaderAllowed: true,
    updateItemsAllowed: true,
    postMode: "lock",
    headerFieldMap: {
      partner_id: "firma",
      document_type_id: "typDokl",
      issue_date: "datVyst",
      due_date: "datSplat",
      tax_date: "datZdan",
      currency: "mena",
      payment_method_id: "formaUhradyCis",
      note: "poznam"
    }
  },
  receivable: {
    kind: "receivable",
    evidence: "pohledavka",
    itemEvidence: "pohledavka-polozka",
    itemCollectionKey: "polozkyDokladu",
    summaryQuery: {
      fields: [
        "id",
        "kod",
        "nazev",
        "nazFirmy",
        "datVyst",
        "datSplat",
        "sumCelkem",
        "zbyvaUhradit",
        "stavUhrK",
        "stavUzivK",
        "varSym",
        "lastUpdate",
        "mena(kod)"
      ],
      includes: ["mena"],
      searchFields: ["kod", "nazev", "nazFirmy", "varSym"]
    },
    partnerField: "firma",
    issueDateField: "datVyst",
    dueDateField: "datSplat",
    totalField: "sumCelkem",
    remainingField: "zbyvaUhradit",
    paymentStatusField: "stavUhrK",
    documentStatusField: "stavUzivK",
    variableSymbolField: "varSym",
    createAllowed: true,
    updateHeaderAllowed: true,
    updateItemsAllowed: true,
    postMode: "lock",
    headerFieldMap: {
      partner_id: "firma",
      document_type_id: "typDokl",
      issue_date: "datVyst",
      due_date: "datSplat",
      currency: "mena",
      payment_method_id: "formaUhradyCis",
      note: "poznam"
    }
  },
  payable: {
    kind: "payable",
    evidence: "zavazek",
    itemEvidence: "zavazek-polozka",
    itemCollectionKey: "polozkyDokladu",
    summaryQuery: {
      fields: [
        "id",
        "kod",
        "nazev",
        "nazFirmy",
        "datVyst",
        "datSplat",
        "sumCelkem",
        "zbyvaUhradit",
        "stavUhrK",
        "stavUzivK",
        "varSym",
        "lastUpdate",
        "mena(kod)"
      ],
      includes: ["mena"],
      searchFields: ["kod", "nazev", "nazFirmy", "varSym"]
    },
    partnerField: "firma",
    issueDateField: "datVyst",
    dueDateField: "datSplat",
    totalField: "sumCelkem",
    remainingField: "zbyvaUhradit",
    paymentStatusField: "stavUhrK",
    documentStatusField: "stavUzivK",
    variableSymbolField: "varSym",
    createAllowed: true,
    updateHeaderAllowed: true,
    updateItemsAllowed: true,
    postMode: "lock",
    headerFieldMap: {
      partner_id: "firma",
      document_type_id: "typDokl",
      issue_date: "datVyst",
      due_date: "datSplat",
      currency: "mena",
      payment_method_id: "formaUhradyCis",
      note: "poznam"
    }
  },
  bank: {
    kind: "bank",
    evidence: "banka",
    itemEvidence: "banka-polozka",
    itemCollectionKey: "polozkyDokladu",
    summaryQuery: {
      fields: ["id", "kod", "nazev", "nazFirmy", "datVyst", "sumCelkem", "stavUzivK", "lastUpdate", "mena(kod)"],
      includes: ["mena"],
      searchFields: ["kod", "nazev", "nazFirmy"]
    },
    partnerField: "firma",
    issueDateField: "datVyst",
    totalField: "sumCelkem",
    documentStatusField: "stavUzivK",
    createAllowed: true,
    updateHeaderAllowed: true,
    updateItemsAllowed: true,
    postMode: null,
    headerFieldMap: {
      partner_id: "firma",
      document_type_id: "typDokl",
      issue_date: "datVyst",
      currency: "mena",
      note: "poznam"
    }
  },
  cash: {
    kind: "cash",
    evidence: "pokladni-pohyb",
    itemEvidence: "pokladni-pohyb-polozka",
    itemCollectionKey: "polozkyDokladu",
    summaryQuery: {
      fields: ["id", "kod", "nazev", "nazFirmy", "datVyst", "sumCelkem", "stavUzivK", "lastUpdate", "mena(kod)"],
      includes: ["mena"],
      searchFields: ["kod", "nazev", "nazFirmy"]
    },
    partnerField: "firma",
    issueDateField: "datVyst",
    totalField: "sumCelkem",
    documentStatusField: "stavUzivK",
    createAllowed: true,
    updateHeaderAllowed: true,
    updateItemsAllowed: true,
    postMode: null,
    headerFieldMap: {
      partner_id: "firma",
      document_type_id: "typDokl",
      issue_date: "datVyst",
      currency: "mena",
      note: "poznam"
    }
  },
  internal: {
    kind: "internal",
    evidence: "interni-doklad",
    itemEvidence: "interni-doklad-polozka",
    itemCollectionKey: "polozkyDokladu",
    summaryQuery: {
      fields: ["id", "kod", "nazev", "datVyst", "sumCelkem", "stavUzivK", "lastUpdate", "mena(kod)"],
      includes: ["mena"],
      searchFields: ["kod", "nazev"]
    },
    partnerField: "firma",
    issueDateField: "datVyst",
    totalField: "sumCelkem",
    documentStatusField: "stavUzivK",
    createAllowed: true,
    updateHeaderAllowed: true,
    updateItemsAllowed: true,
    postMode: null,
    headerFieldMap: {
      partner_id: "firma",
      document_type_id: "typDokl",
      issue_date: "datVyst",
      currency: "mena",
      note: "poznam"
    }
  }
};

export const referenceValueRegistry: Record<ReferenceValueKind, ReferenceValueConfig> = {
  document_type: {
    kind: "document_type",
    evidence: "typ-dokladu",
    ttlMs: 15 * 60 * 1000,
    fields: ["id", "kod", "nazev", "lastUpdate"],
    searchFields: ["kod", "nazev"]
  },
  payment_method: {
    kind: "payment_method",
    evidence: "forma-uhrady",
    ttlMs: 15 * 60 * 1000,
    fields: ["id", "kod", "nazev", "lastUpdate"],
    searchFields: ["kod", "nazev"]
  },
  bank_account: {
    kind: "bank_account",
    evidence: "bankovni-ucet-pokladna",
    ttlMs: 10 * 60 * 1000,
    fields: ["id", "kod", "nazev", "buc", "iban", "lastUpdate"],
    searchFields: ["kod", "nazev", "buc", "iban"]
  },
  cash_register: {
    kind: "cash_register",
    evidence: "pokladna",
    ttlMs: 10 * 60 * 1000,
    fields: ["id", "kod", "nazev", "lastUpdate"],
    searchFields: ["kod", "nazev"]
  },
  center: {
    kind: "center",
    evidence: "stredisko",
    ttlMs: 15 * 60 * 1000,
    fields: ["id", "kod", "nazev", "lastUpdate"],
    searchFields: ["kod", "nazev"]
  },
  project: {
    kind: "project",
    evidence: "zakazka",
    ttlMs: 15 * 60 * 1000,
    fields: ["id", "kod", "nazev", "lastUpdate"],
    searchFields: ["kod", "nazev"]
  },
  activity: {
    kind: "activity",
    evidence: "cinnost",
    ttlMs: 15 * 60 * 1000,
    fields: ["id", "kod", "nazev", "lastUpdate"],
    searchFields: ["kod", "nazev"]
  },
  country: {
    kind: "country",
    evidence: "stat",
    ttlMs: 30 * 60 * 1000,
    fields: ["id", "kod", "nazev", "lastUpdate"],
    searchFields: ["kod", "nazev"]
  },
  vat_code: {
    kind: "vat_code",
    evidence: "cenik-typ-sazby-dph",
    ttlMs: 30 * 60 * 1000,
    fields: ["id", "kod", "nazev", "lastUpdate"],
    searchFields: ["kod", "nazev"]
  }
};

export const reportEvidenceRegistry: Record<ReportEvidenceKind, ReportEvidenceConfig> = {
  overdue_report: {
    kind: "overdue_report",
    evidence: "neuhrazene-po-splatnosti",
    ttlMs: 2 * 60 * 1000,
    fetchLimit: 200,
    fieldCandidates: {
      partner_name: ["nazFirmy", "firma@showAs", "firma", "nazev"],
      partner_id: ["firma", "idFirmy", "partner", "adresar"],
      document_code: ["kod", "cisloDokladu", "doklad", "varSym"],
      document_kind: ["modul", "druhDokladu", "typDokladu", "smer", "druh", "typPohybuK"],
      due_date: ["datSplat", "datumSplatnosti", "dueDate"],
      remaining_amount: ["zbyvaUhradit", "castka", "saldo", "sumCelkem"],
      overdue_days: ["poSplatnosti", "dnuPoSplatnosti", "daysOverdue"],
      variable_symbol: ["varSym", "parSym"],
      currency: ["mena@showAs", "mena.kod", "mena"],
      status: ["stavUhrK@showAs", "stavUzivK@showAs", "stav", "status"],
      date: ["dat", "datum", "kDatu"],
      receivable_balance: [],
      payable_balance: [],
      net_balance: [],
      open_items_count: []
    }
  },
  overdue_report_paid: {
    kind: "overdue_report_paid",
    evidence: "neuhrazene-po-splatnosti-2",
    ttlMs: 2 * 60 * 1000,
    fetchLimit: 200,
    fieldCandidates: {
      partner_name: ["nazFirmy", "firma@showAs", "firma", "nazev"],
      partner_id: ["firma", "idFirmy", "partner", "adresar"],
      document_code: ["kod", "cisloDokladu", "doklad", "varSym"],
      document_kind: ["modul", "druhDokladu", "typDokladu", "smer", "druh", "typPohybuK"],
      due_date: ["datSplat", "datumSplatnosti", "dueDate"],
      remaining_amount: ["zbyvaUhradit", "castka", "saldo", "sumCelkem"],
      overdue_days: ["poSplatnosti", "dnuPoSplatnosti", "daysOverdue"],
      variable_symbol: ["varSym", "parSym"],
      currency: ["mena@showAs", "mena.kod", "mena"],
      status: ["stavUhrK@showAs", "stavUzivK@showAs", "stav", "status"],
      date: ["dat", "datum", "kDatu"],
      receivable_balance: [],
      payable_balance: [],
      net_balance: [],
      open_items_count: []
    }
  },
  saldo_report: {
    kind: "saldo_report",
    evidence: "saldo",
    ttlMs: 2 * 60 * 1000,
    fetchLimit: 200,
    fieldCandidates: {
      partner_name: ["firma@showAs", "nazFirmy", "firma"],
      partner_id: ["firma", "idFirmy", "partner", "adresar"],
      document_code: ["kod", "cisloDokladu", "doklad", "varSym"],
      document_kind: ["modul", "druhDokladu", "typDokladu", "smer", "druh", "typPohybuK"],
      due_date: ["datSplat", "datumSplatnosti", "dueDate"],
      remaining_amount: ["saldo", "castka", "zbyvaUhradit", "sumCelkem"],
      overdue_days: ["poSplatnosti", "dnuPoSplatnosti", "daysOverdue"],
      variable_symbol: ["varSym", "parSym"],
      currency: ["mena@showAs", "mena.kod", "mena"],
      status: ["stavUhrK@showAs", "stavUzivK@showAs", "stav", "status"],
      date: ["dat", "datum", "kDatu"],
      receivable_balance: ["pohledavka", "pohledavky", "saldoMd", "md"],
      payable_balance: ["zavazek", "zavazky", "saldoDal", "dal"],
      net_balance: ["saldo", "zustatek", "zbytek"],
      open_items_count: ["pocetPolozek", "pocetDokladu", "pocetOtevrenychPolozek"]
    }
  },
  saldo_at_date_report: {
    kind: "saldo_at_date_report",
    evidence: "saldo-k-datu",
    ttlMs: 2 * 60 * 1000,
    fetchLimit: 200,
    fieldCandidates: {
      partner_name: ["firma@showAs", "nazFirmy", "firma"],
      partner_id: ["firma", "idFirmy", "partner", "adresar"],
      document_code: ["kod", "cisloDokladu", "doklad", "varSym"],
      document_kind: ["modul", "druhDokladu", "typDokladu", "smer", "druh", "typPohybuK"],
      due_date: ["datSplat", "datumSplatnosti", "dueDate"],
      remaining_amount: ["saldo", "castka", "zbyvaUhradit", "sumCelkem"],
      overdue_days: ["poSplatnosti", "dnuPoSplatnosti", "daysOverdue"],
      variable_symbol: ["varSym", "parSym"],
      currency: ["mena@showAs", "mena.kod", "mena"],
      status: ["stavUhrK@showAs", "stavUzivK@showAs", "stav", "status"],
      date: ["dat", "datum", "kDatu"],
      receivable_balance: ["pohledavka", "pohledavky", "saldoMd", "md"],
      payable_balance: ["zavazek", "zavazky", "saldoDal", "dal"],
      net_balance: ["saldo", "zustatek", "zbytek"],
      open_items_count: ["pocetPolozek", "pocetDokladu", "pocetOtevrenychPolozek"]
    }
  }
};

export function getDocumentKindConfig(kind: DocumentKind): DocumentKindConfig {
  return documentKindRegistry[kind];
}

export function getReferenceValueConfig(kind: ReferenceValueKind): ReferenceValueConfig {
  return referenceValueRegistry[kind];
}

export function getReportEvidenceConfig(kind: ReportEvidenceKind): ReportEvidenceConfig {
  return reportEvidenceRegistry[kind];
}

export function toIsoDate(value?: string): string {
  if (value && value.trim() !== "") {
    return value;
  }
  return new Date().toISOString().slice(0, 10);
}

export function buildReportSelector(partnerId?: string): string | undefined {
  if (!partnerId) {
    return undefined;
  }
  return `(firma='${escapeFilterValue(partnerId)}')`;
}

export function getSaldoModules(scope: OverdueScope): string | undefined {
  if (scope === "receivables") {
    return "FAV,PHL";
  }
  if (scope === "payables") {
    return "FAP,ZAV";
  }
  return undefined;
}

export function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function quote(value: string): string {
  return `"${escapeFilterValue(value)}"`;
}

export function combineFilters(filters: Array<string | undefined>): string | undefined {
  const visible = filters.filter((value): value is string => Boolean(value));
  if (visible.length === 0) {
    return undefined;
  }
  if (visible.length === 1) {
    return visible[0];
  }
  return visible.map((value) => `(${value})`).join(" and ");
}

export function buildTextSearchFilter(query: string | undefined, fields: string[]): string | undefined {
  if (!query) {
    return undefined;
  }
  const text = escapeFilterValue(query.trim());
  if (!text) {
    return undefined;
  }
  return fields.map((field) => `${field} like ${quote(text)}`).join(" or ");
}

export function buildPartnerFilter(partnerId: string | undefined, field = "firma"): string | undefined {
  if (!partnerId) {
    return undefined;
  }
  return `${field} eq ${quote(partnerId)}`;
}

export function buildDateRangeFilter(field: string | undefined, from?: string, to?: string): string | undefined {
  if (!field) {
    return undefined;
  }
  const filters: string[] = [];
  if (from) {
    filters.push(`${field} ge ${quote(from)}`);
  }
  if (to) {
    filters.push(`${field} le ${quote(to)}`);
  }
  return combineFilters(filters);
}

export function buildStatusFilter(field: string | undefined, status?: string): string | undefined {
  if (!field || !status) {
    return undefined;
  }
  return `${field} eq ${quote(status)}`;
}

export function buildUnpaidFilter(config: DocumentKindConfig, overdueOnly?: boolean): string | undefined {
  const remaining = config.remainingField ? `${config.remainingField} gt 0` : undefined;
  const payment = config.paymentStatusField ? `${config.paymentStatusField} neq ${quote("stavUhr.uhrazeno")}` : undefined;
  const due = overdueOnly && config.dueDateField ? `${config.dueDateField} lt ${quote(new Date().toISOString().slice(0, 10))}` : undefined;
  return combineFilters([remaining, payment, due]);
}

export function buildDocumentSearchFilter(config: DocumentKindConfig, input: DocumentSearchInput): string | undefined {
  return combineFilters([
    buildTextSearchFilter(input.query, config.summaryQuery.searchFields),
    buildPartnerFilter(input.partner_id, config.partnerField),
    buildStatusFilter(config.paymentStatusField ?? config.documentStatusField, input.status),
    buildDateRangeFilter(config.issueDateField, input.date_from, input.date_to),
    buildDateRangeFilter(config.dueDateField, input.due_from, input.due_to),
    input.unpaid_only || input.overdue_only ? buildUnpaidFilter(config, input.overdue_only) : undefined
  ]);
}

function normalizeIdentifier(id: string): string {
  if (/^(code:|ext:|\d+$)/.test(id)) {
    return id;
  }
  return `code:${id}`;
}

function normalizeCurrency(value: string): string {
  return /^code:/.test(value) ? value : `code:${value}`;
}

function normalizeVatCode(vatCode?: string, vatRate?: number): string | undefined {
  if (vatCode) {
    return vatCode;
  }
  if (vatRate === undefined) {
    return undefined;
  }
  if (vatRate === 21) {
    return "typSzbDph.dphZakl";
  }
  if (vatRate === 12) {
    return "typSzbDph.dphSniz";
  }
  if (vatRate === 10) {
    return "typSzbDph.dphSniz2";
  }
  if (vatRate === 0) {
    return "typSzbDph.osv";
  }
  return undefined;
}

export function mapHeaderChangesToFlexi(config: DocumentKindConfig, changes: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(changes)) {
    const target = config.headerFieldMap[key];
    if (!target || value === undefined || value === null || value === "") {
      continue;
    }

    if (key === "partner_id" || key === "document_type_id" || key === "payment_method_id") {
      mapped[target] = normalizeIdentifier(String(value));
      continue;
    }
    if (key === "currency") {
      mapped[target] = normalizeCurrency(String(value));
      continue;
    }

    mapped[target] = value;
  }

  return mapped;
}

export function buildItemPayload(item: DocumentItemInput): Record<string, unknown> {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw new Error("Each item must include quantity > 0.");
  }
  if (item.unit_price === undefined || !Number.isFinite(item.unit_price)) {
    throw new Error("Each item must include unit_price.");
  }
  if (!item.product_id && !item.product_code && !item.text) {
    throw new Error("Each item must include product_id, product_code, or text.");
  }

  const payload: Record<string, unknown> = {
    typPolozkyK: "typPolozky.obecny",
    mnozMj: item.quantity,
    cenaMj: item.unit_price
  };

  if (item.product_id) {
    payload.cenik = normalizeIdentifier(item.product_id);
  } else if (item.product_code) {
    payload.cenik = normalizeIdentifier(item.product_code);
  }

  if (item.text) {
    payload.text = item.text;
    payload.nazev = item.text;
  }

  const vatCode = normalizeVatCode(item.vat_code, item.vat_rate);
  if (vatCode) {
    payload.typSzbDphK = vatCode;
  }

  return payload;
}

export function buildItemsCollection(
  config: DocumentKindConfig,
  items: DocumentItemInput[],
  replaceAll = false
): Record<string, unknown> {
  const records = items.map((item) => buildItemPayload(item));
  if (replaceAll) {
    return {
      [config.itemCollectionKey]: records,
      [`${config.itemCollectionKey}@removeAll`]: "true"
    };
  }
  return {
    [config.itemCollectionKey]: records
  };
}

export function buildCreateDocumentPayload(input: CreateDocumentDraftInput): {
  evidence: string;
  payload: string;
} {
  const config = getDocumentKindConfig(input.kind);
  const header = mapHeaderChangesToFlexi(config, {
    partner_id: input.partner_id,
    document_type_id: input.document_type_id,
    issue_date: input.issue_date,
    due_date: input.due_date,
    tax_date: input.tax_date,
    currency: input.currency,
    payment_method_id: input.payment_method_id,
    note: input.note
  });

  if (Object.keys(header).length === 0) {
    throw new Error("Document header is empty.");
  }

  const documentRecord: Record<string, unknown> = {
    ...header
  };

  if (input.items && input.items.length > 0) {
    Object.assign(documentRecord, buildItemsCollection(config, input.items));
  }

  return {
    evidence: config.evidence,
    payload: JSON.stringify({
      winstrom: {
        [config.evidence]: [documentRecord]
      }
    })
  };
}

export function buildDocumentHeaderUpdatePayload(
  kind: DocumentKind,
  id: string,
  changes: Record<string, unknown>
): { evidence: string; payload: string } {
  const config = getDocumentKindConfig(kind);
  const mapped = mapHeaderChangesToFlexi(config, changes);
  if (Object.keys(mapped).length === 0) {
    throw new Error("No supported header changes were provided.");
  }

  return {
    evidence: config.evidence,
    payload: JSON.stringify({
      winstrom: {
        [config.evidence]: [
          {
            id,
            ...mapped
          }
        ]
      }
    })
  };
}

export function buildDocumentItemsUpdatePayload(
  kind: DocumentKind,
  id: string,
  items: DocumentItemInput[]
): { evidence: string; payload: string } {
  const config = getDocumentKindConfig(kind);
  if (items.length === 0) {
    throw new Error("items must not be empty.");
  }

  return {
    evidence: config.evidence,
    payload: JSON.stringify({
      winstrom: {
        [config.evidence]: [
          {
            id,
            ...buildItemsCollection(config, items, true)
          }
        ]
      }
    })
  };
}

export function buildPostDocumentPayload(kind: DocumentKind, id: string): { evidence: string; payload: string } {
  const config = getDocumentKindConfig(kind);
  if (!config.postMode) {
    throw new Error(`Posting is not supported for kind '${kind}'.`);
  }

  return {
    evidence: config.evidence,
    payload: JSON.stringify({
      winstrom: {
        [config.evidence]: [
          {
            id,
            "@action": config.postMode
          }
        ]
      }
    })
  };
}

export function getPartnerSearchSpec(role: PartnerRole): { evidence: string; searchFields: string[]; fields: string[] }[] {
  if (role === "supplier") {
    return [
      {
        evidence: "dodavatel",
        searchFields: ["kod", "nazev", "ic", "dic", "mesto"],
        fields: ["id", "kod", "nazev", "ic", "dic", "mesto", "lastUpdate"]
      }
    ];
  }
  return [
    {
      evidence: "adresar",
      searchFields: ["kod", "nazev", "ic", "dic", "mesto"],
      fields: ["id", "kod", "nazev", "ic", "dic", "mesto", "lastUpdate", "stat(kod)"],
    },
    ...(role === "any"
      ? [
          {
            evidence: "dodavatel",
            searchFields: ["kod", "nazev", "ic", "dic", "mesto"],
            fields: ["id", "kod", "nazev", "ic", "dic", "mesto", "lastUpdate"]
          }
        ]
      : [])
  ];
}

export function getProductSearchSpec(): { evidence: string; fields: string[]; searchFields: string[] } {
  return {
    evidence: "cenik",
    fields: ["id", "kod", "nazev", "mj1", "cenaZakl", "lastUpdate", "typSzbDphK"],
    searchFields: ["kod", "nazev"]
  };
}

export function buildAssetsLiabilitiesPdfRequest(
  companySlug: string,
  input: AssetsLiabilitiesPdfInput = {}
): PdfReportRequest {
  const reportName = input.report_name?.trim() || "rozvahaPoUctechObraty";
  const period = input.accounting_period?.trim();
  const normalizedPeriod = period?.replace(/[^a-zA-Z0-9_-]+/g, "-") || "aktualni-obdobi";
  const filenameParts = [
    "soupis-aktiv-a-pasiv",
    companySlug.trim(),
    normalizedPeriod
  ].filter(Boolean);

  return {
    path: `/c/${companySlug}/rozvaha-po-uctech.pdf`,
    query: {
      "report-name": reportName,
      ucetniObdobi: period,
      filtrUcty: input.account_filter?.trim() || undefined,
      ucet: input.account_ids?.filter(Boolean),
      stredisko: input.center_ids?.filter(Boolean),
      cinnost: input.activity_ids?.filter(Boolean),
      mena: input.currency_codes?.filter(Boolean),
      groupByStredisko: input.group_by_center,
      groupByCinnost: input.group_by_activity
    },
    filename: `${filenameParts.join("-")}.pdf`,
    report_name: reportName,
    report_variant: "assets_liabilities_accounts"
  };
}

export function buildBalanceSheetPdfRequest(
  companySlug: string,
  input: BalanceSheetPdfInput = {}
): PdfReportRequest {
  const reportName = input.report_name?.trim() || "rozvaha$$SUM";
  const period = input.accounting_period?.trim();
  const normalizedPeriod = period?.replace(/[^a-zA-Z0-9_-]+/g, "-") || "aktualni-obdobi";
  const filenameParts = [
    "rozvaha",
    companySlug.trim(),
    normalizedPeriod
  ].filter(Boolean);

  return {
    path: `/c/${companySlug}/sestava.pdf`,
    query: {
      "report-name": reportName,
      ucetniObdobi: period
    },
    filename: `${filenameParts.join("-")}.pdf`,
    report_name: reportName,
    report_variant: "balance_sheet_summary"
  };
}
