const { JSDOM } = require('./test-env/node_modules/jsdom');
const assert = require('node:assert/strict');
const api = require('../outputs/sdlpa-helper.user.js');
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const group = (name, rows, expanded = true) => `<div class="el-collapse-item"><button class="el-collapse-item__header" aria-expanded="${expanded}"><span class="c-title">${name}</span></button><div style="display:${expanded ? 'block' : 'none'}"><ul>${rows}</ul></div></div>`;
const chapter = (name, status, selected = false, video = true) => `<li><button class="cw-title ${selected ? 'cw-selected' : ''}">${video ? '<span class="el-tag-duration">0:01:00</span>' : ''}<span class="cw-name-label">${name}</span></button><span class="el-tag-progress">${status}</span></li>`;
const message = text => `<div class="el-message-box"><div class="el-message-box__message">${text}</div><button>签到</button><button>确定</button></div>`;
const quiz = (name = '哪一项是正确选项？', multiple = false) => `<div class="el-dialog"><span class="el-dialog__title">测试课件 - 小测验</span><p class="subject-title">(${multiple ? '多选题' : '单选题'})</p><div class="subject-title">${name}</div>${['甲', '乙', '丙'].map((x, i) => `<label class="subject-option"><input type="${multiple ? 'checkbox' : 'radio'}" name="answer" value="${i}">${x}</label>`).join('')}<button>提交答案</button></div>`;
const exam = `<div class="exam-box"><div class="qyui-cell col"><div class="subject-seq">1、</div><div>(单选题)</div><div>请选择正确项目</div></div><label class="subject-option"><input type="radio" name="exam">A、甲</label><label class="subject-option"><input type="radio" name="exam">B、乙</label><button>下一题</button><button>交卷</button></div>`;
function setup(html = '', settings = {}, pathname = '/learn', request) {
  const dom = new JSDOM(html, { url: 'https://training.sdlpa.org.cn' + pathname, pretendToBeVisual: true });
  let now = 100000;
  const media = { paused: true, ended: false, rate: 1, error: null };
  const video = dom.window.document.querySelector('video');
  let plays = 0, pauses = 0;
  if (video) {
    for (const [prop, key] of [['paused', 'paused'], ['ended', 'ended'], ['playbackRate', 'rate'], ['error', 'error']]) Object.defineProperty(video, prop, { get: () => media[key] });
    video.play = () => { plays++; media.paused = false; return Promise.resolve(); };
    video.pause = () => { pauses++; media.paused = true; };
  }
  dom.window.document.hasFocus = () => true;
  const writes = [];
  const storage = { get: key => key === 'sdlpa-helper-settings-v1' ? settings : null, set: (key, value) => writes.push([key, value]), request: request || (() => { throw Error('Unexpected AI request'); }) };
  const ctrl = api.install(dom.window, storage, { noTimer: true, now: () => now });
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
  return { dom, doc: dom.window.document, ctrl, media, video, flush, writes, get plays() { return plays; }, get pauses() { return pauses; }, advance: n => { now += n; }, close: () => { ctrl.destroy(); dom.window.close(); } };
}
test('真实章节结构：区分完成、100.0% 舍入、文档附件', () => {
  const t = setup(group('课程', chapter('一', '已完成') + chapter('二', '100.0%', true) + chapter('附件', '', false, false)));
  const list = api.chapters(t.doc);
  assert.equal(list.length, 2); assert.equal(list[0].complete, true); assert.equal(list[1].complete, false); t.close();
});
test('普通签到精确匹配，不处理验证码及身份验证', () => {
  const t = setup(message('请点击[签到]按钮继续学习。'));
  assert.equal(api.classifyMessage(t.doc.querySelector('.el-message-box')).kind, 'checkin');
  t.doc.querySelector('.el-message-box__message').textContent = '请完成验证码签到';
  assert.equal(api.classifyMessage(t.doc.querySelector('.el-message-box')).kind, 'stop'); t.close();
});
test('签到在运行中持续检测，并防止重复点击', () => {
  const t = setup(message('请点击[签到]按钮继续学习。')); let n = 0;
  t.doc.querySelector('button').onclick = () => n++;
  t.ctrl.start(); t.ctrl.tick(); assert.equal(n, 1);
  t.advance(2000); t.ctrl.tick(); assert.equal(n, 2); t.close();
});
test('签到关闭设置生效', () => {
  const t = setup(message('请点击[签到]按钮继续学习。'), { autoCheckin: false }); let n = 0;
  t.doc.querySelector('button').onclick = () => n++;
  t.ctrl.start(); assert.equal(n, 0); t.close();
});
test('离开页面暂停提示：点击网站确定按钮，不覆盖焦点 API', () => {
  const t = setup(message('您已离开播放界面，已暂停播放和计时。点击确定继续播放。'));
  let n = 0; t.doc.querySelectorAll('button')[1].onclick = () => n++;
  t.ctrl.start(); assert.equal(n, 1); t.close();
});
test('未知弹窗和速率异常不自动确定', () => {
  const t = setup(message('检测到视频播放速度异常')); let n = 0;
  t.doc.querySelectorAll('button')[1].onclick = () => n++;
  t.ctrl.start(); assert.equal(n, 0); assert.equal(t.ctrl.state.running, false); t.close();
});
test('自然结束 + 平台已完成 + 末尾等待后切换下一章节', () => {
  const t = setup('<video></video>' + group('课程', chapter('一', '已完成', true) + chapter('二', '未开始')), {completeEarly:false});
  let n = 0; t.doc.querySelectorAll('.cw-title')[1].onclick = () => n++;
  t.media.paused = false; t.ctrl.start(); assert.equal(n, 0);
  t.media.ended = true; t.video.dispatchEvent(new t.dom.window.Event('ended'));
  t.ctrl.tick(); assert.equal(n, 0); t.advance(4000); t.ctrl.tick(); assert.equal(n, 1); t.close();
});

