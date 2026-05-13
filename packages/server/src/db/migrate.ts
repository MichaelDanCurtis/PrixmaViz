import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function runMigrations(databaseUrl: string, migrationsDir: string): Promise<void> {
  const sql = postgres(databaseUrl, { onnotice: () => {} });
  try {
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
