# Current State Map

## Původní projekt

- Původní kód je TypeScript MCP harness pro lokální `stdio` klienty.
- Konfigurace je postavená na `flexi.config.json` profilech a credentials v `.env`.
- Auth do Flexi běží přes HTTP Basic auth a pro write requesty používá `auth=http`.
- Tool surface je accountant-first, ale pořád předpokládá jeden server-side profil a jednu firmu na profil.

## Nový ChatGPT App workspace

- `src/app/http.ts` přidává veřejnou HTTPS aplikaci s loginem, onboardingem a OAuth.
- `src/app/db.ts` zavádí persistentní multi-tenant model:
  - `users`
  - `organizations`
  - `organization_members`
  - `sessions`
  - `flexi_connections`
  - `encrypted_connection_secrets`
  - `oauth_clients`
  - `oauth_authorization_codes`
  - `oauth_tokens`
  - `audit_events`
  - `write_confirmations`
  - `document_drafts`
- `src/app/flexi-mcp-server.ts` staví veřejný MCP server nad přihlášeným uživatelem a aktivní organizací.

## Co zůstalo kompatibilní

- původní legacy harness dál existuje a lze ho spustit přes `npm run legacy:dev`
- původní DTO mapování, Flexi klient a účetní helpery se znovu používají
- stávající testy pro legacy vrstvu dál prochází

## Co se změnilo pro public app

- z tool inputů zmizel model `profile + company + env credentials`
- veřejné tooly používají jen `connection_alias` a OAuth token
- write akce jsou omezené rolí `owner/admin`
- Flexi credentials se ukládají šifrovaně do app storage
- public app vrací kompaktní business odpovědi bez interních request logů
