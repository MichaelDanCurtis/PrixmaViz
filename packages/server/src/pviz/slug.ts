const MAX_LEN = 80;

export function slugify(name: string): string {
  let s = name
    .toLowerCase()
    // Drop non-ASCII characters entirely (no hyphen for them)
    .replace(/[^\x00-\x7F]/g, "")
    // Replace runs of non-alphanumeric ASCII with a single hyphen
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN);
  if (!s) s = "untitled";
  return s;
}

export function resolveSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
