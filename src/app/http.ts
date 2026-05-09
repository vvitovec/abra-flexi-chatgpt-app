import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { pageTemplate, homePage, loginPage, organizationSettingsPage, connectionFormPage, legalPage, supportPage, docsPage } from "./html.js";
import { loadAppConfig, type AppConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import { createPublicFlexiMcpServer } from "./flexi-mcp-server.js";
import { encryptJson, hashPassword, verifyPassword } from "./crypto.js";
import { clearSessionCookie, loadSessionState, setSessionCookie } from "./session.js";
import { FlexiAppOAuthProvider } from "./oauth.js";
import { FlexiClient } from "../client.js";
import { AuditStore } from "../audit.js";
import { normalizeFlexiResponse } from "../flexi-response.js";
import { mapCompaniesToSummary } from "../flexi-dto.js";
import type { FlexiFormat, ResolvedProfile } from "../types.js";
import { decryptJson } from "./crypto.js";
import { defaultEvidencePermissions } from "./default-permissions.js";

function createTemporaryProfile(input: {
  alias: string;
  baseUrl: string;
  companySlug?: string;
  defaultFormat: "json" | "xml";
  username: string;
  password: string;
}): ResolvedProfile {
  return {
    name: input.alias,
    baseUrl: input.baseUrl,
    company: input.companySlug?.trim() ?? "",
    mode: "prod",
    writes: "confirm",
    defaultFormat: input.defaultFormat,
    usernameEnv: "managed",
    passwordEnv: "managed",
    allowWriteOverrideWithoutValidation: false,
    permissions: defaultEvidencePermissions,
    username: input.username,
    password: input.password
  };
}

function redirectWithMessage(res: express.Response, path: string, message: string): void {
  const target = new URL(path, "http://localhost");
  target.searchParams.set("message", message);
  res.redirect(`${target.pathname}${target.search}`);
}

function paramValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return value?.[0] ?? "";
}

function formatBinaryFailure(buffer: Buffer, contentType: string | null): string {
  const text = buffer.toString("utf8");
  if (contentType?.includes("text/plain")) {
    const trimmedText = text.trim();
    if (trimmedText) {
      return trimmedText;
    }
  }
  const trimmed = text.trimStart();
  const format: FlexiFormat = contentType?.includes("xml") || trimmed.startsWith("<") ? "xml" : "json";
  const normalized = normalizeFlexiResponse(format, 400, text, { "content-type": contentType ?? "unknown" });
  const issues = [...normalized.errors, ...normalized.warnings, ...normalized.messages].filter(Boolean);
  return issues[0] ?? "Flexi report export failed.";
}

function resolveReportDownloadTarget(reportKey: string, reportPath?: string): { evidence: string; auditAction: string; local_file?: boolean } {
  if (reportKey === "export_assets_liabilities_pdf_generated") {
    return { evidence: "rozvaha-po-uctech", auditAction: "download_assets_liabilities_pdf_generated", local_file: true };
  }
  if (reportPath?.includes("/sestava.pdf")) {
    return { evidence: "sestava", auditAction: "download_balance_sheet_pdf" };
  }
  if (reportKey === "export_assets_liabilities_pdf") {
    return { evidence: "rozvaha-po-uctech", auditAction: "download_assets_liabilities_pdf" };
  }
  if (reportKey === "export_balance_sheet_pdf") {
    return { evidence: "sestava", auditAction: "download_balance_sheet_pdf" };
  }
  return { evidence: "rozvaha-po-uctech", auditAction: "download_report_pdf" };
}

type ManagedConnectionInput = {
  alias: string;
  baseUrl: string;
  companySlug: string;
  username: string;
  password: string;
  defaultFormat: "json" | "xml";
};

function normalizeManagedConnectionInput(
  body: Record<string, string>,
  fallbackAlias?: string
): ManagedConnectionInput {
  return {
    alias: body.alias?.trim() || fallbackAlias || "default",
    baseUrl: body.base_url?.trim() ?? "",
    companySlug: body.company_slug?.trim() ?? "",
    username: body.username?.trim() ?? "",
    password: body.password ?? "",
    defaultFormat: body.default_format === "xml" ? "xml" : "json"
  };
}

function defaultDisplayNameFromEmail(email: string): string {
  return email.trim();
}

function slugifyOrganizationName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "organization";
}

