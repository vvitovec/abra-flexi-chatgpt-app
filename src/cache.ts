interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): T {
    this.entries.set(key, {
      expiresAt: Date.now() + this.ttlMs,
      value
    });
    return value;
  }

  async getOrSet(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }
    const value = await loader();
    return this.set(key, value);
  }
}
