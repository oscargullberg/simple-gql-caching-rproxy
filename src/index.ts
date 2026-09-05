import fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { Readable, Transform } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { buildCacheKey, TtlCache } from "./cache";
import { loadConfig } from "./config";
import type { AppConfig } from "./config";
import {
  isCacheableGraphqlRequest,
  isCacheableGraphqlResponse,
} from "./graphql";

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
  "sgcrp-admin-secret",
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

const DEFAULT_VARY_HEADERS = ["authorization", "cookie"];
const DEFAULT_CACHE_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_REQUEST_BODY_MAX_BYTES = 1024 * 1024;

export type RemoteResponse = {
  body: Readable;
  headers: OutgoingHttpHeaders;
  statusCode: number;
};

type BufferedResponse = {
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
  const connectionHeaders = new Set(
    getSingleHeaderValue(requestHeaders.connection)
      ?.split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean) ?? [],
  );

  for (const [name, value] of Object.entries(requestHeaders)) {
    const lowerName = name.toLowerCase();
    if (
      HOP_BY_HOP_REQUEST_HEADERS.has(lowerName) ||
      connectionHeaders.has(lowerName)
    ) {
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
  const connectionHeaders = new Set(
    headers
      .get("connection")
      ?.split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean) ?? [],
  );

  headers.forEach((value, name) => {
    const lowerName = name.toLowerCase();
    if (
      !HOP_BY_HOP_RESPONSE_HEADERS.has(lowerName) &&
      !connectionHeaders.has(lowerName)
    ) {
      replyHeaders[lowerName] = value;
    }
  });

  const setCookies = headers.getSetCookie();
  if (setCookies.length > 0) {
    replyHeaders["set-cookie"] = setCookies;
  }

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
  maxBytes: number,
  onComplete: (body: Buffer | undefined) => void,
  onError: (error: Error) => void,
): Readable => {
  const chunks: Buffer[] = [];
  let length = 0;
  let didError = false;
  let exceededLimit = false;

  const fail = (error: Error) => {
    if (didError) {
      return;
    }

    didError = true;
    onError(error);
  };

  const collector = new Transform({
    transform(chunk: Buffer | string, _, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!exceededLimit) {
        length += buffer.length;
        if (length <= maxBytes) {
          chunks.push(buffer);
        } else {
          chunks.length = 0;
          exceededLimit = true;
        }
      }
      callback(null, chunk);
    },
    flush(callback) {
      onComplete(exceededLimit ? undefined : Buffer.concat(chunks, length));
      callback();
    },
  });

  stream.on("error", (error) => {
    fail(error);
    collector.destroy(error);
  });
  collector.on("error", fail);
  return stream.pipe(collector);
};

const getHeaderValue = (
  headers: OutgoingHttpHeaders,
  name: string,
): string | undefined => {
  const entry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name,
  );
  const value = entry?.[1];
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return value === undefined ? undefined : String(value);
};

const getResponseCacheTtlMs = (
  headers: OutgoingHttpHeaders,
  varyHeaders: string[],
  configuredTtlMs: number,
): number | undefined => {
  if (getHeaderValue(headers, "set-cookie")) {
    return undefined;
  }

  const cacheControl = getHeaderValue(headers, "cache-control")?.toLowerCase();
  const directives = new Map<string, string | undefined>();
  for (const directive of cacheControl?.split(",") ?? []) {
    const [rawName, rawValue] = directive.trim().split("=", 2);
    const name = rawName?.trim();
    if (name) {
      directives.set(name, rawValue?.trim().replace(/^"|"$/g, ""));
    }
  }

  if (
    ["no-cache", "no-store", "private"].some((name) => directives.has(name))
  ) {
    return undefined;
  }
  if (
    getHeaderValue(headers, "pragma")
      ?.toLowerCase()
      .split(",")
      .some((directive) => directive.trim() === "no-cache")
  ) {
    return undefined;
  }

  const vary = getHeaderValue(headers, "vary");
  if (vary) {
    const configuredVaryHeaders = new Set(varyHeaders);
    const canVarySafely = vary
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .every(
        (header) => header.length > 0 && configuredVaryHeaders.has(header),
      );
    if (!canVarySafely) {
      return undefined;
    }
  }

  let maxAgeDirective: "max-age" | "s-maxage" | undefined;
  if (directives.has("s-maxage")) {
    maxAgeDirective = "s-maxage";
  } else if (directives.has("max-age")) {
    maxAgeDirective = "max-age";
  }
  if (!maxAgeDirective) {
    return configuredTtlMs;
  }
  const maxAge = directives.get(maxAgeDirective);
  if (maxAge === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(maxAge)) {
    return undefined;
  }

  const maxAgeSeconds = Number(maxAge);
  const age = getHeaderValue(headers, "age") ?? "0";
  if (!Number.isSafeInteger(maxAgeSeconds) || !/^\d+$/.test(age)) {
    return undefined;
  }

  const ageSeconds = Number(age);
  if (!Number.isSafeInteger(ageSeconds)) {
    return undefined;
  }

  const remainingMs = (maxAgeSeconds - ageSeconds) * 1_000;
  return remainingMs > 0 ? Math.min(configuredTtlMs, remainingMs) : undefined;
};

