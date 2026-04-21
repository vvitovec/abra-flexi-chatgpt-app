import { extractCompanies } from "./flexi-response.js";

type UnknownRecord = Record<string, unknown>;

export interface CompanySummary {
  db_name: string;
  name: string;
  state?: string;
  visible?: boolean;
  watching_changes?: boolean;
  created_at?: string;
}

export interface EvidenceSummary {
  path: string;
  name: string;
  import_mode: string;
  type?: string;
  supports_external_id: boolean;
  code_lookup_fields?: string[];
}

export interface EvidenceFieldSummary {
  name: string;
  label: string;
  kind: string;
  summary: boolean;
  writable: boolean;
  required: boolean;
  relation_evidence?: string;
}

export interface EvidenceRelationSummary {
  name: string;
  evidence?: string;
  label?: string;
}

export interface RecordSummary {
  id: string;
  code?: string;
  name?: string;
  display_name: string;
  status?: string;
  issue_date?: string;
  due_date?: string;
  valid_from?: string;
  valid_to?: string;
  partner_name?: string;
  person_name?: string;
  total_amount?: string;
  currency?: string;
  last_updated?: string;
  external_id?: string;
  key_fields?: Record<string, string | boolean>;
}

export interface PartnerSummary {
  id: string;
  code?: string;
  name: string;
  company_id?: string;
  vat_id?: string;
  city?: string;
  country?: string;
  last_updated?: string;
  role?: string;
}

export interface ProductSummary {
  id: string;
  code?: string;
  name: string;
  unit?: string;
  price?: string;
  vat_rate?: string;
  active?: boolean;
  last_updated?: string;
}

export interface DocumentSummary {
  id: string;
  code?: string;
  name?: string;
  display_name: string;
  kind: string;
  partner_name?: string;
  issue_date?: string;
  due_date?: string;
  tax_date?: string;
  total_amount?: string;
  remaining_amount?: string;
  currency?: string;
  payment_status?: string;
  document_status?: string;
  variable_symbol?: string;
  last_updated?: string;
}

export interface ReferenceValueSummary {
  id: string;
  code?: string;
  name: string;
  value?: string;
  last_updated?: string;
}

export interface OverdueItemSummary {
  document_code?: string;
  document_kind?: string;
  partner_name?: string;
  due_date?: string;
  overdue_days?: string;
  remaining_amount?: string;
  currency?: string;
  variable_symbol?: string;
  status?: string;
}

export interface PartnerBalanceSummary {
  partner_id?: string;
  partner_name?: string;
  date?: string;
  receivable_balance?: string;
  payable_balance?: string;
  net_balance?: string;
  currency?: string;
  open_items_count?: string;
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

function toBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  return undefined;
}

function compactRecord<T extends UnknownRecord>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === undefined || value === null) {
        return false;
      }
      if (typeof value === "string") {
        return value.trim() !== "";
      }
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (typeof value === "object") {
        return Object.keys(value as UnknownRecord).length > 0;
      }
      return true;
    })
  ) as T;
}

