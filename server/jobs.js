/**
 * 任务编排：提交到 ComfyUI，后台盯着直到出结果，全程落盘。
 *
 * 关键约束：一首歌几十分钟，浏览器一定会被关掉，所以「盯任务」这件事
 * 必须由服务端做，不能挂在前端轮询上。服务重启后还要能把在途任务捡回来。
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { COMFY_OUTPUT } from './config.js';
import { buildWorkflow, SAVE_NODE_ID } from './workflow.js';
import { estimateDuration, calibrate } from './estimate.js';
import { getStyle } from './styles.js';
import { probeDuration } from './export-audio.js';
import * as comfy from './comfy-api.js';
import * as library from './library.js';

const POLL_INTERVAL_MS = 4_000;
/** 单个任务最长盯 4 小时，超时判失败，避免僵尸任务永远占着队列 */
const MAX_WATCH_MS = 4 * 60 * 60 * 1000;

const CLIENT_ID = randomUUID();

/** 正在盯的任务，防止重复启动 watcher */
const watching = new Set();

/** 首次生成需要加载模型；同一个进程里只冷启动一次 */
let modelsWarm = false;

export async function submitJob(params) {
  const estimate = estimateDuration(params.duration, {
    coldStart: !modelsWarm,
    calibration: calibrate(await library.listJobs()),
  });
  const workflow = buildWorkflow({ ...params, filenamePrefix: 'audio/music3' });

  const res = await comfy.submitPrompt(workflow, CLIENT_ID);
  const promptId = res?.prompt_id;
  if (!promptId) {
    throw new Error('ComfyUI 没有返回 prompt_id，任务未进入队列');
  }

  const now = new Date().toISOString();
  const job = Object.freeze({
    id: randomUUID(),
    promptId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    title: params.title || deriveTitle(params),
    caption: params.caption,
    lyrics: params.lyrics,
    // 留档创作意图本身，而不只是合成后的英文 —— 复用参数时要还原成
    // "什么风格 + 你当时怎么说的"，那才是可编辑的东西
    styleId: params.styleId ?? null,
    vocalId: params.vocalId ?? null,
    brief: params.brief ?? '',
    captionEdited: Boolean(params.captionEdited),
    duration: params.duration,
    seed: params.seed,
    steps: params.steps,
    cfgScale: params.cfgScale,
    topK: params.topK,
    quality: params.quality,
    estimateMinSec: estimate.minSec,
    estimateMaxSec: estimate.maxSec,
    arSteps: estimate.arSteps,
    audio: null,
    error: null,
  });

  await library.addJob(job);
  modelsWarm = true;
  watch(job.id, promptId);
  return job;
}

/**
 * 自动标题：优先用用户自己的话（那才是他记得住的），
 * 没有就退回曲风名，都没有才从合成的 caption 里抠。
 */
function deriveTitle(params) {
  const brief = (params.brief ?? '').trim();
  if (brief) return brief.split(/[.。\n,，]/)[0].trim().slice(0, 40) || brief.slice(0, 40);

  const style = getStyle(params.styleId);
  if (style) return style.name;

  const cleaned = (params.caption ?? '')
    .replace(/^\s*(Global Metadata|Vocal Details|Arrangement)\s*:\s*/i, '').trim();
  return (cleaned.split(/[.。\n]/).find((s) => s.trim().length > 0) ?? '未命名').trim().slice(0, 60);
}

/**
 * 后台盯一个任务直到终态。
 * 刻意不 await —— 调用方立即返回，让 HTTP 请求不被几十分钟的生成阻塞。
 */
function watch(jobId, promptId) {
  if (watching.has(jobId)) return;
  watching.add(jobId);

  const deadline = Date.now() + MAX_WATCH_MS;

  const tick = async () => {
    if (Date.now() > deadline) {
      await library.updateJob(jobId, {
        status: 'error',
        error: '超过 4 小时未完成，已放弃跟踪（ComfyUI 可能已崩溃）',
        finishedAt: new Date().toISOString(),
      });
      watching.delete(jobId);
      return;
    }

    try {
      const history = await comfy.getHistory(promptId);
      const entry = history?.[promptId];

      if (entry) {
        await finalize(jobId, entry);
        watching.delete(jobId);
        return;
      }

      // 还没进历史 —— 分辨"排队中"还是"正在跑"，好让前端显示得准确
      const queue = await comfy.getQueue();
      const isRunning = (queue?.queue_running ?? []).some((it) => it?.[1] === promptId);
      const current = await library.getJob(jobId);
      if (isRunning && current?.status !== 'running') {
        await library.updateJob(jobId, { status: 'running', startedAt: new Date().toISOString() });
      } else if (!isRunning && !(queue?.queue_pending ?? []).some((it) => it?.[1] === promptId)) {
        // 既不在运行也不在等待，历史里又没有 —— 多半是被取消了
        if (current?.status === 'running' || current?.status === 'queued') {
          const stillGone = await comfy.getHistory(promptId).then((h) => !h?.[promptId]).catch(() => true);
          if (stillGone) {
            await library.updateJob(jobId, {
              status: 'canceled',
              finishedAt: new Date().toISOString(),
            });
            watching.delete(jobId);
            return;
          }
        }
      }
    } catch (err) {
      // ComfyUI 暂时不可达不算失败 —— 它可能正在重启，继续盯着
      if (!(err instanceof comfy.ComfyUnavailableError)) {
        console.error(`[jobs] 任务 ${jobId} 轮询异常:`, err.message);
      }
    }

    setTimeout(tick, POLL_INTERVAL_MS);
  };

  setTimeout(tick, POLL_INTERVAL_MS);
}

