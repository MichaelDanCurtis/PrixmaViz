import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "@prixmaviz/shared";
import { useAppStore } from "../../src/store";

// Issue #7 Wave 2 (F5): item-detail modal. Covers:
//   - opens on Card ⋯ menu click
//   - each field commits via PATCH on blur (mocked api)
//   - notes toggle between markdown-rendered view and raw textarea edit
//   - close on ESC

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

function entry(p: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: p.id ?? `id-${p.name ?? "x"}`,
    name: p.name ?? "x",
    path: p.path ?? `/lib/${p.name ?? "x"}.pviz`,
    engine: p.engine ?? "mermaid",
    kind: p.kind ?? "graph",
    tags: p.tags ?? [],
    createdAt: p.createdAt ?? "2024-01-01T00:00:00Z",
    updatedAt: p.updatedAt ?? "2024-01-01T00:00:00Z",
    parentPath: p.parentPath ?? "",
    pinned: p.pinned ?? false,
    lastOpenedAt: p.lastOpenedAt ?? null,
    description: p.description,
    author: p.author,
    notes: p.notes,
  };
}

const target = entry({
  id: "diag-alpha-id",
  name: "Alpha",
  path: "/lib/alpha.pviz",
  description: "Initial desc",
  author: "alice",
  notes: "**bold** initial",
  tags: ["mercury"],
});

const sample: LibraryEntry[] = [
  target,
  entry({ id: "diag-beta-id", name: "Bravo", path: "/lib/bravo.pviz" }),
];

const updateMetaMock = vi.fn(async () => ({ meta: {} }));
const saveMock = vi.fn(async () => ({ path: "", slug: "" }));

vi.mock("../../src/lib/api", () => ({
  api: {
    library: vi.fn(async () => sample),
    loadBySlug: vi.fn(),
    createTile: vi.fn(),
    listTags: vi.fn(async () => ["mercury", "auth", "wire-format"]),
    searchDiagrams: vi.fn(async () => ({ results: [] })),
    updateDiagramMeta: (...args: [string, Record<string, unknown>]) =>
      updateMetaMock(...args),
    save: (...args: [string, Record<string, unknown>]) => saveMock(...args),
  },
  authFetch: vi.fn(async () => new Response(null, { status: 404 })),
}));

beforeEach(() => {
  updateMetaMock.mockClear();
  saveMock.mockClear();
  useAppStore.setState({
    library: sample,
    activeTagFilters: new Set<string>(),
    serverSearchResults: null,
    tagAutocompleteCache: ["mercury", "auth", "wire-format"],
    librarySortKey: "name-asc",
    diagram: null,
    tiles: [],
    detailModalSlug: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("DetailModal (issue #7 F5)", () => {
  it("clicking the ⋯ menu on a card opens the modal", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const menuBtn = screen.getByTestId("library-item-menu-alpha");
    act(() => {
      fireEvent.click(menuBtn);
    });

    expect(useAppStore.getState().detailModalSlug).toBe("alpha");
    expect(screen.getByTestId("detail-modal")).toBeTruthy();
    // Inputs are prefilled from the LibraryEntry.
    expect((screen.getByTestId("detail-modal-name") as HTMLInputElement).value).toBe("Alpha");
    expect((screen.getByTestId("detail-modal-description") as HTMLInputElement).value).toBe(
      "Initial desc",
    );
    expect((screen.getByTestId("detail-modal-author") as HTMLInputElement).value).toBe("alice");
  });

  it("description commits via PATCH meta on blur", async () => {
    useAppStore.setState({ detailModalSlug: "alpha" });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const descInput = screen.getByTestId("detail-modal-description") as HTMLInputElement;
    act(() => {
      fireEvent.change(descInput, { target: { value: "Updated desc" } });
      fireEvent.blur(descInput);
    });
    await flushAsync();

    expect(updateMetaMock).toHaveBeenCalledTimes(1);
    expect(updateMetaMock).toHaveBeenCalledWith(
      "diag-alpha-id",
      expect.objectContaining({ description: "Updated desc" }),
    );
  });

  it("author commits via PATCH meta on blur", async () => {
    useAppStore.setState({ detailModalSlug: "alpha" });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const authorInput = screen.getByTestId("detail-modal-author") as HTMLInputElement;
    act(() => {
      fireEvent.change(authorInput, { target: { value: "bob" } });
      fireEvent.blur(authorInput);
    });
    await flushAsync();

    expect(updateMetaMock).toHaveBeenCalledWith(
      "diag-alpha-id",
      expect.objectContaining({ author: "bob" }),
    );
  });

  it("name change commits via api.save (the rename endpoint)", async () => {
    useAppStore.setState({ detailModalSlug: "alpha" });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const nameInput = screen.getByTestId("detail-modal-name") as HTMLInputElement;
    act(() => {
      fireEvent.change(nameInput, { target: { value: "Alpha v2" } });
      fireEvent.blur(nameInput);
    });
    await flushAsync();

    expect(saveMock).toHaveBeenCalledWith(
      "diag-alpha-id",
      expect.objectContaining({ name: "Alpha v2" }),
    );
  });

  it("blur on unchanged name does NOT call api.save", async () => {
    useAppStore.setState({ detailModalSlug: "alpha" });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    const nameInput = screen.getByTestId("detail-modal-name") as HTMLInputElement;
    act(() => {
      fireEvent.blur(nameInput);
    });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("notes default to view mode (rendered markdown), toggle to edit", async () => {
    useAppStore.setState({ detailModalSlug: "alpha" });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    // View mode shows the rendered HTML.
    const view = screen.getByTestId("detail-modal-notes-view");
    expect(view.innerHTML).toContain("<strong>bold</strong>");

    // Toggle to edit mode — textarea visible.
    const toggle = screen.getByTestId("detail-modal-notes-toggle");
    expect(toggle.textContent).toBe("Edit notes");
    act(() => {
      fireEvent.click(toggle);
    });
    const textarea = screen.getByTestId("detail-modal-notes") as HTMLTextAreaElement;
    expect(textarea.value).toBe("**bold** initial");
    expect(screen.queryByTestId("detail-modal-notes-view")).toBeNull();

    // Edit + blur commits notes via updateDiagramMeta.
    act(() => {
      fireEvent.change(textarea, { target: { value: "*italic* now" } });
      fireEvent.blur(textarea);
    });
    await flushAsync();
    expect(updateMetaMock).toHaveBeenCalledWith(
      "diag-alpha-id",
      expect.objectContaining({ notes: "*italic* now" }),
    );
  });

  it("ESC closes the modal", async () => {
    useAppStore.setState({ detailModalSlug: "alpha" });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    expect(screen.getByTestId("detail-modal")).toBeTruthy();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(useAppStore.getState().detailModalSlug).toBeNull();
  });

  it("close button (X) closes the modal", async () => {
    useAppStore.setState({ detailModalSlug: "alpha" });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const close = screen.getByTestId("detail-modal-close");
    act(() => {
      fireEvent.click(close);
    });
    expect(useAppStore.getState().detailModalSlug).toBeNull();
  });

  it("renders folder readonly path (placeholder Move UI is Agent C scope)", async () => {
    // The api.library() mock returns `sample` on mount and will overwrite
    // anything we put in store before render. Mutate `target`'s
    // parentPath in place so the post-mount store reflects the value we
    // want to assert against.
    target.parentPath = "mercury/wire-format";
    useAppStore.setState({ detailModalSlug: "alpha" });
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    expect(screen.getByText("mercury/wire-format")).toBeTruthy();
    // Restore so subsequent tests aren't polluted.
    target.parentPath = "";
  });
});
