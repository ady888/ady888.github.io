import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Single-file build.
 *
 * Produces one self-contained `.html` that runs by double-clicking it — no web
 * server, no install. Two things make that possible:
 *
 *  - The bundle is emitted as a classic IIFE, not an ES module. Browsers refuse
 *    to load `<script type="module">` over `file://` because the origin is
 *    opaque, so a module build would fail the moment it left a server.
 *  - Havok is aliased away. Its WASM binary is fetched at runtime, which
 *    `file://` also blocks, so the standalone build ships without it and the
 *    game falls back to static props (a path PhysicsWorld already handles).
 */
function inlineEverything(): Plugin {
  return {
    name: "alley-kings:inline-everything",
    enforce: "post",
    generateBundle(_options, bundle) {
      let js = "";
      let css = "";
      const consumed: string[] = [];

      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk" && chunk.isEntry) {
          js = chunk.code;
          consumed.push(name);
        } else if (chunk.type === "asset" && name.endsWith(".css")) {
          css += String(chunk.source);
          consumed.push(name);
        }
      }
      for (const name of consumed) delete bundle[name];

      const html = bundle["index.html"];
      if (html && html.type === "asset") {
        let source = String(html.source);
        // Drop the emitted tags; we are replacing them with inline content.
        source = source
          .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "")
          .replace(/<link[^>]*rel="stylesheet"[^>]*>/g, "");
        // The replacements MUST be functions, not strings: a replacement string
        // treats `$$`, `$&`, `$1` etc. as substitution patterns, which quietly
        // mangles any `$` in the bundled code (it ate the `$` off the HUD's
        // cash readout the first time round).
        const safeJs = js.replace(/<\/script>/gi, "<\\/script>");
        source = source
          .replace("</head>", () => `<style>\n${css}\n</style>\n</head>`)
          .replace("</body>", () => `<script>\n${safeJs}\n</script>\n</body>`);
        html.source = source;
        html.fileName = "alley-kings.html";
      }
    },
  };
}

export default defineConfig({
  base: "./",
  resolve: {
    alias: [
      {
        find: /^\.\/HavokLoader$/,
        replacement: resolve(here, "src/core/HavokLoader.stub.ts"),
      },
    ],
  },
  build: {
    target: "es2022",
    outDir: "dist-standalone",
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "bundle.js",
      },
    },
  },
  plugins: [
    inlineEverything(),
    {
      // Vite always writes index.html; rename leftovers away after the write.
      name: "alley-kings:tidy",
      closeBundle() {
        const stray = resolve(here, "dist-standalone/index.html");
        try {
          const contents = readFileSync(stray, "utf8");
          if (contents.includes("<canvas")) {
            writeFileSync(resolve(here, "dist-standalone/alley-kings.html"), contents);
          }
          rmSync(stray);
        } catch {
          /* nothing to tidy */
        }
      },
    },
  ],
});
