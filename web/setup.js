/**
 * 初始化向导。
 *
 * 环境没配好时自动弹出，配好后可以从顶栏手动打开。
 * 目标是"照着做就能跑起来"，而不是"告诉你哪里不对然后你去查文档"——
 * 所以每一步都带可复制的命令，模型能直接在这里下。
 */
import { iconSpan } from './icons.js';

const $ = (id) => document.getElementById(id);
const fmtGB = (b) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const fmtSpeed = (b) => (b > 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB/s` : `${Math.round(b / 1024)} KB/s`);

function fmtEta(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 90) return `${Math.round(sec)} 秒`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

const STATE_META = {
  ok:      { icon: 'check', cls: 'ok',      text: '就绪' },
  warn:    { icon: 'warn',  cls: 'warn',    text: '需处理' },
  missing: { icon: 'cross', cls: 'missing', text: '缺失' },
  pending: { icon: 'dot',   cls: 'pending', text: '待检查' },
};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let pollTimer = null;
let lastStatus = null;

export function openSetup() {
  $('setupOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
  refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 2500);
}

export function closeSetup() {
  $('setupOverlay').hidden = true;
  document.body.style.overflow = '';
  clearInterval(pollTimer);
  pollTimer = null;
}

async function refresh() {
  try {
    const [status, dl] = await Promise.all([
      fetch('/api/setup').then((r) => r.json()),
      fetch('/api/setup/download').then((r) => r.json()),
    ]);
    lastStatus = status;
    render(status, dl);
  } catch (err) {
    $('setupBody').innerHTML =
      `<div class="setup-error">读取环境状态失败：${escapeHtml(err.message)}</div>`;
  }
}

function render(status, dl) {
  const body = $('setupBody');
  const scrollTop = body.scrollTop;

  const head = status.ready
    ? `<div class="setup-banner ok">${iconSpan('check')}<span>环境已就绪，可以开始生成</span></div>`
    : `<div class="setup-banner">${iconSpan('info')}<span>按下面的步骤配置，每步都有可复制的命令</span></div>`;

  const steps = status.steps.map((s, i) => renderStep(s, i, dl, status)).join('');

  body.innerHTML = head + `<ol class="setup-steps">${steps}</ol>`
    + `<div class="setup-paths">`
    + `<div><span class="k">模型目录</span><code>${escapeHtml(status.modelsDir)}</code></div>`
    + `<div><span class="k">ComfyUI</span><code>${escapeHtml(status.comfyInstall)}</code></div>`
    + `<div class="setup-hint">路径不对？改环境变量 <code>MODELS_DIR</code> / <code>COMFY_INSTALL</code> 后重启工作台。</div>`
    + `</div>`;

  body.scrollTop = scrollTop;
  wire(dl);
}

function renderStep(step, index, dl, status) {
  const meta = STATE_META[step.state] ?? STATE_META.pending;
  let extra = '';

  if (step.id === 'models') {
    extra = renderModels(step, dl, status);
  } else {
    if (step.fix) {
      extra += `<div class="setup-cmd"><pre>${escapeHtml(step.fix)}</pre>`
        + `<button class="copy-btn" data-copy="${escapeHtml(step.fix)}">${iconSpan('copy')}复制</button></div>`;
    }
    if (step.warning) {
      extra += `<div class="setup-warn">${iconSpan('warn')}<span>${escapeHtml(step.warning)}</span></div>`;
    }
    if (step.id === 'runtime' && step.vramTotalMB && step.vramTotalMB < 12000) {
      extra += `<div class="setup-note">显存 ${step.vramTotalMB} MB —— `
        + `文本编码器 8.6 GB 装不进显存，会走权重流式加载。能跑，但速度受限，属预期。</div>`;
    }
  }

  return `<li class="setup-step ${meta.cls}">
    <div class="step-head">
      <span class="step-num">${index + 1}</span>
      <span class="step-title">${escapeHtml(step.title)}</span>
      <span class="step-badge ${meta.cls}">${iconSpan(meta.icon)}${meta.text}</span>
    </div>
    <div class="step-detail">${escapeHtml(step.detail)}</div>
    ${extra}
  </li>`;
}

function renderModels(step, dl, status) {
  const rows = step.models.map((m) => {
    const live = dl.files?.find((f) => f.key === m.key);
    const received = dl.active && live ? live.received : m.haveBytes;
    const pct = Math.min(100, (received / m.bytes) * 100);
    const done = received >= m.bytes;
    const isCurrent = dl.active && dl.current === m.key;
    return `<div class="model-row ${done ? 'done' : ''} ${isCurrent ? 'current' : ''}">
      <div class="model-line">
        <span class="model-name">${iconSpan(done ? 'check' : (isCurrent ? 'download' : 'dot'))}${escapeHtml(m.label)}</span>
        <span class="model-size">${fmtGB(received)} / ${fmtGB(m.bytes)}</span>
      </div>
      <div class="model-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="model-note">${escapeHtml(m.note)}</div>
    </div>`;
  }).join('');

  let controls;
  if (dl.active) {
    controls = `<div class="dl-status">
        <div class="dl-line">
          <strong>${dl.percent.toFixed(1)}%</strong>
          <span>${fmtGB(dl.doneBytes)} / ${fmtGB(dl.totalBytes)}</span>
          <span>${fmtSpeed(dl.bytesPerSec)}</span>
          <span>剩余 ${fmtEta(dl.etaSec)}</span>
        </div>
        <button class="btn-ghost" id="dlCancel">${iconSpan('stop')}停止</button>
      </div>`;
  } else if (step.state === 'ok') {
    controls = `<div class="setup-note">三个模型都已就位，字节数与官方元数据一致。</div>`;
  } else {
    const opts = status.sources.map((s) =>
      `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('');
    controls = `<div class="dl-start">
        <select id="dlSource" class="dl-select">${opts}</select>
        <button class="btn-primary" id="dlStart">${iconSpan('download')}开始下载</button>
      </div>
      <div class="setup-note">支持断点续传，中断了再点一次就接着下。8 GB 显存必须用 int8 版，这里下的就是。</div>`;
  }

  const err = dl.error && !dl.active
    ? `<div class="setup-error">${escapeHtml(dl.error)}</div>` : '';

  return `<div class="model-list">${rows}</div>${controls}${err}`;
}

function wire(dl) {
  document.querySelectorAll('.copy-btn').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        const old = b.innerHTML;
        b.innerHTML = `${iconSpan('check')}已复制`;
        setTimeout(() => { b.innerHTML = old; }, 1600);
      } catch { /* 剪贴板不可用就算了，命令本身可见 */ }
    });
  });

  $('dlStart')?.addEventListener('click', async () => {
    const sourceId = $('dlSource')?.value;
    await fetch('/api/setup/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId }),
    });
    refresh();
  });

  $('dlCancel')?.addEventListener('click', async () => {
    await fetch('/api/setup/download/cancel', { method: 'POST' });
    refresh();
  });
}

/** 首次进入时，环境没配好就自动弹向导 */
export async function autoOpenIfNeeded() {
  try {
    const status = await fetch('/api/setup').then((r) => r.json());
    if (!status.ready) openSetup();
    return status;
  } catch {
    return null;
  }
}

export const getLastStatus = () => lastStatus;
