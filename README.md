# MiniMax Music 3 工作台

在本地跑 MiniMax Music 3 生成音乐的极简前端。ComfyUI 负责推理，这个工作台负责把它变成人能用的东西：写描述、点生成、关掉浏览器、回来听。

**零 npm 依赖**，只用 Node 内置模块。

---

## 为什么不直接用 ComfyUI 自带界面

因为在 8GB 显存的机器上，生成一首 3 分钟的歌要 40~70 分钟。没人会盯着节点图等一小时。

所以这个工作台解决的是五件 ComfyUI 不解决的事：

1. **任务在服务端盯着** —— 浏览器关了照样跑完，服务重启也能把在途任务捡回来
2. **诚实的耗时预估** —— 点生成之前就告诉你要等多久，而不是等 20 分钟才发现还早
3. **作品留档** —— 每首歌连同描述、歌词、种子一起存下来，可以「用这套参数再来一次」
4. **一次排多个变体** —— 只换种子、其余参数相同，跑完回来挑，别等失望了再重排队
5. **导出为指定时长** —— 解决下面这个做 BGM 绕不开的问题

---

## 快速开始

```bash
# 1. 自检环境（先跑这个，它会告诉你缺什么）
npm run doctor

# 2. 启动 ComfyUI（保持这个窗口开着）
npm run comfyui

# 3. 另开一个窗口，启动工作台
npm start
```

然后打开 <http://127.0.0.1:5178>

---

## 环境要求

| 项目 | 要求 | 说明 |
|---|---|---|
| ComfyUI | **≥ 0.33.1** | Music 3 原生节点在 0.33.0 落地，0.33.1 修了低显存的关键 bug |
| 显存 | ≥ 8 GB | 8GB 可跑，靠权重流式加载；更大显存明显更快 |
| 内存 | ≥ 16 GB | 文本编码器 8.6 GB 会驻留内存 |
| Node | ≥ 20 | 用到内置 fetch 和 ESM |

### 升级 ComfyUI

```bash
cd <你的 ComfyUI 目录>
git fetch --tags
git checkout v0.33.1
```

> **不要跑 `pip install -r requirements.txt`。**
> 里面 `torch` / `torchvision` / `torchaudio` 是**无版本号的裸依赖**，pip 会从 PyPI 拉 CPU 版覆盖掉你的 CUDA 版本，一条命令废掉 GPU。
> 只显式安装变动的固定版本包，例如：
> ```bash
> .venv/Scripts/python.exe -m pip install --upgrade comfy-kitchen==0.2.31 comfyui-workflow-templates==0.11.41
> ```

---

## 模型下载

三个文件，共约 11.1 GiB。**8GB 显存必须用 int8 版**（官方文档建议先试 fp16，但那条建议不适用于 8GB 卡——fp16 的文本编码器有 15.56 GiB）。

| 放到 | 文件 | 大小 |
|---|---|---|
| `models/diffusion_models/` | `minimax_music3_dit_int8_convrot.safetensors` | 2.33 GiB |
| `models/text_encoders/` | `minimax_music3_text_encoder_pruned_int8_convrot.safetensors` | 8.57 GiB |
| `models/vae/` | `minimax_music3_dav.safetensors` | 0.20 GiB |

来源（两个源文件完全一致，国内用魔搭）：

- 魔搭：<https://www.modelscope.cn/models/Comfy-Org/MiniMax-Music-3>
- HuggingFace：<https://huggingface.co/Comfy-Org/MiniMax-Music-3>

下完用 `npm run doctor` 校验字节数，它会告诉你有没有下全。

### 模型路径配置

`comfy/extra_model_paths.yaml` 指向模型所在目录。默认指向 Comfy Desktop 的共享目录：

```yaml
comfy_desktop_shared:
  base_path: E:/Comfy-Desktop/ComfyUI-Shared/models
```

装在别处就改这里的 `base_path`。

---

## 性能：先看懂这张表再用

本机实测（RTX 5070 Laptop 8GB + int8 模型，热态）：

| 目标时长 | 自回归步数 | 预计耗时 |
|---|---|---|
| 20 秒 | 325 ~ 500 | 2 ~ 3 分钟 |
| 30 秒 | 488 ~ 750 | 2 ~ 5 分钟 |
| 1 分钟 | 977 ~ 1,500 | 4 ~ 9 分钟 |
| 2 分钟 | 1,953 ~ 3,000 | 8 ~ 17 分钟 |
| 3 分钟 | 2,930 ~ 4,500 | 12 ~ 25 分钟 |
| 6 分钟（上限） | 5,860 ~ 9,000 | 24 ~ 50 分钟 |

**为什么耗时**：大头不是扩散采样（30 步只要 13 秒），而是文本编码器。
`MiniMaxMusic3AR` 是自回归模型，逐帧生成声学条件序列，25 帧 = 1 秒音频。

**为什么是区间不是定值**，两个来源：

1. **步数区间** —— 步数按**实际输出时长**算，不是请求时长。模型会提前收尾
   （日志里进度条实测停在 `331/501`、`1630/2501`，根本没跑满），实测输出/请求
   比例要么 ~100% 要么 ~65%
