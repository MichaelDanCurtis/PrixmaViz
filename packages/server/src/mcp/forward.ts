import type { InstanceLock } from "./lockfile";

export async function forwardCall(
  lock: InstanceLock,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const url = `http://127.0.0.1:${lock.port}/api/mcp/call`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: toolName, args }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`forward failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return await res.json();
}
