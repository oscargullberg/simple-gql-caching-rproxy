import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { execFile } from "node:child_process";
import { Readable, PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { request as httpRequest } from "node:http";
import type { OutgoingHttpHeaders } from "node:http";
import type { AppConfig } from "../src/config";
import { createServer } from "../src/index";

const config: AppConfig = {
  adminSecret: "test-secret",
  cacheMaxEntries: 100,
  cacheTtlSeconds: 60,
  forwardUrl: new URL("https://example.test/graphql"),
  port: 0,
  requestTimeoutMs: 5_000,
  varyHeaders: [],
};
const payload = '{"query":"{ viewer { id } }"}';

test(
  "disconnecting a streaming client aborts upstream work",
  { timeout: 5_000 },
  async (context) => {
    const aborted = Promise.withResolvers<void>();
    const server = createServer(config, async ({ signal }) => {
      const body = new PassThrough();
      signal.addEventListener(
        "abort",
        () => {
          body.destroy(signal.reason);
          aborted.resolve();
        },
        { once: true },
      );
      body.write('{"data":');
      return {
        body,
        headers: { "content-type": "application/json" },
        statusCode: 200,
      };
    });
    context.after(() => server.close());
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });
    const request = httpRequest(
      `${origin}/proxy`,
      { method: "POST" },
      (response) => {
        response.once("data", () => request.destroy());
      },
    );
    request.on("error", () => {});
    request.end(payload);

    await aborted.promise;
    strictEqual(
      (await server.inject({ method: "GET", url: "/healthz" })).statusCode,
      200,
    );
  },
);

test("cache hits skip request JSON and GraphQL parsing", async (context) => {
  const parseJson = JSON.parse;
  let parses = 0;
  context.mock.method(JSON, "parse", (text: string) => {
    if (text === payload) parses += 1;
    return parseJson(text);
  });
  const server = createServer(config, async () => ({
    body: Readable.from(['{"data":{"viewer":{"id":"user-1"}}}']),
    headers: { "content-type": "application/json" },
    statusCode: 200,
  }));
  context.after(() => server.close());

  for (let index = 0; index < 3; index += 1) {
    const response = await server.inject({
      method: "POST",
      url: "/proxy",
      payload,
    });
    strictEqual(response.statusCode, 200);
  }
  strictEqual(parses, 1);
});

const privateHeaders: [string, OutgoingHttpHeaders][] = [
  ["private responses", { "cache-control": 'private="authorization"' }],
  ["no-store responses", { "cache-control": "no-store" }],
  ["unconfigured Vary headers", { vary: "x-locale" }],
  ["wildcard Vary", { vary: "*" }],
  ["cookies", { "set-cookie": ["session=first; HttpOnly", "other=first"] }],
];

for (const [name, headers] of privateHeaders) {
  test(`concurrent requests do not share ${name}`, async (context) => {
    const upstreamReady = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const secondArrived = Promise.withResolvers<void>();
    let arrivals = 0;
    let calls = 0;
    const server = createServer(config, async ({ headers: requestHeaders }) => {
      const call = ++calls;
      upstreamReady.resolve();
      await gate.promise;
      return {
        body: Readable.from([
          JSON.stringify({
            data: { call, locale: requestHeaders["x-locale"] },
          }),
        ]),
        headers: {
          "content-type": "application/json",
          ...headers,
          ...(headers["set-cookie"]
            ? { "set-cookie": [`session=${call}`, `other=${call}`] }
            : {}),
        },
        statusCode: 200,
      };
    });
    context.after(() => server.close());
    server.addHook("preHandler", async () => {
      if (++arrivals === 2) secondArrived.resolve();
    });

    const first = server
      .inject({
        method: "POST",
        url: "/proxy",
        payload,
        headers: { "x-locale": "sv" },
      })
      .then((response) => response);
    await upstreamReady.promise;
    const second = server
      .inject({
        method: "POST",
        url: "/proxy",
        payload,
        headers: { "x-locale": "en" },
      })
      .then((response) => response);
    await secondArrived.promise;
    await setImmediate();
    gate.resolve();

    const [swedish, english] = await Promise.all([first, second]);
    strictEqual(calls, 2);
    deepStrictEqual(swedish.json(), { data: { call: 1, locale: "sv" } });
    deepStrictEqual(english.json(), { data: { call: 2, locale: "en" } });
    if (headers["set-cookie"]) {
      deepStrictEqual(swedish.headers["set-cookie"], ["session=1", "other=1"]);
      deepStrictEqual(english.headers["set-cookie"], ["session=2", "other=2"]);
    }
    await server.inject({ method: "POST", url: "/proxy", payload });
    strictEqual(calls, 3);
  });
}

test("requests after a purge do not join old in-flight responses", async (context) => {
  const started = Promise.withResolvers<void>();
  const secondArrived = Promise.withResolvers<void>();
  const firstBody = new PassThrough();
  let arrivals = 0;
  let calls = 0;
  const server = createServer(config, async () => {
    const call = ++calls;
    started.resolve();
    return {
      body:
        call === 1 ? firstBody : Readable.from([`{"data":{"call":${call}}}`]),
      headers: { "content-type": "application/json" },
      statusCode: 200,
    };
  });
  context.after(() => server.close());
  server.addHook("preHandler", async (request) => {
    if (request.url === "/proxy" && ++arrivals === 2) secondArrived.resolve();
  });
  const first = server
    .inject({ method: "POST", url: "/proxy", payload })
    .then((response) => response);
  await started.promise;
  await server.inject({
    method: "DELETE",
    url: "/caches",
    headers: { "sgcrp-admin-secret": config.adminSecret },
  });
  const fresh = server
    .inject({ method: "POST", url: "/proxy", payload })
    .then((response) => response);
  await secondArrived.promise;
  await setImmediate();
  const callsAfterPurge = calls;
  firstBody.end('{"data":{"call":1}}');

  strictEqual((await first).json().data.call, 1);
  strictEqual((await fresh).json().data.call, 2);
  strictEqual(callsAfterPurge, 2);
  const cached = await server.inject({
    method: "POST",
    url: "/proxy",
    payload,
  });
  strictEqual(cached.json().data.call, 2);
  strictEqual(calls, 2);
});

test("production request logs omit query strings and credentials", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--eval",
      `
      const { createServer } = require('./src/index.ts');
      const server = createServer({
        ...${JSON.stringify(config)},
        forwardUrl: new URL('https://example.test/graphql'),
        enableLogging: true,
      });
      (async () => {
        await server.inject({
          method: 'DELETE',
          url: '/caches?sgcrp-admin-secret=test-secret',
          headers: { authorization: 'Bearer private-token', cookie: 'session=private' },
        });
        await server.inject({ method: 'GET', url: '/caches?sgcrp-admin-secret=test-secret' });
        await server.close();
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
    ],
    { cwd: new URL("..", import.meta.url), timeout: 10_000 },
  );
  ok(stdout.includes('"url":"/caches"'));
  ok(stdout.includes('"statusCode":200'));
  ok(stdout.includes('"statusCode":404'));
  ok(!stdout.includes("test-secret"));
  ok(!stdout.includes("private-token"));
  ok(!stdout.includes("session=private"));
});
