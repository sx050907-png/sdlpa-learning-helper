'use strict';

function aiEndpoint(raw) {
  const url = new URL(String(raw || '').trim());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('接口需使用 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw Error('接口地址格式不正确');
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : path + '/chat/completions';
  return url;
}

async function complete(message, sender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || new URL(sender.url).origin !== 'https://training.sdlpa.org.cn') throw Error('请求来源不正确');
  const stored = await chrome.storage.local.get('sdlpa-helper-settings-v1');
  const cfg = stored['sdlpa-helper-settings-v1'];
  if (!cfg?.baseUrl || !cfg.model?.trim()) throw Error('请先在课程助手中保存接口地址和模型');
  const url = aiEndpoint(cfg.baseUrl);
  // Only the saved endpoint is used; caller-supplied URLs and headers are ignored.
  if (!await chrome.permissions.contains({origins: [url.origin + '/*']})) throw Error('请点击 Edge 工具栏的助手图标，授权此 AI 接口后重试');
  if (typeof message.data !== 'string' || message.data.length > 60000) throw Error('题目数据过长');
  const body = JSON.parse(message.data);
  if (body.model !== cfg.model || body.stream !== false || !Array.isArray(body.messages) || body.messages.length !== 2 ||
      body.messages[0]?.role !== 'system' || body.messages[1]?.role !== 'user' ||
      body.messages.some(m => typeof m.content !== 'string')) throw Error('请求格式不正确');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url.href, {
      method: 'POST', headers: {'Content-Type': 'application/json', ...(cfg.apiKey ? {Authorization: 'Bearer ' + cfg.apiKey} : {})},
      body: JSON.stringify({model: cfg.model, messages: body.messages.map(m => ({role: m.role, content: m.content})), stream: false}),
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal
    });
    const length = Number(response.headers.get('content-length'));
    if (length > 1000000) { controller.abort(); throw Error('接口返回数据过大'); }
    // Bound the streamed response even if Content-Length is absent.
    const reader = response.body?.getReader();
    if (!reader) return {status: response.status, responseText: ''};
    const chunks = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 1000000) { await reader.cancel(); throw Error('接口返回数据过大'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return {status: response.status, responseText: new TextDecoder().decode(bytes)};
  } catch (error) {
    if (error.name === 'AbortError') throw Error('AI 接口超过 25 秒未完成，请稍后重试或换用响应更快的模型');
    throw error;
  } finally { clearTimeout(timer); }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'sdlpa-ai-completion') return false;
  complete(message, sender).then(result => reply({ok: true, result}), error => reply({ok: false, error: error.message || 'AI 连接失败'}));
  return true;
});

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') chrome.tabs.create({url: chrome.runtime.getURL('welcome.html')});
});
