/**
 * 耗时预估 —— 从本机历史自校准。
 *
 * 这个模块存在的理由：在这台机器上生成一首歌要几十分钟，用户必须在点
 * "生成"之前就知道，而不是等了 20 分钟才发现还早。
 *
 * ## 两个必须算对的量
 *
 * 1) **AR 步数取决于「实际输出时长」，不是「请求时长」**
 *    MiniMaxMusic3AR 是自回归模型，逐帧生成，25 帧 = 1 秒音频。
 *    但 max_duration 只是上限 —— 模型会提前收尾，进度条根本跑不满
 *    （实测日志停在 331/501、1630/2501）。
 *    实测输出/请求比例呈双峰：要么 ~100%，要么 ~65%。所以预估必须是
 *    一个区间，下界按提前收尾算、上界按跑满算。
 *
 * 2) **每步耗时冷热差一倍**
 *    ComfyUI 刚启动后的第一次约 0.56 秒/步，之后稳定在 0.25~0.34 秒/步
 *    （v0.33.1 的 CUDA Graphs 需要先捕获、权重也要先进页缓存）。
 *
 * ## 为什么自校准
 *
 * 硬编码常数只对我测的那台机器、那个时刻成立。换显卡、换模型精度、
 * 后台开了别的程序，都会漂。所以默认值只作兜底，一旦本机攒够样本
 * 就用实测值 —— 用得越多越准。
 */

/** 模型固定参数，来自 comfy/ldm/minimax_music/ar.py */
export const AUDIO_FRAMES_PER_SECOND = 25;

/**
 * 兜底默认值（RTX 5070 Laptop 8GB + int8 实测拟合）。
 * 样本不足时用它，够了就被本机数据顶掉。
 */
export const FALLBACK = Object.freeze({
  secPerStepFast: 0.25,   // 热态最快
  secPerStepSlow: 0.34,   // 热态最慢
  secPerStepCold: 0.56,   // ComfyUI 启动后第一次
  overheadSec: 20,        // 扩散采样 + VAE 解码等固定开销
  coldLoadSec: 76,        // 首次把 8.6GB 编码器读进内存
  outputRatioLow: 0.65,   // 模型提前收尾时的输出/请求比例下界
});

/** 样本少于这个数就不信本机数据，波动太大 */
const MIN_SAMPLES = 3;
/** 只看最近这么多条，机器状态会变 */
const WINDOW = 12;

/**
 * 从历史任务里提取校准参数。
 * 只用记录了 actualSec（实际输出时长）和 computeSec（纯生成耗时）的样本。
 *
 * @param {Array} jobs library 里的任务列表
 * @returns {{secPerStepFast:number, secPerStepSlow:number, outputRatioLow:number,
 *            overheadSec:number, sampleCount:number, calibrated:boolean}}
 */
export function calibrate(jobs = []) {
  const usable = jobs
    .filter((j) => j.status === 'done'
      && Number.isFinite(j.actualSec) && j.actualSec > 0
      && Number.isFinite(j.computeSec) && j.computeSec > 0)
    .slice(0, WINDOW);

  if (usable.length < MIN_SAMPLES) {
    return {
      secPerStepFast: FALLBACK.secPerStepFast,
      secPerStepSlow: FALLBACK.secPerStepSlow,
      outputRatioLow: FALLBACK.outputRatioLow,
      overheadSec: FALLBACK.overheadSec,
      sampleCount: usable.length,
      calibrated: false,
    };
  }

  const perStep = usable
    .map((j) => {
      const steps = j.actualSec * AUDIO_FRAMES_PER_SECOND;
      return (j.computeSec - FALLBACK.overheadSec) / steps;
    })
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  const ratios = usable
    .map((j) => (j.duration > 0 ? j.actualSec / j.duration : null))
    .filter((v) => Number.isFinite(v) && v > 0 && v <= 1.05)
    .sort((a, b) => a - b);

  // 用分位数而非极值，一次异常（比如后台在跑别的东西）不至于把区间撑坏
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];

  return {
    secPerStepFast: q(perStep, 0.15),
    secPerStepSlow: q(perStep, 0.85),
    outputRatioLow: Math.max(0.4, Math.min(1, ratios.length ? q(ratios, 0.1) : FALLBACK.outputRatioLow)),
    overheadSec: FALLBACK.overheadSec,
    sampleCount: usable.length,
    calibrated: true,
  };
}

/**
 * 预估一次生成要多久。
 *
 * @param {number} requestedSec 用户请求的时长上限
 * @param {object} opts
 * @param {boolean} opts.coldStart ComfyUI 刚启动、模型还没进内存
 * @param {object} opts.calibration calibrate() 的结果
 */
export function estimateDuration(requestedSec, opts = {}) {
  const coldStart = Boolean(opts.coldStart);
  const cal = opts.calibration ?? calibrate([]);

  const stepsMax = Math.round(requestedSec * AUDIO_FRAMES_PER_SECOND);
  const stepsMin = Math.round(requestedSec * cal.outputRatioLow * AUDIO_FRAMES_PER_SECOND);

  // 冷启动只影响上界的一部分：第一次要读盘 + 捕获 CUDA graph
  const fast = coldStart ? FALLBACK.secPerStepCold * 0.85 : cal.secPerStepFast;
  const slow = coldStart ? FALLBACK.secPerStepCold * 1.15 : cal.secPerStepSlow;
  const load = coldStart ? FALLBACK.coldLoadSec : 0;

  const minSec = Math.round(cal.overheadSec + load + stepsMin * fast);
  const maxSec = Math.round(cal.overheadSec + load + stepsMax * slow);

  return {
    minSec,
    maxSec,
    arSteps: stepsMax,
    arStepsMin: stepsMin,
    coldStart,
    calibrated: cal.calibrated,
    sampleCount: cal.sampleCount,
    text: formatRange(minSec, maxSec),
    basis: cal.calibrated
      ? `基于本机最近 ${cal.sampleCount} 次实测`
      : `默认基准（本机已积累 ${cal.sampleCount}/${MIN_SAMPLES} 次实测）`,
  };
}

function formatOne(sec) {
  if (sec < 90) return `${sec} 秒`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

function formatRange(minSec, maxSec) {
  if (maxSec - minSec < Math.max(20, minSec * 0.15)) return `约 ${formatOne(maxSec)}`;
  return `约 ${formatOne(minSec)} ~ ${formatOne(maxSec)}`;
}

export { formatOne as formatSeconds };
