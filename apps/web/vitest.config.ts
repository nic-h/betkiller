import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(async () => {
  const { default: tsconfigPaths } = await import("vite-tsconfig-paths");
  return {
    plugins: [tsconfigPaths()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    test: {
      globals: true,
      environment: "node",
      setupFiles: ["./tests/setup.ts"],
      include: ["tests/**/*.test.ts"]
    }
  };
});
