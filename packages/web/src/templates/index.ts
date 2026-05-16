import type { DiagramEngine } from "@prixmaviz/shared";

/**
 * Starter templates shown in the first-run gallery (when a workspace has no
 * tiles). Each template is a tiny inline DSL string that demonstrates one
 * engine. Templates are intentionally short — agents/users will iterate them
 * once on the canvas.
 *
 * Implementation notes:
 *  - `engine` is the engine slug the server's `/api/render-dsl` route hands
 *    off to (Kroki for most; Mermaid is bundled). `inferKind(engine)` decides
 *    whether the new diagram is a `graph` or `passthrough` — for these
 *    inline-DSL templates the server creates a `passthrough` diagram (the
 *    `kind` field flips to "passthrough" inside renderDslRoute).
 *  - Keep these compact: a great first-run experience renders fast, and the
 *    DSL doubles as a quick lesson on each engine's syntax.
 */
export interface StarterTemplate {
  slug: string;
  name: string;
  description: string;
  engine: DiagramEngine;
  source: string;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    slug: "flowchart",
    name: "Flowchart",
    description: "Decision tree with branches",
    engine: "mermaid",
    source: `flowchart LR
  A[Start] --> B{Logged in?}
  B -- Yes --> C[Show dashboard]
  B -- No  --> D[Show login]
  C --> E([Done])
  D --> E
`,
  },
  {
    slug: "sequence",
    name: "Sequence diagram",
    description: "Actors exchanging messages over time",
    engine: "mermaid",
    source: `sequenceDiagram
  participant U as User
  participant W as Web
  participant A as Auth
  participant D as DB
  U->>W: GET /dashboard
  W->>A: validate session
  A-->>W: ok
  W->>D: load user data
  D-->>W: rows
  W-->>U: 200 OK
`,
  },
  {
    slug: "er-diagram",
    name: "ER diagram",
    description: "Entities and their relationships",
    engine: "mermaid",
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER    ||--|{ LINE_ITEM : contains
  PRODUCT  ||--o{ LINE_ITEM : "ordered as"
  CUSTOMER {
    string name
    string email
  }
  ORDER {
    int id
    date placed_at
  }
`,
  },
  {
    slug: "class-diagram",
    name: "Class diagram",
    description: "Object model with inheritance",
    engine: "mermaid",
    source: `classDiagram
  class Animal {
    +String name
    +int age
    +eat()
  }
  class Dog {
    +String breed
    +bark()
  }
  class Cat {
    +bool indoor
    +purr()
  }
  Animal <|-- Dog
  Animal <|-- Cat
`,
  },
  {
    slug: "state-machine",
    name: "State machine",
    description: "Finite states and transitions",
    engine: "mermaid",
    source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Loading: fetch()
  Loading --> Ready: success
  Loading --> Error: failure
  Ready --> Idle: reset
  Error --> Idle: retry
  Ready --> [*]
`,
  },
  {
    slug: "mind-map",
    name: "Mind map",
    description: "Branching idea tree",
    engine: "mermaid",
    source: `mindmap
  root((PrixmaViz))
    Engines
      Mermaid
      Graphviz
      D2
      Bytefield
    Surfaces
      Web canvas
      MCP tools
      Plugin
    Outputs
      SVG
      PNG
      VSDX
`,
  },
  {
    slug: "gantt",
    name: "Gantt chart",
    description: "Timeline with overlapping tasks",
    engine: "mermaid",
    source: `gantt
  title Sprint plan
  dateFormat YYYY-MM-DD
  section Design
  Wireframes :a1, 2026-01-05, 4d
  Visual pass :a2, after a1, 3d
  section Build
  Backend :b1, 2026-01-09, 5d
  Frontend :b2, after a2, 5d
  section Ship
  QA :c1, after b1, 3d
  Release :milestone, after c1, 0d
`,
  },
  {
    slug: "architecture",
    name: "Architecture (Graphviz)",
    description: "Service-dependency graph",
    engine: "graphviz",
    source: `digraph G {
  rankdir=LR;
  node [shape=box, style="rounded,filled", fillcolor="#f5f5f7", fontname="Helvetica"];

  Web    [label="Web app"];
  API    [label="API server"];
  Auth   [label="Auth"];
  DB     [label="Postgres", shape=cylinder];
  Cache  [label="Redis",    shape=cylinder];
  Queue  [label="Worker queue", shape=cylinder];

  Web -> API;
  API -> Auth;
  API -> DB;
  API -> Cache;
  API -> Queue;
}
`,
  },
];
