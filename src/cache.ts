import xxhash from "@node-rs/xxhash";
import type { IncomingHttpHeaders } from "node:http";

type HeaderValue = IncomingHttpHeaders[string];
type Clock = () => number;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type TtlCacheOptions = {
  maxEntries: number;
  now?: Clock;
  ttlMs: number;
};

export const parseVaryHeaders = (value: string): string[] =>
  value
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter((header) => header.length > 0);

const normalizeHeaderValue = (value: HeaderValue): string[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return [value];
  }

  return [];
};

export const buildCacheKey = (
  headers: IncomingHttpHeaders,
  body: string,
  varyHeaders: string[],
): string => {
  const normalizedHeaders = varyHeaders.map((header) => [
    header.toLowerCase(),
    normalizeHeaderValue(headers[header.toLowerCase()]),
  ]);

  return xxhash.xxh3
    .xxh128(JSON.stringify({ headers: normalizedHeaders, body }), 0n)
    .toString();
};

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly now: Clock;
  private readonly ttlMs: number;

  constructor(options: TtlCacheOptions) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries));
    this.now = options.now ?? Date.now;
    this.ttlMs = Math.max(1, Math.floor(options.ttlMs));
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, {
      expiresAt: this.now() + this.ttlMs,
      value,
    });

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }

      this.entries.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
