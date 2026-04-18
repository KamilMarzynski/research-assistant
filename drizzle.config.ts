// drizzle.config.ts is used ONLY for `bun run db:generate` (schema introspection during dev).
// It is NOT used at runtime. Migrations are applied inline via src/main/db/migrate.ts.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/main/db/schema.ts",
  out: "./src/main/db/migrations",
  dialect: "turso",
  dbCredentials: {
    url: "file:./dev.db",
  },
});
