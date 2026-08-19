/**
 * 耗时预估。
 *
 * 这个模块存在的唯一理由：在这台机器上生成 3 分钟的歌要接近一小时，
 * 用户必须在点"生成"之前就知道，而不是等了 20 分钟才发现还早。
 *
 * 依据（本机实测，RTX 5070 Laptop 8GB + int8 模型）：
 *   - MiniMaxMusic3AR 是自回归模型，步数 = 音乐秒数 × 25
 *   - 实测速率 1.05 ~ 1.88 it/s（8.76GB 模型在 8GB 卡上流式加载，速率有波动）
 *   - KSampler 扩散 + VAE 解码约 20 秒固定开销
 *   - 实测锚点：20 秒音乐 → 300 秒（模型已常驻内存）
 */
import { SPEED } from './config.js';

/**
 * @param {number} durationSec 目标音乐时长（秒）
 * @param {boolean} coldStart 模型是否需要先从磁盘加载
 * @returns {{minSec:number, maxSec:number, arSteps:number, text:string}}
 */
export function estimateDuration(durationSec, coldStart = false) {
  const arSteps = Math.round(durationSec * SPEED.arStepsPerSecondOfAudio);
  const cold = coldStart ? SPEED.coldStartSec : 0;

  const minSec = Math.round(arSteps / SPEED.arItPerSecMax + SPEED.fixedOverheadSec + cold);
  const maxSec = Math.round(arSteps / SPEED.arItPerSecMin + SPEED.fixedOverheadSec + cold);

  return { minSec, maxSec, arSteps, text: formatRange(minSec, maxSec) };
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
  // 差距不大时不必显示区间，避免界面噪音
  if (maxSec - minSec < Math.max(20, minSec * 0.15)) return `约 ${formatOne(maxSec)}`;
  return `约 ${formatOne(minSec)} ~ ${formatOne(maxSec)}`;
}

export { formatOne as formatSeconds };
