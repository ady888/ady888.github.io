#!/usr/bin/env node
/**
 * Zero-dependency static file server for the Alley Kings package.
 *
 * The game needs to be served over HTTP rather than opened as a file: browsers
 * block ES modules and WebAssembly fetches on `file://` origins, and the Havok
 * physics engine is a WASM module. Thirty lines of Node beats asking anyone to
 * install a web server.
 *
 * It also refuses to stack up. Earlier versions walked to the next free port
 * whenever one was busy, so every relaunch left another server running and
 * opened another tab — and, far worse, those older servers kept serving the
 * older copy of the game they were started from. Someone could install three
 * updates and still be playing the first one. Now a second launch detects the
 * first, and says so.
 */
import { createServer, get as httpGet } from "node:http";
import { createReadStream, readFileSync, statSync } from "node:fs";
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

/**
 * A fingerprint for this copy of the game.
 *
 * The bundle filename carries a content hash, so it changes with every build —
 * which is exactly what is needed to tell "already running" from "an older
 * version is running".
 */
function readBuildId() {
  try {
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    const match = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
    return match ? match[1] : "unknown";
  } catch {
    return "unknown";
  }
}

const BUILD_ID = readBuildId();

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);

  // Identity endpoint, so a second launch can recognise the first.
  if (pathname === "/__alleykings") {
    response
      .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      .end(JSON.stringify({ app: "alley-kings", build: BUILD_ID, root: ROOT }));
    return;
  }

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
    // No caching at all: an updated build must never be masked by an old file.
    "cache-control": "no-store, must-revalidate",
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

/** Asks whoever holds a port whether they are an Alley Kings server. */
function identify(port) {
  return new Promise((resolvePromise) => {
    const request = httpGet(
      { host: "127.0.0.1", port, path: "/__alleykings", timeout: 800 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            resolvePromise(parsed?.app === "alley-kings" ? parsed : null);
          } catch {
            resolvePromise(null);
          }
        });
      },
    );
    request.on("error", () => resolvePromise(null));
    request.on("timeout", () => {
      request.destroy();
      resolvePromise(null);
    });
  });
}

function banner(lines) {
  console.log(`\n  ================================================\n${lines
    .map((line) => `   ${line}`)
    .join("\n")}\n  ================================================\n`);
}

async function listen(port, attemptsLeft = 12) {
  const existing = await identify(port);
  if (existing) {
    const url = `http://localhost:${port}/`;
    if (existing.build === BUILD_ID) {
      banner([
        "ALLEY KINGS is already running.",
        "",
        url,
        "",
        "Opening that one instead of starting a second copy.",
        "You can close this window.",
      ]);
      if (process.env.NO_OPEN !== "1") openBrowser(url);
    } else {
      banner([
        "An OLDER copy of Alley Kings is already running",
        `on ${url}`,
        "",
        "That is why you are seeing several tabs, and why an",
        "update can look like it changed nothing: the old",
        "server keeps serving the old files.",
        "",
        "Close the other Terminal window (or press Ctrl+C in",
        "it), then run this launcher again.",
      ]);
    }
    process.exit(0);
  }

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      // Something else owns this port; step past it rather than fight for it.
      void listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(`\n  Could not start the server: ${error.message}\n`);
      process.exit(1);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}/`;
    banner([
      "ALLEY KINGS is running.",
      "",
      url,
      `build ${BUILD_ID}`,
      "",
      "Your browser should have opened already.",
      "If not, copy that address into it.",
      "",
      "Leave this window open while you play.",
      "Close it (or press Ctrl+C) when you are done.",
    ]);
    if (process.env.NO_OPEN !== "1") openBrowser(url);
  });
}

void listen(START_PORT);
