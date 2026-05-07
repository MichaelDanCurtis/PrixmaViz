export function basename(p: string): string {
  return p.split("/").pop() ?? p;
}
