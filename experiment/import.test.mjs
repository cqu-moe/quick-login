import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {prepareCookies, compareCookies} from './extension/cookies.mjs';
const source = (await readFile(new URL('./extension/import.js', import.meta.url), 'utf8')).replace(/^import .*;\n/, '');
async function run(existing, root = existing) {
  const elements = Object.fromEntries(['file','import','status','inspect','diagnostics'].map(id => [id, {addEventListener(event, fn) {this[event] = fn;}}]));
  const data = {format:'cqu-sso-cookie-probe-v1', createdAt:Date.now()/1000, cookies:[{name:'SOURCEID_TGC',value:'synthetic-test-session',domain:'sso.cqu.edu.cn',path:'/',secure:false,httpOnly:true,sameSite:'Lax',expires:-1}]};
  const written = [];
  elements.file.files = [{size:1000, text:async()=>JSON.stringify(data)}];
  const context = {prepareCookies, compareCookies, document:{querySelector:id=>elements[id.slice(1)]}, chrome:{windows:{getCurrent:async()=>({incognito:false})}, cookies:{getAll:async query=>query.url ? root : existing, set:async details=>{written.push(details);return details;}}}};
  vm.runInNewContext(source, context);
  await elements.file.change();
  await elements.import.click();
  return {written,status:elements.status.textContent};
}
test('anonymous SSO cookies do not block restoring a missing login credential', async()=>{
  const result = await run(['SESSION','JSESSIONID','clientThemeKey','sidTheme'].map(name=>({name,value:'anonymous',domain:'sso.cqu.edu.cn',path:'/',storeId:'0'})));
  assert.equal(result.written.length,1,result.status);
});
test('an existing SSO credential is never overwritten',async()=>{
  const result=await run([{name:'SOURCEID_TGC',value:'existing-session',domain:'sso.cqu.edu.cn',path:'/',storeId:'0'}]);
  assert.equal(result.written.length,0);
});
test('a parent-domain SSO credential also prevents overwriting',async()=>{
  const result=await run([],[{name:'SOURCEID_TGC',value:'existing-session',domain:'.cqu.edu.cn',path:'/',storeId:'0'}]);
  assert.equal(result.written.length,0);
});
