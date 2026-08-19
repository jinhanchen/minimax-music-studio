/**
 * 把生成结果适配到指定时长 —— BGM 场景的刚需。
 *
 * 为什么需要这个：模型自己决定歌曲何时结束，max_duration 只是上限。
 * 实测同一段描述、同样请求 20 秒，不同种子分别给出 19.99s / 19.99s / 13.15s。
 * 配视频时长度对不上，剪辑就得返工。
 *
 * 做法：
 *   短了 → 用 acrossfade 交叉淡化循环拼接（不用 -stream_loop 硬接，接缝会"咔"一下）
 *   长了 → 直接裁剪
 *   两端统一加淡入淡出，避免突兀开头和硬切结尾
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** 循环段数上限：防止极短素材 + 极长目标把命令行撑爆 */
const MAX_SEGMENTS = 30;

export class FfmpegError extends Error {
  constructor(message, stderr) {
    super(message);
    this.name = 'FfmpegError';
    this.stderr = stderr;
  }
}

function run(bin, args, { collectStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const out = [];
    const err = [];
    if (collectStdout) child.stdout.on('data', (c) => out.push(c));
    else child.stdout.resume();
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => reject(new FfmpegError(`无法启动 ${bin}：${e.message}`, '')));
    child.on('close', (code) => {
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) return reject(new FfmpegError(`${bin} 退出码 ${code}`, stderr.slice(-1500)));
      resolve(Buffer.concat(out));
    });
  });
}

/** 读源文件时长；ffprobe 不可用时抛错，让调用方给出明确提示 */
export async function probeDuration(filePath) {
  const buf = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], { collectStdout: true });
  const sec = Number(buf.toString('utf8').trim());
  if (!Number.isFinite(sec) || sec <= 0) {
    throw new FfmpegError('无法读取音频时长', buf.toString('utf8'));
  }
  return sec;
}

/**
 * 计算覆盖目标时长需要几段。
 * 每次 crossfade 会吃掉 cf 秒，所以 N 段总长 = N*L - (N-1)*cf。
 */
export function segmentsNeeded(srcSec, targetSec, cf) {
  if (srcSec >= targetSec) return 1;
  const effective = srcSec - cf;
  if (effective <= 0) return MAX_SEGMENTS;  // 素材比淡化时间还短，尽力而为
  return Math.min(MAX_SEGMENTS, Math.ceil((targetSec - cf) / effective));
}

/**
 * 构造 filter_complex。
 * 分开成纯函数，方便单独验证链路拼接是否正确。
 */
export function buildFilter(segments, targetSec, { crossfade, fadeIn, fadeOut }) {
  const steps = [];
  let cursor = '[0]';

  for (let i = 1; i < segments; i += 1) {
    const label = `[x${i}]`;
    steps.push(`${cursor}[${i}]acrossfade=d=${crossfade}:c1=tri:c2=tri${label}`);
    cursor = label;
  }

  const fadeOutStart = Math.max(0, targetSec - fadeOut);
  steps.push(
    `${cursor}atrim=0:${targetSec},asetpts=N/SR/TB,`
    + `afade=t=in:st=0:d=${fadeIn},`
    + `afade=t=out:st=${fadeOutStart}:d=${fadeOut}[out]`,
  );

  return steps.join(';');
}

/**
 * 生成适配到 targetSec 的 mp3，返回 Buffer。
 *
 * 必须落临时文件，不能用 `-f mp3 pipe:1`：管道输出时 ffmpeg 无法回头写
 * Xing/VBR 头，播放器和剪辑软件只能按码率估算时长，60 秒的文件会被读成
 * 63.5 秒。音频内容是对的，但头是错的 —— 对要进剪辑轨道的 BGM 这是硬伤。
 */
export async function exportWithDuration(srcPath, targetSec, options = {}) {
  const fadeIn = options.fadeIn ?? 0.8;
  const fadeOut = options.fadeOut ?? Math.min(2.5, targetSec / 8);
  let crossfade = options.crossfade ?? 1.5;

  const srcSec = await probeDuration(srcPath);
  // 交叉淡化不能长过素材本身
  crossfade = Math.min(crossfade, Math.max(0.2, srcSec / 3));

  const segments = segmentsNeeded(srcSec, targetSec, crossfade);
  const filter = buildFilter(segments, targetSec, { crossfade, fadeIn, fadeOut });

  const tmp = path.join(os.tmpdir(), `music3_export_${randomUUID()}.mp3`);
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (let i = 0; i < segments; i += 1) args.push('-i', srcPath);
  args.push(
    '-filter_complex', filter,
    '-map', '[out]',
    '-t', String(targetSec),          // 与 atrim 双保险
    '-c:a', 'libmp3lame', '-q:a', '0',
    tmp,
  );

  try {
    await run('ffmpeg', args);
    const buffer = await fs.readFile(tmp);
    if (buffer.length === 0) throw new FfmpegError('ffmpeg 没有输出数据', '');
    const outSec = await probeDuration(tmp);
    return { buffer, srcSec, outSec, segments, looped: segments > 1 };
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}
