const http = require('http');
const fs = require('fs');
const path = require('path');
const port = 3333;

http.createServer((req, res) => {
  const file = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(file);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(port, () => console.log(`Serving on http://localhost:${port}`));
