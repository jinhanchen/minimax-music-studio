import * as api from './api.js';
import { iconSpan, icon } from './icons.js';
import { attachVisualizer, stopVisualizer, drawIdle } from './visualizer.js';
import { openSetup, closeSetup, autoOpenIfNeeded } from './setup.js';

const $ = (id) => document.getElementById(id);

const el = {
  health: $('health'), title: $('title'),
  styles: $('styles'), styleInfo: $('styleInfo'), vocals: $('vocals'),
  brief: $('brief'), briefCount: $('briefCount'),
  caption: $('caption'), captionPreview: $('captionPreview'),
  cpTag: $('cpTag'), cpReset: $('cpReset'),
  lyrics: $('lyrics'), tagbar: $('tagbar'),
  duration: $('duration'), durationOut: $('durationOut'),
  eta: $('eta'), etaValue: $('etaValue'), etaNote: $('etaNote'),
  seed: $('seed'), steps: $('steps'), cfgScale: $('cfgScale'), topK: $('topK'),
  generate: $('generate'), genEta: $('genEta'), formError: $('formError'),
  joblist: $('joblist'), libStats: $('libStats'), brandMark: $('brandMark'),
};

const state = {
  styles: [],
  vocalModes: [],
  /** 曲风是"这是什么类型的音乐"的分类信号，不是往描述框灌模板 */
  styleId: null,
  vocalId: null,
  /** 用户手改过合成结果后，就不再自动覆盖他的文字 */
  captionEdited: false,
  /** 歌词是否还是自动给的骨架 —— 是的话切人声模式可以安全替换 */
  lyricsPristine: true,
  jobs: [],
  filter: 'all',
  expanded: new Set(),
  exporting: new Set(),
  variants: 1,
  everGenerated: false,
};

const LYRIC_TAGS = ['[Intro]', '[Verse]', '[Chorus]', '[Bridge]', '[Instrumental]', '[Outro]'];

/* ============================ 工具 ============================ */

