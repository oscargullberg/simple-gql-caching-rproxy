import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

export const GRAPHQL_STUB_DATA = {
  recipes: [
    { id: "recipe-1", title: "Tomato soup" },
    { id: "recipe-2", title: "Mushroom pasta" },
  ],
};

export type GraphqlRequest = {
  body: string;
  headers: IncomingHttpHeaders;
  operationName: string | undefined;
  variables: unknown;
};

type GraphqlBody = {
  operationName?: unknown;
  variables?: unknown;
};

export type GraphqlStub = {
  close: () => Promise<void>;
  count: (operationName: string) => number;
  requests: GraphqlRequest[];
  url: URL;
  waitFor: (operationName: string) => Promise<void>;
};

const readBody = async (request: NodeJS.ReadableStream): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

export const startGraphqlStub = async (): Promise<GraphqlStub> => {
  const requests: GraphqlRequest[] = [];
  const waiting = new Map<string, Set<() => void>>();
  const server: Server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/graphql") {
      response.writeHead(404).end();
      return;
    }

    const body = await readBody(request);
    let parsed: GraphqlBody = {};
    try {
      parsed = JSON.parse(body) as GraphqlBody;
    } catch {
      // The upstream decides how malformed GraphQL payloads are handled.
    }

    const operationName =
      typeof parsed.operationName === "string"
        ? parsed.operationName
        : undefined;
    requests.push({
      body,
      headers: request.headers,
      operationName,
      variables: parsed.variables,
    });
    for (const resolve of waiting.get(operationName ?? "") ?? []) {
      resolve();
    }
    waiting.delete(operationName ?? "");

    response.setHeader("content-type", "application/json");

    if (operationName?.startsWith("Slow")) {
      await delay(500);
      if (!response.destroyed) {
        response.end(JSON.stringify({ data: { slow: true } }));
      }
      return;
    }

    if (operationName === "GraphqlError") {
      response.end(
        JSON.stringify({
          data: null,
          errors: [{ message: "The upstream rejected the query" }],
        }),
      );
      return;
    }

    if (operationName === "Large") {
      response.end(JSON.stringify({ data: { value: "x".repeat(2_048) } }));
      return;
    }

    if (operationName === "Private") {
      response.setHeader("cache-control", 'private="authorization"');
    }
    if (operationName === "MaxAgeZero") {
      response.setHeader("cache-control", "public, max-age=0");
    }

    if (operationName === "Cookies") {
      const call = requests.filter(
        (record) => record.operationName === operationName,
      ).length;
      response.setHeader("set-cookie", [
        `session=${call}; HttpOnly`,
        `preference=${call}`,
      ]);
    }

    if (operationName === "HttpError") {
      response
        .writeHead(503)
        .end(JSON.stringify({ errors: [{ message: "Unavailable" }] }));
      return;
    }

    if (operationName === "AddRecipe") {
      response.end(
        JSON.stringify({
          data: { addRecipe: GRAPHQL_STUB_DATA.recipes[0] },
        }),
      );
      return;
    }

    response.end(
      JSON.stringify({
        data: {
          call: requests.filter(
            (record) => record.operationName === operationName,
          ).length,
          recipes: GRAPHQL_STUB_DATA.recipes,
        },
      }),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("GraphQL stub did not listen on a TCP port.");
  }

  return {
    close: async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
    count: (operationName) =>
      requests.filter((record) => record.operationName === operationName)
        .length,
    requests,
    url: new URL(`http://127.0.0.1:${address.port}/graphql`),
    waitFor: async (operationName) => {
      if (requests.some((request) => request.operationName === operationName)) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const resolvers = waiting.get(operationName) ?? new Set<() => void>();
        const timeout = setTimeout(() => {
          resolvers.delete(onRequest);
          reject(new Error(`Timed out waiting for ${operationName}.`));
        }, 1_000);
        const onRequest = () => {
          clearTimeout(timeout);
          resolve();
        };
        resolvers.add(onRequest);
        waiting.set(operationName, resolvers);
      });
    },
  };
};
