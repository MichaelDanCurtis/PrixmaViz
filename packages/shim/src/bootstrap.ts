import { readFile, mkdir, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

export function workspaceConfigPath(): string {
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

  // Persist — use atomic exclusive-create to avoid a race where two shim
  // processes concurrently bootstrap and clobber each other's cache file.
  // The mint POST above cannot be undone; if we lose the race, our freshly
  // minted UUID becomes an unused orphan workspace on the server (harmless,
  // just unreferenced).
  await mkdir(dirname(cfgPath), { recursive: true });

  try {
    const fh = await open(cfgPath, "wx");
    try {
      await fh.writeFile(data.id, "utf-8");
    } finally {
      await fh.close();
    }
    console.error(`prixmaviz: workspace ${data.id} — view at ${remoteUrl}/w/${data.id}`);
    return data.id;
  } catch (e: any) {
    if (e.code === "EEXIST") {
      // Another shim instance won the bootstrap race; use their UUID instead.
      // Our freshly-minted UUID becomes an unused orphan on the server (harmless).
      const peer = (await readFile(cfgPath, "utf-8")).trim();
      console.error(`prixmaviz: lost bootstrap race, using peer workspace ${peer}`);
      return peer;
    }
    throw e;
  }
}
