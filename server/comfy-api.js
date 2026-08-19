/**
 * ComfyUI HTTP API 的薄封装。
 * 只用到 5 个端点：/system_stats /prompt /queue /history /view
 * 刻意不接 WebSocket —— 一次生成动辄几分钟，轮询完全够用，能省掉一个依赖。
 */
import { COMFY_URL } from './config.js';

export class ComfyUnavailableError extends Error {
  constructor(cause) {
    super('连不上 ComfyUI');
    this.name = 'ComfyUnavailableError';
    this.cause = cause;
  }
}

export class ComfyRejectedError extends Error {
  constructor(status, payload) {
    super('ComfyUI 拒绝了这个任务');
    this.name = 'ComfyRejectedError';
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, { method = 'GET', body, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(COMFY_URL + path, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let payload;
      try { payload = await res.json(); } catch { payload = await res.text().catch(() => ''); }
      throw new ComfyRejectedError(res.status, payload);
    }
    return res;
  } catch (err) {
    if (err instanceof ComfyRejectedError) throw err;
    throw new ComfyUnavailableError(err);
  } finally {
    clearTimeout(timer);
  }
}

const json = async (path, opts) => (await request(path, opts)).json();

/** ComfyUI 是否在线；顺带返回版本与显存，给前端做健康提示 */
export async function getStatus() {
  try {
    const stats = await json('/system_stats', { timeoutMs: 5_000 });
    const device = stats.devices?.[0] ?? {};
    return {
      online: true,
      version: stats.system?.comfyui_version ?? 'unknown',
      device: device.name ?? 'unknown',
      vramTotalMB: Math.round((device.vram_total ?? 0) / 1024 / 1024),
      vramFreeMB: Math.round((device.vram_free ?? 0) / 1024 / 1024),
    };
  } catch {
    return { online: false };
  }
}

/** 确认三个模型都被 ComfyUI 发现了 —— 部署没做完时给出明确诊断，而不是让任务神秘失败 */
export async function checkModels(models) {
  const info = await json('/object_info', { timeoutMs: 20_000 });
  const optionsOf = (node, input) => {
    const spec = info?.[node]?.input?.required?.[input];
    return Array.isArray(spec?.[0]) ? spec[0] : [];
  };
  return {
    dit: optionsOf('UNETLoader', 'unet_name').includes(models.dit),
    textEncoder: optionsOf('CLIPLoader', 'clip_name').includes(models.textEncoder),
    vae: optionsOf('VAELoader', 'vae_name').includes(models.vae),
    nodesPresent: Boolean(info?.MiniMaxMusic3TextEncode && info?.EmptyMiniMaxMusic3LatentAudio),
  };
}

export async function submitPrompt(workflow, clientId) {
  return json('/prompt', { method: 'POST', body: { prompt: workflow, client_id: clientId } });
}

export async function getHistory(promptId) {
  return json(`/history/${promptId}`, { timeoutMs: 15_000 });
}

export async function getQueue() {
  return json('/queue', { timeoutMs: 10_000 });
}

export async function interrupt() {
  await request('/interrupt', { method: 'POST', timeoutMs: 10_000 });
}

/** 从队列里删掉尚未开始的任务 */
export async function cancelQueued(promptId) {
  await request('/queue', { method: 'POST', body: { delete: [promptId] }, timeoutMs: 10_000 });
}

/** 透传音频文件流，让浏览器能直接播放/下载 */
export async function fetchAudio({ filename, subfolder = '', type = 'output' }) {
  const qs = new URLSearchParams({ filename, subfolder, type });
  return request(`/view?${qs}`, { timeoutMs: 120_000 });
}