2. **速率区间** —— 实测 0.24 ~ 0.33 秒/步。ComfyUI 刚启动后的第一次约
   0.56 秒/步（CUDA Graphs 要先捕获、权重要先进页缓存），之后稳定在快档

所以：

- 调低「扩散步数」几乎省不了时间 —— 它只影响那 13 秒
- **唯一能显著减少等待的办法是缩短时长**
- 首次生成额外约 76 秒加载模型，之后常驻内存

### 预估会自己变准

预估不是写死的常数，而是**从本机历史校准**：每完成一次任务，工作台记下
实际输出时长和纯生成耗时，反推每步耗时；攒够 3 次后就改用本机实测值
（取 15% / 85% 分位，避免单次异常撑坏区间），并只看最近 12 次。

界面上的「基于本机最近 N 次实测」就是在说这件事。换显卡、换模型精度、
后台开了别的程序，它都会自己跟上。

---

## 时长是「上限」不是「保证」——做 BGM 必读

`max_duration` 只是上限，**模型自己决定何时收尾**。本机实测：

| 请求 | 实际输出 | 缩水 |
|---|---|---|
| 20 秒（seed 12345） | 19.99 秒 | 0% |
| 20 秒（seed 777） | 19.99 秒 | 0% |
| 20 秒（seed 189241234240472） | **13.15 秒** | **34%** |
| 25 秒 | 25.00 秒 | 0% |
| 100 秒 | **65.11 秒** | **35%** |

同一段描述、同样参数，只换种子，结果可能给满也可能少三分之一。配视频时这会直接让你返工。

**解法：用「导出为指定时长」。** 完成的曲子上有这个按钮：

- 不够长 → 用 `acrossfade` 交叉淡化循环拼接补足（不是硬接，接缝无「咔」声，实测无静音段、RMS 连续）
- 超长 → 裁剪
- 两端自动加淡入淡出
- 输出**精确命中目标时长**，误差 0.000 秒（15/30/60/90/120 秒实测）

需要 `ffmpeg` 和 `ffprobe` 在 PATH 里。

---

## 怎么写出好听的

### 音乐描述（caption）

模型吃三段式结构，缺一段效果就打折：

```
Global Metadata: 曲风、BPM、调性、情绪走向、制作风格
Vocal Details:   人声性别、音色、演唱方式、和声、效果（纯器乐写 Instrumental, no vocals）
Arrangement:     乐器、律动、低音、打击乐、空间感
```

界面里有 8 个曲风预设，都是可直接改的完整样例。建议从最接近的那个改，别从空白开始。

### 歌词

用结构标签分段，标签给结构、文字给情绪：

```
[Intro] [Verse] [Chorus] [Bridge] [Instrumental] [Outro]
```

留空 = 纯器乐。歌词可以是中文。

### 种子

固定种子 + 相同描述 = 完全一样的结果。想要同一个想法的不同版本，就固定描述、换种子。

---

## 目录结构

```
minimax-music-studio/
├── comfy/extra_model_paths.yaml   模型目录配置
├── scripts/start-comfyui.ps1      启动 ComfyUI（带版本闸门）
├── server/
│   ├── index.js         HTTP 入口与路由
│   ├── config.js        全部配置与常量
│   ├── workflow.js      ComfyUI API 工作流构造
│   ├── validate.js      输入校验（系统边界）
│   ├── comfy-api.js     ComfyUI 接口封装
│   ├── jobs.js          任务编排与后台跟踪
│   ├── library.js       生成记录持久化
│   ├── presets.js       曲风预设
│   ├── estimate.js      耗时预估 + 本机历史自校准
│   ├── export-audio.js  时长适配（ffmpeg 循环/裁剪/淡化）
│   └── doctor.js        环境自检
└── web/                 前端（原生 HTML/CSS/JS）
```

生成记录存在 `data/library.json`，音频文件留在 ComfyUI 的 `output/audio/`。

---

## 排错

**「ComfyUI 未运行」** —— 跑 `npm run comfyui`，等约 60~70 秒完全启动。

**「缺少 Music 3 节点」** —— ComfyUI 版本低于 0.33.1，按上面升级。

**「缺少模型」** —— 跑 `npm run doctor` 看具体缺哪个、该放哪。

**任务卡在「排队中」** —— ComfyUI 一次只跑一个任务，前面还有任务在跑。

**生成失败且报显存不足** —— 缩短时长；确认用的是 int8 模型而不是 fp16。

---

## 已知取舍

- **只支持文生音乐**，没做续写、改编、参考音频
- **VAE 解码固定用分块模式**（低显存必需），大显存机器上这会略微牺牲速度
- **没接云端 API**，纯本地
- **变体是串行跑的** —— ComfyUI 一次只处理一个任务，排 3 个就是 3 倍时间，界面会把总时长算给你看
- 导出的循环 BGM 是「首尾交叉淡化」，不是真正的无缝 loop 点，单曲循环播放时接缝仍可察觉；配视频（有人声/音效压着）足够用

---

## 相关

- 模型：[MiniMaxAI/MiniMax-Music3](https://huggingface.co/MiniMaxAI/MiniMax-Music3)
- ComfyUI 官方教程：<https://docs.comfy.org/tutorials/audio/minimax/minimax-music-3>
