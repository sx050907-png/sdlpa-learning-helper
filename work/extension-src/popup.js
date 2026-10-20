'use strict';
let savedOrigin = '';
const result = document.getElementById('result');
document.getElementById('course').onclick = () => chrome.tabs.create({url: 'https://training.sdlpa.org.cn/'});
document.getElementById('guide').onclick = () => chrome.tabs.create({url: chrome.runtime.getURL('welcome.html')});
document.getElementById('privacy').onclick = () => chrome.tabs.create({url: chrome.runtime.getURL('privacy.html')});
chrome.storage.local.get('sdlpa-helper-settings-v1').then(stored => {
  try {
    const url = new URL(stored['sdlpa-helper-settings-v1']?.baseUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error();
    if (url.username || url.password || url.search || url.hash) throw Error();
    savedOrigin = url.origin + '/*';
    document.getElementById('endpoint').textContent = '将授权：' + url.origin;
  } catch (_) { document.getElementById('endpoint').textContent = '尚未保存有效的 AI 接口地址'; }
});
document.getElementById('authorize').onclick = () => {
  if (!savedOrigin) { result.textContent = '请先在课程助手中填写并保存 AI 接口，再重新打开此窗口。'; return; }
  // Called synchronously from the user's click to preserve the user gesture.
  chrome.permissions.request({origins: [savedOrigin]}).then(granted => {
    result.textContent = granted ? '已授权。回到课程页，点击“测试接口”或“重试本题”。' : '未授权；普通播放功能仍可使用。';
  }).catch(() => { result.textContent = '授权未成功，请关闭此窗口后重试。'; });
};
