import { parseVaryHeaders } from "./cache";

const DEFAULT_PORT = 8080;
const DEFAULT_CACHE_TTL_SECONDS = 120;
const DEFAULT_CACHE_MAX_ENTRIES = 5_000;
const DEFAULT_CACHE_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_REQUEST_BODY_MAX_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type AppConfig = {
  adminSecret: string;
  cacheMaxBytes?: number;
  cacheMaxEntries: number;
  cacheTtlSeconds: number;
  enableLogging?: boolean;
  forwardUrl: URL;
  maxResponseBytes?: number;
  port: number;
  requestBodyMaxBytes?: number;
  requestTimeoutMs: number;
  varyHeaders: string[];
};

const parsePositiveInteger = (
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
): number => {
  const rawValue = env[name];
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  if (!env.SGCRP_FORWARD_URL?.trim()) {
    throw new Error("SGCRP_FORWARD_URL is required.");
  }

  if (!env.SGCRP_ADMIN_SECRET?.trim()) {
    throw new Error("SGCRP_ADMIN_SECRET is required.");
  }

  const forwardUrl = new URL(env.SGCRP_FORWARD_URL);
  if (!["http:", "https:"].includes(forwardUrl.protocol)) {
    throw new Error("SGCRP_FORWARD_URL must use http or https.");
  }
  return {
    adminSecret: env.SGCRP_ADMIN_SECRET,
    cacheMaxBytes: parsePositiveInteger(
      env,
      "SGCRP_CACHE_MAX_BYTES",
      DEFAULT_CACHE_MAX_BYTES,
    ),
    cacheMaxEntries: parsePositiveInteger(
      env,
      "SGCRP_CACHE_MAX_ENTRIES",
      DEFAULT_CACHE_MAX_ENTRIES,
    ),
    cacheTtlSeconds: parsePositiveInteger(
      env,
      "SGCRP_CACHE_TTL_SECONDS",
      DEFAULT_CACHE_TTL_SECONDS,
    ),
    enableLogging: true,
    forwardUrl,
    maxResponseBytes: parsePositiveInteger(
      env,
      "SGCRP_MAX_RESPONSE_BYTES",
      DEFAULT_MAX_RESPONSE_BYTES,
    ),
    port: parsePositiveInteger(env, "SGCRP_PORT", DEFAULT_PORT),
    requestBodyMaxBytes: parsePositiveInteger(
      env,
      "SGCRP_REQUEST_BODY_MAX_BYTES",
      DEFAULT_REQUEST_BODY_MAX_BYTES,
    ),
    requestTimeoutMs: parsePositiveInteger(
      env,
      "SGCRP_REQUEST_TIMEOUT_MS",
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    varyHeaders: parseVaryHeaders(env.SGCRP_VARY_HEADERS ?? ""),
  };
};
