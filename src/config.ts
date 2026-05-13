import { parseVaryHeaders } from "./cache";

const DEFAULT_PORT = 8080;
const DEFAULT_CACHE_TTL_SECONDS = 120;
const DEFAULT_CACHE_MAX_ENTRIES = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type AppConfig = {
  adminSecret: string;
  cacheMaxEntries: number;
  cacheTtlSeconds: number;
  forwardUrl: URL;
  port: number;
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
  if (!env.SGCRP_FORWARD_URL) {
    throw new Error("SGCRP_FORWARD_URL is required.");
  }

  if (!env.SGCRP_ADMIN_SECRET) {
    throw new Error("SGCRP_ADMIN_SECRET is required.");
  }

  return {
    adminSecret: env.SGCRP_ADMIN_SECRET,
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
    forwardUrl: new URL(env.SGCRP_FORWARD_URL),
    port: parsePositiveInteger(env, "SGCRP_PORT", DEFAULT_PORT),
    requestTimeoutMs: parsePositiveInteger(
      env,
      "SGCRP_REQUEST_TIMEOUT_MS",
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    varyHeaders: parseVaryHeaders(env.SGCRP_VARY_HEADERS ?? ""),
  };
};
