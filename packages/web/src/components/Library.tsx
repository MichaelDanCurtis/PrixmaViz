import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store";
import { api } from "../lib/api";
import { basename } from "../lib/path";
import type { LibraryEntry } from "@prixmaviz/shared";

export function Library() {
  const library = useAppStore((s) => s.library);
  const diagram = useAppStore((s) => s.diagram);
  const setLibrary = useAppStore((s) => s.setLibrary);
  const setDiagram = useAppStore((s) => s.setDiagram);
  const setRender = useAppStore((s) => s.setRender);
  const setError = useAppStore((s) => s.setError);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.library().then(setLibrary).catch((e) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, [setLibrary, setError]);

  const filtered = useMemo(() => {
    if (!search) return library;
    const q = search.toLowerCase();
    return library.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [library, search]);

  async function open(entry: LibraryEntry) {
    try {
      const slug = basename(entry.path).replace(/\.pviz$/, "");
      const result = await api.loadBySlug(slug);
      setDiagram({
        id: result.diagramId,
        name: entry.name,
        engine: entry.engine,
        kind: entry.kind,
        ir: result.ir,
        dsl: result.dsl,
        meta: {
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          tags: entry.tags,
          sourcePaths: [],
        },
      });
      setRender(result.diagramId, result.render.svg, result.render.dsl, result.ir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <aside className="library">
      <div className="library-header">
        <div className="library-title">Library</div>
      </div>
      <div className="library-search">
        <input
          placeholder="Search diagrams…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="library-count">
        {filtered.length} diagram{filtered.length === 1 ? "" : "s"}
      </div>
      <div className="library-list">
        {filtered.map((entry) => {
          const slug = basename(entry.path).replace(/\.pviz$/, "");
          const active = diagram?.name === entry.name;
          return (
            <div
              key={entry.path}
              className={`library-item ${active ? "active" : ""}`}
              onClick={() => open(entry)}
            >
              <div className="library-thumb">
                <img src={`/api/library/${encodeURIComponent(slug)}/thumb`} alt="" />
              </div>
              <div className="library-name">{entry.name}</div>
              <div className="library-meta">
                {entry.engine} · {relativeTime(entry.updatedAt)}
              </div>
              {entry.tags.length > 0 && (
                <div className="library-tags">
                  {entry.tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
