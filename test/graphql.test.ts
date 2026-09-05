import { strictEqual } from "node:assert";
import { test } from "node:test";
import {
  isCacheableGraphqlRequest,
  isCacheableGraphqlResponse,
} from "../src/graphql";

test("only GraphQL query operations are cacheable", () => {
  strictEqual(
    isCacheableGraphqlRequest(
      JSON.stringify({ query: "query Recipes { recipes { id } }" }),
    ),
    true,
  );
  strictEqual(
    isCacheableGraphqlRequest(
      JSON.stringify({ query: "mutation AddRecipe { addRecipe { id } }" }),
    ),
    false,
  );
  strictEqual(
    isCacheableGraphqlRequest(
      JSON.stringify({
        operationName: "Read",
        query:
          "query Read { recipes { id } } mutation Write { addRecipe { id } }",
      }),
    ),
    true,
  );
  strictEqual(
    isCacheableGraphqlRequest(
      JSON.stringify({
        query:
          "query Read { recipes { id } } mutation Write { addRecipe { id } }",
      }),
    ),
    false,
  );
});

test("malformed and persisted-query-only bodies are not cacheable", () => {
  strictEqual(isCacheableGraphqlRequest("not-json"), false);
  strictEqual(isCacheableGraphqlRequest(JSON.stringify({ query: "{" })), false);
  strictEqual(
    isCacheableGraphqlRequest(
      JSON.stringify({
        extensions: { persistedQuery: { sha256Hash: "hash" } },
      }),
    ),
    false,
  );
  strictEqual(
    isCacheableGraphqlRequest(
      JSON.stringify({
        operationName: 123,
        query: "query Read { recipes { id } }",
      }),
    ),
    false,
  );
});

test("only successful GraphQL data responses are cacheable", () => {
  strictEqual(
    isCacheableGraphqlResponse(Buffer.from('{"data":{"recipes":[]}}')),
    true,
  );
  strictEqual(
    isCacheableGraphqlResponse(
      Buffer.from('{"data":null,"errors":[{"message":"failed"}]}'),
    ),
    false,
  );
  strictEqual(isCacheableGraphqlResponse(Buffer.from("not-json")), false);
  strictEqual(
    isCacheableGraphqlResponse(
      Buffer.from('{"data":{},"errors":{"message":"invalid"}}'),
    ),
    false,
  );
  strictEqual(
    isCacheableGraphqlResponse(Buffer.from('{"data":{},"hasNext":true}')),
    false,
  );
});
