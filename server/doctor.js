/**
 * 自检：一条命令回答"我这套东西到底哪里没配好"。
 * 部署类项目最容易卡在环境上，把诊断做成可执行的，比写在 README 里管用。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { COMFY_URL, COMFY_INSTALL, COMFY_OUTPUT, MODELS } from './config.js';
import * as comfy from './comfy-api.js';

const SHARED_MODELS = 'E:/Comfy-Desktop/ComfyUI-Shared/models';
const EXPECTED_BYTES = {
  [MODELS.dit]: 2_502_161_682,
  [MODELS.textEncoder]: 9_196_611_886,
  [MODELS.vae]: 216_696_128,
};

const results = [];
const ok   = (m, d = '') => results.push({ level: 'ok', m, d });
const warn = (m, d = '') => results.push({ level: 'warn', m, d });
const bad  = (m, d = '') => results.push({ level: 'bad', m, d });

async function checkComfyInstall() {
  const versionFile = path.join(COMFY_INSTALL, 'comfyui_version.py');
  try {
    const raw = await fs.readFile(versionFile, 'utf8');
    const v = raw.match(/__version__\s*=\s*"([\d.]+)"/)?.[1];
    if (!v) return warn('ComfyUI 版本无法解析', versionFile);
    const [maj, min, pat] = v.split('.').map(Number);
    const enough = maj > 0 || min > 33 || (min === 33 && pat >= 1);
    enough
      ? ok(`ComfyUI ${v}`, '≥0.33.1，含 MiniMax Music 3 原生节点')
      : bad(`ComfyUI ${v} 太旧`, `需 ≥0.33.1。升级：cd "${COMFY_INSTALL}" && git fetch --tags && git checkout v0.33.1`);
  } catch {
    bad('找不到 ComfyUI', `期望位置 ${COMFY_INSTALL}，可用环境变量 COMFY_INSTALL 覆盖`);
  }
}

async function checkModels() {
  const dirs = { dit: 'diffusion_models', textEncoder: 'text_encoders', vae: 'vae' };
  for (const [key, sub] of Object.entries(dirs)) {
    const name = MODELS[key];
    const file = path.join(SHARED_MODELS, sub, name);
    try {
      const st = await fs.stat(file);
      const want = EXPECTED_BYTES[name];
      st.size === want
        ? ok(`模型 ${sub}/${name}`, `${(st.size / 1024 ** 3).toFixed(2)} GiB`)
        : bad(`模型 ${name} 大小不对`, `实际 ${st.size} ≠ 期望 ${want}，多半是下载没下完，请重下`);
    } catch {
      bad(`缺少模型 ${sub}/${name}`,
        `从 https://www.modelscope.cn/models/Comfy-Org/MiniMax-Music-3 下载后放到 ${path.join(SHARED_MODELS, sub)}`);
    }
  }
}

async function checkRuntime() {
  const status = await comfy.getStatus();
  if (!status.online) {
    warn('ComfyUI 未运行', `启动它：npm run comfyui（应监听 ${COMFY_URL}）`);
    return;
  }
  ok(`ComfyUI 在线 ${status.version}`, `${status.device} · 显存 ${status.vramFreeMB}/${status.vramTotalMB} MB`);
  if (status.vramTotalMB && status.vramTotalMB < 12_000) {
    warn('显存偏小', `${status.vramTotalMB} MB —— 文本编码器 8.6GB 会走权重流式加载，速度受限，属预期`);
  }
  try {
    const m = await comfy.checkModels(MODELS);
    m.nodesPresent ? ok('Music 3 节点已注册') : bad('Music 3 节点未注册', 'ComfyUI 版本不够或未重启');
    for (const [k, label] of [['dit', '扩散模型'], ['textEncoder', '文本编码器'], ['vae', 'VAE']]) {
      m[k] ? ok(`${label}已被 ComfyUI 发现`) : bad(`${label}未被发现`, '检查 comfy/extra_model_paths.yaml 的 base_path');
    }
  } catch (e) {
    warn('无法读取 ComfyUI 节点信息', e.message);
  }
}

async function checkOutputDir() {
  try {
    await fs.access(COMFY_OUTPUT);
    ok('输出目录可访问', COMFY_OUTPUT);
  } catch {
    warn('输出目录不存在', `${COMFY_OUTPUT}（ComfyUI 首次生成时会自动建）`);
  }
}

const ICON = { ok: '  [OK] ', warn: '  [!]  ', bad: '  [X]  ' };

await checkComfyInstall();
await checkModels();
await checkOutputDir();
await checkRuntime();

console.log('\n  MiniMax Music 3 工作台 · 环境自检\n');
for (const r of results) {
  console.log(ICON[r.level] + r.m);
  if (r.d) console.log('        ' + r.d);
}
const bads = results.filter((r) => r.level === 'bad').length;
const warns = results.filter((r) => r.level === 'warn').length;
console.log(`\n  ${bads === 0 ? '可以开工' : `有 ${bads} 项必须修`}${warns ? `，${warns} 项提醒` : ''}\n`);
process.exit(bads === 0 ? 0 : 1);
