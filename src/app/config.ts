import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const configSchema = z.object({
  appName: z.string().min(1),
  appBaseUrl: z.string().url(),
  appPort: z.number().int().positive(),
  appDataDir: z.string().min(1),
  appCookieName: z.string().min(1),
  appCookieSecure: z.boolean(),
  appCookieTtlSeconds: z.number().int().positive(),
  oauthCodeTtlSeconds: z.number().int().positive(),
  oauthAccessTokenTtlSeconds: z.number().int().positive(),
  oauthRefreshTokenTtlSeconds: z.number().int().positive(),
  writeConfirmationTtlSeconds: z.number().int().positive(),
  encryptionKeys: z.array(
    z.object({
      version: z.string().min(1),
      key: z.string().min(32)
    })
  ),
  reviewerEmail: z.string().email(),
  reviewerPassword: z.string().min(12),
  reviewerName: z.string().min(1),
  supportEmail: z.string().email(),
  appDomain: z.string().url(),
  widgetResourceDomain: z.string().url(),
  cloudflareTunnelName: z.string().min(1),
  cloudflareHostname: z.string().min(1)
});

export type AppConfig = z.infer<typeof configSchema>;

function parseEncryptionKeys(raw: string): Array<{ version: string; key: string }> {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [version, key] = item.split(":");
      if (!version || !key) {
        throw new Error("APP_ENCRYPTION_KEYS must use version:key format.");
      }
      return { version, key };
    });
}

export function loadAppConfig(): AppConfig {
  const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:8787";
  const appDataDir = resolve(process.env.APP_DATA_DIR ?? ".chatgpt-app-data");
  mkdirSync(appDataDir, { recursive: true });

  return configSchema.parse({
    appName: process.env.APP_NAME ?? "ABRA Flexi ChatGPT App",
    appBaseUrl,
    appPort: Number(process.env.PORT ?? process.env.APP_PORT ?? "8787"),
    appDataDir,
    appCookieName: process.env.APP_COOKIE_NAME ?? "flexi_chatgpt_session",
    appCookieSecure: (process.env.APP_COOKIE_SECURE ?? (appBaseUrl.startsWith("https://") ? "true" : "false")) === "true",
    appCookieTtlSeconds: Number(process.env.APP_COOKIE_TTL_SECONDS ?? "2592000"),
    oauthCodeTtlSeconds: Number(process.env.OAUTH_CODE_TTL_SECONDS ?? "600"),
    oauthAccessTokenTtlSeconds: Number(process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS ?? "3600"),
    oauthRefreshTokenTtlSeconds: Number(process.env.OAUTH_REFRESH_TOKEN_TTL_SECONDS ?? "2592000"),
    writeConfirmationTtlSeconds: Number(process.env.WRITE_CONFIRMATION_TTL_SECONDS ?? "600"),
    encryptionKeys: parseEncryptionKeys(
      process.env.APP_ENCRYPTION_KEYS ?? "v1:replace-with-a-32-byte-minimum-secret-key"
    ),
    reviewerEmail: process.env.REVIEWER_EMAIL ?? "reviewer@example.com",
    reviewerPassword: process.env.REVIEWER_PASSWORD ?? "ChangeMeReview123!",
    reviewerName: process.env.REVIEWER_NAME ?? "OpenAI Reviewer Demo",
    supportEmail: process.env.SUPPORT_EMAIL ?? "support@example.com",
    appDomain: process.env.APP_DOMAIN ?? appBaseUrl,
    widgetResourceDomain: process.env.WIDGET_RESOURCE_DOMAIN ?? appBaseUrl,
    cloudflareTunnelName: process.env.CLOUDFLARE_TUNNEL_NAME ?? "flexi-chatgpt-app",
    cloudflareHostname: process.env.CLOUDFLARE_HOSTNAME ?? "flexi.example.com"
  });
}