function toFriendlyFieldName(name: string): string {
  const aliases: Record<string, string> = {
    kod: "code",
    nazev: "name",
    lastUpdate: "last_updated",
    platiOd: "valid_from",
    platiDo: "valid_to",
    datVyst: "issue_date",
    datSplat: "due_date",
    datUcto: "accounting_date",
    datZdan: "tax_date",
    datSazbyDph: "tax_date",
    firma: "partner_name",
    osoba: "person_name",
    mena: "currency",
    sumCelkem: "total_amount",
    sumCelkemMen: "total_amount_foreign",
    stavUzivK: "status",
    stavEnum: "status",
    stitky: "tags",
    poznam: "note",
    prijmeni: "last_name",
    jmeno: "first_name"
  };

  if (aliases[name]) {
    return aliases[name];
  }

  return name
    .replace(/@showAs$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function getNestedRecord(data: unknown, key: string): UnknownRecord | null {
  const root = toRecord(data);
  if (!root) {
    return null;
  }
  return toRecord(root[key]);
}

function getWinstromRoot(data: unknown): UnknownRecord | null {
  const root = toRecord(data);
  if (!root) {
    return null;
  }
  return toRecord(root.winstrom) ?? root;
}

function getRecordList(data: unknown, evidence: string): UnknownRecord[] {
  const root = getWinstromRoot(data);
  if (!root) {
    return [];
  }

  return asArray(root[evidence])
    .map((item) => toRecord(item))
    .filter((item): item is UnknownRecord => item !== null);
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

function pickFirst(record: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = toStringValue(record[key]);
    if (direct) {
      return direct;
    }
    const relation = toStringValue(record[`${key}@showAs`]);
    if (relation) {
      return relation;
    }
  }
  return undefined;
}

function getExternalId(record: UnknownRecord): string | undefined {
  const externalIds = asArray(record["external-ids"])
    .map((item) => toStringValue(item))
    .filter((item): item is string => Boolean(item));
  return externalIds[0];
}

function buildDisplayName(parts: Array<string | undefined>): string {
  const values = parts.filter((part): part is string => Boolean(part));
  if (values.length === 0) {
    return "Record";
  }
  if (values.length === 1) {
    return values[0];
  }
  return `${values[0]}: ${values[1]}`;
}

function resolvePrimaryName(record: UnknownRecord): string | undefined {
  const explicitName = pickFirst(record, ["nazev", "firma"]);
  if (explicitName) {
    return explicitName;
  }

  const firstName = toStringValue(record.jmeno);
  const lastName = toStringValue(record.prijmeni);
  if (firstName && lastName) {
    return `${lastName} ${firstName}`;
  }

  return firstName ?? lastName;
}

function collectScalarFields(record: UnknownRecord, includeRelationLabels: boolean): Record<string, string | boolean> {
  const fields: Record<string, string | boolean> = {};

  for (const [key, rawValue] of Object.entries(record)) {
    if (key.includes("@") || key === "id" || key === "kod" || key === "nazev" || key === "lastUpdate" || key === "external-ids") {
      continue;
    }

    if (Array.isArray(rawValue) || (rawValue && typeof rawValue === "object")) {
      continue;
    }

    const relationLabel = includeRelationLabels ? toStringValue(record[`${key}@showAs`]) : undefined;
    const textValue = relationLabel ?? toStringValue(rawValue);
    const booleanValue = relationLabel ? undefined : toBooleanValue(rawValue);
    const finalValue = booleanValue ?? textValue;

    if (finalValue === undefined) {
      continue;
    }

    fields[toFriendlyFieldName(key)] = finalValue;
  }

  return fields;
}

function collectRelationFields(record: UnknownRecord): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(record)) {
    if (!key.endsWith("@showAs")) {
      continue;
    }
    const baseKey = key.slice(0, -7);
    const label = toStringValue(rawValue);
    if (!label) {
      continue;
    }
    fields[toFriendlyFieldName(baseKey)] = label;
  }

  return fields;
}

function collectCollectionFields(record: UnknownRecord): Record<string, unknown[]> {
  const collections: Record<string, unknown[]> = {};

  for (const [key, rawValue] of Object.entries(record)) {
    if (Array.isArray(rawValue) && rawValue.length > 0) {
      collections[toFriendlyFieldName(key)] = rawValue;
      continue;
    }

    const nested = toRecord(rawValue);
    if (!nested) {
      continue;
    }

    for (const [nestedKey, nestedValue] of Object.entries(nested)) {
      if (Array.isArray(nestedValue) && nestedValue.length > 0) {
        collections[toFriendlyFieldName(nestedKey)] = nestedValue;
      }
    }
  }

  return collections;
}

function extractCollectionEntries(record: UnknownRecord, collectionKey: string, singularKey: string): UnknownRecord[] {
  const direct = record[collectionKey];
  if (Array.isArray(direct)) {
    return direct.map((item) => toRecord(item)).filter((item): item is UnknownRecord => item !== null);
  }

  const nested = toRecord(direct);
  if (!nested) {
    return [];
  }

  return asArray(nested[singularKey])
    .map((item) => toRecord(item))
    .filter((item): item is UnknownRecord => item !== null);
}

function normalizeReportDocumentKind(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (
    normalized.includes("fav") ||
    normalized.includes("phl") ||
    normalized.includes("vyd") ||
    normalized.includes("pohl") ||
    normalized.includes("receiv")
  ) {
    return "receivable";
  }
  if (
    normalized.includes("fap") ||
    normalized.includes("zav") ||
    normalized.includes("prij") ||
    normalized.includes("payab")
  ) {
    return "payable";
  }
  return undefined;
}

export function extractRecordList(data: unknown, evidence: string): Array<Record<string, unknown>> {
  return getRecordList(data, evidence);
}

