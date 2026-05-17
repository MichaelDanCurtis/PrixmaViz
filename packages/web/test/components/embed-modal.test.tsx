/**
 * Issue #8 Wave 2C — EmbedModal tests.
 *
 * Covers the 4-tab UI:
 *   - Markdown / Iframe / OG / Permalink tab snippet shapes
 *   - Copy button calls navigator.clipboard.writeText
 *   - Permalink tab calls api.createShareLink on permission radio click
 *   - Iframe tab updates width/height in snippet on input change
 *   - Markdown tab lazily creates a view-only token on open
 *   - ESC + close button dismisses the modal
 *
 * The modal renders nothing when embedModalDiagram is null; tests prime
 * the store via useAppStore.setState before render.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../src/store";

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

const createShareLinkMock = vi.fn(async () => ({
  token: "s_abcdef1234567890abcdef1234567890",
  url: "http://test.localhost/s/s_abcdef1234567890abcdef1234567890",
}));

vi.mock("../../src/lib/api", () => ({
  api: {
    createShareLink: (...args: unknown[]) =>
      (createShareLinkMock as unknown as (...a: unknown[]) => Promise<unknown>)(
        ...args,
      ),
    listShareLinks: vi.fn(async () => ({ links: [] })),
    revokeShareLink: vi.fn(async () => ({ ok: true })),
  },
  authFetch: vi.fn(async () => new Response(null, { status: 404 })),
}));

const writeTextMock = vi.fn(async () => undefined);

beforeEach(() => {
  createShareLinkMock.mockClear();
  writeTextMock.mockClear();
  // happy-dom doesn't ship navigator.clipboard; install a stub.
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: writeTextMock },
  });
  // Make window.location.origin deterministic for snippet assertions.
  // happy-dom honors a direct assignment to location.href.
  try {
    window.location.href = "http://test.localhost/";
  } catch {
    // Some happy-dom versions throw on URL writes — fall back to defining.
  }
  useAppStore.setState({
    embedModalDiagram: { diagramId: "diag-alpha-id", diagramName: "Alpha" },
    embedModalInitialTab: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("EmbedModal (Issue #8 Wave 2C)", () => {
  it("renders nothing when no diagram target is set", async () => {
    useAppStore.setState({
      embedModalDiagram: null,
      embedModalInitialTab: null,
    });
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    const { container } = render(<EmbedModal />);
    expect(container.firstChild).toBeNull();
  });

  it("renders all four tabs and starts on Markdown", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    await flushAsync();

    expect(screen.getByTestId("embed-modal")).toBeTruthy();
    expect(screen.getByTestId("embed-modal-tab-markdown")).toBeTruthy();
    expect(screen.getByTestId("embed-modal-tab-iframe")).toBeTruthy();
    expect(screen.getByTestId("embed-modal-tab-og")).toBeTruthy();
    expect(screen.getByTestId("embed-modal-tab-permalink")).toBeTruthy();
    expect(screen.getByTestId("embed-modal-tab-content-markdown")).toBeTruthy();
  });

  it("Markdown tab lazily creates a view-only token and renders the snippet", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);

    await waitFor(() => {
      expect(createShareLinkMock).toHaveBeenCalled();
    });
    // First call (the lazy view token) should be view-only with no expiry.
    expect(createShareLinkMock).toHaveBeenCalledWith(
      "diag-alpha-id",
      expect.objectContaining({ permission: "view", expiresAt: null }),
    );

    const snippet = await screen.findByTestId("embed-modal-markdown-snippet");
    expect(snippet.textContent).toBe(
      "![Alpha](http://test.localhost/s/s_abcdef1234567890abcdef1234567890.svg)",
    );
  });

  it("Iframe tab renders the iframe snippet with default 800x600", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalled());

    act(() => {
      fireEvent.click(screen.getByTestId("embed-modal-tab-iframe"));
    });
    const snippet = await screen.findByTestId("embed-modal-iframe-snippet");
    expect(snippet.textContent).toContain(
      `<iframe src="http://test.localhost/s/s_abcdef1234567890abcdef1234567890" width="800" height="600"`,
    );
  });

  it("Iframe tab updates width/height in the snippet on input change", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalled());

    act(() => {
      fireEvent.click(screen.getByTestId("embed-modal-tab-iframe"));
    });
    const widthInput = (await screen.findByTestId(
      "embed-modal-iframe-width",
    )) as HTMLInputElement;
    const heightInput = screen.getByTestId(
      "embed-modal-iframe-height",
    ) as HTMLInputElement;

    act(() => {
      fireEvent.change(widthInput, { target: { value: "1024" } });
      fireEvent.change(heightInput, { target: { value: "768" } });
    });

    const snippet = screen.getByTestId("embed-modal-iframe-snippet");
    expect(snippet.textContent).toContain('width="1024"');
    expect(snippet.textContent).toContain('height="768"');
  });

  it("OG tab shows both the meta tag and the bare URL pointing at /og/<token>.png", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    await waitFor(() => expect(createShareLinkMock).toHaveBeenCalled());

    act(() => {
      fireEvent.click(screen.getByTestId("embed-modal-tab-og"));
    });

    const meta = await screen.findByTestId("embed-modal-og-meta-snippet");
    const bare = screen.getByTestId("embed-modal-og-url-snippet");
    expect(meta.textContent).toBe(
      '<meta property="og:image" content="http://test.localhost/og/s_abcdef1234567890abcdef1234567890.png">',
    );
    expect(bare.textContent).toBe(
      "http://test.localhost/og/s_abcdef1234567890abcdef1234567890.png",
    );
  });

  it("Copy button calls navigator.clipboard.writeText with the snippet", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    const snippet = await screen.findByTestId("embed-modal-markdown-snippet");
    const expectedText = snippet.textContent ?? "";

    const copyBtn = screen.getByTestId("embed-modal-markdown-snippet-copy");
    await act(async () => {
      fireEvent.click(copyBtn);
      await Promise.resolve();
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(expectedText);
  });

  it("Permalink tab is empty until permission is chosen", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    act(() => {
      fireEvent.click(screen.getByTestId("embed-modal-tab-permalink"));
    });
    expect(screen.getByTestId("embed-modal-permalink-empty")).toBeTruthy();
  });

  it("Permalink tab calls createShareLink on permission change", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    await flushAsync();
    // Switch to permalink tab first — no view-token mint on this tab.
    act(() => {
      fireEvent.click(screen.getByTestId("embed-modal-tab-permalink"));
    });
    createShareLinkMock.mockClear();

    const commentRadio = screen
      .getByTestId("embed-modal-permission-comment")
      .querySelector("input")!;
    await act(async () => {
      fireEvent.click(commentRadio);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(createShareLinkMock).toHaveBeenCalledTimes(1);
    });
    expect(createShareLinkMock).toHaveBeenCalledWith(
      "diag-alpha-id",
      expect.objectContaining({ permission: "comment", expiresAt: null }),
    );

    // URL snippet now rendered.
    const snippet = await screen.findByTestId("embed-modal-permalink-snippet");
    expect(snippet.textContent).toContain("/s/s_");
  });

  it("Permalink tab passes ISO-8601 expiresAt when a duration chip is selected", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    await flushAsync();
    act(() => {
      fireEvent.click(screen.getByTestId("embed-modal-tab-permalink"));
    });
    createShareLinkMock.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByTestId("embed-modal-expiry-24h"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(createShareLinkMock).toHaveBeenCalledTimes(1);
    });
    const args = createShareLinkMock.mock.calls[0]!;
    expect(args[0]).toBe("diag-alpha-id");
    const opts = args[1] as { expiresAt: string };
    expect(opts.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("close button (×) dismisses the modal", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    await flushAsync();

    act(() => {
      fireEvent.click(screen.getByTestId("embed-modal-close"));
    });
    expect(useAppStore.getState().embedModalDiagram).toBeNull();
  });

  it("ESC dismisses the modal", async () => {
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    await flushAsync();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(useAppStore.getState().embedModalDiagram).toBeNull();
  });

  it("opens straight to the requested initial tab when set via the store", async () => {
    useAppStore.setState({
      embedModalDiagram: { diagramId: "diag-alpha-id", diagramName: "Alpha" },
      embedModalInitialTab: "permalink",
    });
    const { EmbedModal } = await import("../../src/components/Library/EmbedModal");
    render(<EmbedModal />);
    await flushAsync();
    expect(screen.getByTestId("embed-modal-tab-content-permalink")).toBeTruthy();
  });
});