const normalizeVaryHeaders = (varyHeaders: string[]): string[] =>
  [
    ...new Set(
      [...DEFAULT_VARY_HEADERS, ...varyHeaders]
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "TimeoutError" || error.name === "AbortError");

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
  const cacheMaxBytes = config.cacheMaxBytes ?? DEFAULT_CACHE_MAX_BYTES;
  const cacheTtlMs = config.cacheTtlSeconds * 1_000;
  const maxResponseBytes =
    config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const varyHeaders = normalizeVaryHeaders(config.varyHeaders);
  const cache = new TtlCache<BufferedResponse>({
    maxEntries: config.cacheMaxEntries,
    maxSizeBytes: cacheMaxBytes,
    sizeOf: (response) => response.body.byteLength,
    ttlMs: cacheTtlMs,
  });
  const inFlight = new Map<string, Promise<BufferedResponse | undefined>>();
  let cacheGeneration = 0;
  const server = fastify({
    bodyLimit: config.requestBodyMaxBytes ?? DEFAULT_REQUEST_BODY_MAX_BYTES,
    logger: config.enableLogging
      ? {
          serializers: {
            req(request) {
              // Legacy purge URLs may contain the admin secret.
              return {
                method: request.method,
                url: request.url.split("?", 1)[0] ?? "",
                remoteAddress: request.ip,
              };
            },
          },
        }
      : false,
  });

  server.removeAllContentTypeParsers();
  server.addContentTypeParser(
    "*",
    { parseAs: "string" },
    function (_, body, done) {
      done(null, body);
    },
  );

  server.addHook("onSend", async (_, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    return payload;
  });

  server.get("/healthz", async (_, reply) => {
    return reply.type("text/plain").send("ok");
  });

  // Preserve Fastify's 404 response without its unsanitized URL log message.
  server.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      message: `Route ${request.method}:${request.url} not found`,
      error: "Not Found",
      statusCode: 404,
    }),
  );

  const sendUpstreamError = (
    request: FastifyRequest,
    reply: FastifyReply,
    error: unknown,
  ) => {
    const statusCode = isTimeoutError(error) ? 504 : 502;
    request.log.error(
      { err: error, statusCode },
      "Remote GraphQL request failed",
    );
    return reply.status(statusCode).send({
      errors: [{ message: "Upstream GraphQL request failed" }],
    });
  };

  const fetchUpstream = async (
    request: FastifyRequest,
    reply: FastifyReply,
    body: string,
  ) => {
    let released = false;
    const clientAbort = new AbortController();
    const abortForDisconnect = () => {
      clientAbort.abort(new DOMException("Client disconnected", "AbortError"));
    };
    const abortForClosedResponse = () => {
      if (!reply.raw.writableEnded) {
        abortForDisconnect();
      }
    };
    request.raw.once("aborted", abortForDisconnect);
    reply.raw.once("close", abortForClosedResponse);
    const removeDisconnectListeners = () => {
      request.raw.off("aborted", abortForDisconnect);
      reply.raw.off("close", abortForClosedResponse);
    };
    const release = () => {
      if (!released) {
        released = true;
        removeDisconnectListeners();
      }
    };

    try {
      const response = await remoteFetch({
        body,
        headers: buildForwardHeaders(request.headers),
        method: request.method,
        signal: AbortSignal.any([
          clientAbort.signal,
          AbortSignal.timeout(config.requestTimeoutMs),
        ]),
        url: config.forwardUrl,
      });
      response.body.once("close", release);
      response.body.once("end", release);
      response.body.once("error", release);
      return response;
    } catch (error) {
      release();
      throw error;
    }
  };

  const forwardWithoutCache = async (
    request: FastifyRequest,
    reply: FastifyReply,
    body: string,
  ) => {
    let response: RemoteResponse;
    try {
      response = await fetchUpstream(request, reply, body);
    } catch (error) {
      return sendUpstreamError(request, reply, error);
    }

    return reply
      .code(response.statusCode)
      .headers(response.headers)
      .send(response.body);
  };

  server.post("/proxy", async (request, reply) => {
    const body = typeof request.body === "string" ? request.body : "";
    const key = buildCacheKey(request.headers, body, varyHeaders);
    const cachedResponse = cache.get(key);

    if (cachedResponse) {
      return reply
        .code(cachedResponse.statusCode)
        .headers(cachedResponse.headers)
        .send(cachedResponse.body);
    }

    const pendingResponse = inFlight.get(key);
    if (pendingResponse) {
      try {
        const response = await pendingResponse;
        if (response) {
          return reply
            .code(response.statusCode)
            .headers(response.headers)
            .send(response.body);
        }
      } catch (error) {
        return sendUpstreamError(request, reply, error);
      }

      return forwardWithoutCache(request, reply, body);
    }

    // Only verified queries enter either map, so hits need no GraphQL parsing.
    if (!isCacheableGraphqlRequest(body)) {
      return forwardWithoutCache(request, reply, body);
    }

    let resolveInFlight!: (response: BufferedResponse | undefined) => void;
    let rejectInFlight!: (error: unknown) => void;
    const inFlightResponse = new Promise<BufferedResponse | undefined>(
      (resolve, reject) => {
        resolveInFlight = resolve;
        rejectInFlight = reject;
      },
    );
    inFlightResponse.catch(() => undefined);
    inFlight.set(key, inFlightResponse);
    const requestGeneration = cacheGeneration;
    const clearInFlight = () => {
      if (inFlight.get(key) === inFlightResponse) {
        inFlight.delete(key);
      }
    };

    let response: RemoteResponse;
    try {
      response = await fetchUpstream(request, reply, body);
    } catch (error) {
      rejectInFlight(error);
      clearInFlight();
      return sendUpstreamError(request, reply, error);
    }

    if (response.statusCode !== 200) {
      request.log.warn(
        { statusCode: response.statusCode },
        "Remote GraphQL response was not cached",
      );
    }

    const responseTtlMs = getResponseCacheTtlMs(
      response.headers,
      varyHeaders,
      cacheTtlMs,
    );
    if (responseTtlMs === undefined) {
      // Privacy and Vary rules apply to concurrent waiters, not just storage.
      resolveInFlight(undefined);
      clearInFlight();
      return reply
        .code(response.statusCode)
        .headers(response.headers)
        .send(response.body);
    }

    const responseBody = cacheStream(
      response.body,
      maxResponseBytes,
      (body) => {
        if (!body) {
          request.log.warn(
            { maxResponseBytes, statusCode: response.statusCode },
            "Remote GraphQL response exceeded the cache buffer limit",
          );
          resolveInFlight(undefined);
          clearInFlight();
          return;
        }

        const bufferedResponse = {
          body,
          headers: response.headers,
          statusCode: response.statusCode,
        };
        if (
          response.statusCode === 200 &&
          isCacheableGraphqlResponse(body) &&
          requestGeneration === cacheGeneration
        ) {
          cache.set(key, bufferedResponse, responseTtlMs);
        }

        resolveInFlight(bufferedResponse);
        clearInFlight();
      },
      (error) => {
        rejectInFlight(error);
        clearInFlight();
      },
    );

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
    inFlight.clear();
    cacheGeneration += 1;
    return reply.status(200).send();
  };

  server.delete("/caches", purgeCaches);
  server.post("/hooks/purge", purgeCaches);

  return server;
};

if (require.main === module) {
  const config = loadConfig();
  const server = createServer(config);

  const start = async () => {
    try {
      const address = await server.listen({
        port: config.port,
        host: "0.0.0.0",
      });
      server.log.info(`Server listening at ${address}`);
    } catch (error) {
      server.log.error(error);
      process.exitCode = 1;
    }
  };

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    server.log.info({ signal }, "Shutting down");
    try {
      await server.close();
    } catch (error) {
      server.log.error(error, "Graceful shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  void start();
}
