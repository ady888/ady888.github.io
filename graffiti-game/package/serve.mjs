#!/usr/bin/env node
/**
 * Zero-dependency static file server for the Alley Kings package.
 *
 * The game needs to be served over HTTP rather than opened as a file: browsers
 * block ES modules and WebAssembly fetches on `file://` origins, and the Havok
 * physics engine is a WASM module. Thirty lines of Node beats asking anyone to
 * install a web server.
 */
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = resolve(fileURLToPath(new URL("./game", import.meta.url)));
const START_PORT = Number(process.env.PORT) || 8765;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  // Refuse to serve anything outside the game folder.
  const target = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(ROOT)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let stats;
  try {
    stats = statSync(target);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  if (stats.isDirectory()) {
    response.writeHead(302, { location: `${pathname}/` }).end();
    return;
  }

  response.writeHead(200, {
    "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
    "content-length": stats.size,
    "cache-control": "no-cache",
  });
  createReadStream(target).pipe(response);
});

/** Opens the player's default browser, per platform. */
function openBrowser(url) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* the URL is printed below either way */
  }
}

function listen(port, attemptsLeft = 12) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(`\n  Could not start the server: ${error.message}\n`);
      process.exit(1);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}/`;
    console.log(`
  ================================================
   ALLEY KINGS is running.

   ${url}

   Your browser should have opened already.
   If not, copy that address into it.

   Leave this window open while you play.
   Close it (or press Ctrl+C) when you are done.
  ================================================
`);
    if (process.env.NO_OPEN !== "1") openBrowser(url);
  });
}

listen(START_PORT);
