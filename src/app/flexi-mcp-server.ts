import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildCreateDocumentPayload,
  buildAssetsLiabilitiesPdfRequest,
  buildBalanceSheetPdfRequest,
  buildDocumentHeaderUpdatePayload,
  buildDocumentItemsUpdatePayload,
  buildDocumentSearchFilter,
  buildPostDocumentPayload,
  buildReportSelector,
  buildTextSearchFilter,
  combineFilters,
  getDocumentKindConfig,
  getPartnerSearchSpec,
  getProductSearchSpec,
  getReportEvidenceConfig,
  getReferenceValueConfig,
  getSaldoModules,
  toIsoDate,
  type CreateDocumentDraftInput,
  type DocumentItemInput,
  type DocumentKind,
  type OverdueScope,
  type PartnerRole,
  type ReferenceValueKind
} from "../accounting.js";
import {
  buildCashflowSnapshot,
  buildCompanyTasks,
  buildVatSummary,
  compactEmployeeLookupMatches,
  detectPaymentMismatches,
  explainDocumentIssues,
  filterRecordsByDateRange,
  filterRecordsByEmployeeSelector,
  mapEmployeeDocumentHits,
  resolveEmployeeLookup,
  summarizeEmployees
} from "../accountant-workflows.js";
import { ensureEvidencePermission, hasEvidencePermission } from "../access.js";
import { AuditStore } from "../audit.js";
import { TtlCache } from "../cache.js";
import { FlexiClient } from "../client.js";
import { normalizeFlexiResponse } from "../flexi-response.js";
import {
  aggregateDocumentOverview,
  type CompanySummary,
  extractEvidenceList,
  extractEvidenceProperties,
  extractEvidenceRelations,
  extractRecordList,
  extractWriteRecord,
  extractWriteStats,
  mapCompaniesToSummary,
  mapDocumentDetail,
  mapDocumentSearchResults,
  mapDocumentSummary,
  mapOverdueReportResults,
  mapPartnerBalanceSummary,
  mapPartnerSearchResults,
  mapPartnerSummary,
  mapProductSearchResults,
  mapProductSummary,
  mapReferenceValueResults,
  mapRecordDetail,
  mapRecordSummary,
  mapSearchResults
} from "../flexi-dto.js";
import type { FlexiFormat, NormalizedFlexiResponse, ResolvedProfile } from "../types.js";
import { defaultEvidencePermissions } from "./default-permissions.js";
import { decryptJson, randomId, sha256Text } from "./crypto.js";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import type { AppAuthInfo, ConnectionContext, OrganizationRole, WriteConfirmation } from "./types.js";

const connectionArgsSchema = {
  connection_alias: z.string().trim().min(1).optional(),
  company_slug: z.string().trim().min(1).optional()
};

const evidenceArgsSchema = {
  ...connectionArgsSchema,
  evidence: z.string().trim().min(1)
};

function compactRecord<T extends Record<string, unknown>>(record: T): T {
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
        return Object.keys(value as Record<string, unknown>).length > 0;
      }
      return true;
    })
  ) as T;
}

function detectPayloadFormat(payloadFormat: FlexiFormat | undefined, payload: string): FlexiFormat {
  if (payloadFormat) {
    return payloadFormat;
  }
  return payload.trim().startsWith("<") ? "xml" : "json";
}

function summarizeIssues(response: NormalizedFlexiResponse, fallback: string): string {
  const issues = [...response.errors, ...response.warnings];
  return issues.length > 0 ? issues.join("; ") : fallback;
}

function summarizeBinaryIssues(
  httpStatus: number,
  contentType: string | null,
  buffer: Buffer,
  fallback: string
): string {
  const text = buffer.toString("utf8");
  if (contentType?.includes("text/plain")) {
    const trimmedText = text.trim();
    if (trimmedText) {
      return trimmedText;
    }
  }
  const trimmed = text.trimStart();
  const format: FlexiFormat = contentType?.includes("xml") || trimmed.startsWith("<") ? "xml" : "json";
  const normalized = normalizeFlexiResponse(format, httpStatus, text, { "content-type": contentType ?? "unknown" });
  const issues = [...normalized.errors, ...normalized.warnings, ...normalized.messages].filter(Boolean);
  return issues[0] ?? fallback;
}

function limitedIssues(values: string[], limit = 5): string[] | undefined {
  const visible = values.filter(Boolean).slice(0, limit);
  return visible.length > 0 ? visible : undefined;
}

function createResult(text: string, structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent
  };
}

function annotationsFor(mode: "read" | "write") {
  return mode === "read"
    ? {
        readOnlyHint: true,
        openWorldHint: true,
        idempotentHint: true
      }
    : {
        destructiveHint: true,
        openWorldHint: true
      };
}

function normalizeCompanySlug(value?: string): string {
  return value?.trim() ?? "";
}

function normalizeCompanyLookupValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function resolveCompanyCandidate(companies: CompanySummary[], rawInput?: string): CompanySummary | null {
  const lookup = rawInput?.trim();
  if (!lookup) {
    return null;
  }

  const normalizedLookup = normalizeCompanyLookupValue(lookup);
  const exact = companies.find(
    (company) =>
      normalizeCompanyLookupValue(company.db_name) === normalizedLookup ||
      normalizeCompanyLookupValue(company.name) === normalizedLookup
  );
  if (exact) {
    return exact;
  }

  const partialMatches = companies.filter((company) => {
    const dbName = normalizeCompanyLookupValue(company.db_name);
    const name = normalizeCompanyLookupValue(company.name);
    return dbName.includes(normalizedLookup) || name.includes(normalizedLookup) || normalizedLookup.includes(dbName) || normalizedLookup.includes(name);
  });

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  return null;
}

