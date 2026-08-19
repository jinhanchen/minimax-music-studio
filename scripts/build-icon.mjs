/**
 * 把 assets/icon.html 渲染成多尺寸 .ico。
 *
 * 两个必须守住的点（都是踩过的坑）：
 * 1. 尺寸显式写死在 SVG 属性上，不用 vw/vh —— 无头浏览器的真实视口
 *    和 --window-size 不是一回事，用视口单位会把图标摊大再被裁一角。
 * 2. 每张 PNG 渲染完必须读回真实像素尺寸校验。`file icon.ico` 的元数据
 *    会骗人，只有逐张验才靠得住。
 *
 * ICO 容器是纯手写的：一个 6 字节头 + 每张 16 字节目录项 + 直接塞 PNG。
 * 不引第三方图形库。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'assets', 'icon.html');
const OUT = path.join(ROOT, 'assets', 'icon.ico');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** playwright-core 不是本项目依赖，从同盘其它项目借用 —— 只在构建图标时需要 */
const PLAYWRIGHT_CANDIDATES = [
  'E:/Frank vibe coding(Legion)/campus-errand/node_modules/playwright-core/index.mjs',
  'E:/Frank vibe coding(Legion)/paike-app/node_modules/playwright-core/index.mjs',
  'E:/Frank vibe coding(Legion)/obsidian-para-house/node_modules/playwright-core/index.mjs',
];

async function firstExisting(list) {
  for (const p of list) {
    try { await fs.access(p); return p; } catch { /* 继续找 */ }
  }
  return null;
}

/** PNG 的 IHDR 里有真实宽高，用它校验渲染结果，不信调用参数 */
function readPngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function packIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type = icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach((img, i) => {
    const at = i * 16;
    // 256 在这个字段里写 0 —— 单字节存不下 256
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at + 0);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, at + 1);
    dir.writeUInt8(0, at + 2);     // 调色板色数
    dir.writeUInt8(0, at + 3);     // reserved
    dir.writeUInt16LE(1, at + 4);  // color planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(img.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += img.data.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

const pwPath = await firstExisting(PLAYWRIGHT_CANDIDATES);
if (!pwPath) {
  console.error('找不到 playwright-core。图标已随仓库提供，只有要重新生成时才需要它。');
  process.exit(1);
}
const browserPath = await firstExisting([EDGE, CHROME]);
if (!browserPath) {
  console.error('找不到 Edge 或 Chrome，无法渲染图标。');
  process.exit(1);
}

const { chromium } = await import(pathToFileURL(pwPath).href);
const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
});

const images = [];
let bad = 0;

for (const size of SIZES) {
  const page = await browser.newPage({
    viewport: { width: size + 40, height: size + 40 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(SRC).href, { waitUntil: 'load' });
  // 显式改属性，不靠 CSS 缩放，保证输出正好是 size×size
  await page.evaluate((s) => {
    const svg = document.getElementById('icon');
    svg.setAttribute('width', String(s));
    svg.setAttribute('height', String(s));
  }, size);
  await page.waitForTimeout(120);

  const data = await page.locator('#icon').screenshot({ omitBackground: true });
  const actual = readPngSize(data);
  const ok = actual && actual.width === size && actual.height === size;
  if (!ok) bad += 1;
  console.log(`  [${ok ? 'OK ' : 'BAD'}] ${size}×${size}  →  实际 ${actual ? `${actual.width}×${actual.height}` : '不是PNG'}  ${data.length} B`);
  images.push({ size, data });
  await page.close();
}

await browser.close();

if (bad > 0) {
  console.error(`\n有 ${bad} 张尺寸不对，不生成 .ico`);
  process.exit(1);
}

await fs.writeFile(OUT, packIco(images));
const st = await fs.stat(OUT);
console.log(`\n  已写出 ${OUT}`);
console.log(`  ${images.length} 种尺寸，共 ${(st.size / 1024).toFixed(1)} KB`);