export function mapCompaniesToSummary(data: unknown): CompanySummary[] {
  return extractCompanies(data)
    .map((company) =>
      compactRecord({
        db_name: company.dbNazev ?? company.nazev ?? String(company.id ?? ""),
        name: company.nazev ?? company.dbNazev ?? String(company.id ?? ""),
        state: company.stavEnum ?? undefined,
        visible: company.show ?? undefined,
        watching_changes: company.watchingChanges ?? undefined,
        created_at: company.createDt ?? undefined
      })
    )
    .filter((company) => Boolean(company.db_name));
}

export function extractEvidenceList(data: unknown): EvidenceSummary[] {
  const evidencesRoot = getNestedRecord(data, "evidences");
  const evidences = asArray(evidencesRoot?.evidence)
    .map((item) => toRecord(item))
    .filter((item): item is UnknownRecord => item !== null);

  return evidences
    .map((evidence) => {
      const findByCodeProperties = toStringValue(evidence.findByCodeProperties)
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      return compactRecord({
        path: toStringValue(evidence.evidencePath) ?? "",
        name: toStringValue(evidence.evidenceName) ?? toStringValue(evidence.evidencePath) ?? "Unknown evidence",
        import_mode: (toStringValue(evidence.importStatus) ?? "unknown").toLowerCase(),
        type: toStringValue(evidence.evidenceType) ?? undefined,
        supports_external_id: toBooleanValue(evidence.extIdSupported) ?? false,
        code_lookup_fields: findByCodeProperties && findByCodeProperties.length > 0 ? findByCodeProperties : undefined
      });
    })
    .filter((evidence) => Boolean(evidence.path));
}

export function extractEvidenceProperties(data: unknown): EvidenceFieldSummary[] {
  const propertiesRoot = getNestedRecord(data, "properties") ?? toRecord(data);
  const properties = asArray(propertiesRoot?.property)
    .map((item) => toRecord(item))
    .filter((item): item is UnknownRecord => item !== null);

  return properties
    .map((property) =>
      compactRecord({
        name: toFriendlyFieldName(toStringValue(property.propertyName) ?? ""),
        label: toStringValue(property.title) ?? toStringValue(property.name) ?? toStringValue(property.propertyName) ?? "Unnamed field",
        kind: toStringValue(property.type) ?? "unknown",
        summary: toBooleanValue(property.inSummary) ?? false,
        writable: toBooleanValue(property.isWritable) ?? false,
        required: toBooleanValue(property.mandatory) ?? false,
        relation_evidence: toStringValue(property.fkEvidencePath) ?? undefined
      })
    )
    .filter((property) => Boolean(property.name));
}

export function extractEvidenceRelations(data: unknown): EvidenceRelationSummary[] {
  const relationsRoot = getNestedRecord(data, "relations") ?? toRecord(data);
  const relations = asArray(relationsRoot?.relation)
    .map((item) => toRecord(item))
    .filter((item): item is UnknownRecord => item !== null);

  return relations.map((relation) =>
    compactRecord({
      name: toFriendlyFieldName(toStringValue(relation.url) ?? toStringValue(relation.name) ?? "relation"),
      evidence: toStringValue(relation.url) ?? undefined,
      label: toStringValue(relation.name) ?? undefined
    })
  );
}

export function mapRecordToSummary(record: UnknownRecord, includeKeyFields = false): RecordSummary {
  const code = pickFirst(record, ["kod", "cislo", "cisloDokladu", "osbCis"]);
  const name = resolvePrimaryName(record);
  const summary = compactRecord({
    id: toStringValue(record.id) ?? code ?? name ?? "unknown",
    code,
    name,
    display_name: buildDisplayName([code, name, toStringValue(record.id)]),
    status: pickFirst(record, ["stavUzivK", "stavEnum", "stitky"]),
    issue_date: pickFirst(record, ["datVyst"]),
    due_date: pickFirst(record, ["datSplat"]),
    valid_from: pickFirst(record, ["platiOd"]),
    valid_to: pickFirst(record, ["platiDo"]),
    partner_name: pickFirst(record, ["firma"]),
    person_name: pickFirst(record, ["osoba"]),
    total_amount: pickFirst(record, ["sumCelkem", "sumCelkemMen", "celkem"]),
    currency: pickFirst(record, ["mena"]),
    last_updated: pickFirst(record, ["lastUpdate"]),
    external_id: getExternalId(record)
  });

  if (!includeKeyFields) {
    return summary;
  }

  const keyFields = collectScalarFields(record, true);
  if (Object.keys(keyFields).length === 0) {
    return summary;
  }

  return compactRecord({
    ...summary,
    key_fields: Object.fromEntries(Object.entries(keyFields).slice(0, 8))
  });
}

