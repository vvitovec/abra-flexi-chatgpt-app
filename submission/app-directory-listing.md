# App Directory Listing Copy

## App Name

ABRA Flexi ChatGPT App

## Category

Business

## Short Description

ABRA Flexi workflow app for ChatGPT with secure team workspaces, accounting triage, and official PDF exports.

## Full Description

ABRA Flexi ChatGPT App lets accounting firms and finance teams connect their own ABRA Flexi cloud environments to ChatGPT without sharing credentials across customers.

Each company works in its own workspace. Users sign in to the app, connect their own Flexi account through the onboarding UI, and then use ChatGPT for accountant-first workflows such as morning triage, VAT and period-close review, overdue items, payment mismatch checks, draft document preparation, and official PDF exports from ABRA Flexi.

The app is designed for multi-tenant use. Flexi credentials are entered only in the app UI, stored encrypted at rest, and never passed as tool inputs in ChatGPT. Write actions are role-gated and audited.

Version 1 supports cloud ABRA Flexi deployments.

## Key Capabilities

- team workspaces for accounting firms and finance departments
- multiple Flexi connections per organization
- secure encrypted credential storage
- morning accounting triage, period-close review, and payment mismatch workflows
- official ABRA Flexi PDF export for `soupis aktiv a pasiv`
- controlled write flows with confirmation and audit logging

## Intended Users

- accounting firms
- external accountants
- finance teams
- internal back-office teams working with ABRA Flexi cloud

## Security Notes

- credentials are entered in the web onboarding UI, not in chat
- workspace isolation is enforced server-side
- access tokens are scoped to the authenticated user and organization membership
- write actions are restricted by role

## Support Contact

Use the support email and support URL from `submission/chatgpt-app-metadata.json`.
