# ABRA Flexi Auth And API

## Co používá tato app v1

- pouze cloud ABRA Flexi / FlexiBee instance dostupné po HTTPS
- dedikovaný REST API uživatel na každé zákaznické připojení
- server-side volání do Flexi přes HTTP Basic auth
- zápisy přes běžné import endpointy, u non-GET requestů s `auth=http`

## Onboarding požadavky pro zákazníka

Zákazník musí dodat:

- veřejnou Flexi base URL, typicky `https://tenant.flexibee.eu`
- firemní slug pro `/c/<firma>/...`
- dedikovaného API uživatele a heslo

## Jak app připojení ověřuje

Při uložení připojení proběhne:

1. `GET /c.json` nebo ekvivalent serverového seznamu firem
2. `GET /c/<firma>/evidence-list`
3. uložení šifrovaných credentials až po úspěšném testu

## Co v1 záměrně nepodporuje

- lokální/on-prem Flexi instance bez veřejné HTTPS adresy
- univerzální passthrough proxy nad všemi raw Flexi endpointy
- neomezené destructive batch operace
- zadávání credentials v promptu nebo v MCP tool inputs

## Doporučený provozní model pro zákazníka

- založit dedikovaného Flexi API uživatele jen pro tuto app
- omezit jeho role na účetní evidence potřebné pro workflow
- nepoužívat osobní admin účet účetní
- pravidelně rotovat heslo a po rotaci připojení přepsat v onboarding UI
