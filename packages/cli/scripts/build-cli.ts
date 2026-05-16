import { $ } from "bun";

/**
 * Build standalone CLI binaries for the five supported platform targets.
 *
 * Mirrors packages/shim/build.ts so the release pipeline can ship both
 * shim + CLI artifacts with the same naming convention. The outputs land
 * in the repo-root /dist directory; the GitHub Release workflow uploads
 * them.
 */
const TARGETS = [
  { name: "darwin-arm64", flag: "--target=bun-darwin-arm64" },
  { name: "darwin-x64", flag: "--target=bun-darwin-x64" },
  { name: "linux-x64", flag: "--target=bun-linux-x64" },
  { name: "linux-arm64", flag: "--target=bun-linux-arm64" },
  { name: "windows-x64", flag: "--target=bun-windows-x64" },
];

await $`mkdir -p ../../dist`;
for (const t of TARGETS) {
  const out = `../../dist/prixmaviz-${t.name}${t.name.startsWith("windows") ? ".exe" : ""}`;
  console.log(`building ${out}…`);
  await $`bun build src/cli.ts --compile ${t.flag} --outfile ${out}`;
}
console.log("done.");
