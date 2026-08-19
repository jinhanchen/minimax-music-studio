/**
 * 系统边界的输入校验。
 * 前端传来的一切都不可信 —— 这里是唯一的守门口，通过后下游可放心使用。
 */
import { LIMITS, DEFAULTS } from './config.js';
import { composeCaption, getStyle } from './styles.js';

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

  // 曲风是"告诉模型这是什么类型的音乐"的分类信号，
  // brief 是用户自己对这一首的想法。最终 caption 由二者合成，
  // 除非用户改过合成结果（captionOverride）——那就以他改的为准。
  const styleId = typeof body.styleId === 'string' && getStyle(body.styleId)
    ? body.styleId : null;
  const vocalId = typeof body.vocalId === 'string' ? body.vocalId : null;
  const brief = typeof body.brief === 'string'
    ? body.brief.trim().slice(0, LIMITS.maxCaptionChars) : '';

  const override = typeof body.captionOverride === 'string' ? body.captionOverride.trim() : '';
  const composed = override || composeCaption({ styleId, vocalId, brief });

  if (!composed) {
    throw new ValidationError('caption',
      '至少要选一个曲风，或者自己写一段音乐描述 —— 模型需要知道要做什么样的音乐。');
  }
  if (composed.length > LIMITS.maxCaptionChars) {
    throw new ValidationError('caption', `描述超长（上限 ${LIMITS.maxCaptionChars} 字符）`);
  }
  const caption = composed;

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

  // 一次挂多个变体：BGM 场景一次不一定满意，而单次要等几十分钟，
  // 与其失望一次再重排队，不如一口气排几个种子，回来挑。
  const variants = clampInt(body.variants, 'variants', { min: 1, max: 5, fallback: 1 });

  return Object.freeze({
    caption, lyrics, duration, steps, cfgScale, topK, quality, title, variants,
    // 一并留档：回头点「用这套参数再来一次」时能把风格和你的原话还原出来，
    // 而不是只剩一段合成后的英文
    styleId, vocalId, brief, captionEdited: Boolean(override),
    seed: resolveSeed(body.seed),
  });
}

/** 导出时长的校验（BGM 适配用） */
export function validateExportRequest(query) {
  const seconds = Number(query.seconds);
  if (!Number.isFinite(seconds)) {
    throw new ValidationError('seconds', 'seconds 必须是数字');
  }
  if (seconds < 3 || seconds > 3600) {
    throw new ValidationError('seconds', '导出时长必须在 3 ~ 3600 秒之间');
  }
  return Math.round(seconds * 100) / 100;
}
