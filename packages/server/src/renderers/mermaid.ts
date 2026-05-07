import type { Edge, GraphIR, Node, NodeShape } from "@prixmaviz/shared";

export interface RenderOutput {
  dsl: string;
  warnings: string[];
}

const SHAPE_BRACKETS: Record<NodeShape, [string, string]> = {
  rect: ["[", "]"],
  round: ["(", ")"],
  circle: ["((", "))"],
  diamond: ["{", "}"],
  hex: ["{{", "}}"],
  cyl: ["[(", ")]"],
};

export function irToMermaid(ir: GraphIR): RenderOutput {
  const warnings: string[] = [];
  const lines: string[] = [`flowchart ${ir.layout.direction}`];

  const groupedNodeIds = new Set<string>();

  for (const g of Object.values(ir.groups)) {
    lines.push(`  subgraph ${g.id}[${escapeText(g.label)}]`);
    for (const nid of g.members) {
      const node = ir.nodes[nid];
      if (node) {
        lines.push(`    ${emitNode(node, warnings)}`);
        groupedNodeIds.add(nid);
      }
    }
    lines.push("  end");
  }

  for (const node of Object.values(ir.nodes)) {
    if (!groupedNodeIds.has(node.id)) lines.push(`  ${emitNode(node, warnings)}`);
  }

  for (const edge of Object.values(ir.edges)) {
    lines.push(`  ${emitEdge(edge)}`);
  }

  return { dsl: lines.join("\n"), warnings };
}

function emitNode(node: Node, warnings: string[]): string {
  const shape: NodeShape = node.shape ?? "rect";
  const brackets = SHAPE_BRACKETS[shape];
  if (!brackets) {
    warnings.push(`shape "${node.shape}" not supported, fell back to rect`);
    const [open, close] = SHAPE_BRACKETS.rect;
    return `${node.id}${open}${labelText(node.label)}${close}`;
  }
  const [open, close] = brackets;
  return `${node.id}${open}${labelText(node.label)}${close}`;
}

function emitEdge(edge: Edge): string {
  const op = edgeOp(edge.kind ?? "solid", edge.arrow ?? "normal");
  const label = edge.label ? `|${escapeText(edge.label)}|` : "";
  return `${edge.from} ${op}${label} ${edge.to}`;
}

function edgeOp(kind: string, arrow: string): string {
  const head = arrow === "none" ? "" : arrow === "open" ? "-" : ">";
  switch (kind) {
    case "dashed":
      return `-.-${head}`;
    case "dotted":
      return `-.-${head}`;
    case "thick":
      return `==${head}`;
    case "solid":
    default:
      return `--${head}`;
  }
}

function labelText(s: string): string {
  if (/[\[\](){}|"]/.test(s)) return `"${escapeText(s)}"`;
  return escapeText(s);
}

function escapeText(s: string): string {
  return s.replace(/"/g, '\\"');
}
