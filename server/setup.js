/**
 * 初始化向导的后端：环境体检 + 模型下载。
 *
 * 存在的理由：换台机器就得重走一遍"装 ComfyUI → 升级 → 下 11GB 模型 →
 * 放对目录"，全靠 README 照着敲很容易漏。做成可执行的流程，让工具自己
 * 告诉你缺什么、并且能直接下。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { MODELS_DIR, MODEL_SOURCES, COMFY_INSTALL, MODELS } from './config.js';
import * as comfy from './comfy-api.js';

/** 三个必需模型。字节数来自仓库元数据，用于校验下完整没有 */
export const REQUIRED_MODELS = Object.freeze([
  {
    key: 'vae',
    label: 'VAE 解码器',
    dir: 'vae',
    file: MODELS.vae,
    bytes: 216_696_128,
    note: '把 latent 还原成波形，最小的一个',
  },
  {
    key: 'dit',
    label: '扩散模型 DiT',
    dir: 'diffusion_models',
    file: MODELS.dit,
    bytes: 2_502_161_682,
    note: 'int8 量化版，8GB 显存能整卡装下',
  },
  {
    key: 'textEncoder',
    label: '文本编码器',
    dir: 'text_encoders',
    file: MODELS.textEncoder,
    bytes: 9_196_611_886,
    note: '最大的一个；自回归生成声学条件，耗时大头在它',
  },
]);

export const TOTAL_BYTES = REQUIRED_MODELS.reduce((s, m) => s + m.bytes, 0);

const MIN_COMFY_VERSION = [0, 33, 1];

