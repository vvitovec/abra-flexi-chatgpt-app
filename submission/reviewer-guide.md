# Reviewer Guide

## Reviewer Login

- Login URL: `https://your-domain.example/login`
- Reviewer email: `reviewer@your-domain.example`
- Reviewer password: `ReplaceWithStrongReviewPassword123!`

Update these values before submission.

## What The Reviewer Should Test

1. Log in with the reviewer account.
2. Open the demo organization workspace.
3. Confirm the demo Flexi connection already exists.
4. Connect the app in ChatGPT web through the production remote app URL.
5. Complete the OAuth authorization flow.
6. Run at least one read prompt and one safe write prompt.

## Suggested Reviewer Prompts

- `Check my Flexi connection for connection alias demo-main.`
- `List available Flexi evidence for connection alias demo-main.`
- `Find partner Example s.r.o. using connection alias demo-main.`
- `Show overdue items for connection alias demo-main.`
- `Prepare a safe demo document draft for connection alias demo-main.`

## Expected Behavior

- reviewer is never asked to enter Flexi credentials in chat
- tool calls use the preconfigured demo connection
- write actions are limited to demo data and return clear confirmations
- support, privacy, and terms pages are publicly reachable

## Troubleshooting

- If login fails, verify the reviewer account from the production `.env`.
- If Flexi tools fail, verify the demo cloud connection in the onboarding UI.
- If ChatGPT cannot connect, verify `/.well-known/oauth-authorization-server` and `/mcp`.
