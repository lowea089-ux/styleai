// Builds the browser edition for static hosting (GitHub Pages): the app with Vite, the service worker – which
// runs the StyleAI server on sql.js + IndexedDB – with esbuild. Output: dist-web/
//
//   WEB_BASE=/styleai/ node scripts/build-web.mjs      (WEB_BASE = path the site is served from)
import { createHash } from "node:crypto";
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { build as vite } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-web");
const base = (process.env.WEB_BASE ?? "/styleai/").replace(/\/?$/, "/");

// 1. The app (React). vite.config.ts switches outDir, base and the service-worker registration for mode "web".
await vite({ root, mode: "web", base, logLevel: "warn" });

// 2. Static files the service worker needs.
copyFileSync(path.join(root, "node_modules/sql.js/dist/sql-wasm.wasm"), path.join(out, "sql-wasm.wasm"));
// GitHub Pages answers unknown paths (deep links before the service worker is installed) with 404.html.
copyFileSync(path.join(out, "index.html"), path.join(out, "404.html"));
writeFileSync(path.join(out, ".nojekyll"), "");

// 3. What goes into the offline cache. Big files (pose model, MediaPipe WASM) are cached on first use instead,
//    so the first visit stays light.
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? walk(abs) : [path.relative(out, abs).split(path.sep).join("/")];
  });
const files = walk(out)
  .filter((f) => !f.endsWith(".map") && !["sw.js", "404.html", ".nojekyll"].includes(f))
  .sort();
const LARGE = 2.5 * 1024 * 1024;
const precache = files.filter((f) => statSync(path.join(out, f)).size <= LARGE);
const runtime = files.filter((f) => !precache.includes(f));
const hash = createHash("sha256");
for (const f of files) hash.update(f).update(readFileSync(path.join(out, f)));
const buildId = hash.digest("hex").slice(0, 12);

// 4. The service worker: server code with browser stand-ins for Node-only modules.
const norm = (p) => (process.platform === "win32" ? path.normalize(p).toLowerCase() : path.normalize(p));
const web = (p) => path.join(root, "web", p);
const swapFiles = new Map(
  [
    ["server/db.ts", "server/db.ts"],
    ["server/images.ts", "server/images.ts"],
    ["server/tryon.ts", "server/tryon.ts"],
  ].map(([from, to]) => [norm(path.join(root, from)), web(to)]),
);
const shims = {
  "node:crypto": web("shims/crypto.ts"),
  "node:fs": web("shims/node.ts"),
  "node:fs/promises": web("shims/node.ts"),
  "node:path": web("shims/node.ts"),
  "node:sqlite": web("shims/node.ts"),
  "@hono/node-server/serve-static": web("shims/node.ts"),
  sharp: web("shims/node.ts"),
};
const browserEdition = {
  name: "styleai-browser-edition",
  setup(b) {
    // sql.js only touches these in Node; in the browser they must resolve to nothing.
    b.onResolve({ filter: /^(fs|path|crypto)$/ }, (args) => ({ path: args.path, namespace: "empty" }));
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "module.exports = {};", loader: "js" }));
    b.onResolve({ filter: /.*/ }, async (args) => {
      if (shims[args.path]) return { path: shims[args.path] };
      if (args.pluginData?.inner || !args.path.startsWith(".")) return undefined;
      const r = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { inner: true } });
      if (r.errors.length) return undefined;
      const swap = swapFiles.get(norm(r.path));
      return swap ? { path: swap } : { path: r.path };
    });
  },
};

const result = await esbuild({
  entryPoints: [web("sw.ts")],
  outfile: path.join(out, "sw.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "eof",
  inject: [web("inject.ts")],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __PRECACHE__: JSON.stringify(precache),
    __RUNTIME__: JSON.stringify(runtime),
    "process.env.NODE_ENV": '"production"',
  },
  plugins: [browserEdition],
  metafile: true,
  logLevel: "warning",
});

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const swSize = statSync(path.join(out, "sw.js")).size;
const preSize = precache.reduce((s, f) => s + statSync(path.join(out, f)).size, 0);
console.log(`dist-web fertig (Basis ${base}, Build ${buildId})`);
console.log(`  Service Worker: ${kb(swSize)} · Offline-Paket: ${precache.length} Dateien, ${kb(preSize)} · bei Bedarf: ${runtime.join(", ") || "–"}`);
if (process.env.WEB_ANALYZE) {
  const inputs = Object.entries(result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].inputs)
    .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)
    .slice(0, 15);
  for (const [f, i] of inputs) console.log(`  ${kb(i.bytesInOutput).padStart(8)}  ${f}`);
}
