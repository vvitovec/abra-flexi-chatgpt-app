import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AuditEntry } from "./types.js";

export class AuditStore {
  constructor(private readonly logDirectory: string) {
    mkdirSync(resolve(logDirectory), { recursive: true });
  }

  save(entry: AuditEntry): string {
    const filePath = this.getEntryPath(entry.request_id);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf8");
    return filePath;
  }

  load(requestId: string): AuditEntry {
    return JSON.parse(readFileSync(this.getEntryPath(requestId), "utf8")) as AuditEntry;
  }

  update(requestId: string, updater: (entry: AuditEntry) => AuditEntry): string {
    const current = this.load(requestId);
    const next = updater(current);
    return this.save(next);
  }

  findLatestError(): AuditEntry | null {
    const directory = resolve(this.logDirectory);
    const files = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(directory, name))
      .sort((a, b) => b.localeCompare(a));

    for (const file of files) {
      const entry = JSON.parse(readFileSync(file, "utf8")) as AuditEntry;
      if (entry.error || (entry.parsed_errors && entry.parsed_errors.length > 0) || (entry.response_status && entry.response_status >= 400)) {
        return entry;
      }
    }

    return null;
  }

  private getEntryPath(requestId: string): string {
    return resolve(this.logDirectory, `${requestId}.json`);
  }
}
