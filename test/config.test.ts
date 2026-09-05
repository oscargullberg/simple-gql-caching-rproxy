import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import { loadConfig } from "../src/config";

test("loadConfig parses defaults and normalized vary headers", () => {
  const config = loadConfig({
    SGCRP_ADMIN_SECRET: "secret",
    SGCRP_FORWARD_URL: "https://example.com/graphql",
    SGCRP_VARY_HEADERS: " Authorization, Accept-Language ",
  });

  strictEqual(config.adminSecret, "secret");
  strictEqual(config.cacheMaxBytes, 100 * 1024 * 1024);
  strictEqual(config.cacheMaxEntries, 5_000);
  strictEqual(config.cacheTtlSeconds, 120);
  strictEqual(config.enableLogging, true);
  strictEqual(config.forwardUrl.toString(), "https://example.com/graphql");
  strictEqual(config.port, 8080);
  strictEqual(config.maxResponseBytes, 5 * 1024 * 1024);
  strictEqual(config.requestBodyMaxBytes, 1024 * 1024);
  strictEqual(config.requestTimeoutMs, 30_000);
  deepStrictEqual(config.varyHeaders, ["authorization", "accept-language"]);
});

test("loadConfig rejects missing required environment", () => {
  throws(
    () => loadConfig({ SGCRP_ADMIN_SECRET: "secret" }),
    /SGCRP_FORWARD_URL is required/
  );
  throws(
    () => loadConfig({ SGCRP_FORWARD_URL: "https://example.com/graphql" }),
    /SGCRP_ADMIN_SECRET is required/
  );
});

test("loadConfig rejects invalid positive integers", () => {
  throws(
    () =>
      loadConfig({
        SGCRP_ADMIN_SECRET: "secret",
        SGCRP_CACHE_MAX_ENTRIES: "0",
        SGCRP_FORWARD_URL: "https://example.com/graphql",
      }),
    /SGCRP_CACHE_MAX_ENTRIES must be a positive integer/
  );
});

test("loadConfig accepts HTTP upstream URLs", () => {
  throws(
    () =>
      loadConfig({
        SGCRP_ADMIN_SECRET: "secret",
        SGCRP_FORWARD_URL: "file:///tmp/graphql",
      }),
    /must use http or https/,
  );
  const config = loadConfig({
    SGCRP_ADMIN_SECRET: "secret",
    SGCRP_FORWARD_URL: "https://user:password@example.com/graphql",
  });
  strictEqual(
    config.forwardUrl.toString(),
    "https://user:password@example.com/graphql",
  );
});
