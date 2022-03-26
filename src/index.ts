import fastify from "fastify";
import xxhash from "@node-rs/xxhash";
import NodeCache from "node-cache";
import { request as undiciRequest } from "undici";
import {
  FORWARD_URL,
  PORT,
  VARY_HEADERS,
  CACHE_TTL_SECONDS,
  ADMIN_SECRET,
} from "./config";
import type { HttpMethod } from "undici/types/dispatcher";
import type { IncomingHttpHeaders } from "http";
import type { FastifyRequest } from "fastify";

if (!FORWARD_URL) {
  throw new Error("SGCRP_FORWARD_URL is required.");
}
if (!ADMIN_SECRET) {
  throw new Error("SGCRP_ADMIN_SECRET is required.");
}

const varyHeaders = VARY_HEADERS.split(",").map((header) => header.trim());
const cache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS, checkperiod: 120 });
const server = fastify();

const getCacheKey = (headers: IncomingHttpHeaders, body: string) => {
  const headersPart = varyHeaders.reduce(
    (acc, header) => `${acc}${header}:${headers[header]}`,
    ""
  );
  const hashedBody = xxhash.xxh64(body);
  return `${headersPart}-${hashedBody}`;
};

const getResponse = async (request: FastifyRequest) => {
  const requestHeaders = { ...request.headers };
  delete requestHeaders["connection"];
  delete requestHeaders["host"];

  const { statusCode, headers, body } = await undiciRequest(FORWARD_URL!, {
    body: request.body as string,
    method: request.method as HttpMethod,
    headers: requestHeaders,
  });
  const bodyText = await body.text();
  return { statusCode, headers, bodyText };
};

const getResponseWithCache = async (request: FastifyRequest) => {
  const key = getCacheKey(request.headers, request.body as string);
  if (cache.has(key)) {
    return cache.get(key) as {
      bodyText: string;
      statusCode: number;
      headers: IncomingHttpHeaders;
    };
  }
  const response = await getResponse(request);
  cache.set(key, response);
  return response;
};

const authorizeAdmin = (request: FastifyRequest) => {
  return (
    request.headers["sgcrp-admin-secret"] === ADMIN_SECRET ||
    (request.query as any)["sgcrp-admin-secret"] === ADMIN_SECRET
  );
};

server.removeAllContentTypeParsers();
server.addContentTypeParser(
  "*",
  { parseAs: "string" },
  function (_, body, done) {
    done(null, body);
  }
);

server.post("/proxy", async (request, reply) => {
  const { statusCode, headers, bodyText } = await getResponseWithCache(request);
  reply.raw.writeHead(statusCode, headers);
  reply.raw.write(bodyText);
  reply.raw.end();
});

server.delete("/caches", async (request, reply) => {
  if (!authorizeAdmin(request)) {
    reply.status(401).send();
    return;
  }

  cache.flushAll();
  reply.status(200).send();
});

server.post("/hooks/purge", async (request, reply) => {
  if (!authorizeAdmin(request)) {
    reply.status(401).send();
    return;
  }

  cache.flushAll();
  reply.status(200).send();
});

server.listen(PORT, "0.0.0.0", (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
