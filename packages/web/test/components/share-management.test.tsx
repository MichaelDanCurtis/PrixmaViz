/**
 * Issue #8 Wave 2C — Share management tests.
 *
 * Covers the share sub-section appended to DetailModal:
 *   - Lists shares fetched from api.listShareLinks
 *   - Each row renders truncated token + permission badge + expiry text
 *   - Revoke button calls api.revokeShareLink and optimistically drops
 *     the row from the list
 *   - "+ New share link" button opens EmbedModal on its Permalink tab
 *   - WS-driven library:share-created bumps the refresh trigger and
 *     re-fetches the list
 *
 * The full Library mount is used (mirrors detail-modal.test.tsx) so the
 * detailModalSlug → entry resolution path is exercised.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryEntry } from "@prixmaviz/shared";
import { useAppStore } from "../../src/store";

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
});
const sample: LibraryEntry[] = [target];

// Default link list. Each test can swap this via listShareLinksMock.mockResolvedValueOnce.
const defaultLinks = [
  {
    id: "link-1",
    token: "s_token1111aaaa2222bbbb3333cccc4444",
    permission: "view" as const,
    expiresAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    url: "http://test.localhost/s/s_token1111aaaa2222bbbb3333cccc4444",
  },
  {
    id: "link-2",
    token: "s_token2222dddd3333eeee4444ffff5555",
    permission: "edit" as const,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: "2024-01-02T00:00:00Z",
    url: "http://test.localhost/s/s_token2222dddd3333eeee4444ffff5555",
  },
];

const listShareLinksMock = vi.fn(async () => ({ links: defaultLinks }));
const revokeShareLinkMock = vi.fn(async () => ({ ok: true as const }));
const createShareLinkMock = vi.fn(async () => ({
  token: "s_newtoken00000000000000000000",
  url: "http://test.localhost/s/s_newtoken00000000000000000000",
}));

vi.mock("../../src/lib/api", () => ({
  api: {
    library: vi.fn(async () => sample),
    loadBySlug: vi.fn(),
    createTile: vi.fn(),
    listTags: vi.fn(async () => []),
    searchDiagrams: vi.fn(async () => ({ results: [] })),
    updateDiagramMeta: vi.fn(async () => ({ meta: {} })),
    save: vi.fn(async () => ({ path: "", slug: "" })),
    listShareLinks: (...args: unknown[]) =>
      (listShareLinksMock as unknown as (...a: unknown[]) => Promise<unknown>)(
        ...args,
      ),
    revokeShareLink: (...args: unknown[]) =>
      (revokeShareLinkMock as unknown as (...a: unknown[]) => Promise<unknown>)(
        ...args,
      ),
    createShareLink: (...args: unknown[]) =>
      (createShareLinkMock as unknown as (...a: unknown[]) => Promise<unknown>)(
        ...args,
      ),
    getWorkspace: vi.fn(async () => ({ settings: {} })),
  },
  authFetch: vi.fn(async () => new Response(null, { status: 404 })),
}));

beforeEach(() => {
  listShareLinksMock.mockClear();
  listShareLinksMock.mockImplementation(async () => ({ links: defaultLinks }));
  revokeShareLinkMock.mockClear();
  createShareLinkMock.mockClear();
  useAppStore.setState({
    library: sample,
    activeTagFilters: new Set<string>(),
    serverSearchResults: null,
    tagAutocompleteCache: [],
    librarySortKey: "name-asc",
    diagram: null,
    tiles: [],
    detailModalSlug: "alpha",
    embedModalDiagram: null,
    embedModalInitialTab: null,
    shareListRefreshTrigger: 0,
  });
});

afterEach(() => {
  cleanup();
});

describe("Share management (Issue #8 Wave 2C)", () => {
  it("fetches and renders the share list when the detail modal is open", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    await waitFor(() => {
      expect(listShareLinksMock).toHaveBeenCalledWith("diag-alpha-id");
    });
    const list = await screen.findByTestId("detail-modal-shares-list");
    // Both links rendered.
    expect(
      list.querySelectorAll('[data-testid^="detail-modal-share-row-"]').length,
    ).toBe(2);
  });

  it("renders permission badge + expiry text per row", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await screen.findByTestId("detail-modal-shares-list");

    const row1 = screen.getByTestId(
      "detail-modal-share-row-s_token1111aaaa2222bbbb3333cccc4444",
    );
    expect(row1.textContent).toContain("view");
    expect(row1.textContent).toContain("Never expires");

    const row2 = screen.getByTestId(
      "detail-modal-share-row-s_token2222dddd3333eeee4444ffff5555",
    );
    expect(row2.textContent).toContain("edit");
    // Expiry should read "in 6d" or "in 7d" depending on rounding.
    expect(row2.textContent).toMatch(/in \dd/);
  });

  it("shows empty state when API returns no links", async () => {
    listShareLinksMock.mockImplementationOnce(async () => ({ links: [] }));
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    await waitFor(() => {
      expect(screen.getByTestId("detail-modal-shares-empty")).toBeTruthy();
    });
  });

  it("Revoke button calls api.revokeShareLink and removes the row from the list", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await screen.findByTestId("detail-modal-shares-list");

    const revokeBtn = screen.getByTestId(
      "detail-modal-share-revoke-s_token1111aaaa2222bbbb3333cccc4444",
    );
    await act(async () => {
      fireEvent.click(revokeBtn);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(revokeShareLinkMock).toHaveBeenCalledWith(
        "s_token1111aaaa2222bbbb3333cccc4444",
      );
    });
    // Row is gone from the list.
    expect(
      screen.queryByTestId(
        "detail-modal-share-row-s_token1111aaaa2222bbbb3333cccc4444",
      ),
    ).toBeNull();
    // Other row still there.
    expect(
      screen.getByTestId(
        "detail-modal-share-row-s_token2222dddd3333eeee4444ffff5555",
      ),
    ).toBeTruthy();
  });

  it("rolls back the optimistic removal if revoke API call fails", async () => {
    revokeShareLinkMock.mockRejectedValueOnce(new Error("HTTP 500"));
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await screen.findByTestId("detail-modal-shares-list");

    const revokeBtn = screen.getByTestId(
      "detail-modal-share-revoke-s_token1111aaaa2222bbbb3333cccc4444",
    );
    await act(async () => {
      fireEvent.click(revokeBtn);
      await Promise.resolve();
    });
    await flushAsync();

    // Row should be back.
    await waitFor(() => {
      expect(
        screen.queryByTestId(
          "detail-modal-share-row-s_token1111aaaa2222bbbb3333cccc4444",
        ),
      ).not.toBeNull();
    });
  });

  it("'+ New share link' button opens the EmbedModal on its Permalink tab", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const newBtn = await screen.findByTestId("detail-modal-share-new");
    act(() => {
      fireEvent.click(newBtn);
    });
    const s = useAppStore.getState();
    expect(s.embedModalDiagram).toEqual({
      diagramId: "diag-alpha-id",
      diagramName: "Alpha",
    });
    expect(s.embedModalInitialTab).toBe("permalink");
  });

  it("'Embed…' footer button opens the EmbedModal (default tab)", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();

    const embedBtn = await screen.findByTestId("detail-modal-embed-button");
    act(() => {
      fireEvent.click(embedBtn);
    });
    const s = useAppStore.getState();
    expect(s.embedModalDiagram).toEqual({
      diagramId: "diag-alpha-id",
      diagramName: "Alpha",
    });
    expect(s.embedModalInitialTab).toBeNull();
  });

  it("re-fetches the share list when shareListRefreshTrigger bumps (WS-driven)", async () => {
    const { Library } = await import("../../src/components/Library");
    render(<Library />);
    await flushAsync();
    await waitFor(() => {
      expect(listShareLinksMock).toHaveBeenCalledTimes(1);
    });

    // Simulate a WS event landing — handlers call bumpShareListRefresh.
    act(() => {
      useAppStore.getState().bumpShareListRefresh();
    });
    await waitFor(() => {
      expect(listShareLinksMock).toHaveBeenCalledTimes(2);
    });
  });
});
