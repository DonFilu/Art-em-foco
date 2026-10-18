const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const { checkDatabase } = require('./db');
const port = process.env.PORT || 3000;
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };
http.createServer((req,res)=>{
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400); return res.end('Requisição inválida'); }
  if(pathname === '/api/database/status') {
    if(req.method !== 'GET') { res.writeHead(405); return res.end('Método não permitido'); }
    checkDatabase().then(() => {
      res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
      res.end(JSON.stringify({ connected: true }));
    }).catch(() => {
      res.writeHead(503, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
      res.end(JSON.stringify({ connected: false }));
    });
    return;
  }
  if(pathname === '/') pathname = '/index.html';
  if(['/db.js','/package.json','/package-lock.json'].includes(pathname) || pathname.startsWith('/.')) { res.writeHead(404); return res.end('Não encontrado'); }
  const file = path.resolve(root, '.' + pathname);
  if(file !== root && !file.startsWith(root + path.sep)){ res.writeHead(403); return res.end('Acesso negado'); }
  fs.readFile(file,(err,data)=>{
    if(err){ res.writeHead(err.code === 'ENOENT' ? 404 : 500); return res.end('Arquivo indisponível'); }
    res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff'});
    res.end(data);
  });
}).listen(port,'0.0.0.0',()=>console.log('Art em Foco online na porta '+port));
