// Bundles the CLI for Node (what `npx tidepush` runs), with the package version baked in.
import pkg from "../package.json";

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "node",
  define: { __VERSION__: JSON.stringify(pkg.version) },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`Built dist/index.js (tidepush ${pkg.version})`);
