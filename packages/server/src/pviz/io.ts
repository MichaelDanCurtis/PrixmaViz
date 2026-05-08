import { readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Diagram, LibraryEntry, PvizFile } from "@prixmaviz/shared";
import { PVIZ_VERSION } from "@prixmaviz/shared";
import { resolveSlug, slugify } from "./slug";

export interface WriteResult {
  path: string;
  slug: string;
}

export async function writePviz(
  dir: string,
  diagram: Diagram,
  svg: string,
): Promise<WriteResult> {
  await mkdir(dir, { recursive: true });
  const taken = await collectSlugs(dir);
  const baseSlug = slugify(diagram.name);
  const slug = resolveSlug(baseSlug, taken);
  const path = join(dir, `${slug}.pviz`);
  const svgPath = join(dir, `${slug}.svg`);

  const file: PvizFile = {
    version: PVIZ_VERSION,
    id: diagram.id,
    name: diagram.name,
    engine: diagram.engine,
    kind: diagram.kind,
    ir: diagram.ir,
    dsl: diagram.dsl,
    meta: diagram.meta,
    annotations: diagram.annotations,
  };
  await Bun.write(path, JSON.stringify(file, null, 2));
  await Bun.write(svgPath, svg);
  return { path, slug };
}

export async function readPviz(path: string): Promise<PvizFile> {
  const raw = await Bun.file(path).text();
  const parsed = JSON.parse(raw) as PvizFile;
  if (parsed.version !== PVIZ_VERSION) {
    throw new Error(`unsupported .pviz version ${parsed.version}`);
  }
  return parsed;
}

export async function listPvizEntries(dir: string): Promise<LibraryEntry[]> {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const entries: LibraryEntry[] = [];
  for (const n of names) {
    if (extname(n) !== ".pviz") continue;
    try {
      const path = join(dir, n);
      const file = await readPviz(path);
      entries.push({
        name: file.name,
        path,
        engine: file.engine,
        kind: file.kind,
        tags: file.meta.tags,
        createdAt: file.meta.createdAt,
        updatedAt: file.meta.updatedAt,
      });
    } catch {
      continue;
    }
  }
  entries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return entries;
}

async function collectSlugs(dir: string): Promise<Set<string>> {
  if (!existsSync(dir)) return new Set();
  const names = await readdir(dir);
  return new Set(
    names
      .filter((n) => extname(n) === ".pviz")
      .map((n) => basename(n, ".pviz")),
  );
}
