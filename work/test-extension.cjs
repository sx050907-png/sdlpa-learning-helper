const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('./test-env/node_modules/jsdom');
const dir = path.join(__dirname, 'extension-staging', '山东药师助手');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const key = 'sdlpa-helper-settings-v1';
const cfg = {baseUrl: 'https://api.deepseek.com', model: 'test-model', apiKey: 'TEST_ONLY_SECRET'};
function mockResponse(text) {
  let done = false;
  return {status:200,headers:{get:()=>null},body:{getReader:()=>({read:async()=>{if(done)return {done:true};done=true;return {done:false,value:Buffer.from(text)};},cancel:async()=>{done=true;}})}};
}
function worker({settings = cfg, allowed = true, fetcher} = {}) {
  let listener, fetches = [], checks = [];
  const chrome = {runtime: {id: 'test-extension', onMessage: {addListener: fn => {listener = fn;}}, onInstalled: {addListener() {}}},
    storage: {local: {get: async () => ({[key]: settings})}},
    permissions: {contains: async p => { checks.push(p); return allowed; }}};
  const context = vm.createContext({chrome, URL, AbortController, setTimeout, clearTimeout, TextDecoder, Uint8Array,
    fetch: async (url, options) => {fetches.push({url, options}); return fetcher ? fetcher(url, options) : mockResponse('{"choices":[]}');}});
  vm.runInContext(fs.readFileSync(path.join(dir, 'background.js'), 'utf8'), context);
  const send = (message = {type: 'sdlpa-ai-completion', url: 'https://attacker.invalid/', data: JSON.stringify({model: 'test-model', stream: false, messages: [{role:'system',content:'test'},{role:'user',content:'question'}]})}, sender = {id: 'test-extension', url: 'https://training.sdlpa.org.cn/learn', frameId: 0}) => new Promise(resolve => {
    if (!listener(message, sender, resolve)) resolve(null);
  });
  return {send, fetches, checks};
}

test('MV3 包内文件齐全，无远程代码、常驻后台页面或多余权限', () => {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
  assert.equal(m.manifest_version, 3); assert.deepEqual(m.permissions, ['storage']);
  assert.equal(m.default_locale, 'zh_CN');
  const messages = JSON.parse(fs.readFileSync(path.join(dir, '_locales', m.default_locale, 'messages.json'), 'utf8'));
  for (const field of ['name', 'description']) {
    const messageKey = /^__MSG_(\w+)__$/.exec(m[field])?.[1];
    assert(messageKey && messages[messageKey]?.message, 'Store locale must resolve ' + field);
  }
  assert.deepEqual(m.content_scripts[0].matches, ['https://training.sdlpa.org.cn/*']);
  assert.equal(m.background.page, undefined); assert.equal(m.externally_connectable, undefined);
  for (const f of [m.background.service_worker, ...m.content_scripts[0].js, m.action.default_popup, ...Object.values(m.icons)]) assert(fs.existsSync(path.join(dir, f)), f);
  for (const f of ['content.js','background.js','popup.js']) assert(!/eval\s*\(|new Function|importScripts\s*\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
});
test('AI 后台只使用已保存地址与 Key，不采用调用方 URL', async () => {
  const w = worker(); const response = await w.send(); assert.equal(response.ok, true);
  assert.equal(w.fetches.length, 1); assert.equal(w.fetches[0].url, 'https://api.deepseek.com/chat/completions');
  const opts = w.fetches[0].options; assert.equal(opts.credentials, 'omit'); assert.equal(opts.redirect, 'error');
  assert.equal(opts.headers.Authorization, 'Bearer TEST_ONLY_SECRET');
  assert(!opts.body.includes('TEST_ONLY_SECRET')); assert.equal(JSON.parse(opts.body).stream, false);
});
test('AI 未授权时不发送请求，返回具体授权提示', async () => {
  const w = worker({allowed:false}); const response = await w.send();
  assert.equal(response.ok, false); assert.match(response.error, /授权/); assert.equal(w.fetches.length, 0);
});
test('拒绝其他网站、其他扩展和子框架调用后台', async () => {
  for (const sender of [{id:'other',url:'https://training.sdlpa.org.cn/learn',frameId:0},{id:'test-extension',url:'https://attacker.invalid/',frameId:0},{id:'test-extension',url:'https://training.sdlpa.org.cn/learn',frameId:1}]) {
    const w = worker(); assert.equal((await w.send(undefined,sender)).ok, false); assert.equal(w.fetches.length, 0);
  }
});
test('拒绝模型不一致、异常正文和非 HTTPS 外部接口', async () => {
  const w = worker(); const response = await w.send({type:'sdlpa-ai-completion',data:JSON.stringify({model:'other',stream:false,messages:[]})});
  assert.equal(response.ok,false); assert.equal(w.fetches.length,0);
  for (const baseUrl of ['http://external.invalid/v1','https://u:secret@example.com/v1','https://example.com/v1?key=secret']) {
    const other = worker({settings:{...cfg,baseUrl}}); assert.equal((await other.send()).ok,false); assert.equal(other.fetches.length,0);
  }
});
test('限制无 Content-Length 的超大 AI 响应', async () => {
  const w = worker({fetcher: async () => mockResponse('x'.repeat(1000001))});
  const response = await w.send(); assert.equal(response.ok,false); assert.match(response.error,/过大/);
});
test('超时返回可读错误，不自动重试', async () => {
  const w = worker({fetcher:async () => {const e = Error(); e.name = 'AbortError'; throw e;}});
  assert.match((await w.send()).error,/25 秒/); assert.equal(w.fetches.length,1);
});
test('扩展适配器从异步本地存储载入，并在保存完成后调用 AI', async () => {
  const dom = new JSDOM('<body></body>',{url:'https://training.sdlpa.org.cn/learn',runScripts:'outside-only',pretendToBeVisual:true});
  const calls = []; let release;
  dom.window.chrome = {storage:{local:{get:async()=>({[key]:cfg}),set:async data=>{calls.push('set'); await new Promise(resolve=>{release=resolve;});}}},
    runtime:{sendMessage:async data=>{calls.push(data);return {ok:false,error:'请先授权 AI 接口'};}}};
  dom.window.eval(fs.readFileSync(path.join(dir,'content.js'),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));
  const host = dom.window.document.getElementById('sdlpa-helper'), ui = host.shadowRoot;
  assert.equal(host.dataset.extensionVersion,JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))).version);
  assert.equal(ui.querySelector('[data-key="model"]').value,'test-model');
  ui.getElementById('test').click(); await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['set']); release(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[1].type,'sdlpa-ai-completion'); assert(!JSON.stringify(calls[1]).includes('TEST_ONLY_SECRET'));
  assert.match(ui.getElementById('saved').textContent,/授权/);
  dom.window.close();
});
test('已存在脚本版时不安装第二套助手', async () => {
  const dom = new JSDOM('<aside id="sdlpa-helper">existing</aside>',{url:'https://training.sdlpa.org.cn/learn',runScripts:'outside-only'});
  dom.window.chrome = {storage:{local:{get:()=>{throw Error('should not load');}}}};
  dom.window.eval(fs.readFileSync(path.join(dir,'content.js'),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dom.window.document.querySelectorAll('#sdlpa-helper').length,1); dom.window.close();
});
(async()=>{let passed=0; for (const [name,fn] of tests) {try {await fn();passed++;console.log('PASS '+name);} catch(e){console.error('FAIL '+name,e);process.exitCode=1;}} console.log(`${passed}/${tests.length} passed`);})();
