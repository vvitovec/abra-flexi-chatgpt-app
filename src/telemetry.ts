function countFields(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countFields(item), 0);
  }
  if (typeof value !== "object") {
    return 1;
  }

  return Object.entries(value as Record<string, unknown>).reduce(
    (total, [, child]) => total + 1 + countFields(child),
    0
  );
}

function countPrimaryRecords(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["records", "evidence", "companies", "fields", "relations", "profiles"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
  }

  return null;
}

export class ToolTelemetry {
  private readonly stats = new Map<
    string,
    {
      calls: number;
      totalBytes: number;
      totalDurationMs: number;
    }
  >();

  record(toolName: string, structuredContent: unknown, durationMs: number): void {
    const responseBytes = Buffer.byteLength(JSON.stringify(structuredContent ?? null), "utf8");
    const responseFields = countFields(structuredContent);
    const responseRecords = countPrimaryRecords(structuredContent);
    const current = this.stats.get(toolName) ?? {
      calls: 0,
      totalBytes: 0,
      totalDurationMs: 0
    };

    current.calls += 1;
    current.totalBytes += responseBytes;
    current.totalDurationMs += durationMs;
    this.stats.set(toolName, current);

    const averageBytes = Math.round(current.totalBytes / current.calls);
    const averageDuration = Number((current.totalDurationMs / current.calls).toFixed(1));
    const parts = [
      `[telemetry] tool=${toolName}`,
      `duration_ms=${durationMs.toFixed(1)}`,
      `response_bytes=${responseBytes}`,
      `response_fields=${responseFields}`,
      `avg_bytes=${averageBytes}`,
      `avg_duration_ms=${averageDuration}`
    ];

    if (responseRecords !== null) {
      parts.push(`record_count=${responseRecords}`);
    }

    console.error(parts.join(" "));
  }
}
