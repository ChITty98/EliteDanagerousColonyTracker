#!/usr/bin/env node
/**
 * Standalone server for ED Colony Tracker.
 * Serves the built static files and proxies API requests to external services.
 *
 * Usage:  node server.mjs
 *         (then open http://localhost:5173 in your browser)
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5173', 10);
const DIST = path.join(__dirname, 'dist');

// --- Token security ---
const TOKEN_FILE = path.join(__dirname, 'colony-token.txt');
let APP_TOKEN;
try {
  APP_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
} catch {
  APP_TOKEN = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(TOKEN_FILE, APP_TOKEN);
}

function isLocalhost(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function validateToken(req) {
  if (isLocalhost(req)) return true;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam === APP_TOKEN) return true;
  const tokenHeader = req.headers['x-app-token'];
  if (tokenHeader === APP_TOKEN) return true;
  return false;
}

// --- Server-side JSON state storage ---
const STATE_FILE = path.join(__dirname, 'colony-data.json');
const GALLERY_DIR = path.join(__dirname, 'colony-images');
const GALLERY_META = path.join(__dirname, 'colony-gallery.json');

// Ensure gallery directory exists
try { fs.mkdirSync(GALLERY_DIR, { recursive: true }); } catch {}

// --- Automatic backup on startup ---
const BACKUP_DIR = path.join(__dirname, 'backups');
try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}
try {
  const stateSize = fs.statSync(STATE_FILE).size;
  if (stateSize > 100) { // only backup if file has real data
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(BACKUP_DIR, `colony-data.${ts}.json`);
    fs.copyFileSync(STATE_FILE, backupPath);
    console.log(`[Backup] Created ${backupPath} (${(stateSize / 1024).toFixed(0)}KB)`);
    // Keep only last 5 backups
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('colony-data.')).sort();
    while (backups.length > 5) {
      const old = backups.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch {}
    }
  }
} catch (e) { console.warn('[Backup] Failed:', e.message); }

function readGalleryMeta() {
  try { return JSON.parse(fs.readFileSync(GALLERY_META, 'utf-8')); } catch { return {}; }
}
function writeGalleryMeta(data) {
  try { fs.writeFileSync(GALLERY_META, JSON.stringify(data)); } catch (e) { console.error('[Gallery] Write error:', e.message); }
}
let stateWriteTimer = null;
let pendingState = null;

// --- SSE (Server-Sent Events) for Companion page ---
const sseClients = [];

function broadcastEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(data);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

// Heartbeat to keep SSE connections alive
setInterval(() => {
  broadcastEvent({ type: 'heartbeat', timestamp: new Date().toISOString() });
}, 30000);

function readStateFile() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeStateDebounced(data) {
  pendingState = data;
  if (stateWriteTimer) clearTimeout(stateWriteTimer);
  stateWriteTimer = setTimeout(() => {
    if (pendingState !== null) {
      try {
        const newJson = JSON.stringify(pendingState);
        // Size-check protection: refuse to overwrite with much smaller data
        try {
          const existingSize = fs.statSync(STATE_FILE).size;
          if (existingSize > 1000 && newJson.length < existingSize * 0.3) {
            console.error(`[State] BLOCKED write — new data (${(newJson.length/1024).toFixed(0)}KB) is <30% of existing (${(existingSize/1024).toFixed(0)}KB). Possible empty state overwrite.`);
            pendingState = null;
            return;
          }
        } catch { /* file doesn't exist yet, ok to write */ }
        fs.writeFileSync(STATE_FILE, newJson);
        console.log(`[State] Saved colony-data.json (${(newJson.length / 1024).toFixed(0)}KB)`);
      } catch (e) {
        console.error('[State] Write error:', e.message);
      }
      pendingState = null;
    }
  }, 500);
}

// MIME types for static file serving
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Proxy targets (same as vite.config.ts)
const PROXIES = {
  '/edsm-api': { host: 'www.edsm.net', prefix: '/edsm-api' },
  '/ardent-api': { host: 'api.ardent-insight.com', prefix: '/ardent-api' },
  '/spansh-api': { host: 'spansh.co.uk', prefix: '/spansh-api' },
};

// --- EDMCModernOverlay TCP client ---
let overlaySocket = null;
let overlayConnected = false;
let overlayReconnectTimer = null;

