import { existsSync } from "node:fs";

export interface PrixmaSettings {
  krokiUrl: string;
}

export function defaultSettings(): PrixmaSettings {
  return { krokiUrl: "https://kroki.io" };
}

export async function readSettings(path: string): Promise<PrixmaSettings> {
  if (!existsSync(path)) return defaultSettings();
  try {
    const txt = await Bun.file(path).text();
    const parsed = JSON.parse(txt) as Partial<PrixmaSettings>;
    return { ...defaultSettings(), ...parsed };
  } catch {
    return defaultSettings();
  }
}

export async function writeSettings(path: string, settings: PrixmaSettings): Promise<void> {
  await Bun.write(path, JSON.stringify(settings, null, 2));
}