export function createPublicFlexiMcpServer(db: AppDatabase, config: AppConfig): McpServer {
  const auditStore = new AuditStore(resolve(config.appDataDir, "logs"));
  const client = new FlexiClient(auditStore);
  const catalogCache = new TtlCache<ReturnType<typeof extractEvidenceList>>(10 * 60 * 1000);
  const propertiesCache = new TtlCache<ReturnType<typeof extractEvidenceProperties>>(10 * 60 * 1000);
  const relationsCache = new TtlCache<ReturnType<typeof extractEvidenceRelations>>(10 * 60 * 1000);
  const referenceCache = new Map<string, TtlCache<Record<string, unknown>[]>>();
  const reportCache = new TtlCache<Record<string, unknown>[]>(2 * 60 * 1000);

  const server = new McpServer(
    { name: "abra-flexi-chatgpt-app", version: "0.2.0" },
    { capabilities: { logging: {} } }
  );

  server.registerResource(
    "flexi-widget",
    "ui://widget/flexi-status",
    {
      title: "Flexi Widget",
      mimeType: "text/html",
      _meta: {
        ui: {
          domain: config.appDomain,
          csp: {
            connectDomains: [config.appBaseUrl],
            resourceDomains: [config.widgetResourceDomain]
          },
          widgetDescription: "Compact Flexi summary widget."
        }
      }
    },
    async () => ({
      contents: [
        {
          uri: "ui://widget/flexi-status",
          mimeType: "text/html",
          text: `<!doctype html><html><body style="font-family:system-ui;padding:16px;background:#faf7ef;color:#132;"><strong>ABRA Flexi App</strong><p>Widget is active. Use tools to fetch current data for the connected organization.</p></body></html>`
        }
      ]
    })
  );

  const getRole = (auth: AppAuthInfo): OrganizationRole => {
    const member = db.getMembership(auth.extra.userId, auth.extra.organizationId);
    if (!member) {
      throw new Error("No active organization membership found.");
    }
    return member.role;
  };

  const ensureWriteRole = (auth: AppAuthInfo): void => {
    const role = getRole(auth);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Write actions require owner or admin role.");
    }
  };

  const buildProfile = (ctx: { alias: string; base_url: string; company_slug: string; default_format: FlexiFormat; mode: "prod" | "test"; username: string; password: string; }): ResolvedProfile => ({
    name: ctx.alias,
    baseUrl: ctx.base_url,
    company: ctx.company_slug,
    mode: ctx.mode,
    writes: "confirm",
    defaultFormat: ctx.default_format,
    usernameEnv: "managed",
    passwordEnv: "managed",
    allowWriteOverrideWithoutValidation: false,
    permissions: defaultEvidencePermissions,
    username: ctx.username,
    password: ctx.password
  });

  const resolveConnectionContext = (auth: AppAuthInfo, connectionAlias?: string): ConnectionContext => {
    const connection = connectionAlias
      ? db.getConnectionByAlias(auth.extra.organizationId, connectionAlias)
      : db.getDefaultConnection(auth.extra.organizationId);

    if (!connection) {
      throw new Error(connectionAlias
        ? `Connection '${connectionAlias}' was not found.`
        : "No active Flexi connection found for this organization.");
    }

    const encryptedSecret = db.getConnectionSecret(connection.id);
    if (!encryptedSecret) {
      throw new Error(`Connection '${connection.alias}' is missing encrypted credentials.`);
    }
    const secret = decryptJson<{ username: string; password: string }>(config, JSON.parse(encryptedSecret));

    return {
      auth,
      connection,
      profile: buildProfile({
        alias: `${auth.extra.organizationId}:${connection.alias}`,
        base_url: connection.base_url,
        company_slug: connection.company_slug,
        default_format: connection.default_format,
        mode: connection.mode,
        username: secret.username,
        password: secret.password
      }),
      permissions: defaultEvidencePermissions
    };
  };

  const registerTool = (
    name: string,
    configShape: any,
    handler: (args: any, extra: any) => Promise<any>
  ): void => {
    (server.registerTool as any)(name, configShape, async (args: any, extra: any) => {
      const auth = extra.authInfo as AppAuthInfo | undefined;
      const organizationId = auth?.extra?.organizationId;
      try {
        const result = await handler(args, extra);
        if (organizationId) {
          db.logAudit({
            organization_id: organizationId,
            user_id: auth?.extra?.userId ?? null,
            connection_id: null,
            client_id: auth?.clientId ?? null,
            action: name,
            status: "ok",
            details_json: JSON.stringify({ arguments: compactRecord({ ...args, payload: undefined }) })
          });
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (organizationId) {
          db.logAudit({
            organization_id: organizationId,
            user_id: auth?.extra?.userId ?? null,
            connection_id: null,
            client_id: auth?.clientId ?? null,
            action: name,
            status: "error",
            details_json: JSON.stringify({ message, arguments: compactRecord({ ...args, payload: undefined }) })
          });
        }
        return createResult(message, { ok: false, error: message });
      }
    });
  };

  const applyRequestedCompany = (ctx: ConnectionContext, requestedCompanySlug?: string): string => {
    const selectedCompany = normalizeCompanySlug(requestedCompanySlug) || normalizeCompanySlug(ctx.connection.company_slug);
    ctx.connection.company_slug = selectedCompany;
    ctx.profile.company = selectedCompany;
    return selectedCompany;
  };

  const ensureSelectedCompany = (ctx: ConnectionContext, requestedCompanySlug?: string): string => {
    const selectedCompany = applyRequestedCompany(ctx, requestedCompanySlug);
    if (selectedCompany) {
      return selectedCompany;
    }
    throw new Error(
      `Connection '${ctx.connection.alias}' has no default company. First run 'flexi_list_accessible_companies' or 'flexi_check_connection' and retry with company_slug.`
    );
  };

  const companyScopedPayloadHash = (companySlug: string, payload: string): string =>
    sha256Text(`${companySlug}\n${payload}`);

  const buildDraftStorageId = (companySlug: string, id: string): string => `${companySlug}::${id}`;
  const reportDownloadTtlMs = 10 * 60 * 1000;

  const getCatalog = async (ctx: ConnectionContext) =>
    catalogCache.getOrSet(`${ctx.auth.extra.organizationId}:${ctx.connection.id}:${ctx.profile.company}:catalog`, async () => {
      const response = await client.request({
        operation: "list_evidence",
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        method: "GET",
        path: client.buildCompanyPath(ctx.profile, ctx.connection.company_slug, "evidence-list"),
        format: ctx.profile.defaultFormat
      });
      if (!response.ok) {
        throw new Error(summarizeIssues(response, "Failed to load evidence list."));
      }
      return extractEvidenceList(response.data);
    });

  const getAccessibleCompanies = async (ctx: ConnectionContext): Promise<CompanySummary[]> => {
    const companiesResponse = await client.request({
      operation: "list_accessible_companies",
      profile: ctx.profile,
      method: "GET",
      path: client.buildServerPath(ctx.profile.defaultFormat),
      format: ctx.profile.defaultFormat
    });
    if (!companiesResponse.ok) {
      throw new Error(summarizeIssues(companiesResponse, "Failed to list accessible companies."));
    }
    return mapCompaniesToSummary(companiesResponse.data);
  };

  const getProperties = async (ctx: ConnectionContext, evidence: string) =>
    propertiesCache.getOrSet(`${ctx.connection.id}:${ctx.profile.company}:${evidence}:properties`, async () => {
      const response = await client.request({
        operation: "describe_evidence_properties",
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        evidence,
        method: "GET",
        path: client.buildCompanyPath(ctx.profile, ctx.connection.company_slug, `${evidence}/properties`),
        format: ctx.profile.defaultFormat
      });
      if (!response.ok) {
        throw new Error(summarizeIssues(response, `Failed to load properties for '${evidence}'.`));
      }
      return extractEvidenceProperties(response.data);
    });

  const getRelations = async (ctx: ConnectionContext, evidence: string) =>
    relationsCache.getOrSet(`${ctx.connection.id}:${ctx.profile.company}:${evidence}:relations`, async () => {
      const response = await client.request({
        operation: "describe_evidence_relations",
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        evidence,
        method: "GET",
        path: client.buildCompanyPath(ctx.profile, ctx.connection.company_slug, `${evidence}/relations`),
        format: ctx.profile.defaultFormat
      });
      if (!response.ok) {
        throw new Error(summarizeIssues(response, `Failed to load relations for '${evidence}'.`));
      }
      return extractEvidenceRelations(response.data);
    });

  const buildQueryPath = (ctx: ConnectionContext, evidence: string) =>
    client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, evidence, ctx.profile.defaultFormat, undefined, "query");

  const runQuery = async ({
    ctx,
    evidence,
    fields,
    includes,
    filter,
    limit,
    offset,
    operation
  }: {
    ctx: ConnectionContext;
    evidence: string;
    fields: string[];
    includes?: string[];
    filter?: string;
    limit: number;
    offset: number;
    operation: string;
  }) => {
    const body = JSON.stringify({
      detail: `custom:${fields.join(",")}`,
      start: offset,
      limit: limit + 1,
      filter,
      includes: includes && includes.length > 0 ? includes.join(",") : undefined
    });

    return client.request({
      operation,
      profile: ctx.profile,
      company: ctx.connection.company_slug,
      evidence,
      method: "POST",
      path: buildQueryPath(ctx, evidence),
      format: ctx.profile.defaultFormat,
      body,
      contentType: "application/json"
    });
  };

  const EMPLOYEE_FIELDS = [
    "id",
    "osbCis",
    "jmeno",
    "funkce",
    "zacatek",
    "konecPomeru",
    "uvazHodTydne",
    "pracPom",
    "typPracPom"
  ];

  const EMPLOYEE_DOCUMENT_FIELDS: Record<string, string[]> = {
    "prehled-zamestnancu": EMPLOYEE_FIELDS,
    "pracovni-pomer": ["id", "osoba", "zacatek", "konecPomeru", "uvazHodTydne", "typPracPom", "pracPomHlav"],
    nepritomnost: ["id", "pracPom", "datOd", "datDo", "poznam", "stavUzivK"]
  };

  const VAT_QUERY_FIELDS = [
    "id",
    "kod",
    "nazFirmy",
    "datVyst",
    "datSplat",
    "datUhr",
    "varSym",
    "sumZklCelkem",
    "sumDphCelkem",
    "sumCelkem",
    "zbyvaUhradit",
    "formaUhradyCis",
    "stavUhrK",
    "mena(kod)"
  ];

  const CLOSE_CHECKLIST_DOCUMENT_FIELDS = [
    ...VAT_QUERY_FIELDS,
    "zamekK",
    "zuctovano"
  ];

  const BANK_CHECKLIST_FIELDS = [
    "id",
    "kod",
    "nazev",
    "datVyst",
    "varSym",
    "sumCelkem",
    "sparovano",
    "partnerName",
    "mena(kod)"
  ];

  const getReferenceLookupCache = (kind: ReferenceValueKind) => {
    const configForKind = getReferenceValueConfig(kind);
    const existing = referenceCache.get(kind);
    if (existing) {
      return existing;
    }
    const cache = new TtlCache<Record<string, unknown>[]>(configForKind.ttlMs);
    referenceCache.set(kind, cache);
    return cache;
  };

  const fetchReportRecords = async ({
    ctx,
    toolName,
    reportKind,
    partnerId,
    date,
    scope,
    limit,
    offset,
    extraQuery
  }: {
    ctx: ConnectionContext;
    toolName: string;
    reportKind: "overdue_report" | "saldo_report" | "saldo_at_date_report";
    partnerId?: string;
    date?: string;
    scope?: OverdueScope;
    limit: number;
    offset: number;
    extraQuery?: Record<string, string | number | boolean | undefined>;
  }) => {
    const configForReport = getReportEvidenceConfig(reportKind);
    ensureEvidencePermission(ctx.profile, "read", configForReport.evidence);
    const resolvedDate = toIsoDate(date);
    const cacheKey = [
      ctx.connection.id,
      configForReport.evidence,
      resolvedDate,
      partnerId ?? "",
      scope ?? "all",
      String(limit),
      String(offset)
    ].join(":");
    const cached = reportCache.get(cacheKey);
    if (cached !== null) {
      return { ok: true, evidence: configForReport.evidence, records: cached };
    }

    const response = await client.request({
      operation: `${toolName}_${configForReport.evidence}`,
      profile: ctx.profile,
      company: ctx.connection.company_slug,
      evidence: configForReport.evidence,
      method: "GET",
      path: client.buildEvidencePath(
        ctx.profile,
        ctx.connection.company_slug,
        configForReport.evidence,
        ctx.profile.defaultFormat,
        buildReportSelector(partnerId)
      ),
      format: ctx.profile.defaultFormat,
      query: compactRecord({
        detail: "full",
        start: offset,
        limit: Math.max(limit + 1, Math.min(configForReport.fetchLimit, 100)),
        datum: resolvedDate,
        ...extraQuery
      })
    });

    if (!response.ok) {
      return {
        ok: false,
        evidence: configForReport.evidence,
        response,
        records: []
      };
    }

    const records = extractRecordList(response.data, configForReport.evidence);
    reportCache.set(cacheKey, records);
    return {
      ok: true,
      evidence: configForReport.evidence,
      records
    };
  };

  const filterOverdueItemsByScope = (
    records: ReturnType<typeof mapOverdueReportResults>["records"],
    scope: OverdueScope
  ) => {
    if (scope === "all") {
      return records;
    }
    const expected = scope === "receivables" ? "receivable" : "payable";
    return records.filter((record) => record.document_kind === expected);
  };

  const buildPartnerBalanceFromRecords = (
    records: Array<Record<string, unknown>>,
    partnerId: string,
    date: string,
    evidence: string
  ) => {
    const reportConfig =
      evidence === getReportEvidenceConfig("saldo_at_date_report").evidence
        ? getReportEvidenceConfig("saldo_at_date_report")
        : getReportEvidenceConfig("saldo_report");
    return mapPartnerBalanceSummary(records, {
      partner_id: partnerId,
      date,
      partner_id_fields: reportConfig.fieldCandidates.partner_id,
      partner_name_fields: reportConfig.fieldCandidates.partner_name,
      date_fields: reportConfig.fieldCandidates.date,
      receivable_balance_fields: reportConfig.fieldCandidates.receivable_balance,
      payable_balance_fields: reportConfig.fieldCandidates.payable_balance,
      net_balance_fields: reportConfig.fieldCandidates.net_balance,
      currency_fields: reportConfig.fieldCandidates.currency,
      open_items_count_fields: reportConfig.fieldCandidates.open_items_count
    });
  };

  const executeAccountantWrite = async ({
    ctx,
    kind,
    evidence,
    payload,
    validationOnly = false
  }: {
    ctx: ConnectionContext;
    kind: string;
    evidence: string;
    payload: string;
    validationOnly?: boolean;
  }) => {
    ensureEvidencePermission(ctx.profile, validationOnly ? "dryRun" : "write", evidence);
    const validation = await client.request({
      operation: validationOnly ? `validate_${kind}` : `validate_before_${kind}`,
      profile: ctx.profile,
      company: ctx.connection.company_slug,
      evidence,
      method: "POST",
      path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, evidence, ctx.profile.defaultFormat),
      format: ctx.profile.defaultFormat,
      body: payload,
      contentType: "application/json",
      query: { "dry-run": true }
    });
    if (!validation.ok || validationOnly) {
      return { validation, execution: null };
    }
    const execution = await client.request({
      operation: `execute_${kind}`,
      profile: ctx.profile,
      company: ctx.connection.company_slug,
      evidence,
      method: "POST",
      path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, evidence, ctx.profile.defaultFormat),
      format: ctx.profile.defaultFormat,
      body: payload,
      contentType: "application/json"
    });
    return { validation, execution };
  };

  const writeMeta = {
    ui: { resourceUri: "ui://widget/flexi-status" }
  };
  const readMeta = {
    ui: { resourceUri: "ui://widget/flexi-status" }
  };

  registerTool(
    "flexi_list_accessible_companies",
    {
      title: "List accessible companies",
      description: "List ABRA Flexi companies visible to one managed connection.",
      inputSchema: z.object(connectionArgsSchema),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      const ctx = resolveConnectionContext(auth, connection_alias);
      const companiesResponse = await client.request({
        operation: "list_accessible_companies",
        profile: ctx.profile,
        method: "GET",
        path: client.buildServerPath(ctx.profile.defaultFormat),
        format: ctx.profile.defaultFormat
      });
      const companies = companiesResponse.ok ? mapCompaniesToSummary(companiesResponse.data) : [];
      if (!companiesResponse.ok) {
        throw new Error(summarizeIssues(companiesResponse, "Failed to list accessible companies."));
      }
      return createResult(`Connection ${ctx.connection.alias} can access ${companies.length} companies.`, compactRecord({
        ok: true,
        connection_alias: ctx.connection.alias,
        fixed_company: ctx.connection.company_slug || undefined,
        company_count: companies.length,
        accessible_companies: companies
      }));
    }
  );

  registerTool(
    "flexi_check_connection",
    {
      title: "Check Flexi connection",
      description: "Verify auth and company access for one managed Flexi connection.",
      inputSchema: z.object(connectionArgsSchema),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = applyRequestedCompany(ctx, company_slug);
      const companiesResponse = await client.request({
        operation: "check_connection_list_companies",
        profile: ctx.profile,
        method: "GET",
        path: client.buildServerPath(ctx.profile.defaultFormat),
        format: ctx.profile.defaultFormat
      });
      const evidenceResponse = selectedCompany
        ? await client.request({
            operation: "check_connection_list_evidence",
            profile: ctx.profile,
            company: ctx.connection.company_slug,
            method: "GET",
            path: client.buildCompanyPath(ctx.profile, ctx.connection.company_slug, "evidence-list"),
            format: ctx.profile.defaultFormat
          })
        : null;
      const companies = companiesResponse.ok ? mapCompaniesToSummary(companiesResponse.data) : [];
      const evidence = evidenceResponse?.ok ? extractEvidenceList(evidenceResponse.data) : [];
      const issues = [...companiesResponse.errors, ...(evidenceResponse?.errors ?? [])];
      const ok = companiesResponse.ok && (evidenceResponse?.ok ?? true);
      db.updateConnectionCheck(ctx.connection.id, ok, issues.join("; "));

      return createResult(
        ok
          ? selectedCompany
            ? `Connection ${ctx.connection.alias} can access ${ctx.connection.company_slug}.`
            : `Connection ${ctx.connection.alias} authenticated successfully. Select a company with company_slug for company-scoped tools.`
          : issues.join("; "),
        compactRecord({
          ok,
          connection_alias: ctx.connection.alias,
          company: ctx.connection.company_slug || undefined,
          fixed_company: normalizeCompanySlug(ctx.connection.company_slug) || undefined,
          company_count: companies.length || undefined,
          evidence_count: selectedCompany ? evidence.length || undefined : undefined,
          accessible_companies: companies.slice(0, 5),
          issues: limitedIssues(issues)
        })
      );
    }
  );

  registerTool(
    "flexi_list_evidence",
    {
      title: "List evidence",
      description: "Browse the allowlisted Flexi evidence catalog for the selected connection.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        query: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).max(500).default(0)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, query, limit, offset }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const catalog = await getCatalog(ctx);
      const normalizedQuery = query?.toLowerCase();
      const filtered = catalog.filter((item) => {
        if (!normalizedQuery) {
          return true;
        }
        return [item.path, item.name, item.type]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedQuery));
      });
      const visible = filtered.slice(offset, offset + limit);
      return createResult(`Returned ${visible.length} evidence entries.`, {
        ok: true,
        connection_alias: ctx.connection.alias,
        returned: visible.length,
        has_more: offset + visible.length < filtered.length,
        evidence: visible.map((item) =>
          compactRecord({
            ...item,
            read_allowed: hasEvidencePermission(ctx.profile, "read", item.path),
            dry_run_allowed: hasEvidencePermission(ctx.profile, "dryRun", item.path),
            write_allowed: hasEvidencePermission(ctx.profile, "write", item.path)
          })
        )
      });
    }
  );

  registerTool(
    "flexi_get_properties",
    {
      title: "Get evidence properties",
      description: "Return compact field metadata for one evidence.",
      inputSchema: z.object({
        ...evidenceArgsSchema,
        field_limit: z.number().int().min(1).max(80).default(25)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, evidence, field_limit }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      ensureEvidencePermission(ctx.profile, "read", evidence);
      const properties = await getProperties(ctx, evidence);
      return createResult(`Loaded properties for ${evidence}.`, {
        ok: true,
        evidence,
        count: properties.length,
        properties: properties.slice(0, field_limit)
      });
    }
  );

  registerTool(
    "flexi_get_relations",
    {
      title: "Get evidence relations",
      description: "Return compact relation metadata for one evidence.",
      inputSchema: z.object({
        ...evidenceArgsSchema,
        limit: z.number().int().min(1).max(80).default(25)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, evidence, limit }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      ensureEvidencePermission(ctx.profile, "read", evidence);
      const relations = await getRelations(ctx, evidence);
      return createResult(`Loaded relations for ${evidence}.`, {
        ok: true,
        evidence,
        count: relations.length,
        relations: relations.slice(0, limit)
      });
    }
  );

  registerTool(
    "flexi_search_records",
    {
      title: "Search records",
      description: "Search one allowlisted evidence with query or Flexi filter.",
      inputSchema: z.object({
        ...evidenceArgsSchema,
        query: z.string().trim().max(120).optional(),
        filter: z.string().trim().max(300).optional(),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      }).refine((value) => value.query || value.filter, {
        message: "Provide query or filter."
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, evidence, query, filter, limit, offset }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      ensureEvidencePermission(ctx.profile, "read", evidence);
      const response = await client.request({
        operation: "search_records",
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        evidence,
        method: "GET",
        path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, evidence, ctx.profile.defaultFormat),
        format: ctx.profile.defaultFormat,
        query: {
          query,
          filter,
          limit: limit + 1,
          start: offset,
          detail: "summary"
        }
      });

      if (!response.ok) {
        return createResult(summarizeIssues(response, `Search failed for ${evidence}.`), {
          ok: false,
          evidence,
          errors: limitedIssues(response.errors),
          warnings: limitedIssues(response.warnings)
        });
      }

      const result = mapSearchResults(response.data, evidence, limit, offset);
      return createResult(`Found ${result.returned} records in ${evidence}.`, { ok: true, ...result });
    }
  );

  registerTool(
    "flexi_get_record",
    {
      title: "Get record",
      description: "Fetch one record summary or full detail from an allowlisted evidence.",
      inputSchema: z.object({
        ...evidenceArgsSchema,
        record_id: z.string().trim().min(1),
        detail: z.enum(["summary", "full"]).default("summary"),
        include_relations: z.boolean().default(false),
        include_collections: z.boolean().default(false)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, evidence, record_id, detail, include_relations, include_collections }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      ensureEvidencePermission(ctx.profile, "read", evidence);
      const response = await client.request({
        operation: "get_record",
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        evidence,
        method: "GET",
        path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, evidence, ctx.profile.defaultFormat, record_id),
        format: ctx.profile.defaultFormat,
        query: { detail }
      });
      if (!response.ok) {
        return createResult(summarizeIssues(response, `Lookup failed for ${evidence}/${record_id}.`), {
          ok: false,
          evidence,
          record_id,
          errors: limitedIssues(response.errors)
        });
      }
      const record = detail === "summary"
        ? mapRecordSummary(response.data, evidence)
        : mapRecordDetail(response.data, evidence, { include_relations, include_collections });
      return createResult(record ? `Loaded ${evidence}/${record_id}.` : `No record found for ${evidence}/${record_id}.`, {
        ok: Boolean(record),
        evidence,
        record_id,
        record: record ?? undefined
      });
    }
  );

  registerTool(
    "search_partners",
    {
      title: "Search partners",
      description: "Find customers or suppliers and return short partner summaries.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        query: z.string().trim().min(2).max(120),
        role: z.enum(["customer", "supplier", "any"]).default("any"),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, query, role, limit, offset }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const specs = getPartnerSearchSpec(role as PartnerRole).filter((spec) =>
        hasEvidencePermission(ctx.profile, "read", spec.evidence)
      );
      const aggregated: ReturnType<typeof mapPartnerSearchResults>["records"] = [];
      let remaining = limit;
      let currentOffset = offset;
      let hasMore = false;
      for (const spec of specs) {
        if (remaining <= 0) break;
        const response = await runQuery({
          ctx,
          evidence: spec.evidence,
          fields: spec.fields,
          includes: spec.evidence === "adresar" ? ["stat"] : undefined,
          filter: buildTextSearchFilter(query, spec.searchFields),
          limit: remaining,
          offset: currentOffset,
          operation: `search_partners_${spec.evidence}`
        });
        if (!response.ok) {
          return createResult(summarizeIssues(response, `Partner search failed for ${spec.evidence}.`), { ok: false });
        }
        const result = mapPartnerSearchResults(response.data, spec.evidence, remaining, currentOffset, spec.evidence === "dodavatel" ? "supplier" : "customer");
        aggregated.push(...result.records);
        hasMore = hasMore || result.has_more;
        remaining = limit - aggregated.length;
        currentOffset = 0;
      }
      return createResult(`Found ${Math.min(limit, aggregated.length)} partners.`, {
        ok: true,
        role,
        returned: Math.min(limit, aggregated.length),
        has_more: hasMore || aggregated.length > limit,
        records: aggregated.slice(0, limit)
      });
    }
  );

  registerTool(
    "get_partner_summary",
    {
      title: "Get partner summary",
      description: "Fetch one partner with a business summary.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        id: z.string().trim().min(1)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, id }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      for (const evidence of ["adresar", "dodavatel"]) {
        if (!hasEvidencePermission(ctx.profile, "read", evidence)) {
          continue;
        }
        const response = await client.request({
          operation: `get_partner_summary_${evidence}`,
          profile: ctx.profile,
          company: ctx.connection.company_slug,
          evidence,
          method: "GET",
          path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, evidence, ctx.profile.defaultFormat, id),
          format: ctx.profile.defaultFormat,
          query: { detail: "summary" }
        });
        if (!response.ok) continue;
        const record = mapPartnerSummary(response.data, evidence, evidence === "dodavatel" ? "supplier" : "customer");
        if (record) {
          return createResult(`Loaded partner ${record.name}.`, { ok: true, evidence, record });
        }
      }
      return createResult(`Partner '${id}' was not found.`, { ok: false, id });
    }
  );

  registerTool(
    "search_products",
    {
      title: "Search products",
      description: "Find products from the price list and return compact summaries.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        query: z.string().trim().min(2).max(120),
        active_only: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, query, active_only, limit, offset }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const spec = getProductSearchSpec();
      ensureEvidencePermission(ctx.profile, "read", spec.evidence);
      const response = await runQuery({
        ctx,
        evidence: spec.evidence,
        fields: spec.fields,
        filter: combineFilters([
          buildTextSearchFilter(query, spec.searchFields)
        ]),
        limit,
        offset,
        operation: "search_products"
      });
      if (!response.ok) {
        return createResult(summarizeIssues(response, "Product search failed."), { ok: false });
      }
      const result = mapProductSearchResults(response.data, spec.evidence, limit, offset);
      return createResult(`Found ${result.returned} products.`, { ok: true, ...result });
    }
  );

  registerTool(
    "get_product_summary",
    {
      title: "Get product summary",
      description: "Fetch one product from the price list.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        id: z.string().trim().min(1)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, id }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const evidence = getProductSearchSpec().evidence;
      ensureEvidencePermission(ctx.profile, "read", evidence);
      const response = await client.request({
        operation: "get_product_summary",
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        evidence,
        method: "GET",
        path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, evidence, ctx.profile.defaultFormat, id),
        format: ctx.profile.defaultFormat,
        query: { detail: "summary" }
      });
      if (!response.ok) {
        return createResult(summarizeIssues(response, `Product '${id}' was not found.`), { ok: false });
      }
      const record = mapProductSummary(response.data, evidence);
      return createResult(record ? `Loaded product ${record.name}.` : `Product '${id}' was not found.`, {
        ok: Boolean(record),
        record: record ?? undefined
      });
    }
  );

  registerTool(
    "list_employees",
    {
      title: "List employees",
      description: "Return a compact employee list for HR and payroll workflows.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        query: z.string().trim().max(120).optional(),
        active_only: z.boolean().default(true),
        include_contracts: z.boolean().default(false),
        as_of: z.string().trim().max(32).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).max(500).default(0)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, query, active_only, include_contracts, as_of, limit, offset }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const resolvedLimit = limit ?? 20;
      const resolvedOffset = offset ?? 0;
      const evidence = "prehled-zamestnancu";
      ensureEvidencePermission(ctx.profile, "read", evidence);
      const response = await runQuery({
        ctx,
        evidence,
        fields: EMPLOYEE_FIELDS,
        filter: buildTextSearchFilter(query, ["jmeno", "osbCis", "funkce"]),
        limit: Math.min(resolvedOffset + resolvedLimit + 100, 250),
        offset: 0,
        operation: "list_employees"
      });
      if (!response.ok) {
        return createResult(summarizeIssues(response, "Employee list lookup failed."), { ok: false });
      }
      const asOfDate = toIsoDate(as_of);
      const employees = summarizeEmployees(extractRecordList(response.data, evidence), {
        as_of: asOfDate,
        active_only,
        include_contracts
      });
      const visible = employees.slice(resolvedOffset, resolvedOffset + resolvedLimit);
      return createResult(`Returned ${visible.length} employees.`, {
        ok: true,
        company_slug: ctx.connection.company_slug,
        as_of: asOfDate,
        returned: visible.length,
        has_more: resolvedOffset + visible.length < employees.length,
        employees: visible
      });
    }
  );

  registerTool(
    "get_employee_summary",
    {
      title: "Get employee summary",
      description: "Return one employee summary with active contracts and workload details.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        employee_id: z.string().trim().max(120).optional(),
        personal_number: z.string().trim().max(120).optional(),
        query: z.string().trim().max(120).optional(),
        as_of: z.string().trim().max(32).optional()
      }).refine((value) => value.employee_id || value.personal_number || value.query, {
        message: "Provide employee_id, personal_number, or query."
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, employee_id, personal_number, query, as_of }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const evidence = "prehled-zamestnancu";
      ensureEvidencePermission(ctx.profile, "read", evidence);
      const response = await runQuery({
        ctx,
        evidence,
        fields: EMPLOYEE_FIELDS,
        filter: personal_number ? `osbCis eq "${personal_number.replace(/"/g, '\\"')}"` : buildTextSearchFilter(query, ["jmeno", "osbCis", "funkce"]),
        limit: 250,
        offset: 0,
        operation: "get_employee_summary"
      });
      if (!response.ok) {
        return createResult(summarizeIssues(response, "Employee summary lookup failed."), { ok: false });
      }
      const employees = summarizeEmployees(extractRecordList(response.data, evidence), {
        as_of: toIsoDate(as_of),
        active_only: false,
        include_contracts: true
      });
      const lookup = resolveEmployeeLookup(employees, { employee_id, personal_number, query });
      if (lookup.status === "not_found") {
        return createResult("Employee was not found.", { ok: false });
      }
      if (lookup.status === "ambiguous") {
        return createResult("More than one employee matched. Narrow the query or use personal_number.", {
          ok: false,
          status: "ambiguous",
          matches: compactEmployeeLookupMatches(lookup)
        });
      }
      return createResult(`Loaded employee ${lookup.employee!.name}.`, {
        ok: true,
        employee: lookup.employee
      });
    }
  );

  registerTool(
    "search_employee_documents",
    {
      title: "Search employee documents",
      description: "Browse HR records such as contracts and absences for one employee.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        personal_number: z.string().trim().max(120).optional(),
        query: z.string().trim().max(120).optional(),
        date_from: z.string().trim().max(32).optional(),
        date_to: z.string().trim().max(32).optional(),
        limit: z.number().int().min(1).max(50).default(20)
      }).refine((value) => value.personal_number || value.query, {
        message: "Provide personal_number or query."
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, personal_number, query, date_from, date_to, limit }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const catalog = await getCatalog(ctx);
      const visibleEvidence = Object.keys(EMPLOYEE_DOCUMENT_FIELDS).filter(
        (evidence) => catalog.some((item) => item.path === evidence) && hasEvidencePermission(ctx.profile, "read", evidence)
      );
      const asOfDate = toIsoDate(date_to);
      const hits: Array<ReturnType<typeof mapEmployeeDocumentHits>[number]> = [];

      for (const evidence of visibleEvidence) {
        const response = await runQuery({
          ctx,
          evidence,
          fields: EMPLOYEE_DOCUMENT_FIELDS[evidence],
          limit: evidence === "prehled-zamestnancu" ? 200 : 100,
          offset: 0,
          operation: `search_employee_documents_${evidence}`
        });
        if (!response.ok) {
          continue;
        }
        const filteredRecords = filterRecordsByEmployeeSelector(extractRecordList(response.data, evidence), {
          personal_number,
          query
        });
        const mappedHits = mapEmployeeDocumentHits(evidence, filteredRecords, asOfDate).filter((item) => {
          const effectiveDate = item.date ?? item.end_date;
          if (!effectiveDate) {
            return true;
          }
          if (date_from && effectiveDate < date_from) {
            return false;
          }
          if (date_to && effectiveDate > date_to) {
            return false;
          }
          return true;
        });
        hits.push(...mappedHits);
      }

      hits.sort((left, right) => (right.date ?? right.end_date ?? "").localeCompare(left.date ?? left.end_date ?? ""));
      const visible = hits.slice(0, limit);
      return createResult(`Found ${visible.length} HR records.`, {
        ok: true,
        returned: visible.length,
        has_more: hits.length > limit,
        records: visible
      });
    }
  );

  const exportAssetsLiabilitiesPdfInput = z.object({
    ...connectionArgsSchema,
    company_name: z.string().trim().min(1).max(160).optional(),
    accounting_period: z.string().trim().max(32).optional(),
    year: z.string().trim().regex(/^\d{4}$/).optional(),
    account_filter: z.string().trim().max(128).optional(),
    account_ids: z.array(z.string().trim().min(1)).max(20).optional(),
    center_ids: z.array(z.string().trim().min(1)).max(20).optional(),
    activity_ids: z.array(z.string().trim().min(1)).max(20).optional(),
    currency_codes: z.array(z.string().trim().min(1)).max(10).optional(),
    group_by_center: z.boolean().optional(),
    group_by_activity: z.boolean().optional()
  });
  type ExportAssetsLiabilitiesPdfArgs = z.infer<typeof exportAssetsLiabilitiesPdfInput>;

  const exportBalanceSheetPdfInput = z.object({
    ...connectionArgsSchema,
    company_name: z.string().trim().min(1).max(160).optional(),
    accounting_period: z.string().trim().max(32).optional(),
    year: z.string().trim().regex(/^\d{4}$/).optional()
  });
  type ExportBalanceSheetPdfArgs = z.infer<typeof exportBalanceSheetPdfInput>;

  const resolveRequestedCompanyForPdf = async (
    ctx: ConnectionContext,
    company_slug?: string,
    company_name?: string
  ) => {
    const requestedCompany = company_name?.trim() || company_slug?.trim();
    let selectedCompany = normalizeCompanySlug(company_slug);
    if (requestedCompany) {
      const companies = await getAccessibleCompanies(ctx);
      const resolvedCompany = resolveCompanyCandidate(companies, requestedCompany);
      if (!resolvedCompany) {
        throw new Error(`Could not map '${requestedCompany}' to one accessible company. First list accessible companies and retry with an exact company_slug.`);
      }
      selectedCompany = resolvedCompany.db_name;
    } else {
      selectedCompany = ensureSelectedCompany(ctx, company_slug);
    }
    applyRequestedCompany(ctx, selectedCompany);
    return selectedCompany;
  };

  const exportAssetsLiabilitiesPdfHandler = async ({ connection_alias, company_slug, company_name, accounting_period, year, account_filter, account_ids, center_ids, activity_ids, currency_codes, group_by_center, group_by_activity }: ExportAssetsLiabilitiesPdfArgs, extra: any) => {
      const auth = extra.authInfo as AppAuthInfo;
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = await resolveRequestedCompanyForPdf(ctx, company_slug, company_name);
      const report = buildAssetsLiabilitiesPdfRequest(selectedCompany, {
        accounting_period: accounting_period ?? year,
        account_filter,
        account_ids,
        center_ids,
        activity_ids,
        currency_codes,
        group_by_center,
        group_by_activity
      });
      const probe = await client.requestBinary({
        operation: "probe_assets_liabilities_pdf",
        profile: ctx.profile,
        company: selectedCompany,
        evidence: "rozvaha-po-uctech",
        method: "GET",
        path: report.path,
        query: report.query
      });
      if (!probe.ok) {
        const issue = summarizeBinaryIssues(
          probe.http_status,
          probe.content_type,
          probe.buffer,
          "Assets and liabilities report export failed."
        );
        throw new Error(`Official assets and liabilities PDF export failed: ${issue}`);
      }
      const grant = db.createReportDownloadGrant({
        token: randomId(24),
        organization_id: auth.extra.organizationId,
        user_id: auth.extra.userId,
        connection_id: ctx.connection.id,
        report_key: "export_assets_liabilities_pdf",
        company_slug: selectedCompany,
        report_path: report.path,
        query_json: JSON.stringify(report.query),
        filename: report.filename,
        expires_at: new Date(Date.now() + reportDownloadTtlMs).toISOString()
      });
      const downloadUrl = new URL(`/downloads/reports/${grant.token}`, config.appBaseUrl).toString();
      return createResult(
        `Official ABRA Flexi PDF report is ready.\nDownload URL: ${downloadUrl}`,
        {
        ok: true,
        report_variant: report.report_variant,
        company_slug: selectedCompany,
        company_name: company_name || undefined,
        report_name: report.report_name,
        filename: report.filename,
        mime_type: "application/pdf",
        source_system: "ABRA Flexi",
        export_origin: "native_flexi_pdf",
        download_url: downloadUrl,
        download_expires_at: grant.expires_at,
        filters: compactRecord({
          accounting_period: accounting_period ?? year,
          year,
          account_filter,
          account_ids,
          center_ids,
          activity_ids,
          currency_codes,
          group_by_center,
          group_by_activity
        })
      });
    };

  const exportBalanceSheetPdfHandler = async ({ connection_alias, company_slug, company_name, accounting_period, year }: ExportBalanceSheetPdfArgs, extra: any) => {
      const auth = extra.authInfo as AppAuthInfo;
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = await resolveRequestedCompanyForPdf(ctx, company_slug, company_name);
      const report = buildBalanceSheetPdfRequest(selectedCompany, {
        accounting_period: accounting_period ?? year
      });
      const probe = await client.requestBinary({
        operation: "probe_balance_sheet_pdf",
        profile: ctx.profile,
        company: selectedCompany,
        evidence: "sestava",
        method: "GET",
        path: report.path,
        query: report.query
      });
      if (!probe.ok) {
        const issue = summarizeBinaryIssues(
          probe.http_status,
          probe.content_type,
          probe.buffer,
          "Balance sheet report export failed."
        );
        throw new Error(`Balance sheet report export failed: ${issue}`);
      }
      const grant = db.createReportDownloadGrant({
        token: randomId(24),
        organization_id: auth.extra.organizationId,
        user_id: auth.extra.userId,
        connection_id: ctx.connection.id,
        report_key: "export_balance_sheet_pdf",
        company_slug: selectedCompany,
        report_path: report.path,
        query_json: JSON.stringify(report.query),
        filename: report.filename,
        expires_at: new Date(Date.now() + reportDownloadTtlMs).toISOString()
      });
      const downloadUrl = new URL(`/downloads/reports/${grant.token}`, config.appBaseUrl).toString();
      return createResult(
        `PDF report is ready.\nDownload URL: ${downloadUrl}`,
        {
        ok: true,
        report_variant: report.report_variant,
        company_slug: selectedCompany,
        company_name: company_name || undefined,
        report_name: report.report_name,
        filename: report.filename,
        mime_type: "application/pdf",
        download_url: downloadUrl,
        download_expires_at: grant.expires_at,
        filters: compactRecord({
          accounting_period: accounting_period ?? year,
          year
        })
      });
    };

  registerTool(
    "export_assets_liabilities_pdf",
    {
      title: "Export official soupis aktiv a pasiv PDF",
      description: "Use only when the user wants the official ABRA Flexi 'soupis aktiv a pasiv' PDF export. This returns the native account-level PDF from Flexi and must not be used for summaries, explanations, or simplified Rozvaha output.",
      inputSchema: exportAssetsLiabilitiesPdfInput,
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    exportAssetsLiabilitiesPdfHandler
  );

  registerTool(
    "export_balance_sheet_pdf",
    {
      title: "Generate rozvaha / balance sheet PDF",
      description: "Use for requests explicitly asking for 'rozvaha' or 'balance sheet'. This tool exports the Rozvaha summary PDF and is separate from 'soupis aktiv a pasiv'.",
      inputSchema: exportBalanceSheetPdfInput,
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    exportBalanceSheetPdfHandler
  );

  registerTool(
    "get_vat_summary",
    {
      title: "Get VAT summary",
      description: "Return a compact VAT overview for issued and received invoices in one period.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        date_from: z.string().trim().max(32).optional(),
        date_to: z.string().trim().max(32).optional()
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, date_from, date_to }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const periodEnd = toIsoDate(date_to);
      const periodStart = date_from ?? `${periodEnd.slice(0, 7)}-01`;
      const [outgoingResponse, incomingResponse] = await Promise.all([
        runQuery({
          ctx,
          evidence: "faktura-vydana",
          fields: VAT_QUERY_FIELDS,
          filter: undefined,
          limit: 250,
          offset: 0,
          operation: "get_vat_summary_outgoing"
        }),
        runQuery({
          ctx,
          evidence: "faktura-prijata",
          fields: VAT_QUERY_FIELDS,
          filter: undefined,
          limit: 250,
          offset: 0,
          operation: "get_vat_summary_incoming"
        })
      ]);

      if (!outgoingResponse.ok || !incomingResponse.ok) {
        return createResult(
          summarizeIssues(outgoingResponse.ok ? incomingResponse : outgoingResponse, "VAT summary lookup failed."),
          { ok: false }
        );
      }

      const summary = buildVatSummary(
        filterRecordsByDateRange(extractRecordList(outgoingResponse.data, "faktura-vydana"), "datVyst", periodStart, periodEnd),
        filterRecordsByDateRange(extractRecordList(incomingResponse.data, "faktura-prijata"), "datVyst", periodStart, periodEnd),
        periodEnd
      );
      return createResult(`Loaded VAT summary for ${periodStart} to ${periodEnd}.`, {
        ok: true,
        period_start: periodStart,
        period_end: periodEnd,
        summary
      });
    }
  );

  registerTool(
    "get_period_close_checklist",
    {
      title: "Get period close checklist",
      description: "Return a practical accounting close checklist for one period.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        period_start: z.string().trim().max(32).optional(),
        period_end: z.string().trim().max(32).optional()
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, period_start, period_end }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const resolvedEnd = toIsoDate(period_end);
      const resolvedStart = period_start ?? `${resolvedEnd.slice(0, 7)}-01`;
      const [salesResponse, purchaseResponse, bankResponse] = await Promise.all([
        runQuery({
          ctx,
          evidence: "faktura-vydana",
          fields: CLOSE_CHECKLIST_DOCUMENT_FIELDS,
          filter: "zbyvaUhradit gt 0",
          limit: 250,
          offset: 0,
          operation: "period_close_sales"
        }),
        runQuery({
          ctx,
          evidence: "faktura-prijata",
          fields: CLOSE_CHECKLIST_DOCUMENT_FIELDS,
          filter: "zbyvaUhradit gt 0",
          limit: 250,
          offset: 0,
          operation: "period_close_purchase"
        }),
        hasEvidencePermission(ctx.profile, "read", "banka")
          ? runQuery({
              ctx,
              evidence: "banka",
              fields: BANK_CHECKLIST_FIELDS,
              filter: undefined,
              limit: 250,
              offset: 0,
              operation: "period_close_bank"
            })
          : Promise.resolve(null)
      ]);

      if (!salesResponse.ok || !purchaseResponse.ok) {
        return createResult(
          summarizeIssues(salesResponse.ok ? purchaseResponse : salesResponse, "Period close checklist lookup failed."),
          { ok: false }
        );
      }

      const salesRecords = filterRecordsByDateRange(
        extractRecordList(salesResponse.data, "faktura-vydana"),
        "datVyst",
        resolvedStart,
        resolvedEnd
      );
      const purchaseRecords = filterRecordsByDateRange(
        extractRecordList(purchaseResponse.data, "faktura-prijata"),
        "datVyst",
        resolvedStart,
        resolvedEnd
      );
      const bankRecords = bankResponse?.ok
        ? filterRecordsByDateRange(extractRecordList(bankResponse.data, "banka"), "datVyst", resolvedStart, resolvedEnd)
        : [];
      const mismatches = [
        ...detectPaymentMismatches(salesRecords, "sales_invoice", resolvedEnd),
        ...detectPaymentMismatches(purchaseRecords, "purchase_invoice", resolvedEnd),
        ...detectPaymentMismatches(bankRecords, "bank", resolvedEnd)
      ];

      const checks = compactRecord({
        overdue_receivables: {
          count: salesRecords.filter((record) => detectPaymentMismatches([record], "receivable", resolvedEnd).some((item) => item.reason.includes("po splatnosti"))).length,
          severity: "high",
          title: "Pohledávky po splatnosti",
          action: "Projít urgenci a potvrdit plán inkasa."
        },
        overdue_payables: {
          count: purchaseRecords.filter((record) => detectPaymentMismatches([record], "payable", resolvedEnd).some((item) => item.reason.includes("po splatnosti"))).length,
          severity: "medium",
          title: "Závazky po splatnosti",
          action: "Naplánovat úhrady nebo potvrdit odklad."
        },
        payment_exceptions: {
          count: mismatches.filter((item) => item.severity !== "low").length,
          severity: "medium",
          title: "Platební výjimky a nekonzistence",
          action: "Opravit statusy úhrad, VS nebo párování."
        },
        unpaired_bank_movements: bankRecords.length > 0
          ? {
              count: bankRecords.filter((record) => String(record.sparovano ?? "") === "false").length,
              severity: "medium",
              title: "Nespárované bankovní pohyby",
              action: "Dopárovat banku proti dokladům."
            }
          : undefined
      });

      return createResult(`Loaded close checklist for ${resolvedStart} to ${resolvedEnd}.`, {
        ok: true,
        period_start: resolvedStart,
        period_end: resolvedEnd,
        checks,
        highlights: mismatches.slice(0, 8)
      });
    }
  );

  registerTool(
    "find_payment_mismatches",
    {
      title: "Find payment mismatches",
      description: "Return payment exceptions such as stale balances, missing VS, or unpaired bank items.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        date_from: z.string().trim().max(32).optional(),
        date_to: z.string().trim().max(32).optional(),
        include_bank: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(20)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, date_from, date_to, include_bank, limit }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const resolvedEnd = toIsoDate(date_to);
      const requests = [
        runQuery({
          ctx,
          evidence: "faktura-vydana",
          fields: VAT_QUERY_FIELDS,
          filter: "zbyvaUhradit gt 0",
          limit: 250,
          offset: 0,
          operation: "find_payment_mismatches_sales"
        }),
        runQuery({
          ctx,
          evidence: "faktura-prijata",
          fields: VAT_QUERY_FIELDS,
          filter: "zbyvaUhradit gt 0",
          limit: 250,
          offset: 0,
          operation: "find_payment_mismatches_purchase"
        })
      ];

      if (include_bank && hasEvidencePermission(ctx.profile, "read", "banka")) {
        requests.push(
          runQuery({
            ctx,
            evidence: "banka",
            fields: BANK_CHECKLIST_FIELDS,
            filter: undefined,
            limit: 250,
            offset: 0,
            operation: "find_payment_mismatches_bank"
          })
        );
      }

      const responses = await Promise.all(requests);
      const firstError = responses.find((response) => !response.ok);
      if (firstError) {
        return createResult(summarizeIssues(firstError, "Payment mismatch lookup failed."), { ok: false });
      }

      const records = [
        ...detectPaymentMismatches(
          filterRecordsByDateRange(extractRecordList(responses[0].data, "faktura-vydana"), "datVyst", date_from, date_to),
          "sales_invoice",
          resolvedEnd
        ),
        ...detectPaymentMismatches(
          filterRecordsByDateRange(extractRecordList(responses[1].data, "faktura-prijata"), "datVyst", date_from, date_to),
          "purchase_invoice",
          resolvedEnd
        )
      ];
      if (responses[2]) {
        records.push(
          ...detectPaymentMismatches(
            filterRecordsByDateRange(extractRecordList(responses[2].data, "banka"), "datVyst", date_from, date_to),
            "bank",
            resolvedEnd
          )
        );
      }
      const sorted = records.sort((left, right) => {
        const severityRank = { high: 0, medium: 1, low: 2 } as const;
        const bySeverity = severityRank[left.severity] - severityRank[right.severity];
        if (bySeverity !== 0) {
          return bySeverity;
        }
        return Number(right.remaining_amount ?? 0) - Number(left.remaining_amount ?? 0);
      });
      const visible = sorted.slice(0, limit);
      return createResult(`Found ${visible.length} payment exceptions.`, {
        ok: true,
        returned: visible.length,
        has_more: sorted.length > limit,
        records: visible
      });
    }
  );

  registerTool(
    "get_cashflow_snapshot",
    {
      title: "Get cashflow snapshot",
      description: "Return an operational cashflow snapshot for overdue and near-term receivables and payables.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        as_of: z.string().trim().max(32).optional()
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, as_of }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const asOfDate = toIsoDate(as_of);
      const unpaidFilter = "zbyvaUhradit gt 0";
      const [receivablesResponse, payablesResponse] = await Promise.all([
        runQuery({
          ctx,
          evidence: getDocumentKindConfig("receivable").evidence,
          fields: CLOSE_CHECKLIST_DOCUMENT_FIELDS,
          filter: unpaidFilter,
          limit: 250,
          offset: 0,
          operation: "get_cashflow_snapshot_receivables"
        }),
        runQuery({
          ctx,
          evidence: getDocumentKindConfig("payable").evidence,
          fields: CLOSE_CHECKLIST_DOCUMENT_FIELDS,
          filter: unpaidFilter,
          limit: 250,
          offset: 0,
          operation: "get_cashflow_snapshot_payables"
        })
      ]);
      if (!receivablesResponse.ok || !payablesResponse.ok) {
        return createResult(
          summarizeIssues(receivablesResponse.ok ? payablesResponse : receivablesResponse, "Cashflow snapshot lookup failed."),
          { ok: false }
        );
      }
      const snapshot = buildCashflowSnapshot(
        extractRecordList(receivablesResponse.data, getDocumentKindConfig("receivable").evidence),
        extractRecordList(payablesResponse.data, getDocumentKindConfig("payable").evidence),
        asOfDate
      );
      return createResult(`Loaded cashflow snapshot for ${asOfDate}.`, {
        ok: true,
        snapshot
      });
    }
  );

  registerTool(
    "search_company_tasks",
    {
      title: "Search company tasks",
      description: "Return a practical queue of accounting work items for the selected company.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        as_of: z.string().trim().max(32).optional(),
        limit: z.number().int().min(1).max(50).default(20)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, as_of, limit }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const asOfDate = toIsoDate(as_of);
      const [receivablesResponse, payablesResponse, salesResponse, purchaseResponse] = await Promise.all([
        runQuery({
          ctx,
          evidence: getDocumentKindConfig("receivable").evidence,
          fields: CLOSE_CHECKLIST_DOCUMENT_FIELDS,
          filter: "zbyvaUhradit gt 0",
          limit: 250,
          offset: 0,
          operation: "search_company_tasks_receivables"
        }),
        runQuery({
          ctx,
          evidence: getDocumentKindConfig("payable").evidence,
          fields: CLOSE_CHECKLIST_DOCUMENT_FIELDS,
          filter: "zbyvaUhradit gt 0",
          limit: 250,
          offset: 0,
          operation: "search_company_tasks_payables"
        }),
        runQuery({
          ctx,
          evidence: "faktura-vydana",
          fields: VAT_QUERY_FIELDS,
          filter: undefined,
          limit: 250,
          offset: 0,
          operation: "search_company_tasks_sales"
        }),
        runQuery({
          ctx,
          evidence: "faktura-prijata",
          fields: VAT_QUERY_FIELDS,
          filter: undefined,
          limit: 250,
          offset: 0,
          operation: "search_company_tasks_purchase"
        })
      ]);
      const firstError = [receivablesResponse, payablesResponse, salesResponse, purchaseResponse].find((response) => !response.ok);
      if (firstError) {
        return createResult(summarizeIssues(firstError, "Task queue lookup failed."), { ok: false });
      }

      const overdueSignals = [
        ...detectPaymentMismatches(extractRecordList(receivablesResponse.data, getDocumentKindConfig("receivable").evidence), "receivable", asOfDate),
        ...detectPaymentMismatches(extractRecordList(payablesResponse.data, getDocumentKindConfig("payable").evidence), "payable", asOfDate)
      ].filter((item) => item.reason.includes("po splatnosti"));

      const mismatchSignals = [
        ...detectPaymentMismatches(extractRecordList(salesResponse.data, "faktura-vydana"), "sales_invoice", asOfDate),
        ...detectPaymentMismatches(extractRecordList(purchaseResponse.data, "faktura-prijata"), "purchase_invoice", asOfDate)
      ].filter((item) => item.severity !== "low");

      const tasks = buildCompanyTasks({
        overdueItems: overdueSignals,
        mismatches: mismatchSignals,
        limit
      });

      return createResult(`Prepared ${tasks.length} company tasks.`, {
        ok: true,
        as_of: asOfDate,
        tasks
      });
    }
  );

  registerTool(
    "prepare_invoice_from_context",
    {
      title: "Prepare invoice from context",
      description: "Resolve partner and product references, then optionally create a draft invoice.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable"]).default("sales_invoice"),
        partner_id: z.string().trim().max(120).optional(),
        partner_query: z.string().trim().max(120).optional(),
        document_type_id: z.string().trim().max(120).optional(),
        issue_date: z.string().trim().max(32).optional(),
        due_date: z.string().trim().max(32).optional(),
        tax_date: z.string().trim().max(32).optional(),
        currency: z.string().trim().max(32).optional(),
        payment_method_id: z.string().trim().max(120).optional(),
        note: z.string().trim().max(500).optional(),
        create_draft: z.boolean().default(false),
        items: z.array(z.object({
          product_id: z.string().trim().max(120).optional(),
          product_code: z.string().trim().max(120).optional(),
          product_query: z.string().trim().max(120).optional(),
          text: z.string().trim().max(255).optional(),
          quantity: z.number().positive(),
          unit_price: z.number().nonnegative(),
          vat_code: z.string().trim().max(120).optional(),
          vat_rate: z.number().nonnegative().optional()
        })).min(1)
      }).refine((value) => value.partner_id || value.partner_query, {
        message: "Provide partner_id or partner_query."
      }),
      annotations: annotationsFor("write"),
      _meta: writeMeta
    },
    async ({ connection_alias, company_slug, kind, partner_id, partner_query, document_type_id, issue_date, due_date, tax_date, currency, payment_method_id, note, create_draft, items }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = ensureSelectedCompany(ctx, company_slug);
      if (create_draft) {
        ensureWriteRole(auth);
      }

      let resolvedPartnerId = partner_id;
      let partnerMatches: ReturnType<typeof mapPartnerSearchResults>["records"] | undefined;
      if (!resolvedPartnerId && partner_query) {
        const specs = getPartnerSearchSpec("any").filter((spec) => hasEvidencePermission(ctx.profile, "read", spec.evidence));
        const partnerResults: ReturnType<typeof mapPartnerSearchResults>["records"] = [];
        for (const spec of specs) {
          const response = await runQuery({
            ctx,
            evidence: spec.evidence,
            fields: spec.fields,
            includes: spec.evidence === "adresar" ? ["stat"] : undefined,
            filter: buildTextSearchFilter(partner_query, spec.searchFields),
            limit: 5,
            offset: 0,
            operation: `prepare_invoice_partner_${spec.evidence}`
          });
          if (!response.ok) {
            continue;
          }
          partnerResults.push(
            ...mapPartnerSearchResults(response.data, spec.evidence, 5, 0, spec.evidence === "dodavatel" ? "supplier" : "customer").records
          );
        }
        const uniquePartners = [...new Map(partnerResults.map((record) => [String(record.id), record])).values()];
        if (uniquePartners.length === 1) {
          resolvedPartnerId = String(uniquePartners[0].id);
        } else {
          partnerMatches = uniquePartners;
        }
      }

      const unresolvedItems: Array<Record<string, unknown>> = [];
      const resolvedItems: DocumentItemInput[] = [];
      for (const [index, item] of items.entries()) {
        if (item.product_id || item.product_code || !item.product_query) {
          resolvedItems.push(item);
          continue;
        }
        const spec = getProductSearchSpec();
        const response = await runQuery({
          ctx,
          evidence: spec.evidence,
          fields: spec.fields,
          filter: combineFilters([
            buildTextSearchFilter(item.product_query, spec.searchFields)
          ]),
          limit: 5,
          offset: 0,
          operation: `prepare_invoice_product_${index}`
        });
        if (!response.ok) {
          unresolvedItems.push({ index, query: item.product_query, reason: summarizeIssues(response, "Product lookup failed.") });
          continue;
        }
        const productMatches = mapProductSearchResults(response.data, spec.evidence, 5, 0).records;
        if (productMatches.length !== 1) {
          unresolvedItems.push({
            index,
            query: item.product_query,
            matches: productMatches
          });
          continue;
        }
        resolvedItems.push({
          ...item,
          product_code: productMatches[0].code ?? undefined,
          product_id: productMatches[0].code ? undefined : productMatches[0].id
        });
      }

      const missing = [];
      if (!resolvedPartnerId) {
        missing.push("partner");
      }
      if (unresolvedItems.length > 0) {
        missing.push("items");
      }

      if (missing.length > 0 || !create_draft) {
        return createResult(
          missing.length > 0
            ? "More input is needed before the invoice can be prepared."
            : "Invoice context is resolved and ready for draft creation.",
          compactRecord({
            ok: missing.length === 0,
            company_slug: selectedCompany,
            status: missing.length > 0 ? "needs_input" : "draft_ready",
            missing_fields: missing.length > 0 ? missing : undefined,
            partner_id: resolvedPartnerId,
            partner_matches: partnerMatches,
            unresolved_items: unresolvedItems.length > 0 ? unresolvedItems : undefined,
            preview: missing.length === 0 ? {
              kind,
              partner_id: resolvedPartnerId,
              document_type_id,
              issue_date,
              due_date,
              tax_date,
              currency,
              payment_method_id,
              note,
              items: resolvedItems
            } : undefined
          })
        );
      }

      const configForKind = getDocumentKindConfig(kind as DocumentKind);
      const built = buildCreateDocumentPayload({
        kind: kind as DocumentKind,
        partner_id: resolvedPartnerId!,
        document_type_id,
        issue_date,
        due_date,
        tax_date,
        currency,
        payment_method_id,
        note,
        items: resolvedItems
      });
      const result = await executeAccountantWrite({
        ctx,
        kind,
        evidence: built.evidence,
        payload: built.payload
      });
      if (!result.validation.ok) {
        return createResult(summarizeIssues(result.validation, `Validation failed for ${kind}.`), { ok: false });
      }
      if (!result.execution || !result.execution.ok) {
        return createResult(summarizeIssues(result.execution ?? result.validation, `Draft creation failed for ${kind}.`), { ok: false });
      }
      const record = extractWriteRecord(result.execution.data, configForKind.evidence);
      if (record?.id) {
        db.saveDraft({
          kind,
          connection_id: ctx.connection.id,
          id: buildDraftStorageId(selectedCompany, record.id),
          evidence: configForKind.evidence,
          payload: built.payload,
          payload_format: "json",
          updated_at: new Date().toISOString()
        });
      }
      return createResult(`Created draft ${record?.display_name ?? kind}.`, {
        ok: true,
        company_slug: selectedCompany,
        status: "draft_created",
        kind,
        id: record?.id,
        code: record?.code
      });
    }
  );

  registerTool(
    "explain_document_issue",
    {
      title: "Explain document issue",
      description: "Explain likely problems on one accounting document in business language.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1),
        as_of: z.string().trim().max(32).optional()
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, kind, id, as_of }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const configForKind = getDocumentKindConfig(kind as DocumentKind);
      const response = await client.request({
        operation: `explain_document_issue_${kind}`,
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        evidence: configForKind.evidence,
        method: "GET",
        path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, configForKind.evidence, ctx.profile.defaultFormat, id),
        format: ctx.profile.defaultFormat,
        query: { detail: "full" }
      });
      if (!response.ok) {
        return createResult(summarizeIssues(response, `Document '${id}' was not found.`), { ok: false });
      }
      const rawRecord = extractRecordList(response.data, configForKind.evidence)[0];
      const summary = mapDocumentSummary(response.data, configForKind.evidence, kind);
      if (!rawRecord || !summary) {
        return createResult(`Document '${id}' was not found.`, { ok: false });
      }
      const issues = explainDocumentIssues(rawRecord, kind, toIsoDate(as_of));
      return createResult(
        issues.length > 0
          ? `Found ${issues.length} likely issue(s) on ${summary.display_name}.`
          : `No obvious issue was detected on ${summary.display_name}.`,
        {
          ok: true,
          record: summary,
          issues
        }
      );
    }
  );

  registerTool(
    "search_documents",
    {
      title: "Search documents",
      description: "Search accounting documents by business filters and return short summaries.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        query: z.string().trim().max(120).optional(),
        partner_id: z.string().trim().max(120).optional(),
        status: z.string().trim().max(120).optional(),
        date_from: z.string().trim().max(32).optional(),
        date_to: z.string().trim().max(32).optional(),
        due_from: z.string().trim().max(32).optional(),
        due_to: z.string().trim().max(32).optional(),
        unpaid_only: z.boolean().optional(),
        overdue_only: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, kind, query, partner_id, status, date_from, date_to, due_from, due_to, unpaid_only, overdue_only, limit, offset }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const configForKind = getDocumentKindConfig(kind as DocumentKind);
      ensureEvidencePermission(ctx.profile, "read", configForKind.evidence);
      const filter = buildDocumentSearchFilter(configForKind, {
        query,
        partner_id,
        status,
        date_from,
        date_to,
        due_from,
        due_to,
        unpaid_only,
        overdue_only
      });
      if (!filter) {
        return createResult("Provide query or at least one business filter.", { ok: false });
      }
      const response = await runQuery({
        ctx,
        evidence: configForKind.evidence,
        fields: configForKind.summaryQuery.fields,
        includes: configForKind.summaryQuery.includes,
        filter,
        limit,
        offset,
        operation: `search_documents_${kind}`
      });
      if (!response.ok) {
        return createResult(summarizeIssues(response, `Document search failed for ${kind}.`), { ok: false });
      }
      const result = mapDocumentSearchResults(response.data, configForKind.evidence, kind, limit, offset);
      return createResult(`Found ${result.returned} documents.`, { ok: true, ...result });
    }
  );

  registerTool(
    "get_document_summary",
    {
      title: "Get document summary",
      description: "Fetch one accounting document with a compact summary.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, kind, id }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const configForKind = getDocumentKindConfig(kind as DocumentKind);
      const response = await client.request({
        operation: `get_document_summary_${kind}`,
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        evidence: configForKind.evidence,
        method: "GET",
        path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, configForKind.evidence, ctx.profile.defaultFormat, id),
        format: ctx.profile.defaultFormat,
        query: { detail: "summary" }
      });
      if (!response.ok) {
        return createResult(summarizeIssues(response, `Document '${id}' was not found.`), { ok: false });
      }
      const record = mapDocumentSummary(response.data, configForKind.evidence, kind);
      return createResult(record ? `Loaded ${record.display_name}.` : `Document '${id}' was not found.`, {
        ok: Boolean(record),
        record: record ?? undefined
      });
    }
  );

  registerTool(
    "get_document_detail",
    {
      title: "Get document detail",
      description: "Fetch one accounting document detail. Extra sections are opt-in.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1),
        include_items: z.boolean().default(false),
        include_payments: z.boolean().default(false),
        include_accounting: z.boolean().default(false),
        include_links: z.boolean().default(false)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, kind, id, include_items, include_payments, include_accounting, include_links }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const configForKind = getDocumentKindConfig(kind as DocumentKind);
      const response = await client.request({
        operation: `get_document_detail_${kind}`,
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        evidence: configForKind.evidence,
        method: "GET",
        path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, configForKind.evidence, ctx.profile.defaultFormat, id),
        format: ctx.profile.defaultFormat,
        query: { detail: "full" }
      });
      if (!response.ok) {
        return createResult(summarizeIssues(response, `Document '${id}' was not found.`), { ok: false });
      }
      const record = mapDocumentDetail(response.data, configForKind.evidence, kind, {
        include_items,
        include_payments,
        include_accounting,
        include_links,
        item_collection_key: configForKind.itemCollectionKey,
        item_evidence: configForKind.itemEvidence
      });
      return createResult(record ? `Loaded detail for ${kind}/${id}.` : `Document '${id}' was not found.`, {
        ok: Boolean(record),
        record: record ?? undefined
      });
    }
  );

  registerTool(
    "search_unpaid_documents",
    {
      title: "Search unpaid documents",
      description: "Find unpaid or overdue receivables and payables with compact summaries.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable"]),
        partner_id: z.string().trim().max(120).optional(),
        overdue_only: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, kind, partner_id, overdue_only, limit, offset }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const configForKind = getDocumentKindConfig(kind as DocumentKind);
      const filter = buildDocumentSearchFilter(configForKind, {
        partner_id,
        unpaid_only: true,
        overdue_only
      });
      const response = await runQuery({
        ctx,
        evidence: configForKind.evidence,
        fields: configForKind.summaryQuery.fields,
        includes: configForKind.summaryQuery.includes,
        filter,
        limit,
        offset,
        operation: `search_unpaid_documents_${kind}`
      });
      if (!response.ok) {
        return createResult(summarizeIssues(response, `Unpaid search failed for ${kind}.`), { ok: false });
      }
      const result = mapDocumentSearchResults(response.data, configForKind.evidence, kind, limit, offset);
      return createResult(`Found ${result.returned} unpaid documents.`, { ok: true, ...result });
    }
  );

  registerTool(
    "search_overdue_items",
    {
      title: "Search overdue items",
      description: "List overdue receivables or payables with compact report summaries.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        scope: z.enum(["all", "receivables", "payables"]).default("all"),
        partner_id: z.string().trim().max(120).optional(),
        date: z.string().trim().max(32).optional(),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, scope, partner_id, date, limit, offset }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const resolvedDate = toIsoDate(date);
      const primary = await fetchReportRecords({
        ctx,
        toolName: "search_overdue_items",
        reportKind: "overdue_report",
        partnerId: partner_id,
        date: resolvedDate,
        scope,
        limit,
        offset
      });

      if (primary.ok) {
        const reportConfig = getReportEvidenceConfig("overdue_report");
        const mapped = mapOverdueReportResults(primary.records, limit, offset, {
          partner_name_fields: reportConfig.fieldCandidates.partner_name,
          document_code_fields: reportConfig.fieldCandidates.document_code,
          document_kind_fields: reportConfig.fieldCandidates.document_kind,
          due_date_fields: reportConfig.fieldCandidates.due_date,
          remaining_amount_fields: reportConfig.fieldCandidates.remaining_amount,
          overdue_days_fields: reportConfig.fieldCandidates.overdue_days,
          variable_symbol_fields: reportConfig.fieldCandidates.variable_symbol,
          currency_fields: reportConfig.fieldCandidates.currency,
          status_fields: reportConfig.fieldCandidates.status
        });
        const scoped = filterOverdueItemsByScope(mapped.records, scope as OverdueScope);
        return createResult(`Found ${Math.min(scoped.length, limit)} overdue items.`, {
          ok: true,
          scope,
          date: resolvedDate,
          returned: Math.min(scoped.length, limit),
          has_more: mapped.has_more || scoped.length > limit,
          records: scoped.slice(0, limit)
        });
      }
      return createResult("No overdue report data found.", { ok: false, scope, date: resolvedDate });
    }
  );

  registerTool(
    "get_partner_balance_summary",
    {
      title: "Get partner balance summary",
      description: "Return compact saldo totals for one partner.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        partner_id: z.string().trim().min(1),
        date: z.string().trim().max(32).optional()
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, partner_id, date }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const resolvedDate = toIsoDate(date);
      for (const reportKind of ["saldo_at_date_report", "saldo_report"] as const) {
        const primary = await fetchReportRecords({
          ctx,
          toolName: "get_partner_balance_summary",
          reportKind,
          partnerId: partner_id,
          date: resolvedDate,
          scope: "all",
          limit: 50,
          offset: 0,
          extraQuery: compactRecord({
            stavUhrady: "neuhrazeno",
            modul: getSaldoModules("all")
          })
        });
        if (!primary.ok) continue;
        const summary = buildPartnerBalanceFromRecords(primary.records, partner_id, resolvedDate, primary.evidence);
        if (summary) {
          return createResult(`Loaded partner balance for ${summary.partner_name ?? partner_id}.`, {
            ok: true,
            report_source: reportKind === "saldo_at_date_report" ? "primary" : "fallback",
            record: summary
          });
        }
      }
      return createResult(`No saldo data found for partner '${partner_id}'.`, { ok: false });
    }
  );

  registerTool(
    "get_accounting_overview",
    {
      title: "Get accounting overview",
      description: "Return a compact dashboard for unpaid receivables and payables.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        date: z.string().trim().max(32).optional(),
        include_overdue: z.boolean().default(true)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, date, include_overdue }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const snapshotDate = toIsoDate(date);
      if (include_overdue) {
        const primary = await fetchReportRecords({
          ctx,
          toolName: "get_accounting_overview",
          reportKind: "overdue_report",
          date: snapshotDate,
          scope: "all",
          limit: 100,
          offset: 0
        });
        if (primary.ok) {
          const reportConfig = getReportEvidenceConfig("overdue_report");
          const mapped = mapOverdueReportResults(primary.records, 100, 0, {
            partner_name_fields: reportConfig.fieldCandidates.partner_name,
            document_code_fields: reportConfig.fieldCandidates.document_code,
            document_kind_fields: reportConfig.fieldCandidates.document_kind,
            due_date_fields: reportConfig.fieldCandidates.due_date,
            remaining_amount_fields: reportConfig.fieldCandidates.remaining_amount,
            overdue_days_fields: reportConfig.fieldCandidates.overdue_days,
            variable_symbol_fields: reportConfig.fieldCandidates.variable_symbol,
            currency_fields: reportConfig.fieldCandidates.currency,
            status_fields: reportConfig.fieldCandidates.status
          });
          const receivableRecords = filterOverdueItemsByScope(mapped.records, "receivables");
          const payableRecords = filterOverdueItemsByScope(mapped.records, "payables");
          const sum = (rows: typeof receivableRecords) => rows.reduce((total, row) => total + Number(row.remaining_amount ?? 0), 0);
          return createResult("Loaded accounting overview.", {
            ok: true,
            date: snapshotDate,
            report_source: "primary",
            receivables: {
              count: receivableRecords.length,
              remaining_amount: sum(receivableRecords).toFixed(2),
              highlights: receivableRecords.slice(0, 5)
            },
            payables: {
              count: payableRecords.length,
              remaining_amount: sum(payableRecords).toFixed(2),
              highlights: payableRecords.slice(0, 5)
            }
          });
        }
      }

      const buildOverviewFallback = async (kind: DocumentKind) => {
        const configForKind = getDocumentKindConfig(kind);
        const response = await runQuery({
          ctx,
          evidence: configForKind.evidence,
          fields: configForKind.summaryQuery.fields,
          includes: configForKind.summaryQuery.includes,
          filter: buildDocumentSearchFilter(configForKind, {
            unpaid_only: true,
            overdue_only: include_overdue,
            due_to: snapshotDate
          }),
          limit: 100,
          offset: 0,
          operation: `overview_${kind}`
        });
        if (!response.ok) return [] as any[];
        return mapDocumentSearchResults(response.data, configForKind.evidence, kind, 100, 0).records;
      };

      const [receivables, payables] = await Promise.all([
        buildOverviewFallback("receivable"),
        buildOverviewFallback("payable")
      ]);

      return createResult("Loaded accounting overview.", {
        ok: true,
        date: snapshotDate,
        report_source: "fallback",
        receivables: {
          ...aggregateDocumentOverview(receivables),
          highlights: receivables.slice(0, 5)
        },
        payables: {
          ...aggregateDocumentOverview(payables),
          highlights: payables.slice(0, 5)
        }
      });
    }
  );

  registerTool(
    "search_reference_values",
    {
      title: "Search reference values",
      description: "Search compact lookup values such as document types, payment methods, or centers.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["document_type", "payment_method", "bank_account", "cash_register", "center", "project", "activity", "country", "vat_code"]),
        query: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      }),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async ({ connection_alias, company_slug, kind, query, limit, offset }, extra) => {
      const ctx = resolveConnectionContext(extra.authInfo as AppAuthInfo, connection_alias);
      ensureSelectedCompany(ctx, company_slug);
      const refConfig = getReferenceValueConfig(kind as ReferenceValueKind);
      ensureEvidencePermission(ctx.profile, "read", refConfig.evidence);
      const cache = getReferenceLookupCache(kind as ReferenceValueKind);
      const cacheKey = `${ctx.connection.id}:${ctx.connection.company_slug}:${kind}`;
      let records = cache.get(cacheKey);
      if (records === null) {
        const response = await runQuery({
          ctx,
          evidence: refConfig.evidence,
          fields: refConfig.fields,
          limit: 200,
          offset: 0,
          operation: `reference_values_${kind}`
        });
        if (!response.ok) {
          return createResult(summarizeIssues(response, `Lookup failed for ${kind}.`), { ok: false });
        }
        records = cache.set(
          cacheKey,
          mapReferenceValueResults(response.data, refConfig.evidence, 200, 0).records as unknown as Record<string, unknown>[]
        );
      }
      const normalizedQuery = query?.toLowerCase();
      const filtered = records.filter((record) => {
        if (!normalizedQuery) return true;
        return Object.values(record).some((value) =>
          typeof value === "string" ? value.toLowerCase().includes(normalizedQuery) : false
        );
      });
      const visible = filtered.slice(offset, offset + limit);
      return createResult(`Found ${visible.length} reference values.`, {
        ok: true,
        kind,
        returned: visible.length,
        has_more: offset + visible.length < filtered.length,
        records: visible
      });
    }
  );

  registerTool(
    "flexi_validate_import",
    {
      title: "Validate import",
      description: "Run a dry-run import and return only compact validation feedback.",
      inputSchema: z.object({
        ...evidenceArgsSchema,
        payload: z.string().min(1),
        payload_format: z.enum(["json", "xml"]).optional(),
        idempotency_key: z.string().trim().min(1).optional()
      }),
      annotations: annotationsFor("write"),
      _meta: writeMeta
    },
    async ({ connection_alias, company_slug, evidence, payload, payload_format, idempotency_key }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      ensureWriteRole(auth);
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = ensureSelectedCompany(ctx, company_slug);
      ensureEvidencePermission(ctx.profile, "dryRun", evidence);
      const bodyFormat = detectPayloadFormat(payload_format, payload);
      const response = await client.request({
        operation: "validate_import",
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        evidence,
        method: "POST",
        path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, evidence, ctx.profile.defaultFormat),
        format: ctx.profile.defaultFormat,
        body: payload,
        contentType: bodyFormat === "json" ? "application/json" : "application/xml",
        query: {
          "dry-run": true,
          idempotencyKey: idempotency_key
        }
      });
      const stats = extractWriteStats(response.data);
      return createResult(
        response.ok ? `Dry-run passed for ${evidence}.` : summarizeIssues(response, `Dry-run failed for ${evidence}.`),
        compactRecord({
          ok: response.ok,
          company_slug: selectedCompany,
          evidence,
          stats,
          messages: limitedIssues(response.messages, 3),
          warnings: limitedIssues(response.warnings),
          errors: limitedIssues(response.errors)
        })
      );
    }
  );

  registerTool(
    "flexi_prepare_write",
    {
      title: "Prepare write",
      description: "Create a short-lived confirmation token for a validated write.",
      inputSchema: z.object({
        ...evidenceArgsSchema,
        payload: z.string().min(1),
        payload_format: z.enum(["json", "xml"]).optional(),
        idempotency_key: z.string().trim().min(1).optional()
      }),
      annotations: annotationsFor("write"),
      _meta: writeMeta
    },
    async ({ connection_alias, company_slug, evidence, payload, payload_format, idempotency_key }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      ensureWriteRole(auth);
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = ensureSelectedCompany(ctx, company_slug);
      const payloadFormat = detectPayloadFormat(payload_format, payload);
      const confirmation = db.createWriteConfirmation({
        id: randomId(),
        organization_id: auth.extra.organizationId,
        user_id: auth.extra.userId,
        connection_id: ctx.connection.id,
        evidence,
        payload_hash: companyScopedPayloadHash(selectedCompany, payload),
        payload_format: payloadFormat,
        idempotency_key: idempotency_key ?? null,
        expires_at: new Date(Date.now() + config.writeConfirmationTtlSeconds * 1000).toISOString()
      });
      return createResult(`Prepared write confirmation for ${evidence}.`, {
        ok: true,
        company_slug: selectedCompany,
        evidence,
        status: "ready_for_confirmation",
        confirmation_id: confirmation.id,
        expires_at: confirmation.expires_at
      });
    }
  );

  registerTool(
    "flexi_execute_write",
    {
      title: "Execute write",
      description: "Execute a prepared write and return a short confirmation payload.",
      inputSchema: z.object({
        ...evidenceArgsSchema,
        payload: z.string().min(1),
        payload_format: z.enum(["json", "xml"]).optional(),
        idempotency_key: z.string().trim().min(1).optional(),
        confirmation_id: z.string().trim().min(1)
      }),
      annotations: annotationsFor("write"),
      _meta: writeMeta
    },
    async ({ connection_alias, company_slug, evidence, payload, payload_format, idempotency_key, confirmation_id }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      ensureWriteRole(auth);
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = ensureSelectedCompany(ctx, company_slug);
      const confirmation = db.consumeWriteConfirmation(confirmation_id);
      if (!confirmation) {
        throw new Error("Invalid or expired confirmation_id.");
      }
      if (confirmation.organization_id !== auth.extra.organizationId || confirmation.connection_id !== ctx.connection.id || confirmation.evidence !== evidence) {
        throw new Error("confirmation_id does not match the selected connection or evidence.");
      }
      if (confirmation.payload_hash !== companyScopedPayloadHash(selectedCompany, payload)) {
        throw new Error("Payload hash does not match the prepared write.");
      }
      if (confirmation.payload_format !== detectPayloadFormat(payload_format, payload)) {
        throw new Error("Payload format does not match the prepared write.");
      }
      if ((confirmation.idempotency_key ?? undefined) !== (idempotency_key ?? undefined)) {
        throw new Error("idempotency_key does not match the prepared write.");
      }
      const response = await client.request({
        operation: "execute_write",
        profile: ctx.profile,
        company: ctx.connection.company_slug,
        evidence,
        method: "POST",
        path: client.buildEvidencePath(ctx.profile, ctx.connection.company_slug, evidence, ctx.profile.defaultFormat),
        format: ctx.profile.defaultFormat,
        body: payload,
        contentType: detectPayloadFormat(payload_format, payload) === "json" ? "application/json" : "application/xml",
        query: { idempotencyKey: idempotency_key }
      });
      const record = extractWriteRecord(response.data, evidence);
      return createResult(
        response.ok ? `Write completed for ${record?.display_name ?? evidence}.` : summarizeIssues(response, `Write failed for ${evidence}.`),
        compactRecord({
          ok: response.ok,
          company_slug: selectedCompany,
          evidence,
          status: response.ok ? "written" : "failed",
          id: record?.id,
          code: record?.code,
          name: record?.name,
          errors: limitedIssues(response.errors),
          warnings: limitedIssues(response.warnings)
        })
      );
    }
  );

  registerTool(
    "create_document_draft",
    {
      title: "Create document draft",
      description: "Create a draft accounting document and return a short confirmation payload.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        partner_id: z.string().trim().min(1),
        document_type_id: z.string().trim().min(1).optional(),
        issue_date: z.string().trim().max(32).optional(),
        due_date: z.string().trim().max(32).optional(),
        tax_date: z.string().trim().max(32).optional(),
        currency: z.string().trim().max(32).optional(),
        payment_method_id: z.string().trim().max(120).optional(),
        note: z.string().trim().max(500).optional(),
        items: z.array(z.object({
          product_id: z.string().trim().max(120).optional(),
          product_code: z.string().trim().max(120).optional(),
          text: z.string().trim().max(255).optional(),
          quantity: z.number().positive(),
          unit_price: z.number().nonnegative().optional(),
          vat_code: z.string().trim().max(120).optional(),
          vat_rate: z.number().nonnegative().optional()
        })).default([])
      }),
      annotations: annotationsFor("write"),
      _meta: writeMeta
    },
    async ({ connection_alias, company_slug, ...input }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      ensureWriteRole(auth);
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = ensureSelectedCompany(ctx, company_slug);
      const configForKind = getDocumentKindConfig(input.kind as DocumentKind);
      const built = buildCreateDocumentPayload(input as CreateDocumentDraftInput);
      const result = await executeAccountantWrite({
        ctx,
        kind: input.kind,
        evidence: built.evidence,
        payload: built.payload
      });
      if (!result.validation.ok) {
        return createResult(summarizeIssues(result.validation, `Validation failed for ${input.kind}.`), { ok: false });
      }
      if (!result.execution || !result.execution.ok) {
        return createResult(summarizeIssues(result.execution ?? result.validation, `Write failed for ${input.kind}.`), { ok: false });
      }
      const record = extractWriteRecord(result.execution.data, configForKind.evidence);
      if (record?.id) {
        db.saveDraft({
          kind: input.kind,
          connection_id: ctx.connection.id,
          id: buildDraftStorageId(selectedCompany, record.id),
          evidence: configForKind.evidence,
          payload: built.payload,
          payload_format: "json",
          updated_at: new Date().toISOString()
        });
      }
      return createResult(`Created draft ${record?.display_name ?? input.kind}.`, {
        ok: true,
        company_slug: selectedCompany,
        kind: input.kind,
        id: record?.id,
        code: record?.code,
        status: "draft"
      });
    }
  );

  registerTool(
    "update_document_header",
    {
      title: "Update document header",
      description: "Update common header fields on one accounting document.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1),
        changes: z.record(z.any())
      }),
      annotations: annotationsFor("write"),
      _meta: writeMeta
    },
    async ({ connection_alias, company_slug, kind, id, changes }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      ensureWriteRole(auth);
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = ensureSelectedCompany(ctx, company_slug);
      const configForKind = getDocumentKindConfig(kind as DocumentKind);
      const built = buildDocumentHeaderUpdatePayload(kind as DocumentKind, id, changes);
      const result = await executeAccountantWrite({ ctx, kind, evidence: built.evidence, payload: built.payload });
      if (!result.validation.ok) {
        return createResult(summarizeIssues(result.validation, `Header validation failed for ${kind}/${id}.`), { ok: false });
      }
      if (!result.execution || !result.execution.ok) {
        return createResult(summarizeIssues(result.execution ?? result.validation, `Header update failed for ${kind}/${id}.`), { ok: false });
      }
      db.saveDraft({
        kind,
        connection_id: ctx.connection.id,
        id: buildDraftStorageId(selectedCompany, id),
        evidence: configForKind.evidence,
        payload: built.payload,
        payload_format: "json",
        updated_at: new Date().toISOString()
      });
      const record = extractWriteRecord(result.execution.data, configForKind.evidence);
      return createResult(`Updated header for ${record?.display_name ?? `${kind}/${id}`}.`, {
        ok: true,
        company_slug: selectedCompany,
        kind,
        id: record?.id ?? id,
        code: record?.code,
        status: "updated"
      });
    }
  );

  registerTool(
    "update_document_items",
    {
      title: "Update document items",
      description: "Replace all items on one accounting document.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1),
        items: z.array(z.object({
          product_id: z.string().trim().max(120).optional(),
          product_code: z.string().trim().max(120).optional(),
          text: z.string().trim().max(255).optional(),
          quantity: z.number().positive(),
          unit_price: z.number().nonnegative().optional(),
          vat_code: z.string().trim().max(120).optional(),
          vat_rate: z.number().nonnegative().optional()
        })).min(1)
      }),
      annotations: annotationsFor("write"),
      _meta: writeMeta
    },
    async ({ connection_alias, company_slug, kind, id, items }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      ensureWriteRole(auth);
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = ensureSelectedCompany(ctx, company_slug);
      const configForKind = getDocumentKindConfig(kind as DocumentKind);
      const built = buildDocumentItemsUpdatePayload(kind as DocumentKind, id, items as DocumentItemInput[]);
      const result = await executeAccountantWrite({ ctx, kind, evidence: built.evidence, payload: built.payload });
      if (!result.validation.ok) {
        return createResult(summarizeIssues(result.validation, `Item validation failed for ${kind}/${id}.`), { ok: false });
      }
      if (!result.execution || !result.execution.ok) {
        return createResult(summarizeIssues(result.execution ?? result.validation, `Item update failed for ${kind}/${id}.`), { ok: false });
      }
      db.saveDraft({
        kind,
        connection_id: ctx.connection.id,
        id: buildDraftStorageId(selectedCompany, id),
        evidence: configForKind.evidence,
        payload: built.payload,
        payload_format: "json",
        updated_at: new Date().toISOString()
      });
      const record = extractWriteRecord(result.execution.data, configForKind.evidence);
      return createResult(`Replaced items for ${record?.display_name ?? `${kind}/${id}`}.`, {
        ok: true,
        company_slug: selectedCompany,
        kind,
        id: record?.id ?? id,
        code: record?.code,
        status: "updated"
      });
    }
  );

  registerTool(
    "validate_document",
    {
      title: "Validate document",
      description: "Dry-run validate the latest stored draft snapshot for one document.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1)
      }),
      annotations: annotationsFor("write"),
      _meta: writeMeta
    },
    async ({ connection_alias, company_slug, kind, id }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      ensureWriteRole(auth);
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = ensureSelectedCompany(ctx, company_slug);
      const storedDraft = db.getDraft(kind, ctx.connection.id, buildDraftStorageId(selectedCompany, id));
      if (!storedDraft) {
        return createResult(`No stored draft snapshot found for ${kind}/${id}.`, { ok: false });
      }
      const result = await executeAccountantWrite({
        ctx,
        kind,
        evidence: storedDraft.evidence,
        payload: storedDraft.payload,
        validationOnly: true
      });
      return createResult(
        result.validation.ok ? `Validation passed for ${kind}/${id}.` : summarizeIssues(result.validation, `Validation failed for ${kind}/${id}.`),
        compactRecord({
          ok: result.validation.ok,
          company_slug: selectedCompany,
          kind,
          id,
          errors: limitedIssues(result.validation.errors),
          warnings: limitedIssues(result.validation.warnings),
          stats: extractWriteStats(result.validation.data)
        })
      );
    }
  );

  registerTool(
    "post_document",
    {
      title: "Post document",
      description: "Finalize a supported accounting document by locking it.",
      inputSchema: z.object({
        ...connectionArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1)
      }),
      annotations: annotationsFor("write"),
      _meta: writeMeta
    },
    async ({ connection_alias, company_slug, kind, id }, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      ensureWriteRole(auth);
      const ctx = resolveConnectionContext(auth, connection_alias);
      const selectedCompany = ensureSelectedCompany(ctx, company_slug);
      const configForKind = getDocumentKindConfig(kind as DocumentKind);
      const built = buildPostDocumentPayload(kind as DocumentKind, id);
      const result = await executeAccountantWrite({ ctx, kind, evidence: built.evidence, payload: built.payload });
      if (!result.validation.ok) {
        return createResult(summarizeIssues(result.validation, `Post validation failed for ${kind}/${id}.`), { ok: false });
      }
      if (!result.execution || !result.execution.ok) {
        return createResult(summarizeIssues(result.execution ?? result.validation, `Post failed for ${kind}/${id}.`), { ok: false });
      }
      db.deleteDraft(kind, ctx.connection.id, buildDraftStorageId(selectedCompany, id));
      const record = extractWriteRecord(result.execution.data, configForKind.evidence);
      return createResult(`Posted ${record?.display_name ?? `${kind}/${id}`}.`, {
        ok: true,
        company_slug: selectedCompany,
        kind,
        id: record?.id ?? id,
        code: record?.code,
        status: "posted"
      });
    }
  );

  registerTool(
    "flexi_explain_last_error",
    {
      title: "Explain last error",
      description: "Summarize the latest failed app or Flexi action for the active organization.",
      inputSchema: z.object({}),
      annotations: annotationsFor("read"),
      _meta: readMeta
    },
    async (_args, extra) => {
      const auth = extra.authInfo as AppAuthInfo;
      const entry = db.getLatestAuditError(auth.extra.organizationId);
      if (!entry) {
        return createResult("No failed action was found in the audit log.", { found: false });
      }
      const details = JSON.parse(entry.details_json) as Record<string, unknown>;
      const summary = typeof details.message === "string" ? details.message : "The last action failed without a structured message.";
      return createResult(summary, {
        found: true,
        action: entry.action,
        summary
      });
    }
  );

  return server;
}
