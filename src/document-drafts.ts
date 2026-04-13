import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface DocumentDraftRecord {
  kind: string;
  evidence: string;
  id: string;
  payload: string;
  payloadFormat: "json" | "xml";
  updatedAt: string;
}

interface DocumentDraftState {
  records: Record<string, DocumentDraftRecord>;
}

function buildKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export class DocumentDraftStore {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(resolve(filePath)), { recursive: true });
  }

  save(record: DocumentDraftRecord): DocumentDraftRecord {
    const state = this.readState();
    state.records[buildKey(record.kind, record.id)] = record;
    this.writeState(state);
    return record;
  }

  get(kind: string, id: string): DocumentDraftRecord | null {
    const state = this.readState();
    return state.records[buildKey(kind, id)] ?? null;
  }

  remove(kind: string, id: string): void {
    const state = this.readState();
    delete state.records[buildKey(kind, id)];
    this.writeState(state);
  }

  private readState(): DocumentDraftState {
    try {
      return JSON.parse(readFileSync(resolve(this.filePath), "utf8")) as DocumentDraftState;
    } catch {
      return { records: {} };
    }
  }

  private writeState(state: DocumentDraftState): void {
    writeFileSync(resolve(this.filePath), JSON.stringify(state, null, 2), "utf8");
  }
}
