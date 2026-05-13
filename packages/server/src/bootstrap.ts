export interface PrixmaConfig {
  databaseUrl: string;
  krokiUrl: string;
  publicUrl: string;
  bindHost: string;
  bindPort: number;
  webDist: string;
  migrationsDir: string;
}

export function loadConfig(): PrixmaConfig {
  const env = process.env;
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return {
    databaseUrl: env.DATABASE_URL,
    krokiUrl: env.KROKI_URL ?? "http://localhost:8000",
    publicUrl: env.PRIXMAVIZ_PUBLIC_URL ?? "http://localhost:5180",
    bindHost: env.PRIXMAVIZ_BIND_HOST ?? "0.0.0.0",
    bindPort: parseInt(env.PRIXMAVIZ_BIND_PORT ?? "5180", 10),
    webDist: env.PRIXMAVIZ_WEB_DIST ?? "packages/web/dist",
    migrationsDir: env.PRIXMAVIZ_MIGRATIONS_DIR ?? "packages/server/migrations",
  };
}
