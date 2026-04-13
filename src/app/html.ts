import type { AppViewerContext, FlexiConnection, Organization } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function pageTemplate(title: string, body: string): string {
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #f7f3eb;
      --panel: rgba(255, 252, 245, 0.92);
      --ink: #17202a;
      --muted: #5e635c;
      --line: rgba(34, 45, 38, 0.14);
      --brand: #0d6b57;
      --brand-soft: #e5f2ee;
      --warn: #8d5a12;
      --danger: #9f2f1c;
      --shadow: 0 24px 80px rgba(22, 26, 23, 0.12);
      --radius: 22px;
      --font-display: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
      --font-body: "Avenir Next", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-body);
      color: var(--ink);
      background:
        radial-gradient(circle at 10% 10%, rgba(13, 107, 87, 0.10), transparent 28%),
        radial-gradient(circle at 90% 20%, rgba(141, 90, 18, 0.12), transparent 24%),
        linear-gradient(180deg, #fcfaf4 0%, var(--bg) 100%);
      min-height: 100vh;
    }
    .shell {
      width: min(1080px, calc(100vw - 32px));
      margin: 24px auto 64px;
    }
    .hero {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding: 28px 32px 20px;
    }
    h1, h2, h3 {
      font-family: var(--font-display);
      letter-spacing: -0.03em;
      margin: 0;
    }
    h1 { font-size: clamp(2.2rem, 3vw, 3.6rem); line-height: 0.95; max-width: 9ch; }
    h2 { font-size: 1.5rem; margin-bottom: 12px; }
    p { color: var(--muted); line-height: 1.6; }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(20px);
    }
    .grid {
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      padding: 0 32px 32px;
    }
    .section { padding: 24px 28px; }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 999px;
      background: var(--brand-soft);
      color: var(--brand);
      font-size: 0.86rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    form { display: grid; gap: 14px; }
    label { display: grid; gap: 8px; font-size: 0.95rem; font-weight: 600; }
    input, select, textarea {
      width: 100%;
      border: 1px solid rgba(23, 32, 42, 0.14);
      background: rgba(255, 255, 255, 0.85);
      border-radius: 14px;
      padding: 12px 14px;
      font: inherit;
      color: inherit;
    }
    textarea { min-height: 110px; resize: vertical; }
    button, .button {
      appearance: none;
      border: none;
      border-radius: 14px;
      background: linear-gradient(135deg, #0d6b57, #0f8a70);
      color: white;
      padding: 12px 16px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .button.secondary {
      background: white;
      color: var(--ink);
      border: 1px solid var(--line);
    }
    .stack { display: grid; gap: 12px; }
    .mono { font-family: "SFMono-Regular", "Menlo", monospace; }
    .muted { color: var(--muted); }
    .danger { color: var(--danger); }
    .warn { color: var(--warn); }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 18px;
    }
    .list {
      display: grid;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .list li {
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.72);
    }
    .split {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
    }
    .split > * { flex: 1 1 220px; }
    .notice {
      border-left: 4px solid var(--brand);
      padding-left: 14px;
      margin: 12px 0 0;
    }
    @media (max-width: 720px) {
      .shell { width: min(100vw - 20px, 1080px); margin-top: 12px; }
      .hero, .grid { padding-left: 18px; padding-right: 18px; }
      .section { padding: 20px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    ${body}
  </div>
</body>
</html>`;
}

export function homePage(viewer: AppViewerContext, connections: FlexiConnection[]): string {
  const organizations = viewer.organizations.length
    ? `<ul class="list">${viewer.organizations.map((org) => `<li><strong>${escapeHtml(org.name)}</strong><br><span class="muted">${escapeHtml(org.slug)}</span></li>`).join("")}</ul>`
    : `<p>Zatím nemáte žádnou organizaci. Založte si první workspace a přidejte Flexi připojení.</p>`;

  const connectionList = connections.length
    ? `<ul class="list">${connections.map((connection) => `<li><strong>${escapeHtml(connection.alias)}</strong><br><span class="muted mono">${escapeHtml(connection.base_url)}/c/${escapeHtml(connection.company_slug)}</span><br><span class="muted">Naposledy ověřeno: ${escapeHtml(connection.last_checked_at ?? "nikdy")}</span>${connection.last_error ? `<p class="danger">${escapeHtml(connection.last_error)}</p>` : ""}</li>`).join("")}</ul>`
    : `<p>Zatím není přidané žádné Flexi připojení.</p>`;

  return pageTemplate("ABRA Flexi ChatGPT App", `
    <section class="hero card">
      <div class="stack">
        <span class="badge">ChatGPT App</span>
        <h1>ABRA Flexi pro účetní týmy</h1>
        <p>Remote MCP app pro ChatGPT web. Každá firma má vlastní workspace, vlastní členy týmu a vlastní šifrovaně uložené Flexi API připojení.</p>
      </div>
      <div class="stack">
        ${viewer.user ? `<div><strong>${escapeHtml(viewer.user.display_name)}</strong><br><span class="muted">${escapeHtml(viewer.user.email)}</span></div>` : `<div class="muted">Nejste přihlášený.</div>`}
        <div class="split">
          ${viewer.user ? `<a class="button secondary" href="/orgs/${encodeURIComponent(viewer.activeOrganization?.id ?? "")}/settings">Nastavení workspace</a><a class="button secondary" href="/logout">Odhlásit</a>` : `<a class="button" href="/login">Přihlásit</a>`}
        </div>
      </div>
    </section>
    <div class="grid">
      <section class="card section">
        <div class="toolbar"><h2>Organizace</h2><a class="button secondary" href="/orgs/new">Nová organizace</a></div>
        ${organizations}
      </section>
      <section class="card section">
        <div class="toolbar"><h2>Flexi připojení</h2>${viewer.activeOrganization ? `<a class="button secondary" href="/connections/new">Přidat připojení</a>` : ""}</div>
        ${connectionList}
      </section>
    </div>
  `);
}

export function loginPage(error?: string, next?: string): string {
  return pageTemplate("Přihlášení", `
    <section class="hero card">
      <div class="stack">
        <span class="badge">Sign in</span>
        <h1>Přihlášení do aplikace</h1>
        <p>ChatGPT bude používat pouze autorizované připojení vaší organizace. Flexi přístupy se zadávají až po přihlášení v onboarding UI, nikdy ne do promptu.</p>
      </div>
    </section>
    <div class="grid">
      <section class="card section">
        <h2>Přihlášení</h2>
        ${error ? `<p class="danger">${escapeHtml(error)}</p>` : ""}
        <form method="post" action="/login">
          <input type="hidden" name="next" value="${escapeHtml(next ?? "/")}" />
          <label>E-mail<input type="email" name="email" required /></label>
          <label>Heslo<input type="password" name="password" required /></label>
          <button type="submit">Přihlásit</button>
        </form>
      </section>
      <section class="card section">
        <h2>Vytvoření účtu</h2>
        <form method="post" action="/register">
          <input type="hidden" name="next" value="${escapeHtml(next ?? "/")}" />
          <label>Jméno<input type="text" name="display_name" required /></label>
          <label>E-mail<input type="email" name="email" required /></label>
          <label>Heslo<input type="password" name="password" required minlength="12" /></label>
          <label>Název organizace<input type="text" name="organization_name" required /></label>
          <label>Slug organizace<input type="text" name="organization_slug" required pattern="[a-z0-9-]+" /></label>
          <button type="submit">Založit účet</button>
        </form>
      </section>
    </div>
  `);
}

export function organizationSettingsPage(org: Organization, members: Array<{ email: string; display_name: string; role: string; status: string }>, connections: FlexiConnection[], message?: string): string {
  return pageTemplate(`${org.name} – nastavení`, `
    <section class="hero card">
      <div class="stack">
        <span class="badge">Workspace</span>
        <h1>${escapeHtml(org.name)}</h1>
        <p class="mono">${escapeHtml(org.slug)}</p>
      </div>
      <div class="stack">
        <a class="button secondary" href="/">Dashboard</a>
        <a class="button secondary" href="/connections/new">Přidat Flexi připojení</a>
      </div>
    </section>
    <div class="grid">
      <section class="card section">
        <h2>Členové</h2>
        ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
        <ul class="list">
          ${members.map((member) => `<li><strong>${escapeHtml(member.display_name)}</strong><br><span class="muted">${escapeHtml(member.email)}</span><br><span class="muted">${escapeHtml(member.role)} · ${escapeHtml(member.status)}</span></li>`).join("")}
        </ul>
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
      </section>
      <section class="card section">
        <h2>Připojení</h2>
        <ul class="list">
          ${connections.map((connection) => `<li><strong>${escapeHtml(connection.alias)}</strong><br><span class="muted mono">${escapeHtml(connection.base_url)}/c/${escapeHtml(connection.company_slug)}</span><br><span class="muted">${escapeHtml(connection.default_format.toUpperCase())} · ${escapeHtml(connection.mode)}</span>${connection.last_error ? `<p class="danger">${escapeHtml(connection.last_error)}</p>` : ""}</li>`).join("")}
        </ul>
      </section>
    </div>
  `);
}

export function connectionFormPage(message?: string, error?: string): string {
  return pageTemplate("Nové Flexi připojení", `
    <section class="hero card">
      <div class="stack">
        <span class="badge">Onboarding</span>
        <h1>Přidat Flexi připojení</h1>
        <p>V1 podporuje jen cloud ABRA Flexi instance veřejně dostupné po HTTPS. Použijte dedikovaného REST API uživatele.</p>
      </div>
    </section>
    <div class="grid">
      <section class="card section">
        ${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
        ${error ? `<p class="danger">${escapeHtml(error)}</p>` : ""}
        <form method="post" action="/connections/new">
          <label>Alias připojení<input type="text" name="alias" required pattern="[a-z0-9-]+" /></label>
          <label>Base URL Flexi<input type="url" name="base_url" required placeholder="https://example.flexibee.eu" /></label>
          <label>Slug firmy<input type="text" name="company_slug" required /></label>
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
    </div>
  `);
}

export function legalPage(title: string, paragraphs: string[]): string {
  return pageTemplate(title, `
    <section class="hero card">
      <div class="stack">
        <span class="badge">Legal</span>
        <h1>${escapeHtml(title)}</h1>
      </div>
    </section>
    <div class="grid">
      <section class="card section">
        ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      </section>
    </div>
  `);
}

export function supportPage(): string {
  return pageTemplate("Support", `
    <section class="hero card">
      <div class="stack">
        <span class="badge">Support</span>
        <h1>Podpora a reviewer přístup</h1>
        <p>Součástí deployment balíčku je reviewer demo účet, sample organizace a samostatný review walkthrough pro OpenAI App Directory.</p>
      </div>
    </section>
    <div class="grid">
      <section class="card section">
        <h2>Support channel</h2>
        <p>Primární support: e-mail uvedený v <span class="mono">.env</span> jako <span class="mono">SUPPORT_EMAIL</span>.</p>
        <p>Pro App Directory submission použijte demo účet bez 2FA a přiložte screenshoty z onboarding flow, přidání Flexi connection a MCP test promptů.</p>
      </section>
    </div>
  `);
}

export function reviewPage(): string {
  return pageTemplate("Reviewer demo", `
    <section class="hero card">
      <div class="stack">
        <span class="badge">Reviewer Demo</span>
        <h1>Review-ready walkthrough</h1>
        <p>Tato stránka shrnuje demo účet, testovací data a přesné kroky pro manuální ověření ChatGPT App reviewerem.</p>
      </div>
    </section>
    <div class="grid">
      <section class="card section">
        <ol class="list">
          <li>Přihlaste se demo účtem z deployment dokumentace.</li>
          <li>Ověřte, že organizace „Review Demo Organization“ obsahuje alespoň jedno Flexi cloud connection.</li>
          <li>Připojte app v ChatGPT Developer Mode, dokončete OAuth flow a spusťte golden prompts.</li>
          <li>Zkontrolujte, že write nástroje vyžadují potvrzovací token a nevrací interní debug metadata.</li>
        </ol>
      </section>
    </div>
  `);
}
