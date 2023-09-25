# Simple GraphQL Caching Reverse Proxy

## Overview

This project provides a simple caching reverse proxy for GraphQL APIs. It is built using Fastify, NodeCache, and Undici.

## Requirements

- Node.js >= 20.6.0

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
- `SGCRP_VARY_HEADERS`: Comma-separated list of headers that should be varied in the cache.

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

- `POST /proxy`: Forwards and caches GraphQL requests.
- `DELETE /caches` and `POST /hooks/purge` : Purges the cache (Admin only).

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
