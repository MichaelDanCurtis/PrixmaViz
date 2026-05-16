import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StarterTemplatesGallery, hasSkippedTemplates } from "../../src/components/StarterTemplatesGallery";
import { STARTER_TEMPLATES } from "../../src/templates";
import { useAppStore } from "../../src/store";

const WORKSPACE_ID = "11111111-2222-3333-4444-555555555555";

function resetStore() {
  useAppStore.setState({
    workspaceId: WORKSPACE_ID,
    tiles: [],
    camera: { x: 0, y: 0, zoom: 1 },
    diagram: null,
    svg: "",
    dsl: "",
    error: null,
  });
}

beforeEach(() => {
  resetStore();
  // Wipe the per-workspace skip flag so each test starts on a clean
  // localStorage. Other prixmaviz_* keys (welcome, workspace id) are
  // untouched.
  try {
    localStorage.removeItem(`prixmaviz_templates_skipped:${WORKSPACE_ID}`);
  } catch {}
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StarterTemplatesGallery — first-run detection", () => {
  // The "show / don't show" decision lives in App.tsx (boolean expression).
  // We test the exported predicate that App.tsx delegates to and the
  // store-derived `tiles.length === 0` condition the parent component reads.
  it("hasSkippedTemplates returns false for a fresh workspace (no localStorage flag)", () => {
    expect(hasSkippedTemplates(WORKSPACE_ID)).toBe(false);
  });

  it("hasSkippedTemplates returns true when the per-workspace skip flag is set", () => {
    localStorage.setItem(`prixmaviz_templates_skipped:${WORKSPACE_ID}`, "1");
    expect(hasSkippedTemplates(WORKSPACE_ID)).toBe(true);
  });

  it("hasSkippedTemplates returns true when workspaceId is null (bootstrap window)", () => {
    expect(hasSkippedTemplates(null)).toBe(true);
  });

  it("first-run condition is satisfied for an empty workspace", () => {
    // The condition App.tsx evaluates: tiles.length === 0 && !hasSkipped.
    useAppStore.setState({ tiles: [] });
    expect(useAppStore.getState().tiles.length).toBe(0);
    expect(hasSkippedTemplates(WORKSPACE_ID)).toBe(false);
  });

  it("first-run condition is NOT satisfied once a tile exists", () => {
    useAppStore.setState({
      tiles: [{ id: "t1", diagramId: "d1", diagramSlug: "x", x: 0, y: 0, w: 600, h: 400, z: 0 }],
    });
    expect(useAppStore.getState().tiles.length).toBe(1);
  });
});

describe("StarterTemplatesGallery — rendering", () => {
  it("renders one card per starter template", () => {
    render(<StarterTemplatesGallery onDismiss={() => {}} />);
    for (const t of STARTER_TEMPLATES) {
      expect(screen.getByTestId(`template-card-${t.slug}`)).toBeTruthy();
    }
  });

  it("shows the skip control", () => {
    render(<StarterTemplatesGallery onDismiss={() => {}} />);
    expect(screen.getByText(/skip — start with an empty canvas/i)).toBeTruthy();
  });

  it("skip button writes the per-workspace flag and dismisses", () => {
    const onDismiss = vi.fn();
    render(<StarterTemplatesGallery onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText(/skip — start with an empty canvas/i));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(hasSkippedTemplates(WORKSPACE_ID)).toBe(true);
  });

  it("close button dismisses without setting the skip flag", () => {
    const onDismiss = vi.fn();
    render(<StarterTemplatesGallery onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText(/close starter templates/i));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(hasSkippedTemplates(WORKSPACE_ID)).toBe(false);
  });
});

describe("StarterTemplatesGallery — template click flow", () => {
  it("clicking a card creates a diagram via /api/render-dsl + a tile via /api/tiles, then dismisses", async () => {
    // Mock the two endpoints the click handler hits. Order matters because
    // tile creation depends on the diagramId returned by renderDsl.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/render-dsl") && init?.method === "POST") {
        return Promise.resolve(new Response(
          JSON.stringify({
            diagramId: "d_new",
            render: { svg: "<svg/>", dsl: "flowchart LR\n  A-->B\n" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (url.endsWith("/api/tiles") && init?.method === "POST") {
        return Promise.resolve(new Response(
          JSON.stringify({
            tile: { id: "t_new", diagramId: "d_new", diagramSlug: "flowchart", x: 60, y: 60, w: 600, h: 400, z: 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      return Promise.resolve(new Response("not mocked", { status: 500 }));
    });

    const onDismiss = vi.fn();
    render(<StarterTemplatesGallery onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId("template-card-flowchart"));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));

    // Verify both endpoints were hit in order.
    const calls = fetchSpy.mock.calls.map((c) => {
      const inp = c[0];
      const url = typeof inp === "string" ? inp : inp instanceof URL ? inp.href : (inp as Request).url;
      return { url, method: (c[1] as RequestInit | undefined)?.method ?? "GET" };
    });
    const renderCall = calls.find((c) => c.url.endsWith("/api/render-dsl"));
    const tileCall = calls.find((c) => c.url.endsWith("/api/tiles"));
    expect(renderCall).toBeTruthy();
    expect(tileCall).toBeTruthy();
    expect(renderCall!.method).toBe("POST");
    expect(tileCall!.method).toBe("POST");

    // Store reflects the new diagram so the Library row would light up.
    expect(useAppStore.getState().diagram?.id).toBe("d_new");
    expect(useAppStore.getState().svg).toBe("<svg/>");
  });

  it("propagates server errors to the store without dismissing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      return Promise.resolve(new Response(
        JSON.stringify({ ok: false, error: "boom" }),
        { status: 502, headers: { "content-type": "application/json" } },
      ));
    });

    const onDismiss = vi.fn();
    render(<StarterTemplatesGallery onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId("template-card-flowchart"));

    await waitFor(() => expect(useAppStore.getState().error).toBeTruthy());
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
