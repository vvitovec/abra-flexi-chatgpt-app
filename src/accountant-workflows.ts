type UnknownRecord = Record<string, unknown>;

export interface EmployeeContractSummary {
  contract_id?: string;
  contract_label?: string;
  employment_type?: string;
  role?: string;
  start_date?: string;
  end_date?: string;
  weekly_hours?: string;
  active: boolean;
}

export interface EmployeeSummary {
  id: string;
  personal_number?: string;
  name: string;
  role?: string;
  active: boolean;
  contract_count: number;
  active_contracts: number;
  weekly_hours_total?: string;
  start_date?: string;
  end_date?: string;
  employment_types?: string[];
  contracts?: EmployeeContractSummary[];
}

export interface EmployeeLookupResult {
  status: "match" | "ambiguous" | "not_found";
  employee?: EmployeeSummary;
  matches?: EmployeeSummary[];
}

export interface EmployeeDocumentSummary {
  evidence: string;
  id: string;
  title: string;
  employee_name?: string;
  date?: string;
  end_date?: string;
  status?: string;
  note?: string;
}

export interface VatBucketSummary {
  count: number;
  tax_base: string;
  vat_amount: string;
  total_amount: string;
  unpaid_amount: string;
  overdue_amount: string;
  currency?: string;
}

export interface VatSummary {
  outgoing: VatBucketSummary;
  incoming: VatBucketSummary;
  net_vat_due: string;
  currencies?: string[];
}

export interface PaymentMismatchSummary {
  kind: string;
  id: string;
  code?: string;
  partner_name?: string;
  reason: string;
  severity: "high" | "medium" | "low";
  issue_date?: string;
  due_date?: string;
  remaining_amount?: string;
  currency?: string;
  variable_symbol?: string;
  payment_status?: string;
  paid_date?: string;
}

export interface CashflowBucketSummary {
  count: number;
  amount: string;
}

export interface CashflowRiskSummary {
  kind: "receivable" | "payable";
  id: string;
  code?: string;
  partner_name?: string;
  due_date?: string;
  overdue_days?: number;
  amount?: string;
  currency?: string;
}

export interface CashflowSnapshotSummary {
  as_of: string;
  overdue_receivables: CashflowBucketSummary;
  overdue_payables: CashflowBucketSummary;
  due_next_7_days_receivables: CashflowBucketSummary;
  due_next_7_days_payables: CashflowBucketSummary;
  top_risks: CashflowRiskSummary[];
}

export interface CompanyTaskSummary {
  id: string;
  category: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail?: string;
  due_date?: string;
  amount?: string;
  currency?: string;
  kind?: string;
}

export interface DocumentIssueSummary {
  code: string;
  severity: "high" | "medium" | "low";
  message: string;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function toStringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function toNumberValue(value: unknown): number {
  const text = toStringValue(value);
  if (!text) {
    return 0;
  }
  const normalized = text.replace(/\s+/g, "").replace(",", ".");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : 0;
}

function normalizeDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : trimmed;
}

