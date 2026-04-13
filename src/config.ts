import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import type { FlexiEvidencePermissions, FlexiHarnessConfig, FlexiProfileConfig, ResolvedProfile } from "./types.js";

loadEnv();

const permissionsSchema: z.ZodType<FlexiEvidencePermissions> = z.object({
  read: z.array(z.string().min(1)).optional(),
  dryRun: z.array(z.string().min(1)).optional(),
  write: z.array(z.string().min(1)).optional()
});

const profileSchema: z.ZodType<FlexiProfileConfig> = z.object({
  baseUrl: z.string().url(),
  company: z.string().min(1),
  mode: z.enum(["test", "prod"]),
  writes: z.enum(["disabled", "confirm"]),
  defaultFormat: z.enum(["json", "xml"]),
  usernameEnv: z.string().min(1),
  passwordEnv: z.string().min(1),
  allowWriteOverrideWithoutValidation: z.boolean().optional(),
  permissions: permissionsSchema.optional()
});

const harnessSchema: z.ZodType<FlexiHarnessConfig> = z.object({
  defaultProfile: z.string().min(1),
  logDirectory: z.string().min(1),
  confirmationTtlSeconds: z.number().int().positive(),
  profiles: z.record(profileSchema)
});

export function loadHarnessConfig(configPath = "flexi.config.json"): FlexiHarnessConfig {
  const raw = readFileSync(resolve(configPath), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return harnessSchema.parse(parsed);
}

export function resolveProfile(
  config: FlexiHarnessConfig,
  profileName?: string
): ResolvedProfile {
  const selectedName = profileName ?? config.defaultProfile;
  const selected = config.profiles[selectedName];
  if (!selected) {
    throw new Error(`Unknown profile '${selectedName}'.`);
  }

  const username = process.env[selected.usernameEnv];
  const password = process.env[selected.passwordEnv];
  if (!username) {
    throw new Error(`Missing environment variable ${selected.usernameEnv} for profile '${selectedName}'.`);
  }
  if (!password) {
    throw new Error(`Missing environment variable ${selected.passwordEnv} for profile '${selectedName}'.`);
  }

  return {
    ...selected,
    name: selectedName,
    username,
    password
  };
}