const fmtClock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function fmtDuration(sec) {
  const s = Math.round(sec);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} 分钟` : `${m} 分 ${r} 秒`;
}

function toast(msg) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = msg;
  document.body.appendChild(node);
  setTimeout(() => node.classList.add('out'), 2800);
  setTimeout(() => node.remove(), 3300);
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============================ 健康检查 ============================ */

async function refreshHealth() {
  try {
    const h = await api.getHealth();
    if (!h.online) {
      setHealth('err', 'ComfyUI 未运行 · 点右侧「初始化设置」');
      return false;
    }
    if (!h.models?.nodesPresent) {
      setHealth('err', `ComfyUI ${h.version} 缺少 Music 3 节点，需 ≥ 0.33.1`);
      return false;
    }
    const missing = Object.entries({
      扩散模型: h.models.dit, 文本编码器: h.models.textEncoder, VAE: h.models.vae,
    }).filter(([, ok]) => !ok).map(([k]) => k);
    if (missing.length) {
      setHealth('err', `缺少模型：${missing.join('、')}`);
      return false;
    }
    setHealth('ok', `ComfyUI ${h.version} · 显存 ${h.vramFreeMB}/${h.vramTotalMB} MB`);
    return true;
  } catch {
    setHealth('err', '工作台服务异常');
    return false;
  }
}

function setHealth(kind, text) {
  el.health.innerHTML = `<span class="dot dot-${kind}"></span>`
    + `<span class="health-text">${escapeHtml(text)}</span>`;
}

/* ============================ 预设 / 歌词标签 ============================ */

/**
 * 曲风选择。
 * 只做一件事：记下"这是什么类型的音乐"。不碰用户写的任何文字。
 */
function renderStyles() {
  el.styles.innerHTML = '';
  for (const s of state.styles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-chip';
    btn.dataset.id = s.id;
    btn.innerHTML = `${iconSpan(s.icon)}<span>${escapeHtml(s.name)}</span>`;
    btn.addEventListener('click', () => selectStyle(s.id));
    el.styles.appendChild(btn);
  }
}

function selectStyle(id) {
  const style = state.styles.find((s) => s.id === id);
  if (!style) return;
  const first = state.styleId === null;
  state.styleId = id;

  // 换曲风时人声跟着换成这个风格的常见取向，但用户已经明确选过就不动他的
  if (first || !state.vocalTouched) state.vocalId = style.defaultVocal;

  document.querySelectorAll('.style-chip')
    .forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  renderVocals();

  el.styleInfo.innerHTML =
    `<span>${escapeHtml(style.genre)}</span><span>${escapeHtml(style.tempo)}</span>`
    + `<span class="si-mood">${escapeHtml(style.mood)}</span>`;

  recompose();
}

function renderVocals() {
  el.vocals.innerHTML = '';
  for (const v of state.vocalModes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `vocal-chip${v.id === state.vocalId ? ' active' : ''}`;
    btn.dataset.id = v.id;
    btn.innerHTML = `<span>${escapeHtml(v.name)}</span>`
      + (v.hint ? `<em>${escapeHtml(v.hint)}</em>` : '');
    btn.addEventListener('click', () => {
      state.vocalId = v.id;
      state.vocalTouched = true;
      renderVocals();
      recompose();
    });
    el.vocals.appendChild(btn);
  }
}

/**
 * 把「曲风 + 人声 + 你的想法」合成为发给模型的描述。
 * 合成在服务端做（同一套逻辑，提交时也走它），前端只负责显示。
 */
let composeTimer = null;

function recompose({ immediate = false } = {}) {
  clearTimeout(composeTimer);
  const run = async () => {
    if (state.captionEdited) return;          // 用户改过就别覆盖他
    if (!state.styleId && !el.brief.value.trim()) {
      el.caption.value = '';
      updateCaptionCount();
      return;
    }
    try {
      const r = await api.compose({
        styleId: state.styleId,
        vocalId: state.vocalId,
        brief: el.brief.value,
      });
      el.caption.value = r.caption;
      if (state.lyricsPristine) el.lyrics.value = r.lyrics;
      updateCaptionCount();
    } catch { /* 合成失败不影响填写，提交时服务端还会再合成一次 */ }
  };
  if (immediate) run();
  else composeTimer = setTimeout(run, 220);
}

function updateCaptionCount() {
  el.briefCount.textContent = el.brief.value.length;
  el.cpTag.textContent = state.captionEdited ? '已手动编辑' : '自动合成';
  el.cpTag.classList.toggle('edited', state.captionEdited);
  el.cpReset.hidden = !state.captionEdited;
}

function renderTagbar() {
  el.tagbar.innerHTML = '';
  for (const tag of LYRIC_TAGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tagbtn';
    b.textContent = tag;
    b.addEventListener('click', () => {
      const ta = el.lyrics;
      const at = ta.selectionStart ?? ta.value.length;
      const insert = `${at > 0 && ta.value[at - 1] !== '\n' ? '\n' : ''}${tag}\n`;
      ta.value = ta.value.slice(0, at) + insert + ta.value.slice(at);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = at + insert.length;
    });
    el.tagbar.appendChild(b);
  }
}

/* ============================ 时长与耗时预估 ============================ */

let etaTimer = null;

function updateDurationUI() {
  const sec = Number(el.duration.value);
  el.durationOut.textContent = fmtDuration(sec);

  clearTimeout(etaTimer);
  etaTimer = setTimeout(async () => {
    try {
      const est = await api.estimate(sec, !state.everGenerated);
      el.etaValue.textContent = est.text;
      el.etaNote.textContent =
        `自回归 ${est.arStepsMin.toLocaleString()}~${est.arSteps.toLocaleString()} 步`
        + `${est.coldStart ? ' · 含首次加载' : ''} · ${est.basis}`;
      el.eta.classList.toggle('eta-long', est.maxSec > 20 * 60);
      el.genEta.textContent = state.variants > 1
        ? `${state.variants} 个 · 单个${est.text}` : est.text;
      updateVariantsTotal(est);
    } catch {
      el.etaValue.textContent = '—';
    }
  }, 120);
}

function updateVariantsTotal(est) {
  const box = $('variantsTotal');
  if (!box) return;
  if (state.variants <= 1) { box.textContent = ''; box.className = 'variants-total'; return; }
  const lo = Math.round(est.minSec * state.variants / 60);
  const hi = Math.round(est.maxSec * state.variants / 60);
  box.textContent = `串行排队，全部跑完约 ${lo} ~ ${hi} 分钟`;
  box.className = hi > 90 ? 'variants-total warn' : 'variants-total';
}

/* ============================ 提交 ============================ */

function showError(msg) {
  el.formError.textContent = msg;
  el.formError.hidden = false;
}
const clearError = () => { el.formError.hidden = true; };

async function submit() {
  clearError();
  if (!state.styleId && !el.brief.value.trim() && !el.caption.value.trim()) {
    showError('先选一个曲风 —— 模型需要知道要做什么类型的音乐。');
    return;
  }

  const payload = {
    title: el.title.value.trim(),
    styleId: state.styleId,
    vocalId: state.vocalId,
    brief: el.brief.value,
    // 只有用户真改过合成结果才覆盖，否则让服务端用同一套逻辑重新合成
    captionOverride: state.captionEdited ? el.caption.value : undefined,
    lyrics: el.lyrics.value,
    duration: Number(el.duration.value),
    seed: el.seed.value === '' ? undefined : Number(el.seed.value),
    steps: Number(el.steps.value),
    cfgScale: Number(el.cfgScale.value),
    topK: Number(el.topK.value),
    variants: state.variants,
  };

  el.generate.disabled = true;
  el.generate.querySelector('.gen-label').textContent = '提交中…';
  try {
    const r = await api.createJob(payload);
    state.everGenerated = true;
    toast(r.count > 1
      ? `${r.count} 个变体已排队 —— 可以关掉页面，跑完回来挑。`
      : '已加入队列 —— 可以关掉这个页面，生成在后台继续。');
    await refreshJobs();
    updateDurationUI();
  } catch (err) {
    const detail = err.detail ? `\n${JSON.stringify(err.detail).slice(0, 300)}` : '';
    showError(err.message + detail);
  } finally {
    el.generate.disabled = false;
    el.generate.querySelector('.gen-label').textContent = '开始生成';
  }
}

/* ============================ 任务列表 ============================ */

const STATUS_TEXT = {
  queued: '排队中', running: '生成中', done: '已完成',
  error: '失败', canceled: '已取消',
};

function jobProgress(job) {
  if (job.status !== 'running' || !job.startedAt) return null;
  const elapsed = (Date.now() - new Date(job.startedAt).getTime()) / 1000;
  const total = job.estimateMaxSec || 1;
  return { elapsed, pct: Math.min(96, (elapsed / total) * 100) };
}

const cardSignature = (job) => [
  job.id, job.status, job.audio?.filename ?? '', job.error ?? '',
  state.expanded.has(job.id) ? 'e' : '',
  state.exporting.has(job.id) ? 'x' : '',
].join('|');

const rendered = new Map();

function renderJobs() {
  const filtered = state.jobs.filter((j) => {
    if (state.filter === 'active') return j.status === 'queued' || j.status === 'running';
    if (state.filter === 'done') return j.status === 'done';
    return true;
  });

  renderStats();

  if (filtered.length === 0) {
    for (const [, e] of rendered) stopVisualizer(e.node.querySelector('canvas'));
    rendered.clear();
    el.joblist.innerHTML = `<div class="empty">${
      state.filter === 'all' ? '还没有作品。左边写点什么，点“开始生成”。' : '这个分类下没有内容。'
    }</div>`;
    return;
  }

  el.joblist.querySelector('.empty')?.remove();

  const wanted = new Set(filtered.map((j) => j.id));
  for (const [id, entry] of rendered) {
    if (!wanted.has(id)) {
      stopVisualizer(entry.node.querySelector('canvas'));
      entry.node.remove();
      rendered.delete(id);
    }
  }

  let prev = null;
  for (const job of filtered) {
    const sig = cardSignature(job);
    const existing = rendered.get(job.id);
    let node;
    if (existing && existing.sig === sig) {
      node = existing.node;
    } else {
      node = renderJobCard(job);
      if (existing) {
        stopVisualizer(existing.node.querySelector('canvas'));
        existing.node.replaceWith(node);
      }
      rendered.set(job.id, { sig, node });
    }
    const shouldFollow = prev ? prev.nextSibling : el.joblist.firstChild;
    if (node !== shouldFollow) el.joblist.insertBefore(node, shouldFollow);
    prev = node;
  }

  updateLiveProgressOnly();
}

/** 曲库概览：让"这台机器到底多快"一眼可见 */
function renderStats() {
  const done = state.jobs.filter((j) => j.status === 'done' && Number.isFinite(j.computeSec));
  if (done.length === 0) { el.libStats.innerHTML = ''; return; }
  const totalCompute = done.reduce((s, j) => s + j.computeSec, 0);
  const totalAudio = done.reduce((s, j) => s + (j.actualSec ?? 0), 0);
  const ratio = totalAudio > 0 ? totalCompute / totalAudio : 0;
  el.libStats.innerHTML =
    `<span>${iconSpan('spark')}${done.length} 首</span>`
    + `<span>${iconSpan('wave')}音频共 ${fmtClock(totalAudio)}</span>`
    + `<span>${iconSpan('clock')}生成共 ${fmtClock(totalCompute)}</span>`
    + `<span class="stat-ratio">平均 ${ratio.toFixed(1)}× 实时</span>`;
}

function renderJobCard(job) {
  const card = document.createElement('div');
  card.className = 'job';
  card.dataset.id = job.id;

  const created = new Date(job.createdAt).toLocaleString('zh-CN', { hour12: false });
  const durText = Number.isFinite(job.actualSec)
    ? `实际 ${fmtDuration(job.actualSec)}（上限 ${fmtDuration(job.duration)}）`
    : fmtDuration(job.duration);

  card.innerHTML = `
    <div class="job-head">
      <div class="job-headline">
        <p class="job-title">${escapeHtml(job.title || '未命名')}</p>
        <div class="job-meta">${escapeHtml(durText)} · seed ${job.seed} · ${job.steps} 步 · ${escapeHtml(created)}</div>
      </div>
      <span class="badge badge-${job.status}">${STATUS_TEXT[job.status] ?? job.status}</span>
    </div>`;

  // 生成耗时：完成后必须留痕，这是判断"这台机器值不值得跑长曲子"的唯一依据
  if (job.status === 'done' && Number.isFinite(job.computeSec)) {
    const speed = job.actualSec > 0 ? (job.computeSec / job.actualSec).toFixed(1) : null;
    const timing = document.createElement('div');
    timing.className = 'job-timing';
    timing.innerHTML =
      `<span class="t-main">${iconSpan('clock')}生成耗时 <strong>${fmtClock(job.computeSec)}</strong></span>`
      + (speed ? `<span class="t-sub">${speed}× 实时</span>` : '')
      + (Number.isFinite(job.estimateMinSec)
        ? `<span class="t-sub">预估 ${fmtClock(job.estimateMinSec)}~${fmtClock(job.estimateMaxSec)}</span>` : '');
    card.appendChild(timing);
  }

  const prog = jobProgress(job);
  if (job.status === 'queued' || prog) {
    const wrap = document.createElement('div');
    wrap.className = 'job-progress';
    wrap.innerHTML = prog
      ? `<div class="bar"><i style="width:${prog.pct.toFixed(1)}%"></i></div>
         <div class="progress-text">
           <span>已用 ${fmtClock(prog.elapsed)}</span>
           <span>预计共 ${fmtClock(job.estimateMinSec)} ~ ${fmtClock(job.estimateMaxSec)}</span>
         </div>`
      : `<div class="bar indeterminate"><i></i></div>
         <div class="progress-text"><span>排队等待 GPU</span><span></span></div>`;
    card.appendChild(wrap);
  }

  if (job.status === 'done') card.appendChild(buildPlayer(job, card));

  if (job.status === 'error' && job.error) {
    const e = document.createElement('div');
    e.className = 'job-error';
    e.textContent = job.error;
    card.appendChild(e);
  }

  card.appendChild(buildActions(job));
  if (state.exporting.has(job.id)) card.appendChild(buildExportPanel(job));
  if (state.expanded.has(job.id)) card.appendChild(buildDetail(job));
  return card;
}

/** 播放器 + 频谱可视化。播放时整张卡片进入"流光"状态 */
function buildPlayer(job, card) {
  const box = document.createElement('div');
  box.className = 'player';
  box.innerHTML = '<canvas class="viz"></canvas>';

  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = api.audioUrl(job.id);
  box.appendChild(audio);

  const canvas = box.querySelector('canvas');
  // 卡片插进 DOM 后才有真实宽高，下一帧再画待机波形
  requestAnimationFrame(() => drawIdle(canvas));

  audio.addEventListener('play', () => {
    // 同一时刻只让一张卡片流光，否则满屏闪
    document.querySelectorAll('.job.playing').forEach((n) => {
      if (n !== card) {
        n.classList.remove('playing');
        stopVisualizer(n.querySelector('canvas'));
        n.querySelector('audio')?.pause();
      }
    });
    card.classList.add('playing');
    attachVisualizer(canvas, audio, (level) => {
      card.style.setProperty('--level', level.toFixed(3));
    });
  });

  const stop = () => {
    card.classList.remove('playing');
    card.style.setProperty('--level', '0');
    stopVisualizer(canvas);
  };
  audio.addEventListener('pause', stop);
  audio.addEventListener('ended', stop);

  return box;
}

function buildActions(job) {
  const row = document.createElement('div');
  row.className = 'job-actions';

  const add = (name, label, onClick, danger = false) => {
    const b = document.createElement('button');
    b.className = `act${danger ? ' act-danger' : ''}`;
    b.innerHTML = `${iconSpan(name)}${escapeHtml(label)}`;
    b.addEventListener('click', onClick);
    row.appendChild(b);
  };

  add('info', state.expanded.has(job.id) ? '收起描述' : '查看描述', () => {
    if (state.expanded.has(job.id)) state.expanded.delete(job.id);
    else state.expanded.add(job.id);
    renderJobs();
  });

  add('refresh', '用这套参数再来一次', () => {
    el.title.value = job.title ?? '';
    el.lyrics.value = job.lyrics ?? '';
    state.lyricsPristine = false;
    el.duration.value = String(job.duration);
    el.steps.value = String(job.steps);
    el.cfgScale.value = String(job.cfgScale);
    el.topK.value = String(job.topK);
    el.seed.value = '';

    // 还原成"什么风格 + 你当时怎么说的"，而不是只剩一段合成后的英文 ——
    // 那样你没法在原意上继续改
    el.brief.value = job.brief ?? '';
    state.vocalId = job.vocalId ?? null;
    state.vocalTouched = Boolean(job.vocalId);
    state.captionEdited = Boolean(job.captionEdited);
    if (job.styleId && state.styles.some((s) => s.id === job.styleId)) {
      selectStyle(job.styleId);
      state.vocalId = job.vocalId ?? state.vocalId;
      renderVocals();
    } else {
      state.styleId = null;
      document.querySelectorAll('.style-chip').forEach((b) => b.classList.remove('active'));
    }
    if (state.captionEdited) {
      el.caption.value = job.caption ?? '';
      el.captionPreview.open = true;
    } else {
      recompose({ immediate: true });
    }
    updateCaptionCount();
    updateDurationUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('参数已还原，种子留空 = 生成不同版本');
  });

  if (job.status === 'done') {
    add('download', '下载原始 MP3', () => { window.location.href = api.audioUrl(job.id, true); });
    add('scissors', state.exporting.has(job.id) ? '收起导出' : '导出为指定时长', () => {
      if (state.exporting.has(job.id)) state.exporting.delete(job.id);
      else state.exporting.add(job.id);
      renderJobs();
    });
  }

  if (job.status === 'queued' || job.status === 'running') {
    add('stop', '取消', async () => {
      try { await api.cancelJob(job.id); await refreshJobs(); toast('已取消'); }
      catch (e) { toast(`取消失败：${e.message}`); }
    }, true);
  } else {
    add('trash', '从列表删除', async () => {
      try {
        await api.deleteJob(job.id);
        state.expanded.delete(job.id);
        state.exporting.delete(job.id);
        await refreshJobs();
      } catch (e) { toast(`删除失败：${e.message}`); }
    }, true);
  }

  return row;
}

function buildExportPanel(job) {
  const box = document.createElement('div');
  box.className = 'export-panel';
  box.innerHTML = `
    <div class="export-title">${iconSpan('loop')}导出为指定时长
      <span class="hint">配视频用；不足会无缝循环补足</span></div>
    <div class="export-quick"></div>
    <div class="export-row">
      <input type="number" class="export-sec" min="3" max="3600" step="1" value="60">
      <span class="export-unit">秒</span>
      <button class="act export-go">${iconSpan('download')}导出</button>
    </div>
    <div class="export-status"></div>`;

  const input = box.querySelector('.export-sec');
  const status = box.querySelector('.export-status');
  const quick = box.querySelector('.export-quick');

  for (const s of [15, 30, 60, 90, 120, 180]) {
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = s < 60 ? `${s} 秒` : `${s / 60} 分`;
    b.addEventListener('click', () => { input.value = String(s); });
    quick.appendChild(b);
  }

  box.querySelector('.export-go').addEventListener('click', async () => {
    const seconds = Number(input.value);
    if (!Number.isFinite(seconds) || seconds < 3 || seconds > 3600) {
      status.textContent = '时长要在 3 ~ 3600 秒之间';
      status.className = 'export-status err';
      return;
    }
    status.textContent = '处理中…（循环拼接需要几秒）';
    status.className = 'export-status';
    try {
      const res = await fetch(api.exportUrl(job.id, seconds));
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const looped = res.headers.get('X-Looped') === '1';
      const srcSec = res.headers.get('X-Source-Duration');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(job.title || 'bgm').replace(/[^\w一-龥 -]/g, '_')}_${seconds}s.mp3`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      status.textContent = `已导出 ${seconds} 秒（原曲 ${srcSec} 秒，${looped ? '循环补足' : '裁剪'}）`;
      status.className = 'export-status ok';
    } catch (err) {
      status.textContent = `导出失败：${err.message}`;
      status.className = 'export-status err';
    }
  });

  return box;
}

