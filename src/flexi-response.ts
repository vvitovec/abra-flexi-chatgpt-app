import { XMLParser } from "fast-xml-parser";
import type { FlexiCompanyRecord, FlexiFormat, NormalizedFlexiResponse } from "./types.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: true
});

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function collectStrings(value: unknown): string[] {
  return asArray(value)
    .flatMap((item) => {
      if (typeof item === "string") {
        return [item];
      }
      if (item && typeof item === "object") {
        return Object.values(item as Record<string, unknown>).flatMap(collectStrings);
      }
      if (typeof item === "number" || typeof item === "boolean") {
        return [String(item)];
      }
      return [];
    })
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function collectFieldValues(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFieldValues(item, fieldName));
  }
  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const direct = fieldName in record ? collectStrings(record[fieldName]) : [];
  return direct.concat(Object.values(record).flatMap((item) => collectFieldValues(item, fieldName)));
}

function collectErrorMessages(value: unknown, inErrorContext = false): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => collectErrorMessages(item, inErrorContext)));
  }
  if (typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const nextInErrorContext = inErrorContext || "error" in record || "errors" in record || "code" in record || "messageCode" in record || "for" in record;

  return uniqueStrings([
    ...(nextInErrorContext && "message" in record ? collectStrings(record.message) : []),
    ...("error" in record ? collectStrings(record.error) : []),
    ...("errors" in record ? collectErrorMessages(record.errors, true) : []),
    ...("results" in record ? collectErrorMessages(record.results, inErrorContext) : [])
  ]);
}

function extractSuccess(data: unknown): string | boolean | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const root = data as Record<string, unknown>;
  const winstrom = (root.winstrom as Record<string, unknown> | undefined) ?? root;
  const success = winstrom.success;
  if (typeof success === "string" || typeof success === "boolean") {
    return success;
  }
  return null;
}

function extractMessages(data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const root = data as Record<string, unknown>;
  const winstrom = (root.winstrom as Record<string, unknown> | undefined) ?? root;
  const messageFields = [winstrom.message, winstrom.messages, winstrom.result];
  return uniqueStrings(messageFields.flatMap(collectStrings));
}

function extractErrors(data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const root = data as Record<string, unknown>;
  const winstrom = (root.winstrom as Record<string, unknown> | undefined) ?? root;
  const explicitErrors = collectErrorMessages(winstrom);
  if (explicitErrors.length > 0) {
    return explicitErrors;
  }

  const success = extractSuccess(data);
  return success === false || success === "false"
    ? uniqueStrings([winstrom.message, collectFieldValues(winstrom.results, "message")].flatMap(collectStrings))
    : [];
}

function extractWarnings(data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const root = data as Record<string, unknown>;
  const winstrom = (root.winstrom as Record<string, unknown> | undefined) ?? root;
  return [winstrom.warning, winstrom.warnings].flatMap(collectStrings);
}

export function parseResponseBody(format: FlexiFormat, raw: string): unknown {
  if (!raw) {
    return null;
  }
  return format === "json" ? (JSON.parse(raw) as unknown) : xmlParser.parse(raw);
}

export function normalizeFlexiResponse(
  format: FlexiFormat,
  httpStatus: number,
  raw: string,
  headers: Record<string, string>
): NormalizedFlexiResponse {
  let data: unknown = null;
  let parseError: string | null = null;

  try {
    data = parseResponseBody(format, raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const contentType = headers["content-type"] ?? "unknown";
    const trimmed = raw.trimStart();
    parseError = /^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)
      ? `Flexi returned HTML instead of ${format.toUpperCase()} (${contentType}). Check auth mode, redirects, or endpoint format.`
      : `Failed to parse ${format.toUpperCase()} response (${contentType}): ${message}`;
  }

  if (parseError) {
    return {
      ok: false,
      http_status: httpStatus,
      flexi_success: null,
      parse_error: parseError,
      messages: [],
      errors: [parseError],
      warnings: [],
      data: null,
      raw,
      format,
      headers
    };
  }

  const flexiSuccess = extractSuccess(data);
  const errors = extractErrors(data);
  const messages = extractMessages(data);
  const warnings = extractWarnings(data);
  const ok = httpStatus >= 200 && httpStatus < 300 && errors.length === 0 && flexiSuccess !== false && flexiSuccess !== "false";

  return {
    ok,
    http_status: httpStatus,
    flexi_success: flexiSuccess,
    parse_error: null,
    messages,
    errors,
    warnings,
    data,
    raw,
    format,
    headers
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function extractCompanies(data: unknown): FlexiCompanyRecord[] {
  const root = toRecord(data);
  if (!root) {
    return [];
  }

  const companiesContainer = toRecord(root.companies) ?? root;
  const rawCompanies = asArray(companiesContainer.company ?? companiesContainer.companies ?? root.company);

  const companies: FlexiCompanyRecord[] = [];

  for (const item of rawCompanies) {
    const record = toRecord(item);
    if (!record) {
      continue;
    }

    companies.push({
      id: record.id === undefined ? null : (record.id as string | number | null),
      dbNazev: toNullableString(record.dbNazev),
      nazev: toNullableString(record.nazev),
      show: toNullableBoolean(record.show),
      stavEnum: toNullableString(record.stavEnum),
      watchingChanges: toNullableBoolean(record.watchingChanges),
      createDt: toNullableString(record.createDt)
    });
  }

  return companies;
}
