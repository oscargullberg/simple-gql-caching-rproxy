# Simple GraphQL Caching Reverse Proxy

A small GraphQL reverse proxy with an in-memory TTL cache.

It accepts `POST /proxy`, forwards the body to one configured GraphQL endpoint, and caches `200` responses by request body plus any configured vary headers.

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
- `SGCRP_REQUEST_TIMEOUT_MS`: Upstream request timeout. Default: `30000`.
- `SGCRP_VARY_HEADERS`: Comma-separated request headers to include in the cache key.

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
- `POST /proxy`: Forwards and caches successful GraphQL responses.
- `DELETE /caches`: Purges the cache.
- `POST /hooks/purge`: Purges the cache.

For purge endpoints, pass the admin secret as either:

- `sgcrp-admin-secret` header
- `sgcrp-admin-secret` query parameter

## Contributing

Keep changes small and easy to reason about. Run tests and build before opening a PR:

```bash
npm test
npm run build
```
