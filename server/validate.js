/**
 * 系统边界的输入校验。
 * 前端传来的一切都不可信 —— 这里是唯一的守门口，通过后下游可放心使用。
 */
import { LIMITS, DEFAULTS } from './config.js';

export class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function requireString(value, field, { min = 0, max } = {}) {
  if (typeof value !== 'string') {
    throw new ValidationError(field, `${field} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new ValidationError(field, `${field} 不能为空`);
  }
  if (max !== undefined && trimmed.length > max) {
    throw new ValidationError(field, `${field} 超长（上限 ${max} 字符，当前 ${trimmed.length}）`);
  }
  return trimmed;
}

function clampInt(value, field, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!isFiniteNumber(n)) {
    throw new ValidationError(field, `${field} 必须是数字`);
  }
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) {
    throw new ValidationError(field, `${field} 必须在 ${min}~${max} 之间（收到 ${rounded}）`);
  }
  return rounded;
}

function clampFloat(value, field, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!isFiniteNumber(n)) {
    throw new ValidationError(field, `${field} 必须是数字`);
  }
  if (n < min || n > max) {
    throw new ValidationError(field, `${field} 必须在 ${min}~${max} 之间（收到 ${n}）`);
  }
  return n;
}

/** 未指定种子时随机一个，让每次生成不同 */
function resolveSeed(value) {
  if (value === undefined || value === null || value === '' || value === -1 || value === '-1') {
    return Math.floor(Math.random() * 2 ** 48);
  }
  const n = Number(value);
  if (!isFiniteNumber(n) || n < 0) {
    throw new ValidationError('seed', 'seed 必须是 ≥0 的整数，留空则随机');
  }
  return Math.floor(n);
}

const ALLOWED_QUALITY = Object.freeze(['V0', '128k', '320k']);

/**
 * 校验并归一化一次生成请求。
 * @returns {object} 全新的参数对象，字段齐全、类型正确
 */
export function validateGenerateRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('body', '请求体必须是 JSON 对象');
  }

  const caption = requireString(body.caption, 'caption', {
    min: 1, max: LIMITS.maxCaptionChars,
  });

  // 纯器乐是合法的，歌词可以为空 —— 但模型需要至少一个结构标签，兜底给 [Instrumental]
  const rawLyrics = typeof body.lyrics === 'string' ? body.lyrics.trim() : '';
  if (rawLyrics.length > LIMITS.maxLyricsChars) {
    throw new ValidationError('lyrics', `歌词超长（上限 ${LIMITS.maxLyricsChars} 字符）`);
  }
  const lyrics = rawLyrics === '' ? '[Instrumental]' : rawLyrics;

  const duration = clampFloat(body.duration, 'duration', {
    min: LIMITS.minDuration, max: LIMITS.maxDuration, fallback: DEFAULTS.duration,
  });

  const steps = clampInt(body.steps, 'steps', {
    min: LIMITS.minSteps, max: LIMITS.maxSteps, fallback: DEFAULTS.steps,
  });

  const cfgScale = clampFloat(body.cfgScale, 'cfgScale', {
    min: 0, max: 100, fallback: DEFAULTS.cfgScale,
  });

  const topK = clampInt(body.topK, 'topK', {
    min: 1, max: 16384, fallback: DEFAULTS.topK,
  });

  const quality = ALLOWED_QUALITY.includes(body.quality) ? body.quality : DEFAULTS.quality;

  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim().slice(0, 120)
    : '';

  return Object.freeze({
    caption, lyrics, duration, steps, cfgScale, topK, quality, title,
    seed: resolveSeed(body.seed),
  });
}
