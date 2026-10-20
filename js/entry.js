(()=>{'use strict';
const screen=document.getElementById('entryScreen'),button=document.getElementById('entryButton'),mount=document.getElementById('googleSignIn'),message=document.getElementById('loginMessage');if(!screen||!button)return;
if(new URLSearchParams(location.search).get('login')==='required')message.textContent='Entre com Google para acessar a Comunidade e os perfis. Você ainda pode criar projetos como visitante.';
function welcome(done){
 if(document.getElementById('cidioWelcome'))return;
 const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 if(reduce){done();return}
 const style=document.createElement('style');style.textContent=`
 #cidioWelcome{position:fixed;inset:0;z-index:99999;overflow:hidden;display:grid;place-items:center;background:#10121d;color:#fff;isolation:isolate}
 #cidioWelcome .cw-wash{position:absolute;inset:-20%;background:linear-gradient(120deg,#9b77ff,#5ca9ff 35%,#ff75b5 68%,#ffc87d);clip-path:inset(0 100% 0 0);animation:cwPaint 1.65s cubic-bezier(.2,.8,.3,1) forwards;opacity:.86}
 #cidioWelcome .cw-brush{position:absolute;top:49%;left:-20%;font-size:clamp(58px,14vw,100px);filter:drop-shadow(0 9px 12px #0008);transform:translate(-50%,-50%) rotate(-35deg);animation:cwBrush 1.65s cubic-bezier(.2,.8,.3,1) forwards;z-index:2}
 #cidioWelcome .cw-brand{position:relative;z-index:3;text-align:center;opacity:0;transform:translateY(16px) scale(.95);animation:cwReveal .65s 1.25s ease-out forwards;text-shadow:0 4px 24px #12101c88}
 #cidioWelcome .cw-logo{display:block;width:min(72vw,330px);max-height:55vh;height:auto;object-fit:contain;filter:drop-shadow(0 15px 28px #0005)}
 #cidioWelcome .cw-skip{position:absolute;bottom:25px;right:25px;z-index:5;border:1px solid #ffffff66;border-radius:30px;background:#16162288;color:#fff;padding:10px 18px;font:500 13px system-ui,sans-serif;cursor:pointer}
 #cidioWelcome.cw-exit{animation:cwExit .5s ease-in forwards}
 @keyframes cwPaint{0%{clip-path:inset(0 100% 0 0)}100%{clip-path:inset(0 0 0 0)}}
 @keyframes cwBrush{0%{left:-15%;top:58%;transform:translate(-50%,-50%) rotate(-30deg)}45%{top:40%}100%{left:115%;top:50%;transform:translate(-50%,-50%) rotate(-15deg)}}
 @keyframes cwReveal{to{opacity:1;transform:translateY(0) scale(1)}}
 @keyframes cwExit{to{opacity:0;visibility:hidden}}
 `;document.head.append(style);
 const overlay=document.createElement('div');overlay.id='cidioWelcome';overlay.setAttribute('role','status');overlay.setAttribute('aria-label','Bem-vindo ao Cidio Art');overlay.innerHTML='<div class="cw-wash"></div><div class="cw-brush" aria-hidden="true">🖌️</div><div class="cw-brand"><img class="cw-logo" src="/assets/logo/file_00000000b1bc820eb89e7b675b7b77fa.png" alt="Cidio Art — art em foco"></div><button type="button" class="cw-skip">Pular animação →</button>';
 document.body.append(overlay);
 let finished=false;let timer;
 const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);overlay.classList.add('cw-exit');done();setTimeout(()=>{overlay.remove();style.remove()},520)};
 overlay.querySelector('.cw-skip').addEventListener('click',finish);
 overlay.addEventListener('click',e=>{if(e.target!==overlay)return;finish()});
 timer=setTimeout(finish,2800);
}
function enter(){const hub=document.getElementById('hubScreen'),projects=document.getElementById('projectsScreen'),bar=document.getElementById('projectBar');if(projects)projects.hidden=true;if(bar)bar.hidden=true;if(hub)hub.hidden=false;screen.hidden=true;window.dispatchEvent(new Event('artemfoco:entered'))}
function loadNotificationTools(){if(document.querySelector('script[data-aef-notifications]'))return;const css=document.createElement('link');css.rel='stylesheet';css.href='/css/notification-toasts.css';document.head.append(css);const center=document.createElement('script');center.src='/js/notification-center.js';center.dataset.aefNotifications='center';center.onload=()=>{const toasts=document.createElement('script');toasts.src='/js/notification-toasts.js';toasts.dataset.aefNotifications='toasts';document.head.append(toasts)};document.head.append(center)}
function authenticated(user,notificationLogin=false){window.artEmFocoUser=user;if(notificationLogin&&typeof user?.id==='string')try{sessionStorage.setItem('aef-notification-new-login:'+user.id,'1')}catch{}loadNotificationTools();window.dispatchEvent(new CustomEvent('artemfoco:authenticated',{detail:{...user,notificationLogin}}));if(notificationLogin)welcome(enter);else enter()}
button.addEventListener('click',()=>{window.artEmFocoUser=null;welcome(enter)});
async function restore(){try{const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});if(r.ok){authenticated((await r.json()).user);return true}}catch{}return false}
async function startGoogle(){
if(await restore())return;
try{const config=await fetch('/api/auth/config',{cache:'no-store'}).then(r=>r.json());if(!config.clientId){message.textContent='Login Google aguardando configuração. Você pode continuar como visitante.';return}
for(let attempt=0;attempt<40&&!window.google?.accounts?.id;attempt++)await new Promise(r=>setTimeout(r,150));
if(!window.google?.accounts?.id){message.textContent='Não foi possível carregar o login Google. Continue como visitante.';return}
google.accounts.id.initialize({client_id:config.clientId,callback:async({credential})=>{try{message.textContent='Salvando seu perfil...';const response=await fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({credential})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível autenticar');authenticated(result.user,true)}catch(e){message.textContent=e.message||'Falha no login. Tente novamente.'}}});
google.accounts.id.renderButton(mount,{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:300});
}catch{message.textContent='Login temporariamente indisponível. Continue como visitante.'}}
startGoogle();
})();
