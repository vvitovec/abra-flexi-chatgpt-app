import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfirmationStore } from "./confirmations.js";

describe("ConfirmationStore", () => {
  it("creates and consumes confirmation records", () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-confirm-"));
    const store = new ConfirmationStore(join(dir, "confirmations.json"), 300);
    const created = store.create({
      profile: "test",
      company: "demo",
      evidence: "adresar",
      format: "json",
      payloadFormat: "json",
      payloadHash: "abc",
      method: "POST",
      idempotencyKey: "idemp-1",
      validationRequestId: "req-1",
      overrideValidation: false
    });

    const consumed = store.consume(created.confirmationId);
    expect(consumed.confirmationId).toBe(created.confirmationId);
    expect(store.peek(created.confirmationId)).toBeNull();
  });

  it("expires confirmation records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flexi-confirm-"));
    const store = new ConfirmationStore(join(dir, "confirmations.json"), 0);
    const created = store.create({
      profile: "test",
      company: "demo",
      evidence: "adresar",
      format: "json",
      payloadFormat: "json",
      payloadHash: "abc",
      method: "POST",
      idempotencyKey: undefined,
      validationRequestId: undefined,
      overrideValidation: false
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(() => store.consume(created.confirmationId)).toThrow(/expired/);
  });
});
