export type FlexiFormat = "json" | "xml";
export type ProfileMode = "test" | "prod";
export type WritePolicy = "disabled" | "confirm";
export type EvidencePermissionScope = "read" | "dryRun" | "write";

export interface FlexiEvidencePermissions {
  read?: string[];
  dryRun?: string[];
  write?: string[];
}

export interface FlexiProfileConfig {
  baseUrl: string;
  company: string;
  mode: ProfileMode;
  writes: WritePolicy;
  defaultFormat: FlexiFormat;
  usernameEnv: string;
  passwordEnv: string;
  allowWriteOverrideWithoutValidation?: boolean;
  permissions?: FlexiEvidencePermissions;
}

export interface FlexiHarnessConfig {
  defaultProfile: string;
  logDirectory: string;
  confirmationTtlSeconds: number;
  profiles: Record<string, FlexiProfileConfig>;
}

export interface ResolvedProfile extends FlexiProfileConfig {
  name: string;
  username: string;
  password: string;
}

export interface FlexiRequestOptions {
  profile: ResolvedProfile;
  method: "GET" | "POST" | "PUT";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  format: FlexiFormat;
  body?: string;
  contentType?: string;
}

export interface NormalizedFlexiResponse {
  [key: string]: unknown;
  ok: boolean;
  http_status: number;
  flexi_success: string | boolean | null;
  parse_error?: string | null;
  messages: string[];
  errors: string[];
  warnings: string[];
  data: unknown;
  raw: string;
  format: FlexiFormat;
  headers: Record<string, string>;
}

export interface AuditEntry {
  request_id: string;
  created_at: string;
  profile: string;
  company?: string | null;
  evidence?: string;
  operation: string;
  method: "GET" | "POST" | "PUT";
  path: string;
  format: FlexiFormat;
  query: Record<string, string | number | boolean | undefined>;
  request_headers: Record<string, string>;
  request_body?: string;
  response_status?: number;
  response_headers?: Record<string, string>;
  response_body?: string;
  parsed_messages?: string[];
  parsed_errors?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface ConfirmationRecord {
  confirmationId: string;
  createdAt: string;
  expiresAt: string;
  profile: string;
  company: string;
  evidence: string;
  format: FlexiFormat;
  payloadFormat: FlexiFormat;
  payloadHash: string;
  method: "POST" | "PUT";
  idempotencyKey?: string;
  validationRequestId?: string;
  overrideValidation: boolean;
}

export interface ToolBaseArgs {
  profile?: string;
  company?: string;
  evidence?: string;
  format?: FlexiFormat;
}

export interface WriteToolArgs extends ToolBaseArgs {
  evidence: string;
  payload: string;
  payload_format?: FlexiFormat;
  idempotency_key?: string;
}

export interface FlexiCompanyRecord {
  id?: string | number | null;
  dbNazev?: string | null;
  nazev?: string | null;
  show?: boolean | null;
  stavEnum?: string | null;
  watchingChanges?: boolean | null;
  createDt?: string | null;
}
