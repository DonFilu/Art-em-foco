(()=>{'use strict';
const screen=document.getElementById('entryScreen'),button=document.getElementById('entryButton'),mount=document.getElementById('googleSignIn'),message=document.getElementById('loginMessage');
if(!screen||!button)return;
function enter(){screen.hidden=true;window.dispatchEvent(new Event('artemfoco:entered'))}
button.addEventListener('click',enter);
async function startGoogle(){
  try{
    const config=await fetch('/api/auth/config',{cache:'no-store'}).then(r=>r.json());
    if(!config.clientId){message.textContent='Login com Google aguardando configuração. Você pode continuar como visitante.';return}
    for(let attempt=0;attempt<40&&!window.google?.accounts?.id;attempt++)await new Promise(r=>setTimeout(r,150));
    if(!window.google?.accounts?.id){message.textContent='Não foi possível carregar o login Google. Continue como visitante.';return}
    google.accounts.id.initialize({client_id:config.clientId,callback:async ({credential})=>{
      try{
        message.textContent='Verificando sua conta...';
        const response=await fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential})});
        if(!response.ok)throw new Error('Não foi possível autenticar');
        const result=await response.json();
        window.artEmFocoUser=result.user;
        window.dispatchEvent(new CustomEvent('artemfoco:authenticated',{detail:result.user}));
        enter();
      }catch{message.textContent='Falha no login. Tente novamente ou continue como visitante.'}
    }});
    google.accounts.id.renderButton(mount,{theme:'outline',size:'large',shape:'pill',text:'continue_with',width:300});
  }catch{message.textContent='Login temporariamente indisponível. Continue como visitante.'}
}
startGoogle();
})();