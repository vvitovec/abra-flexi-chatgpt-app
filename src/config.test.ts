import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHarnessConfig, resolveProfile } from "./config.js";

describe("config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads config and resolves secrets from env", () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-config-"));
    const configPath = join(dir, "flexi.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        defaultProfile: "test",
        logDirectory: ".flexi-harness/logs",
        confirmationTtlSeconds: 300,
        profiles: {
          test: {
            baseUrl: "https://demo.flexibee.eu",
            company: "demo",
            mode: "test",
            writes: "confirm",
            defaultFormat: "json",
            usernameEnv: "FLEXI_TEST_USERNAME",
            passwordEnv: "FLEXI_TEST_PASSWORD",
            permissions: {
              read: ["osoba", "pracovni-pomer"],
              dryRun: ["pracovni-pomer"],
              write: ["pracovni-pomer"]
            }
          }
        }
      }),
      "utf8"
    );

    process.env.FLEXI_TEST_USERNAME = "user";
    process.env.FLEXI_TEST_PASSWORD = "pass";

    const config = loadHarnessConfig(configPath);
    const profile = resolveProfile(config, "test");

    expect(profile.username).toBe("user");
    expect(profile.password).toBe("pass");
    expect(profile.mode).toBe("test");
    expect(profile.permissions?.write).toEqual(["pracovni-pomer"]);
  });

  it("throws when a required secret is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-config-"));
    const configPath = join(dir, "flexi.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        defaultProfile: "test",
        logDirectory: ".flexi-harness/logs",
        confirmationTtlSeconds: 300,
        profiles: {
          test: {
            baseUrl: "https://demo.flexibee.eu",
            company: "demo",
            mode: "test",
            writes: "confirm",
            defaultFormat: "json",
            usernameEnv: "FLEXI_TEST_USERNAME",
            passwordEnv: "FLEXI_TEST_PASSWORD"
          }
        }
      }),
      "utf8"
    );

    delete process.env.FLEXI_TEST_USERNAME;
    delete process.env.FLEXI_TEST_PASSWORD;

    const config = loadHarnessConfig(configPath);

    expect(() => resolveProfile(config, "test")).toThrow(/Missing environment variable/);
  });

  it("resolves production credentials from FLEXI_PROD variables", () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-config-"));
    const configPath = join(dir, "flexi.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        defaultProfile: "prod",
        logDirectory: ".flexi-harness/logs",
        confirmationTtlSeconds: 300,
        profiles: {
          prod: {
            baseUrl: "https://example.flexibee.eu",
            company: "example_company_s_r_o_",
            mode: "prod",
            writes: "confirm",
            defaultFormat: "json",
            usernameEnv: "FLEXI_PROD_USERNAME",
            passwordEnv: "FLEXI_PROD_PASSWORD"
          }
        }
      }),
      "utf8"
    );

    process.env.FLEXI_PROD_USERNAME = "prod-user";
    process.env.FLEXI_PROD_PASSWORD = "prod-pass";

    const config = loadHarnessConfig(configPath);
    const profile = resolveProfile(config, "prod");

    expect(profile.baseUrl).toBe("https://example.flexibee.eu");
    expect(profile.username).toBe("prod-user");
    expect(profile.password).toBe("prod-pass");
  });
});
