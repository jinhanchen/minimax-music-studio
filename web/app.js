import * as api from './api.js';

const $ = (id) => document.getElementById(id);

const el = {
  health: $('health'), presets: $('presets'), title: $('title'),
  caption: $('caption'), captionCount: $('captionCount'),
  lyrics: $('lyrics'), tagbar: $('tagbar'),
  duration: $('duration'), durationOut: $('durationOut'),
  eta: $('eta'), etaValue: $('etaValue'), etaNote: $('etaNote'),
  seed: $('seed'), steps: $('steps'), cfgScale: $('cfgScale'), topK: $('topK'),
  generate: $('generate'), genEta: $('genEta'), formError: $('formError'),
  joblist: $('joblist'),
};

const state = {
  presets: [],
  jobs: [],
  filter: 'all',
  /** 记住每张卡是否展开了描述，刷新列表时不要弹回去 */
  expanded: new Set(),
  /** 正在播放的任务，重渲染时保住播放进度 */
  playing: null,
  everGenerated: false,
};

const LYRIC_TAGS = ['[Intro]', '[Verse]', '[Chorus]', '[Bridge]', '[Instrumental]', '[Outro]'];

/* ============================ 工具 ============================ */

const fmtClock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

function fmtDuration(sec) {
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m} 分钟` : `${m} 分 ${s} 秒`;
}

function toast(msg) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = msg;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============================ 健康检查 ============================ */

async function refreshHealth() {
  try {
    const h = await api.getHealth();
    if (!h.online) {
      el.health.innerHTML =
        `<span class="dot dot-err"></span><span class="health-text">ComfyUI 未运行 · 执行 <code>npm run comfyui</code></span>`;
      return false;
    }
    const missing = h.models
      ? Object.entries({ 扩散模型: h.models.dit, 文本编码器: h.models.textEncoder, VAE: h.models.vae })
          .filter(([, ok]) => !ok).map(([k]) => k)
      : [];
    if (!h.models?.nodesPresent) {
      el.health.innerHTML =
        `<span class="dot dot-err"></span><span class="health-text">ComfyUI ${escapeHtml(h.version)} 缺少 Music 3 节点，需升级到 ≥0.33.1</span>`;
      return false;
    }
    if (missing.length) {
      el.health.innerHTML =
        `<span class="dot dot-err"></span><span class="health-text">缺少模型：${missing.join('、')}</span>`;
      return false;
    }
    el.health.innerHTML =
      `<span class="dot dot-ok"></span><span class="health-text">ComfyUI ${escapeHtml(h.version)} · ${escapeHtml(h.device)} · 显存 ${h.vramFreeMB}/${h.vramTotalMB} MB</span>`;
    return true;
  } catch {
    el.health.innerHTML =
      `<span class="dot dot-err"></span><span class="health-text">工作台服务异常</span>`;
    return false;
  }
}

/* ============================ 预设 / 歌词标签 ============================ */

function renderPresets() {
  el.presets.innerHTML = '';
  for (const p of state.presets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset';
    btn.dataset.id = p.id;
    btn.innerHTML = `<span>${p.emoji}</span><span>${escapeHtml(p.name)}</span>`;
    btn.addEventListener('click', () => {
      el.caption.value = p.caption;
      el.lyrics.value = p.lyrics;
      if (!el.title.value.trim()) el.title.value = p.name;
      document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('active', b === btn));
      updateCaptionCount();
    });
    el.presets.appendChild(btn);
  }
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

const updateCaptionCount = () => { el.captionCount.textContent = el.caption.value.length; };

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
      el.etaNote.textContent = `自回归编码器 ${est.arSteps.toLocaleString()} 步`;
      el.eta.classList.toggle('eta-long', est.maxSec > 20 * 60);
      el.genEta.textContent = est.text;
    } catch {
      el.etaValue.textContent = '—';
    }
  }, 120);
}

/* ============================ 提交 ============================ */

function showError(msg) {
  el.formError.textContent = msg;
  el.formError.hidden = false;
}
const clearError = () => { el.formError.hidden = true; };

async function submit() {
  clearError();
  const caption = el.caption.value.trim();
  if (!caption) {
    showError('请先填写音乐描述 —— 这是模型唯一的创作依据。');
    el.caption.focus();
    return;
  }

  const payload = {
    title: el.title.value.trim(),
    caption,
    lyrics: el.lyrics.value,
    duration: Number(el.duration.value),
    seed: el.seed.value === '' ? undefined : Number(el.seed.value),
    steps: Number(el.steps.value),
    cfgScale: Number(el.cfgScale.value),
    topK: Number(el.topK.value),
  };

  el.generate.disabled = true;
  el.generate.querySelector('.gen-label').textContent = '提交中…';
  try {
    await api.createJob(payload);
    state.everGenerated = true;
    toast('已加入队列 —— 可以关掉这个页面，生成在后台继续。');
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
  // 预估只是预估，封顶 96%，不要显示 100% 却还没好
  return { elapsed, pct: Math.min(96, (elapsed / total) * 100), total };
}

function renderJobs() {
  const filtered = state.jobs.filter((j) => {
    if (state.filter === 'active') return j.status === 'queued' || j.status === 'running';
    if (state.filter === 'done') return j.status === 'done';
    return true;
  });

  if (filtered.length === 0) {
    el.joblist.innerHTML = `<div class="empty">${
      state.filter === 'all' ? '还没有作品。左边写点什么，点"开始生成"。' : '这个分类下没有内容。'
    }</div>`;
    return;
  }

  el.joblist.innerHTML = '';
  for (const job of filtered) el.joblist.appendChild(renderJobCard(job));
}

function renderJobCard(job) {
  const card = document.createElement('div');
  card.className = 'job';
  card.dataset.id = job.id;

  const created = new Date(job.createdAt).toLocaleString('zh-CN', { hour12: false });
  const parts = [`${fmtDuration(job.duration)}`, `seed ${job.seed}`, `${job.steps} 步`];

  card.innerHTML = `
    <div class="job-head">
      <div>
        <p class="job-title">${escapeHtml(job.title || '未命名')}</p>
        <div class="job-meta">${parts.join(' · ')} · ${escapeHtml(created)}</div>
      </div>
      <span class="badge badge-${job.status}">${STATUS_TEXT[job.status] ?? job.status}</span>
    </div>`;

  const prog = jobProgress(job);
  if (job.status === 'queued' || prog) {
    const wrap = document.createElement('div');
    wrap.className = 'job-progress';
    if (prog) {
      wrap.innerHTML = `
        <div class="bar"><i style="width:${prog.pct.toFixed(1)}%"></i></div>
        <div class="progress-text">
          <span>已用 ${fmtClock(prog.elapsed)}</span>
          <span>预计共 ${fmtClock(job.estimateMinSec)} ~ ${fmtClock(job.estimateMaxSec)}</span>
        </div>`;
    } else {
      wrap.innerHTML = `
        <div class="bar indeterminate"><i></i></div>
        <div class="progress-text"><span>排队等待 GPU</span><span></span></div>`;
    }
    card.appendChild(wrap);
  }

  if (job.status === 'done') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = api.audioUrl(job.id);
    audio.addEventListener('play', () => { state.playing = job.id; });
    // max_duration 只是上限，模型常常提前收尾。不标出实际长度，
    // 用户会以为"我要了 3 分钟只给我 2 分 10 秒"是 bug。
    audio.addEventListener('loadedmetadata', () => {
      const actual = Math.round(audio.duration);
      if (!Number.isFinite(actual) || actual <= 0) return;
      const meta = card.querySelector('.job-meta');
      if (meta && !meta.dataset.actualShown) {
        meta.dataset.actualShown = '1';
        meta.textContent = meta.textContent.replace(
          fmtDuration(job.duration),
          `实际 ${fmtDuration(actual)}（上限 ${fmtDuration(job.duration)}）`,
        );
      }
    });
    card.appendChild(audio);
  }

  if (job.status === 'error' && job.error) {
    const e = document.createElement('div');
    e.className = 'job-error';
    e.textContent = job.error;
    card.appendChild(e);
  }

  card.appendChild(buildActions(job));

  if (state.expanded.has(job.id)) card.appendChild(buildDetail(job));
  return card;
}

function buildActions(job) {
  const row = document.createElement('div');
  row.className = 'job-actions';

  const add = (label, onClick, danger = false) => {
    const b = document.createElement('button');
    b.className = `act${danger ? ' act-danger' : ''}`;
    b.textContent = label;
    b.addEventListener('click', onClick);
    row.appendChild(b);
  };

  add(state.expanded.has(job.id) ? '收起描述' : '查看描述', () => {
    if (state.expanded.has(job.id)) state.expanded.delete(job.id);
    else state.expanded.add(job.id);
    renderJobs();
  });

  add('用这套参数再来一次', () => {
    el.title.value = job.title ?? '';
    el.caption.value = job.caption ?? '';
    el.lyrics.value = job.lyrics ?? '';
    el.duration.value = String(job.duration);
    el.steps.value = String(job.steps);
    el.cfgScale.value = String(job.cfgScale);
    el.topK.value = String(job.topK);
    el.seed.value = '';   // 换个种子出新版本
    updateDurationUI();
    updateCaptionCount();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('参数已填入，种子留空 = 生成不同版本');
  });

  if (job.status === 'done') {
    add('下载 MP3', () => { window.location.href = api.audioUrl(job.id, true); });
  }

  if (job.status === 'queued' || job.status === 'running') {
    add('取消', async () => {
      try { await api.cancelJob(job.id); await refreshJobs(); toast('已取消'); }
      catch (e) { toast(`取消失败：${e.message}`); }
    }, true);
  } else {
    add('从列表删除', async () => {
      try { await api.deleteJob(job.id); state.expanded.delete(job.id); await refreshJobs(); }
      catch (e) { toast(`删除失败：${e.message}`); }
    }, true);
  }

  return row;
}

function buildDetail(job) {
  const d = document.createElement('div');
  d.className = 'job-detail';
  d.textContent =
    `【音乐描述】\n${job.caption}\n\n【歌词】\n${job.lyrics}\n\n`
    + `【参数】duration=${job.duration}s  seed=${job.seed}  steps=${job.steps}  `
    + `cfg=${job.cfgScale}  top_k=${job.topK}`;
  return d;
}

/* ============================ 轮询 ============================ */

async function refreshJobs() {
  try {
    const { jobs } = await api.listJobs();
    state.jobs = jobs;
    // 正在播放时不要重建 DOM，否则音频会被打断
    const playingLive = state.playing
      && el.joblist.querySelector(`.job[data-id="${CSS.escape(state.playing)}"] audio`);
    if (playingLive && !playingLive.paused) {
      updateLiveProgressOnly();
      return;
    }
    renderJobs();
  } catch { /* 后端短暂不可用时保持现状 */ }
}

/** 只刷新进行中任务的进度条，不重建整个列表 */
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
  renderTagbar();
  updateCaptionCount();

  try {
    const cfg = await api.getConfig();
    state.presets = cfg.presets ?? [];
    el.duration.min = String(cfg.limits.minDuration);
    el.duration.max = String(cfg.limits.maxDuration);
    el.duration.value = String(cfg.defaults.duration);
    el.steps.value = String(cfg.defaults.steps);
    el.cfgScale.value = String(cfg.defaults.cfgScale);
    el.topK.value = String(cfg.defaults.topK);
    renderPresets();
  } catch (e) {
    showError(`加载配置失败：${e.message}`);
  }

  await refreshJobs();
  // 已有完成记录 = 模型多半还在内存里，别再按冷启动报预估
  state.everGenerated = state.jobs.some((j) => j.status === 'done');
  updateDurationUI();
  await refreshHealth();

  el.caption.addEventListener('input', updateCaptionCount);
  el.duration.addEventListener('input', updateDurationUI);
  el.generate.addEventListener('click', submit);

  document.querySelectorAll('.duration-quick button').forEach((b) => {
    b.addEventListener('click', () => {
      el.duration.value = b.dataset.dur;
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
