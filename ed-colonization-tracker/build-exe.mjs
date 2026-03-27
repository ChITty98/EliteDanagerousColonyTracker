#!/usr/bin/env node
/**
 * Build script: Creates a standalone server.cjs with embedded dist/ files,
 * then produces a .bat launcher (and attempts SEA .exe if possible).
 *
 * Usage:  node build-exe.mjs
 * Output: ed-colony-tracker.bat + server-bundled.cjs (always)
 *         ed-colony-tracker.exe (if SEA succeeds)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const OUT_CJS = path.join(__dirname, 'server-bundled.cjs');

// Auto-incrementing build number from timestamp (MMDDHHmm)
const now = new Date();
const BUILD_ID = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '.' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
const VERSION = `v1.1.0-b${BUILD_ID}`;

// Step 1: Build the Vite project
console.log('Building Vite project...');
execSync('npx vite build', { cwd: __dirname, stdio: 'inherit' });

// Step 2: Read all dist files into a JS object
console.log('Embedding dist/ files...');
function readDirRecursive(dir, base) {
  base = base || '';
  const entries = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = base ? base + '/' + entry.name : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(entries, readDirRecursive(fullPath, relPath));
    } else {
      entries['/' + relPath] = fs.readFileSync(fullPath).toString('base64');
    }
  }
  return entries;
}

const files = readDirRecursive(DIST);
console.log('  Embedded ' + Object.keys(files).length + ' files');

// Step 3: Generate bundled CJS server with embedded files
const serverLines = [
  '"use strict";',
  'const http = require("node:http");',
  'const https = require("node:https");',
  'const net = require("node:net");',
  'const fs = require("node:fs");',
  'const pathMod = require("node:path");',
  'const crypto = require("node:crypto");',
  '',
  'const PORT = parseInt(process.env.PORT || "5173", 10);',
  '',
  '// --- Token security ---',
  'var appDir = pathMod.dirname(process.execPath || process.argv[0]);',
  'var TOKEN_FILE = pathMod.join(appDir, "colony-token.txt");',
  'var APP_TOKEN;',
  'try { APP_TOKEN = fs.readFileSync(TOKEN_FILE, "utf-8").trim(); } catch(e) {',
  '  APP_TOKEN = crypto.randomBytes(16).toString("hex");',
  '  try { fs.writeFileSync(TOKEN_FILE, APP_TOKEN); } catch(e2) { console.log("[Token] Could not save token file:", e2.message); }',
  '}',
  '',
  'function isLocalhost(req) {',
  '  var addr = req.socket.remoteAddress;',
  '  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";',
  '}',
  '',
  'function validateToken(req) {',
  '  if (isLocalhost(req)) return true;',
  '  var url = new URL(req.url, "http://localhost:" + PORT);',
  '  var tokenParam = url.searchParams.get("token");',
  '  if (tokenParam === APP_TOKEN) return true;',
  '  var tokenHeader = req.headers["x-app-token"];',
  '  if (tokenHeader === APP_TOKEN) return true;',
  '  return false;',
  '}',
  '',
  '// --- Server-side JSON state storage ---',
  'var STATE_FILE = pathMod.join(appDir, "colony-data.json");',
  'var GALLERY_DIR = pathMod.join(appDir, "colony-images");',
  'var GALLERY_META = pathMod.join(appDir, "colony-gallery.json");',
  'try { fs.mkdirSync(GALLERY_DIR, { recursive: true }); } catch(e) {}',
  'function readGalleryMeta() { try { return JSON.parse(fs.readFileSync(GALLERY_META, "utf-8")); } catch(e) { return {}; } }',
  'function writeGalleryMeta(data) { try { fs.writeFileSync(GALLERY_META, JSON.stringify(data)); } catch(e) { console.error("[Gallery] Write error:", e.message); } }',
  'var stateWriteTimer = null;',
  'var pendingState = null;',
  '',
  '// --- SSE (Server-Sent Events) for Companion page ---',
  'var sseClients = [];',
  'function broadcastEvent(event) {',
  '  var data = "data: " + JSON.stringify(event) + "\\n\\n";',
  '  for (var i = sseClients.length - 1; i >= 0; i--) {',
  '    try { sseClients[i].write(data); } catch(e) { sseClients.splice(i, 1); }',
  '  }',
  '}',
  'setInterval(function() { broadcastEvent({ type: "heartbeat", timestamp: new Date().toISOString() }); }, 30000);',
  '',
  'function readStateFile() {',
  '  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")); } catch(e) { return {}; }',
  '}',
  '',
  'function writeStateDebounced(data) {',
  '  pendingState = data;',
  '  if (stateWriteTimer) clearTimeout(stateWriteTimer);',
  '  stateWriteTimer = setTimeout(function() {',
  '    if (pendingState !== null) {',
  '      try {',
  '        fs.writeFileSync(STATE_FILE, JSON.stringify(pendingState));',
  '        console.log("[State] Saved colony-data.json (" + (JSON.stringify(pendingState).length / 1024).toFixed(0) + "KB)");',
  '      } catch(e) { console.error("[State] Write error:", e.message); }',
  '      pendingState = null;',
  '    }',
  '  }, 500);',
  '}',
  '',
  'const MIME = {',
  '  ".html": "text/html",',
  '  ".js": "application/javascript",',
  '  ".css": "text/css",',
  '  ".json": "application/json",',
  '  ".png": "image/png",',
  '  ".jpg": "image/jpeg",',
  '  ".svg": "image/svg+xml",',
  '  ".ico": "image/x-icon",',
  '  ".woff": "font/woff",',
  '  ".woff2": "font/woff2",',
  '  ".ttf": "font/ttf",',
  '};',
  '',
  'const FILES = ' + JSON.stringify(files) + ';',
  '',
  'const PROXIES = {',
  '  "/edsm-api": { host: "www.edsm.net", prefix: "/edsm-api" },',
  '  "/ardent-api": { host: "api.ardent-insight.com", prefix: "/ardent-api" },',
  '  "/spansh-api": { host: "spansh.co.uk", prefix: "/spansh-api" },',
  '};',
  '',
  'function proxyRequest(req, res, target, targetPath) {',
  '  const headers = Object.assign({}, req.headers, { host: target.host });',
  '  delete headers.origin;',
  '  delete headers.referer;',
  '  const proxyReq = https.request({',
  '    hostname: target.host,',
  '    port: 443,',
  '    path: targetPath,',
  '    method: req.method,',
  '    headers: headers,',
  '  }, function(proxyRes) {',
  '    res.writeHead(proxyRes.statusCode, proxyRes.headers);',
  '    proxyRes.pipe(res, { end: true });',
  '  });',
  '  proxyReq.on("error", function(err) {',
  '    console.error("Proxy error:", err.message);',
  '    res.writeHead(502, { "Content-Type": "text/plain" });',
  '    res.end("Bad Gateway");',
  '  });',
  '  req.pipe(proxyReq, { end: true });',
  '}',
  '',
  '// --- EDMCModernOverlay TCP client ---',
  'var overlaySocket = null;',
  'var overlayConnected = false;',
  'var overlayReconnectTimer = null;',
  '',
  'function connectOverlay() {',
  '  if (overlaySocket) { try { overlaySocket.destroy(); } catch(e) {} overlaySocket = null; }',
  '  overlayConnected = false;',
  '  var sock = net.createConnection({ host: "127.0.0.1", port: 5010 }, function() {',
  '    overlayConnected = true;',
  '    console.log("[Overlay] Connected to EDMCModernOverlay");',
  '  });',
  '  sock.on("error", function() {});',
  '  sock.on("close", function() {',
  '    overlayConnected = false;',
  '    overlaySocket = null;',
  '    if (overlayReconnectTimer) clearTimeout(overlayReconnectTimer);',
  '    overlayReconnectTimer = setTimeout(connectOverlay, 60000);',
  '  });',
  '  overlaySocket = sock;',
  '}',
  '',
  'function sendOverlayMessage(msg) {',
  '  if (!overlayConnected || !overlaySocket) return;',
  '  try { overlaySocket.write(JSON.stringify(msg) + "\\n"); } catch(e) {}',
  '}',
  '',
  'connectOverlay();',
  '',
  'function serveFile(res, filePath) {',
  '  var data = FILES[filePath];',
  '  if (!data) {',
  '    var index = FILES["/index.html"];',
  '    if (!index) { res.writeHead(404); res.end("Not found"); return; }',
  '    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });',
  '    res.end(Buffer.from(index, "base64"));',
  '    return;',
  '  }',
  '  var ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();',
  '  var mime = MIME[ext] || "application/octet-stream";',
  '  var cache = filePath.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";',
  '  res.writeHead(200, { "Content-Type": mime, "Cache-Control": cache });',
  '  res.end(Buffer.from(data, "base64"));',
  '}',
  '',
  'var server = http.createServer(function(req, res) {',
  '  var url = new URL(req.url, "http://localhost:" + PORT);',
  '  var pathname = url.pathname;',
  '',
  '  // Token validation — only for API/data routes, not static files',
  '  var needsToken = pathname.startsWith("/api/") || pathname.startsWith("/overlay");',
  '  if (needsToken && !validateToken(req)) {',
  '    res.writeHead(401, { "Content-Type": "application/json" });',
  '    res.end(JSON.stringify({ error: "Invalid or missing token" }));',
  '    return;',
  '  }',
  '',
  '  // State API: GET /api/state',
  '  if (pathname === "/api/state" && req.method === "GET") {',
  '    var data = readStateFile();',
  '    res.writeHead(200, { "Content-Type": "application/json" });',
  '    res.end(JSON.stringify(data));',
  '    return;',
  '  }',
  '',
  '  // State API: PATCH /api/state',
  '  if (pathname === "/api/state" && req.method === "PATCH") {',
  '    var body = "";',
  '    req.on("data", function(chunk) { body += chunk; });',
  '    req.on("end", function() {',
  '      try {',
  '        var incoming = JSON.parse(body);',
  '        writeStateDebounced(incoming);',
  '        res.writeHead(200, { "Content-Type": "application/json" });',
  '        res.end(JSON.stringify({ ok: true }));',
  '      } catch(e) {',
  '        res.writeHead(400, { "Content-Type": "application/json" });',
  '        res.end(JSON.stringify({ error: e.message }));',
  '      }',
  '    });',
  '    return;',
  '  }',
  '',
  '  // Gallery API: GET /api/gallery',
  '  if (pathname === "/api/gallery" && req.method === "GET") {',
  '    var meta = readGalleryMeta();',
  '    res.writeHead(200, { "Content-Type": "application/json" });',
  '    res.end(JSON.stringify(meta));',
  '    return;',
  '  }',
  '',
  '  // Gallery API: PATCH /api/gallery',
  '  if (pathname === "/api/gallery" && req.method === "PATCH") {',
  '    var body = "";',
  '    req.on("data", function(chunk) { body += chunk; });',
  '    req.on("end", function() {',
  '      try {',
  '        var incoming = JSON.parse(body);',
  '        writeGalleryMeta(incoming);',
  '        res.writeHead(200, { "Content-Type": "application/json" });',
  '        res.end(JSON.stringify({ ok: true }));',
  '      } catch(e) {',
  '        res.writeHead(400, { "Content-Type": "application/json" });',
  '        res.end(JSON.stringify({ error: e.message }));',
  '      }',
  '    });',
  '    return;',
  '  }',
  '',
  '  // Gallery API: POST /api/gallery/upload',
  '  if (pathname === "/api/gallery/upload" && req.method === "POST") {',
  '    var body = "";',
  '    req.on("data", function(chunk) { body += chunk; });',
  '    req.on("end", function() {',
  '      try {',
  '        var parsed = JSON.parse(body);',
  '        var match = parsed.dataUrl.match(/^data:image\\/(\\w+);base64,(.+)$/);',
  '        if (!match) throw new Error("Invalid data URL");',
  '        var ext = match[1] === "jpeg" ? "jpg" : match[1];',
  '        var buf = Buffer.from(match[2], "base64");',
  '        var id = "img_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);',
  '        var filename = id + "." + ext;',
  '        fs.writeFileSync(pathMod.join(GALLERY_DIR, filename), buf);',
  '        console.log("[Gallery] Saved " + filename + " (" + (buf.length / 1024).toFixed(0) + "KB)");',
  '        res.writeHead(200, { "Content-Type": "application/json" });',
  '        res.end(JSON.stringify({ id: id, filename: filename, url: "/gallery-images/" + filename }));',
  '      } catch(e) {',
  '        res.writeHead(400, { "Content-Type": "application/json" });',
  '        res.end(JSON.stringify({ error: e.message }));',
  '      }',
  '    });',
  '    return;',
  '  }',
  '',
  '  // Gallery API: DELETE /api/gallery/:filename',
  '  if (pathname.indexOf("/api/gallery/") === 0 && req.method === "DELETE") {',
  '    var filename = pathname.slice("/api/gallery/".length);',
  '    var filePath = pathMod.join(GALLERY_DIR, pathMod.basename(filename));',
  '    try { fs.unlinkSync(filePath); } catch(e) {}',
  '    res.writeHead(200, { "Content-Type": "application/json" });',
  '    res.end(JSON.stringify({ ok: true }));',
  '    return;',
  '  }',
  '',
  '  // Serve gallery images (no token needed)',
  '  if (pathname.indexOf("/gallery-images/") === 0) {',
  '    var filename = pathMod.basename(pathname.slice("/gallery-images/".length));',
  '    var filePath = pathMod.join(GALLERY_DIR, filename);',
  '    try {',
  '      var imgData = fs.readFileSync(filePath);',
  '      var ext = pathMod.extname(filename).toLowerCase();',
  '      var mime = (ext === ".jpg" || ext === ".jpeg") ? "image/jpeg" : ext === ".png" ? "image/png" : "image/jpeg";',
  '      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });',
  '      res.end(imgData);',
  '    } catch(e) { res.writeHead(404); res.end("Not found"); }',
  '    return;',
  '  }',
  '',
  '  // SSE: GET /api/events',
  '  if (pathname === "/api/events" && req.method === "GET") {',
  '    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" });',
  '    res.write("data: " + JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }) + "\\n\\n");',
  '    sseClients.push(res);',
  '    req.on("close", function() { var idx = sseClients.indexOf(res); if (idx >= 0) sseClients.splice(idx, 1); });',
  '    return;',
  '  }',
  '',
  '  // Events ingress: POST /api/events',
  '  if (pathname === "/api/events" && req.method === "POST") {',
  '    var body = "";',
  '    req.on("data", function(chunk) { body += chunk; });',
  '    req.on("end", function() {',
  '      try {',
  '        var event = JSON.parse(body);',
  '        event.timestamp = event.timestamp || new Date().toISOString();',
  '        broadcastEvent(event);',
  '        if (event.overlay) { sendOverlayMessage(event.overlay); }',
  '      } catch(e) { console.error("[Events] Parse error:", e.message); }',
  '      res.writeHead(200, { "Content-Type": "application/json" });',
  '      res.end(JSON.stringify({ ok: true }));',
  '    });',
  '    return;',
  '  }',
  '',
  '  if (pathname === "/overlay" && req.method === "POST") {',
  '    var body = "";',
  '    req.on("data", function(chunk) { body += chunk; });',
  '    req.on("end", function() {',
  '      try {',
  '        var msg = JSON.parse(body);',
  '        var preview = msg.text ? msg.text.substring(0, 80) : JSON.stringify(msg).substring(0, 80);',
  '        console.log("[Overlay] Received: " + preview);',
  '        sendOverlayMessage(msg);',
  '        console.log("[Overlay] Forwarded to EDMC (connected: " + overlayConnected + ")");',
  '      } catch(e) { console.log("[Overlay] Parse error: " + e.message); }',
  '      res.writeHead(200, { "Content-Type": "application/json" });',
  '      res.end(JSON.stringify({ ok: true, connected: overlayConnected }));',
  '    });',
  '    return;',
  '  }',
  '  if (pathname === "/overlay/status" && req.method === "GET") {',
  '    res.writeHead(200, { "Content-Type": "application/json" });',
  '    res.end(JSON.stringify({ connected: overlayConnected }));',
  '    return;',
  '  }',
  '  var prefixes = Object.keys(PROXIES);',
  '  for (var i = 0; i < prefixes.length; i++) {',
  '    if (pathname.startsWith(prefixes[i])) {',
  '      var target = PROXIES[prefixes[i]];',
  '      var targetPath = pathname.slice(prefixes[i].length) + url.search;',
  '      proxyRequest(req, res, target, targetPath || "/");',
  '      return;',
  '    }',
  '  }',
  '  serveFile(res, pathname === "/" ? "/index.html" : pathname);',
  '});',
  '',
  'server.listen(PORT, "0.0.0.0", function() {',
  '  var os = require("node:os");',
  '  var hostname = os.hostname().toLowerCase();',
  '  var localUrl = "http://localhost:" + PORT;',
  '  var networkUrl = "http://" + hostname + ":" + PORT;',
  '  var networkTokenUrl = networkUrl + "?token=" + APP_TOKEN;',
  '  var W = 42;',
  '  var C = "\\x1b[1m\\x1b[36m";',
  '  var R = "\\x1b[0m";',
  '  var U = "\\x1b[4m";',
  '  var V = "\\u2551";',
  '  function pad(s) { return s + " ".repeat(Math.max(0, W - s.length)); }',
  '  console.log("");',
  '  console.log("  " + C + "\\u2554" + "\\u2550".repeat(W) + "\\u2557" + R);',
  `  console.log("  " + C + V + R + pad("   ED Colony Tracker ${VERSION}") + C + V + R);`,
  '  console.log("  " + C + V + R + " ".repeat(W) + C + V + R);',
  '  console.log("  " + C + V + R + "   Local:   " + U + localUrl + R + " ".repeat(Math.max(0, W - 12 - localUrl.length)) + C + V + R);',
  '  console.log("  " + C + V + R + "   Network: " + U + networkUrl + R + " ".repeat(Math.max(0, W - 12 - networkUrl.length)) + C + V + R);',
  '  console.log("  " + C + V + R + " ".repeat(W) + C + V + R);',
  '  console.log("  " + C + V + R + pad("   Press Ctrl+C to stop") + C + V + R);',
  '  console.log("  " + C + "\\u255a" + "\\u2550".repeat(W) + "\\u255d" + R);',
  '  console.log("");',
  '  console.log("  Network URL (for other devices):");',
  '  console.log("  " + U + networkTokenUrl + R);',
  '  console.log("");',
  '  var cp = require("node:child_process");',
  '  var cmd = process.platform === "win32" ? \'start chrome "\' + localUrl + \'"\' : process.platform === "darwin" ? \'open -a "Google Chrome" "\' + localUrl + \'"\' : \'google-chrome "\' + localUrl + \'"\';',
  '  cp.exec(cmd, function(err) {',
  '    if (err) {',
  '      var fallback = process.platform === "win32" ? \'start "" "\' + localUrl + \'"\' : process.platform === "darwin" ? \'open "\' + localUrl + \'"\' : \'xdg-open "\' + localUrl + \'"\';',
  '      cp.exec(fallback, function() {});',
  '    }',
  '  });',
  '});',
];

fs.writeFileSync(OUT_CJS, serverLines.join('\n'));
console.log('Wrote ' + OUT_CJS);

// Step 4: Create .bat launcher (always works, no dependencies)
const batContent = '@echo off\r\ntitle ED Colony Tracker\r\necho Starting ED Colony Tracker...\r\nnode "%~dp0server-bundled.cjs"\r\npause\r\n';
const batPath = path.join(__dirname, 'ed-colony-tracker.bat');
fs.writeFileSync(batPath, batContent);
console.log('Wrote ' + batPath);

// Step 5: Attempt SEA exe build
console.log('');
console.log('Attempting SEA exe build...');

const SEA_CONFIG = path.join(__dirname, 'sea-config.json');
const SEA_BLOB = path.join(__dirname, 'sea-prep.blob');
const EXE_PATH = path.join(__dirname, 'ed-colony-tracker.exe');

let seaSuccess = false;
try {
  fs.writeFileSync(SEA_CONFIG, JSON.stringify({
    main: OUT_CJS,
    output: SEA_BLOB,
    disableExperimentalSEAWarning: true,
  }));

  execSync('node --experimental-sea-config "' + SEA_CONFIG + '"', {
    cwd: __dirname,
    stdio: 'inherit',
  });

  // Copy node.exe
  fs.copyFileSync(process.execPath, EXE_PATH);

  // Inject blob
  execSync('npx --yes postject "' + EXE_PATH + '" NODE_SEA_BLOB "' + SEA_BLOB + '" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', {
    cwd: __dirname,
    stdio: 'inherit',
  });

  seaSuccess = true;
  console.log('Created ' + EXE_PATH);
} catch (e) {
  console.log('SEA exe build failed (this is OK). Use the .bat launcher instead.');
  try { fs.unlinkSync(EXE_PATH); } catch {}
}

// Cleanup
try { fs.unlinkSync(SEA_CONFIG); } catch {}
try { fs.unlinkSync(SEA_BLOB); } catch {}

console.log('');
console.log('Done!');
if (seaSuccess) {
  console.log('  Run ed-colony-tracker.exe to start (standalone, no Node needed)');
} else {
  console.log('  Run ed-colony-tracker.bat to start (requires Node.js installed)');
  console.log('  Or:  node server-bundled.cjs');
}
console.log('');
