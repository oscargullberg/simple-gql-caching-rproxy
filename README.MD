# Simple GraphQL Caching Reverse Proxy

A small GraphQL reverse proxy with a bounded in-memory TTL/LRU cache.

It accepts `POST /proxy`, forwards the body to one configured GraphQL endpoint, and caches successful GraphQL queries by request body and caller identity. Mutations, subscriptions, malformed operations, GraphQL errors, private responses, and oversized responses are forwarded without being cached.

## Requirements

- Node.js >=24

## Installation

```bash
npm install
```

## Configuration

Required:

- `SGCRP_FORWARD_URL`: Upstream GraphQL URL.
- `SGCRP_ADMIN_SECRET`: Secret for cache purge endpoints.

Optional:

- `SGCRP_PORT`: Listen port. Default: `8080`.
- `SGCRP_CACHE_TTL_SECONDS`: Cache TTL in seconds. Default: `120`.
- `SGCRP_CACHE_MAX_ENTRIES`: Max cached responses. Default: `5000`.
- `SGCRP_CACHE_MAX_BYTES`: Cached response-body byte budget. Default: `104857600` (100 MiB). This excludes headers, parsing overhead, and in-flight buffers; it is not a total process-memory limit.
- `SGCRP_MAX_RESPONSE_BYTES`: Largest response that may be buffered and cached. Larger responses are still streamed. Default: `5242880` (5 MiB).
- `SGCRP_REQUEST_BODY_MAX_BYTES`: Maximum request-body size. Default: `1048576` (1 MiB).
- `SGCRP_REQUEST_TIMEOUT_MS`: Upstream request timeout. Default: `30000`.
- `SGCRP_VARY_HEADERS`: Additional comma-separated request headers to include in the cache key.

The cache key always varies on `authorization` and `cookie`. Add any tenant, locale, role, or other request header that can change an upstream response to `SGCRP_VARY_HEADERS`.

GraphQL is parsed only on cache misses, without schema validation or backend-specific logic. Queries exceeding the parser's 10,000-token limit are forwarded without caching, not rejected.

## Development

Run the development server:

```bash
npm run dev
```

## Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

## Run

Start the compiled JavaScript code:

```bash
npm start
```

## API Endpoints

- `GET /healthz`: Returns `ok`.
- `POST /proxy`: Forwards GraphQL operations and caches eligible queries.
- `DELETE /caches`: Purges the cache.
- `POST /hooks/purge`: Purges the cache.

For purge endpoints, pass the admin secret as:

- `sgcrp-admin-secret` header

The existing `?sgcrp-admin-secret=...` query parameter remains supported for backward compatibility. Prefer the header because URLs are commonly recorded in logs and browser history. The purge secret is never forwarded upstream.

## Deployment and security

- Put the proxy behind TLS and an edge rate limiter. It deliberately preserves client GraphQL authorization headers and does not authenticate application users itself.
- Use a high-entropy purge secret and keep the purge endpoints private where possible.
- Keep `SGCRP_MAX_RESPONSE_BYTES` and `SGCRP_CACHE_MAX_BYTES` within the container's memory budget.
- Cache misses are streamed immediately. Duplicate queries share an in-flight response only when its cache headers allow sharing. Private responses, cookies, and unconfigured `Vary` headers trigger separate upstream requests.
- A purge clears cached entries and prevents new requests from joining pre-purge work. Already-running requests may finish, but cannot refill the cache with pre-purge data.
- Production startup enables Fastify's structured request and error logs, including request IDs. Request URL fields omit query strings so legacy purge credentials are not logged.

## Contributing

Keep changes small and easy to reason about. Run tests and build before opening a PR:

```bash
npm test
npm run test:e2e
npm run build
```

The end-to-end suite runs the real HTTP proxy with Supertest against an in-process GraphQL mock and covers every public endpoint, cache isolation, mutations, upstream errors/timeouts, body limits, response limits, and purge authorization.
