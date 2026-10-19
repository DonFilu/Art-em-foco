(()=>{'use strict';
const screen=document.getElementById('entryScreen'),button=document.getElementById('entryButton'),mount=document.getElementById('googleSignIn'),message=document.getElementById('loginMessage');if(!screen||!button)return;
if(new URLSearchParams(location.search).get('login')==='required')message.textContent='Entre com Google para acessar a Comunidade e os perfis. Você ainda pode criar projetos como visitante.';
function enter(){const hub=document.getElementById('hubScreen'),projects=document.getElementById('projectsScreen'),bar=document.getElementById('projectBar');if(projects)projects.hidden=true;if(bar)bar.hidden=true;if(hub)hub.hidden=false;screen.hidden=true;window.dispatchEvent(new Event('artemfoco:entered'))}
function authenticated(user){window.artEmFocoUser=user;window.dispatchEvent(new CustomEvent('artemfoco:authenticated',{detail:user}));enter()}
button.addEventListener('click',()=>{window.artEmFocoUser=null;enter()});
async function restore(){try{const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});if(r.ok){authenticated((await r.json()).user);return true}}catch{}return false}
async function startGoogle(){
if(await restore())return;
try{const config=await fetch('/api/auth/config',{cache:'no-store'}).then(r=>r.json());if(!config.clientId){message.textContent='Login Google aguardando configuração. Você pode continuar como visitante.';return}
for(let attempt=0;attempt<40&&!window.google?.accounts?.id;attempt++)await new Promise(r=>setTimeout(r,150));
if(!window.google?.accounts?.id){message.textContent='Não foi possível carregar o login Google. Continue como visitante.';return}
google.accounts.id.initialize({client_id:config.clientId,callback:async({credential})=>{try{message.textContent='Salvando seu perfil...';const response=await fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({credential})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível autenticar');authenticated(result.user)}catch(e){message.textContent=e.message||'Falha no login. Tente novamente.'}}});
google.accounts.id.renderButton(mount,{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:300});
}catch{message.textContent='Login temporariamente indisponível. Continue como visitante.'}}
startGoogle();
})();