export function mapSearchResults(data: unknown, evidence: string, limit: number, offset: number): {
  evidence: string;
  limit: number;
  offset: number;
  returned: number;
  has_more: boolean;
  records: RecordSummary[];
} {
  const rawRecords = getRecordList(data, evidence);
  const hasMore = rawRecords.length > limit;
  const visibleRecords = rawRecords.slice(0, limit).map((record) => mapRecordToSummary(record));

  return {
    evidence,
    limit,
    offset,
    returned: visibleRecords.length,
    has_more: hasMore,
    records: visibleRecords
  };
}

export function mapRecordSummary(data: unknown, evidence: string): RecordSummary | null {
  const record = getRecordList(data, evidence)[0];
  return record ? mapRecordToSummary(record, true) : null;
}

export function mapRecordDetail(
  data: unknown,
  evidence: string,
  options: {
    include_relations: boolean;
    include_collections: boolean;
  }
): Record<string, unknown> | null {
  const record = getRecordList(data, evidence)[0];
  if (!record) {
    return null;
  }

  const summary = mapRecordToSummary(record, true);
  const detail: Record<string, unknown> = {
    ...summary,
    fields: collectScalarFields(record, false)
  };

  if (options.include_relations) {
    detail.relations = collectRelationFields(record);
  }
  if (options.include_collections) {
    detail.collections = collectCollectionFields(record);
  }

  return compactRecord(detail);
}

export function extractWriteStats(data: unknown): Record<string, number> {
  const root = getWinstromRoot(data);
  const stats = toRecord(root?.stats);
  const counters: Record<string, number> = {};

  for (const key of ["created", "updated", "deleted", "skipped", "failed"]) {
    const text = toStringValue(stats?.[key]);
    if (!text) {
      continue;
    }
    const value = Number(text);
    if (!Number.isNaN(value)) {
      counters[key] = value;
    }
  }

  return counters;
}

export function extractWriteRecord(data: unknown, evidence: string): RecordSummary | null {
  const root = getWinstromRoot(data);
  const results = asArray(root?.results)
    .map((item) => toRecord(item))
    .filter((item): item is UnknownRecord => item !== null);

  for (const result of results) {
    const content = toRecord(result.content);
    const record = asArray(content?.[evidence])
      .map((item) => toRecord(item))
      .find((item): item is UnknownRecord => item !== null);
    if (record) {
      return mapRecordToSummary(record, true);
    }
  }

  return null;
}

export function mapPartnerSearchResults(
  data: unknown,
  evidence: string,
  limit: number,
  offset: number,
  role: string
): {
  evidence: string;
  limit: number;
  offset: number;
  returned: number;
  has_more: boolean;
  records: PartnerSummary[];
} {
  const rawRecords = getRecordList(data, evidence);
  const hasMore = rawRecords.length > limit;
  const records = rawRecords.slice(0, limit).map((record) =>
    compactRecord({
      id: pickPath(record, ["id"]) ?? "unknown",
      code: pickPath(record, ["kod", "osbCis"]),
      name: pickPath(record, ["nazev", "firma", "prijmeni", "jmeno"]) ?? "Unknown partner",
      company_id: pickPath(record, ["ic", "ico", "oic"]),
      vat_id: pickPath(record, ["dic"]),
      city: pickPath(record, ["mesto"]),
      country: pickPath(record, ["stat.kod", "stat", "stat@showAs"]),
      last_updated: pickPath(record, ["lastUpdate"]),
      role
    })
  );

  return {
    evidence,
    limit,
    offset,
    returned: records.length,
    has_more: hasMore,
    records
  };
}

