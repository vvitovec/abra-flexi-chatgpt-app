import type { AppViewerContext, FlexiConnection, Organization } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function brandLockup(): string {
  return `
    <div class="brand-lockup" data-reveal>
      <span class="brand-mark">AF</span>
      <div class="brand-copy">
        <strong>ABRA Flexi</strong>
      </div>
    </div>
  `;
}

function actionLinks(items: Array<{ href: string; label: string; secondary?: boolean }>): string {
  return `
    <div class="actions">
      ${items.map((item) => `<a class="button${item.secondary ? " secondary" : ""}" href="${item.href}">${escapeHtml(item.label)}</a>`).join("")}
    </div>
  `;
}

function metric(label: string, value: string): string {
  return `
    <div class="metric" data-reveal>
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function listRow(title: string, meta: string, detail?: string, tone: "default" | "danger" = "default"): string {
  return `
    <li class="row">
      <div class="row-copy">
        <strong>${escapeHtml(title)}</strong>
        <span class="row-meta">${escapeHtml(meta)}</span>
        ${detail ? `<span class="row-detail ${tone === "danger" ? "danger" : ""}">${escapeHtml(detail)}</span>` : ""}
      </div>
    </li>
  `;
}

function workflowSection(options: {
  title: string;
  description: string;
  capabilities: string[];
  examples: string[];
}): string {
  return `
    <section class="content-section workflow" data-reveal>
      <div class="section-head">
        <div>
          <h2>${escapeHtml(options.title)}</h2>
        </div>
        <p>${escapeHtml(options.description)}</p>
      </div>
      <div class="workflow-grid">
        <div class="panel">
          <h3>Co umí</h3>
          <ul class="mini-list">
            ${options.capabilities.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
        <div class="panel">
          <h3>Příklady promptů</h3>
          <div class="example-stack">
            ${options.examples.map((item) => `<div class="example">${escapeHtml(item)}</div>`).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

export function pageTemplate(title: string, body: string): string {
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap");

    :root {
      --bg: #f3f7fc;
      --bg-strong: #edf3fa;
      --surface: rgba(255, 255, 255, 0.92);
      --surface-soft: rgba(248, 251, 255, 0.84);
      --ink: #182435;
      --muted: #66768a;
      --line: rgba(64, 96, 134, 0.14);
      --line-strong: rgba(64, 96, 134, 0.24);
      --brand: #5e89bb;
      --brand-deep: #466f9f;
      --brand-soft: rgba(94, 137, 187, 0.12);
      --danger: #b4544b;
      --warn: #98763d;
      --radius-xl: 10px;
      --radius-lg: 8px;
      --radius-md: 6px;
      --content: 1120px;
      --font-display: "Manrope", sans-serif;
      --font-body: "Manrope", sans-serif;
      --font-mono: "IBM Plex Mono", monospace;
    }

    * {
      box-sizing: border-box;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      margin: 0;
      font-family: var(--font-body);
      color: var(--ink);
      min-height: 100vh;
      background:
        radial-gradient(circle at 85% 8%, rgba(94, 137, 187, 0.16), transparent 24%),
        linear-gradient(180deg, #f8fbff 0%, var(--bg) 48%, var(--bg-strong) 100%);
      position: relative;
      overflow-x: hidden;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.72), transparent 28%),
        radial-gradient(circle at 15% 75%, rgba(94, 137, 187, 0.08), transparent 24%);
      opacity: 0.9;
    }

    a {
      color: inherit;
      text-decoration-color: rgba(24, 36, 53, 0.18);
      text-underline-offset: 0.18em;
    }

    .shell {
      width: min(var(--content), calc(100vw - 40px));
      margin: 0 auto;
      padding: 28px 0 52px;
      position: relative;
    }

    .page {
      display: grid;
      gap: 40px;
    }

    .hero {
      position: relative;
      padding: 8px 0 28px;
      border-bottom: 1px solid var(--line);
    }

    .hero-grid,
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.85fr);
      gap: 40px;
      align-items: start;
    }

    .auth-layout {
      align-items: stretch;
    }

    .auth-story {
      display: grid;
      align-content: start;
      gap: 28px;
    }

    .auth-forms {
      display: grid;
      gap: 18px;
      align-content: start;
    }

    .panel,
    .card,
    .hero-panel {
      border: 0;
      border-top: 1px solid var(--line);
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      padding: 18px 0 0;
      position: relative;
    }

    .form-panel,
    .soft-panel {
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--surface-soft);
      padding: 20px;
    }

    .hero-panel {
      min-height: 100%;
    }

    .section,
    .content-section {
      padding-top: 0;
    }

    .section {
      margin-top: 24px;
      border-top: 1px solid var(--line);
      padding-top: 18px;
    }

    .grid,
    .panel-grid,
    .doc-grid,
    .workflow-grid {
      display: grid;
      gap: 36px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .section-stack,
    .stack,
    form {
      display: grid;
      gap: 14px;
    }

    .section-head,
    .toolbar {
      display: flex;
      gap: 14px;
      justify-content: space-between;
      align-items: start;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }

    .section-head p,
    .toolbar p {
      margin: 0;
      max-width: 44ch;
    }

    .brand-lockup {
      display: inline-flex;
      align-items: center;
      gap: 12px;
    }

    .brand-mark {
      width: 40px;
      height: 40px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, var(--brand), var(--brand-deep));
      color: #f8fbff;
      font-size: 0.84rem;
      font-weight: 800;
      letter-spacing: 0.08em;
    }

    .brand-copy {
      display: grid;
      gap: 2px;
    }

    .brand-copy strong {
      font-size: 1.05rem;
      letter-spacing: -0.04em;
    }

    h1,
    h2,
    h3 {
      margin: 0;
      font-family: var(--font-display);
      letter-spacing: -0.06em;
      line-height: 0.94;
      font-weight: 800;
    }

    h1 {
      font-size: clamp(2rem, 5.4vw, 3.55rem);
      max-width: 8.2ch;
    }

    h2 {
      font-size: clamp(1.4rem, 3vw, 2rem);
    }

    h3 {
      font-size: 1rem;
      letter-spacing: -0.02em;
    }

    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.66;
      font-size: 0.97rem;
    }

    .lede {
      max-width: 54ch;
      font-size: 0.99rem;
    }

    .hero-copy {
      display: grid;
      align-content: start;
      gap: 20px;
      min-height: auto;
    }

    .hero-copy .actions {
      padding-top: 2px;
    }

    .metric-strip {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      padding-top: 4px;
    }

    .metric {
      display: grid;
      gap: 6px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }

    .metric-label {
      color: var(--muted);
      font-size: 0.74rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .metric strong {
      font-size: 1.4rem;
      letter-spacing: -0.06em;
    }

    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    .button,
    button {
      appearance: none;
      border: 1px solid transparent;
      border-radius: var(--radius-lg);
      background: var(--brand);
      color: #f8fbff;
      padding: 11px 16px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      text-decoration: none;
      transition: transform 180ms ease, background-color 180ms ease, border-color 180ms ease, color 180ms ease;
    }

    .button:hover,
    button:hover {
      transform: translateY(-1px);
      background: var(--brand-deep);
    }

    .button.secondary {
      background: transparent;
      border-color: var(--line-strong);
      color: var(--ink);
    }

    .button.secondary:hover {
      background: rgba(255, 255, 255, 0.8);
      border-color: var(--brand);
    }

    label {
      display: grid;
      gap: 8px;
      font-size: 0.86rem;
      font-weight: 700;
      letter-spacing: 0.005em;
      color: var(--ink);
    }

    input,
    select,
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: rgba(255, 255, 255, 0.9);
      padding: 12px 14px;
      font: inherit;
      color: var(--ink);
      transition: border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease;
    }

    input:focus,
    select:focus,
    textarea:focus {
      outline: none;
      border-color: rgba(94, 137, 187, 0.5);
      box-shadow: 0 0 0 3px rgba(94, 137, 187, 0.12);
      background: #fff;
    }

    textarea {
      min-height: 120px;
      resize: vertical;
    }

    .masked-secret {
      -webkit-text-security: disc;
    }

    .list,
    .rows {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0;
    }

    .row,
    .list li {
      border-top: 1px solid var(--line);
      padding-top: 12px;
      padding-bottom: 12px;
      transition: border-color 180ms ease, color 180ms ease;
    }

    .row:first-child,
    .list li:first-child {
      border-top: none;
      padding-top: 0;
    }

    .row:hover,
    .list li:hover {
      border-color: var(--brand);
    }

    .row-copy {
      display: grid;
      gap: 4px;
    }

    .row-copy strong {
      font-size: 1rem;
      letter-spacing: -0.03em;
    }

    .row-meta,
    .muted {
      color: var(--muted);
    }

    .row-detail {
      font-size: 0.92rem;
      color: var(--muted);
    }

    .notice,
    .tip {
      padding: 12px 14px;
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.78);
      color: var(--ink);
    }

    .notice {
      border-color: rgba(94, 137, 187, 0.18);
      background: rgba(94, 137, 187, 0.08);
    }

    .tip {
      border-color: rgba(141, 101, 16, 0.2);
      background: rgba(141, 101, 16, 0.08);
    }

    .mini-list {
      margin: 0;
      padding-left: 1.1rem;
      display: grid;
      gap: 10px;
      color: var(--muted);
      line-height: 1.6;
    }

    .example-stack {
      display: grid;
      gap: 10px;
    }

    .example {
      border-radius: var(--radius-md);
      padding: 13px 14px;
      border: 1px solid var(--line);
      background: rgba(248, 251, 255, 0.88);
      color: var(--ink);
      font-family: var(--font-mono);
      font-size: 0.9rem;
      line-height: 1.6;
    }

    .mono {
      font-family: var(--font-mono);
      font-size: 0.92em;
    }

    .danger {
      color: var(--danger);
    }

    .warn {
      color: var(--warn);
    }

    .detail-rail {
      display: grid;
      gap: 14px;
    }

    .keypoints {
      display: grid;
      gap: 12px;
    }

    .keypoint {
      display: grid;
      gap: 4px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }

    .site-footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      padding-top: 20px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 0.88rem;
    }

    [data-reveal] {
      transition: none;
    }

    @media (max-width: 960px) {
      .hero-grid,
      .split,
      .grid,
      .panel-grid,
      .doc-grid,
      .workflow-grid {
        grid-template-columns: 1fr;
      }

      .hero-copy {
        min-height: auto;
      }

      .metric-strip {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 720px) {
      .shell {
        width: min(var(--content), calc(100vw - 24px));
        padding-top: 12px;
      }

      .hero,
      .panel,
      .card,
      .hero-panel {
        padding-top: 16px;
      }

      h1 {
        font-size: clamp(1.7rem, 10vw, 2.6rem);
      }

      .actions {
        flex-direction: column;
        align-items: stretch;
      }

      .button,
      button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    ${body}
    <footer class="site-footer" data-reveal>
      <span>ABRA Flexi ChatGPT App</span>
      <div class="actions">
        <a href="/docs">Návod</a>
        <a href="/legal/privacy">Privacy</a>
        <a href="/legal/terms">Terms</a>
      </div>
    </footer>
  </div>
  <script>
    document.documentElement.classList.add("js");
    const nodes = document.querySelectorAll("[data-reveal]");
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });
    nodes.forEach((node) => observer.observe(node));
  </script>
