const http = require('http');
const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const { checkDatabase } = require('./db');
const root = __dirname;
const port = process.env.PORT || 3000;
const googleClient = new OAuth2Client();
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };
function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body))}
async function readJSON(req){
  let data='';for await(const chunk of req){data+=chunk;if(data.length>12000)throw new Error('Requisição muito grande')}
  return JSON.parse(data);
}
http.createServer(async(req,res)=>{
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { return json(res,400,{error:'Requisição inválida'}) }
  if(pathname === '/api/auth/config'){
    if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
    return json(res,200,{clientId:process.env.GOOGLE_CLIENT_ID||null});
  }
  if(pathname === '/api/auth/google'){
    if(req.method!=='POST')return json(res,405,{error:'Método não permitido'});
    if(!process.env.GOOGLE_CLIENT_ID)return json(res,503,{error:'Login Google não configurado'});
    try{
      const {credential}=await readJSON(req);
      if(typeof credential!=='string'||credential.length>10000)return json(res,400,{error:'Credencial inválida'});
      const ticket=await googleClient.verifyIdToken({idToken:credential,audience:process.env.GOOGLE_CLIENT_ID});
      const payload=ticket.getPayload();
      if(!payload?.sub||!payload.email_verified)return json(res,401,{error:'Conta não verificada'});
      // A sessão persistente e o perfil no MongoDB serão adicionados na próxima etapa.
      return json(res,200,{user:{name:payload.name||'',picture:payload.picture||'',email:payload.email||''}});
    }catch{return json(res,401,{error:'Falha ao verificar conta Google'})}
  }
  if(pathname === '/api/database/status'){
    if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
    try{await checkDatabase();return json(res,200,{connected:true})}
    catch{return json(res,503,{connected:false})}
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
