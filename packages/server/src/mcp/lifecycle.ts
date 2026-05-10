import { existsSync } from "node:fs";

export interface AppRunningResult {
  running: boolean;
  port: number | null;
}

export function lockfilePath(stateDir: string): string {
  // Note: must match the path used by writeLock callers in index.ts and mcp/server.ts.
  return `${stateDir}/instance.json`;
}

export async function isAppRunning(path: string): Promise<AppRunningResult> {
  if (!existsSync(path)) return { running: false, port: null };
  try {
    const txt = await Bun.file(path).text();
    const data = JSON.parse(txt) as { pid?: number; port?: number; startedAt?: string };
    if (typeof data.port !== "number") return { running: false, port: null };
    return { running: true, port: data.port };
  } catch {
    return { running: false, port: null };
  }
}

export async function launchApp(appBundlePath: string): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      const proc = Bun.spawn(["open", "-a", appBundlePath], { stdout: "ignore", stderr: "ignore" });
      const code = await proc.exited;
      return code === 0;
    }
    if (process.platform === "linux") {
      Bun.spawn([appBundlePath], { stdout: "ignore", stderr: "ignore" });
      return true;
    }
    if (process.platform === "win32") {
      const proc = Bun.spawn(["cmd", "/c", "start", "", appBundlePath], { stdout: "ignore", stderr: "ignore" });
      const code = await proc.exited;
      return code === 0;
    }
    return false;
  } catch {
    return false;
  }
}
