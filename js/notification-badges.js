(()=>{'use strict';
 const center=window.ArtEmFocoNotifications;if(!center)return;
 const menu=document.querySelector('.aef-menu');
 const links=[...document.querySelectorAll('a[href="/notificacoes.html"]')];
 if(!menu&&!links.length)return;
 function render(count){
  document.querySelectorAll('.aef-unread-dot,.aef-unread-count').forEach(el=>el.remove());
  const toggle=menu?.querySelector('.aef-menu-toggle');
  if(!count){if(toggle)toggle.setAttribute('aria-label','Abrir menu de navegação');return}
  if(toggle){const dot=document.createElement('span');dot.className='aef-unread-dot';dot.setAttribute('aria-hidden','true');toggle.append(dot);toggle.setAttribute('aria-label','Abrir menu de navegação, '+count+' notificações não vistas')}
  for(const link of links){const badge=document.createElement('span');badge.className='aef-unread-count';badge.textContent=count>99?'99+':String(count);badge.setAttribute('aria-label',count+' notificações não vistas');link.append(badge)}
 }
 center.subscribe(({state})=>render(state.unreadCount));
})();
