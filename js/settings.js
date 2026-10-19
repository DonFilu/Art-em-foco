(()=>{'use strict';
 const input=document.getElementById('notificationSound'),label=document.getElementById('soundLabel'),message=document.getElementById('settingsMessage');if(!input)return;
 let savedValue=true;
 function render(value){input.checked=value;label.textContent=value?'Ativado':'Desativado'}
 async function load(){
  message.textContent='';
  try{const response=await fetch('/api/settings/notifications',{credentials:'same-origin',cache:'no-store'});if(response.status===401){message.textContent='Entre com Google para alterar suas configurações.';return}const data=await response.json();if(!response.ok||typeof data.soundEnabled!=='boolean')throw Error(data.error||'Não foi possível carregar as configurações');savedValue=data.soundEnabled;render(savedValue);input.disabled=false}
  catch(error){message.textContent=error.message||'Não foi possível carregar as configurações.'}
 }
 input.addEventListener('change',async()=>{
  const next=input.checked;input.disabled=true;label.textContent='Salvando…';message.textContent='';
  try{const response=await fetch('/api/settings/notifications',{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({soundEnabled:next})});const data=await response.json();if(!response.ok||typeof data.soundEnabled!=='boolean')throw Error(data.error||'Não foi possível salvar as configurações');savedValue=data.soundEnabled;render(savedValue);message.textContent='Configuração salva.'}
  catch(error){render(savedValue);message.textContent=error.message||'Não foi possível salvar as configurações.'}
  finally{input.disabled=false}
 });
 load();
})();
