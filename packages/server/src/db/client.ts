import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

let instance: Sql | null = null;
let configuredUrl: string | null = null;

export function getDb(databaseUrl: string): Sql {
  if (instance && configuredUrl === databaseUrl) return instance;
  if (instance) {
    instance.end({ timeout: 5 });
    instance = null;
  }
  instance = postgres(databaseUrl, {
    onnotice: () => {},
    max: 10,
    idle_timeout: 60,
  });
  configuredUrl = databaseUrl;
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.end();
    instance = null;
    configuredUrl = null;
  }
}
