/**
 * Issue #8 Wave 2C — Embed modal.
 *
 * A 4-tab snippet picker for the various ways to embed or link a diagram:
 *
 *   - Markdown  — `![<name>](<host>/s/<token>.svg)`. Uses a view-only token.
 *                 If no view-only token exists yet, one is lazily created on
 *                 first open of this tab (POST /api/diagrams/:id/shares).
 *   - Iframe    — `<iframe src="<host>/s/<token>" width=... height=...>`
 *                 with editable width/height inputs (default 800x600).
 *                 Reuses the same view token as the Markdown tab.
 *   - OG        — two snippets: a `<meta property="og:image">` tag and the
 *                 bare URL `<host>/og/<token>.png`. Used for social cards.
 *   - Permalink — picks permission tier (view/comment/edit) + expiry
 *                 (24h / 7d / 30d / never). Each change calls
 *                 POST /api/diagrams/:id/shares with the chosen settings.
 *
 * The host (origin) for snippets is computed from `window.location.origin`.
 * The server stores `PRIXMAVIZ_PUBLIC_URL` and returns the absolute URL on
 * create, but for the modal we keep snippets origin-relative-to-this-page
 * so the displayed code matches what a user copying it on this very host
 * would expect. Tokens themselves are server-issued and opaque.
 *
 * Open/close state: lives in the app store (`embedModalDiagram`). Setting
 * it to `{ diagramId, diagramName }` opens the modal for that diagram;
 * setting to `null` closes it. The component also accepts an optional
 * `initialTab` so callers (e.g. "+ New share link" in DetailModal) can
 * open straight to the Permalink tab.
 *
 * Spec: docs/superpowers/specs/2026-05-16-sharing-and-embedding-design.md
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store";
import { api } from "../../lib/api";
import { toastError, toastSuccess } from "../../lib/toast";

export type EmbedTab = "markdown" | "iframe" | "og" | "permalink";

const TAB_LABELS: Record<EmbedTab, string> = {
  markdown: "Markdown",
  iframe: "Iframe",
  og: "OG",
  permalink: "Permalink",
};

const EXPIRY_OPTIONS: Array<{
  label: string;
  /** ms from now; null = never */
  delta: number | null;
}> = [
  { label: "24h", delta: 24 * 60 * 60 * 1000 },
  { label: "7d", delta: 7 * 24 * 60 * 60 * 1000 },
  { label: "30d", delta: 30 * 24 * 60 * 60 * 1000 },
  { label: "Never", delta: null },
];

/**
 * `navigator.clipboard.writeText` isn't available in some test environments
 * and historically not in old browsers. The fallback uses a hidden textarea
 * + execCommand("copy") — deprecated but still functional everywhere we
 * care about. Either path toasts on success/error.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function originOrEmpty(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

/**
 * Reusable snippet block. Renders a `<pre>` and a Copy button that copies
 * the snippet verbatim. The Copy button label flips to "Copied!" for 1.5s
 * after a successful write so the user gets visual confirmation without
 * relying on the toast popping over the modal.
 */
