/**
 * 曲风 = 告诉模型"这是什么类型的音乐"，而不是一段替用户写好的 prompt。
 *
 * ## 为什么不再往描述框里灌模板
 *
 * 之前点一个曲风就把整段范文塞进描述框，把两件不同的事混成了一件：
 *   - 类型（分类信号：这是 lo-fi 还是爵士）
 *   - 意图（这一首具体要什么：雨夜、适合看书、别太吵）
 *
 * 混在一起的后果：用户得去改别人写的段落；换风格就丢掉自己写的东西；
 * 风格不再是可独立切换的维度，它融化进自由文本里了。
 *
 * 现在风格是结构化字段，用户只写自己的想法，最终 caption 在提交时合成。
 * 合成结果对用户可见可改 —— 不能是黑箱，否则出了不满意的结果没法调。
 */

/** 人声取向。BGM 绝大多数要纯器乐，所以它是默认值 */
export const VOCAL_MODES = Object.freeze([
  {
    id: 'instrumental',
    name: '纯器乐',
    hint: '配视频/BGM 首选，人声会抢旁白',
    text: 'Instrumental, no vocals.',
  },
  {
    id: 'female',
    name: '女声',
    hint: '',
    text: 'Female lead vocal, {timbre}, natural phrasing, light harmonies on the chorus.',
  },
  {
    id: 'male',
    name: '男声',
    hint: '',
    text: 'Male lead vocal, {timbre}, natural phrasing, light harmonies on the chorus.',
  },
  {
    id: 'choir',
    name: '和声/合唱',
    hint: '无实词，当作乐器用',
    text: 'Wordless choir pads used as texture, no lead vocals.',
  },
]);

/**
 * 每个曲风拆成模型能吃的几个维度。
 * 全部用英文技术术语 —— 官方示例都是英文，曲风/调性/制作这些词的
 * 英文表述在训练数据里最密集。用户自己的话不翻译，原样带过去。
 */
const s = (id, name, icon, f) => Object.freeze({ id, name, icon, ...f });

export const STYLES = Object.freeze([
  s('lofi', 'Lo-fi 学习', 'radio', {
    genre: 'Lo-fi hip-hop, chillhop',
    tempo: '72-84 BPM',
    tonality: 'major key with jazzy sevenths and ninths',
    mood: 'laid-back and dreamy, a warm late-night glow',
    production: 'warm analog production, tape saturation, vinyl crackle, slightly off-grid swing',
    instruments: 'dusty Rhodes piano, soft upright bass, brushed lo-fi drums, occasional muted trumpet, wide reverb tail',
    vocalTimbre: 'soft and breathy, mixed low under the instruments',
    defaultVocal: 'instrumental',
  }),

  s('cinematic', '电影配乐', 'film', {
    genre: 'Cinematic orchestral, trailer score',
    tempo: '80-100 BPM',
    tonality: 'minor key, modal with suspended chords',
    mood: 'starts sparse and tense, builds to a full-orchestra climax, resolves into quiet strings',
    production: 'wide modern film-score production, deep sub layer, large hall reverb',
    instruments: 'low staccato strings ostinato, French horns, taiko drums and cinematic booms, soaring violin melody, piano underneath, riser transitions',
    vocalTimbre: 'ethereal and wordless, sitting far back in the mix',
    defaultVocal: 'choir',
  }),

  s('citypop', '都市流行', 'city', {
    genre: '80s Japanese city pop',
    tempo: '104-118 BPM',
    tonality: 'major key with lush extended chords',
    mood: 'bright, nostalgic and breezy, a warm summer-night drive that lifts in the chorus',
    production: 'vintage analog production, tape warmth, gated reverb on drums',
    instruments: 'slap bass, electric piano, clean chorus-drenched guitar, DX7-style bells, punchy live drums, saxophone in the bridge',
    vocalTimbre: 'smooth mid-range, relaxed and slightly airy',
    defaultVocal: 'female',
  }),

  s('folk', '民谣木吉他', 'guitar', {
    genre: 'Intimate acoustic folk, singer-songwriter',
    tempo: '76-92 BPM',
    tonality: 'open major key, simple diatonic harmony',
    mood: 'warm, honest and unhurried, gently hopeful toward the end',
    production: 'close-miked natural production, minimal processing, room ambience',
    instruments: 'fingerpicked steel-string acoustic guitar, upright bass, brushed snare, subtle cello pad, mandolin fills late',
    vocalTimbre: 'warm with a slight rasp, conversational and close',
    defaultVocal: 'male',
  }),

  s('edm', '电子舞曲', 'sliders', {
    genre: 'Melodic progressive house',
    tempo: '120-128 BPM',
    tonality: 'minor key, repetitive four-chord loop',
    mood: 'hypnotic and euphoric, long tension build into a wide emotional drop',
    production: 'clean modern club production, sidechain pumping, very wide stereo field',
    instruments: 'rolling analog bassline, plucked arpeggios, warm supersaw chords, four-on-the-floor kick, white-noise risers and impacts',
    vocalTimbre: 'breathy and heavily processed, chopped into rhythmic stabs',
    defaultVocal: 'instrumental',
  }),

  s('guzheng', '国风古韵', 'lantern', {
    genre: 'Modern Chinese traditional fusion, guofeng',
    tempo: '64-80 BPM',
    tonality: 'pentatonic scale, no leading tone',
    mood: 'serene and misty at first, gradually more resolute, ends in stillness',
    production: 'spacious natural production with a sense of distance and air',
    instruments: 'guzheng lead, dizi flute counter-melody, erhu later, soft frame drum pulse, sparse pipa plucks, subtle string pad',
    vocalTimbre: 'clear and slightly nasal traditional timbre, restrained vibrato',
    defaultVocal: 'instrumental',
  }),

  s('jazz', '爵士三重奏', 'sax', {
    genre: 'Late-night jazz trio, cool jazz',
    tempo: '88-104 BPM',
    tonality: 'major key with ii-V-I turnarounds and chromatic passing chords',
    mood: 'smoky, relaxed and conversational, a slow simmer that never fully boils',
    production: 'vintage analog recording, natural room bleed, minimal compression',
    instruments: 'acoustic piano leading, walking upright bass, brushed drum kit with ride cymbal, muted trumpet solo in the middle, generous space between phrases',
    vocalTimbre: 'smoky and intimate, behind the beat',
    defaultVocal: 'instrumental',
  }),

  s('ambient', '氛围冥想', 'mist', {
    genre: 'Ambient drone, meditative soundscape',
    tempo: '56-68 BPM, no strong pulse',
    tonality: 'Lydian mode, slow harmonic drift',
    mood: 'weightless and still throughout, extremely slow evolution, dissolves at the end',
    production: 'very wide production, long reverb tails, granular textures',
    instruments: 'sustained synth pads, bowed glass textures, distant reverberant piano notes, field-recording air, occasional low swells, no percussion',
    vocalTimbre: 'wordless and distant, almost part of the pad',
    defaultVocal: 'instrumental',
  }),
]);

