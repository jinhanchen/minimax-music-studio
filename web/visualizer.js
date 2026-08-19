/**
 * 播放可视化：真实频谱 + 流光。
 *
 * 频谱来自 Web Audio 的 AnalyserNode，是音频的真实频率数据，不是随机动画 ——
 * 假动画和音乐对不上，一眼就假。
 *
 * 三个必须小心的点：
 * 1. `createMediaElementSource` 对同一个 <audio> 只能调一次，调第二次抛异常，
 *    所以必须缓存节点。
 * 2. 一旦接进 Web Audio 图，音频只从 AudioContext 出声 —— 中途出错会导致
 *    "有进度条没声音"。所以整条接线都包在 try 里，失败就退回原生播放，
 *    只是没有频谱。
 * 3. AudioContext 需要用户手势才能启动，play 事件本身就是手势，在那里 resume()。
 */

let ctx = null;
/** 每个 <audio> 只能建一次 source，缓存起来 */
const sources = new WeakMap();
/** 当前正在跑的动画帧，切歌时要停掉旧的 */
const running = new WeakMap();

function audioContext() {
  if (!ctx) {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/**
 * 把 <audio> 接上分析器。
 * @returns {AnalyserNode|null} 接不上就返回 null，调用方降级处理
 */
function connect(audioEl) {
  const ac = audioContext();
  if (!ac) return null;
  try {
    let entry = sources.get(audioEl);
    if (!entry) {
      const source = ac.createMediaElementSource(audioEl);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;          // 128 个频段，够画又不至于太碎
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);
      analyser.connect(ac.destination);
      entry = { source, analyser };
      sources.set(audioEl, entry);
    }
    if (ac.state === 'suspended') ac.resume();
    return entry.analyser;
  } catch {
    // 接线失败就别硬来，让原生播放继续
    return null;
  }
}

/**
 * 在 canvas 上画频谱，并把整体响度回调出去（给流光强度用）。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLAudioElement} audioEl
 * @param {(level:number)=>void} onLevel 0~1 的整体响度
 */
export function attachVisualizer(canvas, audioEl, onLevel) {
  const analyser = connect(audioEl);
  const g = canvas.getContext('2d');
  if (!g) return;

  stopVisualizer(canvas);

  const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  // 接不上分析器时用这个做温和的兜底波形，不至于一片死寂
  let fallbackPhase = 0;

  const state = { alive: true, raf: 0 };
  running.set(canvas, state);

  const draw = () => {
    if (!state.alive) return;
    state.raf = requestAnimationFrame(draw);

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const BARS = 40;
    const gap = 2;
    const bw = (w - gap * (BARS - 1)) / BARS;
    let sum = 0;

    // 每帧只取一次频谱数据 —— 放进逐柱循环里会变成每帧 40 次
    if (bins && analyser) analyser.getByteFrequencyData(bins);
    if (!bins) fallbackPhase += 0.02;

    for (let i = 0; i < BARS; i += 1) {
      const t = i / (BARS - 1);
      let v;
      if (bins && analyser) {
        // 低频能量天然远高于高频，直接线性取样会画成一条单调下滑的斜坡。
        // 对数取样 + 高频增益补偿，才看得出各频段各自在动。
        const idx = Math.min(bins.length - 1, Math.floor(t ** 1.75 * (bins.length - 1)));
        const gain = 1 + t * 1.9;
        v = Math.min(1, (bins[idx] / 255) * gain);
      } else {
        v = 0.18 + 0.12 * Math.abs(Math.sin(fallbackPhase * 3 + i * 0.5));
      }
      // 抬一点底，静音段也保留细线，不然界面像坏了
      v = Math.max(0.06, v);
      sum += v;

      const bh = v * h;
      const x = i * (bw + gap);
      const y = (h - bh) / 2;

      const grad = g.createLinearGradient(0, y, 0, y + bh);
      grad.addColorStop(0, `rgba(255, 200, 120, ${0.45 + v * 0.55})`);
      grad.addColorStop(0.5, `rgba(240, 165, 60, ${0.65 + v * 0.35})`);
      grad.addColorStop(1, `rgba(200, 110, 25, ${0.4 + v * 0.4})`);
      g.fillStyle = grad;

      const r = Math.min(bw / 2, 2);
      g.beginPath();
      g.roundRect(x, y, bw, bh, r);
      g.fill();
    }

    if (onLevel) onLevel(Math.min(1, (sum / BARS) * 1.6));
  };

  draw();
}

/**
 * 待机态：画一条静态的低幅波形。
 * 空白画布看起来像组件坏了，给个静止形态明确表示"这里是频谱，还没播"。
 */
export function drawIdle(canvas) {
  const g = canvas?.getContext?.('2d');
  if (!g) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const BARS = 40;
  const gap = 2;
  const bw = (w - gap * (BARS - 1)) / BARS;
  for (let i = 0; i < BARS; i += 1) {
    // 确定性的伪随机：同一张卡片每次重绘形状一致，不会闪
    const v = 0.08 + 0.055 * Math.abs(Math.sin(i * 1.7) + Math.sin(i * 0.6));
    const bh = Math.max(2, v * h);
    const x = i * (bw + gap);
    g.fillStyle = 'rgba(150, 160, 180, 0.16)';
    g.beginPath();
    g.roundRect(x, (h - bh) / 2, bw, bh, Math.min(bw / 2, 2));
    g.fill();
  }
}

export function stopVisualizer(canvas) {
  const state = running.get(canvas);
  if (state) {
    state.alive = false;
    cancelAnimationFrame(state.raf);
    running.delete(canvas);
  }
  // 停下来后回到待机形态，而不是留一块空白
  if (canvas?.isConnected) drawIdle(canvas);
  else {
    const g = canvas?.getContext?.('2d');
    if (g) g.clearRect(0, 0, canvas.width, canvas.height);
  }
}
