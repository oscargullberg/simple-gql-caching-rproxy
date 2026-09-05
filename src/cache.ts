import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

type HeaderValue = IncomingHttpHeaders[string];
type Clock = () => number;

type CacheEntry<T> = {
  expiresAt: number;
  sizeBytes: number;
  value: T;
};

type TtlCacheOptions<T> = {
  maxEntries: number;
  maxSizeBytes?: number;
  now?: Clock;
  sizeOf?: (value: T) => number;
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

  return createHash("sha256")
    .update(JSON.stringify({ headers: normalizedHeaders, body }))
    .digest("hex");
};

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly maxSizeBytes: number;
  private readonly now: Clock;
  private readonly sizeOf: (value: T) => number;
  private readonly ttlMs: number;
  private totalSizeBytes = 0;

  constructor(options: TtlCacheOptions<T>) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries));
    this.maxSizeBytes = Math.max(
      1,
      Math.floor(options.maxSizeBytes ?? Number.MAX_SAFE_INTEGER),
    );
    this.now = options.now ?? Date.now;
    this.sizeOf = options.sizeOf ?? (() => 1);
    this.ttlMs = Math.max(1, Math.floor(options.ttlMs));
  }

  get size(): number {
    return this.entries.size;
  }

  get sizeBytes(): number {
    return this.totalSizeBytes;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= this.now()) {
      this.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.ttlMs): boolean {
    const sizeBytes = Math.max(0, Math.floor(this.sizeOf(value)));
    const normalizedTtlMs = Math.floor(ttlMs);
    if (
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes > this.maxSizeBytes ||
      !Number.isSafeInteger(normalizedTtlMs) ||
      normalizedTtlMs <= 0
    ) {
      return false;
    }

    this.delete(key);
    this.entries.set(key, {
      expiresAt: this.now() + normalizedTtlMs,
      sizeBytes,
      value,
    });
    this.totalSizeBytes += sizeBytes;

    while (
      this.entries.size > this.maxEntries ||
      this.totalSizeBytes > this.maxSizeBytes
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return false;
      }

      this.delete(oldestKey);
    }

    return true;
  }

  clear(): void {
    this.entries.clear();
    this.totalSizeBytes = 0;
  }

  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    this.totalSizeBytes = Math.max(0, this.totalSizeBytes - entry.sizeBytes);
    this.entries.delete(key);
  }
}
