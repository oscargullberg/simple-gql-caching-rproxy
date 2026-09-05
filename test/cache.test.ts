import { strictEqual } from "node:assert";
import { test } from "node:test";
import { TtlCache } from "../src/cache";

test("TtlCache evicts the oldest entry when maxEntries is reached", () => {
  let now = 1_000;
  const cache = new TtlCache<string>({
    maxEntries: 2,
    ttlMs: 10_000,
    now: () => now,
  });

  cache.set("a", "first");
  cache.set("b", "second");
  cache.set("c", "third");

  strictEqual(cache.get("a"), undefined);
  strictEqual(cache.get("b"), "second");
  strictEqual(cache.get("c"), "third");
  strictEqual(cache.size, 2);
});

test("TtlCache expires entries on read", () => {
  let now = 1_000;
  const cache = new TtlCache<string>({
    maxEntries: 10,
    ttlMs: 100,
    now: () => now,
  });

  cache.set("response", "cached");
  now = 1_101;

  strictEqual(cache.get("response"), undefined);
  strictEqual(cache.size, 0);
});

test("TtlCache treats get as recent usage", () => {
  let now = 1_000;
  const cache = new TtlCache<string>({
    maxEntries: 2,
    ttlMs: 10_000,
    now: () => now,
  });

  cache.set("a", "first");
  cache.set("b", "second");
  strictEqual(cache.get("a"), "first");
  now += 1;
  cache.set("c", "third");

  strictEqual(cache.get("a"), "first");
  strictEqual(cache.get("b"), undefined);
  strictEqual(cache.get("c"), "third");
});

test("TtlCache enforces a total byte budget", () => {
  const cache = new TtlCache<Buffer>({
    maxEntries: 10,
    maxSizeBytes: 5,
    sizeOf: (value) => value.byteLength,
    ttlMs: 10_000,
  });

  cache.set("a", Buffer.from("123"));
  cache.set("b", Buffer.from("456"));

  strictEqual(cache.get("a"), undefined);
  strictEqual(cache.get("b")?.toString(), "456");
  strictEqual(cache.sizeBytes, 3);
  strictEqual(cache.set("oversized", Buffer.from("123456")), false);
  strictEqual(cache.sizeBytes, 3);
});

test("TtlCache accepts a shorter TTL for one entry", () => {
  let now = 0;
  const cache = new TtlCache<string>({
    maxEntries: 10,
    now: () => now,
    ttlMs: 10_000,
  });

  cache.set("short", "value", 500);
  now = 500;

  strictEqual(cache.get("short"), undefined);
});
