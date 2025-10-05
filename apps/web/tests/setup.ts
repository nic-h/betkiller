import path from "node:path";
import fs from "node:fs";

const fixturePath = path.resolve(process.cwd(), "tests/fixtures/context.test.sqlite");

if (fs.existsSync(fixturePath)) {
  process.env.DB_PATH = fixturePath;
  process.env.NODE_ENV = "test";
  console.log("[vitest] DB_PATH =", process.env.DB_PATH);
} else {
  console.warn("[vitest] fixture DB not found:", fixturePath, "— using default DB_PATH");
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
}
