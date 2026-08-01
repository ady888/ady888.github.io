import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built game can be dropped into any sub-folder of a
  // static host (e.g. a GitHub Pages project directory) without rewriting URLs.
  base: "./",
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@babylonjs/havok")) return "havok";
          if (id.includes("@babylonjs")) return "babylon";
          return undefined;
        },
      },
    },
  },
  // The Havok WASM binary is fetched at runtime; keep it out of dep pre-bundling.
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
  },
});