export function mapPartnerSummary(data: unknown, evidence: string, role?: string): PartnerSummary | null {
  const record = getRecordList(data, evidence)[0];
  if (!record) {
    return null;
  }

  return compactRecord({
    id: pickPath(record, ["id"]) ?? "unknown",
    code: pickPath(record, ["kod", "osbCis"]),
    name: pickPath(record, ["nazev", "firma", "prijmeni", "jmeno", "osoba@showAs"]) ?? "Unknown partner",
    company_id: pickPath(record, ["ic", "ico", "oic"]),
    vat_id: pickPath(record, ["dic"]),
    city: pickPath(record, ["mesto"]),
    country: pickPath(record, ["stat@showAs", "stat.kod", "stat"]),
    last_updated: pickPath(record, ["lastUpdate"]),
    role
  });
}

export function mapProductSearchResults(
  data: unknown,
  evidence: string,
  limit: number,
  offset: number
): {
  evidence: string;
  limit: number;
  offset: number;
  returned: number;
  has_more: boolean;
  records: ProductSummary[];
} {
  const rawRecords = getRecordList(data, evidence);
  const hasMore = rawRecords.length > limit;
  const records = rawRecords.slice(0, limit).map((record) =>
    compactRecord({
      id: pickPath(record, ["id"]) ?? "unknown",
      code: pickPath(record, ["kod"]),
      name: pickPath(record, ["nazev"]) ?? "Unknown product",
      unit: pickPath(record, ["mj1", "mj"]),
      price: pickPath(record, ["cenaZakl", "prodejCena", "cenaMj"]),
      vat_rate: pickPath(record, ["typSzbDphK@showAs", "typSzbDphK", "szbDph"]),
      active: pickPath(record, ["stavK"]) ? pickPath(record, ["stavK"]) !== "stavCeniku.neaktivni" : undefined,
      last_updated: pickPath(record, ["lastUpdate"])
    })
  );

  return {
    evidence,
    limit,
    offset,
    returned: records.length,
    has_more: hasMore,
    records
  };
}

export function mapProductSummary(data: unknown, evidence: string): ProductSummary | null {
  const record = getRecordList(data, evidence)[0];
  if (!record) {
    return null;
  }

  return compactRecord({
    id: pickPath(record, ["id"]) ?? "unknown",
    code: pickPath(record, ["kod"]),
    name: pickPath(record, ["nazev"]) ?? "Unknown product",
    unit: pickPath(record, ["mj1", "mj"]),
    price: pickPath(record, ["cenaZakl", "prodejCena", "cenaMj"]),
    vat_rate: pickPath(record, ["typSzbDphK@showAs", "typSzbDphK", "szbDph"]),
    active: pickPath(record, ["stavK"]) ? pickPath(record, ["stavK"]) !== "stavCeniku.neaktivni" : undefined,
    last_updated: pickPath(record, ["lastUpdate"])
  });
}

export function mapDocumentSearchResults(
  data: unknown,
  evidence: string,
  kind: string,
  limit: number,
  offset: number
): {
  evidence: string;
  kind: string;
  limit: number;
  offset: number;
  returned: number;
  has_more: boolean;
  records: DocumentSummary[];
} {
  const rawRecords = getRecordList(data, evidence);
  const hasMore = rawRecords.length > limit;
  const records = rawRecords.slice(0, limit).map((record) =>
    compactRecord({
      id: pickPath(record, ["id"]) ?? "unknown",
      code: pickPath(record, ["kod"]),
      name: pickPath(record, ["nazev"]),
      display_name: buildDisplayName([pickPath(record, ["kod"]), pickPath(record, ["nazev", "nazFirmy"]), pickPath(record, ["id"])]),
      kind,
      partner_name: pickPath(record, ["nazFirmy", "firma@showAs", "firma"]),
      issue_date: pickPath(record, ["datVyst"]),
      due_date: pickPath(record, ["datSplat"]),
      tax_date: pickPath(record, ["datZdan", "datSazbyDph"]),
      total_amount: pickPath(record, ["sumCelkem", "sumCelkemMen", "celkem"]),
      remaining_amount: pickPath(record, ["zbyvaUhradit"]),
      currency: pickPath(record, ["mena.kod", "mena", "mena@showAs"]),
      payment_status: pickPath(record, ["stavUhrK@showAs", "stavUhrK"]),
      document_status: pickPath(record, ["stavUzivK@showAs", "stavUzivK"]),
      variable_symbol: pickPath(record, ["varSym"]),
      last_updated: pickPath(record, ["lastUpdate"])
    })
  );

  return {
    evidence,
    kind,
    limit,
    offset,
    returned: records.length,
    has_more: hasMore,
    records
  };
}

