(()=>{'use strict';
const list=document.getElementById('notificationsList');if(!list)return;
const requestedId=new URLSearchParams(location.search).get('id')||'';
const selectedId=/^[0-9a-f]{24}$/.test(requestedId)?requestedId:null;
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
   const date=document.createElement('small');date.className='notification-date';const when=new Date(n.createdAt);date.textContent=Number.isNaN(when.getTime())?'':when.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
   btn.append(label,heading,hint,date);
   const detail=document.createElement('div');detail.className='notification-detail';detail.hidden=true;const description=document.createElement('p');description.textContent=n.body;detail.append(description);
   if(n.artistId){
    const actions=document.createElement('div');actions.className='notification-actions';
    const profile=document.createElement('a');profile.href='/artista.html?id='+encodeURIComponent(n.artistId);profile.textContent='Ver perfil';profile.className='notification-profile';
    if(n.status==='pending'){
     for(const [action,text] of [['accept','✓ Aceitar'],['decline','✕ Recusar']]){
      const button=document.createElement('button');button.type='button';button.textContent=text;button.className='notification-action '+action;
      button.addEventListener('click',async()=>{
       if(button.disabled)return;for(const b of actions.querySelectorAll('button'))b.disabled=true;
       try{const r=await fetch('/api/community/friends/respond',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({artistId:n.artistId,action})});if(!r.ok){const data=await r.json().catch(()=>({}));throw Error(data.error||'Não foi possível responder ao convite')}n.status=action==='accept'?'accepted':'declined';n.readAt=new Date().toISOString();label.textContent='✓ Vista';card.classList.add('is-read');actions.querySelectorAll('button').forEach(b=>b.remove());const result=document.createElement('span');result.textContent=action==='accept'?'Pedido aceito':'Pedido recusado';actions.prepend(result)}
       catch(e){alert(e.message);for(const b of actions.querySelectorAll('button'))b.disabled=false}
      });actions.append(button)
     }
    }else{const status=document.createElement('span');status.textContent=n.status==='accepted'?'Pedido aceito':'Pedido recusado';actions.append(status)}
    actions.append(profile);detail.append(actions);
   }
   if(n.link){const link=document.createElement('a');link.href=n.link;link.className='notification-profile';link.textContent='Ver interação';detail.append(link)}
   async function setOpen(open){
    detail.hidden=!open;btn.setAttribute('aria-expanded',String(open));hint.textContent=open?'Toque para fechar':'Toque para ler';
    if(open&&!n.readAt){
     try{const r=await fetch('/api/notifications/'+encodeURIComponent(n.id)+'/read',{method:'PATCH',credentials:'same-origin'});if(!r.ok)throw Error();n.readAt=new Date().toISOString();label.textContent='✓ Vista';card.classList.add('is-read')}catch{label.textContent='● Nova notificação'}
    }
   }
   btn.addEventListener('click',()=>setOpen(detail.hidden));card.append(btn,detail);list.append(card);
   if(n.id===selectedId)setOpen(true)
  }
 }catch{message('Não foi possível carregar as notificações. Atualize a página para tentar novamente.')}
}
load();
})();
