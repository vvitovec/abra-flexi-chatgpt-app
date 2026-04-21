import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { FlexiEvidencePermissions, ResolvedProfile } from "../types.js";

export type OrganizationRole = "owner" | "admin" | "member";

export interface AppUser {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_demo: number;
  created_at: string;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  status: "active" | "invited";
  invite_token: string | null;
  invited_by: string | null;
  created_at: string;
}

export interface AppSession {
  id: string;
  user_id: string;
  active_org_id: string | null;
  expires_at: string;
  created_at: string;
}

export interface FlexiConnection {
  id: string;
  organization_id: string;
  alias: string;
  base_url: string;
  company_slug: string;
  default_format: "json" | "xml";
  mode: "prod" | "test";
  status: "active" | "inactive";
  key_version: string;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
  last_error: string | null;
}

export interface DecryptedConnectionSecret {
  username: string;
  password: string;
}

export interface WriteConfirmation {
  id: string;
  organization_id: string;
  user_id: string;
  connection_id: string;
  evidence: string;
  payload_hash: string;
  payload_format: "json" | "xml";
  idempotency_key: string | null;
  expires_at: string;
  created_at: string;
}

export interface DocumentDraft {
  kind: string;
  connection_id: string;
  id: string;
  evidence: string;
  payload: string;
  payload_format: "json" | "xml";
  updated_at: string;
}

export interface ReportDownloadGrant {
  token: string;
  organization_id: string;
  user_id: string;
  connection_id: string;
  report_key: string;
  company_slug: string;
  report_path: string;
  query_json: string;
  filename: string;
  expires_at: string;
  created_at: string;
}

export interface AuditEventRecord {
  id: string;
  organization_id: string;
  user_id: string | null;
  connection_id: string | null;
  client_id: string | null;
  action: string;
  status: string;
  details_json: string;
  created_at: string;
}

export interface OAuthAuthorizationCodeRecord {
  code: string;
  client_id: string;
  user_id: string;
  organization_id: string;
  scopes: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string | null;
  expires_at: string;
  created_at: string;
}

export interface OAuthTokenRecord {
  access_token: string;
  refresh_token: string | null;
  client_id: string;
  user_id: string;
  organization_id: string;
  scopes: string;
  resource: string | null;
  expires_at: string;
  refresh_expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface AppAuthInfo extends AuthInfo {
  extra: {
    userId: string;
    organizationId: string;
  };
}

export interface ConnectionContext {
  auth: AppAuthInfo;
  connection: FlexiConnection;
  profile: ResolvedProfile;
  permissions: FlexiEvidencePermissions;
}

export interface AppViewerContext {
  user: AppUser | null;
  session: AppSession | null;
  organizations: Organization[];
  activeOrganization: Organization | null;
}

export interface RegisteredClientRecord extends OAuthClientInformationFull {
  metadata_json: string;
  created_at: string;
}