function SnippetBlock(props: {
  label?: string;
  code: string;
  testid?: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    const ok = await copyToClipboard(props.code);
    if (ok) {
      setCopied(true);
      toastSuccess("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } else {
      toastError("Could not copy to clipboard");
    }
  }, [props.code]);
  return (
    <div className="embed-modal-snippet">
      {props.label && (
        <div className="embed-modal-snippet-label">{props.label}</div>
      )}
      <div className="embed-modal-snippet-row">
        <pre className="embed-modal-snippet-code" data-testid={props.testid}>
          {props.code}
        </pre>
        <button
          type="button"
          className="embed-modal-copy-button"
          onClick={onCopy}
          data-testid={props.testid ? `${props.testid}-copy` : undefined}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

interface EmbedModalProps {
  /** Optional override; defaults to "markdown". */
  initialTab?: EmbedTab;
}

export function EmbedModal({ initialTab }: EmbedModalProps = {}) {
  const target = useAppStore((s) => s.embedModalDiagram);
  const close = useAppStore((s) => s.closeEmbedModal);
  const requestedInitialTab = useAppStore((s) => s.embedModalInitialTab);
  const [tab, setTab] = useState<EmbedTab>(initialTab ?? requestedInitialTab ?? "markdown");
  // Active view-only token reused by Markdown + Iframe tabs. Lazily created
  // when either tab is first shown (avoids spamming the API for users who
  // open the modal "just to peek" at the Permalink tab).
  const [viewToken, setViewToken] = useState<string | null>(null);
  const [viewTokenError, setViewTokenError] = useState<string | null>(null);
  // Iframe width/height. Defaults match the spec — 800x600 is a reasonable
  // landing for embedding into Notion/Confluence/Hugo posts.
  const [iframeWidth, setIframeWidth] = useState(800);
  const [iframeHeight, setIframeHeight] = useState(600);
  // Permalink controls.
  const [permission, setPermission] = useState<"view" | "comment" | "edit">("view");
  const [expiryLabel, setExpiryLabel] = useState<string>("Never");
  const [permalinkUrl, setPermalinkUrl] = useState<string | null>(null);
  const [permalinkBusy, setPermalinkBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset state when the modal target changes — different diagram should
  // not retain a stale view token / permalink URL from the previous one.
  useEffect(() => {
    if (!target) return;
    setViewToken(null);
    setViewTokenError(null);
    setPermalinkUrl(null);
    setIframeWidth(800);
    setIframeHeight(600);
    setPermission("view");
    setExpiryLabel("Never");
    setTab(initialTab ?? requestedInitialTab ?? "markdown");
  }, [target?.diagramId, initialTab, requestedInitialTab]);

  // ESC + click-outside close. Mirrors DetailModal's behavior.
  useEffect(() => {
    if (!target) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    function onMouseDown(e: MouseEvent) {
      if (!dialogRef.current) return;
      if (!dialogRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [target, close]);

  // Lazily mint a view-only token on first entry to Markdown / Iframe / OG.
  // All three tabs share a single token because their URLs all read public
  // diagram bytes — there's no reason to mint three separate tokens.
  useEffect(() => {
    if (!target) return;
    if (viewToken) return;
    if (tab !== "markdown" && tab !== "iframe" && tab !== "og") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.createShareLink(target.diagramId, {
          permission: "view",
          expiresAt: null,
        });
        if (!cancelled) setViewToken(res.token);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setViewTokenError(msg);
          toastError(`Could not create share link: ${msg}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, target, viewToken]);

  if (!target) return null;

  const host = originOrEmpty();
  const safeName = target.diagramName || "diagram";

  // ── Tab snippets ─────────────────────────────────────────────────────
  const markdownSnippet = viewToken
    ? `![${safeName}](${host}/s/${viewToken}.svg)`
    : "";
  const iframeSnippet = viewToken
    ? `<iframe src="${host}/s/${viewToken}" width="${iframeWidth}" height="${iframeHeight}" frameborder="0"></iframe>`
    : "";
  const ogMetaSnippet = viewToken
    ? `<meta property="og:image" content="${host}/og/${viewToken}.png">`
    : "";
  const ogUrlSnippet = viewToken ? `${host}/og/${viewToken}.png` : "";

  // ── Permalink handler ────────────────────────────────────────────────
  async function applyPermalink(
    nextPermission: "view" | "comment" | "edit",
    nextExpiryLabel: string,
  ): Promise<void> {
    if (!target) return;
    setPermalinkBusy(true);
    try {
      const opt = EXPIRY_OPTIONS.find((o) => o.label === nextExpiryLabel);
      const expiresAt =
        opt && opt.delta !== null
          ? new Date(Date.now() + opt.delta).toISOString()
          : null;
      const res = await api.createShareLink(target.diagramId, {
        permission: nextPermission,
        expiresAt,
      });
      setPermalinkUrl(res.url || `${host}/s/${res.token}`);
    } catch (err) {
      toastError(
        `Could not create share link: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setPermalinkBusy(false);
    }
  }

  function onPermissionChange(next: "view" | "comment" | "edit") {
    setPermission(next);
    void applyPermalink(next, expiryLabel);
  }

  function onExpiryChange(next: string) {
    setExpiryLabel(next);
    void applyPermalink(permission, next);
  }

  return (
    <div
      className="embed-modal-overlay"
      role="presentation"
      data-testid="embed-modal-overlay"
    >
      <div
        ref={dialogRef}
        className="embed-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Embed ${target.diagramName}`}
        data-testid="embed-modal"
      >
        <div className="embed-modal-header">
          <h2 className="embed-modal-title">
            Embed &amp; share — {target.diagramName}
          </h2>
          <button
            type="button"
            className="embed-modal-close"
            aria-label="Close"
            title="Close (Esc)"
            onClick={close}
            data-testid="embed-modal-close"
          >
            ×
          </button>
        </div>

        <div className="embed-modal-tabs" role="tablist">
          {(Object.keys(TAB_LABELS) as EmbedTab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`embed-modal-tab${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)}
              data-testid={`embed-modal-tab-${t}`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="embed-modal-body">
          {tab === "markdown" && (
            <div data-testid="embed-modal-tab-content-markdown">
              {viewTokenError ? (
                <div className="embed-modal-error" role="alert">
                  Could not load share link: {viewTokenError}
                </div>
              ) : !viewToken ? (
                <div className="embed-modal-loading">Creating share link…</div>
              ) : (
                <>
                  <p className="embed-modal-hint">
                    Paste this in any Markdown surface (GitHub, docs, blog
                    posts) to embed the diagram as a view-only image.
                  </p>
                  <SnippetBlock
                    code={markdownSnippet}
                    testid="embed-modal-markdown-snippet"
                  />
                </>
              )}
            </div>
          )}

          {tab === "iframe" && (
            <div data-testid="embed-modal-tab-content-iframe">
              {viewTokenError ? (
                <div className="embed-modal-error" role="alert">
                  Could not load share link: {viewTokenError}
                </div>
              ) : !viewToken ? (
                <div className="embed-modal-loading">Creating share link…</div>
              ) : (
                <>
                  <p className="embed-modal-hint">
                    Embed an interactive view in Notion, Confluence, your
                    docs site, or any HTML surface.
                  </p>
                  <div className="embed-modal-iframe-dims">
                    <label className="embed-modal-field">
                      <span>Width</span>
                      <input
                        type="number"
                        min={100}
                        max={4000}
                        value={iframeWidth}
                        onChange={(e) =>
                          setIframeWidth(
                            Math.max(
                              1,
                              parseInt(e.target.value, 10) || 0,
                            ),
                          )
                        }
                        data-testid="embed-modal-iframe-width"
                      />
                    </label>
                    <label className="embed-modal-field">
                      <span>Height</span>
                      <input
                        type="number"
                        min={100}
                        max={4000}
                        value={iframeHeight}
                        onChange={(e) =>
                          setIframeHeight(
                            Math.max(
                              1,
                              parseInt(e.target.value, 10) || 0,
                            ),
                          )
                        }
                        data-testid="embed-modal-iframe-height"
                      />
                    </label>
                  </div>
                  <SnippetBlock
                    code={iframeSnippet}
                    testid="embed-modal-iframe-snippet"
                  />
                </>
              )}
            </div>
          )}

          {tab === "og" && (
            <div data-testid="embed-modal-tab-content-og">
              {viewTokenError ? (
                <div className="embed-modal-error" role="alert">
                  Could not load share link: {viewTokenError}
                </div>
              ) : !viewToken ? (
                <div className="embed-modal-loading">Creating share link…</div>
              ) : (
                <>
                  <p className="embed-modal-hint">
                    Use the meta tag in a page's &lt;head&gt; for social-card
                    previews on Twitter, Slack, Discord, LinkedIn, etc.
                  </p>
                  <SnippetBlock
                    label="Meta tag"
                    code={ogMetaSnippet}
                    testid="embed-modal-og-meta-snippet"
                  />
                  <SnippetBlock
                    label="Bare URL"
                    code={ogUrlSnippet}
                    testid="embed-modal-og-url-snippet"
                  />
                </>
              )}
            </div>
          )}

          {tab === "permalink" && (
            <div data-testid="embed-modal-tab-content-permalink">
              <p className="embed-modal-hint">
                Create a long-lived link you can paste into any chat or doc.
                The recipient sees the diagram at their chosen permission
                level.
              </p>

              <fieldset className="embed-modal-fieldset">
                <legend>Permission</legend>
                {(["view", "comment", "edit"] as const).map((p) => (
                  <label
                    key={p}
                    className="embed-modal-radio"
                    data-testid={`embed-modal-permission-${p}`}
                  >
                    <input
                      type="radio"
                      name="embed-modal-permission"
                      value={p}
                      checked={permission === p}
                      disabled={permalinkBusy}
                      onChange={() => onPermissionChange(p)}
                    />
                    <span style={{ textTransform: "capitalize" }}>{p}</span>
                  </label>
                ))}
              </fieldset>

              <fieldset className="embed-modal-fieldset">
                <legend>Expires</legend>
                <div className="embed-modal-chips">
                  {EXPIRY_OPTIONS.map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      className={`embed-modal-chip${expiryLabel === o.label ? " active" : ""}`}
                      onClick={() => onExpiryChange(o.label)}
                      disabled={permalinkBusy}
                      data-testid={`embed-modal-expiry-${o.label.toLowerCase()}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {permalinkUrl ? (
                <SnippetBlock
                  label="Link URL"
                  code={permalinkUrl}
                  testid="embed-modal-permalink-snippet"
                />
              ) : (
                <p className="embed-modal-hint" data-testid="embed-modal-permalink-empty">
                  Pick a permission tier or expiry above to mint a new link.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
