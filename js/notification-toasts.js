(()=>{'use strict';
 const center=window.ArtEmFocoNotifications;if(!center)return;
 if(location.pathname==='/artista.html'&&!window.ArtEmFocoInteractions&&!document.querySelector('script[data-aef-interactions]')){const script=document.createElement('script');script.src='/js/art-interactions.js';script.dataset.aefInteractions='1';document.head.append(script)}
 const root=document.createElement('section');root.className='aef-toast-region';root.setAttribute('aria-label','Notificações recentes');root.setAttribute('aria-live','polite');
 const list=document.createElement('div');list.className='aef-toast-list';const more=document.createElement('button');more.type='button';more.className='aef-toast-more';more.hidden=true;more.addEventListener('click',()=>{location.href='/notificacoes.html'});root.append(list,more);document.body.append(root);
 const audio=new Audio('/audio/notificacao.mp3');audio.preload='auto';
 const queue=[],visible=new Map(),activeKeys=new Set(),dismissedKeys=new Set(),dismissedOrder=[];
 const MAX_REMEMBERED_KEYS=200;
 function updateMore(){const count=queue.length;more.hidden=!count;if(count)more.textContent='+'+count+(count===1?' notificação':' notificações')}
 function play(){if(!audio.paused)return;audio.currentTime=0;audio.play().catch(()=>{})}
 function rememberDismissed(key){if(dismissedKeys.has(key))return;dismissedKeys.add(key);dismissedOrder.push(key);if(dismissedOrder.length>MAX_REMEMBERED_KEYS)dismissedKeys.delete(dismissedOrder.shift())}
 function clearToasts(){queue.length=0;visible.forEach(card=>{clearTimeout(card._dismissTimer);clearTimeout(card._removeTimer);card.remove()});visible.clear();activeKeys.clear();dismissedKeys.clear();dismissedOrder.length=0;updateMore()}
 function dismiss(entry,card){if(!visible.has(entry.eventKey))return;card.classList.add('is-leaving');clearTimeout(card._dismissTimer);card._removeTimer=setTimeout(()=>{visible.delete(entry.eventKey);activeKeys.delete(entry.eventKey);rememberDismissed(entry.eventKey);card.remove();render()},180)}
 function open(entry){if(entry.kind==='summary'){location.href='/notificacoes.html';return}if(/^[0-9a-f]{24}$/.test(entry.id))location.href='/notificacoes.html?id='+encodeURIComponent(entry.id)}
 function makeToast(entry){
  const card=document.createElement('article');card.className='aef-toast';
  const openButton=document.createElement('button');openButton.type='button';openButton.className='aef-toast-open';
  const icon=document.createElement('span');icon.className='aef-toast-icon';icon.setAttribute('aria-hidden','true');icon.textContent=entry.kind==='summary'?'🔔':'✦';
  const content=document.createElement('span');content.className='aef-toast-content';const title=document.createElement('strong');const body=document.createElement('span');body.className='aef-toast-body';
  if(entry.kind==='summary'){title.textContent='Você tem '+entry.count+' notificações não vistas!';body.textContent='Toque para acompanhar as novidades.'}else{title.textContent=entry.title||'Nova notificação';body.textContent=entry.body||'Você recebeu uma nova atualização.'}
  content.append(title,body);openButton.append(icon,content);
  const close=document.createElement('button');close.type='button';close.className='aef-toast-close';close.setAttribute('aria-label','Fechar notificação');close.textContent='×';close.addEventListener('click',event=>{event.stopPropagation();dismiss(entry,card)});
  let startX=0,deltaX=0,dragging=false,pointerActive=false,pointerId=null;
  function resetPointer(){pointerActive=false;pointerId=null;startX=0;deltaX=0;card.style.transform='';card.style.opacity=''}
  card.addEventListener('pointerdown',event=>{if(event.target.closest('.aef-toast-close')||event.isPrimary===false||(event.pointerType==='mouse'&&event.button!==0))return;pointerActive=true;pointerId=event.pointerId;startX=event.clientX;deltaX=0;dragging=false;card.setPointerCapture?.(event.pointerId)});
  card.addEventListener('pointermove',event=>{if(!pointerActive||event.pointerId!==pointerId)return;deltaX=event.clientX-startX;if(Math.abs(deltaX)>5)dragging=true;card.style.transform='translateX('+deltaX+'px)';card.style.opacity=String(Math.max(.35,1-Math.abs(deltaX)/260))});
  card.addEventListener('pointerup',event=>{if(!pointerActive||event.pointerId!==pointerId)return;const shouldDismiss=Math.abs(deltaX)>Math.max(80,card.offsetWidth*.24);pointerActive=false;pointerId=null;startX=0;if(shouldDismiss)dismiss(entry,card);else{card.style.transform='';card.style.opacity=''}});
  card.addEventListener('pointercancel',event=>{if(!pointerActive||event.pointerId!==pointerId)return;resetPointer()});
  openButton.addEventListener('click',event=>{if(dragging){event.preventDefault();dragging=false;return}open(entry)});
  card.append(openButton,close);card._dismissTimer=setTimeout(()=>dismiss(entry,card),6000);return card;
 }
 function render(){while(visible.size<2&&queue.length){const entry=queue.shift(),card=makeToast(entry);visible.set(entry.eventKey,card);list.append(card)}updateMore()}
 function enqueue(entries){for(const entry of entries){if(!entry?.eventKey||activeKeys.has(entry.eventKey)||dismissedKeys.has(entry.eventKey))continue;activeKeys.add(entry.eventKey);queue.push(entry)}render()}
 center.subscribe(({type,notifications,state})=>{if(type==='summary'){enqueue(notifications);if(notifications.length&&state.soundEnabled)play()}if(type==='new'){enqueue(notifications);if(notifications.length&&state.soundEnabled)play()}if(type==='signed-out'||type==='account-change')clearToasts()});
})();
