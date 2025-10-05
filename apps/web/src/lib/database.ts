import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import fs from "fs";
import path from "path";

const DEFAULT_DB_PATH =
  process.env.SQLITE_PATH ??
  process.env.BK_DB ??
  process.env.DATABASE_PATH ??
  path.resolve(process.cwd(), "../../data/context.db");

let singleton: BetterSqliteDatabase | null = null;
let resolvedPath: string | null = null;

export function resolveDatabasePath(): string {
  if (resolvedPath) return resolvedPath;
  const candidate = DEFAULT_DB_PATH;
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
  const directory = path.dirname(absolute);
  if (!fs.existsSync(directory)) {
    throw new Error(`Database directory missing: ${directory}`);
  }
  if (!fs.existsSync(absolute)) {
    throw new Error(`SQLite database not found at ${absolute}. Run the indexer or update SQLITE_PATH.`);
  }
  resolvedPath = absolute;
  return resolvedPath;
}

export function getDatabase(): BetterSqliteDatabase {
  if (singleton) return singleton;
  const dbPath = resolveDatabasePath();
  singleton = new Database(dbPath, { readonly: true, fileMustExist: true });
  return singleton;
}

export function withDatabase<T>(fn: (db: BetterSqliteDatabase) => T): T {
  const db = getDatabase();
  return fn(db);
}

export function resetDatabaseConnection() {
  if (singleton) {
    try {
      singleton.close();
    } catch (error) {
      // ignore close failures
    }
  }
  singleton = null;
  resolvedPath = null;
}

export function toMicroNumber(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0n;
    try {
      return BigInt(trimmed);
    } catch (error) {
      return 0n;
    }
  }
  if (Array.isArray(value)) {
    return value.reduce<bigint>((total, entry) => total + toMicroNumber(entry), 0n);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    let total = 0n;
    for (const key of Object.keys(obj)) {
      total += toMicroNumber(obj[key]);
    }
    return total;
  }
  return 0n;
}
