import { existsSync } from "node:fs";
import { defaultWorkspace, type WorkspaceState, WORKSPACE_VERSION } from "@prixmaviz/shared";

export async function readWorkspace(path: string): Promise<WorkspaceState> {
  if (!existsSync(path)) return defaultWorkspace();
  try {
    const txt = await Bun.file(path).text();
    const parsed = JSON.parse(txt) as WorkspaceState;
    if (parsed.version !== WORKSPACE_VERSION) return defaultWorkspace();
    return parsed;
  } catch {
    return defaultWorkspace();
  }
}

export async function writeWorkspace(path: string, state: WorkspaceState): Promise<void> {
  await Bun.write(path, JSON.stringify(state, null, 2));
}
