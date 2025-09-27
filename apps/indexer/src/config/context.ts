export const CONTEXT_ADDRESSES = (process.env.CONTEXT_ADDRESSES || "")
  .split(",")
  .map((address) => address.trim().toLowerCase())
  .filter(Boolean);

export const CONTEXT_API = process.env.CONTEXT_API || "/api/context";
export const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 14);
