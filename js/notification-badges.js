(()=>{'use strict';
const menu=document.querySelector('.aef-menu');
const links=[...document.querySelectorAll('a[href="/notificacoes.html"]')];
if(!menu&&!links.length)return;
function render(count){
 document.querySelectorAll('.aef-unread-dot,.aef-unread-count').forEach(el=>el.remove());
 if(!count)return;
 const toggle=menu?.querySelector('.aef-menu-toggle');
 if(toggle){const dot=document.createElement('span');dot.className='aef-unread-dot';dot.setAttribute('aria-hidden','true');toggle.append(dot);toggle.setAttribute('aria-label','Abrir menu de navegação, '+count+' notificações não vistas')}
 for(const link of links){
  const badge=document.createElement('span');badge.className='aef-unread-count';badge.textContent=count>99?'99+':String(count);badge.setAttribute('aria-label',count+' notificações não vistas');link.append(badge)
 }
}
async function refresh(){
 try{const response=await fetch('/api/notifications',{credentials:'same-origin',cache:'no-store'});if(!response.ok){render(0);return}const data=await response.json();render((data.notifications||[]).filter(item=>!item.readAt).length)}
 catch{render(0)}
}
refresh();document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
})();