import { resolve } from "node:path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { pageTemplate, homePage, loginPage, organizationSettingsPage, connectionFormPage, legalPage, reviewPage, supportPage } from "./html.js";
import { loadAppConfig, type AppConfig } from "./config.js";
import { AppDatabase } from "./db.js";
import { createPublicFlexiMcpServer } from "./flexi-mcp-server.js";
import { encryptJson, hashPassword, verifyPassword } from "./crypto.js";
import { clearSessionCookie, loadSessionState, setSessionCookie } from "./session.js";
import { FlexiAppOAuthProvider } from "./oauth.js";
import { FlexiClient } from "../client.js";
import { AuditStore } from "../audit.js";
import type { ResolvedProfile } from "../types.js";
import { defaultEvidencePermissions } from "./default-permissions.js";

function createTemporaryProfile(input: {
  alias: string;
  baseUrl: string;
  companySlug: string;
  defaultFormat: "json" | "xml";
  username: string;
  password: string;
}): ResolvedProfile {
  return {
    name: input.alias,
    baseUrl: input.baseUrl,
    company: input.companySlug,
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
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const state = loadSessionState(req, db, config);
    (req as any).viewer = state;
    res.locals.viewer = state;
    next();
  });

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(config.appBaseUrl),
    baseUrl: new URL(config.appBaseUrl),
    resourceServerUrl: new URL(`${config.appBaseUrl}/mcp`),
    resourceName: "ABRA Flexi ChatGPT App",
    serviceDocumentationUrl: new URL(`${config.appBaseUrl}/support`),
    scopesSupported: ["mcp:read", "mcp:write"]
  }));

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

  app.post("/register", (req: Request, res: Response) => {
    const { email, password, display_name, organization_name, organization_slug, next } = req.body as Record<string, string>;
    if (db.findUserByEmail(email)) {
      res.type("html").status(409).send(loginPage("Účet s tímto e-mailem už existuje.", next));
      return;
    }
    const user = db.createUser(email, hashPassword(password), display_name);
    const organization = db.createOrganizationWithOwner(organization_name, organization_slug, user.id);
    const session = db.createSession(user.id, organization.id);
    setSessionCookie(res, config, session.id);
    res.redirect(next || "/");
  });

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
        <div class="stack"><span class="badge">Workspace</span><h1>Nová organizace</h1></div>
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
    const { alias, base_url, company_slug, username, password, default_format } = req.body as Record<string, string>;
    const tempProfile = createTemporaryProfile({
      alias,
      baseUrl: base_url,
      companySlug: company_slug,
      defaultFormat: default_format === "xml" ? "xml" : "json",
      username,
      password
    });

    try {
      const companiesResponse = await flexiClient.request({
        operation: "onboarding_check_companies",
        profile: tempProfile,
        method: "GET",
        path: flexiClient.buildServerPath(tempProfile.defaultFormat),
        format: tempProfile.defaultFormat
      });
      const evidenceResponse = await flexiClient.request({
        operation: "onboarding_check_evidence",
        profile: tempProfile,
        company: company_slug,
        method: "GET",
        path: flexiClient.buildCompanyPath(tempProfile, company_slug, "evidence-list"),
        format: tempProfile.defaultFormat
      });
      if (!companiesResponse.ok || !evidenceResponse.ok) {
        const issues = [...companiesResponse.errors, ...evidenceResponse.errors].join("; ") || "Flexi connection test failed.";
        res.type("html").status(400).send(connectionFormPage(undefined, issues));
        return;
      }

      const encrypted = encryptJson(config, { username, password });
      const connection = db.createConnection({
        organizationId: viewer.session.active_org_id,
        alias,
        baseUrl: base_url,
        companySlug: company_slug,
        defaultFormat: default_format === "xml" ? "xml" : "json",
        mode: "prod",
        keyVersion: encrypted.keyVersion,
        encryptedSecret: JSON.stringify(encrypted)
      });
      db.updateConnectionCheck(connection.id, true);
      redirectWithMessage(res, "/connections/new", `Připojení '${alias}' bylo uloženo a ověřeno.`);
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

  app.get("/review/demo", (_req: Request, res: Response) => {
    res.type("html").send(reviewPage());
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