function connectOverlay() {
  if (overlaySocket) {
    try { overlaySocket.destroy(); } catch {}
    overlaySocket = null;
  }
  overlayConnected = false;
  const sock = net.createConnection({ host: '127.0.0.1', port: 5010 }, () => {
    overlayConnected = true;
    console.log('[Overlay] Connected to EDMCModernOverlay');
  });
  sock.on('error', (err) => {
    console.log(`[Overlay] Connection error: ${err.message}`);
  });
  sock.on('close', () => {
    console.log('[Overlay] Connection closed, will reconnect in 60s');
    overlayConnected = false;
    overlaySocket = null;
    // Reconnect after 60 seconds
    if (overlayReconnectTimer) clearTimeout(overlayReconnectTimer);
    overlayReconnectTimer = setTimeout(connectOverlay, 60_000);
  });
  overlaySocket = sock;
}

function sendOverlayMessage(msg) {
  if (!overlayConnected || !overlaySocket) {
    console.log('[Overlay] Not connected, dropping message:', msg.id || '(no id)');
    return;
  }
  try {
    const payload = JSON.stringify(msg) + '\n';
    overlaySocket.write(payload);
    console.log('[Overlay] Sent:', msg.id, msg.text?.substring(0, 60) || '');
  } catch (err) {
    console.log(`[Overlay] Send error: ${err.message}`);
  }
}

// Initial connection attempt
connectOverlay();

/**
 * Proxy a request to an HTTPS backend.
 */
function proxyRequest(req, res, target, targetPath) {
  const options = {
    hostname: target.host,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host,
      // Remove browser origin headers that confuse APIs
      origin: undefined,
      referer: undefined,
    },
  };
  // Clean undefined headers
  Object.keys(options.headers).forEach((k) => {
    if (options.headers[k] === undefined) delete options.headers[k];
  });

  const proxyReq = https.request(options, (proxyRes) => {
    // Pass through status and headers (strip CORS — we're same-origin now)
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error(`Proxy error -> ${target.host}${targetPath}:`, err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq, { end: true });
}

/**
 * Serve a static file from dist/.
 */
function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback — serve index.html for client-side routes
      const indexPath = path.join(DIST, 'index.html');
      fs.readFile(indexPath, (err2, indexData) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexData);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    // Cache assets (hashed filenames) for 1 year, everything else no-cache
    const cacheControl = filePath.includes('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': cacheControl,
    });
    res.end(data);
  });
}

// Create server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Token validation — only for API/data routes, not static files
  const needsToken = pathname.startsWith('/api/') || pathname.startsWith('/overlay');
  if (needsToken && !validateToken(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid or missing token' }));
    return;
  }

  // State API: GET /api/state
  if (pathname === '/api/state' && req.method === 'GET') {
    const data = readStateFile();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // Token API: GET /api/network-url — returns network URL with token (localhost only)
  if (pathname === '/api/network-url' && req.method === 'GET') {
    if (!isLocalhost(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Localhost only' }));
      return;
    }
    const hostname = os.hostname();
    const networkUrl = `http://${hostname}:${PORT}?token=${APP_TOKEN}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: networkUrl, token: APP_TOKEN, hostname, port: PORT }));
    return;
  }

  // Exploration API: GET /api/exploration/:addr — single system's body data
  const exploMatch = pathname.match(/^\/api\/exploration\/(\d+)$/);
  if (exploMatch && req.method === 'GET') {
    const addr = exploMatch[1];
    const data = readStateFile();
    const cache = data.journalExplorationCache || {};
    const system = cache[addr] || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(system));
    return;
  }

  // State API: PATCH /api/state
  if (pathname === '/api/state' && req.method === 'PATCH') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        writeStateDebounced(incoming);
        // Broadcast state_updated to all other devices so they re-fetch
        const sourceIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
        broadcastEvent({ type: 'state_updated', source: sourceIp, timestamp: new Date().toISOString() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Gallery API: GET /api/gallery — returns metadata
  if (pathname === '/api/gallery' && req.method === 'GET') {
    const meta = readGalleryMeta();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(meta));
    return;
  }

  // Gallery API: PATCH /api/gallery — save metadata
  if (pathname === '/api/gallery' && req.method === 'PATCH') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        writeGalleryMeta(incoming);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Gallery API: POST /api/gallery/upload — upload image (base64 body)
  if (pathname === '/api/gallery/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { dataUrl } = JSON.parse(body);
        // Extract base64 data from data URL
        const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!match) throw new Error('Invalid data URL');
        const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        const buf = Buffer.from(match[2], 'base64');
        const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const filename = `${id}.${ext}`;
        fs.writeFileSync(path.join(GALLERY_DIR, filename), buf);
        console.log(`[Gallery] Saved ${filename} (${(buf.length / 1024).toFixed(0)}KB)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, filename, url: `/gallery-images/${filename}` }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Gallery API: DELETE /api/gallery/:filename — delete image file
  if (pathname.startsWith('/api/gallery/') && req.method === 'DELETE') {
    const filename = pathname.slice('/api/gallery/'.length);
    const filePath = path.join(GALLERY_DIR, path.basename(filename));
    try { fs.unlinkSync(filePath); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Serve gallery images (no token needed — like static files)
  if (pathname.startsWith('/gallery-images/')) {
    const filename = path.basename(pathname.slice('/gallery-images/'.length));
    const filePath = path.join(GALLERY_DIR, filename);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : 'image/jpeg';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
    });
    return;
  }

  // SSE: GET /api/events — live event stream for Companion page
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
    sseClients.push(res);
    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx >= 0) sseClients.splice(idx, 1);
    });
    return;
  }

  // Events ingress: POST /api/events — journal watcher pushes events here
  if (pathname === '/api/events' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const event = JSON.parse(body);
        event.timestamp = event.timestamp || new Date().toISOString();
        broadcastEvent(event);
        // If event has overlay data, also send to in-game overlay
        if (event.overlay) {
          sendOverlayMessage(event.overlay);
        }
      } catch (e) {
        console.error('[Events] Parse error:', e.message);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // Overlay endpoint
  if (pathname === '/overlay' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const preview = msg.text ? msg.text.substring(0, 80) : JSON.stringify(msg).substring(0, 80);
        console.log(`[Overlay] Received: ${preview}`);
        sendOverlayMessage(msg);
        console.log(`[Overlay] Forwarded to EDMC (connected: ${overlayConnected})`);
      } catch (e) {
        console.log(`[Overlay] Parse error: ${e.message}`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, connected: overlayConnected }));
    });
    return;
  }

  // Overlay status endpoint
  if (pathname === '/overlay/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connected: overlayConnected }));
    return;
  }

  // Check proxy routes
  for (const [prefix, target] of Object.entries(PROXIES)) {
    if (pathname.startsWith(prefix)) {
      const targetPath = pathname.slice(prefix.length) + url.search;
      proxyRequest(req, res, target, targetPath || '/');
      return;
    }
  }

  // Static file serving
  let filePath = path.join(DIST, pathname === '/' ? 'index.html' : pathname);
  // Prevent directory traversal
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveStatic(res, filePath);
});

