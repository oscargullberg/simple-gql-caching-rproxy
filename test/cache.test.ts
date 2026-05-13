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
