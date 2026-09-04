import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Database-backed tests (*.db.test.ts, UNP-6) need DATABASE_URL and skip
// themselves without it. Vitest does not read .env, so lift that one
// variable from the file when the shell has not set it. Only that one: the
// rest of .env stays out of the test process.
function databaseUrlFromEnvFile(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = path.resolve(__dirname, ".env");
  if (!fs.existsSync(file)) return undefined;
  const line = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) return undefined;
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts"],
    environment: "node",
    env: { DATABASE_URL: databaseUrlFromEnvFile() ?? "" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
