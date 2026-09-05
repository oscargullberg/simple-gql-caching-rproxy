import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import supertest from "supertest";
import { createServer } from "../src/index";
import { GRAPHQL_STUB_DATA, startGraphqlStub } from "./graphql-stub";

const operation = (operationName: string, query: string) => ({
  operationName,
  query,
});

test("API endpoints against a mock GraphQL upstream", async (context) => {
  const upstream = await startGraphqlStub();
  const server = createServer({
    adminSecret: "e2e-secret",
    cacheMaxBytes: 4_096,
    cacheMaxEntries: 100,
    cacheTtlSeconds: 60,
    forwardUrl: upstream.url,
    maxResponseBytes: 512,
    port: 0,
    requestBodyMaxBytes: 2_048,
    requestTimeoutMs: 200,
    varyHeaders: ["x-tenant-id"],
  });
  await server.listen({ host: "127.0.0.1", port: 0 });
  const api = supertest(server.server);

  try {
    await context.test("health check", async () => {
      const response = await api.get("/healthz").expect(200).expect("ok");
      strictEqual(response.headers["x-content-type-options"], "nosniff");
    });

    await context.test(
      "queries use stub data and cache by identity",
      async () => {
        const body = operation(
          "Recipes",
          "query Recipes { recipes { id title } }",
        );
        const first = await api
          .post("/proxy")
          .set("authorization", "Bearer first")
          .set("sgcrp-admin-secret", "must-not-be-forwarded")
          .send(body)
          .expect(200);
        const cached = await api
          .post("/proxy")
          .set("authorization", "Bearer first")
          .send(body)
          .expect(200);
        const otherUser = await api
          .post("/proxy")
          .set("authorization", "Bearer second")
          .send(body)
          .expect(200);
        const otherTenant = await api
          .post("/proxy")
          .set("authorization", "Bearer first")
          .set("x-tenant-id", "tenant-2")
          .send(body)
          .expect(200);

        strictEqual(
          first.body.data.recipes.length,
          GRAPHQL_STUB_DATA.recipes.length,
        );
        strictEqual(cached.body.data.call, 1);
        strictEqual(otherUser.body.data.call, 2);
        strictEqual(otherTenant.body.data.call, 3);
        strictEqual(upstream.count("Recipes"), 3);
        strictEqual(
          upstream.requests.find(
            (request) => request.operationName === "Recipes",
          )?.headers["sgcrp-admin-secret"],
          undefined,
        );
      },
    );

    await context.test("mutations are never cached or coalesced", async () => {
      const body = operation(
        "AddRecipe",
        'mutation AddRecipe { addRecipe(title: "Soup") { id } }',
      );
      const responses = await Promise.all([
        api.post("/proxy").send(body),
        api.post("/proxy").send(body),
      ]);
      strictEqual(responses[0]?.status, 200);
      strictEqual(responses[1]?.status, 200);
      strictEqual(upstream.count("AddRecipe"), 2);
    });

    await context.test(
      "GraphQL errors and private responses are not cached",
      async () => {
        const errorBody = operation(
          "GraphqlError",
          "query GraphqlError { recipes { id } }",
        );
        const privateBody = operation(
          "Private",
          "query Private { recipes { id } }",
        );
        const staleBody = operation(
          "MaxAgeZero",
          "query MaxAgeZero { recipes { id } }",
        );

        await api.post("/proxy").send(errorBody).expect(200);
        await api.post("/proxy").send(errorBody).expect(200);
        await api.post("/proxy").send(privateBody).expect(200);
        await api.post("/proxy").send(privateBody).expect(200);
        await api.post("/proxy").send(staleBody).expect(200);
        await api.post("/proxy").send(staleBody).expect(200);

        strictEqual(upstream.count("GraphqlError"), 2);
        strictEqual(upstream.count("Private"), 2);
        strictEqual(upstream.count("MaxAgeZero"), 2);
      },
    );

    await context.test(
      "multiple upstream cookies remain separate and are not cached",
      async () => {
        const body = operation("Cookies", "query Cookies { recipes { id } }");
        const first = await api.post("/proxy").send(body).expect(200);
        const second = await api.post("/proxy").send(body).expect(200);
        deepStrictEqual(first.headers["set-cookie"], [
          "session=1; HttpOnly",
          "preference=1",
        ]);
        deepStrictEqual(second.headers["set-cookie"], [
          "session=2; HttpOnly",
          "preference=2",
        ]);
        strictEqual(upstream.count("Cookies"), 2);
      },
    );

    await context.test(
      "upstream HTTP errors preserve their status and body",
      async () => {
        const body = operation(
          "HttpError",
          "query HttpError { recipes { id } }",
        );
        const first = await api.post("/proxy").send(body).expect(503);
        await api.post("/proxy").send(body).expect(503);
        deepStrictEqual(first.body, { errors: [{ message: "Unavailable" }] });
        strictEqual(upstream.count("HttpError"), 2);
      },
    );

    await context.test(
      "oversized responses stream but are not retained",
      async () => {
        const body = operation("Large", "query Large { value }");
        const first = await api.post("/proxy").send(body).expect(200);
        await api.post("/proxy").send(body).expect(200);

        strictEqual(first.body.data.value.length, 2_048);
        strictEqual(upstream.count("Large"), 2);
      },
    );

    await context.test("request bodies are bounded", async () => {
      await api
        .post("/proxy")
        .send({
          operationName: "Oversized",
          query: "query Oversized { recipes { id } }",
          variables: { value: "x".repeat(3_000) },
        })
        .expect(413);
      strictEqual(upstream.count("Oversized"), 0);
    });

    await context.test(
      "slow upstreams time out without rejecting unrelated traffic",
      async () => {
        const firstSlowRequest = api
          .post("/proxy")
          .send(operation("SlowOne", "query SlowOne { slow }"))
          .then((response) => response);
        const secondSlowRequest = api
          .post("/proxy")
          .send(operation("SlowTwo", "query SlowTwo { slow }"))
          .then((response) => response);
        await Promise.all([
          upstream.waitFor("SlowOne"),
          upstream.waitFor("SlowTwo"),
        ]);

        const unrelated = await api
          .post("/proxy")
          .send(operation("AtCapacity", "query AtCapacity { recipes { id } }"))
          .expect(200);
        strictEqual(unrelated.body.data.recipes[0].title, "Tomato soup");
        strictEqual((await firstSlowRequest).status, 504);
        strictEqual((await secondSlowRequest).status, 504);
        strictEqual(upstream.count("AtCapacity"), 1);
      },
    );

    await context.test(
      "admin endpoints preserve query-secret and header authentication",
      async () => {
        const body = operation(
          "Purgeable",
          "query Purgeable { recipes { id } }",
        );
        await api.post("/proxy").send(body).expect(200);
        await api.post("/proxy").send(body).expect(200);
        strictEqual(upstream.count("Purgeable"), 1);

        await api.delete("/caches?sgcrp-admin-secret=e2e-secret").expect(200);
        await api
          .delete("/caches")
          .set("sgcrp-admin-secret", "e2e-secret")
          .expect(200);
        await api.post("/proxy").send(body).expect(200);
        strictEqual(upstream.count("Purgeable"), 2);

        await api.post("/hooks/purge").expect(401);
        await api
          .post("/hooks/purge")
          .set("sgcrp-admin-secret", "e2e-secret")
          .expect(200);
      },
    );
  } finally {
    await server.close();
    await upstream.close();
  }
});
