(()=>{'use strict';
const row=document.getElementById('artistBadges'),dialog=document.getElementById('badgeDialog'),progress=document.getElementById('badgeProgress');
if(!row||!dialog)return;
const format=n=>Number(n||0).toLocaleString('pt-BR');
let badges=[];
function track(current,target){const outer=document.createElement('div');outer.className='cidio-badge-track';const fill=document.createElement('div');fill.className='cidio-badge-fill';fill.style.width=Math.min(100,Math.round(100*current/target))+'%';outer.append(fill);return outer}
function line(parent,value){const el=document.createElement('small');el.textContent=value;parent.append(el)}
function render(){
 row.replaceChildren();progress.replaceChildren();
 for(const b of badges){
 if(b.unlocked){const item=document.createElement('span');item.className='cidio-badge';item.textContent=b.icon;item.title=b.name;item.setAttribute('aria-label',b.name);row.append(item)}
 const item=document.createElement('div');item.className='cidio-badge-item';const heading=document.createElement('strong');heading.textContent=b.icon+' '+b.name+(b.unlocked?' ✓':'');item.append(heading);
 if(b.id==='influencer'){line(item,b.unlocked?'Insígnia conquistada!':'Você indica o Cidio Art e faz vídeos nas redes sociais? Entre em contato mostrando as provas das divulgações para ganhar esta insígnia.');if(!b.unlocked){const a=document.createElement('a');a.className='cidio-whatsapp';a.href='https://wa.me/5548999962908?text=Quero%20a%20ins%C3%ADgnia%20Influencer';a.target='_blank';a.rel='noopener noreferrer';a.textContent='WhatsApp · Solicitar';item.append(a)}}
 else if(b.id==='dev'||b.id==='moderator')line(item,b.unlocked?'Insígnia oficial concedida':'Insígnia oficial concedida pela equipe.');
 else if(b.id==='top')line(item,b.unlocked?'Já alcançou o Top 1!':'Conquiste o primeiro lugar do ranking de artistas.');
 else if(b.type==='both'){line(item,format(b.current)+' / '+format(b.target)+' curtidas');item.append(track(b.current,b.target));line(item,format(b.postsCurrent)+' / '+format(b.postsTarget)+' publicações');item.append(track(b.postsCurrent,b.postsTarget))}
 else {line(item,format(b.current)+' / '+format(b.target)+(b.type==='posts'?' publicações':' curtidas'));item.append(track(b.current,b.target))}
 progress.append(item)
 }
 if(!row.childNodes.length)row.title='Nenhuma insígnia conquistada ainda';
}
async function load(){const id=new URLSearchParams(location.search).get('id');if(!id)return;try{const response=await fetch('/api/badges?id='+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Não foi possível carregar insígnias');const data=await response.json();badges=data.badges||[];render()}catch(e){progress.textContent=e.message}}
document.getElementById('badgeClose').onclick=()=>dialog.close();
document.querySelectorAll('.open-badges').forEach(b=>b.addEventListener('click',()=>{dialog.showModal();load()}));
load();
})();