function normalizeEmployeeName(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const withoutCode = value.includes(":") ? value.split(":").slice(1).join(":") : value;
  const normalized = withoutCode.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function normalizeLabel(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function getPathValue(record: UnknownRecord, path: string): unknown {
  if (path in record) {
    return record[path];
  }

  const normalizedPath = path
    .replace(/\(([^)]+)\)/g, ".$1")
    .replace(/^\.+|\.+$/g, "");
  const parts = normalizedPath.split(".").filter(Boolean);
  let current: unknown = record;

  for (const part of parts) {
    const currentRecord = toRecord(current);
    if (!currentRecord) {
      return undefined;
    }
    current = currentRecord[part];
  }

  return current;
}

function pickPath(record: UnknownRecord, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = toStringValue(getPathValue(record, path));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseDateValue(value?: string): number | null {
  const normalized = normalizeDate(value);
  if (!normalized) {
    return null;
  }
  const timestamp = Date.parse(`${normalized}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isActiveOn(endDate: string | undefined, asOfDate: string): boolean {
  if (!endDate) {
    return true;
  }
  const end = parseDateValue(endDate);
  const asOf = parseDateValue(asOfDate);
  if (end === null || asOf === null) {
    return true;
  }
  return end >= asOf;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function asAmount(value: number): string {
  return value.toFixed(2);
}

function groupEmployeeKey(record: UnknownRecord): string {
  const personalNumber = pickPath(record, ["osbCis", "osb_cis"]);
  if (personalNumber) {
    return `personal:${personalNumber}`;
  }
  return `name:${normalizeEmployeeName(pickPath(record, ["jmeno", "osoba@showAs"]))?.toLowerCase() ?? "unknown"}`;
}

function buildEmployeeContract(record: UnknownRecord, asOfDate: string): EmployeeContractSummary {
  const endDate = normalizeDate(pickPath(record, ["konecPomeru", "konec_pomeru"]));
  return {
    contract_id: pickPath(record, ["id"]),
    contract_label: normalizeLabel(pickPath(record, ["pracPom@showAs", "pracPomHlav@showAs", "typPracPom@showAs", "pracPom"])),
    employment_type: normalizeLabel(pickPath(record, ["typPracPom@showAs", "pracPom@showAs", "typPracPom"])),
    role: pickPath(record, ["funkce"]),
    start_date: normalizeDate(pickPath(record, ["zacatek"])),
    end_date: endDate,
    weekly_hours: pickPath(record, ["uvazHodTydne", "uvaz_hod_tydne"]),
    active: isActiveOn(endDate, asOfDate)
  };
}

export function summarizeEmployees(
  records: UnknownRecord[],
  options: {
    as_of: string;
    active_only?: boolean;
    include_contracts?: boolean;
  }
): EmployeeSummary[] {
  const grouped = new Map<
    string,
    {
      id: string;
      personal_number?: string;
      name: string;
      role?: string;
      contracts: EmployeeContractSummary[];
    }
  >();

  for (const record of records) {
    const key = groupEmployeeKey(record);
    const contract = buildEmployeeContract(record, options.as_of);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        id: key,
        personal_number: pickPath(record, ["osbCis", "osb_cis"]),
        name: normalizeEmployeeName(pickPath(record, ["jmeno", "osoba@showAs"])) ?? "Neznámý zaměstnanec",
        role: pickPath(record, ["funkce"]),
        contracts: [contract]
      });
      continue;
    }

    existing.role ||= pickPath(record, ["funkce"]);
    const duplicate = existing.contracts.find(
      (item) =>
        item.contract_id === contract.contract_id &&
        item.start_date === contract.start_date &&
        item.end_date === contract.end_date &&
        item.contract_label === contract.contract_label
    );
    if (!duplicate) {
      existing.contracts.push(contract);
    }
  }

  const employees = [...grouped.values()]
    .map((employee) => {
      const activeContracts = employee.contracts.filter((contract) => contract.active);
      const visibleContracts = options.active_only ? activeContracts : employee.contracts;
      const relevantContracts = visibleContracts.length > 0 ? visibleContracts : employee.contracts;
      const startDates = relevantContracts.map((contract) => parseDateValue(contract.start_date)).filter((value): value is number => value !== null);
      const endDates = relevantContracts
        .map((contract) => contract.end_date)
        .filter((value): value is string => Boolean(value))
        .map((value) => parseDateValue(value))
        .filter((value): value is number => value !== null);
      const weeklyHoursTotal = activeContracts.reduce((sum, contract) => sum + toNumberValue(contract.weekly_hours), 0);

      return {
        id: employee.id,
        personal_number: employee.personal_number,
        name: employee.name,
        role: employee.role,
        active: activeContracts.length > 0,
        contract_count: employee.contracts.length,
        active_contracts: activeContracts.length,
        weekly_hours_total: weeklyHoursTotal > 0 ? asAmount(weeklyHoursTotal) : undefined,
        start_date:
          startDates.length > 0 ? new Date(Math.min(...startDates)).toISOString().slice(0, 10) : undefined,
        end_date:
          activeContracts.length > 0 || endDates.length === 0
            ? undefined
            : new Date(Math.max(...endDates)).toISOString().slice(0, 10),
        employment_types: uniqueStrings(relevantContracts.map((contract) => contract.employment_type)),
        contracts: options.include_contracts ? relevantContracts : undefined
      } satisfies EmployeeSummary;
    })
    .filter((employee) => !options.active_only || employee.active);

  return employees.sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    return left.name.localeCompare(right.name, "cs");
  });
}

export function resolveEmployeeLookup(
  employees: EmployeeSummary[],
  options: {
    personal_number?: string;
    employee_id?: string;
    query?: string;
  }
): EmployeeLookupResult {
  const normalizedQuery = options.query?.trim().toLowerCase();
  const normalizedEmployeeId = options.employee_id?.trim().toLowerCase();
  const normalizedPersonalNumber = options.personal_number?.trim();

  const matches = employees.filter((employee) => {
    if (normalizedPersonalNumber && employee.personal_number === normalizedPersonalNumber) {
      return true;
    }
    if (normalizedEmployeeId && employee.id.toLowerCase() === normalizedEmployeeId) {
      return true;
    }
    if (normalizedQuery) {
      return (
        employee.name.toLowerCase().includes(normalizedQuery) ||
        (employee.personal_number?.toLowerCase().includes(normalizedQuery) ?? false)
      );
    }
    return false;
  });

  if (matches.length === 0) {
    return { status: "not_found" };
  }
  if (matches.length === 1) {
    return { status: "match", employee: matches[0] };
  }
  return { status: "ambiguous", matches: matches.slice(0, 10) };
}

export function mapEmployeeDocumentHits(
  evidence: string,
  records: UnknownRecord[],
  asOfDate: string
): EmployeeDocumentSummary[] {
  return records.map((record) => {
    const endDate = normalizeDate(pickPath(record, ["konecPomeru", "datDo"]));
    const issueDate = normalizeDate(pickPath(record, ["zacatek", "datOd", "datVyst"]));
    const title =
      normalizeEmployeeName(
        pickPath(record, ["pracPom@showAs", "typPracPom@showAs", "pracPom", "typPracPom", "poznam", "nazev"])
      ) ??
      evidence;
    return {
      evidence,
      id: pickPath(record, ["id"]) ?? "unknown",
      title,
      employee_name: normalizeEmployeeName(pickPath(record, ["jmeno", "osoba@showAs"])),
      date: issueDate,
      end_date: endDate,
      status:
        evidence === "pracovni-pomer"
          ? isActiveOn(endDate, asOfDate)
            ? "active"
            : "inactive"
          : pickPath(record, ["stavUzivK@showAs", "stavUzivK"]),
      note: pickPath(record, ["poznam"])
    };
  });
}

function summarizeVatBucket(records: UnknownRecord[], asOfDate: string): VatBucketSummary {
  const baseAmount = records.reduce((sum, record) => sum + toNumberValue(getPathValue(record, "sumZklCelkem")), 0);
  const vatAmount = records.reduce((sum, record) => sum + toNumberValue(getPathValue(record, "sumDphCelkem")), 0);
  const totalAmount = records.reduce((sum, record) => sum + toNumberValue(getPathValue(record, "sumCelkem")), 0);
  const unpaidAmount = records.reduce((sum, record) => sum + toNumberValue(getPathValue(record, "zbyvaUhradit")), 0);
  const overdueAmount = records.reduce((sum, record) => {
    const remaining = toNumberValue(getPathValue(record, "zbyvaUhradit"));
    const dueDate = normalizeDate(pickPath(record, ["datSplat"]));
    if (!dueDate || !remaining || isActiveOn(dueDate, asOfDate)) {
      return sum;
    }
    return sum + remaining;
  }, 0);
  const currencies = uniqueStrings(records.map((record) => pickPath(record, ["mena.kod", "mena@showAs", "mena"])));
  return {
    count: records.length,
    tax_base: asAmount(baseAmount),
    vat_amount: asAmount(vatAmount),
    total_amount: asAmount(totalAmount),
    unpaid_amount: asAmount(unpaidAmount),
    overdue_amount: asAmount(overdueAmount),
    currency: currencies.length === 1 ? currencies[0] : currencies.length > 1 ? "MULTI" : undefined
  };
}

export function buildVatSummary(
  outgoingRecords: UnknownRecord[],
  incomingRecords: UnknownRecord[],
  asOfDate: string
): VatSummary {
  const outgoing = summarizeVatBucket(outgoingRecords, asOfDate);
  const incoming = summarizeVatBucket(incomingRecords, asOfDate);
  const currencies = uniqueStrings([outgoing.currency, incoming.currency]).filter((value) => value !== "MULTI");
  return {
    outgoing,
    incoming,
    net_vat_due: asAmount(toNumberValue(outgoing.vat_amount) - toNumberValue(incoming.vat_amount)),
    currencies: currencies.length > 0 ? currencies : undefined
  };
}

function normalizePaymentStatus(record: UnknownRecord): string | undefined {
  return pickPath(record, ["stavUhrK@showAs", "stavUhrK"]);
}

function normalizePartnerName(record: UnknownRecord): string | undefined {
  return pickPath(record, ["nazFirmy", "partnerName@showAs", "firma@showAs", "partnerName", "firma"]);
}

export function detectPaymentMismatches(
  records: UnknownRecord[],
  kind: string,
  asOfDate: string
): PaymentMismatchSummary[] {
  const mismatches: PaymentMismatchSummary[] = [];

  for (const record of records) {
    const remaining = toNumberValue(getPathValue(record, "zbyvaUhradit"));
    const paymentStatus = normalizePaymentStatus(record);
    const paymentStatusLower = paymentStatus?.toLowerCase() ?? "";
    const issueDate = normalizeDate(pickPath(record, ["datVyst"]));
    const dueDate = normalizeDate(pickPath(record, ["datSplat"]));
    const paidDate = normalizeDate(pickPath(record, ["datUhr"]));
    const variableSymbol = pickPath(record, ["varSym"]);
    const paymentMethod = normalizeEmployeeName(pickPath(record, ["formaUhradyCis@showAs", "formaUhradyCis"]));
    const partnerName = normalizePartnerName(record);
    const code = pickPath(record, ["kod"]);
    const base = {
      kind,
      id: pickPath(record, ["id"]) ?? code ?? "unknown",
      code,
      partner_name: partnerName,
      issue_date: issueDate,
      due_date: dueDate,
      remaining_amount: remaining ? asAmount(remaining) : undefined,
      currency: pickPath(record, ["mena.kod", "mena@showAs", "mena"]),
      variable_symbol: variableSymbol,
      payment_status: paymentStatus,
      paid_date: paidDate
    };

    if (paidDate && remaining > 0.009) {
      mismatches.push({
        ...base,
        severity: "high",
        reason: "Doklad má datum úhrady, ale stále zbývá uhradit nenulová částka."
      });
    }

    if (!paidDate && remaining <= 0.009 && paymentStatusLower.includes("neuhra")) {
      mismatches.push({
        ...base,
        severity: "medium",
        reason: "Doklad už nemá zůstatek, ale stav úhrady stále vypadá jako neuhrazený."
      });
    }

    if (paymentMethod && /přev|prev|bank|inkaso|kart/i.test(paymentMethod) && !variableSymbol) {
      mismatches.push({
        ...base,
        severity: "medium",
        reason: "Pro bezhotovostní úhradu chybí variabilní symbol."
      });
    }

    if (dueDate && remaining > 0.009 && !isActiveOn(dueDate, asOfDate)) {
      mismatches.push({
        ...base,
        severity: "low",
        reason: "Doklad je po splatnosti a stále není plně uhrazený."
      });
    }

    if (kind === "bank" && toStringValue(getPathValue(record, "sparovano")) === "false") {
      mismatches.push({
        ...base,
        severity: "medium",
        reason: "Bankovní pohyb není spárovaný s dokladem."
      });
    }
  }

  return mismatches;
}

function buildCashflowBucket(records: UnknownRecord[]): CashflowBucketSummary {
  return {
    count: records.length,
    amount: asAmount(records.reduce((sum, record) => sum + toNumberValue(getPathValue(record, "zbyvaUhradit")), 0))
  };
}

function toRisk(kind: "receivable" | "payable", record: UnknownRecord, asOfDate: string): CashflowRiskSummary {
  const dueDate = normalizeDate(pickPath(record, ["datSplat"]));
  const dueTimestamp = parseDateValue(dueDate);
  const asOfTimestamp = parseDateValue(asOfDate);
  const overdueDays =
    dueTimestamp !== null && asOfTimestamp !== null && dueTimestamp < asOfTimestamp
      ? Math.round((asOfTimestamp - dueTimestamp) / 86400000)
      : undefined;

  return {
    kind,
    id: pickPath(record, ["id"]) ?? "unknown",
    code: pickPath(record, ["kod"]),
    partner_name: normalizePartnerName(record),
    due_date: dueDate,
    overdue_days: overdueDays,
    amount: pickPath(record, ["zbyvaUhradit", "sumCelkem"]),
    currency: pickPath(record, ["mena.kod", "mena@showAs", "mena"])
  };
}

export function buildCashflowSnapshot(
  receivableRecords: UnknownRecord[],
  payableRecords: UnknownRecord[],
  asOfDate: string
): CashflowSnapshotSummary {
  const asOfTimestamp = parseDateValue(asOfDate) ?? Date.now();
  const nextWeekTimestamp = asOfTimestamp + 7 * 86400000;

  const byDueWindow = (records: UnknownRecord[], lowerInclusive: number, upperInclusive: number) =>
    records.filter((record) => {
      const dueTimestamp = parseDateValue(normalizeDate(pickPath(record, ["datSplat"])));
      if (dueTimestamp === null || toNumberValue(getPathValue(record, "zbyvaUhradit")) <= 0.009) {
        return false;
      }
      return dueTimestamp >= lowerInclusive && dueTimestamp <= upperInclusive;
    });

  const overdueReceivables = receivableRecords.filter((record) => {
    const dueTimestamp = parseDateValue(normalizeDate(pickPath(record, ["datSplat"])));
    return dueTimestamp !== null && dueTimestamp < asOfTimestamp && toNumberValue(getPathValue(record, "zbyvaUhradit")) > 0.009;
  });
  const overduePayables = payableRecords.filter((record) => {
    const dueTimestamp = parseDateValue(normalizeDate(pickPath(record, ["datSplat"])));
    return dueTimestamp !== null && dueTimestamp < asOfTimestamp && toNumberValue(getPathValue(record, "zbyvaUhradit")) > 0.009;
  });

  const dueNextWeekReceivables = byDueWindow(receivableRecords, asOfTimestamp, nextWeekTimestamp);
  const dueNextWeekPayables = byDueWindow(payableRecords, asOfTimestamp, nextWeekTimestamp);

  const topRisks = [
    ...overdueReceivables.map((record) => toRisk("receivable", record, asOfDate)),
    ...overduePayables.map((record) => toRisk("payable", record, asOfDate))
  ]
    .sort((left, right) => toNumberValue(right.amount) - toNumberValue(left.amount))
    .slice(0, 8);

  return {
    as_of: asOfDate,
    overdue_receivables: buildCashflowBucket(overdueReceivables),
    overdue_payables: buildCashflowBucket(overduePayables),
    due_next_7_days_receivables: buildCashflowBucket(dueNextWeekReceivables),
    due_next_7_days_payables: buildCashflowBucket(dueNextWeekPayables),
    top_risks: topRisks
  };
}

export function buildCompanyTasks(input: {
  overdueItems: PaymentMismatchSummary[];
  mismatches: PaymentMismatchSummary[];
  draftDocuments?: Array<{ kind: string; id: string; code?: string }>;
  limit?: number;
}): CompanyTaskSummary[] {
  const tasks: CompanyTaskSummary[] = [];

  for (const issue of input.mismatches) {
    tasks.push({
      id: `${issue.kind}:${issue.id}:${issue.reason}`,
      category: "payment_exception",
      severity: issue.severity,
      title: issue.code ? `Prověřit doklad ${issue.code}` : "Prověřit platební výjimku",
      detail: issue.reason,
      due_date: issue.due_date,
      amount: issue.remaining_amount,
      currency: issue.currency,
      kind: issue.kind
    });
  }

  for (const item of input.overdueItems) {
    tasks.push({
      id: `overdue:${item.kind}:${item.id}`,
      category: item.kind === "receivable" ? "receivable_overdue" : "payable_overdue",
      severity: item.kind === "receivable" ? "high" : "medium",
      title: item.code
        ? `${item.kind === "receivable" ? "Urgovat úhradu" : "Naplánovat úhradu"} ${item.code}`
        : item.kind === "receivable"
          ? "Urgovat po splatnosti"
          : "Naplánovat závazek po splatnosti",
      detail: item.reason,
      due_date: item.due_date,
      amount: item.remaining_amount,
      currency: item.currency,
      kind: item.kind
    });
  }

  for (const draft of input.draftDocuments ?? []) {
    tasks.push({
      id: `draft:${draft.kind}:${draft.id}`,
      category: "draft_followup",
      severity: "low",
      title: draft.code ? `Dokončit rozpracovaný doklad ${draft.code}` : "Dokončit rozpracovaný doklad",
      detail: "Doklad má uložený draft a pravděpodobně čeká na validaci nebo zaúčtování.",
      kind: draft.kind
    });
  }

  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  return tasks
    .sort((left, right) => {
      const bySeverity = severityRank[left.severity] - severityRank[right.severity];
      if (bySeverity !== 0) {
        return bySeverity;
      }
      return toNumberValue(right.amount) - toNumberValue(left.amount);
    })
    .slice(0, input.limit ?? 20);
}

export function explainDocumentIssues(record: UnknownRecord, kind: string, asOfDate: string): DocumentIssueSummary[] {
  const issues: DocumentIssueSummary[] = [];
  const partnerName = normalizePartnerName(record);
  const dueDate = normalizeDate(pickPath(record, ["datSplat"]));
  const issueDate = normalizeDate(pickPath(record, ["datVyst"]));
  const remaining = toNumberValue(getPathValue(record, "zbyvaUhradit"));
  const paymentStatus = normalizePaymentStatus(record)?.toLowerCase() ?? "";
  const paidDate = normalizeDate(pickPath(record, ["datUhr"]));
  const variableSymbol = pickPath(record, ["varSym"]);
  const lockLabel = pickPath(record, ["zamekK@showAs", "zamekK"]);
  const accounted = toStringValue(getPathValue(record, "zuctovano"));

  if (!partnerName && kind !== "internal") {
    issues.push({
      code: "missing_partner",
      severity: "high",
      message: "Doklad nemá navázaného partnera nebo není partner v datech čitelný."
    });
  }

  if (!dueDate && ["sales_invoice", "purchase_invoice", "receivable", "payable"].includes(kind)) {
    issues.push({
      code: "missing_due_date",
      severity: "medium",
      message: "Doklad nemá datum splatnosti."
    });
  }

  if (!variableSymbol && ["sales_invoice", "purchase_invoice", "receivable", "payable", "bank"].includes(kind)) {
    issues.push({
      code: "missing_variable_symbol",
      severity: "medium",
      message: "Chybí variabilní symbol, což zhoršuje párování úhrad."
    });
  }

  if (paidDate && remaining > 0.009) {
    issues.push({
      code: "paid_date_with_balance",
      severity: "high",
      message: "Doklad má datum úhrady, ale pořád má nenulový zůstatek."
    });
  }

  if (remaining > 0.009 && dueDate && !isActiveOn(dueDate, asOfDate)) {
    issues.push({
      code: "overdue_unpaid",
      severity: "high",
      message: "Doklad je po splatnosti a stále není plně uhrazený."
    });
  }

  if (remaining <= 0.009 && paymentStatus.includes("neuhra")) {
    issues.push({
      code: "stale_payment_status",
      severity: "medium",
      message: "Zůstatek je nulový, ale stav úhrady stále vypadá jako neuhrazený."
    });
  }

  if (lockLabel?.toLowerCase().includes("otev")) {
    issues.push({
      code: "still_open",
      severity: "low",
      message: "Doklad zůstává otevřený a může ještě čekat na uzamčení nebo finalizaci."
    });
  }

  if (accounted === "false") {
    issues.push({
      code: "not_accounted",
      severity: "medium",
      message: "Doklad není zaúčtovaný."
    });
  }

  if (!issueDate) {
    issues.push({
      code: "missing_issue_date",
      severity: "medium",
      message: "Doklad nemá datum vystavení."
    });
  }

  return issues;
}

export function compactEmployeeLookupMatches(result: EmployeeLookupResult): EmployeeSummary[] | undefined {
  return result.matches?.slice(0, 10);
}

export function sliceRecordList<T>(records: T[], limit: number): { records: T[]; hasMore: boolean } {
  return {
    records: records.slice(0, limit),
    hasMore: records.length > limit
  };
}

export function filterRecordsByDateRange(
  records: UnknownRecord[],
  field: string,
  dateFrom?: string,
  dateTo?: string
): UnknownRecord[] {
  const fromTimestamp = parseDateValue(dateFrom);
  const toTimestamp = parseDateValue(dateTo);

  return records.filter((record) => {
    const currentTimestamp = parseDateValue(normalizeDate(pickPath(record, [field])));
    if (currentTimestamp === null) {
      return false;
    }
    if (fromTimestamp !== null && currentTimestamp < fromTimestamp) {
      return false;
    }
    if (toTimestamp !== null && currentTimestamp > toTimestamp) {
      return false;
    }
    return true;
  });
}

export function filterRecordsByEmployeeSelector(
  records: UnknownRecord[],
  options: {
    personal_number?: string;
    query?: string;
  }
): UnknownRecord[] {
  const normalizedQuery = options.query?.trim().toLowerCase();
  const normalizedPersonalNumber = options.personal_number?.trim();
  if (!normalizedQuery && !normalizedPersonalNumber) {
    return records;
  }

  return records.filter((record) => {
    const name = normalizeEmployeeName(pickPath(record, ["jmeno", "osoba@showAs"]))?.toLowerCase();
    const personalNumber = pickPath(record, ["osbCis", "osb_cis"]);
    const relationLabel = toStringValue(getPathValue(record, "osoba@showAs"))?.toLowerCase();
    if (normalizedPersonalNumber && personalNumber === normalizedPersonalNumber) {
      return true;
    }
    if (normalizedPersonalNumber && relationLabel?.startsWith(`${normalizedPersonalNumber}:`)) {
      return true;
    }
    if (normalizedQuery) {
      return (
        (name?.includes(normalizedQuery) ?? false) ||
        (personalNumber?.toLowerCase().includes(normalizedQuery) ?? false) ||
        (relationLabel?.includes(normalizedQuery) ?? false)
      );
    }
    return false;
  });
}
