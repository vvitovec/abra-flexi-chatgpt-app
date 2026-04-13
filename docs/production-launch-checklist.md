# Production Launch Checklist

## 1. Infrastructure

- production app runs on a stable HTTPS hostname
- DNS resolves to the public hostname used in `APP_BASE_URL`
- Cloudflare Named Tunnel is running and auto-starting after reboot
- app process is managed by `systemd`
- backups are configured for `.env` and `APP_DATA_DIR`
- restore has been tested on a separate host or directory

## 2. App Configuration

- `.env` was created from `.env.production.example`
- `APP_BASE_URL`, `APP_DOMAIN`, and `WIDGET_RESOURCE_DOMAIN` match exactly
- `APP_ENCRYPTION_KEYS` was generated with `scripts/generate-app-key.mjs`
- `SUPPORT_EMAIL` is a real monitored inbox
- reviewer credentials are strong and stored safely
- `APP_COOKIE_SECURE=true` is enabled in production

## 3. Product Setup

- reviewer account can log in without 2FA blockers
- a demo organization exists
- at least one demo cloud Flexi connection exists
- the demo organization contains safe, reviewable sample data
- write flows are limited to safe demo data only

## 4. QA Before Submission

- `npm run check`
- `npm test`
- `npm run build`
- `scripts/verify-production.sh https://your-domain`
- login, logout, and session persistence work
- organization creation works
- member invite works
- Flexi connection onboarding works
- OAuth connect from ChatGPT web works
- MCP tools answer correctly for read flows
- write confirmation flow works for owner/admin
- member role is blocked from write flows
- OAuth token revocation works

## 5. Submission Assets

- final icon exported and readable on light backgrounds
- fresh screenshots captured from production
- `submission/chatgpt-app-metadata.json` filled with real URLs
- `submission/app-directory-listing.md` reviewed and copied into submission fields
- `submission/reviewer-guide.md` updated with real reviewer credentials and test steps
- privacy policy and terms reflect the real company operating the app

## 6. Post-Submission

- monitoring is active for uptime and restarts
- server logs are rotated
- support inbox is monitored
- reviewer account password rotation plan exists
- incident response contact is defined
