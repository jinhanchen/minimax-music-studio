/**
 * 极简静态文件服务。只服务 web/ 目录，路径穿越一律拒绝。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './config.js';

const WEB_DIR = path.join(ROOT, 'web');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
});

export async function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const target = path.join(WEB_DIR, path.normalize(rel));

  // 归一化之后必须仍在 web/ 之内，否则是穿越尝试
  if (!target.startsWith(WEB_DIR + path.sep) && target !== path.join(WEB_DIR, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return true;
  }

  try {
    const data = await fs.readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return false;
    throw err;
  }
}
