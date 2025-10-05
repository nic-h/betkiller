export function getEnv(key: string, fallback?: string): string {
  const value = process.env[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required env var ${key}`);
}

export function getOptionalEnv(key: string): string | undefined {
  const value = process.env[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}
