const model=document.querySelector('#model');
chrome.storage.local.get('settings').then(({settings})=>model.value=settings?.model||'local');
model.addEventListener('change',async()=>{
  const {settings={}}=await chrome.storage.local.get('settings');
  await chrome.storage.local.set({settings:{...settings,model:model.value}});
  document.querySelector('#saved').textContent='Saved. Applies the next time you open a reader.';
});
async function check(){
  const state=await chrome.runtime.sendMessage({target:'background',type:'health'});
  document.querySelector('#connection').textContent=state.configured?'OpenAI is connected':state.running?'Local service ready · OpenAI key needed':'On-device reading is ready';
  document.querySelector('#detail').textContent=state.configured?'Open an article and choose an OpenAI voice in the player.':state.running?'You can listen with the Mac voice now. Connect the OpenAI API key to enable the OpenAI voices.':'The Mac voice works immediately. Start the local speech service to connect OpenAI voices.';
  if(new URLSearchParams(location.search).has('restricted'))document.querySelector('#detail').textContent+=' This Chrome page cannot run the reader. Try a regular article webpage.';
}
document.querySelector('#check').addEventListener('click',check);check();
