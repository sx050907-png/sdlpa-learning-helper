const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const target = path.join(__dirname, 'extension-staging', '山东药师助手');
const version = JSON.parse(fs.readFileSync(path.join(__dirname,'extension-src','manifest.json'),'utf8')).version;
fs.mkdirSync(target, {recursive: true});
for (const file of fs.readdirSync(path.join(__dirname, 'extension-src'))) {
  fs.cpSync(path.join(__dirname, 'extension-src', file), path.join(target, file), {recursive:true});
}
let source = fs.readFileSync(path.join(root, 'outputs', 'sdlpa-helper.user.js'), 'utf8');
const start = source.indexOf('(function (factory) {');
const end = source.indexOf('})(function () {');
if (start < 0 || end < start) throw Error('Userscript wrapper changed; review the extension adapter');
const bootstrap = `(async function (factory) {
  'use strict';
  if (document.getElementById('sdlpa-helper')) return;
  const api = factory();
  const keys = ['sdlpa-helper-settings-v1', 'sdlpa-helper-position-v1'];
  const cache = await chrome.storage.local.get(keys);
  let writes = Promise.resolve();
  const report = error => {
    const hint = document.getElementById('sdlpa-helper')?.shadowRoot?.getElementById('error');
    if (hint) hint.textContent = error.message || '本地设置保存失败，请刷新课程后重试';
  };
  const app = api.install(window, {
    get: (key, fallback) => Object.hasOwn(cache, key) ? cache[key] : fallback,
    set: (key, value) => {
      cache[key] = value;
      writes = writes.then(() => chrome.storage.local.set({[key]: value}));
      writes.catch(report);
    },
    request: options => {
      writes.then(() => chrome.runtime.sendMessage({type: 'sdlpa-ai-completion', data: options.data}))
        .then(reply => {
          if (reply?.ok) options.onload(reply.result);
          else options.onerror({message: reply?.error || '扩展连接失效，请刷新课程后重试'});
        }, () => options.onerror({message: '扩展连接失效，请刷新课程后重试'}));
    }
  });
  if (app) document.getElementById('sdlpa-helper').dataset.extensionVersion = '${version}';
`;
source = bootstrap + source.slice(end);
source = source.replace('Key 保存在脚本管理器本地。', 'Key 保存在本机扩展中；首次使用或更换接口后，点击浏览器工具栏的助手图标授权接口。');
source = source.replace("onerror: () => reject(new Error('AI 接口连接失败'))", "onerror: error => reject(new Error(error?.message || 'AI 接口连接失败'))");
if (/GM_(getValue|setValue|xmlhttpRequest)/.test(source)) throw Error('Unconverted GM API');
fs.writeFileSync(path.join(target, 'content.js'), source);

// Original, dependency-free book/check icon. PNG files use only the standard library.
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
fs.mkdirSync(path.join(target, 'icons'), {recursive: true});
for (const size of [16, 48, 128, 300]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const book = px > .19 && px < .81 && py > .23 && py < .72;
    const spine = Math.abs(px - .5) < .025 && py > .23 && py < .76;
    const margin = px < .06 || px > .94 || py < .06 || py > .94;
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const color = book && !spine ? [255,255,255] : [18,86,160];
    raw[i] = color[0]; raw[i + 1] = color[1]; raw[i + 2] = color[2]; raw[i + 3] = margin ? 0 : 255;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  fs.writeFileSync(path.join(target, 'icons', size + '.png'), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
console.log('Staged extension: ' + target);