export const getStyle = (id) => STYLES.find((x) => x.id === id) ?? null;
export const getVocalMode = (id) => VOCAL_MODES.find((x) => x.id === id) ?? VOCAL_MODES[0];

/**
 * 把「曲风 + 人声取向 + 用户自己的话」合成为模型要的三段式 caption。
 *
 * 用户的话原样保留、且放在情绪位置的最前面 —— 它是这一首的具体意图，
 * 应该压过曲风自带的通用情绪描述，而不是被淹没在里面。
 *
 * @param {object} input
 * @param {string} input.styleId
 * @param {string} input.vocalId
 * @param {string} input.brief 用户自己写的想法，可为空
 * @returns {string} 完整 caption
 */
/** 句首大写。官方示例都是规范英文句子，拼出来一串小写开头显得潦草 */
const cap = (s) => {
  const t = String(s ?? '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

/** 去掉用户句尾的标点，免得拼接后出现 "。." 这类重复 */
const stripTrailingPunct = (s) => String(s ?? '').trim().replace(/[.。;；,，、]+$/u, '');

export function composeCaption({ styleId, vocalId, brief }) {
  const style = getStyle(styleId);
  const userBrief = (brief ?? '').trim();

  // 没选曲风就只有用户自己的话 —— 那就当作完整描述直接用
  if (!style) return userBrief;

  const vocal = getVocalMode(vocalId ?? style.defaultVocal);
  const vocalText = vocal.text.replace('{timbre}', style.vocalTimbre);

  // 用户的话放在情绪位置的最前面：它是这一首的具体意图，
  // 应该压过曲风自带的通用情绪，而不是被淹没在后面
  const moodParts = [];
  if (userBrief) moodParts.push(stripTrailingPunct(userBrief));
  moodParts.push(style.mood);

  const global = [
    `Global Metadata: ${cap(style.genre)}.`,
    `${cap(style.tempo)}, ${style.tonality}.`,
    `${moodParts.map(cap).join('. ')}.`,
    `${cap(style.production)}.`,
  ].join(' ');

  return [
    global,
    `Vocal Details: ${cap(vocalText)}`,
    `Arrangement: ${cap(style.instruments)}.`,
  ].join('\n');
}

/** 给这个曲风一段合适的起始歌词骨架；纯器乐就一个标签 */
export function defaultLyrics(styleId, vocalId) {
  const style = getStyle(styleId);
  const vocal = getVocalMode(vocalId ?? style?.defaultVocal);
  if (!style || vocal.id === 'instrumental' || vocal.id === 'choir') return '[Instrumental]';
  return '[Intro]\n\n[Verse]\n\n[Chorus]\n\n[Verse]\n\n[Chorus]\n\n[Outro]';
}
