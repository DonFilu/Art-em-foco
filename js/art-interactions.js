(()=>{'use strict';
 const MAX=2000,$=tag=>document.createElement(tag);
 async function api(url,options={}){const response=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options}),data=await response.json().catch(()=>({}));if(!response.ok){if(response.status===401)location.href='/?login=required';throw Error(data.error||'Não foi possível concluir a interação')}return data}
 function when(value){const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}
 function action(label,aria,handler,className=''){const button=$('button');button.type='button';button.className='art-interaction-button '+className;button.textContent=label;button.setAttribute('aria-label',aria||label);button.addEventListener('click',handler);return button}
 function author(comment){const box=$('div'),profile=$('a'),avatar=$('span'),name=$('strong'),date=$('small');box.className='art-comment-author';profile.className='art-comment-profile';profile.href='/artista.html?id='+encodeURIComponent(comment.author.id);profile.setAttribute('aria-label','Abrir perfil de '+comment.author.name);avatar.className='art-comment-avatar';window.ArtEmFocoAvatar?.set(avatar,comment.author);name.textContent=comment.author.name;date.textContent=when(comment.createdAt);profile.append(avatar,name);box.append(profile,date);return box}
 function attach(post,options={}){
  const root=$('section'),bar=$('div'),like=action('♡ '+(post.likeCount||0),'Curtir publicação',toggleLike),comments=action('💬 '+(post.commentCount||0),'Ver comentários',toggleComments),panel=$('div'),status=$('p'),list=$('div'),form=$('form'),input=$('textarea'),send=$('button');
  root.className='art-interactions';root.dataset.postId=post.id;bar.className='art-interaction-bar';panel.className='art-comments';panel.hidden=true;status.className='art-comment-status';status.setAttribute('role','status');list.className='art-comment-list';form.className='art-comment-form';input.maxLength=MAX;input.rows=2;input.placeholder='Escreva um comentário…';input.setAttribute('aria-label','Escreva um comentário');send.type='submit';send.textContent='Enviar';if(post.likedByViewer){like.classList.add('is-liked');like.textContent='♥ '+(post.likeCount||0)}bar.append(like,comments);form.append(input,send);panel.append(status,list,form);root.append(bar,panel);
  let cursor=null,loaded=false,loading=false;
  const setCount=(button,icon,count)=>button.textContent=icon+' '+Math.max(0,Number(count)||0);
  const setCommentCount=count=>{post.commentCount=Math.max(0,Number(count)||0);setCount(comments,'💬',post.commentCount)};
  async function toggleLike(){try{like.disabled=true;const liked=like.classList.contains('is-liked'),result=await api('/api/art/posts/'+post.id+'/like',{method:liked?'DELETE':'PUT'});like.classList.toggle('is-liked',result.liked);setCount(like,result.liked?'♥':'♡',result.likesCount)}catch(error){status.textContent=error.message}finally{like.disabled=false}}
  async function toggleComments(){panel.hidden=!panel.hidden;if(!panel.hidden&&!loaded)await loadComments(true)}
  function removeMore(holder){holder.querySelectorAll(':scope > .art-load-more').forEach(button=>button.remove())}
  function addMore(holder,label,handler){removeMore(holder);holder.append(action(label,label,handler,'art-load-more'))}
  async function loadComments(reset=false){if(loading)return;loading=true;if(reset){cursor=null;list.replaceChildren();loaded=true}status.textContent='Carregando comentários…';try{const data=await api('/api/art/posts/'+post.id+'/comments'+(cursor?'?cursor='+encodeURIComponent(cursor):''));for(const comment of data.comments||[])list.append(renderComment(comment));cursor=data.nextCursor||null;removeMore(list);if(cursor)addMore(list,'Carregar mais comentários',()=>loadComments());status.textContent=(data.comments||[]).length?'':'Ainda não há comentários.'}catch(error){status.textContent=error.message}finally{loading=false}}
  function replyRoot(card){return card.closest('.art-replies')?.closest('.art-comment')||card.closest('.art-comment')}
  function ensureReplies(card,comment){let toggle=card.querySelector(':scope > .art-replies-toggle'),holder=card.querySelector(':scope > .art-replies');if(!holder){holder=$('div');holder.className='art-replies';holder.hidden=true;card.append(holder)}if(!toggle){toggle=action('', 'Ver respostas',async()=>{if(holder.dataset.loaded==='1'){holder.hidden=!holder.hidden;toggle.textContent=holder.hidden?'Ver respostas':'Ocultar respostas';return}await loadReplies(null,holder,comment.id,toggle)},'art-replies-toggle');card.insertBefore(toggle,holder)}const count=Math.max(0,Number(comment.repliesCount)||0);toggle.dataset.count=String(count);toggle.textContent='Ver '+count+' '+(count===1?'resposta':'respostas');toggle.hidden=count===0;return {toggle,holder}}
  function replyForm(comment,card){const form=$('form'),field=$('textarea'),sendReply=$('button'),cancel=action('Cancelar','Cancelar resposta',()=>form.remove());form.className='art-reply-form';field.maxLength=MAX;field.rows=2;field.placeholder='Responder a '+comment.author.name+'…';sendReply.type='submit';sendReply.textContent='Responder';form.append(field,sendReply,cancel);form.addEventListener('submit',async event=>{event.preventDefault();const value=field.value.trim();if(!value)return status.textContent='Escreva uma resposta antes de enviar.';try{sendReply.disabled=true;const result=await api('/api/art/posts/'+post.id+'/comments',{method:'POST',body:JSON.stringify({text:value,parentId:comment.parentId||comment.id,replyToId:comment.id})}),rootCard=replyRoot(card),rootComment={...comment,id:comment.parentId||comment.id,repliesCount:result.repliesCount};if(rootCard){const replies=ensureReplies(rootCard,rootComment);replies.holder.hidden=false;replies.holder.prepend(renderComment(result.comment,true));replies.holder.dataset.loaded='1';replies.toggle.textContent='Ocultar respostas'}form.remove();setCommentCount(result.commentCount)}catch(error){status.textContent=error.message}finally{sendReply.disabled=false}});return form}
  function renderComment(comment,isReply=false){const card=$('article');card.className='art-comment'+(isReply?' art-reply':'');card.dataset.commentId=comment.id;card.append(author(comment));if(comment.replyToName){const replyTo=$('span');replyTo.className='art-reply-to';replyTo.textContent='Respondendo a @'+comment.replyToName;card.append(replyTo)}const body=$('p');body.className='art-comment-text';body.textContent=comment.text;card.append(body);const actions=$('div'),commentLike=action((comment.likedByViewer?'♥ ':'♡ ')+(comment.likesCount||0),'Curtir comentário',async()=>{try{commentLike.disabled=true;const result=await api('/api/art/posts/'+post.id+'/comments/'+comment.id+'/like',{method:comment.likedByViewer?'DELETE':'PUT'});comment.likedByViewer=result.liked;comment.likesCount=result.likesCount;commentLike.textContent=(result.liked?'♥ ':'♡ ')+result.likesCount;commentLike.classList.toggle('is-liked',result.liked)}catch(error){status.textContent=error.message}finally{commentLike.disabled=false}});actions.className='art-comment-actions';commentLike.classList.toggle('is-liked',comment.likedByViewer);actions.append(commentLike,action('Responder','Responder a comentário',()=>{card.querySelector('.art-reply-form')?.remove();card.append(replyForm(comment,card))}));if(window.artEmFocoUser?.id===comment.author.id||window.artEmFocoUser?.id===post.authorId)actions.append(action('Excluir','Excluir comentário',async()=>{if(!confirm('Excluir este comentário e as respostas associadas?'))return;try{const result=await api('/api/art/posts/'+post.id+'/comments/'+comment.id,{method:'DELETE'});setCommentCount(result.commentCount);if(isReply){const rootCard=replyRoot(card);card.remove();if(rootCard)ensureReplies(rootCard,{id:comment.parentId,repliesCount:result.repliesCount})}else await loadComments(true)}catch(error){status.textContent=error.message}}));card.append(actions);if(!isReply)ensureReplies(card,comment);return card}
  async function loadReplies(cursorValue,holder,commentId,toggle){if(holder.dataset.loading==='1')return;holder.dataset.loading='1';if(toggle)toggle.disabled=true;try{const url='/api/art/posts/'+post.id+'/comments/'+commentId+'/replies'+(cursorValue?'?cursor='+encodeURIComponent(cursorValue):''),data=await api(url);removeMore(holder);for(const reply of data.comments||[])holder.append(renderComment(reply,true));holder.dataset.loaded='1';holder.hidden=false;if(toggle)toggle.textContent='Ocultar respostas';if(data.nextCursor)addMore(holder,'Carregar mais respostas',()=>loadReplies(data.nextCursor,holder,commentId,toggle))}catch(error){status.textContent=error.message}finally{delete holder.dataset.loading;if(toggle)toggle.disabled=false}}
  form.addEventListener('submit',async event=>{event.preventDefault();const value=input.value.trim();if(!value)return status.textContent='Escreva um comentário antes de enviar.';if(value.length>MAX)return status.textContent='O comentário pode ter no máximo 2000 caracteres.';try{send.disabled=true;const data=await api('/api/art/posts/'+post.id+'/comments',{method:'POST',body:JSON.stringify({text:value})});list.prepend(renderComment(data.comment));input.value='';setCommentCount(data.commentCount);status.textContent='Comentário publicado.'}catch(error){status.textContent=error.message}finally{send.disabled=false}});
  if(options.commentId&&/^[a-f0-9]{24}$/.test(options.commentId)){
   // Follow paginated comment threads, including replies, without bypassing access checks.
   (async()=>{panel.hidden=false;await loadComments(true);let found=null;
    const seek=async()=>{
     for(let page=0;page<50;page++){
      found=list.querySelector('[data-comment-id="'+options.commentId+'"]');if(found)return true;
      const roots=[...list.querySelectorAll(':scope > .art-comment')];
      for(const parent of roots){
       const toggle=parent.querySelector(':scope > .art-replies-toggle'),holder=parent.querySelector(':scope > .art-replies');
       if(toggle&&!toggle.hidden&&holder?.dataset.loaded!=='1')await toggle.click();
       for(let replies=0;replies<50;replies++){
        found=holder?.querySelector('[data-comment-id="'+options.commentId+'"]');if(found)return true;
        const more=holder?.querySelector(':scope > .art-load-more');if(!more)break;await more.click();
       }
      }
      const more=list.querySelector(':scope > .art-load-more');if(!more)break;await more.click();
     }
     return false;
    };
    if(await seek()){found.closest('.art-replies')?.removeAttribute('hidden');found.style.outline='2px solid #8b5cf6';found.style.outlineOffset='4px';found.scrollIntoView({behavior:'smooth',block:'center'});status.textContent='Comentário encontrado.'}
    else status.textContent='Este comentário não está mais disponível ou não pôde ser localizado.';
   })().catch(()=>{status.textContent='Não foi possível localizar o comentário.'});
  }
  return root;
 }
 window.ArtEmFocoInteractions={attach};
 if(!document.querySelector('link[href="/css/art-interactions.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/css/art-interactions.css';document.head.append(css)}
 async function attachArtistGallery(attempt=0){if(location.pathname!=='/artista.html')return;const cards=[...document.querySelectorAll('.artist-post-card')];if(!cards.length){if(attempt<20)setTimeout(()=>attachArtistGallery(attempt+1),150);return}const artistId=new URLSearchParams(location.search).get('id');if(!/^AEF-\d{8,}$/.test(artistId||''))return;try{if(!window.artEmFocoUser){const me=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});if(me.ok){const data=await me.json();window.artEmFocoUser=data.user||null}}const data=await api('/api/art/posts?author='+encodeURIComponent(artistId)),posts=new Map((data.posts||[]).map(post=>[post.id,post]));cards.forEach(card=>{const source=card.querySelector('.artist-post-image')?.getAttribute('src')||'',id=/\/api\/art\/media\/([0-9a-f]{24})/.exec(source)?.[1],post=id&&posts.get(id),info=card.querySelector('.artist-post-info');if(post&&info&&!info.querySelector('.art-interactions'))info.append(attach(post))})}catch{}}
 async function openNotificationTarget(){
  const match=/^#post-([a-f0-9]{24})(?::comment-([a-f0-9]{24}))?$/.exec(location.hash);
  if(!match||location.pathname!=='/artista.html')return;
  const [ ,postId,commentId]=match;
  const card=document.getElementById('post-'+postId);
  if(!card)return;
  const image=card.querySelector('.artist-post-image');
  if(!image)return;
  const artistId=new URLSearchParams(location.search).get('id');
  try{
   const data=await api('/api/art/posts?author='+encodeURIComponent(artistId));
   const post=data.posts?.find(p=>p.id===postId);
   if(!post)return;
   const opened=document.querySelector('.aef-post-viewer');if(opened)opened.close();
   if(window.ArtEmFocoPostViewer?.open)window.ArtEmFocoPostViewer.open(post,{commentId});
   else{card.scrollIntoView({behavior:'smooth',block:'center'});if(commentId)card.querySelector('.art-interaction-bar button:last-child')?.click()}
  }catch{card.scrollIntoView({behavior:'smooth',block:'center'})}
 }
 let lastTarget='';
 async function followTarget(){if(!location.hash||lastTarget===location.hash)return;lastTarget=location.hash;await openNotificationTarget()}
 window.addEventListener('artemfoco:posts-loaded',followTarget);
 window.addEventListener('hashchange',()=>{lastTarget='';followTarget()});
 attachArtistGallery();
})();
