/**
 * 曲风预设。
 *
 * MiniMax Music 3 的 caption 要求三段式结构（全局元数据 / 人声细节 / 编曲），
 * 空白输入框对人非常不友好 —— 这些预设是可直接改的起点，不是不可动的模板。
 *
 * 结构依据官方文档：
 *   Global Metadata: 曲风、BPM、调性、情绪走向、制作风格
 *   Vocal Details:   性别、音色、演唱方式、和声、效果
 *   Arrangement:     乐器、律动、低音、打击乐、空间感
 */

const p = (id, name, icon, caption, lyrics) =>
  Object.freeze({ id, name, icon, caption, lyrics });

export const PRESETS = Object.freeze([
  p('lofi', 'Lo-fi 学习', 'radio',
    'Global Metadata: Lo-fi hip-hop, chillhop. 78 BPM, D-flat major with jazzy extensions. '
    + 'Laid-back and dreamy throughout, a gentle warm drift with a subtle late-night glow. '
    + 'Warm analog production, tape saturation, slightly off-grid swing.\n'
    + 'Vocal Details: Instrumental, no vocals.\n'
    + 'Arrangement: Dusty Rhodes piano, soft upright bass, brushed lo-fi drums with sidechained '
    + 'vinyl crackle, muted trumpet accents in the second half, wide reverb tail.',
    '[Instrumental]'),

  p('cinematic', '电影配乐', 'film',
    'Global Metadata: Cinematic orchestral, epic trailer score. 90 BPM, D minor. '
    + 'Starts sparse and tense, builds steadily to a full-orchestra climax, resolves into quiet strings. '
    + 'Wide modern film-score production, deep sub layer, large hall reverb.\n'
    + 'Vocal Details: Wordless ethereal female choir pads in the climax, no lead vocals.\n'
    + 'Arrangement: Low staccato strings ostinato, French horns, taiko drums and cinematic booms, '
    + 'soaring violin melody, piano ostinato underneath, riser transitions.',
    '[Instrumental]'),

  p('citypop', '都市流行', 'city',
    'Global Metadata: 80s Japanese city pop. 112 BPM, F-sharp major. '
    + 'Bright, nostalgic and breezy, a warm summer-night drive feeling that lifts in the chorus. '
    + 'Vintage analog production, tape warmth, gated reverb on drums.\n'
    + 'Vocal Details: Female lead, smooth mid-range timbre, relaxed and slightly airy delivery, '
    + 'stacked harmonies on the chorus, light chorus effect.\n'
    + 'Arrangement: Slap bass, electric piano, clean chorus-drenched guitar, DX7-style bells, '
    + 'punchy live drums, saxophone solo in the bridge.',
    '[Intro]\n\n[Verse]\n霓虹漫过车窗 夜色刚刚好\n电台还在唱着 去年的调子\n\n[Chorus]\n再开一段吧 别急着回家\n这条路的尽头 有还没说的话\n\n[Bridge]\n\n[Outro]'),

  p('folk', '民谣木吉他', 'guitar',
    'Global Metadata: Intimate acoustic folk singer-songwriter. 84 BPM, G major. '
    + 'Warm, honest and unhurried, gently hopeful toward the end. '
    + 'Close-miked natural production, minimal processing, room ambience.\n'
    + 'Vocal Details: Male lead, warm baritone with a slight rasp, conversational and close, '
    + 'soft double-tracked harmony on the chorus.\n'
    + 'Arrangement: Fingerpicked steel-string acoustic guitar, upright bass, brushed snare, '
    + 'subtle cello pad, mandolin fills in the last chorus.',
    '[Intro]\n\n[Verse]\n\n[Chorus]\n\n[Verse]\n\n[Chorus]\n\n[Outro]'),

  p('edm', '电子舞曲', 'sliders',
    'Global Metadata: Melodic progressive house. 126 BPM, A minor. '
    + 'Hypnotic and euphoric, long tension build into a wide emotional drop, gentle outro. '
    + 'Clean modern club production, sidechain pumping, very wide stereo field.\n'
    + 'Vocal Details: Female topline, breathy and processed, heavy reverb and delay throws, '
    + 'chopped vocal stabs used as a rhythmic element in the drop.\n'
    + 'Arrangement: Rolling analog bassline, plucked arpeggios, warm supersaw chords, '
    + 'four-on-the-floor kick, white-noise risers and impacts at transitions.',
    '[Intro]\n\n[Build]\n\n[Drop]\n\n[Breakdown]\n\n[Drop]\n\n[Outro]'),

  p('guzheng', '国风古韵', 'lantern',
    'Global Metadata: Modern Chinese traditional fusion, guofeng. 72 BPM, pentatonic scale in D. '
    + 'Serene and misty at the start, gradually more resolute, ends in stillness. '
    + 'Spacious natural production with a sense of distance and air.\n'
    + 'Vocal Details: Female lead, clear and slightly nasal traditional timbre, restrained vibrato, '
    + 'occasional wordless humming between phrases.\n'
    + 'Arrangement: Guzheng lead, dizi flute counter-melody, erhu in the second half, '
    + 'soft frame drum pulse, sparse pipa plucks, subtle string pad underneath.',
    '[Intro]\n\n[Verse]\n\n[Chorus]\n\n[Instrumental]\n\n[Chorus]\n\n[Outro]'),

  p('jazz', '爵士三重奏', 'sax',
    'Global Metadata: Late-night jazz trio, cool jazz. 96 BPM, B-flat major with ii-V-I turnarounds. '
    + 'Smoky, relaxed and conversational, a slow simmer that never fully boils. '
    + 'Vintage analog recording, natural room bleed, minimal compression.\n'
    + 'Vocal Details: Instrumental, no vocals.\n'
    + 'Arrangement: Acoustic piano leading, walking upright bass, brushed drum kit with ride cymbal, '
    + 'muted trumpet taking the middle solo, tasteful space between phrases.',
    '[Instrumental]'),

  p('ambient', '氛围冥想', 'mist',
    'Global Metadata: Ambient drone, meditative soundscape. 60 BPM, C Lydian, no strong pulse. '
    + 'Weightless and still throughout, extremely slow evolution, dissolves at the end. '
    + 'Very wide production, long reverb tails, granular textures.\n'
    + 'Vocal Details: Instrumental, no vocals.\n'
    + 'Arrangement: Sustained synth pads, bowed glass textures, distant piano notes with heavy reverb, '
    + 'field-recording air, occasional low swells, no percussion.',
    '[Instrumental]'),
]);