function compareVersion(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

async function readComfyVersion() {
  try {
    const raw = await fsp.readFile(path.join(COMFY_INSTALL, 'comfyui_version.py'), 'utf8');
    const v = raw.match(/__version__\s*=\s*"([\d.]+)"/)?.[1];
    return v ?? null;
  } catch {
    return null;
  }
}

async function statFile(m) {
  try {
    const st = await fsp.stat(path.join(MODELS_DIR, m.dir, m.file));
    return st.size;
  } catch {
    return 0;
  }
}

/** 一次性把所有环境状态查清楚，前端照着渲染就行 */
export async function checkEnvironment() {
  const version = await readComfyVersion();
  const versionOk = version
    ? compareVersion(version.split('.').map(Number), MIN_COMFY_VERSION) >= 0
    : false;

  const models = [];
  for (const m of REQUIRED_MODELS) {
    const have = await statFile(m);
    models.push({
      key: m.key,
      label: m.label,
      file: m.file,
      dir: m.dir,
      note: m.note,
      bytes: m.bytes,
      haveBytes: have,
      // 大小不符 = 下了一半，不能当"有"
      state: have === m.bytes ? 'ok' : (have > 0 ? 'partial' : 'missing'),
    });
  }

  const runtime = await comfy.getStatus();
  let discovered = null;
  if (runtime.online) {
    try { discovered = await comfy.checkModels(MODELS); } catch { /* 探测失败不阻塞 */ }
  }

  const ffmpeg = await hasFfmpeg();

  const steps = [
    {
      id: 'comfyui',
      title: '安装 ComfyUI',
      state: version ? (versionOk ? 'ok' : 'warn') : 'missing',
      detail: version
        ? (versionOk ? `已安装 v${version}` : `v${version} 太旧，MiniMax Music 3 需要 ≥ 0.33.1`)
        : `没找到 ComfyUI（期望位置 ${COMFY_INSTALL}）`,
      fix: version && !versionOk
        ? `cd "${COMFY_INSTALL}"\ngit fetch --tags\ngit checkout v0.33.1`
        : (version ? null : '从 comfy.org 下载 ComfyUI 桌面版，装完把 COMFY_INSTALL 指向它的 ComfyUI 目录'),
      warning: version && !versionOk
        ? '升级后不要跑 pip install -r requirements.txt —— 里面 torch 是无版本裸依赖，会拉 CPU 版覆盖你的 CUDA 版'
        : null,
    },
    {
      id: 'models',
      title: '下载模型（约 11.1 GB）',
      state: models.every((m) => m.state === 'ok') ? 'ok'
        : (models.some((m) => m.state === 'ok' || m.state === 'partial') ? 'warn' : 'missing'),
      detail: `${models.filter((m) => m.state === 'ok').length} / ${models.length} 就绪`,
      models,
    },
    {
      id: 'runtime',
      title: '启动 ComfyUI',
      state: runtime.online ? 'ok' : 'missing',
      detail: runtime.online
        ? `在线 v${runtime.version} · ${runtime.device} · 显存 ${runtime.vramFreeMB}/${runtime.vramTotalMB} MB`
        : 'ComfyUI 没有运行',
      fix: runtime.online ? null : 'npm run comfyui',
      vramTotalMB: runtime.vramTotalMB ?? null,
    },
    {
      id: 'nodes',
      title: 'ComfyUI 认出模型',
      state: discovered
        ? (discovered.nodesPresent && discovered.dit && discovered.textEncoder && discovered.vae ? 'ok' : 'warn')
        : 'pending',
      detail: discovered
        ? (discovered.nodesPresent
          ? `节点已注册；模型发现 ${['dit', 'textEncoder', 'vae'].filter((k) => discovered[k]).length}/3`
          : 'Music 3 节点未注册，ComfyUI 版本不够或需重启')
        : '等 ComfyUI 起来后才能检查',
      fix: discovered && !discovered.nodesPresent ? '确认 ComfyUI ≥ 0.33.1 并重启' : null,
    },
    {
      id: 'ffmpeg',
      title: 'ffmpeg（导出指定时长用）',
      state: ffmpeg ? 'ok' : 'warn',
      detail: ffmpeg ? '可用' : '不在 PATH 里 —— 不影响生成，但「导出为指定时长」会用不了',
      fix: ffmpeg ? null : '装 ffmpeg 并加入 PATH',
    },
  ];

  return {
    ready: steps.every((s) => s.state === 'ok'),
    steps,
    modelsDir: MODELS_DIR,
    comfyInstall: COMFY_INSTALL,
    sources: MODEL_SOURCES,
    totalBytes: TOTAL_BYTES,
  };
}

async function hasFfmpeg() {
  return new Promise((resolve) => {
    const c = spawn('ffmpeg', ['-version'], { windowsHide: true });
    c.on('error', () => resolve(false));
    c.on('close', (code) => resolve(code === 0));
    c.stdout?.resume();
    c.stderr?.resume();
  });
}

/* ============================ 下载 ============================ */

/**
 * 下载状态是进程内的单例 —— 同一时刻只允许一个下载任务，
 * 避免两个下载往同一个文件写。
 */
const download = {
  active: false,
  sourceId: MODEL_SOURCES[0].id,
  startedAt: null,
  finishedAt: null,
  error: null,
  canceled: false,
  current: null,
  files: [],
};

export function getDownloadState() {
  const doneBytes = download.files.reduce((s, f) => s + f.received, 0);
  const wantBytes = download.files.reduce((s, f) => s + f.total, 0) || TOTAL_BYTES;
  const elapsed = download.startedAt
    ? (Date.now() - new Date(download.startedAt).getTime()) / 1000
    : 0;
  const speed = elapsed > 2 ? (doneBytes - download.baseBytes) / elapsed : 0;
  const remain = speed > 0 ? Math.round((wantBytes - doneBytes) / speed) : null;
  return {
    active: download.active,
    sourceId: download.sourceId,
    startedAt: download.startedAt,
    finishedAt: download.finishedAt,
    error: download.error,
    canceled: download.canceled,
    current: download.current,
    files: download.files,
    doneBytes,
    totalBytes: wantBytes,
    percent: wantBytes > 0 ? Math.min(100, (doneBytes / wantBytes) * 100) : 0,
    bytesPerSec: Math.max(0, Math.round(speed)),
    etaSec: remain,
  };
}

export function cancelDownload() {
  if (!download.active) return false;
  download.canceled = true;
  download.controller?.abort();
  return true;
}

/**
 * 启动下载。已经完整的文件直接跳过，下了一半的从断点续。
 * 立即返回，进度用 getDownloadState() 轮询。
 */
export async function startDownload(sourceId) {
  if (download.active) throw new Error('已经有下载在进行中');

  const source = MODEL_SOURCES.find((s) => s.id === sourceId) ?? MODEL_SOURCES[0];

  const files = [];
  for (const m of REQUIRED_MODELS) {
    const received = await statFile(m);
    files.push({
      key: m.key,
      label: m.label,
      file: m.file,
      dir: m.dir,
      total: m.bytes,
      received: Math.min(received, m.bytes),
      state: received === m.bytes ? 'done' : 'pending',
    });
  }

  Object.assign(download, {
    active: true,
    sourceId: source.id,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    canceled: false,
    current: null,
    files,
    baseBytes: files.reduce((s, f) => s + f.received, 0),
    controller: new AbortController(),
  });

  run(source).catch((err) => {
    download.error = String(err?.message ?? err);
  }).finally(() => {
    download.active = false;
    download.finishedAt = new Date().toISOString();
    download.current = null;
  });

  return getDownloadState();
}

async function run(source) {
  for (const entry of download.files) {
    if (download.canceled) throw new Error('已取消');
    if (entry.state === 'done') continue;

    const meta = REQUIRED_MODELS.find((m) => m.key === entry.key);
    const dir = path.join(MODELS_DIR, meta.dir);
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, meta.file);

    download.current = entry.key;
    entry.state = 'downloading';

    // 长下载必然会断，最多重试 40 次，每次从断点续
    let attempt = 0;
    while (entry.received < entry.total) {
      if (download.canceled) throw new Error('已取消');
      attempt += 1;
      if (attempt > 40) throw new Error(`${meta.label} 重试 40 次仍未完成`);
      try {
        await fetchRange(source.base, meta, target, entry);
      } catch (err) {
        if (download.canceled) throw new Error('已取消');
        entry.lastError = String(err?.message ?? err);
        await new Promise((r) => { setTimeout(r, 3000); });
      }
    }

    const finalSize = await statFile(meta);
    if (finalSize !== meta.bytes) {
      throw new Error(`${meta.label} 大小不符：${finalSize} ≠ ${meta.bytes}`);
    }
    entry.state = 'done';
    entry.received = meta.bytes;
  }
  download.current = null;
}

async function fetchRange(base, meta, target, entry) {
  const url = `${base}/${meta.dir}/${meta.file}`;
  const from = entry.received;

  const res = await fetch(url, {
    headers: from > 0 ? { Range: `bytes=${from}-` } : {},
    signal: download.controller.signal,
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status}`);
  }
  // 服务器不认 Range 就只能从头来，否则会把整个文件追加到断点后面
  const append = from > 0 && res.status === 206;
  if (from > 0 && !append) entry.received = 0;

  const out = fs.createWriteStream(target, { flags: append ? 'a' : 'w' });
  const counter = new TransformCounter(entry);
  await pipeline(Readable.fromWeb(res.body), counter, out);
}

/** 边写边累加已收字节，给进度条用 */
class TransformCounter extends Transform {
  constructor(entry) {
    super();
    this.entry = entry;
  }

  _transform(chunk, _enc, cb) {
    this.entry.received += chunk.length;
    cb(null, chunk);
  }
}
