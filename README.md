# ABRA Flexi ChatGPT App

Tento workspace je veřejná ChatGPT App varianta původního projektu. Původní lokální `stdio` MCP zůstává v původním adresáři beze změny. Tady najdete:

- remote MCP server přes `POST /mcp`
- vlastní OAuth 2.1 auth server pro ChatGPT App
- webové onboarding UI pro firmy a účetní týmy
- multi-tenant správu organizací a Flexi připojení
- deployment a submission podklady pro ChatGPT App Directory

## Režimy spuštění

Veřejná app:

```bash
npm install
cp .env.example .env
npm run dev
```

Legacy lokální MCP harness:

```bash
npm run legacy:dev
```

## Co je v implementaci

- `src/app/http.ts`
  - Express app, login/register, workspace onboarding, OAuth endpoints a `POST /mcp`
- `src/app/oauth.ts`
  - OAuth provider pro ChatGPT App auth flow
- `src/app/db.ts`
  - SQLite persistence pro users, orgs, sessions, Flexi connections, OAuth data a audit
- `src/app/flexi-mcp-server.ts`
  - veřejný MCP tool surface nad šifrovanými Flexi connections
- `docs/`
  - architektura, Flexi auth poznámky, OpenAI app requirements, GDPR/security, deploy a publish guide

## Důležité env proměnné

- `APP_BASE_URL`
  - veřejná HTTPS URL aplikace
- `APP_ENCRYPTION_KEYS`
  - seznam klíčů ve formátu `v1:base64-or-random-secret`
- `SUPPORT_EMAIL`
  - kontakt pro support a submission
- `REVIEWER_EMAIL`, `REVIEWER_PASSWORD`
  - demo účet pro OpenAI review
- `CLOUDFLARE_TUNNEL_NAME`, `CLOUDFLARE_HOSTNAME`
  - deployment přes Named Tunnel

## Build a ověření

```bash
npm run check
npm test
npm run build
```

## Dokumentace

- [current-state-map](./docs/current-state-map.md)
- [abra-flexi-auth-and-api](./docs/abra-flexi-auth-and-api.md)
- [openai-chatgpt-app-requirements](./docs/openai-chatgpt-app-requirements.md)
- [security-compliance-gdpr](./docs/security-compliance-gdpr.md)
- [home-server-cloudflare-deploy](./docs/home-server-cloudflare-deploy.md)
- [chatgpt-publish-step-by-step](./docs/chatgpt-publish-step-by-step.md)
- [app-directory-submission-pack](./docs/app-directory-submission-pack.md)
- [costs-and-hosting-options](./docs/costs-and-hosting-options.md)
