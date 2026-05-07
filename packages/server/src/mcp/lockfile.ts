import { existsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";

export interface InstanceLock {
  pid: number;
  port: number;
  startedAt: string;
}

export function writeLock(path: string, port: number): InstanceLock {
  const lock: InstanceLock = {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(lock, null, 2));
  return lock;
}

export function readLock(path: string): InstanceLock | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as InstanceLock;
  } catch {
    return null;
  }
}

export function clearLock(path: string): void {
  try { unlinkSync(path); } catch {}
}

export async function isLockAlive(lock: InstanceLock): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${lock.port}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok;
  } catch {
    return false;
  }
}
