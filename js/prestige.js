(()=>{'use strict';
const styles=['legend','diamond','gold','amethyst','ruby','emerald','sapphire','rose','copper','silver'];
let ranks=new Map(),ready=false,loading=null;
const idOf=a=>a?.id||a?.authorId||a?.artId||'';
function decorate(el,id,kind){if(!el||!id)return;const rank=ranks.get(id)||0;el.classList.remove(...styles.map((_,i)=>'cidio-rank-'+(i+1)));el.classList.remove('cidio-premium-name','cidio-premium-avatar','cidio-premium-post');if(rank){el.classList.add('cidio-rank-'+rank,kind==='avatar'?'cidio-premium-avatar':kind==='post'?'cidio-premium-post':'cidio-premium-name');el.dataset.prestigeAura='reserved';}else delete el.dataset.prestigeAura;}
function applyName(el,a){if(!el)return;const id=idOf(a);if(id){el.dataset.prestigeArtist=id;el.dataset.prestigeKind='name';decorate(el,id,'name')}}
function applyAvatar(el,a){if(!el)return;const id=idOf(a);if(id){el.dataset.prestigeArtist=id;el.dataset.prestigeKind='avatar';decorate(el,id,'avatar')}}
function applyPost(el,a){if(!el)return;const id=idOf(a);if(id){el.dataset.prestigeArtist=id;el.dataset.prestigeKind='post';decorate(el,id,'post')}}
function update(){document.querySelectorAll('[data-prestige-artist]').forEach(el=>decorate(el,el.dataset.prestigeArtist,el.dataset.prestigeKind))}
async function refresh(){if(loading)return loading;loading=fetch('/api/ranking/prestige',{credentials:'same-origin',cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('prestige unavailable');const data=await r.json();ranks=new Map((data.artists||[]).map(a=>[a.id,a.rank]));ready=true;update()}).catch(()=>{}).finally(()=>{loading=null});return loading}
function observe(){const observer=new MutationObserver(mutations=>{for(const m of mutations){for(const n of m.addedNodes){if(n.nodeType!==1)continue;const el=n;if(el.matches?.('[data-prestige-artist]'))decorate(el,el.dataset.prestigeArtist,el.dataset.prestigeKind);el.querySelectorAll?.('[data-prestige-artist]').forEach(e=>decorate(e,e.dataset.prestigeArtist,e.dataset.prestigeKind))}}});observer.observe(document.documentElement,{childList:true,subtree:true})}
window.CidioPrestige={applyName,applyAvatar,applyPost,refresh,styles};observe();refresh();document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});window.addEventListener('artemfoco:authenticated',refresh);
})();