server.listen(PORT, '0.0.0.0', () => {
  const hostname = os.hostname().toLowerCase();
  const localUrl = `http://localhost:${PORT}`;
  const networkUrl = `http://${hostname}:${PORT}`;
  const networkTokenUrl = `${networkUrl}?token=${APP_TOKEN}`;

  const C = '\x1b[1m\x1b[36m';
  const R = '\x1b[0m';
  const U = '\x1b[4m';
  const V = '║';
  const W = 42;
  const pad = (s) => s + ' '.repeat(Math.max(0, W - s.length));
  console.log('');
  console.log(`  ${C}╔${'═'.repeat(W)}╗${R}`);
  console.log(`  ${C}${V}${R}${pad('   ED Colony Tracker v1.1.0')}${C}${V}${R}`);
  console.log(`  ${C}${V}${R}${' '.repeat(W)}${C}${V}${R}`);
  console.log(`  ${C}${V}${R}   Local:   ${U}${localUrl}${R}${' '.repeat(Math.max(0, W - 12 - localUrl.length))}${C}${V}${R}`);
  console.log(`  ${C}${V}${R}   Network: ${U}${networkUrl}${R}${' '.repeat(Math.max(0, W - 12 - networkUrl.length))}${C}${V}${R}`);
  console.log(`  ${C}${V}${R}${' '.repeat(W)}${C}${V}${R}`);
  console.log(`  ${C}${V}${R}${pad('   Press Ctrl+C to stop')}${C}${V}${R}`);
  console.log(`  ${C}╚${'═'.repeat(W)}╝${R}`);
  console.log('');
  console.log(`  Network URL (for other devices):`);
  console.log(`  ${U}${networkTokenUrl}${R}`);
  console.log('');

  // Auto-open Chrome specifically (required for File System Access API — Firefox doesn't support it)
  const cmd = process.platform === 'win32' ? `start chrome "${localUrl}"`
    : process.platform === 'darwin' ? `open -a "Google Chrome" "${localUrl}"`
    : `google-chrome "${localUrl}"`;
  exec(cmd, (err) => {
    // Fallback to default browser if Chrome not found
    if (err) {
      const fallback = process.platform === 'win32' ? `start "" "${localUrl}"`
        : process.platform === 'darwin' ? `open "${localUrl}"`
        : `xdg-open "${localUrl}"`;
      exec(fallback, () => {});
    }
  });
});
