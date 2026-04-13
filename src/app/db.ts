import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AppConfig } from "./config.js";
import { hashPassword, randomId } from "./crypto.js";
import type {
  AppSession,
  AppUser,
  AuditEventRecord,
  DecryptedConnectionSecret,
  DocumentDraft,
  FlexiConnection,
  OAuthAuthorizationCodeRecord,
  OAuthTokenRecord,
  Organization,
  OrganizationMember,
  OrganizationRole,
  WriteConfirmation
} from "./types.js";

type BetterDb = Database.Database;

function nowIso(): string {
  return new Date().toISOString();
}

function rowToUser(row: any): AppUser {
  return row as AppUser;
}

export class AppDatabase {
  readonly db: BetterDb;

  constructor(private readonly config: AppConfig) {
    const dbPath = resolve(config.appDataDir, "app.sqlite");
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists users (
        id text primary key,
        email text not null unique,
        password_hash text not null,
        display_name text not null,
        is_demo integer not null default 0,
        created_at text not null
      );

      create table if not exists organizations (
        id text primary key,
        slug text not null unique,
        name text not null,
        created_at text not null
      );

      create table if not exists organization_members (
        id text primary key,
        organization_id text not null references organizations(id) on delete cascade,
        user_id text not null references users(id) on delete cascade,
        role text not null,
        status text not null,
        invite_token text,
        invited_by text,
        created_at text not null,
        unique (organization_id, user_id)
      );

      create table if not exists sessions (
        id text primary key,
        user_id text not null references users(id) on delete cascade,
        active_org_id text references organizations(id) on delete set null,
        expires_at text not null,
        created_at text not null
      );

      create table if not exists flexi_connections (
        id text primary key,
        organization_id text not null references organizations(id) on delete cascade,
        alias text not null,
        base_url text not null,
        company_slug text not null,
        default_format text not null,
        mode text not null,
        status text not null,
        key_version text not null,
        created_at text not null,
        updated_at text not null,
        last_checked_at text,
        last_error text,
        unique (organization_id, alias)
      );

      create table if not exists encrypted_connection_secrets (
        id text primary key,
        connection_id text not null unique references flexi_connections(id) on delete cascade,
        secret_blob text not null,
        key_version text not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists oauth_clients (
        client_id text primary key,
        client_secret text,
        metadata_json text not null,
        created_at text not null
      );

      create table if not exists oauth_authorization_codes (
        code text primary key,
        client_id text not null references oauth_clients(client_id) on delete cascade,
        user_id text not null references users(id) on delete cascade,
        organization_id text not null references organizations(id) on delete cascade,
        scopes text not null,
        redirect_uri text not null,
        code_challenge text not null,
        code_challenge_method text not null,
        resource text,
        expires_at text not null,
        created_at text not null
      );

      create table if not exists oauth_tokens (
        access_token text primary key,
        refresh_token text unique,
        client_id text not null references oauth_clients(client_id) on delete cascade,
        user_id text not null references users(id) on delete cascade,
        organization_id text not null references organizations(id) on delete cascade,
        scopes text not null,
        resource text,
        expires_at text not null,
        refresh_expires_at text,
        revoked_at text,
        created_at text not null
      );

      create table if not exists audit_events (
        id text primary key,
        organization_id text not null references organizations(id) on delete cascade,
        user_id text references users(id) on delete set null,
        connection_id text references flexi_connections(id) on delete set null,
        client_id text,
        action text not null,
        status text not null,
        details_json text not null,
        created_at text not null
      );

      create table if not exists write_confirmations (
        id text primary key,
        organization_id text not null references organizations(id) on delete cascade,
        user_id text not null references users(id) on delete cascade,
        connection_id text not null references flexi_connections(id) on delete cascade,
        evidence text not null,
        payload_hash text not null,
        payload_format text not null,
        idempotency_key text,
        expires_at text not null,
        created_at text not null
      );

      create table if not exists document_drafts (
        kind text not null,
        connection_id text not null references flexi_connections(id) on delete cascade,
        id text not null,
        evidence text not null,
        payload text not null,
        payload_format text not null,
        updated_at text not null,
        primary key (kind, connection_id, id)
      );

      create index if not exists idx_sessions_user on sessions(user_id);
      create index if not exists idx_members_user on organization_members(user_id);
      create index if not exists idx_connections_org on flexi_connections(organization_id);
      create index if not exists idx_tokens_refresh on oauth_tokens(refresh_token);
      create index if not exists idx_audit_org_created on audit_events(organization_id, created_at desc);
    `);
  }

  seedReviewer(): void {
    const existing = this.findUserByEmail(this.config.reviewerEmail);
    const createdAt = nowIso();
    const userId = existing?.id ?? randomId();
    if (!existing) {
      this.db.prepare(
        "insert into users (id, email, password_hash, display_name, is_demo, created_at) values (?, ?, ?, ?, ?, ?)"
      ).run(
        userId,
        this.config.reviewerEmail,
        hashPassword(this.config.reviewerPassword),
        this.config.reviewerName,
        1,
        createdAt
      );
    }

    const orgSlug = "review-demo";
    const org = this.getOrganizationBySlug(orgSlug);
    const orgId = org?.id ?? randomId();
    if (!org) {
      this.db.prepare(
        "insert into organizations (id, slug, name, created_at) values (?, ?, ?, ?)"
      ).run(orgId, orgSlug, "Review Demo Organization", createdAt);
    }

    const member = this.db.prepare(
      "select id from organization_members where organization_id = ? and user_id = ?"
    ).get(orgId, userId) as { id: string } | undefined;
    if (!member) {
      this.db.prepare(
        "insert into organization_members (id, organization_id, user_id, role, status, invite_token, invited_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(randomId(), orgId, userId, "owner", "active", null, null, createdAt);
    }
  }

  createUser(email: string, passwordHash: string, displayName: string, isDemo = false): AppUser {
    const user: AppUser = {
      id: randomId(),
      email,
      password_hash: passwordHash,
      display_name: displayName,
      is_demo: isDemo ? 1 : 0,
      created_at: nowIso()
    };
    this.db.prepare(
      "insert into users (id, email, password_hash, display_name, is_demo, created_at) values (?, ?, ?, ?, ?, ?)"
    ).run(user.id, user.email, user.password_hash, user.display_name, user.is_demo, user.created_at);
    return user;
  }

  findUserByEmail(email: string): AppUser | null {
    const row = this.db.prepare("select * from users where lower(email) = lower(?)").get(email);
    return row ? rowToUser(row) : null;
  }

  getUserById(id: string): AppUser | null {
    const row = this.db.prepare("select * from users where id = ?").get(id);
    return row ? rowToUser(row) : null;
  }

  createOrganizationWithOwner(name: string, slug: string, ownerId: string): Organization {
    const organization: Organization = {
      id: randomId(),
      slug,
      name,
      created_at: nowIso()
    };
    const tx = this.db.transaction(() => {
      this.db.prepare(
        "insert into organizations (id, slug, name, created_at) values (?, ?, ?, ?)"
      ).run(organization.id, organization.slug, organization.name, organization.created_at);
      this.db.prepare(
        "insert into organization_members (id, organization_id, user_id, role, status, invite_token, invited_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(randomId(), organization.id, ownerId, "owner", "active", null, null, organization.created_at);
    });
    tx();
    return organization;
  }

  getOrganizationById(id: string): Organization | null {
    const row = this.db.prepare("select * from organizations where id = ?").get(id);
    return row ? (row as Organization) : null;
  }

  getOrganizationBySlug(slug: string): Organization | null {
    const row = this.db.prepare("select * from organizations where slug = ?").get(slug);
    return row ? (row as Organization) : null;
  }

  listOrganizationsForUser(userId: string): Organization[] {
    return this.db.prepare(`
      select o.*
      from organizations o
      join organization_members m on m.organization_id = o.id
      where m.user_id = ? and m.status = 'active'
      order by o.name asc
    `).all(userId) as Organization[];
  }

  getMembership(userId: string, organizationId: string): OrganizationMember | null {
    const row = this.db.prepare(
      "select * from organization_members where user_id = ? and organization_id = ? and status = 'active'"
    ).get(userId, organizationId);
    return row ? (row as OrganizationMember) : null;
  }

  listMembers(organizationId: string): Array<OrganizationMember & { email: string; display_name: string }> {
    return this.db.prepare(`
      select m.*, u.email, u.display_name
      from organization_members m
      join users u on u.id = m.user_id
      where m.organization_id = ?
      order by u.email asc
    `).all(organizationId) as Array<OrganizationMember & { email: string; display_name: string }>;
  }

  inviteMember(organizationId: string, email: string, role: OrganizationRole, invitedBy: string): string {
    let user = this.findUserByEmail(email);
    if (!user) {
      user = this.createUser(email, hashPassword(randomId(12)), email.split("@")[0] ?? email, false);
    }
    const existing = this.db.prepare(
      "select id from organization_members where organization_id = ? and user_id = ?"
    ).get(organizationId, user.id) as { id: string } | undefined;
    const inviteToken = randomId();
    if (existing) {
      this.db.prepare(
        "update organization_members set role = ?, status = 'invited', invite_token = ?, invited_by = ?, created_at = ? where id = ?"
      ).run(role, inviteToken, invitedBy, nowIso(), existing.id);
    } else {
      this.db.prepare(
        "insert into organization_members (id, organization_id, user_id, role, status, invite_token, invited_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(randomId(), organizationId, user.id, role, "invited", inviteToken, invitedBy, nowIso());
    }
    return inviteToken;
  }

  acceptInvite(token: string, userId: string): OrganizationMember | null {
    const invite = this.db.prepare(
      "select * from organization_members where invite_token = ? and status = 'invited'"
    ).get(token) as OrganizationMember | undefined;
    if (!invite) {
      return null;
    }
    this.db.prepare(
      "update organization_members set user_id = ?, status = 'active', invite_token = null where id = ?"
    ).run(userId, invite.id);
    return this.getMembership(userId, invite.organization_id);
  }

  createSession(userId: string, activeOrgId: string | null): AppSession {
    const expiresAt = new Date(Date.now() + this.config.appCookieTtlSeconds * 1000).toISOString();
    const session: AppSession = {
      id: randomId(),
      user_id: userId,
      active_org_id: activeOrgId,
      expires_at: expiresAt,
      created_at: nowIso()
    };
    this.db.prepare(
      "insert into sessions (id, user_id, active_org_id, expires_at, created_at) values (?, ?, ?, ?, ?)"
    ).run(session.id, session.user_id, session.active_org_id, session.expires_at, session.created_at);
    return session;
  }

  getSession(id: string): AppSession | null {
    const row = this.db.prepare("select * from sessions where id = ?").get(id);
    if (!row) {
      return null;
    }
    const session = row as AppSession;
    if (new Date(session.expires_at).getTime() < Date.now()) {
      this.deleteSession(id);
      return null;
    }
    return session;
  }

  updateSessionActiveOrganization(id: string, organizationId: string): void {
    this.db.prepare("update sessions set active_org_id = ? where id = ?").run(organizationId, id);
  }

  deleteSession(id: string): void {
    this.db.prepare("delete from sessions where id = ?").run(id);
  }

  createConnection(input: {
    organizationId: string;
    alias: string;
    baseUrl: string;
    companySlug: string;
    defaultFormat: "json" | "xml";
    mode: "prod" | "test";
    keyVersion: string;
    encryptedSecret: string;
  }): FlexiConnection {
    const timestamp = nowIso();
    const connection: FlexiConnection = {
      id: randomId(),
      organization_id: input.organizationId,
      alias: input.alias,
      base_url: input.baseUrl,
      company_slug: input.companySlug,
      default_format: input.defaultFormat,
      mode: input.mode,
      status: "active",
      key_version: input.keyVersion,
      created_at: timestamp,
      updated_at: timestamp,
      last_checked_at: null,
      last_error: null
    };
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        insert into flexi_connections
        (id, organization_id, alias, base_url, company_slug, default_format, mode, status, key_version, created_at, updated_at, last_checked_at, last_error)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        connection.id,
        connection.organization_id,
        connection.alias,
        connection.base_url,
        connection.company_slug,
        connection.default_format,
        connection.mode,
        connection.status,
        connection.key_version,
        connection.created_at,
        connection.updated_at,
        connection.last_checked_at,
        connection.last_error
      );
      this.db.prepare(`
        insert into encrypted_connection_secrets (id, connection_id, secret_blob, key_version, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?)
      `).run(randomId(), connection.id, input.encryptedSecret, input.keyVersion, timestamp, timestamp);
    });
    tx();
    return connection;
  }

  listConnections(organizationId: string): FlexiConnection[] {
    return this.db.prepare(
      "select * from flexi_connections where organization_id = ? order by alias asc"
    ).all(organizationId) as FlexiConnection[];
  }

  getConnectionByAlias(organizationId: string, alias: string): FlexiConnection | null {
    const row = this.db.prepare(
      "select * from flexi_connections where organization_id = ? and alias = ? and status = 'active'"
    ).get(organizationId, alias);
    return row ? (row as FlexiConnection) : null;
  }

  getDefaultConnection(organizationId: string): FlexiConnection | null {
    const row = this.db.prepare(
      "select * from flexi_connections where organization_id = ? and status = 'active' order by created_at asc limit 1"
    ).get(organizationId);
    return row ? (row as FlexiConnection) : null;
  }

  getConnectionSecret(connectionId: string): string | null {
    const row = this.db.prepare(
      "select secret_blob from encrypted_connection_secrets where connection_id = ?"
    ).get(connectionId) as { secret_blob: string } | undefined;
    return row?.secret_blob ?? null;
  }

  rotateConnectionSecret(connectionId: string, encryptedSecret: string, keyVersion: string): void {
    const timestamp = nowIso();
    this.db.prepare(`
      update encrypted_connection_secrets
      set secret_blob = ?, key_version = ?, updated_at = ?
      where connection_id = ?
    `).run(encryptedSecret, keyVersion, timestamp, connectionId);
    this.db.prepare(`
      update flexi_connections
      set key_version = ?, updated_at = ?
      where id = ?
    `).run(keyVersion, timestamp, connectionId);
  }

  updateConnectionCheck(connectionId: string, ok: boolean, errorMessage?: string): void {
    this.db.prepare(`
      update flexi_connections
      set last_checked_at = ?, last_error = ?, updated_at = ?
      where id = ?
    `).run(nowIso(), ok ? null : errorMessage ?? "Unknown error", nowIso(), connectionId);
  }

  createAuthorizationCode(record: Omit<OAuthAuthorizationCodeRecord, "created_at">): OAuthAuthorizationCodeRecord {
    const createdAt = nowIso();
    this.db.prepare(`
      insert into oauth_authorization_codes
      (code, client_id, user_id, organization_id, scopes, redirect_uri, code_challenge, code_challenge_method, resource, expires_at, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.code,
      record.client_id,
      record.user_id,
      record.organization_id,
      record.scopes,
      record.redirect_uri,
      record.code_challenge,
      record.code_challenge_method,
      record.resource,
      record.expires_at,
      createdAt
    );
    return { ...record, created_at: createdAt };
  }

  consumeAuthorizationCode(code: string): OAuthAuthorizationCodeRecord | null {
    const row = this.db.prepare("select * from oauth_authorization_codes where code = ?").get(code);
    if (!row) {
      return null;
    }
    this.db.prepare("delete from oauth_authorization_codes where code = ?").run(code);
    const record = row as OAuthAuthorizationCodeRecord;
    if (new Date(record.expires_at).getTime() < Date.now()) {
      return null;
    }
    return record;
  }

  upsertClient(client: OAuthClientInformationFull): void {
    const metadataJson = JSON.stringify(client);
    this.db.prepare(`
      insert into oauth_clients (client_id, client_secret, metadata_json, created_at)
      values (?, ?, ?, ?)
      on conflict(client_id) do update set
        client_secret = excluded.client_secret,
        metadata_json = excluded.metadata_json
    `).run(client.client_id, client.client_secret ?? null, metadataJson, nowIso());
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.db.prepare(
      "select metadata_json from oauth_clients where client_id = ?"
    ).get(clientId) as { metadata_json: string } | undefined;
    return row ? (JSON.parse(row.metadata_json) as OAuthClientInformationFull) : undefined;
  }

  createToken(record: OAuthTokenRecord): OAuthTokenRecord {
    this.db.prepare(`
      insert into oauth_tokens
      (access_token, refresh_token, client_id, user_id, organization_id, scopes, resource, expires_at, refresh_expires_at, revoked_at, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.access_token,
      record.refresh_token,
      record.client_id,
      record.user_id,
      record.organization_id,
      record.scopes,
      record.resource,
      record.expires_at,
      record.refresh_expires_at,
      record.revoked_at,
      record.created_at
    );
    return record;
  }

  getTokenByAccessToken(accessToken: string): OAuthTokenRecord | null {
    const row = this.db.prepare("select * from oauth_tokens where access_token = ?").get(accessToken);
    return row ? (row as OAuthTokenRecord) : null;
  }

  getTokenByRefreshToken(refreshToken: string): OAuthTokenRecord | null {
    const row = this.db.prepare("select * from oauth_tokens where refresh_token = ?").get(refreshToken);
    return row ? (row as OAuthTokenRecord) : null;
  }

  revokeToken(accessToken: string): void {
    this.db.prepare("update oauth_tokens set revoked_at = ? where access_token = ?").run(nowIso(), accessToken);
  }

  revokeRefreshToken(refreshToken: string): void {
    this.db.prepare("update oauth_tokens set revoked_at = ? where refresh_token = ?").run(nowIso(), refreshToken);
  }

  createWriteConfirmation(record: Omit<WriteConfirmation, "created_at">): WriteConfirmation {
    const createdAt = nowIso();
    this.db.prepare(`
      insert into write_confirmations
      (id, organization_id, user_id, connection_id, evidence, payload_hash, payload_format, idempotency_key, expires_at, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.organization_id,
      record.user_id,
      record.connection_id,
      record.evidence,
      record.payload_hash,
      record.payload_format,
      record.idempotency_key,
      record.expires_at,
      createdAt
    );
    return { ...record, created_at: createdAt };
  }

  consumeWriteConfirmation(id: string): WriteConfirmation | null {
    const row = this.db.prepare("select * from write_confirmations where id = ?").get(id);
    if (!row) {
      return null;
    }
    this.db.prepare("delete from write_confirmations where id = ?").run(id);
    const record = row as WriteConfirmation;
    if (new Date(record.expires_at).getTime() < Date.now()) {
      return null;
    }
    return record;
  }

  saveDraft(draft: DocumentDraft): void {
    this.db.prepare(`
      insert into document_drafts (kind, connection_id, id, evidence, payload, payload_format, updated_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(kind, connection_id, id) do update set
        evidence = excluded.evidence,
        payload = excluded.payload,
        payload_format = excluded.payload_format,
        updated_at = excluded.updated_at
    `).run(draft.kind, draft.connection_id, draft.id, draft.evidence, draft.payload, draft.payload_format, draft.updated_at);
  }

  getDraft(kind: string, connectionId: string, id: string): DocumentDraft | null {
    const row = this.db.prepare(
      "select * from document_drafts where kind = ? and connection_id = ? and id = ?"
    ).get(kind, connectionId, id);
    return row ? (row as DocumentDraft) : null;
  }

  deleteDraft(kind: string, connectionId: string, id: string): void {
    this.db.prepare(
      "delete from document_drafts where kind = ? and connection_id = ? and id = ?"
    ).run(kind, connectionId, id);
  }

  logAudit(event: Omit<AuditEventRecord, "id" | "created_at">): void {
    this.db.prepare(`
      insert into audit_events
      (id, organization_id, user_id, connection_id, client_id, action, status, details_json, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomId(),
      event.organization_id,
      event.user_id,
      event.connection_id,
      event.client_id,
      event.action,
      event.status,
      event.details_json,
      nowIso()
    );
  }

  getLatestAuditError(organizationId: string): AuditEventRecord | null {
    const row = this.db.prepare(`
      select *
      from audit_events
      where organization_id = ? and status = 'error'
      order by created_at desc
      limit 1
    `).get(organizationId);
    return row ? (row as AuditEventRecord) : null;
  }
}