function buildDetail(job) {
  const d = document.createElement('div');
  d.className = 'job-detail';
  d.textContent =
    `【音乐描述】\n${job.caption}\n\n【歌词】\n${job.lyrics}\n\n`
    + `【参数】duration=${job.duration}s  seed=${job.seed}  steps=${job.steps}  `
    + `cfg=${job.cfgScale}  top_k=${job.topK}`
    + (Number.isFinite(job.computeSec) ? `\n【耗时】生成 ${job.computeSec.toFixed(1)}s` : '')
    + (Number.isFinite(job.actualSec) ? ` · 输出音频 ${job.actualSec.toFixed(2)}s` : '');
  return d;
}

/* ============================ 轮询 ============================ */

async function refreshJobs() {
  try {
    const { jobs } = await api.listJobs();
    state.jobs = jobs;
    renderJobs();
  } catch { /* 后端短暂不可用时保持现状 */ }
}

function updateLiveProgressOnly() {
  for (const job of state.jobs) {
    const prog = jobProgress(job);
    if (!prog) continue;
    const card = el.joblist.querySelector(`.job[data-id="${CSS.escape(job.id)}"]`);
    const bar = card?.querySelector('.bar > i');
    const txt = card?.querySelector('.progress-text span');
    if (bar) bar.style.width = `${prog.pct.toFixed(1)}%`;
    if (txt) txt.textContent = `已用 ${fmtClock(prog.elapsed)}`;
  }
}

