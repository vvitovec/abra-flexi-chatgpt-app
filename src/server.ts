import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildCreateDocumentPayload,
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
} from "./accounting.js";
import { ensureEvidencePermission, hasEvidencePermission } from "./access.js";
import { AuditStore } from "./audit.js";
import { TtlCache } from "./cache.js";
import { FlexiClient } from "./client.js";
import { ConfirmationStore } from "./confirmations.js";
import { loadHarnessConfig, resolveProfile } from "./config.js";
import {
  extractEvidenceList,
  extractEvidenceProperties,
  extractEvidenceRelations,
  aggregateDocumentOverview,
  extractWriteRecord,
  extractWriteStats,
  extractRecordList,
  mapDocumentDetail,
  mapDocumentSearchResults,
  mapDocumentSummary,
  mapCompaniesToSummary,
  mapPartnerBalanceSummary,
  mapPartnerSearchResults,
  mapPartnerSummary,
  mapProductSearchResults,
  mapProductSummary,
  mapOverdueReportResults,
  mapReferenceValueResults,
  mapRecordDetail,
  mapRecordSummary,
  mapSearchResults
} from "./flexi-dto.js";
import { DocumentDraftStore } from "./document-drafts.js";
import type { FlexiFormat, NormalizedFlexiResponse, ResolvedProfile } from "./types.js";
import { ToolTelemetry } from "./telemetry.js";
import { sha256 } from "./utils.js";

const companyArgsSchema = {
  profile: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional()
};

