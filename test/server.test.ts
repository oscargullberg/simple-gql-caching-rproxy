import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { request as httpRequest } from "node:http";
import { Readable, PassThrough } from "node:stream";
import { test } from "node:test";
import { createServer } from "../src/index";
import type { RemoteResponse } from "../src/index";

test("GET /healthz returns ok", async () => {
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
      body: Readable.from(['{"data":{"ok":true}}']),
      headers: { "content-type": "application/json" },
      statusCode: 200,
    })
  );

  const response = await server.inject({ method: "GET", url: "/healthz" });

  strictEqual(response.statusCode, 200);
  strictEqual(response.body, "ok");

  await server.close();
});

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
        body: Readable.from(['{"data":{"ok":true}}']),
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

test("POST /proxy coalesces concurrent misses for the same cache key", async () => {
  let calls = 0;
  let resolveUpstream: (() => void) | undefined;
  const upstreamReady = new Promise<void>((resolve) => {
    resolveUpstream = resolve;
  });
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
      await upstreamReady;

      return {
        body: Readable.from(['{"data":{"ok":true}}']),
        headers: { "content-type": "application/json" },
        statusCode: 200,
      };
    }
  );

  const body = '{"query":"{ countries { code } }"}';
  const requests = Array.from({ length: 20 }, () =>
    server.inject({
      method: "POST",
      url: "/proxy",
      headers: { "content-type": "application/json" },
      payload: body,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  strictEqual(calls, 1);
  resolveUpstream?.();

  const responses = await Promise.all(requests);

  strictEqual(calls, 1);
  for (const response of responses) {
    strictEqual(response.statusCode, 200);
    strictEqual(response.body, '{"data":{"ok":true}}');
  }

  await server.close();
});

test("POST /proxy sends the same non-cacheable upstream response to concurrent waiters", async () => {
  let calls = 0;
  let resolveUpstream: (() => void) | undefined;
  const upstreamReady = new Promise<void>((resolve) => {
    resolveUpstream = resolve;
  });
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
      await upstreamReady;

      return {
        body: Readable.from(['{"errors":[{"message":"upstream busy"}]}']),
        headers: { "content-type": "application/json" },
        statusCode: 503,
      };
    }
  );

  const body = '{"query":"{ countries { code } }"}';
  const requests = Array.from({ length: 10 }, () =>
    server.inject({
      method: "POST",
      url: "/proxy",
      headers: { "content-type": "application/json" },
      payload: body,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  strictEqual(calls, 1);
  resolveUpstream?.();

  const responses = await Promise.all(requests);

  strictEqual(calls, 1);
  for (const response of responses) {
    strictEqual(response.statusCode, 503);
    strictEqual(response.body, '{"errors":[{"message":"upstream busy"}]}');
  }

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
      body: Readable.from(['{"data":{"ok":true}}']),
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
        body: Readable.from([`{"data":{"call":${calls}}}`]),
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
        body: Readable.from([`{"data":{"call":${calls}}}`]),
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

test("admin purge prevents in-flight responses from repopulating the cache", async () => {
  let calls = 0;
  let finishFirstResponse: (() => void) | undefined;
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

      if (calls === 1) {
        const body = new PassThrough();
        body.write('{"data":');
        finishFirstResponse = () => body.end('{"call":1}}');

        return {
          body,
          headers: { "content-type": "application/json" },
          statusCode: 200,
        };
      }

      return {
        body: Readable.from([`{"data":{"call":${calls}}}`]),
        headers: { "content-type": "application/json" },
        statusCode: 200,
      };
    }
  );

  const body = '{"query":"{ viewer { id } }"}';
  const first = server.inject({ method: "POST", url: "/proxy", payload: body });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const purge = await server.inject({
    method: "DELETE",
    url: "/caches",
    headers: { "sgcrp-admin-secret": "secret" },
  });

  strictEqual(purge.statusCode, 200);
  finishFirstResponse?.();
  strictEqual((await first).body, '{"data":{"call":1}}');

  const afterPurge = await server.inject({
    method: "POST",
    url: "/proxy",
    payload: body,
  });

  strictEqual(calls, 2);
  strictEqual(afterPurge.body, '{"data":{"call":2}}');

  await server.close();
});

test("POST /proxy streams cache misses before the upstream body finishes", async () => {
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
      const body = new PassThrough();
      setTimeout(() => body.write('{"data":'), 10);
      setTimeout(() => body.end('{"ok":true}}'), 150);

      return {
        body,
        headers: { "content-type": "application/json" },
        statusCode: 200,
      };
    }
  );

  await server.listen({ port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port.");
  }

  const startedAt = Date.now();
  let firstChunkAt: number | undefined;
  const responseBody = await new Promise<string>((resolve, reject) => {
    const request = httpRequest(
      {
        headers: { "content-type": "application/json" },
        hostname: "127.0.0.1",
        method: "POST",
        path: "/proxy",
        port: address.port,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          firstChunkAt ??= Date.now();
          body += chunk.toString("utf8");
        });
        response.on("end", () => resolve(body));
      }
    );

    request.on("error", reject);
    request.end('{"query":"{ viewer { id } }"}');
  });

  strictEqual(responseBody, '{"data":{"ok":true}}');
  ok(firstChunkAt !== undefined);
  ok(
    firstChunkAt - startedAt < 100,
    `first chunk arrived after ${firstChunkAt - startedAt}ms`
  );

  await server.close();
});
