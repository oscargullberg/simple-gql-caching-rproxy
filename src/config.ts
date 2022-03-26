export const FORWARD_URL = process.env.SGCRP_FORWARD_URL;
export const PORT = process.env.SGCRP_PORT || 8080;
export const CACHE_TTL_SECONDS = (process.env.SGCRP_CACHE_TTL_SECONDS ??
  120) as number;
export const VARY_HEADERS = process.env.SGCRP_VARY_HEADERS || "";
export const ADMIN_SECRET = process.env.SGCRP_ADMIN_SECRET;
