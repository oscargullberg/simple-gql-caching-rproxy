import fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { Readable, Transform } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { buildCacheKey, TtlCache } from "./cache";
import { loadConfig } from "./config";
import type { AppConfig } from "./config";

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export type RemoteResponse = {
  body: Readable;
  headers: OutgoingHttpHeaders;
  statusCode: number;
};

type CachedResponse = {
  body: Buffer;
  headers: OutgoingHttpHeaders;
  statusCode: number;
};

type FetchRemoteResponse = (request: {
  body: string;
  headers: Record<string, string>;
  method: string;
  signal: AbortSignal;
  url: URL;
}) => Promise<RemoteResponse>;

const getSingleHeaderValue = (
  value: IncomingHttpHeaders[string],
): string | undefined => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value;
};

const buildForwardHeaders = (
  requestHeaders: IncomingHttpHeaders,
): Record<string, string> => {
  const headers: Record<string, string> = {
    "accept-encoding": "identity",
  };

  for (const [name, value] of Object.entries(requestHeaders)) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_REQUEST_HEADERS.has(lowerName)) {
      continue;
    }

    const headerValue = getSingleHeaderValue(value);
    if (headerValue !== undefined) {
      headers[lowerName] = headerValue;
    }
  }

  return headers;
};

const buildReplyHeaders = (headers: Headers): OutgoingHttpHeaders => {
  const replyHeaders: OutgoingHttpHeaders = {};

  headers.forEach((value, name) => {
    const lowerName = name.toLowerCase();
    if (!HOP_BY_HOP_RESPONSE_HEADERS.has(lowerName)) {
      replyHeaders[lowerName] = value;
    }
  });

  return replyHeaders;
};

const fetchRemoteResponse: FetchRemoteResponse = async ({
  body,
  headers,
  method,
  signal,
  url,
}) => {
  const response = await fetch(url, {
    body,
    headers,
    method,
    signal,
  });

  return {
    body: response.body
      ? Readable.fromWeb(response.body as unknown as NodeReadableStream)
      : Readable.from([]),
    headers: buildReplyHeaders(response.headers),
    statusCode: response.status,
  };
};

const cacheStream = (
  stream: Readable,
  onComplete: (body: Buffer) => void,
): Readable => {
  const chunks: Buffer[] = [];
  let length = 0;

  const collector = new Transform({
    transform(chunk: Buffer | string, _, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      length += buffer.length;
      callback(null, chunk);
    },
    flush(callback) {
      onComplete(Buffer.concat(chunks, length));
      callback();
    },
  });

  stream.on("error", (error) => collector.destroy(error));
  return stream.pipe(collector);
};

const isAuthorizedAdmin = (
  request: FastifyRequest,
  adminSecret: string,
): boolean => {
  const query = request.query as Record<string, unknown>;
  const clientSecret =
    request.headers["sgcrp-admin-secret"] ?? query["sgcrp-admin-secret"];

  if (
    typeof clientSecret !== "string" ||
    Buffer.byteLength(clientSecret) !== Buffer.byteLength(adminSecret)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(clientSecret, "utf8"),
    Buffer.from(adminSecret, "utf8"),
  );
};

export const createServer = (
  config: AppConfig,
  remoteFetch: FetchRemoteResponse = fetchRemoteResponse,
) => {
  const cache = new TtlCache<CachedResponse>({
    maxEntries: config.cacheMaxEntries,
    ttlMs: config.cacheTtlSeconds * 1_000,
  });
  const server = fastify();

  server.removeAllContentTypeParsers();
  server.addContentTypeParser(
    "*",
    { parseAs: "string" },
    function (_, body, done) {
      done(null, body);
    },
  );

  server.get("/healthz", async (_, reply) => {
    return reply.type("text/plain").send("ok");
  });

  server.post("/proxy", async (request, reply) => {
    const body = (request.body as string | undefined) ?? "";
    const key = buildCacheKey(request.headers, body, config.varyHeaders);
    const cachedResponse = cache.get(key);

    if (cachedResponse) {
      return reply
        .code(cachedResponse.statusCode)
        .headers(cachedResponse.headers)
        .send(cachedResponse.body);
    }

    const response = await remoteFetch({
      body,
      headers: buildForwardHeaders(request.headers),
      method: request.method,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      url: config.forwardUrl,
    });

    if (response.statusCode !== 200) {
      request.log.warn(
        { statusCode: response.statusCode },
        "Remote GraphQL response was not cached",
      );
    }

    const responseBody =
      response.statusCode === 200
        ? cacheStream(response.body, (body) => {
            cache.set(key, {
              body,
              headers: response.headers,
              statusCode: response.statusCode,
            });
          })
        : response.body;

    return reply
      .code(response.statusCode)
      .headers(response.headers)
      .send(responseBody);
  });

  const purgeCaches = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAuthorizedAdmin(request, config.adminSecret)) {
      return reply.status(401).send();
    }

    cache.clear();
    return reply.status(200).send();
  };

  server.delete("/caches", purgeCaches);
  server.post("/hooks/purge", purgeCaches);

  return server;
};

if (require.main === module) {
  const config = loadConfig();
  const server = createServer(config);

  server.listen({ port: config.port, host: "0.0.0.0" }, (err, address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }

    server.log.info(`Server listening at ${address}`);
  });
}
