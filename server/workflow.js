/**
 * 构造 ComfyUI API 格式的工作流。
 *
 * 结构逆向自官方模板 comfyui_workflow_templates_json/templates/audio_minimax_music_3.json
 * （该模板用 subgraph 封装，这里是展开后的等价图），并已端到端实测跑通。
 *
 *   CLIPLoader(type=minimax) ─CLIP─> MiniMaxMusic3TextEncode ─┬─COND──> KSampler.positive
 *                                                             ├─COND──> ConditioningZeroOut ─> KSampler.negative
 *                                                             └─FLOAT(seconds)─> EmptyMiniMaxMusic3LatentAudio
 *   UNETLoader ─MODEL─> KSampler ─LATENT─> VAEDecodeAudioTiled ─AUDIO─> SaveAudioAdvanced
 *
 * 两个容易踩的点：
 * 1. TextEncode 的第 2 个输出是模型实际决定的时长（秒），用它驱动 latent 大小。
 *    max_duration 只是上限，模型可以提前结束。所以这条连线不能省。
 * 2. SaveAudioAdvanced.format 是 COMFY_DYNAMICCOMBO_V3，嵌套参数用扁平点号键
 *    "format.quality"，不是嵌套对象。依据 comfy_api/latest/_io.py 的
 *    prefixed_id = `${inp.id}.${nested_inp.id}`。
 */
import { MODELS, DEFAULTS } from './config.js';

/** 节点 id 用常量，避免散落的magic string */
const N = Object.freeze({
  clipLoader: '3',
  unetLoader: '6',
  vaeLoader: '7',
  textEncode: '13',
  zeroOut: '10',
  emptyLatent: '15',
  sampler: '9',
  decode: '42',
  save: '35',
});

/**
 * @param {object} params 已通过 validate.js 校验的参数
 * @returns {object} 全新的工作流对象（不修改入参）
 */
export function buildWorkflow(params) {
  const {
    caption,
    lyrics,
    duration,
    seed,
    steps = DEFAULTS.steps,
    cfgScale = DEFAULTS.cfgScale,
    topK = DEFAULTS.topK,
    quality = DEFAULTS.quality,
    filenamePrefix = 'audio/music3',
  } = params;

  return {
    [N.clipLoader]: {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: MODELS.textEncoder,
        type: 'minimax',
        device: 'default',
      },
    },
    [N.unetLoader]: {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: MODELS.dit,
        weight_dtype: 'default',
      },
    },
    [N.vaeLoader]: {
      class_type: 'VAELoader',
      inputs: { vae_name: MODELS.vae },
    },
    [N.textEncode]: {
      class_type: 'MiniMaxMusic3TextEncode',
      inputs: {
        clip: [N.clipLoader, 0],
        caption,
        lyrics,
        seed,
        max_duration: duration,
        cfg_scale: cfgScale,
        top_k: topK,
      },
    },
    [N.zeroOut]: {
      class_type: 'ConditioningZeroOut',
      inputs: { conditioning: [N.textEncode, 0] },
    },
    [N.emptyLatent]: {
      class_type: 'EmptyMiniMaxMusic3LatentAudio',
      // seconds 取自 TextEncode 的第 2 个输出（模型实际决定的长度）
      inputs: { seconds: [N.textEncode, 1], batch_size: 1 },
    },
    [N.sampler]: {
      class_type: 'KSampler',
      inputs: {
        model: [N.unetLoader, 0],
        seed,
        steps,
        cfg: cfgScale,
        sampler_name: 'euler',
        scheduler: 'simple',
        positive: [N.textEncode, 0],
        negative: [N.zeroOut, 0],
        latent_image: [N.emptyLatent, 0],
        denoise: 1.0,
      },
    },
    [N.decode]: {
      // 固定用 Tiled 版本：8GB 显存下分块解码是必需的，不做可切换开关（YAGNI）
      class_type: 'VAEDecodeAudioTiled',
      inputs: {
        samples: [N.sampler, 0],
        vae: [N.vaeLoader, 0],
        tile_size: DEFAULTS.tileSize,
        overlap: DEFAULTS.tileOverlap,
      },
    },
    [N.save]: {
      class_type: 'SaveAudioAdvanced',
      inputs: {
        audio: [N.decode, 0],
        filename_prefix: filenamePrefix,
        format: DEFAULTS.format,
        'format.quality': quality,
      },
    },
  };
}

/** 保存节点的 id，用于从 /history 结果里取输出文件 */
export const SAVE_NODE_ID = N.save;