export function mapDocumentSummary(data: unknown, evidence: string, kind: string): DocumentSummary | null {
  const record = getRecordList(data, evidence)[0];
  if (!record) {
    return null;
  }

  return compactRecord({
    id: pickPath(record, ["id"]) ?? "unknown",
    code: pickPath(record, ["kod"]),
    name: pickPath(record, ["nazev"]),
    display_name: buildDisplayName([pickPath(record, ["kod"]), pickPath(record, ["nazev", "nazFirmy", "firma@showAs"]), pickPath(record, ["id"])]),
    kind,
    partner_name: pickPath(record, ["nazFirmy", "firma@showAs", "firma"]),
    issue_date: pickPath(record, ["datVyst"]),
    due_date: pickPath(record, ["datSplat"]),
    tax_date: pickPath(record, ["datZdan", "datSazbyDph"]),
    total_amount: pickPath(record, ["sumCelkem", "sumCelkemMen", "celkem"]),
    remaining_amount: pickPath(record, ["zbyvaUhradit"]),
    currency: pickPath(record, ["mena.kod", "mena@showAs", "mena"]),
    payment_status: pickPath(record, ["stavUhrK@showAs", "stavUhrK"]),
    document_status: pickPath(record, ["stavUzivK@showAs", "stavUzivK"]),
    variable_symbol: pickPath(record, ["varSym"]),
    last_updated: pickPath(record, ["lastUpdate"])
  });
}

export function mapDocumentDetail(
  data: unknown,
  evidence: string,
  kind: string,
  options: {
    include_items: boolean;
    include_payments: boolean;
    include_accounting: boolean;
    include_links: boolean;
    item_collection_key?: string;
    item_evidence?: string;
  }
): Record<string, unknown> | null {
  const record = getRecordList(data, evidence)[0];
  if (!record) {
    return null;
  }

  const summary = mapDocumentSummary(data, evidence, kind);
  if (!summary) {
    return null;
  }

  const detail: Record<string, unknown> = {
    ...summary,
    fields: compactRecord({
      note: pickPath(record, ["poznam", "popis"]),
      center: pickPath(record, ["stredisko@showAs", "stredisko"]),
      project: pickPath(record, ["zakazka@showAs", "zakazka"]),
      activity: pickPath(record, ["cinnost@showAs", "cinnost"]),
      accounting_date: pickPath(record, ["datUcto"]),
      variable_symbol: pickPath(record, ["varSym"])
    })
  };

  if (options.include_items && options.item_collection_key && options.item_evidence) {
    const items = extractCollectionEntries(record, options.item_collection_key, options.item_evidence).map((item) =>
      compactRecord({
        id: pickPath(item, ["id"]),
        code: pickPath(item, ["kod"]),
        text: pickPath(item, ["text", "nazev"]),
        product: pickPath(item, ["cenik@showAs", "cenik"]),
        quantity: pickPath(item, ["mnozMj"]),
        unit_price: pickPath(item, ["cenaMj"]),
        total_amount: pickPath(item, ["sumCelkem", "sumZkl"]),
        vat_code: pickPath(item, ["typSzbDphK@showAs", "typSzbDphK"])
      })
    );
    if (items.length > 0) {
      detail.items = items;
    }
  }

  if (options.include_payments) {
    const paymentCandidates = [
      ...extractCollectionEntries(record, "uhrady", "uhrada"),
      ...extractCollectionEntries(record, "platby", "platba")
    ].map((payment) =>
      compactRecord({
        id: pickPath(payment, ["id"]),
        code: pickPath(payment, ["kod"]),
        amount: pickPath(payment, ["castka", "sumCelkem"]),
        date: pickPath(payment, ["datVyst", "datUcto", "datPlatby"]),
        note: pickPath(payment, ["poznam", "nazev"])
      })
    );
    if (paymentCandidates.length > 0) {
      detail.payments = paymentCandidates;
    }
  }

  if (options.include_accounting) {
    detail.accounting = compactRecord({
      center: pickPath(record, ["stredisko@showAs", "stredisko"]),
      project: pickPath(record, ["zakazka@showAs", "zakazka"]),
      activity: pickPath(record, ["cinnost@showAs", "cinnost"]),
      accounting_date: pickPath(record, ["datUcto"]),
      tax_date: pickPath(record, ["datZdan", "datSazbyDph"])
    });
  }

  if (options.include_links) {
    const links = collectRelationFields(record);
    if (Object.keys(links).length > 0) {
      detail.links = links;
    }
  }

  return compactRecord(detail);
}

