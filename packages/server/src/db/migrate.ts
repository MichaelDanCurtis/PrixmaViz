import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface RunMigrationsOptions {
  /**
   * Postgres schema to create (if missing) and route all migrations into.
   * When set, every connection used by this call has `search_path` bound
   * to the schema. Useful for isolating test runs that share one database.
   * When omitted, migrations run against the default `search_path`
   * (typically `public`).
   */
  searchPath?: string;
}

export async function runMigrations(
  databaseUrl: string,
  migrationsDir: string,
  opts: RunMigrationsOptions = {},
): Promise<void> {
  const sql = postgres(databaseUrl, {
    onnotice: () => {},
    ...(opts.searchPath ? { connection: { search_path: opts.searchPath } } : {}),
  });
  try {
    if (opts.searchPath) {
      await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${opts.searchPath}"`);
    }
    // Ensure schema_migrations exists (idempotent)
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const filename of files) {
      const applied = await sql`
        SELECT 1 FROM schema_migrations WHERE filename = ${filename}
      `;
      if (applied.length > 0) continue;
      const content = await readFile(join(migrationsDir, filename), "utf-8");
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO schema_migrations (filename) VALUES (${filename})`;
      });
      console.error(`migration applied: ${filename}`);
    }
  } finally {
    await sql.end();
  }
}
