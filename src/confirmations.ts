import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ConfirmationRecord } from "./types.js";

interface ConfirmationState {
  records: Record<string, ConfirmationRecord>;
}

export class ConfirmationStore {
  constructor(
    private readonly filePath: string,
    private readonly ttlSeconds: number
  ) {
    mkdirSync(dirname(resolve(filePath)), { recursive: true });
  }

  create(record: Omit<ConfirmationRecord, "confirmationId" | "createdAt" | "expiresAt">): ConfirmationRecord {
    const state = this.readState();
    const now = new Date();
    const confirmation: ConfirmationRecord = {
      ...record,
      confirmationId: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000).toISOString()
    };
    state.records[confirmation.confirmationId] = confirmation;
    this.writeState(state);
    return confirmation;
  }

  consume(confirmationId: string): ConfirmationRecord {
    const state = this.readState();
    const record = state.records[confirmationId];
    if (!record) {
      throw new Error(`Unknown confirmation_id '${confirmationId}'.`);
    }
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      delete state.records[confirmationId];
      this.writeState(state);
      throw new Error(`confirmation_id '${confirmationId}' has expired.`);
    }
    delete state.records[confirmationId];
    this.writeState(state);
    return record;
  }

  peek(confirmationId: string): ConfirmationRecord | null {
    const state = this.readState();
    const record = state.records[confirmationId];
    if (!record) {
      return null;
    }
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      delete state.records[confirmationId];
      this.writeState(state);
      return null;
    }
    return record;
  }

  private readState(): ConfirmationState {
    try {
      return JSON.parse(readFileSync(resolve(this.filePath), "utf8")) as ConfirmationState;
    } catch {
      return { records: {} };
    }
  }

  private writeState(state: ConfirmationState): void {
    writeFileSync(resolve(this.filePath), JSON.stringify(state, null, 2), "utf8");
  }
}
