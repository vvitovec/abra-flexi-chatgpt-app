# ChatGPT Web Test Plan

## Goal

Verify that the remote app works end-to-end in ChatGPT web before App Directory submission.

## Preconditions

- app is live on public HTTPS
- reviewer account exists
- demo organization exists
- demo Flexi cloud connection exists

## Connection Flow

1. Open ChatGPT web with Developer Mode enabled.
2. Add the remote app using the production base URL.
3. Confirm ChatGPT discovers the OAuth metadata.
4. Complete the login flow with the reviewer account.
5. Confirm the app finishes the OAuth authorization flow without manual patching.

## Read Flow Prompts

- `Check my Flexi connection for connection alias demo-main.`
- `List available Flexi evidence for connection alias demo-main.`
- `Find partner Example s.r.o. in Flexi using connection alias demo-main.`
- `Show overdue receivables for connection alias demo-main.`
- `Give me an accounting overview for connection alias demo-main.`

Expected result:

- tool calls succeed
- no internal credentials are requested in chat
- no `profile`, `username`, or `password` parameters appear in prompts or tool schema

## Write Flow Prompts

- `Prepare a draft issued invoice for connection alias demo-main for partner Example s.r.o.`
- `Validate the draft and tell me what is missing.`
- `Post the document only if validation passes.`

Expected result:

- owner/admin can complete the flow
- member role is blocked from write actions
- confirmation and idempotency flow is visible in tool responses

## Failure Flow

- disconnect or invalidate the Flexi credentials
- repeat `Check my Flexi connection`
- confirm the error is readable and does not leak secrets

## Reviewer Sign-Off

- screenshots captured from a successful connection flow
- screenshots captured from one successful read flow
- screenshots captured from one safe write confirmation flow
