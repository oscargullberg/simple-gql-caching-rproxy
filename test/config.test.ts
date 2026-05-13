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
  strictEqual(config.cacheMaxEntries, 5_000);
  strictEqual(config.cacheTtlSeconds, 120);
  strictEqual(config.forwardUrl.toString(), "https://example.com/graphql");
  strictEqual(config.port, 8080);
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
