// Kokoaa src/index.ts:n yhdeksi ajettavaksi CommonJS-bundleksi (index.cjs),
// johon niputetaan myos node_modules-riippuvuudet. Nain plugin toimii ilman
// erillista `npm install`:ia kayttajan koneella.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "index.cjs",
  // Shebang tulee automaattisesti sailytettyna src/index.ts:n rivilta 1,
  // joten erillista banneria ei tarvita (tuplaisi shebangin -> syntaksivirhe).
});

console.error("Built index.cjs");
