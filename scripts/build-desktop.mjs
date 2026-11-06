// Bundles the Electron main process (desktop/main.ts + server) into one CommonJS file.
// sharp stays external: it ships native binaries that electron-builder unpacks from the asar archive.
import { build } from "esbuild";
import sharp from "sharp";

await build({
  entryPoints: ["desktop/main.ts"],
  outfile: "dist-desktop/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "sharp"],
  legalComments: "none",
  logLevel: "info",
});

// App icon (PNG ≥ 256 px; electron-builder converts it for Windows).
await sharp("public/favicon.svg", { density: 600 }).resize(512, 512).png().toFile("build/icon.png");
console.log("Desktop-Bundle und Icon erstellt.");
