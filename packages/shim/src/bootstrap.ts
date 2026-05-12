import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

function workspaceConfigPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) throw new Error("cannot resolve home directory");
  if (process.platform === "darwin") {
    return join(home, "Library/Application Support/PrixmaViz/workspace.txt");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? home, "PrixmaViz/workspace.txt");
  }
  return join(home, ".config/prixmaviz/workspace.txt");
}

export async function resolveWorkspaceId(remoteUrl: string): Promise<string> {
  if (process.env.PRIXMAVIZ_WORKSPACE) return process.env.PRIXMAVIZ_WORKSPACE;

  const cfgPath = workspaceConfigPath();
  if (existsSync(cfgPath)) {
    const cached = (await readFile(cfgPath, "utf-8")).trim();
    if (cached) return cached;
  }

  // Bootstrap a new workspace
  const resp = await fetch(`${remoteUrl.replace(/\/$/, "")}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`failed to bootstrap workspace at ${remoteUrl}: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { id?: string };
  if (!data.id) throw new Error(`workspace bootstrap returned no id`);

  // Persist
  await mkdir(join(cfgPath, ".."), { recursive: true });
  await writeFile(cfgPath, data.id, "utf-8");
  console.error(`prixmaviz: workspace ${data.id} — view at ${remoteUrl}/w/${data.id}`);
  return data.id;
}
