import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import { createServer } from "../src/index";
import type { RemoteResponse } from "../src/index";

test("POST /proxy caches repeated successful GraphQL responses", async () => {
  const calls: Array<{ url: URL; body: string }> = [];
  const server = createServer(
    {
      adminSecret: "secret",
      cacheMaxEntries: 100,
      cacheTtlSeconds: 60,
      forwardUrl: new URL("https://example.com/graphql?api=public"),
      port: 0,
      requestTimeoutMs: 5_000,
      varyHeaders: [],
    },
    async ({ url, body }): Promise<RemoteResponse> => {
      calls.push({ url, body });
      return {
        bodyText: '{"data":{"ok":true}}',
        headers: { "content-type": "application/json" },
        statusCode: 200,
      };
    }
  );

  const body = '{"query":"{ countries { code } }"}';
  const first = await server.inject({
    method: "POST",
    url: "/proxy",
    headers: { "content-type": "application/json" },
    payload: body,
  });
  const second = await server.inject({
    method: "POST",
    url: "/proxy",
    headers: { "content-type": "application/json" },
    payload: body,
  });

  strictEqual(first.statusCode, 200);
  strictEqual(second.statusCode, 200);
  strictEqual(first.body, '{"data":{"ok":true}}');
  strictEqual(second.body, first.body);
  strictEqual(calls.length, 1);
  strictEqual(calls[0]?.url.toString(), "https://example.com/graphql?api=public");
  strictEqual(calls[0]?.body, body);

  await server.close();
});

test("admin purge accepts secrets in the query string", async () => {
  const server = createServer(
    {
      adminSecret: "secret",
      cacheMaxEntries: 100,
      cacheTtlSeconds: 60,
      forwardUrl: new URL("https://example.com/graphql"),
      port: 0,
      requestTimeoutMs: 5_000,
      varyHeaders: [],
    },
    async (): Promise<RemoteResponse> => ({
      bodyText: '{"data":{"ok":true}}',
      headers: { "content-type": "application/json" },
      statusCode: 200,
    })
  );

  const response = await server.inject({
    method: "DELETE",
    url: "/caches?sgcrp-admin-secret=secret",
  });

  strictEqual(response.statusCode, 200);

  await server.close();
});

test("POST /proxy varies cache entries by configured request headers", async () => {
  let calls = 0;
  const server = createServer(
    {
      adminSecret: "secret",
      cacheMaxEntries: 100,
      cacheTtlSeconds: 60,
      forwardUrl: new URL("https://example.com/graphql"),
      port: 0,
      requestTimeoutMs: 5_000,
      varyHeaders: ["authorization"],
    },
    async (): Promise<RemoteResponse> => {
      calls += 1;
      return {
        bodyText: `{"data":{"call":${calls}}}`,
        headers: { "content-type": "application/json" },
        statusCode: 200,
      };
    }
  );

  const body = '{"query":"{ viewer { id } }"}';
  const first = await server.inject({
    method: "POST",
    url: "/proxy",
    headers: { authorization: "Bearer first" },
    payload: body,
  });
  const second = await server.inject({
    method: "POST",
    url: "/proxy",
    headers: { authorization: "Bearer second" },
    payload: body,
  });

  strictEqual(first.body, '{"data":{"call":1}}');
  strictEqual(second.body, '{"data":{"call":2}}');
  strictEqual(calls, 2);

  await server.close();
});

test("admin purge requires the configured secret and clears the cache", async () => {
  let calls = 0;
  const server = createServer(
    {
      adminSecret: "secret",
      cacheMaxEntries: 100,
      cacheTtlSeconds: 60,
      forwardUrl: new URL("https://example.com/graphql"),
      port: 0,
      requestTimeoutMs: 5_000,
      varyHeaders: [],
    },
    async (): Promise<RemoteResponse> => {
      calls += 1;
      return {
        bodyText: `{"data":{"call":${calls}}}`,
        headers: { "content-type": "application/json" },
        statusCode: 200,
      };
    }
  );

  const body = '{"query":"{ viewer { id } }"}';
  await server.inject({ method: "POST", url: "/proxy", payload: body });
  const unauthorized = await server.inject({ method: "DELETE", url: "/caches" });
  const authorized = await server.inject({
    method: "DELETE",
    url: "/caches",
    headers: { "sgcrp-admin-secret": "secret" },
  });
  const afterPurge = await server.inject({
    method: "POST",
    url: "/proxy",
    payload: body,
  });

  strictEqual(unauthorized.statusCode, 401);
  strictEqual(authorized.statusCode, 200);
  deepStrictEqual(JSON.parse(afterPurge.body), { data: { call: 2 } });

  await server.close();
});