/* ============================ 启动 ============================ */

async function init() {
  el.brandMark.innerHTML = icon('wave');
  renderTagbar();
  updateCaptionCount();

  try {
    const cfg = await api.getConfig();
    state.styles = cfg.styles ?? [];
    state.vocalModes = cfg.vocalModes ?? [];
    el.duration.min = String(cfg.limits.minDuration);
    el.duration.max = String(cfg.limits.maxDuration);
    el.duration.value = String(cfg.defaults.duration);
    el.steps.value = String(cfg.defaults.steps);
    el.cfgScale.value = String(cfg.defaults.cfgScale);
    el.topK.value = String(cfg.defaults.topK);
    renderStyles();
    renderVocals();
    // 默认选中第一个曲风：空表单对人不友好，而且曲风本来就是必选项
    if (state.styles.length) selectStyle(state.styles[0].id);
  } catch (e) {
    showError(`加载配置失败：${e.message}`);
  }

  await refreshJobs();
  state.everGenerated = state.jobs.some((j) => j.status === 'done');
  updateDurationUI();
  await refreshHealth();
  await autoOpenIfNeeded();

  el.brief.addEventListener('input', () => { updateCaptionCount(); recompose(); });
  // 一旦手动改了合成结果，就以用户改的为准，不再自动覆盖
  el.caption.addEventListener('input', () => {
    state.captionEdited = true;
    updateCaptionCount();
  });
  el.cpReset.addEventListener('click', () => {
    state.captionEdited = false;
    recompose({ immediate: true });
    updateCaptionCount();
  });
  el.lyrics.addEventListener('input', () => { state.lyricsPristine = false; });
  el.duration.addEventListener('input', updateDurationUI);
  el.generate.addEventListener('click', submit);
  $('openSetup').addEventListener('click', openSetup);
  $('closeSetup').addEventListener('click', closeSetup);
  $('setupOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'setupOverlay') closeSetup();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('setupOverlay').hidden) closeSetup();
  });

  document.querySelectorAll('.duration-quick button').forEach((b) => {
    b.addEventListener('click', () => {
      el.duration.value = b.dataset.dur;
      updateDurationUI();
    });
  });

  document.querySelectorAll('.vbtn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.vbtn').forEach((x) => x.classList.toggle('active', x === b));
      state.variants = Number(b.dataset.v);
      updateDurationUI();
    });
  });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      state.filter = t.dataset.tab;
      renderJobs();
    });
  });

  setInterval(refreshJobs, 4000);
  setInterval(refreshHealth, 15000);
}

init();