test('视频未结束但平台已完成：稳定确认后自动切换', () => {
  const t = setup('<video></video>' + group('课程', chapter('一', '学习中', true) + chapter('二', '未开始')));
  let n = 0; t.doc.querySelectorAll('.cw-title')[1].onclick = () => n++;
  t.media.paused = false; t.ctrl.start(); t.advance(4000); t.ctrl.tick(); assert.equal(n,0);
  t.doc.querySelector('.el-tag-progress').textContent = '已完成'; t.ctrl.tick();
  t.advance(3000); t.ctrl.tick(); assert.equal(n,0);
  t.advance(600); t.ctrl.tick(); assert.equal(n,1); assert.equal(t.video.ended,false); t.close();
});
test('100.0% 不代替已完成，状态撤回后重新等待确认', () => {
  const t = setup('<video></video>' + group('课程', chapter('一', '100.0%', true) + chapter('二', '未开始')));
  let n=0; t.doc.querySelectorAll('.cw-title')[1].onclick=()=>n++;
  t.media.paused=false; t.ctrl.start(); t.advance(5000); t.ctrl.tick(); assert.equal(n,0);
  const badge=t.doc.querySelector('.el-tag-progress'); badge.textContent='已完成';t.ctrl.tick();t.advance(3000);
  badge.textContent='99.9%';t.ctrl.tick();badge.textContent='已完成';t.ctrl.tick();
  t.advance(1000);t.ctrl.tick();assert.equal(n,0);t.advance(3000);t.ctrl.tick();assert.equal(n,1);t.close();
});
test('提前完成遇到签到：先签到，弹窗消失后重新稳定确认', () => {
  const t=setup('<video></video>'+group('课程',chapter('一','已完成',true)+chapter('二','未开始')));
  let n=0,signs=0;t.doc.querySelectorAll('.cw-title')[1].onclick=()=>n++;
  t.media.paused=false;t.ctrl.start();t.advance(4000);
  const holder=t.doc.createElement('div');holder.innerHTML=message('请点击[签到]按钮继续学习。');t.doc.body.append(holder);
  holder.querySelector('button').onclick=()=>{signs++;holder.remove();};t.ctrl.tick();assert.equal(signs,1);assert.equal(n,0);
  t.ctrl.tick();t.advance(3000);t.ctrl.tick();assert.equal(n,0);t.advance(600);t.ctrl.tick();assert.equal(n,1);t.close();
});
test('已完成但练习尚在显示：不提前切换', () => {
  const t=setup('<video></video>'+group('课程',chapter('一','已完成',true)+chapter('二','未开始'))+quiz());
  let n=0;t.doc.querySelectorAll('.cw-title')[1].onclick=()=>n++;t.media.paused=false;
  t.ctrl.start();t.advance(10000);t.ctrl.tick();assert.equal(n,0);assert.match(t.ctrl.state.status,/练习/);t.close();
});
test('关闭自动切换时，即使已完成也不离开当前视频', () => {
  const t=setup('<video></video>'+group('课程',chapter('一','已完成',true)+chapter('二','未开始')),{autoNext:false});
  let n=0;t.doc.querySelectorAll('.cw-title')[1].onclick=()=>n++;t.media.paused=false;
  t.ctrl.start();t.advance(10000);t.ctrl.tick();assert.equal(n,0);assert.match(t.ctrl.state.status,/自动切换已关闭/);t.close();
});
test('静音默认不改变播放器，开关立即生效且保存，不改变音量', () => {
  const t=setup('<video></video>');t.video.volume=.42;assert.equal(t.video.muted,false);
  const toggle=t.ctrl.ui.querySelector('[data-key="mute"]');toggle.checked=true;toggle.dispatchEvent(new t.dom.window.Event('change'));
  assert.equal(t.video.muted,true);assert.equal(t.video.volume,.42);assert.equal(t.writes.at(-1)[1].mute,true);
  toggle.checked=false;toggle.dispatchEvent(new t.dom.window.Event('change'));assert.equal(t.video.muted,false);assert.equal(t.video.volume,.42);t.close();
});
test('保存的静音设置加载后生效，替换的视频仍静音', () => {
  const t=setup('<video></video>',{mute:true});assert.equal(t.video.muted,true);
  const replacement=t.doc.createElement('video');t.video.replaceWith(replacement);t.ctrl.tick();assert.equal(replacement.muted,true);
  replacement.muted=false;t.ctrl.tick();assert.equal(replacement.muted,true);t.close();
});
test('视频结束但平台未确认完成时不跳过', () => {
  const t = setup('<video></video>' + group('课程', chapter('一', '99.8%', true) + chapter('二', '未开始')));
  let n = 0; t.doc.querySelectorAll('.cw-title')[1].onclick = () => n++;
  t.media.ended = true; t.ctrl.start(); t.advance(50000); t.ctrl.tick(); assert.equal(n, 0);
  t.advance(50000); t.ctrl.tick(); assert.equal(t.ctrl.state.running, false); t.close();
});
test('视频结束后出现小测验，优先处理练习，不换章节', () => {
  const t = setup('<video></video>' + group('课程', chapter('一', '已完成', true) + chapter('二', '未开始')) + quiz());
  let n = 0; t.doc.querySelectorAll('.cw-title')[1].onclick = () => n++;
  t.media.ended = true; t.ctrl.start(); t.advance(10000); t.ctrl.tick(); assert.equal(n, 0); assert.match(t.ctrl.state.status, /练习/); t.close();
});
test('跨课程切换先展开折叠课程，避免点击隐藏元素', () => {
  const t = setup('<video></video>' + group('一', chapter('一', '已完成', true)) + group('二', chapter('二', '未开始'), false));
  let opened = 0, clicked = 0;
  t.doc.querySelectorAll('.el-collapse-item__header')[1].onclick = () => opened++;
  t.doc.querySelectorAll('.cw-title')[1].onclick = () => clicked++;
  t.media.ended = true; t.ctrl.start(); t.advance(4000); t.ctrl.tick();
  assert.equal(opened, 1); assert.equal(clicked, 0); t.close();
});
test('无法识别的末尾小测验始终阻止切换和恢复播放', () => {
  const t = setup('<video></video>' + group('课程', chapter('一', '已完成', true) + chapter('二', '未开始')) + '<div class="el-dialog"><span class="el-dialog__title">本节 - 小测验</span><img alt="图片题干"></div>');
  let n = 0; t.doc.querySelectorAll('.cw-title')[1].onclick = () => n++;
  t.media.ended = true; t.ctrl.start(); t.advance(10000); t.ctrl.tick(); assert.equal(n, 0); assert.match(t.ctrl.state.status, /无法完整识别/); assert.equal(t.plays, 0); t.close();
});
test('当前类别全部完成后通过平台返回按钮继续检查总列表', () => {
  const t = setup('<video></video><button id="back">返回课程列表</button>' + group('课程', chapter('一', '已完成', true)));
  let n = 0; t.doc.getElementById('back').onclick = () => n++;
  t.media.ended = true; t.ctrl.start(); t.advance(4000); t.ctrl.tick(); assert.equal(n, 1); t.close();
});
test('课程列表：进入未完成课程，跳过 100% 及考试按钮', () => {
  const t = setup('<div class="el-table"><table><thead><tr><th>课程名称</th><th>学习进度</th><th>操作</th></tr></thead><tbody><tr><td>完成课</td><td>100%</td><td><button>学习</button><button>去考试</button></td></tr><tr><td>未完成课</td><td>25%</td><td><button id="target">学习</button></td></tr></tbody></table></div>', {}, '/train');
  let n = 0; t.doc.getElementById('target').onclick = () => n++;
  t.ctrl.start(); assert.equal(n, 1); t.close();
});
test('课程总目录短暂空表格时等待，加载后继续进入课程', () => {
  const t = setup('<div class="el-table"><table><thead><tr><th>课程</th><th>学习进度</th><th>操作</th></tr></thead><tbody></tbody></table></div>', {}, '/train');
  t.ctrl.start(); assert.equal(t.ctrl.state.running, true); assert.match(t.ctrl.state.status, /等待课程目录/);
  t.doc.querySelector('tbody').innerHTML = '<tr><td>课程</td><td>0%</td><td><button>学习</button></td></tr>';
  let n = 0; t.doc.querySelector('tbody button').onclick = () => n++;
  t.advance(5000); t.ctrl.tick(); assert.equal(n, 1); t.close();
});
test('目录加载长期失败时报告超时，不误报课程已完成', () => {
  const t = setup('<div class="el-table"><table><thead><tr><th>学习进度</th></tr></thead><tbody></tbody></table></div>', {}, '/train');
  t.ctrl.start(); t.advance(21000); t.ctrl.tick(); assert.equal(t.ctrl.state.running, false); assert.match(t.ctrl.state.error, /目录仍为空/); t.close();
});
test('浏览器阻止自动播放后明确提示，避免连续重复调用', async () => {
  const t = setup('<video></video>' + group('课', chapter('一', '20%', true)));
  let n = 0; t.video.play = () => { n++; return Promise.reject(new t.dom.window.DOMException('blocked', 'NotAllowedError')); };
  t.ctrl.start(); await t.flush(); t.advance(10000); t.ctrl.tick(); await t.flush();
  assert.equal(n, 1); assert.match(t.ctrl.state.status, /浏览器阻止自动播放/);
  t.ctrl.start(); await t.flush(); assert.equal(n, 2); t.close();
});
test('小测验解析可见题干与选项，跳过隐藏旧题', () => {
  const t = setup('<div style="display:none">' + quiz('隐藏题') + '</div>' + quiz('可见题', true));
  const q = api.readQuiz(t.doc, '/learn'); assert.equal(q.title, '可见题'); assert.equal(q.multiple, true); assert.equal(q.options.length, 3); t.close();
});
test('课后测验读取题号题型题干及选项', () => {
  const t = setup(exam, {}, '/exam'); const q = api.readQuiz(t.doc, '/exam');
  assert.match(q.title, /请选择正确项目/); assert.equal(q.options[0].text, '甲'); assert.equal(q.kind, 'exam'); t.close();
});
test('AI 接口：保留用户给定 base path，禁止外部 HTTP 及 URL 密钥', () => {
  assert.equal(api.endpoint('https://example.org/v1'), 'https://example.org/v1/chat/completions');
  assert.equal(api.endpoint('http://127.0.0.1:8080/v1/'), 'http://127.0.0.1:8080/v1/chat/completions');
  assert.throws(() => api.endpoint('http://example.org/v1')); assert.throws(() => api.endpoint('https://example.org/v1?key=secret'));
});
test('AI 答案：拒绝空、越界、多选填单选、重复项、非 JSON', () => {
  const q = { options: [1, 2, 3], multiple: false };
  for (const s of ['{"answers":[]}', '{"answers":[4]}', '{"answers":[1,2]}', '{"answers":[1,1]}', '答案A']) assert.throws(() => api.parseAnswer(s, q));
  assert.deepEqual(api.parseAnswer('```json\n{"answers":[2]}\n```', q).answers, [2]);
});
test('AI 真实请求结构：密钥仅放认证头；只传题干和选项', async () => {
  let request;
  const result = await api.requestAnswer({ baseUrl: 'https://example.org/v1', model: 'model-x', apiKey: 'fake-test-key' }, { title: '练习', multiple: false, options: [{ index: 1, text: '一' }] }, r => {
    request = r; r.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '{"answers":[1]}' } }] }) });
  });
  assert.equal(request.headers.Authorization, 'Bearer fake-test-key'); assert.equal(request.data.includes('fake-test-key'), false); assert.equal(result.answers[0], 1);
});
test('AI 随堂小测验：填写并按设置提交', async () => {
  const t = setup(quiz(), { aiEnabled: true, autoPracticeSubmit: true, baseUrl: 'https://example.org/v1', model: 'test' }, '/learn', r => r.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '{"answers":[2],"explanation":"测试依据"}' } }] }) }));
  let n = 0; t.doc.querySelector('.el-dialog button').onclick = () => n++;
  t.ctrl.start(); await t.flush(); assert.equal(t.doc.querySelectorAll('input')[1].checked, true); assert.equal(n, 1); t.ctrl.tick(); await t.flush(); assert.equal(n, 1); t.close();
});
test('关闭 AI 后迟到回复不填写、不提交', async () => {
  let reply;
  const t = setup(quiz(), { aiEnabled:true, autoPracticeSubmit:true, baseUrl:'https://example.org/v1', model:'test' }, '/learn', r=>{reply=r;});
  t.ctrl.start(); const toggle=t.ctrl.ui.querySelector('[data-key="aiEnabled"]');toggle.checked=false;toggle.dispatchEvent(new t.dom.window.Event('change'));
  reply.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'{"answers":[1]}'}}]})});await t.flush();
  assert.equal(t.doc.querySelector('input').checked,false);t.close();
});
test('停止后 AI 迟到回复不填写、不提交', async () => {
  let reply;
  const t = setup(quiz(), { aiEnabled: true, autoPracticeSubmit: true, baseUrl: 'https://example.org/v1', model: 'test' }, '/learn', r => { reply = r; });
  t.ctrl.start(); t.ctrl.stop(); reply.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '{"answers":[1]}' } }] }) });
  await t.flush(); assert.equal(t.doc.querySelector('input').checked, false); t.close();
});
test('换题后 AI 迟到回复不填写下一题', async () => {
  let reply;
  const t = setup(quiz('旧题'), { aiEnabled: true, baseUrl: 'https://example.org/v1', model: 'test' }, '/learn', r => { reply = r; });
  t.ctrl.start(); t.doc.querySelector('div.subject-title').textContent = '新题';
  reply.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '{"answers":[1]}' } }] }) });
  await t.flush(); assert.equal(t.doc.querySelector('input').checked, false); t.close();
});
test('AI 接口失败：停止并保留题目，不无限重试', async () => {
  let n = 0;
  const t = setup(quiz(), { aiEnabled: true, baseUrl: 'https://example.org/v1', model: 'test' }, '/learn', r => { n++; r.onload({ status: 401, responseText: 'private-server-body' }); });
  t.ctrl.start(); await t.flush(); t.ctrl.tick(); assert.equal(n, 1); assert.equal(t.ctrl.state.running, false); assert.equal(t.ctrl.state.error.includes('private-server-body'), false); t.close();
});
test('课后测验始终不自动交卷', async () => {
  const t = setup(exam, { aiEnabled: true, examNext: true, baseUrl: 'https://example.org/v1', model: 'test' }, '/exam', r => r.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '{"answers":[1]}' } }] }) }));
  let next = 0, submit = 0; const buttons = t.doc.querySelectorAll('.exam-box button'); buttons[0].onclick = () => next++; buttons[1].onclick = () => submit++;
  t.ctrl.start(); await t.flush(); assert.equal(next, 1); assert.equal(submit, 0); t.close();
});
test('切换服务商清空旧密钥与模型，避免发到另一个服务商', () => {
  const t = setup('', { apiKey: 'fake-old-key', model: 'old', aiEnabled: true });
  const select = t.ctrl.ui.getElementById('provider'); select.value = 'doubao'; select.dispatchEvent(new t.dom.window.Event('change'));
  assert.equal(t.ctrl.cfg.apiKey, ''); assert.equal(t.ctrl.cfg.model, ''); assert.equal(t.ctrl.cfg.aiEnabled, false);
  assert.equal(t.ctrl.cfg.baseUrl, 'https://ark.cn-beijing.volces.com/api/v3'); t.close();
});
test('四个服务商预设均生成正确的对话接口路径', () => {
  assert.equal(api.endpoint(api.PRESETS.zhipu.baseUrl), 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
  assert.equal(api.endpoint(api.PRESETS.doubao.baseUrl), 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
  assert.equal(api.endpoint(api.PRESETS.deepseek.baseUrl), 'https://api.deepseek.com/chat/completions');
  assert.equal(api.endpoint(api.PRESETS.openai.baseUrl), 'https://api.openai.com/v1/chat/completions');
});
test('接口测试仅发送测试题且不自动开启 AI', async () => {
  let sent;
  const t = setup('', { baseUrl: 'https://example.org/v1', model: 'test' }, '/learn', r => {
    sent = JSON.parse(r.data); r.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: '{"answers":[1]}' } }] }) });
  });
  t.ctrl.ui.getElementById('test').click(); await t.flush();
  assert.match(sent.messages[1].content, /接口连通性测试/); assert.equal(t.ctrl.cfg.aiEnabled, false);
  assert.match(t.ctrl.ui.getElementById('saved').textContent, /接口测试成功/); t.close();
});
test('XGPlayer 错误状态明确停止', () => {
  const t = setup('<div class="xgplayer xgplayer-is-error"><video></video></div>' + group('课', chapter('一', '20%', true)));
  t.ctrl.start(); assert.equal(t.ctrl.state.running, false); assert.match(t.ctrl.state.error, /播放器/); t.close();
});
test('标题栏拖动：限制屏幕边界并保存位置', () => {
  const t = setup(''), win = t.dom.window, host = t.doc.getElementById('sdlpa-helper');
  host.getBoundingClientRect = () => ({ left: parseFloat(host.style.left) || 700, top: parseFloat(host.style.top) || 400, width: 320, height: 330 });
  const pointer = (type, x, y) => new win.MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true });
  t.ctrl.ui.querySelector('header').dispatchEvent(pointer('pointerdown', 710, 410));
  win.dispatchEvent(pointer('pointermove', 5000, 5000)); win.dispatchEvent(pointer('pointerup', 5000, 5000));
  assert.equal(host.style.left, '696px'); assert.equal(host.style.top, '430px');
  assert.deepEqual(t.writes.at(-1), ['sdlpa-helper-position-v1', { left: 696, top: 430 }]);
  t.ctrl.ui.querySelector('header').dispatchEvent(pointer('pointerdown', 710, 410));
  win.dispatchEvent(pointer('pointerup', -5000, -5000)); assert.equal(host.style.left, '8px'); assert.equal(host.style.top, '8px'); t.close();
});
test('收起按钮的操作不触发标题拖动', () => {
  const t = setup(''), win = t.dom.window, host = t.doc.getElementById('sdlpa-helper');
  t.ctrl.ui.getElementById('fold').dispatchEvent(new win.MouseEvent('pointerdown', { button: 0, clientX: 500, clientY: 300, bubbles: true }));
  win.dispatchEvent(new win.MouseEvent('pointerup', { clientX: 10, clientY: 10 }));
  assert.equal(host.style.left, ''); t.close();
});
test('刷新后恢复已保存位置，过期屏幕坐标重新约束', () => {
  const dom = new JSDOM('', { url: 'https://training.sdlpa.org.cn/learn', pretendToBeVisual: true });
  const ctrl = api.install(dom.window, { get: key => key === 'sdlpa-helper-position-v1' ? { left: -100, top: -20 } : {}, set: () => {}, request: () => {} }, { noTimer: true });
  const host = dom.window.document.getElementById('sdlpa-helper'); assert.equal(host.style.left, '8px'); assert.equal(host.style.top, '8px');
  ctrl.destroy(); dom.window.close();
});
(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('PASS ' + name); }
    catch (e) { console.error('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
  }
  console.log(`${passed}/${tests.length} passed`);
})();
