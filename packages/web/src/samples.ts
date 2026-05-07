import type { DiagramEngine } from "@prixmaviz/shared";

export const SAMPLES: Record<DiagramEngine, string> = {
  mermaid: `flowchart LR
  Agent[AI Agent] -->|render| Shim[Bun Shim]
  Shim -->|HTTP| Kroki[(Kroki)]
  Kroki -->|SVG| Shim
  Shim -->|WS| UI[React + Motion]
  UI -.->|annotations| Shim
  Shim -.->|context| Agent`,

  plantuml: `@startuml
actor Agent
component Shim
database Kroki
component UI
Agent -> Shim : render
Shim -> Kroki : HTTP
Kroki -> Shim : SVG
Shim -> UI : WS
UI --> Shim : annotations
@enduml`,

  graphviz: `digraph G {
  rankdir=LR;
  node [shape=box, style=rounded];
  Agent -> Shim [label="render"];
  Shim -> Kroki [label="HTTP"];
  Kroki -> Shim [label="SVG"];
  Shim -> UI [label="WS"];
  UI -> Shim [label="annotations", style=dashed];
}`,

  d2: `agent: AI Agent
shim: Bun Shim
kroki: Kroki
ui: React + Motion
agent -> shim: render
shim -> kroki: HTTP
kroki -> shim: SVG
shim -> ui: WS
ui -> shim: annotations`,

  c4plantuml: `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
Person(user, "User")
System_Boundary(s, "PrixmaViz") {
  Container(agent, "Agent", "CC/Codex")
  Container(shim, "Shim", "Bun")
  Container(ui, "UI", "React")
}
System_Ext(kroki, "Kroki")
Rel(user, ui, "annotates")
Rel(agent, shim, "MCP")
Rel(shim, kroki, "HTTP")
Rel(shim, ui, "WS")
@enduml`,

  structurizr: `workspace {
  model {
    user = person "User"
    sys = softwareSystem "PrixmaViz" {
      agent = container "Agent"
      shim = container "Shim"
      ui = container "UI"
    }
    kroki = softwareSystem "Kroki" "external"
    user -> ui "annotates"
    agent -> shim "MCP"
    shim -> kroki "HTTP"
    shim -> ui "WS"
  }
  views {
    container sys { include * autolayout lr }
    theme default
  }
}`,

  excalidraw: `{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {"type":"rectangle","x":0,"y":0,"width":120,"height":60,"strokeColor":"#1971c2"},
    {"type":"rectangle","x":200,"y":0,"width":120,"height":60,"strokeColor":"#2f9e44"}
  ]
}`,

  bpmn: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs" targetNamespace="http://kroki.io">
  <bpmn:process id="P" isExecutable="false">
    <bpmn:startEvent id="s"/>
    <bpmn:task id="t" name="Render"/>
    <bpmn:endEvent id="e"/>
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="t"/>
    <bpmn:sequenceFlow id="f2" sourceRef="t" targetRef="e"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="d">
    <bpmndi:BPMNPlane id="pl" bpmnElement="P">
      <bpmndi:BPMNShape id="ss" bpmnElement="s"><dc:Bounds x="40" y="40" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="ts" bpmnElement="t"><dc:Bounds x="140" y="30" width="100" height="56"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="es" bpmnElement="e"><dc:Bounds x="300" y="40" width="36" height="36"/></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`,

  erd: `[Agent]
*id
name

[Diagram]
*id
+agent_id
source
engine

Agent 1--* Diagram`,

  dbml: `Table users {
  id integer [primary key]
  email varchar [unique]
  created_at timestamp
}

Table diagrams {
  id integer [primary key]
  user_id integer [ref: > users.id]
  engine varchar
  source text
}`,

  nomnoml: `[Agent] -> [Shim]
[Shim] -> [Kroki]
[Kroki] -> [Shim]
[Shim] -> [UI]
[UI] --> [Shim]`,

  pikchr: `arrow right 200% "render" above
box "Shim" fit
arrow right 150% "HTTP" above
cylinder "Kroki" fit`,

  svgbob: ` +-------+    +------+    +-------+
 | Agent | -> | Shim | -> | Kroki |
 +-------+    +------+    +-------+
                 |
                 v
              +-----+
              | UI  |
              +-----+`,

  ditaa: `+--------+   +------+   +-------+
| Agent  |-->| Shim |-->| Kroki |
+--------+   +--+---+   +-------+
                |
                v
             +-----+
             | UI  |
             +-----+`,

  tikz: `\\begin{tikzpicture}[->,>=stealth,node distance=2.4cm,thick]
  \\node[draw,rounded corners] (a) {Agent};
  \\node[draw,rounded corners,right of=a] (s) {Shim};
  \\node[draw,rounded corners,right of=s] (k) {Kroki};
  \\node[draw,rounded corners,below of=s] (u) {UI};
  \\path (a) edge (s) (s) edge (k) (s) edge (u);
\\end{tikzpicture}`,

  vega: `{
  "$schema": "https://vega.github.io/schema/vega/v5.json",
  "width": 320, "height": 160, "padding": 5,
  "data": [{"name": "t", "values": [
    {"c":"agent","v":3},{"c":"shim","v":7},{"c":"kroki","v":5},{"c":"ui","v":4}
  ]}],
  "scales": [
    {"name":"x","type":"band","domain":{"data":"t","field":"c"},"range":"width","padding":0.2},
    {"name":"y","domain":{"data":"t","field":"v"},"range":"height"}
  ],
  "axes": [{"orient":"bottom","scale":"x"},{"orient":"left","scale":"y"}],
  "marks": [{"type":"rect","from":{"data":"t"},"encode":{"enter":{
    "x":{"scale":"x","field":"c"},"width":{"scale":"x","band":1},
    "y":{"scale":"y","field":"v"},"y2":{"scale":"y","value":0},
    "fill":{"value":"#7aa2f7"}}}}]
}`,

  vegalite: `{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"values": [
    {"x":"agent","y":3},{"x":"shim","y":7},{"x":"kroki","y":5},{"x":"ui","y":4}
  ]},
  "mark": "bar",
  "encoding": {
    "x": {"field":"x","type":"nominal"},
    "y": {"field":"y","type":"quantitative"}
  }
}`,

  wavedrom: `{ signal: [
  { name: "clk",  wave: "p......" },
  { name: "req",  wave: "0.1..0." },
  { name: "ack",  wave: "0..1.0." },
  { name: "data", wave: "x.=.=.x", data: ["A","B"] }
]}`,

  wireviz: `connectors:
  J1:
    pinlabels: [GND, 5V, TX, RX]
  J2:
    pinlabels: [GND, 5V, RX, TX]
