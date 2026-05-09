import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface PrixmaPaths {
  projectRoot: string;
  prixmaDir: string;
  diagramsDir: string;
  cacheDir: string;
  stateDir: string;
  configFile: string;
  workspaceFile: string;
}

export function resolvePaths(projectRoot: string): PrixmaPaths {
  const root = resolve(projectRoot);
  const prixmaDir = join(root, ".prixmaviz");
  return {
    projectRoot: root,
    prixmaDir,
    diagramsDir: join(prixmaDir, "diagrams"),
    cacheDir: join(prixmaDir, "cache"),
    stateDir: join(prixmaDir, "state"),
    configFile: join(prixmaDir, "config.json"),
    workspaceFile: join(prixmaDir, "workspace.json"),
  };
}

export function ensureDirs(paths: PrixmaPaths): void {
  for (const d of [paths.prixmaDir, paths.diagramsDir, paths.cacheDir, paths.stateDir]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}
