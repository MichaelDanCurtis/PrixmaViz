import { $ } from "bun";

const TARGETS = [
  { name: "darwin-arm64", flag: "--target=bun-darwin-arm64" },
  { name: "darwin-x64", flag: "--target=bun-darwin-x64" },
  { name: "linux-x64", flag: "--target=bun-linux-x64" },
  { name: "linux-arm64", flag: "--target=bun-linux-arm64" },
  { name: "windows-x64", flag: "--target=bun-windows-x64" },
];

await $`mkdir -p ../../dist`;
for (const t of TARGETS) {
  const out = `../../dist/prixmaviz-mcp-${t.name}${t.name.startsWith("windows") ? ".exe" : ""}`;
  console.log(`building ${out}…`);
  await $`bun build src/index.ts --compile ${t.flag} --outfile ${out}`;
}
console.log("done.");