cables:
  W1:
    wirecount: 4
    colors: [BK, RD, GN, WH]
connections:
  - - J1: [1-4]
    - W1: [1-4]
    - J2: [1, 2, 4, 3]`,

  bytefield: `(def boxes-per-row 16)
(draw-column-headers)
(draw-box "type" {:span 2})
(draw-box "len" {:span 2})
(draw-box "data" {:span 12 :borders #{:left :right :top}})`,

  blockdiag: `blockdiag {
  Agent -> Shim -> Kroki;
  Shim -> UI;
}`,

  seqdiag: `seqdiag {
  Agent -> Shim [label="render"];
  Shim -> Kroki [label="HTTP"];
  Shim <- Kroki [label="SVG"];
  Shim -> UI [label="WS"];
}`,

  actdiag: `actdiag {
  write -> convert -> image
  lane user {
    label = "User"
    write [label = "Writing source"]
    image [label = "Get diagram"]
  }
  lane Kroki {
    convert [label = "Convert"]
  }
}`,

  nwdiag: `nwdiag {
  network dmz {
    address = "10.0.0.0/24"
    web01 [address = "10.0.0.1"]
    web02 [address = "10.0.0.2"]
  }
  network internal {
    address = "10.0.1.0/24"
    web01 [address = "10.0.1.1"]
    db01  [address = "10.0.1.2"]
  }
}`,

  packetdiag: `packetdiag {
  colwidth = 32
  node_height = 72
  0-15: Source Port
  16-31: Destination Port
  32-63: Sequence Number
}`,

  rackdiag: `rackdiag {
  16U;
  1: UPS [2U];
  3: DB Server;
  4: Web Server;
  5: Web Server;
  7: Load Balancer;
  8-9: HTTP Server [2U];
}`,

  symbolator: `module example (
  input clk,
  input rst,
  input [7:0] data_in,
  output [7:0] data_out
);
endmodule`,

  umlet: `<?xml version='1.0' encoding='UTF-8'?>
<diagram program="umlet" version="14.3.0">
  <element>
    <id>UMLClass</id>
    <coordinates><x>0</x><y>0</y><w>120</w><h>60</h></coordinates>
    <panel_attributes>Agent</panel_attributes>
  </element>
</diagram>`,

  diagramsnet: `<mxfile host="Kroki">
  <diagram id="d" name="Page-1">
    <mxGraphModel><root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <mxCell id="2" value="Agent" style="rounded=1;" vertex="1" parent="1">
        <mxGeometry x="40" y="40" width="120" height="40" as="geometry"/>
      </mxCell>
    </root></mxGraphModel>
  </diagram>
</mxfile>`,
};
