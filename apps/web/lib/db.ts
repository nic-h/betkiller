import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import fs from "fs";
import path from "path";

function resolveDatabasePath() {
  const raw = process.env.DATABASE_PATH ?? "../../data/context-edge.db";
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

let singleton: BetterSqliteDatabase | null = null;

export function getDatabase(): BetterSqliteDatabase {
  if (singleton) {
    return singleton;
  }

  const dbPath = resolveDatabasePath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    throw new Error(`Database directory missing: ${dir}`);
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found at ${dbPath}. Did the indexer run yet?`);
  }

  singleton = new Database(dbPath, { readonly: true, fileMustExist: true });
  return singleton;
}
