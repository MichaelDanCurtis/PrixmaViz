import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface GetDbOptions {
  /**
   * Postgres schema to bind as `search_path` on every connection.
   * When set, all unqualified table references in queries route through
   * this schema. Used by the test suite to isolate parallel test files
   * sharing one database; production callers omit it.
   */
  searchPath?: string;
}

let instance: Sql | null = null;
let configuredUrl: string | null = null;
let configuredSearchPath: string | null = null;

export function getDb(databaseUrl: string, opts: GetDbOptions = {}): Sql {
  const sp = opts.searchPath ?? null;
  if (instance && configuredUrl === databaseUrl && configuredSearchPath === sp) return instance;
  if (instance) {
    // fire-and-forget; keep getDb sync. drain in background.
    instance.end({ timeout: 5 }).catch(() => {});
    instance = null;
  }
  instance = postgres(databaseUrl, {
    onnotice: () => {},
    max: 10,
    idle_timeout: 60,
    ...(sp ? { connection: { search_path: sp } } : {}),
  });
  configuredUrl = databaseUrl;
  configuredSearchPath = sp;
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.end();
    instance = null;
    configuredUrl = null;
    configuredSearchPath = null;
  }
}
