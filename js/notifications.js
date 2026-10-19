(()=>{'use strict';
const list=document.getElementById('notificationsList');if(!list)return;
const empty='<div class="notifications-empty"><div class="notifications-icon" aria-hidden="true">🔔</div><h2>Você ainda não tem notificações</h2><p>Quando houver novidades, elas aparecerão aqui.</p><a href="/comunidade.html">Explorar a comunidade →</a></div>';
function message(text){list.replaceChildren();const p=document.createElement('p');p.className='notifications-message';p.textContent=text;list.append(p)}
async function load(){
 message('Carregando notificações...');
 try{
  const response=await fetch('/api/notifications',{credentials:'same-origin',cache:'no-store'});
  if(response.status===401){message('Entre com Google para acessar suas notificações.');const a=document.createElement('a');a.href='/?login=required';a.textContent='Entrar com Google →';list.append(a);return}
  if(!response.ok)throw Error('Falha ao buscar notificações');
  const data=await response.json();if(!data.notifications?.length){list.innerHTML=empty;return}
  list.replaceChildren();
  for(const n of data.notifications){
   const card=document.createElement('article');card.className='notification-card'+(n.readAt?' is-read':'');
   const btn=document.createElement('button');btn.type='button';btn.className='notification-open';btn.setAttribute('aria-expanded','false');
   const label=document.createElement('span');label.className='notification-state';label.textContent=n.readAt?'✓ Vista':'● Nova notificação';
   const heading=document.createElement('strong');heading.textContent=n.title;
   const hint=document.createElement('span');hint.className='notification-hint';hint.textContent='Toque para ler';
   btn.append(label,heading,hint);
   const detail=document.createElement('div');detail.className='notification-detail';detail.hidden=true;detail.textContent=n.body;
   btn.addEventListener('click',async()=>{
    detail.hidden=!detail.hidden;btn.setAttribute('aria-expanded',String(!detail.hidden));hint.textContent=detail.hidden?'Toque para ler':'Toque para fechar';
    if(!detail.hidden&&!n.readAt){
     try{const r=await fetch('/api/notifications/'+encodeURIComponent(n.id)+'/read',{method:'PATCH',credentials:'same-origin'});if(!r.ok)throw Error();n.readAt=new Date().toISOString();label.textContent='✓ Vista';card.classList.add('is-read')}catch{label.textContent='● Nova notificação'}
    }
   });card.append(btn,detail);list.append(card)
  }
 }catch{message('Não foi possível carregar as notificações. Atualize a página para tentar novamente.')}
}
load();
})();