</body>
</html>`;
}

export function homePage(viewer: AppViewerContext, connections: FlexiConnection[]): string {
  const organizations = viewer.organizations.length
    ? `<ul class="rows">${viewer.organizations.map((org) => listRow(org.name, org.slug, viewer.activeOrganization?.id === org.id ? "Aktivní workspace" : "Dostupný workspace")).join("")}</ul>`
    : "<p>Zatím nemáte žádnou organizaci. Založte si první workspace a přidejte Flexi připojení.</p>";

  const connectionList = connections.length
    ? `<ul class="rows">${connections.map((connection) => {
        const companyLabel = connection.company_slug
          ? `${connection.base_url}/c/${connection.company_slug}`
          : `${connection.base_url} · firma se volí dynamicky přes company_slug`;
        return listRow(connection.alias, companyLabel, connection.last_error ? connection.last_error : `Naposledy ověřeno: ${connection.last_checked_at ?? "nikdy"}`, connection.last_error ? "danger" : "default");
      }).join("")}</ul>`
    : "<p>Zatím není přidané žádné Flexi připojení.</p>";

  const userSummary = viewer.user
    ? `<div class="detail-rail">
         <h2>${escapeHtml(viewer.user.display_name)}</h2>
         <p>${escapeHtml(viewer.user.email)}</p>
         <div class="metric-strip">
           ${metric("Workspaces", String(viewer.organizations.length))}
           ${metric("Připojení", String(connections.length))}
           ${metric("Stav", viewer.activeOrganization ? "Připraveno" : "Bez workspace")}
         </div>
       </div>`
    : `<div class="detail-rail">
         <h2>Nejste přihlášený.</h2>
         <p>Přihlaste se a nastavte workspace, členy týmu a spravované Flexi připojení.</p>
       </div>`;

  return pageTemplate("ABRA Flexi ChatGPT App", `
    <main class="page">
      <section class="hero">
        <div class="hero-grid">
          <div class="hero-copy">
            ${brandLockup()}
            <div class="stack" data-reveal>
              <h1>ABRA Flexi v ChatGPT pro účetní tým.</h1>
              <p class="lede">Minimal interface pro přihlášení, správu workspace a bezpečné Flexi onboarding flow. Přístupové údaje se drží v aplikaci, ne v promptu.</p>
            </div>
            ${actionLinks([
              { href: "/docs", label: "Návod", secondary: true },
              viewer.user
                ? { href: `/orgs/${encodeURIComponent(viewer.activeOrganization?.id ?? "")}/settings`, label: "Nastavení workspace", secondary: true }
                : { href: "/login", label: "Přihlásit" },
              ...(viewer.user ? [{ href: "/logout", label: "Odhlásit", secondary: true }] : [])
            ])}
          </div>
          <aside class="hero-panel" data-reveal>
            ${userSummary}
          </aside>
        </div>
      </section>

      <section class="content-section" data-reveal>
        <div class="section-head">
          <div>
            <h2>Organizace a připojení</h2>
          </div>
          <p>První plocha ukazuje, co je připravené pro práci v ChatGPT a kde je potřeba doplnit konfiguraci.</p>
        </div>
        <div class="panel-grid">
          <section class="panel">
            <div class="toolbar">
              <div>
                <h3>Správa workspace</h3>
              </div>
              <a class="button secondary" href="/orgs/new">Nová organizace</a>
            </div>
            ${organizations}
          </section>
          <section class="panel">
            <div class="toolbar">
              <div>
                <h3>Managed connections</h3>
              </div>
              ${viewer.activeOrganization ? `<a class="button secondary" href="/connections/new">Přidat připojení</a>` : ""}
            </div>
            ${connectionList}
          </section>
        </div>
      </section>
    </main>
  `);
}

export function loginPage(error?: string, next?: string): string {
  return pageTemplate("Přihlášení", `
    <main class="page">
      <section class="hero">
        <div class="hero-grid auth-layout">
          <div class="auth-story">
            <div class="stack">
              ${brandLockup()}
              <div class="stack" data-reveal>
                <h1>Týmový přístup a bezpečný Flexi onboarding.</h1>
                <p class="lede">ChatGPT pracuje jen nad autorizovaným workspace. Flexi přístup zadáváte až po přihlášení ve spravovaném formuláři.</p>
              </div>
            </div>
            <div class="panel" data-reveal>
              <div class="keypoints">
                <div class="keypoint">
                  <strong>Správa organizace</strong>
                  <p>Oddělené workspace, role a pozvánky pro účetní tým.</p>
                </div>
                <div class="keypoint">
                  <strong>Bezpečné připojení</strong>
                  <p>Flexi credentials se ukládají šifrovaně a nikdy se nevrací do tool response.</p>
                </div>
                <div class="keypoint">
                  <strong>Čistý onboarding</strong>
                  <p>Nejdřív login, potom ověření připojení a výběr firem přes <span class="mono">company_slug</span>.</p>
                </div>
              </div>
            </div>
          </div>

          <div class="auth-forms">
            <section class="panel" data-reveal>
              <div class="section-head">
                <div>
                  <h2>Vrátit se do workspace</h2>
                </div>
              </div>
              ${error ? `<p class="notice danger">${escapeHtml(error)}</p>` : ""}
              <form method="post" action="/login">
                <input type="hidden" name="next" value="${escapeHtml(next ?? "/")}" />
                <label>E-mail<input type="email" name="email" required autocomplete="email" /></label>
                <label>Heslo<input type="password" name="password" required autocomplete="current-password" /></label>
                <button type="submit">Přihlásit</button>
              </form>
            </section>

            <section class="panel" data-reveal>
              <div class="section-head">
                <div>
                  <h2>Vytvořit nový účet</h2>
                </div>
              </div>
              <form method="post" action="/register">
                <input type="hidden" name="next" value="${escapeHtml(next ?? "/")}" />
                <label>E-mail<input type="email" name="email" required autocomplete="email" /></label>
                <label>Heslo<input type="password" name="password" required minlength="12" autocomplete="new-password" /></label>
                <label>Název organizace<input type="text" name="organization_name" required autocomplete="organization" /></label>
                <label>Base URL Flexi<input type="url" name="base_url" required placeholder="https://example.flexibee.eu" /></label>
                <label>Slug firmy<input type="text" name="company_slug" placeholder="volitelné, lze vybrat až v toolu" /></label>
                <label>REST API uživatel<input type="text" name="username" required /></label>
                <label>Heslo API uživatele<input type="hidden" name="flexi_password" /><input type="text" required class="masked-secret" autocomplete="off" spellcheck="false" autocapitalize="none" data-1p-ignore="true" data-lpignore="true" data-form-type="other" oninput="this.previousElementSibling.value = this.value" /></label>
                <button type="submit">Založit účet</button>
              </form>
            </section>
          </div>
        </div>
      </section>
    </main>
  `);
}

export function organizationSettingsPage(
  org: Organization,
  members: Array<{ email: string; display_name: string; role: string; status: string }>,
  connections: FlexiConnection[],
  message?: string
): string {
  return pageTemplate(`${org.name} – nastavení`, `
    <main class="page">
      <section class="hero">
        <div class="hero-grid">
          <div class="hero-copy">
            ${brandLockup()}
            <div class="stack" data-reveal>
              <h1>${escapeHtml(org.name)}</h1>
              <p class="lede">Správa členů týmu, rolí a ověřených Flexi připojení v rámci jednoho workspace.</p>
              <p class="mono">${escapeHtml(org.slug)}</p>
            </div>
            ${actionLinks([
              { href: "/", label: "Dashboard", secondary: true },
              { href: "/connections/new", label: "Přidat Flexi připojení" }
            ])}
          </div>
          <aside class="hero-panel" data-reveal>
            <div class="detail-rail">
              <h2>Workspace status</h2>
              <div class="metric-strip">
                ${metric("Členové", String(members.length))}
                ${metric("Připojení", String(connections.length))}
                ${metric("Slug", org.slug)}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section class="content-section" data-reveal>
        <div class="panel-grid">
          <section class="panel">
            <div class="section-head">
              <div>
                <h2>Členové</h2>
              </div>
            </div>
            ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
            <ul class="rows">
              ${members.map((member) => listRow(member.display_name, member.email, `${member.role} · ${member.status}`)).join("")}
            </ul>
            <div class="section">
              <h3>Pozvat člena</h3>
              <form method="post" action="/orgs/${encodeURIComponent(org.id)}/invite">
                <label>E-mail<input type="email" name="email" required /></label>
                <label>Role
                  <select name="role">
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <button type="submit">Vytvořit pozvánku</button>
              </form>
            </div>
          </section>

          <section class="panel">
            <div class="section-head">
              <div>
                <h2>Připojení</h2>
              </div>
            </div>
            <ul class="rows">
              ${connections.map((connection) => {
                const companyLabel = connection.company_slug
                  ? `${connection.base_url}/c/${connection.company_slug}`
                  : `${connection.base_url} · výběr firmy dynamicky přes company_slug`;
                return listRow(
                  connection.alias,
                  companyLabel,
                  connection.last_error ? connection.last_error : `${connection.default_format.toUpperCase()} · ${connection.mode}`,
                  connection.last_error ? "danger" : "default"
                );
              }).join("")}
            </ul>
          </section>
        </div>
      </section>
    </main>
  `);
}

export function connectionFormPage(message?: string, error?: string): string {
  return pageTemplate("Nové Flexi připojení", `
    <main class="page">
      <section class="hero">
        <div class="hero-grid">
          <div class="hero-copy">
            ${brandLockup()}
            <div class="stack" data-reveal>
              <h1>Přidat ověřené Flexi připojení.</h1>
              <p class="lede">V1 cílí na cloudové ABRA Flexi instance dostupné po HTTPS. Použijte dedikovaného REST API uživatele a otestujte spojení před uložením.</p>
            </div>
          </div>
          <aside class="hero-panel" data-reveal>
            <div class="detail-rail">
              <h2>Co bude aplikace kontrolovat</h2>
              <div class="keypoints">
                <div class="keypoint">
                  <strong>Dostupnost instanci</strong>
                  <p>Base URL musí vracet Flexi API po HTTPS.</p>
                </div>
                <div class="keypoint">
                  <strong>Firemní kontext</strong>
                  <p>Pokud účet vidí více firem, můžete nechat <span class="mono">company_slug</span> prázdný.</p>
                </div>
                <div class="keypoint">
                  <strong>Formát odpovědí</strong>
                  <p>JSON jako výchozí, XML když ho potřebujete pro konkrétní workflow.</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section class="content-section" data-reveal>
        <div class="panel-grid">
          <section class="panel">
            ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
            ${error ? `<p class="notice danger">${escapeHtml(error)}</p>` : ""}
            <form method="post" action="/connections/new">
              <label>Alias připojení<input type="text" name="alias" required pattern="[a-z0-9-]+" /></label>
              <label>Base URL Flexi<input type="url" name="base_url" required placeholder="https://example.flexibee.eu" /></label>
              <label>Slug firmy<input type="text" name="company_slug" placeholder="volitelné, lze vybrat až v toolu" /></label>
              <label>REST API uživatel<input type="text" name="username" required /></label>
              <label>Heslo<input type="password" name="password" required /></label>
              <label>Formát
                <select name="default_format">
                  <option value="json">JSON</option>
                  <option value="xml">XML</option>
                </select>
              </label>
              <button type="submit">Uložit a otestovat</button>
            </form>
          </section>

          <section class="panel">
            <div class="section-head">
              <div>
                <h2>Doporučené nastavení</h2>
              </div>
            </div>
            <ul class="mini-list">
              <li>Pokud REST API uživatel vidí více firem, firmu vybírejte až při MCP tool callu přes <span class="mono">company_slug</span>.</li>
              <li>Používejte samostatný technický účet s odpovídajícími oprávněními.</li>
              <li>Po uložení aplikace provede ověření dostupnosti a vrátí jen stručný výsledek bez citlivých dat.</li>
            </ul>
          </section>
        </div>
      </section>
    </main>
  `);
}

export function legalPage(title: string, paragraphs: string[]): string {
  return pageTemplate(title, `
    <main class="page">
      <section class="hero">
        <div class="hero-grid">
          <div class="hero-copy">
            ${brandLockup()}
            <div class="stack" data-reveal>
              <h1>${escapeHtml(title)}</h1>
            </div>
          </div>
          <aside class="hero-panel" data-reveal>
            <p>Krátké provozní zásady pro zpracování přístupů, audit logů a odpovědností při používání aplikace.</p>
          </aside>
        </div>
      </section>
      <section class="content-section" data-reveal>
        <section class="panel">
          <div class="section-stack">
            ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
          </div>
        </section>
      </section>
    </main>
  `);
}

export function supportPage(): string {
  return pageTemplate("Návod", `
    <main class="page">
      <section class="hero">
        <div class="hero-grid">
          <div class="hero-copy">
            ${brandLockup()}
            <div class="stack" data-reveal>
              <h1>Podpora je nově součástí Návodu.</h1>
              <p class="lede">Všechny informace o supportu, reviewer účtu a provozním kontaktu najdete přímo na stránce Návod.</p>
            </div>
          </div>
          <aside class="hero-panel" data-reveal>
            <div class="detail-rail">
              <h2>Otevřít Návod</h2>
              <p>Přejděte na jednotnou stránku s workflow i support informacemi.</p>
              <div class="actions"><a class="button" href="/docs">Návod</a></div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  `);
}

export function docsPage(): string {
  return pageTemplate("Návod", `
    <main class="page">
      <section class="hero">
        <div class="hero-grid">
          <div class="hero-copy">
            ${brandLockup()}
            <div class="stack" data-reveal>
              <h1>Praktický průvodce pro účetní tým v ChatGPT.</h1>
              <p class="lede">Zaměřeno na reálné workflow: triáž, DPH, HR, cashflow, nesrovnalosti a přípravu dokladů bez ručního proklikávání ve Flexi.</p>
            </div>
            ${actionLinks([
              { href: "/", label: "Dashboard", secondary: true }
            ])}
          </div>
          <aside class="hero-panel" data-reveal>
            <div class="detail-rail">
              <ul class="mini-list">
                <li><strong>Workspace</strong> drží členy týmu a uložená připojení.</li>
                <li><strong>Connection alias</strong> je jméno spravovaného Flexi připojení.</li>
                <li><strong>company_slug</strong> vybírá konkrétní firmu ve Flexi.</li>
                <li><strong>Prompt</strong> popisuje úkol, ne název toolu.</li>
              </ul>
            </div>
          </aside>
        </div>
      </section>

      ${workflowSection({
        title: "Ranní triáž a oficiální exporty",
        description: "Nejsilnější vstup pro rychlý přehled priorit, rizik a oficiálních PDF exportů bez ručního procházení Flexi.",
        capabilities: [
          "ranní přehled toho, co řešit jako první",
          "fronta rizik pro uzávěrku, cashflow a neuhrazené položky",
          "oficiální PDF export soupisu aktiv a pasiv přímo z ABRA Flexi"
        ],
        examples: [
          "Co má účetní dnes řešit jako první ve firmě albac_s_r_o_?",
          "Exportuj soupis aktiv a pasiv za firmu albac_s_r_o_ jako PDF.",
          "Stáhni oficiální PDF soupisu aktiv a pasiv za období 2026 pro firmu albac_s_r_o_."
        ]
      })}

      <section class="content-section" data-reveal>
        <div class="panel-grid">
          <section class="panel">
            <h2>Jak psát dotazy</h2>
            <ul class="mini-list">
              <li>Napište vždy co chcete zjistit, ne jaký tool se má spustit.</li>
              <li>Pokud máte více firem, uveďte ji jménem nebo slugem.</li>
              <li>U dokladů pomůže číslo dokladu, partner, období nebo variabilní symbol.</li>
              <li>U HR pomůže jméno zaměstnance nebo osobní číslo.</li>
              <li>U přehledů uveďte období: měsíc, kvartál nebo rozsah.</li>
            </ul>
          </section>
          <section class="panel">
            <h2>Co nedělat</h2>
            <ul class="mini-list">
              <li>Nevkládejte do promptu hesla, API údaje ani interní citlivé poznámky.</li>
              <li>Nezadávejte write akce bez kontroly, pokud čekáte jen analýzu.</li>
              <li>Nespoléhejte na první odpověď u právních nebo daňových rozhodnutí bez lidské kontroly.</li>
            </ul>
            <p class="tip">Do promptu nikdy nevkládejte hesla ani Flexi credentials. Přístup se zadává jen v onboarding formuláři aplikace.</p>
          </section>
        </div>
      </section>

      <section class="content-section" data-reveal>
        <div class="panel-grid">
          <section class="panel">
            <h2>Support a reviewer přístup</h2>
            <p>Primární support je e-mail uvedený v <span class="mono">SUPPORT_EMAIL</span>. Slouží jako hlavní kontakt pro běžný provoz i pro OpenAI review.</p>
            <p class="section">Pro App Directory submission použijte demo účet bez 2FA a přiložte screenshoty onboarding flow, přidání Flexi connection a MCP test promptů.</p>
          </section>
          <section class="panel">
            <h2>Co má být připravené</h2>
            <ul class="mini-list">
              <li>demo účet bez 2FA blokátorů</li>
              <li>sample organizace s bezpečnými daty</li>
              <li>alespoň jedno review-ready Flexi připojení</li>
              <li>jasný walkthrough pro onboarding a test prompty</li>
            </ul>
          </section>
        </div>
      </section>

      ${workflowSection({
        title: "Personalistika a zaměstnanci",
        description: "Rychlé odpovědi nad zaměstnanci, pracovními poměry a HR přehledy pro každodenní personální dotazy.",
        capabilities: [
          "vypsat aktivní zaměstnance",
          "ukázat detail jednoho zaměstnance",
          "prohledat pracovní poměry a další HR záznamy"
        ],
        examples: [
          "Vypiš aktivní zaměstnance firmy albac sro.",
          "Řekni mi detail zaměstnance Monika Pajdlová ve firmě albac_s_r_o_.",
          "Najdi HR záznamy pro osobní číslo 3 za rok 2026."
        ]
      })}

      ${workflowSection({
        title: "DPH a období",
        description: "Rychlý přehled za zvolené období a orientace před měsíční uzávěrkou. Vhodné pro první kontrolu, ne jako náhrada formálního podání.",
        capabilities: [
          "souhrn DPH za vydané a přijaté faktury",
          "uzávěrkový checklist s prioritami",
          "upozornění na neuhrazené nebo podezřelé stavy"
        ],
        examples: [
          "Ukaž DPH souhrn za únor 2026 pro firmu albac_s_r_o_.",
          "Připrav mi checklist pro měsíční uzávěrku za březen 2026.",
          "Co je potřeba dořešit před uzavřením období 2026-03?"
        ]
      })}

      ${workflowSection({
        title: "Cashflow a priority",
        description: "Denní fronta účetního týmu: co je po splatnosti, co je potřeba zaplatit nebo urgovat a kde vzniká finanční riziko.",
        capabilities: [
          "cashflow snapshot k dnešnímu dni",
          "pracovní frontu účetních úkolů",
          "přehled největších rizik a položek po splatnosti"
        ],
        examples: [
          "Ukaž cashflow snapshot pro firmu albac_s_r_o_.",
          "Co má účetní dnes řešit jako první?",
          "Vypiš největší závazky po splatnosti."
        ]
      })}

      ${workflowSection({
        title: "Kontrola plateb a nesrovnalostí",
        description: "Hledá případy, které stojí za ruční kontrolu: nesedící úhrady, chybějící párování nebo problémové doklady.",
        capabilities: [
          "najít platební výjimky",
          "ukázat proč je konkrétní doklad problémový",
          "přeložit technický stav do lidského vysvětlení"
        ],
        examples: [
          "Najdi platební nesrovnalosti za poslední měsíc.",
          "Vysvětli mi problém dokladu 2/26 ve firmě albac_s_r_o_.",
          "Které doklady vypadají jako špatně spárované?"
        ]
      })}

      ${workflowSection({
        title: "Příprava dokladů",
        description: "Připraví draft faktury z běžného zadání, dohledá partnera a položky a vrátí přesně, co ještě chybí.",
        capabilities: [
          "připravit draft faktury z kontextu",
          "dohledat partnera a produkt",
          "vrátit stav needs_input, když něco chybí"
        ],
        examples: [
          "Připrav draft vydané faktury pro partnera ČEVAK na 1 položku voda za 1000 Kč.",
          "Zkus připravit fakturu pro New Human Solution a řekni, co ještě chybí.",
          "Nevystavuj nic hned, jen připrav návrh a ukaž nejasnosti."
        ]
      })}

      <section class="content-section" data-reveal>
        <div class="panel-grid">
          <section class="panel">
            <h2>Jak pracovat s více firmami</h2>
            <ul class="mini-list">
              <li>Řekněte „ukaž firmy dostupné pro connection alias Abra-Albac“.</li>
              <li>Pak napište úkol už nad konkrétní firmou, například „ve firmě albac_s_r_o_ ukaž zaměstnance“.</li>
              <li>Pokud firmu neuvedete a connection nemá výchozí firmu, aplikace si o ni řekne.</li>
            </ul>
          </section>
          <section class="panel">
            <h2>Co funguje nejlépe</h2>
            <ul class="mini-list">
              <li>Pište krátké, konkrétní úkoly. Jedna otázka bývá lepší než pět požadavků najednou.</li>
              <li>Když výsledek nesedí, upřesněte období, firmu nebo doklad.</li>
              <li>Pro kontrolu používejte formulace jako „vysvětli proč“, „najdi nesrovnalosti“, „co mám řešit dnes“.</li>
              <li>Pro HR používejte jméno nebo osobní číslo, pro doklady číslo dokladu nebo partnera.</li>
            </ul>
          </section>
        </div>
      </section>
    </main>
  `);
}
