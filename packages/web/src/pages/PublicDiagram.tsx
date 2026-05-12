import { useEffect, useState } from "react";

interface PublicDiagramData {
  id: string;
  name: string;
  engine: string;
  kind: string;
  svg?: string;
  dsl?: string;
}

export function PublicDiagram({ diagramId }: { diagramId: string }) {
  const [data, setData] = useState<PublicDiagramData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/diagrams/${encodeURIComponent(diagramId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [diagramId]);

  if (error) return <div className="public-error">Diagram not found.</div>;
  if (!data) return <div className="public-loading">Loading…</div>;

  return (
    <div className="public-diagram">
      <header className="public-header">
        <h1>{data.name}</h1>
        <span className="public-engine">{data.engine}</span>
      </header>
      <div className="public-svg" dangerouslySetInnerHTML={{ __html: data.svg ?? "" }} />
      <footer className="public-footer">
        <a href="https://prixmaviz.alexis.com">Made with PrixmaViz</a>
      </footer>
    </div>
  );
}