async function finalize(jobId, entry) {
  const status = entry?.status ?? {};
  const finishedAt = new Date().toISOString();

  const failed = status.status_str === 'error' || status.completed === false;
  if (failed) {
    await library.updateJob(jobId, {
      status: 'error',
      error: extractError(status),
      finishedAt,
    });
    return;
  }

  const audioList = entry?.outputs?.[SAVE_NODE_ID]?.audio ?? [];
  const audio = audioList[0];
  if (!audio) {
    await library.updateJob(jobId, {
      status: 'error',
      error: '任务完成但没有音频输出，请检查 ComfyUI 日志',
      finishedAt,
    });
    return;
  }

  const current = await library.getJob(jobId);
  const info = {
    filename: audio.filename,
    subfolder: audio.subfolder ?? '',
    type: audio.type ?? 'output',
  };

  await library.updateJob(jobId, {
    status: 'done',
    finishedAt,
    audio: info,
    // 这两个数是耗时预估自校准的原料：
    // actualSec 决定真实 AR 步数（模型会提前收尾，不等于请求时长）
    // computeSec 是纯生成耗时（不含排队）
    actualSec: await measureAudioSeconds(info),
    computeSec: computeSeconds(current, finishedAt),
  });
}

/** 纯生成耗时：从真正开始跑算起，排队等待不算 */
function computeSeconds(job, finishedAt) {
  const start = job?.startedAt ?? job?.createdAt;
  if (!start) return null;
  const sec = (new Date(finishedAt) - new Date(start)) / 1000;
  return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 100) / 100 : null;
}

/** 读实际输出时长；ffprobe 不在就返回 null，不影响主流程 */
async function measureAudioSeconds(info) {
  try {
    const file = path.join(COMFY_OUTPUT, info.subfolder ?? '', info.filename);
    return Math.round(await probeDuration(file) * 100) / 100;
  } catch {
    return null;
  }
}

/**
 * 给历史任务补上 actualSec —— 老记录没有这两个字段，
 * 不补的话自校准要等攒够新样本才生效。
 */
export async function backfillMeasurements() {
  const all = await library.listJobs();
  let filled = 0;
  for (const job of all) {
    if (job.status !== 'done' || !job.audio) continue;
    const patch = {};
    if (!Number.isFinite(job.actualSec)) {
      const sec = await measureAudioSeconds(job.audio);
      if (sec) patch.actualSec = sec;
    }
    if (!Number.isFinite(job.computeSec) && job.finishedAt) {
      const sec = computeSeconds(job, job.finishedAt);
      if (sec) patch.computeSec = sec;
    }
    if (Object.keys(patch).length) {
      await library.updateJob(job.id, patch);
      filled += 1;
    }
  }
  return filled;
}

function extractError(status) {
  const messages = status?.messages ?? [];
  for (const m of messages) {
    const [kind, payload] = Array.isArray(m) ? m : [];
    if (kind === 'execution_error' && payload) {
      const node = payload.node_type ? `[${payload.node_type}] ` : '';
      return `${node}${payload.exception_type ?? ''}: ${payload.exception_message ?? '未知错误'}`.trim();
    }
  }
  return '生成失败，未拿到具体错误信息';
}

/** 服务启动时调用：把上次没跑完的任务重新盯起来 */
export async function resumeUnfinished() {
  const pending = await library.findUnfinished();
  for (const job of pending) {
    if (job.promptId) {
      modelsWarm = true;
      watch(job.id, job.promptId);
    }
  }
  return pending.length;
}

export async function cancelJob(jobId) {
  const job = await library.getJob(jobId);
  if (!job) return null;
  if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') return job;

  if (job.status === 'running') {
    await comfy.interrupt();
  } else {
    await comfy.cancelQueued(job.promptId).catch(() => {});
  }
  return library.updateJob(jobId, {
    status: 'canceled',
    finishedAt: new Date().toISOString(),
  });
}
