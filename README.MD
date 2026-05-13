# Simple GraphQL Caching Reverse Proxy

## Overview

This project provides a simple in-memory caching reverse proxy for GraphQL APIs. It is built with Fastify, native Node.js `fetch`, and a bounded TTL cache keyed with xxh3-128.

## Requirements

- Node.js >=24

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env` file in the root directory and set the following variables:

- `SGCRP_FORWARD_URL`: URL of the GraphQL server to forward requests to (Required).
- `SGCRP_ADMIN_SECRET`: Admin secret key for privileged operations like cache purging (Required).
- `SGCRP_PORT`: Port on which the proxy server will run. Default is 8080.
- `SGCRP_CACHE_TTL_SECONDS`: Time-to-live for cache in seconds. Default is 120.
- `SGCRP_CACHE_MAX_ENTRIES`: Maximum number of cached responses kept in memory. Default is 5000.
- `SGCRP_REQUEST_TIMEOUT_MS`: Timeout for upstream GraphQL requests in milliseconds. Default is 30000.
- `SGCRP_VARY_HEADERS`: Comma-separated list of request headers that should be included in the cache key.

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

- `POST /proxy`: Forwards and caches successful GraphQL responses.
- `DELETE /caches` and `POST /hooks/purge`: Purges the cache. Pass the admin secret using the `sgcrp-admin-secret` header or `sgcrp-admin-secret` query parameter.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
