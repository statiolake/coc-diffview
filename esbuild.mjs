import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  external: ["coc.nvim"],
  format: "cjs",
  platform: "node",
  outfile: "lib/index.js",
  sourcemap: true,
});
