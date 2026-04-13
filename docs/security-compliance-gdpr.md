# Security, Compliance And GDPR

## Data categories

Aplikace ukládá:

- uživatelské účty a e-mail
- členství v organizacích a role
- šifrované Flexi credentials
- OAuth klienty, auth codes a access/refresh tokeny
- audit metadata o provedených akcích

## Data minimization

- Flexi credentials se nezadávají do MCP toolů ani promptů
- tool responses neobsahují raw debug metadata ani interní request cesty
- audit logy drží stručné metadata a chybové texty, ne plné secrets

## Ochranné mechanismy

- sessions přes HttpOnly cookie
- Flexi credentials šifrované AES-256-GCM
- role-based write gating `owner/admin`
- krátkodobé confirmation tokeny pro write workflow
- oddělení organizací v DB a connection lookupu

## GDPR provozní minimum

- mějte veřejnou privacy policy a terms
- mějte záznam o tom, kdo je data controller a support kontakt
- definujte retention pro audit a backupy
- zajistěte možnost rotace a smazání Flexi připojení
- provozujte pouze na infrastruktuře, kterou skutečně spravujete a zálohujete

## Home server poznámka

Domácí Ubuntu server je provozně možný, ale pro účetnictví nese vyšší riziko:

- výpadky elektřiny a internetu
- slabší fyzická bezpečnost
- horší disaster recovery
- vyšší riziko problémů při reviewer testech

Proto je v dokumentaci připraven i fallback na EU VPS bez změny architektury.