const evidenceArgsSchema = {
  ...companyArgsSchema,
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

function createServer(configPath = "flexi.config.json"): McpServer {
  const config = loadHarnessConfig(configPath);
  const auditStore = new AuditStore(config.logDirectory);
  const confirmationStore = new ConfirmationStore(
    resolve(".flexi-harness", "confirmations.json"),
    config.confirmationTtlSeconds
  );
  const documentDraftStore = new DocumentDraftStore(resolve(".flexi-harness", "document-drafts.json"));
  const client = new FlexiClient(auditStore);
  const telemetry = new ToolTelemetry();
  const catalogCache = new TtlCache<ReturnType<typeof extractEvidenceList>>(10 * 60 * 1000);
  const propertiesCache = new TtlCache<ReturnType<typeof extractEvidenceProperties>>(10 * 60 * 1000);
  const relationsCache = new TtlCache<ReturnType<typeof extractEvidenceRelations>>(10 * 60 * 1000);
  const referenceCache = new Map<string, TtlCache<Record<string, unknown>[]>>();
  const reportCache = new TtlCache<Record<string, unknown>[]>(2 * 60 * 1000);
  const server = new McpServer(
    { name: "flexi-mcp-harness", version: "0.2.0" },
    { capabilities: { logging: {} } }
  );

  const getProfile = (profileName?: string): ResolvedProfile => resolveProfile(config, profileName);
  const getCompany = (profile: ResolvedProfile, company?: string): string => company ?? profile.company;
  const getFormat = (profile: ResolvedProfile): FlexiFormat => profile.defaultFormat;
  const ensureWritesAllowed = (profile: ResolvedProfile): void => {
    if (profile.writes === "disabled") {
      throw new Error(`Writes are disabled for profile '${profile.name}'.`);
    }
  };

  const registerTool = (
    name: string,
    configShape: any,
    handler: (args: any, extra: any) => Promise<any>
  ): void => {
    (server.registerTool as any)(name, configShape, async (args: any, extra: any) => {
      const startedAt = performance.now();
      const result = await handler(args, extra);
      telemetry.record(name, result.structuredContent ?? null, performance.now() - startedAt);
      return result;
    });
  };

  const getCatalog = async (profile: ResolvedProfile, company: string) =>
    catalogCache.getOrSet(`${profile.name}:${company}:catalog`, async () => {
      const response = await client.request({
        operation: "list_evidence",
        profile,
        company,
        method: "GET",
        path: client.buildCompanyPath(profile, company, "evidence-list"),
        format: getFormat(profile)
      });

      if (!response.ok) {
        throw new Error(summarizeIssues(response, `Failed to load evidence list for company '${company}'.`));
      }

      return extractEvidenceList(response.data);
    });

  const getProperties = async (profile: ResolvedProfile, company: string, evidence: string) =>
    propertiesCache.getOrSet(`${profile.name}:${company}:${evidence}:properties`, async () => {
      const response = await client.request({
        operation: "describe_evidence_properties",
        profile,
        company,
        evidence,
        method: "GET",
        path: client.buildCompanyPath(profile, company, `${evidence}/properties`),
        format: getFormat(profile)
      });

      if (!response.ok) {
        throw new Error(summarizeIssues(response, `Failed to load properties for evidence '${evidence}'.`));
      }

      return extractEvidenceProperties(response.data);
    });

  const getRelations = async (profile: ResolvedProfile, company: string, evidence: string) =>
    relationsCache.getOrSet(`${profile.name}:${company}:${evidence}:relations`, async () => {
      const response = await client.request({
        operation: "describe_evidence_relations",
        profile,
        company,
        evidence,
        method: "GET",
        path: client.buildCompanyPath(profile, company, `${evidence}/relations`),
        format: getFormat(profile)
      });

      if (!response.ok) {
        throw new Error(summarizeIssues(response, `Failed to load relations for evidence '${evidence}'.`));
      }

      return extractEvidenceRelations(response.data);
    });

  const createErrorResult = (
    text: string,
    errorType: string,
    extra: Record<string, unknown> = {}
  ) =>
    createResult(
      text,
      compactRecord({
        ok: false,
        error_type: errorType,
        ...extra
      })
    );

  const buildQueryPath = (profile: ResolvedProfile, company: string | undefined, evidence: string) =>
    client.buildEvidencePath(profile, company, evidence, getFormat(profile), undefined, "query");

  const runQuery = async ({
    profile,
    company,
    evidence,
    fields,
    includes,
    filter,
    limit,
    offset,
    operation
  }: {
    profile: ResolvedProfile;
    company?: string;
    evidence: string;
    fields: string[];
    includes?: string[];
    filter?: string;
    limit: number;
    offset: number;
    operation: string;
  }) => {
    const requestFormat = getFormat(profile);
    const body = JSON.stringify({
      detail: `custom:${fields.join(",")}`,
      start: offset,
      limit: limit + 1,
      filter,
      includes: includes && includes.length > 0 ? includes.join(",") : undefined
    });

    return client.request({
      operation,
      profile,
      company,
      evidence,
      method: "POST",
      path: buildQueryPath(profile, company, evidence),
      format: requestFormat,
      body,
      contentType: "application/json"
    });
  };

  const getReferenceLookupCache = (kind: ReferenceValueKind): TtlCache<Record<string, unknown>[]> => {
    const config = getReferenceValueConfig(kind);
    const existing = referenceCache.get(kind);
    if (existing) {
      return existing;
    }
    const cache = new TtlCache<Record<string, unknown>[]>(config.ttlMs);
    referenceCache.set(kind, cache);
    return cache;
  };

  const logReportTelemetry = (tool: string, details: Record<string, string | number | boolean | undefined>) => {
    const parts = [`[telemetry] tool=${tool}`];
    for (const [key, value] of Object.entries(details)) {
      if (value === undefined) {
        continue;
      }
      parts.push(`${key}=${value}`);
    }
    console.error(parts.join(" "));
  };

  const fetchReportRecords = async ({
    toolName,
    profile,
    company,
    reportKind,
    partnerId,
    date,
    scope,
    limit,
    offset,
    extraQuery
  }: {
    toolName: string;
    profile: ResolvedProfile;
    company: string;
    reportKind: "overdue_report" | "saldo_report" | "saldo_at_date_report";
    partnerId?: string;
    date?: string;
    scope?: OverdueScope;
    limit: number;
    offset: number;
    extraQuery?: Record<string, string | number | boolean | undefined>;
  }): Promise<{
    ok: boolean;
    evidence: string;
    source: "primary";
    records: Array<Record<string, unknown>>;
    response?: NormalizedFlexiResponse & { request_id: string; raw_response_path: string };
  }> => {
    const configForReport = getReportEvidenceConfig(reportKind);
    ensureEvidencePermission(profile, "read", configForReport.evidence);
    const resolvedDate = toIsoDate(date);
    const cacheKey = [
      profile.name,
      company,
      configForReport.evidence,
      resolvedDate,
      partnerId ?? "",
      scope ?? "all",
      String(limit),
      String(offset)
    ].join(":");
    const cached = reportCache.get(cacheKey);

    if (cached !== null) {
      logReportTelemetry(toolName, {
        report_source: "primary",
        report_evidence: configForReport.evidence,
        cache: "hit",
        record_count: cached.length
      });
      return {
        ok: true,
        evidence: configForReport.evidence,
        source: "primary",
        records: cached
      };
    }

    logReportTelemetry(toolName, {
      report_source: "primary",
      report_evidence: configForReport.evidence,
      cache: "miss"
    });

    const response = await client.request({
      operation: `${toolName}_${configForReport.evidence}`,
      profile,
      company,
      evidence: configForReport.evidence,
      method: "GET",
      path: client.buildEvidencePath(
        profile,
        company,
        configForReport.evidence,
        getFormat(profile),
        buildReportSelector(partnerId)
      ),
      format: getFormat(profile),
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
        source: "primary",
        records: [],
        response
      };
    }

    const records = extractRecordList(response.data, configForReport.evidence);
    reportCache.set(cacheKey, records);
    logReportTelemetry(toolName, {
      report_source: "primary",
      report_evidence: configForReport.evidence,
      cache: "miss",
      record_count: records.length
    });

    return {
      ok: true,
      evidence: configForReport.evidence,
      source: "primary",
      records
    };
  };

  const classifyError = (message: string): string => {
    if (/not allowed|writes are disabled|does not match/i.test(message)) {
      return "permission_error";
    }
    if (/unknown|not found|no .*found/i.test(message)) {
      return "not_found";
    }
    if (/unsupported/i.test(message)) {
      return "unsupported_for_kind";
    }
    if (/required|must|empty|invalid|no supported/i.test(message)) {
      return "validation_error";
    }
    if (/failed/i.test(message)) {
      return "transport_error";
    }
    return "backend_error";
  };

  const handleAccountantTool = async (runner: () => Promise<any>) => {
    try {
      return await runner();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResult(message, classifyError(message));
    }
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

  const searchUnpaidDocumentsFallback = async ({
    profile,
    company,
    scope,
    partnerId,
    limit,
    offset,
    toolName
  }: {
    profile: ResolvedProfile;
    company: string;
    scope: OverdueScope;
    partnerId?: string;
    limit: number;
    offset: number;
    toolName: string;
  }) => {
    const kinds: DocumentKind[] =
      scope === "receivables"
        ? ["receivable"]
        : scope === "payables"
          ? ["payable"]
          : ["receivable", "payable"];
    const collected: ReturnType<typeof mapDocumentSearchResults>["records"] = [];
    let hasMore = false;

    for (const kind of kinds) {
      const configForKind = getDocumentKindConfig(kind);
      if (!hasEvidencePermission(profile, "read", configForKind.evidence)) {
        continue;
      }
      const response = await runQuery({
        profile,
        company,
        evidence: configForKind.evidence,
        fields: configForKind.summaryQuery.fields,
        includes: configForKind.summaryQuery.includes,
        filter: buildDocumentSearchFilter(configForKind, {
          partner_id: partnerId,
          unpaid_only: true,
          overdue_only: true
        }),
        limit,
        offset,
        operation: `${toolName}_fallback_${kind}`
      });

      if (!response.ok) {
        continue;
      }

      const result = mapDocumentSearchResults(response.data, configForKind.evidence, kind, limit, offset);
      collected.push(...result.records);
      hasMore = hasMore || result.has_more;
    }

    const records = collected.slice(0, limit).map((record) =>
      compactRecord({
        document_code: record.code,
        document_kind: record.kind === "receivable" || record.kind === "sales_invoice" ? "receivable" : "payable",
        partner_name: record.partner_name,
        due_date: record.due_date,
        remaining_amount: record.remaining_amount,
        currency: record.currency,
        variable_symbol: record.variable_symbol,
        status: record.payment_status ?? record.document_status
      })
    );

    logReportTelemetry(toolName, {
      report_source: "fallback",
      report_evidence: "documents",
      record_count: records.length
    });

    return {
      ok: true,
      source: "fallback" as const,
      records,
      has_more: hasMore || collected.length > limit
    };
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
    profile,
    company,
    kind,
    evidence,
    payload,
    validationOnly = false,
    saveDraftId
  }: {
    profile: ResolvedProfile;
    company?: string;
    kind: string;
    evidence: string;
    payload: string;
    validationOnly?: boolean;
    saveDraftId?: string;
  }) => {
    ensureWritesAllowed(profile);
    ensureEvidencePermission(profile, validationOnly ? "dryRun" : "write", evidence);

    const requestFormat = getFormat(profile);
    const validation = await client.request({
      operation: validationOnly ? `validate_${kind}` : `validate_before_${kind}`,
      profile,
      company,
      evidence,
      method: "POST",
      path: client.buildEvidencePath(profile, company, evidence, requestFormat),
      format: requestFormat,
      body: payload,
      contentType: "application/json",
      query: {
        "dry-run": true
      }
    });

    if (!validation.ok || validationOnly) {
      return {
        validation,
        execution: null
      };
    }

    const execution = await client.request({
      operation: `execute_${kind}`,
      profile,
      company,
      evidence,
      method: "POST",
      path: client.buildEvidencePath(profile, company, evidence, requestFormat),
      format: requestFormat,
      body: payload,
      contentType: "application/json"
    });

    if (execution.ok && saveDraftId) {
      documentDraftStore.save({
        kind,
        evidence,
        id: saveDraftId,
        payload,
        payloadFormat: "json",
        updatedAt: new Date().toISOString()
      });
    }

    return {
      validation,
      execution
    };
  };

  registerTool(
    "flexi_check_connection",
    {
      title: "Check Flexi connection",
      description: "Verify auth and basic company access. Use before the first real workflow.",
      inputSchema: z.object(companyArgsSchema)
    },
    async ({ profile, company }) => {
      const selected = getProfile(profile);
      const selectedCompany = getCompany(selected, company);
      const requestFormat = getFormat(selected);

      const companiesResponse = await client.request({
        operation: "check_connection_list_companies",
        profile: selected,
        method: "GET",
        path: client.buildServerPath(requestFormat),
        format: requestFormat
      });

      const evidenceResponse = await client.request({
        operation: "check_connection_list_evidence",
        profile: selected,
        company: selectedCompany,
        method: "GET",
        path: client.buildCompanyPath(selected, selectedCompany, "evidence-list"),
        format: requestFormat
      });

      const companies = companiesResponse.ok ? mapCompaniesToSummary(companiesResponse.data) : [];
      const evidence = evidenceResponse.ok ? extractEvidenceList(evidenceResponse.data) : [];
      const issues = [...companiesResponse.errors, ...evidenceResponse.errors];
      const ok = companiesResponse.ok && evidenceResponse.ok;
      const text = ok
        ? `Profile ${selected.name} can access ${selectedCompany}.`
        : issues.length > 0
          ? issues.join("; ")
          : `Connection check failed for profile ${selected.name}.`;

      return createResult(
        text,
        compactRecord({
          ok,
          profile: selected.name,
          company: selectedCompany,
          mode: selected.mode,
          writes: selected.writes,
          company_count: companies.length || undefined,
          accessible_companies: companies.slice(0, 5),
          evidence_count: evidence.length || undefined,
          issues: limitedIssues(issues)
        })
      );
    }
  );

  registerTool(
    "flexi_list_profiles",
    {
      title: "List Flexi profiles",
      description: "List configured profiles and their write mode.",
      inputSchema: z.object({})
    },
    async () =>
      createResult("Listed configured profiles.", {
        default_profile: config.defaultProfile,
        profiles: Object.entries(config.profiles).map(([name, profile]) =>
          compactRecord({
            name,
            company: profile.company,
            mode: profile.mode,
            writes: profile.writes,
            default_format: profile.defaultFormat
          })
        )
      })
  );

  registerTool(
    "flexi_list_evidence",
    {
      title: "List evidence",
      description: "Browse evidence catalog with small summaries. Use before search or writes.",
      inputSchema: z.object({
        ...companyArgsSchema,
        query: z.string().trim().max(120).optional(),
        import_mode: z.enum(["supported", "not_direct", "not_documented", "disallowed"]).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).max(500).default(0)
      })
    },
    async ({ profile, company, query, import_mode, limit, offset }) => {
      const selected = getProfile(profile);
      const selectedCompany = getCompany(selected, company);
      const catalog = await getCatalog(selected, selectedCompany);
      const normalizedQuery = query?.toLowerCase();
      const filtered = catalog.filter((item) => {
        if (import_mode && item.import_mode !== import_mode) {
          return false;
        }
        if (!normalizedQuery) {
          return true;
        }
        return [item.path, item.name, item.type]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedQuery));
      });
      const visible = filtered.slice(offset, offset + limit);

      return createResult(
        `Returned ${visible.length} evidence entries.`,
        {
          company: selectedCompany,
          query,
          limit,
          offset,
          returned: visible.length,
          has_more: offset + visible.length < filtered.length,
          evidence: visible.map((item) =>
            compactRecord({
              ...item,
              read_allowed: hasEvidencePermission(selected, "read", item.path),
              dry_run_allowed: hasEvidencePermission(selected, "dryRun", item.path),
              write_allowed: hasEvidencePermission(selected, "write", item.path)
            })
          )
        }
      );
    }
  );

  registerTool(
    "flexi_describe_evidence",
    {
      title: "Describe evidence",
      description: "Show compact schema metadata for one evidence. Detail lists are opt-in.",
      inputSchema: z.object({
        ...evidenceArgsSchema,
        include_fields: z.boolean().default(false),
        include_relations: z.boolean().default(false),
        field_limit: z.number().int().min(1).max(50).default(25)
      })
    },
    async ({ profile, company, evidence, include_fields, include_relations, field_limit }) => {
      const selected = getProfile(profile);
      ensureEvidencePermission(selected, "read", evidence);
      const selectedCompany = getCompany(selected, company);
      const [catalog, properties] = await Promise.all([
        getCatalog(selected, selectedCompany),
        getProperties(selected, selectedCompany, evidence)
      ]);
      const relations = include_relations ? await getRelations(selected, selectedCompany, evidence) : [];
      const evidenceInfo = catalog.find((item) => item.path === evidence);
      const summaryFields = properties.filter((item) => item.summary).map((item) => item.name);
      const writableFields = properties.filter((item) => item.writable).map((item) => item.name);
      const relationFields = properties.filter((item) => item.relation_evidence);

      return createResult(
        `Loaded schema metadata for ${evidence}.`,
        compactRecord({
          evidence,
          name: evidenceInfo?.name ?? evidence,
          import_mode: evidenceInfo?.import_mode,
          supports_external_id: evidenceInfo?.supports_external_id,
          code_lookup_fields: evidenceInfo?.code_lookup_fields,
          counts: {
            total_fields: properties.length,
            summary_fields: summaryFields.length,
            writable_fields: writableFields.length,
            relation_fields: relationFields.length
          },
          summary_fields: summaryFields.slice(0, 12),
          writable_fields: writableFields.slice(0, 12),
          fields: include_fields ? properties.slice(0, field_limit) : undefined,
          relations: include_relations ? relations.slice(0, field_limit) : undefined
        })
      );
    }
  );

  registerTool(
    "flexi_search_records",
    {
      title: "Search records",
      description: "Search one evidence and return short record summaries. Query or filter is required.",
      inputSchema: z
        .object({
          ...evidenceArgsSchema,
          query: z.string().trim().max(120).optional(),
          filter: z.string().trim().max(300).optional(),
          limit: z.number().int().min(1).max(50).default(10),
          offset: z.number().int().min(0).max(1000).default(0)
        })
        .refine((value) => value.query || value.filter, {
          message: "Provide query or filter."
        })
        .refine((value) => !value.query || value.query === "*" || value.query.length >= 2, {
          message: "query must have at least 2 characters unless you use '*'."
        })
    },
    async ({ profile, company, evidence, query, filter, limit, offset }) => {
      const selected = getProfile(profile);
      ensureEvidencePermission(selected, "read", evidence);
      if (query === "*" && !filter && limit > 10) {
        throw new Error("Broad browse queries are limited to 10 records.");
      }

      const response = await client.request({
        operation: "search_records",
        profile: selected,
        company,
        evidence,
        method: "GET",
        path: client.buildEvidencePath(selected, company, evidence, getFormat(selected)),
        format: getFormat(selected),
        query: {
          query,
          filter,
          limit: limit + 1,
          start: offset,
          detail: "summary"
        }
      });

      if (!response.ok) {
        return createResult(
          summarizeIssues(response, `Search failed for ${evidence}.`),
          compactRecord({
            ok: false,
            evidence,
            errors: limitedIssues(response.errors),
            warnings: limitedIssues(response.warnings)
          })
        );
      }

      const result = mapSearchResults(response.data, evidence, limit, offset);
      return createResult(`Found ${result.returned} records in ${evidence}.`, {
        ok: true,
        ...result
      });
    }
  );

  registerTool(
    "flexi_get_record_summary",
    {
      title: "Get record summary",
      description: "Fetch one record with a small business summary.",
      inputSchema: z.object({
        ...evidenceArgsSchema,
        id: z.string().trim().min(1)
      })
    },
    async ({ profile, company, evidence, id }) => {
      const selected = getProfile(profile);
      ensureEvidencePermission(selected, "read", evidence);
      const response = await client.request({
        operation: "get_record_summary",
        profile: selected,
        company,
        evidence,
        method: "GET",
        path: client.buildEvidencePath(selected, company, evidence, getFormat(selected), id),
        format: getFormat(selected),
        query: {
          detail: "summary"
        }
      });

      if (!response.ok) {
        return createResult(
          summarizeIssues(response, `Lookup failed for ${evidence}/${id}.`),
          compactRecord({
            ok: false,
            evidence,
            id,
            errors: limitedIssues(response.errors),
            warnings: limitedIssues(response.warnings)
          })
        );
      }

      const record = mapRecordSummary(response.data, evidence);
      return createResult(
        record ? `Loaded summary for ${record.display_name}.` : `No record found for ${evidence}/${id}.`,
        compactRecord({
          ok: Boolean(record),
          evidence,
          id,
          record: record ?? undefined
        })
      );
    }
  );

  registerTool(
    "flexi_get_record_detail",
    {
      title: "Get record detail",
      description: "Fetch one record detail. Relations and child collections are opt-in.",
      inputSchema: z.object({
        ...evidenceArgsSchema,
        id: z.string().trim().min(1),
        include_relations: z.boolean().default(false),
        include_collections: z.boolean().default(false)
      })
    },
    async ({ profile, company, evidence, id, include_relations, include_collections }) => {
      const selected = getProfile(profile);
      ensureEvidencePermission(selected, "read", evidence);
      const response = await client.request({
        operation: "get_record_detail",
        profile: selected,
        company,
        evidence,
        method: "GET",
        path: client.buildEvidencePath(selected, company, evidence, getFormat(selected), id),
        format: getFormat(selected),
        query: {
          detail: "full"
        }
      });

      if (!response.ok) {
        return createResult(
          summarizeIssues(response, `Detail lookup failed for ${evidence}/${id}.`),
          compactRecord({
            ok: false,
            evidence,
            id,
            errors: limitedIssues(response.errors),
            warnings: limitedIssues(response.warnings)
          })
        );
      }

      const record = mapRecordDetail(response.data, evidence, {
        include_relations,
        include_collections
      });

      return createResult(
        record ? `Loaded detail for ${evidence}/${id}.` : `No record found for ${evidence}/${id}.`,
        compactRecord({
          ok: Boolean(record),
          evidence,
          id,
          record: record ?? undefined
        })
      );
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
      })
    },
    async ({ profile, company, evidence, payload, payload_format, idempotency_key }) => {
      const selected = getProfile(profile);
      ensureEvidencePermission(selected, "dryRun", evidence);
      const requestFormat = getFormat(selected);
      const bodyFormat = detectPayloadFormat(payload_format, payload);
      const response = await client.request({
        operation: "validate_import",
        profile: selected,
        company,
        evidence,
        method: "POST",
        path: client.buildEvidencePath(selected, company, evidence, requestFormat),
        format: requestFormat,
        body: payload,
        contentType: bodyFormat === "json" ? "application/json" : "application/xml",
        query: {
          "dry-run": true,
          idempotencyKey: idempotency_key
        }
      });

      const stats = extractWriteStats(response.data);
      const text = response.ok
        ? `Dry-run passed for ${evidence}.`
        : summarizeIssues(response, `Dry-run failed for ${evidence}.`);

      return createResult(
        text,
        compactRecord({
          ok: response.ok,
          evidence,
          validation_request_id: response.request_id,
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
        idempotency_key: z.string().trim().min(1).optional(),
        validation_request_id: z.string().trim().min(1).optional(),
        override_validation: z.boolean().optional()
      })
    },
    async ({ profile, company, evidence, payload, payload_format, idempotency_key, validation_request_id, override_validation }) => {
      const selected = getProfile(profile);
      ensureWritesAllowed(selected);
      ensureEvidencePermission(selected, "write", evidence);

      if (!validation_request_id && !override_validation) {
        throw new Error("validation_request_id is required unless override_validation=true is allowed.");
      }
      if (override_validation && !selected.allowWriteOverrideWithoutValidation) {
        throw new Error(`override_validation is not allowed for profile '${selected.name}'.`);
      }

      const payloadFormat = detectPayloadFormat(payload_format, payload);
      const confirmation = confirmationStore.create({
        profile: selected.name,
        company: getCompany(selected, company),
        evidence,
        format: getFormat(selected),
        payloadFormat,
        payloadHash: sha256(payload),
        method: "POST",
        idempotencyKey: idempotency_key,
        validationRequestId: validation_request_id,
        overrideValidation: Boolean(override_validation)
      });

      return createResult(
        `Prepared write confirmation for ${evidence}.`,
        compactRecord({
          ok: true,
          evidence,
          status: "ready_for_confirmation",
          confirmation_id: confirmation.confirmationId,
          expires_at: confirmation.expiresAt,
          validation_request_id: validation_request_id ?? undefined
        })
      );
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
      })
    },
    async ({ profile, company, evidence, payload, payload_format, idempotency_key, confirmation_id }) => {
      const selected = getProfile(profile);
      ensureWritesAllowed(selected);
      ensureEvidencePermission(selected, "write", evidence);

      const confirmation = confirmationStore.consume(confirmation_id);
      const payloadHash = sha256(payload);
      const payloadFormat = detectPayloadFormat(payload_format, payload);
      const selectedCompany = getCompany(selected, company);

      if (confirmation.profile !== selected.name) {
        throw new Error("confirmation_id profile does not match the selected profile.");
      }
      if (confirmation.company !== selectedCompany) {
        throw new Error("confirmation_id company does not match the selected company.");
      }
      if (confirmation.evidence !== evidence) {
        throw new Error("confirmation_id evidence does not match.");
      }
      if (confirmation.payloadHash !== payloadHash) {
        throw new Error("Payload hash does not match the prepared write.");
      }
      if (confirmation.payloadFormat !== payloadFormat) {
        throw new Error("Payload format does not match the prepared write.");
      }
      if ((idempotency_key ?? undefined) !== confirmation.idempotencyKey) {
        throw new Error("idempotency_key does not match the prepared write.");
      }

      const response = await client.request({
        operation: "execute_write",
        profile: selected,
        company: selectedCompany,
        evidence,
        method: confirmation.method,
        path: client.buildEvidencePath(selected, selectedCompany, evidence, getFormat(selected)),
        format: getFormat(selected),
        body: payload,
        contentType: payloadFormat === "json" ? "application/json" : "application/xml",
        query: {
          idempotencyKey: idempotency_key
        }
      });

      const stats = extractWriteStats(response.data);
      const record = extractWriteRecord(response.data, evidence);
      const status = response.ok ? "written" : "failed";
      const text = response.ok
        ? record
          ? `Write completed for ${record.display_name}.`
          : `Write completed for ${evidence}.`
        : summarizeIssues(response, `Write failed for ${evidence}.`);

      return createResult(
        text,
        compactRecord({
          ok: response.ok,
          evidence,
          status,
          stats,
          id: record?.id,
          code: record?.code,
          name: record?.name,
          display_name: record?.display_name,
          errors: limitedIssues(response.errors),
          warnings: limitedIssues(response.warnings)
        })
      );
    }
  );

  registerTool(
    "search_partners",
    {
      title: "Search partners",
      description: "Find customers or suppliers and return short partner summaries.",
      inputSchema: z.object({
        ...companyArgsSchema,
        query: z.string().trim().min(2).max(120),
        role: z.enum(["customer", "supplier", "any"]).default("any"),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      })
    },
    async ({ profile, company, query, role, limit, offset }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const specs = getPartnerSearchSpec(role as PartnerRole).filter((spec) =>
          hasEvidencePermission(selected, "read", spec.evidence)
        );

        if (specs.length === 0) {
          return createErrorResult("No partner evidence is allowed for this profile.", "permission_error");
        }

        const aggregated: ReturnType<typeof mapPartnerSearchResults>["records"] = [];
        let remaining = limit;
        let currentOffset = offset;
        let hasMore = false;

        for (const spec of specs) {
          if (remaining <= 0) {
            break;
          }

          const response = await runQuery({
            profile: selected,
            company: selectedCompany,
            evidence: spec.evidence,
            fields: spec.fields,
            includes: spec.evidence === "adresar" ? ["stat"] : undefined,
            filter: buildTextSearchFilter(query, spec.searchFields),
            limit: remaining,
            offset: currentOffset,
            operation: `search_partners_${spec.evidence}`
          });

          if (!response.ok) {
            return createErrorResult(
              summarizeIssues(response, `Partner search failed for ${spec.evidence}.`),
              "backend_error",
              { evidence: spec.evidence }
            );
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
          limit,
          offset,
          returned: Math.min(limit, aggregated.length),
          has_more: hasMore || aggregated.length > limit,
          records: aggregated.slice(0, limit)
        });
      })
  );

  registerTool(
    "get_partner_summary",
    {
      title: "Get partner summary",
      description: "Fetch one partner with a small business summary.",
      inputSchema: z.object({
        ...companyArgsSchema,
        id: z.string().trim().min(1)
      })
    },
    async ({ profile, company, id }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);

        for (const evidence of ["adresar", "dodavatel"]) {
          if (!hasEvidencePermission(selected, "read", evidence)) {
            continue;
          }
          const response = await client.request({
            operation: `get_partner_summary_${evidence}`,
            profile: selected,
            company: selectedCompany,
            evidence,
            method: "GET",
            path: client.buildEvidencePath(selected, selectedCompany, evidence, getFormat(selected), id),
            format: getFormat(selected),
            query: {
              detail: "summary"
            }
          });

          if (!response.ok) {
            continue;
          }
          const record = mapPartnerSummary(response.data, evidence, evidence === "dodavatel" ? "supplier" : "customer");
          if (record) {
            return createResult(`Loaded partner ${record.name}.`, {
              ok: true,
              evidence,
              record
            });
          }
        }

        return createErrorResult(`Partner '${id}' was not found.`, "not_found");
      })
  );

  registerTool(
    "get_partner_detail",
    {
      title: "Get partner detail",
      description: "Fetch one partner detail. Bank accounts and contacts are opt-in.",
      inputSchema: z.object({
        ...companyArgsSchema,
        id: z.string().trim().min(1),
        include_bank_accounts: z.boolean().default(false),
        include_contacts: z.boolean().default(false)
      })
    },
    async ({ profile, company, id, include_bank_accounts, include_contacts }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);

        for (const evidence of ["adresar", "dodavatel"]) {
          if (!hasEvidencePermission(selected, "read", evidence)) {
            continue;
          }
          const response = await client.request({
            operation: `get_partner_detail_${evidence}`,
            profile: selected,
            company: selectedCompany,
            evidence,
            method: "GET",
            path: client.buildEvidencePath(selected, selectedCompany, evidence, getFormat(selected), id),
            format: getFormat(selected),
            query: {
              detail: "full"
            }
          });

          if (!response.ok) {
            continue;
          }
          const summary = mapPartnerSummary(response.data, evidence, evidence === "dodavatel" ? "supplier" : "customer");
          const generic = mapRecordDetail(response.data, evidence, {
            include_relations: include_contacts,
            include_collections: include_bank_accounts || include_contacts
          });
          if (!summary || !generic) {
            continue;
          }

          let bankAccounts: unknown[] | undefined;
          if (include_bank_accounts && hasEvidencePermission(selected, "read", "adresar-bankovni-ucet")) {
            const bankResponse = await runQuery({
              profile: selected,
              company: selectedCompany,
              evidence: "adresar-bankovni-ucet",
              fields: ["id", "kod", "nazev", "buc", "iban", "lastUpdate"],
              filter: `firma eq "${id}"`,
              limit: 10,
              offset: 0,
              operation: "partner_bank_accounts"
            });
            if (bankResponse.ok) {
              bankAccounts = mapReferenceValueResults(bankResponse.data, "adresar-bankovni-ucet", 10, 0).records;
            }
          }

          return createResult(`Loaded detail for partner ${summary.name}.`, compactRecord({
            ok: true,
            evidence,
            record: compactRecord({
              ...summary,
              fields: (generic as Record<string, unknown>).fields,
              contacts: include_contacts ? compactRecord({
                phone: (generic as Record<string, any>).fields?.phone ?? (generic as Record<string, any>).fields?.telefon,
                email: (generic as Record<string, any>).fields?.email,
                city: (generic as Record<string, any>).fields?.city ?? (generic as Record<string, any>).fields?.mesto,
                street: (generic as Record<string, any>).fields?.ulice
              }) : undefined,
              bank_accounts: bankAccounts
            })
          }));
        }

        return createErrorResult(`Partner '${id}' was not found.`, "not_found");
      })
  );

  registerTool(
    "search_products",
    {
      title: "Search products",
      description: "Find products from the price list and return short summaries.",
      inputSchema: z.object({
        ...companyArgsSchema,
        query: z.string().trim().min(2).max(120),
        active_only: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      })
    },
    async ({ profile, company, query, active_only, limit, offset }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const spec = getProductSearchSpec();
        ensureEvidencePermission(selected, "read", spec.evidence);

        const response = await runQuery({
          profile: selected,
          company: selectedCompany,
          evidence: spec.evidence,
          fields: spec.fields,
          filter: combineFilters([
            buildTextSearchFilter(query, spec.searchFields),
            active_only ? '(stavK is null or stavK neq "stavCeniku.neaktivni")' : undefined
          ]),
          limit,
          offset,
          operation: "search_products"
        });

        if (!response.ok) {
          return createErrorResult(summarizeIssues(response, "Product search failed."), "backend_error");
        }

        const result = mapProductSearchResults(response.data, spec.evidence, limit, offset);
        return createResult(`Found ${result.returned} products.`, {
          ok: true,
          ...result
        });
      })
  );

  registerTool(
    "get_product_summary",
    {
      title: "Get product summary",
      description: "Fetch one product from the price list.",
      inputSchema: z.object({
        ...companyArgsSchema,
        id: z.string().trim().min(1)
      })
    },
    async ({ profile, company, id }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const evidence = getProductSearchSpec().evidence;
        ensureEvidencePermission(selected, "read", evidence);

        const response = await client.request({
          operation: "get_product_summary",
          profile: selected,
          company: selectedCompany,
          evidence,
          method: "GET",
          path: client.buildEvidencePath(selected, selectedCompany, evidence, getFormat(selected), id),
          format: getFormat(selected),
          query: {
            detail: "summary"
          }
        });

        if (!response.ok) {
          return createErrorResult(summarizeIssues(response, `Product '${id}' was not found.`), "not_found");
        }

        const record = mapProductSummary(response.data, evidence);
        if (!record) {
          return createErrorResult(`Product '${id}' was not found.`, "not_found");
        }

        return createResult(`Loaded product ${record.name}.`, {
          ok: true,
          record
        });
      })
  );

  registerTool(
    "search_documents",
    {
      title: "Search documents",
      description: "Search accounting documents by business filters and return short summaries.",
      inputSchema: z.object({
        ...companyArgsSchema,
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
      })
    },
    async ({ profile, company, kind, query, partner_id, status, date_from, date_to, due_from, due_to, unpaid_only, overdue_only, limit, offset }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const configForKind = getDocumentKindConfig(kind as DocumentKind);
        ensureEvidencePermission(selected, "read", configForKind.evidence);

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
          return createErrorResult("Provide query or at least one business filter.", "validation_error");
        }

        const response = await runQuery({
          profile: selected,
          company: selectedCompany,
          evidence: configForKind.evidence,
          fields: configForKind.summaryQuery.fields,
          includes: configForKind.summaryQuery.includes,
          filter,
          limit,
          offset,
          operation: `search_documents_${kind}`
        });

        if (!response.ok) {
          return createErrorResult(summarizeIssues(response, `Document search failed for ${kind}.`), "backend_error");
        }

        const result = mapDocumentSearchResults(response.data, configForKind.evidence, kind, limit, offset);
        return createResult(`Found ${result.returned} documents.`, {
          ok: true,
          ...result
        });
      })
  );

  registerTool(
    "get_document_summary",
    {
      title: "Get document summary",
      description: "Fetch one accounting document with a small business summary.",
      inputSchema: z.object({
        ...companyArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1)
      })
    },
    async ({ profile, company, kind, id }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const configForKind = getDocumentKindConfig(kind as DocumentKind);
        ensureEvidencePermission(selected, "read", configForKind.evidence);

        const response = await client.request({
          operation: `get_document_summary_${kind}`,
          profile: selected,
          company: selectedCompany,
          evidence: configForKind.evidence,
          method: "GET",
          path: client.buildEvidencePath(selected, selectedCompany, configForKind.evidence, getFormat(selected), id),
          format: getFormat(selected),
          query: {
            detail: "summary"
          }
        });

        if (!response.ok) {
          return createErrorResult(summarizeIssues(response, `Document '${id}' was not found.`), "not_found");
        }

        const record = mapDocumentSummary(response.data, configForKind.evidence, kind);
        if (!record) {
          return createErrorResult(`Document '${id}' was not found.`, "not_found");
        }

        return createResult(`Loaded ${record.display_name}.`, {
          ok: true,
          record
        });
      })
  );

  registerTool(
    "get_document_detail",
    {
      title: "Get document detail",
      description: "Fetch one accounting document detail. Extra sections are opt-in.",
      inputSchema: z.object({
        ...companyArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1),
        include_items: z.boolean().default(false),
        include_payments: z.boolean().default(false),
        include_accounting: z.boolean().default(false),
        include_links: z.boolean().default(false)
      })
    },
    async ({ profile, company, kind, id, include_items, include_payments, include_accounting, include_links }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const configForKind = getDocumentKindConfig(kind as DocumentKind);
        ensureEvidencePermission(selected, "read", configForKind.evidence);

        const response = await client.request({
          operation: `get_document_detail_${kind}`,
          profile: selected,
          company: selectedCompany,
          evidence: configForKind.evidence,
          method: "GET",
          path: client.buildEvidencePath(selected, selectedCompany, configForKind.evidence, getFormat(selected), id),
          format: getFormat(selected),
          query: {
            detail: "full"
          }
        });

        if (!response.ok) {
          return createErrorResult(summarizeIssues(response, `Document '${id}' was not found.`), "not_found");
        }

        const record = mapDocumentDetail(response.data, configForKind.evidence, kind, {
          include_items,
          include_payments,
          include_accounting,
          include_links,
          item_collection_key: configForKind.itemCollectionKey,
          item_evidence: configForKind.itemEvidence
        });

        if (!record) {
          return createErrorResult(`Document '${id}' was not found.`, "not_found");
        }

        return createResult(`Loaded detail for ${kind}/${id}.`, {
          ok: true,
          record
        });
      })
  );

  registerTool(
    "search_overdue_items",
    {
      title: "Search overdue items",
      description: "List overdue receivables or payables with compact report summaries.",
      inputSchema: z.object({
        ...companyArgsSchema,
        scope: z.enum(["all", "receivables", "payables"]).default("all"),
        partner_id: z.string().trim().max(120).optional(),
        date: z.string().trim().max(32).optional(),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      })
    },
    async ({ profile, company, scope, partner_id, date, limit, offset }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const resolvedDate = toIsoDate(date);
        const primaryEvidence = getReportEvidenceConfig("overdue_report").evidence;

        if (hasEvidencePermission(selected, "read", primaryEvidence)) {
          const primary = await fetchReportRecords({
            toolName: "search_overdue_items",
            profile: selected,
            company: selectedCompany,
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

            if (scoped.length > 0 || !partner_id) {
              return createResult(`Found ${Math.min(scoped.length, limit)} overdue items.`, {
                ok: true,
                scope,
                date: resolvedDate,
                limit,
                offset,
                returned: Math.min(scoped.length, limit),
                has_more: mapped.has_more || scoped.length > limit,
                records: scoped.slice(0, limit)
              });
            }
          }
        }

        const fallback = await searchUnpaidDocumentsFallback({
          profile: selected,
          company: selectedCompany,
          scope: scope as OverdueScope,
          partnerId: partner_id,
          limit,
          offset,
          toolName: "search_overdue_items"
        });

        return createResult(`Found ${fallback.records.length} overdue items.`, {
          ok: true,
          scope,
          date: resolvedDate,
          limit,
          offset,
          returned: fallback.records.length,
          has_more: fallback.has_more,
          records: fallback.records
        });
      })
  );

  registerTool(
    "get_partner_balance_summary",
    {
      title: "Get partner balance summary",
      description: "Return compact saldo totals for one partner.",
      inputSchema: z.object({
        ...companyArgsSchema,
        partner_id: z.string().trim().min(1),
        date: z.string().trim().max(32).optional()
      })
    },
    async ({ profile, company, partner_id, date }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const resolvedDate = toIsoDate(date);
        const attempts: Array<"saldo_at_date_report" | "saldo_report"> = ["saldo_at_date_report", "saldo_report"];

        for (const reportKind of attempts) {
          const reportConfig = getReportEvidenceConfig(reportKind);
          if (!hasEvidencePermission(selected, "read", reportConfig.evidence)) {
            continue;
          }

          const primary = await fetchReportRecords({
            toolName: "get_partner_balance_summary",
            profile: selected,
            company: selectedCompany,
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

          if (!primary.ok) {
            continue;
          }

          const summary = buildPartnerBalanceFromRecords(primary.records, partner_id, resolvedDate, primary.evidence);
          if (!summary) {
            continue;
          }

          return createResult(`Loaded partner balance for ${summary.partner_name ?? partner_id}.`, {
            ok: true,
            report_source: reportKind === "saldo_at_date_report" ? "primary" : "fallback",
            record: summary
          });
        }

        return createErrorResult(`No saldo data found for partner '${partner_id}'.`, "not_found");
      })
  );

  registerTool(
    "search_unpaid_documents",
    {
      title: "Search unpaid documents",
      description: "Find unpaid or overdue receivables and payables with compact summaries.",
      inputSchema: z.object({
        ...companyArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable"]),
        partner_id: z.string().trim().max(120).optional(),
        overdue_only: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      })
    },
    async ({ profile, company, kind, partner_id, overdue_only, limit, offset }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const configForKind = getDocumentKindConfig(kind as DocumentKind);
        ensureEvidencePermission(selected, "read", configForKind.evidence);

        const filter = buildDocumentSearchFilter(configForKind, {
          partner_id,
          unpaid_only: true,
          overdue_only
        });

        const response = await runQuery({
          profile: selected,
          company: selectedCompany,
          evidence: configForKind.evidence,
          fields: configForKind.summaryQuery.fields,
          includes: configForKind.summaryQuery.includes,
          filter,
          limit,
          offset,
          operation: `search_unpaid_documents_${kind}`
        });

        if (!response.ok) {
          return createErrorResult(summarizeIssues(response, `Unpaid search failed for ${kind}.`), "backend_error");
        }

        const result = mapDocumentSearchResults(response.data, configForKind.evidence, kind, limit, offset);
        return createResult(`Found ${result.returned} unpaid documents.`, {
          ok: true,
          ...result
        });
      })
  );

  registerTool(
    "get_accounting_overview",
    {
      title: "Get accounting overview",
      description: "Return a compact dashboard for unpaid receivables and payables.",
      inputSchema: z.object({
        ...companyArgsSchema,
        date: z.string().trim().max(32).optional(),
        include_overdue: z.boolean().default(true)
      })
    },
    async ({ profile, company, date, include_overdue }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const snapshotDate = toIsoDate(date);

        const buildOverviewFallback = async (kind: DocumentKind) => {
          const configForKind = getDocumentKindConfig(kind);
          if (!hasEvidencePermission(selected, "read", configForKind.evidence)) {
            return { kind, records: [] as any[] };
          }
          const response = await runQuery({
            profile: selected,
            company: selectedCompany,
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

          if (!response.ok) {
            return { kind, records: [] as any[] };
          }

          return {
            kind,
            records: mapDocumentSearchResults(response.data, configForKind.evidence, kind, 100, 0).records
          };
        };

        const overdueEvidence = getReportEvidenceConfig("overdue_report").evidence;
        if (include_overdue && hasEvidencePermission(selected, "read", overdueEvidence)) {
          const primary = await fetchReportRecords({
            toolName: "get_accounting_overview",
            profile: selected,
            company: selectedCompany,
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
            const receivableTotals = {
              count: receivableRecords.length,
              total_amount: receivableRecords
                .reduce((sum, item) => sum + Number(item.remaining_amount ?? 0), 0)
                .toFixed(2),
              remaining_amount: receivableRecords
                .reduce((sum, item) => sum + Number(item.remaining_amount ?? 0), 0)
                .toFixed(2)
            };
            const payableTotals = {
              count: payableRecords.length,
              total_amount: payableRecords.reduce((sum, item) => sum + Number(item.remaining_amount ?? 0), 0).toFixed(2),
              remaining_amount: payableRecords
                .reduce((sum, item) => sum + Number(item.remaining_amount ?? 0), 0)
                .toFixed(2)
            };

            return createResult("Loaded accounting overview.", {
              ok: true,
              date: snapshotDate,
              report_source: "primary",
              receivables: compactRecord({
                ...receivableTotals,
                highlights: receivableRecords.slice(0, 5)
              }),
              payables: compactRecord({
                ...payableTotals,
                highlights: payableRecords.slice(0, 5)
              })
            });
          }
        }

        const [receivables, payables] = await Promise.all([
          buildOverviewFallback("receivable"),
          buildOverviewFallback("payable")
        ]);

        const receivableTotals = aggregateDocumentOverview(receivables.records);
        const payableTotals = aggregateDocumentOverview(payables.records);

        return createResult("Loaded accounting overview.", {
          ok: true,
          date: snapshotDate,
          report_source: "fallback",
          receivables: compactRecord({
            ...receivableTotals,
            highlights: receivables.records.slice(0, 5)
          }),
          payables: compactRecord({
            ...payableTotals,
            highlights: payables.records.slice(0, 5)
          })
        });
      })
  );

  registerTool(
    "search_reference_values",
    {
      title: "Search reference values",
      description: "Search compact lookup values such as document types, payment methods, or centers.",
      inputSchema: z.object({
        ...companyArgsSchema,
        kind: z.enum(["document_type", "payment_method", "bank_account", "cash_register", "center", "project", "activity", "country", "vat_code"]),
        query: z.string().trim().max(120).optional(),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(1000).default(0)
      })
    },
    async ({ profile, company, kind, query, limit, offset }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const refConfig = getReferenceValueConfig(kind as ReferenceValueKind);
        ensureEvidencePermission(selected, "read", refConfig.evidence);

        const cache = getReferenceLookupCache(kind as ReferenceValueKind);
        const cacheKey = `${selected.name}:${selectedCompany}:${kind}`;
        let records = cache.get(cacheKey);

        if (records !== null) {
          console.error(`[telemetry] tool=search_reference_values lookup_kind=${kind} cache=hit`);
        } else {
          console.error(`[telemetry] tool=search_reference_values lookup_kind=${kind} cache=miss`);
          const response = await runQuery({
            profile: selected,
            company: selectedCompany,
            evidence: refConfig.evidence,
            fields: refConfig.fields,
            filter: undefined,
            limit: 200,
            offset: 0,
            operation: `reference_values_${kind}`
          });
          if (!response.ok) {
            throw new Error(summarizeIssues(response, `Lookup failed for ${kind}.`));
          }
          records = cache.set(
            cacheKey,
            mapReferenceValueResults(response.data, refConfig.evidence, 200, 0).records as unknown as Record<string, unknown>[]
          );
        }

        const normalizedQuery = query?.toLowerCase();
        const filtered = records.filter((record) => {
          if (!normalizedQuery) {
            return true;
          }
          return Object.values(record).some((value) =>
            typeof value === "string" ? value.toLowerCase().includes(normalizedQuery) : false
          );
        });
        const visible = filtered.slice(offset, offset + limit);

        return createResult(`Found ${visible.length} reference values.`, {
          ok: true,
          kind,
          limit,
          offset,
          returned: visible.length,
          has_more: offset + visible.length < filtered.length,
          records: visible
        });
      })
  );

  registerTool(
    "create_document_draft",
    {
      title: "Create document draft",
      description: "Create a draft accounting document and return a short confirmation payload.",
      inputSchema: z.object({
        ...companyArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        partner_id: z.string().trim().min(1),
        document_type_id: z.string().trim().min(1).optional(),
        issue_date: z.string().trim().max(32).optional(),
        due_date: z.string().trim().max(32).optional(),
        tax_date: z.string().trim().max(32).optional(),
        currency: z.string().trim().max(32).optional(),
        payment_method_id: z.string().trim().max(120).optional(),
        note: z.string().trim().max(500).optional(),
        items: z
          .array(
            z.object({
              product_id: z.string().trim().max(120).optional(),
              product_code: z.string().trim().max(120).optional(),
              text: z.string().trim().max(255).optional(),
              quantity: z.number().positive(),
              unit_price: z.number().nonnegative().optional(),
              vat_code: z.string().trim().max(120).optional(),
              vat_rate: z.number().nonnegative().optional()
            })
          )
          .default([])
      })
    },
    async ({ profile, company, ...input }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const configForKind = getDocumentKindConfig(input.kind as DocumentKind);
        const built = buildCreateDocumentPayload(input as CreateDocumentDraftInput);
        const result = await executeAccountantWrite({
          profile: selected,
          company: selectedCompany,
          kind: input.kind,
          evidence: built.evidence,
          payload: built.payload
        });

        if (!result.validation.ok) {
          return createErrorResult(summarizeIssues(result.validation, `Validation failed for ${input.kind}.`), "validation_error");
        }
        if (!result.execution || !result.execution.ok) {
          return createErrorResult(summarizeIssues(result.execution ?? result.validation, `Write failed for ${input.kind}.`), "backend_error");
        }

        const record = extractWriteRecord(result.execution.data, configForKind.evidence);
        if (record?.id) {
          documentDraftStore.save({
            kind: input.kind,
            evidence: configForKind.evidence,
            id: record.id,
            payload: built.payload,
            payloadFormat: "json",
            updatedAt: new Date().toISOString()
          });
        }

        return createResult(`Created draft ${record?.display_name ?? input.kind}.`, compactRecord({
          ok: true,
          kind: input.kind,
          id: record?.id,
          code: record?.code,
          status: "draft",
          validation_request_id: result.validation.request_id
        }));
      })
  );

  registerTool(
    "update_document_header",
    {
      title: "Update document header",
      description: "Update common header fields on one accounting document.",
      inputSchema: z.object({
        ...companyArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1),
        changes: z.record(z.any())
      })
    },
    async ({ profile, company, kind, id, changes }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const configForKind = getDocumentKindConfig(kind as DocumentKind);
        const built = buildDocumentHeaderUpdatePayload(kind as DocumentKind, id, changes);
        const result = await executeAccountantWrite({
          profile: selected,
          company: selectedCompany,
          kind,
          evidence: built.evidence,
          payload: built.payload
        });

        if (!result.validation.ok) {
          return createErrorResult(summarizeIssues(result.validation, `Header validation failed for ${kind}/${id}.`), "validation_error");
        }
        if (!result.execution || !result.execution.ok) {
          return createErrorResult(summarizeIssues(result.execution ?? result.validation, `Header update failed for ${kind}/${id}.`), "backend_error");
        }

        documentDraftStore.save({
          kind,
          evidence: configForKind.evidence,
          id,
          payload: built.payload,
          payloadFormat: "json",
          updatedAt: new Date().toISOString()
        });

        const record = extractWriteRecord(result.execution.data, configForKind.evidence);
        return createResult(`Updated header for ${record?.display_name ?? `${kind}/${id}`}.`, compactRecord({
          ok: true,
          kind,
          id: record?.id ?? id,
          code: record?.code,
          status: "updated",
          validation_request_id: result.validation.request_id
        }));
      })
  );

  registerTool(
    "update_document_items",
    {
      title: "Update document items",
      description: "Replace all items on one accounting document.",
      inputSchema: z.object({
        ...companyArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1),
        items: z
          .array(
            z.object({
              product_id: z.string().trim().max(120).optional(),
              product_code: z.string().trim().max(120).optional(),
              text: z.string().trim().max(255).optional(),
              quantity: z.number().positive(),
              unit_price: z.number().nonnegative().optional(),
              vat_code: z.string().trim().max(120).optional(),
              vat_rate: z.number().nonnegative().optional()
            })
          )
          .min(1)
      })
    },
    async ({ profile, company, kind, id, items }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const configForKind = getDocumentKindConfig(kind as DocumentKind);
        const built = buildDocumentItemsUpdatePayload(kind as DocumentKind, id, items as DocumentItemInput[]);
        const result = await executeAccountantWrite({
          profile: selected,
          company: selectedCompany,
          kind,
          evidence: built.evidence,
          payload: built.payload
        });

        if (!result.validation.ok) {
          return createErrorResult(summarizeIssues(result.validation, `Item validation failed for ${kind}/${id}.`), "validation_error");
        }
        if (!result.execution || !result.execution.ok) {
          return createErrorResult(summarizeIssues(result.execution ?? result.validation, `Item update failed for ${kind}/${id}.`), "backend_error");
        }

        documentDraftStore.save({
          kind,
          evidence: configForKind.evidence,
          id,
          payload: built.payload,
          payloadFormat: "json",
          updatedAt: new Date().toISOString()
        });

        const record = extractWriteRecord(result.execution.data, configForKind.evidence);
        return createResult(`Replaced items for ${record?.display_name ?? `${kind}/${id}`}.`, compactRecord({
          ok: true,
          kind,
          id: record?.id ?? id,
          code: record?.code,
          status: "updated",
          validation_request_id: result.validation.request_id
        }));
      })
  );

  registerTool(
    "validate_document",
    {
      title: "Validate document",
      description: "Dry-run validate the latest stored draft snapshot for one document.",
      inputSchema: z.object({
        ...companyArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1).optional()
      })
    },
    async ({ profile, company, kind, id }) =>
      handleAccountantTool(async () => {
        if (!id) {
          return createErrorResult("id is required for validate_document.", "validation_error");
        }
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const storedDraft = documentDraftStore.get(kind, id);
        if (!storedDraft) {
          return createErrorResult(`No stored draft snapshot found for ${kind}/${id}.`, "not_found");
        }

        const result = await executeAccountantWrite({
          profile: selected,
          company: selectedCompany,
          kind,
          evidence: storedDraft.evidence,
          payload: storedDraft.payload,
          validationOnly: true
        });

        return createResult(
          result.validation.ok ? `Validation passed for ${kind}/${id}.` : summarizeIssues(result.validation, `Validation failed for ${kind}/${id}.`),
          compactRecord({
            ok: result.validation.ok,
            kind,
            id,
            validation_request_id: result.validation.request_id,
            errors: limitedIssues(result.validation.errors),
            warnings: limitedIssues(result.validation.warnings),
            stats: extractWriteStats(result.validation.data)
          })
        );
      })
  );

  registerTool(
    "post_document",
    {
      title: "Post document",
      description: "Finalize a supported accounting document by locking it.",
      inputSchema: z.object({
        ...companyArgsSchema,
        kind: z.enum(["sales_invoice", "purchase_invoice", "receivable", "payable", "bank", "cash", "internal"]),
        id: z.string().trim().min(1)
      })
    },
    async ({ profile, company, kind, id }) =>
      handleAccountantTool(async () => {
        const selected = getProfile(profile);
        const selectedCompany = getCompany(selected, company);
        const configForKind = getDocumentKindConfig(kind as DocumentKind);
        if (!configForKind.postMode) {
          return createErrorResult(`Posting is not supported for kind '${kind}'.`, "unsupported_for_kind");
        }

        const built = buildPostDocumentPayload(kind as DocumentKind, id);
        const result = await executeAccountantWrite({
          profile: selected,
          company: selectedCompany,
          kind,
          evidence: built.evidence,
          payload: built.payload
        });

        if (!result.validation.ok) {
          return createErrorResult(summarizeIssues(result.validation, `Post validation failed for ${kind}/${id}.`), "validation_error");
        }
        if (!result.execution || !result.execution.ok) {
          return createErrorResult(summarizeIssues(result.execution ?? result.validation, `Post failed for ${kind}/${id}.`), "backend_error");
        }

        documentDraftStore.remove(kind, id);
        const record = extractWriteRecord(result.execution.data, configForKind.evidence);
        return createResult(`Posted ${record?.display_name ?? `${kind}/${id}`}.`, compactRecord({
          ok: true,
          kind,
          id: record?.id ?? id,
          code: record?.code,
          status: "posted",
          validation_request_id: result.validation.request_id
        }));
      })
  );

  registerTool(
    "flexi_explain_last_error",
    {
      title: "Explain last error",
      description: "Summarize the latest failed request from the audit log.",
      inputSchema: z.object({})
    },
    async () => {
      const entry = auditStore.findLatestError();
      if (!entry) {
        return createResult("No failed Flexi request found in the audit log.", {
          found: false
        });
      }

      const summary = entry.error
        ? `Transport failure during ${entry.operation}: ${entry.error}`
        : entry.parsed_errors && entry.parsed_errors.length > 0
          ? `Flexi returned business errors for ${entry.operation}: ${entry.parsed_errors.join("; ")}`
          : `Flexi returned HTTP ${entry.response_status ?? "unknown"} during ${entry.operation}.`;

      return createResult(
        summary,
        compactRecord({
          found: true,
          summary,
          request_id: entry.request_id,
          profile: entry.profile,
          company: entry.company ?? undefined,
          evidence: entry.evidence ?? undefined,
          operation: entry.operation,
          response_status: entry.response_status ?? undefined,
          errors: limitedIssues(entry.parsed_errors ?? []),
          log_path: resolve(config.logDirectory, `${entry.request_id}.json`)
        })
      );
    }
  );

  return server;
}

export async function runServer(configPath?: string): Promise<void> {
  const server = createServer(configPath);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Flexi MCP harness running on stdio");
}

export { createServer };
