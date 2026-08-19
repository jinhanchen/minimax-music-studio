/**
 * MiniMax Music 3 工作台 —— HTTP 服务入口。
 *
 * 职责：服务前端静态文件 + 一层薄 API + 代理音频流。
 * 之所以要这一层（而不是让前端直连 ComfyUI）：
 *   1. 避开 CORS，不用给 ComfyUI 加启动参数
 *   2. 任务要在服务端盯着，浏览器关了也能继续
 *   3. 生成历史落盘，跨重启可查
 */
import http from 'node:http';
import { Readable } from 'node:stream';
import { PORT, COMFY_URL, MODELS, LIMITS, DEFAULTS } from './config.js';
import { validateGenerateRequest, ValidationError } from './validate.js';
import { estimateDuration } from './estimate.js';
import * as comfy from './comfy-api.js';
import * as library from './library.js';
import * as jobs from './jobs.js';
import { serveStatic } from './static-files.js';
import { PRESETS } from './presets.js';

const MAX_BODY_BYTES = 1024 * 1024; // caption + 歌词，1MB 绰绰有余

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ValidationError('body', '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ValidationError('body', '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

const routes = {
  'GET /api/health': async () => {
    const status = await comfy.getStatus();
    if (!status.online) {
      return {
        status: 200,
        body: {
          online: false,
          comfyUrl: COMFY_URL,
          hint: 'ComfyUI 没有运行。在项目目录执行 npm run comfyui 启动它。',
        },
      };
    }
    let models = null;
    try {
      models = await comfy.checkModels(MODELS);
    } catch { /* 模型探测失败不阻塞健康检查 */ }
    return { status: 200, body: { ...status, comfyUrl: COMFY_URL, models } };
  },

  'GET /api/config': async () => ({
    status: 200,
    body: { limits: LIMITS, defaults: DEFAULTS, presets: PRESETS },
  }),

  'POST /api/estimate': async (req) => {
    const body = await readBody(req);
    const duration = Number(body?.duration);
    if (!Number.isFinite(duration)) {
      throw new ValidationError('duration', 'duration 必须是数字');
    }
    const clamped = Math.min(LIMITS.maxDuration, Math.max(LIMITS.minDuration, duration));
    return { status: 200, body: estimateDuration(clamped, Boolean(body?.coldStart)) };
  },

  'GET /api/jobs': async () => ({ status: 200, body: { jobs: await library.listJobs() } }),

  'POST /api/jobs': async (req) => {
    const params = validateGenerateRequest(await readBody(req));
    const job = await jobs.submitJob(params);
    return { status: 201, body: job };
  },

  'POST /api/jobs/:id/cancel': async (_req, { id }) => {
    const job = await jobs.cancelJob(id);
    if (!job) return { status: 404, body: { error: '任务不存在' } };
    return { status: 200, body: job };
  },

  'DELETE /api/jobs/:id': async (_req, { id }) => {
    const removed = await library.removeJob(id);
    return removed
      ? { status: 200, body: { ok: true } }
      : { status: 404, body: { error: '任务不存在' } };
  },
};

/** 音频流单独处理：要透传二进制，不走 JSON 路由 */
async function handleAudio(res, jobId, { download }) {
  const job = await library.getJob(jobId);
  if (!job?.audio) {
    return sendJson(res, 404, { error: '这个任务还没有音频输出' });
  }
  const upstream = await comfy.fetchAudio(job.audio);
  const safeName = `${(job.title || 'music3').replace(/[^\p{L}\p{N}_ -]/gu, '_').slice(0, 60)}.mp3`;
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'none',
    ...(upstream.headers.get('content-length')
      ? { 'Content-Length': upstream.headers.get('content-length') } : {}),
    ...(download
      ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}` }
      : {}),
  });
  Readable.fromWeb(upstream.body).pipe(res);
}

function matchRoute(method, pathname) {
  const direct = `${method} ${pathname}`;
  if (routes[direct]) return { handler: routes[direct], params: {} };

  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method || !pattern.includes(':')) continue;
    const pk = pattern.split('/');
    const ak = pathname.split('/');
    if (pk.length !== ak.length) continue;
    const params = {};
    const ok = pk.every((seg, i) => {
      if (seg.startsWith(':')) { params[seg.slice(1)] = decodeURIComponent(ak[i]); return true; }
      return seg === ak[i];
    });
    if (ok) return { handler: routes[key], params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const { pathname } = url;

  try {
    // 音频流
    const audioMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/audio$/);
    if (req.method === 'GET' && audioMatch) {
      return await handleAudio(res, decodeURIComponent(audioMatch[1]), {
        download: url.searchParams.get('download') === '1',
      });
    }

    const matched = matchRoute(req.method, pathname);
    if (matched) {
      const { status, body } = await matched.handler(req, matched.params);
      return sendJson(res, status, body);
    }

    if (req.method === 'GET' && await serveStatic(req, res, pathname)) return;

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof ValidationError) {
      return sendJson(res, 400, { error: err.message, field: err.field });
    }
    if (err instanceof comfy.ComfyUnavailableError) {
      return sendJson(res, 503, {
        error: `连不上 ComfyUI（${COMFY_URL}）。先执行 npm run comfyui 启动它。`,
      });
    }
    if (err instanceof comfy.ComfyRejectedError) {
      return sendJson(res, 400, {
        error: 'ComfyUI 拒绝了这个任务',
        detail: err.payload,
      });
    }
    console.error('[server] 未处理异常:', err);
    sendJson(res, 500, { error: '服务器内部错误', detail: String(err?.message ?? err) });
  }
});

const resumed = await jobs.resumeUnfinished().catch((e) => {
  console.error('[server] 恢复在途任务失败:', e.message);
  return 0;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  MiniMax Music 3 工作台');
  console.log(`  → http://127.0.0.1:${PORT}`);
  console.log(`  ComfyUI: ${COMFY_URL}`);
  if (resumed > 0) console.log(`  已恢复 ${resumed} 个在途任务`);
  console.log('');
});
