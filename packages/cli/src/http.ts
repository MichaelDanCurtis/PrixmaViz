/**
 * Thin HTTP helper that injects the workspace bearer token, normalizes
 * trailing slashes on the server URL, and turns non-2xx responses into
 * useful Error messages instead of silently returning a junk body.
 *
 * Every command in the CLI ultimately calls one of these — kept small so
 * the test fakes can replace it with a single mock per test.
 */

import type { CliConfig } from "./config";

export interface HttpClient {
  /** GET <serverUrl><path>. Returns parsed JSON. */
  getJson<T = unknown>(path: string): Promise<T>;
  /** POST JSON body, expect JSON back. */
  postJson<T = unknown>(path: string, body: unknown): Promise<T>;
  /** GET binary bytes (used by pull + export-workspace). */
  getBinary(path: string): Promise<Uint8Array>;
  /** POST multipart form-data, expect JSON back. */
  postMultipart<T = unknown>(path: string, form: FormData): Promise<T>;
}

export interface HttpClientDeps {
  /** Allow tests to inject a fake fetch. Defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

const USER_AGENT = "prixmaviz-cli";

/**
 * Build an HttpClient bound to the given config. The bearer token is
 * baked into the closure so callers don't pass it on every call (and
 * can't accidentally call the API without it).
 */
export function createHttpClient(
  cfg: CliConfig,
  deps: HttpClientDeps = {},
): HttpClient {
  const fetchFn = deps.fetchFn ?? fetch;
  const base = cfg.serverUrl.replace(/\/$/, "");
  const authHeader = `Bearer ${cfg.workspaceToken}`;

  async function checkOk(resp: Response, path: string): Promise<void> {
    if (resp.ok) return;
    let body = "";
    try {
      body = await resp.text();
    } catch {
      /* ignore */
    }
    // Truncate the body so we don't dump a 5KB HTML error page into the
    // user's terminal — first 500 chars is plenty to identify the issue.
    throw new Error(
      `prixmaviz ${path} failed (HTTP ${resp.status}): ${body.slice(0, 500)}`,
    );
  }

  return {
    async getJson<T = unknown>(path: string): Promise<T> {
      const resp = await fetchFn(`${base}${path}`, {
        method: "GET",
        headers: {
          "Authorization": authHeader,
          "Accept": "application/json",
          "User-Agent": USER_AGENT,
        },
      });
      await checkOk(resp, path);
      return (await resp.json()) as T;
    },

    async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
      const resp = await fetchFn(`${base}${path}`, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify(body ?? {}),
      });
      await checkOk(resp, path);
      return (await resp.json()) as T;
    },

    async getBinary(path: string): Promise<Uint8Array> {
      const resp = await fetchFn(`${base}${path}`, {
        method: "GET",
        headers: {
          "Authorization": authHeader,
          "User-Agent": USER_AGENT,
        },
      });
      await checkOk(resp, path);
      const buf = await resp.arrayBuffer();
      return new Uint8Array(buf);
    },

    async postMultipart<T = unknown>(
      path: string,
      form: FormData,
    ): Promise<T> {
      const resp = await fetchFn(`${base}${path}`, {
        method: "POST",
        // NB: do not set Content-Type explicitly — fetch sets the
        // multipart boundary automatically when body is FormData.
        headers: {
          "Authorization": authHeader,
          "Accept": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: form,
      });
      await checkOk(resp, path);
      return (await resp.json()) as T;
    },
  };
}
