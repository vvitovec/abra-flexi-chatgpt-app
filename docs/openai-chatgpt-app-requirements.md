# OpenAI ChatGPT App Requirements

## Tato implementace cílí na

- remote MCP server dostupný po HTTPS
- OAuth 2.1 authorization flow pro připojení v ChatGPT webu
- webové onboarding a legal/support stránky
- review-friendly deployment s demo účtem bez 2FA blokace

## Co musí být veřejně dostupné

- `POST /mcp`
- OAuth metadata a auth/token/revoke endpoints na stejné veřejné doméně
- `privacy policy`, `terms`, `support`, `review demo`

## Co musí být připravené pro App Directory

- stabilní doména s TLS
- reviewer instrukce a demo účet
- popis aplikace, ikona, screenshoty a support kontakt
- jasné vysvětlení, jak aplikace pracuje s daty a credentials

## Co je v kódu připravené

- vlastní OAuth provider
- protected MCP endpoint s bearer token validací
- legal a support stránky
- metadata template v `submission/chatgpt-app-metadata.json`

## Co ještě musíte dodat ručně před submission

- finální produkční doménu
- finální support email
- finální screenshoty z běžící produkční instance
- reviewer demo Flexi connection nebo sandbox data
