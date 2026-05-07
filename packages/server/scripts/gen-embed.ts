import { readdirSync, statSync } from "node:fs";
import { relative, resolve, join } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const WEB_DIST = resolve(ROOT, "packages/web/dist");
const OUT = resolve(import.meta.dir, "../src/embedded.ts");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const files = walk(WEB_DIST).map((f) => relative(WEB_DIST, f).split("\\").join("/"));

const imports = files.map((f, i) => `import _${i} from "../../web/dist/${f}" with { type: "file" };`);
const entries = files.map((f, i) => `  ${JSON.stringify("/" + f)}: _${i},`);

const out = `${imports.join("\n")}

export const EMBEDDED: Record<string, string> = {
${entries.join("\n")}
};
`;

await Bun.write(OUT, out);
console.log(`embedded ${files.length} files -> ${OUT}`);
