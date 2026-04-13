import type { Response } from "express";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import { randomId } from "./crypto.js";
import type { AppAuthInfo, AppSession, AppUser } from "./types.js";
import { loadSessionState } from "./session.js";

export class SqliteRegisteredClientStore implements OAuthRegisteredClientsStore {
  constructor(private readonly db: AppDatabase) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.db.getClient(clientId);
  }

  registerClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">): OAuthClientInformationFull {
    const registered: OAuthClientInformationFull = {
      ...client,
      client_id: `client_${randomId(8)}`,
      client_secret: client.client_secret ?? randomId(16),
      client_id_issued_at: Math.floor(Date.now() / 1000)
    };
    this.db.upsertClient(registered);
    return registered;
  }
}

export class FlexiAppOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig
  ) {
    this.clientsStore = new SqliteRegisteredClientStore(db);
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const { session, user } = loadSessionState(res.req as any, this.db, this.config) as {
      session: AppSession | null;
      user: AppUser | null;
    };
    if (!session || !user) {
      const next = new URL("/login", this.config.appBaseUrl);
      next.searchParams.set("next", res.req.originalUrl);
      res.redirect(next.toString());
      return;
    }

    const organizations = this.db.listOrganizationsForUser(user.id);
    const activeOrg = session.active_org_id
      ? this.db.getOrganizationById(session.active_org_id)
      : organizations[0] ?? null;

    if (!activeOrg) {
      const redirect = new URL(params.redirectUri);
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("error_description", "User has no active organization.");
      if (params.state) {
        redirect.searchParams.set("state", params.state);
      }
      res.redirect(redirect.toString());
      return;
    }

    if (!session.active_org_id) {
      this.db.updateSessionActiveOrganization(session.id, activeOrg.id);
    }

    const code = randomId(24);
    this.db.createAuthorizationCode({
      code,
      client_id: client.client_id,
      user_id: user.id,
      organization_id: activeOrg.id,
      scopes: (params.scopes ?? []).join(" "),
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: "S256",
      resource: params.resource?.toString() ?? null,
      expires_at: new Date(Date.now() + this.config.oauthCodeTtlSeconds * 1000).toISOString()
    });

    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set("code", code);
    if (params.state) {
      redirect.searchParams.set("state", params.state);
    }
    res.redirect(redirect.toString());
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const code = this.db.consumeAuthorizationCode(authorizationCode);
    if (!code) {
      throw new Error("Invalid authorization code.");
    }
    if (code.client_id !== client.client_id) {
      throw new Error("Authorization code client mismatch.");
    }
    this.db.createAuthorizationCode(code);
    return code.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const code = this.db.consumeAuthorizationCode(authorizationCode);
    if (!code) {
      throw new Error("Invalid or expired authorization code.");
    }
    if (code.client_id !== client.client_id) {
      throw new Error("Authorization code client mismatch.");
    }
    if (redirectUri && redirectUri !== code.redirect_uri) {
      throw new Error("redirect_uri mismatch.");
    }

    const token = this.issueToken({
      clientId: client.client_id,
      userId: code.user_id,
      organizationId: code.organization_id,
      scopes: code.scopes,
      resource: resource?.toString() ?? code.resource
    });
    return token;
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const stored = this.db.getTokenByRefreshToken(refreshToken);
    if (!stored || stored.client_id !== client.client_id || stored.revoked_at) {
      throw new Error("Invalid refresh token.");
    }
    if (stored.refresh_expires_at && new Date(stored.refresh_expires_at).getTime() < Date.now()) {
      throw new Error("Refresh token expired.");
    }
    this.db.revokeRefreshToken(refreshToken);
    return this.issueToken({
      clientId: stored.client_id,
      userId: stored.user_id,
      organizationId: stored.organization_id,
      scopes: scopes?.join(" ") || stored.scopes,
      resource: resource?.toString() ?? stored.resource
    });
  }

  async verifyAccessToken(token: string): Promise<AppAuthInfo> {
    const stored = this.db.getTokenByAccessToken(token);
    if (!stored || stored.revoked_at) {
      throw new Error("Invalid token.");
    }
    const expiresAt = Math.floor(new Date(stored.expires_at).getTime() / 1000);
    return {
      token,
      clientId: stored.client_id,
      scopes: stored.scopes.split(" ").filter(Boolean),
      expiresAt,
      resource: stored.resource ? new URL(stored.resource) : undefined,
      extra: {
        userId: stored.user_id,
        organizationId: stored.organization_id
      }
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.db.revokeToken(request.token);
    this.db.revokeRefreshToken(request.token);
  }

  private issueToken(input: {
    clientId: string;
    userId: string;
    organizationId: string;
    scopes: string;
    resource: string | null | undefined;
  }): OAuthTokens {
    const accessToken = `at_${randomId(24)}`;
    const refreshToken = `rt_${randomId(24)}`;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.config.oauthAccessTokenTtlSeconds * 1000);
    const refreshExpiresAt = new Date(createdAt.getTime() + this.config.oauthRefreshTokenTtlSeconds * 1000);

    this.db.createToken({
      access_token: accessToken,
      refresh_token: refreshToken,
      client_id: input.clientId,
      user_id: input.userId,
      organization_id: input.organizationId,
      scopes: input.scopes,
      resource: input.resource ?? null,
      expires_at: expiresAt.toISOString(),
      refresh_expires_at: refreshExpiresAt.toISOString(),
      revoked_at: null,
      created_at: createdAt.toISOString()
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: this.config.oauthAccessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: input.scopes
    };
  }
}
