export interface NodeIdDiff {
  added: string[];
  removed: string[];
  kept: string[];
}

export function diffSvgNodeIds(prev: string[], next: string[]): NodeIdDiff {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: next.filter((id) => !prevSet.has(id)),
    removed: prev.filter((id) => !nextSet.has(id)),
    kept: next.filter((id) => prevSet.has(id)),
  };
}

export function parseSvgNodes(svg: string): string[] {
  const ids: string[] = [];
  const re = /<g[^>]*\sid="(flowchart-[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) ids.push(m[1]!);
  return ids;
}
