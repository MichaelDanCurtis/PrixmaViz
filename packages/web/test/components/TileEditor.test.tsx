// Issue #6: editor toggle + render-error preservation.
//
// Verifies that:
//   - clicking the Edit button mounts the textarea
//   - the textarea is populated from GET /source
//   - on a failed save the user's text is preserved + the error renders
//
// We mock `fetch` to control API responses; happy-dom + RTL handle the rest.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { Tile } from "../../src/components/Tile";
import { useAppStore } from "../../src/store";

const realFetch = globalThis.fetch;

function mockApi(responses: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const pattern of Object.keys(responses)) {
      if (url.includes(pattern)) {
        return await responses[pattern]!(init);
      }
    }
    return new Response("not stubbed: " + url, { status: 404 });
  }) as typeof fetch;
}

const tile = {
  id: "tile1",
  diagramId: "d_1",
  diagramSlug: "demo",
  x: 0, y: 0, w: 600, h: 400, z: 0,
};

beforeEach(() => {
  // Editor uses authFetch which appends Authorization header; set a workspace
  // so the auth path doesn't try to bootstrap.
  try { localStorage.setItem("prixmaviz_workspace", "00000000-0000-0000-0000-000000000001"); } catch {}
  useAppStore.setState({
    workspaceId: "00000000-0000-0000-0000-000000000001",
    tiles: [tile],
    camera: { x: 0, y: 0, zoom: 1 },
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  cleanup();
  vi.restoreAllMocks();
});

describe("Tile inline editor (Issue #6)", () => {
  it("Edit button toggles the editor; load fills the textarea", async () => {
    mockApi({
      "/api/library/demo/thumb": () => new Response("<svg></svg>", { status: 200 }),
      "/api/diagrams/d_1/source": (init) => {
        if (!init || init.method === undefined || init.method === "GET") {
          return new Response(
            JSON.stringify({ id: "d_1", engine: "mermaid", kind: "passthrough", source: "flowchart LR\n  A-->B" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("unexpected", { status: 405 });
      },
    });
    render(<Tile tile={tile} />);
    // Toggle on
    const editBtn = screen.getByTestId("tile-edit-toggle");
    fireEvent.click(editBtn);
    const ta = await waitFor(() => screen.getByPlaceholderText("") as HTMLTextAreaElement);
    await waitFor(() => expect(ta.value).toContain("flowchart LR"));
    // Toggle off — textarea unmounts
    fireEvent.click(editBtn);
    await waitFor(() => expect(screen.queryByText("DSL Source")).toBeNull());
  });

  it("render-failure preserves the user's text and shows the error inline", async () => {
    mockApi({
      "/api/library/demo/thumb": () => new Response("<svg></svg>", { status: 200 }),
      "/api/diagrams/d_1/source": (init) => {
        if (!init || init.method === undefined || init.method === "GET") {
          return new Response(
            JSON.stringify({ id: "d_1", engine: "mermaid", kind: "passthrough", source: "original" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // POST → simulate a render failure echoing the source back.
        const body = JSON.parse(init.body as string) as { source: string };
        return new Response(
          JSON.stringify({ ok: false, error: "Parse error at line 1", source: body.source }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    render(<Tile tile={tile} />);
    fireEvent.click(screen.getByTestId("tile-edit-toggle"));
    const ta = await waitFor(() => screen.getByPlaceholderText("") as HTMLTextAreaElement);
    await waitFor(() => expect(ta.value).toBe("original"));

    // Type something that will "fail"
    fireEvent.change(ta, { target: { value: "garbage that won't parse" } });
    expect(ta.value).toBe("garbage that won't parse");

    // Trigger save via Cmd+Enter
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    // The error must render inline AND the user's text must be preserved.
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Parse error"));
    expect(ta.value).toBe("garbage that won't parse");
  });
});
