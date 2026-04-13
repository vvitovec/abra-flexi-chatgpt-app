import { describe, expect, it } from "vitest";
import { ensureEvidencePermission, hasEvidencePermission } from "./access.js";

describe("evidence access", () => {
  it("allows all evidence when no permissions are configured", () => {
    const profile = {
      name: "prod",
      permissions: undefined
    };

    expect(hasEvidencePermission(profile, "read", "pracovni-pomer")).toBe(true);
    expect(hasEvidencePermission(profile, "dryRun", "pracovni-pomer")).toBe(true);
    expect(hasEvidencePermission(profile, "write", "pracovni-pomer")).toBe(true);
  });

  it("matches exact evidence names case-insensitively", () => {
    const profile = {
      name: "prod",
      permissions: {
        write: ["Pracovni-Pomer", "OSOBA"]
      }
    };

    expect(hasEvidencePermission(profile, "write", "pracovni-pomer")).toBe(true);
    expect(hasEvidencePermission(profile, "write", "osoba")).toBe(true);
    expect(hasEvidencePermission(profile, "write", "prace")).toBe(false);
  });

  it("supports wildcard permission entries", () => {
    const profile = {
      name: "prod",
      permissions: {
        dryRun: ["*"]
      }
    };

    expect(hasEvidencePermission(profile, "dryRun", "pracovni-pomer")).toBe(true);
    expect(hasEvidencePermission(profile, "dryRun", "osoba")).toBe(true);
  });

  it("throws a readable error for disallowed evidence", () => {
    const profile = {
      name: "prod",
      permissions: {
        write: ["pracovni-pomer"]
      }
    };

    expect(() => ensureEvidencePermission(profile, "write", "prace")).toThrow(
      "Evidence 'prace' is not allowed for write on profile 'prod'."
    );
  });
});
