/**
 * 全局配置。所有路径与魔法数字集中在这里，不散落到业务代码。
 * 可用环境变量覆盖，方便换机器部署。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/** 本工作台监听端口 */
export const PORT = Number(process.env.MUSIC_STUDIO_PORT ?? 5178);

/**
 * ComfyUI 地址。
 * 必须用 127.0.0.1 而非 localhost —— Windows 上 localhost 会先试 IPv6 ::1，
 * 等约 2 秒超时再回落 IPv4，而 ComfyUI 只监听 IPv4。
 */
export const COMFY_URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8188';

/** ComfyUI 安装位置（启动脚本与 doctor 用） */
export const COMFY_INSTALL = process.env.COMFY_INSTALL
  ?? 'E:/Comfy-Desktop/ComfyUI-Installs/minimax-h3/ComfyUI';

/** ComfyUI 输出目录，音频文件最终落在这里的 audio/ 子目录 */
export const COMFY_OUTPUT = process.env.COMFY_OUTPUT
  ?? 'E:/Comfy-Desktop/ComfyUI-Shared/output';

/** 模型根目录。下载向导往这里的 diffusion_models / text_encoders / vae 放文件 */
export const MODELS_DIR = process.env.MODELS_DIR
  ?? 'E:/Comfy-Desktop/ComfyUI-Shared/models';

/**
 * 模型下载源。魔搭在国内直连快很多，HuggingFace 作备选。
 * 两边文件逐字节一致（本项目部署时校验过）。
 */
export const MODEL_SOURCES = Object.freeze([
  {
    id: 'modelscope',
    label: '魔搭 ModelScope（国内推荐）',
    base: 'https://www.modelscope.cn/models/Comfy-Org/MiniMax-Music-3/resolve/master',
  },
  {
    id: 'huggingface',
    label: 'HuggingFace（需要代理）',
    base: 'https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main',
  },
]);

/** 生成记录索引文件 */
export const LIBRARY_FILE = path.join(ROOT, 'data', 'library.json');

/** 模型文件名 —— 8GB 显存走 int8 路线 */
export const MODELS = Object.freeze({
  dit: 'minimax_music3_dit_int8_convrot.safetensors',
  textEncoder: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
  vae: 'minimax_music3_dav.safetensors',
});

/**
 * 模型硬约束，来自 comfy/ldm/minimax_music/ar.py：
 *   MAX_AUDIO_FRAMES = 9000, AUDIO_FRAMES_PER_SECOND = 25
 * 最长 9000 / 25 = 360 秒。
 */
export const LIMITS = Object.freeze({
  minDuration: 5,
  maxDuration: 360,
  framesPerSecond: 25,
  minSteps: 1,
  maxSteps: 100,
  maxCaptionChars: 4000,
  maxLyricsChars: 8000,
});

/** 默认生成参数，取自官方工作流模板 */
export const DEFAULTS = Object.freeze({
  duration: 60,
  steps: 30,
  cfgScale: 1.7,
  topK: 50,
  format: 'mp3',
  quality: 'V0',
  tileSize: 1536,
  tileOverlap: 64,
});

/**
 * 本机实测速度基准（RTX 5070 Laptop 8GB，int8 模型，权重流式加载）：
 * 自回归编码器步数 = 时长 × 25，实测 1.05~1.88 it/s。
 * 用于给用户显示诚实的耗时预估，而不是假装"马上好"。
 */
export const SPEED = Object.freeze({
  arStepsPerSecondOfAudio: 25,
  arItPerSecMin: 1.05,
  arItPerSecMax: 1.88,
  /** 扩散 + VAE 解码等固定开销（秒） */
  fixedOverheadSec: 20,
  /** 模型冷启动加载耗时（秒），仅首次 */
  coldStartSec: 76,
});
