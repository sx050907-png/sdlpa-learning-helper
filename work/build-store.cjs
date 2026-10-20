'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
function run(script, jitless = false) {
  const result = spawnSync(process.execPath,[...(jitless ? ['--jitless'] : []),path.join(__dirname,script)],{cwd:root,encoding:'utf8'});
  if (result.status !== 0) throw Error((result.stdout || '') + (result.stderr || '') + '\nFailed: ' + script);
  return result.stdout.trim();
}
run('build-extension.cjs');
const coreTests = run('test-helper.cjs',true);
const adapterTests = run('test-extension.cjs',true);
const stage = path.join(__dirname,'extension-staging','山东药师助手');
const manifest = JSON.parse(fs.readFileSync(path.join(stage,'manifest.json'),'utf8'));
const version = manifest.version;
const localeMessages = manifest.default_locale ? JSON.parse(fs.readFileSync(path.join(stage,'_locales',manifest.default_locale,'messages.json'),'utf8')) : {};
const storeDescription = manifest.description.replace(/__MSG_(\w+)__/g, (_,key) => {
  if (!localeMessages[key]?.message) throw Error('Missing locale message: ' + key);
  return localeMessages[key].message;
});
if (!/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(version) || version.split('.').some(n=>Number(n)>65535)) throw Error('Invalid extension version');
const source = fs.readFileSync(path.join(root,'outputs','sdlpa-helper.user.js'),'utf8');
if (source.match(/@version\s+(\S+)/)?.[1] !== version) throw Error('Userscript and manifest versions must match');
if (manifest.update_url || manifest.key) throw Error('Store identity/update configuration requires explicit review');
const folder = path.join(root,'outputs','Edge商店发布材料');
const extension = path.join(folder,'extension');
fs.mkdirSync(folder,{recursive:true});
fs.cpSync(stage,extension,{recursive:true});
fs.copyFileSync(path.join(stage,'icons','300.png'),path.join(folder,'商店Logo-300.png'));
fs.copyFileSync(path.join(stage,'privacy.html'),path.join(folder,'privacy.html'));
fs.copyFileSync(path.join(stage,'style.css'),path.join(folder,'style.css'));
const listing = `山东药师学习助手\n\n商店短描述（以 manifest 为准）：\n${storeDescription}\n\n完整描述（简体中文）：\n山东药师学习助手是一款面向山东省药师协会继续教育学习页面的独立辅助扩展，帮助用户减少播放控制和课件目录中的重复操作。扩展与山东省药师协会及各 AI 服务商无隶属关系，不代表平台官方，也不保证获得课程学分或考试通过。\n\n主要功能：\n1. 在用户点击开始后持续检查播放器和右侧课件完成标记，按设置继续未完成的课件。平台显示“已完成”后可提前切换，也可以关闭此选项，等待视频自然结束；仅显示 100% 不作为完成依据。\n2. 提供可保存的静音开关和可拖动的页面面板。\n3. 检测普通签到弹窗、模拟点击平台原有签到按钮，并处理已知的离开页面暂停提示。身份验证、验证码、扫码等步骤由用户处理。\n4. 可选的 AI 练习辅助：支持用户自己填写智谱、豆包、DeepSeek、OpenAI 或兼容 Chat Completions 的 HTTPS 接口、模型和 Key。启用后发送当前可见题目和选项，可按设置填写答案及提交随堂小测。课后测验最终交卷和课程评价需用户操作。AI 自动辅助默认关闭，不提供内置付费题库。\n\n使用时需拥有平台合法学习账号。请保持电脑联网、不休眠，课程页尽量保持前台；浏览器后台节流和平台规则仍可能影响计时。提前切换可能不再触发尚未出现的末尾练习，如需完整观看请关闭该选项。AI 服务商可能按其自己的计费规则收费，答案也可能出错。\n\n扩展不伪造学习进度、不加速视频、不读取登录 Cookie、不上传视频。普通页面处理在本机进行；设置与 Key 保存在本机扩展存储，AI 请求直接发送至用户授权的接口，没有开发者题库、广告或分析服务器。完整数据说明见隐私政策。正式上架后，同一商店条目中的新版由 Edge 分发，已打开的课程页需刷新才能运行新版。\n\n建议分类：Productivity（以 Partner Center 实际选项为准）。\n搜索词：继续教育；课件播放；静音；山东药师；学习助手。\n`;
if (listing.split('完整描述（简体中文）：')[1].length < 250) throw Error('Store listing is too short');
fs.writeFileSync(path.join(folder,'商店介绍-简体中文.txt'), '\ufeff' + listing);
fs.writeFileSync(path.join(folder,'隐私与权限申报.txt'), '\ufeff' + `单一用途：辅助用户操作 training.sdlpa.org.cn 的继续教育课件播放器、目录和可见练习界面。\n\n权限说明：\nstorage：保存开关、面板位置、自定义接口、模型及本机 API Key。\n课程站点访问：仅在 training.sdlpa.org.cn 注入页面助手，读取可见课件、完成标记、播放器状态和提示，执行用户启用的操作。\noptional_host_permissions 的 HTTPS 通配：为用户自行选择的 AI 服务提供按域名授权的跨域访问；安装时不自动授予所有 HTTPS 网站权限。\nlocalhost、127.0.0.1、::1 的可选 HTTP：兼容用户自己的本机模型或代理服务，仍需用户授权。\n远程代码：不使用。所有运行代码随扩展包提供；模型返回结果只作 JSON 数据解析，不作为脚本执行。\n\n数据披露须按 Partner Center 实际类别如实填写：\n- Website content：会读取课件完成标记、播放器状态、可见题干与选项。启用 AI 后，当前题干与选项传给用户所选接口。\n- Authentication information：用户提供的 AI API Key 本机保存，并用于用户所选接口认证；不是学习平台的登录密码。\n- 不声明“完全不接触或传输用户数据”；可选 AI 及接口测试确实有上述传输。\n- 不使用广告分析、不出售数据、不读取全站浏览历史。课程题目无需 AI 时在本机处理。\n\n隐私政策文件：privacy.html（与 style.css 一起部署到公开 HTTPS 网站，商店填写实际可访问 URL；本地文件路径不可充当隐私 URL）。\n发布者/支持联系方式：待用户提供并核对；以最终政策和注册资料为准。\n`);
fs.writeFileSync(path.join(folder,'审核测试说明.txt'),'\ufeff' + `待提交版本：${version}\n\n尚未提交，以下是审核说明草稿。\n本版本本地脚本与适配测试通过；用户 Edge 中的最新扩展包运行仍需真实复测。不能把 0.3.0 的旧版实课记录当作本版本的验收。\n\n审核路径：\n1. 从扩展图标打开使用说明，确认可查看隐私政策；安装后不会自动开启页面学习。\n2. 使用经授权的继续教育测试账号登录 https://training.sdlpa.org.cn/，进入学习页并点击助手“开始”。课程、课件、签到时机均由平台决定。\n3. 在右侧平台标记已完成的课件上，检查稳定确认后切换；关闭提前切换后应等待自然结束。检查静音开关、切课后保持静音及拖动面板。\n4. 出现普通“请点击[签到]按钮继续学习。”提示时，已开启的自动签到会点击平台原按钮。验证码、扫码和身份验证不自动处理。\n5. 可选 AI 由审核者自行选择合法接口，填写模型和 Key、授权接口并测试；请勿使用开发者或用户的私人 Key。关闭 AI 后不会继续填写迟到的请求结果。最终交卷需人工操作。\n\n账号说明：当前未向审核人员提供学习平台的授权测试账号。若审核需要受限功能登录，发布前应由发布者取得可分享的专用测试账号或与微软协调测试方案；不得上传用户真实登录会话或个人账号凭据。\n`);
fs.writeFileSync(path.join(folder,'验证结果.txt'),'\ufeff' + `版本 ${version}\n${coreTests}\n\n${adapterTests}\n\n以上为本地检查，不等于微软审核通过或最新版实课运行验收。\n`);
const statusFile = path.join(folder,'发布状态.json');
const previousStatus = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile,'utf8').replace(/^\uFEFF/,'')) : {};
fs.writeFileSync(statusFile,JSON.stringify({status:'prepared-not-submitted',developerEnrollment:'pending-user',publisherDisplayName:null,publicSupportContact:null,publicPrivacyUrl:null,storeProductId:null,storeExtensionId:null,latestExtensionRealCourseVerified:false,...previousStatus,version,listingFile:'商店介绍-简体中文.txt',privacyFile:'privacy.html',checks:{core:coreTests.split('\n').at(-1),adapter:adapterTests.split('\n').at(-1)}},null,2));
const zipPath = path.join(folder,`sdlpa-helper-edge-store-${version}.zip`);
// POSIX names are required in the ZIP, including when built on Windows.
// Arguments carry filesystem paths; no user value is interpolated into code.
const zipCode = `from pathlib import Path
import sys, zipfile
src=Path(sys.argv[1]).resolve()
dest=Path(sys.argv[2]).resolve()
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as archive:
    for item in sorted(src.rglob('*')):
        if item.is_file():
            item.resolve().relative_to(src)
            archive.write(item,item.relative_to(src).as_posix())
with zipfile.ZipFile(dest) as archive:
    names=archive.namelist()
    assert 'manifest.json' in names
    assert all(not n.startswith('/') and chr(92) not in n and '..' not in n.split('/') for n in names)
    assert archive.testzip() is None
`;
const zipped = spawnSync('python',['-c',zipCode,extension,zipPath],{encoding:'utf8'});
if (zipped.status !== 0) throw Error(zipped.stdout + zipped.stderr);
const hash = require('node:crypto').createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
fs.writeFileSync(zipPath+'.sha256',hash+'  '+path.basename(zipPath)+'\n');
console.log(JSON.stringify({version,core:coreTests.split('\n').at(-1),adapter:adapterTests.split('\n').at(-1),zip:zipPath,bytes:fs.statSync(zipPath).size,sha256:hash,status:'prepared-not-submitted'},null,2));