export function mapReferenceValueResults(
  data: unknown,
  evidence: string,
  limit: number,
  offset: number
): {
  evidence: string;
  limit: number;
  offset: number;
  returned: number;
  has_more: boolean;
  records: ReferenceValueSummary[];
} {
  const rawRecords = getRecordList(data, evidence);
  const hasMore = rawRecords.length > limit;
  const records = rawRecords.slice(0, limit).map((record) =>
    compactRecord({
      id: pickPath(record, ["id"]) ?? "unknown",
      code: pickPath(record, ["kod"]),
      name: pickPath(record, ["nazev"]) ?? pickPath(record, ["kod"]) ?? "Unknown value",
      value: pickPath(record, ["buc", "iban", "nazev"]),
      last_updated: pickPath(record, ["lastUpdate"])
    })
  );

  return {
    evidence,
    limit,
    offset,
    returned: records.length,
    has_more: hasMore,
    records
  };
}

export function aggregateDocumentOverview(records: DocumentSummary[]): {
  count: number;
  total_amount: string;
  remaining_amount: string;
} {
  const total = records.reduce((sum, record) => sum + Number(record.total_amount ?? 0), 0);
  const remaining = records.reduce((sum, record) => sum + Number(record.remaining_amount ?? record.total_amount ?? 0), 0);
  return {
    count: records.length,
    total_amount: total.toFixed(2),
    remaining_amount: remaining.toFixed(2)
  };
}

export function mapOverdueReportResults(
  records: Array<Record<string, unknown>>,
  limit: number,
  offset: number,
  options: {
    partner_name_fields: string[];
    document_code_fields: string[];
    document_kind_fields: string[];
    due_date_fields: string[];
    remaining_amount_fields: string[];
    overdue_days_fields: string[];
    variable_symbol_fields: string[];
    currency_fields: string[];
    status_fields: string[];
  }
): {
  limit: number;
  offset: number;
  returned: number;
  has_more: boolean;
  records: OverdueItemSummary[];
} {
  const hasMore = records.length > limit;
  const visible = records.slice(0, limit).map((record) =>
    compactRecord({
      document_code: pickPath(record, options.document_code_fields),
      document_kind: normalizeReportDocumentKind(pickPath(record, options.document_kind_fields)),
      partner_name: pickPath(record, options.partner_name_fields),
      due_date: pickPath(record, options.due_date_fields),
      overdue_days: pickPath(record, options.overdue_days_fields),
      remaining_amount: pickPath(record, options.remaining_amount_fields),
      currency: pickPath(record, options.currency_fields),
      variable_symbol: pickPath(record, options.variable_symbol_fields),
      status: pickPath(record, options.status_fields)
    })
  );

  return {
    limit,
    offset,
    returned: visible.length,
    has_more: hasMore,
    records: visible
  };
}

export function mapPartnerBalanceSummary(
  records: Array<Record<string, unknown>>,
  options: {
    partner_id: string;
    date: string;
    partner_id_fields: string[];
    partner_name_fields: string[];
    date_fields: string[];
    receivable_balance_fields: string[];
    payable_balance_fields: string[];
    net_balance_fields: string[];
    currency_fields: string[];
    open_items_count_fields: string[];
  }
): PartnerBalanceSummary | null {
  const normalizedPartnerId = options.partner_id.toLowerCase();
  const record =
    records.find((item) => pickPath(item, options.partner_id_fields)?.toLowerCase() === normalizedPartnerId) ??
    records.find((item) => {
      const value = pickPath(item, options.partner_name_fields)?.toLowerCase();
      return value ? value.includes(normalizedPartnerId) : false;
    }) ??
    records[0];

  if (!record) {
    return null;
  }

  return compactRecord({
    partner_id: pickPath(record, options.partner_id_fields) ?? options.partner_id,
    partner_name: pickPath(record, options.partner_name_fields),
    date: pickPath(record, options.date_fields) ?? options.date,
    receivable_balance: pickPath(record, options.receivable_balance_fields),
    payable_balance: pickPath(record, options.payable_balance_fields),
    net_balance: pickPath(record, options.net_balance_fields),
    currency: pickPath(record, options.currency_fields),
    open_items_count: pickPath(record, options.open_items_count_fields)
  });
}
