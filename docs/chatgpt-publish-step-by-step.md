# Step By Step: Od kódu po app v ChatGPT Webu

## 1. Lokální příprava

1. Otevřete tento workspace.
2. Spusťte:
   `npm install`
3. Zkopírujte `.env.production.example` na `.env`.
4. Vygenerujte encryption key:
   `node scripts/generate-app-key.mjs`
5. Doplňte `APP_BASE_URL`, `SUPPORT_EMAIL`, reviewer credentials a Cloudflare hostname.

## 2. Ověření před deployem

1. Spusťte:
   `npm run check`
   `npm test`
   `npm run build`
2. Lokálně ověřte:
   `npm run dev`
3. Otevřete:
   - `/login`
   - `/legal/privacy`
   - `/support`
   - `/review/demo`

## 3. Deploy na Ubuntu server

1. Nakopírujte projekt na server.
2. Na serveru:
   `npm install`
   `npm run build`
3. Připravte `.env`.
4. Nasaďte systemd služby a Cloudflare tunnel podle `docs/home-server-cloudflare-deploy.md`.
5. Spusťte `scripts/verify-production.sh https://vase-domena`.

## 4. Seed reviewer účtu

1. Po prvním startu se automaticky vytvoří reviewer user podle `REVIEWER_EMAIL`, `REVIEWER_PASSWORD`, `REVIEWER_NAME`.
2. Přihlaste se tímto účtem na produkční URL.
3. Vytvořte nebo připojte demo Flexi cloud connection.

## 5. Ověření MCP a OAuth

1. Ověřte metadata a MCP:
   - `GET /.well-known/oauth-authorization-server`
   - `POST /mcp`
2. V ChatGPT webu zapněte Developer Mode.
3. Přidejte custom app / MCP server na produkční URL.
4. Dokončete OAuth přihlášení.
5. Otestujte golden prompts:
   - zkontroluj připojení
   - najdi partnera
   - najdi neuhrazené doklady
   - zobraz accounting overview

## 6. Submission balíček

1. Vyplňte `submission/chatgpt-app-metadata.json`.
2. Zkopírujte texty z `submission/app-directory-listing.md`.
3. Zkontrolujte `submission/fill-before-submit.md`.
2. Připravte screenshoty:
   - login
   - workspace dashboard
   - přidání Flexi connection
   - ChatGPT tool run
4. Přiložte reviewer login a walkthrough z `submission/reviewer-guide.md`.

## 7. Po přijetí do directory

1. Sledujte uptime a logs.
2. Rotujte reviewer heslo a případně demo Flexi connection.
3. Upravte support kontakty a release notes.
