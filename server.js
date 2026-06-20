// Крошечный сервер без зависимостей. Railway запускает `npm start` -> node server.js.
// Слушает 0.0.0.0:$PORT (PORT задаёт Railway) и на любой запрос отдаёт index.html.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PAGE = path.join(__dirname, 'index.html');

http.createServer((req, res) => {
  fs.readFile(PAGE, (err, html) => {
    if (err) { res.writeHead(500); return res.end('Server error'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}).listen(PORT, '0.0.0.0', () => console.log('akov.tech placeholder on :' + PORT));
