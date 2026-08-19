/**
 * 内联 SVG 图标库。
 *
 * 全部 24×24 视图框、线性描边、颜色跟随 currentColor —— 这样图标会自动
 * 继承按钮/文字的颜色状态（hover、选中、禁用），不用为每种状态各画一版。
 *
 * 不用 emoji：emoji 在不同系统上字形、粗细、基线都不一样，没法和界面
 * 的线条语言统一，也无法跟随主题色。
 */

const svg = (body, { fill = false } = {}) =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"`
  + ` fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}"`
  + ` stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = Object.freeze({
  /* ---- 曲风预设 ---- */
  radio: svg('<rect x="2.5" y="8" width="19" height="12.5" rx="2.5"/>'
    + '<path d="M7 8 17.5 3.5"/><circle cx="16.5" cy="14.2" r="3.2"/>'
    + '<path d="M6 12.5h4M6 16h4"/>'),

  film: svg('<rect x="2.5" y="4" width="19" height="16" rx="2.5"/>'
    + '<path d="M7.5 4v16M16.5 4v16M2.5 12h19M2.5 8h5M2.5 16h5M16.5 8h5M16.5 16h5"/>'),

  city: svg('<path d="M3 21V9l6-3.5V21"/><path d="M9 21V11l6-3.5V21"/>'
    + '<path d="M15 21V13l6-3.5V21"/><path d="M2 21h20"/>'
    + '<path d="M5.5 12.5v1M5.5 16v1M11.5 14v1M11.5 17.5v1M17.5 15.5v1"/>'),

  guitar: svg('<path d="M20.5 3.5 16 8"/><path d="M18.4 5.6 20 4l1.2 1.2L19.6 6.8"/>'
    + '<path d="M15.2 8.8c1.6 1.6 1.3 3.3.2 4.6-1.4 1.6-1.1 3.1.1 4.3 1.2 1.2 1 2.8-.5 4-1.8 1.4-4.6 1.2-6.6-.8s-2.2-4.8-.8-6.6c1.2-1.5 2.8-1.7 4-.5"/>'
    + '<circle cx="10.6" cy="15.2" r="2.1"/>'),

  sliders: svg('<path d="M5 3v6M5 15v6M12 3v3M12 12v9M19 3v9M19 18v3"/>'
    + '<circle cx="5" cy="12" r="2.4"/><circle cx="12" cy="9" r="2.4"/><circle cx="19" cy="15" r="2.4"/>'),

  lantern: svg('<path d="M12 2v2.5M12 19.5V22"/>'
    + '<ellipse cx="12" cy="12" rx="7" ry="7.5"/>'
    + '<path d="M9 4.5h6M9 19.5h6"/><path d="M12 4.5v15M8.4 5.6c-1 3.9-1 8.9 0 12.8M15.6 5.6c1 3.9 1 8.9 0 12.8"/>'),

  sax: svg('<path d="M9 2.5v7.5c0 4.5 1.5 6.5 4.5 7.5"/>'
    + '<path d="M13.5 17.5c2.4.8 4.3-.2 5-2.2.6-1.9-.4-3.6-2.2-4"/>'
    + '<path d="M16.3 11.3 20.5 9l1 2.6-4 2.2"/>'
    + '<path d="M7 2.5h4"/><circle cx="9.4" cy="7" r=".9" fill="currentColor" stroke="none"/>'
    + '<circle cx="9.7" cy="11" r=".9" fill="currentColor" stroke="none"/>'),

  mist: svg('<path d="M3 8h13M18.5 8H21M3 12h6M11.5 12h9M3 16h11M16.5 16H21M6 20h12"/>'),

  /* ---- 状态 ---- */
  check: svg('<path d="M4 12.5 9.5 18 20 6.5"/>'),
  warn: svg('<path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5M12 17.2v.1"/>'),
  cross: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  dot: svg('<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>'),

  /* ---- 操作 ---- */
  download: svg('<path d="M12 3v12M7 10.5l5 5 5-5M4 20h16"/>'),
  play: svg('<path d="M7 4.5 19.5 12 7 19.5z"/>', { fill: true }),
  scissors: svg('<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/>'
    + '<path d="M8.2 7.6 20 18M20 6 8.2 16.4"/>'),
  loop: svg('<path d="M4 9.5A5 5 0 0 1 9 4.5h9"/><path d="M15 1.8 18.4 4.5 15 7.2"/>'
    + '<path d="M20 14.5a5 5 0 0 1-5 5H6"/><path d="M9 22.2 5.6 19.5 9 16.8"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/>'
    + '<path d="M15.5 5.5h-9a2.5 2.5 0 0 0-2.5 2.5v9"/>'),
  trash: svg('<path d="M4 6.5h16M9.5 6.5V4h5v2.5"/>'
    + '<path d="M6.5 6.5 7.4 20a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-13.5"/>'
    + '<path d="M10.5 10.5v7M13.5 10.5v7"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/>'),
  chevron: svg('<path d="M8 5l7 7-7 7"/>'),
  refresh: svg('<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.5 2.2"/>'),
  wave: svg('<path d="M2 12h2.5M7 6.5v11M11.5 3.5v17M16 8v8M20.5 10.5v3"/>'),
  spark: svg('<path d="M12 2.5 13.9 9 20.5 11 13.9 13 12 19.5 10.1 13 3.5 11 10.1 9z"/>'),
  folder: svg('<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),

  /** 品牌标：与桌面图标同一形状（火花 = 生成，频谱 = 音频） */
  brand: svg(
    '<path d="M12 2.2 Q12.9 6.9 17.6 7.9 Q12.9 8.9 12 13.6 Q11.1 8.9 6.4 7.9 Q11.1 6.9 12 2.2 Z"/>'
    + '<rect x="2.6" y="18.1" width="2.9" height="2.9" rx="1.45"/>'
    + '<rect x="6.5" y="16.1" width="2.9" height="4.9" rx="1.45"/>'
    + '<rect x="10.5" y="14.5" width="2.9" height="6.5" rx="1.45"/>'
    + '<rect x="14.5" y="16.7" width="2.9" height="4.3" rx="1.45"/>'
    + '<rect x="18.5" y="18.3" width="2.9" height="2.7" rx="1.45"/>',
    { fill: true },
  ),
});

/** 找不到就退回一个中性圆点，绝不渲染成空白 */
export const icon = (name) => ICONS[name] ?? ICONS.dot;

/** 塞进 innerHTML 时用：包一层 span 方便控制尺寸与对齐 */
export const iconSpan = (name, cls = '') =>
  `<span class="ico ${cls}">${icon(name)}</span>`;
