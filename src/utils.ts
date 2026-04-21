import type { FlexiQueryValue } from "./types.js";
import { createHash, randomUUID } from "node:crypto";

export function buildBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function buildQueryString(
  query: Record<string, FlexiQueryValue | undefined> | undefined
): string {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      params.append(key, String(item));
    }
  }

  const text = params.toString();
  return text ? `?${text}` : "";
}

export function joinUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

export function toHeaderRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted = { ...headers };
  for (const key of Object.keys(redacted)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower.includes("password") || lower.includes("token")) {
      redacted[key] = "***REDACTED***";
    }
  }
  return redacted;
}

export function maskSecrets(input: string | undefined): string | undefined {
  if (!input) {
    return input;
  }
  return input
    .replace(/("password"\s*:\s*")[^"]+(")/gi, "$1***REDACTED***$2")
    .replace(/(<password>)[^<]+(<\/password>)/gi, "$1***REDACTED***$2")
    .replace(/(heslo=)[^&\s]+/gi, "$1***REDACTED***");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newRequestId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function summarizeArray(values: string[], fallback: string): string {
  return values.length > 0 ? values.join("; ") : fallback;
}
