import type { AuditStore } from "./audit.js";
import { normalizeFlexiResponse } from "./flexi-response.js";
import type {
  AuditEntry,
  FlexiBinaryResponse,
  FlexiFormat,
  FlexiRequestOptions,
  NormalizedFlexiResponse,
  ResolvedProfile
} from "./types.js";
import {
  buildBasicAuthHeader,
  buildQueryString,
  joinUrl,
  maskSecrets,
  newRequestId,
  redactHeaders,
  toHeaderRecord
} from "./utils.js";

export class FlexiClient {
  constructor(private readonly auditStore: AuditStore) {}

  buildServerPath(format: FlexiFormat, suffix = "c"): string {
    return `/${suffix.replace(/^\/+/, "")}.${format}`;
  }

  buildCompanyPath(profile: ResolvedProfile, company: string | undefined, suffix: string): string {
    const selectedCompany = company ?? profile.company;
    if (!selectedCompany?.trim()) {
      throw new Error("Missing company slug for this Flexi request.");
    }
    return `/c/${selectedCompany}/${suffix.replace(/^\//, "")}`;
  }

  buildEvidencePath(
    profile: ResolvedProfile,
    company: string | undefined,
    evidence: string,
    format: FlexiFormat,
    recordId?: string,
    suffix?: string
  ): string {
    const segments = [evidence];
    if (recordId) {
      segments.push(recordId);
    }
    if (suffix) {
      segments.push(suffix);
    }
    const base = this.buildCompanyPath(profile, company, segments.join("/"));
    return `${base}.${format}`;
  }

  async request(options: FlexiRequestOptions & { operation: string; evidence?: string; company?: string }): Promise<NormalizedFlexiResponse & { request_id: string; raw_response_path: string }> {
    const requestId = newRequestId();
    const startedAt = Date.now();
    const query = { ...(options.query ?? {}) };
    if (options.method !== "GET" && query.auth === undefined) {
      query.auth = "http";
    }
    const url = joinUrl(options.profile.baseUrl, `${options.path}${buildQueryString(query)}`);
    const headers: Record<string, string> = {
      Accept: options.format === "json" ? "application/json" : "application/xml",
      Authorization: buildBasicAuthHeader(options.profile.username, options.profile.password)
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = options.contentType ?? (options.format === "json" ? "application/json" : "application/xml");
    }

    const auditEntry: AuditEntry = {
      request_id: requestId,
      created_at: new Date().toISOString(),
      profile: options.profile.name,
      company: options.company ?? null,
      evidence: options.evidence,
      operation: options.operation,
      method: options.method,
      path: options.path,
      format: options.format,
      query,
      request_headers: redactHeaders(headers),
      request_body: maskSecrets(options.body)
    };
    const rawResponsePath = this.auditStore.save(auditEntry);

    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body,
        redirect: options.method === "GET" ? "follow" : "manual"
      });
      const raw = await response.text();
      const normalized = normalizeFlexiResponse(options.format, response.status, raw, toHeaderRecord(response.headers));
      const durationMs = Date.now() - startedAt;
      const responseBytes = Buffer.byteLength(raw, "utf8");

      this.auditStore.update(requestId, (entry) => ({
        ...entry,
        response_status: response.status,
        response_headers: redactHeaders(normalized.headers),
        response_body: maskSecrets(raw),
        parsed_messages: normalized.messages,
        parsed_errors: normalized.errors,
        metadata: {
          duration_ms: durationMs,
          response_bytes: responseBytes
        }
      }));

      return {
        ...normalized,
        request_id: requestId,
        raw_response_path: rawResponsePath
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      this.auditStore.update(requestId, (entry) => ({
        ...entry,
        error: message,
        metadata: {
          duration_ms: durationMs
        }
      }));
      throw new Error(`Flexi request failed: ${message}`);
    }
  }

  async requestBinary(options: Omit<FlexiRequestOptions, "format" | "body" | "contentType"> & { operation: string; evidence?: string; company?: string }): Promise<FlexiBinaryResponse> {
    const requestId = newRequestId();
    const startedAt = Date.now();
    const query = { ...(options.query ?? {}) };
    const url = joinUrl(options.profile.baseUrl, `${options.path}${buildQueryString(query)}`);
    const headers: Record<string, string> = {
      Accept: "application/pdf",
      Authorization: buildBasicAuthHeader(options.profile.username, options.profile.password)
    };

    const auditEntry: AuditEntry = {
      request_id: requestId,
      created_at: new Date().toISOString(),
      profile: options.profile.name,
      company: options.company ?? null,
      evidence: options.evidence,
      operation: options.operation,
      method: options.method,
      path: options.path,
      format: options.profile.defaultFormat,
      query,
      request_headers: redactHeaders(headers)
    };
    const rawResponsePath = this.auditStore.save(auditEntry);

    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        redirect: options.method === "GET" ? "follow" : "manual"
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      const durationMs = Date.now() - startedAt;
      const contentType = response.headers.get("content-type");

      this.auditStore.update(requestId, (entry) => ({
        ...entry,
        response_status: response.status,
        response_headers: redactHeaders(toHeaderRecord(response.headers)),
        response_body: contentType?.includes("application/pdf")
          ? `<binary ${buffer.length} bytes: ${contentType}>`
          : maskSecrets(buffer.toString("utf8")),
        metadata: {
          duration_ms: durationMs,
          response_bytes: buffer.length
        }
      }));

      return {
        ok: response.ok && (contentType?.includes("application/pdf") ?? false),
        http_status: response.status,
        headers: toHeaderRecord(response.headers),
        buffer,
        content_type: contentType,
        content_length: buffer.length,
        request_id: requestId,
        raw_response_path: rawResponsePath
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      this.auditStore.update(requestId, (entry) => ({
        ...entry,
        error: message,
        metadata: {
          duration_ms: durationMs
        }
      }));
      throw new Error(`Flexi request failed: ${message}`);
    }
  }
}
