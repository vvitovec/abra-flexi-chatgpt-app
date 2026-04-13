# Production Upgrade Plan

Tento dokument popisuje rozšíření současného harnessu z bezpečné V1 diagnostické vrstvy na plnou produkční integrační sadu.

## Cíle další fáze

- plné CRUD workflow pro klíčové evidence
- akce nad doklady a službami Flexi
- dávkové a transakční zpracování
- přílohy, exporty a soubory
- changes API a webhooky
- silnější observability, retry a idempotence

## Priorita 1

- Zavést persistentní request store nad SQLite místo JSON souborů.
- Přidat idempotency policy nad skutečné zápisy a batch importy.
- Rozšířit `flexi_prepare_write` o diff proti stávajícímu stavu.
- Přidat explicitní rozlišení `create`, `update`, `action`, `delete`.
- Zavést allowlist evidencí a akcí pro produkční profily.
- Přidat per-profile write limits a audit retention politiku.

## Priorita 2

- Přidat nástroje pro přílohy a binární uploady.
- Přidat dávkové importy a transakční zpracování více záznamů.
- Podpořit akce typu generování, přepočty, vazby a workflow operace.
- Přidat helpery pro `changes API` a diff synchronizace.
- Přidat nástroje pro webhook troubleshooting a replay.

## Priorita 3

- Zavést observability vrstvu:
  - strukturované logy
  - metriky úspěšnosti
  - latence
  - error categories
- Přidat retry pravidla jen pro bezpečné operace.
- Přidat circuit breaker pro produkční profil při sérii chyb.
- Přidat explicitní režim maintenance/read-only fallback.

## Bezpečnostní upgrade

- Oddělit credentials per environment a per workflow.
- Přidat možnost čtení secrets z keychainu nebo secret manageru.
- Přidat podpis audit záznamů a kontrolu integrity.
- Redigovat i payload pole podle konfigurovatelného seznamu citlivých atributů.
- Přidat explicitní schvalovací workflow pro produkční zápisy s vyšším dopadem.

## Rozšíření MCP nástrojů

- `flexi_batch_validate`
- `flexi_batch_execute`
- `flexi_list_changes`
- `flexi_download_attachment`
- `flexi_upload_attachment`
- `flexi_run_action`
- `flexi_diff_record`
- `flexi_replay_request`
- `flexi_list_webhooks`
- `flexi_test_webhook_delivery`

## Testovací strategie pro production-ready verzi

- contract testy proti skutečné sandbox instanci Flexi
- fixture sada pro běžné doklady a číselníky
- replay testy pro reálné chybové payloady
- soak testy pro větší batch importy
- bezpečnostní testy redakce logů a potvrzovacích toků
- recovery testy po timeoutu a částečné chybě
