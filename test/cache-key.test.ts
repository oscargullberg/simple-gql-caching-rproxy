import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import { buildCacheKey, parseVaryHeaders } from "../src/cache";

test("parseVaryHeaders normalizes names and drops empty entries", () => {
  deepStrictEqual(parseVaryHeaders(" Authorization, accept-language ,, "), [
    "authorization",
    "accept-language",
  ]);
});

test("buildCacheKey treats configured vary headers case-insensitively", () => {
  const body = '{"query":"{ viewer { id } }"}';
  const upperCaseConfigKey = buildCacheKey(
    { "accept-language": "en-US" },
    body,
    ["Accept-Language"]
  );
  const lowerCaseConfigKey = buildCacheKey(
    { "accept-language": "en-US" },
    body,
    ["accept-language"]
  );

  strictEqual(upperCaseConfigKey, lowerCaseConfigKey);
});

test("buildCacheKey varies by configured header values and request body", () => {
  const varyHeaders = ["authorization"];
  const base = buildCacheKey(
    { authorization: "Bearer first" },
    '{"query":"{ viewer { id } }"}',
    varyHeaders
  );

  notStrictEqual(
    base,
    buildCacheKey(
      { authorization: "Bearer second" },
      '{"query":"{ viewer { id } }"}',
      varyHeaders
    )
  );
  notStrictEqual(
    base,
    buildCacheKey(
      { authorization: "Bearer first" },
      '{"query":"{ organization { id } }"}',
      varyHeaders
    )
  );
});

test("buildCacheKey uses one SHA-256 digest for the canonical cache input", () => {
  const key = buildCacheKey(
    { authorization: "Bearer first" },
    '{"query":"{ viewer { id } }"}',
    ["authorization"]
  );

  strictEqual(
    key,
    "c05b748709da815b2a51484935d01666d64ca7277c45a93e136ba8ecd7da57b2",
  );
});