function createUniqueOrganizationSlug(db: AppDatabase, organizationName: string): string {
  const baseSlug = slugifyOrganizationName(organizationName);
  let slug = baseSlug;
  let suffix = 2;

  while (db.getOrganizationBySlug(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
}

async function verifyManagedConnectionInput(flexiClient: FlexiClient, connection: ManagedConnectionInput): Promise<void> {
  const tempProfile = createTemporaryProfile({
    alias: connection.alias,
    baseUrl: connection.baseUrl,
    companySlug: connection.companySlug,
    defaultFormat: connection.defaultFormat,
    username: connection.username,
    password: connection.password
  });

  const companiesResponse = await flexiClient.request({
    operation: "onboarding_check_companies",
    profile: tempProfile,
    method: "GET",
    path: flexiClient.buildServerPath(tempProfile.defaultFormat),
    format: tempProfile.defaultFormat
  });
  const evidenceResponse = connection.companySlug
    ? await flexiClient.request({
        operation: "onboarding_check_evidence",
        profile: tempProfile,
        company: connection.companySlug,
        method: "GET",
        path: flexiClient.buildCompanyPath(tempProfile, connection.companySlug, "evidence-list"),
        format: tempProfile.defaultFormat
      })
    : null;

  if (!companiesResponse.ok || (connection.companySlug && !evidenceResponse?.ok)) {
    const issues = [
      ...companiesResponse.errors,
      ...(evidenceResponse?.errors ?? [])
    ].join("; ") || "Flexi connection test failed.";
    throw new Error(issues);
  }

  if (!connection.companySlug) {
    const companyCount = companiesResponse.ok ? mapCompaniesToSummary(companiesResponse.data).length : 0;
    if (companyCount === 0) {
      throw new Error("REST API účet nevrátil žádnou dostupnou firmu.");
    }
  }
}

function storeManagedConnection(input: {
  db: AppDatabase;
  config: AppConfig;
  organizationId: string;
  connection: ManagedConnectionInput;
}): string {
  const encrypted = encryptJson(input.config, {
    username: input.connection.username,
    password: input.connection.password
  });
  const connection = input.db.createConnection({
    organizationId: input.organizationId,
    alias: input.connection.alias,
    baseUrl: input.connection.baseUrl,
    companySlug: input.connection.companySlug,
    defaultFormat: input.connection.defaultFormat,
    mode: "prod",
    keyVersion: encrypted.keyVersion,
    encryptedSecret: JSON.stringify(encrypted)
  });
  input.db.updateConnectionCheck(connection.id, true);

  return input.connection.companySlug
    ? `Připojení '${input.connection.alias}' bylo uloženo a ověřeno.`
    : `Připojení '${input.connection.alias}' bylo uloženo. Firmu budete vybírat dynamicky přes company_slug.`;
}

async function createManagedConnectionFromInput(input: {
  db: AppDatabase;
  config: AppConfig;
  flexiClient: FlexiClient;
  organizationId: string;
  connection: ManagedConnectionInput;
}): Promise<string> {
  await verifyManagedConnectionInput(input.flexiClient, input.connection);
  return storeManagedConnection({
    db: input.db,
    config: input.config,
    organizationId: input.organizationId,
    connection: input.connection
  });
}

export function createHttpApp(config = loadAppConfig()) {
  const db = new AppDatabase(config);
  db.seedReviewer();

  const auditStore = new AuditStore(resolve(config.appDataDir, "logs"));
  const flexiClient = new FlexiClient(auditStore);
  const provider = new FlexiAppOAuthProvider(db, config);
  const bearerAuth = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(`${config.appBaseUrl}/mcp`))
  });

  const app = express();
  app.set("trust proxy", 1);
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const state = loadSessionState(req, db, config);
    (req as any).viewer = state;
    res.locals.viewer = state;
    next();
  });

  app.get("/", (req: Request, res: Response) => {
    const viewer = (req as any).viewer as ReturnType<typeof loadSessionState>;
    const organizations = viewer.user ? db.listOrganizationsForUser(viewer.user.id) : [];
    const activeOrganization = viewer.session?.active_org_id ? db.getOrganizationById(viewer.session.active_org_id) : organizations[0] ?? null;
    if (viewer.session && activeOrganization && viewer.session.active_org_id !== activeOrganization.id) {
      db.updateSessionActiveOrganization(viewer.session.id, activeOrganization.id);
    }
    const connections = activeOrganization ? db.listConnections(activeOrganization.id) : [];
    res.type("html").send(homePage({
      user: viewer.user,
      session: viewer.session,
      organizations,
      activeOrganization
    }, connections));
  });

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, app: config.appName });
  });

  app.get("/favicon.ico", (_req: Request, res: Response) => {
    res.status(204).end();
  });

  app.get("/oauth/authorize", (req: Request, res: Response) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(`/authorize${query}`);
  });
  app.post("/oauth/token", (req: Request, res: Response) => {
    req.url = "/token";
    (app as any).handle(req, res);
  });
  app.post("/oauth/revoke", (req: Request, res: Response) => {
    req.url = "/revoke";
    (app as any).handle(req, res);
  });

  app.get("/login", (req: Request, res: Response) => {
    res.type("html").send(loginPage(
      typeof req.query.error === "string" ? req.query.error : undefined,
      typeof req.query.next === "string" ? req.query.next : undefined
    ));
  });

  app.post("/login", (req: Request, res: Response) => {
    const { email, password, next } = req.body as Record<string, string>;
    const user = db.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.type("html").status(401).send(loginPage("Neplatný e-mail nebo heslo.", next));
      return;
    }
    const organizations = db.listOrganizationsForUser(user.id);
    const session = db.createSession(user.id, organizations[0]?.id ?? null);
    setSessionCookie(res, config, session.id);
    res.redirect(next || "/");
  });

  app.post("/register", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.is("application/x-www-form-urlencoded")) {
      next();
      return;
    }

    const {
      email,
      password,
      organization_name,
      next: nextUrl
    } = req.body as Record<string, string>;

    if (db.findUserByEmail(email)) {
      res.type("html").status(409).send(loginPage("Účet s tímto e-mailem už existuje.", nextUrl));
      return;
    }

    const managedConnection = normalizeManagedConnectionInput({
      alias: "default",
      base_url: req.body.base_url as string,
      company_slug: req.body.company_slug as string,
      username: req.body.username as string,
      password: req.body.flexi_password as string,
      default_format: "json"
    });

    try {
      await verifyManagedConnectionInput(flexiClient, managedConnection);
      const user = db.createUser(email, hashPassword(password), defaultDisplayNameFromEmail(email));
      const organization = db.createOrganizationWithOwner(
        organization_name,
        createUniqueOrganizationSlug(db, organization_name),
        user.id
      );
      storeManagedConnection({
        db,
        config,
        organizationId: organization.id,
        connection: managedConnection
      });
      const session = db.createSession(user.id, organization.id);
      setSessionCookie(res, config, session.id);
      res.redirect(nextUrl || "/");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.type("html").status(400).send(loginPage(message, nextUrl));
    }
  });

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(config.appBaseUrl),
    baseUrl: new URL(config.appBaseUrl),
    resourceServerUrl: new URL(`${config.appBaseUrl}/mcp`),
    resourceName: "ABRA Flexi ChatGPT App",
    serviceDocumentationUrl: new URL(`${config.appBaseUrl}/docs`),
    scopesSupported: ["mcp:read", "mcp:write"]
  }));

  app.get("/logout", (req: Request, res: Response) => {
    const viewer = (req as any).viewer as ReturnType<typeof loadSessionState>;
    if (viewer.session) {
      db.deleteSession(viewer.session.id);
    }
    clearSessionCookie(res, config);
    res.redirect("/login");
  });

  app.get("/orgs/new", (req: Request, res: Response) => {
    const viewer = (req as any).viewer as ReturnType<typeof loadSessionState>;
    if (!viewer.user) {
      res.redirect("/login?next=/orgs/new");
      return;
    }
    res.type("html").send(pageTemplate("Nová organizace", `
      <section class="hero card">
        <div class="stack"><h1>Nová organizace</h1></div>
      </section>
      <div class="grid"><section class="card section">
        <form method="post" action="/orgs/new">
          <label>Název<input type="text" name="name" required /></label>
          <label>Slug<input type="text" name="slug" required pattern="[a-z0-9-]+" /></label>
          <button type="submit">Vytvořit organizaci</button>
        </form>
      </section></div>
    `));
  });

  app.post("/orgs/new", (req: Request, res: Response) => {
    const viewer = (req as any).viewer as ReturnType<typeof loadSessionState>;
    if (!viewer.user || !viewer.session) {
      res.redirect("/login?next=/orgs/new");
      return;
    }
    const { name, slug } = req.body as Record<string, string>;
    const org = db.createOrganizationWithOwner(name, slug, viewer.user.id);
    db.updateSessionActiveOrganization(viewer.session.id, org.id);
    res.redirect(`/orgs/${org.id}/settings`);
  });

  app.get("/orgs/:id/settings", (req: Request, res: Response) => {
    const viewer = (req as any).viewer as ReturnType<typeof loadSessionState>;
    if (!viewer.user || !viewer.session) {
      res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    const orgId = paramValue(req.params.id);
    const org = db.getOrganizationById(orgId);
    if (!org || !db.getMembership(viewer.user.id, org.id)) {
      res.status(404).type("html").send(pageTemplate("Not found", "<section class='card section'><p>Organizace nebyla nalezena.</p></section>"));
      return;
    }
    db.updateSessionActiveOrganization(viewer.session.id, org.id);
    const members = db.listMembers(org.id);
    const connections = db.listConnections(org.id);
    res.type("html").send(organizationSettingsPage(
      org,
      members,
      connections,
      typeof req.query.message === "string" ? req.query.message : undefined
    ));
  });

  app.post("/orgs/:id/invite", (req: Request, res: Response) => {
    const viewer = (req as any).viewer as ReturnType<typeof loadSessionState>;
    if (!viewer.user) {
      res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    const orgId = paramValue(req.params.id);
    const membership = db.getMembership(viewer.user.id, orgId);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      res.status(403).type("html").send(pageTemplate("Forbidden", "<section class='card section'><p>Nemáte oprávnění zvát členy.</p></section>"));
      return;
    }
    const { email, role } = req.body as Record<string, string>;
    const inviteToken = db.inviteMember(orgId, email, role as any, viewer.user.id);
    redirectWithMessage(res, `/orgs/${orgId}/settings`, `Pozvánka vytvořena. Token: ${inviteToken}`);
  });

  app.get("/connections/new", (req: Request, res: Response) => {
    const viewer = (req as any).viewer as ReturnType<typeof loadSessionState>;
    if (!viewer.user || !viewer.session?.active_org_id) {
      res.redirect("/login?next=/connections/new");
      return;
    }
    res.type("html").send(connectionFormPage(
      typeof req.query.message === "string" ? req.query.message : undefined,
      typeof req.query.error === "string" ? req.query.error : undefined
    ));
  });

  app.post("/connections/new", async (req: Request, res: Response) => {
    const viewer = (req as any).viewer as ReturnType<typeof loadSessionState>;
    if (!viewer.user || !viewer.session?.active_org_id) {
      res.redirect("/login?next=/connections/new");
      return;
    }
    const membership = db.getMembership(viewer.user.id, viewer.session.active_org_id);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      res.status(403).type("html").send(connectionFormPage(undefined, "Pouze owner/admin může přidávat připojení."));
      return;
    }
    const managedConnection = normalizeManagedConnectionInput(req.body as Record<string, string>);

    try {
      const message = await createManagedConnectionFromInput({
        db,
        config,
        flexiClient,
        organizationId: viewer.session.active_org_id,
        connection: managedConnection
      });
      redirectWithMessage(res, "/connections/new", message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.type("html").status(400).send(connectionFormPage(undefined, message));
    }
  });

  app.get("/legal/privacy", (_req: Request, res: Response) => {
    res.type("html").send(legalPage("Privacy Policy", [
      "Aplikace zpracovává jen data potřebná pro přihlášení, správu organizací, bezpečné uložení Flexi API připojení a provedení konkrétních MCP operací.",
      "Flexi přístupové údaje se zadávají pouze v onboarding rozhraní, ukládají se šifrovaně a nikdy se nevracejí do tool responses.",
      "Aplikace nepožaduje ani neukládá MFA kódy, API klíče třetích stran, platební údaje ani jiné restricted credentials mimo samotné Flexi přihlášení nutné pro funkci služby.",
      "Audit logy uchovávají metadata o akcích a chybách, ale nevracejí interní request identifikátory ani plné debug payloady do ChatGPT."
    ]));
  });

  app.get("/legal/terms", (_req: Request, res: Response) => {
    res.type("html").send(legalPage("Terms of Use", [
      "Aplikace je určena pro účetní a finanční workflow v ABRA Flexi a předpokládá použití dedikovaného REST API uživatele.",
      "Uživatel odpovídá za to, že má oprávnění připojit danou Flexi instanci a že zadá správné firemní údaje.",
      "Write akce mohou být omezeny podle role člena organizace a podle allowlistu podporovaných evidencí."
    ]));
  });

  app.get("/support", (_req: Request, res: Response) => {
    res.type("html").send(supportPage());
  });

  app.get("/docs", (_req: Request, res: Response) => {
    res.type("html").send(docsPage());
  });

  app.get("/downloads/reports/:token", async (req: Request, res: Response) => {
    const token = paramValue(req.params.token);
    const grant = db.getReportDownloadGrant(token);
    if (!grant) {
      res.status(404).type("text/plain").send("Report download link is missing or expired.");
      return;
    }

    const connection = db.listConnections(grant.organization_id).find((item) => item.id === grant.connection_id);
    const reportTarget = resolveReportDownloadTarget(grant.report_key, grant.report_path);
    if (reportTarget.local_file) {
      if (!existsSync(grant.report_path)) {
        res.status(404).type("text/plain").send("The generated report file is no longer available.");
        return;
      }
      const buffer = readFileSync(grant.report_path);
      db.logAudit({
        organization_id: grant.organization_id,
        user_id: grant.user_id,
        connection_id: grant.connection_id,
        client_id: null,
        action: reportTarget.auditAction,
        status: "ok",
        details_json: JSON.stringify({
          token,
          filename: grant.filename,
          size_bytes: buffer.length
        })
      });
      res.status(200);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${grant.filename.replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(buffer);
      return;
    }
    if (!connection) {
      res.status(404).type("text/plain").send("The Flexi connection for this report is no longer available.");
      return;
    }

    const encryptedSecret = db.getConnectionSecret(connection.id);
    if (!encryptedSecret) {
      res.status(500).type("text/plain").send("The Flexi connection is missing credentials.");
      return;
    }
    try {
      const secret = decryptJson<{ username: string; password: string }>(config, JSON.parse(encryptedSecret));
      const profile = createTemporaryProfile({
        alias: `download:${connection.alias}`,
        baseUrl: connection.base_url,
        companySlug: grant.company_slug,
        defaultFormat: connection.default_format,
        username: secret.username,
        password: secret.password
      });
      const reportQuery = JSON.parse(grant.query_json) as Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;
      const binary = await flexiClient.requestBinary({
        operation: grant.report_key,
        profile,
        company: grant.company_slug,
        evidence: reportTarget.evidence,
        method: "GET",
        path: grant.report_path,
        query: reportQuery
      });

      let servedOk = binary.ok;
      const servedFilename = grant.filename;
      let servedStatus = binary.http_status;
      let servedBuffer = binary.buffer;
      let servedContentType = binary.content_type ?? "application/pdf";
      let servedContentLength = binary.content_length;
      let servedMessage = formatBinaryFailure(binary.buffer, binary.content_type);

      if (!servedOk) {
        db.logAudit({
          organization_id: grant.organization_id,
          user_id: grant.user_id,
          connection_id: grant.connection_id,
          client_id: null,
          action: reportTarget.auditAction,
          status: "error",
          details_json: JSON.stringify({ token, message: servedMessage, content_type: servedContentType, status: servedStatus })
        });
        res.status(servedStatus >= 400 ? servedStatus : 502).type("text/plain").send(servedMessage);
        return;
      }

      db.logAudit({
        organization_id: grant.organization_id,
        user_id: grant.user_id,
        connection_id: grant.connection_id,
        client_id: null,
        action: reportTarget.auditAction,
        status: "ok",
        details_json: JSON.stringify({
          token,
          filename: servedFilename,
          size_bytes: servedContentLength
        })
      });

      res.status(200);
      res.setHeader("Content-Type", servedContentType);
      res.setHeader("Content-Disposition", `attachment; filename="${servedFilename.replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.send(servedBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.logAudit({
        organization_id: grant.organization_id,
        user_id: grant.user_id,
        connection_id: grant.connection_id,
        client_id: null,
        action: reportTarget.auditAction,
        status: "error",
        details_json: JSON.stringify({ token, message })
      });
      res.status(502).type("text/plain").send(message);
    }
  });

  app.post("/mcp", bearerAuth, async (req: Request, res: Response) => {
    try {
      const requestServer = createPublicFlexiMcpServer(db, config);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      await requestServer.connect(transport);
      await transport.handleRequest(req as any, res as any, req.body);
      res.on("close", () => {
        void transport.close();
        void requestServer.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: error instanceof Error ? error.message : "Internal server error" },
          id: null
        });
      }
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST for stateless Streamable HTTP." },
      id: null
    });
  });

  return { app, db, config };
}

export function startHttpApp(config = loadAppConfig()) {
  const { app } = createHttpApp(config);
  return app.listen(config.appPort, () => {
    console.error(`Flexi ChatGPT App listening on ${config.appBaseUrl}`);
  });
}
